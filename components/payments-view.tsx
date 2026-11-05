"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, RefreshCw, Webhook, Code2, ChevronDown } from "lucide-react";
import type { EventFunding, PayoutBatch, WebhookEvent } from "@/lib/types";
import { api, ApiError } from "@/lib/client";
import { BATCH_STATUS, FUNDING_STATUS, ITEM_EXCEPTION, ITEM_IN_FLIGHT, ITEM_STATUS } from "@/lib/status";
import { ago, money, stamp } from "@/lib/format";
import { Badge, Button, Empty, Kpi, KV, Notice, Panel, StatusBadge, cx } from "./ui";

export function PaymentsView({ batches, events, webhooks, selectedId, mode, webhookReady, now }: { batches: PayoutBatch[]; events: Record<string, { name: string; funding: EventFunding }>; webhooks: WebhookEvent[]; selectedId: string | null; mode: "sandbox" | "simulator"; webhookReady: boolean; now: number }) {
  const router = useRouter();
  const [sel, setSel] = useState(selectedId);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [raw, setRaw] = useState(false);
  const [showRejected, setShowRejected] = useState(false);
  const accepted = webhooks.filter((w) => w.simulated || w.processingStatus === "PROCESSED" || w.processingStatus === "DUPLICATE");
  const rejected = webhooks.filter((w) => !w.simulated && (w.processingStatus === "REJECTED" || w.processingStatus === "UNSUPPORTED"));
  const b = batches.find((x) => x.id === sel) ?? batches[0];
  const inFlight = !!b && (b.items.some((i) => ITEM_IN_FLIGHT.includes(i.status)) || ["PENDING", "PROCESSING", "SUBMITTING", "UNKNOWN"].includes(b.status));
  const busyRef = useRef(false);

  async function refresh(manual = false) {
    if (!b || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setErr(null);
    try {
      await api(`payouts/${b.id}/refresh`, { body: {} });
    } catch (e) {
      if (manual) setErr((e as ApiError).message);
    } finally {
      busyRef.current = false;
      setBusy(false);
      router.refresh();
    }
  }

  // Poll the backend reconciliation path while recipient items are still in flight.
  useEffect(() => {
    if (!inFlight) return;
    const t = setInterval(() => refresh(false), 2500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inFlight, b?.id]);

  const all = batches.flatMap((x) => x.items);
  const sum = (f: (s: string) => boolean) => all.filter((i) => f(i.status));
  const submitted = all.reduce((a, i) => a + i.amountMinor, 0);

  function exportCsv() {
    const head = ["internal_batch_id", "paypal_batch_id", "sender_batch_id", "internal_item_id", "paypal_item_id", "sender_item_id", "business", "recipient_masked", "amount", "currency", "item_status", "transaction_id", "updated_at"];
    const rows = batches.flatMap((x) => x.items.map((i) => [x.id, x.paypalBatchId ?? "", x.senderBatchId, i.id, i.paypalItemId ?? "", i.senderItemId, i.businessName, i.recipientMasked, (i.amountMinor / 100).toFixed(2), i.currency, i.status, i.transactionId ?? "", i.updatedAt]));
    const blob = new Blob([[head, ...rows].map((r) => r.join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "peakshift-payout-ledger.csv";
    a.click();
  }

  const fundings = Object.entries(events).filter(([, e]) => e.funding.orderId || e.funding.captureId);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Total submitted" value={money(submitted)} sub={`${all.length} recipient items`} />
        <Kpi label="Items paid" value={sum((s) => s === "SUCCEEDED").length} tone="success" sub="PayPal-confirmed recipient items" />
        <Kpi label="Processing" value={sum((s) => ITEM_IN_FLIGHT.includes(s as never)).length} tone="info" sub="Awaiting item confirmation" />
        <Kpi label="Held / unclaimed" value={sum((s) => s === "HELD" || s === "UNCLAIMED").length} tone="warning" sub="Needs recipient attention" />
        <Kpi label="Failed / returned" value={sum((s) => ["FAILED", "RETURNED", "BLOCKED", "REFUNDED"].includes(s)).length} sub="Exceptions" />
      </div>

      <p className="text-[12px] text-ink-3">
        Demo replay of a completed event: record times follow the scenario timeline (budget funded the afternoon before, payouts after verification on the evening of the event). PayPal sandbox API calls are real and also carry their wall-clock time.
      </p>

      {mode === "simulator" && (
        <Notice tone="warning" title="PayPal simulator mode">
          This deployment has no PayPal sandbox credentials, so payouts run through a local simulator that mirrors the sandbox lifecycle (PENDING → PROCESSING → SUCCESS, with item-level updates). References are prefixed <code className="font-mono">SIM</code>. Configure sandbox keys to make real Payouts API calls.
        </Notice>
      )}

      {!b ? (
        <Empty title="No payout batches yet">Approve a settlement to submit the first PayPal payout batch. Funding captures appear below.</Empty>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[280px_1fr]">
          <Panel title="Batches" bodyClass="!px-2 !pb-2">
            <ul className="space-y-1">
              {batches.map((x) => (
                <li key={x.id}>
                  <button onClick={() => setSel(x.id)} className={cx("w-full rounded-[8px] px-3 py-2.5 text-left", x.id === b.id ? "bg-surface-2" : "hover:bg-surface-2/60")}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-medium">{events[x.eventId]?.name ?? x.eventId}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-[12px] text-ink-3 num">
                      <span>{money(x.amountMinor)}</span>
                      <StatusBadge meta={BATCH_STATUS[x.status]} />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>

          <div className="space-y-4">
            <Panel
              title={
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-[15px] font-semibold">Payout batch</h2>
                  <StatusBadge meta={BATCH_STATUS[b.status]} pulse={inFlight} />
                  <Badge tone="info">{b.provider === "paypal" ? "PayPal sandbox" : "PayPal simulator"}</Badge>
                </div>
              }
              subtitle={events[b.eventId]?.name}
              action={
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" onClick={exportCsv} icon={<Download className="size-3.5" />}>
                    Ledger CSV
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => refresh(true)} loading={busy} loadingLabel="Checking PayPal status…" icon={<RefreshCw className="size-3.5" />}>
                    Refresh status
                  </Button>
                </div>
              }
            >
              <div className="grid gap-x-8 md:grid-cols-2">
                <dl className="divide-y divide-line">
                  <KV k="Internal batch ID" v={b.id} mono />
                  <KV k="PayPal payout batch ID" v={b.paypalBatchId ?? "awaiting"} mono />
                  <KV k="Sender batch ID" v={b.senderBatchId} mono />
                  <KV k="Total" v={`${money(b.amountMinor)} ${b.currency}`} />
                </dl>
                <dl className="divide-y divide-line">
                  <KV k="Submitted (scenario time)" v={stamp(b.submittedAt)} />
                  {b.wallClockSubmittedAt && <KV k="Sandbox API call (wall clock)" v={stamp(b.wallClockSubmittedAt)} />}
                  <KV k="Items" v={`${b.items.length} · ${b.items.filter((i) => i.status === "SUCCEEDED").length} paid · ${b.items.filter((i) => ITEM_EXCEPTION.includes(i.status)).length} exceptions`} />
                  <KV k="Last webhook" v={b.lastWebhookAt ? `${ago(b.lastWebhookAt, now)}${b.provider !== "paypal" ? " (simulated)" : ""}` : webhookReady ? "none yet" : "webhook not configured"} />
                  <KV k="Last reconciled" v={ago(b.lastCheckedAt, now)} />
                </dl>
              </div>
              {err && <Notice tone="warning" className="mt-3" title={err}>Last confirmed status is kept.</Notice>}
              {b.status === "SUCCESS" && b.items.some((i) => i.status !== "SUCCEEDED") && (
                <Notice tone="warning" className="mt-3" title="Batch completed, but not every recipient is paid">Item-level statuses below are authoritative.</Notice>
              )}
            </Panel>

            <Panel title="Recipient items" subtitle="Paid appears only after PayPal confirms the individual item" bodyClass="!px-0">
              <div className="overflow-x-auto">
                <table className="[&_td.text-right]:whitespace-nowrap [&_th]:whitespace-nowrap w-full min-w-[820px] text-[13px] num">
                  <thead>
                    <tr className="border-y border-line bg-surface-2/60 text-left text-[12px] text-ink-2">
                      <th className="px-5 py-2.5 font-medium">Recipient</th>
                      <th className="px-3 py-2.5 font-medium">PayPal item ID</th>
                      <th className="px-3 py-2.5 font-medium">Sender item ID</th>
                      <th className="px-3 py-2.5 text-right font-medium">Amount</th>
                      <th className="px-3 py-2.5 font-medium">Item status</th>
                      <th className="px-5 py-2.5 font-medium">Status history</th>
                    </tr>
                  </thead>
                  <tbody>
                    {b.items.map((i) => (
                      <tr key={i.id} className="border-b border-line align-top">
                        <td className="px-5 py-3">
                          <div className="font-medium">{i.businessName}</div>
                          <div className="font-mono text-[11.5px] text-ink-3">{i.recipientMasked}</div>
                        </td>
                        <td className="px-3 py-3 font-mono text-[11.5px] text-ink-2">{i.paypalItemId ?? "—"}</td>
                        <td className="px-3 py-3 font-mono text-[11.5px] text-ink-3">{i.senderItemId.slice(-22)}</td>
                        <td className="px-3 py-3 text-right font-semibold">{money(i.amountMinor)}</td>
                        <td className="px-3 py-3">
                          <StatusBadge meta={ITEM_STATUS[i.status]} pulse={ITEM_IN_FLIGHT.includes(i.status)} />
                          {i.errorCode && <div className="mt-1 text-[11.5px] text-danger">{i.errorCode}</div>}
                          {i.transactionId && <div className="mt-1 font-mono text-[11px] text-ink-3">txn {i.transactionId}</div>}
                        </td>
                        <td className="px-5 py-3">
                          <ol className="flex flex-wrap items-center gap-1 text-[11px] text-ink-3">
                            {i.history.map((h, k) => (
                              <li key={k} className="flex items-center gap-1" title={`${stamp(h.at)} · ${h.source}`}>
                                {k > 0 && <span>→</span>}
                                <span className={cx(h.status === "SUCCEEDED" && "text-success")}>{ITEM_STATUS[h.status].label}</span>
                              </li>
                            ))}
                          </ol>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>

            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title={<span className="flex items-center gap-2 text-[15px] font-semibold"><Webhook className="size-4 text-ink-3" />Webhook receipts</span>} subtitle="A valid signature proves the message came from PayPal — payment status is read from each recipient item">
                {accepted.length ? (
                  <ul className="space-y-1.5 text-[12px]">
                    {accepted.slice(0, 8).map((w) => (
                      <li key={w.id} className="flex items-center justify-between gap-2 rounded-[8px] bg-surface-2/50 px-3 py-2">
                        <span className="min-w-0">
                          <span className="block truncate font-mono text-[11.5px] text-ink">{w.eventType}</span>
                          <span className="text-ink-3">{stamp(w.receivedAt)} · {w.providerEventId}</span>
                        </span>
                        {w.simulated ? <Badge tone="warning">Simulated</Badge> : w.processingStatus === "DUPLICATE" ? <Badge tone="neutral">Duplicate · ignored</Badge> : <Badge tone="info">Signature verified</Badge>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[13px] text-ink-3">No accepted webhook events yet.</p>
                )}
                {rejected.length > 0 && (
                  <div className="mt-3 rounded-[8px] border border-line">
                    <button onClick={() => setShowRejected((v) => !v)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-[12.5px] text-ink-2 hover:text-ink" aria-expanded={showRejected}>
                      <span>Rejected / unsupported events ({rejected.length})</span>
                      <ChevronDown className={cx("size-3.5 transition", showRejected && "rotate-180")} />
                    </button>
                    {showRejected && (
                      <ul className="space-y-1 border-t border-line px-3 py-2 text-[11.5px]">
                        {rejected.map((w) => (
                          <li key={w.id} className="flex items-start justify-between gap-2">
                            <span className="min-w-0">
                              <span className="block truncate font-mono text-ink-2">{w.eventType}</span>
                              <span className="text-ink-3">{w.reason ?? (w.verified ? "Not acted on" : "Signature verification failed — no state change")}</span>
                            </span>
                            <Badge tone={w.processingStatus === "REJECTED" ? "danger" : "neutral"}>{w.processingStatus === "REJECTED" ? "Rejected" : "Unsupported"}</Badge>
                          </li>
                        ))}
                        <li className="pt-1 text-ink-3">Every rejection is kept in the audit log with its reason. None changed any payment state.</li>
                      </ul>
                    )}
                  </div>
                )}
              </Panel>
              <Panel title={<span className="flex items-center gap-2 text-[15px] font-semibold"><Code2 className="size-4 text-ink-3" />PayPal response</span>} subtitle="Redacted — emails, names and links removed">
                <button onClick={() => setRaw((r) => !r)} className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-2 hover:text-ink" aria-expanded={raw}>
                  {raw ? "Hide" : "Inspect"} redacted response <ChevronDown className={cx("size-3.5 transition", raw && "rotate-180")} />
                </button>
                {raw && <pre className="mt-2 max-h-[260px] overflow-auto rounded-[8px] bg-bg p-3 font-mono text-[11px] text-ink-2">{JSON.stringify(b.responseRedacted, null, 2)}</pre>}
                <ol className="mt-3 space-y-1 text-[12px]">
                  {b.history.map((h, k) => (
                    <li key={k} className="flex justify-between gap-2">
                      <span>{BATCH_STATUS[h.status].label} <span className="text-ink-3">· {h.source}</span></span>
                      <span className="text-ink-3">{stamp(h.at)}</span>
                    </li>
                  ))}
                </ol>
              </Panel>
            </div>
          </div>
        </div>
      )}

      {fundings.length > 0 && (
        <Panel title="Event funding (Checkout)" subtitle="The budget capture is a payment into the operator's own PayPal account — not escrow. Rewards are paid from it by PayPal Payouts.">
          <ul className="divide-y divide-line">
            {fundings.map(([id, e]) => (
              <li key={id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-[13px]">
                <span className="font-medium">{e.name}</span>
                <span className="flex flex-wrap items-center gap-3 font-mono text-[11.5px] text-ink-2">
                  <span>order {e.funding.orderId ?? "—"}</span>
                  <span>capture {e.funding.captureId ?? "—"}</span>
                  <span className="font-sans text-[13px] text-ink num">{money(e.funding.amountMinor)}</span>
                  <StatusBadge meta={FUNDING_STATUS[e.funding.status]} />
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
