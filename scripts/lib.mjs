// Shared helpers: event time → "years ago", formatting.
export const UNIVERSE_AGE = 13.787e9;
export const CATEGORIES = ['cosmology', 'geology', 'biology', 'human-evolution', 'history', 'science', 'technology', 'culture'];
export const SOURCE_TYPES = ['wikipedia', 'paper', 'book', 'museum', 'dataset', 'other'];
export const DATE_RE = /^(-?\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;

export function nowYear(d = new Date()) {
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  return d.getUTCFullYear() + (d.getTime() - start) / (365.25 * 864e5);
}

// Years before now. Calendar dates are converted against the current date.
export function yearsAgo(time, now = nowYear()) {
  if (typeof time.ya === 'number') return time.ya;
  const m = DATE_RE.exec(time.date);
  const y = Number(m[1]), mo = m[2] ? Number(m[2]) : 1, da = m[3] ? Number(m[3]) : 1;
  return Math.max(now - (y + (mo - 1) / 12 + (da - 1) / 365.25), 0.01);
}
