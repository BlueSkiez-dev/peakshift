// State store with two backends behind one contract:
//   • Postgres (DATABASE_URL set — production / Vercel): the authoritative document lives in
//     `peakshift_state` (JSONB). Each request hydrates the latest state; every mutation is a
//     row-locked transaction (SELECT … FOR UPDATE), so concurrent serverless instances serialise.
//   • File (local dev, no DATABASE_URL): one JSON file written atomically.
// Reads are synchronous against the request's hydrated snapshot; call `readFresh()` (or `hydrate()`)
// at the start of every request before using `read()`.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { AppState, AuditEvent, Role } from "./types";
import { buildSeed, SEED_VERSION } from "./seed";
import { advance } from "./clock";

// PEAKSHIFT_STORE=file forces the local file store (e.g. to test without touching the shared database).
const DATABASE_URL = process.env.PEAKSHIFT_STORE === "file" ? "" : (process.env.DATABASE_URL ?? "");
export const storeMode = (): "postgres" | "file" => (DATABASE_URL ? "postgres" : "file");

const DATA_DIR = process.env.PEAKSHIFT_DATA_DIR ?? path.join(process.cwd(), ".data");
const FILE = path.join(DATA_DIR, "state.json");

type Sql = import("postgres").Sql;
const g = globalThis as unknown as {
  __peakshift?: AppState;
  __peakshiftLock?: Promise<unknown>;
  __psSql?: Sql;
  __psSchema?: Promise<void>;
  __psKv?: Map<string, unknown>;
  __psGate?: { free: number; waiters: (() => void)[] };
};

const POOL = Math.max(1, Number(process.env.PEAKSHIFT_DB_POOL ?? 5));

/**
 * Run DB work holding one of POOL permits. Each permit uses at most one connection at a time,
 * so the driver's own connection queue is never used — under bursts in the Next server that
 * queue was observed to strand queries. Callers inside a permit must not take another.
 */
async function gated<T>(fn: () => Promise<T>): Promise<T> {
  const gate = (g.__psGate ??= { free: POOL, waiters: [] });
  if (gate.free > 0) gate.free--;
  else await new Promise<void>((r) => gate.waiters.push(r));
  try {
    return await fn();
  } finally {
    const next = gate.waiters.shift();
    if (next) next(); // hand the permit straight over
    else gate.free++;
  }
}

// ------------------------------------------------------------------ Postgres backend
/** Parse a jsonb::text value; tolerates a legacy double-encoded (JSON string) document. */
const parseDoc = <T,>(text: string): T => {
  const v = JSON.parse(text);
  return (typeof v === "string" ? JSON.parse(v) : v) as T;
};

/**
 * Keep demo identities in step with the seed without reseeding (which would discard a completed
 * PayPal run): user names/emails come from the seed, and audit actor names follow their user.
 */
function syncSeedIdentities(s: AppState): AppState {
  const seedUsers = new Map(buildSeed().users.map((u) => [u.id, u]));
  const renamed: [string, string][] = [];
  for (const u of s.users) {
    const su = seedUsers.get(u.id);
    if (!su) continue;
    if (u.displayName !== su.displayName) renamed.push([u.displayName, su.displayName]);
    Object.assign(u, { displayName: su.displayName, email: su.email });
  }
  const names = new Map(s.users.map((u) => [u.id, u.displayName]));
  for (const a of s.audit) {
    const n = names.get(a.actorId);
    if (n) a.actorName = n;
    for (const [from, to] of renamed) if (a.summary.includes(from)) a.summary = a.summary.split(from).join(to);
  }
  return s;
}

async function sql(): Promise<Sql> {
  if (g.__psSql) return g.__psSql;
  const { default: postgres } = await import("postgres");
  g.__psSql = postgres(DATABASE_URL, {
    max: POOL, // small pool: serverless instances + Supabase pooler; access is gated to this size
    // Supabase transaction pooler (port 6543) does not support named prepared statements.
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 15,
    queue_timeout: 25, // never wait forever for a pooled connection
    ssl: DATABASE_URL.includes("localhost") ? false : "require",
  });
  return g.__psSql;
}

async function ensureSchema() {
  g.__psSchema ??= (async () => {
    const db = await sql();
    await db`create table if not exists peakshift_state (
      id int primary key,
      seed_version text not null,
      state jsonb not null,
      updated_at timestamptz not null default now()
    )`;
    await db`create table if not exists peakshift_kv (
      k text primary key,
      v jsonb not null,
      created_at timestamptz not null default now()
    )`;
  })().catch((e) => {
    g.__psSchema = undefined;
    throw e;
  });
  return g.__psSchema;
}

async function pgLoad(): Promise<AppState> {
  await ensureSchema();
  const db = await sql();
  const rows = await db`select seed_version, state::text as state from peakshift_state where id = 1`;
  if (rows.length && rows[0].seed_version === SEED_VERSION) return syncSeedIdentities(parseDoc<AppState>(rows[0].state as string));
  const fresh = buildSeed();
  await db`insert into peakshift_state (id, seed_version, state) values (1, ${SEED_VERSION}, ${JSON.stringify(fresh)}::text::jsonb)
           on conflict (id) do update set seed_version = excluded.seed_version, state = excluded.state, updated_at = now()`;
  return fresh;
}

// ------------------------------------------------------------------ File backend
function fileLoad(): AppState {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf8")) as AppState;
    if (parsed.seedVersion === SEED_VERSION) return syncSeedIdentities(parsed);
  } catch {
    /* first run */
  }
  const fresh = buildSeed();
  filePersist(fresh);
  return fresh;
}

function filePersist(state: AppState) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, FILE);
  } catch (e) {
    console.warn("[peakshift] state not persisted:", (e as Error).message);
  }
}

// ------------------------------------------------------------------ Public contract
/** Load the latest authoritative state for this request. */
export async function hydrate(): Promise<AppState> {
  if (storeMode() === "postgres") {
    g.__peakshift = await gated(pgLoad);
    return g.__peakshift;
  }
  g.__peakshift ??= fileLoad();
  return g.__peakshift;
}

/** Hydrate, then return the snapshot. Use at the start of every page / route. */
export async function readFresh(): Promise<AppState> {
  return hydrate();
}

/** Synchronous read of the request's hydrated snapshot. */
export function read(): AppState {
  if (g.__peakshift) return g.__peakshift;
  if (storeMode() === "file") return (g.__peakshift = fileLoad());
  throw new Error("[peakshift] store not hydrated — call `await readFresh()` before `read()`.");
}

/** Serialised mutation: callers get a consistent snapshot and their writes persist together. */
export async function mutate<T>(fn: (s: AppState) => T | Promise<T>): Promise<T> {
  // One writer per instance: queued writers wait here rather than each holding a pooled
  // connection while blocked on the row lock (which starves reads under bursts).
  const prev = g.__peakshiftLock ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  g.__peakshiftLock = prev.then(() => mine);
  await prev;
  try {
    return await (storeMode() === "postgres" ? gated(() => pgMutate(fn)) : fileMutate(fn));
  } finally {
    release();
  }
}

async function fileMutate<T>(fn: (s: AppState) => T | Promise<T>): Promise<T> {
  const s = (g.__peakshift ??= fileLoad());
  const result = await fn(s);
  filePersist(s);
  return result;
}

async function pgMutate<T>(fn: (s: AppState) => T | Promise<T>): Promise<T> {
  {
    await ensureSchema();
    const db = await sql();
    let next: AppState | undefined;
    const result = await db.begin(async (tx) => {
      await tx`set local lock_timeout = '15s'`; // a stuck writer can never block others indefinitely
      const rows = await tx`select seed_version, state::text as state from peakshift_state where id = 1 for update`;
      const s: AppState = rows.length && rows[0].seed_version === SEED_VERSION ? syncSeedIdentities(parseDoc<AppState>(rows[0].state as string)) : buildSeed();
      const r = await fn(s);
      await tx`insert into peakshift_state (id, seed_version, state, updated_at) values (1, ${SEED_VERSION}, ${JSON.stringify(s)}::text::jsonb, now())
               on conflict (id) do update set seed_version = excluded.seed_version, state = excluded.state, updated_at = now()`;
      next = s;
      return r;
    });
    if (next) g.__peakshift = next;
    return result as T;
  }
}

export async function resetState(): Promise<AppState> {
  const fresh = buildSeed();
  if (storeMode() === "postgres") {
    await mutate((s) => {
      for (const k of Object.keys(s) as (keyof AppState)[]) delete (s as Partial<AppState>)[k];
      Object.assign(s, fresh);
    });
    await gated(async () => {
      const db = await sql();
      await db`delete from peakshift_kv`;
    });
    return g.__peakshift!;
  }
  g.__peakshift = fresh;
  filePersist(fresh);
  return fresh;
}

// ------------------------------------------------------------------ Small KV (shared across instances in Postgres mode)
export async function kvGetMany<T>(keys: string[]): Promise<Map<string, T>> {
  const out = new Map<string, T>();
  if (!keys.length) return out;
  if (storeMode() === "postgres") {
    return gated(async () => {
      await ensureSchema();
      const db = await sql();
      const rows = await db`select k, v::text as v from peakshift_kv where k in ${db(keys)}`;
      for (const r of rows) out.set(r.k as string, parseDoc<T>(r.v as string));
      return out;
    });
  }
  const m = (g.__psKv ??= new Map());
  for (const k of keys) if (m.has(k)) out.set(k, m.get(k) as T);
  return out;
}

export async function kvSetMany(entries: [string, unknown][]) {
  if (!entries.length) return;
  if (storeMode() === "postgres") {
    await gated(async () => {
      await ensureSchema();
      const db = await sql();
      for (const [k, v] of entries) {
        await db`insert into peakshift_kv (k, v) values (${k}, ${JSON.stringify(v)}::text::jsonb) on conflict (k) do update set v = excluded.v, created_at = now()`;
      }
      await db`delete from peakshift_kv where created_at < now() - interval '1 day'`;
    });
    return;
  }
  const m = (g.__psKv ??= new Map());
  for (const [k, v] of entries) m.set(k, v);
  while (m.size > 2000) m.delete(m.keys().next().value as string);
}

export async function storeHealth(): Promise<{ ok: boolean; mode: "postgres" | "file"; detail: string }> {
  if (storeMode() === "file") return { ok: true, mode: "file", detail: "File-backed JSON (local development)" };
  try {
    const rows = await gated(async () => {
      await ensureSchema();
      const db = await sql();
      return db`select updated_at from peakshift_state where id = 1`;
    });
    return { ok: true, mode: "postgres", detail: rows.length ? `Postgres · last write ${new Date(rows[0].updated_at as string).toISOString()}` : "Postgres · empty" };
  } catch (e) {
    return { ok: false, mode: "postgres", detail: (e as Error).message.slice(0, 160) };
  }
}

// ------------------------------------------------------------------ helpers
export const uid = (prefix: string) => `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
export const correlation = () => `cor_${crypto.randomBytes(5).toString("hex")}`;
export const nowIso = () => new Date().toISOString();

export function audit(
  s: AppState,
  e: Omit<AuditEvent, "id" | "at" | "correlationId" | "role"> & { role: Role | "system" | "paypal"; correlationId?: string },
) {
  const ev: AuditEvent = { id: uid("aud"), at: advance(s, 1000), correlationId: e.correlationId ?? correlation(), ...e };
  s.audit.unshift(ev);
  if (s.audit.length > 500) s.audit.length = 500;
  return ev;
}

export function hashOf(v: unknown) {
  return crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);
}
