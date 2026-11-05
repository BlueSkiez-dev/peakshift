// Deterministic domain tests: optimiser, M&V, rewards, safety, AI guardrails.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSeed } from "../lib/seed";
import { optimise, rewardMinor, overlapMinutes } from "../lib/optimiser";
import { generateDatasets } from "../lib/meter";
import { verifyParticipant } from "../lib/verification";
import { extractProfile } from "../lib/ai/profile";
import { parseBrief } from "../lib/ai/brief";
import type { BusinessProfile, MeterDataset } from "../lib/types";

delete process.env.ANTHROPIC_API_KEY; // tests exercise the deterministic offline path

const seed = buildSeed();
const ev = seed.events[0];
const input = (over: Partial<typeof ev> = {}, profiles: BusinessProfile[] = seed.profiles) => ({
  event: { id: ev.id, targetWh: ev.targetWh, budgetMinor: ev.budgetMinor, shift: ev.shift, minDataQuality: 90, currency: "USD" as const, ...over },
  orgs: seed.orgs,
  profiles,
});

test("PRD scenario: ClearTank 5 + FreshFold 5 + Riverside 6 = 16 kWh for $8.10", () => {
  const r = optimise(input());
  assert.equal(r.feasible, true);
  const sel = r.candidates.filter((c) => c.selected).map((c) => [c.businessName, c.allocatedWh, c.estRewardMinor]);
  assert.deepEqual(sel, [
    ["ClearTank Water Services", 5000, 200],
    ["FreshFold Laundry", 5000, 250],
    ["Riverside Bakery", 6000, 360],
  ]);
  assert.equal(r.estCostMinor, 810);
  assert.equal(ev.budgetMinor - r.estCostMinor, 390);
});

test("critical load is a hard exclusion, never selected", () => {
  const r = optimise(input());
  const nc = r.candidates.find((c) => c.orgId === "org_northcool")!;
  assert.equal(nc.reasonCode, "HARD_SAFETY_CRITICAL_LOAD");
  assert.equal(nc.hard, true);
  assert.equal(nc.selected, false);
  // even with a huge target and budget it stays excluded
  const big = optimise(input({ targetWh: 100000, budgetMinor: 1e6 }));
  assert.equal(big.candidates.find((c) => c.orgId === "org_northcool")!.selected, false);
});

test("eligible-but-unneeded vs window mismatch are distinguished", () => {
  const r = optimise(input());
  assert.equal(r.candidates.find((c) => c.orgId === "org_harbour")!.reasonCode, "NOT_NEEDED_TARGET_MET");
  assert.equal(r.candidates.find((c) => c.orgId === "org_glow")!.reasonCode, "WINDOW_MISMATCH");
});

test("unconfirmed profile cannot be optimised", () => {
  const profiles = seed.profiles.map((p) => (p.orgId === "org_cleartank" ? { ...p, status: "draft" as const } : p));
  const r = optimise(input({}, profiles));
  assert.equal(r.candidates.find((c) => c.orgId === "org_cleartank")!.reasonCode, "PROFILE_UNCONFIRMED");
});

test("target above eligible capacity is infeasible with shortfall", () => {
  const r = optimise(input({ targetWh: 25000, budgetMinor: 100000 }));
  assert.equal(r.feasible, false);
  assert.equal(r.shortfallWh, 25000 - 19000);
  assert.equal(r.candidates.some((c) => c.selected), false);
});

test("budget below minimum cost is infeasible with minimum budget", () => {
  const r = optimise(input({ budgetMinor: 500 }));
  assert.equal(r.feasible, false);
  assert.equal(r.minBudgetRequiredMinor, 810);
});

test("reward rounds half-up in cents", () => {
  assert.equal(rewardMinor(5000, 50), 250);
  assert.equal(rewardMinor(4800, 40), 192);
  assert.equal(rewardMinor(1, 500), 1); // 0.5¢ → 1¢
  assert.equal(rewardMinor(1, 499), 0);
});

test("window overlap", () => {
  assert.equal(overlapMinutes({ start: "07:00", end: "11:00" }, { start: "12:00", end: "17:00" }), 0);
  assert.equal(overlapMinutes({ start: "13:00", end: "17:00" }, { start: "12:00", end: "17:00" }), 240);
});

function verifyAll() {
  const commits = [
    { orgId: "org_cleartank", committedWh: 5000, window: { start: "12:00", end: "16:00" }, rate: 40 },
    { orgId: "org_freshfold", committedWh: 5000, window: { start: "12:00", end: "17:00" }, rate: 50 },
    { orgId: "org_riverside", committedWh: 6000, window: { start: "12:00", end: "17:00" }, rate: 60 },
  ];
  return commits.map((c) => {
    const [base, act] = generateDatasets(ev, c);
    return verifyParticipant({ event: ev, orgId: c.orgId, businessName: c.orgId, committedWh: c.committedWh, rateMinorPerKwh: c.rate, baseline: base, actual: act, minCoveragePct: 90 });
  });
}

test("M&V: 15.2 kWh peak reduction, 14.8 alternate-window increase, 14.8 verified (92.5%)", () => {
  const ps = verifyAll();
  const sum = (k: "peakReductionWh" | "reboundWh" | "verifiedWh" | "rewardMinor") => ps.reduce((a, p) => a + p[k], 0);
  assert.equal(sum("peakReductionWh"), 15200);
  assert.equal(sum("reboundWh"), 14800);
  assert.equal(sum("verifiedWh"), 14800);
  assert.equal(sum("rewardMinor"), 192 + 230 + 324);
  for (const p of ps) assert.ok(p.verifiedWh <= p.committedWh);
});

test("M&V is deterministic across runs", () => {
  assert.deepEqual(verifyAll(), verifyAll());
});

test("missing intervals block verification below threshold", () => {
  const [base, act] = generateDatasets(ev, { orgId: "org_freshfold", committedWh: 5000, window: { start: "12:00", end: "17:00" } });
  const holed: MeterDataset = { ...act, readings: act.readings.map((r) => (r.i >= 72 && r.i < 78 ? { ...r, wh: null } : r)) };
  const p = verifyParticipant({ event: ev, orgId: "x", businessName: "x", committedWh: 5000, rateMinorPerKwh: 50, baseline: base, actual: holed, minCoveragePct: 90 });
  assert.equal(p.status, "INSUFFICIENT_DATA");
  assert.equal(p.rewardMinor, 0);
  assert.ok(p.coveragePct < 90);
});

test("AI extractor never invents capacity and always flags refrigeration critical", async () => {
  const d = await extractProfile("The pump can run any time after lunch, but it has to finish before the evening rush. Do not interrupt the cold room.");
  const pump = d.activities.find((a) => a.equipmentCategory === "water_pump")!;
  assert.equal(pump.maxShiftWh, null);
  assert.equal(pump.provenance.maxShiftWh, "missing");
  assert.deepEqual(pump.window, { start: "12:00", end: "17:00" });
  const cold = d.activities.find((a) => a.equipmentCategory === "refrigeration")!;
  assert.equal(cold.isCritical, true);
});

test("AI extractor reads stated capacity and rate", async () => {
  const d = await extractProfile(seed.profiles.find((p) => p.orgId === "org_cleartank")!.freeText);
  const pump = d.activities.find((a) => a.equipmentCategory === "water_pump")!;
  assert.equal(pump.maxShiftWh, 5000);
  assert.equal(pump.rateMinorPerKwh, 40);
});

test("event brief parser proposes the demo event", async () => {
  const b = await parseBrief("We need to shift 16 kWh away from the 6 p.m. to 8 p.m. peak on Friday. Businesses can move flexible work between noon and 5 p.m. We have a $12 reward budget.");
  assert.deepEqual(b.peak, { start: "18:00", end: "20:00" });
  assert.deepEqual(b.shift, { start: "12:00", end: "17:00" });
  assert.equal(b.targetKwh, 16);
  assert.equal(b.targetKw, 8);
  assert.equal(b.budgetUsd, 12);
});
