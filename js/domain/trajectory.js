// trajectory.js — PURE goal-trajectory math (no DB, no DOM).
//
// The expected weight on a date is linear interpolation between the surrounding
// anchor points (start → milestones → final), sorted by date. Outside the anchor
// range we clamp (no extrapolation → no fake precision). Classification uses a
// documented, configurable tolerance band (settings.trajectoryToleranceKg,
// default 0.5 kg) — a UI classification threshold, explicitly NOT medical.

import { parseLocalDate } from '../core/dates.js';

/** Whole-day difference b - a for two "YYYY-MM-DD" strings. */
function daysBetween(a, b) {
  return Math.round((parseLocalDate(b) - parseLocalDate(a)) / 86400000);
}

/**
 * Ordered anchor points for a plan: start, each milestone, final — sorted by
 * date ascending. Milestones are sorted here for COMPUTATION only; this never
 * rewrites the user's stored ordering.
 * @returns {Array<{date:string, weight:number}>}
 */
export function buildAnchors(plan, milestones = []) {
  if (!plan) return [];
  const pts = [
    { date: plan.startDate, weight: plan.startWeight },
    ...milestones.map((m) => ({ date: m.targetDate, weight: m.targetWeight })),
    { date: plan.finalDate, weight: plan.finalWeight },
  ];
  return pts.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * Expected (target-trajectory) weight on `date` via linear interpolation.
 * Clamps before the first / after the last anchor. Returns null with no anchors.
 */
export function expectedWeightAt(anchors, date) {
  if (!anchors || anchors.length === 0) return null;
  if (date <= anchors[0].date) return anchors[0].weight;
  const last = anchors[anchors.length - 1];
  if (date >= last.date) return last.weight;

  for (let i = 1; i < anchors.length; i++) {
    const a = anchors[i - 1], b = anchors[i];
    if (date >= a.date && date <= b.date) {
      const span = daysBetween(a.date, b.date);
      if (span === 0) return b.weight; // same-day anchors: no interpolation
      const frac = daysBetween(a.date, date) / span;
      return a.weight + (b.weight - a.weight) * frac;
    }
  }
  return last.weight; // unreachable given sorted anchors
}

/**
 * Classify actual vs expected for a weight-loss trajectory.
 *  - actual at/below expected−tol → 'ahead' (below the target line = ahead)
 *  - within ±tol                  → 'on'
 *  - actual at/above expected+tol → 'behind'
 * @returns {{status:'ahead'|'on'|'behind'|null, deltaKg:number|null, expected:number|null}}
 */
export function classifyTrajectory(expected, actual, toleranceKg) {
  if (expected == null || actual == null) return { status: null, deltaKg: null, expected };
  const delta = actual - expected; // negative = below target line = ahead
  let status = 'on';
  if (delta <= -toleranceKg) status = 'ahead';
  else if (delta >= toleranceKg) status = 'behind';
  return { status, deltaKg: delta, expected };
}
