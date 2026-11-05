// Pure time-window helpers. No imports: safe for client components (never pulls seed data into the browser bundle).

export interface Window {
  start: string;
  end: string;
}

/** "HH:MM" → 15-minute interval index (0..96). */
export const toIdx = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 4 + Math.floor(m / 15);
};

/** Interval indexes covered by a window, end-exclusive. */
export const windowIdx = (w: Window) => {
  const a = toIdx(w.start);
  const b = toIdx(w.end);
  return Array.from({ length: Math.max(0, b - a) }, (_, k) => a + k);
};
