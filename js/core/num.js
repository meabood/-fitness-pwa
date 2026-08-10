// num.js — numeric formatting and the stable weight-key normalization used by
// the derived "best reps at weight" cache (approved adjustment #3).
//
// Raw workout sets remain the authoritative source. This module only produces a
// STABLE, non-fragile key so we never use arbitrary floats as object keys.

/**
 * Normalize a weight to a fixed-precision integer count of "milli-units" plus
 * its unit, producing a stable string key like "kg:105000" or "lb:97500".
 *
 * Why: floating-point weights (97.5, 105.0, 0.1+0.2 ...) are unsafe as object
 * keys. Rounding to 3 decimal places of the entered unit, then keying on an
 * integer, gives a deterministic, collision-free key that round-trips.
 *
 * @param {number} weight  the raw entered weight, in `unit`
 * @param {'kg'|'lb'} unit
 * @returns {string} stable key
 */
export function weightKey(weight, unit) {
  const milli = Math.round(Number(weight) * 1000); // integer milli-units
  return `${unit}:${milli}`;
}

/** Inverse of weightKey → { weight, unit }. */
export function parseWeightKey(key) {
  const [unit, milli] = key.split(':');
  return { unit, weight: Number(milli) / 1000 };
}

/** Format a number with thousands separators (Western digits), e.g. 1840 → "1,840". */
export function formatInt(n) {
  return Math.round(n).toLocaleString('en-US');
}

/** Format a weight for display, trimming trailing zeros (105.0 → "105", 105.8 → "105.8"). */
export function formatWeight(n) {
  const r = Math.round(Number(n) * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** Signed delta with fixed 1-decimal, e.g. -0.4 → "−0.4" (using a real minus glyph). */
export function formatDelta(n) {
  const r = Math.round(Number(n) * 10) / 10;
  const sign = r > 0 ? '+' : r < 0 ? '−' : '';
  return `${sign}${formatWeight(Math.abs(r))}`;
}
