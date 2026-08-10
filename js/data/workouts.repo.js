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

const SESSIONS = 'workoutSessions';
const SETS = 'workoutSets';
const clean = (v) => String(v ?? '').trim();
const byOrder = (a, b) => (a.order - b.order) || ((a.createdAt || 0) - (b.createdAt || 0));

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
    planned.push({ exerciseId: rx.exerciseId, nameSnapshot: ex ? ex.name : 'تمرين', note: rx.note || '' });
  }
  return planned;
}

/**
 * Start a session from a routine day (snapshots routine/day names + planned
 * exercises), or ad-hoc when routineId/dayId are omitted.
 */
export async function startSession({ routineId = null, routineDayId = null, localDate } = {}) {
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

export async function setSessionNotes(id, notes) {
  const s = await get(SESSIONS, id); if (!s) return;
  s.notes = clean(notes); s.updatedAt = now();
  await put(SESSIONS, s); emit('workout:changed', {});
}
export async function setSessionCompleted(id, completed) {
  const s = await get(SESSIONS, id); if (!s) return;
  s.completed = !!completed; s.endTime = completed ? toLocalTime() : s.endTime; s.updatedAt = now();
  await put(SESSIONS, s); emit('workout:changed', {});
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
