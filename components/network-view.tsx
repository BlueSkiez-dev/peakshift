"use client";
import { useMemo, useState } from "react";
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef, type ICellRendererParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { ShieldAlert } from "lucide-react";
import type { AuditEvent, ProfileDraft } from "@/lib/types";
import type { NetworkRow } from "@/lib/views";
import { kwh, money, stamp, windowLabel } from "@/lib/format";
import { Badge, Kpi, KV, Notice, cx } from "./ui";
import { Drawer } from "./overlay";

ModuleRegistry.registerModules([AllCommunityModule]);

export const gridTheme = themeQuartz.withParams({
  backgroundColor: "#101714",
  foregroundColor: "#e8efea",
  headerBackgroundColor: "#151d19",
  headerTextColor: "#9eaca5",
  borderColor: "#1f2a25",
  rowHoverColor: "#151d19",
  selectedRowBackgroundColor: "rgba(199,235,115,0.08)",
  accentColor: "#c7eb73",
  fontFamily: "var(--font-geist), ui-sans-serif",
  fontSize: 13,
  headerFontSize: 12,
  rowHeight: 52,
  headerHeight: 40,
  wrapperBorderRadius: 12,
  spacing: 7,
  oddRowBackgroundColor: "#101714",
  browserColorScheme: "dark",
});

const tone = (s: NetworkRow["status"]) => (s === "eligible" ? "success" : s === "critical" ? "danger" : "warning");

export function NetworkView({ rows, initial, shift, history, drafts }: { rows: NetworkRow[]; initial: string | null; shift: { start: string; end: string } | null; history: Record<string, AuditEvent[]>; drafts: Record<string, ProfileDraft | null> }) {
  const [open, setOpen] = useState<string | null>(initial);
  const sel = rows.find((r) => r.orgId === open);
  const cols = useMemo<ColDef<NetworkRow>[]>(
    () => [
      {
        field: "name",
        headerName: "Business",
        pinned: "left",
        minWidth: 220,
        flex: 1.4,
        cellRenderer: (p: ICellRendererParams<NetworkRow>) => (
          <div className="flex h-full items-center gap-2.5">
            <span className={cx("grid size-7 place-items-center rounded-full text-[11px] font-semibold", p.data!.status === "critical" ? "bg-danger-dim text-danger" : "bg-surface-3 text-ink-2")}>{p.data!.name[0]}</span>
            <span className="leading-tight">
              <span className="block font-medium">{p.data!.name}</span>
              <span className="block text-[11.5px] text-ink-3">{p.data!.category} · {p.data!.site}</span>
            </span>
          </div>
        ),
      },
      { field: "profileStatus", headerName: "Profile", width: 130, cellRenderer: (p: ICellRendererParams<NetworkRow>) => <Badge tone={p.value === "confirmed" ? "success" : "warning"}>{p.value === "confirmed" ? `Confirmed v${p.data!.profileVersion}` : "Draft"}</Badge> },
      { field: "capacityWh", headerName: "Flexible capacity", type: "rightAligned", width: 150, valueFormatter: (p) => (p.data!.status === "critical" ? "0 kWh" : kwh(p.value)) },
      { field: "window", headerName: "Available window", width: 170, valueFormatter: (p) => windowLabel(p.value) },
      { field: "rateMinor", headerName: "Min. rate", type: "rightAligned", width: 120, valueFormatter: (p) => (p.value == null ? "—" : `${money(p.value)}/kWh`) },
      { field: "statusLabel", headerName: "Safety / eligibility", minWidth: 250, flex: 1.2, cellRenderer: (p: ICellRendererParams<NetworkRow>) => <span className="flex h-full items-center gap-1.5">{p.data!.status === "critical" && <ShieldAlert className="size-3.5 text-danger" />}<Badge tone={tone(p.data!.status)}>{p.value}</Badge></span> },
      { field: "dataQuality", headerName: "Meter data", type: "rightAligned", width: 120, valueFormatter: (p) => `${p.value}%` },
      { field: "updatedAt", headerName: "Last updated", width: 170, valueFormatter: (p) => stamp(p.value) },
    ],
    [],
  );
  const eligible = rows.filter((r) => r.status === "eligible");
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Businesses" value={rows.length} sub="Fictional demo sites" />
        <Kpi label="Confirmed eligible capacity" value={(eligible.reduce((a, r) => a + r.capacityWh, 0) / 1000).toFixed(1)} unit="kWh" tone="signal" sub={shift ? `For alternate window ${windowLabel(shift)}` : undefined} />
        <Kpi label="Profiles needing review" value={rows.filter((r) => r.profileStatus !== "confirmed" || r.hasDraft).length} tone="warning" />
        <Kpi label="Critical-load exclusions" value={rows.filter((r) => r.status === "critical").length} sub="Hard block — never offered" />
      </div>
      <div className="h-[420px] overflow-hidden rounded-[12px] border border-line">
        <AgGridReact<NetworkRow> theme={gridTheme} rowData={rows} columnDefs={cols} onRowClicked={(e) => setOpen(e.data!.orgId)} getRowId={(p) => p.data.orgId} rowSelection={{ mode: "singleRow", checkboxes: false, enableClickSelection: true }} suppressCellFocus={false} />
      </div>
      <p className="text-[12px] text-ink-3">Select a row to open the profile, constraints, AI extraction evidence and audit history. Operators can&apos;t edit a business&apos;s safety declaration.</p>

      <Drawer open={!!sel} onClose={() => setOpen(null)} title={sel?.name} subtitle={sel ? `${sel.category} · ${sel.site}` : ""} width={520}>
        {sel && (
          <div className="space-y-5">
            {sel.status === "critical" ? (
              <Notice tone="danger" title="Critical load — excluded from offers">This site&apos;s only declared activity is marked critical by the business. It is excluded before any cost comparison and there is no override in the planner.</Notice>
            ) : sel.status === "window" ? (
              <Notice tone="warning" title="Window mismatch">Its confirmed window {windowLabel(sel.window)} doesn&apos;t overlap the current alternate window{shift ? ` (${windowLabel(shift)})` : ""}.</Notice>
            ) : (
              <Notice tone="success" title="Eligible for dispatch">Confirmed, non-critical, positive capacity, rate present and data quality above threshold.</Notice>
            )}
            <dl className="divide-y divide-line rounded-[10px] border border-line px-4">
              <KV k="Activity" v={sel.activity} />
              <KV k="Confirmed capacity" v={kwh(sel.capacityWh)} />
              <KV k="Window" v={windowLabel(sel.window)} />
              <KV k="Minimum rate" v={sel.rateMinor == null ? "—" : `${money(sel.rateMinor)}/kWh`} />
              <KV k="Minimum notice" v={sel.notice == null ? "—" : `${sel.notice} h`} />
              <KV k="Profile" v={`v${sel.profileVersion} · ${sel.profileStatus}`} />
            </dl>
            {sel.constraints.length > 0 && (
              <div>
                <div className="mb-1.5 text-[13px] font-medium">Operational constraints</div>
                <ul className="list-disc space-y-1 pl-5 text-[13px] text-ink-2">
                  {sel.constraints.map((c) => <li key={c}>{c}</li>)}
                </ul>
              </div>
            )}
            <div>
              <div className="mb-1.5 text-[13px] font-medium">Owner&apos;s description</div>
              <blockquote className="rounded-[10px] border-l-2 border-signal/60 bg-surface-2/50 px-4 py-3 text-[13px] italic text-ink-2">“{sel.freeText}”</blockquote>
              {drafts[sel.orgId] && (
                <p className="mt-2 text-[12px] text-ink-3">
                  AI extraction: {drafts[sel.orgId]!.engine.mode} · {drafts[sel.orgId]!.engine.model} · {drafts[sel.orgId]!.engine.promptVersion}
                </p>
              )}
            </div>
            <div>
              <div className="mb-1.5 text-[13px] font-medium">Profile audit</div>
              {history[sel.orgId]?.length ? (
                <ul className="space-y-1.5 text-[12px]">
                  {history[sel.orgId].map((h) => (
                    <li key={h.id} className="rounded-[8px] bg-surface-2/50 px-3 py-2">
                      <div className="text-ink">{h.summary}</div>
                      <div className="text-ink-3">{stamp(h.at)} · {h.actorName}</div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12px] text-ink-3">Seed profile v1 confirmed by the owner before the demo.</p>
              )}
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
