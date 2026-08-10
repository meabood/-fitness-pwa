// dates.js — the ONLY module that reads the clock or formats calendar dates.
//
// Date strategy (locked in architecture review):
//  * Each entry's calendar day is stored as a local-calendar string "YYYY-MM-DD",
//    computed from the device's LOCAL time — never from toISOString() (which is
//    UTC and would shift entries across midnight for non-UTC users, e.g. UTC+3).
//  * Time-of-day is stored separately as "HH:mm" (also local) for ordering/display.
//  * Epoch-millisecond timestamps (createdAt/updatedAt) are for auditing only and
//    are NEVER used to decide which calendar day an entry belongs to.
//
// Everything in the app queries by the "YYYY-MM-DD" string, so "which day" is
// unambiguous and stable across timezones and DST.

const AR_MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

const pad2 = (n) => String(n).padStart(2, '0');

/** Local calendar date string "YYYY-MM-DD" for a Date (defaults to now). */
export function toLocalDate(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Local time string "HH:mm" for a Date (defaults to now). */
export function toLocalTime(d = new Date()) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Today's local date string. */
export function todayLocal() {
  return toLocalDate(new Date());
}

/** Epoch milliseconds — audit timestamps only. */
export function now() {
  return Date.now();
}

/** Parse "YYYY-MM-DD" into a LOCAL Date at midnight (safe for arithmetic). */
export function parseLocalDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d); // local midnight, no UTC shift
}

/** True if `s` is a real "YYYY-MM-DD" calendar date (round-trips exactly). */
export function isValidLocalDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

/** True if `s` is a valid 24-hour "HH:mm" (or "HH:mm:ss") local time string. */
export function isValidLocalTime(s) {
  if (typeof s !== 'string') return false;
  const m = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (!m) return false;
  const h = Number(m[1]), min = Number(m[2]), sec = m[3] == null ? 0 : Number(m[3]);
  return h >= 0 && h <= 23 && min >= 0 && min <= 59 && sec >= 0 && sec <= 59;
}

/** Add (or subtract) whole days to a "YYYY-MM-DD" string, returning a string. */
export function addDays(dateStr, days) {
  const d = parseLocalDate(dateStr);
  d.setDate(d.getDate() + days);
  return toLocalDate(d);
}

/** Compare two "YYYY-MM-DD" strings: -1 / 0 / 1. Lexicographic works for ISO. */
export function compareDates(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Inclusive trailing window of `n` calendar days ending at `endDate`.
 * Returns { from, to } as date strings, where `from` = endDate - (n-1) days.
 * Used for the 7-day moving average window, etc.
 */
export function trailingWindow(endDate, n) {
  return { from: addDays(endDate, -(n - 1)), to: endDate };
}

/** Human Arabic date, e.g. "8 أغسطس 2026". Display only. */
export function formatArabicDate(dateStr) {
  const d = parseLocalDate(dateStr);
  return `${d.getDate()} ${AR_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Short Arabic date, e.g. "8 أغسطس". Display only. */
export function formatArabicDateShort(dateStr) {
  const d = parseLocalDate(dateStr);
  return `${d.getDate()} ${AR_MONTHS[d.getMonth()]}`;
}
