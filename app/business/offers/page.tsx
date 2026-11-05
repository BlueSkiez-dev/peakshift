import Link from "next/link";
import { ArrowRight, Inbox } from "lucide-react";
import { pageUser } from "@/lib/auth";
import { readFresh } from "@/lib/store";
import { OFFER_STATUS } from "@/lib/status";
import { dateLabel, kwh, money, windowLabel } from "@/lib/format";
import { StatusBadge, Empty } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Offers() {
  const u = await pageUser();
  const s = (await readFresh());
  const offers = s.offers.filter((o) => o.orgId === u.orgId).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.025em]">Offers</h1>
        <p className="mt-1 text-[13.5px] text-ink-2">Each offer is a specific request: what to move, when, and what you can earn. You decide.</p>
      </div>
      {offers.length === 0 ? (
        <Empty icon={<Inbox className="size-6" />} title="No offers yet" action={<Link href="/business/flexibility" className="rounded-[8px] bg-brand px-4 py-2 text-sm font-semibold text-white">Review my flexibility</Link>}>
          When the programme needs your flexibility, an offer will appear here. Keeping your profile confirmed makes you eligible.
        </Empty>
      ) : (
        <ul className="space-y-3">
          {offers.map((o) => {
            const ev = s.events.find((e) => e.id === o.eventId)!;
            return (
              <li key={o.id}>
                <Link href={`/business/offers/${o.id}`} className="block rounded-[14px] border border-line bg-surface p-4 hover:border-line-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[12.5px] text-ink-2">{dateLabel(ev.eventDate)}</span>
                    <StatusBadge meta={OFFER_STATUS[o.status]} />
                  </div>
                  <div className="mt-1.5 text-[16px] font-semibold">{o.activityName}</div>
                  <div className="mt-1 text-[13px] text-ink-2 num">
                    Avoid {windowLabel(ev.peak)} · move to {windowLabel(o.shiftWindow)} · {kwh(o.allocatedWh)} · up to {money(o.maxRewardMinor)}
                  </div>
                  <div className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-brand">
                    Review offer <ArrowRight className="size-3.5" />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
