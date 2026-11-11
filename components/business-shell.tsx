"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Home, Inbox, LogOut, SlidersHorizontal, UserRound, Wallet } from "lucide-react";
import { Mark } from "./brand";
import { cx } from "./ui";
import { api, useBizHref } from "@/lib/client";
import { asPrefix } from "@/lib/as";

const NAV = [
  { href: "/business/home", label: "Home", icon: Home },
  { href: "/business/flexibility", label: "My flexibility", icon: SlidersHorizontal },
  { href: "/business/offers", label: "Offers", icon: Inbox },
  { href: "/business/earnings", label: "Earnings", icon: Wallet },
  { href: "/business/profile", label: "Profile", icon: UserRound },
];

export function BusinessShell({ org, owner, pending, paypal, children }: { org: { name: string; site: string; category: string }; owner: string; pending: number; paypal: "sandbox" | "simulator"; children: ReactNode }) {
  const raw = usePathname();
  const scoped = asPrefix(raw); // tab-scoped business view (opened from the operator console)
  const path = raw.slice(scoped.length);
  const biz = useBizHref();
  const router = useRouter();
  // Field theme applies to the whole document (so dialogs/portals match), restored on leave.
  useEffect(() => {
    const el = document.documentElement;
    const prev = el.dataset.theme;
    el.dataset.theme = "field";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#f4f6f3");
    return () => {
      el.dataset.theme = prev ?? "control";
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#080c0a");
    };
  }, []);

  return (
    <div data-theme="field" className="min-h-dvh bg-bg text-ink">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[960px] items-center gap-3 px-4 sm:px-6">
          <Link href={biz("/business/home")} className="flex items-center gap-2.5 rounded-md">
            <Mark className="size-7" />
            <span className="leading-tight">
              <span className="block text-[14px] font-semibold tracking-[-0.01em]">{org.name}</span>
              <span className="block text-[11.5px] text-ink-3">{org.site}</span>
            </span>
          </Link>
          <nav className="ml-auto hidden items-center gap-1 md:flex" aria-label="Business">
            {NAV.map((n) => {
              const active = path.startsWith(n.href);
              return (
                <Link key={n.href} href={biz(n.href)} aria-current={active ? "page" : undefined} className={cx("relative rounded-[8px] px-3 py-1.5 text-[13.5px]", active ? "bg-surface-2 font-medium text-ink" : "text-ink-2 hover:text-ink")}>
                  {n.label}
                  {n.href === "/business/offers" && pending > 0 && <span className="ml-1.5 rounded-full bg-warning px-1.5 text-[10.5px] font-semibold text-white num">{pending}</span>}
                </Link>
              );
            })}
          </nav>
          <button
            onClick={async () => {
              // A tab-scoped view never touches the shared session cookie, so the operator tab stays signed in.
              if (!scoped) await api("session", { method: "DELETE" });
              router.push("/demo");
            }}
            className="ml-auto rounded-md p-2 text-ink-3 hover:bg-surface-2 md:ml-1"
            aria-label="Switch role (demo)"
            title="Switch role (demo)"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </header>
      <div className="border-b border-line bg-surface-2/60">
        <div className="mx-auto flex max-w-[960px] flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5 text-[11px] text-ink-2 sm:px-6">
          <span className="font-semibold tracking-[0.06em] text-info">{paypal === "sandbox" ? "PAYPAL SANDBOX" : "PAYPAL SIMULATOR"}</span>
          <span className="text-ink-3">·</span>
          <span className="font-semibold tracking-[0.06em] text-warning">SIMULATED METER DATA</span>
          <span className="ml-auto hidden text-ink-3 sm:inline">Signed in as {owner}</span>
        </div>
      </div>

      <main className="mx-auto max-w-[960px] px-4 pb-28 pt-5 sm:px-6 md:pb-12">{children}</main>

      {/* Mobile bottom navigation */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" aria-label="Business">
        <ul className="grid grid-cols-5">
          {NAV.map((n) => {
            const active = path.startsWith(n.href);
            return (
              <li key={n.href}>
                <Link href={biz(n.href)} aria-current={active ? "page" : undefined} className={cx("relative flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[10.5px]", active ? "text-brand font-semibold" : "text-ink-3")}>
                  <n.icon className="size-5" />
                  {n.label.replace("My ", "")}
                  {n.href === "/business/offers" && pending > 0 && <span className="absolute right-[calc(50%-18px)] top-2 size-2 rounded-full bg-warning" />}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
