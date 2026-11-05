// Deterministic measurement & verification (PRD §10.5). Conservative demo heuristic — not certified M&V.
import type { DemandEvent, MeterDataset, ParticipantVerification } from "./types";
import { windowIdx } from "./meter";
import { rewardMinor } from "./optimiser";

export const FORMULA_VERSION = "mv-min-peak-rebound-v1";
export const BASELINE_METHOD = "SYNTHETIC_COMPARABLE_INTERVALS_V1";

function sumWindow(ds: MeterDataset, idx: number[]) {
  let sum = 0;
  let received = 0;
  for (const i of idx) {
    const r = ds.readings[i];
    if (r && r.wh != null && r.wh >= 0) {
      sum += r.wh;
      received++;
    }
  }
  return { sum, received };
}

export function verifyParticipant(args: {
  event: Pick<DemandEvent, "peak" | "shift">;
  orgId: string;
  businessName: string;
  committedWh: number;
  rateMinorPerKwh: number;
  baseline: MeterDataset;
  actual: MeterDataset;
  minCoveragePct: number;
}): ParticipantVerification {
  const peak = windowIdx(args.event.peak);
  const shift = windowIdx(args.event.shift);
  const bp = sumWindow(args.baseline, peak);
  const ap = sumWindow(args.actual, peak);
  const bs = sumWindow(args.baseline, shift);
  const as = sumWindow(args.actual, shift);

  const expected = (peak.length + shift.length) * 2;
  const received = bp.received + ap.received + bs.received + as.received;
  const coveragePct = Math.round((received / expected) * 1000) / 10;

  const peakReductionWh = Math.max(0, bp.sum - ap.sum);
  const reboundWh = Math.max(0, as.sum - bs.sum);
  const verifiedWh = Math.max(0, Math.min(args.committedWh, peakReductionWh, reboundWh));
  const limitedBy =
    verifiedWh === args.committedWh ? "commitment" : verifiedWh === reboundWh ? "rebound" : "peak_reduction";
  const insufficient = coveragePct < args.minCoveragePct;

  return {
    orgId: args.orgId,
    businessName: args.businessName,
    committedWh: args.committedWh,
    baselinePeakWh: bp.sum,
    actualPeakWh: ap.sum,
    peakReductionWh,
    baselineShiftWh: bs.sum,
    actualShiftWh: as.sum,
    reboundWh,
    verifiedWh: insufficient ? 0 : verifiedWh,
    limitedBy,
    coveragePct,
    expectedIntervals: expected,
    receivedIntervals: received,
    status: insufficient ? "INSUFFICIENT_DATA" : "VERIFIED",
    rateMinorPerKwh: args.rateMinorPerKwh,
    rewardMinor: insufficient ? 0 : rewardMinor(verifiedWh, args.rateMinorPerKwh),
  };
}
