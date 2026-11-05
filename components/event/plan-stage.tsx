"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Download, RefreshCw, Send, ShieldAlert, Sparkles } from "lucide-react";
import type { CandidateDecision, DemandEvent, DispatchPlan, Offer } from "@/lib/types";
import { api, useAction } from "@/lib/client";
import { kwh, money, rate, windowLabel, stamp } from "@/lib/format";
import { Badge, Button, Kpi, Notice, Panel, cx } from "../ui";
import { Dialog, useToast } from "../overlay";

const STEPS = ["Checking confirmed profiles", "Applying safety and time-window rules", "Comparing offer rates", "Building the least-cost allocation"];
const GROUPS: { code: CandidateDecision["reasonCode"][]; label: string; tone: "danger" | "neutral" | "warning" }[] = [
  { code: ["HARD_SAFETY_CRITICAL_LOAD"], label: "Hard safety exclusion", tone: "danger" },
  { code: ["NOT_NEEDED_TARGET_MET"], label: "Eligible — not needed for lowest-cost target", tone: "neutral" },
  { code: ["WINDOW_MISMATCH"], label: "Window mismatch", tone: "warning" },
  { code: ["INSUFFICIENT_DATA"], label: "Insufficient data", tone: "warning" },
  { code: ["CAPACITY_UNCONFIRMED", "RATE_MISSING", "PROFILE_UNCONFIRMED", "SUSPENDED"], label: "Missing confirmation", tone: "warning" },
];

export function PlanStage({ ev, plan, plans, offers }: { ev: DemandEvent; plan: DispatchPlan | null; plans: DispatchPlan[]; offers: Offer[] }) {
  const { run, pending, error } = useAction();
  const toast = useToast();
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [confirm, setConfirm] = useState(false);
  const funded = ev.funding.status === "FUNDED";
  const canOptimise = ["FUNDED", "PLAN_READY", "OFFERS_SENT"].includes(ev.status);
  const published = plan?.status === "published";
  const topUp = plans.some((p) => p.status === "published") && !published;

  async function optimise() {
    const t0 = performance.now();
    const r = await run("opt", () => api<DispatchPlan>(`events/${ev.id}/optimise`, { body: {} }));
    if (r) {
      setElapsed(Math.round(performance.now() - t0));
      toast({ tone: r.feasible ? "success" : "info", title: r.feasible ? `Plan v${r.version} ready — ${kwh(r.plannedWh)} for ${money(r.estCostMinor)}` : "Target not met", detail: r.feasible ? "Review the allocation, then publish offers." : r.infeasibleReason ?? undefined });
    }
  }
  async function publish() {
    setConfirm(false);
    const r = await run("pub", () => api<Offer[]>(`events/${ev.id}/offers/publish`, { body: { planId: plan!.id } }));
    if (r) toast({ tone: "success", title: `${r.length} offers published.`, detail: "Waiting for business responses." });
  }
  function exportCsv() {
    if (!plan) return;
    const head = ["business", "activity", "eligible", "selected", "reason_code", "capacity_kwh", "allocated_kwh", "rate_usd_per_kwh", "est_reward_usd", "window", "reason"];
    const rows = plan.candidates.map((c) => [c.businessName, c.activityName, c.eligible, c.selected, c.reasonCode, c.capacityWh / 1000, c.allocatedWh / 1000, c.rateMinorPerKwh == null ? "" : c.rateMinorPerKwh / 100, c.estRewardMinor / 100, c.window ? `${c.window.start}-${c.window.end}` : "", `"${c.reason.replace(/"/g, "'")}"`]);
    const blob = new Blob([[head, ...rows].map((r) => r.join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `peakshift-plan-${ev.id}-v${plan.version}.csv`;
    a.click();
  }

  if (!funded)
    return (
      <Notice tone="warning" title="Fund the event before optimising" action={<Link href={`/operator/events/${ev.id}?stage=fund`} className="text-[13px] font-medium text-ink underline">Go to funding</Link>}>
        Under the active configuration, offers can only be published for a funded event.
      </Notice>
    );

  const selected = plan?.candidates.filter((c) => c.selected) ?? [];
  const nc = plan?.candidates.find((c) => c.reasonCode === "HARD_SAFETY_CRITICAL_LOAD");

  return (
    <div className="space-y-4">
      {/* Before / controls */}
      <Panel
        title={plan ? `Dispatch plan v${plan.version}` : "Find the lowest-cost plan"}
        subtitle={plan ? <>Optimiser <code className="font-mono text-[11.5px]">{plan.optimiserVersion}</code> · inputs hash <code className="font-mono text-[11.5px]">{plan.inputsHash}</code> · {stamp(plan.createdAt)}</> : "Filters every business through hard eligibility gates, then fills the target in ascending rate order. Deterministic — the same inputs always give the same plan."}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {plan && <Button variant="ghost" size="sm" icon={<Download className="size-3.5" />} onClick={exportCsv}>Export CSV</Button>}
            {canOptimise && (
              <Button variant={plan ? "secondary" : "primary"} size={plan ? "sm" : "md"} onClick={optimise} loading={pending === "opt"} loadingLabel="Building plan…" icon={plan ? <RefreshCw className="size-3.5" /> : <Sparkles className="size-4" />}>
                {plan ? (topUp || ev.status === "OFFERS_SENT" ? "Re-optimise remaining" : "Rerun") : "Find the lowest-cost plan"}
              </Button>
            )}
          </div>
        }
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Kpi label="Target" value={((plan?.targetWh ?? ev.targetWh) / 1000).toFixed(1)} unit="kWh" sub={topUp ? "Remaining after acceptances" : `${ev.targetKw.toFixed(1)} kW avg`} />
          <Kpi label="Budget" value={money(plan?.budgetMinor ?? ev.budgetMinor)} sub="USD · captured" />
          <Kpi label="Eligible capacity" value={plan ? (plan.eligibleCapacityWh / 1000).toFixed(1) : "—"} unit={plan ? "kWh" : undefined} sub="Confirmed, safe, in-window" />
          <Kpi label="Candidates" value={plan ? plan.candidates.filter((c) => c.eligible).length : "—"} sub={plan ? `of ${plan.candidates.length} businesses` : "Run to evaluate"} />
          <Kpi label="Safety exclusions" value={plan ? plan.candidates.filter((c) => c.hard).length : "—"} tone={plan && plan.candidates.some((c) => c.hard) ? "warning" : "ink"} sub="Hard block — no override" />
        </div>

        {(pending === "opt" || elapsed != null) && (
          <ol className="mt-4 grid gap-2 sm:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s} className="flex items-center gap-2 rounded-[8px] border border-line bg-surface-2/50 px-3 py-2 text-[12.5px] anim-fade-up" style={{ animationDelay: `${i * 70}ms` }}>
                {pending === "opt" ? <span className="size-3.5 rounded-full border-2 border-ink-3 border-t-transparent animate-spin" /> : <Check className="size-3.5 text-signal" />}
                <span className={pending === "opt" ? "text-ink-2" : "text-ink"}>{s}</span>
              </li>
            ))}
            {elapsed != null && pending !== "opt" && <li className="sm:col-span-4 text-[12px] text-ink-3">Completed in {elapsed} ms (round trip). No artificial delay.</li>}
          </ol>
        )}
        {error && <Notice tone="danger" className="mt-4" title={error.message} />}
      </Panel>

      {plan && (
        <>
          {/* Lead with the result */}
          {plan.feasible ? (
            <div className="flex flex-wrap items-start justify-between gap-4 rounded-[12px] border border-signal/35 bg-signal-dim px-5 py-4 anim-fade-up">
              <div className="flex gap-3">
                <span className="mt-0.5 grid size-6 place-items-center rounded-full bg-signal text-signal-ink">
                  <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={3}><path className="check-draw" d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                </span>
                <div className="text-[14px]">
                  <div className="font-semibold text-ink">Commitment target covered.</div>
                  <div className="text-ink-2">
                    Planned commitments only — delivery is measured after the event. The plan allocates <b className="text-ink num">{kwh(plan.plannedWh)}</b> across {selected.length} businesses for an estimated <b className="text-ink num">{money(plan.estCostMinor)}</b>
                    .{nc ? <> {nc.businessName} was excluded because {nc.activityName.toLowerCase()} is marked as critical.</> : null}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {published ? (
                  <Badge tone="success">Offers sent {plan.publishedAt ? `· ${stamp(plan.publishedAt)}` : ""}</Badge>
                ) : plan.status === "ready" ? (
                  <Button variant="primary" onClick={() => setConfirm(true)} loading={pending === "pub"} loadingLabel="Publishing offers…" icon={<Send className="size-4" />}>
                    Publish {selected.length} offers
                  </Button>
                ) : null}
                {published && (
                  <Link href={`/operator/events/${ev.id}?stage=offers`} className="inline-flex h-10 items-center gap-1.5 rounded-[8px] border border-line-2 px-3 text-sm hover:bg-surface-2">
                    Track responses <ArrowRight className="size-4" />
                  </Link>
                )}
              </div>
            </div>
          ) : (
            <Notice tone="warning" title="Target not met — nothing will be published">
              {plan.infeasibleReason} {plan.minBudgetRequiredMinor ? `Minimum budget required: ${money(plan.minBudgetRequiredMinor)}.` : "Add eligible capacity or reduce the target before publishing."}
            </Notice>
          )}

          <MeritOrder plan={plan} />

          <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
            <Panel title="Selected for this event" subtitle="Each allocation and the deterministic reason it was chosen" bodyClass="!px-0">
              <div className="overflow-x-auto">
                <table className="[&_td.text-right]:whitespace-nowrap [&_th]:whitespace-nowrap w-full min-w-[720px] text-[13px]">
                  <thead>
                    <tr className="border-y border-line bg-surface-2/60 text-left text-[12px] text-ink-2">
                      <th className="sticky left-0 bg-surface-2 px-5 py-2.5 font-medium">Business</th>
                      <th className="px-3 py-2.5 text-right font-medium">Available</th>
                      <th className="px-3 py-2.5 text-right font-medium">Allocated</th>
                      <th className="px-3 py-2.5 text-right font-medium">Rate</th>
                      <th className="px-3 py-2.5 text-right font-medium">Est. reward</th>
                      <th className="px-3 py-2.5 font-medium">Shift window</th>
                      <th className="px-5 py-2.5 font-medium">Why selected</th>
                    </tr>
                  </thead>
                  <tbody className="num">
                    {selected.map((c, i) => {
                      const o = offers.find((x) => x.planId === plan.id && x.orgId === c.orgId);
                      return (
                        <tr key={c.orgId} className="border-b border-line anim-fade-up" style={{ animationDelay: `${120 + i * 60}ms` }}>
                          <td className="sticky left-0 bg-surface px-5 py-3">
                            <div className="font-medium">{c.businessName}</div>
                            <div className="text-[12px] text-ink-3">{c.activityName}{o ? ` · offer ${o.status.toLowerCase().replace("_", " ")}` : ""}</div>
                          </td>
                          <td className="px-3 py-3 text-right text-ink-2">{kwh(c.capacityWh)}</td>
                          <td className="px-3 py-3 text-right font-semibold">{kwh(c.allocatedWh)}</td>
                          <td className="px-3 py-3 text-right">{rate(c.rateMinorPerKwh)}</td>
                          <td className="px-3 py-3 text-right">{money(c.estRewardMinor)}</td>
                          <td className="px-3 py-3 text-ink-2">{windowLabel(c.window)}</td>
                          <td className="px-5 py-3 text-[12.5px] text-ink-2">{c.reason}</td>
                        </tr>
                      );
                    })}
                    {!selected.length && (
                      <tr>
                        <td colSpan={7} className="px-5 py-6 text-center text-ink-3">No feasible selection.</td>
                      </tr>
                    )}
                  </tbody>
                  {selected.length > 0 && (
                    <tfoot className="num">
                      <tr className="text-[13px]">
                        <td className="sticky left-0 bg-surface px-5 py-3 font-semibold">Total</td>
                        <td />
                        <td className="px-3 py-3 text-right font-semibold">{kwh(plan.plannedWh)}</td>
                        <td className="px-3 py-3 text-right text-ink-3">—</td>
                        <td className="px-3 py-3 text-right font-semibold">{money(plan.estCostMinor)}</td>
                        <td colSpan={2} className="px-5 py-3 text-[12.5px] text-ink-2">
                          {plan.feasible ? `Commitment target covered; ${money(plan.budgetMinor - plan.estCostMinor)} of budget not allocated by the plan` : ""}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </Panel>

            <Panel title="Not selected / excluded" subtitle="Unselected isn't the same as ineligible">
              <div className="space-y-4">
                {GROUPS.map((g) => {
                  const items = plan.candidates.filter((c) => g.code.includes(c.reasonCode) && !c.selected);
                  if (!items.length) return null;
                  return (
                    <div key={g.label}>
                      <div className="mb-2 flex items-center gap-2">
                        <Badge tone={g.tone}>{g.label}</Badge>
                      </div>
                      <ul className="space-y-2">
                        {items.map((c) => (
                          <li key={c.orgId} className={cx("rounded-[10px] border px-3.5 py-2.5", c.hard ? "border-danger/35 bg-danger-dim" : "border-line bg-surface-2/50")}>
                            <div className="flex items-center justify-between gap-2">
                              <span className="flex items-center gap-1.5 text-[13.5px] font-medium">
                                {c.hard && <ShieldAlert className="size-3.5 text-danger" />}
                                {c.businessName}
                              </span>
                              <code className="font-mono text-[10.5px] text-ink-3">{c.reasonCode}</code>
                            </div>
                            <p className="mt-1 text-[12.5px] text-ink-2">{c.reason}</p>
                            {c.hard && <p className="mt-1.5 text-[11.5px] text-danger">No override exists in the planner. Changing a safety declaration requires the business to edit and re-confirm its profile.</p>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </Panel>
          </div>

          {plans.length > 1 && (
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
              Plan versions:
              {plans.map((p) => (
                <span key={p.id} className={cx("rounded-md border px-2 py-0.5 num", p.id === plan.id ? "border-line-2 text-ink" : "border-line")}>
                  v{p.version} · {p.status}
                </span>
              ))}
              <span>Published offers keep their plan reference.</span>
            </div>
          )}
        </>
      )}

      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={`Publish ${selected.length} offers?`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button>
            <Button variant="primary" onClick={publish} icon={<Send className="size-4" />}>Publish {selected.length} offers</Button>
          </>
        }
      >
        {plan && (
          <div className="space-y-3 text-[13px]">
            <ul className="divide-y divide-line rounded-[10px] border border-line">
              {selected.map((c) => (
                <li key={c.orgId} className="flex items-center justify-between px-3.5 py-2 num">
                  <span>{c.businessName}</span>
                  <span className="text-ink-2">
                    {kwh(c.allocatedWh)} · {money(c.estRewardMinor)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex justify-between num"><span className="text-ink-2">Total allocated</span><b>{kwh(plan.plannedWh)}</b></div>
            <div className="flex justify-between num"><span className="text-ink-2">Estimated reward</span><b>{money(plan.estCostMinor)}</b></div>
            <div className="flex justify-between"><span className="text-ink-2">Offer valid until</span><b>{new Date(`${ev.eventDate}T09:00:00+01:00`).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" })} WAT</b></div>
            <Notice tone="info">Businesses must still accept. Publishing creates offers — it does not commit anyone.</Notice>
          </div>
        )}
      </Dialog>
    </div>
  );
}

/** Merit-order stack: eligible capacity sorted by price, the target line, and what got dispatched. */
function MeritOrder({ plan }: { plan: DispatchPlan }) {
  const eligible = useMemo(() => plan.candidates.filter((c) => c.eligible).sort((a, b) => (a.rateMinorPerKwh ?? 0) - (b.rateMinorPerKwh ?? 0)), [plan]);
  const total = Math.max(plan.targetWh * 1.15, eligible.reduce((a, c) => a + c.capacityWh, 0));
  const targetPct = (plan.targetWh / total) * 100;
  return (
    <Panel title="Merit order" subtitle="Eligible capacity stacked from cheapest to most expensive. Everything left of the target line is dispatched.">
      <div className="relative pt-7 pb-2">
        <div className="relative flex h-16 overflow-hidden rounded-[10px] border border-line bg-surface-2/40">
          {eligible.map((c, i) => {
            const w = (c.capacityWh / total) * 100;
            const allocW = (c.allocatedWh / total) * 100;
            return (
              <div key={c.orgId} className="relative h-full border-r border-bg/60" style={{ width: `${w}%` }} title={`${c.businessName}: ${kwh(c.capacityWh)} at ${rate(c.rateMinorPerKwh)}`}>
                <div className={cx("absolute inset-y-0 left-0 anim-bar", c.selected ? "bg-signal" : "hatch bg-surface-3")} style={{ width: c.selected ? `${(allocW / w) * 100}%` : "100%", animationDelay: `${i * 90}ms` }} />
                <div className={cx("relative flex h-full flex-col justify-center px-2.5 text-[11.5px] leading-tight", c.selected ? "text-signal-ink" : "text-ink-2")}>
                  <span className="truncate font-semibold">{c.businessName}</span>
                  <span className="truncate num opacity-80">
                    {kwh(c.capacityWh)} · {rate(c.rateMinorPerKwh)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="absolute top-0 bottom-0 flex flex-col items-center" style={{ left: `calc(${targetPct}% - 1px)` }}>
          <span className="whitespace-nowrap rounded bg-ink px-1.5 py-0.5 text-[10.5px] font-semibold text-bg num">Target {kwh(plan.targetWh)}</span>
          <span className="w-0.5 flex-1 bg-ink" />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-ink-3">
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-signal" /> Dispatched</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-surface-3 hatch border border-line" /> Eligible, not needed</span>
        <span>Critical loads and window mismatches never enter the stack.</span>
      </div>
    </Panel>
  );
}
