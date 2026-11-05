"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Building2, ChevronDown, Gauge, ShieldCheck, Sparkles, Wallet, Waves } from "lucide-react";
import { api } from "@/lib/client";
import { Wordmark } from "@/components/brand";
import { Badge, EnvLabels, cx } from "@/components/ui";
import { EVENT_STATUS } from "@/lib/status";
import type { EventStatus } from "@/lib/types";

const LOOP = [
  { icon: Sparkles, title: "Describe", text: "Owners explain what can move in plain language. AI structures it; they confirm." },
  { icon: Gauge, title: "Plan", text: "A deterministic optimiser picks the lowest-cost safe mix and explains every exclusion." },
  { icon: Building2, title: "Accept", text: "Each business voluntarily accepts a specific shift, window and reward." },
  { icon: Waves, title: "Verify", text: "15-minute meter data measures peak reduction and the alternate-window increase. Only verified kWh pays." },
  { icon: Wallet, title: "Pay", text: "Operator approves; PayPal Payouts sends rewards, reconciled per recipient." },
];

export function DemoEntry({ paypal, ai, businesses, event }: { paypal: "sandbox" | "simulator"; ai: "claude" | "offline"; businesses: { userId: string; owner: string; name: string; category: string; pending: number }[]; event: { name: string; status: EventStatus } }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [how, setHow] = useState(false);
  const [pick, setPick] = useState(false);

  async function enter(userId: string, to: string) {
    setBusy(userId);
    try {
      await api("session", { body: { userId } });
      router.push(to);
    } catch {
      setBusy(null);
    }
  }

  return (
    <main className="relative min-h-dvh overflow-hidden">
      {/* subtle demand-curve backdrop */}
      <svg className="pointer-events-none absolute inset-x-0 top-0 h-[520px] w-full opacity-[0.55]" viewBox="0 0 1440 520" preserveAspectRatio="none" aria-hidden>
        <defs>
          <linearGradient id="g1" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--signal)" stopOpacity="0.16" />
            <stop offset="1" stopColor="var(--signal)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="g2" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--info)" stopOpacity="0.10" />
            <stop offset="1" stopColor="var(--info)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d="M0 420 C160 410 220 330 360 320 C520 308 560 360 700 340 C860 316 900 150 1060 140 C1180 132 1220 300 1440 330 L1440 520 L0 520Z" fill="url(#g2)" />
        <path d="M0 420 C160 410 220 330 360 320 C520 300 560 250 700 236 C860 222 900 270 1060 262 C1180 256 1220 320 1440 330" fill="none" stroke="var(--signal)" strokeOpacity="0.5" strokeWidth="1.5" />
        <path d="M0 420 C160 410 220 330 360 320 C520 308 560 360 700 340 C860 316 900 150 1060 140 C1180 132 1220 300 1440 330" fill="none" stroke="var(--info)" strokeOpacity="0.45" strokeWidth="1.2" strokeDasharray="4 5" />
      </svg>

      <div className="relative mx-auto max-w-[1180px] px-5 sm:px-8">
        <nav className="flex items-center justify-between py-6">
          <Wordmark sub="Demand flexibility, verified and paid" />
          <EnvLabels paypalMode={paypal} />
        </nav>

        <section className="pt-10 sm:pt-16 pb-10 anim-fade-up">
          <Badge tone="signal">Hackathon demo · {event.name ? EVENT_STATUS[event.status].label : "ready"}</Badge>
          <h1 className="mt-5 max-w-[880px] text-[40px] sm:text-[58px] font-semibold leading-[1.02] tracking-[-0.04em]">
            Turn small-business electricity flexibility into a resource you can <span className="text-signal">coordinate, verify and pay.</span>
          </h1>
          <p className="mt-5 max-w-[640px] text-[16px] text-ink-2">
            Explore a simulated demand-flexibility event with real {paypal === "sandbox" ? "PayPal sandbox" : "PayPal-shaped (simulator)"} payment flows. AI interprets. Deterministic code allocates and verifies. Humans approve.
          </p>
        </section>

        <section className="grid gap-4 md:grid-cols-[1.25fr_1fr] pb-6">
          <button
            onClick={() => enter("usr_operator", "/operator/overview")}
            disabled={!!busy}
            className="group relative overflow-hidden rounded-[16px] border border-line-2 bg-surface p-6 text-left transition hover:border-signal/50 focus-visible:outline-2"
          >
            <div className="absolute right-0 top-0 h-full w-1/2 opacity-60 hatch" aria-hidden />
            <div className="relative">
              <div className="micro">Programme operator · Lenin Briggs</div>
              <div className="mt-2 text-[24px] font-semibold tracking-[-0.02em]">Open operator workspace</div>
              <p className="mt-2 max-w-md text-[14px] text-ink-2">Lagoon Flex Programme control room: fund the event, find the lowest-cost plan, verify delivery and settle rewards through PayPal.</p>
              <div className="mt-6 inline-flex items-center gap-2 rounded-[8px] bg-signal px-4 py-2.5 text-[14px] font-semibold text-signal-ink">
                {busy === "usr_operator" ? "Opening control room…" : "Enter control room"}
                <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
              </div>
            </div>
          </button>

          <div className="rounded-[16px] border border-line-2 bg-surface p-6">
            <div className="micro">Business participant</div>
            <div className="mt-2 text-[24px] font-semibold tracking-[-0.02em]">Open business view</div>
            <p className="mt-2 text-[14px] text-ink-2">See an offer the way an owner does — on a phone, in plain language, with the choice to accept or decline.</p>
            <button onClick={() => setPick((p) => !p)} className="mt-5 inline-flex items-center gap-2 rounded-[8px] border border-line-2 bg-surface-2 px-4 py-2.5 text-[14px] font-medium hover:bg-surface-3" aria-expanded={pick}>
              Choose a business <ChevronDown className={cx("size-4 transition", pick && "rotate-180")} />
            </button>
            {pick && (
              <ul className="mt-3 divide-y divide-line rounded-[10px] border border-line anim-fade-up">
                {businesses.map((b) => (
                  <li key={b.userId}>
                    <button onClick={() => enter(b.userId, "/business/home")} disabled={!!busy} className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left hover:bg-surface-2">
                      <span className="min-w-0">
                        <span className="block text-[13.5px] font-medium">{b.name}</span>
                        <span className="block text-[12px] text-ink-3">
                          {b.owner} · {b.category}
                        </span>
                      </span>
                      {busy === b.userId ? <span className="text-[12px] text-ink-2">Opening…</span> : b.pending ? <Badge tone="warning">{b.pending} offer</Badge> : <ArrowRight className="size-4 text-ink-3" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="grid gap-px overflow-hidden rounded-[14px] border border-line bg-line sm:grid-cols-5">
          {LOOP.map((s, i) => (
            <div key={s.title} className="bg-surface/90 p-4 anim-fade-up" style={{ animationDelay: `${i * 40}ms` }}>
              <div className="flex items-center gap-2 text-signal">
                <s.icon className="size-4" />
                <span className="micro !text-ink-3">0{i + 1}</span>
              </div>
              <div className="mt-2 text-[14px] font-semibold">{s.title}</div>
              <div className="mt-1 text-[12.5px] text-ink-2">{s.text}</div>
            </div>
          ))}
        </section>

        <section className="py-8">
          <button onClick={() => setHow((h) => !h)} className="inline-flex items-center gap-2 text-[13px] text-ink-2 hover:text-ink" aria-expanded={how}>
            <ShieldCheck className="size-4" /> How this demo works <ChevronDown className={cx("size-3.5 transition", how && "rotate-180")} />
          </button>
          {how && (
            <div className="mt-3 grid gap-3 text-[13px] text-ink-2 sm:grid-cols-3 anim-fade-up">
              <p className="rounded-[10px] border border-line bg-surface p-4">
                <b className="text-ink">Simulated meter data.</b> Six fictional Lagos businesses with deterministic, synthetic 15-minute readings. Every energy screen is labelled. Nothing here claims a real grid outcome.
              </p>
              <p className="rounded-[10px] border border-line bg-surface p-4">
                <b className="text-ink">{paypal === "sandbox" ? "PayPal sandbox." : "PayPal simulator."}</b>{" "}
                {paypal === "sandbox" ? "Checkout funding and Payouts are real PayPal sandbox API calls with batch and item references, reconciled via webhooks." : "No PayPal credentials are configured on this deployment, so a local simulator mirrors the sandbox lifecycle. It is labelled everywhere. Add sandbox keys to switch to real API calls."}
              </p>
              <p className="rounded-[10px] border border-line bg-surface p-4">
                <b className="text-ink">{ai === "claude" ? "Claude AI." : "Offline AI fallback."}</b> {ai === "claude" ? "Profile extraction, event briefs and the Analyst run on Claude with schema-validated tool output." : "No AI key configured: a deterministic rule-based extractor runs instead, with the same schema validation and safety rules."} AI never sets capacity, prices or payments.
              </p>
            </div>
          )}
          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px] text-ink-3">
            <span>Demo accounts: operator, admin, six business owners — role switch is a demo-only convenience and is audited.</span>
            <button onClick={() => enter("usr_admin", "/operator/settings")} className="underline-offset-2 hover:text-ink hover:underline">
              Platform admin (reset demo)
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
