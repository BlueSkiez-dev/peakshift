"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Info, Lock, ShieldCheck } from "lucide-react";
import type { DemandEvent } from "@/lib/types";
import { api, useAction } from "@/lib/client";
import { FUNDING_STATUS } from "@/lib/status";
import { money, stamp } from "@/lib/format";
import { Button, KV, Notice, Panel, StatusBadge, Badge } from "../ui";
import { Dialog, useToast } from "../overlay";

declare global {
  interface Window {
    paypal?: { Buttons: (o: Record<string, unknown>) => { render: (el: HTMLElement) => Promise<void>; close?: () => void } };
  }
}

export function FundStage({ ev, mode, clientId }: { ev: DemandEvent; mode: "sandbox" | "simulator"; clientId: string | null }) {
  const { run, pending, error } = useAction();
  const toast = useToast();
  const [simOrder, setSimOrder] = useState<string | null>(null);
  const funded = ev.funding.status === "FUNDED";

  async function startSimulator() {
    const r = await run("order", () => api<{ orderId: string }>(`events/${ev.id}/fund/order`, { body: {} }));
    if (r) setSimOrder(r.orderId);
  }
  async function captureSim() {
    const id = simOrder!;
    setSimOrder(null);
    const r = await run("capture", () => api(`events/${ev.id}/fund/capture`, { body: { orderId: id } }));
    if (r) toast({ tone: "success", title: "Budget captured", detail: "Server verified the capture. Event is funded and ready to optimise." });
  }
  async function cancelSim() {
    setSimOrder(null);
    await run("cancel", () => api(`events/${ev.id}/fund/cancel`, { body: {} }));
    toast({ tone: "info", title: "Funding was not completed.", detail: "The event remains unfunded. You can retry safely." });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
      <Panel title="Review and fund" subtitle="Fund the event reward budget through PayPal Checkout. The event can't publish offers until the server verifies the capture.">
        <dl className="divide-y divide-line rounded-[10px] border border-line px-4">
          <KV k="Reward budget" v={<b className="text-[15px]">{money(ev.budgetMinor)} USD</b>} />
          <KV k="Event target" v={`${(ev.targetWh / 1000).toFixed(1)} kWh · ${ev.targetKw.toFixed(1)} kW average`} />
          <KV k="Funding status" v={<StatusBadge meta={FUNDING_STATUS[ev.funding.status]} />} />
          {ev.funding.orderId && <KV k="PayPal order" v={ev.funding.orderId} mono />}
          {ev.funding.captureId && <KV k="PayPal capture" v={ev.funding.captureId} mono />}
          {ev.funding.capturedAt && <KV k="Captured" v={stamp(ev.funding.capturedAt)} />}
        </dl>

        {error && (
          <Notice tone="danger" className="mt-4" title={error.message}>
            Nothing was charged twice — retrying reuses the open order.
          </Notice>
        )}

        <div className="mt-5">
          {funded ? (
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone="success">Capture verified by server</Badge>
              <Link href={`/operator/events/${ev.id}?stage=plan`} className="inline-flex h-10 items-center gap-2 rounded-[8px] bg-signal px-4 text-sm font-semibold text-signal-ink">
                Find the lowest-cost plan <ArrowRight className="size-4" />
              </Link>
            </div>
          ) : mode === "sandbox" && clientId ? (
            <PayPalButtons ev={ev} clientId={clientId} />
          ) : (
            <div className="space-y-3">
              <Button variant="primary" size="lg" onClick={startSimulator} loading={pending === "order" || pending === "capture"} loadingLabel={pending === "capture" ? "Verifying capture…" : "Creating order…"}>
                Continue to PayPal simulator <ArrowRight className="size-4" />
              </Button>
              <p className="text-[12.5px] text-ink-3">No PayPal sandbox credentials are configured on this deployment, so checkout runs in a labelled local simulator. Add <code className="font-mono">PAYPAL_CLIENT_ID</code> / <code className="font-mono">PAYPAL_CLIENT_SECRET</code> to use the real sandbox.</p>
            </div>
          )}
        </div>
      </Panel>

      <div className="space-y-4">
        <Panel title="What funding means">
          <ul className="space-y-3 text-[13px] text-ink-2">
            <li className="flex gap-3">
              <Lock className="mt-0.5 size-4 shrink-0 text-ink-3" />
              <span>
                <b className="text-ink">Not escrow.</b> The capture is a payment to the programme operator&apos;s PayPal business account. PeakShift records a budget allocation; it does not hold or segregate funds.
              </span>
            </li>
            <li className="flex gap-3">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ink-3" />
              <span>Funded status is set only after the server captures the order and checks amount, currency and reference — never from a browser redirect.</span>
            </li>
            <li className="flex gap-3">
              <Info className="mt-0.5 size-4 shrink-0 text-ink-3" />
              <span>Payouts later draw only from verified rewards and can never exceed this captured amount.</span>
            </li>
          </ul>
        </Panel>
        {ev.funding.history.length > 1 && (
          <Panel title="Funding history">
            <ol className="space-y-2 text-[12.5px]">
              {ev.funding.history.map((h, i) => (
                <li key={i} className="flex items-center justify-between gap-3">
                  <StatusBadge meta={FUNDING_STATUS[h.status]} />
                  <span className="text-ink-3">{stamp(h.at)}</span>
                </li>
              ))}
            </ol>
          </Panel>
        )}
      </div>

      <Dialog open={!!simOrder} onClose={cancelSim} title="PayPal simulator — approve payment" size="sm" footer={<><Button variant="ghost" onClick={cancelSim}>Cancel checkout</Button><Button variant="primary" onClick={captureSim} data-autofocus="true">Approve {money(ev.budgetMinor)}</Button></>}>
        <div className="space-y-3 text-[13px]">
          <Notice tone="warning" title="Simulated checkout">This stands in for the PayPal approval window because no sandbox credentials are configured. No PayPal API call is made.</Notice>
          <dl className="rounded-[10px] border border-line px-4">
            <KV k="Merchant" v="Lagoon Flex Programme (operator)" />
            <KV k="Amount" v={`${money(ev.budgetMinor)} USD`} />
            <KV k="Order" v={simOrder} mono />
          </dl>
        </div>
      </Dialog>
    </div>
  );
}

function PayPalButtons({ ev, clientId }: { ev: DemandEvent; clientId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "capturing" | "error">("loading");
  const [msg, setMsg] = useState<string | null>(null);
  const toast = useToast();
  const { run } = useAction();

  useEffect(() => {
    let cancelled = false;
    const id = "paypal-sdk";
    const render = () => {
      if (cancelled || !window.paypal || !ref.current) return;
      ref.current.innerHTML = "";
      window.paypal
        .Buttons({
          style: { layout: "vertical", color: "gold", shape: "rect", label: "paypal", height: 44 },
          createOrder: async () => (await api<{ orderId: string }>(`events/${ev.id}/fund/order`, { body: {} })).orderId,
          onApprove: async (data: { orderID: string }) => {
            setState("capturing");
            const r = await run("capture", () => api(`events/${ev.id}/fund/capture`, { body: { orderId: data.orderID } }));
            if (r) toast({ tone: "success", title: "Budget captured in PayPal sandbox", detail: "Server verified amount, currency and reference." });
            else setState("ready");
          },
          onCancel: async () => {
            await run("cancel", () => api(`events/${ev.id}/fund/cancel`, { body: {} }));
            setMsg("Funding was not completed. The event remains unfunded.");
          },
          onError: (e: Error) => {
            setState("error");
            setMsg(e?.message ?? "PayPal checkout failed.");
          },
        })
        .render(ref.current)
        .then(() => !cancelled && setState("ready"));
    };
    if (window.paypal) render();
    else if (!document.getElementById(id)) {
      const sc = document.createElement("script");
      sc.id = id;
      sc.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture&components=buttons`;
      sc.onload = render;
      sc.onerror = () => {
        setState("error");
        setMsg("Couldn't load PayPal. Check your connection and retry.");
      };
      document.body.appendChild(sc);
    } else document.getElementById(id)!.addEventListener("load", render);
    return () => {
      cancelled = true;
    };
  }, [clientId, ev.id, run, toast]);

  return (
    <div className="max-w-sm space-y-2">
      {state === "loading" && <div className="h-11 animate-pulse rounded-[8px] bg-surface-2" />}
      {state === "capturing" && <Notice tone="info" title="Verifying capture with PayPal…" />}
      <div ref={ref} className="rounded-[10px] bg-white p-3" hidden={state === "loading" || state === "capturing"} />
      {msg && <Notice tone="warning">{msg}</Notice>}
      <p className="text-[12px] text-ink-3">PayPal sandbox · use a sandbox personal account to approve.</p>
    </div>
  );
}
