"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Ban, CalendarClock, CircleDollarSign, Clock3, ShieldCheck, Zap } from "lucide-react";
import type { offerView } from "@/lib/business-view";
import { api, useAction } from "@/lib/client";
import { OFFER_STATUS } from "@/lib/status";
import { clock, dateLabel, kwh, money, rate, stamp, windowLabel } from "@/lib/format";
import { Button, Notice, StatusBadge, cx } from "./ui";
import { Dialog, useToast } from "./overlay";

type V = ReturnType<typeof offerView>;
const REASONS = ["Schedule conflict", "The activity is essential that day", "The quantity is too high", "The reward isn't suitable", "Other / prefer not to say"];

export function OfferDetail({ v }: { v: V }) {
  const { offer: o, event: ev } = v;
  const { run, pending, error } = useAction();
  const toast = useToast();
  const [accepting, setAccepting] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [agree, setAgree] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const open = o.status === "ACTION_REQUIRED";

  async function accept() {
    const r = await run("accept", () => api(`offers/${o.id}/accept`, { body: {} }));
    setAccepting(false);
    if (r) toast({ tone: "success", title: "Offer accepted", detail: "Your commitment is recorded. Your reward depends on verified meter data." });
  }
  async function decline() {
    const r = await run("decline", () => api(`offers/${o.id}/decline`, { body: { reason } }));
    setDeclining(false);
    if (r) toast({ tone: "info", title: "Offer declined.", detail: "No commitment was created." });
  }

  return (
    <div className="space-y-5 pb-24 md:pb-0">
      <Link href="/business/offers" className="inline-flex items-center gap-1.5 text-[13px] text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" /> Offers
      </Link>

      <header className="anim-fade-up">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-brand px-2.5 py-0.5 text-[11.5px] font-medium text-white">Offer for your business</span>
          <StatusBadge meta={OFFER_STATUS[o.status]} />
        </div>
        <h1 className="mt-2 text-[24px] font-semibold leading-tight tracking-[-0.025em]">{ev.name}</h1>
        <p className="mt-1 text-[13px] text-ink-2">
          {dateLabel(ev.date)} · Respond by {new Date(o.expiresAt).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" })} WAT
        </p>
      </header>

      {o.status === "ACCEPTED" && (
        <section className="rounded-[14px] border border-success/30 bg-success-dim p-5 anim-scale-in" aria-live="polite">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-full bg-success text-white">
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={3}><path className="check-draw" d="M5 12.5l4.5 4.5L19 7.5" /></svg>
            </span>
            <div>
              <div className="text-[16px] font-semibold">Offer accepted</div>
              <div className="text-[12.5px] text-ink-2">{o.respondedAt ? stamp(o.respondedAt) : ""} · plan v{o.planVersion} · profile v{o.profileVersion}</div>
            </div>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-[13px]">
            <div className="rounded-[10px] bg-surface p-3"><dt className="text-ink-3">Committed</dt><dd className="mt-0.5 font-semibold num">{kwh(o.allocatedWh)}</dd></div>
            <div className="rounded-[10px] bg-surface p-3"><dt className="text-ink-3">Potential reward</dt><dd className="mt-0.5 font-semibold num">{money(o.maxRewardMinor)}</dd></div>
            <div className="col-span-2 rounded-[10px] bg-surface p-3"><dt className="text-ink-3">When</dt><dd className="mt-0.5">Run it between {clock(o.shiftWindow.start)} and {clock(o.shiftWindow.end)}, not during {windowLabel(ev.peak)}</dd></div>
          </dl>
          <p className="mt-3 text-[13px] text-ink-2"><b className="text-ink">What happens next:</b> after the event, your meter readings are compared with your usual day. Your reward is calculated only from the energy that actually shifted, then paid through PayPal.</p>
          <Link href="/business/earnings" className="mt-3 inline-flex text-[13px] font-medium text-brand underline-offset-4 hover:underline">Track this in Earnings →</Link>
        </section>
      )}
      {o.status === "DECLINED" && <Notice tone="neutral" title="Offer declined">No commitment was created. You won&apos;t be penalised; the operator may send a different offer in future.</Notice>}
      {["EXPIRED", "CANCELLED", "SUPERSEDED"].includes(o.status) && <Notice tone="neutral" title={`This offer is ${OFFER_STATUS[o.status].label.toLowerCase()}`}>It can no longer be accepted. {o.status === "SUPERSEDED" ? "A newer plan replaced it." : "Contact the programme operator or wait for a new offer."}</Notice>}

      <section className="overflow-hidden rounded-[16px] border border-line bg-surface shadow-[var(--shadow)]">
        <div className="border-b border-line bg-surface-2/60 px-5 py-4">
          <div className="text-[12px] text-ink-3">What this means for your business</div>
          <p className="mt-1 text-[15px] leading-snug text-ink">
            Run your <b>{o.activityName.toLowerCase()}</b> between <b>{clock(o.shiftWindow.start)}</b> and <b>{clock(o.shiftWindow.end)}</b> instead of during the {windowLabel(ev.peak)} peak — about <b className="num">{kwh(o.allocatedWh)}</b> of electricity.
            {v.mustCompleteBy ? <> Finish by {clock(v.mustCompleteBy)}, as you told us.</> : null}
          </p>
        </div>
        <dl className="divide-y divide-line">
          <Row icon={<Zap className="size-4" />} k="What changes" v={o.activityName} />
          <Row icon={<Clock3 className="size-4" />} k="When" v={<>Avoid <b>{windowLabel(ev.peak)}</b> · run within <b>{windowLabel(o.shiftWindow)}</b></>} />
          <Row icon={<CalendarClock className="size-4" />} k="How much" v={<span className="num">{kwh(o.allocatedWh)} to shift</span>} />
          <Row icon={<CircleDollarSign className="size-4" />} k="What you can earn" v={<span className="num">{rate(o.rateMinorPerKwh)} · up to <b>{money(o.maxRewardMinor)}</b> <span className="text-ink-3">(estimated reward — final amount depends on verified meter data)</span></span>} />
          <Row
            icon={<ShieldCheck className="size-4 text-success" />}
            k="What must stay on"
            v={
              <ul className="space-y-1">
                {v.critical.map((c) => <li key={c}>{c} — never interrupted</li>)}
                {v.constraints.map((c) => <li key={c}>{c}</li>)}
                {!v.critical.length && !v.constraints.length && <li>Nothing else changes. You stay in control of your equipment.</li>}
              </ul>
            }
          />
        </dl>
        <div className="border-t border-line px-5 py-3 text-[11.5px] text-warning">Simulated meter data — hackathon demo. No equipment is controlled remotely by PeakShift.</div>
      </section>

      {error && <Notice tone="danger" title={error.message}>We checked the latest state of this offer.</Notice>}

      {open && (
        <div className="fixed inset-x-0 bottom-[56px] z-20 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur md:static md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
          <div className="mx-auto flex max-w-[960px] gap-2 md:justify-end">
            <Button variant="danger" size="lg" className="flex-1 md:flex-none" onClick={() => setDeclining(true)} icon={<Ban className="size-4" />}>
              Decline offer
            </Button>
            <button onClick={() => setAccepting(true)} className="h-12 flex-[2] rounded-[8px] bg-brand px-6 text-[15px] font-semibold text-white hover:bg-brand-2 md:flex-none">
              Accept this offer
            </button>
          </div>
        </div>
      )}

      <Dialog
        open={accepting}
        onClose={() => setAccepting(false)}
        title="Accept this offer?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAccepting(false)}>Not now</Button>
            <button disabled={!agree || pending === "accept"} onClick={accept} className={cx("h-10 rounded-[8px] px-4 text-sm font-semibold text-white", agree ? "bg-brand hover:bg-brand-2" : "bg-ink-3/50 cursor-not-allowed")}>
              {pending === "accept" ? "Confirming commitment…" : "Confirm acceptance"}
            </button>
          </>
        }
      >
        <div className="space-y-3 text-[13.5px]">
          <div className="rounded-[10px] bg-surface-2 p-3 num">
            {o.activityName}: {kwh(o.allocatedWh)} between {clock(o.shiftWindow.start)} and {clock(o.shiftWindow.end)} on {dateLabel(ev.date)} · up to {money(o.maxRewardMinor)}
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded-[10px] border border-line p-3">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 size-5 accent-[var(--brand)]" />
            <span>I agree to move the activity shown above within the proposed time window. I understand that critical equipment must remain operating and that my final reward depends on verified meter data.</span>
          </label>
        </div>
      </Dialog>

      <Dialog
        open={declining}
        onClose={() => setDeclining(false)}
        title="Decline this offer?"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeclining(false)}>Keep offer</Button>
            <Button variant="danger" onClick={decline} loading={pending === "decline"} loadingLabel="Declining…">Decline offer</Button>
          </>
        }
      >
        <p className="text-[13px] text-ink-2">That&apos;s completely fine — there&apos;s no penalty. A reason helps the operator plan, but it&apos;s optional.</p>
        <fieldset className="mt-3 space-y-1.5">
          <legend className="sr-only">Reason (optional)</legend>
          {REASONS.map((r) => (
            <label key={r} className={cx("flex cursor-pointer items-center gap-3 rounded-[8px] border px-3 py-2 text-[13px]", reason === r ? "border-brand bg-surface-2" : "border-line")}>
              <input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} className="accent-[var(--brand)]" />
              {r}
            </label>
          ))}
        </fieldset>
      </Dialog>
    </div>
  );
}

function Row({ icon, k, v }: { icon: React.ReactNode; k: string; v: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[28px_1fr] gap-x-3 px-5 py-3.5 sm:grid-cols-[28px_170px_1fr]">
      <span className="mt-0.5 text-ink-3">{icon}</span>
      <dt className="text-[12.5px] text-ink-3 sm:text-[13px]">{k}</dt>
      <dd className="col-start-2 text-[14px] text-ink sm:col-start-3">{v}</dd>
    </div>
  );
}
