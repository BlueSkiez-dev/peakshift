// Business-scoped view models. Never includes another participant's data, budgets or emails.
import type { AppState, Offer } from "./types";
import { latestProfile } from "./services";

export type EarningState = "AWAITING" | "VERIFIED" | "PROCESSING" | "PAID" | "ATTENTION";

export function earningsFor(s: AppState, orgId: string) {
  return s.offers
    .filter((o) => o.orgId === orgId && o.status === "ACCEPTED")
    .map((o) => {
      const ev = s.events.find((e) => e.id === o.eventId)!;
      const run = s.verifications.find((v) => v.id === ev.verificationRunId);
      const p = run?.participants.find((x) => x.orgId === orgId);
      const batch = s.batches.find((b) => b.eventId === ev.id);
      const item = batch?.items.find((i) => i.orgId === orgId);
      let state: EarningState = "AWAITING";
      if (item) state = item.status === "SUCCEEDED" ? "PAID" : ["FAILED", "HELD", "BLOCKED", "UNCLAIMED", "RETURNED", "REFUNDED", "CANCELLED"].includes(item.status) ? "ATTENTION" : "PROCESSING";
      else if (p) state = "VERIFIED";
      return {
        offerId: o.id,
        eventName: ev.name,
        eventDate: ev.eventDate,
        activity: o.activityName,
        committedWh: o.allocatedWh,
        potentialMinor: o.maxRewardMinor,
        verifiedWh: p?.verifiedWh ?? null,
        rewardMinor: p?.rewardMinor ?? null,
        limitedBy: p?.limitedBy ?? null,
        state,
        itemStatus: item?.status ?? null,
        reference: item?.transactionId ?? item?.paypalItemId ?? null,
        batchRef: batch?.paypalBatchId ?? null,
        provider: batch?.provider ?? null,
        updatedAt: item?.updatedAt ?? null,
      };
    });
}

/** True for a profile confirmed in the last 2 minutes — drives the post-save receipt after a refresh. */
export function recentlyConfirmed(p: { confirmedAt: string | null } | null | undefined, now: number = Date.now()) {
  return !!p?.confirmedAt && now - new Date(p.confirmedAt).getTime() < 120_000;
}

/** Display-only: an unanswered offer past its deadline shows as EXPIRED (the server enforces it on respond). */
export function withEffectiveStatus(o: Offer, now: number = Date.now()): Offer {
  return o.status === "ACTION_REQUIRED" && new Date(o.expiresAt).getTime() < now ? { ...o, status: "EXPIRED" } : o;
}

export function offerView(s: AppState, o: Offer) {
  const ev = s.events.find((e) => e.id === o.eventId)!;
  const prof = s.profiles.find((p) => p.orgId === o.orgId && p.version === o.profileVersion) ?? latestProfile(s, o.orgId);
  const act = prof?.activities.find((a) => a.id === o.activityId);
  const critical = prof?.activities.filter((a) => a.isCritical) ?? [];
  return {
    offer: o,
    event: { name: ev.name, date: ev.eventDate, peak: ev.peak, shift: ev.shift, status: ev.status },
    constraints: act?.constraints ?? [],
    mustCompleteBy: act?.mustCompleteBy ?? null,
    critical: critical.map((c) => c.name),
  };
}
