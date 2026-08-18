// domain/calendar.js — pure month-grid math. No DOM, no locale beyond weekday
// order. The week starts on Saturday (السبت), matching the app's audience.
// All dates are "YYYY-MM-DD" local strings; nothing here uses UTC.

import { toLocalDate } from '../core/dates.js';

// Saturday-first weekday short labels (السبت → الجمعة).
export const WEEKDAYS_AR = ['س', 'ح', 'ن', 'ث', 'ر', 'خ', 'ج'];

/** Column index (0=Saturday … 6=Friday) for a JS Date.getDay() (0=Sunday). */
export function satFirstIndex(jsDay) { return (jsDay + 1) % 7; }

/** Pad a number to a 2-digit string. */
function p2(n) { return String(n).padStart(2, '0'); }

/** The "YYYY-MM-DD" for a given year, 0-based month, and day-of-month. */
export function ymd(year, month0, day) { return `${year}-${p2(month0 + 1)}-${p2(day)}`; }

/** Days in a 0-based month. */
export function daysInMonth(year, month0) { return new Date(year, month0 + 1, 0).getDate(); }

/**
 * Build a month grid as an array of weeks (each 7 cells). Cells are either null
 * (padding for days outside the month) or { date, day } for in-month days.
 * Leading padding aligns the 1st under its Saturday-first weekday column.
 */
export function monthGrid(year, month0) {
  const first = new Date(year, month0, 1);
  const lead = satFirstIndex(first.getDay());       // empty cells before day 1
  const total = daysInMonth(year, month0);
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= total; d++) cells.push({ date: ymd(year, month0, d), day: d });
  while (cells.length % 7 !== 0) cells.push(null);   // trailing padding
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Inclusive first/last date strings of a month (for bounded range queries). */
export function monthBounds(year, month0) {
  return { from: ymd(year, month0, 1), to: ymd(year, month0, daysInMonth(year, month0)) };
}

/** Previous / next month as { year, month0 }. */
export function prevMonth(year, month0) { return month0 === 0 ? { year: year - 1, month0: 11 } : { year, month0: month0 - 1 }; }
export function nextMonth(year, month0) { return month0 === 11 ? { year: year + 1, month0: 0 } : { year, month0: month0 + 1 }; }

/** { year, month0 } for a "YYYY-MM-DD" string (or today's Date). */
export function monthOf(dateStr) {
  const [y, m] = dateStr.split('-').map(Number);
  return { year: y, month0: m - 1 };
}
export function monthOfToday(d = new Date()) { return { year: d.getFullYear(), month0: d.getMonth() }; }

export { toLocalDate };
