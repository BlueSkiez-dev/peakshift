"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity, ArrowDownToLine, ArrowRight, FileSearch, ShieldCheck, Wallet, Zap } from "lucide-react";
import { MeterStatus, RadialGauge } from "../gauges";
import type { DemandEvent, ParticipantVerification, VerificationRun } from "@/lib/types";
import { api, useAction } from "@/lib/client";
import { intervalLabel, kwh, money, rate, stamp, windowLabel } from "@/lib/format";
import { windowIdx } from "@/lib/windows";
import { attainmentPct, LIMITED_BY_LABEL } from "@/lib/terms";
import { Badge, Button, Empty, Kpi, Meter, Notice, Panel, SimulatedNote, cx } from "../ui";
import { Drawer } from "../overlay";
import { DemandChart } from "../charts-lazy";

type DS = { orgId: string; type: "baseline" | "event"; readings: { i: number; wh: number | null }[] };

export function VerifyStage({ ev, run, series, datasets }: { ev: DemandEvent; run: VerificationRun | null; series: { rows: { t: string; baseline: number; actual: number | null }[] }; datasets: DS[] }) {
  const router = useRouter();
  const { run: act, pending, error } = useAction();
  const [open, setOpen] = useState<ParticipantVerification | null>(null);

  if (!run)
    return (
      <Empty icon={<FileSearch className="size-6" />} title="No verification yet" action={<Link href={`/operator/events/${ev.id}?stage=execute`} className="rounded-[8px] bg-signal px-4 py-2 text-sm font-semibold text-signal-ink">Go to execution</Link>}>
        Run the demo event to load the simulated meter readings, then run verification.
      </Empty>
    );

  const t = run.totals;
  const ok = run.status === "VERIFIED";
  const limitedByRebound = run.participants.some((p) => p.limitedBy === "rebound");
  const shortfallWh = Math.max(0, t.committedWh - t.verifiedWh);

  async function toSettlement() {
    const r = await act("settle", () => api(`events/${ev.id}/settlements`, { body: {} }));
    if (r) router.push(`/operator/events/${ev.id}?stage=settle`);
  }

  return (
    <div className="space-y-4">
      {/* Main outcome */}
      <section className={cx("rounded-[14px] border px-5 py-5 md:px-6", ok ? "border-success/30 bg-success-dim" : "border-danger/35 bg-danger-dim")}>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <div className="flex items-center gap-2">
              {ok ? <Badge tone="success">Verified</Badge> : <Badge tone="danger">Insufficient data — settlement blocked</Badge>}
              <span className="text-[12px] text-ink-3">Run v{run.version} · {stamp(run.createdAt)}</span>
            </div>
            <div className="mt-3 flex items-baseline gap-2 num">
              <span className="text-[44px] font-semibold leading-none tracking-[-0.03em]">{(t.verifiedWh / 1000).toFixed(1)}</span>
              <span className="text-[16px] text-ink-2">kWh verified shifted energy</span>
            </div>
            <p className="mt-2 max-w-xl text-[13.5px] text-ink-2">
              {kwh(t.verifiedWh)} verified against the accepted {kwh(t.committedWh)} commitment — {t.deliveryPct}% delivery, {kwh(shortfallWh)} shortfall.
              {limitedByRebound ? " Where the alternate-window increase was smaller than the peak reduction, the smaller value is used." : ""}
            </p>
          </div>
          {ok && (
            <div className="flex flex-col items-end gap-1.5">
              {ev.settlementId ? (
                <Link href={`/operator/events/${ev.id}?stage=settle`} className="inline-flex h-11 items-center gap-2 rounded-[8px] bg-signal px-5 text-[14px] font-semibold text-signal-ink">
                  Review rewards and settlement <ArrowRight className="size-4" />
                </Link>
              ) : (
                <Button variant="primary" size="lg" onClick={toSettlement} loading={pending === "settle"} loadingLabel="Preparing settlement…">
                  Review rewards and settlement <ArrowRight className="size-4" />
                </Button>
              )}
              <span className="text-[12px] text-ink-3">Only verified energy is included in the reward calculation.</span>
            </div>
          )}
        </div>
        {error && <Notice tone="danger" className="mt-3" title={error.message} />}
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Accepted commitment" value={(t.committedWh / 1000).toFixed(1)} unit="kWh" />
        <Kpi label="Measured peak reduction" value={(t.peakReductionWh / 1000).toFixed(1)} unit="kWh" tone="info" sub={`Peak ${windowLabel(ev.peak)}`} />
        <Kpi label="Alternate-window increase" value={(t.reboundWh / 1000).toFixed(1)} unit="kWh" tone="info" sub={`Alternate ${windowLabel(ev.shift)}`} />
        <Kpi label="Verified shifted" value={(t.verifiedWh / 1000).toFixed(1)} unit="kWh" tone="success" sub={<Meter value={t.verifiedWh} max={t.committedWh} tone="success" className="mt-1" label="Commitment attainment" />} foot={`${t.deliveryPct}% delivery · ${kwh(shortfallWh)} shortfall`} />
        <Kpi label="Meter data completeness" value={`${t.coveragePct}%`} tone={t.coveragePct >= run.minCoveragePct ? "ink" : "warning"} sub={`Intervals received · threshold ${run.minCoveragePct}%`} />
      </div>

      {/* Evidence health: gauges + meter status (all values from the stored verification run) */}
      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <RadialGauge label="Commitment attainment" value={t.deliveryPct} display={`${t.deliveryPct}%`} unit={`${kwh(t.verifiedWh)} of ${kwh(t.committedWh)}`} tone="success" icon={<Zap className="size-7" />} rows={[{ k: "Limited by alt.-window increase", v: run.participants.filter((p) => p.limitedBy === "rebound").length }, { k: "Limited by peak reduction", v: run.participants.filter((p) => p.limitedBy === "peak_reduction").length }]} />
          <RadialGauge label="Peak reduction vs target" value={Math.round((t.peakReductionWh / ev.targetWh) * 1000) / 10} display={`${Math.round((t.peakReductionWh / ev.targetWh) * 1000) / 10}%`} unit={`${kwh(t.peakReductionWh)} of ${kwh(ev.targetWh)}`} tone="info" icon={<ArrowDownToLine className="size-7" />} rows={[{ k: "Baseline peak", v: kwh(run.participants.reduce((a, p) => a + p.baselinePeakWh, 0)) }, { k: "Actual peak", v: kwh(run.participants.reduce((a, p) => a + p.actualPeakWh, 0)), trend: "down" }]} />
          <RadialGauge label="Meter data completeness" value={t.coveragePct} display={`${t.coveragePct}%`} unit={`threshold ${run.minCoveragePct}%`} tone={t.coveragePct >= run.minCoveragePct ? "signal" : "warning"} icon={<Activity className="size-7" />} rows={[{ k: "Intervals", v: `${run.participants.reduce((a, p) => a + p.receivedIntervals, 0)}/${run.participants.reduce((a, p) => a + p.expectedIntervals, 0)}` }, { k: "Formula", v: run.formulaVersion.replace("mv-", "") }]} />
          <RadialGauge label="Budget used (verified)" value={Math.round((t.rewardMinor / ev.budgetMinor) * 1000) / 10} display={money(t.rewardMinor)} unit={`of ${money(ev.budgetMinor)} budget`} tone="warning" icon={<Wallet className="size-7" />} rows={[{ k: "Per verified kWh", v: t.verifiedWh ? money(Math.round((t.rewardMinor * 1000) / t.verifiedWh)) : "—" }, { k: "Unallocated", v: money(ev.budgetMinor - t.rewardMinor) }]} />
        </div>
        <Panel title="Meter status" subtitle="Simulated 15-minute datasets loaded for each participant">
          <MeterStatus
            caption="Simulated meter data — hackathon demo. No live telemetry."
            rows={run.participants.flatMap((p) => {
              const ds = datasets.filter((d) => d.orgId === p.orgId);
              const full = (type: "baseline" | "event") => {
                const d = ds.find((x) => x.type === type);
                const got = d ? d.readings.filter((r) => r.wh != null).length : 0;
                return { status: (d ? (got === 96 ? "ok" : "missing") : "pending") as "ok" | "missing" | "pending", intervals: `${got}/96` };
              };
              const b = full("baseline");
              const e = full("event");
              return [
                { name: p.businessName, meter: "Baseline meter", status: b.status, coveragePct: p.coveragePct, intervals: b.intervals },
                { name: p.businessName, meter: "Event-day meter", status: e.status, coveragePct: p.coveragePct, intervals: e.intervals },
              ];
            })}
          />
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <Panel title="Baseline vs event" subtitle={<>Energy per 15-minute interval, participating sites · <SimulatedNote /></>}>
          <DemandChart rows={series.rows} peak={ev.peak} shift={ev.shift} height={300} />
        </Panel>
        <Panel title="Calculation" subtitle="Conservative demo heuristic — not a certified M&V method">
          <ol className="space-y-3 text-[13px]">
            <li>
              <div className="font-medium">Peak reduction</div>
              <div className="text-ink-2">Baseline peak energy − actual peak energy, floored at zero.</div>
            </li>
            <li>
              <div className="font-medium">Alternate-window increase</div>
              <div className="text-ink-2">Actual alternate-window energy − baseline alternate-window energy, floored at zero (the moved consumption reappearing).</div>
            </li>
            <li>
              <div className="font-medium">Verified shifted energy</div>
              <div className="text-ink-2">min(peak reduction, alternate-window increase), capped at the accepted commitment — so we never pay for a reduction whose consumption didn&apos;t reappear in the permitted window, nor for more than was committed.</div>
            </li>
          </ol>
          <div className="mt-4 space-y-1.5 rounded-[10px] border border-line bg-surface-2/50 p-3 font-mono text-[11.5px] text-ink-2">
            <div>formula&nbsp;&nbsp;{run.formulaVersion}</div>
            <div>baseline&nbsp;{run.baselineMethod}</div>
            <div>units&nbsp;&nbsp;&nbsp;&nbsp;integer Wh · reward in cents, round half-up</div>
          </div>
        </Panel>
      </div>

      <Panel title="Participant verification" subtitle="Open a row to inspect interval readings and the reward calculation" bodyClass="!px-0">
        <div className="overflow-x-auto">
          <table className="[&_td.text-right]:whitespace-nowrap [&_th]:whitespace-nowrap w-full min-w-[860px] text-[13px] num">
            <thead>
              <tr className="border-y border-line bg-surface-2/60 text-left text-[12px] text-ink-2">
                <th className="px-5 py-2.5 font-medium">Business</th>
                <th className="px-3 py-2.5 text-right font-medium">Committed</th>
                <th className="px-3 py-2.5 text-right font-medium">Peak reduction</th>
                <th className="px-3 py-2.5 text-right font-medium">Alt.-window increase</th>
                <th className="px-3 py-2.5 text-right font-medium">Verified</th>
                <th className="px-3 py-2.5 text-right font-medium" title="Verified ÷ committed">Attainment</th>
                <th className="px-3 py-2.5 font-medium">Limited by</th>
                <th className="px-3 py-2.5 text-right font-medium" title="Meter intervals received ÷ expected">Data completeness</th>
                <th className="px-5 py-2.5 text-right font-medium">Verified reward</th>
              </tr>
            </thead>
            <tbody>
              {run.participants.map((p) => (
                <tr key={p.orgId} className="cursor-pointer border-b border-line hover:bg-surface-2/50" onClick={() => setOpen(p)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setOpen(p)}>
                  <td className="px-5 py-3 font-medium">{p.businessName}</td>
                  <td className="px-3 py-3 text-right">{kwh(p.committedWh)}</td>
                  <td className="px-3 py-3 text-right">{kwh(p.peakReductionWh)}</td>
                  <td className="px-3 py-3 text-right">{kwh(p.reboundWh)}</td>
                  <td className="px-3 py-3 text-right font-semibold">{kwh(p.verifiedWh)}</td>
                  <td className="px-3 py-3 text-right">{attainmentPct(p.verifiedWh, p.committedWh).toFixed(1)}%</td>
                  <td className="px-3 py-3 text-ink-2">{LIMITED_BY_LABEL[p.limitedBy]}</td>
                  <td className="px-3 py-3 text-right">{p.coveragePct}%</td>
                  <td className="px-5 py-3 text-right">
                    <span className="inline-flex items-center gap-1.5 underline decoration-line-2 underline-offset-4">{money(p.rewardMinor)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="px-5 py-3">Total</td>
                <td className="px-3 py-3 text-right">{kwh(t.committedWh)}</td>
                <td className="px-3 py-3 text-right">{kwh(t.peakReductionWh)}</td>
                <td className="px-3 py-3 text-right">{kwh(t.reboundWh)}</td>
                <td className="px-3 py-3 text-right">{kwh(t.verifiedWh)}</td>
                <td className="px-3 py-3 text-right">{t.deliveryPct.toFixed(1)}%</td>
                <td />
                <td className="px-3 py-3 text-right">{t.coveragePct}%</td>
                <td className="px-5 py-3 text-right">{money(t.rewardMinor)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Panel>

      <Drawer open={!!open} onClose={() => setOpen(null)} title={open?.businessName ?? ""} subtitle={<>Evidence drilldown · <SimulatedNote /></>} width={560}>
        {open && <Evidence p={open} ev={ev} datasets={datasets.filter((d) => d.orgId === open.orgId)} />}
      </Drawer>
    </div>
  );
}

export function Evidence({ p, ev, datasets }: { p: ParticipantVerification; ev: DemandEvent; datasets: DS[] }) {
  const base = datasets.find((d) => d.type === "baseline");
  const act = datasets.find((d) => d.type === "event");
  const rows = [...windowIdx(ev.shift), ...windowIdx(ev.peak)];
  const line = (k: string, v: string, strong?: boolean) => (
    <div className={cx("flex justify-between py-1.5 text-[13px] num", strong && "font-semibold")}>
      <span className={strong ? "text-ink" : "text-ink-2"}>{k}</span>
      <span>{v}</span>
    </div>
  );
  return (
    <div className="space-y-5">
      <div className="divide-y divide-line rounded-[10px] border border-line px-4">
        {line("Accepted commitment", kwh(p.committedWh, 2))}
        {line("Baseline peak energy", kwh(p.baselinePeakWh, 2))}
        {line("Actual peak energy", kwh(p.actualPeakWh, 2))}
        {line("Peak reduction", kwh(p.peakReductionWh, 2))}
        {line("Baseline alternate-window energy", kwh(p.baselineShiftWh, 2))}
        {line("Actual alternate-window energy", kwh(p.actualShiftWh, 2))}
        {line("Alternate-window increase", kwh(p.reboundWh, 2))}
        {line("Verified shifted energy (min of the two, capped at commitment)", kwh(p.verifiedWh, 2), true)}
        {line("Commitment attainment", `${attainmentPct(p.verifiedWh, p.committedWh).toFixed(1)}%`)}
        {line("Agreed rate", rate(p.rateMinorPerKwh))}
        {line(`Reward = ${p.verifiedWh.toLocaleString()} Wh × ${p.rateMinorPerKwh}¢ ÷ 1000`, money(p.rewardMinor), true)}
      </div>
      <div className="flex items-center gap-2 text-[12px] text-ink-3">
        <ShieldCheck className="size-3.5" /> Server-calculated · meter data completeness {p.coveragePct}% ({p.receivedIntervals}/{p.expectedIntervals} intervals)
      </div>
      <div>
        <div className="mb-2 text-[13px] font-medium">Interval readings (Wh)</div>
        <div className="max-h-[360px] overflow-auto rounded-[10px] border border-line">
          <table className="w-full text-[12px] num">
            <thead className="sticky top-0 bg-surface-2 text-ink-2">
              <tr>
                <th className="px-3 py-1.5 text-left font-medium">Interval</th>
                <th className="px-3 py-1.5 text-left font-medium">Window</th>
                <th className="px-3 py-1.5 text-right font-medium">Baseline</th>
                <th className="px-3 py-1.5 text-right font-medium">Event</th>
                <th className="px-3 py-1.5 text-right font-medium">Δ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => {
                const b = base?.readings[i]?.wh ?? null;
                const a = act?.readings[i]?.wh ?? null;
                const peak = windowIdx(ev.peak).includes(i);
                return (
                  <tr key={i} className="border-t border-line">
                    <td className="px-3 py-1">{intervalLabel(i)}</td>
                    <td className={cx("px-3 py-1", peak ? "text-warning" : "text-info")}>{peak ? "Peak" : "Alternate"}</td>
                    <td className="px-3 py-1 text-right">{b ?? "missing"}</td>
                    <td className="px-3 py-1 text-right">{a ?? "missing"}</td>
                    <td className={cx("px-3 py-1 text-right", a != null && b != null && a - b < 0 ? "text-success" : "text-ink-2")}>{a != null && b != null ? (a - b > 0 ? "+" : "") + (a - b) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
