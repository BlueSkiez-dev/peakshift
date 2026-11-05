import { notFound } from "next/navigation";
import { pageUser } from "@/lib/auth";
import { readFresh } from "@/lib/store";
import { offerView, withEffectiveStatus } from "@/lib/business-view";
import { scenarioNowMs } from "@/lib/clock";
import { OfferDetail } from "@/components/offer-detail";

export const dynamic = "force-dynamic";

export default async function OfferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await pageUser();
  const s = (await readFresh());
  const o = s.offers.find((x) => x.id === id);
  if (!o || o.orgId !== u.orgId) notFound(); // never reveal another business's offer
  return <OfferDetail v={offerView(s, withEffectiveStatus(o, scenarioNowMs(s)))} />;
}
