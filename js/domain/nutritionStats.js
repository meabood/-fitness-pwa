// nutritionStats.js — PURE nutrition calculations (no DB, no DOM).
//
// Core rules:
//  - Calories are never guessed: values come from the user; we only scale/sum.
//  - Protein "unknown" (null) is never treated as 0. It stays null through finals
//    and is excluded from protein totals; a zero the user actually typed is 0.

/**
 * Final factual values recorded on a nutrition entry.
 * @param {number} kcalPerServing
 * @param {number|null} proteinPerServing  null = unknown (NOT zero)
 * @param {number} quantity
 * @returns {{finalCalories:number, finalProtein:number|null}}
 */
export function computeFinals(kcalPerServing, proteinPerServing, quantity) {
  const q = Number(quantity);
  const finalCalories = Number(kcalPerServing) * q;
  const finalProtein = proteinPerServing == null ? null : Number(proteinPerServing) * q;
  return { finalCalories, finalProtein };
}

/**
 * Totals for a set of nutrition entries on a day.
 * Protein total sums only entries whose finalProtein is known; if none are known
 * the total is null (display as "—"), distinct from a real 0.
 * @returns {{calories:number, protein:number|null, hasUnknownProtein:boolean, count:number}}
 */
export function dayTotals(entries) {
  let calories = 0;
  let protein = 0;
  let anyKnown = false;
  let hasUnknownProtein = false;
  for (const e of entries) {
    calories += Number(e.finalCalories) || 0;
    if (e.finalProtein == null) hasUnknownProtein = true;
    else { protein += Number(e.finalProtein); anyKnown = true; }
  }
  return { calories, protein: anyKnown ? protein : null, hasUnknownProtein, count: entries.length };
}

/** target - consumed; null when there is no target. Negative = exceeded. */
export function remaining(consumed, target) {
  if (target == null) return null;
  return target - consumed;
}

/**
 * A day "counts" for averages when it has entries OR is explicitly completed
 * (completed-with-zero-intake = 0). A day with neither is missing/unlogged and
 * must be excluded — never treated as 0. Used by statistics (Stage 9).
 */
export function dayCounts(hasEntries, completed) {
  return hasEntries || completed === true;
}
