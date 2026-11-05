"use client";
import { useMemo, useState } from "react";
import { Bot, Building2, Cpu, Landmark, Search, User } from "lucide-react";
import type { AiRun, AuditEvent } from "@/lib/types";
import { stamp } from "@/lib/format";
import { Badge, Panel, cx } from "./ui";
import { Drawer } from "./overlay";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "money", label: "Money movement", re: /funding|payout|settlement|webhook/ },
  { key: "decisions", label: "Decisions", re: /optimisation|offer|event\.|verification|meter/ },
  { key: "ai", label: "AI", re: /^ai\.|agent/ },
  { key: "profile", label: "Profiles & safety", re: /profile/ },
  { key: "access", label: "Access", re: /login|demo/ },
];

const roleIcon = (r: string) => (r === "paypal" ? <Landmark className="size-3.5" /> : r === "system" ? <Cpu className="size-3.5" /> : r === "business" ? <Building2 className="size-3.5" /> : <User className="size-3.5" />);

export function AuditView({ events, aiRuns }: { events: AuditEvent[]; aiRuns: AiRun[] }) {
  const [f, setF] = useState("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<AuditEvent | null>(null);
  const list = useMemo(() => {
    const filt = FILTERS.find((x) => x.key === f);
    return events.filter((e) => (!filt?.re || filt.re.test(e.action)) && (!q || `${e.summary} ${e.actorName} ${e.entityId} ${e.correlationId}`.toLowerCase().includes(q.toLowerCase())));
  }, [events, f, q]);

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
      <Panel bodyClass="!p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          {FILTERS.map((x) => (
            <button key={x.key} onClick={() => setF(x.key)} className={cx("rounded-full px-3 py-1 text-[12.5px]", f === x.key ? "bg-signal text-signal-ink font-medium" : "bg-surface-2 text-ink-2 hover:text-ink")} aria-pressed={f === x.key}>
              {x.label}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-2 rounded-[8px] border border-line bg-surface-2 px-2.5 py-1.5">
            <Search className="size-3.5 text-ink-3" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search actor, entity, correlation ID" aria-label="Search audit log" className="w-56 bg-transparent text-[12.5px] outline-none placeholder:text-ink-3" />
          </label>
        </div>
        {list.length === 0 ? (
          <div className="px-5 py-10 text-center text-[13px] text-ink-3">
            No entries match these filters.{" "}
            <button className="underline" onClick={() => { setF("all"); setQ(""); }}>
              Reset filters
            </button>
          </div>
        ) : (
          <ol className="divide-y divide-line">
            {list.map((e) => (
              <li key={e.id}>
                <button onClick={() => setOpen(e)} className="grid w-full grid-cols-[150px_1fr] gap-4 px-5 py-3 text-left hover:bg-surface-2/50 md:grid-cols-[170px_190px_1fr]">
                  <span className="text-[12px] text-ink-3 num">{stamp(e.at)}</span>
                  <span className="hidden items-center gap-1.5 text-[12.5px] text-ink-2 md:flex">
                    {roleIcon(e.role)} {e.actorName}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] text-ink">{e.summary}</span>
                    <span className="mt-0.5 block font-mono text-[11px] text-ink-3">
                      {e.action} · {e.entityType}:{e.entityId} · {e.correlationId}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      <Panel title={<span className="flex items-center gap-2 text-[15px] font-semibold"><Bot className="size-4 text-ink-3" />AI runs</span>} subtitle="Model, prompt version and latency for every AI call">
        <ul className="space-y-2">
          {aiRuns.length === 0 && <li className="text-[13px] text-ink-3">No AI calls yet.</li>}
          {aiRuns.map((r) => (
            <li key={r.id} className="rounded-[8px] bg-surface-2/50 px-3 py-2 text-[12px]">
              <div className="flex items-center justify-between">
                <span className="font-medium text-ink">{r.feature.replace("_", " ")}</span>
                <Badge tone={r.status === "ok" ? "success" : "danger"}>{r.status}</Badge>
              </div>
              <div className="mt-0.5 font-mono text-[11px] text-ink-3">
                {r.mode} · {r.model} · {r.promptVersion} · {r.latencyMs} ms
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      <Drawer open={!!open} onClose={() => setOpen(null)} title={open?.action ?? ""} subtitle={open ? stamp(open.at) : ""}>
        {open && (
          <div className="space-y-4 text-[13px]">
            <p>{open.summary}</p>
            <dl className="grid grid-cols-[120px_1fr] gap-y-1.5 font-mono text-[12px]">
              <dt className="text-ink-3">actor</dt>
              <dd>{open.actorName} ({open.role})</dd>
              <dt className="text-ink-3">entity</dt>
              <dd>
                {open.entityType}:{open.entityId}
              </dd>
              <dt className="text-ink-3">correlation</dt>
              <dd>{open.correlationId}</dd>
            </dl>
            {open.before !== undefined && (
              <div>
                <div className="mb-1 text-[12px] text-ink-3">Before</div>
                <pre className="max-h-48 overflow-auto rounded-[8px] bg-bg p-3 font-mono text-[11px] text-ink-2">{JSON.stringify(open.before, null, 2)}</pre>
              </div>
            )}
            {open.after !== undefined && (
              <div>
                <div className="mb-1 text-[12px] text-ink-3">After</div>
                <pre className="max-h-64 overflow-auto rounded-[8px] bg-bg p-3 font-mono text-[11px] text-ink-2">{JSON.stringify(open.after, null, 2)}</pre>
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
