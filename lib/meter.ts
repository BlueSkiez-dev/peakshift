// Deterministic synthetic 15-minute meter data. Same inputs → same readings, every run.
// Every dataset is labelled SIMULATED and shown as "Simulated meter data — hackathon demo".
import type { DemandEvent, MeterDataset, TimeWindow } from "./types";
import { DELIVERY_PROFILE } from "./seed";

export const INTERVALS = 96;
export { toIdx, windowIdx } from "./windows";
import { windowIdx } from "./windows";

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Baseline Wh per 15-minute interval for a site (comparable-day synthetic baseline). */
export function baselineFor(orgId: string): number[] {
  const p = DELIVERY_PROFILE[orgId];
  const r = rng(hash(orgId + ":baseline"));
  return Array.from({ length: INTERVALS }, (_, i) => {
    const h = Math.floor(i / 4);
    const frac = (i % 4) / 4;
    const kwA = p.baseKw[h];
    const kwB = p.baseKw[(h + 1) % 24];
    const kwv = kwA + (kwB - kwA) * frac;
    const jitter = 1 + (r() - 0.5) * 0.06;
    return Math.round(kwv * 250 * jitter); // kW × 0.25 h × 1000 = Wh
  });
}

/** Spread `total` Wh across `idx` intervals with a smooth shape; exact integer sum. */
function spread(total: number, idx: number[], shape: (k: number, n: number) => number): Map<number, number> {
  const n = idx.length;
  const w = idx.map((_, k) => shape(k, n));
  const sw = w.reduce((a, b) => a + b, 0);
  const out = new Map<number, number>();
  let acc = 0;
  idx.forEach((i, k) => {
    const v = Math.floor((total * w[k]) / sw);
    out.set(i, v);
    acc += v;
  });
  // put the remainder on the heaviest interval so the sum is exact
  let best = 0;
  w.forEach((x, k) => (x > w[best] ? (best = k) : null));
  out.set(idx[best], (out.get(idx[best]) ?? 0) + (total - acc));
  return out;
}

const bell = (k: number, n: number) => 0.6 + Math.sin(((k + 0.5) / n) * Math.PI);

export interface Commitment {
  orgId: string;
  committedWh: number;
  window: TimeWindow; // participant's own shift window
}

/**
 * Build the baseline + event datasets for one participant.
 * Event readings = baseline − peak reduction (spread over the peak) + rebound (spread inside the
 * participant's window ∩ the event's alternate window). Outside the windows: baseline ± tiny noise.
 */
export function generateDatasets(event: DemandEvent, c: Commitment): MeterDataset[] {
  const p = DELIVERY_PROFILE[c.orgId];
  const baseline = baselineFor(c.orgId);
  const peakIdx = windowIdx(event.peak);
  const eventShift = new Set(windowIdx(event.shift));
  const ownShift = windowIdx(c.window).filter((i) => eventShift.has(i));
  const reboundIdx = ownShift.length ? ownShift : [...eventShift];

  const peakRed = Math.round((c.committedWh * p.peakBp) / 10000);
  const rebound = Math.round((c.committedWh * p.reboundBp) / 10000);
  const redMap = spread(peakRed, peakIdx, bell);
  const rebMap = spread(rebound, reboundIdx, bell);
  const r = rng(hash(c.orgId + ":" + event.id + ":event"));

  const eventReadings = baseline.map((b, i) => {
    let v = b;
    const noise = r(); // always draw so the sequence is stable
    if (redMap.has(i)) v -= redMap.get(i)!;
    else if (rebMap.has(i)) v += rebMap.get(i)!;
    else if (!eventShift.has(i) && !peakIdx.includes(i)) v = Math.round(b * (1 + (noise - 0.5) * 0.02)); // measured windows stay exact
    return { i, wh: Math.max(0, v) };
  });

  const label = "Simulated meter data — hackathon demo";
  return [
    { id: `mds_${event.id}_${c.orgId}_base`, orgId: c.orgId, eventId: event.id, type: "baseline", source: "SIMULATED", intervalMinutes: 15, label, readings: baseline.map((wh, i) => ({ i, wh })) },
    { id: `mds_${event.id}_${c.orgId}_event`, orgId: c.orgId, eventId: event.id, type: "event", source: "SIMULATED", intervalMinutes: 15, label, readings: eventReadings },
  ];
}
