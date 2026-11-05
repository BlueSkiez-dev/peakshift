// Deterministic lowest-cost allocation (PRD §10). The LLM never touches this.
import type { BusinessProfile, CandidateDecision, DemandEvent, Organisation, TimeWindow } from "./types";
import { toIdx } from "./windows";

export const OPTIMISER_VERSION = "lowest-cost-linear-v1";
/** Minimum overlap between a business window and the event's alternate window. */
export const MIN_OVERLAP_MINUTES = 60;

export function overlapMinutes(a: TimeWindow, b: TimeWindow) {
  const s = Math.max(toIdx(a.start), toIdx(b.start));
  const e = Math.min(toIdx(a.end), toIdx(b.end));
  return Math.max(0, e - s) * 15;
}

export function intersect(a: TimeWindow, b: TimeWindow): TimeWindow {
  return { start: a.start > b.start ? a.start : b.start, end: a.end < b.end ? a.end : b.end };
}

/** reward_minor = round_half_up(wh × rate / 1000), integer arithmetic only. */
export function rewardMinor(wh: number, rateMinorPerKwh: number) {
  const num = wh * rateMinorPerKwh;
  return Math.floor((num + 500) / 1000);
}

export interface OptimiseInput {
  event: Pick<DemandEvent, "id" | "targetWh" | "budgetMinor" | "shift" | "minDataQuality" | "currency">;
  orgs: Organisation[];
  profiles: BusinessProfile[]; // latest profile per org
}

export interface OptimiseResult {
  feasible: boolean;
  plannedWh: number;
  estCostMinor: number;
  shortfallWh: number;
  eligibleCapacityWh: number;
  minBudgetRequiredMinor: number | null;
  infeasibleReason: string | null;
  candidates: CandidateDecision[];
}

export function optimise({ event, orgs, profiles }: OptimiseInput): OptimiseResult {
  const decisions: CandidateDecision[] = [];
  const eligible: CandidateDecision[] = [];

  for (const org of orgs.filter((o) => o.type === "participant")) {
    const prof = profiles.find((p) => p.orgId === org.id);
    const base = {
      orgId: org.id,
      businessName: org.name,
      eligible: false,
      selected: false,
      hard: false,
      allocatedWh: 0,
      estRewardMinor: 0,
      dataQuality: prof?.dataQuality ?? 0,
      profileVersion: prof?.version ?? 0,
    };
    if (!prof || prof.status !== "confirmed") {
      decisions.push({ ...base, activityId: null, activityName: "—", reasonCode: "PROFILE_UNCONFIRMED", reason: "Profile is not confirmed by the business, so it cannot be dispatched.", capacityWh: 0, rateMinorPerKwh: null, window: null });
      continue;
    }
    if (org.status !== "active") {
      decisions.push({ ...base, activityId: null, activityName: "—", reasonCode: "SUSPENDED", reason: "Business is suspended.", capacityWh: 0, rateMinorPerKwh: null, window: null });
      continue;
    }
    // Gate 2: critical activities are hard-excluded before any cost logic.
    const nonCritical = prof.activities.filter((a) => !a.isCritical);
    if (nonCritical.length === 0) {
      const a = prof.activities[0];
      decisions.push({ ...base, hard: true, activityId: a?.id ?? null, activityName: a?.name ?? "—", reasonCode: "HARD_SAFETY_CRITICAL_LOAD", reason: `${a?.name ?? "Activity"} is a critical load that must never be interrupted — excluded.`, capacityWh: 0, rateMinorPerKwh: null, window: null });
      continue;
    }
    // Use the business's best (lowest-rate) non-critical activity for this single-window MVP.
    const a = [...nonCritical].sort((x, y) => (x.rateMinorPerKwh ?? 1e9) - (y.rateMinorPerKwh ?? 1e9))[0];
    const d = { ...base, activityId: a.id, activityName: a.name, capacityWh: a.maxShiftWh ?? 0, rateMinorPerKwh: a.rateMinorPerKwh, window: a.window };
    if (!a.maxShiftWh || a.maxShiftWh <= 0) {
      decisions.push({ ...d, reasonCode: "CAPACITY_UNCONFIRMED", reason: "Maximum shiftable energy is not confirmed by the business." });
      continue;
    }
    if (a.rateMinorPerKwh == null || a.currency !== event.currency) {
      decisions.push({ ...d, reasonCode: "RATE_MISSING", reason: "Minimum reward rate is missing or in a different currency." });
      continue;
    }
    if (!a.window || overlapMinutes(a.window, event.shift) < MIN_OVERLAP_MINUTES) {
      decisions.push({ ...d, reasonCode: "WINDOW_MISMATCH", reason: `Available window ${a.window ? `${a.window.start}–${a.window.end}` : "(none)"} has under ${MIN_OVERLAP_MINUTES} min inside the ${event.shift.start}–${event.shift.end} alternate window.` });
      continue;
    }
    if (prof.dataQuality < event.minDataQuality) {
      decisions.push({ ...d, reasonCode: "INSUFFICIENT_DATA", reason: `Meter data quality ${prof.dataQuality}% is below the ${event.minDataQuality}% threshold.` });
      continue;
    }
    const e = { ...d, eligible: true, window: intersect(a.window, event.shift), reasonCode: "NOT_NEEDED_TARGET_MET" as const, reason: "" };
    eligible.push(e);
  }

  // Sort: rate asc → data quality desc → capacity desc → stable org id.
  eligible.sort(
    (x, y) =>
      (x.rateMinorPerKwh ?? 0) - (y.rateMinorPerKwh ?? 0) ||
      y.dataQuality - x.dataQuality ||
      y.capacityWh - x.capacityWh ||
      x.orgId.localeCompare(y.orgId),
  );

  let remaining = event.targetWh;
  let cost = 0;
  let rank = 0;
  for (const c of eligible) {
    if (remaining <= 0) {
      c.reason = `Eligible at ${fmtRate(c.rateMinorPerKwh!)}, but lower-cost offers already cover the commitment target.`;
      continue;
    }
    const alloc = Math.min(c.capacityWh, remaining);
    c.allocatedWh = alloc;
    c.estRewardMinor = rewardMinor(alloc, c.rateMinorPerKwh!);
    c.selected = true;
    remaining -= alloc;
    cost += c.estRewardMinor;
    rank++;
    if (rank === 1) {
      c.reasonCode = "SELECTED_LOWEST_RATE";
      c.reason = `Lowest eligible rate (${fmtRate(c.rateMinorPerKwh!)}); confirmed window ${c.window!.start}–${c.window!.end}.`;
    } else if (remaining <= 0) {
      c.reasonCode = "SELECTED_TO_COMPLETE_TARGET";
      c.reason = `Required to complete the target at the next-lowest rate (${fmtRate(c.rateMinorPerKwh!)}).`;
    } else {
      c.reasonCode = "SELECTED_LOWEST_RATE";
      c.reason = `Next-lowest eligible rate (${fmtRate(c.rateMinorPerKwh!)}); window and capacity fit.`;
    }
  }

  const eligibleCapacityWh = eligible.reduce((s, c) => s + c.capacityWh, 0);
  const plannedWh = event.targetWh - Math.max(0, remaining);
  let feasible = true;
  let infeasibleReason: string | null = null;
  let minBudget: number | null = null;
  if (remaining > 0) {
    feasible = false;
    infeasibleReason = `Only ${(eligibleCapacityWh / 1000).toFixed(1)} kWh of confirmed eligible flexibility exists — ${(remaining / 1000).toFixed(1)} kWh below the ${(event.targetWh / 1000).toFixed(1)} kWh target.`;
  } else if (cost > event.budgetMinor) {
    feasible = false;
    minBudget = cost;
    infeasibleReason = `The lowest-cost eligible plan costs ${fmtMoney(cost)}, which exceeds the ${fmtMoney(event.budgetMinor)} budget.`;
  }
  if (!feasible) eligible.forEach((c) => (c.selected = false));

  const all = [...eligible, ...decisions];
  return {
    feasible,
    plannedWh,
    estCostMinor: cost,
    shortfallWh: Math.max(0, remaining),
    eligibleCapacityWh,
    minBudgetRequiredMinor: minBudget,
    infeasibleReason,
    candidates: all,
  };
}

const fmtRate = (m: number) => `$${(m / 100).toFixed(2)}/kWh`;
const fmtMoney = (m: number) => `$${(m / 100).toFixed(2)}`;
