import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { readFresh } from "@/lib/store";
import { paypalMode } from "@/lib/paypal";
import { BusinessShell } from "@/components/business-shell";

export const dynamic = "force-dynamic";

export default async function BusinessLayout({ children }: { children: React.ReactNode }) {
  const u = await currentUser();
  if (!u) redirect("/demo");
  if (u.role !== "business") redirect("/operator/overview");
  const s = (await readFresh());
  const org = s.orgs.find((o) => o.id === u.orgId)!;
  const pending = s.offers.filter((o) => o.orgId === org.id && o.status === "ACTION_REQUIRED").length;
  return (
    <BusinessShell org={{ name: org.name, site: org.siteLabel ?? "", category: org.category ?? "" }} owner={u.displayName} pending={pending} paypal={paypalMode()}>
      {children}
    </BusinessShell>
  );
}
