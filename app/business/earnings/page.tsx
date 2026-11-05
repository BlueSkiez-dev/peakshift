import { Wallet } from "lucide-react";
import { pageUser } from "@/lib/auth";
import { readFresh } from "@/lib/store";
import { earningsFor } from "@/lib/business-view";
import { refreshPayout } from "@/lib/services";
import { dateLabel, kwh, money, stamp } from "@/lib/format";
import { Empty, cx } from "@/components/ui";
import { EARNING, EarningBadge } from "@/components/business-bits";
import { AutoRefresh } from "@/components/auto-refresh";

export const dynamic = "force-dynamic";

export default async function Earnings() {
  const u = await pageUser();
  // Simulator batches advance on reconciliation reads (real sandbox batches advance via verified webhooks).
  for (const b of (await readFresh()).batches.filter((b) => b.provider === "paypal-simulator" && b.items.some((i) => i.orgId === u.orgId) && !["SUCCESS", "DENIED", "FAILED"].includes(b.status))) {
    await refreshPayout(null, b.id, "simulator").catch(() => null);
  }
  const s = (await readFresh());
  const rows = earningsFor(s, u.orgId);
  const paid = rows.filter((r) => r.state === "PAID").reduce((a, r) => a + (r.rewardMinor ?? 0), 0);
  const earned = rows.filter((r) => r.rewardMinor != null).reduce((a, r) => a + (r.rewardMinor ?? 0), 0);
  return (
    <div className="space-y-5">
      <AutoRefresh active={rows.some((r) => r.state === "PROCESSING")} />
      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.025em]">Earnings</h1>
        <p className="mt-1 text-[13.5px] text-ink-2">Earned and paid are shown separately. “Paid” appears only once PayPal confirms your payout.</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-[14px] border border-line bg-surface p-4">
          <div className="text-[12px] text-ink-3">Verified rewards</div>
          <div className="mt-1 text-[26px] font-semibold num">{money(earned)}</div>
        </div>
        <div className="rounded-[14px] border border-line bg-surface p-4">
          <div className="text-[12px] text-ink-3">Paid to you</div>
          <div className={cx("mt-1 text-[26px] font-semibold num", paid > 0 && "text-success")}>{money(paid)}</div>
        </div>
      </div>
      {rows.length === 0 ? (
        <Empty icon={<Wallet className="size-6" />} title="No earnings yet">Accept an offer and shift your usage; your reward appears here once the event is verified.</Empty>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.offerId} className="rounded-[14px] border border-line bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-[15px] font-semibold">{r.eventName}</div>
                  <div className="text-[12.5px] text-ink-2">{dateLabel(r.eventDate)} · {r.activity}</div>
                </div>
                <EarningBadge state={r.state} />
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-[10px] bg-surface-2 p-2.5">
                  <dt className="text-[11px] text-ink-3">Committed</dt>
                  <dd className="mt-0.5 text-[14px] font-semibold num">{kwh(r.committedWh)}</dd>
                </div>
                <div className="rounded-[10px] bg-surface-2 p-2.5">
                  <dt className="text-[11px] text-ink-3">Verified</dt>
                  <dd className="mt-0.5 text-[14px] font-semibold num">{r.verifiedWh == null ? "—" : kwh(r.verifiedWh)}</dd>
                </div>
                <div className="rounded-[10px] bg-surface-2 p-2.5">
                  <dt className="text-[11px] text-ink-3">{r.rewardMinor == null ? "Potential reward" : "Verified reward"}</dt>
                  <dd className={cx("mt-0.5 text-[14px] font-semibold num", r.state === "PAID" && "text-success")}>{money(r.rewardMinor ?? r.potentialMinor)}</dd>
                </div>
              </dl>
              <p className="mt-3 text-[12.5px] text-ink-2">{EARNING[r.state].hint}{r.limitedBy === "rebound" ? " Your verified energy was limited by the usage measured in the alternate window." : ""}</p>
              {(r.reference || r.batchRef) && (
                <p className="mt-1.5 font-mono text-[11.5px] text-ink-3">
                  {r.provider === "paypal-simulator" ? "PayPal simulator" : "PayPal"} ref {(r.reference ?? r.batchRef)!.slice(0, 18)}… {r.updatedAt ? `· ${stamp(r.updatedAt)}` : ""}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-[12px] text-ink-3">You only ever see your own rewards and payouts.</p>
    </div>
  );
}
