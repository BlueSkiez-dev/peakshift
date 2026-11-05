import { redirect } from "next/navigation";
import { pageUser } from "@/lib/auth";
import { readFresh } from "@/lib/store";
import { buildStudioData } from "@/lib/analytics-contract";
import { buildDatasets } from "@/lib/analytics";
import { getOrCreateEventReport } from "@/lib/reports";
import { claudeEnabled } from "@/lib/ai/claude";
import { EVENT_STATUS } from "@/lib/status";
import { dateLabel, windowLabel } from "@/lib/format";
import { PageHeader, Badge, StatusBadge } from "@/components/ui";
import { IntelligenceClient } from "@/components/intelligence/client";

export const dynamic = "force-dynamic";

export default async function Intelligence({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const u = await pageUser();
  if (u.role === "business") redirect("/business/home");
  const sp = await searchParams;
  const s = (await readFresh());
  const ev = s.events.find((e) => e.id === sp.event) ?? s.events.find((e) => e.verificationRunId) ?? s.events[0];
  const bootstrap = buildStudioData(s, ev);
  const report = await getOrCreateEventReport(u, ev.id);
  const ai = claudeEnabled();
  // AG Studio licence keys are designed to be used in the browser; read from server env and pass down.
  const licenseKey = process.env.AG_STUDIO_LICENSE_KEY ?? process.env.AG_STUDIO ?? process.env.NEXT_PUBLIC_AG_STUDIO_LICENSE_KEY ?? null;
  return (
    <div>
      <PageHeader
        eyebrow="Energy Intelligence · AG Studio"
        title="Energy Intelligence"
        desc="Explore this event's allocation, meter evidence, verification and settlement — and build reports with PeakShift Analyst. Analytics only: operations and money movement stay in their controlled screens."
        meta={
          <>
            <Badge tone="info">{ev.name}</Badge>
            <StatusBadge meta={EVENT_STATUS[ev.status]} />
            <Badge tone="neutral">{dateLabel(ev.eventDate)} · peak {windowLabel(ev.peak)} · alternate {windowLabel(ev.shift)}</Badge>
            <Badge tone={ai ? "signal" : "warning"}>{ai ? "PeakShift Analyst · Claude via AG Studio Agent Framework" : "Analyst offline (no AI key)"}</Badge>
            {!licenseKey && <Badge tone="warning">AG Studio trial watermark (no licence key)</Badge>}
          </>
        }
      />
      <IntelligenceClient bootstrap={bootstrap} report={report} ai={ai} licenseKey={licenseKey} canEdit={u.role === "operator" || u.role === "admin"} offlineDatasets={ai ? null : buildDatasets(s, ev)} />
    </div>
  );
}
