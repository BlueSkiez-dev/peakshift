"use client";
// AG Charts wrappers themed to PeakShift tokens. Every chart ships a text summary + data table toggle.
import { useMemo, useState } from "react";
import { AgCharts } from "ag-charts-react";
import { AllCommunityModule, ModuleRegistry, type AgChartOptions } from "ag-charts-community";
import { Table2 } from "lucide-react";
import { cx } from "./ui";

ModuleRegistry.registerModules([AllCommunityModule]);

export type Theme = "control" | "field";
const T = {
  control: { ink: "#e8efea", ink2: "#9eaca5", ink3: "#6a7973", grid: "#1b2520", line: "#2b3832", baseline: "#6fb4d2", event: "#c7eb73", bg: "transparent", warn: "#e4a74b", danger: "#e6786d", success: "#62c492", tooltipBg: "#151d19" },
  field: { ink: "#17211e", ink2: "#5e6b65", ink3: "#85918b", grid: "#e5ebe6", line: "#cfd9d2", baseline: "#3c7188", event: "#2f7658", bg: "transparent", warn: "#a66b16", danger: "#b44e45", success: "#2f7658", tooltipBg: "#ffffff" },
};
export const PALETTE = (t: Theme) => (t === "control" ? ["#c7eb73", "#6fb4d2", "#e4a74b", "#b49cf0", "#62c492", "#e6786d"] : ["#2f7658", "#3c7188", "#a66b16", "#6d5bb8", "#5c8f2a", "#b44e45"]);

export function baseTheme(t: Theme) {
  const c = T[t];
  return {
    baseTheme: (t === "control" ? "ag-default-dark" : "ag-default") as "ag-default-dark" | "ag-default",
    palette: { fills: PALETTE(t), strokes: PALETTE(t) },
    params: {
      fontFamily: "var(--font-geist), ui-sans-serif, system-ui",
      backgroundColor: c.bg,
      foregroundColor: c.ink,
      textColor: c.ink2,
      fontSize: 12,
      axisColor: c.line,
      gridLineColor: c.grid,
      chartPadding: 4,
    },
    overrides: {
      common: {
        background: { visible: false },
        legend: { item: { label: { color: c.ink2, fontSize: 12 }, marker: { shape: "square", size: 9 } } },
        tooltip: {},
      },
    },
  };
}

function ChartFrame({ height, summary, table, children, className }: { height: number; summary: string; table: { head: string[]; rows: (string | number)[][] }; children: React.ReactNode; className?: string }) {
  const [showTable, setShowTable] = useState(false);
  return (
    <figure className={cx("relative", className)}>
      <figcaption className="sr-only">{summary}</figcaption>
      <button onClick={() => setShowTable((s) => !s)} className="absolute right-0 -top-1 z-10 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-ink-3 hover:bg-surface-2 hover:text-ink" aria-pressed={showTable} title="Show data table">
        <Table2 className="size-3.5" /> {showTable ? "Chart" : "Data"}
      </button>
      {showTable ? (
        <div className="overflow-auto rounded-[8px] border border-line" style={{ height }}>
          <table className="w-full text-[12px] num">
            <thead className="sticky top-0 bg-surface-2 text-ink-2">
              <tr>{table.head.map((h) => <th key={h} className="px-3 py-1.5 text-left font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i} className="border-t border-line">
                  {r.map((v, j) => <td key={j} className={cx("px-3 py-1", j > 0 && "text-right")}>{v}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ height }}>{children}</div>
      )}
    </figure>
  );
}

// ------------------------------------------------------------ Demand curve: baseline vs event with peak / alternate bands
export function DemandChart({
  rows,
  peak,
  shift,
  theme = "control",
  height = 300,
  showActual = true,
  targetKwh,
}: {
  rows: { t: string; baseline: number; actual: number | null }[];
  peak: { start: string; end: string };
  shift: { start: string; end: string };
  theme?: Theme;
  height?: number;
  showActual?: boolean;
  targetKwh?: number;
}) {
  const c = T[theme];
  const lastOf = (end: string) => {
    const [h, m] = end.split(":").map(Number);
    const i = h * 4 + Math.floor(m / 15) - 1;
    return `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`;
  };
  const hasActual = showActual && rows.some((r) => r.actual != null);
  const options = useMemo<AgChartOptions>(
    () => ({
      theme: baseTheme(theme),
      data: rows,
      series: [
        { type: "area", xKey: "t", yKey: "baseline", yName: "Baseline (comparable day)", fill: c.baseline, fillOpacity: 0.12, stroke: c.baseline, strokeWidth: 1.5, lineDash: [4, 3], marker: { enabled: false } },
        ...(hasActual ? [{ type: "area" as const, xKey: "t", yKey: "actual", yName: "Event day", fill: c.event, fillOpacity: 0.22, stroke: c.event, strokeWidth: 2, marker: { enabled: false } }] : []),
      ],
      axes: {
        x: {
          type: "category",
          position: "bottom",
          label: { color: c.ink3, fontSize: 11, formatter: ({ value }: { value: string }) => (value.endsWith(":00") && Number(value.slice(0, 2)) % 3 === 0 ? value : "") },
          line: { stroke: c.line },
          gridLine: { enabled: false },
          crossLines: [
            { type: "range", range: [shift.start, lastOf(shift.end)], fill: c.baseline, fillOpacity: 0.07, strokeWidth: 0, label: { text: "Alternate window", position: "top", color: c.ink2, fontSize: 11 } },
            { type: "range", range: [peak.start, lastOf(peak.end)], fill: c.warn, fillOpacity: 0.1, strokeWidth: 0, label: { text: "Peak", position: "top", color: c.warn, fontSize: 11 } },
          ],
        },
        y: {
          type: "number",
          position: "left",
          title: { text: "kWh per 15 min", color: c.ink3, fontSize: 11 },
          label: { color: c.ink3, fontSize: 11 },
          gridLine: { style: [{ stroke: c.grid, lineDash: [2, 3] }] },
        },
      },
      legend: { position: "bottom", spacing: 16 },
    }) as AgChartOptions,
    [rows, peak, shift, theme, hasActual, c],
  );
  const peakRows = rows.filter((r) => r.t >= peak.start && r.t < peak.end);
  const bPeak = peakRows.reduce((a, r) => a + r.baseline, 0);
  const aPeak = peakRows.reduce((a, r) => a + (r.actual ?? 0), 0);
  const summary = hasActual
    ? `Baseline peak energy ${bPeak.toFixed(1)} kWh; event-day peak energy ${aPeak.toFixed(1)} kWh. Simulated meter data.`
    : `Baseline peak energy ${bPeak.toFixed(1)} kWh${targetKwh ? `; target reduction ${targetKwh.toFixed(1)} kWh` : ""}. Simulated meter data.`;
  return (
    <ChartFrame height={height} summary={summary} table={{ head: ["Interval", "Baseline kWh", "Event kWh"], rows: rows.map((r) => [r.t, r.baseline.toFixed(2), r.actual == null ? "—" : r.actual.toFixed(2)]) }}>
      <AgCharts options={options} style={{ height: "100%", width: "100%" }} />
    </ChartFrame>
  );
}

// ------------------------------------------------------------ Generic bar/line/area/donut from a widget spec
export function SpecChart({
  kind,
  rows,
  x,
  series,
  unit,
  theme = "control",
  height = 260,
}: {
  kind: "bar" | "line" | "area" | "donut";
  rows: Record<string, unknown>[];
  x: string;
  series: { key: string; label: string }[];
  unit?: string;
  theme?: Theme;
  height?: number;
}) {
  const c = T[theme];
  const fmt = (v: number) => (unit === "USD" ? `$${v.toFixed(2)}` : unit === "USD/kWh" ? `$${v.toFixed(2)}/kWh` : unit === "%" ? `${v}%` : unit ? `${v} ${unit}` : String(v));
  const options = useMemo<AgChartOptions>(() => {
    if (kind === "donut") {
      return {
        theme: baseTheme(theme),
        data: rows,
        series: [{ type: "donut", angleKey: series[0].key, legendItemKey: x, innerRadiusRatio: 0.68, strokeWidth: 0, calloutLabel: { enabled: false }, sectorLabel: { enabled: false } }],
        legend: { position: "right" },
      } as AgChartOptions;
    }
    return {
      theme: baseTheme(theme),
      data: rows,
      series: series.map((s) => ({
        type: kind,
        xKey: x,
        yKey: s.key,
        yName: s.label,
        ...(kind === "bar" ? { cornerRadius: 3, label: { enabled: rows.length <= 8, formatter: ({ value }: { value: number }) => fmt(value), color: c.ink2, fontSize: 10.5, placement: "outside-end" } } : { marker: { enabled: kind === "line", size: 5 } }),
        ...(kind === "area" ? { fillOpacity: 0.16 } : {}),
        tooltip: { renderer: ({ datum }: { datum: Record<string, number | string> }) => ({ heading: String(datum[x]), title: s.label, data: [{ label: s.label, value: fmt(Number(datum[s.key])) }] }) },
      })),
      axes: {
        x: { type: "category", position: "bottom", label: { color: c.ink3, fontSize: 11 }, line: { stroke: c.line } },
        y: { type: "number", position: "left", label: { color: c.ink3, fontSize: 11 }, gridLine: { style: [{ stroke: c.grid, lineDash: [2, 3] }] }, title: unit ? { text: unit, color: c.ink3, fontSize: 11 } : undefined },
      },
      legend: { position: "bottom", enabled: series.length > 1 },
    } as AgChartOptions;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, rows, x, series, unit, theme]);
  return (
    <ChartFrame height={height} summary={`${series.map((s) => s.label).join(" and ")} by ${x}.`} table={{ head: [x, ...series.map((s) => s.label)], rows: rows.map((r) => [String(r[x]), ...series.map((s) => (r[s.key] == null ? "—" : String(r[s.key])))]) }}>
      <AgCharts options={options} style={{ height: "100%", width: "100%" }} />
    </ChartFrame>
  );
}
