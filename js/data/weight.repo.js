// weight.repo.js — weight entries data access.
//
// Enforces the official-daily-weight invariant INSIDE each write transaction:
// a date with any entries has exactly one official; promoting one clears its
// siblings; deleting/moving the official promotes another. The pure decision
// lives in domain/weightStats.chooseOfficialId (unit-tested); this module only
// applies it against IndexedDB.

import { tx, reqAsPromise, getAll, getAllByIndex } from '../core/db.js';
import { uuid } from '../core/ids.js';
import { now, todayLocal, toLocalTime, isValidLocalDate, isValidLocalTime } from '../core/dates.js';
import { emit } from '../core/events.js';
import { chooseOfficialId, byDateTime, addOfficialPreference, moveOfficialDecision } from '../domain/weightStats.js';

const STORE = 'weightEntries';

// Sane human upper bound in kg (exclusive), matching the UI's documented bound.
export const MAX_WEIGHT_KG = 700;

/**
 * Validate the resolved factual values of a weight entry. The repository is the
 * integrity boundary — the UI's friendly checks are advisory only.
 * @returns {string[]} error messages (empty = valid)
 */
export function validateWeightValues({ weightKg, localDate, time }) {
  const errors = [];
  const w = Number(weightKg);
  if (!Number.isFinite(w)) errors.push('الوزن يجب أن يكون رقمًا صحيحًا.');
  else if (w <= 0) errors.push('الوزن يجب أن يكون أكبر من صفر.');
  else if (w >= MAX_WEIGHT_KG) errors.push('الوزن يتجاوز الحد المعقول.');
  if (!isValidLocalDate(localDate)) errors.push('التاريخ غير صالح.');
  if (time != null && time !== '' && !isValidLocalTime(time)) errors.push('الوقت غير صالح.');
  return errors;
}

function assertWeightValid(vals) {
  const errors = validateWeightValues(vals);
  if (errors.length) throw Object.assign(new Error('weight invalid'), { name: 'ValidationError', errors });
}

/** Read all entries on a date (within a txn store), unsorted. */
async function rowsForDate(store, localDate) {
  return reqAsPromise(store.index('localDate').getAll(IDBKeyRange.only(localDate)));
}

/**
 * Apply the official invariant for one date within an open txn.
 * @param preferredId  optional id to force official (promotion / sole new entry)
 */
async function normalizeOfficial(store, localDate, preferredId) {
  const rows = await rowsForDate(store, localDate);
  const officialId = chooseOfficialId(rows, preferredId);
  for (const r of rows) {
    const want = r.id === officialId ? 1 : 0;
    if (r.isOfficial !== want) {
      r.isOfficial = want;
      r.updatedAt = now();
      await reqAsPromise(store.put(r));
    }
  }
}

/**
 * Add a weight entry.
 * @param {object} p
 * @param {number} p.weightKg
 * @param {string} [p.localDate]  defaults to today (local)
 * @param {string} [p.time]       "HH:mm"; defaults to now (local)
 * @param {string} [p.note]
 * @param {boolean} [p.makeOfficial]  force official; if omitted, a sole first
 *        entry of the date auto-becomes official and additional entries do not.
 * @returns {Promise<string>} new id
 */
export async function addWeight(p) {
  const id = uuid();
  const ts = now();
  const localDate = p.localDate || todayLocal();
  const time = p.time != null ? p.time : toLocalTime();
  assertWeightValid({ weightKg: p.weightKg, localDate, time });
  const entry = {
    id,
    weightKg: Number(p.weightKg),
    localDate,
    time,
    note: String(p.note || ''),
    isOfficial: 0,
    createdAt: ts,
    updatedAt: ts,
  };
  await tx(STORE, 'readwrite', async (t) => {
    const store = t.objectStore(STORE);
    await reqAsPromise(store.put(entry));
    const rows = await rowsForDate(store, entry.localDate);
    // Sole first entry auto-official; an added measurement on a date that already
    // has an official stays non-official unless the user opted in (makeOfficial).
    const preferred = addOfficialPreference(rows.length, p.makeOfficial, id);
    await normalizeOfficial(store, entry.localDate, preferred);
  });
  emit('weight:changed', { localDate: entry.localDate });
  return id;
}

/**
 * Update an entry. Handles weight/date/time/note and optional promotion.
 * Moving to another date re-normalizes both the old and the new date.
 * @param {string} id
 * @param {object} patch  any of {weightKg, localDate, time, note, makeOfficial}
 */
export async function updateWeight(id, patch) {
  await tx(STORE, 'readwrite', async (t) => {
    const store = t.objectStore(STORE);
    const cur = await reqAsPromise(store.get(id));
    if (!cur) throw new Error('weight entry not found');
    const oldDate = cur.localDate;

    const next = { ...cur };
    if ('weightKg' in patch) next.weightKg = Number(patch.weightKg);
    if ('localDate' in patch) next.localDate = patch.localDate;
    if ('time' in patch) next.time = patch.time;
    if ('note' in patch) next.note = String(patch.note || '');
    next.updatedAt = now();

    // Validate the fully-merged entry before any write/normalization.
    assertWeightValid({ weightKg: next.weightKg, localDate: next.localDate, time: next.time });

    const promote = patch.makeOfficial === true;
    if (next.localDate !== oldDate) {
      // Moving dates: do NOT carry the old official flag into the destination.
      // Unless the user promotes it, the moved entry arrives non-official so the
      // destination's existing official is preserved; if the destination has no
      // official, the invariant promotes the moved entry.
      const { movedFlag, preferred } = moveOfficialDecision({ movedId: id, makeOfficial: promote });
      next.isOfficial = movedFlag;
      await reqAsPromise(store.put(next));
      await normalizeOfficial(store, oldDate, undefined);            // old date may need a new official
      await normalizeOfficial(store, next.localDate, preferred);
    } else {
      // Same date: keep official assignment stable unless explicitly promoting.
      await reqAsPromise(store.put(next));
      const preferred = promote ? id : (next.isOfficial === 1 ? id : undefined);
      await normalizeOfficial(store, next.localDate, preferred);
    }
  });
  emit('weight:changed', {});
}

/** Promote an entry to be the official daily weight for its date. */
export async function setOfficial(id) {
  await tx(STORE, 'readwrite', async (t) => {
    const store = t.objectStore(STORE);
    const cur = await reqAsPromise(store.get(id));
    if (!cur) throw new Error('weight entry not found');
    await normalizeOfficial(store, cur.localDate, id);
  });
  emit('weight:changed', {});
}

/** Delete an entry; if it was official, another entry on that date is promoted. */
export async function deleteWeight(id) {
  await tx(STORE, 'readwrite', async (t) => {
    const store = t.objectStore(STORE);
    const cur = await reqAsPromise(store.get(id));
    if (!cur) return;
    await reqAsPromise(store.delete(id));
    await normalizeOfficial(store, cur.localDate, undefined);
  });
  emit('weight:changed', {});
}

// ---- reads ----

/** All entries on a date, sorted chronologically (time then createdAt). */
export async function getEntriesForDate(localDate) {
  const rows = await getAllByIndex(STORE, 'localDate', IDBKeyRange.only(localDate));
  return rows.sort(byDateTime);
}

/** All weight entries whose localDate is within [from,to] (bounded index scan,
 * not a full-store scan). Sorted by (localDate, time). */
export async function getEntriesInRange(from, to) {
  const rows = await getAllByIndex(STORE, 'localDate', IDBKeyRange.bound(from, to));
  return rows.sort(byDateTime);
}

/** Today's official entry, or null. */
export async function getTodayOfficial() {
  const rows = await getEntriesForDate(todayLocal());
  return rows.find((r) => r.isOfficial === 1) || null;
}

/** Every entry (used for full-history derivations; official count is bounded). */
export async function getAllEntries() {
  return getAll(STORE);
}

/** Official entries within an inclusive date range (for charts, later stages). */
export async function getOfficialInRange(from, to) {
  const rows = await getAllByIndex(STORE, 'localDate', IDBKeyRange.bound(from, to));
  return rows.filter((r) => r.isOfficial === 1).sort(byDateTime);
}
