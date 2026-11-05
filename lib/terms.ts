// Shared energy-metric vocabulary so every screen, chart, tool and export says the same thing.
import type { ParticipantVerification } from "./types";

export const VERIFIED_FORMULA = "Verified shifted energy = min(peak reduction, alternate-window increase), capped at the accepted commitment";
export const VERIFIED_FORMULA_SHORT = "min(peak reduction, alternate-window increase), capped at commitment";

export const LIMITED_BY_LABEL: Record<ParticipantVerification["limitedBy"], string> = {
  commitment: "Commitment cap",
  peak_reduction: "Peak reduction",
  rebound: "Alternate-window increase",
};

/** Commitment attainment (verified ÷ committed), one decimal — distinct from meter-data completeness. */
export const attainmentPct = (verifiedWh: number, committedWh: number) => (committedWh ? Math.round((verifiedWh / committedWh) * 1000) / 10 : 0);
