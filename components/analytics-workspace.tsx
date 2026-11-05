"use client";
import { useEffect, useState } from "react";
import { Bot, Pin, Send, ShieldCheck, Sparkles, Wrench } from "lucide-react";
import type { Dataset, DatasetName, WidgetSpec } from "@/lib/analytics";
import type { AnalystReply } from "@/lib/ai/analyst";
import { api, ApiError } from "@/lib/client";
import { Badge, Button, Notice, Panel, cx } from "./ui";
import { SpecChart } from "./charts-lazy";

const SUGGESTED = [
  "Build a chart comparing committed versus verified shifted energy by business for this event.",
  "Why was NorthCool Storage excluded from this dispatch?",
  "Why were these three businesses selected?",
  "Compare incentive cost per verified kWh across participating businesses.",
  "Send the payouts now.",
];

type Turn = { q: string; r?: AnalystReply; err?: string };
const PIN_KEY = "peakshift.pinnedWidgets.v1";

export function AskPanel({ eventId, datasets }: { eventId: string; datasets: Record<DatasetName, Dataset> }) {
  const [q, setQ] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [pinned, setPinned] = useState<WidgetSpec[]>([]);
  useEffect(() => {
    try {
      setPinned(JSON.parse(localStorage.getItem(PIN_KEY) ?? "[]"));
    } catch {
      /* storage unavailable */
    }
  }, []);
  const savePins = (p: WidgetSpec[]) => {
    setPinned(p);
    try {
      localStorage.setItem(PIN_KEY, JSON.stringify(p));
    } catch {
      /* ignore */
    }
  };
  async function ask(question: string) {
    if (!question.trim() || busy) return;
    setQ("");
    setBusy(true);
    setTurns((t) => [...t, { q: question }]);
    try {
      const r = await api<AnalystReply>(`events/${eventId}/analyst`, { body: { question } });
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, r } : x)));
    } catch (e) {
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, err: (e as ApiError).message } : x)));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel
      className="flex max-h-[820px] flex-col"
      bodyClass="flex min-h-0 flex-1 flex-col"
      title={<span className="flex items-center gap-2 text-[15px] font-semibold"><Bot className="size-4 text-signal" /> PeakShift Analyst (offline)</span>}
      subtitle="No AI key configured: a deterministic analyst answers from stored data and reason codes. With ANTHROPIC_API_KEY set, the Analyst runs inside AG Studio on the Agent Framework."
    >
      <div className="min-h-0 flex-1 space-y-4 overflow-auto pr-1">
        {turns.length === 0 && (
          <div className="space-y-2">
            {SUGGESTED.map((s) => (
              <button key={s} onClick={() => ask(s)} className="block w-full rounded-[8px] border border-line bg-surface-2/50 px-3 py-2 text-left text-[13px] text-ink-2 hover:border-line-2 hover:text-ink">{s}</button>
            ))}
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className="space-y-2 anim-fade-up">
            <div className="ml-8 rounded-[10px] rounded-tr-sm bg-signal-dim px-3 py-2 text-[13px] text-ink">{t.q}</div>
            {!t.r && !t.err && <div className="flex items-center gap-2 text-[12.5px] text-ink-3"><Sparkles className="size-3.5 anim-pulse" /> Analysing event data…</div>}
            {t.err && <Notice tone="warning" title={t.err} />}
            {t.r && <Answer r={t.r} pinned={pinned.some((p) => p.id === t.r!.widget?.id)} onPin={(w) => savePins([...pinned, w])} datasets={datasets} />}
          </div>
        ))}
        {pinned.length > 0 && (
          <div className="space-y-3 border-t border-line pt-3">
            <div className="micro">Added to workspace ({pinned.length}) · saved in this browser</div>
            {pinned.map((w) => (
              <div key={w.id} className="rounded-[10px] border border-line bg-surface-2/40 p-3">
                <div className="mb-1 flex items-start justify-between gap-2">
                  <span className="text-[12.5px] font-medium">{w.title}</span>
                  <button onClick={() => savePins(pinned.filter((x) => x.id !== w.id))} className="text-[11.5px] text-ink-3 hover:text-ink" aria-label={`Remove ${w.title}`}>Remove</button>
                </div>
                <WidgetView w={w} datasets={datasets} compact />
              </div>
            ))}
          </div>
        )}
      </div>
      <form className="mt-3 flex items-center gap-2 border-t border-line pt-3" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about this event…" aria-label="Ask PeakShift Analyst" className="h-10 min-w-0 flex-1 rounded-[8px] border border-line-2 bg-surface-2 px-3 text-[13.5px] outline-none focus:border-signal/60" />
        <button type="submit" disabled={!q.trim() || busy} aria-label="Send question" className="grid h-10 w-10 shrink-0 place-items-center rounded-[8px] bg-signal text-signal-ink hover:brightness-105 disabled:opacity-45"><Send className="size-4" /></button>
      </form>
    </Panel>
  );
}

function Answer({ r, pinned, onPin, datasets }: { r: AnalystReply; pinned: boolean; onPin: (w: WidgetSpec) => void; datasets: Record<DatasetName, Dataset> }) {
  return (
    <div className="space-y-2.5 rounded-[10px] border border-line bg-surface-2/40 p-3">
      {r.boundary && (
        <div className="flex items-center gap-1.5 text-[11.5px] text-warning">
          <ShieldCheck className="size-3.5" /> Boundary enforced
        </div>
      )}
      <p className="whitespace-pre-line text-[13px] leading-relaxed text-ink">{r.answer}</p>
      {r.calculation && <p className="rounded-[6px] bg-bg/60 px-2.5 py-1.5 font-mono text-[11px] text-ink-2">{r.calculation}</p>}
      {r.widget && (
        <div className="rounded-[8px] border border-line bg-surface p-2.5">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-[12.5px] font-medium">{r.widget.title}</span>
            <Badge tone="info">Proposed</Badge>
          </div>
          <WidgetView w={r.widget} datasets={datasets} compact />
          <Button size="sm" variant={pinned ? "ghost" : "secondary"} disabled={pinned} onClick={() => onPin(r.widget!)} icon={<Pin className="size-3.5" />} className="mt-2">
            {pinned ? "Added to workspace" : "Add to workspace"}
          </Button>
        </div>
      )}
      <div className="flex flex-wrap gap-1.5 text-[10.5px] text-ink-3">
        {r.toolCalls.map((t, i) => (
          <span key={i} className="inline-flex items-center gap-1 rounded bg-bg/60 px-1.5 py-0.5 font-mono">
            <Wrench className="size-2.5" />
            {t.name}
          </span>
        ))}
      </div>
      <div className="text-[11px] text-ink-3">
        {r.sources.length > 0 && <>Sources: {r.sources.map((s) => s.label).join(", ")} · </>}
        {r.filters} · {r.engine.mode === "claude" ? "Claude" : "offline"} {r.engine.latencyMs} ms
      </div>
    </div>
  );
}

function WidgetView({ w, datasets, compact }: { w: WidgetSpec; datasets: Record<DatasetName, Dataset>; compact?: boolean }) {
  const ds = datasets[w.dataset];
  if (!ds?.rows.length) return <p className="py-4 text-center text-[12px] text-ink-3">No data yet for {w.dataset}.</p>;
  if (w.kind === "table" || w.kind === "kpi")
    return (
      <div className={cx("overflow-auto rounded-[6px] border border-line", compact ? "max-h-48" : "max-h-72")}>
        <table className="w-full text-[11.5px]">
          <thead className="bg-surface-2 text-ink-2">
            <tr>{w.series.map((s) => <th key={s.key} className="px-2 py-1.5 text-left font-medium">{s.label}</th>)}</tr>
          </thead>
          <tbody>
            {ds.rows.map((row, i) => (
              <tr key={i} className="border-t border-line align-top">
                {w.series.map((s) => <td key={s.key} className="px-2 py-1.5">{String(row[s.key] ?? "—")}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  return <SpecChart kind={w.kind as "bar" | "line" | "area" | "donut"} rows={ds.rows} x={w.x ?? "business"} series={w.series} unit={w.unit} height={compact ? 200 : 260} />;
}

