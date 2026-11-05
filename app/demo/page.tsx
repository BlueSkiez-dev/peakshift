import { readFresh } from "@/lib/store";
import { paypalMode } from "@/lib/paypal";
import { claudeEnabled } from "@/lib/ai/claude";
import { DemoEntry } from "./entry";

export const dynamic = "force-dynamic";

export default async function DemoPage() {
  const s = (await readFresh());
  const ev = s.events[0];
  const businesses = s.orgs
    .filter((o) => o.type === "participant")
    .map((o) => {
      const owner = s.users.find((u) => u.orgId === o.id)!;
      const pending = s.offers.filter((x) => x.orgId === o.id && x.status === "ACTION_REQUIRED").length;
      return { userId: owner.id, owner: owner.displayName, name: o.name, category: o.category ?? "", pending };
    });
  return <DemoEntry paypal={paypalMode()} ai={claudeEnabled() ? "claude" : "offline"} businesses={businesses} event={{ name: ev?.name ?? "", status: ev?.status ?? "DRAFT" }} />;
}
