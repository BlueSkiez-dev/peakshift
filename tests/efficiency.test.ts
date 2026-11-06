// participantEfficiency projection: unit conversion, eligibility, zero-energy exclusion,
// aggregation and the weighted event average (never a mean of rates).
import { test } from "node:test";
import assert from "node:assert/strict";
import "./setup-env";
import { buildParticipantEfficiency, type EfficiencyPayoutInput, type EfficiencyVerificationInput } from "../lib/efficiency";
import * as store from "../lib/store";
import * as svc from "../lib/services";
import { buildStudioData } from "../lib/analytics-contract";
import type { User } from "../lib/types";

process.env.PEAKSHIFT_PAYPAL = "simulator";
const E = "evt_test";
const name = (id: string) => ({ a: "Alpha", b: "Bravo", c: "Charlie", d: "Delta" })[id] ?? id;
const pay = (businessId: string, amountMinor: number, payoutStatus = "SUCCEEDED", eventId = E): EfficiencyPayoutInput => ({ eventId, businessId, amountMinor, payoutStatus });
const ver = (businessId: string, verifiedShiftWh: number, eventId = E): EfficiencyVerificationInput => ({ eventId, businessId, verifiedShiftWh });

test("unit conversion: minor → USD, Wh → kWh, USD ÷ kWh", () => {
  const [r] = buildParticipantEfficiency(E, [pay("a", 192)], [ver("a", 4800)], name);
  assert.equal(r.paidAmountMinor, 192);
  assert.equal(r.paidAmountUsd, 1.92);
  assert.equal(r.verifiedEnergyWh, 4800);
  assert.equal(r.verifiedEnergyKwh, 4.8);
  assert.equal(r.costPerVerifiedKwhUsd, 0.4);
  assert.equal(r.businessName, "Alpha");
  assert.equal(r.participantEfficiencyId, `${E}:a`);
  assert.equal(r.payoutStatus, "SUCCEEDED");
});

test("zero or missing verified energy is excluded (no division by zero)", () => {
  const rows = buildParticipantEfficiency(E, [pay("a", 192), pay("b", 230), pay("c", 100)], [ver("a", 4800), ver("b", 0)], name);
  assert.deepEqual(rows.map((r) => r.businessId), ["a"]);
  assert.ok(rows.every((r) => Number.isFinite(r.costPerVerifiedKwhUsd)));
});

test("payment eligibility: only confirmed SUCCEEDED items count; other statuses and events are ignored", () => {
  for (const status of ["PENDING", "PROCESSING", "SUBMITTED", "UNCLAIMED", "HELD", "FAILED", "RETURNED", "UNKNOWN"]) {
    assert.deepEqual(buildParticipantEfficiency(E, [pay("a", 192, status)], [ver("a", 4800)], name), [], `${status} is not paid`);
  }
  const rows = buildParticipantEfficiency(E, [pay("a", 192), pay("b", 230, "UNCLAIMED"), pay("c", 324, "SUCCEEDED", "other_event")], [ver("a", 4800), ver("b", 4600), ver("c", 5400)], name);
  assert.deepEqual(rows.map((r) => r.businessId), ["a"]);
  // Zero / negative amounts are never "paid".
  assert.deepEqual(buildParticipantEfficiency(E, [pay("a", 0)], [ver("a", 4800)], name), []);
});

test("aggregation: several confirmed items for one business are summed", () => {
  const [r] = buildParticipantEfficiency(E, [pay("a", 100), pay("a", 92), pay("a", 50, "FAILED")], [ver("a", 4800)], name);
  assert.equal(r.paidAmountMinor, 192);
  assert.equal(r.costPerVerifiedKwhUsd, 0.4);
});

test("weighted average = Σ paid ÷ Σ verified kWh, not the mean of rates; sorted lowest first", () => {
  const rows = buildParticipantEfficiency(E, [pay("c", 324), pay("a", 192), pay("b", 230)], [ver("a", 4800), ver("b", 4600), ver("c", 5400)], name);
  assert.deepEqual(rows.map((r) => [r.businessId, r.costPerVerifiedKwhUsd]), [["a", 0.4], ["b", 0.5], ["c", 0.6]]);
  const mean = rows.reduce((a, r) => a + r.costPerVerifiedKwhUsd, 0) / rows.length; // 0.50
  const weighted = 7.46 / 14.8; // 0.50405…
  assert.equal(rows[0].eventWeightedAverageCostPerVerifiedKwhUsd, Math.round(weighted * 10_000) / 10_000);
  assert.equal(rows[0].eventWeightedAverageCostPerVerifiedKwhUsd, 0.5041);
  assert.notEqual(rows[0].eventWeightedAverageCostPerVerifiedKwhUsd, mean);
  assert.ok(rows.every((r) => r.eventWeightedAverageCostPerVerifiedKwhUsd === rows[0].eventWeightedAverageCostPerVerifiedKwhUsd));
  // Excluded businesses do not distort the average.
  const partial = buildParticipantEfficiency(E, [pay("a", 192), pay("b", 230, "PENDING")], [ver("a", 4800), ver("b", 4600)], name);
  assert.equal(partial[0].eventWeightedAverageCostPerVerifiedKwhUsd, 0.4);
});

test("projection never mutates its inputs", () => {
  const p = [pay("a", 192)];
  const v = [ver("a", 4800)];
  const before = JSON.stringify([p, v]);
  buildParticipantEfficiency(E, p, v, name);
  assert.equal(JSON.stringify([p, v]), before);
});

// ---- integration with the event-scoped Studio endpoint
const operator: User = { id: "usr_operator", email: "o@x", displayName: "Op", role: "operator", orgId: "org_lagoon" };
const business: User = { id: "usr_cleartank", email: "b@x", displayName: "Biz", role: "business", orgId: "org_cleartank" };
const D = "evt_wed_peak";

test("studio data: participantEfficiency appears only after PayPal items are confirmed, with PK, relationships and no PII", async () => {
  await store.resetState();
  const o = await svc.fundCreateOrder(operator, D);
  await svc.fundCapture(operator, D, o.orderId);
  const plan = await svc.runOptimise(operator, D);
  await svc.publishOffers(operator, D, plan.id);
  for (const id of ["org_cleartank", "org_freshfold", "org_riverside"]) {
    const off = store.read().offers.find((x) => x.orgId === id && x.status === "ACTION_REQUIRED")!;
    await svc.respondOffer({ ...business, orgId: id }, off.id, "accept");
  }
  await svc.executeDemo(operator, D);
  await svc.verifyEvent(operator, D);
  const st = await svc.createSettlement(operator, D);
  await svc.approveSettlement(operator, st.id, st.reviewHash);
  const b = await svc.submitPayouts(operator, st.id);

  const eff = () => buildStudioData(store.read(), store.read().events.find((e) => e.id === D)!).sources.find((x) => x.id === "participantEfficiency")!;
  assert.equal(eff().data.length, 0, "submitted (not yet confirmed) items are not counted as paid");

  const payoutsBefore = JSON.stringify(store.read().batches);
  const versBefore = JSON.stringify(store.read().verifications);
  await store.mutate((s) => {
    s.batches.find((x) => x.id === b.id)!.wallClockSubmittedAt = new Date(Date.now() - 10_000).toISOString();
  });
  await svc.refreshPayout(operator, b.id);
  await svc.refreshPayout(operator, b.id);
  const src = eff();
  assert.equal(src.primaryKeyField, "participantEfficiencyId");
  assert.deepEqual(src.data.map((r) => [r.businessName, r.costPerVerifiedKwhUsd]), [["ClearTank Water Services", 0.4], ["FreshFold Laundry", 0.5], ["Riverside Bakery", 0.6]]);
  assert.ok(src.data.every((r) => r.eventWeightedAverageCostPerVerifiedKwhUsd === 0.5041));
  assert.equal(src.data.reduce((a, r) => a + Number(r.paidAmountMinor), 0), 746);
  assert.equal(src.data.reduce((a, r) => a + Number(r.verifiedEnergyWh), 0), 14800);
  // Read-only: building the projection did not change payout or verification records (beyond the refresh itself).
  assert.equal(JSON.stringify(store.read().verifications), versBefore);
  assert.notEqual(JSON.stringify(store.read().batches), payoutsBefore); // the refresh changed them, not the projection
  const again = JSON.stringify(store.read().batches);
  eff();
  assert.equal(JSON.stringify(store.read().batches), again);

  const full = buildStudioData(store.read(), store.read().events.find((e) => e.id === D)!);
  const rels = full.relationships.filter((r) => r.source.startsWith("participantEfficiency."));
  assert.deepEqual(rels.map((r) => `${r.source}->${r.target}`), ["participantEfficiency.eventId->events.eventId", "participantEfficiency.businessId->businesses.businessId"]);
  const fieldIds = src.fields.map((x) => x.id);
  for (const k of ["eventId", "businessId", "businessName", "paidAmountMinor", "paidAmountUsd", "verifiedEnergyWh", "verifiedEnergyKwh", "costPerVerifiedKwhUsd", "eventWeightedAverageCostPerVerifiedKwhUsd", "payoutStatus"]) assert.ok(fieldIds.includes(k), `field ${k}`);
  assert.equal(src.fields.find((x) => x.id === "costPerVerifiedKwhUsd")!.format, "decimalFormat");
  const json = JSON.stringify(src);
  assert.ok(!/@/.test(json) && !/paypal(Batch|Item)Id/i.test(json), "no recipient emails or PayPal identifiers");
  assert.equal(full.dataMode, "SIMULATED");
});
