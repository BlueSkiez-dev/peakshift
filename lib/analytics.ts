// Approved, read-only analytics datasets (the only data the Analyst agent and AG workspace can see).
// No emails, secrets or raw PayPal payloads are included.
import type { AppState, DemandEvent } from "./types";
import { windowIdx } from "./meter";
import { intervalLabel } from "./format";

export type DatasetName = "demand_curve" | "allocation" | "verification" | "reward_economics" | "payout_status" | "exclusions";

export interface Dataset {
  name: DatasetName;
  title: string;
  description: string;
  rows: Record<string, string | number | boolean | null>[];
  fields: { key: string; label: string; unit?: "kWh" | "USD" | "%" | "USD/kWh" | "kW" }[];
}

const r1 = (wh: number) => Math.round(wh / 100) / 10;
const usd = (m: number) => Math.round(m) / 100;

export function buildDatasets(s: AppState, ev: DemandEvent): Record<DatasetName, Dataset> {
  const plan = s.plans.find((p) => p.id === ev.activePlanId) ?? s.plans.find((p) => p.eventId === ev.id && p.status === "published");
  const publishedPlans = s.plans.filter((p) => p.eventId === ev.id && p.status === "published");
  const offers = s.offers.filter((o) => o.eventId === ev.id);
  const run = s.verifications.find((v) => v.id === ev.verificationRunId);
  const batch = s.batches.find((b) => b.eventId === ev.id);

  // Demand curve: aggregate across participants (baseline vs event), target line during the peak.
  const ds = s.datasets.filter((d) => d.eventId === ev.id);
  const peak = new Set(windowIdx(ev.peak));
  const shift = new Set(windowIdx(ev.shift));
  const demandRows = Array.from({ length: 96 }, (_, i) => {
    const base = ds.filter((d) => d.type === "baseline").reduce((a, d) => a + (d.readings[i]?.wh ?? 0), 0);
    const act = ds.filter((d) => d.type === "event").reduce((a, d) => a + (d.readings[i]?.wh ?? 0), 0);
    return {
      time: intervalLabel(i),
      baseline_kwh: ds.length ? r1(base) / 1 : null,
      actual_kwh: ds.length ? r1(act) : null,
      window: peak.has(i) ? "Peak" : shift.has(i) ? "Alternate" : "Other",
      simulated: true,
    };
  });

  const allCandidates = (publishedPlans.length ? publishedPlans : plan ? [plan] : []).flatMap((p) => p.candidates);
  const latestByOrg = new Map<string, (typeof allCandidates)[number]>();
  for (const c of allCandidates) if (!latestByOrg.has(c.orgId) || c.selected) latestByOrg.set(c.orgId, c);

  const allocationRows = [...latestByOrg.values()].map((c) => {
    const o = offers.find((x) => x.orgId === c.orgId && x.status !== "SUPERSEDED");
    return {
      business: c.businessName,
      available_kwh: r1(c.capacityWh),
      allocated_kwh: r1(c.allocatedWh),
      rate_usd_per_kwh: c.rateMinorPerKwh == null ? null : usd(c.rateMinorPerKwh),
      estimated_reward_usd: usd(c.estRewardMinor),
      selected: c.selected,
      offer_status: o?.status ?? (c.selected ? "NOT_PUBLISHED" : "NOT_OFFERED"),
      reason_code: c.reasonCode,
    };
  });

  const verificationRows = (run?.participants ?? []).map((p) => ({
    business: p.businessName,
    committed_kwh: r1(p.committedWh),
    peak_reduction_kwh: r1(p.peakReductionWh),
    alt_window_increase_kwh: r1(p.reboundWh),
    verified_kwh: r1(p.verifiedWh),
    attainment_pct: p.committedWh ? Math.round((p.verifiedWh / p.committedWh) * 1000) / 10 : 0,
    limited_by: p.limitedBy,
    data_completeness_pct: p.coveragePct,
  }));

  let cum = 0;
  const rewardRows = (run?.participants ?? []).map((p) => {
    cum += p.rewardMinor;
    return {
      business: p.businessName,
      verified_reward_usd: usd(p.rewardMinor),
      verified_kwh: r1(p.verifiedWh),
      cost_per_verified_kwh: p.verifiedWh ? Math.round((p.rewardMinor / (p.verifiedWh / 1000)) ) / 100 : null,
      cumulative_usd: usd(cum),
      budget_used_pct: Math.round((cum / ev.budgetMinor) * 1000) / 10,
    };
  });

  const payoutRows = (batch?.items ?? []).map((i) => ({
    business: i.businessName,
    amount_usd: usd(i.amountMinor),
    item_status: i.status,
    batch_status: batch!.status,
    paypal_batch_id: batch!.paypalBatchId,
    provider: batch!.provider,
  }));

  const exclusionRows = [...latestByOrg.values()]
    .filter((c) => !c.selected)
    .map((c) => ({ business: c.businessName, reason_code: c.reasonCode, hard_safety_block: c.hard, eligible: c.eligible, reason: c.reason }));

  return {
    demand_curve: { name: "demand_curve", title: "Demand response curve", description: "Aggregate baseline vs event energy per 15-minute interval for participating sites (simulated meter data).", rows: demandRows, fields: [{ key: "time", label: "Interval" }, { key: "baseline_kwh", label: "Baseline", unit: "kWh" }, { key: "actual_kwh", label: "Event", unit: "kWh" }] },
    allocation: { name: "allocation", title: "Flexibility allocation", description: "Available vs allocated energy per business from the deterministic optimiser.", rows: allocationRows, fields: [{ key: "business", label: "Business" }, { key: "available_kwh", label: "Available", unit: "kWh" }, { key: "allocated_kwh", label: "Allocated", unit: "kWh" }, { key: "rate_usd_per_kwh", label: "Rate", unit: "USD/kWh" }, { key: "estimated_reward_usd", label: "Est. reward", unit: "USD" }] },
    verification: { name: "verification", title: "Verification performance", description: "Committed vs verified energy per participant (min of peak reduction and alternate-window increase, capped at commitment).", rows: verificationRows, fields: [{ key: "business", label: "Business" }, { key: "committed_kwh", label: "Committed", unit: "kWh" }, { key: "verified_kwh", label: "Verified", unit: "kWh" }, { key: "peak_reduction_kwh", label: "Peak reduction", unit: "kWh" }, { key: "alt_window_increase_kwh", label: "Alternate-window increase", unit: "kWh" }, { key: "attainment_pct", label: "Commitment attainment", unit: "%" }, { key: "data_completeness_pct", label: "Meter data completeness", unit: "%" }] },
    reward_economics: { name: "reward_economics", title: "Reward economics", description: "Verified reward per participant and cumulative budget usage.", rows: rewardRows, fields: [{ key: "business", label: "Business" }, { key: "verified_reward_usd", label: "Verified reward", unit: "USD" }, { key: "cost_per_verified_kwh", label: "Cost per verified kWh", unit: "USD/kWh" }, { key: "cumulative_usd", label: "Cumulative", unit: "USD" }] },
    payout_status: { name: "payout_status", title: "Payout reconciliation", description: "Recipient-level PayPal item status (batch status shown separately).", rows: payoutRows, fields: [{ key: "business", label: "Business" }, { key: "amount_usd", label: "Amount", unit: "USD" }, { key: "item_status", label: "Item status" }] },
    exclusions: { name: "exclusions", title: "Safety & eligibility exclusions", description: "Businesses not selected, with deterministic reason codes.", rows: exclusionRows, fields: [{ key: "business", label: "Business" }, { key: "reason_code", label: "Reason code" }, { key: "hard_safety_block", label: "Hard block" }, { key: "reason", label: "Reason" }] },
  };
}

// ---- Widget spec used by both the hand-built widgets and the Analyst agent ----
export interface WidgetSpec {
  id: string;
  kind: "bar" | "line" | "area" | "table" | "kpi" | "donut";
  title: string;
  subtitle?: string;
  dataset: DatasetName;
  x?: string;
  series: { key: string; label: string }[];
  stacked?: boolean;
  unit?: "kWh" | "USD" | "%" | "USD/kWh";
  createdBy: "peakshift" | "analyst";
  prompt?: string;
}
