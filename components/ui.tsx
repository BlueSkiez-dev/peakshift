import type { ButtonHTMLAttributes, ReactNode } from "react";
import { AlertTriangle, Check, CircleDashed, Info, Loader2, ShieldAlert, X } from "lucide-react";
import type { Tone } from "@/lib/status";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------- Button
type Variant = "primary" | "secondary" | "ghost" | "danger" | "signal";
export function Button({
  variant = "secondary",
  size = "md",
  loading,
  loadingLabel,
  icon,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg"; loading?: boolean; loadingLabel?: string; icon?: ReactNode }) {
  const v = {
    primary: "bg-signal text-signal-ink hover:brightness-105 active:brightness-95 font-semibold shadow-[0_0_0_1px_rgba(0,0,0,0.04)_inset]",
    signal: "bg-signal text-signal-ink hover:brightness-105 font-semibold",
    secondary: "bg-surface-2 text-ink border border-line-2 hover:bg-surface-3",
    ghost: "text-ink-2 hover:text-ink hover:bg-surface-2",
    danger: "bg-transparent text-danger border border-danger/40 hover:bg-danger-dim",
  }[variant];
  const s = { sm: "h-8 px-3 text-[13px] gap-1.5", md: "h-10 px-4 text-sm gap-2", lg: "h-12 px-5 text-[15px] gap-2" }[size];
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      aria-busy={loading || undefined}
      className={cx("inline-flex items-center justify-center rounded-[8px] whitespace-nowrap transition-[filter,background-color,color] duration-150 disabled:opacity-45 disabled:cursor-not-allowed select-none", v, s, className)}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {loading && loadingLabel ? loadingLabel : children}
    </button>
  );
}

// ---------------------------------------------------------------- Status badge (text + icon + colour — never colour alone)
const toneCls: Record<Tone, string> = {
  neutral: "bg-neutral-dim text-ink-2",
  info: "bg-info-dim text-info",
  signal: "bg-signal-dim text-signal",
  success: "bg-success-dim text-success",
  warning: "bg-warning-dim text-warning",
  danger: "bg-danger-dim text-danger",
};
const toneIcon: Record<Tone, ReactNode> = {
  neutral: <CircleDashed className="size-3" aria-hidden />,
  info: <Info className="size-3" aria-hidden />,
  signal: <span className="size-1.5 rounded-full bg-current" aria-hidden />,
  success: <Check className="size-3" aria-hidden />,
  warning: <AlertTriangle className="size-3" aria-hidden />,
  danger: <ShieldAlert className="size-3" aria-hidden />,
};
export function Badge({ tone = "neutral", children, title, className, pulse }: { tone?: Tone; children: ReactNode; title?: string; className?: string; pulse?: boolean }) {
  return (
    <span title={title} className={cx("inline-flex items-center gap-1.5 rounded-full px-2 py-[3px] text-[11.5px] font-medium leading-none whitespace-nowrap", toneCls[tone], className)}>
      <span className={cx("inline-flex", pulse && "anim-pulse")}>{toneIcon[tone]}</span>
      {children}
    </span>
  );
}

export function StatusBadge({ meta, pulse }: { meta: { label: string; tone: Tone; hint: string }; pulse?: boolean }) {
  return (
    <Badge tone={meta.tone} title={meta.hint} pulse={pulse}>
      {meta.label}
    </Badge>
  );
}

// ---------------------------------------------------------------- Surfaces
export function Panel({ title, action, children, className, subtitle, bodyClass, id }: { title?: ReactNode; subtitle?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; bodyClass?: string; id?: string }) {
  return (
    <section id={id} className={cx("rounded-[12px] bg-surface border border-line shadow-[var(--shadow)]", className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-4 px-5 pt-4 pb-3">
          <div className="min-w-0">
            {typeof title === "string" ? <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h2> : title}
            {subtitle && <p className="mt-0.5 text-[13px] text-ink-2">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={cx(title || action ? "px-5 pb-5" : "p-5", bodyClass)}>{children}</div>
    </section>
  );
}

export function Kpi({ label, value, unit, sub, tone, foot, accent }: { label: string; value: ReactNode; unit?: string; sub?: ReactNode; tone?: "signal" | "info" | "ink" | "warning" | "success"; foot?: ReactNode; accent?: boolean }) {
  const color = { signal: "text-signal", info: "text-info", ink: "text-ink", warning: "text-warning", success: "text-success" }[tone ?? "ink"];
  return (
    <div className={cx("relative rounded-[10px] border border-line bg-surface-2/60 px-4 py-3.5", accent && "border-signal/30")}>
      <div className="micro">{label}</div>
      <div className={cx("mt-1.5 flex items-baseline gap-1.5 num", color)}>
        <span className="text-[28px] font-semibold leading-none tracking-[-0.02em]">{value}</span>
        {unit && <span className="text-[13px] font-medium text-ink-2">{unit}</span>}
      </div>
      {sub && <div className="mt-1.5 text-[12.5px] text-ink-2">{sub}</div>}
      {foot && <div className="mt-1 text-[11.5px] text-ink-3">{foot}</div>}
    </div>
  );
}

export function Meter({ value, max, tone = "signal", className, label }: { value: number; max: number; tone?: "signal" | "info" | "warning" | "danger" | "success"; className?: string; label?: string }) {
  const pctV = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const bg = { signal: "bg-signal", info: "bg-info", warning: "bg-warning", danger: "bg-danger", success: "bg-success" }[tone];
  return (
    <div className={cx("h-1.5 w-full rounded-full bg-surface-3 overflow-hidden", className)} role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} aria-label={label}>
      <div className={cx("h-full rounded-full anim-bar", bg)} style={{ width: `${pctV}%` }} />
    </div>
  );
}

// ---------------------------------------------------------------- Env labels (two distinct, non-dismissible)
export function EnvLabels({ paypalMode, compact }: { paypalMode: "sandbox" | "simulator"; compact?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span
        title={paypalMode === "sandbox" ? "Payments use the real PayPal sandbox REST API." : "No PayPal credentials are configured; payments run in a local simulator and are labelled as such."}
        className="inline-flex items-center gap-1.5 rounded-[6px] border border-info/35 bg-info-dim px-2 py-1 text-[10.5px] font-semibold tracking-[0.07em] text-info"
      >
        <span className="size-1.5 rounded-full bg-info" aria-hidden />
        {paypalMode === "sandbox" ? "PAYPAL SANDBOX" : "PAYPAL SIMULATOR"}
      </span>
      <span title="All meter readings are synthetic and deterministic." className="inline-flex items-center gap-1.5 rounded-[6px] border border-warning/35 bg-warning-dim px-2 py-1 text-[10.5px] font-semibold tracking-[0.07em] text-warning">
        <span className="size-1.5 rounded-full bg-warning" aria-hidden />
        {compact ? "SIMULATED DATA" : "SIMULATED METER DATA"}
      </span>
    </div>
  );
}

export function SimulatedNote({ className }: { className?: string }) {
  return <span className={cx("inline-flex items-center gap-1.5 text-[11.5px] text-warning", className)}>● Simulated meter data — hackathon demo</span>;
}

export function Notice({ tone = "info", title, children, action, className }: { tone?: Tone; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  const border = { neutral: "border-line-2", info: "border-info/30", signal: "border-signal/30", success: "border-success/30", warning: "border-warning/35", danger: "border-danger/40" }[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cx("flex items-start gap-3 rounded-[10px] border px-4 py-3", toneCls[tone].split(" ")[0], border, className)}>
      <span className={cx("mt-0.5", toneCls[tone].split(" ")[1])}>{toneIcon[tone]}</span>
      <div className="min-w-0 flex-1 text-[13px] text-ink-2">
        {title && <div className="font-medium text-ink">{title}</div>}
        {children}
      </div>
      {action}
    </div>
  );
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[12px] border border-dashed border-line-2 px-6 py-10 text-center">
      {icon && <div className="mb-3 text-ink-3">{icon}</div>}
      <div className="text-[15px] font-medium text-ink">{title}</div>
      {children && <div className="mt-1 max-w-md text-[13px] text-ink-2">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function KV({ k, v, mono }: { k: ReactNode; v: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-[13px]">
      <dt className="text-ink-2">{k}</dt>
      <dd className={cx("text-right text-ink num", mono && "font-mono text-[12px]")}>{v}</dd>
    </div>
  );
}

export function PageHeader({ eyebrow, title, desc, actions, meta }: { eyebrow?: ReactNode; title: ReactNode; desc?: ReactNode; actions?: ReactNode; meta?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4 anim-fade-up">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5 text-[12.5px] text-ink-3">{eyebrow}</div>}
        <h1 className="text-[26px] md:text-[28px] font-semibold tracking-[-0.025em] text-ink leading-tight">{title}</h1>
        {desc && <p className="mt-1.5 max-w-2xl text-[14px] text-ink-2">{desc}</p>}
        {meta && <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

export function IconClose(props: { onClick: () => void; label?: string }) {
  return (
    <button onClick={props.onClick} aria-label={props.label ?? "Close"} className="rounded-md p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink">
      <X className="size-4" />
    </button>
  );
}
