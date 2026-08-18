// domain/milestoneGen.js — pure milestone-sequence generation and conflict
// merging. No DOM, no IO. Produces ordinary milestone objects
// ({ targetWeight, targetDate, label }) that the existing goals architecture
// stores; it never creates a separate store or its own achievement truth.

import { parseLocalDate, toLocalDate, isValidLocalDate } from '../core/dates.js';

export const FREQUENCIES = [
  { key: 'daily', label: 'يوميًا', days: 1 },
  { key: 'weekly', label: 'أسبوعيًا', days: 7 },
  { key: 'biweekly', label: 'كل أسبوعين', days: 14 },
  { key: 'monthly', label: 'شهريًا', month: 1 },
];

const MAX_MILESTONES = 200; // safety cap against runaway sequences

/** Advance a "YYYY-MM-DD" by k intervals of the given frequency. */
export function advanceDate(startDate, frequency, k) {
  const freq = FREQUENCIES.find((f) => f.key === frequency);
  if (!freq) return startDate;
  if (freq.month) {
    const d = parseLocalDate(startDate);
    d.setMonth(d.getMonth() + freq.month * k);
    return toLocalDate(d);
  }
  const d = parseLocalDate(startDate);
  d.setDate(d.getDate() + freq.days * k);
  return toLocalDate(d);
}

/** Round to 1 decimal to avoid binary-float drift (0.5 kg steps stay exact). */
function r1(n) { return Math.round(n * 10) / 10; }

/**
 * Generate a milestone sequence for the checkpoints strictly BETWEEN start and
 * final weight, in `step` increments at the given frequency. The start weight
 * (where the user is) and the final weight (the plan's goal) are the plan's own
 * endpoints and are NOT emitted as milestones — the existing goal engine tracks
 * them and only accepts milestones strictly between them. Checkpoint k (k=1,2,…)
 * has weight start±k·step and date startDate + k·interval; the sequence stops
 * before reaching finalWeight (never emits a value at/past the goal).
 *
 * Example: 105.5 → 95 @0.5 weekly from 22 Aug ⇒ 105.0 (29 Aug) … 95.5 = 20
 * checkpoints; 95.0 is the plan's final goal, shown separately on the timeline.
 *
 * @returns { ok:true, milestones:[{targetWeight,targetDate,label}] } | { ok:false, error }
 */
export function generateMilestones({ startWeight, finalWeight, step, startDate, frequency }) {
  const sw = Number(startWeight), fw = Number(finalWeight), st = Number(step);
  if (!Number.isFinite(sw) || sw <= 0) return { ok: false, error: 'أدخل وزن بداية صحيحًا.' };
  if (!Number.isFinite(fw) || fw <= 0) return { ok: false, error: 'أدخل وزن هدف صحيحًا.' };
  if (!Number.isFinite(st) || st <= 0) return { ok: false, error: 'أدخل مقدار تغيّر صحيحًا لكل مرحلة.' };
  if (!isValidLocalDate(startDate)) return { ok: false, error: 'أدخل تاريخ بداية صحيحًا.' };
  if (!frequency || !FREQUENCIES.some((f) => f.key === frequency)) return { ok: false, error: 'اختر التكرار.' };
  if (r1(sw) === r1(fw)) return { ok: false, error: 'وزن البداية والهدف متطابقان.' };
  if (Math.abs(r1(fw) - r1(sw)) <= st) return { ok: false, error: 'المقدار أكبر من الفرق بين البداية والهدف؛ لا مراحل بينهما.' };

  const losing = fw < sw;               // direction of change
  const delta = losing ? -st : st;
  const goal = r1(fw);
  const milestones = [];
  for (let k = 1; milestones.length < MAX_MILESTONES; k++) {
    const w = r1(sw + delta * k);
    // strictly between start and final: stop once we reach or pass the goal
    if (losing ? w <= goal : w >= goal) break;
    milestones.push({ targetWeight: w, targetDate: advanceDate(startDate, frequency, k), label: '' });
  }
  if (milestones.length >= MAX_MILESTONES) {
    return { ok: false, error: 'عدد المراحل كبير جدًا. زد مقدار التغيّر لكل مرحلة.' };
  }
  return { ok: true, milestones };
}

/** Two milestones are "the same slot" when weight AND date match. */
function sameSlot(a, b) {
  return r1(Number(a.targetWeight)) === r1(Number(b.targetWeight)) && a.targetDate === b.targetDate;
}

/**
 * Merge generated milestones into existing ones by strategy. Pure — returns a
 * new array to hand to updatePlan (which writes atomically). `reachedWeights`
 * is the set of targetWeights already achieved (from the derived summary) so the
 * "replace planned" strategy can preserve achieved history.
 *
 * strategies:
 *  - 'add'     : keep all existing, append generated that aren't duplicate slots
 *  - 'replace' : keep achieved existing milestones, drop unreached, add generated
 *  - (no existing) : just the generated
 */
export function mergeMilestones(existing, generated, strategy, reachedWeights = new Set()) {
  const ex = existing || [];
  if (!ex.length) return generated.slice();

  if (strategy === 'add') {
    const out = ex.slice();
    for (const g of generated) if (!out.some((e) => sameSlot(e, g))) out.push(g);
    return out;
  }
  if (strategy === 'replace') {
    const keep = ex.filter((e) => reachedWeights.has(r1(Number(e.targetWeight))));
    const out = keep.slice();
    for (const g of generated) if (!out.some((e) => sameSlot(e, g))) out.push(g);
    return out;
  }
  return ex.slice(); // unknown strategy → no change (caller guards)
}

/** Normalize milestones to the storage shape and sort by date for validation. */
export function toStorageMilestones(milestones) {
  return milestones
    .map((m) => ({ targetWeight: r1(Number(m.targetWeight)), targetDate: m.targetDate, label: String(m.label || '') }))
    .sort((a, b) => (a.targetDate < b.targetDate ? -1 : a.targetDate > b.targetDate ? 1 : 0));
}

/**
 * The date the final goal is reached by a generated schedule: one frequency
 * interval after the last between-checkpoint (i.e. the step that lands on the
 * goal). For an empty schedule (step ≥ gap) it's one interval after startDate.
 * Pure; used to detect/repair a plan finalDate that is too early.
 */
export function requiredFinalDate(generated, startDate, frequency) {
  const n = (generated && generated.length) ? generated.length : 0;
  return advanceDate(startDate, frequency, n + 1);
}
