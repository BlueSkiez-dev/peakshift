// "Start a fresh run": operators may reset the shared demo, but never over another judge's active run.
import { test } from "node:test";
import assert from "node:assert/strict";
import "./setup-env";
import * as store from "../lib/store";
import * as svc from "../lib/services";
import { RESET_IDLE_MINUTES, resetEligibility } from "../lib/demo-reset";
import type { User } from "../lib/types";

process.env.PEAKSHIFT_PAYPAL = "simulator";
const operator: User = { id: "usr_operator", email: "o@x", displayName: "Op", role: "operator", orgId: "org_lagoon" };
const business: User = { id: "usr_cleartank", email: "b@x", displayName: "Biz", role: "business", orgId: "org_cleartank" };
const D = "evt_wed_peak";
const ev = () => store.read().events.find((e) => e.id === D)!;
const minutes = (n: number) => n * 60_000;
const idleBy = async (ms: number) => store.mutate((s) => { s.lastActivityAt = new Date(Date.now() - ms).toISOString(); });

async function fullRun() {
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
  await store.mutate((s) => { s.batches.find((x) => x.id === b.id)!.wallClockSubmittedAt = new Date(Date.now() - 10_000).toISOString(); });
  await svc.refreshPayout(operator, b.id);
  await svc.refreshPayout(operator, b.id);
}

test("seeded, unfunded event: reset is allowed", async () => {
  await store.resetState();
  assert.equal(ev().status, "AWAITING_FUNDING");
  assert.equal(resetEligibility(store.read()).allowed, true);
});

test("checkout in progress: refused while recent, allowed once idle", async () => {
  await store.resetState();
  await svc.fundCreateOrder(operator, D);
  assert.equal(ev().funding.status, "ORDER_CREATED");
  const r = resetEligibility(store.read());
  assert.equal(r.allowed, false);
  assert.match(r.reason, /Checkout is in progress/);
  assert.ok(r.retryAfterSec! > 0 && r.retryAfterSec! <= RESET_IDLE_MINUTES * 60);
  await assert.rejects(svc.startFreshRun(operator), (e: { status?: number; code?: string }) => e.code === "RUN_IN_PROGRESS");
  assert.equal(ev().funding.status, "ORDER_CREATED", "refused reset changes nothing");

  await idleBy(minutes(RESET_IDLE_MINUTES) + 1000);
  assert.equal(resetEligibility(store.read()).allowed, true, "an abandoned checkout does not block forever");
});

test("mid-run (offers sent): refused while active", async () => {
  await store.resetState();
  const o = await svc.fundCreateOrder(operator, D);
  await svc.fundCapture(operator, D, o.orderId);
  const plan = await svc.runOptimise(operator, D);
  await svc.publishOffers(operator, D, plan.id);
  assert.equal(resetEligibility(store.read()).allowed, false);
  await idleBy(minutes(RESET_IDLE_MINUTES - 1));
  assert.equal(resetEligibility(store.read()).allowed, false, "still inside the idle window");
  await idleBy(minutes(RESET_IDLE_MINUTES));
  assert.equal(resetEligibility(store.read()).allowed, true);
});

test("completed (PAID) run: an operator can start a fresh run immediately, and it is audited", async () => {
  await store.resetState();
  await fullRun();
  assert.equal(ev().status, "PAID");
  assert.equal(resetEligibility(store.read()).allowed, true);
  await svc.startFreshRun(operator);
  const s = store.read();
  assert.equal(ev().status, "AWAITING_FUNDING");
  assert.equal(ev().funding.status, "NOT_FUNDED");
  assert.equal(s.batches.length, 0);
  const a = s.audit[0];
  assert.equal(a.action, "demo.reset");
  assert.equal(a.actorId, "usr_operator");
  assert.match(a.summary, /Previous run \(PAID/);
  assert.equal(resetEligibility(s).allowed, true, "a fresh seeded event can be reset again");
});

test("business users cannot start a fresh run", async () => {
  await store.resetState();
  await assert.rejects(svc.startFreshRun(business), (e: { code?: string }) => e.code === "FORBIDDEN");
});
