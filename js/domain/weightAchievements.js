// weightAchievements.js — PURE composer that derives everything the weight UI
// needs from the factual official timeline + the active goal plan. Nothing here
// is stored as source of truth; it is recomputed on every edit, so corrections
// and deletions automatically reassign milestone dates, lows, and completion.
//
// Achievements (restrained): new lowest, milestone reached, final goal reached.
//
// Dedupe requirement: if a milestone's target weight equals the final goal
// weight, the same qualifying weigh-in must not surface as two separate
// achievements for the same target. Such milestones are flagged
// `sameAsFinal` and excluded from the distinct milestone achievements and from
// per-entry decorations; the final-goal achievement represents that target.

import {
  officialTimeline, movingAverage7, runningLows, firstQualifying,
} from './weightStats.js';
import { buildAnchors, expectedWeightAt, classifyTrajectory } from './trajectory.js';
import { todayLocal } from '../core/dates.js';

const EPS = 1e-9;
const sameWeight = (a, b) => Math.abs(a - b) < EPS;

/**
 * @param {Array} entries        all weight entries (official + not)
 * @param {object|null} plan     active goal plan
 * @param {Array} milestones     milestones for the plan (any order)
 * @param {object} opts          { toleranceKg, asOfDate }
 *
 * As-of semantics: `asOfDate` defaults to TODAY. All current/as-of calculations
 * (latest context, 7-day moving average, remaining-to-goal, trajectory, and
 * milestone/final status) consider only official weigh-ins with
 * localDate <= asOfDate, so a future-dated weigh-in never changes today's status.
 * Goal achievements additionally consider only weigh-ins on or after the active
 * plan's startDate, so a weight recorded before the plan started can't satisfy
 * the plan's milestones or final goal.
 */
export function computeWeightSummary(entries, plan, milestones = [], opts = {}) {
  const toleranceKg = opts.toleranceKg ?? 0.5;
  const asOfDate = opts.asOfDate || todayLocal();

  // Full official timeline (for history rendering / previous-official lookups)…
  const timeline = officialTimeline(entries);
  // …and the as-of view used for every current calculation (never the future).
  const current = timeline.filter((e) => e.localDate <= asOfDate);
  const latest = current.length ? current[current.length - 1] : null;

  const { lows, lowest } = runningLows(current);
  const movingAvg = movingAverage7(current, asOfDate);

  // --- milestones: only weigh-ins within [plan.startDate, asOfDate] qualify ---
  const finalWeight = plan ? plan.finalWeight : null;
  const goalTimeline = plan ? current.filter((e) => e.localDate >= plan.startDate) : current;
  const msSorted = milestones.slice().sort((a, b) =>
    (a.targetDate < b.targetDate ? -1 : a.targetDate > b.targetDate ? 1 : 0));

  const milestoneStatus = msSorted.map((m) => {
    const q = firstQualifying(goalTimeline, m.targetWeight);
    return {
      id: m.id,
      label: m.label || '',
      targetWeight: m.targetWeight,
      targetDate: m.targetDate,
      reached: !!q,
      achievedDate: q ? q.localDate : null,
      achievedEntryId: q ? q.id : null,
      sameAsFinal: plan ? sameWeight(m.targetWeight, finalWeight) : false,
    };
  });

  // --- final goal (same [startDate, asOfDate] range) ---
  let finalStatus = null;
  if (plan) {
    const q = firstQualifying(goalTimeline, finalWeight);
    finalStatus = {
      targetWeight: finalWeight,
      targetDate: plan.finalDate,
      reached: !!q,
      achievedDate: q ? q.localDate : null,
      achievedEntryId: q ? q.id : null,
    };
  }

  // --- next unreached target (skip milestones equal to final; final covers them) ---
  let next = null;
  if (plan) {
    const nextMs = milestoneStatus.find((m) => !m.reached && !m.sameAsFinal);
    if (nextMs) {
      next = { kind: 'milestone', targetWeight: nextMs.targetWeight, targetDate: nextMs.targetDate };
    } else if (finalStatus && !finalStatus.reached) {
      next = { kind: 'final', targetWeight: finalStatus.targetWeight, targetDate: finalStatus.targetDate };
    }
    if (next && latest) next.remainingKg = Math.max(0, latest.weightKg - next.targetWeight);
  }

  // --- trajectory (compare latest official vs expected line at its date) ---
  let trajectory = { status: null, deltaKg: null, expected: null };
  if (plan && latest) {
    const anchors = buildAnchors(plan, milestones);
    const expected = expectedWeightAt(anchors, latest.localDate);
    trajectory = classifyTrajectory(expected, latest.weightKg, toleranceKg);
  }

  // --- per-entry decorations for history rows (new low + achieved target) ---
  // A milestone tag is attached to the entry that FIRST achieved it. Milestones
  // equal to the final are not tagged as milestones; the final tag is used.
  const decorations = new Map();
  const ensure = (id) => {
    if (!decorations.has(id)) decorations.set(id, { newLow: false, tags: [] });
    return decorations.get(id);
  };
  for (const id of lows) ensure(id).newLow = true;
  for (const m of milestoneStatus) {
    if (m.reached && !m.sameAsFinal) {
      ensure(m.achievedEntryId).tags.push({
        type: 'milestone', targetWeight: m.targetWeight, label: m.label,
      });
    }
  }
  if (finalStatus && finalStatus.reached) {
    ensure(finalStatus.achievedEntryId).tags.push({ type: 'final', targetWeight: finalStatus.targetWeight });
  }

  // --- distinct achievements for a summary list (deduped) ---
  const achievements = [];
  for (const m of milestoneStatus) {
    if (m.reached && !m.sameAsFinal) {
      achievements.push({ type: 'milestone', targetWeight: m.targetWeight, label: m.label, date: m.achievedDate });
    }
  }
  if (finalStatus && finalStatus.reached) {
    achievements.push({ type: 'final', targetWeight: finalStatus.targetWeight, date: finalStatus.achievedDate });
  }

  return {
    timeline, current, latest, movingAvg, lowest, lows,
    milestones: milestoneStatus, finalStatus, next, trajectory,
    decorations, achievements,
  };
}
