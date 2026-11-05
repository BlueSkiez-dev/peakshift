import type { AppState, BusinessProfile, DemandEvent, FlexActivity, Organisation, User } from "./types";

export const SEED_VERSION = "peakshift-seed-v2";
export const TZ = "Africa/Lagos";
export const OPERATOR_ORG = "org_lagoon";
export const DEMO_EVENT_ID = "evt_wed_peak";
/** The demo replays a completed historical event: Wednesday 4 November 2026, Lagos time. */
export const DEMO_EVENT_DATE = "2026-11-04";
/** Scenario timeline anchors (UTC). Lagos is UTC+1. */
export const SEED_TIMES = {
  seeded: "2026-11-03T08:00:00.000Z", // 09:00 WAT, day before
  profilesCreated: "2026-11-03T09:58:00.000Z",
  profilesConfirmed: "2026-11-03T10:00:00.000Z",
  eventCreated: "2026-11-03T12:00:00.000Z", // 13:00 WAT
  clockStart: "2026-11-03T12:30:00.000Z", // 13:30 WAT — operator about to fund
} as const;

/** Synthetic delivery behaviour used by the deterministic meter generator (basis points of commitment). */
export const DELIVERY_PROFILE: Record<string, { peakBp: number; reboundBp: number; baseKw: number[] }> = {
  // baseKw: hourly typical demand (kW) used to shape the synthetic baseline, 24 values
  org_riverside: { peakBp: 9334, reboundBp: 9000, baseKw: [1.2, 1.1, 1.1, 1.3, 3.8, 5.6, 6.2, 5.4, 4.6, 3.9, 3.6, 3.4, 3.3, 3.2, 3.1, 3.2, 3.6, 4.1, 4.8, 4.9, 4.2, 2.8, 1.8, 1.4] },
  org_freshfold: { peakBp: 9200, reboundBp: 9200, baseKw: [0.6, 0.5, 0.5, 0.5, 0.6, 0.9, 2.1, 3.4, 4.1, 4.3, 4.2, 4.0, 3.6, 3.5, 3.4, 3.6, 3.9, 4.4, 4.6, 4.5, 4.0, 2.6, 1.1, 0.8] },
  org_cleartank: { peakBp: 10000, reboundBp: 9600, baseKw: [1.6, 1.5, 1.5, 1.5, 1.7, 2.2, 3.0, 3.4, 3.2, 3.0, 2.8, 2.6, 2.4, 2.4, 2.5, 2.7, 3.1, 3.6, 4.2, 4.3, 3.9, 3.0, 2.2, 1.8] },
  org_glow: { peakBp: 9500, reboundBp: 9500, baseKw: [0.2, 0.2, 0.2, 0.2, 0.2, 0.3, 0.6, 1.2, 1.9, 2.2, 2.3, 2.2, 2.0, 2.1, 2.2, 2.3, 2.4, 2.6, 2.5, 2.2, 1.4, 0.6, 0.3, 0.2] },
  org_harbour: { peakBp: 9700, reboundBp: 9700, baseKw: [1.8, 1.7, 1.6, 1.6, 1.8, 2.4, 3.2, 3.6, 3.3, 2.9, 2.6, 2.5, 2.5, 2.6, 2.7, 2.8, 3.0, 3.4, 3.9, 4.1, 3.8, 3.2, 2.6, 2.1] },
  org_northcool: { peakBp: 0, reboundBp: 0, baseKw: [5.1, 5.0, 5.0, 4.9, 5.0, 5.2, 5.5, 5.8, 6.1, 6.4, 6.7, 6.9, 7.1, 7.2, 7.2, 7.1, 6.9, 6.8, 6.6, 6.4, 6.1, 5.8, 5.5, 5.3] },
};

function act(a: Partial<FlexActivity> & Pick<FlexActivity, "id" | "name" | "equipmentCategory">): FlexActivity {
  return {
    isCritical: false,
    maxShiftWh: null,
    rateMinorPerKwh: null,
    currency: "USD",
    window: null,
    mustCompleteBy: null,
    constraints: [],
    ...a,
  };
}

export const BUSINESS_SEED: {
  org: Organisation;
  owner: { id: string; name: string; email: string };
  freeText: string;
  activities: FlexActivity[];
  notice: number;
}[] = [
  {
    org: { id: "org_riverside", name: "Riverside Bakery", type: "participant", category: "Bakery", siteLabel: "Marina Road site", timezone: TZ, payoutEmail: "riverside.bakery@peakshift-demo.example", status: "active" },
    owner: { id: "usr_riverside", name: "Celine Schaumer", email: "celine@riverside.demo" },
    freeText:
      "We can run the afternoon dough mixing and prep batch any time between noon and 5 p.m. instead of the evening — about 6 kWh. Ovens for the morning bake can't move. We'd want at least 60 cents per kWh and a day's notice.",
    activities: [
      act({ id: "act_riverside_mixer", name: "Dough mixer / preparation batch", equipmentCategory: "food_prep", maxShiftWh: 6000, rateMinorPerKwh: 60, window: { start: "12:00", end: "17:00" }, mustCompleteBy: "17:00", constraints: ["Morning bake ovens stay on their normal schedule"] }),
    ],
    notice: 24,
  },
  {
    org: { id: "org_freshfold", name: "FreshFold Laundry", type: "participant", category: "Laundry", siteLabel: "Allen Avenue site", timezone: TZ, payoutEmail: "freshfold.laundry@peakshift-demo.example", status: "active" },
    owner: { id: "usr_freshfold", name: "Piers Wagner", email: "piers@freshfold.demo" },
    freeText:
      "Our big washing and drying batch normally runs in the evening. We can move up to 5 kWh of it into the early afternoon as long as it's done by 5 p.m. for pickups. 50 cents per kWh is fine.",
    activities: [
      act({ id: "act_freshfold_wash", name: "Washing and drying batch", equipmentCategory: "laundry", maxShiftWh: 5000, rateMinorPerKwh: 50, window: { start: "12:00", end: "17:00" }, mustCompleteBy: "17:00", constraints: ["Customer pickups must be ready by 5 p.m."] }),
    ],
    notice: 12,
  },
  {
    org: { id: "org_cleartank", name: "ClearTank Water Services", type: "participant", category: "Water services", siteLabel: "Ikoyi reservoir", timezone: TZ, payoutEmail: "cleartank.water@peakshift-demo.example", status: "active" },
    owner: { id: "usr_cleartank", name: "Nina Nguyen", email: "nina@cleartank.demo" },
    freeText:
      "The refill pump can run any time after lunch, but it has to finish before the evening rush. We have enough tank capacity to wait — up to 5 kWh of pumping. Keep the reserve above the 40% safety floor. 40 cents per kWh.",
    activities: [
      act({ id: "act_cleartank_pump", name: "Non-critical reservoir refill pumping", equipmentCategory: "water_pump", maxShiftWh: 5000, rateMinorPerKwh: 40, window: { start: "12:00", end: "16:00" }, mustCompleteBy: "17:00", constraints: ["Tank reserve stays above the 40% safety floor"] }),
    ],
    notice: 4,
  },
  {
    org: { id: "org_glow", name: "Glow Studio Salon", type: "participant", category: "Salon", siteLabel: "Lekki Phase 1", timezone: TZ, payoutEmail: "glow.studio@peakshift-demo.example", status: "active" },
    owner: { id: "usr_glow", name: "Adaeze Nwosu", email: "adaeze@glow.demo" },
    freeText:
      "We can pre-heat water and run the towel steamers early, between 7 and 11 in the morning, before appointments start. About 2 kWh. Afternoons are fully booked so nothing can move then. 75 cents per kWh.",
    activities: [
      act({ id: "act_glow_heat", name: "Water heating / towel steamers", equipmentCategory: "water_heating", maxShiftWh: 2000, rateMinorPerKwh: 75, window: { start: "07:00", end: "11:00" }, constraints: ["Shift must not overlap customer appointments"] }),
    ],
    notice: 24,
  },
  {
    org: { id: "org_harbour", name: "Harbour View Inn", type: "participant", category: "Hospitality", siteLabel: "Victoria Island", timezone: TZ, payoutEmail: "harbour.view@peakshift-demo.example", status: "active" },
    owner: { id: "usr_harbour", name: "Kemi Lawal", email: "kemi@harbourview.demo" },
    freeText:
      "Guest laundry and topping up the hot-water cylinders could happen between 1 and 5 p.m. — around 3 kWh — as long as we keep enough hot water for evening check-ins. 80 cents per kWh.",
    activities: [
      act({ id: "act_harbour_laundry", name: "Laundry / water heating", equipmentCategory: "water_heating", maxShiftWh: 3000, rateMinorPerKwh: 80, window: { start: "13:00", end: "17:00" }, constraints: ["Keep sufficient hot-water reserve for evening check-ins"] }),
    ],
    notice: 12,
  },
  {
    org: { id: "org_northcool", name: "NorthCool Storage", type: "participant", category: "Cold storage", siteLabel: "Apapa cold store", timezone: TZ, payoutEmail: "northcool.storage@peakshift-demo.example", status: "active" },
    owner: { id: "usr_northcool", name: "Ibrahim Musa", email: "ibrahim@northcool.demo" },
    freeText:
      "Our cold rooms hold frozen fish and vaccines for clinics. Refrigeration runs 24/7 and must never be interrupted. We don't have anything else that uses much power.",
    activities: [
      act({ id: "act_northcool_cold", name: "Cold-room refrigeration", equipmentCategory: "refrigeration", isCritical: true, maxShiftWh: 0, rateMinorPerKwh: null, window: null, constraints: ["Refrigeration must never be interrupted"] }),
    ],
    notice: 0,
  },
];

export function buildSeed(): AppState {
  const t = SEED_TIMES.eventCreated;
  const operatorOrg: Organisation = { id: OPERATOR_ORG, name: "Lagoon Flex Programme", type: "operator", timezone: TZ, status: "active" };
  const users: User[] = [
    { id: "usr_operator", email: "operator@peakshift.demo", displayName: "Lenin Briggs", role: "operator", orgId: OPERATOR_ORG },
    { id: "usr_admin", email: "admin@peakshift.demo", displayName: "Demo Admin", role: "admin", orgId: OPERATOR_ORG },
    ...BUSINESS_SEED.map((b) => ({ id: b.owner.id, email: b.owner.email, displayName: b.owner.name, role: "business" as const, orgId: b.org.id })),
  ];
  const profiles: BusinessProfile[] = BUSINESS_SEED.map((b) => ({
    id: `prof_${b.org.id}_v1`,
    orgId: b.org.id,
    version: 1,
    status: "confirmed",
    freeText: b.freeText,
    draft: null,
    activities: b.activities,
    minimumNoticeHours: b.notice,
    dataQuality: 100,
    confirmedAt: SEED_TIMES.profilesConfirmed,
    confirmedBy: b.owner.id,
    createdAt: SEED_TIMES.profilesCreated,
  }));

  const event: DemandEvent = {
    id: DEMO_EVENT_ID,
    name: "Wednesday evening peak — Lagoon feeder 3",
    eventDate: DEMO_EVENT_DATE,
    timezone: TZ,
    peak: { start: "18:00", end: "20:00" },
    shift: { start: "12:00", end: "17:00" },
    targetKw: 8,
    targetWh: 16000,
    budgetMinor: 1200,
    currency: "USD",
    minDataQuality: 90,
    notes: "Feeder 3 forecast to exceed rating during the evening ramp.",
    status: "AWAITING_FUNDING",
    aiProposedFields: [],
    funding: { provider: "paypal", orderId: null, captureId: null, amountMinor: 1200, currency: "USD", status: "NOT_FUNDED", capturedAt: null, history: [{ status: "NOT_FUNDED", at: t }] },
    activePlanId: null,
    verificationRunId: null,
    settlementId: null,
    executedAt: null,
    createdAt: t,
    createdBy: "usr_operator",
  };

  return {
    seedVersion: SEED_VERSION,
    users,
    orgs: [operatorOrg, ...BUSINESS_SEED.map((b) => b.org)],
    profiles,
    events: [event],
    plans: [],
    offers: [],
    datasets: [],
    verifications: [],
    settlements: [],
    batches: [],
    webhooks: [],
    clock: SEED_TIMES.clockStart,
    audit: [
      {
        id: "aud_event_created",
        at: t,
        actorId: "usr_operator",
        actorName: "Lenin Briggs",
        role: "operator",
        entityType: "event",
        entityId: DEMO_EVENT_ID,
        action: "event.created",
        summary: "Created “Wednesday evening peak — Lagoon feeder 3” — 16.0 kWh target, $12.00 budget.",
        correlationId: "cor_seed_event",
      },
      {
        id: "aud_seed",
        at: SEED_TIMES.seeded,
        actorId: "system",
        actorName: "System",
        role: "system",
        entityType: "demo",
        entityId: SEED_VERSION,
        action: "demo.seeded",
        summary: "Seed scenario loaded: 1 operator, 6 fictional businesses, 1 peak event.",
        correlationId: "cor_seed",
      },
    ],
    aiRuns: [],
    studioReports: [],
  };
}
