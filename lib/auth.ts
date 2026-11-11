// Demo authentication: a signed, httpOnly session cookie that names a seeded demo user.
// Every privileged API route re-checks role and ownership server-side (PRD §4.2).
import crypto from "node:crypto";
import { cookies, headers } from "next/headers";
import { AS_HEADER } from "./as";
import type { Role, User } from "./types";
import { readFresh } from "./store";

export const SESSION_COOKIE = "ps_session";
const SECRET = process.env.SESSION_SECRET ?? "peakshift-demo-only-session-secret";

export function sign(userId: string) {
  const mac = crypto.createHmac("sha256", SECRET).update(userId).digest("base64url").slice(0, 32);
  return `${userId}.${mac}`;
}

export function verify(token: string | undefined): string | null {
  if (!token) return null;
  const i = token.lastIndexOf(".");
  if (i < 0) return null;
  const userId = token.slice(0, i);
  const expected = sign(userId);
  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return userId;
}

export async function currentUser(): Promise<User | null> {
  // Tab-scoped business view (lib/as.ts). Only ever resolves to a business user; anything else is signed out.
  const asId = await headers().then((h) => h.get(AS_HEADER), () => null);
  if (asId) {
    const u = (await readFresh()).users.find((x) => x.id === asId);
    return u && u.role === "business" ? u : null;
  }
  const jar = await cookies();
  const id = verify(jar.get(SESSION_COOKIE)?.value);
  if (!id) return null;
  return (await readFresh()).users.find((u) => u.id === id) ?? null;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export async function requireUser(roles?: Role[]): Promise<User> {
  const u = await currentUser();
  if (!u) throw new HttpError(401, "UNAUTHENTICATED", "Sign in to continue.");
  if (roles && !roles.includes(u.role)) throw new HttpError(403, "FORBIDDEN", "Your role cannot perform this action.");
  return u;
}

export const OPERATOR_ROLES: Role[] = ["operator", "admin"];

/** For server pages: a missing/expired session redirects to /demo instead of crashing the render. */
export async function pageUser(): Promise<User> {
  const u = await currentUser();
  if (!u) {
    const { redirect } = await import("next/navigation");
    redirect("/demo");
  }
  return u as User;
}
