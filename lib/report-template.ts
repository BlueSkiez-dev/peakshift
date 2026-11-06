// Versioned default "Event Performance" report (v1.1 Addendum §5.2, §8.1).
// Loaded when an organisation has no saved report for the event; restorable via "Reset to default".
// Field references use "<sourceId>.<fieldId>" from lib/analytics-contract.ts.

export const REPORT_TEMPLATE_VERSION = "event-performance-v2";
export const PEAKSHIFT_WIDGET_IDS = ["peakshift-flex-capacity", "peakshift-load-shift-evidence", "peakshift-participant-contribution", "peakshift-settlement-pulse", "peakshift-unit-cost"] as const;

const r = (id: string, aggregation?: string) => (aggregation ? { id, aggregation } : { id });
const t = (text: string) => ({ text });
const L = (xTrack: number, yTrack: number, xSpan: number, ySpan: number) => ({ xTrack, yTrack, xSpan, ySpan });

export function defaultEventPerformanceReport() {
  const widgets: Record<string, unknown> = {
    // ---- Top row
    capacity: {
      type: "peakshift-flex-capacity",
      dataMapping: {
        target: [r("events.targetReductionKw", "max")],
        available: [r("events.availableCandidateKw", "max")],
        committed: [r("events.committedKw", "max")],
        verified: [r("events.verifiedKw", "max")],
      },
      format: { title: t("Flexibility capacity vs target"), subtitle: t("Average kW over the peak window") },
    },
    verifiedKpi: { type: "value", dataMapping: { value: [r("verificationResults.verifiedShiftWh", "sum")] }, format: { title: t("Verified shifted energy (Wh)"), style: { label: { enabled: true, text: "Verified shifted energy (Wh)", position: "above" } } } },
    spendKpi: { type: "value", dataMapping: { value: [r("settlementItems.rewardAmountUsd", "sum")] }, format: { title: t("Incentive spend (USD, verified)"), style: { label: { enabled: true, text: "Incentive spend (USD, verified)", position: "above" } } } },
    budgetKpi: { type: "value", dataMapping: { value: [r("events.incentiveBudgetUsd", "max")] }, format: { title: t("Event budget (USD)"), style: { label: { enabled: true, text: "Event budget (USD)", position: "above" } } } },
    // ---- Main row
    evidence: {
      type: "peakshift-load-shift-evidence",
      dataMapping: {
        interval: [r("meterIntervals.intervalLabel")],
        baseline: [r("meterIntervals.baselineWh", "sum")],
        actual: [r("meterIntervals.actualWh", "sum")],
        window: [r("meterIntervals.windowType")],
      },
      format: { title: t("Load shift evidence"), subtitle: t("Baseline vs actual interval energy · simulated meter data") },
    },
    contribution: {
      type: "peakshift-participant-contribution",
      dataMapping: {
        participant: [r("businesses.displayName")],
        verified: [r("verificationResults.verifiedShiftWh", "sum")],
        committed: [r("verificationResults.committedWh", "sum")],
      },
      format: { title: t("Participant contribution"), subtitle: t("Verified vs committed · click to filter") },
    },
    // ---- Bottom row
    efficiency: {
      type: "grid",
      dataMapping: {
        cols: [
          r("businesses.displayName"),
          r("verificationResults.committedWh", "sum"),
          r("verificationResults.verifiedShiftWh", "sum"),
          r("verificationResults.attainmentPct", "max"),
          r("verificationResults.coveragePct", "max"),
          r("verificationResults.rewardPerVerifiedKwhMinor", "max"),
          r("settlementItems.rewardAmountUsd", "sum"),
        ],
      },
      // No grand-total row: a "max" of per-business percentages is not a total. Event totals live in the KPIs.
      format: { title: t("Incentive efficiency"), subtitle: t("Attainment = verified ÷ committed · data completeness = meter intervals received · reward in cents per verified kWh"), style: { columnAutoSize: true, headerRow: { wrapText: true }, grandTotalRow: { enabled: false } } },
    },
    pulse: {
      type: "peakshift-settlement-pulse",
      dataMapping: {
        status: [r("payoutItems.payoutStatus")],
        amount: [r("payoutItems.amountMinor", "sum")],
      },
      format: { title: t("Settlement pulse"), subtitle: t("PayPal item status — batch status tracked separately") },
    },
    // ---- Evidence row
    exclusions: {
      type: "grid",
      dataMapping: { cols: [r("businesses.displayName"), r("eligibility.reasonCode"), r("eligibility.reasonText")] }, // HARD_SAFETY_* codes mark safety blocks
      format: { title: t("Eligibility & exclusions"), subtitle: t("Deterministic optimiser reason codes"), style: { columnAutoSize: true, headerRow: { wrapText: true }, grandTotalRow: { enabled: false } } },
    },
    costPerKwh: {
      type: "bar-chart-grouped", // horizontal bars keep business names readable
      dataMapping: { categoryKey: [r("businesses.displayName")], valueKey: [r("verificationResults.rewardPerVerifiedKwhMinor", "max")] },
      format: { title: t("Incentive cost per verified kWh"), subtitle: t("Minor units (cents) per kWh") },
    },
    businessFilter: { type: "list-filter", dataMapping: { value: [r("businesses.displayName")] }, format: { title: t("Business") } },
    statusFilter: { type: "list-filter", dataMapping: { value: [r("verificationResults.verificationStatus")] }, format: { title: t("Verification status") } },
  };
  // 24-track grid. No overlaps: each row's spans sum to 24 and rows stack on yTrack.
  const widgetLayout = {
    // Row 1 — headline numbers
    capacity: L(0, 0, 9, 9),
    verifiedKpi: L(9, 0, 5, 9),
    spendKpi: L(14, 0, 5, 9),
    budgetKpi: L(19, 0, 5, 9),
    // Row 2 — load-shift evidence gets the full width
    evidence: L(0, 9, 24, 16),
    // Row 3 — who delivered, what was paid, cost per kWh
    contribution: L(0, 25, 8, 14),
    pulse: L(8, 25, 7, 14),
    costPerKwh: L(15, 25, 9, 14),
    // Row 4 — full-width efficiency table so every column is visible
    efficiency: L(0, 39, 24, 11),
    // Row 5 — full-width eligibility evidence (reason text needs the room)
    exclusions: L(0, 50, 24, 17),
    // Row 6 — quick filters
    businessFilter: L(0, 67, 12, 11),
    statusFilter: L(12, 67, 12, 11),
  };
  return {
    pages: [{ id: "event-performance", widgets, widgetLayout }],
    selectedPageId: "event-performance",
    // Judge-facing default: opens in View mode with every side panel (incl. the AI Assistant) collapsed.
    panels: { filters: { collapsed: true }, data: { collapsed: true }, edit: { collapsed: true }, ai: { collapsed: true } },
  };
}

/** Validate a stored report against the current widget registry (Addendum §8.3.6). */
export function validateReportState(state: unknown, knownTypes: Set<string>): { ok: true } | { ok: false; reason: string } {
  if (!state || typeof state !== "object") return { ok: false, reason: "Report state is empty." };
  const st = state as { pages?: { id?: string; widgets?: Record<string, { type?: string }> }[]; selectedPageId?: string };
  if (!Array.isArray(st.pages) || !st.pages.length) return { ok: false, reason: "Report has no pages." };
  for (const p of st.pages) {
    for (const [id, w] of Object.entries(p.widgets ?? {})) {
      if (!w?.type) return { ok: false, reason: `Widget ${id} has no type.` };
      if (w.type.startsWith("peakshift-") && !knownTypes.has(w.type)) return { ok: false, reason: `Unknown PeakShift widget type “${w.type}”.` };
    }
  }
  return { ok: true };
}
