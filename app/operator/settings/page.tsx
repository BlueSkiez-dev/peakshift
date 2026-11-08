import { currentUser } from "@/lib/auth";
import { healthCheck, webhookConfigured } from "@/lib/paypal";
import { claudeEnabled, CLAUDE_MODEL } from "@/lib/ai/claude";
import { readFresh, storeHealth } from "@/lib/store";
import { PageHeader, Panel, Badge, KV } from "@/components/ui";
import { ResetDemo } from "@/components/reset-demo";

export const dynamic = "force-dynamic";

export default async function Settings() {
  const u = await currentUser();
  const pp = await healthCheck();
  const s = (await readFresh());
  const db = await storeHealth();
  return (
    <div className="space-y-4">
      <PageHeader title="Settings & integrations" desc="Integration health for PayPal, AI and the data store, plus demo controls." />
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="PayPal" action={<Badge tone={pp.ok ? "success" : "danger"}>{pp.ok ? "Connected" : "Needs attention"}</Badge>}>
          <dl className="divide-y divide-line">
            <KV k="Mode" v={pp.mode === "sandbox" ? "Sandbox REST API" : "Local simulator"} />
            <KV k="OAuth" v={pp.detail} />
            <KV k="Webhook ID" v={webhookConfigured() ? "Configured" : "Not configured"} />
            <KV k="Webhook URL" v="/api/v1/webhooks/paypal" mono />
          </dl>
        </Panel>
        <Panel title="AI" action={<Badge tone={claudeEnabled() ? "success" : "warning"}>{claudeEnabled() ? "Claude" : "Offline rules"}</Badge>}>
          <dl className="divide-y divide-line">
            <KV k="Provider" v={claudeEnabled() ? "Anthropic Messages API" : "Deterministic extractor"} />
            <KV k="Model" v={claudeEnabled() ? CLAUDE_MODEL : "peakshift-rules-v1"} mono />
            <KV k="Calls logged" v={s.aiRuns.length} />
            <KV k="Can move money" v="Never — no such tool" />
          </dl>
        </Panel>
        <Panel title="Data store" action={<Badge tone={db.ok ? "success" : "danger"}>{db.ok ? "Healthy" : "Unavailable"}</Badge>}>
          <dl className="divide-y divide-line">
            <KV k="Mode" v={db.mode === "postgres" ? "PostgreSQL (row-locked transactions)" : "File-backed JSON (local dev)"} />
            <KV k="Status" v={db.detail} />
            <KV k="Seed" v={s.seedVersion} mono />
            <KV k="Audit entries" v={s.audit.length} />
            <KV k="Meter datasets" v={`${s.datasets.length} (simulated)`} />
          </dl>
        </Panel>
      </div>
      <Panel title="Demo controls" subtitle="Restores the seeded scenario: 6 businesses, 1 event awaiting funding. Clears demo-generated plans, offers, readings, settlements and payout records.">
        {u?.role === "admin" ? <ResetDemo /> : <p className="text-[13px] text-ink-3">To restore the seeded event, use Start a fresh run on the Overview. The unconditional reset here is for the platform admin.</p>}
      </Panel>
    </div>
  );
}
