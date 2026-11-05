// One shared status-mapping layer (Experience spec §9). Every screen uses these labels.
import type { BatchStatus, EventStatus, ItemStatus, OfferStatus, FundingStatus } from "./types";

export type Tone = "neutral" | "info" | "signal" | "success" | "warning" | "danger";

export interface StatusMeta {
  label: string;
  tone: Tone;
  hint: string;
}

export const EVENT_STATUS: Record<EventStatus, StatusMeta> = {
  DRAFT: { label: "Draft", tone: "neutral", hint: "Event is being prepared; no offers are active." },
  AWAITING_FUNDING: { label: "Awaiting funding", tone: "warning", hint: "Funding has not been confirmed." },
  FUNDED: { label: "Budget funded", tone: "info", hint: "Reward budget captured to the operator's PayPal account (not escrow)." },
  PLAN_READY: { label: "Ready to publish", tone: "info", hint: "Allocation is calculated and awaits operator review." },
  OFFERS_SENT: { label: "Offers sent", tone: "info", hint: "Offers are available to participants; acceptance is pending." },
  READY_TO_EXECUTE: { label: "Ready to execute", tone: "signal", hint: "Accepted commitment meets the target." },
  IN_PROGRESS: { label: "In progress", tone: "info", hint: "Demo event replay is underway." },
  VERIFIED: { label: "Verified", tone: "success", hint: "Sufficient data and calculation checks passed." },
  VERIFY_BLOCKED: { label: "Verification blocked", tone: "danger", hint: "Data coverage is below the threshold; settlement is blocked." },
  SETTLEMENT_REVIEW: { label: "Awaiting settlement approval", tone: "warning", hint: "Operator must review and approve recipient rewards." },
  PAYOUT_PROCESSING: { label: "Rewards processing", tone: "info", hint: "PayPal accepted the batch; recipient items may still be processing." },
  PAID: { label: "Rewards paid", tone: "success", hint: "Every included recipient item is PayPal-confirmed as paid." },
  NEEDS_ATTENTION: { label: "Settlement needs attention", tone: "danger", hint: "Some items are held, unclaimed, failed or returned." },
  CANCELLED: { label: "Cancelled", tone: "neutral", hint: "Event is no longer active." },
};

export const OFFER_STATUS: Record<OfferStatus, StatusMeta> = {
  ACTION_REQUIRED: { label: "Action required", tone: "warning", hint: "Review the offer and accept or decline." },
  ACCEPTED: { label: "Accepted", tone: "success", hint: "You committed to this shift." },
  DECLINED: { label: "Declined", tone: "neutral", hint: "No commitment was created." },
  EXPIRED: { label: "Expired", tone: "neutral", hint: "The response deadline passed." },
  CANCELLED: { label: "Cancelled", tone: "neutral", hint: "The operator cancelled this offer." },
  SUPERSEDED: { label: "Superseded", tone: "neutral", hint: "A newer plan replaced this offer." },
};

export const FUNDING_STATUS: Record<FundingStatus, StatusMeta> = {
  NOT_FUNDED: { label: "Not funded", tone: "warning", hint: "No PayPal capture recorded." },
  ORDER_CREATED: { label: "Order created", tone: "info", hint: "Awaiting payer approval in PayPal." },
  PAYER_APPROVED: { label: "Payer approved", tone: "info", hint: "Capturing on the server." },
  CAPTURE_PENDING: { label: "Capture pending", tone: "warning", hint: "PayPal has not completed the capture." },
  FUNDED: { label: "Budget funded", tone: "success", hint: "Capture verified by the server. Funds sit in the operator's PayPal account — not escrow." },
  FUNDING_CANCELLED: { label: "Funding cancelled", tone: "neutral", hint: "Payer cancelled. Event remains unfunded." },
  FUNDING_FAILED: { label: "Funding failed", tone: "danger", hint: "Capture failed. Event remains unfunded." },
};

export const BATCH_STATUS: Record<BatchStatus, StatusMeta> = {
  DRAFT: { label: "Draft", tone: "neutral", hint: "Not yet submitted." },
  SUBMITTING: { label: "Submitting", tone: "info", hint: "Sending to PayPal." },
  PENDING: { label: "Submitted", tone: "info", hint: "PayPal acknowledged the batch." },
  PROCESSING: { label: "Processing", tone: "info", hint: "PayPal is processing recipient items." },
  SUCCESS: { label: "Batch processed", tone: "success", hint: "PayPal finished processing the batch. Each recipient item carries its own paid / not-paid status." },
  DENIED: { label: "Denied", tone: "danger", hint: "PayPal did not process this batch." },
  FAILED: { label: "Needs attention", tone: "danger", hint: "Batch failed." },
  UNKNOWN: { label: "Awaiting confirmation", tone: "warning", hint: "Outcome unknown; reconciling with the same sender batch ID." },
};

export const ITEM_STATUS: Record<ItemStatus, StatusMeta> = {
  READY: { label: "Ready", tone: "neutral", hint: "Approved, not yet submitted." },
  SUBMITTED: { label: "Submitted", tone: "info", hint: "Sent to PayPal." },
  PENDING: { label: "Processing", tone: "info", hint: "PayPal has not confirmed this recipient yet." },
  PROCESSING: { label: "Processing", tone: "info", hint: "PayPal has not confirmed this recipient yet." },
  SUCCEEDED: { label: "Paid", tone: "success", hint: "PayPal reports this recipient's payout as successful." },
  FAILED: { label: "Failed", tone: "danger", hint: "PayPal could not complete this payout." },
  HELD: { label: "Held", tone: "warning", hint: "PayPal is holding this payout for review." },
  BLOCKED: { label: "Blocked", tone: "danger", hint: "PayPal blocked this payout." },
  UNCLAIMED: { label: "Unclaimed", tone: "warning", hint: "Recipient has not claimed the payout yet." },
  RETURNED: { label: "Returned", tone: "danger", hint: "Payout returned to sender." },
  REFUNDED: { label: "Refunded", tone: "neutral", hint: "Payout refunded." },
  CANCELLED: { label: "Cancelled", tone: "neutral", hint: "Payout cancelled." },
  UNKNOWN: { label: "Awaiting confirmation", tone: "warning", hint: "Outcome unknown." },
};

export const ITEM_FINAL_OK: ItemStatus[] = ["SUCCEEDED"];
export const ITEM_EXCEPTION: ItemStatus[] = ["FAILED", "HELD", "BLOCKED", "UNCLAIMED", "RETURNED", "REFUNDED", "CANCELLED"];
export const ITEM_IN_FLIGHT: ItemStatus[] = ["READY", "SUBMITTED", "PENDING", "PROCESSING", "UNKNOWN"];

/** The 7 visible pipeline stages for an event. */
export const PIPELINE = [
  { key: "fund", label: "Fund", statuses: ["DRAFT", "AWAITING_FUNDING"] },
  { key: "plan", label: "Plan", statuses: ["FUNDED", "PLAN_READY"] },
  { key: "offers", label: "Offers", statuses: ["OFFERS_SENT"] },
  { key: "execute", label: "Execute", statuses: ["READY_TO_EXECUTE", "IN_PROGRESS"] },
  { key: "verify", label: "Verify", statuses: ["VERIFIED", "VERIFY_BLOCKED"] },
  { key: "settle", label: "Settle", statuses: ["SETTLEMENT_REVIEW"] },
  { key: "paid", label: "Payouts", statuses: ["PAYOUT_PROCESSING", "PAID", "NEEDS_ATTENTION"] },
] as const;

export function pipelineIndex(status: EventStatus) {
  const idx = PIPELINE.findIndex((s) => (s.statuses as readonly string[]).includes(status));
  return status === "PAID" ? PIPELINE.length : idx;
}
