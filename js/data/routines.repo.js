// routines.repo.js — workout routines: routines → ordered days → ordered
// exercises (references to permanent Exercise Library ids). Removing an exercise
// from a routine never touches workout history (that lives in workoutSets, keyed
// by the permanent exercise id). Uses existing v1 stores; no schema change.

import { getAll, getAllByIndex, get, put, del, tx, reqAsPromise } from '../core/db.js';
import { uuid } from '../core/ids.js';
import { now } from '../core/dates.js';
import { emit } from '../core/events.js';
import { getConfig, setConfig } from './settings.repo.js';

const ROUTINES = 'routines';
const DAYS = 'routineDays';
const REXS = 'routineExercises';
const clean = (v) => String(v ?? '').trim();
const byOrder = (a, b) => (a.order - b.order) || (a.createdAt - b.createdAt);

// ---- active routine (persistent daily preference) ----
/** Set (or clear with null) the user's active routine. Explicit action only —
 * nothing silently replaces an existing active routine. */
export async function setActiveRoutine(routineId) {
  await setConfig('activeRoutineId', routineId || null);
  emit('routines:changed', {});
}
/** The active routine object, or null if unset/missing/archived. */
export async function getActiveRoutine() {
  const id = await getConfig('activeRoutineId');
  if (!id) return null;
  const r = await get(ROUTINES, id);
  return (r && r.status === 'active') ? r : null;
}
export async function getActiveRoutineId() {
  const r = await getActiveRoutine();
  return r ? r.id : null;
}


// ---- routines ----
export async function createRoutine(name) {
  const ts = now();
  const routine = { id: uuid(), name: clean(name) || 'برنامج', notes: '', status: 'active', createdAt: ts, updatedAt: ts };
  await put(ROUTINES, routine);
  emit('routines:changed', {});
  return routine.id;
}
export async function renameRoutine(id, name) {
  const cur = await get(ROUTINES, id); if (!cur) return;
  cur.name = clean(name) || cur.name; cur.updatedAt = now();
  await put(ROUTINES, cur); emit('routines:changed', {});
}
export async function setRoutineNotes(id, notes) {
  const cur = await get(ROUTINES, id); if (!cur) return;
  cur.notes = clean(notes); cur.updatedAt = now();
  await put(ROUTINES, cur); emit('routines:changed', {});
}
export async function setRoutineStatus(id, status) {
  const cur = await get(ROUTINES, id); if (!cur) return;
  cur.status = status; cur.updatedAt = now();
  await put(ROUTINES, cur); emit('routines:changed', {});
}
export const archiveRoutine = (id) => setRoutineStatus(id, 'archived');
export const restoreRoutine = (id) => setRoutineStatus(id, 'active');

export const getRoutine = (id) => get(ROUTINES, id);
export const getAllRoutines = () => getAll(ROUTINES);
export async function getActiveRoutines() {
  const rows = await getAllByIndex(ROUTINES, 'status', IDBKeyRange.only('active'));
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
}
export async function getArchivedRoutines() {
  const rows = await getAllByIndex(ROUTINES, 'status', IDBKeyRange.only('archived'));
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
}

/** Deep-duplicate a routine with all its days and exercises (new ids). */
export async function duplicateRoutine(id) {
  const ts = now();
  const newId = uuid();
  await tx([ROUTINES, DAYS, REXS], 'readwrite', async (t) => {
    const src = await reqAsPromise(t.objectStore(ROUTINES).get(id));
    if (!src) throw new Error('routine not found');
    await reqAsPromise(t.objectStore(ROUTINES).put({ ...src, id: newId, name: `${src.name} (نسخة)`, status: 'active', createdAt: ts, updatedAt: ts }));
    const days = (await reqAsPromise(t.objectStore(DAYS).index('routineId').getAll(IDBKeyRange.only(id)))).sort(byOrder);
    for (const d of days) {
      const newDayId = uuid();
      await reqAsPromise(t.objectStore(DAYS).put({ ...d, id: newDayId, routineId: newId, createdAt: ts }));
      const rexs = (await reqAsPromise(t.objectStore(REXS).index('routineDayId').getAll(IDBKeyRange.only(d.id)))).sort(byOrder);
      for (const rx of rexs) {
        await reqAsPromise(t.objectStore(REXS).put({ ...rx, id: uuid(), routineDayId: newDayId, createdAt: ts }));
      }
    }
  });
  emit('routines:changed', {});
  return newId;
}

// ---- days ----
export async function getDays(routineId) {
  const rows = await getAllByIndex(DAYS, 'routineId', IDBKeyRange.only(routineId));
  return rows.sort(byOrder);
}
export async function addDay(routineId, name) {
  const days = await getDays(routineId);
  const day = { id: uuid(), routineId, name: clean(name) || 'يوم', order: days.length, createdAt: now() };
  await put(DAYS, day); emit('routines:changed', {});
  return day.id;
}
export async function renameDay(dayId, name) {
  const cur = await get(DAYS, dayId); if (!cur) return;
  cur.name = clean(name) || cur.name; await put(DAYS, cur); emit('routines:changed', {});
}
export async function deleteDay(dayId) {
  await tx([DAYS, REXS], 'readwrite', async (t) => {
    await reqAsPromise(t.objectStore(DAYS).delete(dayId));
    const rexs = await reqAsPromise(t.objectStore(REXS).index('routineDayId').getAll(IDBKeyRange.only(dayId)));
    for (const rx of rexs) await reqAsPromise(t.objectStore(REXS).delete(rx.id));
  });
  emit('routines:changed', {});
}
export async function duplicateDay(dayId) {
  const ts = now();
  await tx([DAYS, REXS], 'readwrite', async (t) => {
    const src = await reqAsPromise(t.objectStore(DAYS).get(dayId));
    if (!src) return;
    const siblings = (await reqAsPromise(t.objectStore(DAYS).index('routineId').getAll(IDBKeyRange.only(src.routineId))));
    const newDayId = uuid();
    await reqAsPromise(t.objectStore(DAYS).put({ ...src, id: newDayId, name: `${src.name} (نسخة)`, order: siblings.length, createdAt: ts }));
    const rexs = (await reqAsPromise(t.objectStore(REXS).index('routineDayId').getAll(IDBKeyRange.only(dayId)))).sort(byOrder);
    for (const rx of rexs) await reqAsPromise(t.objectStore(REXS).put({ ...rx, id: uuid(), routineDayId: newDayId, createdAt: ts }));
  });
  emit('routines:changed', {});
}
/** Move a day up/down by swapping order with its neighbour. */
export async function moveDay(routineId, dayId, dir) {
  const days = await getDays(routineId);
  const i = days.findIndex((d) => d.id === dayId);
  const j = dir === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= days.length) return;
  await tx(DAYS, 'readwrite', async (t) => {
    const a = days[i], b = days[j];
    const ao = a.order, bo = b.order;
    a.order = bo; b.order = ao;
    await reqAsPromise(t.objectStore(DAYS).put(a));
    await reqAsPromise(t.objectStore(DAYS).put(b));
  });
  emit('routines:changed', {});
}

// ---- routine exercises ----
export async function getDayExercises(dayId) {
  const rows = await getAllByIndex(REXS, 'routineDayId', IDBKeyRange.only(dayId));
  return rows.sort(byOrder);
}
export async function addExerciseToDay(dayId, exerciseId, note = '') {
  const rows = await getDayExercises(dayId);
  const rx = { id: uuid(), routineDayId: dayId, exerciseId, order: rows.length, note: clean(note), createdAt: now() };
  await put(REXS, rx); emit('routines:changed', {});
  return rx.id;
}
export async function removeRoutineExercise(rexId) {
  await del(REXS, rexId); emit('routines:changed', {});
}
/** Replace which exercise a routine slot points to (keeps its order/note). */
export async function replaceRoutineExercise(rexId, newExerciseId) {
  const cur = await get(REXS, rexId); if (!cur) return;
  cur.exerciseId = newExerciseId; await put(REXS, cur); emit('routines:changed', {});
}
export async function setRoutineExerciseNote(rexId, note) {
  const cur = await get(REXS, rexId); if (!cur) return;
  cur.note = clean(note); await put(REXS, cur); emit('routines:changed', {});
}
/** Per-exercise rest config (seconds). null/empty clears an override so the
 * global workout-logging default applies. Additive per-record fields; no
 * schema/migration change. */
export async function setRoutineExerciseRest(rexId, { betweenSets, afterExercise } = {}) {
  const cur = await get(REXS, rexId); if (!cur) return;
  const norm = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) || Number(v) < 0) ? null : Math.round(Number(v));
  if (betweenSets !== undefined) cur.restBetweenSets = norm(betweenSets);
  if (afterExercise !== undefined) cur.restAfterExercise = norm(afterExercise);
  await put(REXS, cur); emit('routines:changed', {});
}
export async function moveRoutineExercise(dayId, rexId, dir) {
  const rows = await getDayExercises(dayId);
  const i = rows.findIndex((r) => r.id === rexId);
  const j = dir === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= rows.length) return;
  await tx(REXS, 'readwrite', async (t) => {
    const a = rows[i], b = rows[j];
    const ao = a.order, bo = b.order; a.order = bo; b.order = ao;
    await reqAsPromise(t.objectStore(REXS).put(a));
    await reqAsPromise(t.objectStore(REXS).put(b));
  });
  emit('routines:changed', {});
}

/** Full routine tree: { routine, days:[{ day, exercises:[routineExercise] }] }. */
export async function getRoutineFull(routineId) {
  const routine = await getRoutine(routineId);
  if (!routine) return null;
  const days = await getDays(routineId);
  const withEx = [];
  for (const day of days) withEx.push({ day, exercises: await getDayExercises(day.id) });
  return { routine, days: withEx };
}
