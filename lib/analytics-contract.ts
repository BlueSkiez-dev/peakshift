// AG Studio analytics data contract (v1.1 Engineering Addendum §6–7).
// Authorised, event-scoped, camelCase read models built from authoritative domain records.
// Energy = integer Wh, power = kW, money = integer minor units + currencyCode. UTC ISO timestamps.
// Never includes emails, PayPal recipient identifiers, credentials or free-text profile descriptions.
import type { AppState, DemandEvent } from "./types";
import { windowIdx } from "./meter";
import { hashOf } from "./store";
import { latestProfile } from "./services";
import { scenarioNow } from "./clock";
import { attainmentPct } from "./terms";
import { buildParticipantEfficiency } from "./efficiency";

export const ANALYTICS_SCHEMA_VERSION = "1.0";
export const MAX_ROWS_PER_SOURCE = 5000;

type Fmt = "textFormat" | "integerFormat" | "decimalFormat" | "booleanFormat" | "percentageFormat";
type FieldDef = { id: string; name: string; format: Fmt; description?: string };
export interface StudioSource {
  id: string;
  name: string;
  description: string;
  primaryKeyField: string;
  transactions: "all";
  data: Record<string, string | number | boolean | null>[];
  fields: FieldDef[];
}
export interface StudioRelationship {
  id: string;
  source: string;
  target: string;
  type: "many-to-one";
}
export interface StudioBootstrap {
  eventId: string;
  eventName: string;
  snapshotId: string;
  dataAsOfUtc: string;
  dataMode: "SIMULATED";
  schemaVersion: string;
  verificationVersion: number | null;
  description: string;
  sources: StudioSource[];
  relationships: StudioRelationship[];
}

const f = (id: string, name: string, format: Fmt, description?: string): FieldDef => ({ id, name, format, description });

/** Local event date + "HH:MM" (Africa/Lagos, UTC+1, no DST) → UTC ISO. */
function utc(date: string, hhmm: string) {
  return new Date(`${date}T${hhmm}:00+01:00`).toISOString();
}
function intervalUtc(date: string, i: number) {
  return new Date(new Date(`${date}T00:00:00+01:00`).getTime() + i * 15 * 60000).toISOString();
}
const hhmmOf = (i: number) => `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`;

export function buildStudioData(s: AppState, ev: DemandEvent): StudioBootstrap {
  const participants = s.orgs.filter((o) => o.type === "participant");
  const offers = s.offers.filter((o) => o.eventId === ev.id && o.status !== "SUPERSEDED");
  const run = s.verifications.find((v) => v.id === ev.verificationRunId);
  const settlement = s.settlements.find((x) => x.id === ev.settlementId);
  const batch = s.batches.find((b) => b.eventId === ev.id);
  const plans = s.plans.filter((p) => p.eventId === ev.id && p.status !== "superseded");
  const plan = s.plans.find((p) => p.id === ev.activePlanId);
  const decisions = new Map<string, (typeof plans)[number]["candidates"][number]>();
  for (const p of [...plans].sort((a, b) => a.version - b.version)) for (const c of p.candidates) if (!decisions.has(c.orgId) || c.selected) decisions.set(c.orgId, c);

  const committedWh = offers.filter((o) => o.status === "ACCEPTED").reduce((a, o) => a + o.allocatedWh, 0);
  const peakHours = windowIdx(ev.peak).length / 4;

  // ---- events
  const events = [
    {
      eventId: ev.id,
      eventName: ev.name,
      status: ev.status,
      siteTimezone: ev.timezone,
      peakStartUtc: utc(ev.eventDate, ev.peak.start),
      peakEndUtc: utc(ev.eventDate, ev.peak.end),
      shiftStartUtc: utc(ev.eventDate, ev.shift.start),
      shiftEndUtc: utc(ev.eventDate, ev.shift.end),
      peakWindowLabel: `${ev.peak.start}–${ev.peak.end}`,
      shiftWindowLabel: `${ev.shift.start}–${ev.shift.end}`,
      targetReductionKw: ev.targetKw,
      targetEnergyWh: ev.targetWh,
      availableCandidateKw: plan ? Math.round((plan.eligibleCapacityWh / peakHours / 1000) * 100) / 100 : null,
      committedKw: Math.round((committedWh / peakHours / 1000) * 100) / 100,
      verifiedKw: run ? Math.round((run.totals.verifiedWh / peakHours / 1000) * 100) / 100 : null,
      incentiveBudgetMinor: ev.budgetMinor,
      incentiveBudgetUsd: ev.budgetMinor / 100,
      currencyCode: ev.currency,
      fundingStatus: ev.funding.status,
      dataMode: "SIMULATED",
      dataAsOfUtc: scenarioNow(s),
    },
  ];

  // ---- businesses (no emails, no free text)
  const businesses = participants.map((o) => {
    const p = latestProfile(s, o.id, "confirmed") ?? latestProfile(s, o.id);
    const flex = p?.activities.filter((a) => !a.isCritical) ?? [];
    const crit = p?.activities.filter((a) => a.isCritical) ?? [];
    const wh = flex.reduce((a, x) => a + (x.maxShiftWh ?? 0), 0);
    return {
      businessId: o.id,
      displayName: o.name,
      businessType: o.category ?? "",
      regionLabel: o.siteLabel ?? "",
      profileStatus: p?.status === "confirmed" ? "CONFIRMED" : p ? "DRAFT" : "NONE",
      profileVersion: p?.version ?? 0,
      safetyReviewStatus: crit.length && !flex.length ? "CRITICAL_LOAD_EXCLUDED" : crit.length ? "CRITICAL_ACTIVITY_PROTECTED" : "NO_CRITICAL_LOADS",
      maxShiftKw: Math.round((wh / peakHours / 1000) * 100) / 100,
      availableShiftWh: wh,
      minRateMinorPerKwh: flex[0]?.rateMinorPerKwh ?? null,
    };
  });

  // ---- eligibility decisions (deterministic optimiser output)
  const eligibility = [...decisions.values()].map((c) => ({
    decisionId: `${ev.id}:${c.orgId}`,
    eventId: ev.id,
    businessId: c.orgId,
    eligible: c.eligible,
    selected: c.selected,
    hardSafetyBlock: c.hard,
    reasonCode: c.reasonCode,
    reasonText: c.reason,
    allocatedWh: c.allocatedWh,
    capacityWh: c.capacityWh,
    rateMinorPerKwh: c.rateMinorPerKwh,
    planVersion: plans.find((p) => p.candidates.includes(c))?.version ?? null,
  }));

  // ---- offers
  const offerRows = offers.map((o) => ({
    offerId: o.id,
    eventId: ev.id,
    businessId: o.orgId,
    offerStatus: o.status,
    committedKw: Math.round((o.allocatedWh / peakHours / 1000) * 100) / 100,
    committedWh: o.allocatedWh,
    incentiveRateMinorPerKwh: o.rateMinorPerKwh,
    estimatedRewardMinor: o.maxRewardMinor,
    acceptedAt: o.status === "ACCEPTED" ? o.respondedAt : null,
    planVersion: o.planVersion,
  }));

  // ---- meter intervals (measured windows only: alternate + peak)
  const peak = new Set(windowIdx(ev.peak));
  const shift = new Set(windowIdx(ev.shift));
  const meterIntervals: StudioSource["data"] = [];
  const orgsWithData = [...new Set(s.datasets.filter((d) => d.eventId === ev.id).map((d) => d.orgId))];
  for (const orgId of orgsWithData) {
    const base = s.datasets.find((d) => d.eventId === ev.id && d.orgId === orgId && d.type === "baseline");
    const act = s.datasets.find((d) => d.eventId === ev.id && d.orgId === orgId && d.type === "event");
    for (let i = 44; i < 84; i++) {
      // 11:00–21:00 local: the evidence range around both windows
      const b = base?.readings[i]?.wh ?? null;
      const a = act?.readings[i]?.wh ?? null;
      meterIntervals.push({
        intervalId: `${ev.id}:${orgId}:${i}`,
        eventId: ev.id,
        businessId: orgId,
        windowType: peak.has(i) ? "PEAK" : shift.has(i) ? "SHIFT" : "OTHER",
        intervalStartUtc: intervalUtc(ev.eventDate, i),
        intervalEndUtc: intervalUtc(ev.eventDate, i + 1),
        intervalLabel: hhmmOf(i),
        intervalIndex: i,
        intervalMinutes: 15,
        baselineWh: b,
        actualWh: a,
        deltaWh: a != null && b != null ? a - b : null,
        dataQuality: a != null && b != null ? "OK" : "MISSING",
        isSimulated: true,
      });
    }
  }

  // ---- verification results
  const verificationResults = (run?.participants ?? []).map((p) => ({
    verificationId: `${run!.id}:${p.orgId}`,
    eventId: ev.id,
    businessId: p.orgId,
    verificationStatus: p.status,
    committedWh: p.committedWh,
    baselinePeakWh: p.baselinePeakWh,
    actualPeakWh: p.actualPeakWh,
    peakReductionWh: p.peakReductionWh,
    baselineShiftWh: p.baselineShiftWh,
    actualShiftWh: p.actualShiftWh,
    reboundWh: p.reboundWh,
    verifiedShiftWh: p.verifiedWh,
    limitedBy: p.limitedBy,
    coveragePct: p.coveragePct,
    attainmentPct: attainmentPct(p.verifiedWh, p.committedWh),
    rewardMinor: p.rewardMinor,
    rewardPerVerifiedKwhMinor: p.verifiedWh ? Math.round((p.rewardMinor * 1000) / p.verifiedWh) : null,
    reasonCode: p.status === "VERIFIED" ? `LIMITED_BY_${p.limitedBy.toUpperCase()}` : "INSUFFICIENT_DATA",
    computedAt: run!.createdAt,
    formulaVersion: run!.formulaVersion,
    datasetVersion: `v${run!.version}`,
    isSimulated: true,
  }));

  // ---- settlement items
  const settlementItems = (settlement?.items ?? []).map((i) => ({
    settlementItemId: i.id,
    settlementId: settlement!.id,
    eventId: ev.id,
    businessId: i.orgId,
    rewardAmountMinor: i.amountMinor,
    rewardAmountUsd: i.amountMinor / 100,
    currencyCode: "USD",
    settlementItemStatus: settlement!.status === "DRAFT" ? "CALCULATED" : settlement!.status === "APPROVED" ? "APPROVED" : "SUBMITTED",
    approvedAt: settlement!.approvedAt,
  }));

  // ---- payout items (no recipient identifiers)
  const payoutItems = (batch?.items ?? []).map((i) => ({
    payoutItemId: i.id,
    settlementItemId: settlement?.items.find((x) => x.orgId === i.orgId)?.id ?? null,
    eventId: ev.id,
    businessId: i.orgId,
    paypalBatchId: batch!.paypalBatchId,
    paypalItemId: i.paypalItemId,
    amountMinor: i.amountMinor,
    amountUsd: i.amountMinor / 100,
    currencyCode: i.currency,
    payoutStatus: i.status,
    batchStatus: batch!.status,
    failureCode: i.errorCode,
    provider: batch!.provider === "paypal" ? "PAYPAL_SANDBOX" : "PAYPAL_SIMULATOR",
    lastWebhookAt: batch!.lastWebhookAt,
    lastReconciledAt: batch!.lastCheckedAt,
  }));

  // ---- participant efficiency (derived projection: confirmed PayPal item payouts ÷ verified energy)
  const participantEfficiency = buildParticipantEfficiency(ev.id, payoutItems, verificationResults, (id) => participants.find((o) => o.id === id)?.name ?? id);

  const src = (id: string, name: string, description: string, primaryKeyField: string, data: StudioSource["data"], fields: FieldDef[]): StudioSource => ({
    id,
    name,
    description,
    primaryKeyField,
    transactions: "all",
    data: data.slice(0, MAX_ROWS_PER_SOURCE),
    fields,
  });

  const sources: StudioSource[] = [
    src("events", "Events", "The selected demand-response event: target, windows, budget, status. One row.", "eventId", events, [
      f("eventId", "Event ID", "textFormat"), f("eventName", "Event", "textFormat"), f("status", "Event status", "textFormat"), f("siteTimezone", "Timezone", "textFormat"),
      f("peakStartUtc", "Peak start (UTC)", "textFormat"), f("peakEndUtc", "Peak end (UTC)", "textFormat"), f("shiftStartUtc", "Shift start (UTC)", "textFormat"), f("shiftEndUtc", "Shift end (UTC)", "textFormat"),
      f("peakWindowLabel", "Peak window (local)", "textFormat"), f("shiftWindowLabel", "Alternate window (local)", "textFormat"),
      f("targetReductionKw", "Target reduction (kW)", "decimalFormat", "Average power reduction required over the peak window"),
      f("targetEnergyWh", "Target energy (Wh)", "integerFormat"), f("availableCandidateKw", "Available candidate (kW)", "decimalFormat", "Eligible confirmed capacity averaged over the peak"),
      f("committedKw", "Committed (kW)", "decimalFormat", "Accepted commitments averaged over the peak — not delivered energy"), f("verifiedKw", "Verified (kW)", "decimalFormat", "Verified shifted energy averaged over the peak"),
      f("incentiveBudgetMinor", "Incentive budget (minor units)", "integerFormat", "Cents"), f("incentiveBudgetUsd", "Incentive budget (USD)", "decimalFormat", "Display value derived from minor units"), f("currencyCode", "Currency", "textFormat"), f("fundingStatus", "Funding status", "textFormat"),
      f("dataMode", "Data mode", "textFormat"), f("dataAsOfUtc", "Data as of (UTC)", "textFormat"),
    ]),
    src("businesses", "Businesses", "Participating small businesses and their confirmed flexibility summary. Fictional.", "businessId", businesses, [
      f("businessId", "Business ID", "textFormat"), f("displayName", "Business", "textFormat"), f("businessType", "Category", "textFormat"), f("regionLabel", "Site", "textFormat"),
      f("profileStatus", "Profile status", "textFormat"), f("profileVersion", "Profile version", "integerFormat"), f("safetyReviewStatus", "Safety status", "textFormat"),
      f("maxShiftKw", "Max shift (kW)", "decimalFormat"), f("availableShiftWh", "Available shift (Wh)", "integerFormat"), f("minRateMinorPerKwh", "Min. rate (minor/kWh)", "integerFormat"),
    ]),
    src("eligibility", "Eligibility decisions", "Deterministic optimiser decision per business with stored reason codes. Hard safety blocks cannot be overridden.", "decisionId", eligibility, [
      f("decisionId", "Decision ID", "textFormat"), f("eventId", "Event ID", "textFormat"), f("businessId", "Business ID", "textFormat"),
      f("eligible", "Eligible", "booleanFormat"), f("selected", "Selected", "booleanFormat"), f("hardSafetyBlock", "Safety block", "booleanFormat"),
      f("reasonCode", "Reason code", "textFormat"), f("reasonText", "Reason", "textFormat"), f("allocatedWh", "Allocated (Wh)", "integerFormat"), f("capacityWh", "Capacity (Wh)", "integerFormat"),
      f("rateMinorPerKwh", "Rate (minor/kWh)", "integerFormat"), f("planVersion", "Plan version", "integerFormat"),
    ]),
    src("offers", "Offers", "Offers published to businesses and their voluntary responses.", "offerId", offerRows, [
      f("offerId", "Offer ID", "textFormat"), f("eventId", "Event ID", "textFormat"), f("businessId", "Business ID", "textFormat"), f("offerStatus", "Offer status", "textFormat"),
      f("committedKw", "Committed (kW)", "decimalFormat"), f("committedWh", "Committed (Wh)", "integerFormat"), f("incentiveRateMinorPerKwh", "Rate (minor/kWh)", "integerFormat"),
      f("estimatedRewardMinor", "Estimated reward (minor)", "integerFormat"), f("acceptedAt", "Accepted at (UTC)", "textFormat"), f("planVersion", "Plan version", "integerFormat"),
    ]),
    src("meterIntervals", "Meter intervals", "SIMULATED 15-minute baseline vs actual interval energy (Wh) around the peak and alternate windows.", "intervalId", meterIntervals, [
      f("intervalId", "Interval ID", "textFormat"), f("eventId", "Event ID", "textFormat"), f("businessId", "Business ID", "textFormat"), f("windowType", "Window", "textFormat"),
      f("intervalStartUtc", "Interval start (UTC)", "textFormat"), f("intervalEndUtc", "Interval end (UTC)", "textFormat"), f("intervalLabel", "Interval (local)", "textFormat"),
      f("intervalIndex", "Interval index", "integerFormat"), f("intervalMinutes", "Interval minutes", "integerFormat"),
      f("baselineWh", "Baseline (Wh)", "integerFormat", "Interval energy"), f("actualWh", "Actual (Wh)", "integerFormat", "Interval energy"), f("deltaWh", "Delta (Wh)", "integerFormat"),
      f("dataQuality", "Data quality", "textFormat"), f("isSimulated", "Simulated", "booleanFormat"),
    ]),
    src("verificationResults", "Verification results", "Immutable M&V output per participant: verified shifted energy = min(peak reduction, alternate-window increase), capped at commitment. reboundWh is the alternate-window increase; coveragePct is meter-data completeness, not commitment attainment.", "verificationId", verificationResults, [
      f("verificationId", "Verification ID", "textFormat"), f("eventId", "Event ID", "textFormat"), f("businessId", "Business ID", "textFormat"), f("verificationStatus", "Verification status", "textFormat"),
      f("committedWh", "Committed (Wh)", "integerFormat"), f("baselinePeakWh", "Baseline peak (Wh)", "integerFormat"), f("actualPeakWh", "Actual peak (Wh)", "integerFormat"),
      f("peakReductionWh", "Peak reduction (Wh)", "integerFormat"), f("baselineShiftWh", "Baseline alternate (Wh)", "integerFormat"), f("actualShiftWh", "Actual alternate (Wh)", "integerFormat"),
      f("reboundWh", "Alternate-window increase (Wh)", "integerFormat"), f("verifiedShiftWh", "Verified shifted (Wh)", "integerFormat"), f("limitedBy", "Limited by", "textFormat"),
      f("coveragePct", "Meter data completeness (%)", "decimalFormat"), f("attainmentPct", "Commitment attainment (%)", "decimalFormat"), f("rewardMinor", "Verified reward (minor)", "integerFormat"), f("rewardPerVerifiedKwhMinor", "Reward per verified kWh (minor)", "integerFormat"),
      f("reasonCode", "Reason code", "textFormat"), f("computedAt", "Computed at (UTC)", "textFormat"), f("formulaVersion", "Formula", "textFormat"), f("datasetVersion", "Dataset version", "textFormat"), f("isSimulated", "Simulated", "booleanFormat"),
    ]),
    src("settlementItems", "Settlement items", "Server-calculated reward entitlements. Approval is a human action in Operations.", "settlementItemId", settlementItems, [
      f("settlementItemId", "Settlement item ID", "textFormat"), f("settlementId", "Settlement ID", "textFormat"), f("eventId", "Event ID", "textFormat"), f("businessId", "Business ID", "textFormat"),
      f("rewardAmountMinor", "Reward (minor)", "integerFormat"), f("rewardAmountUsd", "Reward (USD)", "decimalFormat", "Display value derived from minor units"), f("currencyCode", "Currency", "textFormat"), f("settlementItemStatus", "Settlement status", "textFormat"), f("approvedAt", "Approved at (UTC)", "textFormat"),
    ]),
    src("payoutItems", "Payout items", "PayPal payout item state, reconciled from verified webhooks / authoritative item detail. Batch status is separate.", "payoutItemId", payoutItems, [
      f("payoutItemId", "Payout item ID", "textFormat"), f("settlementItemId", "Settlement item ID", "textFormat"), f("eventId", "Event ID", "textFormat"), f("businessId", "Business ID", "textFormat"),
      f("paypalBatchId", "PayPal batch ID", "textFormat"), f("paypalItemId", "PayPal item ID", "textFormat"), f("amountMinor", "Amount (minor)", "integerFormat"), f("amountUsd", "Amount (USD)", "decimalFormat", "Display value derived from minor units"), f("currencyCode", "Currency", "textFormat"),
      f("payoutStatus", "Payout status", "textFormat"), f("batchStatus", "Batch status", "textFormat"), f("failureCode", "Failure code", "textFormat"), f("provider", "Provider", "textFormat"),
      f("lastWebhookAt", "Last webhook (UTC)", "textFormat"), f("lastReconciledAt", "Last reconciled (UTC)", "textFormat"),
    ]),
    src(
      "participantEfficiency",
      "Participant efficiency",
      "Derived, read-only projection: one row per business whose PayPal payout ITEM is confirmed SUCCEEDED and whose verified shifted energy is positive. costPerVerifiedKwhUsd = paidAmountUsd ÷ verifiedEnergyKwh. eventWeightedAverageCostPerVerifiedKwhUsd = total confirmed paid USD ÷ total verified kWh (same value on every row; not a mean of the rates). Batch status is never used. Use this table directly for cost-per-verified-kWh charts — no calculated measure needed.",
      "participantEfficiencyId",
      participantEfficiency,
      [
        f("participantEfficiencyId", "Participant efficiency ID", "textFormat"), f("eventId", "Event ID", "textFormat"), f("businessId", "Business ID", "textFormat"), f("businessName", "Business", "textFormat"),
        f("paidAmountMinor", "Paid amount (minor)", "integerFormat", "Confirmed PayPal item payouts in cents (item status SUCCEEDED)"),
        f("paidAmountUsd", "Paid amount (USD)", "decimalFormat", "paidAmountMinor ÷ 100"),
        f("verifiedEnergyWh", "Verified energy (Wh)", "integerFormat", "Verified shifted energy from the verification run"),
        f("verifiedEnergyKwh", "Verified energy (kWh)", "decimalFormat", "verifiedEnergyWh ÷ 1000"),
        f("costPerVerifiedKwhUsd", "Cost per verified kWh (USD)", "decimalFormat", "paidAmountUsd ÷ verifiedEnergyKwh — USD per verified kWh"),
        f("eventWeightedAverageCostPerVerifiedKwhUsd", "Event weighted avg cost per verified kWh (USD)", "decimalFormat", "Total confirmed paid USD ÷ total verified kWh for the event"),
        f("payoutStatus", "Payout status", "textFormat", "Always SUCCEEDED — only confirmed recipient items are included"),
      ],
    ),
  ];

  const rel = (id: string, source: string, target: string): StudioRelationship => ({ id, source, target, type: "many-to-one" });
  const relationships = [
    rel("eligibility-event", "eligibility.eventId", "events.eventId"),
    rel("eligibility-business", "eligibility.businessId", "businesses.businessId"),
    rel("offers-event", "offers.eventId", "events.eventId"),
    rel("offers-business", "offers.businessId", "businesses.businessId"),
    rel("meter-event", "meterIntervals.eventId", "events.eventId"),
    rel("meter-business", "meterIntervals.businessId", "businesses.businessId"),
    rel("verification-event", "verificationResults.eventId", "events.eventId"),
    rel("verification-business", "verificationResults.businessId", "businesses.businessId"),
    rel("settlement-event", "settlementItems.eventId", "events.eventId"),
    rel("settlement-business", "settlementItems.businessId", "businesses.businessId"),
    rel("payout-settlement-item", "payoutItems.settlementItemId", "settlementItems.settlementItemId"),
    rel("payout-business", "payoutItems.businessId", "businesses.businessId"),
    rel("efficiency-event", "participantEfficiency.eventId", "events.eventId"),
    rel("efficiency-business", "participantEfficiency.businessId", "businesses.businessId"),
  ];

  const snapshotId = `snap_${ev.id}_${hashOf({ st: ev.status, o: offerRows.map((o) => [o.offerId, o.offerStatus]), r: run?.id, b: batch?.items.map((i) => i.status), f: ev.funding.status, p: plan?.id })}`;
  return {
    eventId: ev.id,
    eventName: ev.name,
    snapshotId,
    dataAsOfUtc: scenarioNow(s),
    dataMode: "SIMULATED",
    schemaVersion: ANALYTICS_SCHEMA_VERSION,
    verificationVersion: run?.version ?? null,
    description: `PeakShift event-scoped analytics for “${ev.name}” (${ev.eventDate}, ${ev.timezone}). Energy in integer Wh, power in kW, money in integer minor units (USD cents) with currencyCode. Meter data is SIMULATED for a hackathon demo. Businesses are fictional.`,
    sources,
    relationships,
  };
}
