// data/history.repo.js — read-only aggregation for the calendar-first history
// UX. Composes bounded localDate queries across nutrition, workouts, and weight
// with the pure helpers in domain/dayHistory.js. No new stores, no writes.
//
// Performance: a month is aggregated with a fixed, small number of bounded index
// queries (nutrition range, weight range, session range) — never one scan per
// calendar cell. The Day Summary fetches only the selected date. Set lookups for
// a day are per-session (already the app's pattern), only for that day's sessions.

import { getEntriesInRange as nutritionInRange, getEntriesForDate as nutritionForDate } from './nutrition.repo.js';
import { getEntriesInRange as weightInRange, getEntriesForDate as weightForDate } from './weight.repo.js';
import { getSessionsInRange, getSessionsForDate, getSetsForSession } from './workouts.repo.js';
import { getAll } from '../core/db.js';
import { effectiveElapsedSec } from '../domain/recovery.js';
import {
  datesWithData, monthIndicators, nutritionSummary, workoutSummaries, weightSummary, historyList,
} from '../domain/dayHistory.js';
import { monthBounds } from '../domain/calendar.js';

/**
 * Indicator flags for every in-month day. Three bounded queries total.
 * @returns Map "YYYY-MM-DD" -> { nutrition, workout, weight }
 */
export async function getMonthIndicators(year, month0, inMonthDates) {
  const { from, to } = monthBounds(year, month0);
  const [nut, ses, wgt] = await Promise.all([
    nutritionInRange(from, to),
    getSessionsInRange(from, to),
    weightInRange(from, to),
  ]);
  return monthIndicators(inMonthDates, {
    nutrition: datesWithData(nut),
    workout: datesWithData(ses),
    weight: datesWithData(wgt),
  });
}

/**
 * Unified Day Summary for a single local date. Fetches only that date's records
 * (plus that date's session sets). Returns { date, nutrition, workouts, weight }
 * where each domain is null/[] when absent.
 */
export async function getDaySummary(date) {
  const [entries, sessions, weights] = await Promise.all([
    nutritionForDate(date),
    getSessionsForDate(date),
    weightForDate(date),
  ]);
  const setsBySession = new Map();
  await Promise.all(sessions.map(async (s) => { setsBySession.set(s.id, await getSetsForSession(s.id)); }));
  return {
    date,
    nutrition: nutritionSummary(entries),
    workouts: workoutSummaries(sessions, setsBySession, (s) => effectiveElapsedSec(s)),
    weight: weightSummary(weights),
  };
}

/**
 * Full chronological history: every date with any factual data, newest first.
 * One pass per domain (not per date), so it scales without an arbitrary limit.
 * Rows carry light summaries for display; tapping opens the same Day Summary.
 */
export async function getHistoryList() {
  const [allEntries, allSessions, allWeights] = await Promise.all([
    getAll('nutritionEntries'),
    getAll('workoutSessions'),
    getAll('weightEntries'),
  ]);

  const nutritionByDate = {};
  const byDateEntries = groupBy(allEntries, 'localDate');
  for (const [date, list] of byDateEntries) nutritionByDate[date] = nutritionSummary(list);

  const setsBySession = new Map();
  // Only sessions that exist are fetched; sets are grouped from a single pass.
  const allSets = await getAll('workoutSets');
  for (const st of allSets) {
    if (!setsBySession.has(st.sessionId)) setsBySession.set(st.sessionId, []);
    setsBySession.get(st.sessionId).push(st);
  }
  const workoutsByDate = {};
  const byDateSessions = groupBy(allSessions, 'localDate');
  for (const [date, list] of byDateSessions) {
    workoutsByDate[date] = workoutSummaries(list, setsBySession, (s) => effectiveElapsedSec(s));
  }

  const weightByDate = {};
  const byDateWeights = groupBy(allWeights, 'localDate');
  for (const [date, list] of byDateWeights) weightByDate[date] = weightSummary(list);

  return historyList({ nutritionByDate, workoutsByDate, weightByDate });
}

function groupBy(rows, key) {
  const m = new Map();
  for (const r of (rows || [])) {
    const k = r && r[key];
    if (!k) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}
