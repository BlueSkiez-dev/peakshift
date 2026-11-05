import { readFresh } from "@/lib/store";
import { activeEvent, networkRows } from "@/lib/views";
import { PageHeader } from "@/components/ui";
import { NetworkView } from "@/components/network-view";

export const dynamic = "force-dynamic";

export default async function Network({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  const sp = await searchParams;
  const s = (await readFresh());
  const ev = activeEvent(s);
  const rows = networkRows(s, ev);
  const history = Object.fromEntries(rows.map((r) => [r.orgId, s.audit.filter((a) => a.entityType === "profile" && s.profiles.some((p) => p.id === a.entityId && p.orgId === r.orgId)).slice(0, 6)]));
  const drafts = Object.fromEntries(s.profiles.filter((p) => p.status === "draft" || p.draft).map((p) => [p.orgId, p.draft]));
  return (
    <div>
      <PageHeader title="Flexibility network" desc="The businesses behind the capacity: confirmed profiles, safe windows, minimum rates and safety status — sorted by readiness, not alphabetically." />
      <NetworkView rows={rows} initial={sp.org ?? null} shift={ev?.shift ?? null} history={history} drafts={drafts} />
    </div>
  );
}
