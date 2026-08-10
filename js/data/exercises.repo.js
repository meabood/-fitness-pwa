// exercises.repo.js — Exercise Library data access.
//
// Each exercise has a PERMANENT id that carries its history (workout sets, from
// Stage 7). Different machines are separate exercises with separate ids — the app
// never merges or compares across ids. Archiving hides an exercise from pickers
// but never deletes it or its history.

import { getAll, getAllByIndex, get, put, del } from '../core/db.js';
import { uuid } from '../core/ids.js';
import { now } from '../core/dates.js';
import { emit } from '../core/events.js';
import { getConfig, setConfig } from './settings.repo.js';
import { BUILTIN_EXERCISES, BUILTIN_VERSION } from './builtinExercises.js';

const STORE = 'exercises';
const clean = (v) => String(v ?? '').trim();

/**
 * Seed the curated starter library idempotently. A built-in is only created if
 * its stable id does not already exist, so:
 *   - fresh installs get the whole library,
 *   - re-running never duplicates,
 *   - user-created exercises are never touched or merged,
 *   - a built-in the user archived still exists (by id) → skipped.
 * A version flag short-circuits the common case (already seeded at this version)
 * and lets a future library revision seed only newly added ids.
 * @returns {Promise<number>} how many built-ins were created this run
 */
export async function seedBuiltinExercises() {
  const seededVersion = await getConfig('builtinLibraryVersion');
  if (seededVersion === BUILTIN_VERSION) return 0;
  // A newly created built-in adopts the user's CURRENT default exercise unit.
  // This only affects records created in this run; existing exercises (built-in
  // or custom) and workout history are never rewritten, and later settings
  // changes never retroactively mutate an existing exercise's unit.
  const defaultUnit = (await getConfig('defaultExerciseUnit')) === 'kg' ? 'kg' : 'lb';
  const ts = now();
  let created = 0;
  for (const b of BUILTIN_EXERCISES) {
    const existing = await get(STORE, b.id);
    if (existing) continue;                       // never overwrite / duplicate / re-unit
    await put(STORE, { ...b, defaultUnit, createdAt: ts, updatedAt: ts });
    created++;
  }
  await setConfig('builtinLibraryVersion', BUILTIN_VERSION);
  if (created) emit('exercises:changed', {});
  return created;
}

export function validateExercise(x) {
  const errors = [];
  if (!clean(x.name)) errors.push('اسم التمرين مطلوب.');
  if (x.defaultUnit && !['kg', 'lb'].includes(x.defaultUnit)) errors.push('وحدة غير صالحة.');
  return errors;
}

export async function addExercise(x) {
  const errors = validateExercise(x);
  if (errors.length) throw Object.assign(new Error('exercise invalid'), { name: 'ValidationError', errors });
  const ts = now();
  const ex = {
    id: uuid(),
    name: clean(x.name),
    muscleGroup: clean(x.muscleGroup),
    equipment: clean(x.equipment),
    defaultUnit: x.defaultUnit === 'kg' ? 'kg' : 'lb',
    machineId: clean(x.machineId) || null,
    notes: clean(x.notes),
    status: 'active',
    createdAt: ts,
    updatedAt: ts,
  };
  await put(STORE, ex);
  emit('exercises:changed', {});
  return ex.id;
}

export async function updateExercise(id, patch) {
  const cur = await get(STORE, id);
  if (!cur) throw new Error('exercise not found');
  const merged = { ...cur, ...patch };
  const errors = validateExercise(merged);
  if (errors.length) throw Object.assign(new Error('exercise invalid'), { name: 'ValidationError', errors });
  const next = {
    ...cur,
    name: clean(merged.name),
    muscleGroup: clean(merged.muscleGroup),
    equipment: clean(merged.equipment),
    defaultUnit: merged.defaultUnit === 'kg' ? 'kg' : 'lb',
    machineId: clean(merged.machineId) || null,
    notes: clean(merged.notes),
    updatedAt: now(),
  };
  await put(STORE, next);
  emit('exercises:changed', {});
}

export async function setExerciseStatus(id, status) {
  const cur = await get(STORE, id);
  if (!cur) return;
  cur.status = status; cur.updatedAt = now();
  await put(STORE, cur);
  emit('exercises:changed', {});
}
export const archiveExercise = (id) => setExerciseStatus(id, 'archived');
export const restoreExercise = (id) => setExerciseStatus(id, 'active');

/** Permanent delete. Prefer archive when workout history exists (Stage 7+). */
export async function deleteExercise(id) {
  await del(STORE, id);
  emit('exercises:changed', {});
}

export const getExercise = (id) => get(STORE, id);
export const getAllExercises = () => getAll(STORE);

export async function getActiveExercises() {
  const rows = await getAllByIndex(STORE, 'status', IDBKeyRange.only('active'));
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
}
export async function getArchivedExercises() {
  const rows = await getAllByIndex(STORE, 'status', IDBKeyRange.only('archived'));
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
}

/** Distinct non-empty muscle groups / equipment among active exercises (for filters). */
export async function getFacets() {
  const rows = await getActiveExercises();
  const muscles = [...new Set(rows.map((r) => r.muscleGroup).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar'));
  const equipment = [...new Set(rows.map((r) => r.equipment).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar'));
  return { muscles, equipment };
}

/** Search/filter active exercises by name term, muscle group, and equipment.
 * Term matches the Arabic display name, the English name, and any aliases so a
 * user can type either language. */
export function matchesTerm(ex, t) {
  if (!t) return true;
  const hay = [ex.name, ex.nameEn, ...(ex.aliases || [])].filter(Boolean).join(' ').toLowerCase();
  return hay.includes(t);
}

export async function queryExercises({ term = '', muscle = '', equipment = '' } = {}) {
  const t = clean(term).toLowerCase();
  let rows = await getActiveExercises();
  if (t) rows = rows.filter((r) => matchesTerm(r, t));
  if (muscle) rows = rows.filter((r) => r.muscleGroup === muscle);
  if (equipment) rows = rows.filter((r) => r.equipment === equipment);
  return rows;
}
