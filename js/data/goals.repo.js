// goals.repo.js — weight goal plans + milestones data access.
//
// Only one plan is active at a time; creating/activating a plan archives the
// others. Editing a goal never touches weigh-ins. Saves are validated by the
// pure validator first and REJECTED on invalid input (no silent repair). The
// repo re-validates defensively and throws a ValidationError the UI can show.

import { tx, reqAsPromise, getAllByIndex } from '../core/db.js';
import { uuid } from '../core/ids.js';
import { now } from '../core/dates.js';
import { emit } from '../core/events.js';
import { validateGoalPlan } from '../domain/goalValidation.js';

const PLANS = 'goalPlans';
const MILES = 'milestones';

export class ValidationError extends Error {
  constructor(errors) { super('goal validation failed'); this.name = 'ValidationError'; this.errors = errors; }
}

/** The active plan, or null. */
export async function getActivePlan() {
  const rows = await getAllByIndex(PLANS, 'status', IDBKeyRange.only('active'));
  return rows[0] || null;
}

/** Milestones for a plan, sorted by date (display/computation order). */
export async function getMilestones(planId) {
  const rows = await getAllByIndex(MILES, 'planId', IDBKeyRange.only(planId));
  return rows.sort((a, b) => (a.targetDate < b.targetDate ? -1 : a.targetDate > b.targetDate ? 1 : 0));
}

/** Active plan together with its milestones, or { plan:null, milestones:[] }. */
export async function getActivePlanWithMilestones() {
  const plan = await getActivePlan();
  const milestones = plan ? await getMilestones(plan.id) : [];
  return { plan, milestones };
}

export async function getAllPlans() {
  const active = await getAllByIndex(PLANS, 'status', IDBKeyRange.only('active'));
  const archived = await getAllByIndex(PLANS, 'status', IDBKeyRange.only('archived'));
  return [...active, ...archived];
}

/**
 * Create a new plan (+ milestones). Archives any currently active plan when
 * `activate` is true (default). Throws ValidationError on invalid input.
 * @returns {Promise<string>} new plan id
 */
export async function createPlan(planData, milestones = [], { activate = true } = {}) {
  const { ok, errors } = validateGoalPlan(planData, milestones);
  if (!ok) throw new ValidationError(errors);

  const id = uuid();
  const ts = now();
  const plan = {
    id,
    name: String(planData.name || 'خطة الوزن'),
    startWeight: Number(planData.startWeight),
    startDate: planData.startDate,
    finalWeight: Number(planData.finalWeight),
    finalDate: planData.finalDate,
    status: activate ? 'active' : 'archived',
    createdAt: ts,
    updatedAt: ts,
  };

  await tx([PLANS, MILES], 'readwrite', async (t) => {
    const plans = t.objectStore(PLANS);
    if (activate) {
      const actives = await reqAsPromise(plans.index('status').getAll(IDBKeyRange.only('active')));
      for (const a of actives) { a.status = 'archived'; a.updatedAt = ts; await reqAsPromise(plans.put(a)); }
    }
    await reqAsPromise(plans.put(plan));
    await writeMilestones(t, id, milestones, ts);
  });

  emit('goals:changed', {});
  return id;
}

/** Update an existing plan (+ replace its milestones). Throws ValidationError. */
export async function updatePlan(planId, planData, milestones = []) {
  const { ok, errors } = validateGoalPlan(planData, milestones);
  if (!ok) throw new ValidationError(errors);

  const ts = now();
  await tx([PLANS, MILES], 'readwrite', async (t) => {
    const plans = t.objectStore(PLANS);
    const cur = await reqAsPromise(plans.get(planId));
    if (!cur) throw new Error('plan not found');
    const next = {
      ...cur,
      name: String(planData.name ?? cur.name),
      startWeight: Number(planData.startWeight),
      startDate: planData.startDate,
      finalWeight: Number(planData.finalWeight),
      finalDate: planData.finalDate,
      updatedAt: ts,
    };
    await reqAsPromise(plans.put(next));
    // replace-all milestones for this plan
    const miles = t.objectStore(MILES);
    const existing = await reqAsPromise(miles.index('planId').getAll(IDBKeyRange.only(planId)));
    for (const m of existing) await reqAsPromise(miles.delete(m.id));
    await writeMilestones(t, planId, milestones, ts);
  });

  emit('goals:changed', {});
}

async function writeMilestones(t, planId, milestones, ts) {
  const miles = t.objectStore(MILES);
  // Preserve entered order via `order`; storage order is not a silent repair —
  // validation already ensured the entered sequence is consistent.
  for (let i = 0; i < milestones.length; i++) {
    const m = milestones[i];
    await reqAsPromise(miles.put({
      id: uuid(),
      planId,
      targetWeight: Number(m.targetWeight),
      targetDate: m.targetDate,
      label: String(m.label || ''),
      order: i,
      createdAt: ts,
    }));
  }
}

/** Archive a plan (kept for history; disappears from the active slot). */
export async function archivePlan(planId) {
  await tx(PLANS, 'readwrite', async (t) => {
    const store = t.objectStore(PLANS);
    const cur = await reqAsPromise(store.get(planId));
    if (!cur) return;
    cur.status = 'archived'; cur.updatedAt = now();
    await reqAsPromise(store.put(cur));
  });
  emit('goals:changed', {});
}

/** Make an archived plan active again (archives the current active). */
export async function activatePlan(planId) {
  const ts = now();
  await tx(PLANS, 'readwrite', async (t) => {
    const store = t.objectStore(PLANS);
    const actives = await reqAsPromise(store.index('status').getAll(IDBKeyRange.only('active')));
    for (const a of actives) { if (a.id !== planId) { a.status = 'archived'; a.updatedAt = ts; await reqAsPromise(store.put(a)); } }
    const cur = await reqAsPromise(store.get(planId));
    if (cur) { cur.status = 'active'; cur.updatedAt = ts; await reqAsPromise(store.put(cur)); }
  });
  emit('goals:changed', {});
}
