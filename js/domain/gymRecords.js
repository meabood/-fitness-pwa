// gymRecords.js — PURE dynamic personal-record engine (no DB, no DOM).
//
// Records are DERIVED from the factual working sets of ONE permanent exercise id
// and recomputed on every change — never stored as authoritative flags. Rules:
//  - Only WORKING sets count (warm-ups excluded).
//  - Weight PR: a working set heavier than every valid prior working set of the
//    same exercise, compared WITHIN THE SAME UNIT (never kg vs lb).
//  - Rep PR at exact weight: more reps than any prior working set at that exact
//    (unit, weight). Keyed by a stable unit:milliUnits key (never a raw float).
//  - "At the moment entered" semantics: chronological replay flags each set that
//    beat the history that existed before it. Within a session, set 2 superseding
//    set 1 both count when entered; the current best is simply the strongest.
//  - Same exercise only: callers pass sets for a single exercise id; ids are
//    never mixed here.

import { weightKey } from '../core/num.js';

/**
 * Chronological order for a set, defined by the FACTUAL session timeline rather
 * than the database write time of the set. Callers join each set with its
 * session and attach: sessionDate (localDate), sessionStart (startTime, "HH:mm"),
 * and sessionSeq (a stable numeric tiebreaker, e.g. the session's createdAt, used
 * ONLY when date+start are equal). Within a session, set.order decides sequence.
 * Falls back to the set's own localDate when session fields are absent.
 */
export function chronological(a, b) {
  const ad = a.sessionDate ?? a.localDate, bd = b.sessionDate ?? b.localDate;
  if (ad !== bd) return ad < bd ? -1 : 1;
  const as = a.sessionStart ?? '', bs = b.sessionStart ?? '';
  if (as !== bs) return as < bs ? -1 : 1;
  const aq = a.sessionSeq ?? 0, bq = b.sessionSeq ?? 0;
  if (aq !== bq) return aq - bq;
  return (a.order || 0) - (b.order || 0);
}

/**
 * Compute records for one exercise's sets.
 * @returns {{
 *   setFlags: Map<string,{weightPR:boolean, repPR:boolean}>,  // per working set, as of when entered
 *   maxWeightByUnit: Map<string,number>,                       // current best working weight per unit
 *   bestRepsByWeight: Map<string,{reps:number, weight:number, unit:string}>  // key = weightKey(weight,unit)
 * }}
 */
export function computeExerciseRecords(sets) {
  const working = sets.filter((s) => s.setType === 'working').slice().sort(chronological);
  const setFlags = new Map();
  const maxWeightByUnit = new Map();
  const bestRepsByWeight = new Map();

  for (const s of working) {
    const w = Number(s.weight), unit = s.unit, reps = Number(s.reps);
    let weightPR = false, repPR = false;

    // Weight PR only when a prior working set exists in the SAME unit and this is
    // strictly heavier. The first working set in a unit is a baseline (no ★),
    // but it still sets the running max.
    const hasPriorUnit = maxWeightByUnit.has(unit);
    const curMax = hasPriorUnit ? maxWeightByUnit.get(unit) : -Infinity;
    if (hasPriorUnit && w > curMax) weightPR = true;
    maxWeightByUnit.set(unit, hasPriorUnit ? Math.max(curMax, w) : w);

    // Rep PR only when a prior set exists at this exact (unit, weight) and this
    // has strictly more reps. The first set at a given weight is a baseline.
    const key = weightKey(w, unit);
    const hadKey = bestRepsByWeight.has(key);
    const prevBest = hadKey ? bestRepsByWeight.get(key).reps : 0;
    if (hadKey && reps > prevBest) repPR = true;
    if (!hadKey || reps > prevBest) bestRepsByWeight.set(key, { reps, weight: w, unit });

    setFlags.set(s.id, { weightPR, repPR });
  }
  return { setFlags, maxWeightByUnit, bestRepsByWeight };
}

/** Best reps-by-weight as a sorted array (desc by weight) for a detail view. */
export function bestRepsByWeightList(sets) {
  const { bestRepsByWeight } = computeExerciseRecords(sets);
  return [...bestRepsByWeight.values()].sort((a, b) => b.weight - a.weight);
}

/**
 * Genuine achievements contributed BY a given session.
 * @param {Map<string, Array>} setsByExercise  exerciseId -> all sets for that exercise
 * @param {string} sessionId
 * @returns {Array<{exerciseId, type:'weight'|'rep', weight:number, unit:string, reps?:number}>}
 */
export function sessionAchievements(setsByExercise, sessionId) {
  const out = [];
  for (const [exerciseId, sets] of setsByExercise) {
    const { setFlags } = computeExerciseRecords(sets);
    let weightPR = null;              // strongest weight PR set from this session
    const repPRs = new Map();         // weightKey -> best {reps, weight, unit}
    for (const s of sets) {
      if (s.sessionId !== sessionId) continue;
      const f = setFlags.get(s.id);
      if (!f) continue;
      if (f.weightPR && (!weightPR || Number(s.weight) > Number(weightPR.weight))) {
        weightPR = { weight: Number(s.weight), unit: s.unit };
      }
      if (f.repPR) {
        const k = weightKey(s.weight, s.unit);
        const cur = repPRs.get(k);
        if (!cur || Number(s.reps) > cur.reps) repPRs.set(k, { reps: Number(s.reps), weight: Number(s.weight), unit: s.unit });
      }
    }
    if (weightPR) out.push({ exerciseId, type: 'weight', weight: weightPR.weight, unit: weightPR.unit });
    for (const v of repPRs.values()) out.push({ exerciseId, type: 'rep', weight: v.weight, unit: v.unit, reps: v.reps });
  }
  return out;
}
