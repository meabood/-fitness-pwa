// domain/recovery.js — pure, testable reliability logic. No IO, no DOM. These
// helpers back the Reliability & Recovery UX: stale-workout detection, next-day
// suggestion, incomplete-finish detection, pause/duration math, reopen
// safeguards, and conservative typo/outlier checks. All thresholds are
// intentionally cautious so normal use never triggers a warning.

// A workout left open longer than this is almost certainly forgotten, not real.
export const STALE_WORKOUT_SEC = 6 * 3600;          // 6 hours
// Completed workouts older than this shouldn't be reopened as an ACTIVE session.
export const REOPEN_ACTIVE_MAX_SEC = 24 * 3600;     // 24 hours

/**
 * ── One coherent workout-duration model ──────────────────────────────────
 * A session banks factual ACTIVE seconds in `accumulatedSec` and, while a
 * segment is running, records `runningSince` (ms). `paused` and `completed`
 * stop the running segment. Effective duration is the banked seconds plus the
 * open running segment (only while active, unpaused, and running).
 *
 * This makes every state consistent and idle-gap-free:
 *  - resume-after-finish continues from the banked final duration (the gap
 *    between finishing and resuming is never counted),
 *  - a manual correction sets the banked seconds and keeps counting on top,
 *  - pause excludes paused time,
 *  - reload recomputes from the `runningSince` timestamp (no drift).
 *
 * Backward compatible: sessions created before this model (v0.13.0 and earlier,
 * which used createdAt + pausedAccumSec/pausedAt + durationSecOverride) are read
 * through the legacy branch until the next mutating action migrates them.
 */
export function elapsedSec(session, now = Date.now()) {
  if (!session) return 0;
  const hasNew = session.accumulatedSec != null || session.runningSince != null || session.paused != null;
  if (hasNew) {
    let s = Number(session.accumulatedSec) || 0;
    if (!session.completed && !session.paused && session.runningSince) s += (now - session.runningSince) / 1000;
    return Math.max(0, Math.round(s));
  }
  // ── Legacy fallback (pre-accumulator sessions) ──
  const pausedAccum = Number(session.pausedAccumSec || 0);
  if (session.completed) {
    // A completed workout must NEVER keep accumulating wall-clock time. Derive
    // the factual duration from persisted historical fields, never from now().
    // Priority: manual correction → completedAt → clock(endTime−startTime) →
    // updatedAt → 0 (unknown, but never growing).
    if (Number.isFinite(Number(session.durationSecOverride))) {
      return Math.max(0, Math.round(Number(session.durationSecOverride)));
    }
    const startMs = Number(session.createdAt);
    if (Number.isFinite(Number(session.completedAt)) && Number.isFinite(startMs)) {
      const s = (Number(session.completedAt) - startMs) / 1000 - pausedAccum;
      if (s >= 0) return Math.max(0, Math.round(s));
    }
    const clock = clockDurationSec(session.startTime, session.endTime);
    if (clock != null) return Math.max(0, Math.round(clock - pausedAccum));
    if (Number.isFinite(Number(session.updatedAt)) && Number.isFinite(startMs) && Number(session.updatedAt) >= startMs) {
      const s = (Number(session.updatedAt) - startMs) / 1000 - pausedAccum;
      if (s >= 0) return Math.max(0, Math.round(s));
    }
    return 0; // cannot determine — 0 is safe; wall-clock growth is not
  }
  // Active legacy session: still running, so wall time since start is correct.
  const start = session.createdAt || now;
  let s = (now - start) / 1000 - pausedAccum;
  if (session.pausedAt) s -= (now - session.pausedAt) / 1000;
  return Math.max(0, Math.round(s));
}

/** Duration in seconds between two local "HH:MM" clock strings, wrapping past
 * midnight. null when either is missing/unparseable. Used only as a legacy
 * fallback for completed sessions with no ms end timestamp. */
function clockDurationSec(startHHMM, endHHMM) {
  const parse = (t) => {
    if (typeof t !== 'string') return null;
    const m = t.match(/^(\d{1,2}):(\d{2})/);
    if (!m) return null;
    const h = Number(m[1]), mi = Number(m[2]);
    if (h > 23 || mi > 59) return null;
    return h * 3600 + mi * 60;
  };
  const a = parse(startHHMM), b = parse(endHHMM);
  if (a == null || b == null) return null;
  let d = b - a;
  if (d < 0) d += 24 * 3600; // crossed midnight
  return d;
}
/** Backward-compatible alias (existing callers import effectiveElapsedSec). */
export const effectiveElapsedSec = elapsedSec;

/** Is the session actively counting right now (running, not paused/completed)? */
export function isRunning(session) {
  return !!session && !session.completed && !session.paused && !!session.runningSince;
}
export function isPausedState(session) {
  // New model: explicit paused flag. Legacy: an open pausedAt on an active session.
  if (!session || session.completed) return false;
  if (session.paused != null || session.runningSince != null || session.accumulatedSec != null) return !!session.paused;
  return !!session.pausedAt;
}

// ── Pure transition patches (repo applies them; fully unit-testable) ──

/** Fields for a brand-new session using the accumulator model. */
export function startPatch(now = Date.now()) {
  return { accumulatedSec: 0, runningSince: now, paused: false, completed: false, completedAt: null, durationSecOverride: null, pausedAt: null, pausedAccumSec: 0 };
}
/** Pause an active running session: bank the open segment. */
export function pausePatch(session, now = Date.now()) {
  if (!session || session.completed || isPausedState(session)) return null;
  return { accumulatedSec: elapsedSec(session, now), runningSince: null, paused: true, pausedAt: null };
}
/** Resume from a pause: start a new running segment. */
export function resumePatch(session, now = Date.now()) {
  if (!session || session.completed || !isPausedState(session)) return null;
  return { paused: false, runningSince: now, pausedAt: null, pausedAccumSec: 0 };
}
/** Finish: bank the open segment as the factual final duration. */
export function finishPatch(session, now = Date.now()) {
  return { accumulatedSec: elapsedSec(session, now), runningSince: null, paused: false, completed: true, completedAt: now, durationSecOverride: null };
}
/**
 * Reopen a finished workout as the SAME active session. Continues from the
 * banked final duration; the idle gap between finishing and reopening is
 * excluded because a fresh running segment starts now. Any legacy
 * durationSecOverride is folded into accumulatedSec and cleared so it can never
 * overwrite the newly accumulated resumed time.
 */
export function reopenPatch(session, now = Date.now()) {
  return { accumulatedSec: elapsedSec(session, now), runningSince: now, paused: false, completed: false, completedAt: null, durationSecOverride: null };
}
/**
 * Manually correct the factual duration. Sets banked seconds to the value; if
 * the session is active and running, it keeps counting on top of the correction
 * (so the live timer reflects it immediately). Returns null for invalid input.
 */
export function setDurationPatch(session, seconds, now = Date.now()) {
  const sec = (seconds == null || seconds === '' || !Number.isFinite(Number(seconds)) || Number(seconds) < 0)
    ? null : Math.round(Number(seconds));
  if (sec == null) return null;
  const patch = { accumulatedSec: sec, durationSecOverride: null };
  if (session && !session.completed && !isPausedState(session)) patch.runningSince = now; // keep counting from the corrected base
  return patch;
}
/** Reset the duration model for an emptied session (e.g. wrong-day change). */
export function resetDurationPatch(now = Date.now()) {
  return { accumulatedSec: 0, runningSince: now, paused: false, completed: false, completedAt: null, durationSecOverride: null, pausedAt: null, pausedAccumSec: 0 };
}

/** Is an ACTIVE (not completed) session implausibly old? */
export function isStaleWorkout(session, now = Date.now(), thresholdSec = STALE_WORKOUT_SEC) {
  if (!session || session.completed) return false;
  return elapsedSec(session, now) > thresholdSec;
}

/** May a completed session be reopened as an active session (vs history-only)? */
export function canReopenAsActive(session, now = Date.now(), maxSec = REOPEN_ACTIVE_MAX_SEC) {
  if (!session || !session.completed) return true; // already active
  const end = session.completedAt || session.updatedAt || session.createdAt || now;
  return (now - end) / 1000 <= maxSec;
}

/**
 * Suggest the next routine day from completed history: the day AFTER the most
 * recently performed one, in routine order (wrapping). When routineId is given,
 * ONLY that routine's completed sessions are considered, so a workout logged
 * under a different routine can't confuse the recommendation. Returns a day
 * object or null when history is absent/ambiguous (never invents a suggestion).
 * @param days ordered [{ id, name }]
 * @param recentSessions newest-first sessions (each may have routineId, routineDayId, completed)
 * @param routineId optional active-routine filter
 */
export function suggestNextDay(days, recentSessions, routineId = null) {
  if (!Array.isArray(days) || days.length === 0) return null;
  const pool = routineId ? (recentSessions || []).filter((s) => s && s.routineId === routineId) : (recentSessions || []);
  const last = pool.find((s) => s && s.completed && s.routineDayId);
  if (!last) return null;
  const idx = days.findIndex((d) => d.id === last.routineDayId);
  if (idx < 0) return null;                 // last day not in this routine → ambiguous
  return days[(idx + 1) % days.length];
}

/** The most recently completed day's id (optionally within one routine). */
export function lastPerformedDayId(recentSessions, routineId = null) {
  const pool = routineId ? (recentSessions || []).filter((s) => s && s.routineId === routineId) : (recentSessions || []);
  const last = pool.find((s) => s && s.completed && s.routineDayId);
  return last ? last.routineDayId : null;
}

/**
 * The correct factual reference weight for a typo check on an entry dated
 * `forDate` (optionally at `beforeTime` "HH:MM"): the nearest measurement
 * strictly BEFORE that point in time, preferring the official one when tied.
 * Supports multiple measurements on the SAME date when time ordering exists
 * (e.g. an 08:00 reading is the reference for a 20:00 entry). Excludes
 * `excludeId` (the entry being edited). Never returns a future/later record.
 * null when there is no prior history.
 * @param entries array of { id, localDate, time, weightKg, isOfficial }
 * @param forDate  "YYYY-MM-DD" of the new/edited entry
 * @param excludeId id to exclude (the edited entry)
 * @param beforeTime optional "HH:MM" of the new/edited entry, for same-day ordering
 */
export function referenceWeightBefore(entries, forDate, excludeId = null, beforeTime = null) {
  if (!Array.isArray(entries) || !forDate) return null;
  const key = (e) => `${e.localDate}T${String(e.time || '')}`;
  const cutoff = beforeTime != null ? `${forDate}T${beforeTime}` : null;
  const prior = entries.filter((e) => {
    if (!e || e.id === excludeId || !e.localDate) return false;
    if (e.localDate < forDate) return true;                 // any earlier date
    if (e.localDate === forDate) {
      // same date: include only when we can establish it came strictly before
      if (cutoff == null) return false;                     // no ordering info → don't guess
      return key(e) < cutoff;
    }
    return false;                                           // future date → never
  });
  if (!prior.length) return null;
  // pick the latest by (localDate, time); on a tie prefer official
  let best = null;
  for (const e of prior) {
    if (!best) { best = e; continue; }
    const ek = key(e), bk = key(best);
    if (ek > bk) { best = e; continue; }
    if (ek === bk) {
      const eOff = e.isOfficial ? 1 : 0, bOff = best.isOfficial ? 1 : 0;
      if (eOff > bOff) best = e;
    }
  }
  return best ? best.weightKg : null;
}

/** True when a planned workout has exercises but ZERO working sets logged
 * (the "nothing logged yet" finish confirmation, distinct from partial gaps). */
export function isEmptyWorkout(plannedExercises, sets) {
  const hasPlan = Array.isArray(plannedExercises) && plannedExercises.length > 0;
  const anyWorking = (sets || []).some((s) => s.setType === 'working');
  return hasPlan && !anyWorking;
}

/**
 * Which planned exercises have NO completed working set yet. Used to warn before
 * an accidental finish. Warm-up-only exercises count as incomplete. Does not
 * require every set — just at least one working set per planned exercise.
 */
export function incompleteExercises(plannedExercises, sets) {
  const planned = Array.isArray(plannedExercises) ? plannedExercises : [];
  const working = new Set(
    (sets || []).filter((s) => s.setType === 'working').map((s) => s.exerciseId),
  );
  return planned.filter((p) => !working.has(p.exerciseId));
}

/** Does the session look unfinished enough to confirm before finishing? True only
 * when there is at least one logged working set AND at least one planned exercise
 * still has none (avoids nagging on an empty or a reasonably complete workout). */
export function looksIncompleteForFinish(plannedExercises, sets) {
  const anyWorking = (sets || []).some((s) => s.setType === 'working');
  if (!anyWorking) return false;                 // nothing logged → not a "left work" situation
  return incompleteExercises(plannedExercises, sets).length > 0;
}

// ── Typo / outlier protection (soft; never blocks explicit confirmation) ──

/** Body-weight typo check vs the most recent recorded weight. Conservative:
 * flags a single-entry jump beyond max(7 kg, 6% of recent). */
export function isWeightOutlier(recentKg, enteredKg) {
  const r = Number(recentKg), e = Number(enteredKg);
  if (!Number.isFinite(r) || !Number.isFinite(e) || r <= 0) return false;
  const band = Math.max(7, r * 0.06);
  return Math.abs(e - r) > band;
}

/** Exercise-load typo check vs last performance (same unit). Conservative:
 * flags only a big multiplicative jump (≥2×) that is also ≥20 units larger,
 * so normal progressive overload never warns. */
export function isLoadOutlier(lastLoad, enteredLoad) {
  const l = Number(lastLoad), e = Number(enteredLoad);
  if (!Number.isFinite(l) || !Number.isFinite(e) || l <= 0) return false;
  return e >= l * 2 && (e - l) >= 20;
}
