import Link from "next/link";
import { ArrowRight, CalendarPlus, ShieldAlert } from "lucide-react";
import { readFresh } from "@/lib/store";
import { activeEvent, demandSeries, networkRows } from "@/lib/views";
import { nextAction } from "@/lib/next";
import { EVENT_STATUS, ITEM_STATUS, OFFER_STATUS, BATCH_STATUS } from "@/lib/status";
import { clock, dateLabel, kwh, money, stamp, windowLabel, ago } from "@/lib/format";
import { Badge, Empty, Kpi, Meter, Notice, PageHeader, Panel, SimulatedNote, StatusBadge, cx } from "@/components/ui";
import { Pipeline } from "@/components/pipeline";
import { DemandChart } from "@/components/charts-lazy";
import { scenarioNow, scenarioNowMs } from "@/lib/clock";
import { resetEligibility } from "@/lib/demo-reset";
import { FreshRun } from "@/components/fresh-run";

export const dynamic = "force-dynamic";

export default async function Overview() {
  const s = (await readFresh());
  const ev = activeEvent(s);
  if (!ev)
    return (
      <Empty icon={<CalendarPlus className="size-6" />} title="Create your first event" action={<Link href="/operator/events/new" className="rounded-[8px] bg-signal px-4 py-2 font-semibold text-signal-ink">Create event</Link>}>
        Define a peak window, a target and a reward budget. PeakShift finds the lowest-cost safe set of businesses to shift.
      </Empty>
    );

  const offers = s.offers.filter((o) => o.eventId === ev.id && o.status !== "SUPERSEDED");
  const accepted = offers.filter((o) => o.status === "ACCEPTED");
  const acceptedWh = accepted.reduce((a, o) => a + o.allocatedWh, 0);
  const plan = s.plans.find((p) => p.id === ev.activePlanId);
  const run = s.verifications.find((v) => v.id === ev.verificationRunId);
  const batch = s.batches.find((b) => b.eventId === ev.id);
  const na = nextAction(ev.status, ev.id);
  const series = demandSeries(s, ev);
  const net = networkRows(s, ev);
  const exceptions = net.filter((n) => n.status === "critical");
  const committedCost = accepted.reduce((a, o) => a + o.maxRewardMinor, 0);
  const paidMinor = batch?.items.filter((i) => i.status === "SUCCEEDED").reduce((a, i) => a + i.amountMinor, 0) ?? 0;
  const elig = resetEligibility(s);
  const gapWh =Math.max(0, ev.targetWh - (run ? run.totals.verifiedWh : acceptedWh));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={<>Control room · scenario time {stamp(scenarioNow(s))}</>}
        title="Overview"
        desc="The current peak event, the flexibility you have secured, and what needs your attention next."
        actions={
          <div className="flex flex-wrap items-center gap-2">
          {ev.status !== "AWAITING_FUNDING" && <FreshRun allowed={elig.allowed} reason={elig.reason} />}
          <Link href="/operator/events/new" className="inline-flex h-10 items-center gap-2 rounded-[8px] border border-line-2 bg-surface-2 px-4 text-sm hover:bg-surface-3">
            <CalendarPlus className="size-4" /> Create event
          </Link>
          </div>
        }
      />

      {ev.status === "PAID" && (
        <Notice tone="info" title="This run is complete">
          Explore the funded, verified and paid event as it is, or click <b className="text-ink">Start a fresh run</b> to fund and settle it yourself through PayPal sandbox.
        </Notice>
      )}

      {/* Current event */}
      <section className="rounded-[14px] border border-line bg-surface shadow-[var(--shadow)] anim-fade-up">
        <div className="flex flex-wrap items-start justify-between gap-6 border-b border-line px-5 py-5 md:px-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="micro">Active event</span>
              <StatusBadge meta={EVENT_STATUS[ev.status]} />
              {ev.funding.status === "FUNDED" && <Badge tone="info">{ev.funding.provider === "paypal" ? "Budget funded via PayPal sandbox" : ev.funding.provider === "paypal-simulator" ? "Budget funded · PayPal simulator" : "Demo funding fixture"}</Badge>}
            </div>
            <Link href={`/operator/events/${ev.id}`} className="mt-2 block text-[22px] font-semibold tracking-[-0.02em] hover:underline underline-offset-4 decoration-line-2">
              {ev.name}
            </Link>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-ink-2">
              <span>{dateLabel(ev.eventDate)}</span>
              <span>
                Peak <b className="font-medium text-ink">{windowLabel(ev.peak)}</b>
              </span>
              <span>
                Alternate window <b className="font-medium text-ink">{windowLabel(ev.shift)}</b>
              </span>
              <span className="num">
                Target <b className="font-medium text-ink">{kwh(ev.targetWh)}</b> = {ev.targetKw.toFixed(1)} kW avg × 2 h
              </span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <Link href={na.href} className="group inline-flex h-11 items-center gap-2 rounded-[8px] bg-signal px-5 text-[14px] font-semibold text-signal-ink hover:brightness-105">
              {na.label} <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
            </Link>
            <span className="max-w-[300px] text-right text-[12px] text-ink-3">{na.helper}</span>
          </div>
        </div>
        <div className="px-5 py-4 md:px-6">
          <Pipeline status={ev.status} eventId={ev.id} />
        </div>
      </section>

      {exceptions.length > 0 && ev.status !== "PAID" && (
        <Notice tone="danger" title={`${exceptions.length} critical load${exceptions.length > 1 ? "s" : ""} excluded from this event`}>
          {exceptions.map((e) => e.name).join(", ")} — refrigeration is marked critical and can never be offered. This is a hard safety rule, not a price decision.
        </Notice>
      )}

      {/* KPIs */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Shift target" value={(ev.targetWh / 1000).toFixed(1)} unit="kWh" tone="ink" sub={`${ev.targetKw.toFixed(1)} kW average over ${windowLabel(ev.peak)}`} />
        <Kpi
          label="Accepted flexibility"
          value={(acceptedWh / 1000).toFixed(1)}
          unit={`/ ${(ev.targetWh / 1000).toFixed(1)} kWh`}
          tone={acceptedWh >= ev.targetWh ? "signal" : "info"}
          sub={<Meter value={acceptedWh} max={ev.targetWh} tone={acceptedWh >= ev.targetWh ? "signal" : "info"} className="mt-1" label="Accepted vs target" />}
          foot={`${accepted.length} of ${offers.length || plan?.candidates.filter((c) => c.selected).length || 0} offers accepted`}
        />
        <Kpi label="Verified shifted energy" value={run ? (run.totals.verifiedWh / 1000).toFixed(1) : "—"} unit={run ? "kWh" : undefined} tone={run ? "success" : "ink"} sub={run ? `${run.totals.deliveryPct}% delivery of ${kwh(run.totals.committedWh)} committed` : "Available after the event is verified"} foot={run ? (run.totals.committedWh > run.totals.verifiedWh ? `Delivery shortfall ${kwh(run.totals.committedWh - run.totals.verifiedWh)} · simulated meter data` : "Simulated meter data") : undefined} />
        <Kpi
          label={run ? "Verified reward" : committedCost ? "Estimated reward" : "Reward budget"}
          value={money(run ? run.totals.rewardMinor : committedCost || ev.budgetMinor)}
          tone="ink"
          sub={run ? `${money(ev.budgetMinor - run.totals.rewardMinor)} of ${money(ev.budgetMinor)} budget unallocated` : committedCost ? `${money(ev.budgetMinor - committedCost)} of ${money(ev.budgetMinor)} budget remains` : `USD · ${ev.funding.status === "FUNDED" ? "captured" : "not yet funded"}`}
          foot={run ? "Unallocated budget stays in the operator's PayPal account" : gapWh > 0 && ev.status !== "AWAITING_FUNDING" ? `Remaining gap ${kwh(gapWh)}` : undefined}
        />
      </section>

      {/* Chart + readiness */}
      <section className="grid gap-4 xl:grid-cols-[1.65fr_1fr]">
        <Panel
          title={series.hasEvent ? "Baseline vs event demand" : "Baseline demand for selected sites"}
          subtitle={<>Aggregate of {series.participants} {series.hasEvent ? "participating" : "eligible"} sites · 15-minute intervals · <SimulatedNote /></>}
        >
          <DemandChart rows={series.rows} peak={ev.peak} shift={ev.shift} targetKwh={ev.targetWh / 1000} height={300} />
        </Panel>

        <Panel title="Participant readiness" subtitle="Confirmed profiles, eligibility and offer responses" action={<Link href="/operator/network" className="text-[12.5px] text-ink-2 hover:text-ink">Network →</Link>}>
          <ul className="divide-y divide-line">
            {net.map((n) => {
              const o = offers.find((x) => x.orgId === n.orgId);
              return (
                <li key={n.orgId} className="flex items-center gap-3 py-2.5">
                  <span className={cx("grid size-8 shrink-0 place-items-center rounded-full text-[12px] font-semibold", n.status === "critical" ? "bg-danger-dim text-danger" : o?.status === "ACCEPTED" ? "bg-signal text-signal-ink" : "bg-surface-3 text-ink-2")}>{n.name[0]}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-medium">{n.name}</div>
                    <div className="truncate text-[12px] text-ink-3">
                      {n.status === "critical" ? "Critical load — excluded from offers" : `${kwh(n.capacityWh)} · ${n.rateMinor != null ? `${money(n.rateMinor)}/kWh` : "—"} · ${windowLabel(n.window)}`}
                    </div>
                  </div>
                  {o ? <StatusBadge meta={OFFER_STATUS[o.status]} /> : n.status === "critical" ? <Badge tone="danger">Hard block</Badge> : n.status === "window" ? <Badge tone="neutral">Window mismatch</Badge> : <Badge tone="neutral">{n.status === "eligible" ? "Eligible" : n.statusLabel}</Badge>}
                </li>
              );
            })}
          </ul>
        </Panel>
      </section>

      {/* Settlement health + recent events */}
      <section className="grid gap-4 lg:grid-cols-2">
        <Panel title="Settlement health" subtitle="PayPal batch and recipient-level item status — tracked separately" action={<Link href="/operator/payments" className="text-[12.5px] text-ink-2 hover:text-ink">Payments →</Link>}>
          {batch ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <span className="text-ink-2">Batch</span>
                <code className="font-mono text-[12px] text-ink">{batch.paypalBatchId ?? batch.senderBatchId}</code>
                <StatusBadge meta={BATCH_STATUS[batch.status]} />
                <span className="ml-auto text-[12px] text-ink-3">checked {ago(batch.lastCheckedAt ?? batch.submittedAt, scenarioNowMs(s))}</span>
              </div>
              <ul className="divide-y divide-line rounded-[10px] border border-line">
                {batch.items.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-[13px]">
                    <span>{i.businessName}</span>
                    <span className="flex items-center gap-3">
                      <span className="num">{money(i.amountMinor)}</span>
                      <StatusBadge meta={ITEM_STATUS[i.status]} />
                    </span>
                  </li>
                ))}
              </ul>
              <div className="text-[12.5px] text-ink-2 num">
                Paid {money(paidMinor)} of {money(batch.amountMinor)} submitted
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3 text-center">
              {[
                ["Funding", ev.funding.status === "FUNDED" ? "Captured" : "Pending"],
                ["Settlement", run ? "Ready for review" : "Awaiting verification"],
                ["Payouts", "None submitted"],
              ].map(([k, v]) => (
                <div key={k} className="rounded-[10px] border border-line bg-surface-2/50 px-3 py-4">
                  <div className="micro">{k}</div>
                  <div className="mt-1.5 text-[13.5px] text-ink">{v}</div>
                </div>
              ))}
              <p className="col-span-3 text-left text-[12.5px] text-ink-3">“Paid” appears only after PayPal confirms each recipient item — never from a batch status alone.</p>
            </div>
          )}
        </Panel>

        <Panel title="Recent events" action={<Link href="/operator/events" className="text-[12.5px] text-ink-2 hover:text-ink">All events →</Link>}>
          <ul className="divide-y divide-line">
            {s.events.slice(0, 5).map((e) => (
              <li key={e.id}>
                <Link href={`/operator/events/${e.id}`} className="flex items-center justify-between gap-3 py-3 hover:opacity-90">
                  <div className="min-w-0">
                    <div className="truncate text-[13.5px] font-medium">{e.name}</div>
                    <div className="text-[12px] text-ink-3 num">
                      {dateLabel(e.eventDate)} · {clock(e.peak.start)}–{clock(e.peak.end)} · {kwh(e.targetWh)} · {money(e.budgetMinor)}
                    </div>
                  </div>
                  <StatusBadge meta={EVENT_STATUS[e.status]} />
                </Link>
              </li>
            ))}
          </ul>
          {exceptions.length > 0 && (
            <div className="mt-3 flex items-center gap-2 rounded-[8px] bg-surface-2/60 px-3 py-2 text-[12px] text-ink-2">
              <ShieldAlert className="size-3.5 text-danger" /> Safety rules are enforced before cost. No override exists in the planner.
            </div>
          )}
        </Panel>
      </section>
    </div>
  );
}
