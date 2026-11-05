// Application services: every consequential state transition lives here, server-side, audited.
import { z } from "zod";
import type {
  AppState,
  BatchStatus,
  BusinessProfile,
  DemandEvent,
  DispatchPlan,
  FlexActivity,
  ItemStatus,
  Offer,
  PayoutBatch,
  Settlement,
  SettlementItem,
  User,
  VerificationRun,
} from "./types";
import { audit, correlation, hashOf, mutate, nowIso, read, resetState, uid } from "./store";
import { HttpError } from "./auth";
import { optimise, OPTIMISER_VERSION } from "./optimiser";
import { generateDatasets } from "./meter";
import { BASELINE_METHOD, FORMULA_VERSION, verifyParticipant } from "./verification";
import * as paypal from "./paypal";
import { extractProfile } from "./ai/profile";
import { parseBrief } from "./ai/brief";
import { maskEmail } from "./format";
import { recipientFor } from "./recipients";
import { ITEM_EXCEPTION } from "./status";
import { advance, scenarioNowMs, stampPhase } from "./clock";

const actor = (u: User) => ({ actorId: u.id, actorName: u.displayName, role: u.role });

export function getEvent(s: AppState, id: string) {
  const e = s.events.find((x) => x.id === id);
  if (!e) throw new HttpError(404, "NOT_FOUND", "Event not found.");
  return e;
}

export function latestProfile(s: AppState, orgId: string, status?: BusinessProfile["status"]) {
  return s.profiles
    .filter((p) => p.orgId === orgId && (!status || p.status === status))
    .sort((a, b) => b.version - a.version)[0];
}

function assertStatus(e: DemandEvent, allowed: DemandEvent["status"][], action: string) {
  if (!allowed.includes(e.status)) throw new HttpError(409, "INVALID_STATE", `Cannot ${action} while the event is “${e.status}”.`);
}

function expireOffers(s: AppState) {
  const now = scenarioNowMs(s);
  for (const o of s.offers) if (o.status === "ACTION_REQUIRED" && new Date(o.expiresAt).getTime() < now) o.status = "EXPIRED";
}

// ---------------------------------------------------------------- Events

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");
export const EventInput = z
  .object({
    name: z.string().trim().min(1, "Required").max(80, "Max 80 characters"),
    eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
    peak: z.object({ start: hhmm, end: hhmm }),
    shift: z.object({ start: hhmm, end: hhmm }),
    targetKw: z.number().positive("Must be greater than 0"),
    targetWh: z.number().int().positive("Must be greater than 0"),
    budgetMinor: z.number().int().positive("Must be greater than 0"),
    currency: z.literal("USD"),
    minDataQuality: z.number().int().min(50).max(100).default(90),
    notes: z.string().max(500).default(""),
    aiProposedFields: z.array(z.string()).default([]),
  })
  .superRefine((v, ctx) => {
    if (v.peak.end <= v.peak.start) ctx.addIssue({ code: "custom", path: ["peak"], message: "Peak end must be after start." });
    if (v.shift.end <= v.shift.start) ctx.addIssue({ code: "custom", path: ["shift"], message: "Shift end must be after start." });
    if (v.shift.start < v.peak.end && v.peak.start < v.shift.end)
      ctx.addIssue({ code: "custom", path: ["shift"], message: "The alternate window must not overlap the peak window." });
  });

export async function createEvent(u: User, input: unknown) {
  const parsed = EventInput.safeParse(input);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const i of parsed.error.issues) fields[i.path.join(".")] = i.message;
    throw new HttpError(422, "VALIDATION_ERROR", "Some event fields need attention.", fields);
  }
  const v = parsed.data;
  return mutate((s) => {
    const t = advance(s, 60_000);
    const e: DemandEvent = {
      id: uid("evt"),
      ...v,
      timezone: "Africa/Lagos",
      status: "AWAITING_FUNDING",
      funding: { provider: paypal.paypalMode() === "sandbox" ? "paypal" : "paypal-simulator", orderId: null, captureId: null, amountMinor: v.budgetMinor, currency: "USD", status: "NOT_FUNDED", capturedAt: null, history: [{ status: "NOT_FUNDED", at: t }] },
      activePlanId: null,
      verificationRunId: null,
      settlementId: null,
      executedAt: null,
      createdAt: t,
      createdBy: u.id,
    };
    s.events.unshift(e);
    audit(s, { ...actor(u), entityType: "event", entityId: e.id, action: "event.created", summary: `Created “${e.name}” — ${(e.targetWh / 1000).toFixed(1)} kWh target, $${(e.budgetMinor / 100).toFixed(2)} budget.`, after: { ...v, aiProposedFields: v.aiProposedFields } });
    return e;
  });
}

export async function parseEventBrief(u: User, text: string) {
  if (!text.trim()) throw new HttpError(422, "VALIDATION_ERROR", "Describe the event first.");
  try {
    const r = await parseBrief(text, new Date(scenarioNowMs(read()) + 3_600_000).toISOString().slice(0, 10)); // Lagos date
    await mutate((s) => {
      s.aiRuns.unshift({ id: uid("ai"), feature: "event_brief", mode: r.engine.mode, model: r.engine.model, promptVersion: "event-brief-v2", status: "ok", latencyMs: r.engine.latencyMs, at: nowIso() });
      audit(s, { ...actor(u), entityType: "ai", entityId: "event_brief", action: "ai.extraction_generated", summary: `Event brief parsed (${r.engine.mode}, ${r.engine.latencyMs} ms). ${r.proposedFields.length} fields proposed, ${r.questions.length} questions.` });
    });
    return r;
  } catch (e) {
    throw new HttpError(502, "AI_UNAVAILABLE", "AI extraction is temporarily unavailable. You can complete the event manually.", { detail: (e as Error).message });
  }
}

// ---------------------------------------------------------------- Funding (PayPal Checkout)

export async function fundCreateOrder(u: User, eventId: string) {
  const e = getEvent(read(), eventId);
  assertStatus(e, ["AWAITING_FUNDING", "DRAFT"], "fund");
  // Reuse an open order rather than creating duplicates on repeated clicks.
  if (e.funding.status === "ORDER_CREATED" && e.funding.orderId) return { orderId: e.funding.orderId, mode: paypal.paypalMode(), reused: true };
  const order = await paypal.createOrder({ eventId: e.id, amountMinor: e.budgetMinor, currency: e.currency, description: `PeakShift event budget — ${e.name}`, requestId: `order-${e.id}-${e.funding.history.length}` });
  await mutate((s) => {
    const ev = getEvent(s, eventId);
    ev.funding = { ...ev.funding, provider: paypal.paypalMode() === "sandbox" ? "paypal" : "paypal-simulator", orderId: order.id, status: "ORDER_CREATED", history: [...ev.funding.history, { status: "ORDER_CREATED", at: stampPhase(s, ev, "funding"), note: order.id }] };
    audit(s, { ...actor(u), entityType: "event", entityId: eventId, action: "funding.order_created", summary: `PayPal ${paypal.paypalMode()} order ${order.id} created for ${(e.budgetMinor / 100).toFixed(2)} USD.` });
  });
  return { orderId: order.id, mode: paypal.paypalMode(), reused: false };
}

export async function fundCapture(u: User, eventId: string, orderId: string) {
  const e = getEvent(read(), eventId);
  if (e.funding.status === "FUNDED") return e.funding;
  if (e.funding.orderId !== orderId) throw new HttpError(409, "ORDER_MISMATCH", "This PayPal order does not belong to the event.");
  let cap: paypal.CaptureResult;
  try {
    cap = await paypal.captureOrder(orderId, { amountMinor: e.budgetMinor, currency: e.currency, eventId: e.id });
  } catch (err) {
    await mutate((s) => {
      const ev = getEvent(s, eventId);
      ev.funding.status = "FUNDING_FAILED";
      ev.funding.history.push({ status: "FUNDING_FAILED", at: stampPhase(s, ev, "funding"), note: (err as Error).message });
      audit(s, { ...actor(u), entityType: "event", entityId: eventId, action: "funding.capture_failed", summary: `Capture failed: ${(err as Error).message}` });
    });
    throw new HttpError(502, "CAPTURE_FAILED", "Funding was not completed. The event remains unfunded.");
  }
  return mutate((s) => {
    const ev = getEvent(s, eventId);
    const t = stampPhase(s, ev, "funding");
    const problems: string[] = [];
    if (cap.status !== "COMPLETED") problems.push(`status ${cap.status}`);
    if (cap.amountMinor !== ev.budgetMinor) problems.push("AMOUNT_MISMATCH");
    if (cap.currency !== ev.currency) problems.push("CURRENCY_MISMATCH");
    if (problems.length) {
      ev.funding.status = cap.status === "PENDING" ? "CAPTURE_PENDING" : "FUNDING_FAILED";
      ev.funding.history.push({ status: ev.funding.status, at: t, note: problems.join(", ") });
      audit(s, { ...actor(u), entityType: "event", entityId: eventId, action: "funding.capture_rejected", summary: `Capture not accepted: ${problems.join(", ")}.` });
      throw new HttpError(409, "CAPTURE_NOT_VERIFIED", "PayPal capture could not be verified. The event remains unfunded.");
    }
    ev.funding = { ...ev.funding, captureId: cap.captureId, status: "FUNDED", capturedAt: t, history: [...ev.funding.history, { status: "FUNDED", at: t, note: cap.captureId ?? undefined }] };
    ev.status = "FUNDED";
    audit(s, { ...actor(u), entityType: "event", entityId: eventId, action: "funding.captured", summary: `Budget captured — ${(cap.amountMinor / 100).toFixed(2)} ${cap.currency}, capture ${cap.captureId}.`, after: { orderId, captureId: cap.captureId } });
    return ev.funding;
  });
}

export async function fundCancel(u: User, eventId: string) {
  return mutate((s) => {
    const ev = getEvent(s, eventId);
    if (ev.funding.status === "FUNDED") return ev.funding;
    ev.funding.status = "FUNDING_CANCELLED";
    ev.funding.orderId = null;
    ev.funding.history.push({ status: "FUNDING_CANCELLED", at: stampPhase(s, ev, "funding") });
    audit(s, { ...actor(u), entityType: "event", entityId: eventId, action: "funding.cancelled", summary: "Payer cancelled PayPal checkout. Event remains unfunded." });
    return ev.funding;
  });
}

// ---------------------------------------------------------------- Optimisation & offers

export async function runOptimise(u: User, eventId: string) {
  return mutate((s) => {
    expireOffers(s);
    const ev = getEvent(s, eventId);
    assertStatus(ev, ["FUNDED", "PLAN_READY", "OFFERS_SENT"], "optimise");
    if (ev.funding.status !== "FUNDED") throw new HttpError(409, "NOT_FUNDED", "Fund the event before optimising.");
    const evOffers = s.offers.filter((o) => o.eventId === eventId);
    const accepted = evOffers.filter((o) => o.status === "ACCEPTED");
    const excludedOrgs = new Set(evOffers.filter((o) => ["ACCEPTED", "DECLINED"].includes(o.status)).map((o) => o.orgId));
    const acceptedWh = accepted.reduce((a, o) => a + o.allocatedWh, 0);
    const acceptedCost = accepted.reduce((a, o) => a + o.maxRewardMinor, 0);
    const target = ev.targetWh - acceptedWh;
    const budget = ev.budgetMinor - acceptedCost;
    const profiles = s.orgs.filter((o) => o.type === "participant").map((o) => latestProfile(s, o.id, "confirmed") ?? latestProfile(s, o.id)).filter(Boolean) as BusinessProfile[];
    const result = optimise({
      event: { id: ev.id, targetWh: target, budgetMinor: budget, shift: ev.shift, minDataQuality: ev.minDataQuality, currency: ev.currency },
      orgs: s.orgs.filter((o) => !excludedOrgs.has(o.id)),
      profiles,
    });
    // supersede previous unpublished/ready plans and any unanswered offers
    for (const p of s.plans) if (p.eventId === eventId && (p.status === "ready" || p.status === "infeasible")) p.status = "superseded";
    for (const o of evOffers) if (o.status === "ACTION_REQUIRED") o.status = "SUPERSEDED";
    const version = s.plans.filter((p) => p.eventId === eventId).length + 1;
    const plan: DispatchPlan = {
      id: uid("plan"),
      eventId,
      version,
      status: result.feasible ? "ready" : "infeasible",
      feasible: result.feasible,
      targetWh: target,
      plannedWh: result.plannedWh,
      estCostMinor: result.estCostMinor,
      budgetMinor: budget,
      shortfallWh: result.shortfallWh,
      minBudgetRequiredMinor: result.minBudgetRequiredMinor,
      eligibleCapacityWh: result.eligibleCapacityWh,
      candidates: result.candidates,
      inputsHash: hashOf({ target, budget, shift: ev.shift, profiles: profiles.map((p) => [p.orgId, p.version]), excluded: [...excludedOrgs] }),
      optimiserVersion: OPTIMISER_VERSION,
      infeasibleReason: result.infeasibleReason,
      createdAt: stampPhase(s, ev, "planning"),
      publishedAt: null,
    };
    s.plans.unshift(plan);
    ev.activePlanId = plan.id;
    if (ev.status === "FUNDED") ev.status = "PLAN_READY";
    if (ev.status === "OFFERS_SENT" && result.feasible) ev.status = "PLAN_READY";
    const sel = plan.candidates.filter((c) => c.selected);
    audit(s, {
      ...actor(u),
      entityType: "plan",
      entityId: plan.id,
      action: "optimisation.generated",
      summary: result.feasible
        ? `Plan v${version}: ${(plan.plannedWh / 1000).toFixed(1)} kWh across ${sel.length} businesses for $${(plan.estCostMinor / 100).toFixed(2)} (${sel.map((c) => c.businessName).join(", ")}).`
        : `Plan v${version} infeasible: ${result.infeasibleReason}`,
      after: { inputsHash: plan.inputsHash, optimiser: OPTIMISER_VERSION },
    });
    return plan;
  });
}

export async function publishOffers(u: User, eventId: string, planId: string) {
  return mutate((s) => {
    const ev = getEvent(s, eventId);
    assertStatus(ev, ["PLAN_READY"], "publish offers");
    const plan = s.plans.find((p) => p.id === planId && p.eventId === eventId);
    if (!plan || plan.id !== ev.activePlanId) throw new HttpError(409, "PLAN_CHANGED", "Plan changed — review the latest plan before publishing.");
    if (!plan.feasible || plan.status !== "ready") throw new HttpError(409, "PLAN_NOT_PUBLISHABLE", "Only a feasible, current plan can be published.");
    const t = stampPhase(s, ev, "offers");
    const expiresAt = new Date(`${ev.eventDate}T09:00:00+01:00`).toISOString();
    const created: Offer[] = plan.candidates
      .filter((c) => c.selected)
      .map((c) => ({
        id: uid("ofr"),
        eventId,
        planId,
        planVersion: plan.version,
        orgId: c.orgId,
        activityId: c.activityId!,
        activityName: c.activityName,
        profileVersion: c.profileVersion,
        allocatedWh: c.allocatedWh,
        rateMinorPerKwh: c.rateMinorPerKwh!,
        maxRewardMinor: c.estRewardMinor,
        shiftWindow: c.window!,
        status: "ACTION_REQUIRED",
        expiresAt,
        publishedAt: t,
        respondedAt: null,
        declineReason: null,
      }));
    s.offers.push(...created);
    plan.status = "published";
    plan.publishedAt = t;
    ev.status = "OFFERS_SENT";
    audit(s, { ...actor(u), entityType: "event", entityId: eventId, action: "offers.published", summary: `${created.length} offers published from plan v${plan.version}. Waiting for business responses.` });
    return created;
  });
}

export async function respondOffer(u: User, offerId: string, decision: "accept" | "decline", reason?: string) {
  return mutate((s) => {
    expireOffers(s);
    const o = s.offers.find((x) => x.id === offerId);
    if (!o) throw new HttpError(404, "NOT_FOUND", "Offer not found.");
    if (u.role === "business" && o.orgId !== u.orgId) throw new HttpError(403, "FORBIDDEN", "This offer belongs to another business.");
    if (u.role === "operator") throw new HttpError(403, "FORBIDDEN", "Only the business can respond to its offer.");
    if (o.status !== "ACTION_REQUIRED") throw new HttpError(409, "OFFER_NOT_OPEN", `This offer is ${o.status.toLowerCase().replace("_", " ")} and can no longer be ${decision}ed.`);
    const ev = getEvent(s, o.eventId);
    if (!["OFFERS_SENT", "PLAN_READY"].includes(ev.status)) throw new HttpError(409, "EVENT_CLOSED", "This event is no longer accepting responses.");
    o.status = decision === "accept" ? "ACCEPTED" : "DECLINED";
    o.respondedAt = stampPhase(s, ev, "responses");
    o.declineReason = decision === "decline" ? (reason ?? null) : null;
    const org = s.orgs.find((x) => x.id === o.orgId)!;
    audit(s, {
      ...actor(u),
      entityType: "offer",
      entityId: o.id,
      action: decision === "accept" ? "offer.accepted" : "offer.declined",
      summary: decision === "accept" ? `${org.name} accepted ${(o.allocatedWh / 1000).toFixed(1)} kWh at $${(o.rateMinorPerKwh / 100).toFixed(2)}/kWh (profile v${o.profileVersion}, plan v${o.planVersion}).` : `${org.name} declined the offer${reason ? ` (${reason})` : ""}.`,
    });
    const acceptedWh = s.offers.filter((x) => x.eventId === ev.id && x.status === "ACCEPTED").reduce((a, x) => a + x.allocatedWh, 0);
    if (acceptedWh >= ev.targetWh) {
      ev.status = "READY_TO_EXECUTE";
      audit(s, { actorId: "system", actorName: "System", role: "system", entityType: "event", entityId: ev.id, action: "event.ready", summary: `Accepted commitments reach the ${(ev.targetWh / 1000).toFixed(1)} kWh target. Ready to execute.` });
    }
    return o;
  });
}

// ---------------------------------------------------------------- Execution & verification

export async function executeDemo(u: User, eventId: string) {
  return mutate((s) => {
    const ev = getEvent(s, eventId);
    assertStatus(ev, ["READY_TO_EXECUTE"], "run the demo event");
    const accepted = s.offers.filter((o) => o.eventId === eventId && o.status === "ACCEPTED");
    s.datasets = s.datasets.filter((d) => d.eventId !== eventId);
    for (const o of accepted) s.datasets.push(...generateDatasets(ev, { orgId: o.orgId, committedWh: o.allocatedWh, window: o.shiftWindow }));
    ev.status = "IN_PROGRESS";
    ev.executedAt = stampPhase(s, ev, "execution");
    audit(s, { ...actor(u), entityType: "event", entityId: eventId, action: "meter.imported", summary: `Demo event replayed: loaded ${accepted.length * 2} simulated 15-minute datasets (${accepted.length * 192} intervals).` });
    return { datasets: accepted.length * 2 };
  });
}

export async function verifyEvent(u: User, eventId: string) {
  return mutate((s) => {
    const ev = getEvent(s, eventId);
    assertStatus(ev, ["IN_PROGRESS", "VERIFY_BLOCKED"], "verify");
    const accepted = s.offers.filter((o) => o.eventId === eventId && o.status === "ACCEPTED");
    const participants = accepted.map((o) => {
      const org = s.orgs.find((x) => x.id === o.orgId)!;
      const base = s.datasets.find((d) => d.eventId === eventId && d.orgId === o.orgId && d.type === "baseline");
      const act = s.datasets.find((d) => d.eventId === eventId && d.orgId === o.orgId && d.type === "event");
      if (!base || !act) throw new HttpError(409, "BASELINE_UNAVAILABLE", `Baseline unavailable for ${org.name}.`);
      return verifyParticipant({ event: ev, orgId: o.orgId, businessName: org.name, committedWh: o.allocatedWh, rateMinorPerKwh: o.rateMinorPerKwh, baseline: base, actual: act, minCoveragePct: ev.minDataQuality });
    });
    const sum = (k: keyof (typeof participants)[number]) => participants.reduce((a, p) => a + (p[k] as number), 0);
    const committed = sum("committedWh");
    const verified = sum("verifiedWh");
    const coverage = participants.length ? Math.min(...participants.map((p) => p.coveragePct)) : 0;
    const ok = participants.every((p) => p.status === "VERIFIED");
    const run: VerificationRun = {
      id: uid("ver"),
      eventId,
      version: s.verifications.filter((v) => v.eventId === eventId).length + 1,
      formulaVersion: FORMULA_VERSION,
      baselineMethod: BASELINE_METHOD,
      minCoveragePct: ev.minDataQuality,
      status: ok ? "VERIFIED" : "INSUFFICIENT_DATA",
      participants,
      createdAt: stampPhase(s, ev, "verification"),
      totals: { committedWh: committed, peakReductionWh: sum("peakReductionWh"), reboundWh: sum("reboundWh"), verifiedWh: verified, deliveryPct: committed ? Math.round((verified / committed) * 1000) / 10 : 0, coveragePct: coverage, rewardMinor: sum("rewardMinor") },
    };
    s.verifications.unshift(run);
    ev.verificationRunId = run.id;
    ev.status = ok ? "VERIFIED" : "VERIFY_BLOCKED";
    audit(s, { ...actor(u), entityType: "verification", entityId: run.id, action: "verification.completed", summary: ok ? `Verification complete. ${(verified / 1000).toFixed(1)} kWh confirmed of ${(committed / 1000).toFixed(1)} kWh committed (${run.totals.deliveryPct}%).` : `Verification blocked: data coverage ${coverage}% below ${ev.minDataQuality}%.`, after: { formula: FORMULA_VERSION, totals: run.totals } });
    return run;
  });
}

// ---------------------------------------------------------------- Settlement

function settlementItems(s: AppState, run: VerificationRun): SettlementItem[] {
  return run.participants.map((p) => {
    const org = s.orgs.find((o) => o.id === p.orgId)!;
    return {
      id: `sti_${run.id}_${p.orgId}`,
      orgId: p.orgId,
      businessName: p.businessName,
      recipientMasked: maskEmail(recipientFor(org)),
      committedWh: p.committedWh,
      verifiedWh: p.verifiedWh,
      rateMinorPerKwh: p.rateMinorPerKwh,
      amountMinor: p.rewardMinor,
      evidence: p.status,
      payable: p.status === "VERIFIED" && p.rewardMinor > 0,
    };
  });
}

export async function createSettlement(u: User, eventId: string) {
  return mutate((s) => {
    const ev = getEvent(s, eventId);
    if (ev.settlementId) return s.settlements.find((x) => x.id === ev.settlementId)!;
    assertStatus(ev, ["VERIFIED"], "open settlement");
    const run = s.verifications.find((v) => v.id === ev.verificationRunId)!;
    const items = settlementItems(s, run);
    const st: Settlement = { id: uid("stl"), eventId, verificationRunId: run.id, status: "DRAFT", items, totalMinor: items.filter((i) => i.payable).reduce((a, i) => a + i.amountMinor, 0), currency: "USD", reviewHash: hashOf(items), approvedBy: null, approvedAt: null, createdAt: stampPhase(s, ev, "settlement") };
    s.settlements.unshift(st);
    ev.settlementId = st.id;
    ev.status = "SETTLEMENT_REVIEW";
    audit(s, { ...actor(u), entityType: "settlement", entityId: st.id, action: "settlement.drafted", summary: `Settlement drafted: ${items.filter((i) => i.payable).length} recipients, $${(st.totalMinor / 100).toFixed(2)} verified reward.` });
    return st;
  });
}

export async function approveSettlement(u: User, settlementId: string, reviewHash: string) {
  return mutate((s) => {
    const st = s.settlements.find((x) => x.id === settlementId);
    if (!st) throw new HttpError(404, "NOT_FOUND", "Settlement not found.");
    if (st.status !== "DRAFT") throw new HttpError(409, "ALREADY_APPROVED", "This settlement has already been approved.");
    const ev = getEvent(s, st.eventId);
    assertStatus(ev, ["SETTLEMENT_REVIEW"], "approve settlement");
    const run = s.verifications.find((v) => v.id === st.verificationRunId)!;
    // Server recalculates from persisted verification — never trusts browser totals.
    const items = settlementItems(s, run);
    const fresh = hashOf(items);
    if (fresh !== st.reviewHash || reviewHash !== st.reviewHash) throw new HttpError(409, "SETTLEMENT_CHANGED", "Settlement data changed since you reviewed it. Reload and review again.");
    const total = items.filter((i) => i.payable).reduce((a, i) => a + i.amountMinor, 0);
    if (total > ev.budgetMinor) throw new HttpError(409, "OVER_BUDGET", "Total exceeds the event budget.");
    if (ev.funding.status !== "FUNDED" || total > ev.funding.amountMinor) throw new HttpError(409, "OVER_FUNDING", "Total exceeds the captured funding for this event.");
    if (total <= 0) throw new HttpError(409, "NOTHING_PAYABLE", "No payable rewards in this settlement.");
    st.status = "APPROVED";
    st.approvedBy = u.id;
    st.approvedAt = stampPhase(s, ev, "approval");
    audit(s, { ...actor(u), entityType: "settlement", entityId: st.id, action: "settlement.approved", summary: `Settlement approved by ${u.displayName}: $${(total / 100).toFixed(2)} to ${items.filter((i) => i.payable).length} recipients.`, after: { reviewHash: st.reviewHash, totalMinor: total } });
    return st;
  });
}

const BATCH_MAP: Record<string, BatchStatus> = { PENDING: "PENDING", PROCESSING: "PROCESSING", SUCCESS: "SUCCESS", DENIED: "DENIED", CANCELED: "FAILED", NEW: "PENDING" };
const ITEM_MAP: Record<string, ItemStatus> = { SUCCESS: "SUCCEEDED", FAILED: "FAILED", PENDING: "PENDING", UNCLAIMED: "UNCLAIMED", RETURNED: "RETURNED", ONHOLD: "HELD", BLOCKED: "BLOCKED", REFUNDED: "REFUNDED", REVERSED: "RETURNED", NEW: "PENDING" };

function rollupEvent(s: AppState, b: PayoutBatch) {
  const ev = getEvent(s, b.eventId);
  const before = ev.status;
  if (b.items.length && b.items.every((i) => i.status === "SUCCEEDED")) ev.status = "PAID";
  else if (b.status === "DENIED" || b.items.some((i) => ITEM_EXCEPTION.includes(i.status))) ev.status = "NEEDS_ATTENTION";
  else ev.status = "PAYOUT_PROCESSING";
  if (before !== ev.status)
    audit(s, { actorId: "system", actorName: "Reconciler", role: "system", entityType: "event", entityId: ev.id, action: "event.status_changed", summary: `Event moved to ${ev.status} after item-level reconciliation.` });
}

function setItem(s: AppState, b: PayoutBatch, senderItemId: string, status: ItemStatus, extra: { paypalItemId?: string; transactionId?: string | null; error?: string | null }, source: string) {
  const it = b.items.find((i) => i.senderItemId === senderItemId);
  if (!it) return;
  if (extra.paypalItemId) it.paypalItemId = extra.paypalItemId;
  if (extra.transactionId) it.transactionId = extra.transactionId;
  if (extra.error !== undefined) it.errorCode = extra.error;
  if (it.status !== status) {
    it.history.push({ status, at: advance(s, 1000), source });
    audit(s, { actorId: "paypal", actorName: "PayPal", role: "paypal", entityType: "payout_item", entityId: it.id, action: "payout.item_status", summary: `${it.businessName}: ${it.status} → ${status} (${source}).` });
    it.status = status;
  }
  it.updatedAt = s.clock ?? nowIso();
}

export async function submitPayouts(u: User, settlementId: string) {
  // Phase 1 — persist intent (stable sender IDs) BEFORE calling PayPal.
  const intent = await mutate((s) => {
    const st = s.settlements.find((x) => x.id === settlementId);
    if (!st) throw new HttpError(404, "NOT_FOUND", "Settlement not found.");
    if (st.status === "DRAFT") throw new HttpError(409, "NOT_APPROVED", "Approve the settlement before submitting payouts.");
    const existing = s.batches.find((b) => b.settlementId === st.id);
    if (existing) return { batch: existing, fresh: false };
    const ev = getEvent(s, st.eventId);
    const t = stampPhase(s, ev, "payout");
    const batch: PayoutBatch = {
      id: uid("pob"),
      settlementId: st.id,
      eventId: ev.id,
      provider: paypal.paypalMode() === "sandbox" ? "paypal" : "paypal-simulator",
      senderBatchId: `PS-${ev.id}-${st.id}`.slice(0, 127),
      paypalBatchId: null,
      amountMinor: st.items.filter((i) => i.payable).reduce((a, i) => a + i.amountMinor, 0),
      currency: "USD",
      status: "SUBMITTING",
      items: st.items
        .filter((i) => i.payable)
        .map((i) => ({ id: uid("poi"), senderItemId: `${st.id}-${i.orgId}`, paypalItemId: null, transactionId: null, orgId: i.orgId, businessName: i.businessName, recipientMasked: i.recipientMasked, amountMinor: i.amountMinor, currency: "USD" as const, status: "READY" as ItemStatus, errorCode: null, history: [{ status: "READY" as ItemStatus, at: t, source: "settlement" }], updatedAt: t })),
      submittedAt: null,
      lastWebhookAt: null,
      lastCheckedAt: null,
      responseRedacted: null,
      history: [{ status: "SUBMITTING", at: t, source: "operator" }],
      updatedAt: t,
    };
    s.batches.unshift(batch);
    st.status = "SUBMITTED";
    ev.status = "PAYOUT_PROCESSING";
    audit(s, { ...actor(u), entityType: "payout_batch", entityId: batch.id, action: "payout.intent_persisted", summary: `Payout intent persisted: sender batch ${batch.senderBatchId}, ${batch.items.length} items, $${(batch.amountMinor / 100).toFixed(2)}.` });
    return { batch, fresh: true };
  });
  if (!intent.fresh && intent.batch.status !== "SUBMITTING" && intent.batch.status !== "UNKNOWN") return intent.batch;

  // Phase 2 — call PayPal with the SAME sender batch id (idempotent on retry).
  const b = intent.batch;
  const s0 = read();
  const items = b.items.map((i) => ({ senderItemId: i.senderItemId, receiver: recipientFor(s0.orgs.find((o) => o.id === i.orgId)!)!, amountMinor: i.amountMinor, currency: i.currency, note: `PeakShift verified flexibility reward — event ${b.eventId}` }));
  let resp: { payoutBatchId: string; batchStatus: string; raw: unknown } | null = null;
  let failure: string | null = null;
  if (paypal.paypalMode() === "simulator") {
    resp = { payoutBatchId: "SIMBATCH-" + hashOf(b.senderBatchId).toUpperCase().slice(0, 12), batchStatus: "PENDING", raw: { simulated: true, batch_header: { batch_status: "PENDING" } } };
  } else {
    try {
      resp = await paypal.createPayoutBatch({ senderBatchId: b.senderBatchId, subject: "You received a PeakShift reward", message: "Thanks for shifting your electricity use.", items });
    } catch (e) {
      failure = e instanceof paypal.PayPalError ? `${e.code}: ${e.message}` : (e as Error).message;
    }
  }
  return mutate((s) => {
    const batch = s.batches.find((x) => x.id === b.id)!;
    const t = advance(s, 30_000);
    if (resp) {
      batch.paypalBatchId = resp.payoutBatchId;
      batch.status = BATCH_MAP[resp.batchStatus] ?? "PENDING";
      batch.submittedAt = t;
      batch.wallClockSubmittedAt = nowIso();
      batch.responseRedacted = resp.raw;
      batch.history.push({ status: batch.status, at: t, source: "create-response" });
      for (const it of batch.items) setItem(s, batch, it.senderItemId, "SUBMITTED", {}, "create-response");
      audit(s, { ...actor(u), entityType: "payout_batch", entityId: batch.id, action: "payout.submitted", summary: `Payout batch submitted to PayPal ${batch.provider === "paypal" ? "sandbox" : "simulator"}: ${resp.payoutBatchId} (${batch.status}).` });
    } else {
      batch.status = "UNKNOWN";
      batch.history.push({ status: "UNKNOWN", at: t, source: failure ?? "error" });
      audit(s, { ...actor(u), entityType: "payout_batch", entityId: batch.id, action: "payout.submit_uncertain", summary: `PayPal response pending confirmation (${failure}). Will reconcile with the same sender batch ID.` });
    }
    batch.updatedAt = t;
    return batch;
  });
}

/** Authoritative reconciliation: fetch batch + item detail (or advance the labelled simulator). */
export async function refreshPayout(u: User | null, batchId: string, source = "manual-refresh") {
  const b0 = read().batches.find((x) => x.id === batchId);
  if (!b0) throw new HttpError(404, "NOT_FOUND", "Payout batch not found.");
  if (b0.status === "UNKNOWN" || b0.status === "SUBMITTING") {
    if (u) return submitPayouts(u, b0.settlementId);
  }
  if (!b0.paypalBatchId) return b0;

  if (b0.provider === "paypal-simulator") {
    return mutate((s) => {
      const b = s.batches.find((x) => x.id === batchId)!;
      // Simulator pacing follows real elapsed time; records follow the scenario clock.
      const elapsed = Date.now() - new Date(b.wallClockSubmittedAt ?? b.submittedAt ?? b.updatedAt).getTime();
      const emit = (type: string, resource: string) => {
        s.webhooks.unshift({ id: uid("whk"), providerEventId: `WH-SIM-${hashOf(type + resource).toUpperCase().slice(0, 10)}`, eventType: type, verified: false, simulated: true, receivedAt: advance(s, 1000), processingStatus: "PROCESSED", resource });
        b.lastWebhookAt = s.clock ?? null;
      };
      if (elapsed > 2500 && (b.status === "PENDING")) {
        b.status = "PROCESSING";
        b.history.push({ status: "PROCESSING", at: advance(s, 1000), source: "simulator" });
        emit("PAYMENT.PAYOUTSBATCH.PROCESSING", b.paypalBatchId!);
        for (const it of b.items) setItem(s, b, it.senderItemId, "PROCESSING", { paypalItemId: "SIMITEM-" + hashOf(it.senderItemId).toUpperCase().slice(0, 10) }, "simulator");
      }
      if (elapsed > 6000 && b.status === "PROCESSING") {
        for (const it of b.items) {
          setItem(s, b, it.senderItemId, "SUCCEEDED", { transactionId: "SIMTXN-" + hashOf("t" + it.senderItemId).toUpperCase().slice(0, 12) }, "simulator");
          emit("PAYMENT.PAYOUTS-ITEM.SUCCEEDED", it.paypalItemId ?? it.senderItemId);
        }
        b.status = "SUCCESS";
        b.history.push({ status: "SUCCESS", at: advance(s, 1000), source: "simulator" });
        emit("PAYMENT.PAYOUTSBATCH.SUCCESS", b.paypalBatchId!);
      }
      b.lastCheckedAt = advance(s, 1000);
      rollupEvent(s, b);
      return b;
    });
  }

  let detail: paypal.BatchDetail;
  try {
    detail = await paypal.getPayoutBatch(b0.paypalBatchId);
  } catch (e) {
    await mutate((s) => {
      const b = s.batches.find((x) => x.id === batchId)!;
      b.lastCheckedAt = advance(s, 1000);
    });
    throw new HttpError(502, "PAYPAL_UNAVAILABLE", `Could not reach PayPal: ${(e as Error).message}. Last confirmed status kept.`);
  }
  return mutate((s) => {
    const b = s.batches.find((x) => x.id === batchId)!;
    const t = advance(s, 1000);
    const bs = BATCH_MAP[detail.batchStatus] ?? "UNKNOWN";
    if (bs !== b.status) {
      b.history.push({ status: bs, at: t, source });
      b.status = bs;
    }
    for (const i of detail.items) setItem(s, b, i.senderItemId, ITEM_MAP[i.transactionStatus] ?? "UNKNOWN", { paypalItemId: i.payoutItemId, transactionId: i.transactionId, error: i.error }, source);
    b.responseRedacted = detail.raw;
    b.lastCheckedAt = t;
    b.updatedAt = t;
    rollupEvent(s, b);
    return b;
  });
}

export async function handlePayPalWebhook(headers: Headers, rawBody: string) {
  let body: { id?: string; event_type?: string; resource?: Record<string, unknown> };
  try {
    body = JSON.parse(rawBody);
  } catch {
    throw new HttpError(400, "BAD_PAYLOAD", "Invalid JSON");
  }
  const verified = await paypal.verifyWebhookSignature(headers, rawBody);
  const eventId = body.id ?? "unknown";
  const res = body.resource ?? {};
  const header = (res.batch_header ?? {}) as { payout_batch_id?: string };
  const batchRef = (header.payout_batch_id ?? (res.payout_batch_id as string | undefined)) ?? "";
  const eventType = body.event_type ?? "(no event type)";
  const supported = eventType.startsWith("PAYMENT.PAYOUTSBATCH.") || eventType.startsWith("PAYMENT.PAYOUTS-ITEM.");
  const outcome = await mutate((s) => {
    const wallClockAt = nowIso();
    if (s.webhooks.some((w) => w.providerEventId === eventId && w.processingStatus !== "REJECTED")) {
      s.webhooks.unshift({ id: uid("whk"), providerEventId: eventId, eventType, verified, simulated: false, receivedAt: advance(s, 1000), wallClockAt, processingStatus: "DUPLICATE", resource: batchRef, reason: "Already processed (same PayPal event ID)" });
      return "duplicate" as const;
    }
    const batch = s.batches.find((b) => b.paypalBatchId === batchRef);
    // A valid signature proves the message came from PayPal — it is not, by itself, proof of payment.
    const reason = !verified ? "Signature verification failed — no state change" : !supported ? "Event type not used by PeakShift" : !batch ? "No matching payout batch" : undefined;
    const processingStatus = !verified ? "REJECTED" : reason ? "UNSUPPORTED" : "PROCESSED";
    const receivedAt = advance(s, processingStatus === "PROCESSED" ? 30_000 : 1000);
    s.webhooks.unshift({ id: uid("whk"), providerEventId: eventId, eventType, verified, simulated: false, receivedAt, wallClockAt, processingStatus, resource: batchRef, reason });
    audit(s, {
      actorId: "paypal",
      actorName: "PayPal webhook",
      role: "paypal",
      entityType: "webhook",
      entityId: eventId,
      action: !verified ? "webhook.rejected" : reason ? "webhook.unsupported" : "webhook.verified",
      summary: !verified ? `${eventType} rejected: ${reason}.` : reason ? `${eventType}: signature verified, not acted on — ${reason.toLowerCase()}.` : `${eventType}: signature verified; item statuses re-fetched from PayPal.`,
    });
    if (batch && verified && supported) batch.lastWebhookAt = receivedAt;
    return !verified ? ("rejected" as const) : batch && supported ? batch.id : ("unmatched" as const);
  });
  if (outcome === "rejected") throw new HttpError(400, "WEBHOOK_UNVERIFIED", "Signature verification failed.");
  if (outcome !== "duplicate" && outcome !== "unmatched") await refreshPayout(null, outcome, "webhook");
  return { ok: true, outcome };
}

// ---------------------------------------------------------------- Business profiles

export async function runProfileExtraction(u: User, orgId: string, text: string) {
  if (u.role === "business" && u.orgId !== orgId) throw new HttpError(403, "FORBIDDEN", "You can only edit your own profile.");
  if (!text.trim() || text.trim().length < 20) throw new HttpError(422, "VALIDATION_ERROR", "Describe at least one activity in a sentence or two.");
  let draft;
  try {
    draft = await extractProfile(text);
  } catch (e) {
    const invalid = (e as { code?: string }).code === "AI_OUTPUT_INVALID";
    await mutate((s) => {
      s.aiRuns.unshift({ id: uid("ai"), feature: "profile_extract", mode: "claude", model: "?", promptVersion: "profile-extract-v3", status: invalid ? "rejected" : "error", latencyMs: 0, at: nowIso() });
    });
    throw new HttpError(502, invalid ? "AI_OUTPUT_INVALID" : "AI_UNAVAILABLE", invalid ? "We couldn't safely structure this description. Please review or enter the fields manually." : "AI extraction is temporarily unavailable. You can complete the profile manually.");
  }
  return mutate((s) => {
    const prev = latestProfile(s, orgId);
    // discard any older unconfirmed draft so only one draft exists
    s.profiles = s.profiles.filter((p) => !(p.orgId === orgId && p.status === "draft"));
    const version = (latestProfile(s, orgId)?.version ?? 0) + 1;
    const p: BusinessProfile = {
      id: uid("prof"),
      orgId,
      version,
      status: "draft",
      freeText: text,
      draft,
      activities: draft.activities.map(({ provenance: _p, sourceEvidence: _e, ...a }) => a),
      minimumNoticeHours: draft.minimumNoticeHours,
      dataQuality: prev?.dataQuality ?? 100,
      confirmedAt: null,
      confirmedBy: null,
      createdAt: advance(s, 60_000),
    };
    s.profiles.push(p);
    s.aiRuns.unshift({ id: uid("ai"), feature: "profile_extract", mode: draft.engine.mode, model: draft.engine.model, promptVersion: draft.engine.promptVersion, status: "ok", latencyMs: draft.engine.latencyMs, at: nowIso() });
    audit(s, { ...actor(u), entityType: "profile", entityId: p.id, action: "ai.extraction_generated", summary: `AI draft v${version} generated (${draft.engine.mode}, ${draft.engine.latencyMs} ms): ${draft.activities.length} activities, ${draft.missingFields.length} missing fields. Not eligible until confirmed.` });
    return p;
  });
}

const ActivityConfirm = z.object({
  id: z.string(),
  name: z.string().trim().min(1).max(120),
  equipmentCategory: z.string().max(40),
  isCritical: z.boolean(),
  maxShiftWh: z.number().int().min(0).max(500000).nullable(),
  rateMinorPerKwh: z.number().int().min(0).max(100000).nullable(),
  window: z.object({ start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/) }).nullable(),
  mustCompleteBy: z.string().nullable().optional(),
  constraints: z.array(z.string().max(200)).max(10),
  safetyAcknowledged: z.boolean(),
});
const ConfirmInput = z.object({ profileId: z.string(), activities: z.array(ActivityConfirm).min(1).max(8), minimumNoticeHours: z.number().int().min(0).max(168).nullable() });

export async function confirmProfile(u: User, orgId: string, input: unknown) {
  if (u.role === "business" && u.orgId !== orgId) throw new HttpError(403, "FORBIDDEN", "You can only confirm your own profile.");
  const parsed = ConfirmInput.safeParse(input);
  if (!parsed.success) throw new HttpError(422, "VALIDATION_ERROR", "Some profile fields are invalid.");
  const v = parsed.data;
  const fields: Record<string, string> = {};
  v.activities.forEach((a, i) => {
    if (a.isCritical && !a.safetyAcknowledged) fields[`activities.${i}.safety`] = "Confirm the safety declaration for this critical activity.";
    if (!a.isCritical) {
      if (!a.safetyAcknowledged) fields[`activities.${i}.safety`] = "Confirm this activity can be shifted safely.";
      if (!a.maxShiftWh || a.maxShiftWh <= 0) fields[`activities.${i}.maxShiftWh`] = "Enter how much energy can move.";
      if (a.rateMinorPerKwh == null) fields[`activities.${i}.rateMinorPerKwh`] = "Enter your minimum reward.";
      if (!a.window || a.window.end <= a.window.start) fields[`activities.${i}.window`] = "Enter a valid time window.";
    }
  });
  if (Object.keys(fields).length) throw new HttpError(422, "VALIDATION_ERROR", "A few details need your input before the profile can be confirmed.", fields);
  return mutate((s) => {
    const draft = s.profiles.find((p) => p.id === v.profileId && p.orgId === orgId);
    if (!draft) throw new HttpError(404, "NOT_FOUND", "Draft not found.");
    if (draft.status !== "draft") throw new HttpError(409, "NOT_DRAFT", "This profile version is already confirmed.");
    for (const p of s.profiles) if (p.orgId === orgId && p.status === "confirmed") p.status = "superseded";
    const before = draft.activities;
    draft.activities = v.activities.map(({ safetyAcknowledged: _s, ...a }) => ({ ...a, currency: "USD" as const, maxShiftWh: a.isCritical ? 0 : a.maxShiftWh, rateMinorPerKwh: a.isCritical ? null : a.rateMinorPerKwh, window: a.isCritical ? null : a.window, mustCompleteBy: a.mustCompleteBy ?? null })) as FlexActivity[];
    draft.minimumNoticeHours = v.minimumNoticeHours;
    draft.status = "confirmed";
    draft.confirmedAt = advance(s, 60_000);
    draft.confirmedBy = u.id;
    const eligible = draft.activities.filter((a) => !a.isCritical);
    audit(s, { ...actor(u), entityType: "profile", entityId: draft.id, action: "profile.confirmed", summary: `Profile v${draft.version} confirmed: ${draft.activities.length} activities, ${eligible.length} eligible, ${draft.activities.length - eligible.length} critical.`, before, after: draft.activities });
    return draft;
  });
}

export async function resetDemo(u: User) {
  if (u.role !== "admin") throw new HttpError(403, "FORBIDDEN", "Only the platform admin can reset the demo.");
  await resetState();
  await mutate((s) => audit(s, { ...actor(u), entityType: "demo", entityId: s.seedVersion, action: "demo.reset", summary: "Demo reset to the seeded scenario. Prior demo payouts and records cleared." }));
  return { ok: true };
}

export { correlation };
