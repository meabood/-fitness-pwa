// meals.repo.js — Meal Library data access. Editing a meal never rewrites logged
// history (nutrition entries snapshot values at logging time). Archiving hides a
// meal from pickers but keeps it; historical entries are independent regardless.

import { getAll, getAllByIndex, get, put, del } from '../core/db.js';
import { uuid } from '../core/ids.js';
import { now } from '../core/dates.js';
import { emit } from '../core/events.js';
import { countEntriesForMeal } from './nutrition.repo.js';

const STORE = 'meals';

const clean = (v) => String(v ?? '').trim();
const posNum = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : NaN; };

/** Validate meal input. Protein null = unknown (allowed). @returns {string[]} errors */
export function validateMeal(m) {
  const errors = [];
  if (!clean(m.name)) errors.push('اسم الوجبة مطلوب.');
  if (Number.isNaN(posNum(m.calories))) errors.push('السعرات يجب أن تكون رقمًا صفرًا أو أكبر.');
  if (m.protein != null && m.protein !== '' && Number.isNaN(posNum(m.protein))) {
    errors.push('البروتين يجب أن يكون رقمًا صفرًا أو أكبر، أو يُترك فارغًا.');
  }
  return errors;
}

function normalizeProtein(p) {
  if (p == null || p === '') return null; // unknown, not zero
  return posNum(p);
}

export async function addMeal(m) {
  const errors = validateMeal(m);
  if (errors.length) throw Object.assign(new Error('meal invalid'), { name: 'ValidationError', errors });
  const ts = now();
  const meal = {
    id: uuid(),
    name: clean(m.name),
    calories: posNum(m.calories),
    protein: normalizeProtein(m.protein),
    serving: clean(m.serving),
    notes: clean(m.notes),
    status: 'active',
    createdAt: ts,
    updatedAt: ts,
  };
  await put(STORE, meal);
  emit('meals:changed', {});
  return meal.id;
}

export async function updateMeal(id, patch) {
  const cur = await get(STORE, id);
  if (!cur) throw new Error('meal not found');
  const merged = { ...cur, ...patch };
  const errors = validateMeal(merged);
  if (errors.length) throw Object.assign(new Error('meal invalid'), { name: 'ValidationError', errors });
  const next = {
    ...cur,
    name: clean(merged.name),
    calories: posNum(merged.calories),
    protein: normalizeProtein(merged.protein),
    serving: clean(merged.serving),
    notes: clean(merged.notes),
    updatedAt: now(),
  };
  await put(STORE, next);
  emit('meals:changed', {});
}

export async function setMealStatus(id, status) {
  const cur = await get(STORE, id);
  if (!cur) return;
  cur.status = status; cur.updatedAt = now();
  await put(STORE, cur);
  emit('meals:changed', {});
}
export const archiveMeal = (id) => setMealStatus(id, 'archived');
export const restoreMeal = (id) => setMealStatus(id, 'active');

/** Permanent delete. Safe for history (entries are snapshots), but archive is preferred. */
/** Permanent delete. Refuses when the meal is referenced by historical nutrition
 * entries (deleting would orphan sourceMealId, a state the backup validator
 * rejects). Callers should archive instead. Throws MealReferencedError. */
export async function deleteMeal(id) {
  const refs = await countEntriesForMeal(id);
  if (refs > 0) {
    throw Object.assign(new Error('meal referenced'), { name: 'MealReferencedError', refs });
  }
  await del(STORE, id);
  emit('meals:changed', {});
}

export const getMeal = (id) => get(STORE, id);
export const getAllMeals = () => getAll(STORE);
export async function getActiveMeals() {
  const rows = await getAllByIndex(STORE, 'status', IDBKeyRange.only('active'));
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
}
export async function getArchivedMeals() {
  const rows = await getAllByIndex(STORE, 'status', IDBKeyRange.only('archived'));
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
}

/** Case-insensitive name search among active meals. */
export async function searchMeals(term) {
  const t = clean(term).toLowerCase();
  const rows = await getActiveMeals();
  if (!t) return rows;
  return rows.filter((m) => m.name.toLowerCase().includes(t));
}
