// data/backup.js — full backup export & restore.
//
// Backups are human-readable JSON with metadata and every store's records. The
// TRANSFORM core (serialize / validate / plan) is pure and tested; the DB layer
// is a thin executor. Restore NEVER deletes or resets the database — Replace
// clears each store's RECORDS (store.clear()) inside one transaction, preserving
// the database and its v1 schema. Merge is additive-by-key and re-normalizes the
// weight official invariant afterward.

import { getAll, tx, reqAsPromise, SCHEMA_VERSION } from '../core/db.js';
import { APP_VERSION } from '../core/meta.js';
import { emit } from '../core/events.js';
import { now, todayLocal, isValidLocalDate } from '../core/dates.js';
import { chooseOfficialId } from '../domain/weightStats.js';

export const BACKUP_FORMAT_VERSION = 1;

// Every v1 store, with its key path (for merge de-duplication).
export const BACKUP_STORES = [
  'settings', 'targetHistory', 'meals', 'nutritionEntries', 'nutritionDays',
  'weightEntries', 'goalPlans', 'milestones', 'exercises', 'routines',
  'routineDays', 'routineExercises', 'workoutSessions', 'workoutSets', 'exerciseStats',
];

// Derived / cache stores: raw factual records are authoritative. These are never
// restored as factual state — a stale cache from a backup must never override or
// disagree with restored raw workout history. They are cleared on Replace and
// left empty (rebuilt on demand from raw sets if/when the cache is used).
export const DERIVED_STORES = new Set(['exerciseStats']);

function keyOf(store) {
  if (store === 'settings') return 'key';
  if (store === 'nutritionDays') return 'localDate';
  if (store === 'exerciseStats') return 'exerciseId';
  return 'id';
}

const isStr = (v) => typeof v === 'string' && v.length > 0;
const isFin = (v) => Number.isFinite(Number(v));

// Per-record validators for each factual store (derived stores are skipped).
// Each returns true when the record is structurally usable.
const RECORD_VALID = {
  settings: (r) => isStr(r.key) && 'value' in r,
  targetHistory: (r) => isStr(r.id) && (r.type === 'calorie' || r.type === 'protein') && isFin(r.value) && isValidLocalDate(r.effectiveFrom),
  meals: (r) => isStr(r.id) && isStr(r.name),
  nutritionEntries: (r) => isStr(r.id) && isValidLocalDate(r.localDate) && (r.sourceMealId == null || typeof r.sourceMealId === 'string'),
  nutritionDays: (r) => isValidLocalDate(r.localDate),
  weightEntries: (r) => isStr(r.id) && isFin(r.weightKg) && isValidLocalDate(r.localDate),
  goalPlans: (r) => isStr(r.id) && isFin(r.startWeight) && isFin(r.finalWeight) && isValidLocalDate(r.startDate) && isValidLocalDate(r.finalDate),
  milestones: (r) => isStr(r.id) && isStr(r.planId) && isFin(r.targetWeight) && isValidLocalDate(r.targetDate),
  exercises: (r) => isStr(r.id) && isStr(r.name),
  routines: (r) => isStr(r.id) && isStr(r.name),
  routineDays: (r) => isStr(r.id) && isStr(r.routineId),
  routineExercises: (r) => isStr(r.id) && isStr(r.routineDayId) && isStr(r.exerciseId),
  workoutSessions: (r) => isStr(r.id) && isValidLocalDate(r.localDate),
  workoutSets: (r) => isStr(r.id) && isStr(r.sessionId) && isStr(r.exerciseId),
};

// Child → parent references that must resolve (inside a backup for Replace, and
// after a Merge). `optional` refs may be null/empty.
const PARENT_REFS = {
  milestones: [{ field: 'planId', store: 'goalPlans' }],
  routineDays: [{ field: 'routineId', store: 'routines' }],
  routineExercises: [{ field: 'routineDayId', store: 'routineDays' }, { field: 'exerciseId', store: 'exercises' }],
  workoutSets: [{ field: 'sessionId', store: 'workoutSessions' }, { field: 'exerciseId', store: 'exercises' }],
  nutritionEntries: [{ field: 'sourceMealId', store: 'meals', optional: true }],
};

// ---------- PURE core ----------

/** Build the backup object from per-store record arrays + metadata. */
export function serializeBackup(dataByStore, meta = {}) {
  const data = {};
  for (const s of BACKUP_STORES) data[s] = Array.isArray(dataByStore[s]) ? dataByStore[s] : [];
  return {
    format: 'fitness-pwa-backup',
    backupFormatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: meta.schemaVersion ?? SCHEMA_VERSION,
    appVersion: meta.appVersion ?? APP_VERSION,
    exportTimestamp: meta.exportTimestamp ?? now(),
    data,
  };
}

/** Validate structure, version, records, keys, and INTERNAL referential
 * integrity BEFORE touching the DB. Comprehensive enough that a passing backup is
 * safe to Replace with (Replace clears every store first). Derived stores are
 * only checked to be arrays — their content is never trusted. */
export function validateBackup(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object') return { ok: false, errors: ['ملف غير صالح.'] };
  if (obj.format !== 'fitness-pwa-backup') errors.push('التنسيق غير معروف.');
  if (!Number.isInteger(obj.backupFormatVersion)) errors.push('إصدار تنسيق النسخة مفقود.');
  else if (obj.backupFormatVersion > BACKUP_FORMAT_VERSION) errors.push('النسخة أحدث من إصدار التطبيق المدعوم.');
  if (obj.schemaVersion != null && (!Number.isInteger(obj.schemaVersion) || obj.schemaVersion > SCHEMA_VERSION)) errors.push('مخطط البيانات غير مدعوم.');
  if (!obj.data || typeof obj.data !== 'object') {
    return { ok: false, errors: [...errors, 'لا توجد بيانات في الملف.'] };
  }

  // 1) every store present as an array (Replace clears all → missing = data loss)
  for (const s of BACKUP_STORES) {
    if (!(s in obj.data)) errors.push(`قسم مفقود: "${s}".`);
    else if (!Array.isArray(obj.data[s])) errors.push(`قسم "${s}" تالف.`);
  }
  if (errors.length) return { ok: false, errors };

  // 2) per-record validity + primary-key presence + no duplicate keys per store
  const idSets = {};
  for (const s of BACKUP_STORES) {
    const k = keyOf(s);
    const rows = obj.data[s];
    const seen = new Set();
    const valid = RECORD_VALID[s]; // undefined for derived stores
    for (const r of rows) {
      if (!r || typeof r !== 'object') { errors.push(`سجل تالف في "${s}".`); continue; }
      const key = r[k];
      if (typeof key !== 'string' || key.length === 0) { errors.push(`مفتاح غير صالح في "${s}".`); continue; }
      if (seen.has(key)) { errors.push(`مفتاح مكرر في "${s}": ${key}.`); continue; }
      seen.add(key);
      if (valid && !valid(r)) errors.push(`سجل غير صالح في "${s}": ${key}.`);
    }
    idSets[s] = seen;
  }

  // 3) internal referential integrity (orphan child ⇒ reject before any write)
  for (const s of Object.keys(PARENT_REFS)) {
    for (const r of obj.data[s]) {
      if (!r || typeof r !== 'object') continue;
      for (const ref of PARENT_REFS[s]) {
        const v = r[ref.field];
        if (ref.optional && (v == null || v === '')) continue;
        if (!idSets[ref.store] || !idSets[ref.store].has(v)) {
          errors.push(`سجل بلا مرجع صحيح في "${s}" (${ref.field}→${ref.store}).`);
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, backupFormatVersion: obj.backupFormatVersion, schemaVersion: obj.schemaVersion };
}

/**
 * PURE restore plan.
 * @param obj      backup object
 * @param mode     'replace' | 'merge'
 * @param existing {store: Set(keys)} for merge de-duplication
 * @returns { clear:boolean, puts:{store:records[]}, skipped:{store:count} }
 */
export function planRestore(obj, mode, existing = {}) {
  const puts = {}, skipped = {};
  for (const s of BACKUP_STORES) {
    const rows = Array.isArray(obj.data?.[s]) ? obj.data[s] : [];
    if (mode === 'replace') { puts[s] = rows; skipped[s] = 0; continue; }
    const have = existing[s] || new Set();
    const k = keyOf(s);
    const add = []; let skip = 0;
    for (const r of rows) { if (have.has(r[k])) skip++; else add.push(r); } // additive only
    puts[s] = add; skipped[s] = skip;
  }
  return { clear: mode === 'replace', puts, skipped };
}

/** PURE: re-derive the one-official-per-date invariant across weight rows. */
export function renormalizeWeights(weightRows) {
  const byDate = new Map();
  for (const r of weightRows) { if (!byDate.has(r.localDate)) byDate.set(r.localDate, []); byDate.get(r.localDate).push(r); }
  const out = [];
  for (const rows of byDate.values()) {
    const officialId = chooseOfficialId(rows, undefined);
    for (const r of rows) out.push({ ...r, isOfficial: r.id === officialId ? 1 : 0 });
  }
  return out;
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) if (!deepEqual(a[k], b[k])) return false;
    return true;
  }
  return false;
}

/**
 * PURE, relationally-validated MERGE plan. Merge is additive-by-key only, but
 * "additive" is not automatically safe: if an imported record collides with an
 * existing one whose content DIFFERS, the backup's version is silently dropped —
 * and any imported child pointing at the backup's version could be mis-linked.
 * So this planner:
 *   - flags CONFLICTS: an id exists on both sides but the records are not
 *     structurally equal (existing wins under additive merge, so this is unsafe);
 *   - flags ORPHANS: a to-be-added child whose referenced parent will not exist
 *     after the merge (existing parents ∪ added parents);
 * and refuses (ok:false) if either occurs, before any write.
 * @param existingByStore {store: records[]}
 */
export function planMerge(obj, existingByStore = {}) {
  const puts = {}, skipped = {}, conflicts = [], orphans = [], errors = [];
  const existingByKey = {}, postKeys = {};
  for (const s of BACKUP_STORES) {
    const k = keyOf(s);
    const ex = existingByStore[s] || [];
    existingByKey[s] = new Map(ex.map((r) => [r[k], r]));
    postKeys[s] = new Set(ex.map((r) => r[k]));
  }
  for (const s of BACKUP_STORES) {
    const k = keyOf(s);
    const rows = Array.isArray(obj.data?.[s]) ? obj.data[s] : [];
    const add = []; let skip = 0;
    for (const r of rows) {
      const key = r[k];
      if (existingByKey[s].has(key)) {
        if (!deepEqual(existingByKey[s].get(key), r)) conflicts.push({ store: s, id: key });
        skip++; // existing kept (already in postKeys)
      } else {
        add.push(r);
        postKeys[s].add(key); // will exist after the merge
      }
    }
    puts[s] = add; skipped[s] = skip;
  }
  // referential integrity for records that would be ADDED
  for (const s of Object.keys(PARENT_REFS)) {
    for (const r of puts[s]) {
      for (const ref of PARENT_REFS[s]) {
        const v = r[ref.field];
        if (ref.optional && (v == null || v === '')) continue;
        if (!postKeys[ref.store].has(v)) orphans.push({ store: s, id: r[keyOf(s)], ref: ref.field, parent: ref.store });
      }
    }
  }
  if (conflicts.length) errors.push(`تعارض في المعرّفات (${conflicts.length}): توجد سجلات بالمعرّف نفسه لكن بمحتوى مختلف. الدمج غير آمن — استخدم الاستبدال الكامل.`);
  if (orphans.length) errors.push(`الدمج سيُنشئ سجلات بلا مرجع صحيح (${orphans.length}).`);
  return { ok: errors.length === 0, errors, conflicts, orphans, puts, skipped };
}

// ---------- DB executor ----------

export async function exportBackup() {
  const dataByStore = {};
  for (const s of BACKUP_STORES) dataByStore[s] = await getAll(s);
  return serializeBackup(dataByStore, {});
}

export async function importBackup(obj, { mode = 'replace' } = {}) {
  const v = validateBackup(obj);
  if (!v.ok) throw Object.assign(new Error('invalid backup'), { name: 'ValidationError', errors: v.errors });

  let plan;
  if (mode === 'merge') {
    const existingByStore = {};
    for (const s of BACKUP_STORES) existingByStore[s] = await getAll(s);
    const mp = planMerge(obj, existingByStore); // relational validation BEFORE any write
    if (!mp.ok) throw Object.assign(new Error('unsafe merge'), { name: 'ValidationError', errors: mp.errors, conflicts: mp.conflicts, orphans: mp.orphans });
    plan = { clear: false, puts: mp.puts, skipped: mp.skipped };
  } else {
    plan = planRestore(obj, 'replace', {});
  }

  await tx(BACKUP_STORES, 'readwrite', async (t) => {
    for (const s of BACKUP_STORES) {
      const store = t.objectStore(s);
      if (DERIVED_STORES.has(s)) {
        // Derived cache: clear on Replace, never restore imported rows as factual.
        if (plan.clear) await reqAsPromise(store.clear());
        continue;
      }
      if (plan.clear) await reqAsPromise(store.clear()); // records only — DB & schema intact
      for (const r of plan.puts[s]) await reqAsPromise(store.put(r));
    }
  });

  // Merge can bring two "official" weigh-ins onto one date; re-normalize.
  if (mode === 'merge') {
    await tx('weightEntries', 'readwrite', async (t) => {
      const store = t.objectStore('weightEntries');
      const all = await reqAsPromise(store.getAll());
      for (const r of renormalizeWeights(all)) await reqAsPromise(store.put(r));
    });
  }

  for (const topic of ['weight', 'goals', 'nutrition', 'meals', 'workout', 'exercises', 'routines', 'settings']) emit(`${topic}:changed`, {});
  return { mode, counts: Object.fromEntries(BACKUP_STORES.map((s) => [s, DERIVED_STORES.has(s) ? 0 : plan.puts[s].length])), skipped: plan.skipped };
}

export function backupFilename(date = todayLocal()) { return `fitness-backup-${date}.json`; }

/** Trigger a local download (Blob object URL — no network). */
export function downloadBackup(obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = backupFilename();
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
