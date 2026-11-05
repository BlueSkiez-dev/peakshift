// Server-side view models for pages. Display-only shaping of authoritative state.
import type { AppState, DemandEvent } from "./types";
import { latestProfile } from "./services";
import { overlapMinutes, MIN_OVERLAP_MINUTES } from "./optimiser";
import { baselineFor, windowIdx } from "./meter";

export function activeEvent(s: AppState): DemandEvent | undefined {
  return s.events.find((e) => e.status !== "CANCELLED" && e.status !== "PAID") ?? s.events[0];
}

export type NetStatus = "eligible" | "critical" | "window" | "unconfirmed" | "capacity";
export interface NetworkRow {
  orgId: string;
  name: string;
  category: string;
  site: string;
  profileStatus: "confirmed" | "draft" | "none";
  profileVersion: number;
  activity: string;
  capacityWh: number;
  window: { start: string; end: string } | null;
  rateMinor: number | null;
  status: NetStatus;
  statusLabel: string;
  dataQuality: number;
  updatedAt: string;
  hasDraft: boolean;
  constraints: string[];
  freeText: string;
  notice: number | null;
}

export function networkRows(s: AppState, ev?: DemandEvent): NetworkRow[] {
  return s.orgs
    .filter((o) => o.type === "participant")
    .map((o): NetworkRow => {
      const conf = latestProfile(s, o.id, "confirmed");
      const draft = s.profiles.find((p) => p.orgId === o.id && p.status === "draft");
      const p = conf ?? draft;
      const nonCrit = p?.activities.filter((a) => !a.isCritical) ?? [];
      const a = nonCrit[0] ?? p?.activities[0];
      let status: NetStatus = "eligible";
      if (!conf) status = "unconfirmed";
      else if (!nonCrit.length) status = "critical";
      else if (!a?.maxShiftWh) status = "capacity";
      else if (ev && (!a.window || overlapMinutes(a.window, ev.shift) < MIN_OVERLAP_MINUTES)) status = "window";
      const label = { eligible: "Eligible", critical: "Critical load — excluded from offers", window: "Window mismatch", unconfirmed: "Profile not confirmed", capacity: "Capacity not confirmed" }[status];
      return {
        orgId: o.id,
        name: o.name,
        category: o.category ?? "",
        site: o.siteLabel ?? "",
        profileStatus: conf ? "confirmed" : draft ? "draft" : "none",
        profileVersion: p?.version ?? 0,
        activity: a?.name ?? "—",
        capacityWh: nonCrit.reduce((x, y) => x + (y.maxShiftWh ?? 0), 0),
        window: a && !a.isCritical ? a.window : null,
        rateMinor: a && !a.isCritical ? a.rateMinorPerKwh : null,
        status,
        statusLabel: label,
        dataQuality: p?.dataQuality ?? 0,
        updatedAt: p?.confirmedAt ?? p?.createdAt ?? "",
        hasDraft: !!draft,
        constraints: p?.activities.flatMap((x) => x.constraints) ?? [],
        freeText: p?.freeText ?? "",
        notice: p?.minimumNoticeHours ?? null,
      };
    })
    .sort((x, y) => order(x.status) - order(y.status) || (x.rateMinor ?? 999) - (y.rateMinor ?? 999));
}
const order = (s: NetStatus) => ({ eligible: 0, window: 1, capacity: 2, unconfirmed: 3, critical: 4 })[s];

/** Aggregate curve for the overview: participants' baseline (and event readings once executed). */
export function demandSeries(s: AppState, ev: DemandEvent) {
  const ds = s.datasets.filter((d) => d.eventId === ev.id);
  const accepted = s.offers.filter((o) => o.eventId === ev.id && o.status === "ACCEPTED").map((o) => o.orgId);
  const orgIds = accepted.length ? accepted : s.orgs.filter((o) => o.type === "participant" && o.id !== "org_northcool").map((o) => o.id);
  const baselines = orgIds.map((id) => ds.find((d) => d.orgId === id && d.type === "baseline")?.readings.map((r) => r.wh ?? 0) ?? baselineFor(id));
  const events = orgIds.map((id) => ds.find((d) => d.orgId === id && d.type === "event")?.readings.map((r) => r.wh ?? 0));
  const hasEvent = events.every(Boolean) && ds.length > 0;
  const peak = new Set(windowIdx(ev.peak));
  const shift = new Set(windowIdx(ev.shift));
  return {
    hasEvent,
    participants: orgIds.length,
    rows: Array.from({ length: 96 }, (_, i) => ({
      i,
      t: `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`,
      baseline: baselines.reduce((a, b) => a + b[i], 0) / 1000,
      actual: hasEvent ? events.reduce((a, b) => a + (b as number[])[i], 0) / 1000 : null,
      zone: peak.has(i) ? "peak" : shift.has(i) ? "shift" : "",
    })),
  };
}
