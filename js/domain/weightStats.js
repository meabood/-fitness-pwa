// weightStats.js — PURE weight calculations (no DB, no DOM). Fully unit-testable.
//
// Stage 2: sorting, the official-daily-weight selection invariant, the
// previous-chronological-official comparison, and deltas.
// Stage 3: 7-day trailing-calendar moving average and the new-lowest timeline.

import { addDays } from '../core/dates.js';

/** Compare two entries chronologically: date, then time, then createdAt. */
export function byDateTime(a, b) {
  if (a.localDate !== b.localDate) return a.localDate < b.localDate ? -1 : 1;
  const at = a.time || '', bt = b.time || '';
  if (at !== bt) return at < bt ? -1 : 1;
  return (a.createdAt || 0) - (b.createdAt || 0);
}

/** The "latest" entry within a day: max by (time, createdAt). */
export function latestOfDay(entries) {
  return entries.slice().sort(byDateTime).at(-1) || null;
}

/**
 * Choose which entry on a single date should be the official daily weight.
 * This encodes the invariant "a date with any entries has exactly one official"
 * and "never two officials on one date".
 *
 * Rules, in order:
 *   1. No entries              → null (nothing to make official).
 *   2. preferredId given & present → that entry (used when the user promotes one,
 *      or when a freshly added sole entry should auto-become official). This is
 *      what makes "change official" work: promoting the evening weight makes it
 *      official and every sibling loses official status.
 *   3. Exactly one already official → keep it.
 *   4. More than one official (corrupt/legacy) → collapse to the latest.
 *   5. Zero official (e.g. the official was just deleted) → promote the latest.
 *
 * @returns {string|null} the id that should be official
 */
export function chooseOfficialId(entries, preferredId) {
  if (!entries || entries.length === 0) return null;
  if (preferredId && entries.some((e) => e.id === preferredId)) return preferredId;

  const officials = entries.filter((e) => e.isOfficial === 1);
  if (officials.length === 1) return officials[0].id;
  if (officials.length > 1) return latestOfDay(officials).id;
  return latestOfDay(entries).id;
}

/** Official entries, one per date, sorted ascending by date. */
export function officialTimeline(entries) {
  return entries
    .filter((e) => e.isOfficial === 1)
    .sort((a, b) => (a.localDate < b.localDate ? -1 : a.localDate > b.localDate ? 1 : 0));
}

// ---- default/assignment decisions (pure, unit-tested) ----

/**
 * Default state of the "official daily weight" toggle for a NEW measurement on a
 * date. A date's first measurement defaults to official; if the date already has
 * an official, a new measurement defaults to NON-official (the user may still opt
 * in). Adding a later measurement must never silently replace the day's official.
 */
export function defaultNewMeasurementOfficial(dateHasOfficial) {
  return !dateHasOfficial;
}

/**
 * The `preferred` official id to pass to chooseOfficialId after ADDING an entry.
 * @param totalRowsAfterAdd  entry count on the date including the new one
 * @param makeOfficial       explicit user choice (from the toggle)
 * @param newId              the new entry's id
 */
export function addOfficialPreference(totalRowsAfterAdd, makeOfficial, newId) {
  if (makeOfficial === true) return newId;   // user opted in
  if (totalRowsAfterAdd === 1) return newId; // sole entry of the date → official
  return undefined;                          // keep the date's existing official
}

/**
 * Decide how a MOVED entry should be treated on its destination date.
 * The entry's old isOfficial state must NOT be blindly carried over: unless the
 * user explicitly promotes it, the moved entry arrives non-official so the
 * destination's existing official is preserved. If the destination has no
 * official, the invariant (chooseOfficialId) will promote the moved entry.
 * @returns {{movedFlag: 0|1, preferred: string|undefined}}
 */
export function moveOfficialDecision({ movedId, makeOfficial }) {
  if (makeOfficial === true) return { movedFlag: 1, preferred: movedId };
  return { movedFlag: 0, preferred: undefined };
}

/**
 * The previous chronological OFFICIAL entry strictly before `dateStr`.
 * "Previous weight" means previous official weigh-in — NOT necessarily yesterday.
 * @param {Array} timeline  output of officialTimeline (sorted asc)
 */
export function previousOfficialBefore(timeline, dateStr) {
  let prev = null;
  for (const e of timeline) {
    if (e.localDate < dateStr) prev = e;
    else break;
  }
  return prev;
}

/** Signed change in kg from prev → curr (negative = weight down). null if either missing. */
export function changeKg(prev, curr) {
  if (!prev || !curr) return null;
  return curr.weightKg - prev.weightKg;
}

/**
 * The local date of the START of the week containing `dateStr`. The app's week
 * begins on SATURDAY (matching the calendar convention). Pure string/Date math
 * on the local date only — no UTC boundaries.
 */
export function weekStartDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const jsDay = new Date(y, m - 1, d).getDay(); // 0=Sun … 6=Sat
  const offsetFromSaturday = (jsDay + 1) % 7;   // Sat→0, Sun→1, … Fri→6
  return addDays(dateStr, -offsetFromSaturday);
}

/**
 * Compact "this week" summary from OFFICIAL weigh-ins, for Home. Uses the local
 * week starting Saturday of `asOfDate`. Honest about missing data:
 *  - `latest`     : the most recent official weigh-in on/before asOfDate (or null)
 *  - `weekStart`  : the FIRST official weigh-in within the current week (or null;
 *                   never fabricated). If the week has only one weigh-in, it is
 *                   both weekStart and latest.
 *  - `changeKg`   : latest − weekStart (null when either is missing, or when both
 *                   are the same single measurement → 0 is not implied)
 * Derived from history only; nothing is stored.
 *
 * @param timeline official entries (any order; will be filtered/sorted)
 * @param asOfDate "YYYY-MM-DD"
 */
/**
 * Compact "this week" summary from OFFICIAL weigh-ins, for Home. Uses the local
 * week starting Saturday of `asOfDate`. Everything is scoped strictly to the
 * current week — a previous-week measurement is NEVER presented as this week's:
 *  - `hasWeekData` : whether any official weigh-in falls in the current week
 *  - `firstInWeek` : the FIRST official weigh-in within the week (may be mid-week,
 *                    e.g. Wednesday), or null. Never fabricated.
 *  - `latestInWeek`: the LATEST official weigh-in within the week, or null.
 *  - `changeKg`    : latestInWeek − firstInWeek (null when fewer than two DISTINCT
 *                    in-week measurements → a single weigh-in never implies 0)
 *  - `priorLatest` : the most recent official weigh-in BEFORE this week (context
 *                    only; the caller must not label it as a this-week value)
 * Derived from history only; nothing is stored.
 *
 * @param timeline official entries (any order; will be filtered/sorted)
 * @param asOfDate "YYYY-MM-DD"
 */
export function weekSummary(timeline, asOfDate) {
  const ws = weekStartDate(asOfDate);
  const sorted = (timeline || []).filter((e) => e && e.localDate <= asOfDate).sort(byDateTime);
  const inWeek = sorted.filter((e) => e.localDate >= ws && e.localDate <= asOfDate);
  const priorLatest = sorted.filter((e) => e.localDate < ws).slice(-1)[0] || null;
  const firstInWeek = inWeek.length ? inWeek[0] : null;
  const latestInWeek = inWeek.length ? inWeek[inWeek.length - 1] : null;
  // change only with two DISTINCT in-week measurements (single weigh-in ⇒ null)
  const changeKg = (firstInWeek && latestInWeek && firstInWeek.id !== latestInWeek.id)
    ? (latestInWeek.weightKg - firstInWeek.weightKg) : null;
  return {
    weekStartDate: ws,
    hasWeekData: inWeek.length > 0,
    firstInWeek, latestInWeek, changeKg, priorLatest,
    // legacy aliases (pre-0.15.2 callers): scoped to in-week now
    weekStart: firstInWeek, latest: latestInWeek,
  };
}

// ---- Stage 3: moving average + new-lowest (pure) ----

/**
 * 7-day moving average of OFFICIAL weigh-ins over the trailing 7 CALENDAR days
 * ending at `endDate` (inclusive): the window is [endDate-6 days, endDate].
 *
 * Critical semantics:
 *  - Uses the trailing 7 calendar days, NOT the last 7 measurements. A weigh-in
 *    outside the date window is excluded even if it is among the most recent.
 *  - Missing days are never invented or interpolated: the average is over the
 *    official weigh-ins that actually fall in the window. If none fall in it,
 *    the average is null (the UI degrades gracefully).
 *
 * @param {Array} timeline  official entries (any order)
 * @param {string} endDate  "YYYY-MM-DD"
 * @returns {{avg: number|null, count: number, from: string, to: string}}
 */
export function movingAverage7(timeline, endDate) {
  const from = addDays(endDate, -6); // 7 calendar days inclusive
  const inWindow = timeline.filter((e) => e.localDate >= from && e.localDate <= endDate);
  if (inWindow.length === 0) return { avg: null, count: 0, from, to: endDate };
  const sum = inWindow.reduce((s, e) => s + e.weightKg, 0);
  return { avg: sum / inWindow.length, count: inWindow.length, from, to: endDate };
}

/**
 * Identify which official weigh-ins were a NEW LOWEST at the time they occurred
 * (strictly below every prior official weight), derived by replaying history.
 * The FIRST official weigh-in is a baseline, not an achievement: a new-low
 * requires at least one prior official weigh-in and then a strictly lower value.
 * `lowest` still reports the overall minimum entry (which may be the first) for
 * the "lowest official weight" statistic.
 * @returns {{lows: Set<string>, lowest: {value:number, entryId:string}|null}}
 */
export function runningLows(timeline) {
  const sorted = timeline.slice().sort((a, b) =>
    a.localDate < b.localDate ? -1 : a.localDate > b.localDate ? 1 : 0);
  const lows = new Set();
  let min = Infinity;
  let lowest = null;
  sorted.forEach((e, i) => {
    if (e.weightKg < min) { // strictly lower than all prior (ties don't count)
      if (i > 0) lows.add(e.id); // first weigh-in is a baseline, never a ★
      min = e.weightKg;
      lowest = { value: e.weightKg, entryId: e.id };
    }
  });
  return { lows, lowest };
}

/** First official weigh-in (chronological) at or below `targetWeight`, or null. */
export function firstQualifying(timeline, targetWeight) {
  const sorted = timeline.slice().sort((a, b) =>
    a.localDate < b.localDate ? -1 : a.localDate > b.localDate ? 1 : 0);
  for (const e of sorted) if (e.weightKg <= targetWeight) return e;
  return null;
}

/**
 * Build history rows for display: each official entry with its delta vs the
 * previous official. Returned newest-first for a top-down history list.
 */
export function officialHistoryRows(entries) {
  const timeline = officialTimeline(entries);
  const rows = timeline.map((e, i) => ({
    entry: e,
    delta: i > 0 ? e.weightKg - timeline[i - 1].weightKg : null,
    previous: i > 0 ? timeline[i - 1] : null,
  }));
  return rows.reverse(); // newest first
}
