// participantEfficiency — a derived analytics projection (read-only). Built from the event-scoped
// payoutItems and verificationResults read models, joined on eventId + businessId. It never writes
// to payout or verification records.
//
// Rules
//   • Only recipient-level payout items with confirmed status SUCCEEDED count as paid. Batch status
//     is never used to infer payment.
//   • A business is included only if it has a confirmed paid amount AND positive verified energy
//     (no division by zero, no unit cost for undelivered energy).
//   • paidAmountUsd = paidAmountMinor / 100; verifiedEnergyKwh = verifiedEnergyWh / 1000;
//     costPerVerifiedKwhUsd = paidAmountUsd / verifiedEnergyKwh.
//   • eventWeightedAverageCostPerVerifiedKwhUsd = total confirmed paid USD / total verified kWh over
//     the included businesses — NOT the arithmetic mean of the per-business rates.

export interface EfficiencyPayoutInput {
  eventId: string;
  businessId: string;
  amountMinor: number;
  payoutStatus: string;
}
export interface EfficiencyVerificationInput {
  eventId: string;
  businessId: string;
  verifiedShiftWh: number;
}
export interface ParticipantEfficiencyRow {
  [key: string]: string | number;
  participantEfficiencyId: string;
  eventId: string;
  businessId: string;
  businessName: string;
  paidAmountMinor: number;
  paidAmountUsd: number;
  verifiedEnergyWh: number;
  verifiedEnergyKwh: number;
  costPerVerifiedKwhUsd: number;
  eventWeightedAverageCostPerVerifiedKwhUsd: number;
  payoutStatus: "SUCCEEDED";
}

export const PAID_STATUS = "SUCCEEDED";
/** Unit costs keep 4 decimal places (display rounds to 2) so the weighted average is not distorted by rounding. */
const round4 = (x: number) => Math.round(x * 10_000) / 10_000;

export function buildParticipantEfficiency(
  eventId: string,
  payoutItems: EfficiencyPayoutInput[],
  verificationResults: EfficiencyVerificationInput[],
  businessName: (businessId: string) => string,
): ParticipantEfficiencyRow[] {
  // Sum confirmed paid amounts per business (a business could have more than one item).
  const paid = new Map<string, number>();
  for (const p of payoutItems) {
    if (p.eventId !== eventId || p.payoutStatus !== PAID_STATUS || !(p.amountMinor > 0)) continue;
    paid.set(p.businessId, (paid.get(p.businessId) ?? 0) + p.amountMinor);
  }
  const verified = new Map<string, number>();
  for (const v of verificationResults) {
    if (v.eventId !== eventId) continue;
    verified.set(v.businessId, (verified.get(v.businessId) ?? 0) + v.verifiedShiftWh);
  }

  const included = [...paid.entries()]
    .map(([businessId, paidAmountMinor]) => ({ businessId, paidAmountMinor, verifiedEnergyWh: verified.get(businessId) ?? 0 }))
    .filter((r) => r.verifiedEnergyWh > 0);
  if (!included.length) return [];

  const totalPaidUsd = included.reduce((a, r) => a + r.paidAmountMinor, 0) / 100;
  const totalKwh = included.reduce((a, r) => a + r.verifiedEnergyWh, 0) / 1000;
  const weighted = round4(totalPaidUsd / totalKwh);

  return included
    .map((r) => {
      const paidAmountUsd = r.paidAmountMinor / 100;
      const verifiedEnergyKwh = r.verifiedEnergyWh / 1000;
      return {
        participantEfficiencyId: `${eventId}:${r.businessId}`,
        eventId,
        businessId: r.businessId,
        businessName: businessName(r.businessId),
        paidAmountMinor: r.paidAmountMinor,
        paidAmountUsd,
        verifiedEnergyWh: r.verifiedEnergyWh,
        verifiedEnergyKwh,
        costPerVerifiedKwhUsd: round4(paidAmountUsd / verifiedEnergyKwh),
        eventWeightedAverageCostPerVerifiedKwhUsd: weighted,
        payoutStatus: PAID_STATUS,
      } satisfies ParticipantEfficiencyRow;
    })
    .sort((a, b) => a.costPerVerifiedKwhUsd - b.costPerVerifiedKwhUsd || a.businessName.localeCompare(b.businessName));
}
