import { readFresh } from "@/lib/store";
import { scenarioNowMs } from "@/lib/clock";
import { paypalMode, webhookConfigured } from "@/lib/paypal";
import { PageHeader } from "@/components/ui";
import { PaymentsView } from "@/components/payments-view";

export const dynamic = "force-dynamic";

export default async function Payments({ searchParams }: { searchParams: Promise<{ batch?: string }> }) {
  const sp = await searchParams;
  const s = (await readFresh());
  const batches = s.batches;
  const events = Object.fromEntries(s.events.map((e) => [e.id, { name: e.name, funding: e.funding }]));
  return (
    <div>
      <PageHeader title="Payments" desc="Reconcile every PayPal transaction: event funding, payout batches and recipient-level item status — tracked separately and never inferred from a batch status." />
      <PaymentsView batches={batches} events={events} webhooks={s.webhooks.slice(0, 30)} selectedId={sp.batch ?? batches[0]?.id ?? null} mode={paypalMode()} webhookReady={webhookConfigured()} now={scenarioNowMs(s)} />
    </div>
  );
}
