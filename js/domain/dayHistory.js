// domain/dayHistory.js — pure aggregation of factual history by local date.
// No DOM, no IO. Consumes raw records (already fetched via bounded localDate
// queries) and produces indicators, a Day Summary, and a history list.
//
// Principles:
//  - An indicator means DATA EXISTS for that date — never goal/adherence.
//  - Unknown protein stays unknown (null), never silently 0.
//  - Duration is taken from the caller (the authoritative elapsedSec), not
//    recomputed here.
//  - Grouping is purely by the record's own localDate string (no UTC).

/** Set of localDate strings that have ≥1 record, from an array with .localDate. */
export function datesWithData(records) {
  const s = new Set();
  for (const r of (records || [])) if (r && r.localDate) s.add(r.localDate);
  return s;
}

/**
 * Per-day indicator flags for a month.
 * @param dates array of "YYYY-MM-DD" in the month (the in-month cells)
 * @param sets  { nutrition:Set, workout:Set, weight:Set } of dates-with-data
 * @returns Map date -> { nutrition, workout, weight }
 */
export function monthIndicators(dates, sets) {
  const out = new Map();
  const N = sets.nutrition || new Set(), W = sets.workout || new Set(), B = sets.weight || new Set();
  for (const d of dates) out.set(d, { nutrition: N.has(d), workout: W.has(d), weight: B.has(d) });
  return out;
}

/** Nutrition totals for a date. Unknown protein is preserved as null unless at
 * least one entry has a known protein (then it sums the known ones). */
export function nutritionSummary(entries) {
  const list = entries || [];
  if (!list.length) return null;
  let kcal = 0, protein = 0, anyProtein = false;
  for (const e of list) {
    kcal += Number(e.finalCalories) || 0;
    if (e.finalProtein != null && Number.isFinite(Number(e.finalProtein))) { protein += Number(e.finalProtein); anyProtein = true; }
  }
  return { calories: Math.round(kcal), protein: anyProtein ? Math.round(protein) : null, entryCount: list.length };
}

/**
 * Workout summaries for a date — one per session (multiple are all shown).
 * @param sessions array of session records for the date
 * @param setsBySession Map sessionId -> array of set records
 * @param durationOf function(session) -> seconds (authoritative elapsedSec)
 */
export function workoutSummaries(sessions, setsBySession, durationOf) {
  return (sessions || []).map((s) => {
    const sets = (setsBySession && setsBySession.get(s.id)) || [];
    const working = sets.filter((x) => x.setType === 'working').length;
    const exercises = new Set(sets.map((x) => x.exerciseId)).size;
    return {
      id: s.id,
      name: s.routineDayNameSnapshot || s.routineNameSnapshot || 'تمرين حر',
      durationSec: durationOf ? durationOf(s) : 0,
      exerciseCount: exercises,
      workingSetCount: working,
      completed: !!s.completed,
    };
  });
}

/** Body-weight summary for a date: the official measurement (if any) plus a
 * count of additional measurements. Never collapses multiple into one silently. */
export function weightSummary(entries) {
  const list = entries || [];
  if (!list.length) return null;
  const official = list.find((e) => e.isOfficial === 1) || null;
  const shown = official || list[0];
  return {
    weightKg: shown ? shown.weightKg : null,
    isOfficial: !!official,
    total: list.length,
    others: Math.max(0, list.length - 1),
  };
}

/** Does a day have any factual data at all? */
export function dayHasData(summary) {
  return !!(summary && (summary.nutrition || (summary.workouts && summary.workouts.length) || summary.weight));
}

/**
 * Build the full history list: one row per date that has any data, newest
 * first. Input maps are date -> domain summary (already aggregated).
 * @returns array of { date, nutrition, workouts, weight } sorted desc by date
 */
export function historyList({ nutritionByDate, workoutsByDate, weightByDate }) {
  const dates = new Set([
    ...Object.keys(nutritionByDate || {}),
    ...Object.keys(workoutsByDate || {}),
    ...Object.keys(weightByDate || {}),
  ]);
  const rows = [];
  for (const date of dates) {
    rows.push({
      date,
      nutrition: (nutritionByDate && nutritionByDate[date]) || null,
      workouts: (workoutsByDate && workoutsByDate[date]) || [],
      weight: (weightByDate && weightByDate[date]) || null,
    });
  }
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // newest first
  return rows;
}
