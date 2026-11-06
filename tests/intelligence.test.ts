// v1.1 Addendum: analytics contract, report persistence, agent tool isolation, AI proxy guardrails.
import { test } from "node:test";
import assert from "node:assert/strict";
import "./setup-env";
import { buildStudioData } from "../lib/analytics-contract";
import { defaultEventPerformanceReport, validateReportState, PEAKSHIFT_WIDGET_IDS } from "../lib/report-template";
import * as store from "../lib/store";
import * as reports from "../lib/reports";
import * as tools from "../lib/agent-tools";
import * as svc from "../lib/services";
import { runStudioTurn } from "../lib/ai/studio-proxy";
import type { User } from "../lib/types";

const operator: User = { id: "usr_operator", email: "o@x", displayName: "Op", role: "operator", orgId: "org_lagoon" };
const business: User = { id: "usr_cleartank", email: "b@x", displayName: "Biz", role: "business", orgId: "org_cleartank" };

async function runFullEvent() {
  await store.resetState();
  const E = "evt_wed_peak";
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
  return E;
}

test("studio bootstrap: 9 related camelCase sources, snapshot metadata, no PII", async () => {
  const E = await runFullEvent();
  const s = store.read();
  const b = buildStudioData(s, s.events.find((e) => e.id === E)!);
  assert.deepEqual(b.sources.map((x) => x.id), ["events", "businesses", "eligibility", "offers", "meterIntervals", "verificationResults", "settlementItems", "payoutItems", "participantEfficiency"]);
  assert.equal(b.relationships.length, 14);
  assert.equal(b.dataMode, "SIMULATED");
  assert.match(b.snapshotId, /^snap_evt_wed_peak_/);
  for (const src of b.sources) {
    for (const row of src.data) {
      assert.ok(src.primaryKeyField in row, `${src.id} rows carry the primary key`);
      for (const k of Object.keys(row)) assert.match(k, /^[a-z][A-Za-z0-9]*$/, `${src.id}.${k} is camelCase`);
    }
  }
  const json = JSON.stringify(b);
  assert.ok(!/@/.test(json), "no email addresses");
  assert.ok(!json.includes("peakshift-demo.example"), "no PayPal recipient identifiers");
  const ver = b.sources.find((x) => x.id === "verificationResults")!.data;
  assert.equal(ver.reduce((a, r) => a + Number(r.verifiedShiftWh), 0), 14800);
  // every relationship references real fields
  for (const r of b.relationships) {
    for (const ref of [r.source, r.target]) {
      const [sid, fid] = ref.split(".");
      assert.ok(b.sources.find((x) => x.id === sid)!.fields.some((f) => f.id === fid), `${ref} exists`);
    }
  }
});

test("default report template only references existing fields and registered widgets", () => {
  const s = store.read();
  const b = buildStudioData(s, s.events[0]);
  const fields = new Set(b.sources.flatMap((x) => x.fields.map((f) => `${x.id}.${f.id}`)));
  const state = defaultEventPerformanceReport();
  assert.ok(validateReportState(state, new Set(PEAKSHIFT_WIDGET_IDS)).ok);
  const refs = JSON.stringify(state).match(/"id":"[a-zA-Z]+\.[a-zA-Z]+"/g)!.map((x) => x.slice(6, -1));
  for (const r of refs) assert.ok(fields.has(r), `template field ${r} exists in contract`);
  assert.equal(validateReportState({ pages: [{ widgets: { a: { type: "peakshift-unknown" } } }] }, new Set(PEAKSHIFT_WIDGET_IDS)).ok, false);
});

test("report persistence: create from template, optimistic concurrency, reset, size/shape validation", async () => {
  const r = await reports.getOrCreateEventReport(operator, "evt_wed_peak");
  assert.equal(r.revision, 1);
  const again = await reports.getOrCreateEventReport(operator, "evt_wed_peak");
  assert.equal(again.id, r.id, "one report per org/event");
  const saved = await reports.saveReport(operator, r.id, { reportState: defaultEventPerformanceReport(), expectedRevision: 1 });
  assert.equal(saved.revision, 2);
  await assert.rejects(reports.saveReport(operator, r.id, { reportState: defaultEventPerformanceReport(), expectedRevision: 1 }), /saved elsewhere/);
  await assert.rejects(reports.saveReport(operator, r.id, { reportState: { nope: 1 }, expectedRevision: 2 }), /not a valid/);
  await assert.rejects(reports.saveReport(operator, r.id, { reportState: { pages: [{ big: "x".repeat(600_000) }] }, expectedRevision: 2 }), /512 KB/);
  await assert.rejects(reports.saveReport(business, r.id, { reportState: defaultEventPerformanceReport(), expectedRevision: 2 }), /not edit/);
  const reset = await reports.resetReport(operator, r.id);
  assert.equal(reset.revision, 3);
  assert.equal(reset.isDefault, true);
});

test("agent tools are read-only, scoped, and explain NorthCool deterministically", async () => {
  const before = JSON.stringify({ ...store.read(), audit: [], aiRuns: [] });
  const ex = tools.explainExclusion(operator, { eventId: "evt_wed_peak", business: "NorthCool Storage" }) as Record<string, unknown>;
  assert.equal(ex.reasonCode, "HARD_SAFETY_CRITICAL_LOAD");
  assert.equal(ex.ruleId, "GATE_2_NON_CRITICAL_ONLY");
  assert.equal(ex.hardSafetyBlock, true);
  assert.equal(ex.overridable, false);
  const vb = tools.verificationBreakdown(operator, { eventId: "evt_wed_peak" }) as { participants: { rewardPerVerifiedKwhMinor: number; displayName: string }[] };
  assert.deepEqual(vb.participants.map((p) => [p.displayName, p.rewardPerVerifiedKwhMinor]).sort(), [["ClearTank Water Services", 40], ["FreshFold Laundry", 50], ["Riverside Bakery", 60]]);
  const ss = tools.settlementSummary(operator, { eventId: "evt_wed_peak" }) as { settlementStatus: string; paidMinor: number };
  assert.equal(ss.settlementStatus, "APPROVED");
  assert.equal(ss.paidMinor, 0, "approved is not paid");
  tools.eventContext(operator, { eventId: "evt_wed_peak" });
  tools.freshness(operator, { eventId: "evt_wed_peak" });
  assert.equal(JSON.stringify({ ...store.read(), audit: [], aiRuns: [] }), before, "tools did not mutate state");
  assert.throws(() => tools.eventContext(business, { eventId: "evt_wed_peak" }), /not found/i, "business users cannot call agent tools");
  assert.throws(() => tools.eventContext(operator, { eventId: "evt_other_org" }), /not found/i);
  assert.throws(() => tools.explainExclusion(operator, { eventId: "evt_wed_peak" }), /VALIDATION|business/i);
});

test("AI proxy refuses without a key and validates request size before any model call", async () => {
  await assert.rejects(runStudioTurn({ input: Array.from({ length: 500 }, () => ({ type: "reasoning" as const })) }, "ctx"), /oversized|Invalid/);
  await assert.rejects(runStudioTurn({ input: [{ type: "message", role: "user", content: [{ type: "text", text: "x".repeat(450_000) }] }] }, "ctx"), /too long/);
});

test("sandbox payout recipients: plain list in dispatch order, explicit map, invalid emails ignored, fallback to seed", async () => {
  const { recipientFor, hasConfiguredRecipient } = await import("../lib/recipients");
  const org = (id: string) => ({ id, payoutEmail: `${id}@seed.example` });
  process.env.PAYPAL_SANDBOX_RECIPIENTS = "a@sb.example.com, b@sb.example.com ,c@sb.example.com";
  assert.equal(recipientFor(org("org_cleartank")), "a@sb.example.com");
  assert.equal(recipientFor(org("org_freshfold")), "b@sb.example.com");
  assert.equal(recipientFor(org("org_riverside")), "c@sb.example.com");
  assert.equal(recipientFor(org("org_northcool")), "org_northcool@seed.example");
  process.env.PAYPAL_SANDBOX_RECIPIENTS = "org_riverside=r@sb.example.com,org_glow=not-an-email";
  assert.equal(recipientFor(org("org_riverside")), "r@sb.example.com");
  assert.equal(recipientFor(org("org_glow")), "org_glow@seed.example");
  assert.equal(hasConfiguredRecipient("org_glow"), false);
  delete process.env.PAYPAL_SANDBOX_RECIPIENTS;
  assert.equal(recipientFor(org("org_cleartank")), "org_cleartank@seed.example");
});
