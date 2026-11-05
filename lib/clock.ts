// Scenario clock. The demo replays a completed historical event, so workflow records are stamped
// from a monotonic clock positioned on the event's own timeline rather than the wall clock:
//   D-1 afternoon  funding → plan → offers → business responses (offers expire D 09:00)
//   D 12:00–20:00  alternate window + peak; meter data covers the event day
//   D evening      meter import → verification → settlement approval → PayPal payouts
// Real PayPal API calls still happen when the operator clicks; their wall-clock times are kept
// alongside (wallClock*) so the record stays honest about when sandbox calls were made.
import type { AppState, DemandEvent } from "./types";

export type Phase = "funding" | "planning" | "offers" | "responses" | "execution" | "verification" | "settlement" | "approval" | "payout";

const LAGOS_OFFSET = "+01:00"; // Africa/Lagos — WAT, no daylight saving

/** Earliest scenario time (event-local) for each workflow phase: [day offset from event date, HH:MM]. */
export const PHASE_ANCHORS: Record<Phase, [number, string]> = {
  funding: [-1, "14:00"],
  planning: [-1, "14:20"],
  offers: [-1, "14:30"],
  responses: [-1, "15:00"],
  execution: [0, "20:05"], // meter data imported after the 18:00–20:00 peak closes
  verification: [0, "20:30"],
  settlement: [0, "20:45"],
  approval: [0, "21:00"],
  payout: [0, "21:10"],
};

/** ISO instant for an event-local date + time, shifted by whole days. */
export function localIso(date: string, hhmm: string, dayOffset = 0): string {
  const d = new Date(`${date}T${hhmm}:00${LAGOS_OFFSET}`);
  d.setUTCDate(d.getUTCDate() + dayOffset);
  return d.toISOString();
}

export function phaseAnchor(ev: Pick<DemandEvent, "eventDate">, phase: Phase): string {
  const [day, hhmm] = PHASE_ANCHORS[phase];
  return localIso(ev.eventDate, hhmm, day);
}

/** Current scenario time (falls back to wall clock for legacy state without a clock). */
export function scenarioNow(s: Pick<AppState, "clock">): string {
  return s.clock ?? new Date().toISOString();
}

export function scenarioNowMs(s: Pick<AppState, "clock">): number {
  return Date.parse(scenarioNow(s));
}

/** Advance the clock by `ms` (never backwards), optionally jumping to `notBefore`. Returns the new time. */
export function advance(s: Pick<AppState, "clock">, ms: number, notBefore?: string): string {
  let t = scenarioNowMs(s) + ms;
  if (notBefore) t = Math.max(t, Date.parse(notBefore));
  s.clock = new Date(t).toISOString();
  return s.clock;
}

/** Stamp a workflow step: one minute after the previous step, and no earlier than the phase anchor. */
export function stampPhase(s: Pick<AppState, "clock">, ev: Pick<DemandEvent, "eventDate">, phase: Phase): string {
  return advance(s, 60_000, phaseAnchor(ev, phase));
}
