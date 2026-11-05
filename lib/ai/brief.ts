// Event Brief Parser (PRD §9.4). Every value it returns is labelled AI-proposed until the operator confirms.
import { z } from "zod";
import { claudeEnabled, claudeStructured, CLAUDE_MODEL } from "./claude";
import { findRange, nextWeekday } from "./time-parse";

export const BRIEF_PROMPT_VERSION = "event-brief-v2";

export interface BriefProposal {
  name: string | null;
  eventDate: string | null;
  peak: { start: string; end: string } | null;
  shift: { start: string; end: string } | null;
  targetKw: number | null;
  targetKwh: number | null;
  budgetUsd: number | null;
  derivation: string | null;
  questions: string[];
  proposedFields: string[];
  engine: { mode: "claude" | "offline"; model: string; latencyMs: number };
}

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const win = z.object({ start: hhmm, end: hhmm }).nullable();
const Schema = z.object({
  name: z.string().max(80).nullable(),
  event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  peak_window: win,
  shift_window: win,
  target_kw: z.number().positive().max(100000).nullable(),
  target_kwh: z.number().positive().max(1000000).nullable(),
  budget_usd: z.number().positive().max(100000).nullable(),
  questions: z.array(z.string().max(300)).max(8),
});

const TOOL = {
  name: "submit_event",
  description: "Return proposed demand-event fields.",
  input_schema: {
    type: "object",
    required: ["name", "event_date", "peak_window", "shift_window", "target_kw", "target_kwh", "budget_usd", "questions"],
    properties: {
      name: { type: ["string", "null"], description: "Short event name, max 80 chars" },
      event_date: { type: ["string", "null"], description: "YYYY-MM-DD" },
      peak_window: { anyOf: [{ type: "null" }, { type: "object", properties: { start: { type: "string" }, end: { type: "string" } }, required: ["start", "end"] }] },
      shift_window: { anyOf: [{ type: "null" }, { type: "object", properties: { start: { type: "string" }, end: { type: "string" } }, required: ["start", "end"] }] },
      target_kw: { type: ["number", "null"] },
      target_kwh: { type: ["number", "null"] },
      budget_usd: { type: ["number", "null"] },
      questions: { type: "array", items: { type: "string" } },
    },
  },
};

function hours(w: { start: string; end: string }) {
  const [a, b] = [w.start, w.end].map((t) => Number(t.slice(0, 2)) + Number(t.slice(3)) / 60);
  return b - a;
}

function complete(p: z.infer<typeof Schema>, engine: BriefProposal["engine"]): BriefProposal {
  const questions = [...p.questions];
  let kw = p.target_kw;
  let kwh = p.target_kwh;
  let derivation: string | null = null;
  if (p.peak_window) {
    const h = hours(p.peak_window);
    if (kwh != null && kw == null) {
      kw = Math.round((kwh / h) * 10) / 10;
      derivation = `${kwh.toFixed(1)} kWh ÷ ${h} h = ${kw.toFixed(1)} kW average`;
      questions.push(`Should the ${kw.toFixed(1)} kW target apply as an average across the full ${h}-hour window?`);
    } else if (kw != null && kwh == null) {
      kwh = Math.round(kw * h * 10) / 10;
      derivation = `${kw.toFixed(1)} kW × ${h} h = ${kwh.toFixed(1)} kWh`;
    } else if (kw != null && kwh != null) derivation = `${kw.toFixed(1)} kW × ${h} h = ${(kw * h).toFixed(1)} kWh`;
  }
  if (!p.peak_window) questions.push("When does the peak window start and end?");
  if (!p.shift_window) questions.push("Which alternate window can businesses move their usage into?");
  if (!p.budget_usd) questions.push("What is the total reward budget in USD?");
  if (!p.event_date) questions.push("Which date is the event on?");
  const proposed = [
    p.name && "name",
    p.event_date && "eventDate",
    p.peak_window && "peak",
    p.shift_window && "shift",
    kw != null && "targetKw",
    kwh != null && "targetWh",
    p.budget_usd && "budgetMinor",
  ].filter(Boolean) as string[];
  return { name: p.name, eventDate: p.event_date, peak: p.peak_window, shift: p.shift_window, targetKw: kw, targetKwh: kwh, budgetUsd: p.budget_usd, derivation, questions, proposedFields: proposed, engine };
}

function offline(text: string, today: string): z.infer<typeof Schema> {
  const t = text.replace(/\s+/g, " ");
  const kwh = t.match(/(\d+(?:\.\d+)?)\s*kwh/i);
  const kw = t.match(/(\d+(?:\.\d+)?)\s*kw(?!h)/i);
  const budget = t.match(/\$\s?(\d+(?:\.\d+)?)/) ?? t.match(/(\d+(?:\.\d+)?)\s*(?:usd|dollars)/i);
  const day = t.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
  const iso = t.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  // peak: the range near the word "peak"; shift: range near "between/move/shift"
  const parts = t.split(/(?<=[.;])(?<![ap]\.m\.)\s+/i); // don't split on "p.m."
  let peak = null as null | { start: string; end: string };
  let shift = null as null | { start: string; end: string };
  for (const s of parts) {
    const r = findRange(s);
    if (!r) continue;
    if (!peak && /peak|away from|avoid/i.test(s)) peak = { start: r.start, end: r.end };
    else if (!shift) shift = { start: r.start, end: r.end };
  }
  return {
    name: day ? `${day[1][0].toUpperCase()}${day[1].slice(1).toLowerCase()} evening peak` : "Evening peak event",
    event_date: iso ? iso[1] : day ? nextWeekday(day[1], new Date(`${today}T12:00:00Z`)) : null,
    peak_window: peak,
    shift_window: shift,
    target_kw: kw ? Number(kw[1]) : null,
    target_kwh: kwh ? Number(kwh[1]) : null,
    budget_usd: budget ? Number(budget[1]) : null,
    questions: [],
  };
}

/** `today` is the scenario date (YYYY-MM-DD) so relative weekdays resolve on the demo timeline. */
export async function parseBrief(text: string, today = new Date().toISOString().slice(0, 10)): Promise<BriefProposal> {
  const t0 = Date.now();
  const input = text.slice(0, 1500);
  if (claudeEnabled()) {
    const raw = await claudeStructured<unknown>(
      `You extract demand-response event parameters from an operator's brief. Today is ${today}; timezone Africa/Lagos. Use 24h HH:MM. Only return values stated or directly derivable; otherwise null and ask a question. Do not compute kW from kWh yourself.`,
      input,
      TOOL,
    );
    const parsed = Schema.safeParse(raw);
    if (!parsed.success) throw Object.assign(new Error("AI output failed schema validation"), { code: "AI_OUTPUT_INVALID" });
    return complete(parsed.data, { mode: "claude", model: CLAUDE_MODEL, latencyMs: Date.now() - t0 });
  }
  return complete(Schema.parse(offline(input, today)), { mode: "offline", model: "peakshift-rules-v1", latencyMs: Date.now() - t0 });
}
