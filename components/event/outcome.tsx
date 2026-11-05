import type { DemandEvent, PayoutBatch, VerificationRun } from "@/lib/types";
import { kwh, money } from "@/lib/format";
import { cx } from "../ui";

/**
 * Final event outcome. Keeps planned commitment, verified delivery and money paid visibly separate:
 * committed ≠ delivered, and "rewards paid" counts only PayPal-confirmed recipient items.
 */
export function EventOutcome({ ev, run, batch }: { ev: DemandEvent; run: VerificationRun; batch: PayoutBatch | null }) {
  const t = run.totals;
  const shortfallWh = Math.max(0, t.committedWh - t.verifiedWh);
  const paidItems = batch?.items.filter((i) => i.status === "SUCCEEDED") ?? [];
  const paidMinor = paidItems.reduce((a, i) => a + i.amountMinor, 0);
  const allPaid = !!batch && batch.items.length > 0 && paidItems.length === batch.items.length;
  const unallocatedMinor = ev.funding.amountMinor - t.rewardMinor;
  const cells: { k: string; v: string; sub: string; tone?: "success" | "warning" | "signal" }[] = [
    { k: "Committed (plan)", v: kwh(t.committedWh), sub: "Accepted commitments — not delivered energy" },
    { k: "Verified shifted energy", v: kwh(t.verifiedWh), sub: "Measured from meter data", tone: "success" },
    { k: "Delivery", v: `${t.deliveryPct}%`, sub: `${kwh(t.verifiedWh)} of ${kwh(t.committedWh)} committed` },
    { k: "Delivery shortfall", v: kwh(shortfallWh), sub: shortfallWh ? "Committed but not verified — not paid" : "None", tone: shortfallWh ? "warning" : undefined },
    {
      k: "Rewards paid",
      v: money(paidMinor),
      sub: batch ? `${paidItems.length} of ${batch.items.length} recipient items PayPal-confirmed${allPaid ? "" : ` · ${money(t.rewardMinor)} approved`}` : `${money(t.rewardMinor)} verified reward · not yet paid`,
      tone: allPaid ? "signal" : undefined,
    },
    { k: "Unallocated budget remaining", v: money(unallocatedMinor), sub: `of ${money(ev.funding.amountMinor)} budget funded` },
  ];
  return (
    <section aria-label="Event outcome" className="rounded-[14px] border border-line bg-surface px-5 py-4 md:px-6">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold">Event outcome</h2>
        <span className="text-[12px] text-ink-3">Commitment target covered by the plan · delivery measured after the event</span>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-3 xl:grid-cols-6">
        {cells.map((c) => (
          <div key={c.k} className="min-w-0">
            <dt className="text-[11.5px] text-ink-3">{c.k}</dt>
            <dd className={cx("mt-0.5 text-[20px] font-semibold tracking-[-0.01em] num", c.tone === "success" && "text-success", c.tone === "warning" && "text-warning", c.tone === "signal" && "text-signal")}>{c.v}</dd>
            <dd className="text-[11.5px] leading-snug text-ink-3">{c.sub}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 border-t border-line pt-3 text-[12px] text-ink-3">
        The {money(ev.funding.amountMinor)} budget was captured by PayPal Checkout into the operator&apos;s PayPal account — it is not held in escrow. Rewards are paid from that account by PayPal Payouts; the unallocated {money(unallocatedMinor)} stays with the operator.
      </p>
    </section>
  );
}
