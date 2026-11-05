import { Badge } from "./ui";
import type { EarningState } from "@/lib/business-view";

export const EARNING: Record<EarningState, { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger"; hint: string }> = {
  AWAITING: { label: "Awaiting verification", tone: "neutral", hint: "Committed but not yet measured." },
  VERIFIED: { label: "Verified reward", tone: "info", hint: "Calculation passed verification; payout not yet submitted." },
  PROCESSING: { label: "Payout processing", tone: "info", hint: "Submitted to PayPal, awaiting confirmation for your payment." },
  PAID: { label: "Paid", tone: "success", hint: "PayPal confirms your payout succeeded." },
  ATTENTION: { label: "Needs attention", tone: "warning", hint: "Held, unclaimed, failed or returned. Check your PayPal account or contact the programme." },
};

export function EarningBadge({ state }: { state: EarningState }) {
  const m = EARNING[state];
  return (
    <Badge tone={m.tone} title={m.hint} pulse={state === "PROCESSING"}>
      {m.label}
    </Badge>
  );
}
