// Display-only formatting. Never use these to compute authoritative values.

export const kwh = (wh: number | null | undefined, digits = 1) =>
  wh == null ? "—" : `${(wh / 1000).toFixed(digits)} kWh`;

export const kwhNum = (wh: number, digits = 1) => (wh / 1000).toFixed(digits);

export const kw = (v: number, digits = 1) => `${v.toFixed(digits)} kW`;

export const money = (minor: number | null | undefined, currency = "USD") =>
  minor == null
    ? "—"
    : new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2 }).format(minor / 100);

export const rate = (minorPerKwh: number | null | undefined) =>
  minorPerKwh == null ? "—" : `${money(minorPerKwh)}/kWh`;

export const pct = (v: number, digits = 1) => `${v.toFixed(digits)}%`;

/** "18:00" → "6:00 p.m." */
export function clock(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  if (h === 12 && m === 0) return "noon";
  const suffix = h >= 12 ? "p.m." : "a.m.";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

export const windowLabel = (w: { start: string; end: string } | null | undefined) =>
  w ? `${clock(w.start)}–${clock(w.end)}` : "—";

export function dateLabel(iso: string, opts: Intl.DateTimeFormatOptions = {}) {
  const d = new Date(iso.length === 10 ? iso + "T12:00:00Z" : iso);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", ...opts });
}

export function stamp(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Africa/Lagos",
  }) + " WAT";
}

export function ago(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export const intervalLabel = (i: number) => {
  const h = Math.floor(i / 4);
  const m = (i % 4) * 15;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

export const shortId = (id: string | null | undefined, n = 8) => (id ? (id.length > n ? id.slice(0, n) + "…" : id) : "—");

export function maskEmail(email: string | undefined | null) {
  if (!email) return "—";
  const [user, domain] = email.split("@");
  const [dName, ...tld] = domain.split(".");
  return `${user.slice(0, 2)}•••@${dName.slice(0, 1)}•••.${tld.join(".")}`;
}
