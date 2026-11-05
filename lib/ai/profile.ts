// Flexibility Profile Extractor (PRD §9.2–9.3).
// AI interprets; it never invents capacity or commercial terms, and never declares a critical load safe.
import { z } from "zod";
import type { FieldProvenance, ProfileDraft } from "../types";
import { claudeEnabled, claudeStructured, CLAUDE_MODEL } from "./claude";
import { findRange, parseTime } from "./time-parse";

export const PROFILE_PROMPT_VERSION = "profile-extract-v3";
export const PROFILE_SCHEMA_VERSION = "profile-schema-v2";

const SYSTEM = `You convert a small-business owner's plain-language description into a structured electricity-flexibility profile for review.
Rules (non-negotiable):
- Only extract values the owner actually stated. If capacity (kWh) or a minimum reward is not stated, return null and list it in missing_fields. Never estimate.
- Refrigeration, cold rooms, medical devices, vaccines, security systems, fire/life-safety and essential water treatment are ALWAYS critical (is_critical=true).
- If it is unclear whether an activity can be interrupted, set is_critical=null and add a question.
- Times are 24h "HH:MM" local time. "After lunch" = 12:00. "Before the evening rush" = 17:00.
- source_evidence must quote the owner's exact words that support each activity.
- Write questions in plain, friendly language a non-technical owner understands.`;

const TOOL = {
  name: "submit_profile",
  description: "Return the structured flexibility profile draft.",
  input_schema: {
    type: "object",
    required: ["summary", "activities", "missing_fields", "questions", "assumptions", "confidence"],
    properties: {
      summary: { type: "string", description: "One sentence, plain language." },
      activities: {
        type: "array",
        items: {
          type: "object",
          required: ["name", "equipment_category", "is_critical", "maximum_shiftable_kwh", "available_window", "minimum_reward_cents_per_kwh", "operational_constraints", "source_evidence"],
          properties: {
            name: { type: "string" },
            equipment_category: { type: "string", enum: ["water_pump", "laundry", "food_prep", "cooking", "water_heating", "refrigeration", "hvac", "lighting", "ev_charging", "medical", "security", "other"] },
            is_critical: { type: ["boolean", "null"] },
            maximum_shiftable_kwh: { type: ["number", "null"] },
            available_window: { anyOf: [{ type: "null" }, { type: "object", required: ["start", "end"], properties: { start: { type: "string" }, end: { type: "string" } } }] },
            must_complete_by: { type: ["string", "null"] },
            minimum_reward_cents_per_kwh: { type: ["number", "null"] },
            operational_constraints: { type: "array", items: { type: "string" } },
            source_evidence: { type: "array", items: { type: "string" } },
          },
        },
      },
      minimum_notice_hours: { type: ["number", "null"] },
      missing_fields: { type: "array", items: { type: "string" } },
      questions: { type: "array", items: { type: "string" } },
      assumptions: { type: "array", items: { type: "string" } },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
    },
  },
} as const;

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const Schema = z.object({
  summary: z.string().max(400),
  activities: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        equipment_category: z.string().max(40),
        is_critical: z.boolean().nullable(),
        maximum_shiftable_kwh: z.number().min(0).max(500).nullable(),
        available_window: z.object({ start: hhmm, end: hhmm }).nullable(),
        must_complete_by: hhmm.nullable().optional(),
        minimum_reward_cents_per_kwh: z.number().min(0).max(1000).nullable(),
        operational_constraints: z.array(z.string().max(200)).max(10),
        source_evidence: z.array(z.string().max(400)).max(10),
      }),
    )
    .max(8),
  minimum_notice_hours: z.number().min(0).max(168).nullable().optional(),
  missing_fields: z.array(z.string()).max(20),
  questions: z.array(z.string().max(300)).max(10),
  assumptions: z.array(z.string().max(300)).max(10),
  confidence: z.enum(["high", "medium", "low"]),
});
type Raw = z.infer<typeof Schema>;

const ALWAYS_CRITICAL = /refrigerat|cold.?room|freez|fridge|vaccine|medical|oxygen|security|alarm|fire|life.?safety|water treatment|chlorinat/i;

/** Number grounding: a capacity/rate is kept only if the owner's text actually contains it. */
function grounded(n: number | null, text: string) {
  if (n == null) return false;
  const s = String(n);
  return text.includes(s) || text.includes(n.toFixed(1)) || (n < 1 && text.includes(String(Math.round(n * 100))));
}

function finalise(raw: Raw, text: string, engine: ProfileDraft["engine"]): ProfileDraft {
  const missing = new Set(raw.missing_fields);
  const questions = [...raw.questions];
  const activities = raw.activities.map((a, k) => {
    const prov: Record<string, FieldProvenance> = {};
    let isCritical = a.is_critical;
    if (ALWAYS_CRITICAL.test(`${a.name} ${a.equipment_category}`)) {
      isCritical = true;
      prov.isCritical = "safety";
    } else if (isCritical === null) {
      prov.isCritical = "safety";
      questions.push(`Is “${a.name}” essential to safety, product quality or business continuity? It stays excluded until you confirm.`);
    } else prov.isCritical = isCritical ? "safety" : "ai";

    let cap = a.maximum_shiftable_kwh;
    if (cap != null && !grounded(cap, text)) cap = null; // reject ungrounded capacity
    if (isCritical) cap = 0;
    prov.maxShiftWh = isCritical ? "confirmed" : cap == null ? "missing" : "ai";
    if (!isCritical && cap == null) missing.add(`maximum_shiftable_energy:${a.name}`);

    let rate = a.minimum_reward_cents_per_kwh;
    if (rate != null && !grounded(rate, text) && !grounded(rate / 100, text)) rate = null;
    prov.rateMinorPerKwh = isCritical ? "confirmed" : rate == null ? "missing" : "ai";
    if (!isCritical && rate == null) missing.add(`minimum_reward:${a.name}`);

    prov.window = isCritical ? "confirmed" : a.available_window ? "ai" : "missing";
    if (!isCritical && !a.available_window) missing.add(`available_window:${a.name}`);
    prov.name = "ai";

    return {
      id: `act_draft_${k}`,
      name: a.name,
      equipmentCategory: a.equipment_category,
      isCritical: isCritical ?? true, // unresolved → treated as critical (ineligible) until confirmed
      maxShiftWh: cap == null ? null : Math.round(cap * 1000),
      rateMinorPerKwh: rate == null ? null : Math.round(rate),
      currency: "USD" as const,
      window: isCritical ? null : a.available_window,
      mustCompleteBy: a.must_complete_by ?? null,
      constraints: a.operational_constraints,
      provenance: prov,
      sourceEvidence: a.source_evidence,
    };
  });
  return {
    summary: raw.summary,
    activities,
    minimumNoticeHours: raw.minimum_notice_hours ?? null,
    missingFields: [...missing],
    questions,
    assumptions: raw.assumptions,
    confidence: missing.size > 2 ? "low" : raw.confidence,
    engine,
  };
}

// ---------------- Offline extractor (no API key) ----------------

const CATS: { re: RegExp; cat: string; name: string }[] = [
  { re: /refrigerat|cold.?room|freez|fridge/i, cat: "refrigeration", name: "Cold-room refrigeration" },
  { re: /pump/i, cat: "water_pump", name: "Water pumping" },
  { re: /dough|mix|prep/i, cat: "food_prep", name: "Dough mixing / preparation batch" },
  { re: /wash|dry|laundry/i, cat: "laundry", name: "Washing and drying batch" },
  { re: /hot.?water|water heat|heater|cylinder|steamer|boiler/i, cat: "water_heating", name: "Water heating" },
  { re: /air.?con|hvac|cooling unit/i, cat: "hvac", name: "Air conditioning" },
  { re: /charg/i, cat: "ev_charging", name: "Vehicle charging" },
  { re: /oven/i, cat: "cooking", name: "Ovens" },
];

function offlineRaw(text: string): Raw {
  const sentences = text.split(/(?<=[.!?])(?<![ap]\.m\.)\s+|\n+/i).filter((s) => s.trim());
  const acts: Raw["activities"] = [];
  const kwhM = text.match(/(\d+(?:\.\d+)?)\s*kwh/i);
  const centsM = text.match(/(\d+(?:\.\d+)?)\s*(?:cents?|c)\s*(?:per|\/|a)\s*kwh/i) ?? text.match(/\$\s?(\d+(?:\.\d+)?)\s*(?:per|\/)\s*kwh/i);
  let rate: number | null = null;
  if (centsM) rate = /\$/.test(centsM[0]) ? Math.round(Number(centsM[1]) * 100) : Number(centsM[1]);

  for (const c of CATS) {
    const ev = sentences.filter((s) => c.re.test(s));
    if (!ev.length) continue;
    const joined = ev.join(" ");
    const neverMove = /never|must not|can'?t|cannot|do not interrupt|don'?t interrupt|must stay/i.test(joined) && !/can (run|move|pre)/i.test(joined);
    const critical = c.cat === "refrigeration" || (c.cat === "cooking" && neverMove) || neverMove;
    if (critical) {
      acts.push({ name: c.name, equipment_category: c.cat, is_critical: true, maximum_shiftable_kwh: null, available_window: null, must_complete_by: null, minimum_reward_cents_per_kwh: null, operational_constraints: [`${c.name} must not be interrupted`], source_evidence: ev });
      continue;
    }
    const range = findRange(text);
    let window = range ? { start: range.start, end: range.end } : null;
    const after = /after lunch|afternoon/i.test(text) ? "12:00" : null;
    const before = text.match(/(?:finish|done|complete[d]?)\s+(?:before|by)\s+([^,.;]+)/i);
    const by = before ? parseTime(before[1], "pm") : null;
    if (!window && after) window = { start: after, end: by && by > after ? by : "17:00" };
    const constraints: string[] = [];
    const reserve = text.match(/(?:keep|maintain)[^.]*?(reserve|floor|minimum)[^.]*/i);
    if (reserve) constraints.push(reserve[0].trim().replace(/^\w/, (x) => x.toUpperCase()));
    const done = text.match(/(?:done|ready|finish(?:ed)?)\s+by\s+[^.]*/i);
    if (done) constraints.push(done[0].trim().replace(/^\w/, (x) => x.toUpperCase()));
    const capacity = kwhM && !acts.some((a) => !a.is_critical) ? Number(kwhM[1]) : null; // one stated figure → first activity only
    acts.push({
      name: c.name,
      equipment_category: c.cat,
      is_critical: false,
      maximum_shiftable_kwh: capacity,
      available_window: window,
      must_complete_by: by,
      minimum_reward_cents_per_kwh: rate,
      operational_constraints: constraints,
      source_evidence: ev,
    });
  }
  // Explicit "do not interrupt the X" for things not caught above
  const dni = text.match(/(?:do not|don'?t|never)\s+interrupt\s+(?:the\s+)?([a-z\s-]{3,30})/i);
  if (dni && !acts.some((a) => a.is_critical && new RegExp(dni[1].trim().split(" ")[0], "i").test(a.name))) {
    acts.push({ name: dni[1].trim().replace(/^\w/, (x) => x.toUpperCase()), equipment_category: /cold|fridge|freez/i.test(dni[1]) ? "refrigeration" : "other", is_critical: true, maximum_shiftable_kwh: null, available_window: null, must_complete_by: null, minimum_reward_cents_per_kwh: null, operational_constraints: ["Must not be interrupted"], source_evidence: [dni[0]] });
  }
  const notice = text.match(/(\d+)\s*hours?'?\s*notice/i);
  const flexible = acts.filter((a) => !a.is_critical);
  return {
    summary: flexible.length
      ? `Can shift ${flexible.map((a) => a.name.toLowerCase()).join(" and ")}${flexible[0].available_window ? ` into ${flexible[0].available_window.start}–${flexible[0].available_window.end}` : ""}.`
      : "No flexible activity identified yet.",
    activities: acts,
    minimum_notice_hours: notice ? Number(notice[1]) : /day'?s notice/i.test(text) ? 24 : null,
    missing_fields: [],
    questions: flexible.length ? [] : ["Which activity could run at a different time of day?"],
    assumptions: /after lunch/i.test(text) ? ["“After lunch” interpreted as from 12:00."] : [],
    confidence: flexible.length && kwhM && rate ? "high" : "medium",
  };
}

export async function extractProfile(text: string): Promise<ProfileDraft> {
  const t0 = Date.now();
  const input = text.slice(0, 2000);
  if (claudeEnabled()) {
    const raw = await claudeStructured<unknown>(SYSTEM, `Business description:\n"""${input}"""`, TOOL as never);
    const parsed = Schema.safeParse(raw);
    if (!parsed.success) throw Object.assign(new Error("AI output failed schema validation"), { code: "AI_OUTPUT_INVALID" });
    return finalise(parsed.data, input, { mode: "claude", model: CLAUDE_MODEL, promptVersion: PROFILE_PROMPT_VERSION, schemaVersion: PROFILE_SCHEMA_VERSION, latencyMs: Date.now() - t0 });
  }
  const parsed = Schema.parse(offlineRaw(input));
  return finalise(parsed, input, { mode: "offline", model: "peakshift-rules-v1", promptVersion: PROFILE_PROMPT_VERSION, schemaVersion: PROFILE_SCHEMA_VERSION, latencyMs: Date.now() - t0 });
}
