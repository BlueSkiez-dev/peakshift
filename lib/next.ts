import type { EventStatus } from "./types";

export type Stage = "fund" | "plan" | "offers" | "execute" | "verify" | "settle" | "payouts";

export const STAGES: { key: Stage; label: string; desc: string }[] = [
  { key: "fund", label: "Fund", desc: "PayPal Checkout" },
  { key: "plan", label: "Plan", desc: "Lowest-cost allocation" },
  { key: "offers", label: "Offers", desc: "Voluntary acceptance" },
  { key: "execute", label: "Execute", desc: "Meter replay" },
  { key: "verify", label: "Verify", desc: "Peak & alternate window" },
  { key: "settle", label: "Settle", desc: "Human approval" },
  { key: "payouts", label: "Payouts", desc: "PayPal reconciliation" },
];

export function currentStage(s: EventStatus): Stage {
  switch (s) {
    case "DRAFT":
    case "AWAITING_FUNDING":
      return "fund";
    case "FUNDED":
    case "PLAN_READY":
      return "plan";
    case "OFFERS_SENT":
      return "offers";
    case "READY_TO_EXECUTE":
    case "IN_PROGRESS":
      return "execute";
    case "VERIFIED":
    case "VERIFY_BLOCKED":
      return "verify";
    case "SETTLEMENT_REVIEW":
      return "settle";
    default:
      return "payouts";
  }
}

export function stageIndex(s: EventStatus) {
  if (s === "PAID") return STAGES.length;
  return STAGES.findIndex((x) => x.key === currentStage(s));
}

export function nextAction(s: EventStatus, id: string): { label: string; href: string; helper: string } {
  const base = `/operator/events/${id}`;
  switch (s) {
    case "DRAFT":
    case "AWAITING_FUNDING":
      return { label: "Fund event budget", href: `${base}?stage=fund`, helper: "Offers can't be published until funding is captured." };
    case "FUNDED":
      return { label: "Find the lowest-cost plan", href: `${base}?stage=plan`, helper: "Filters for safety and windows, then fills the target by rate." };
    case "PLAN_READY":
      return { label: "Review and publish offers", href: `${base}?stage=plan`, helper: "Businesses must still accept each offer." };
    case "OFFERS_SENT":
      return { label: "Track business responses", href: `${base}?stage=offers`, helper: "The event is ready once accepted commitments meet the target." };
    case "READY_TO_EXECUTE":
      return { label: "Run demo event", href: `${base}?stage=execute`, helper: "Replays the deterministic simulated meter dataset." };
    case "IN_PROGRESS":
      return { label: "Run verification", href: `${base}?stage=execute`, helper: "Checks peak reduction and the alternate-window increase against the baseline." };
    case "VERIFIED":
      return { label: "Review rewards and settlement", href: `${base}?stage=verify`, helper: "Only verified energy is included in the reward calculation." };
    case "VERIFY_BLOCKED":
      return { label: "Review data coverage", href: `${base}?stage=verify`, helper: "Settlement is blocked until coverage passes." };
    case "SETTLEMENT_REVIEW":
      return { label: "Review settlement", href: `${base}?stage=settle`, helper: "The last human checkpoint before money moves." };
    case "PAYOUT_PROCESSING":
      return { label: "Reconcile payouts", href: `/operator/payments`, helper: "Recipient statuses are updating from PayPal." };
    case "NEEDS_ATTENTION":
      return { label: "Resolve payout exceptions", href: `/operator/payments`, helper: "Some recipient items need attention." };
    case "PAID":
      return { label: "View payment reconciliation", href: `/operator/payments`, helper: "Every recipient item is confirmed by PayPal." };
    default:
      return { label: "Open event", href: base, helper: "" };
  }
}
