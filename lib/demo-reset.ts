// "Start a fresh run": who may reset the shared demo, and when.
//
// The deployment is one shared scenario used by every judge. Any operator may restore the seeded
// event, but never while someone else is mid-run: a run in progress is protected until it has been
// idle for RESET_IDLE_MINUTES. A completed (PAID) run, or an untouched seeded event, can be reset at once.
// The platform-admin reset (Settings) is unconditional and unchanged.
import type { AppState, DemandEvent } from "./types";

export const RESET_IDLE_MINUTES = 10;
const IDLE_MS = RESET_IDLE_MINUTES * 60_000;

export interface ResetEligibility {
  allowed: boolean;
  /** Why it is (not) allowed, in plain language for the confirm dialog / error. */
  reason: string;
  /** When refused: seconds until the run counts as idle. */
  retryAfterSec?: number;
}

const IN_FLIGHT_FUNDING = new Set(["ORDER_CREATED", "PAYER_APPROVED", "CAPTURE_PENDING"]);

export function demoEvent(s: AppState): DemandEvent | undefined {
  return s.events.find((e) => e.id === "evt_wed_peak") ?? s.events[0];
}

export function resetEligibility(s: AppState, nowMs = Date.now()): ResetEligibility {
  const ev = demoEvent(s);
  if (!ev) return { allowed: true, reason: "No event exists; the seeded scenario will be restored." };

  const last = s.lastActivityAt ? new Date(s.lastActivityAt).getTime() : 0;
  const idleMs = Number.isFinite(last) ? nowMs - last : Infinity;
  const idle = idleMs >= IDLE_MS;
  const fundingInFlight = IN_FLIGHT_FUNDING.has(ev.funding.status);
  const payoutInFlight = s.batches.some((b) => b.eventId === ev.id && ["SUBMITTING", "PENDING", "PROCESSING"].includes(b.status));

  if (ev.status === "PAID" && !payoutInFlight) return { allowed: true, reason: "The last run is complete (rewards paid)." };
  if (ev.status === "AWAITING_FUNDING" && !fundingInFlight) return { allowed: true, reason: "The event has not been funded yet." };
  if (idle) return { allowed: true, reason: `The current run has been idle for over ${RESET_IDLE_MINUTES} minutes.` };

  const retryAfterSec = Math.max(1, Math.ceil((IDLE_MS - idleMs) / 1000));
  const what = fundingInFlight ? "a PayPal Checkout is in progress" : payoutInFlight ? "PayPal payouts are still processing" : "another run is in progress";
  return {
    allowed: false,
    reason: `Someone may be using the demo right now: ${what}. To protect their run, a fresh run can start once it has been idle for ${RESET_IDLE_MINUTES} minutes (about ${Math.ceil(retryAfterSec / 60)} min from now).`,
    retryAfterSec,
  };
}
