// Small natural-language time helpers used by the offline (no-API-key) extractors.

export function toHHMM(h: number, m = 0) {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const WORDS: Record<string, string> = {
  noon: "12:00",
  midday: "12:00",
  "after lunch": "12:00",
  lunchtime: "12:00",
  midnight: "00:00",
  "evening rush": "17:00",
  "evening peak": "17:00",
  "before the evening": "17:00",
};

/** Parse "6 p.m.", "6pm", "18:00", "noon", "7" (with a meridiem hint). */
export function parseTime(raw: string, hint: "am" | "pm" | null = null): string | null {
  const s = raw.toLowerCase().replace(/\./g, "").trim();
  for (const [w, v] of Object.entries(WORDS)) if (s.includes(w)) return v;
  const m = s.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const mer = (m[3] as "am" | "pm" | undefined) ?? hint;
  if (h > 23 || min > 59) return null;
  if (mer === "pm" && h < 12) h += 12;
  if (mer === "am" && h === 12) h = 0;
  if (!mer && !m[2] && h >= 1 && h <= 6) h += 12; // "between 1 and 5" in a business context → afternoon
  return toHHMM(h, min);
}

/** Find a time range like "between noon and 5 p.m.", "from 6 to 8 pm", "6 p.m.–8 p.m.". */
export function findRange(text: string): { start: string; end: string; match: string } | null {
  const t = text.toLowerCase();
  const re =
    /(?:between|from)?\s*(noon|midday|\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?)\s*(?:and|to|until|till|-|–|—)\s*(noon|midday|\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const endMer = /p\.?m/.test(m[2]) ? "pm" : /a\.?m/.test(m[2]) ? "am" : null;
    const startMer = /p\.?m/.test(m[1]) ? "pm" : /a\.?m/.test(m[1]) ? "am" : endMer;
    // avoid matching quantities like "5 kWh"
    const after = t.slice(m.index + m[0].length, m.index + m[0].length + 5);
    if (/^\s*k?wh?\b/.test(after)) continue;
    const start = parseTime(m[1], startMer);
    const end = parseTime(m[2], endMer);
    if (start && end && start < end) return { start, end, match: m[0].trim() };
  }
  return null;
}

export function nextWeekday(name: string, from = new Date()): string | null {
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const idx = days.indexOf(name.toLowerCase());
  if (idx < 0) return null;
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  let delta = (idx - d.getUTCDay() + 7) % 7;
  if (delta === 0) delta = 7;
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
