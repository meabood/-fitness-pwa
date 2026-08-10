// domain/muscleMap.js — PURE mapping from an exercise's free-text `muscleGroup`
// to a small set of BROAD body regions, for the muscle visualization.
//
// HONESTY / LIMITATIONS (documented on purpose):
//   The exercise schema stores `muscleGroup` as a free-text string (Arabic or
//   Latin), not a controlled vocabulary. This module therefore uses keyword
//   matching to map that text to broad regions only — chest, back, shoulders,
//   biceps, triceps, forearms, core, glutes, quads, hamstrings, calves. It does
//   NOT infer activation percentages, fiber detail, or precise anatomy, and it
//   never modifies stored data. A group it cannot classify is simply left
//   unmapped (no false precision). Primary vs secondary emphasis is derived
//   only from how many of a day's exercises target a region — a presentation
//   heuristic, not a physiological claim.

export const REGIONS = [
  'chest', 'back', 'shoulders', 'biceps', 'triceps', 'forearms',
  'core', 'glutes', 'quads', 'hamstrings', 'calves',
];

export const REGION_LABEL_AR = {
  chest: 'صدر', back: 'ظهر', shoulders: 'أكتاف', biceps: 'بايسبس', triceps: 'ترايسبس',
  forearms: 'ساعد', core: 'بطن', glutes: 'ألوية', quads: 'أمامية الفخذ',
  hamstrings: 'خلفية الفخذ', calves: 'سمانة',
};

// Keyword → region. Arabic first, then common Latin synonyms. Order matters:
// more specific keys are checked, but each region collects all its cues.
const CUES = {
  chest: ['صدر', 'chest', 'pec', 'bench', 'ضغط صدر'],
  back: ['ظهر', 'back', 'lat', 'row', 'تجديف', 'سحب', 'pull'],
  shoulders: ['كتف', 'أكتاف', 'shoulder', 'delt', 'press', 'كتفية'],
  biceps: ['بايسبس', 'باي', 'bicep', 'ذراع أمامي', 'مرفق', 'curl'],
  triceps: ['ترايسبس', 'تراي', 'tricep', 'ذراع خلفي', 'extension'],
  forearms: ['ساعد', 'forearm', 'قبضة', 'grip', 'wrist'],
  core: ['بطن', 'core', 'abs', 'معدة', 'plank', 'جذع'],
  glutes: ['ألوية', 'مؤخرة', 'glute', 'hip', 'حوض'],
  quads: ['أمامية الفخذ', 'رباعية', 'quad', 'فخذ أمامي', 'squat', 'قرفصاء', 'leg press', 'أرجل', 'رجل', 'leg', 'legs'],
  hamstrings: ['خلفية الفخذ', 'hamstring', 'فخذ خلفي', 'deadlift', 'رفعة مميتة'],
  calves: ['سمانة', 'calf', 'calves', 'ساق', 'بطة'],
};

/** Map a single free-text muscle-group string to a region key, or null. */
export function groupToRegion(text) {
  if (!text) return null;
  const t = String(text).toLowerCase();
  for (const region of REGIONS) {
    for (const cue of CUES[region]) {
      if (t.includes(cue.toLowerCase())) return region;
    }
  }
  return null;
}

/**
 * Given the exercises represented in a routine/day (each may carry a
 * `muscleGroup` and/or a `name`), return the broad regions involved with a
 * primary/secondary split.
 *   - A region hit by >=2 exercises (or by the single exercise when only one
 *     exists) is `primary`; a region hit once alongside others is `secondary`.
 * This is purely a display emphasis heuristic.
 * @param {Array<{muscleGroup?:string,name?:string}>} exercises
 * @returns {{ primary:Set<string>, secondary:Set<string>, counts:Object, unmapped:number }}
 */
export function regionsForExercises(exercises = []) {
  const counts = {};
  let unmapped = 0;
  for (const ex of exercises) {
    const region = groupToRegion(ex.muscleGroup) || groupToRegion(ex.name);
    if (!region) { unmapped++; continue; }
    counts[region] = (counts[region] || 0) + 1;
  }
  const hit = Object.keys(counts);
  const primary = new Set();
  const secondary = new Set();
  const total = hit.reduce((n, r) => n + counts[r], 0);
  for (const r of hit) {
    if (counts[r] >= 2 || total === counts[r]) primary.add(r);
    else secondary.add(r);
  }
  return { primary, secondary, counts, unmapped };
}
