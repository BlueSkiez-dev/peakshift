// Judge-readiness guarantees: coherent scenario chronology, commitment vs delivery never conflated,
// percentages reconcile, webhook rejections are recorded without changing payment state.
import { test } from "node:test";
import assert from "node:assert/strict";
import "./setup-env";
import * as store from "../lib/store";
import * as svc from "../lib/services";
import { buildStudioData } from "../lib/analytics-contract";
import { localIso } from "../lib/clock";
import { attainmentPct } from "../lib/terms";
import type { User } from "../lib/types";

process.env.PEAKSHIFT_PAYPAL = "simulator";
const operator: User = { id: "usr_operator", email: "o@x", displayName: "Op", role: "operator", orgId: "org_lagoon" };
const business: User = { id: "usr_cleartank", email: "b@x", displayName: "Biz", role: "business", orgId: "org_cleartank" };
const E = "evt_wed_peak";

async function runToPaid() {
  await store.resetState();
  const o = await svc.fundCreateOrder(operator, E);
  await svc.fundCapture(operator, E, o.orderId);
  const plan = await svc.runOptimise(operator, E);
  await svc.publishOffers(operator, E, plan.id);
  for (const id of ["org_cleartank", "org_freshfold", "org_riverside"]) {
    const off = store.read().offers.find((x) => x.orgId === id && x.status === "ACTION_REQUIRED")!;
    await svc.respondOffer({ ...business, orgId: id }, off.id, "accept");
  }
  await svc.executeDemo(operator, E);
  await svc.verifyEvent(operator, E);
  const st = await svc.createSettlement(operator, E);
  await svc.approveSettlement(operator, st.id, st.reviewHash);
  const b = await svc.submitPayouts(operator, st.id);
  // The simulator paces itself on wall-clock time; backdate the real submission so it completes now.
  await store.mutate((s) => {
    s.batches.find((x) => x.id === b.id)!.wallClockSubmittedAt = new Date(Date.now() - 10_000).toISOString();
  });
  await svc.refreshPayout(operator, b.id);
  await svc.refreshPayout(operator, b.id);
  return b.id;
}

test("demo event is a completed historical event: Wednesday 4 Nov 2026", async () => {
  await store.resetState();
  const ev = store.read().events[0];
  assert.equal(ev.id, E);
  assert.equal(ev.eventDate, "2026-11-04");
  assert.match(ev.name, /^Wednesday evening peak/);
});

test("scenario chronology: funding and planning before the peak, payouts after verification", async () => {
  const batchId = await runToPaid();
  const s = store.read();
  const ev = s.events.find((e) => e.id === E)!;
  const peakStart = localIso(ev.eventDate, ev.peak.start);
  const peakEnd = localIso(ev.eventDate, ev.peak.end);
  const plan = s.plans.find((p) => p.id === ev.activePlanId)!;
  const offers = s.offers.filter((o) => o.eventId === E && o.status === "ACCEPTED");
  const run = s.verifications.find((v) => v.id === ev.verificationRunId)!;
  const st = s.settlements.find((x) => x.id === ev.settlementId)!;
  const b = s.batches.find((x) => x.id === batchId)!;

  const ordered: [string, string][] = [
    ["funded", ev.funding.capturedAt!],
    ["plan", plan.createdAt],
    ["offers", plan.publishedAt!],
    ...offers.map((o): [string, string] => [`accept ${o.orgId}`, o.respondedAt!]),
    ["peak start", peakStart],
    ["peak end", peakEnd],
    ["meter import", ev.executedAt!],
    ["verification", run.createdAt],
    ["settlement", st.createdAt],
    ["approval", st.approvedAt!],
    ["payout submitted", b.submittedAt!],
    ...b.items.map((i): [string, string] => [`paid ${i.orgId}`, i.history.at(-1)!.at]),
  ];
  for (let k = 1; k < ordered.length; k++) assert.ok(ordered[k - 1][1] <= ordered[k][1], `${ordered[k - 1][0]} (${ordered[k - 1][1]}) must precede ${ordered[k][0]} (${ordered[k][1]})`);
  for (const o of offers) assert.ok(o.respondedAt! < o.expiresAt, "offers are answered before they expire");

  // Audit log is chronological (stored newest-first) and never later than the scenario clock.
  const at = s.audit.map((a) => a.at);
  for (let k = 1; k < at.length; k++) assert.ok(at[k - 1] >= at[k], `audit out of order at ${k}`);
  assert.ok(at[0] <= s.clock!);
  // Meter intervals sit on the event day itself.
  const meter = buildStudioData(s, ev).sources.find((x) => x.id === "meterIntervals")!.data as { intervalStartUtc: string }[];
  assert.ok(meter.every((r) => r.intervalStartUtc.startsWith("2026-11-03T23") || r.intervalStartUtc.startsWith("2026-11-04")));
  // Every payment record follows the event.
  assert.ok(b.items.every((i) => i.history.every((h) => h.at >= peakEnd)));
  assert.ok(s.webhooks.every((w) => w.receivedAt >= peakEnd));
});

test("commitment vs delivery: 16.0 committed, 14.8 verified, 92.5%, 1.2 kWh shortfall; percentages reconcile", async () => {
  await runToPaid();
  const s = store.read();
  const ev = s.events.find((e) => e.id === E)!;
  const run = s.verifications.find((v) => v.id === ev.verificationRunId)!;
  assert.equal(run.totals.committedWh, 16000);
  assert.equal(run.totals.verifiedWh, 14800);
  assert.equal(run.totals.deliveryPct, 92.5);
  assert.equal(run.totals.committedWh - run.totals.verifiedWh, 1200);
  assert.equal(attainmentPct(run.totals.verifiedWh, run.totals.committedWh), run.totals.deliveryPct);
  // Per participant: verified = min(peak reduction, alternate-window increase) capped at commitment.
  for (const p of run.participants) assert.equal(p.verifiedWh, Math.min(p.peakReductionWh, p.reboundWh, p.committedWh));
  assert.deepEqual(run.participants.map((p) => [p.orgId, attainmentPct(p.verifiedWh, p.committedWh)]), [["org_cleartank", 96], ["org_freshfold", 92], ["org_riverside", 90]]);
  // Meter-data completeness is a separate measure (all intervals present).
  assert.ok(run.participants.every((p) => p.coveragePct === 100));
  // Budget semantics: $12.00 funded, $7.46 rewards, $4.54 unallocated.
  assert.equal(ev.funding.amountMinor - run.totals.rewardMinor, 454);
  // Event reads "Rewards paid" only because every PayPal item succeeded.
  const b = s.batches.find((x) => x.eventId === E)!;
  assert.equal(ev.status, "PAID");
  assert.ok(b.items.every((i) => i.status === "SUCCEEDED"));
  assert.equal(b.items.reduce((a, i) => a + i.amountMinor, 0), 746);
});

test("unsigned webhook is rejected, recorded with its reason, and changes no payment state", async () => {
  await runToPaid();
  const before = JSON.stringify(store.read().batches);
  await assert.rejects(() => svc.handlePayPalWebhook(new Headers(), "{}"), /Signature verification failed/);
  const s = store.read();
  assert.equal(JSON.stringify(s.batches), before);
  const w = s.webhooks[0];
  assert.equal(w.processingStatus, "REJECTED");
  assert.equal(w.eventType, "(no event type)");
  assert.match(w.reason ?? "", /Signature verification failed/);
  assert.equal(s.audit[0].action, "webhook.rejected");
});
