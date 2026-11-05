import { cx } from "./ui";

/** PeakShift mark: a demand curve whose evening peak is clipped and moved into the afternoon. */
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cx("size-7", className)} aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--brand)" />
      <path d="M5 23 C8 23 9 14 12.5 14 C15.5 14 15.5 19 18 19 L22 19 C24 19 24.5 23 27 23" fill="none" stroke="var(--signal)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 11.5 h5.5 M20 11.5 l2 -2 M20 11.5 l2 2" fill="none" stroke="var(--signal)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" opacity="0.65" transform="matrix(-1 0 0 1 45.5 0)" />
    </svg>
  );
}

export function Wordmark({ className, sub }: { className?: string; sub?: string }) {
  return (
    <div className={cx("flex items-center gap-2.5", className)}>
      <Mark />
      <div className="leading-none">
        <div className="text-[15px] font-semibold tracking-[-0.02em] text-ink">PeakShift</div>
        {sub && <div className="mt-1 text-[11px] text-ink-3">{sub}</div>}
      </div>
    </div>
  );
}
