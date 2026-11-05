import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { readFresh } from "@/lib/store";
import { paypalMode } from "@/lib/paypal";
import { claudeEnabled } from "@/lib/ai/claude";
import { activeEvent, networkRows } from "@/lib/views";
import { OperatorShell } from "@/components/operator-shell";

export const dynamic = "force-dynamic";

export default async function OperatorLayout({ children }: { children: React.ReactNode }) {
  const u = await currentUser();
  if (!u) redirect("/demo");
  if (u.role === "business") redirect("/business/home");
  const s = (await readFresh());
  const ev = activeEvent(s);
  const net = networkRows(s, ev).map((r) => ({ orgId: r.orgId, name: r.name, capacityWh: r.capacityWh, status: r.status }));
  const offers = ev ? s.offers.filter((o) => o.eventId === ev.id && o.status !== "SUPERSEDED") : [];
  return (
    <OperatorShell
      user={{ name: u.displayName, role: u.role }}
      paypal={paypalMode()}
      ai={claudeEnabled() ? "claude" : "offline"}
      event={ev ? { id: ev.id, name: ev.name, status: ev.status } : null}
      network={net.map((n) => ({ ...n, offer: offers.find((o) => o.orgId === n.orgId)?.status ?? null }))}
    >
      {children}
    </OperatorShell>
  );
}
