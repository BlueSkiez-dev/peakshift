"use client";
// Energy Intelligence workspace (v1.1 Addendum §5, §7, §8, §10).
// AG Studio embedded in the PeakShift shell: authorised event-scoped data + relationships,
// four PeakShift custom widgets, PeakShift theme, server-persisted report with revisions and
// autosave, refresh/freshness, and PeakShift Analyst on the Agent Framework (Claude via server).
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AgStudio, AgStudioProvider, createWidgets, type AgStudioRef } from "ag-studio-react";
import { AgStudioAiModule, createAiHarness, directLlmRunner, enableStudioDevValidations, studioTheme, type AgStudioApi } from "ag-studio";
import { Check, CircleAlert, Eraser, Eye, Pencil, RefreshCw, RotateCcw, Save, Loader2, Sparkles } from "lucide-react";
import type { StudioBootstrap } from "@/lib/analytics-contract";
import type { StudioReport } from "@/lib/types";
import { api, ApiError } from "@/lib/client";
import { PEAKSHIFT_WIDGET_IDS, validateReportState, defaultEventPerformanceReport } from "@/lib/report-template";
import { peakshiftWidgetTypes, WIDGET_MENU, type PeakShiftRegistry, type StudioContext } from "./widgets";
import { Button, Notice, cx } from "../ui";
import { Dialog } from "../overlay";

if (process.env.NODE_ENV !== "production") enableStudioDevValidations();

const theme = studioTheme.withParams({
  backgroundColor: "#101714", foregroundColor: "#e8efea", borderColor: "#1f2a25", accentColor: "#c7eb73", chartAccentColor: "#c7eb73", browserColorScheme: "dark",
  fontFamily: "var(--font-geist), ui-sans-serif, system-ui", chartFontFamily: "var(--font-geist), ui-sans-serif, system-ui",
  chartTextColor: "#e8efea", chartSubtleTextColor: "#9eaca5", chartAxisLabelColor: "#6a7973", chartAxisLineColor: "#2b3832", chartGridLineColor: "#1b2520",
  chartTooltipBackgroundColor: "#151d19", chartTooltipTextColor: "#e8efea",
  gridHeaderBackgroundColor: "#151d19", gridDataBackgroundColor: "#101714", gridOddRowBackgroundColor: "#121a16", gridHeaderTextColor: "#9eaca5", gridCellTextColor: "#e8efea", gridRowHoverColor: "#18221d", gridAccentColor: "#c7eb73",
  menuBackgroundColor: "#151d19", menuTextColor: "#e8efea", inputBackgroundColor: "#151d19", inputTextColor: "#e8efea",
  buttonBackgroundColor: "#1b2520", buttonTextColor: "#e8efea", buttonHoverBackgroundColor: "#24302a", buttonActiveBackgroundColor: "#c7eb73", buttonActiveTextColor: "#11200a", iconColor: "#9eaca5",
} as never);

export const PROMPT_STARTERS = [
  { label: "Committed vs verified", prompt: "Build a chart comparing committed versus verified shifted energy by business for this event." },
  { label: "Why was NorthCool excluded?", prompt: "Why was NorthCool Storage excluded from this dispatch? Show the exact rule and the source record." },
  { label: "Incentive efficiency", prompt: "Compare incentive cost per verified kWh across participating businesses and highlight the most efficient participants." },
];

type SaveState = "saved" | "dirty" | "saving" | "error" | "conflict";

/** Browser-side AgLlmAdapter: every turn goes to the authenticated PeakShift server route. */
function peakshiftAdapter(eventId: string) {
  return {
    executeTurn(request: unknown, options?: { signal?: AbortSignal }) {
      const complete = fetch("/api/v1/ai/studio", { method: "POST", headers: { "content-type": "application/json", "x-peakshift-event": eventId }, body: JSON.stringify(request), signal: options?.signal })
        .then(async (r) => {
          const j = await r.json().catch(() => ({}));
          if (!r.ok) return { id: "err", createdAt: Date.now(), status: "failed", output: [], error: { code: j?.error?.code ?? "ERROR", message: j?.error?.message ?? "Analyst unavailable" } };
          return j.data;
        })
        .catch((e: Error) => ({ id: "err", createdAt: Date.now(), status: e.name === "AbortError" ? "cancelled" : "failed", output: [], error: { code: "NETWORK", message: e.message } }));
      const stream = {
        async *[Symbol.asyncIterator]() {
          const res = (await complete) as { output?: { type: string; id: string; callId?: string; name?: string; arguments?: string; content?: { text?: string }[] }[] };
          for (const o of res.output ?? []) {
            if (o.type === "message") {
              yield { type: "TEXT_MESSAGE_START", messageId: o.id, role: "assistant" };
              yield { type: "TEXT_MESSAGE_CONTENT", messageId: o.id, delta: (o.content ?? []).map((c) => c.text ?? "").join("") };
              yield { type: "TEXT_MESSAGE_END", messageId: o.id };
            } else if (o.type === "function_call") {
              yield { type: "TOOL_CALL_START", toolCallId: o.callId, toolCallName: o.name };
              yield { type: "TOOL_CALL_ARGS", toolCallId: o.callId, delta: o.arguments ?? "{}" };
              yield { type: "TOOL_CALL_END", toolCallId: o.callId };
            }
          }
        },
      };
      return { stream, complete };
    },
  };
}

/** Read-only PeakShift domain tools (Addendum §11.1). Tenancy is resolved server-side from the session. */
function domainTools(sapi: AgStudioApi, eventId: string) {
  const call = async (path: string, body: object, signal: AbortSignal) => {
    const r = await fetch(`/api/v1/analytics/agent-tools/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ eventId, ...body }), signal });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error?.message ?? "Tool failed");
    return j.data;
  };
  const run = (path: string) => async (args: Record<string, unknown>, ctx: { signal: AbortSignal; success: (r: string, d?: unknown) => never; error: (m: string) => never }) => {
    try {
      const data = await call(path, args ?? {}, ctx.signal);
      return ctx.success(JSON.stringify(data), data);
    } catch (e) {
      return ctx.error((e as Error).message);
    }
  };
  const def = (cfg: { name: string; description: string; params: (s: never) => unknown; path: string }) =>
    sapi.defineAiTool({ name: cfg.name, description: cfg.description, params: cfg.params as never, execute: run(cfg.path) as never });
  return [
    def({ name: "peakshift_event_context", path: "event-context", description: "Read the selected event's scope, target, windows, funding, accepted commitment, data mode and snapshot. Read-only.", params: ((s: { object: (d: object) => unknown }) => s.object({})) as never }),
    def({
      name: "peakshift_explain_exclusion",
      path: "explain-exclusion",
      description: "Explain why a business was excluded or not selected, using the optimiser's stored deterministic reason code, rule ID and supporting profile fields. Read-only.",
      params: ((s: { object: (d: object, o?: object) => unknown; string: (o?: object) => unknown }) => s.object({ business: s.string({ description: "Business display name or ID, e.g. 'NorthCool Storage'" }) })) as never,
    }),
    def({
      name: "peakshift_verification_breakdown",
      path: "verification-breakdown",
      description: "Return stored verification inputs and results (baseline/actual peak & alternate Wh, peak reduction, alternate-window increase (reboundWh), verified Wh, meter-data completeness (coveragePct), reward, reward per verified kWh, formula version). Optionally filter to one business. Read-only.",
      params: ((s: { object: (d: object) => unknown; string: (o?: object) => { optional: () => unknown } }) => s.object({ business: s.string({ description: "Optional business name or ID" }).optional() })) as never,
    }),
    def({
      name: "peakshift_settlement_summary",
      path: "settlement-summary",
      description: "Summarise settlement approval and PayPal payout item states (count and amount by status, batch status, last webhook). Read-only; cannot submit, approve or retry payouts.",
      params: ((s: { object: (d: object) => unknown; string: (o?: object) => { optional: () => unknown } }) => s.object({ status: s.string({ description: "Optional item status filter, e.g. SUCCEEDED, UNCLAIMED" }).optional() })) as never,
    }),
    def({ name: "peakshift_analytics_freshness", path: "freshness", description: "Return snapshot ID, data-as-of time, data mode and row counts for the dashboard sources. Read-only.", params: ((s: { object: (d: object) => unknown }) => s.object({})) as never }),
  ];
}

class Boundary extends Component<{ children: ReactNode; onReset: () => void }, { err: string | null }> {
  state = { err: null as string | null };
  static getDerivedStateFromError(e: Error) {
    return { err: e.message };
  }
  render() {
    if (this.state.err)
      return (
        <div className="grid h-full place-items-center p-8">
          <Notice tone="warning" title="This report couldn't be displayed" action={<Button size="sm" onClick={() => { this.setState({ err: null }); this.props.onReset(); }}>Restore default report</Button>}>
            {this.state.err}. Operations screens are unaffected.
          </Notice>
        </div>
      );
    return this.props.children;
  }
}

export default function IntelligenceWorkspace({ bootstrap, report, ai, licenseKey, canEdit }: { bootstrap: StudioBootstrap; report: StudioReport; ai: boolean; licenseKey: string | null; canEdit: boolean }) {
  const ref = useRef<AgStudioRef>(null);
  const [boot, setBoot] = useState(bootstrap);
  const [stale, setStale] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [mode, setMode] = useState<"edit" | "view">("view"); // saved reports always open in View mode
  const [rev, setRev] = useState(report.revision);
  const [save, setSave] = useState<SaveState>("saved");
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState(report.updatedAt);
  const [resetOpen, setResetOpen] = useState(false);
  const [studioKey, setStudioKey] = useState(0);
  const [initial, setInitial] = useState<{ state: unknown; invalid: string | null }>(() => {
    const v = validateReportState(report.reportState, new Set(PEAKSHIFT_WIDGET_IDS));
    return v.ok ? { state: report.reportState, invalid: null } : { state: defaultEventPerformanceReport(), invalid: v.reason };
  });
  const revRef = useRef(rev);
  useEffect(() => {
    revRef.current = rev;
  }, [rev]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ready = useRef(false);
  const saving = useRef(false);

  const data = useMemo(
    () => ({ description: boot.description, sources: boot.sources, relationships: boot.relationships }),
    [boot],
  );
  const context = useMemo<StudioContext>(
    () => ({
      eventId: boot.eventId,
      dataMode: boot.dataMode,
      dataAsOfUtc: boot.dataAsOfUtc,
      snapshotId: boot.snapshotId,
      lastWebhookAt: (boot.sources.find((s) => s.id === "payoutItems")?.data[0]?.lastWebhookAt as string | null) ?? null,
      peakLabel: String(boot.sources.find((s) => s.id === "events")?.data[0]?.peakWindowLabel ?? ""),
      shiftLabel: String(boot.sources.find((s) => s.id === "events")?.data[0]?.shiftWindowLabel ?? ""),
    }),
    [boot],
  );
  const widgets = useMemo(() => createWidgets<PeakShiftRegistry>({ additionalTypes: peakshiftWidgetTypes() as never, menu: WIDGET_MENU as never }), []);

  const persist = useCallback(async () => {
    const sapi = ref.current?.api;
    if (!sapi || saving.current || !canEdit) return;
    saving.current = true;
    setSave("saving");
    try {
      const snap = sapi.getState() as unknown as { panels?: Record<string, { collapsed?: boolean; width?: number }> }; // read-only snapshot
      // The saved, judge-facing report always reopens with the AI Assistant collapsed.
      const state = { ...snap, panels: { ...(snap.panels ?? {}), ai: { ...(snap.panels?.ai ?? {}), collapsed: true } } };
      const r = await api<StudioReport>(`analytics/reports/${report.id}`, { method: "PUT", body: { reportState: state, expectedRevision: revRef.current } });
      setRev(r.revision);
      setSavedAt(r.updatedAt);
      setSave("saved");
      setSaveMsg(null);
    } catch (e) {
      const ae = e as ApiError;
      setSave(ae.code === "REPORT_CONFLICT" ? "conflict" : "error");
      setSaveMsg(ae.message);
    } finally {
      saving.current = false;
    }
  }, [canEdit, report.id]);

  const onStateUpdated = useCallback(() => {
    if (!ready.current || mode !== "edit" || !canEdit) return;
    setSave((s) => (s === "conflict" ? s : "dirty"));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void persist(), 900);
  }, [mode, canEdit, persist]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function refresh() {
    setRefreshing(true);
    try {
      const b = await api<StudioBootstrap>(`analytics/events/${boot.eventId}/studio-data`);
      setBoot(b);
      setStale(false);
    } catch {
      setStale(true); // keep last good data visible, clearly marked
    } finally {
      setRefreshing(false);
    }
  }

  async function resetToDefault() {
    setResetOpen(false);
    const r = await api<StudioReport>(`analytics/reports/${report.id}/reset`, { body: {} });
    setRev(r.revision);
    setSavedAt(r.updatedAt);
    setSave("saved");
    ready.current = false;
    setInitial({ state: r.reportState, invalid: null });
    setStudioKey((k) => k + 1);
  }

  async function reloadLatest() {
    const r = await api<StudioReport>(`analytics/reports/${report.id}`);
    setRev(r.revision);
    setSave("saved");
    setSaveMsg(null);
    ready.current = false;
    setInitial({ state: r.reportState, invalid: null });
    setStudioKey((k) => k + 1);
  }

  /** Clear entry point to PeakShift Analyst: switch to edit mode (where Studio hosts the AI panel) and expand it. */
  function openAnalyst() {
    setMode("edit");
    setTimeout(() => {
      const sapi = ref.current?.api;
      if (!sapi) return;
      const st = sapi.getState() as unknown as { panels?: Record<string, { collapsed?: boolean; width?: number }> };
      const p = st.panels ?? {};
      // Only the assistant opens; Compose, Data and Filters stay collapsed so the report keeps its width.
      sapi.setState({ ...st, panels: { ...p, edit: { ...p.edit, collapsed: true }, data: { ...p.data, collapsed: true }, filters: { ...p.filters, collapsed: true }, ai: { ...p.ai, collapsed: false } } } as never);
    }, 60);
  }

  function clearFilters() {
    const sapi = ref.current?.api;
    if (!sapi) return;
    type W = { type?: string; dataMapping?: Record<string, unknown> };
    const st = sapi.getState() as unknown as { pages: ({ widgets?: Record<string, W>; filter?: unknown } & Record<string, unknown>)[] };
    // Build a new state (getState() output is treated as read-only): empty cross-filter, no page
    // filters, and no list-filter selections.
    const pages = st.pages.map(({ filter: _f, ...p }) => ({
      ...p,
      // Studio merges cross-filter state, so empty every existing selection key explicitly.
      crossFilter: { values: Object.fromEntries(Object.keys(((p as { crossFilter?: { values?: Record<string, unknown> } }).crossFilter?.values) ?? {}).map((k) => [k, []])) },
      widgets: Object.fromEntries(
        Object.entries(p.widgets ?? {}).map(([id, w]) => {
          if (w.type !== "list-filter" || !w.dataMapping) return [id, w];
          const { selection: _sel, ...dm } = w.dataMapping;
          return [id, { ...w, dataMapping: dm }];
        }),
      ),
    }));
    sapi.setState({ ...st, pages } as never);
  }

  const aiSetup = useMemo(() => {
    if (!ai) return undefined;
    const adapter = peakshiftAdapter(boot.eventId);
    return ({ api: sapi }: { api: AgStudioApi }) =>
      createAiHarness(sapi, ({ builtIn, tools }) => ({
        agents: [
          directLlmRunner({
            id: "peakshift-analyst",
            name: "PeakShift Analyst",
            description: "Energy operations and settlement analytics assistant for the selected PeakShift event.",
            adapter,
            schema: (s: { undefined: () => unknown }) => s.undefined(),
            instructions: () =>
              [
                "You are PeakShift Analyst: understand the selected event's data, explain what happened, and help the operator build a useful report.",
                `Event scope: ${boot.eventId}. Snapshot ${boot.snapshotId} as of ${boot.dataAsOfUtc}. Data mode: SIMULATED.`,
                "Tables: events, businesses, eligibility, offers, meterIntervals, verificationResults, settlementItems, payoutItems (related by eventId/businessId). Energy in Wh, money in minor units.",
                "PeakShift custom widgets you can add: peakshift-participant-contribution (committed vs verified by business), peakshift-load-shift-evidence, peakshift-flex-capacity, peakshift-settlement-pulse. Prefer them for those questions.",
                "Use peakshift_explain_exclusion for exclusion questions and quote the reasonCode, ruleId and sourceRecord.",
                "Use peakshift_verification_breakdown for reward-per-verified-kWh questions (rewardPerVerifiedKwhMinor is cents per kWh).",
                "Delegate widget placement to the 'page' agent and detailed widget configuration to the 'widget' agent when helpful.",
                "Never claim a payout is paid unless its item status is SUCCEEDED. You cannot approve, pay, or change any operational data.",
              ].join("\n"),
            tools: () => [
              ...domainTools(sapi, boot.eventId),
              tools.studio.viewSchema(),
              tools.studio.viewReport(),
              tools.studio.viewPage(),
              tools.studio.viewWidget(),
              tools.studio.executeQuery(),
              tools.studio.addWidget(),
              tools.studio.positionWidget(),
              tools.studio.addPageFilter(),
              tools.studio.removePageFilter(),
              tools.delegateTo(["page", "widget", "data"]),
            ],
          } as never),
          // AG Studio's built-in specialists, running on the same PeakShift server adapter.
          directLlmRunner({ ...builtIn.page, adapter } as never),
          directLlmRunner({ ...builtIn.widget, adapter } as never),
          directLlmRunner({ ...builtIn.data, adapter } as never),
        ],
        primary: "peakshift-analyst",
        promptStarters: PROMPT_STARTERS,
      }) as never);
  }, [ai, boot.eventId, boot.snapshotId, boot.dataAsOfUtc]);

  const statusPill = {
    saved: { icon: <Check className="size-3.5" />, text: `Saved · rev ${rev}`, cls: "text-success" },
    dirty: { icon: <span className="size-1.5 rounded-full bg-warning" />, text: "Unsaved changes", cls: "text-warning" },
    saving: { icon: <Loader2 className="size-3.5 animate-spin" />, text: "Saving…", cls: "text-ink-2" },
    error: { icon: <CircleAlert className="size-3.5" />, text: "Save failed", cls: "text-danger" },
    conflict: { icon: <CircleAlert className="size-3.5" />, text: "Newer version saved elsewhere", cls: "text-danger" },
  }[save];

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-line bg-surface px-3 py-2">
        <label className="flex items-center gap-2 text-[13px]">
          <span className="text-ink-3">Report</span>
          <select className="h-8 rounded-[8px] border border-line-2 bg-surface-2 px-2 text-[13px] outline-none" value={report.id} onChange={() => null} aria-label="Saved report">
            <option value={report.id}>{report.name}</option>
          </select>
        </label>
        <div className="inline-flex rounded-[8px] border border-line-2 bg-surface-2 p-0.5" role="tablist" aria-label="Report mode">
          <button role="tab" aria-selected={mode === "edit"} disabled={!canEdit} onClick={() => setMode("edit")} className={cx("inline-flex h-7 items-center gap-1.5 rounded-[6px] px-2.5 text-[12.5px]", mode === "edit" ? "bg-surface text-ink" : "text-ink-2")}>
            <Pencil className="size-3.5" /> Edit report
          </button>
          <button role="tab" aria-selected={mode === "view"} onClick={() => setMode("view")} className={cx("inline-flex h-7 items-center gap-1.5 rounded-[6px] px-2.5 text-[12.5px]", mode === "view" ? "bg-surface text-ink" : "text-ink-2")}>
            <Eye className="size-3.5" /> View report
          </button>
        </div>
        <span className={cx("inline-flex items-center gap-1.5 text-[12px]", statusPill.cls)} role="status" aria-live="polite">
          {statusPill.icon} {statusPill.text}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {ai && canEdit && (
            <Button size="sm" variant="secondary" onClick={openAnalyst} icon={<Sparkles className="size-3.5" />}>
              Ask PeakShift Analyst
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={clearFilters} icon={<Eraser className="size-3.5" />}>Clear filters</Button>
          <Button size="sm" variant="ghost" onClick={refresh} loading={refreshing} loadingLabel="Refreshing…" icon={<RefreshCw className="size-3.5" />}>Refresh data</Button>
          {canEdit && <Button size="sm" variant="ghost" onClick={() => setResetOpen(true)} icon={<RotateCcw className="size-3.5" />}>Reset to default</Button>}
          {canEdit && (
            <Button size="sm" variant="secondary" onClick={() => void persist()} disabled={save === "saving" || save === "conflict"} icon={<Save className="size-3.5" />}>
              Save
            </Button>
          )}
        </div>
      </div>

      {initial.invalid && <Notice tone="warning" title="Saved report couldn't be restored — showing the PeakShift default">{initial.invalid}</Notice>}
      {save === "conflict" && <Notice tone="danger" title="This report was saved elsewhere" action={<Button size="sm" onClick={reloadLatest}>Reload latest</Button>}>{saveMsg} Your unsaved layout changes will be replaced.</Notice>}
      {save === "error" && <Notice tone="danger" title="Save failed" action={<Button size="sm" onClick={() => void persist()}>Retry</Button>}>{saveMsg}</Notice>}
      {stale && <Notice tone="warning" title="Data may be stale">The last refresh failed. Showing the snapshot from {new Date(boot.dataAsOfUtc).toLocaleTimeString("en-GB", { timeZone: "Africa/Lagos" })} WAT.</Notice>}

      <section className="overflow-hidden rounded-[14px] border border-line bg-surface">
        <div className="h-[calc(100dvh-250px)] min-h-[720px]">
          <Boundary onReset={resetToDefault}>
            <AgStudioProvider licenseKey={licenseKey ?? undefined} modules={ai ? [AgStudioAiModule] : []}>
              <AgStudio<PeakShiftRegistry>
                key={studioKey}
                ref={ref as never}
                style={{ height: "100%", width: "100%" }}
                data={data as never}
                initialState={initial.state as never}
                widgets={widgets as never}
                theme={theme as never}
                mode={mode}
                context={context}
                onStudioReady={() => {
                  // ignore the state events Studio emits while restoring
                  setTimeout(() => (ready.current = true), 400);
                }}
                onStateUpdated={onStateUpdated}
                onStudioPreDestroyed={() => {
                  if (timer.current && save === "dirty") void persist();
                }}
                {...(aiSetup ? { ai: aiSetup as never } : {})}
              />
            </AgStudioProvider>
          </Boundary>
        </div>
      </section>

      {/* Trust footer */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11.5px] text-ink-3">
        <span className="text-warning">● SIMULATED meter data — hackathon demo</span>
        <span>Event scope: {boot.eventName}</span>
        <span>Snapshot {boot.snapshotId}</span>
        <span>Data as of {new Date(boot.dataAsOfUtc).toLocaleString("en-GB", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "medium" })} WAT{stale ? " (stale)" : ""}</span>
        <span>Verification {boot.verificationVersion ? `v${boot.verificationVersion}` : "not run"}</span>
        <span>Report saved {new Date(savedAt).toLocaleTimeString("en-GB", { timeZone: "Africa/Lagos" })}</span>
        <span>AG Studio is a read-only analytics layer — it never moves money or changes operations.</span>
      </div>

      <Dialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title="Reset to the default report?"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setResetOpen(false)}>Cancel</Button>
            <Button variant="danger" onClick={resetToDefault}>Reset report</Button>
          </>
        }
      >
        <p className="text-[13px] text-ink-2">Replaces this report&apos;s layout and widgets with the versioned PeakShift “Event Performance” template. Your event data is not affected. The reset is audited.</p>
      </Dialog>
    </div>
  );
}
