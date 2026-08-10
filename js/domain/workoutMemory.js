// workoutMemory.js — PURE derivations for exercise memory (no DB, no DOM).
// Given all sets for ONE permanent exercise id, compute the most recent prior
// working performance. This is what makes an exercise "resume from history" even
// after being removed from every routine and later re-added — the id carries it.

/** Group sets by their sessionId. */
export function bySessionGroups(sets) {
  const m = new Map();
  for (const s of sets) {
    if (!m.has(s.sessionId)) m.set(s.sessionId, []);
    m.get(s.sessionId).push(s);
  }
  return m;
}

export function workingOnly(sets) {
  return sets.filter((s) => s.setType === 'working');
}

/** The common unit among working sets, or null if there are none / units are mixed. */
export function workingUnit(sets) {
  const w = workingOnly(sets);
  if (!w.length) return null;
  const u = w[0].unit;
  return w.every((s) => s.unit === u) ? u : null;
}

/**
 * Max working weight across the given sets. Unit-safe: returns null if there are
 * no working sets OR if working sets have mixed units (never Math.max across
 * kg/lb). Callers needing a numeric max must ensure a single unit.
 */
export function maxWorkingWeight(sets) {
  const w = workingOnly(sets);
  if (!w.length) return null;
  if (workingUnit(sets) === null) return null; // mixed units → not comparable
  return Math.max(...w.map((s) => Number(s.weight)));
}

const bySetOrder = (a, b) => (a.order || 0) - (b.order || 0);

/** Lexicographic compare of session timeline keys (date, start, seq). */
function cmpSessionKey(d1, s1, q1, d2, s2, q2) {
  if (d1 !== d2) return d1 < d2 ? -1 : 1;
  if (s1 !== s2) return s1 < s2 ? -1 : 1;
  if (q1 !== q2) return q1 - q2;
  return 0;
}

/**
 * Most recent PRIOR working performance for an exercise, strictly before the
 * current session on the FACTUAL session timeline (session localDate, then
 * startTime, then a stable seq tiebreaker) — never the database write time.
 * Sets must be joined with their session (sessionDate/sessionStart/sessionSeq).
 * @param {Array} sets  all sets for one exercise id (session-enriched)
 * @param {object} [opts]
 *   excludeSessionId  the current session (always excluded)
 *   asOf              { localDate, startTime, seq } of the current session; only
 *                     sessions strictly earlier on the timeline qualify. Omit for
 *                     the "latest overall" view (exercise detail).
 * @returns {null | { sessionId, date, workingSets, unit, workingWeight, mixedUnits }}
 */
export function lastPerformance(sets, { excludeSessionId = null, asOf = null } = {}) {
  const groups = [...bySessionGroups(sets).entries()]
    .map(([sessionId, ss]) => ({
      sessionId,
      date: ss[0].sessionDate ?? ss[0].localDate,
      start: ss[0].sessionStart ?? '',
      seq: ss[0].sessionSeq ?? 0,
      sets: ss.slice().sort(bySetOrder),
    }))
    .filter((g) => g.sessionId !== excludeSessionId && g.sets.some((s) => s.setType === 'working'))
    .filter((g) => {
      if (!asOf) return true;
      return cmpSessionKey(g.date, g.start, g.seq, asOf.localDate, asOf.startTime ?? '', asOf.seq ?? Infinity) < 0;
    });
  if (!groups.length) return null;
  groups.sort((a, b) => -cmpSessionKey(a.date, a.start, a.seq, b.date, b.start, b.seq)); // most recent first
  const g = groups[0];
  const ws = workingOnly(g.sets);
  const unit = workingUnit(g.sets); // null if mixed
  const workingWeight = unit === null ? null : Math.max(...ws.map((s) => Number(s.weight)));
  return { sessionId: g.sessionId, date: g.date, workingSets: ws, unit, workingWeight, mixedUnits: unit === null };
}
