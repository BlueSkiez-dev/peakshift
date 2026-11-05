// Read-only PeakShift domain tools for PeakShift Analyst (v1.1 Addendum §11, §12.3).
// Every call resolves organisation + event scope from the session; the model never supplies tenancy.
// No tool here mutates anything. There is deliberately no SQL, fetch or payment tool.
import { z } from "zod";
import type { User } from "./types";
import { read } from "./store";
import { HttpError } from "./auth";
import { buildStudioData } from "./analytics-contract";
import { BATCH_STATUS, ITEM_STATUS } from "./status";

const EventScope = z.object({ eventId: z.string().min(1).max(64) });

function scopedEvent(u: User, eventId: string) {
  const s = read();
  const ev = s.events.find((e) => e.id === eventId);
  // Single-operator demo tenancy: every event belongs to the operator org.
  if (!ev || !["operator", "admin"].includes(u.role) || u.orgId !== "org_lagoon") throw new HttpError(404, "NOT_FOUND", "Event not found in your organisation.");
  return { s, ev };
}

function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body);
  if (!r.success) throw new HttpError(422, "VALIDATION_ERROR", r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return r.data;
}

export function eventContext(u: User, body: unknown) {
  const { eventId } = parse(EventScope, body);
  const { s, ev } = scopedEvent(u, eventId);
  const accepted = s.offers.filter((o) => o.eventId === ev.id && o.status === "ACCEPTED");
  const snap = buildStudioData(s, ev);
  return {
    eventId: ev.id,
    eventName: ev.name,
    eventDate: ev.eventDate,
    timezone: ev.timezone,
    status: ev.status,
    peakWindowLocal: `${ev.peak.start}–${ev.peak.end}`,
    alternateWindowLocal: `${ev.shift.start}–${ev.shift.end}`,
    targetReductionKw: ev.targetKw,
    targetEnergyWh: ev.targetWh,
    budgetMinor: ev.budgetMinor,
    currencyCode: ev.currency,
    fundingStatus: ev.funding.status,
    acceptedCommitmentWh: accepted.reduce((a, o) => a + o.allocatedWh, 0),
    acceptedOffers: accepted.length,
    dataMode: "SIMULATED",
    snapshotId: snap.snapshotId,
    dataAsOfUtc: snap.dataAsOfUtc,
  };
}

export function explainExclusion(u: User, body: unknown) {
  const { eventId, business } = parse(EventScope.extend({ business: z.string().min(1).max(80).describe("Business ID or display name") }), body);
  const { s, ev } = scopedEvent(u, eventId);
  const org = s.orgs.find((o) => o.type === "participant" && (o.id === business || o.name.toLowerCase() === business.toLowerCase() || o.name.toLowerCase().includes(business.toLowerCase())));
  if (!org) return { found: false, message: `No participant matches “${business}” in this event.` };
  const plans = s.plans.filter((p) => p.eventId === ev.id).sort((a, b) => b.version - a.version);
  if (!plans.length) return { found: true, businessId: org.id, displayName: org.name, message: "No optimisation plan has been generated for this event yet." };
  const plan = plans.find((p) => p.candidates.some((c) => c.orgId === org.id))!;
  const c = plan.candidates.find((x) => x.orgId === org.id)!;
  const prof = s.profiles.find((p) => p.orgId === org.id && p.version === c.profileVersion);
  return {
    found: true,
    businessId: org.id,
    displayName: org.name,
    planId: plan.id,
    planVersion: plan.version,
    optimiserVersion: plan.optimiserVersion,
    selected: c.selected,
    eligible: c.eligible,
    hardSafetyBlock: c.hard,
    reasonCode: c.reasonCode,
    reasonText: c.reason,
    ruleId: { HARD_SAFETY_CRITICAL_LOAD: "GATE_2_NON_CRITICAL_ONLY", WINDOW_MISMATCH: "GATE_3_WINDOW_OVERLAP_60MIN", PROFILE_UNCONFIRMED: "GATE_1_PROFILE_CONFIRMED", CAPACITY_UNCONFIRMED: "GATE_4_CAPACITY_CONFIRMED", RATE_MISSING: "GATE_5_RATE_PRESENT", INSUFFICIENT_DATA: "GATE_6_DATA_QUALITY", SUSPENDED: "GATE_7_ACTIVE", NOT_NEEDED_TARGET_MET: "ALLOC_LOWEST_COST_ORDER", SELECTED_LOWEST_RATE: "ALLOC_LOWEST_COST_ORDER", SELECTED_TO_COMPLETE_TARGET: "ALLOC_LOWEST_COST_ORDER" }[c.reasonCode],
    supportingProfileFields: {
      profileVersion: c.profileVersion,
      activities: (prof?.activities ?? []).map((a) => ({ name: a.name, isCritical: a.isCritical, maxShiftWh: a.maxShiftWh, window: a.window, rateMinorPerKwh: a.rateMinorPerKwh })),
    },
    overridable: false,
    sourceRecord: `dispatch_plans/${plan.id}/candidates/${org.id}`,
  };
}

export function verificationBreakdown(u: User, body: unknown) {
  const { eventId, business } = parse(EventScope.extend({ business: z.string().max(80).optional() }), body);
  const { s, ev } = scopedEvent(u, eventId);
  const run = s.verifications.find((v) => v.id === ev.verificationRunId);
  if (!run) return { available: false, message: "This event has not been verified yet. No verified figures exist." };
  const parts = run.participants.filter((p) => !business || p.orgId === business || p.businessName.toLowerCase().includes(business.toLowerCase()));
  return {
    available: true,
    verificationRunId: run.id,
    datasetVersion: `v${run.version}`,
    formulaVersion: run.formulaVersion,
    baselineMethod: run.baselineMethod,
    formula: "verifiedShiftWh = min(peakReductionWh, alternateWindowIncreaseWh), capped at committedWh (reboundWh = alternate-window increase)",
    dataMode: "SIMULATED",
    totals: run.totals,
    participants: parts.map((p) => ({
      businessId: p.orgId,
      displayName: p.businessName,
      committedWh: p.committedWh,
      baselinePeakWh: p.baselinePeakWh,
      actualPeakWh: p.actualPeakWh,
      peakReductionWh: p.peakReductionWh,
      baselineAlternateWh: p.baselineShiftWh,
      actualAlternateWh: p.actualShiftWh,
      reboundWh: p.reboundWh,
      verifiedShiftWh: p.verifiedWh,
      limitedBy: p.limitedBy,
      coveragePct: p.coveragePct,
      rewardMinor: p.rewardMinor,
      rewardPerVerifiedKwhMinor: p.verifiedWh ? Math.round((p.rewardMinor * 1000) / p.verifiedWh) : null,
      currencyCode: "USD",
    })),
  };
}

export function settlementSummary(u: User, body: unknown) {
  const { eventId, status } = parse(EventScope.extend({ status: z.string().max(40).optional() }), body);
  const { s, ev } = scopedEvent(u, eventId);
  const st = s.settlements.find((x) => x.id === ev.settlementId);
  const b = s.batches.find((x) => x.eventId === ev.id);
  if (!st) return { available: false, message: "No settlement exists for this event yet." };
  const items = (b?.items ?? []).filter((i) => !status || i.status === status);
  const byStatus: Record<string, { count: number; amountMinor: number; label: string }> = {};
  for (const i of items) {
    byStatus[i.status] ??= { count: 0, amountMinor: 0, label: ITEM_STATUS[i.status].label };
    byStatus[i.status].count++;
    byStatus[i.status].amountMinor += i.amountMinor;
  }
  return {
    available: true,
    settlementId: st.id,
    settlementStatus: st.status,
    approvedAt: st.approvedAt,
    approvedTotalMinor: st.totalMinor,
    currencyCode: "USD",
    batch: b ? { provider: b.provider === "paypal" ? "PAYPAL_SANDBOX" : "PAYPAL_SIMULATOR", paypalBatchId: b.paypalBatchId, batchStatus: b.status, batchStatusLabel: BATCH_STATUS[b.status].label, submittedAt: b.submittedAt, lastWebhookAt: b.lastWebhookAt, lastReconciledAt: b.lastCheckedAt } : null,
    itemsByStatus: byStatus,
    paidMinor: items.filter((i) => i.status === "SUCCEEDED").reduce((a, i) => a + i.amountMinor, 0),
    note: "Batch acceptance by PayPal is not completed payment. Only item status SUCCEEDED means a recipient was paid.",
  };
}

export function freshness(u: User, body: unknown) {
  const { eventId } = parse(EventScope, body);
  const { s, ev } = scopedEvent(u, eventId);
  const snap = buildStudioData(s, ev);
  return {
    eventId: ev.id,
    snapshotId: snap.snapshotId,
    dataAsOfUtc: snap.dataAsOfUtc,
    dataMode: snap.dataMode,
    schemaVersion: snap.schemaVersion,
    verificationVersion: snap.verificationVersion,
    sourceRowCounts: Object.fromEntries(snap.sources.map((x) => [x.id, x.data.length])),
  };
}

// ---------------- simple in-memory rate limiter (per user + per IP) for AI routes
const buckets = new Map<string, { n: number; reset: number }>();
export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { n: 1, reset: now + windowMs });
    return;
  }
  b.n++;
  if (b.n > limit) throw new HttpError(429, "RATE_LIMITED", `Too many AI requests. Try again in ${Math.ceil((b.reset - now) / 1000)} s.`);
}
