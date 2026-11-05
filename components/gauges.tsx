// Radial gauge + meter status components (inspired by the energy-ops visual references).
// Every value shown is computed server-side from authoritative records; the gauge only draws it.
import type { ReactNode } from "react";
import { CheckCircle2, CircleAlert, Gauge as GaugeIcon } from "lucide-react";
import { cx } from "./ui";

const TONE = { signal: "var(--signal)", info: "var(--info)", success: "var(--success)", warning: "var(--warning)", danger: "var(--danger)" };

export function RadialGauge({
  value,
  max = 100,
  label,
  display,
  unit,
  tone = "signal",
  rows,
  icon,
}: {
  value: number | null;
  max?: number;
  label: string;
  display: string;
  unit?: string;
  tone?: keyof typeof TONE;
  rows?: { k: string; v: ReactNode; trend?: "up" | "down" | "flat" }[];
  icon?: ReactNode;
}) {
  const r = 46;
  const c = 2 * Math.PI * r;
  const arc = 0.78; // 280° sweep, open at the bottom
  const pct = value == null ? 0 : Math.max(0, Math.min(1, value / max));
  return (
    <div className="flex h-full flex-col rounded-[12px] border border-line bg-surface p-4">
      <div className="text-center text-[13px] font-medium text-ink">{label}</div>
      <div className="relative mx-auto mt-2 size-[124px]">
        <svg viewBox="0 0 120 120" className="size-full -rotate-[230deg]" role="img" aria-label={`${label}: ${display}${unit ? " " + unit : ""}`}>
          <circle cx="60" cy="60" r={r} fill="none" stroke="var(--surface-3)" strokeWidth="9" strokeLinecap="round" strokeDasharray={`${c * arc} ${c}`} />
          <circle
            cx="60"
            cy="60"
            r={r}
            fill="none"
            stroke={TONE[tone]}
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={`${c * arc * pct} ${c}`}
            style={{ transition: "stroke-dasharray 600ms cubic-bezier(.2,.7,.2,1)" }}
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <span style={{ color: TONE[tone] }}>{icon ?? <GaugeIcon className="size-7" />}</span>
        </div>
      </div>
      <div className="-mt-2 text-center num">
        <div className="text-[20px] font-semibold tracking-[-0.02em]">{display}</div>
        {unit && <div className="text-[11.5px] text-ink-3" style={{ color: TONE[tone] }}>{unit}</div>}
      </div>
      {rows && (
        <dl className="mt-3 divide-y divide-line border-t border-line text-[11.5px]">
          {rows.map((x) => (
            <div key={x.k} className="flex items-center justify-between py-1.5">
              <dt className="text-ink-3">{x.k}</dt>
              <dd className="flex items-center gap-1 num text-ink-2">
                {x.v}
                {x.trend === "down" && <span className="text-success" aria-label="lower">▼</span>}
                {x.trend === "up" && <span className="text-warning" aria-label="higher">▲</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

export interface MeterRow {
  name: string;
  meter: string;
  status: "ok" | "missing" | "pending";
  coveragePct: number | null;
  intervals: string;
}

export function MeterStatus({ rows, caption }: { rows: MeterRow[]; caption?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-[12.5px]">
        <thead>
          <tr className="text-left text-[11.5px] text-ink-3">
            <th className="pb-2 font-medium">Meter</th>
            <th className="pb-2 font-medium">Site</th>
            <th className="pb-2 font-medium">Status</th>
            <th className="pb-2 font-medium">Quality</th>
            <th className="pb-2 text-right font-medium">Intervals</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.name + r.meter}>
              <td className="py-2.5 font-medium text-ink">{r.meter}</td>
              <td className="py-2.5 text-ink-2">{r.name}</td>
              <td className="py-2.5">
                <span className={cx("inline-flex items-center gap-1.5", r.status === "ok" ? "text-success" : r.status === "missing" ? "text-danger" : "text-ink-3")}>
                  {r.status === "ok" ? <CheckCircle2 className="size-3.5" /> : <CircleAlert className="size-3.5" />}
                  {r.status === "ok" ? "Ok" : r.status === "missing" ? "Missing" : "Awaiting replay"}
                </span>
              </td>
              <td className="py-2.5">
                {r.coveragePct == null ? (
                  <span className="text-ink-3">—</span>
                ) : (
                  <span className={cx("inline-flex items-center gap-1.5 num", r.coveragePct >= 90 ? "text-success" : "text-warning")}>
                    {r.coveragePct >= 90 ? <CheckCircle2 className="size-3.5" /> : <CircleAlert className="size-3.5" />}
                    {r.coveragePct}%
                  </span>
                )}
              </td>
              <td className="py-2.5 text-right num text-ink-2">{r.intervals}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {caption && <p className="mt-2 text-[11.5px] text-warning">{caption}</p>}
    </div>
  );
}
