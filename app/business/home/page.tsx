import { BizLink } from "@/components/biz-link";
import { ArrowRight, CalendarClock, CheckCircle2, ShieldCheck, SlidersHorizontal, Wallet } from "lucide-react";
import { pageUser } from "@/lib/auth";
import { readFresh } from "@/lib/store";
import { latestProfile } from "@/lib/services";
import { earningsFor } from "@/lib/business-view";
import { clock, dateLabel, kwh, money, windowLabel } from "@/lib/format";
import { OFFER_STATUS } from "@/lib/status";
import { Badge, StatusBadge, cx } from "@/components/ui";
import { EarningBadge } from "@/components/business-bits";

export const dynamic = "force-dynamic";

export default async function BusinessHome() {
  const u = await pageUser();
  const s = (await readFresh());
  const org = s.orgs.find((o) => o.id === u.orgId)!;
  const offers = s.offers.filter((o) => o.orgId === org.id && o.status !== "SUPERSEDED").sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const pending = offers.find((o) => o.status === "ACTION_REQUIRED");
  const committed = offers.filter((o) => o.status === "ACCEPTED");
  const profile = latestProfile(s, org.id, "confirmed");
  const draft = s.profiles.find((p) => p.orgId === org.id && p.status === "draft");
  const earnings = earningsFor(s, org.id);
  const flexible = profile?.activities.filter((a) => !a.isCritical) ?? [];
  const critical = profile?.activities.filter((a) => a.isCritical) ?? [];

  return (
    <div className="space-y-5">
      <div className="anim-fade-up">
        <p className="text-[13px] text-ink-2">Good to see you, {u.displayName.split(" ")[0]}.</p>
        <h1 className="mt-0.5 text-[26px] font-semibold tracking-[-0.025em]">{pending ? "You have an offer to review" : committed.length ? "You're committed to a shift" : "Your flexibility at a glance"}</h1>
        <p className="mt-1 text-[13.5px] text-ink-2">Taking part is always voluntary. Critical equipment is never included.</p>
      </div>

      {pending && (
        <BizLink href={`/business/offers/${pending.id}`} className="group block overflow-hidden rounded-[16px] border border-brand/20 bg-surface shadow-[var(--shadow)] anim-fade-up">
          <div className="flex items-center justify-between bg-brand px-5 py-3 text-white">
            <span className="flex items-center gap-2 text-[13px] font-medium">
              <CalendarClock className="size-4 text-signal" /> Offer for your business
            </span>
            <span className="rounded-full bg-signal px-2 py-0.5 text-[11px] font-semibold text-signal-ink">Action required</span>
          </div>
          <div className="px-5 py-4">
            <div className="text-[13px] text-ink-2">{dateLabel(s.events.find((e) => e.id === pending.eventId)!.eventDate)}</div>
            <div className="mt-1 text-[18px] font-semibold tracking-[-0.01em]">
              Move your {pending.activityName.toLowerCase()} to {windowLabel(pending.shiftWindow)}
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              {[
                ["Shift", kwh(pending.allocatedWh)],
                ["Earn up to", money(pending.maxRewardMinor)],
                ["Avoid", windowLabel(s.events.find((e) => e.id === pending.eventId)!.peak)],
              ].map(([k, v]) => (
                <div key={k} className="rounded-[10px] bg-surface-2 px-2 py-2.5">
                  <div className="text-[11px] text-ink-3">{k}</div>
                  <div className="mt-0.5 text-[14px] font-semibold num">{v}</div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between">
              <span className="text-[12px] text-ink-3">Respond by {new Date(pending.expiresAt).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" })} WAT</span>
              <span className="inline-flex items-center gap-1.5 rounded-[8px] bg-brand px-4 py-2.5 text-[14px] font-semibold text-white">
                Review offer <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
              </span>
            </div>
          </div>
        </BizLink>
      )}

      {committed.length > 0 && (
        <section className="rounded-[14px] border border-line bg-surface p-5">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold">
            <CheckCircle2 className="size-4 text-success" /> What you&apos;ve committed to
          </h2>
          <ul className="mt-3 space-y-2">
            {committed.map((o) => {
              const ev = s.events.find((e) => e.id === o.eventId)!;
              return (
                <li key={o.id}>
                  <BizLink href={`/business/offers/${o.id}`} className="flex items-center justify-between gap-3 rounded-[10px] bg-surface-2/70 px-4 py-3 hover:bg-surface-2">
                    <span className="min-w-0">
                      <span className="block text-[14px] font-medium">{o.activityName}</span>
                      <span className="block text-[12.5px] text-ink-2 num">
                        {dateLabel(ev.eventDate)} · {kwh(o.allocatedWh)} between {clock(o.shiftWindow.start)} and {clock(o.shiftWindow.end)}
                      </span>
                    </span>
                    <StatusBadge meta={OFFER_STATUS[o.status]} />
                  </BizLink>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <BizLink href="/business/flexibility" className="group rounded-[14px] border border-line bg-surface p-5 hover:border-line-2">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-[15px] font-semibold">
              <SlidersHorizontal className="size-4 text-ink-3" /> My flexibility
            </span>
            {draft ? <Badge tone="warning">Draft needs review</Badge> : profile ? <Badge tone="success">Confirmed v{profile.version}</Badge> : <Badge tone="warning">Not set up</Badge>}
          </div>
          <ul className="mt-3 space-y-1.5 text-[13px]">
            {flexible.map((a) => (
              <li key={a.id} className="flex justify-between gap-3">
                <span className="text-ink">{a.name}</span>
                <span className="text-ink-2 num">{kwh(a.maxShiftWh)} · {windowLabel(a.window)}</span>
              </li>
            ))}
            {critical.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3">
                <span className="text-ink">{a.name}</span>
                <span className="flex items-center gap-1 text-[12px] text-danger">
                  <ShieldCheck className="size-3.5" /> Never interrupted
                </span>
              </li>
            ))}
          </ul>
          <span className="mt-3 inline-flex items-center gap-1 text-[13px] text-brand group-hover:underline">
            Update with AI <ArrowRight className="size-3.5" />
          </span>
        </BizLink>

        <BizLink href="/business/earnings" className="group rounded-[14px] border border-line bg-surface p-5 hover:border-line-2">
          <span className="flex items-center gap-2 text-[15px] font-semibold">
            <Wallet className="size-4 text-ink-3" /> Earnings
          </span>
          {earnings.length ? (
            <ul className="mt-3 space-y-2">
              {earnings.slice(0, 3).map((e) => (
                <li key={e.offerId} className="flex items-center justify-between gap-3 text-[13px]">
                  <span className="min-w-0 truncate">{e.eventName}</span>
                  <span className="flex items-center gap-2">
                    <span className={cx("font-semibold num", e.state === "PAID" && "text-success")}>{money(e.rewardMinor ?? e.potentialMinor)}</span>
                    <EarningBadge state={e.state} />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-[13px] text-ink-2">No earnings yet. Rewards appear here after an event you accepted is verified.</p>
          )}
          <span className="mt-3 inline-flex items-center gap-1 text-[13px] text-brand group-hover:underline">
            View earnings <ArrowRight className="size-3.5" />
          </span>
        </BizLink>
      </div>
    </div>
  );
}
