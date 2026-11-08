// PeakShift REST API v1 — implements the PRD §15 route inventory. Every route authenticates and
// enforces role/ownership server-side. Consistent success/error envelopes with request IDs.
import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";
import { HttpError, OPERATOR_ROLES, requireUser, sign, SESSION_COOKIE } from "@/lib/auth";
import { read, audit, mutate, hydrate, storeHealth } from "@/lib/store";
import * as svc from "@/lib/services";
import { askAnalyst } from "@/lib/ai/analyst";
import { buildDatasets } from "@/lib/analytics";
import { healthCheck, paypalMode, paypalPublicClientId, webhookConfigured } from "@/lib/paypal";
import { claudeEnabled, CLAUDE_MODEL } from "@/lib/ai/claude";
import { runStudioTurn } from "@/lib/ai/studio-proxy";
import { buildStudioData } from "@/lib/analytics-contract";
import { getOrCreateEventReport, getReport, listReports, resetReport, saveReport } from "@/lib/reports";
import { eventContext, explainExclusion, freshness, rateLimit, settlementSummary, verificationBreakdown } from "@/lib/agent-tools";
import type { Role } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // AI agent turns and PayPal calls

type Ctx = { params: Record<string, string>; req: NextRequest; body: () => Promise<Record<string, unknown>> };
type Handler = (c: Ctx) => Promise<unknown>;
const routes: { method: string; pattern: string; handler: Handler }[] = [];
const on = (method: string, pattern: string, handler: Handler) => routes.push({ method, pattern, handler });

function match(pattern: string, path: string[]) {
  const p = pattern.split("/").filter(Boolean);
  if (p.length !== path.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(":")) params[p[i].slice(1)] = decodeURIComponent(path[i]);
    else if (p[i] !== path[i]) return null;
  }
  return params;
}

// ---------------- session / demo access
on("POST", "session", async ({ body }) => {
  const { userId } = (await body()) as { userId: string };
  const u = read().users.find((x) => x.id === userId);
  if (!u) throw new HttpError(404, "NOT_FOUND", "Unknown demo account.");
  await mutate((s) => audit(s, { actorId: u.id, actorName: u.displayName, role: u.role, entityType: "session", entityId: u.id, action: "demo_login_completed", summary: `Demo sign-in as ${u.displayName} (${u.role}) via role switch — demo-only convenience.` }));
  return { __cookie: sign(u.id), user: u };
});
on("DELETE", "session", async () => ({ __clearCookie: true }));
on("GET", "me", async () => ({ user: await requireUser() }));

// ---------------- operator
on("GET", "operator/overview", async () => {
  await requireUser(OPERATOR_ROLES);
  const s = read();
  return { events: s.events, plans: s.plans.length, batches: s.batches.length };
});
on("GET", "events", async () => (await requireUser(OPERATOR_ROLES), read().events));
on("POST", "events", async ({ body }) => svc.createEvent(await requireUser(OPERATOR_ROLES), await body()));
on("POST", "events/parse-brief", async ({ body }) => svc.parseEventBrief(await requireUser(OPERATOR_ROLES), String((await body()).text ?? "")));
on("GET", "events/:id", async ({ params }) => (await requireUser(OPERATOR_ROLES), svc.getEvent(read(), params.id)));
on("POST", "events/:id/fund/order", async ({ params }) => svc.fundCreateOrder(await requireUser(OPERATOR_ROLES), params.id));
on("POST", "events/:id/fund/capture", async ({ params, body }) => svc.fundCapture(await requireUser(OPERATOR_ROLES), params.id, String((await body()).orderId ?? "")));
on("POST", "events/:id/fund/cancel", async ({ params }) => svc.fundCancel(await requireUser(OPERATOR_ROLES), params.id));
on("POST", "events/:id/optimise", async ({ params }) => svc.runOptimise(await requireUser(OPERATOR_ROLES), params.id));
on("GET", "events/:id/plans/:planId", async ({ params }) => {
  await requireUser(OPERATOR_ROLES);
  const p = read().plans.find((x) => x.id === params.planId && x.eventId === params.id);
  if (!p) throw new HttpError(404, "NOT_FOUND", "Plan not found.");
  return p;
});
on("POST", "events/:id/offers/publish", async ({ params, body }) => svc.publishOffers(await requireUser(OPERATOR_ROLES), params.id, String((await body()).planId ?? "")));
on("POST", "events/:id/demo/execute", async ({ params }) => svc.executeDemo(await requireUser(OPERATOR_ROLES), params.id));
on("POST", "events/:id/verify", async ({ params }) => svc.verifyEvent(await requireUser(OPERATOR_ROLES), params.id));
on("GET", "events/:id/verification", async ({ params }) => {
  await requireUser(OPERATOR_ROLES);
  const s = read();
  const ev = svc.getEvent(s, params.id);
  return { run: s.verifications.find((v) => v.id === ev.verificationRunId) ?? null, datasets: s.datasets.filter((d) => d.eventId === ev.id) };
});
on("POST", "events/:id/settlements", async ({ params }) => svc.createSettlement(await requireUser(OPERATOR_ROLES), params.id));
on("POST", "settlements/:id/approve", async ({ params, body }) => svc.approveSettlement(await requireUser(OPERATOR_ROLES), params.id, String((await body()).reviewHash ?? "")));
on("POST", "settlements/:id/payouts", async ({ params }) => svc.submitPayouts(await requireUser(OPERATOR_ROLES), params.id));
on("GET", "payouts/:id", async ({ params }) => {
  const u = await requireUser();
  const b = read().batches.find((x) => x.id === params.id);
  if (!b) throw new HttpError(404, "NOT_FOUND", "Payout batch not found.");
  if (u.role === "business") return { ...b, items: b.items.filter((i) => i.orgId === u.orgId), responseRedacted: null };
  return b;
});
on("POST", "payouts/:id/refresh", async ({ params }) => svc.refreshPayout(await requireUser(OPERATOR_ROLES), params.id));
on("GET", "businesses", async () => (await requireUser(OPERATOR_ROLES), read().orgs.filter((o) => o.type === "participant").map(({ payoutEmail: _e, ...o }) => o)));

// ---------------- analytics / agent
on("GET", "events/:id/analytics", async ({ params }) => {
  await requireUser(OPERATOR_ROLES);
  const s = read();
  return buildDatasets(s, svc.getEvent(s, params.id));
});
on("POST", "events/:id/analyst", async ({ params, body }) => {
  const u = await requireUser(OPERATOR_ROLES);
  const s = read();
  const ev = svc.getEvent(s, params.id);
  const q = String((await body()).question ?? "");
  if (!q.trim()) throw new HttpError(422, "VALIDATION_ERROR", "Ask a question.");
  const r = await askAnalyst(s, ev, q);
  await mutate((st) => {
    st.aiRuns.unshift({ id: crypto.randomUUID(), feature: "analyst", mode: r.engine.mode, model: r.engine.model, promptVersion: "analyst-v2", status: "ok", latencyMs: r.engine.latencyMs, at: new Date().toISOString() });
    audit(st, { actorId: u.id, actorName: u.displayName, role: u.role, entityType: "ai", entityId: ev.id, action: "ag_studio_agent_request_completed", summary: `Analyst answered (${r.engine.mode}; tools: ${r.toolCalls.map((t) => t.name).join(", ") || "none"})${r.boundary ? " — boundary enforced" : ""}${r.widget ? `; proposed widget “${r.widget.title}”` : ""}.` });
  });
  return r;
});

// ---------------- v1.1 Energy Intelligence (AG Studio)
on("GET", "analytics/events/:id/studio-data", async ({ params }) => {
  await requireUser(OPERATOR_ROLES);
  const s = read();
  return buildStudioData(s, svc.getEvent(s, params.id));
});
on("GET", "analytics/reports", async ({ req }) => listReports(await requireUser(OPERATOR_ROLES), req.nextUrl.searchParams.get("eventId") ?? ""));
on("POST", "analytics/reports", async ({ body }) => getOrCreateEventReport(await requireUser(OPERATOR_ROLES), String((await body()).eventId ?? "")));
on("GET", "analytics/reports/:id", async ({ params }) => getReport(await requireUser(OPERATOR_ROLES), params.id));
on("PUT", "analytics/reports/:id", async ({ params, body }) => {
  const b = await body();
  return saveReport(await requireUser(OPERATOR_ROLES), params.id, { reportState: b.reportState, expectedRevision: Number(b.expectedRevision), name: typeof b.name === "string" ? b.name : undefined });
});
on("POST", "analytics/reports/:id/reset", async ({ params }) => resetReport(await requireUser(OPERATOR_ROLES), params.id));

const tool = (name: string, fn: (u: Awaited<ReturnType<typeof requireUser>>, body: unknown) => unknown) =>
  on("POST", `analytics/agent-tools/${name}`, async ({ body, req }) => {
    const u = await requireUser(OPERATOR_ROLES);
    rateLimit(`tool:${u.id}`, 120, 60_000);
    const t0 = Date.now();
    const r = fn(u, await body());
    await mutate((st) => audit(st, { actorId: u.id, actorName: u.displayName, role: u.role, entityType: "agent_tool", entityId: name, action: "agent.tool_call", summary: `Analyst tool ${name} (read-only) in ${Date.now() - t0} ms.`, correlationId: req.headers.get("x-peakshift-run") ?? undefined }));
    return r;
  });
tool("event-context", eventContext);
tool("explain-exclusion", explainExclusion);
tool("verification-breakdown", verificationBreakdown);
tool("settlement-summary", settlementSummary);
tool("freshness", freshness);

on("POST", "ai/studio", async ({ body, req }) => {
  const u = await requireUser(OPERATOR_ROLES);
  if (!claudeEnabled()) throw new HttpError(503, "AI_UNAVAILABLE", "AI is not configured on this deployment.");
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) throw new HttpError(403, "BAD_ORIGIN", "Cross-origin AI requests are not allowed.");
  rateLimit(`ai:user:${u.id}`, 30, 60_000);
  rateLimit(`ai:ip:${req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local"}`, 60, 60_000);
  const s = read();
  const eventId = req.headers.get("x-peakshift-event") ?? "";
  const ev = s.events.find((e) => e.id === eventId) ?? s.events.find((e) => e.verificationRunId) ?? s.events[0];
  const ctx = `Selected event: id ${ev.id}, “${ev.name}” on ${ev.eventDate} (${ev.timezone}); peak ${ev.peak.start}–${ev.peak.end}; alternate ${ev.shift.start}–${ev.shift.end}; target ${ev.targetKw} kW avg = ${ev.targetWh} Wh; budget ${ev.budgetMinor} minor USD; status ${ev.status}. Pass eventId "${ev.id}" to every peakshift_* tool. Data mode: SIMULATED.`;
  const t0 = Date.now();
  try {
    const r = await runStudioTurn((await body()) as never, ctx, req.signal);
    await mutate((st) => {
      st.aiRuns.unshift({ id: crypto.randomUUID(), feature: "analyst", mode: "claude", model: r.model, promptVersion: "studio-analyst-v2", status: "ok", latencyMs: Date.now() - t0, at: new Date().toISOString() });
      audit(st, { actorId: u.id, actorName: u.displayName, role: u.role, entityType: "ai", entityId: ev.id, action: "ag_studio_agent_request_completed", summary: `AG Studio agent turn · ${r.model} · ${Date.now() - t0} ms · tools offered ${r.toolsOffered.length}${r.toolsStripped.length ? `, stripped ${r.toolsStripped.join(", ")}` : ""} · calls: ${r.output.filter((o) => (o as { type: string }).type === "function_call").map((o) => (o as { name: string }).name).join(", ") || "none"}${r.usage ? ` · ${r.usage.totalTokens} tokens` : ""}.` });
    });
    return r;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    await mutate((st) => st.aiRuns.unshift({ id: crypto.randomUUID(), feature: "analyst", mode: "claude", model: "?", promptVersion: "studio-analyst-v2", status: "error", latencyMs: Date.now() - t0, at: new Date().toISOString() }));
    throw new HttpError(502, "AI_UPSTREAM_ERROR", "The analyst could not complete this turn. Try again.");
  }
});

// ---------------- business
on("GET", "businesses/me", async () => {
  const u = await requireUser(["business"]);
  const s = read();
  return { org: s.orgs.find((o) => o.id === u.orgId), profile: svc.latestProfile(s, u.orgId) };
});
on("POST", "businesses/:id/profile/extract", async ({ params, body }) => svc.runProfileExtraction(await requireUser(["business", "admin"]), params.id, String((await body()).text ?? "")));
on("POST", "businesses/:id/profile/confirm", async ({ params, body }) => svc.confirmProfile(await requireUser(["business", "admin"]), params.id, await body()));
on("GET", "business/offers", async () => {
  const u = await requireUser(["business"]);
  return read().offers.filter((o) => o.orgId === u.orgId);
});
on("POST", "offers/:id/accept", async ({ params }) => svc.respondOffer(await requireUser(["business", "admin"]), params.id, "accept"));
on("POST", "offers/:id/decline", async ({ params, body }) => svc.respondOffer(await requireUser(["business", "admin"]), params.id, "decline", ((await body()).reason as string) || undefined));

// ---------------- platform
on("GET", "health", async () => {
  await requireUser(OPERATOR_ROLES);
  const pp = await healthCheck();
  return { paypal: { ...pp, webhookConfigured: webhookConfigured() }, ai: { mode: claudeEnabled() ? "claude" : "offline", model: claudeEnabled() ? CLAUDE_MODEL : "peakshift-rules-v1" }, database: await storeHealth() };
});
// Daily Vercel Cron: a real database round trip so the free-tier Postgres never pauses for inactivity
// during judging. Read-only. If CRON_SECRET is set, Vercel sends it as a bearer token and we require it.
on("GET", "cron/keepalive", async ({ req }) => {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) throw new HttpError(401, "UNAUTHENTICATED", "Cron secret required.");
  const db = await storeHealth();
  if (!db.ok) throw new HttpError(503, "STORE_UNAVAILABLE", "Database did not respond.");
  return { ok: true, mode: db.mode, at: new Date().toISOString() };
});
on("GET", "config/public", async () => ({ paypalMode: paypalMode(), paypalClientId: paypalPublicClientId() }));
on("POST", "demo/fresh-run", async () => svc.startFreshRun(await requireUser(OPERATOR_ROLES)));
on("POST", "admin/demo-reset", async () => svc.resetDemo(await requireUser(["admin"])));
on("POST", "webhooks/paypal", async ({ req }) => svc.handlePayPalWebhook(req.headers, await req.text()));

// ---------------- dispatcher
async function dispatch(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const requestId = crypto.randomUUID();
  const { path } = await ctx.params;
  try {
    await hydrate();
  } catch (e) {
    console.error("[api] store unavailable", e);
    return NextResponse.json({ error: { code: "STORE_UNAVAILABLE", message: "The data store is unavailable. Try again shortly.", request_id: requestId } }, { status: 503 });
  }
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const params = match(r.pattern, path);
    if (!params) continue;
    try {
      let cached: Record<string, unknown> | null = null;
      const data = (await r.handler({ params, req, body: async () => (cached ??= ((await req.json().catch(() => ({}))) as Record<string, unknown>)) })) as Record<string, unknown>;
      const res = NextResponse.json({ data, meta: { request_id: requestId, generated_at: new Date().toISOString() } });
      if (data && typeof data === "object" && "__cookie" in data) {
        res.cookies.set(SESSION_COOKIE, String(data.__cookie), { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 7 });
        delete data.__cookie;
      }
      if (data && typeof data === "object" && "__clearCookie" in data) res.cookies.delete(SESSION_COOKIE);
      return res;
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({ error: { code: e.code, message: e.message, fields: e.fields, request_id: requestId } }, { status: e.status });
      console.error("[api]", req.method, path.join("/"), e);
      return NextResponse.json({ error: { code: "INTERNAL", message: "Something went wrong on our side. Your last confirmed state is unchanged.", request_id: requestId } }, { status: 500 });
    }
  }
  return NextResponse.json({ error: { code: "NOT_FOUND", message: "Route not found.", request_id: requestId } }, { status: 404 });
}

export const GET = dispatch;
export const POST = dispatch;
export const PATCH = dispatch;
export const PUT = dispatch;
export const DELETE = dispatch;
export type { Role };
