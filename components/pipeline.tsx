import Link from "next/link";
import { Check } from "lucide-react";
import { STAGES, stageIndex, type Stage } from "@/lib/next";
import type { EventStatus } from "@/lib/types";
import { cx } from "./ui";

/** Seven-stage pipeline. Completed stages show a check; the current stage is lit; future stages are hatched. */
export function Pipeline({ status, eventId, active, compact }: { status: EventStatus; eventId: string; active?: Stage; compact?: boolean }) {
  const cur = stageIndex(status);
  return (
    <ol className={cx("grid gap-1.5", compact ? "grid-cols-7" : "grid-cols-2 sm:grid-cols-4 lg:grid-cols-7")} aria-label="Event stages">
      {STAGES.map((s, i) => {
        const done = i < cur;
        const now = i === cur;
        const sel = active === s.key;
        return (
          <li key={s.key}>
            <Link
              href={`/operator/events/${eventId}?stage=${s.key}`}
              aria-current={now ? "step" : undefined}
              className={cx(
                "group relative flex h-full flex-col rounded-[10px] border px-3 py-2.5 transition-colors",
                now ? "border-signal/50 bg-signal-dim" : done ? "border-line bg-surface-2/60 hover:bg-surface-2" : "border-line/70 hatch hover:border-line-2",
                sel && !now && "ring-1 ring-line-2",
              )}
            >
              <span className="flex items-center gap-2">
                <span className={cx("grid size-[18px] place-items-center rounded-full text-[10px] font-semibold num", done ? "bg-signal text-signal-ink" : now ? "border border-signal text-signal" : "border border-line-2 text-ink-3")}>
                  {done ? <Check className="size-3" strokeWidth={3} /> : i + 1}
                </span>
                <span className={cx("text-[13px] font-medium", now ? "text-ink" : done ? "text-ink" : "text-ink-3")}>{s.label}</span>
              </span>
              {!compact && <span className={cx("mt-1 pl-[26px] text-[11.5px]", now ? "text-signal" : "text-ink-3")}>{now ? "Current" : done ? "Complete" : s.desc}</span>}
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
