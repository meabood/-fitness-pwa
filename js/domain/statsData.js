// domain/statsData.js — PURE transforms that turn raw records into chart series
// (no DB, no DOM). The critical rules live here so they can be tested:
//  - Missing nutrition days are GAPS (y = null), never fabricated zeros; a day
//    explicitly completed with no entries is a real 0.
//  - Weight plots only ACTUAL official weigh-ins (no fabricated points); the
//    7-day moving average and the target trajectory are separate series.
//  - Exercise series are per exercise id AND per unit — kg and lb are never mixed
//    or numerically compared.

import { addDays, compareDates } from '../core/dates.js';
import { dayTotals } from './nutritionStats.js';
import { movingAverage7, officialTimeline as toOfficialTimeline } from './weightStats.js';
import { buildAnchors, expectedWeightAt } from './trajectory.js';
import { workingOnly, workingUnit } from './workoutMemory.js';

/** Inclusive list of date strings from `from` to `to`. */
export function rangeDays(from, to) {
  const out = [];
  let d = from;
  while (compareDates(d, to) <= 0) { out.push(d); d = addDays(d, 1); }
  return out;
}

/** date -> index map for even x spacing across a range. */
export function dayIndex(days) {
  const m = new Map();
  days.forEach((d, i) => m.set(d, i));
  return m;
}

/**
 * Nutrition daily series over a range.
 * @param days       date list (range)
 * @param entriesByDate Map<date, entries[]>
 * @param completedSet  Set<date> of explicitly-completed days
 * @param targetAt      (date) => number|null  calorie target effective that day
 * @returns { calories:[{x,y}], protein:[{x,y}], calorieTarget:[{x,y}] }
 *          y is null for unlogged days (gap); a completed empty day is 0.
 */
export function nutritionSeries(days, entriesByDate, completedSet, targetAt) {
  const idx = dayIndex(days);
  const calories = [], protein = [], calorieTarget = [];
  for (const d of days) {
    const x = idx.get(d);
    const entries = entriesByDate.get(d) || [];
    const has = entries.length > 0;
    const completed = completedSet.has(d);
    if (has || completed) {
      const t = dayTotals(entries);
      calories.push({ x, y: t.calories });
      protein.push({ x, y: t.protein == null ? null : t.protein });
    } else {
      calories.push({ x, y: null });   // missing ≠ zero
      protein.push({ x, y: null });
    }
    const tgt = targetAt(d);
    calorieTarget.push({ x, y: tgt == null ? null : tgt });
  }
  return { calories, protein, calorieTarget };
}

/**
 * Weight series over a range: actual official points, 7-day MA at each official
 * date, and the target trajectory sampled per day.
 * @param days
 * @param entries      all weight entries (any)
 * @param plan         active goal plan or null
 * @param milestones   milestones for the plan (ordered)
 * @returns { actual:[{x,y}], ma:[{x,y}], trajectory:[{x,y|null}], milestones:[{x,y}] }
 */
export function weightSeries(days, entries, plan, milestones = []) {
  const idx = dayIndex(days);
  const inRange = (d) => idx.has(d);
  const timeline = toOfficialTimeline(entries); // official-per-date, chronological
  const actual = [];
  const ma = [];
  for (const e of timeline) {
    if (!inRange(e.localDate)) continue;
    const x = idx.get(e.localDate);
    actual.push({ x, y: e.weightKg });
    const m = movingAverage7(timeline.filter((t) => compareDates(t.localDate, e.localDate) <= 0), e.localDate);
    ma.push({ x, y: m.avg != null ? m.avg : null });
  }
  let trajectory = [];
  const milestoneMarks = [];
  if (plan) {
    const anchors = buildAnchors(plan, milestones);
    trajectory = days.map((d) => {
      const within = compareDates(d, plan.startDate) >= 0 && compareDates(d, plan.finalDate) <= 0;
      return { x: idx.get(d), y: within ? expectedWeightAt(anchors, d) : null };
    });
    for (const ms of milestones) {
      if (inRange(ms.targetDate)) milestoneMarks.push({ x: idx.get(ms.targetDate), y: ms.targetWeight });
    }
  }
  return { actual, ma, trajectory, milestones: milestoneMarks };
}

/**
 * Per-exercise progression for ONE unit: each SESSION's max working weight over
 * time, plus the units seen. Sets from other units are ignored (never mixed).
 * Sets must be session-enriched (sessionDate/sessionStart/sessionSeq).
 *
 * Two sessions on the SAME localDate are kept DISTINCT and ordered by the factual
 * session timeline (date → start → seq); the x position is the session's
 * sequential index so same-day sessions never collapse onto one point. Each point
 * carries { date, start } for friendly labelling.
 * @returns { unit, maxWeight:[{x,y,date,start}], units:string[] }
 */
export function exerciseUnitSeries(enrichedSets, unit) {
  const unitsSeen = [...new Set(workingOnly(enrichedSets).map((s) => s.unit))];
  const working = workingOnly(enrichedSets).filter((s) => s.unit === unit);
  const bySession = new Map();
  for (const s of working) {
    const key = s.sessionId;
    if (!bySession.has(key)) {
      bySession.set(key, { date: s.sessionDate ?? s.localDate, start: s.sessionStart ?? '', seq: s.sessionSeq ?? 0, max: Number(s.weight) });
    } else {
      bySession.get(key).max = Math.max(bySession.get(key).max, Number(s.weight));
    }
  }
  const rows = [...bySession.values()].sort((a, b) =>
    a.date !== b.date ? (a.date < b.date ? -1 : 1)
      : a.start !== b.start ? (a.start < b.start ? -1 : 1)
        : a.seq - b.seq);
  const maxWeight = rows.map((r, i) => ({ x: i, y: r.max, date: r.date, start: r.start }));
  return { unit, maxWeight, units: unitsSeen };
}

/** Whole-day offset between two date strings. */
export function dayOffset(from, to) {
  let n = 0, d = from;
  while (compareDates(d, to) < 0) { d = addDays(d, 1); n++; }
  return n;
}
