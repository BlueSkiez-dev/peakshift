"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Sparkles, Wand2 } from "lucide-react";
import { api, ApiError } from "@/lib/client";
import type { BriefProposal } from "@/lib/ai/brief";
import { clock, money } from "@/lib/format";
import { Badge, Button, Notice, Panel, cx } from "./ui";
import { useToast } from "./overlay";

const EXAMPLE = "We need to shift 16 kWh away from the 6 p.m. to 8 p.m. peak on Friday. Businesses can move flexible work between noon and 5 p.m. We have a $12 reward budget.";
const STEPS = ["Define the need", "Set the time window", "Set the reward budget", "Review and fund"];

type Form = { name: string; eventDate: string; peakStart: string; peakEnd: string; shiftStart: string; shiftEnd: string; targetKw: string; targetKwh: string; budget: string; notes: string };

const hours = (a: string, b: string) => {
  const [h1, m1] = a.split(":").map(Number);
  const [h2, m2] = b.split(":").map(Number);
  return (h2 * 60 + m2 - h1 * 60 - m1) / 60;
};

export function EventWizard({ ai, paypal }: { ai: "claude" | "offline"; paypal: "sandbox" | "simulator" }) {
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<"describe" | "manual">("describe");
  const [brief, setBrief] = useState("");
  const [parsing, setParsing] = useState(false);
  const [proposal, setProposal] = useState<BriefProposal | null>(null);
  const [aiFields, setAiFields] = useState<Set<string>>(new Set());
  const [edited, setEdited] = useState<Set<string>>(new Set());
  const [aiErr, setAiErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const [f, setF] = useState<Form>({ name: "", eventDate: "", peakStart: "18:00", peakEnd: "20:00", shiftStart: "12:00", shiftEnd: "17:00", targetKw: "", targetKwh: "", budget: "", notes: "" });

  const set = (k: keyof Form, v: string) => {
    setF((x) => ({ ...x, [k]: v }));
    if (aiFields.has(k)) setEdited((e) => new Set(e).add(k));
  };

  async function extract() {
    setParsing(true);
    setAiErr(null);
    try {
      const p = await api<BriefProposal>("events/parse-brief", { body: { text: brief } });
      setProposal(p);
      const fields = new Set<string>();
      const nf = { ...f };
      const take = (key: keyof Form, value: string) => {
        nf[key] = value;
        fields.add(key);
      };
      if (p.name) take("name", p.name);
      if (p.eventDate) take("eventDate", p.eventDate);
      if (p.peak) {
        take("peakStart", p.peak.start);
        take("peakEnd", p.peak.end);
      }
      if (p.shift) {
        take("shiftStart", p.shift.start);
        take("shiftEnd", p.shift.end);
      }
      if (p.targetKw != null) take("targetKw", String(p.targetKw));
      if (p.targetKwh != null) take("targetKwh", String(p.targetKwh));
      if (p.budgetUsd != null) take("budget", p.budgetUsd.toFixed(2));
      setF(nf);
      setAiFields(fields);
      setEdited(new Set());
    } catch (e) {
      setAiErr((e as ApiError).message);
    } finally {
      setParsing(false);
    }
  }

  const peakH = hours(f.peakStart, f.peakEnd);
  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    if (!f.name.trim()) e.name = "Give the event a name.";
    if (f.name.length > 80) e.name = "Max 80 characters.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.eventDate)) e.eventDate = "Choose a date.";
    if (peakH <= 0) e.peak = "Peak end must be after start.";
    if (hours(f.shiftStart, f.shiftEnd) <= 0) e.shift = "Window end must be after start.";
    else if (f.shiftStart < f.peakEnd && f.peakStart < f.shiftEnd) e.shift = "The alternate window must not overlap the peak window.";
    if (!(Number(f.targetKwh) > 0)) e.targetKwh = "Target energy must be greater than 0.";
    if (!(Number(f.targetKw) > 0)) e.targetKw = "Average power must be greater than 0.";
    if (!(Number(f.budget) > 0)) e.budget = "Budget must be greater than 0.";
    return e;
  }, [f, peakH]);
  const stepFields = [["name", "eventDate", "targetKwh", "targetKw"], ["peak", "shift"], ["budget"], []];
  const stepValid = (i: number) => stepFields[i].every((k) => !errors[k]);

  async function save() {
    setSaving(true);
    setFieldErr({});
    try {
      const ev = await api<{ id: string }>("events", {
        body: {
          name: f.name.trim(),
          eventDate: f.eventDate,
          peak: { start: f.peakStart, end: f.peakEnd },
          shift: { start: f.shiftStart, end: f.shiftEnd },
          targetKw: Number(f.targetKw),
          targetWh: Math.round(Number(f.targetKwh) * 1000),
          budgetMinor: Math.round(Number(f.budget) * 100),
          currency: "USD",
          minDataQuality: 90,
          notes: f.notes,
          aiProposedFields: [...aiFields],
        },
      });
      toast({ tone: "success", title: "Event draft created", detail: "Fund the budget to start optimising." });
      router.push(`/operator/events/${ev.id}?stage=fund`);
    } catch (e) {
      const ae = e as ApiError;
      setFieldErr(ae.fields ?? { form: ae.message });
      setSaving(false);
    }
  }

  const label = (k: string) =>
    aiFields.has(k) ? (
      edited.has(k) ? <Badge tone="neutral">Edited by you</Badge> : <Badge tone="info">AI-proposed — review before saving</Badge>
    ) : null;

  return (
    <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
      <ol className="flex gap-2 overflow-x-auto lg:flex-col" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button
              onClick={() => i <= step && setStep(i)}
              disabled={i > step}
              aria-current={i === step ? "step" : undefined}
              className={cx("flex w-full items-center gap-3 rounded-[10px] border px-3 py-2.5 text-left text-[13px] whitespace-nowrap", i === step ? "border-signal/40 bg-signal-dim text-ink" : i < step ? "border-line text-ink-2 hover:bg-surface-2" : "border-line/60 text-ink-3")}
            >
              <span className={cx("grid size-5 place-items-center rounded-full text-[11px] num", i < step ? "bg-signal text-signal-ink" : "border border-line-2")}>{i < step ? <Check className="size-3" strokeWidth={3} /> : i + 1}</span>
              {s}
            </button>
          </li>
        ))}
      </ol>

      <div className="space-y-4">
        {step === 0 && (
          <Panel title="Define the need" subtitle="Describe the event the way you'd brief a colleague. AI proposes structured fields; you confirm every value.">
            <div className="mb-4 inline-flex rounded-[8px] border border-line bg-surface-2 p-0.5 text-[13px]" role="tablist">
              {(["describe", "manual"] as const).map((m) => (
                <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={cx("rounded-[6px] px-3 py-1.5", mode === m ? "bg-surface text-ink shadow" : "text-ink-2")}>
                  {m === "describe" ? "Describe the event (recommended)" : "Enter details manually"}
                </button>
              ))}
            </div>
            {mode === "describe" && (
              <div className="mb-5 space-y-2">
                <label htmlFor="brief" className="text-[13px] font-medium">Event brief</label>
                <textarea id="brief" value={brief} onChange={(e) => setBrief(e.target.value)} rows={4} placeholder={EXAMPLE} className="w-full rounded-[10px] border border-line-2 bg-surface-2 px-3.5 py-3 text-[14px] outline-none focus:border-signal/60" />
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="primary" onClick={extract} loading={parsing} loadingLabel="Reading event brief…" disabled={!brief.trim()} icon={<Sparkles className="size-4" />}>
                    Extract event details
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setBrief(EXAMPLE)} icon={<Wand2 className="size-3.5" />}>
                    Use example brief
                  </Button>
                  <span className="text-[12px] text-ink-3">{ai === "claude" ? "Claude · schema-validated" : "Offline extractor (no AI key) · schema-validated"}</span>
                </div>
                {aiErr && <Notice tone="warning" title={aiErr} />}
                {proposal && (
                  <div className="rounded-[10px] border border-info/30 bg-info-dim p-4 anim-fade-up">
                    <div className="text-[13px] font-medium text-ink">Here&apos;s what we understood. Check each value below before continuing.</div>
                    {proposal.derivation && <div className="mt-1 text-[12.5px] text-ink-2 num">Derived: {proposal.derivation} — you can correct it.</div>}
                    {proposal.questions.length > 0 && (
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-[12.5px] text-ink-2">
                        {proposal.questions.map((q) => <li key={q}>{q}</li>)}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Event name" err={errors.name && f.name !== "" ? errors.name : undefined} tag={label("name")}>
                <input value={f.name} maxLength={80} onChange={(e) => set("name", e.target.value)} className={inp} />
              </Field>
              <Field label="Event date" err={errors.eventDate && f.eventDate ? errors.eventDate : undefined} tag={label("eventDate")} hint="Africa/Lagos (WAT)">
                <input type="date" value={f.eventDate} onChange={(e) => set("eventDate", e.target.value)} className={inp} />
              </Field>
              <Field label="Target energy to shift (kWh)" err={f.targetKwh ? errors.targetKwh : undefined} tag={label("targetKwh")} hint="Energy — kWh">
                <input inputMode="decimal" value={f.targetKwh} onChange={(e) => set("targetKwh", e.target.value)} className={inp} />
              </Field>
              <Field label="Average reduction (kW)" err={f.targetKw ? errors.targetKw : undefined} tag={label("targetKw")} hint="Power — kW, averaged over the peak">
                <div className="flex gap-2">
                  <input inputMode="decimal" value={f.targetKw} onChange={(e) => set("targetKw", e.target.value)} className={inp} />
                  <Button type="button" size="sm" variant="ghost" onClick={() => peakH > 0 && Number(f.targetKwh) > 0 && set("targetKw", String(Math.round((Number(f.targetKwh) / peakH) * 10) / 10))}>
                    Derive
                  </Button>
                </div>
              </Field>
            </div>
            {Number(f.targetKw) > 0 && peakH > 0 && (
              <p className="mt-3 text-[12.5px] text-ink-2 num">
                {Number(f.targetKw).toFixed(1)} kW × {peakH} hours = {(Number(f.targetKw) * peakH).toFixed(1)} kWh {Math.abs(Number(f.targetKw) * peakH - Number(f.targetKwh)) > 0.05 && Number(f.targetKwh) > 0 ? <span className="text-warning">· doesn&apos;t match the {f.targetKwh} kWh target</span> : null}
              </p>
            )}
          </Panel>
        )}

        {step === 1 && (
          <Panel title="Set the time window" subtitle="When demand must fall, and when businesses may move their usage instead.">
            <Timeline f={f} />
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field label="Peak window" err={errors.peak} tag={label("peakStart")}>
                <div className="flex items-center gap-2">
                  <input type="time" step={900} value={f.peakStart} onChange={(e) => set("peakStart", e.target.value)} className={inp} aria-label="Peak start" />
                  <span className="text-ink-3">to</span>
                  <input type="time" step={900} value={f.peakEnd} onChange={(e) => set("peakEnd", e.target.value)} className={inp} aria-label="Peak end" />
                </div>
              </Field>
              <Field label="Alternate shift window" err={errors.shift} tag={label("shiftStart")}>
                <div className="flex items-center gap-2">
                  <input type="time" step={900} value={f.shiftStart} onChange={(e) => set("shiftStart", e.target.value)} className={inp} aria-label="Alternate start" />
                  <span className="text-ink-3">to</span>
                  <input type="time" step={900} value={f.shiftEnd} onChange={(e) => set("shiftEnd", e.target.value)} className={inp} aria-label="Alternate end" />
                </div>
              </Field>
            </div>
            <p className="mt-3 text-[12.5px] text-ink-2 num">
              {Number(f.targetKw || 0).toFixed(1)} kW × {peakH > 0 ? peakH : 0} hours = {(Number(f.targetKw || 0) * Math.max(0, peakH)).toFixed(1)} kWh target. kW is average power; kWh is energy.
            </p>
          </Panel>
        )}

        {step === 2 && (
          <Panel title="Set the reward budget" subtitle="The maximum total incentive. The optimiser will show the expected cost before anything is published.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Reward budget" err={f.budget ? errors.budget : undefined} tag={label("budget")}>
                <div className="flex items-center rounded-[8px] border border-line-2 bg-surface-2 focus-within:border-signal/60">
                  <span className="pl-3 text-ink-3">$</span>
                  <input inputMode="decimal" value={f.budget} onChange={(e) => set("budget", e.target.value)} className="h-10 w-full bg-transparent px-2 text-[14px] outline-none num" />
                  <span className="pr-3 text-[12px] text-ink-3">USD</span>
                </div>
              </Field>
              <Field label="Internal note (optional)">
                <input value={f.notes} onChange={(e) => set("notes", e.target.value)} className={inp} />
              </Field>
            </div>
            <Notice tone="info" className="mt-4">The {paypal === "sandbox" ? "sandbox" : "simulated"} budget is for demonstration and is not an escrow balance or a PayPal wallet balance.</Notice>
          </Panel>
        )}

        {step === 3 && (
          <Panel title="Review and fund" subtitle="Confirm the values. The event is saved as a draft awaiting funding; offers can't be published until funding is captured.">
            <dl className="grid gap-x-8 divide-y divide-line sm:grid-cols-2 sm:divide-y-0">
              {[
                ["Event", f.name, "name"],
                ["Date", f.eventDate, "eventDate"],
                ["Peak window", `${clock(f.peakStart)}–${clock(f.peakEnd)}`, "peakStart"],
                ["Alternate window", `${clock(f.shiftStart)}–${clock(f.shiftEnd)}`, "shiftStart"],
                ["Target", `${Number(f.targetKwh).toFixed(1)} kWh (${Number(f.targetKw).toFixed(1)} kW avg)`, "targetKwh"],
                ["Reward budget", money(Math.round(Number(f.budget) * 100)), "budget"],
              ].map(([k, v, key]) => (
                <div key={k} className="flex items-center justify-between gap-3 py-2.5 sm:border-b sm:border-line">
                  <dt className="text-[13px] text-ink-2">{k}</dt>
                  <dd className="flex items-center gap-2 text-[13.5px] num">
                    {v}
                    {aiFields.has(key) && <Badge tone="info">{edited.has(key) ? "AI · edited" : "AI · confirmed"}</Badge>}
                  </dd>
                </div>
              ))}
            </dl>
            {fieldErr.form && <Notice tone="danger" className="mt-3" title={fieldErr.form} />}
            {Object.keys(fieldErr).filter((k) => k !== "form").length > 0 && <Notice tone="danger" className="mt-3" title="Some fields need attention">{Object.values(fieldErr).join(" ")}</Notice>}
          </Panel>
        )}

        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0} icon={<ArrowLeft className="size-4" />}>
            Back
          </Button>
          {step < 3 ? (
            <Button variant="primary" onClick={() => setStep((s) => s + 1)} disabled={!stepValid(step)}>
              Continue <ArrowRight className="size-4" />
            </Button>
          ) : (
            <Button variant="primary" onClick={save} loading={saving} loadingLabel="Creating draft…">
              Save and continue to {paypal === "sandbox" ? "PayPal sandbox" : "funding"} <ArrowRight className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

const inp = "h-10 w-full rounded-[8px] border border-line-2 bg-surface-2 px-3 text-[14px] outline-none focus:border-signal/60 num";

function Field({ label, children, err, tag, hint }: { label: string; children: React.ReactNode; err?: string; tag?: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex flex-wrap items-center gap-2 text-[13px] font-medium">
        {label} {tag}
      </span>
      {children}
      {hint && !err && <span className="mt-1 block text-[11.5px] text-ink-3">{hint}</span>}
      {err && <span className="mt-1 block text-[12px] text-danger">{err}</span>}
    </label>
  );
}

function Timeline({ f }: { f: Form }) {
  const pos = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return ((h * 60 + m) / 1440) * 100;
  };
  return (
    <div className="relative h-16 rounded-[10px] border border-line bg-surface-2/40" aria-hidden>
      <div className="absolute inset-y-2 rounded-[6px] border border-info/40 bg-info-dim" style={{ left: `${pos(f.shiftStart)}%`, width: `${Math.max(0, pos(f.shiftEnd) - pos(f.shiftStart))}%` }}>
        <span className="absolute left-2 top-1 text-[11px] text-info">Alternate</span>
      </div>
      <div className="absolute inset-y-2 rounded-[6px] border border-warning/50 bg-warning-dim" style={{ left: `${pos(f.peakStart)}%`, width: `${Math.max(0, pos(f.peakEnd) - pos(f.peakStart))}%` }}>
        <span className="absolute left-2 top-1 text-[11px] text-warning">Peak</span>
      </div>
      <div className="absolute inset-x-0 bottom-0 flex justify-between px-2 pb-0.5 text-[10px] text-ink-3 num">
        {[0, 6, 12, 18, 24].map((h) => <span key={h}>{String(h).padStart(2, "0")}:00</span>)}
      </div>
    </div>
  );
}
