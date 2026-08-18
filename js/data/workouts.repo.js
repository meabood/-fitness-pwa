// workouts.repo.js — workout sessions + sets.
//
// A session snapshots its routine/day names and the planned exercise list at
// start, so later routine edits never rewrite history. Each set snapshots its
// unit from the exercise and denormalizes the session's localDate (indexed by
// [exerciseId, localDate] for fast per-exercise history / memory). Changing a
// session's date cascades to its sets in one transaction. Raw sets are the
// authoritative record — "what exercises a session had" = the exercise ids of
// its sets, independent of any routine.

import { getAll, getAllByIndex, get, put, del, tx, reqAsPromise } from '../core/db.js';
import { uuid } from '../core/ids.js';
import { now, todayLocal, toLocalTime } from '../core/dates.js';
import { emit } from '../core/events.js';
import { getRoutine, getDays, getDayExercises } from './routines.repo.js';
import { getExercise } from './exercises.repo.js';
import { lastPerformance } from '../domain/workoutMemory.js';
import { computeExerciseRecords, sessionAchievements } from '../domain/gymRecords.js';
import { startPatch, finishPatch, reopenPatch, pausePatch, resumePatch, setDurationPatch, resetDurationPatch } from '../domain/recovery.js';

const SESSIONS = 'workoutSessions';
const SETS = 'workoutSets';
const clean = (v) => String(v ?? '').trim();
const byOrder = (a, b) => (a.order - b.order) || ((a.createdAt || 0) - (b.createdAt || 0));

/** Error thrown when the one-active-workout invariant would be violated. The
 * caller (UI) catches it and surfaces the existing session instead of creating
 * a second one. */
export class ActiveSessionExistsError extends Error {
  constructor(sessionId) { super('active session exists'); this.name = 'ActiveSessionExistsError'; this.sessionId = sessionId; }
}

/** The single active (incomplete) session, or null. Enforced app-wide so Home,
 * Workout Hub, Start Workout, day changes, and reload all agree. */
export async function getActiveSession() {
  const all = await getAll(SESSIONS);
  const active = all.filter((s) => !s.completed);
  if (!active.length) return null;
  // Deterministic: the most recently created open session.
  active.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return active[0];
}

/** ALL active (incomplete) sessions, newest first. Normally 0 or 1; used to
 * detect a legacy-invalid multi-active state so the UI can offer resolution
 * without silently deleting or finishing anything. */
export async function getAllActiveSessions() {
  const all = await getAll(SESSIONS);
  return all.filter((s) => !s.completed).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

// ---- validation ----
export function validateSet({ weight, reps, setType, rir }) {
  const errors = [];
  const w = Number(weight);
  if (!Number.isFinite(w) || w < 0) errors.push('الوزن يجب أن يكون رقمًا صفرًا أو أكبر.');
  const r = Number(reps);
  if (!Number.isInteger(r) || r < 1) errors.push('التكرارات يجب أن تكون عددًا صحيحًا 1 أو أكبر.');
  if (setType && !['warmup', 'working'].includes(setType)) errors.push('نوع المجموعة غير صالح.');
  if (rir != null && rir !== '' && (!Number.isFinite(Number(rir)) || Number(rir) < 0)) errors.push('RIR غير صالح.');
  return errors;
}

// ---- sessions ----
async function snapshotPlanned(routineDayId) {
  const rexs = await getDayExercises(routineDayId);
  const planned = [];
  for (const rx of rexs) {
    const ex = await getExercise(rx.exerciseId);
    planned.push({
      exerciseId: rx.exerciseId,
      nameSnapshot: ex ? ex.name : 'تمرين',
      note: rx.note || '',
      // rest overrides captured at start (null → use global default at logging time)
      restBetweenSets: rx.restBetweenSets ?? null,
      restAfterExercise: rx.restAfterExercise ?? null,
    });
  }
  return planned;
}

/**
 * Start a session from a routine day (snapshots routine/day names + planned
 * exercises), or ad-hoc when routineId/dayId are omitted.
 */
export async function startSession({ routineId = null, routineDayId = null, localDate, allowSecond = false } = {}) {
  // One-active-workout invariant (enforced at the repo boundary). The UI passes
  // allowSecond=false; if an active session already exists we refuse and let the
  // caller surface it instead of silently creating a second active workout.
  if (!allowSecond) {
    const existing = await getActiveSession();
    if (existing) throw new ActiveSessionExistsError(existing.id);
  }
  const ts = now();
  let routineNameSnapshot = '', routineDayNameSnapshot = '', plannedExercises = [];
  if (routineId && routineDayId) {
    const routine = await getRoutine(routineId);
    const days = await getDays(routineId);
    const day = days.find((d) => d.id === routineDayId);
    routineNameSnapshot = routine ? routine.name : '';
    routineDayNameSnapshot = day ? day.name : '';
    plannedExercises = await snapshotPlanned(routineDayId);
  }
  const session = {
    id: uuid(),
    localDate: localDate || todayLocal(),
    startTime: toLocalTime(),
    endTime: null,
    routineId, routineNameSnapshot,
    routineDayId, routineDayNameSnapshot,
    plannedExercises,           // snapshot for the logging screen + historical "planned"
    notes: '',
    completed: false,
    createdAt: ts, updatedAt: ts,
    ...startPatch(ts),          // accumulator duration model (accumulatedSec/runningSince/paused)
  };
  await put(SESSIONS, session);
  emit('workout:changed', {});
  return session.id;
}

export const getSession = (id) => get(SESSIONS, id);
export const getAllSessions = () => getAll(SESSIONS);
export async function getSessionsForDate(localDate) {
  return getAllByIndex(SESSIONS, 'localDate', IDBKeyRange.only(localDate));
}

/** All sessions whose localDate is within [from,to] (bounded index scan). */
export async function getSessionsInRange(from, to) {
  return getAllByIndex(SESSIONS, 'localDate', IDBKeyRange.bound(from, to));
}
export async function getRecentSessions(limit = 20) {
  const all = await getAll(SESSIONS);
  all.sort((a, b) => (a.localDate < b.localDate ? 1 : a.localDate > b.localDate ? -1 : (b.createdAt - a.createdAt)));
  return all.slice(0, limit);
}

/** Distinct exercise ids used most recently (from recent sessions' sets),
 * most-recent first. Used by the picker to surface "الأخيرة". Factual only —
 * empty when there is no workout history yet. */
export async function getRecentExerciseIds(limit = 12) {
  const sessions = await getRecentSessions(30);
  const seen = new Set();
  const out = [];
  for (const s of sessions) {
    const sets = await getSetsForSession(s.id);
    sets.sort((a, b) => (a.order || 0) - (b.order || 0));
    for (const set of sets) {
      if (!seen.has(set.exerciseId)) { seen.add(set.exerciseId); out.push(set.exerciseId); }
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** Append an exercise to a session's planned list (ad-hoc add during logging). */
export async function addExerciseToSession(sessionId, exerciseId) {
  const s = await get(SESSIONS, sessionId); if (!s) return;
  s.plannedExercises = s.plannedExercises || [];
  if (!s.plannedExercises.some((p) => p.exerciseId === exerciseId)) {
    const ex = await getExercise(exerciseId);
    s.plannedExercises.push({ exerciseId, nameSnapshot: ex ? ex.name : 'تمرين', note: '' });
    s.updatedAt = now();
    await put(SESSIONS, s);
    emit('workout:changed', { exerciseId });
  }
}

/** Set the per-exercise note within THIS session (planned-exercise note). Does
 * not touch historical set snapshots or the routine. */
export async function setSessionExerciseNote(sessionId, exerciseId, note) {
  const s = await get(SESSIONS, sessionId); if (!s) return;
  s.plannedExercises = s.plannedExercises || [];
  const entry = s.plannedExercises.find((p) => p.exerciseId === exerciseId);
  if (entry) { entry.note = String(note ?? ''); s.updatedAt = now(); await put(SESSIONS, s); emit('workout:changed', { exerciseId }); }
}

/** Remove an exercise from THIS session: deletes only this session's sets for it
 * (other sessions/history untouched) and drops it from the planned list. */
export async function removeExerciseFromSession(sessionId, exerciseId) {
  const sets = await getSetsForSessionExercise(sessionId, exerciseId);
  const removedSets = sets.map((s) => ({ ...s }));   // snapshot for undo
  for (const st of sets) await del(SETS, st.id);
  let removedPlanned = null, removedIndex = -1;
  const s = await get(SESSIONS, sessionId);
  if (s) {
    s.plannedExercises = s.plannedExercises || [];
    removedIndex = s.plannedExercises.findIndex((p) => p.exerciseId === exerciseId);
    if (removedIndex >= 0) removedPlanned = { ...s.plannedExercises[removedIndex] };
    s.plannedExercises = s.plannedExercises.filter((p) => p.exerciseId !== exerciseId);
    s.updatedAt = now();
    await put(SESSIONS, s);
  }
  emit('workout:changed', { exerciseId });
  return { planned: removedPlanned, index: removedIndex, sets: removedSets }; // for undo
}

/** Undo removeExerciseFromSession: restore the planned entry (at its old spot)
 * and re-insert its exact sets (same ids). Session-scoped; routine untouched. */
export async function restoreExerciseToSession(sessionId, removed) {
  if (!removed) return;
  const s = await get(SESSIONS, sessionId);
  if (s) {
    s.plannedExercises = s.plannedExercises || [];
    if (removed.planned && !s.plannedExercises.some((p) => p.exerciseId === removed.planned.exerciseId)) {
      const at = removed.index >= 0 && removed.index <= s.plannedExercises.length ? removed.index : s.plannedExercises.length;
      s.plannedExercises.splice(at, 0, removed.planned);
    }
    s.updatedAt = now();
    await put(SESSIONS, s);
  }
  for (const st of (removed.sets || [])) await put(SETS, { ...st });
  emit('workout:changed', {});
}

/** Swap an exercise for another within THIS session. Any sets already logged for
 * the old exercise are reassigned to the new one (unit re-snapshotted per set via
 * updateSet), and the planned entry is replaced (keeping its note). History for
 * OTHER sessions is untouched; sets keep their ids. */
export async function swapExerciseInSession(sessionId, oldExerciseId, newExerciseId) {
  if (oldExerciseId === newExerciseId) return;
  const sets = await getSetsForSessionExercise(sessionId, oldExerciseId);
  for (const st of sets) await updateSet(st.id, { exerciseId: newExerciseId });
  const s = await get(SESSIONS, sessionId);
  if (s) {
    s.plannedExercises = s.plannedExercises || [];
    const newEx = await getExercise(newExerciseId);
    const idx = s.plannedExercises.findIndex((p) => p.exerciseId === oldExerciseId);
    const slot = idx >= 0 ? s.plannedExercises[idx] : null;
    const note = slot ? slot.note : '';
    // The replacement occupies the SAME execution slot, so it inherits the
    // slot's rest configuration unless explicitly changed later (item 14).
    const entry = {
      exerciseId: newExerciseId,
      nameSnapshot: newEx ? newEx.name : 'تمرين',
      note,
      restBetweenSets: slot ? (slot.restBetweenSets ?? null) : null,
      restAfterExercise: slot ? (slot.restAfterExercise ?? null) : null,
    };
    // avoid duplicate planned entry if the new exercise was already present
    const existingNewIdx = s.plannedExercises.findIndex((p) => p.exerciseId === newExerciseId);
    if (idx >= 0) {
      s.plannedExercises.splice(idx, 1, entry);
      if (existingNewIdx >= 0 && existingNewIdx !== idx) {
        s.plannedExercises = s.plannedExercises.filter((p, i) => !(p.exerciseId === newExerciseId && i !== idx));
      }
    } else if (existingNewIdx < 0) {
      s.plannedExercises.push(entry);
    }
    s.updatedAt = now();
    await put(SESSIONS, s);
  }
  emit('workout:changed', { exerciseId: newExerciseId });
}

/** Reorder an exercise within THIS session's planned list (up/down). */
export async function moveExerciseInSession(sessionId, exerciseId, dir) {
  const s = await get(SESSIONS, sessionId); if (!s) return;
  const arr = s.plannedExercises || [];
  const i = arr.findIndex((p) => p.exerciseId === exerciseId);
  if (i < 0) return;
  const j = dir === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  s.plannedExercises = arr;
  s.updatedAt = now();
  await put(SESSIONS, s);
  emit('workout:changed', { exerciseId });
}

export async function setSessionNotes(id, notes) {
  const s = await get(SESSIONS, id); if (!s) return;
  s.notes = clean(notes); s.updatedAt = now();
  await put(SESSIONS, s); emit('workout:changed', {});
}
export async function setSessionCompleted(id, completed) {
  const s = await get(SESSIONS, id); if (!s) return;
  if (completed) {
    // Finish: bank the running segment as the factual duration; clear rest.
    Object.assign(s, finishPatch(s));
    s.endTime = toLocalTime();
    s.restEndsAt = null; s.restKind = null;
  } else {
    // Reopen the SAME session as active — continue from banked duration; the
    // idle gap between finishing and reopening is excluded. Old override cleared.
    Object.assign(s, reopenPatch(s));
  }
  s.updatedAt = now();
  await put(SESSIONS, s); emit('workout:changed', {});
}

/** Pause/resume the workout ELAPSED timer (independent of the rest countdown).
 * Paused time is excluded from effective duration; persisted so reload/relaunch
 * cannot corrupt the total. */
export async function pauseSession(id) {
  const s = await get(SESSIONS, id); if (!s) return;
  const patch = pausePatch(s); if (!patch) return;
  Object.assign(s, patch); s.updatedAt = now();
  await put(SESSIONS, s); emit('workout:changed', {});
}
export async function resumeSession(id) {
  const s = await get(SESSIONS, id); if (!s) return;
  const patch = resumePatch(s); if (!patch) return;
  Object.assign(s, patch); s.updatedAt = now();
  await put(SESSIONS, s); emit('workout:changed', {});
}

/** Correct the factual duration (seconds). Sets the banked base; if the session
 * is active+running the live timer keeps counting on top of it. Does not touch
 * sets/exercises/PRs/identity and never creates a duplicate session. */
export async function setSessionDuration(id, seconds) {
  const s = await get(SESSIONS, id); if (!s) return;
  const patch = setDurationPatch(s, seconds); if (!patch) return;
  Object.assign(s, patch); s.updatedAt = now();
  await put(SESSIONS, s); emit('workout:changed', {});
}

/** Change the routine day of a session that has NO logged sets yet (wrong-day
 * recovery). Re-snapshots planned exercises + names and resets the duration
 * model to a fresh start, keeping the SAME session id. Refuses if sets exist so
 * meaningful logged data is never silently discarded. Returns true on success. */
export async function changeSessionDay(id, routineId, routineDayId) {
  const existing = await getSetsForSession(id);
  if (existing.length) return false;
  const s = await get(SESSIONS, id); if (!s) return false;
  const routine = await getRoutine(routineId);
  const days = await getDays(routineId);
  const day = days.find((d) => d.id === routineDayId);
  s.routineId = routineId;
  s.routineNameSnapshot = routine ? routine.name : '';
  s.routineDayId = routineDayId;
  s.routineDayNameSnapshot = day ? day.name : '';
  s.plannedExercises = await snapshotPlanned(routineDayId);
  s.startTime = toLocalTime();
  Object.assign(s, resetDurationPatch(now())); // same id, fresh timer
  s.updatedAt = now();
  await put(SESSIONS, s); emit('workout:changed', {});
  return true;
}

/** Re-insert a previously deleted set with its EXACT prior fields (undo). */
export async function restoreSet(record) {
  if (!record || !record.id) return;
  await put(SETS, { ...record });
  emit('workout:changed', { exerciseId: record.exerciseId });
}

/** Persist the active rest countdown on the session as a TIMESTAMP (+ kind),
 * so it survives reload / PWA relaunch. Never stores a decrementing value.
 * Additive optional fields; old sessions without them stay valid. */
export async function setSessionRest(id, { endsAt, kind }) {
  const s = await get(SESSIONS, id); if (!s) return;
  s.restEndsAt = endsAt || null;
  s.restKind = endsAt ? (kind || 'set') : null;
  s.updatedAt = now();
  await put(SESSIONS, s);
}
/** Clear persisted rest state (Skip / expiry / finish). */
export async function clearSessionRest(id) {
  const s = await get(SESSIONS, id); if (!s || (s.restEndsAt == null && s.restKind == null)) return;
  s.restEndsAt = null; s.restKind = null; s.updatedAt = now();
  await put(SESSIONS, s);
}

/** Update a session; changing localDate cascades to all its sets (transactional). */
export async function updateSession(id, patch) {
  await tx([SESSIONS, SETS], 'readwrite', async (t) => {
    const s = await reqAsPromise(t.objectStore(SESSIONS).get(id));
    if (!s) throw new Error('session not found');
    const oldDate = s.localDate;
    if ('localDate' in patch) s.localDate = patch.localDate;
    if ('notes' in patch) s.notes = clean(patch.notes);
    if ('startTime' in patch) s.startTime = patch.startTime;
    if ('endTime' in patch) s.endTime = patch.endTime;
    if ('completed' in patch) s.completed = !!patch.completed;
    s.updatedAt = now();
    await reqAsPromise(t.objectStore(SESSIONS).put(s));
    if ('localDate' in patch && patch.localDate !== oldDate) {
      const sets = await reqAsPromise(t.objectStore(SETS).index('sessionId').getAll(IDBKeyRange.only(id)));
      for (const st of sets) { st.localDate = patch.localDate; st.updatedAt = now(); await reqAsPromise(t.objectStore(SETS).put(st)); }
    }
  });
  emit('workout:changed', {});
}

export async function deleteSession(id) {
  await tx([SESSIONS, SETS], 'readwrite', async (t) => {
    await reqAsPromise(t.objectStore(SESSIONS).delete(id));
    const sets = await reqAsPromise(t.objectStore(SETS).index('sessionId').getAll(IDBKeyRange.only(id)));
    for (const st of sets) await reqAsPromise(t.objectStore(SETS).delete(st.id));
  });
  emit('workout:changed', {});
}

// ---- sets ----
export async function getSetsForSession(sessionId) {
  const rows = await getAllByIndex(SETS, 'sessionId', IDBKeyRange.only(sessionId));
  return rows.sort(byOrder);
}
export async function getSetsForSessionExercise(sessionId, exerciseId) {
  const rows = await getSetsForSession(sessionId);
  return rows.filter((s) => s.exerciseId === exerciseId).sort(byOrder);
}
export async function getSetsForExercise(exerciseId) {
  return getAllByIndex(SETS, 'exerciseId', IDBKeyRange.only(exerciseId));
}

export async function addSet({ sessionId, exerciseId, weight, reps, setType = 'working', rir = null, note = '' }) {
  const errors = validateSet({ weight, reps, setType, rir });
  if (errors.length) throw Object.assign(new Error('set invalid'), { name: 'ValidationError', errors });
  const session = await get(SESSIONS, sessionId);
  if (!session) throw new Error('session not found');
  const exercise = await getExercise(exerciseId);
  const unit = exercise ? exercise.defaultUnit : 'kg';
  const existing = await getSetsForSessionExercise(sessionId, exerciseId);
  const ts = now();
  const set = {
    id: uuid(), sessionId, exerciseId,
    localDate: session.localDate,           // denormalized from session
    order: existing.length,
    weight: Number(weight), reps: Number(reps),
    unit,                                   // snapshot from exercise
    setType, rir: (rir == null || rir === '') ? null : Number(rir),
    note: clean(note), createdAt: ts, updatedAt: ts,
  };
  await put(SETS, set);
  emit('workout:changed', { exerciseId });
  return set.id;
}

export async function updateSet(id, patch) {
  const cur = await get(SETS, id);
  if (!cur) throw new Error('set not found');
  const previousExerciseId = cur.exerciseId;
  const merged = { ...cur };
  if ('weight' in patch) merged.weight = Number(patch.weight);
  if ('reps' in patch) merged.reps = Number(patch.reps);
  if ('setType' in patch) merged.setType = patch.setType;
  if ('rir' in patch) merged.rir = (patch.rir == null || patch.rir === '') ? null : Number(patch.rir);
  if ('note' in patch) merged.note = clean(patch.note);

  // Historical exercise correction: changing exerciseId re-snapshots the unit
  // from the destination exercise's current default (never leave a stale kg/lb
  // unit attached to a newly chosen exercise), unless an explicit unit is given.
  if ('exerciseId' in patch && patch.exerciseId !== cur.exerciseId) {
    const destEx = await getExercise(patch.exerciseId);
    if (!destEx) throw Object.assign(new Error('destination exercise not found'), { name: 'ValidationError', errors: ['التمرين الوجهة غير موجود.'] });
    merged.exerciseId = patch.exerciseId;
    merged.unit = ('unit' in patch) ? patch.unit : destEx.defaultUnit;
  } else if ('unit' in patch) {
    merged.unit = patch.unit;
  }

  const errors = validateSet(merged);
  if (errors.length) throw Object.assign(new Error('set invalid'), { name: 'ValidationError', errors });
  merged.updatedAt = now();
  await put(SETS, merged);
  // Signal BOTH exercises so derived state (Stage 8 PRs) can invalidate/recompute
  // the old and the new exercise when a set is reassigned.
  emit('workout:changed', {
    exerciseId: merged.exerciseId,
    previousExerciseId: previousExerciseId !== merged.exerciseId ? previousExerciseId : null,
  });
}

export async function deleteSet(id) {
  const cur = await get(SETS, id);
  await del(SETS, id);
  emit('workout:changed', { exerciseId: cur?.exerciseId });
  return cur ? { ...cur } : null;   // snapshot for undo (restoreSet)
}

// ---- exercise memory ----
/**
 * Most recent prior working performance for an exercise. Pass the current
 * session's context so future/later sessions never count as "last performance".
 * @param {string} exerciseId
 * @param {object} [opts] { excludeSessionId, asOf:{localDate,startTime,seq} }
 */
// ---- session join (factual chronology) ----
/**
 * Join sets with their sessions, attaching the FACTUAL session timeline fields
 * the pure calculators order by: sessionDate (localDate), sessionStart
 * (startTime), and sessionSeq (a stable tiebreaker = session.createdAt, used only
 * when date+start are equal). Never mutates stored records.
 */
async function enrichSetsWithSession(sets) {
  const ids = [...new Set(sets.map((s) => s.sessionId))];
  const sessions = new Map();
  for (const sid of ids) { const s = await get(SESSIONS, sid); if (s) sessions.set(sid, s); }
  return sets.map((s) => {
    const ss = sessions.get(s.sessionId);
    return ss
      ? { ...s, sessionDate: ss.localDate, sessionStart: ss.startTime || '', sessionSeq: ss.createdAt || 0 }
      : { ...s, sessionDate: s.localDate, sessionStart: '', sessionSeq: 0 };
  });
}

/** Session-enriched sets for one exercise (for detail views + pure calcs). */
export async function getExerciseSetsEnriched(exerciseId) {
  return enrichSetsWithSession(await getSetsForExercise(exerciseId));
}

export async function getExerciseMemory(exerciseId, opts = {}) {
  const sets = await enrichSetsWithSession(await getSetsForExercise(exerciseId));
  return lastPerformance(sets, opts);
}

// ---- dynamic PRs (Stage 8) — always derived from raw sets, never stored ----
/** Records for one exercise: per-set flags + current bests. */
export async function getExerciseRecords(exerciseId) {
  const sets = await enrichSetsWithSession(await getSetsForExercise(exerciseId));
  return computeExerciseRecords(sets);
}

/** Genuine achievements contributed by a session (across its exercises). */
export async function getSessionAchievements(sessionId) {
  const sessionSets = await getSetsForSession(sessionId);
  const exIds = [...new Set(sessionSets.map((s) => s.exerciseId))];
  const setsByExercise = new Map();
  for (const exId of exIds) setsByExercise.set(exId, await enrichSetsWithSession(await getSetsForExercise(exId)));
  return sessionAchievements(setsByExercise, sessionId);
}
