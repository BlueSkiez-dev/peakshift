import { notFound } from "next/navigation";
import Link from "next/link";
import { readFresh } from "@/lib/store";
import { currentStage, type Stage } from "@/lib/next";
import { EVENT_STATUS, FUNDING_STATUS } from "@/lib/status";
import { dateLabel, kwh, money, windowLabel } from "@/lib/format";
import { paypalMode, paypalPublicClientId } from "@/lib/paypal";
import { demandSeries } from "@/lib/views";
import { PageHeader, StatusBadge, Badge } from "@/components/ui";
import { Pipeline } from "@/components/pipeline";
import { FundStage } from "@/components/event/fund-stage";
import { PlanStage } from "@/components/event/plan-stage";
import { OffersStage, ExecuteStage } from "@/components/event/run-stages";
import { VerifyStage } from "@/components/event/verify-stage";
import { SettleStage, PayoutsStage } from "@/components/event/settle-stage";
import { EventOutcome } from "@/components/event/outcome";

export const dynamic = "force-dynamic";

export default async function EventPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ stage?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const s = (await readFresh());
  const ev = s.events.find((e) => e.id === id);
  if (!ev) notFound();
  const stage = (sp.stage as Stage) ?? currentStage(ev.status);
  const plans = s.plans.filter((p) => p.eventId === id);
  const plan = plans.find((p) => p.id === ev.activePlanId) ?? null;
  const offers = s.offers.filter((o) => o.eventId === id);
  const run = s.verifications.find((v) => v.id === ev.verificationRunId) ?? null;
  const settlement = s.settlements.find((x) => x.id === ev.settlementId) ?? null;
  const batch = s.batches.find((b) => b.eventId === id) ?? null;
  const orgs = s.orgs.filter((o) => o.type === "participant").map((o) => ({ id: o.id, name: o.name, category: o.category ?? "", ownerId: s.users.find((u) => u.orgId === o.id)?.id ?? "" }));
  const series = demandSeries(s, ev);
  const datasets = s.datasets.filter((d) => d.eventId === id).map((d) => ({ orgId: d.orgId, type: d.type, readings: d.readings }));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-1.5">
            <Link href="/operator/events" className="hover:text-ink">
              Events
            </Link>
            <span>/</span>
            <span className="text-ink-2">{ev.id}</span>
          </span>
        }
        title={ev.name}
        desc={`${dateLabel(ev.eventDate)} · Peak ${windowLabel(ev.peak)} · Alternate ${windowLabel(ev.shift)} · ${kwh(ev.targetWh)} target (${ev.targetKw.toFixed(1)} kW avg) · ${money(ev.budgetMinor)} budget`}
        meta={
          <>
            <StatusBadge meta={EVENT_STATUS[ev.status]} />
            {ev.status !== "AWAITING_FUNDING" && <StatusBadge meta={FUNDING_STATUS[ev.funding.status]} />}
            {ev.aiProposedFields.length > 0 && <Badge tone="info">{ev.aiProposedFields.length} fields AI-proposed · confirmed by operator</Badge>}
          </>
        }
      />
      <Pipeline status={ev.status} eventId={ev.id} active={stage} />
      {run && run.status === "VERIFIED" && ["SETTLEMENT_REVIEW", "PAYOUT_PROCESSING", "PAID", "NEEDS_ATTENTION"].includes(ev.status) && <EventOutcome ev={ev} run={run} batch={batch} />}
      <div key={stage} className="anim-fade-up">
        {stage === "fund" && <FundStage ev={ev} mode={paypalMode()} clientId={paypalPublicClientId()} />}
        {stage === "plan" && <PlanStage ev={ev} plan={plan} plans={plans} offers={offers} />}
        {stage === "offers" && <OffersStage ev={ev} offers={offers} orgs={orgs} plan={plan} />}
        {stage === "execute" && <ExecuteStage ev={ev} offers={offers} orgs={orgs} series={series} />}
        {stage === "verify" && <VerifyStage ev={ev} run={run} series={series} datasets={datasets} />}
        {stage === "settle" && <SettleStage ev={ev} run={run} settlement={settlement} batch={batch} />}
        {stage === "payouts" && <PayoutsStage ev={ev} batch={batch} settlement={settlement} />}
      </div>
    </div>
  );
}
