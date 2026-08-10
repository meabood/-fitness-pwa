// nutrition.repo.js — nutrition logging data access.
//
// Every logged entry SNAPSHOTS the values at logging time (name, kcal/serving,
// protein/serving, serving) and stores the recorded finals (finalCalories,
// finalProtein). Later Meal Library edits never change these. Unknown protein is
// null throughout (never coerced to 0). nutritionDays holds an optional per-day
// completion flag so "unlogged" is distinct from "logged zero".

import { getAllByIndex, get, put, del, tx, reqAsPromise } from '../core/db.js';
import { uuid } from '../core/ids.js';
import { now, todayLocal, toLocalTime } from '../core/dates.js';
import { emit } from '../core/events.js';
import { computeFinals } from '../domain/nutritionStats.js';
import { byDateTime } from '../domain/weightStats.js';

const ENTRIES = 'nutritionEntries';
const DAYS = 'nutritionDays';

const clean = (v) => String(v ?? '').trim();
const num = (v) => Number(v);
const validPos = (v) => Number.isFinite(num(v)) && num(v) >= 0;

/** Build a snapshot entry from explicit factual values (used for meal + one-time). */
function buildEntry({ localDate, time, sourceMealId, name, kcalPerServing, proteinPerServing, serving, quantity, note }) {
  const q = num(quantity);
  const protein = proteinPerServing == null || proteinPerServing === '' ? null : num(proteinPerServing);
  const { finalCalories, finalProtein } = computeFinals(num(kcalPerServing), protein, q);
  const ts = now();
  return {
    id: uuid(),
    localDate: localDate || todayLocal(),
    time: time != null ? time : toLocalTime(),
    sourceMealId: sourceMealId || null,
    nameSnapshot: clean(name),
    kcalPerServingSnapshot: num(kcalPerServing),
    proteinPerServingSnapshot: protein,          // null = unknown
    servingSnapshot: clean(serving),
    quantity: q,
    finalCalories,
    finalProtein,                                 // null = unknown
    note: clean(note),
    createdAt: ts,
    updatedAt: ts,
  };
}

/**
 * Validate the fully-resolved factual values of an entry.
 *  - name: non-empty
 *  - calories: finite and >= 0
 *  - quantity: finite and > 0
 *  - protein: null/'' = unknown (allowed); otherwise finite and >= 0
 * @returns {string[]} error messages
 */
export function validateEntryValues({ name, calories, protein, quantity }) {
  const errors = [];
  if (!clean(name)) errors.push('اسم الصنف مطلوب.');
  const c = Number(calories);
  if (!Number.isFinite(c) || c < 0) errors.push('السعرات يجب أن تكون رقمًا صفرًا أو أكبر.');
  const q = Number(quantity);
  if (!Number.isFinite(q) || q <= 0) errors.push('الكمية يجب أن تكون أكبر من صفر.');
  if (!(protein == null || protein === '')) { // null/'' stays unknown, not validated as 0
    const p = Number(protein);
    if (!Number.isFinite(p) || p < 0) errors.push('البروتين يجب أن يكون رقمًا صفرًا أو أكبر، أو يُترك فارغًا.');
  }
  return errors;
}

/** Backwards-compatible name used by the UI. */
export const validateEntryInput = validateEntryValues;

function assertEntryValid(vals) {
  const errors = validateEntryValues(vals);
  if (errors.length) throw Object.assign(new Error('entry invalid'), { name: 'ValidationError', errors });
}

/** Log an entry from a Meal Library item (snapshots the meal's current values). */
export async function addEntryFromMeal(meal, { quantity = 1, localDate, time, note } = {}) {
  assertEntryValid({ name: meal?.name, calories: meal?.calories, protein: meal?.protein, quantity });
  const entry = buildEntry({
    localDate, time, sourceMealId: meal.id,
    name: meal.name, kcalPerServing: meal.calories, proteinPerServing: meal.protein,
    serving: meal.serving, quantity, note,
  });
  await put(ENTRIES, entry);
  emit('nutrition:changed', { localDate: entry.localDate });
  return entry.id;
}

/** Log a one-time entry (not tied to the library). protein '' / null = unknown. */
export async function addOneTimeEntry(data) {
  assertEntryValid({ name: data.name, calories: data.calories, protein: data.protein, quantity: data.quantity });
  const entry = buildEntry({
    localDate: data.localDate, time: data.time, sourceMealId: null,
    name: data.name, kcalPerServing: data.calories, proteinPerServing: data.protein,
    serving: data.serving, quantity: data.quantity, note: data.note,
  });
  await put(ENTRIES, entry);
  emit('nutrition:changed', { localDate: entry.localDate });
  return entry.id;
}

/**
 * PURE: apply a patch to an entry, validate the FULLY-MERGED result, then
 * recompute finals. Time is preserved unless `time` is explicitly in the patch.
 * Protein null/'' stays unknown (never coerced to 0); an explicit 0 is kept.
 * Throws ValidationError on invalid merged values. Exported for testing.
 */
export function applyEntryPatch(cur, patch) {
  const next = { ...cur };
  if ('name' in patch) next.nameSnapshot = clean(patch.name);
  if ('calories' in patch) next.kcalPerServingSnapshot = num(patch.calories);
  if ('protein' in patch) next.proteinPerServingSnapshot = (patch.protein == null || patch.protein === '') ? null : num(patch.protein);
  if ('serving' in patch) next.servingSnapshot = clean(patch.serving);
  if ('quantity' in patch) next.quantity = num(patch.quantity);
  if ('localDate' in patch) next.localDate = patch.localDate;
  if ('time' in patch) next.time = patch.time;          // preserved unless explicitly provided
  if ('note' in patch) next.note = clean(patch.note);

  // Validate the merged entry BEFORE writing/recalculating.
  assertEntryValid({
    name: next.nameSnapshot,
    calories: next.kcalPerServingSnapshot,
    protein: next.proteinPerServingSnapshot,
    quantity: next.quantity,
  });

  const { finalCalories, finalProtein } = computeFinals(next.kcalPerServingSnapshot, next.proteinPerServingSnapshot, next.quantity);
  next.finalCalories = finalCalories;
  next.finalProtein = finalProtein;
  next.updatedAt = now();
  return next;
}

/**
 * Edit an entry's factual values. Recomputes finals from the (possibly edited)
 * per-serving snapshot × quantity, after validating the fully-merged entry.
 * Editing here is the ONLY way an entry's snapshot changes — never as a side
 * effect of a library edit.
 */
export async function updateEntry(id, patch) {
  const cur = await get(ENTRIES, id);
  if (!cur) throw new Error('entry not found');
  const next = applyEntryPatch(cur, patch);
  await put(ENTRIES, next);
  emit('nutrition:changed', {});
}

export async function deleteEntry(id) {
  const cur = await get(ENTRIES, id);
  await del(ENTRIES, id);
  emit('nutrition:changed', { localDate: cur?.localDate });
}

/** Duplicate an entry on the same day (new record, same snapshot/finals). */
export async function duplicateEntry(id) {
  const cur = await get(ENTRIES, id);
  if (!cur) return;
  const ts = now();
  const copy = { ...cur, id: uuid(), time: toLocalTime(), createdAt: ts, updatedAt: ts };
  await put(ENTRIES, copy);
  emit('nutrition:changed', { localDate: copy.localDate });
  return copy.id;
}

/** Copy an entry to another date (new record; never a shared reference). */
export async function copyEntryToDate(id, targetDate) {
  const cur = await get(ENTRIES, id);
  if (!cur) return;
  const ts = now();
  const copy = { ...cur, id: uuid(), localDate: targetDate, createdAt: ts, updatedAt: ts };
  await put(ENTRIES, copy);
  emit('nutrition:changed', { localDate: targetDate });
  return copy.id;
}

/** Copy every entry from one day to another (e.g. "copy previous day"). */
export async function copyDay(fromDate, toDate) {
  const rows = await getEntriesForDate(fromDate);
  const ts = now();
  await tx(ENTRIES, 'readwrite', async (t) => {
    const store = t.objectStore(ENTRIES);
    for (const r of rows) {
      await reqAsPromise(store.put({ ...r, id: uuid(), localDate: toDate, createdAt: ts, updatedAt: ts }));
    }
  });
  emit('nutrition:changed', { localDate: toDate });
  return rows.length;
}

// ---- reads ----
export async function getEntriesForDate(localDate) {
  const rows = await getAllByIndex(ENTRIES, 'localDate', IDBKeyRange.only(localDate));
  return rows.sort(byDateTime);
}
export async function getEntriesInRange(from, to) {
  const rows = await getAllByIndex(ENTRIES, 'localDate', IDBKeyRange.bound(from, to));
  return rows.sort(byDateTime);
}

// ---- day completion ----
export async function getDay(localDate) {
  return (await get(DAYS, localDate)) || null;
}
export async function setDayCompleted(localDate, completed) {
  await put(DAYS, { localDate, completed: !!completed, completedAt: completed ? now() : null });
  emit('nutrition:changed', { localDate });
}
