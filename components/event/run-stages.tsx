"use client";
import Link from "next/link";
import { ArrowRight, Check, ExternalLink, Play, RefreshCw, ScanLine } from "lucide-react";
import type { DemandEvent, DispatchPlan, Offer } from "@/lib/types";
import { api, useAction } from "@/lib/client";
import { businessViewUrl } from "@/lib/as";
import { OFFER_STATUS } from "@/lib/status";
import { kwh, money, rate, stamp, windowLabel } from "@/lib/format";
import { toIdx } from "@/lib/windows";
import { Badge, Button, Empty, Meter, Notice, Panel, SimulatedNote, StatusBadge, cx } from "../ui";
import { useToast } from "../overlay";
import { DemandChart } from "../charts-lazy";

type Org = { id: string; name: string; category: string; ownerId: string };

export function OffersStage({ ev, offers, orgs, plan }: { ev: DemandEvent; offers: Offer[]; orgs: Org[]; plan: DispatchPlan | null }) {
  const live = offers.filter((o) => o.status !== "SUPERSEDED");
  const accepted = live.filter((o) => o.status === "ACCEPTED");
  const acceptedWh = accepted.reduce((a, o) => a + o.allocatedWh, 0);
  const declined = live.filter((o) => o.status === "DECLINED");
  const name = (id: string) => orgs.find((o) => o.id === id)?.name ?? id;

  // Each business opens in its own tab with a tab-scoped identity (lib/as.ts), so this operator tab stays signed in.
  const businessUrl = (o: Offer) => businessViewUrl(orgs.find((x) => x.id === o.orgId)!.ownerId, `/business/offers/${o.id}`);

  if (!live.length)
    return (
      <Empty title="No offers published yet" action={<Link className="rounded-[8px] bg-signal px-4 py-2 text-sm font-semibold text-signal-ink" href={`/operator/events/${ev.id}?stage=plan`}>Go to dispatch plan</Link>}>
        Generate and review a plan, then publish offers. Businesses accept or decline each one voluntarily.
      </Empty>
    );

  return (
    <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
      <Panel title="Business responses" subtitle="Acceptance is voluntary, explicit and timestamped. Offers are bound to the plan and profile version at publication.">
        <div className="mb-4 flex flex-wrap items-center gap-4">
          <div className="min-w-[220px] flex-1">
            <div className="mb-1.5 flex justify-between text-[12.5px] num">
              <span className="text-ink-2">Accepted commitment</span>
              <span className="font-semibold">
                {kwh(acceptedWh)} / {kwh(ev.targetWh)}
              </span>
            </div>
            <Meter value={acceptedWh} max={ev.targetWh} tone={acceptedWh >= ev.targetWh ? "signal" : "info"} label="Accepted vs target" />
          </div>
          {ev.status === "READY_TO_EXECUTE" ? (
            <Link href={`/operator/events/${ev.id}?stage=execute`} className="inline-flex h-10 items-center gap-2 rounded-[8px] bg-signal px-4 text-sm font-semibold text-signal-ink">
              Ready to execute <ArrowRight className="size-4" />
            </Link>
          ) : (
            <Badge tone="info" pulse>Waiting for responses</Badge>
          )}
        </div>
        <ul className="divide-y divide-line rounded-[10px] border border-line">
          {live.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-medium">{name(o.orgId)}</div>
                <div className="text-[12px] text-ink-3 num">
                  {o.activityName} · {kwh(o.allocatedWh)} · {rate(o.rateMinorPerKwh)} · up to {money(o.maxRewardMinor)} · {windowLabel(o.shiftWindow)}
                </div>
                {o.respondedAt && <div className="mt-0.5 text-[11.5px] text-ink-3">{o.status === "ACCEPTED" ? "Accepted" : "Responded"} {stamp(o.respondedAt)}{o.declineReason ? ` · “${o.declineReason}”` : ""}</div>}
              </div>
              <StatusBadge meta={OFFER_STATUS[o.status]} />
              {o.status === "ACTION_REQUIRED" && (
                <a href={businessUrl(o)} target="_blank" rel="noopener" className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-line-2 bg-surface-2 px-3 text-[12.5px] font-medium hover:bg-surface-3">
                  <ExternalLink className="size-3.5" /> Open as business
                </a>
              )}
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="text-[12px] text-ink-3">“Open as business” opens that owner&apos;s view in a new tab (demo-only); this operator tab stays signed in. Operators cannot accept on a business&apos;s behalf — every response is audited under the business owner.</p>
        </div>
      </Panel>

      <div className="space-y-4">
        {declined.length > 0 && ev.status === "OFFERS_SENT" && (
          <Notice tone="warning" title={`${declined.length} offer${declined.length > 1 ? "s" : ""} declined`} action={<Link href={`/operator/events/${ev.id}?stage=plan`} className="inline-flex items-center gap-1 text-[13px] font-medium text-ink"><RefreshCw className="size-3.5" />Re-optimise</Link>}>
            Re-optimise against remaining eligible participants. Accepted commitments are kept; declined businesses are not re-offered automatically.
          </Notice>
        )}
        <Panel title="What happens next">
          <ol className="space-y-3 text-[13px] text-ink-2">
            {["Each business reviews its specific shift, window and reward on its phone.", "Once accepted commitments reach the target, the event becomes Ready to execute.", "On the day, readings are compared with the baseline. Only verified energy earns a reward."].map((t, i) => (
              <li key={i} className="flex gap-3">
                <span className="grid size-5 shrink-0 place-items-center rounded-full border border-line-2 text-[11px] text-ink-3 num">{i + 1}</span>
                {t}
              </li>
            ))}
          </ol>
          {plan && <p className="mt-4 text-[12px] text-ink-3">Plan v{plan.version} · {plan.status}</p>}
        </Panel>
      </div>
    </div>
  );
}

export function ExecuteStage({ ev, offers, orgs, series }: { ev: DemandEvent; offers: Offer[]; orgs: Org[]; series: { hasEvent: boolean; rows: { t: string; baseline: number; actual: number | null }[] } }) {
  const { run, pending, error } = useAction();
  const toast = useToast();
  const accepted = offers.filter((o) => o.status === "ACCEPTED");
  const name = (id: string) => orgs.find((o) => o.id === id)?.name ?? id;
  const ready = ev.status === "READY_TO_EXECUTE";
  const replayed = ev.status === "IN_PROGRESS" || ev.status === "VERIFY_BLOCKED" || !!ev.executedAt;

  async function execute() {
    const r = await run("exec", () => api<{ datasets: number }>(`events/${ev.id}/demo/execute`, { body: {} }));
    if (r) toast({ tone: "success", title: "Deterministic data loaded", detail: `${r.datasets} simulated datasets · ${r.datasets * 96} intervals.` });
  }
  async function verify() {
    const r = await run("verify", () => api<{ totals: { verifiedWh: number } }>(`events/${ev.id}/verify`, { body: {} }));
    if (r) toast({ tone: "success", title: `Verification complete. ${kwh(r.totals.verifiedWh)} confirmed.` });
  }

  const pos = (hhmm: string) => (toIdx(hhmm) / 96) * 100;

  return (
    <div className="space-y-4">
      <Panel title="Event execution" subtitle={<>A controlled, deterministic replay of the event day. <SimulatedNote /></>}>
        {/* Day timeline */}
        <div className="relative mt-2 h-[132px] rounded-[10px] border border-line bg-surface-2/40">
          <div className="absolute inset-y-0 bg-info-dim border-x border-info/30" style={{ left: `${pos(ev.shift.start)}%`, width: `${pos(ev.shift.end) - pos(ev.shift.start)}%` }}>
            <span className="absolute left-2 top-1.5 text-[11px] text-info">Alternate window {windowLabel(ev.shift)}</span>
          </div>
          <div className="absolute inset-y-0 bg-warning-dim border-x border-warning/35" style={{ left: `${pos(ev.peak.start)}%`, width: `${pos(ev.peak.end) - pos(ev.peak.start)}%` }}>
            <span className="absolute left-2 top-1.5 text-[11px] text-warning">Peak</span>
          </div>
          {accepted.map((o, i) => (
            <div key={o.id} className="absolute flex items-center" style={{ top: 30 + i * 30, left: `${pos(o.shiftWindow.start)}%`, width: `${pos(ev.peak.end) - pos(o.shiftWindow.start)}%` }}>
              <div className="h-[18px] rounded-[5px] bg-signal/85 px-2 text-[11px] font-medium leading-[18px] text-signal-ink truncate anim-bar" style={{ width: `${((pos(o.shiftWindow.end) - pos(o.shiftWindow.start)) / (pos(ev.peak.end) - pos(o.shiftWindow.start))) * 100}%`, animationDelay: `${i * 80}ms` }}>
                {name(o.orgId)} · {kwh(o.allocatedWh)}
              </div>
              <div className="flex-1 border-t border-dashed border-ink-3/60" />
              <div className="size-2 rotate-45 border-l border-b border-ink-3/70 -ml-1" aria-hidden />
            </div>
          ))}
          <div className="absolute inset-x-0 bottom-0 flex justify-between px-2 pb-1 text-[10.5px] text-ink-3 num">
            {["00", "03", "06", "09", "12", "15", "18", "21", "24"].map((h) => (
              <span key={h}>{h}:00</span>
            ))}
          </div>
        </div>
        <p className="mt-2 text-[12px] text-ink-3">Each bar is an accepted commitment: consumption moved out of the peak into the business&apos;s confirmed window.</p>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          {ready && (
            <Button variant="primary" size="lg" onClick={execute} loading={pending === "exec"} loadingLabel="Loading meter readings…" icon={<Play className="size-4" />}>
              Run demo event
            </Button>
          )}
          {ev.status === "IN_PROGRESS" && (
            <>
              <Badge tone="success">Replay complete · {accepted.length * 2} datasets loaded {ev.executedAt ? `· ${stamp(ev.executedAt)}` : ""}</Badge>
              <Button variant="primary" size="lg" onClick={verify} loading={pending === "verify"} loadingLabel="Checking event data…" icon={<ScanLine className="size-4" />}>
                Run verification
              </Button>
            </>
          )}
          {!ready && !replayed && ev.status !== "IN_PROGRESS" && (
            <Notice tone="info" title="Not ready to execute">
              {ev.status === "OFFERS_SENT" ? "Accepted commitments don't meet the target yet — the event cannot proceed to a target-met state." : `Event is ${ev.status.toLowerCase().replace(/_/g, " ")}.`}
            </Notice>
          )}
          {["VERIFIED", "SETTLEMENT_REVIEW", "PAYOUT_PROCESSING", "PAID", "NEEDS_ATTENTION"].includes(ev.status) && (
            <Link href={`/operator/events/${ev.id}?stage=verify`} className="inline-flex h-10 items-center gap-2 rounded-[8px] border border-line-2 px-4 text-sm hover:bg-surface-2">
              <Check className="size-4 text-signal" /> Verified — view evidence <ArrowRight className="size-4" />
            </Link>
          )}
        </div>
        {error && <Notice tone="danger" className="mt-3" title={error.message}>Prior state is preserved. You can retry safely.</Notice>}
      </Panel>

      {series.hasEvent && (
        <Panel title="Replayed meter readings" subtitle={<>Aggregate of accepted participants · 15-minute intervals · <SimulatedNote /></>}>
          <DemandChart rows={series.rows} peak={ev.peak} shift={ev.shift} height={280} />
        </Panel>
      )}

      <div className={cx("grid gap-3 sm:grid-cols-3")}>
        {accepted.map((o) => (
          <div key={o.id} className="rounded-[10px] border border-line bg-surface px-4 py-3">
            <div className="text-[13.5px] font-medium">{name(o.orgId)}</div>
            <div className="mt-0.5 text-[12px] text-ink-3">{o.activityName}</div>
            <div className="mt-2 flex items-baseline justify-between num">
              <span className="text-[20px] font-semibold">{kwh(o.allocatedWh)}</span>
              <span className="text-[12px] text-ink-2">{windowLabel(o.shiftWindow)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
