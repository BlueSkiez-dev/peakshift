"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Landmark, Lock, ShieldCheck, Wallet } from "lucide-react";
import type { DemandEvent, PayoutBatch, Settlement, SettlementItem, VerificationRun } from "@/lib/types";
import { api, ApiError } from "@/lib/client";
import { BATCH_STATUS, ITEM_STATUS } from "@/lib/status";
import { kwh, money, rate, stamp } from "@/lib/format";
import { Badge, Button, Empty, Kpi, KV, Notice, Panel, StatusBadge, cx } from "../ui";
import { Dialog, Drawer, useToast } from "../overlay";

export function SettleStage({ ev, run, settlement, batch }: { ev: DemandEvent; run: VerificationRun | null; settlement: Settlement | null; batch: PayoutBatch | null }) {
  const router = useRouter();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [phase, setPhase] = useState<"idle" | "approving" | "submitting" | "uncertain">("idle");
  const [err, setErr] = useState<string | null>(null);
  const [detail, setDetail] = useState<SettlementItem | null>(null);

  if (!settlement || !run)
    return (
      <Empty title="Settlement opens after verification" action={<Link href={`/operator/events/${ev.id}?stage=verify`} className="rounded-[8px] bg-signal px-4 py-2 text-sm font-semibold text-signal-ink">Go to verification</Link>}>
        Rewards are calculated only from verified shifted energy and the accepted rate.
      </Empty>
    );

  const payable = settlement.items.filter((i) => i.payable);
  const excluded = settlement.items.filter((i) => !i.payable);
  const remaining = ev.funding.amountMinor - settlement.totalMinor;
  const locked = settlement.status !== "DRAFT" || !!batch;

  async function approveAndSend() {
    setErr(null);
    setPhase("approving");
    try {
      await api(`settlements/${settlement!.id}/approve`, { body: { reviewHash: settlement!.reviewHash } });
      setPhase("submitting");
      const b = await api<PayoutBatch>(`settlements/${settlement!.id}/payouts`, { body: {} });
      setConfirm(false);
      if (b.status === "UNKNOWN") {
        setPhase("uncertain");
        toast({ tone: "info", title: "PayPal response is pending confirmation.", detail: "We'll reconcile using the same sender batch ID — no duplicate batch." });
      } else {
        toast({ tone: "success", title: "Payout batch submitted to PayPal.", detail: "Recipient statuses are updating." });
        router.push(`/operator/payments?batch=${b.id}`);
      }
    } catch (e) {
      const ae = e as ApiError;
      if (ae.code === "NETWORK_UNCERTAIN") {
        setPhase("uncertain");
        setConfirm(false);
      } else {
        setErr(ae.message);
        setPhase("idle");
      }
      router.refresh();
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-[14px] border border-line bg-surface px-5 py-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-[18px] font-semibold tracking-[-0.01em]">Review settlement</h2>
            <Badge tone="success">Verified</Badge>
            <span className="inline-flex items-center gap-1.5 rounded-[6px] border border-info/35 bg-info-dim px-2 py-0.5 text-[10.5px] font-semibold tracking-[0.07em] text-info">{ev.funding.provider === "paypal" ? "PAYPAL SANDBOX" : "PAYPAL SIMULATOR"}</span>
          </div>
          <p className="mt-1 text-[13px] text-ink-2">The last human checkpoint before money moves. Amounts are server-calculated from verification run v{run.version} and cannot be edited here.</p>
        </div>
        {!locked ? (
          <Button variant="primary" size="lg" onClick={() => setConfirm(true)} icon={<Wallet className="size-4" />}>
            Approve and send payouts
          </Button>
        ) : (
          <Link href={batch ? `/operator/payments?batch=${batch.id}` : "#"} className="inline-flex h-11 items-center gap-2 rounded-[8px] border border-line-2 px-4 text-sm hover:bg-surface-2">
            {settlement.status === "APPROVED" && !batch ? "Approved — submitting" : "View payout reconciliation"} <ArrowRight className="size-4" />
          </Link>
        )}
      </div>

      {phase === "uncertain" && (
        <Notice tone="warning" title="Awaiting confirmation from PayPal">
          The outcome of the submission is not yet known. Do not resubmit — open Payments and use Refresh status; it reconciles with the existing sender batch ID.
        </Notice>
      )}
      {err && <Notice tone="danger" title={err}>No payout was submitted.</Notice>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Recipients" value={payable.length} sub={excluded.length ? `${excluded.length} excluded` : "No exclusions"} />
        <Kpi label="Verified energy" value={(run.totals.verifiedWh / 1000).toFixed(1)} unit="kWh" sub={`${run.totals.deliveryPct}% delivery of ${kwh(run.totals.committedWh)} committed`} />
        <Kpi label="Total payout" value={money(settlement.totalMinor)} tone="signal" accent sub="USD · verified reward" />
        <Kpi label="Unallocated budget remaining" value={money(remaining)} sub={`of ${money(ev.funding.amountMinor)} budget funded · stays with the operator`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr]">
        <Panel title="Recipients" subtitle="Click an amount to see exactly how it was calculated" bodyClass="!px-0">
          <div className="overflow-x-auto">
            <table className="[&_td.text-right]:whitespace-nowrap [&_th]:whitespace-nowrap w-full min-w-[760px] text-[13px] num">
              <thead>
                <tr className="border-y border-line bg-surface-2/60 text-left text-[12px] text-ink-2">
                  <th className="px-5 py-2.5 font-medium">Business</th>
                  <th className="px-3 py-2.5 font-medium">PayPal recipient</th>
                  <th className="px-3 py-2.5 text-right font-medium">Committed</th>
                  <th className="px-3 py-2.5 text-right font-medium">Verified</th>
                  <th className="px-3 py-2.5 text-right font-medium">Agreed rate</th>
                  <th className="px-3 py-2.5 text-right font-medium">Amount payable</th>
                  <th className="px-5 py-2.5 font-medium">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {payable.map((i) => (
                  <tr key={i.id} className="border-b border-line">
                    <td className="px-5 py-3 font-medium">{i.businessName}</td>
                    <td className="px-3 py-3 font-mono text-[12px] text-ink-2">{i.recipientMasked}</td>
                    <td className="px-3 py-3 text-right text-ink-2">{kwh(i.committedWh)}</td>
                    <td className="px-3 py-3 text-right">{kwh(i.verifiedWh)}</td>
                    <td className="px-3 py-3 text-right">{rate(i.rateMinorPerKwh)}</td>
                    <td className="px-3 py-3 text-right">
                      <button onClick={() => setDetail(i)} className="font-semibold underline decoration-line-2 underline-offset-4 hover:decoration-signal">
                        {money(i.amountMinor)}
                      </button>
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone="success">Verified</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="px-5 py-3 font-semibold" colSpan={5}>
                    Total approved amount
                  </td>
                  <td className="px-3 py-3 text-right text-[15px] font-semibold">{money(settlement.totalMinor)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          {excluded.length > 0 && (
            <div className="mx-5 mt-3 rounded-[10px] border border-line bg-surface-2/50 p-3 text-[12.5px] text-ink-2">
              <b className="text-ink">Exceptions:</b> {excluded.map((e) => `${e.businessName} (${e.evidence === "INSUFFICIENT_DATA" ? "insufficient data" : "zero reward"})`).join(", ")} — not included in this batch.
            </div>
          )}
        </Panel>

        <div className="space-y-4">
          <Panel title="Funding & pre-flight checks">
            <dl className="divide-y divide-line">
              <KV k="Capture reference" v={ev.funding.captureId ?? "—"} mono />
              <KV k="Budget funded (operator's PayPal account, not escrow)" v={money(ev.funding.amountMinor)} />
              <KV k="This settlement" v={money(settlement.totalMinor)} />
              <KV k="Review hash" v={settlement.reviewHash} mono />
            </dl>
            <ul className="mt-3 space-y-1.5 text-[12.5px]">
              {[
                ["Event verified with sufficient data coverage", run.status === "VERIFIED"],
                ["Total within event budget and captured funding", settlement.totalMinor <= ev.budgetMinor && settlement.totalMinor <= ev.funding.amountMinor],
                ["Every amount positive and in cents", payable.every((i) => i.amountMinor > 0)],
                ["No item already submitted", !batch],
              ].map(([k, ok]) => (
                <li key={String(k)} className="flex items-center gap-2">
                  <span className={cx("grid size-4 place-items-center rounded-full text-[9px]", ok ? "bg-success text-bg" : "bg-surface-3 text-ink-3")}>{ok ? "✓" : "–"}</span>
                  <span className={ok ? "text-ink-2" : "text-ink-3"}>{k}</span>
                </li>
              ))}
            </ul>
          </Panel>
          {settlement.approvedAt && (
            <Notice tone="success" title="Settlement approved">
              {stamp(settlement.approvedAt)} · audited
            </Notice>
          )}
        </div>
      </div>

      <Dialog
        open={confirm}
        onClose={() => phase === "idle" && setConfirm(false)}
        title="Confirm payout submission"
        tone="money"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)} disabled={phase !== "idle"}>
              Cancel
            </Button>
            <Button type="button" variant="primary" onClick={approveAndSend} loading={phase !== "idle"} loadingLabel={phase === "approving" ? "Recording approval…" : "Submitting to PayPal…"} icon={<Lock className="size-4" />}>
              Confirm payout submission
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-[13px]">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-[10px] border border-line bg-surface-2/50 p-3">
              <div className="micro">Recipients</div>
              <div className="mt-1 text-[22px] font-semibold num">{payable.length}</div>
            </div>
            <div className="rounded-[10px] border border-signal/30 bg-signal-dim p-3">
              <div className="micro">Total</div>
              <div className="mt-1 text-[22px] font-semibold num">{money(settlement.totalMinor)} USD</div>
            </div>
          </div>
          <ul className="divide-y divide-line rounded-[10px] border border-line">
            {payable.map((i) => (
              <li key={i.id} className="flex justify-between px-3.5 py-2 num">
                <span>
                  {i.businessName} <span className="font-mono text-[11.5px] text-ink-3">{i.recipientMasked}</span>
                </span>
                <b>{money(i.amountMinor)}</b>
              </li>
            ))}
          </ul>
          <Notice tone="info" title={ev.funding.provider === "paypal" ? "This submits a payout batch to PayPal sandbox." : "This submits a payout batch to the PayPal simulator (no sandbox credentials configured)."}>Individual items may remain processing, or be held, unclaimed or fail. Each recipient is shown as Paid only after PayPal confirms that item.</Notice>
        </div>
      </Dialog>

      <Drawer open={!!detail} onClose={() => setDetail(null)} title={`Reward calculation · ${detail?.businessName ?? ""}`} subtitle="Server-calculated from the persisted verification run">
        {detail && <CalcDetail item={detail} run={run} />}
      </Drawer>
    </div>
  );
}

function CalcDetail({ item, run }: { item: SettlementItem; run: VerificationRun }) {
  const p = run.participants.find((x) => x.orgId === item.orgId)!;
  const rows: [string, string, boolean?][] = [
    ["Accepted commitment", kwh(p.committedWh, 2)],
    ["Baseline peak energy", kwh(p.baselinePeakWh, 2)],
    ["Actual peak energy", kwh(p.actualPeakWh, 2)],
    ["Peak reduction", kwh(p.peakReductionWh, 2)],
    ["Baseline alternate-window energy", kwh(p.baselineShiftWh, 2)],
    ["Actual alternate-window energy", kwh(p.actualShiftWh, 2)],
    ["Alternate-window increase", kwh(p.reboundWh, 2)],
    ["Verified shifted energy (min of the two, capped at commitment)", kwh(p.verifiedWh, 2), true],
    ["Agreed rate", rate(p.rateMinorPerKwh)],
    ["Calculation result", money(p.rewardMinor), true],
  ];
  return (
    <div className="space-y-4">
      <dl className="divide-y divide-line rounded-[10px] border border-line px-4">
        {rows.map(([k, v, strong]) => (
          <div key={k} className={cx("flex justify-between py-2 text-[13px] num", strong && "font-semibold")}>
            <dt className={strong ? "" : "text-ink-2"}>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="rounded-[10px] bg-surface-2/60 p-3 font-mono text-[12px] text-ink-2">
        reward = round_half_up({p.verifiedWh} Wh × {p.rateMinorPerKwh}¢ ÷ 1000) = {p.rewardMinor}¢
      </div>
      <p className="flex items-center gap-2 text-[12px] text-ink-3">
        <ShieldCheck className="size-3.5" /> Repeated on the server at approval. Browser totals are never trusted.
      </p>
    </div>
  );
}

export function PayoutsStage({ ev, batch, settlement }: { ev: DemandEvent; batch: PayoutBatch | null; settlement: Settlement | null }) {
  if (!batch)
    return (
      <Empty icon={<Landmark className="size-6" />} title="No payout batch yet" action={settlement ? <Link href={`/operator/events/${ev.id}?stage=settle`} className="rounded-[8px] bg-signal px-4 py-2 text-sm font-semibold text-signal-ink">Review settlement</Link> : undefined}>
        Payouts are submitted after the operator approves the settlement.
      </Empty>
    );
  return (
    <Panel title="Payout batch" subtitle="Batch status and recipient item status are separate state machines" action={<Link href={`/operator/payments?batch=${batch.id}`} className="inline-flex items-center gap-1.5 text-[13px] text-ink-2 hover:text-ink">Open reconciliation <ArrowRight className="size-3.5" /></Link>}>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
        <code className="font-mono text-[12px]">{batch.paypalBatchId ?? batch.senderBatchId}</code>
        <StatusBadge meta={BATCH_STATUS[batch.status]} />
      </div>
      <ul className="divide-y divide-line rounded-[10px] border border-line">
        {batch.items.map((i) => (
          <li key={i.id} className="flex items-center justify-between px-4 py-2.5 text-[13px] num">
            <span>{i.businessName}</span>
            <span className="flex items-center gap-3">
              {money(i.amountMinor)} <StatusBadge meta={ITEM_STATUS[i.status]} />
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
