// settings.repo.js — Settings foundation.
//
// Two kinds of settings:
//  1. Simple config (units, tolerance) live in the `settings` key/value store.
//  2. Calorie/protein TARGETS are stored in `targetHistory` so historical days
//     can later compare against the target that applied on that date. The
//     "current target" is derived as the row with the latest effectiveFrom <=
//     today. Editing the target today appends/replaces today's row and never
//     rewrites past rows. This satisfies the "preserve target history" rule
//     even though the Stage-1 UI only edits the current value.

import { get, put, getAll, getAllByIndex, tx, reqAsPromise } from '../core/db.js';
import { uuid } from '../core/ids.js';
import { todayLocal, now } from '../core/dates.js';
import { emit } from '../core/events.js';

const DEFAULTS = {
  defaultWeightUnit: 'kg',    // weigh-ins are kg per spec
  defaultExerciseUnit: 'lb',  // gym default; per-exercise override later
  trajectoryToleranceKg: 0.5, // UI classification band (documented, non-medical)
  restBetweenSetsDefault: 90, // seconds; per-routine-exercise overrides this
  restAfterExerciseDefault: 120,
};

const SUPPORTED_UNITS = ['kg', 'lb'];

/**
 * Validate a simple config value for known keys. Unknown keys pass through
 * (forward-compatible), but every known key is the repository's integrity
 * boundary — invalid values are rejected, never silently coerced.
 * @returns {string[]} error messages
 */
export function validateConfig(key, value) {
  const errors = [];
  if (key === 'defaultWeightUnit' || key === 'defaultExerciseUnit') {
    if (!SUPPORTED_UNITS.includes(value)) errors.push('وحدة غير مدعومة.');
  } else if (key === 'trajectoryToleranceKg') {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) errors.push('قيمة التفاوت يجب أن تكون رقمًا صفرًا أو أكبر.');
  }
  return errors;
}

/** Validate a calorie/protein target: null clears it; otherwise finite and >= 0. */
export function validateTarget(value) {
  if (value == null || value === '') return []; // optional → cleared
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return ['الهدف يجب أن يكون رقمًا صفرًا أو أكبر.'];
  return [];
}

/** Read a simple config value, falling back to a built-in default. */
export async function getConfig(key) {
  const row = await get('settings', key);
  if (row && 'value' in row) return row.value;
  return DEFAULTS[key];
}

/** Write a simple config value. Rejects invalid values for known keys. */
export async function setConfig(key, value) {
  const errors = validateConfig(key, value);
  if (errors.length) throw Object.assign(new Error('config invalid'), { name: 'ValidationError', errors });
  await put('settings', { key, value });
  emit('settings:changed', { key });
}

/** All simple config as a plain object (with defaults filled in). */
export async function getAllConfig() {
  const out = { ...DEFAULTS };
  const all = await getAll('settings'); // tiny store; whole read is fine
  for (const r of all) out[r.key] = r.value;
  return out;
}

// ---- Targets (calorie / protein) via targetHistory ----

/**
 * Set the target for `type` ('calorie' | 'protein'), effective from today.
 * Passing null clears the target from today onward (protein target is optional).
 * Replaces any existing row for the same type+today; leaves earlier rows intact.
 */
export async function setTarget(type, value) {
  if (type !== 'calorie' && type !== 'protein') {
    throw Object.assign(new Error('bad target type'), { name: 'ValidationError', errors: ['نوع هدف غير صالح.'] });
  }
  const errors = validateTarget(value);
  if (errors.length) throw Object.assign(new Error('target invalid'), { name: 'ValidationError', errors });
  const effectiveFrom = todayLocal();
  await tx('targetHistory', 'readwrite', async (t) => {
    const store = t.objectStore('targetHistory');
    const idx = store.index('type_effectiveFrom');
    const existing = await reqAsPromise(
      idx.getAll(IDBKeyRange.only([type, effectiveFrom])));
    for (const row of existing) await reqAsPromise(store.delete(row.id));
    if (value != null) {
      await reqAsPromise(store.put({
        id: uuid(), type, value: Number(value), effectiveFrom, createdAt: now(),
      }));
    }
  });
  emit('settings:changed', { target: type });
}

/** All target rows for a type (sorted by effectiveFrom asc) — for charts. */
export async function getTargetRows(type) {
  const rows = await getAllByIndex('targetHistory', 'type', IDBKeyRange.only(type));
  return rows.sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : a.effectiveFrom > b.effectiveFrom ? 1 : 0));
}

/** PURE: the target value effective on `date` given pre-read rows, or null. */
export function targetAtFromRows(rows, date) {
  let best = null;
  for (const r of rows) if (r.effectiveFrom <= date && (!best || r.effectiveFrom > best.effectiveFrom)) best = r;
  return best ? best.value : null;
}

/** The target value for `type` on a given date (defaults to today), or null. */
export async function getTargetForDate(type, dateStr = todayLocal()) {
  const rows = await getAllByIndex(
    'targetHistory', 'type', IDBKeyRange.only(type));
  let best = null;
  for (const r of rows) {
    if (r.effectiveFrom <= dateStr && (!best || r.effectiveFrom > best.effectiveFrom)) {
      best = r;
    }
  }
  return best ? best.value : null;
}

/** Convenience: current target for `type` (today). */
export function getCurrentTarget(type) {
  return getTargetForDate(type, todayLocal());
}
