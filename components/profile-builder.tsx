"use client";
import { useMemo, useState } from "react";
import { ChevronDown, Lightbulb, PenLine, ShieldAlert, ShieldCheck, Sparkles } from "lucide-react";
import type { BusinessProfile, FieldProvenance, FlexActivity } from "@/lib/types";
import { api, ApiError, useAction } from "@/lib/client";
import { kwh, money, stamp, windowLabel } from "@/lib/format";
import { Badge, Button, Notice, cx } from "./ui";
import { useToast } from "./overlay";

type Act = FlexActivity & { provenance: Record<string, FieldProvenance | "edited">; sourceEvidence: string[]; safetyAcknowledged: boolean };

const PROMPTS = ["What equipment or activity can move?", "How much energy can move, if you know it?", "When can it run instead?", "What must never be interrupted?", "What minimum must be maintained?"];

const PROV: Record<string, { label: string; tone: "success" | "info" | "warning" | "danger" | "neutral" }> = {
  confirmed: { label: "Confirmed by you", tone: "success" },
  edited: { label: "Edited by you", tone: "success" },
  ai: { label: "AI suggestion", tone: "info" },
  missing: { label: "Needs your input", tone: "warning" },
  safety: { label: "Safety confirmation required", tone: "danger" },
};

function toActs(p: BusinessProfile | null): Act[] {
  if (!p) return [];
  return p.activities.map((a, i) => {
    const d = p.draft?.activities[i];
    return { ...a, provenance: d?.provenance ?? { name: "confirmed", maxShiftWh: "confirmed", rateMinorPerKwh: "confirmed", window: "confirmed", isCritical: "confirmed" }, sourceEvidence: d?.sourceEvidence ?? [], safetyAcknowledged: p.status === "confirmed" };
  });
}

export function ProfileBuilder({ orgId, orgName: _orgName, confirmed, draft, ai, justConfirmed }: { orgId: string; orgName: string; confirmed: BusinessProfile | null; draft: BusinessProfile | null; ai: "claude" | "offline"; justConfirmed?: boolean }) {
  const { run, pending, error } = useAction();
  const toast = useToast();
  const [text, setText] = useState(draft?.freeText ?? "");
  const [acts, setActs] = useState<Act[]>(toActs(draft));
  const [notice, setNotice] = useState<number | null>(draft?.minimumNoticeHours ?? null);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const [receipt, setReceipt] = useState<BusinessProfile | null>(justConfirmed ? confirmed : null);
  const [showSource, setShowSource] = useState(false);

  async function extract() {
    setReceipt(null);
    setFieldErr({});
    await run("extract", () => api<BusinessProfile>(`businesses/${orgId}/profile/extract`, { body: { text } }));
  }

  function upd(i: number, patch: Partial<Act>, field?: string) {
    setActs((xs) => xs.map((a, k) => (k === i ? { ...a, ...patch, provenance: field ? { ...a.provenance, [field]: "edited" } : a.provenance } : a)));
  }

  async function confirm() {
    setFieldErr({});
    try {
      const p = await api<BusinessProfile>(`businesses/${orgId}/profile/confirm`, {
        body: {
          profileId: draft!.id,
          minimumNoticeHours: notice,
          activities: acts.map((a) => ({ id: a.id, name: a.name, equipmentCategory: a.equipmentCategory, isCritical: a.isCritical, maxShiftWh: a.maxShiftWh, rateMinorPerKwh: a.rateMinorPerKwh, window: a.window, mustCompleteBy: a.mustCompleteBy ?? null, constraints: a.constraints, safetyAcknowledged: a.safetyAcknowledged })),
        },
      });
      setReceipt(p);
      const eligible = p.activities.filter((a) => !a.isCritical).length;
      toast({ tone: "success", title: `Profile saved. ${eligible} activit${eligible === 1 ? "y is" : "ies are"} eligible for review.` });
      await run("refresh", async () => null);
    } catch (e) {
      const ae = e as ApiError;
      setFieldErr(ae.fields ?? { form: ae.message });
    }
  }

  const d = draft?.draft;
  const unresolved = useMemo(() => acts.filter((a) => !a.safetyAcknowledged).length, [acts]);

  return (
    <div className="space-y-5">
      <header className="anim-fade-up">
        <h1 className="text-[26px] font-semibold tracking-[-0.025em]">My flexibility</h1>
        <p className="mt-1 max-w-xl text-[14px] text-ink-2">Tell us which activities your business can move to a different time. We&apos;ll organise the details for you to review.</p>
      </header>

      {receipt && (
        <div className="rounded-[14px] border border-success/30 bg-success-dim p-5 anim-scale-in">
          <div className="flex items-center gap-2 text-[15px] font-semibold"><ShieldCheck className="size-4 text-success" /> Profile v{receipt.version} confirmed</div>
          <p className="mt-1 text-[13px] text-ink-2">
            {receipt.activities.length} activities confirmed · {receipt.activities.filter((a) => !a.isCritical).length} eligible ({receipt.activities.filter((a) => !a.isCritical).map((a) => a.name).join(", ") || "none"}) · {receipt.activities.filter((a) => a.isCritical).length} protected as critical. Accepted offers keep the version they were made with.
          </p>
        </div>
      )}

      {/* Current confirmed profile */}
      {confirmed && !draft && (
        <section className="rounded-[14px] border border-line bg-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[15px] font-semibold">Current profile</h2>
            <Badge tone="success">Confirmed v{confirmed.version} · {stamp(confirmed.confirmedAt)}</Badge>
          </div>
          <ul className="mt-3 divide-y divide-line">
            {confirmed.activities.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-[13.5px]">
                <span className="font-medium">{a.name}</span>
                {a.isCritical ? (
                  <span className="flex items-center gap-1.5 text-[12.5px] text-danger"><ShieldAlert className="size-3.5" /> Critical load — excluded from offers</span>
                ) : (
                  <span className="text-ink-2 num">{kwh(a.maxShiftWh)} · {windowLabel(a.window)} · min {money(a.rateMinorPerKwh)}/kWh</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Entry */}
      <section className="rounded-[14px] border border-line bg-surface p-5">
        <label htmlFor="desc" className="text-[15px] font-semibold">{confirmed ? "Describe what's changed" : "Describe your flexible activities"}</label>
        <p className="mt-1 text-[13px] text-ink-2">Write it the way you&apos;d explain it to a colleague. If you don&apos;t know the kWh, leave it out — we won&apos;t guess.</p>
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {PROMPTS.map((p) => (
            <li key={p} className="flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-[12px] text-ink-2">
              <Lightbulb className="size-3 text-warning" /> {p}
            </li>
          ))}
        </ul>
        <textarea id="desc" value={text} onChange={(e) => setText(e.target.value)} rows={5} placeholder={confirmed?.freeText} className="mt-3 w-full rounded-[10px] border border-line-2 bg-surface-2/50 px-3.5 py-3 text-[14.5px] leading-relaxed outline-none focus:border-brand" disabled={pending === "extract"} />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button onClick={extract} loading={pending === "extract"} loadingLabel="Reading your description…" disabled={text.trim().length < 20} className="!bg-brand !text-white hover:!bg-brand-2 !border-0" icon={<Sparkles className="size-4" />}>
            Organise with AI
          </Button>
          {confirmed && !text && (
            <Button variant="ghost" size="sm" onClick={() => setText(confirmed.freeText)} icon={<PenLine className="size-3.5" />}>
              Start from my last description
            </Button>
          )}
          <span className="text-[12px] text-ink-3">{ai === "claude" ? "Claude · your words stay on our server" : "Offline extractor (no AI key) · same safety rules"}</span>
        </div>
        {error && <Notice tone="warning" className="mt-3" title={error.message}>Your description is kept. You can retry or edit the fields manually.</Notice>}
      </section>

      {/* Review */}
      {draft && d && (
        <section className="grid gap-5 lg:grid-cols-[1fr_1.35fr] anim-fade-up">
          <div className="space-y-3 lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-[14px] border border-line bg-surface p-5">
              <button className="flex w-full items-center justify-between text-left lg:pointer-events-none" onClick={() => setShowSource((s) => !s)} aria-expanded={showSource}>
                <span className="text-[13px] font-semibold">Your description</span>
                <ChevronDown className={cx("size-4 text-ink-3 lg:hidden", showSource && "rotate-180")} />
              </button>
              <blockquote className={cx("mt-2 border-l-2 border-brand/40 pl-3 text-[13.5px] leading-relaxed text-ink-2", !showSource && "hidden lg:block")}>{draft.freeText}</blockquote>
            </div>
            <div className="rounded-[14px] border border-info/25 bg-info-dim p-4">
              <div className="text-[13px] font-semibold">What we understood</div>
              <p className="mt-1 text-[13px] text-ink-2">{d.summary}</p>
              {d.missingFields.length > 0 && <p className="mt-2 text-[12.5px] text-ink-2">We have not added a value where your description didn&apos;t include one — those fields say <b>Needs your input</b>.</p>}
              {d.questions.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-[12.5px] text-ink-2">
                  {d.questions.map((q) => <li key={q}>{q}</li>)}
                </ul>
              )}
              {d.assumptions.length > 0 && <p className="mt-2 text-[12px] text-ink-3">Assumptions: {d.assumptions.join(" ")}</p>}
              <p className="mt-3 text-[11.5px] text-ink-3">
                Extraction confidence: <b className="capitalize">{d.confidence}</b> — about reading your words, not about your equipment. {d.engine.mode === "claude" ? "Claude" : "Offline rules"} · {d.engine.model} · {d.engine.latencyMs} ms
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-semibold">Review each activity</h2>
              <Badge tone="info">AI-proposed — review before saving</Badge>
            </div>
            {acts.map((a, i) => (
              <article key={a.id} className={cx("rounded-[14px] border bg-surface p-4", a.isCritical ? "border-danger/30" : "border-line")}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <input value={a.name} onChange={(e) => upd(i, { name: e.target.value }, "name")} className="min-w-0 flex-1 rounded-[6px] bg-transparent text-[15px] font-semibold outline-none focus:bg-surface-2 px-1 -mx-1" aria-label="Activity name" />
                  {a.isCritical ? <Badge tone="danger">Critical — excluded</Badge> : <Badge tone="success">Can shift</Badge>}
                </div>
                {a.sourceEvidence.length > 0 && <p className="mt-1 text-[12px] italic text-ink-3">From your words: “{a.sourceEvidence[0].slice(0, 140)}{a.sourceEvidence[0].length > 140 ? "…" : ""}”</p>}

                {!a.isCritical && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <F label="Energy you can move" prov={a.provenance.maxShiftWh} err={fieldErr[`activities.${i}.maxShiftWh`]}>
                      <div className="flex items-center rounded-[8px] border border-line-2 bg-surface-2/40 focus-within:border-brand">
                        <input inputMode="decimal" value={a.maxShiftWh == null ? "" : a.maxShiftWh / 1000} placeholder="?" onChange={(e) => upd(i, { maxShiftWh: e.target.value === "" ? null : Math.round(Number(e.target.value) * 1000) }, "maxShiftWh")} className="h-10 w-full bg-transparent px-3 text-[14px] outline-none num" />
                        <span className="pr-3 text-[12px] text-ink-3">kWh</span>
                      </div>
                    </F>
                    <F label="Minimum reward" prov={a.provenance.rateMinorPerKwh} err={fieldErr[`activities.${i}.rateMinorPerKwh`]}>
                      <div className="flex items-center rounded-[8px] border border-line-2 bg-surface-2/40 focus-within:border-brand">
                        <span className="pl-3 text-ink-3">$</span>
                        <input inputMode="decimal" value={a.rateMinorPerKwh == null ? "" : (a.rateMinorPerKwh / 100).toFixed(2)} placeholder="?" onChange={(e) => upd(i, { rateMinorPerKwh: e.target.value === "" ? null : Math.round(Number(e.target.value) * 100) }, "rateMinorPerKwh")} className="h-10 w-full bg-transparent px-2 text-[14px] outline-none num" />
                        <span className="pr-3 text-[12px] text-ink-3">/kWh</span>
                      </div>
                    </F>
                    <F label="When it can run" prov={a.provenance.window} err={fieldErr[`activities.${i}.window`]}>
                      <div className="flex items-center gap-1">
                        <input type="time" step={900} value={a.window?.start ?? ""} onChange={(e) => upd(i, { window: { start: e.target.value, end: a.window?.end ?? "17:00" } }, "window")} className="h-10 w-full rounded-[8px] border border-line-2 bg-surface-2/40 px-2 text-[13px] outline-none focus:border-brand num" aria-label="Window start" />
                        <span className="text-ink-3">–</span>
                        <input type="time" step={900} value={a.window?.end ?? ""} onChange={(e) => upd(i, { window: { start: a.window?.start ?? "12:00", end: e.target.value } }, "window")} className="h-10 w-full rounded-[8px] border border-line-2 bg-surface-2/40 px-2 text-[13px] outline-none focus:border-brand num" aria-label="Window end" />
                      </div>
                    </F>
                  </div>
                )}
                {a.constraints.length > 0 && (
                  <ul className="mt-3 space-y-1 text-[12.5px] text-ink-2">
                    {a.constraints.map((c) => <li key={c}>• {c}</li>)}
                  </ul>
                )}

                {/* Safety confirmation — deliberate, explicit */}
                <div className={cx("mt-3 rounded-[10px] border p-3", a.isCritical ? "border-danger/30 bg-danger-dim" : "border-line bg-surface-2/50", fieldErr[`activities.${i}.safety`] && "ring-2 ring-danger/40")}>
                  <div className="mb-2 flex items-center gap-2 text-[12.5px] font-medium">
                    <ShieldAlert className={cx("size-3.5", a.isCritical ? "text-danger" : "text-ink-3")} /> Safety declaration
                    {a.provenance.isCritical === "safety" && !a.safetyAcknowledged && <Badge tone="danger">Safety confirmation required</Badge>}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className={cx("flex cursor-pointer items-start gap-2 rounded-[8px] border p-2.5 text-[12.5px]", a.isCritical ? "border-danger/40 bg-surface" : "border-line")}>
                      <input type="radio" name={`crit-${i}`} checked={a.isCritical} onChange={() => upd(i, { isCritical: true, safetyAcknowledged: false }, "isCritical")} className="mt-0.5 accent-[var(--danger)]" />
                      <span>This activity is essential to safety, product quality or business continuity. It must not be interrupted or shifted.</span>
                    </label>
                    <label className={cx("flex cursor-pointer items-start gap-2 rounded-[8px] border p-2.5 text-[12.5px]", !a.isCritical ? "border-brand/40 bg-surface" : "border-line")}>
                      <input type="radio" name={`crit-${i}`} checked={!a.isCritical} onChange={() => upd(i, { isCritical: false, safetyAcknowledged: false }, "isCritical")} className="mt-0.5 accent-[var(--brand)]" />
                      <span>This activity can safely run at a different time within the window above.</span>
                    </label>
                  </div>
                  <label className="mt-2 flex cursor-pointer items-center gap-2 text-[12.5px]">
                    <input type="checkbox" checked={a.safetyAcknowledged} onChange={(e) => upd(i, { safetyAcknowledged: e.target.checked })} className="size-4 accent-[var(--brand)]" />I confirm this declaration is correct.
                  </label>
                  {fieldErr[`activities.${i}.safety`] && <p className="mt-1 text-[12px] text-danger">{fieldErr[`activities.${i}.safety`]}</p>}
                </div>
              </article>
            ))}

            <div className="rounded-[14px] border border-line bg-surface p-4">
              <label className="flex flex-wrap items-center justify-between gap-3 text-[13px]">
                <span className="font-medium">Minimum notice you need</span>
                <span className="flex items-center gap-2">
                  <input inputMode="numeric" value={notice ?? ""} placeholder="?" onChange={(e) => setNotice(e.target.value === "" ? null : Number(e.target.value))} className="h-9 w-20 rounded-[8px] border border-line-2 bg-surface-2/40 px-3 text-right outline-none focus:border-brand num" />
                  hours
                </span>
              </label>
            </div>

            {fieldErr.form && <Notice tone="danger" title={fieldErr.form} />}
            {Object.keys(fieldErr).length > 0 && !fieldErr.form && <Notice tone="warning" title="A few details need your input before the profile can be confirmed." />}

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-line bg-surface-2/60 p-4">
              <p className="text-[12.5px] text-ink-2">{unresolved ? `${unresolved} declaration${unresolved > 1 ? "s" : ""} still to confirm. ` : ""}Until you confirm, this draft is never used for offers.</p>
              <button onClick={confirm} className="h-11 rounded-[8px] bg-brand px-5 text-[14px] font-semibold text-white hover:bg-brand-2">
                Confirm and save profile
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function F({ label, prov, err, children }: { label: string; prov?: string; err?: string; children: React.ReactNode }) {
  const p = PROV[prov ?? "confirmed"];
  return (
    <label className="block">
      <span className="mb-1 flex flex-wrap items-center justify-between gap-1 text-[12px] text-ink-2">
        {label}
        {p && <Badge tone={p.tone} className="!text-[10.5px] !px-1.5">{p.label}</Badge>}
      </span>
      {children}
      {err && <span className="mt-1 block text-[11.5px] text-danger">{err}</span>}
    </label>
  );
}
