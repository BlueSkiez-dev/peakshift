"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Activity, BarChart3, CalendarClock, ChevronRight, LayoutGrid, LogOut, Menu, Network, ReceiptText, ScrollText, Settings, ShieldCheck, Users, X } from "lucide-react";
import { Wordmark } from "./brand";
import { EnvLabels, StatusBadge, cx } from "./ui";
import { EVENT_STATUS, OFFER_STATUS } from "@/lib/status";
import type { EventStatus, OfferStatus } from "@/lib/types";
import { api } from "@/lib/client";

const NAV = [
  { href: "/operator/overview", label: "Overview", icon: LayoutGrid },
  { href: "/operator/events", label: "Events", icon: CalendarClock },
  { href: "/operator/network", label: "Flexibility network", icon: Network },
  { href: "/operator/verification", label: "Verification", icon: Activity },
  { href: "/operator/payments", label: "Payments", icon: ReceiptText },
  { href: "/operator/intelligence", label: "Energy Intelligence", icon: BarChart3, tag: "AG" },
  { href: "/operator/audit", label: "Audit log", icon: ScrollText },
];

type NetItem = { orgId: string; name: string; capacityWh: number; status: string; offer: OfferStatus | null };

export function OperatorShell({ user, paypal, ai, event, network, children }: { user: { name: string; role: string }; paypal: "sandbox" | "simulator"; ai: "claude" | "offline"; event: { id: string; name: string; status: EventStatus } | null; network: NetItem[]; children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const maxCap = Math.max(1, ...network.map((n) => n.capacityWh));

  const rail = (
    <div className="flex h-full flex-col">
      <div className="px-5 pt-5 pb-4">
        <Link href="/operator/overview" className="block rounded-md">
          <Wordmark sub="Lagoon Flex Programme" />
        </Link>
      </div>
      <nav aria-label="Operator" className="px-3">
        <ul className="space-y-0.5">
          {NAV.map((n) => {
            const active = path === n.href || (n.href !== "/operator/overview" && path.startsWith(n.href));
            return (
              <li key={n.href}>
                <Link
                  href={n.href}
                  onClick={() => setOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "group relative flex items-center gap-3 rounded-[8px] px-3 py-2 text-[13.5px] transition-colors",
                    active ? "bg-surface-2 text-ink" : "text-ink-2 hover:bg-surface-2/60 hover:text-ink",
                  )}
                >
                  {active && <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r bg-signal" aria-hidden />}
                  <n.icon className={cx("size-[17px]", active ? "text-signal" : "text-ink-3 group-hover:text-ink-2")} />
                  <span className="flex-1">{n.label}</span>
                  {n.tag && <span className="rounded border border-line-2 px-1 text-[9.5px] font-semibold tracking-wider text-ink-3">{n.tag}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Flexibility network mini-register */}
      <div className="mt-6 px-3">
        <div className="flex items-center justify-between px-3 pb-2">
          <span className="micro">Network</span>
          <span className="text-[11px] text-ink-3 num">{network.length} sites</span>
        </div>
        <ul className="space-y-1">
          {network.map((n) => (
            <li key={n.orgId}>
              <Link href={`/operator/network?org=${n.orgId}`} onClick={() => setOpen(false)} className="flex items-center gap-2.5 rounded-[8px] px-3 py-1.5 hover:bg-surface-2/60">
                <span className={cx("grid size-6 shrink-0 place-items-center rounded-full text-[10.5px] font-semibold", n.status === "critical" ? "bg-danger-dim text-danger" : n.offer === "ACCEPTED" ? "bg-signal text-signal-ink" : "bg-surface-3 text-ink-2")}>{n.name[0]}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] text-ink">{n.name}</span>
                  <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-surface-3">
                    <span className={cx("block h-full rounded-full", n.status === "critical" ? "bg-danger/60" : n.status === "eligible" ? "bg-signal" : "bg-ink-3")} style={{ width: `${n.status === "critical" ? 100 : (n.capacityWh / maxCap) * 100}%` }} />
                  </span>
                </span>
                <span className="text-[11px] text-ink-3 num w-11 text-right">{n.status === "critical" ? "crit." : `${(n.capacityWh / 1000).toFixed(0)} kWh`}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-auto space-y-1 border-t border-line px-3 py-3">
        <Link href="/operator/settings" onClick={() => setOpen(false)} className={cx("flex items-center gap-3 rounded-[8px] px-3 py-2 text-[13px]", path.startsWith("/operator/settings") ? "bg-surface-2 text-ink" : "text-ink-2 hover:bg-surface-2/60")}>
          <Settings className="size-4 text-ink-3" /> Settings & integrations
        </Link>
        <div className="flex items-center gap-2 px-3 pt-1 text-[11px] text-ink-3">
          <span className={cx("size-1.5 rounded-full", ai === "claude" ? "bg-signal" : "bg-warning")} /> AI: {ai === "claude" ? "Claude" : "offline rules"}
          <span className="ml-2 size-1.5 rounded-full bg-info" /> PayPal: {paypal}
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh lg:pl-[244px]">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[244px] border-r border-line bg-rail lg:block">{rail}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-[272px] border-r border-line bg-rail anim-slide-in">{rail}</aside>
        </div>
      )}

      <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-3 px-4 md:px-8">
          <button className="rounded-md p-1.5 text-ink-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Open navigation">
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
          {event ? (
            <Link href={`/operator/events/${event.id}`} className="group hidden min-w-0 items-center gap-2.5 rounded-[8px] border border-line bg-surface px-3 py-1.5 sm:flex hover:border-line-2">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full rounded-full bg-signal opacity-60 anim-pulse" />
                <span className="relative inline-flex size-2 rounded-full bg-signal" />
              </span>
              <span className="truncate text-[12.5px] text-ink-2 max-w-[260px]">{event.name}</span>
              <StatusBadge meta={EVENT_STATUS[event.status]} />
              <ChevronRight className="size-3.5 text-ink-3 group-hover:text-ink-2" />
            </Link>
          ) : null}
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden md:block">
              <EnvLabels paypalMode={paypal} />
            </div>
            <div className="flex items-center gap-2 border-l border-line pl-3">
              <span className="grid size-8 place-items-center rounded-full bg-brand text-[12px] font-semibold text-signal">
                {user.name
                  .split(" ")
                  .map((p) => p[0])
                  .join("")}
              </span>
              <div className="hidden leading-tight xl:block">
                <div className="text-[12.5px] font-medium">{user.name}</div>
                <div className="text-[11px] text-ink-3 capitalize flex items-center gap-1">
                  {user.role === "admin" ? <ShieldCheck className="size-3" /> : <Users className="size-3" />} {user.role}
                </div>
              </div>
              <button
                onClick={async () => {
                  await api("session", { method: "DELETE" });
                  router.push("/demo");
                }}
                className="rounded-md p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink"
                title="Switch role (demo)"
                aria-label="Switch role"
              >
                <LogOut className="size-4" />
              </button>
            </div>
          </div>
        </div>
        <div className="border-t border-line px-4 py-1.5 md:hidden">
          <EnvLabels paypalMode={paypal} compact />
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-4 py-6 md:px-8 md:py-8">{children}</main>
    </div>
  );
}

export { OFFER_STATUS };
