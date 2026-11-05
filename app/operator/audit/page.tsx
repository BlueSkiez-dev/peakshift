import { readFresh } from "@/lib/store";
import { PageHeader } from "@/components/ui";
import { AuditView } from "@/components/audit-view";

export const dynamic = "force-dynamic";

export default async function Audit() {
  const s = (await readFresh());
  return (
    <div>
      <PageHeader title="Audit log" desc="Every consequential decision and financial state transition: who, what, when, and the correlation ID that ties it together." />
      <AuditView events={s.audit} aiRuns={s.aiRuns.slice(0, 20)} />
    </div>
  );
}
