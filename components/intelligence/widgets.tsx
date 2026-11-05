"use client";
// Four PeakShift custom AG Studio widgets (v1.1 Addendum §9). Each implements AgWidgetDefinition:
// id, label, icon, typed dataMapping (roles + cardinality + aiDescription), a configuration form,
// a React comp reading data through widgetApi.getData, defaultSize/minSize, and ai.description.
import { useEffect, useRef, useState, type MouseEvent } from "react";
import type { AgWidgetFieldReference, AgWidgetParams, AgWidgetFormParams, AgBaseRegistry, AgBaseWidgetDefinition, AgDefaultWidgetDefinition, AgWidgetDataFormat } from "ag-studio";
import { AgIncompleteDataMappingOverlay, AgLoadingOverlay, AgNoDataOverlay } from "ag-studio-react";
import type { AgWidgetApi, AgWidgetDataQuery, AgWidgetDataResponse } from "ag-studio";

/**
 * Keep a widget query live through the widget data handle: Studio re-delivers the response whenever
 * data, filters or cross-filters change, and when the query definition changes (new params).
 * No per-render requests (no suspense loop) and no lapsed subscriptions after a refresh.
 */
function useWidgetData(widgetApi: AgWidgetApi, query: AgWidgetDataQuery | null, deps: unknown, crossFilter: "filter" | "highlight" = "filter") {
  const [resp, setResp] = useState<AgWidgetDataResponse | null>(null);
  const handle = useRef<ReturnType<AgWidgetApi["getDataHandle"]> | null>(null);
  useEffect(() => {
    try {
      const h = widgetApi.getDataHandle();
      h.open((update) => {
        const ev = update.results.find((r) => r.key === "main");
        if (ev) setResp(ev.response as AgWidgetDataResponse);
      }, { batchByFrame: false });
      handle.current = h;
    } catch {
      handle.current = null;
    }
    return () => {
      try {
        handle.current?.close();
      } catch {
        /* already closed */
      }
      handle.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const h = handle.current;
    if (!h) return;
    if (!query) {
      h.remove("main");
      return;
    }
    h.set("main", { query, options: { crossFilter } } as never);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps]);
  return resp;
}

type Ref = AgWidgetFieldReference[];
type Fmt = AgWidgetDataFormat<{ unit?: "Wh" | "kW"; showCumulative?: boolean }>;
export interface CapacityDef { type: "peakshift-flex-capacity"; dataMapping: { target: Ref; available: Ref; committed: Ref; verified: Ref }; format?: Fmt }
export interface EvidenceDef { type: "peakshift-load-shift-evidence"; dataMapping: { interval: Ref; baseline: Ref; actual: Ref; window: Ref }; format?: Fmt }
export interface ContributionDef { type: "peakshift-participant-contribution"; dataMapping: { participant: Ref; verified: Ref; committed: Ref }; format?: Fmt }
export interface PulseDef { type: "peakshift-settlement-pulse"; dataMapping: { status: Ref; amount: Ref }; format?: Fmt }

export interface PeakShiftRegistry extends AgBaseRegistry {
  widgets: readonly (
    | AgDefaultWidgetDefinition
    | AgBaseWidgetDefinition<"peakshift-flex-capacity", CapacityDef>
    | AgBaseWidgetDefinition<"peakshift-load-shift-evidence", EvidenceDef>
    | AgBaseWidgetDefinition<"peakshift-participant-contribution", ContributionDef>
    | AgBaseWidgetDefinition<"peakshift-settlement-pulse", PulseDef>
  )[];
}

export interface StudioContext {
  eventId: string;
  dataMode: "SIMULATED";
  dataAsOfUtc: string;
  snapshotId: string;
  lastWebhookAt: string | null;
  peakLabel: string;
  shiftLabel: string;
}

const C = { ink: "#e8efea", ink2: "#9eaca5", ink3: "#6a7973", line: "#1f2a25", line2: "#2b3832", signal: "#c7eb73", info: "#6fb4d2", warn: "#e4a74b", danger: "#e6786d", success: "#62c492", surface2: "#151d19" };
const n = (v: unknown) => (v == null || v === "" ? null : Number(v));
const fmtNum = (v: number | null, d = 1) => (v == null || Number.isNaN(v) ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d }));
const kwhFromWh = (wh: number | null) => (wh == null ? null : wh / 1000);

function Shell({ children, foot }: { children: React.ReactNode; foot?: React.ReactNode }) {
  return (
    <div style={{ position: "relative", height: "100%", display: "flex", flexDirection: "column", fontFamily: "var(--font-geist), ui-sans-serif", color: C.ink, padding: "4px 6px 6px" }}>
      <div style={{ flex: 1, minHeight: 0 }}>{children}</div>
      {foot && <div style={{ marginTop: 6, fontSize: 10.5, color: C.ink3, display: "flex", gap: 10, flexWrap: "wrap" }}>{foot}</div>}
    </div>
  );
}
const SimTag = () => <span style={{ color: C.warn }}>● Simulated data</span>;

// ============================================================ 1. Flexibility Capacity Monitor
function CapacityMonitor(params: AgWidgetParams<CapacityDef>) {
  const { widgetApi, dataMapping } = params;
  const fields = [dataMapping.target?.at(0), dataMapping.available?.at(0), dataMapping.committed?.at(0), dataMapping.verified?.at(0)];
  const present = fields.filter(Boolean) as NonNullable<(typeof fields)[number]>[];
  const res = useWidgetData(widgetApi, fields[0] ? { fields: present } : null, params);
  if (!fields[0]) return <AgIncompleteDataMappingOverlay />;
  if (!res) return <AgLoadingOverlay />;
  const row = res.results.rows.at(0);
  if (!row) return <AgNoDataOverlay />;
  const val = (f: (typeof fields)[number]) => (f ? n(row[f.key]) : null);
  const target = val(fields[0]) ?? 0;
  const available = val(fields[1]);
  const committed = val(fields[2]);
  const verified = val(fields[3]);
  const max = Math.max(target * 1.3, available ?? 0, committed ?? 0, verified ?? 0, 0.1);
  const stage = verified != null && verified > 0 ? "verified" : committed && committed > 0 ? "committed" : "available";
  const headline = stage === "verified" ? verified! : stage === "committed" ? committed! : (available ?? 0);
  const shortfall = Math.max(0, target - headline);
  const rows: [string, number | null, string, string][] = [
    ["Available", available, C.ink3, "Eligible confirmed candidate capacity"],
    ["Committed", committed, C.info, "Accepted commitments — not delivered energy"],
    ["Verified", verified, C.signal, "Verified shifted energy averaged over the peak"],
  ];
  return (
    <Shell foot={<><span>Unit: kW (average over peak)</span><SimTag /></>}>
      <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        <span style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", color: shortfall > 0.05 ? C.ink : C.signal }}>{fmtNum(headline, 2)}</span>
        <span style={{ fontSize: 12, color: C.ink2 }}>
          / {fmtNum(target, 2)} kW target · {stage === "verified" ? "verified" : stage === "committed" ? "committed" : "available"}
        </span>
        <span role="status" style={{ marginLeft: "auto", fontSize: 11, padding: "2px 8px", borderRadius: 999, background: shortfall > 0.05 ? "rgba(228,167,75,.13)" : "rgba(199,235,115,.12)", color: shortfall > 0.05 ? C.warn : C.signal }}>
          {shortfall > 0.05 ? `${stage === "verified" ? "Delivery shortfall" : stage === "committed" ? "Commitment gap" : "Capacity gap"} ${fmtNum(shortfall, 2)} kW` : stage === "verified" ? "Target delivered" : stage === "committed" ? "Commitment target covered" : "Capacity covers target"}
        </span>
      </div>
      <div style={{ position: "relative", display: "grid", gap: 7 }}>
        {rows.map(([label, v, color, hint]) => (
          <div key={label} title={hint} style={{ display: "grid", gridTemplateColumns: "72px 1fr 58px", alignItems: "center", gap: 8, fontSize: 11.5 }}>
            <span style={{ color: C.ink2 }}>{label}</span>
            <span style={{ height: 9, borderRadius: 5, background: C.surface2, overflow: "hidden" }}>
              <span style={{ display: "block", height: "100%", width: v == null ? 0 : `${(v / max) * 100}%`, background: label === "Available" ? `repeating-linear-gradient(135deg, ${C.ink3} 0 4px, ${C.line2} 4px 7px)` : color, borderRadius: 5, transition: "width 420ms cubic-bezier(.2,.7,.2,1)" }} />
            </span>
            <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: v == null ? C.ink3 : C.ink }}>{v == null ? "—" : fmtNum(v, 2)}</span>
          </div>
        ))}
        <div aria-hidden style={{ position: "absolute", top: -4, bottom: -4, left: `calc(80px + (100% - 146px) * ${target / max})`, width: 2, background: C.ink, borderRadius: 1 }}>
          <span style={{ position: "absolute", top: -14, left: -18, fontSize: 9.5, color: C.ink, whiteSpace: "nowrap" }}>Target</span>
        </div>
      </div>
    </Shell>
  );
}

// ============================================================ 2. Load Shift Evidence
function LoadShiftEvidence(params: AgWidgetParams<EvidenceDef>) {
  const { widgetApi, dataMapping, format, context } = params;
  const ctx = context as StudioContext | undefined;
  const fi = dataMapping.interval?.at(0);
  const fb = dataMapping.baseline?.at(0);
  const fa = dataMapping.actual?.at(0);
  const fw = dataMapping.window?.at(0);
  const [hover, setHover] = useState<number | null>(null);
  const res = useWidgetData(widgetApi, fi && fb && fa ? { fields: [fi, ...(fw ? [fw] : []), fb, fa], sort: [{ field: fi, direction: "asc" }] } : null, params);
  if (!fi || !fb || !fa) return <AgIncompleteDataMappingOverlay />;
  if (!res) return <AgLoadingOverlay />;
  const unit = format?.style?.unit ?? "Wh";
  const toUnit = (wh: number | null) => (wh == null ? null : unit === "kW" ? (wh * 60) / 15 / 1000 : wh);
  const rows = res.results.rows.map((r) => ({ t: String(r[fi.key]), w: fw ? String(r[fw.key] ?? "") : "", b: n(r[fb.key]), a: n(r[fa.key]) }));
  if (!rows.length || rows.every((r) => r.a == null)) return <AgNoDataOverlay />;
  const W = 1000;
  const H = 300;
  const pad = { l: 46, r: 12, t: 26, b: 22 };
  const vals = rows.flatMap((r) => [toUnit(r.b), toUnit(r.a)]).filter((v): v is number => v != null);
  const yMax = Math.max(...vals) * 1.12 || 1;
  const x = (i: number) => pad.l + (i / Math.max(1, rows.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / yMax) * (H - pad.t - pad.b);
  const path = (k: "a" | "b") => rows.map((r, i) => (r[k] == null ? "" : `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(toUnit(r[k])!).toFixed(1)}`)).join(" ");
  const band = (w: string) => {
    const idx = rows.map((r, i) => (r.w === w ? i : -1)).filter((i) => i >= 0);
    return idx.length ? { x1: x(idx[0]) - 4, x2: x(idx[idx.length - 1]) + 4 } : null;
  };
  const peak = band("PEAK");
  const shift = band("SHIFT");
  const sumW = (w: string, k: "a" | "b") => rows.filter((r) => r.w === w).reduce((s, r) => s + (r[k] ?? 0), 0);
  const peakRed = Math.max(0, sumW("PEAK", "b") - sumW("PEAK", "a"));
  const rebound = Math.max(0, sumW("SHIFT", "a") - sumW("SHIFT", "b"));
  // cumulative shifted energy (CUSUM of baseline − actual), display only
  const cusum = rows.reduce<number[]>((acc, r, i) => [...acc, (i ? acc[i - 1] : 0) + (r.b ?? 0) - (r.a ?? 0)], []);
  const cMax = Math.max(1, ...cusum.map(Math.abs));
  const showCum = format?.style?.showCumulative !== false;
  const h = hover != null ? rows[hover] : null;
  return (
    <Shell foot={<><span>{unit === "kW" ? "Average interval power (kW) = Wh × 60 ÷ 15 ÷ 1000" : "Interval energy (Wh), 15-minute intervals"}</span><SimTag />{ctx && <span>Snapshot {ctx.snapshotId.slice(-8)}</span>}</>}>
      <div style={{ display: "flex", gap: 14, fontSize: 11.5, color: C.ink2, marginBottom: 2, flexWrap: "wrap" }}>
        <span><b style={{ color: C.ink, fontWeight: 600 }}>{fmtNum(kwhFromWh(peakRed), 2)} kWh</b> peak reduction</span>
        <span><b style={{ color: C.ink, fontWeight: 600 }}>{fmtNum(kwhFromWh(rebound), 2)} kWh</b> alternate-window increase</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
          <Legend c={C.info} dash label="Baseline" /> <Legend c={C.signal} label="Actual" /> {showCum && <Legend c={C.danger} label="Cumulative shift" />}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: "calc(100% - 22px)" }} role="img" aria-label={`Baseline vs actual interval energy. Peak reduction ${fmtNum(kwhFromWh(peakRed), 2)} kWh, rebound ${fmtNum(kwhFromWh(rebound), 2)} kWh. Simulated.`} onMouseLeave={() => setHover(null)}>
        {shift && <rect x={shift.x1} y={pad.t} width={shift.x2 - shift.x1} height={H - pad.t - pad.b} fill={C.info} opacity={0.08} />}
        {peak && <rect x={peak.x1} y={pad.t} width={peak.x2 - peak.x1} height={H - pad.t - pad.b} fill={C.warn} opacity={0.12} />}
        {shift && <text x={shift.x1 + 6} y={pad.t - 8} fill={C.info} fontSize={12}>Alternate window {ctx?.shiftLabel ?? ""}</text>}
        {peak && <text x={peak.x1 + 6} y={pad.t - 8} fill={C.warn} fontSize={12}>Peak {ctx?.peakLabel ?? ""}</text>}
        {[0, 0.25, 0.5, 0.75, 1].map((g) => (
          <g key={g}>
            <line x1={pad.l} x2={W - pad.r} y1={y(yMax * g)} y2={y(yMax * g)} stroke={C.line} strokeDasharray="2 4" />
            <text x={pad.l - 6} y={y(yMax * g) + 4} fill={C.ink3} fontSize={11} textAnchor="end">{fmtNum(yMax * g, unit === "kW" ? 1 : 0)}</text>
          </g>
        ))}
        {rows.map((r, i) => (i % 4 === 0 ? <text key={i} x={x(i)} y={H - 6} fill={C.ink3} fontSize={11} textAnchor="middle">{r.t}</text> : null))}
        <path d={`${path("b")} L${x(rows.length - 1)},${H - pad.b} L${x(0)},${H - pad.b} Z`} fill={C.info} opacity={0.08} />
        <path d={path("b")} fill="none" stroke={C.info} strokeWidth={2} strokeDasharray="6 5" vectorEffect="non-scaling-stroke" />
        <path d={`${path("a")} L${x(rows.length - 1)},${H - pad.b} L${x(0)},${H - pad.b} Z`} fill={C.signal} opacity={0.14} />
        <path d={path("a")} fill="none" stroke={C.signal} strokeWidth={2.4} vectorEffect="non-scaling-stroke" />
        {showCum && <path d={cusum.map((c, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${(pad.t + (1 - (c / cMax + 1) / 2) * (H - pad.t - pad.b)).toFixed(1)}`).join(" ")} fill="none" stroke={C.danger} strokeWidth={1.6} opacity={0.85} vectorEffect="non-scaling-stroke" />}
        {rows.map((_, i) => (
          <rect key={i} x={x(i) - (W / rows.length) / 2} y={pad.t} width={W / rows.length} height={H - pad.t - pad.b} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
        {h && hover != null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke={C.ink2} strokeDasharray="3 3" />
            {h.a != null && <circle cx={x(hover)} cy={y(toUnit(h.a)!)} r={4} fill={C.signal} />}
            {h.b != null && <circle cx={x(hover)} cy={y(toUnit(h.b)!)} r={4} fill={C.info} />}
          </g>
        )}
      </svg>
      {h && hover != null && (
        <div role="status" style={{ position: "absolute", top: 34, left: `min(calc(${(x(hover) / W) * 100}% + 12px), calc(100% - 190px))`, background: "rgba(16,23,20,.96)", border: `1px solid ${C.line2}`, borderRadius: 8, padding: "6px 9px", fontSize: 11.5, lineHeight: 1.55, pointerEvents: "none", minWidth: 170 }}>
          <div style={{ color: C.ink, fontWeight: 600 }}>{h.t} · {h.w === "PEAK" ? "Peak" : h.w === "SHIFT" ? "Alternate" : "Outside windows"}</div>
          <div style={{ color: C.info }}>Baseline {fmtNum(toUnit(h.b), unit === "kW" ? 2 : 0)} {unit}</div>
          <div style={{ color: C.signal }}>Actual {fmtNum(toUnit(h.a), unit === "kW" ? 2 : 0)} {unit}</div>
          <div style={{ color: C.ink2 }}>Δ {h.a != null && h.b != null ? fmtNum(toUnit(h.a - h.b), unit === "kW" ? 2 : 0) : "—"} {unit} · simulated</div>
        </div>
      )}
    </Shell>
  );
}
const Legend = ({ c, label, dash }: { c: string; label: string; dash?: boolean }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
    <svg width="16" height="6"><line x1="0" x2="16" y1="3" y2="3" stroke={c} strokeWidth="2.4" strokeDasharray={dash ? "4 3" : undefined} /></svg>
    {label}
  </span>
);

// ============================================================ 3. Participant Contribution
function ParticipantContribution(params: AgWidgetParams<ContributionDef>) {
  const { widgetApi, dataMapping } = params;
  const fp = dataMapping.participant?.at(0);
  const fv = dataMapping.verified?.at(0);
  const fc = dataMapping.committed?.at(0);
  const res = useWidgetData(widgetApi, fp && fv ? { fields: [fp, fv, ...(fc ? [fc] : [])] } : null, params, "highlight");
  if (!fp || !fv) return <AgIncompleteDataMappingOverlay />;
  if (!res) return <AgLoadingOverlay />;
  const rows = res.results.rows.map((r) => ({ p: r[fp.key], v: n(r[fv.key]), c: fc ? n(r[fc.key]) : null }));
  if (!rows.length) return <AgNoDataOverlay />;
  const verified = rows.filter((r) => r.v != null && r.v > 0).sort((a, b) => b.v! - a.v!);
  const notVerified = rows.filter((r) => r.v == null || r.v <= 0);
  const max = Math.max(1, ...rows.map((r) => Math.max(r.v ?? 0, r.c ?? 0)));
  const selected = new Set((widgetApi.getCrossFilterSelections() ?? []).flatMap((s) => (s.type === "value" ? s.values : [])));
  const crossRows = res.crossFilter?.rows;
  const toggle = (e: MouseEvent, p: unknown) => {
    widgetApi.toggleCrossFilter({ type: "value", value: p as string, field: fp, group: 0, reset: !(e.metaKey || e.ctrlKey) });
    e.stopPropagation();
  };
  return (
    <Shell foot={<><span>Sorted by verified shifted energy · click a business to filter related widgets</span><SimTag /></>}>
      <div onClick={() => widgetApi.resetCrossFilter()} style={{ height: "100%", overflow: "auto", display: "grid", alignContent: "start", gap: 8 }}>
        {verified.map((r, rank) => {
          const isSel = selected.has(r.p as never);
          const dim = selected.size > 0 && !isSel;
          const pct = r.c ? Math.round(((r.v ?? 0) / r.c) * 1000) / 10 : null;
          return (
            <button key={String(r.p)} onClick={(e) => toggle(e, r.p)} aria-pressed={isSel} style={{ all: "unset", cursor: "pointer", opacity: dim ? 0.4 : 1, display: "grid", gap: 4, padding: "5px 6px", borderRadius: 7, background: isSel ? "rgba(199,235,115,.08)" : "transparent", outline: isSel ? `1px solid rgba(199,235,115,.35)` : "none" }}>
              <span style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                <span style={{ color: C.ink }}>
                  <span style={{ color: C.ink3, marginRight: 6, fontVariantNumeric: "tabular-nums" }}>{rank + 1}</span>
                  {widgetApi.formatFieldValue(fp, r.p)}
                </span>
                <span style={{ fontVariantNumeric: "tabular-nums", color: C.ink }}>
                  {fmtNum(kwhFromWh(r.v), 2)} kWh{pct != null && <span style={{ color: pct >= 99.5 ? C.success : C.ink2 }}> · {pct}%</span>}
                </span>
              </span>
              <span style={{ position: "relative", height: 8, borderRadius: 4, background: C.surface2 }}>
                <span style={{ position: "absolute", inset: 0, width: `${((r.v ?? 0) / max) * 100}%`, background: C.signal, borderRadius: 4, transition: "width 400ms" }} />
                {r.c != null && <span title={`Committed ${fmtNum(kwhFromWh(r.c), 2)} kWh`} style={{ position: "absolute", top: -3, bottom: -3, left: `calc(${(r.c / max) * 100}% - 1px)`, width: 2, background: C.ink, borderRadius: 1 }} />}
              </span>
            </button>
          );
        })}
        {notVerified.length > 0 && (
          <div style={{ marginTop: 4, paddingTop: 6, borderTop: `1px dashed ${C.line2}`, fontSize: 11.5, color: C.ink2 }}>
            <div style={{ color: C.warn, marginBottom: 3 }}>Not verified / insufficient data</div>
            {notVerified.map((r) => (
              <div key={String(r.p)}>{widgetApi.formatFieldValue(fp, r.p)} — no verified result (not zero performance)</div>
            ))}
          </div>
        )}
        {crossRows && <span style={{ fontSize: 10.5, color: C.ink3 }}>Filtered by another widget</span>}
      </div>
    </Shell>
  );
}

// ============================================================ 4. Settlement Pulse
const PULSE: Record<string, { label: string; color: string; group: "completed" | "inflight" | "exception" | "other" }> = {
  SUCCEEDED: { label: "Paid", color: C.success, group: "completed" },
  READY: { label: "Approved", color: C.ink3, group: "inflight" },
  SUBMITTED: { label: "Submitted", color: C.info, group: "inflight" },
  PENDING: { label: "Pending", color: C.info, group: "inflight" },
  PROCESSING: { label: "Processing", color: C.info, group: "inflight" },
  UNKNOWN: { label: "Awaiting confirmation", color: C.warn, group: "inflight" },
  UNCLAIMED: { label: "Unclaimed", color: C.warn, group: "exception" },
  HELD: { label: "Held", color: C.warn, group: "exception" },
  FAILED: { label: "Failed", color: C.danger, group: "exception" },
  RETURNED: { label: "Returned", color: C.danger, group: "exception" },
  BLOCKED: { label: "Blocked", color: C.danger, group: "exception" },
  REFUNDED: { label: "Refunded", color: C.ink3, group: "other" },
  CANCELLED: { label: "Cancelled", color: C.ink3, group: "other" },
};
function SettlementPulse(params: AgWidgetParams<PulseDef>) {
  const { widgetApi, dataMapping, context } = params;
  const ctx = context as StudioContext | undefined;
  const fs = dataMapping.status?.at(0);
  const fa = dataMapping.amount?.at(0);
  const res = useWidgetData(widgetApi, fs && fa ? { fields: [fs, fa] } : null, params, "highlight");
  if (!fs || !fa) return <AgIncompleteDataMappingOverlay />;
  if (!res) return <AgLoadingOverlay />;
  const all = res.results.rows.map((r) => ({ s: String(r[fs.key]), a: n(r[fa.key]) ?? 0 }));
  if (!all.length) return <AgNoDataOverlay />;
  // When another widget cross-filters (e.g. a business is selected), Studio returns the filtered subset in `crossFilter`.
  const filtered = res.crossFilter ? res.crossFilter.rows.map((r) => ({ s: String(r[fs.key]), a: n(r[fa.key]) ?? 0 })) : null;
  const rows = filtered ?? all;
  const grand = all.reduce((x, r) => x + r.a, 0);
  const total = rows.reduce((x, r) => x + r.a, 0);
  const by = (g: string) => rows.filter((r) => (PULSE[r.s]?.group ?? "other") === g).reduce((x, r) => x + r.a, 0);
  const usd = (minor: number) => `$${(minor / 100).toFixed(2)}`;
  const selected = new Set((widgetApi.getCrossFilterSelections() ?? []).flatMap((s) => (s.type === "value" ? s.values : [])));
  const tiles: [string, number, string][] = [
    ["Submitted", total, C.ink],
    ["Paid", by("completed"), C.success],
    ["In flight", by("inflight"), C.info],
    ["Exceptions", by("exception"), C.warn],
  ];
  return (
    <Shell foot={<>{filtered && <span style={{ color: C.signal }}>Filtered: {usd(total)} of {usd(grand)}</span>}<span>PayPal item status · batch status is separate · amounts in USD from minor units</span><span>Last webhook: {ctx?.lastWebhookAt ? new Date(ctx.lastWebhookAt).toLocaleTimeString("en-GB", { timeZone: "Africa/Lagos" }) + " WAT" : "none yet"}</span></>}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 6 }}>
        {tiles.map(([k, v, c]) => (
          <div key={k} style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 8px" }}>
            <div style={{ fontSize: 9.5, letterSpacing: ".06em", textTransform: "uppercase", color: C.ink3 }}>{k}</div>
            <div style={{ fontSize: 17, fontWeight: 600, color: c, fontVariantNumeric: "tabular-nums" }}>{usd(v)}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden", margin: "10px 0 8px", background: C.surface2 }} role="img" aria-label="Payout amount by item status">
        {rows.map((r) => (
          <span key={r.s} style={{ width: `${(r.a / Math.max(1, total)) * 100}%`, background: PULSE[r.s]?.color ?? C.ink3 }} />
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {rows.map((r) => {
          const m = PULSE[r.s] ?? { label: r.s, color: C.ink3 };
          const isSel = selected.has(r.s as never);
          return (
            <button key={r.s} aria-pressed={isSel} onClick={(e) => { widgetApi.toggleCrossFilter({ type: "value", value: r.s, field: fs, group: 0, reset: !(e.metaKey || e.ctrlKey) }); e.stopPropagation(); }} style={{ all: "unset", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, padding: "3px 8px", borderRadius: 999, border: `1px solid ${isSel ? m.color : C.line2}`, color: C.ink }}>
              <span style={{ width: 7, height: 7, borderRadius: 4, background: m.color }} />
              {m.label} · {usd(r.a)}
            </button>
          );
        })}
      </div>
    </Shell>
  );
}

// ============================================================ Registry
const ICON = (d: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

export function peakshiftWidgetTypes() {
  const numeric = (aiDescription: string, required = true) => ({ type: "field" as const, supportedRoles: ["numeric" as const], requires: { cardinality: "one" as const }, required, aiDescription });
  const category = (aiDescription: string, required = true) => ({ type: "field" as const, supportedRoles: ["category" as const], requires: { cardinality: "many" as const }, required, aiDescription });
  return [
    {
      id: "peakshift-flex-capacity",
      label: "Flexibility Capacity",
      icon: ICON('<rect x="3" y="6" width="18" height="4" rx="2"/><rect x="3" y="14" width="12" height="4" rx="2"/><path d="M17 3v18"/>'),
      dataMapping: {
        target: numeric("Event target reduction in kW (events.targetReductionKw, max)."),
        available: numeric("Eligible candidate capacity in kW (events.availableCandidateKw, max).", false),
        committed: numeric("Accepted commitment in kW (events.committedKw, max). Not delivered energy.", false),
        verified: numeric("Verified contribution in kW (events.verifiedKw, max).", false),
      },
      form: (p: AgWidgetFormParams<CapacityDef>) => p.createDefaults({ dataMappingItems: [{ key: "target", label: "Target (kW)" }, { key: "available", label: "Available (kW)" }, { key: "committed", label: "Committed (kW)" }, { key: "verified", label: "Verified (kW)" }] }),
      comp: CapacityMonitor,
      defaultSize: { width: 520, height: 230 },
      minSize: { width: 300, height: 170 },
      ai: { label: "Flexibility Capacity Monitor", description: "Segmented kW meter comparing available, committed and verified flexibility against the event target with a target marker and shortfall status. Use for 'are we on target?' questions.", usage: "Map target, available, committed and verified from the events table (aggregation max)." },
    },
    {
      id: "peakshift-load-shift-evidence",
      label: "Load Shift Evidence",
      icon: ICON('<path d="M3 17c3 0 4-8 7-8s3 4 5 4 3-5 6-5"/><path d="M3 20h18" opacity=".5"/>'),
      dataMapping: {
        interval: category("15-minute interval label (meterIntervals.intervalLabel)."),
        baseline: numeric("Baseline interval energy in Wh (meterIntervals.baselineWh, sum)."),
        actual: numeric("Actual interval energy in Wh (meterIntervals.actualWh, sum)."),
        window: category("Window type PEAK/SHIFT/OTHER (meterIntervals.windowType) used to shade the peak and alternate windows.", false),
      },
      form: (p: AgWidgetFormParams<EvidenceDef>) => p.createDefaults({ dataMappingItems: [{ key: "interval", label: "Interval" }, { key: "baseline", label: "Baseline (Wh)" }, { key: "actual", label: "Actual (Wh)" }, { key: "window", label: "Window type" }] }),
      comp: LoadShiftEvidence,
      defaultSize: { width: 900, height: 380 },
      minSize: { width: 420, height: 240 },
      featureConfig: { crossFilter: { supportsHighlight: false } },
      ai: { label: "Load Shift Evidence", description: "Time series of baseline vs actual interval energy with shaded peak and alternate windows, peak reduction, alternate-window increase and a cumulative-shift line. Use to show whether consumption left the peak and reappeared in the permitted window. Data is simulated.", usage: "Map interval=meterIntervals.intervalLabel, baseline=meterIntervals.baselineWh (sum), actual=meterIntervals.actualWh (sum), window=meterIntervals.windowType." },
    },
    {
      id: "peakshift-participant-contribution",
      label: "Participant Contribution",
      icon: ICON('<path d="M4 6h12M4 12h16M4 18h8"/>'),
      dataMapping: {
        participant: category("Business display name (businesses.displayName)."),
        verified: numeric("Verified shifted energy in Wh (verificationResults.verifiedShiftWh, sum)."),
        committed: numeric("Committed energy in Wh (verificationResults.committedWh or offers.committedWh, sum).", false),
      },
      form: (p: AgWidgetFormParams<ContributionDef>) => p.createDefaults({ supportsCrossHighlight: true, dataMappingItems: [{ key: "participant", label: "Business" }, { key: "verified", label: "Verified (Wh)" }, { key: "committed", label: "Committed (Wh)" }] }),
      comp: ParticipantContribution,
      defaultSize: { width: 440, height: 380 },
      minSize: { width: 280, height: 200 },
      featureConfig: { crossFilter: { supportsHighlight: true } },
      ai: { label: "Participant Contribution", description: "Ranked bars of verified shifted energy per business with a committed-energy marker and delivery %. Clicking a business cross-filters related widgets. Use for 'who contributed' or 'committed vs verified by business'.", usage: "Map participant=businesses.displayName, verified=verificationResults.verifiedShiftWh (sum), committed=verificationResults.committedWh (sum)." },
    },
    {
      id: "peakshift-settlement-pulse",
      label: "Settlement Pulse",
      icon: ICON('<path d="M3 12h4l2-6 4 12 2-6h6"/>'),
      dataMapping: {
        status: category("PayPal payout item status (payoutItems.payoutStatus)."),
        amount: numeric("Payout amount in minor units (payoutItems.amountMinor, sum)."),
      },
      form: (p: AgWidgetFormParams<PulseDef>) => p.createDefaults({ supportsCrossHighlight: true, dataMappingItems: [{ key: "status", label: "Payout status" }, { key: "amount", label: "Amount (minor units)" }] }),
      comp: SettlementPulse,
      defaultSize: { width: 520, height: 260 },
      minSize: { width: 320, height: 200 },
      featureConfig: { crossFilter: { supportsHighlight: true } },
      ai: { label: "Settlement Pulse", description: "Submitted / paid / in-flight / exception amounts and a status distribution of PayPal payout items. Paid means item status SUCCEEDED only. Use for payout reconciliation questions.", usage: "Map status=payoutItems.payoutStatus, amount=payoutItems.amountMinor (sum)." },
    },
  ];
}

export const WIDGET_MENU = [{ label: "PeakShift", widgetIds: ["peakshift-flex-capacity", "peakshift-load-shift-evidence", "peakshift-participant-contribution", "peakshift-settlement-pulse"] }];
