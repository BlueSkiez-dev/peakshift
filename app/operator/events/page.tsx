import Link from "next/link";
import { CalendarPlus } from "lucide-react";
import { readFresh } from "@/lib/store";
import { EVENT_STATUS, FUNDING_STATUS } from "@/lib/status";
import { dateLabel, kwh, money, windowLabel } from "@/lib/format";
import { PageHeader, Panel, StatusBadge } from "@/components/ui";
import { Pipeline } from "@/components/pipeline";

export const dynamic = "force-dynamic";

export default async function Events() {
  const s = (await readFresh());
  return (
    <div>
      <PageHeader
        title="Events"
        desc="Every demand event, its funding and where it sits in the pipeline."
        actions={
          <Link href="/operator/events/new" className="inline-flex h-10 items-center gap-2 rounded-[8px] bg-signal px-4 text-sm font-semibold text-signal-ink">
            <CalendarPlus className="size-4" /> Create event
          </Link>
        }
      />
      <div className="space-y-3">
        {s.events.map((e) => {
          const accepted = s.offers.filter((o) => o.eventId === e.id && o.status === "ACCEPTED").reduce((a, o) => a + o.allocatedWh, 0);
          return (
            <Panel key={e.id}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <Link href={`/operator/events/${e.id}`} className="text-[16px] font-semibold hover:underline underline-offset-4">
                    {e.name}
                  </Link>
                  <div className="mt-1 text-[13px] text-ink-2 num">
                    {dateLabel(e.eventDate)} · Peak {windowLabel(e.peak)} · Alternate {windowLabel(e.shift)} · {kwh(e.targetWh)} · {money(e.budgetMinor)} · accepted {kwh(accepted)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge meta={FUNDING_STATUS[e.funding.status]} />
                  <StatusBadge meta={EVENT_STATUS[e.status]} />
                </div>
              </div>
              <div className="mt-4">
                <Pipeline status={e.status} eventId={e.id} compact />
              </div>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}
