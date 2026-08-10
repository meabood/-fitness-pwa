// core/bodyMap.js — a local, lightweight SVG muscle visualization. Two simple
// front/back silhouettes share one visual language; broad regions are colored by
// emphasis (primary/secondary) from domain/muscleMap. No remote assets, no libs.
//
// The silhouette is intentionally stylized (a calm app graphic, not an anatomy
// chart). Region shapes are approximate broad zones — see domain/muscleMap for
// the honesty note on how regions are derived from free-text muscle groups.

import { el } from './dom.js';
import { REGIONS, REGION_LABEL_AR } from '../domain/muscleMap.js';

const NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, String(attrs[k])); return e; }

// Region path data per view. Coordinates target a 100×200 viewBox torso figure.
// Kept deliberately simple and readable at mobile sizes.
const FRONT = {
  shoulders: 'M30 46 q-9 1 -12 9 q7 -3 13 -3 z M70 46 q9 1 12 9 q-7 -3 -13 -3 z',
  chest: 'M36 50 q14 -6 28 0 l-2 16 q-12 6 -24 0 z',
  core: 'M40 68 q10 4 20 0 l-2 26 q-8 3 -16 0 z',
  biceps: 'M24 56 q-5 10 -6 22 q5 2 9 1 q1 -13 4 -22 z M76 56 q5 10 6 22 q-5 2 -9 1 q-1 -13 -4 -22 z',
  forearms: 'M17 80 q-3 12 -3 24 q4 1 8 0 q1 -13 3 -24 z M83 80 q3 12 3 24 q-4 1 -8 0 q-1 -13 -3 -24 z',
  quads: 'M40 98 q-4 22 -3 44 q6 2 10 0 q1 -22 1 -44 z M60 98 q4 22 3 44 q-6 2 -10 0 q-1 -22 -1 -44 z',
  calves: 'M39 146 q-2 20 0 36 q5 1 8 0 q1 -18 0 -36 z M61 146 q2 20 0 36 q-5 1 -8 0 q-1 -18 0 -36 z',
};
const BACK = {
  shoulders: 'M30 46 q-9 1 -12 9 q7 -3 13 -3 z M70 46 q9 1 12 9 q-7 -3 -13 -3 z',
  back: 'M36 50 q14 -6 28 0 l-3 30 q-11 5 -22 0 z',
  triceps: 'M24 56 q-5 10 -6 22 q5 2 9 1 q1 -13 4 -22 z M76 56 q5 10 6 22 q-5 2 -9 1 q-1 -13 -4 -22 z',
  glutes: 'M40 84 q10 5 20 0 l-1 16 q-9 4 -18 0 z',
  hamstrings: 'M40 102 q-4 20 -3 40 q6 2 10 0 q1 -20 1 -40 z M60 102 q4 20 3 40 q-6 2 -10 0 q-1 -20 -1 -40 z',
  calves: 'M39 146 q-2 20 0 36 q5 1 8 0 q1 -18 0 -36 z M61 146 q2 20 0 36 q-5 1 -8 0 q-1 -18 0 -36 z',
};

// A simple body outline (head + torso + limbs) shared by both views.
const OUTLINE = 'M50 6 q8 0 8 9 q0 8 -8 9 q-8 -1 -8 -9 q0 -9 8 -9 z '
  + 'M50 25 q16 0 20 18 q3 14 3 30 q6 14 8 30 q1 8 0 16 '
  + 'q-5 2 -8 0 q-2 -18 -6 -28 q0 26 -2 44 q-1 22 -3 42 q-5 2 -9 0 q-2 -22 -3 -42 '
  + 'q-2 6 -2 8 q0 -2 -0 -8 q-1 20 -3 42 q-1 20 -3 42 q-4 2 -9 0 q-2 -20 -3 -42 '
  + 'q-2 -18 -2 -44 q-4 10 -6 28 q-3 2 -8 0 q-1 -8 0 -16 q2 -16 8 -30 q0 -16 3 -30 q4 -18 20 -18 z';

function emphasisClass(region, primary, secondary) {
  if (primary.has(region)) return 'bm-region pri';
  if (secondary.has(region)) return 'bm-region sec';
  return 'bm-region';
}

function view(map, label, primary, secondary) {
  const svg = s('svg', { viewBox: '0 0 100 200', role: 'img', 'aria-label': label });
  // inactive base regions first, then outline on top for a clean edge
  for (const region of REGIONS) {
    const d = map[region];
    if (!d) continue;
    const p = s('path', { d, class: emphasisClass(region, primary, secondary) });
    svg.appendChild(p);
  }
  const outline = s('path', { d: OUTLINE, class: 'bm-body' });
  svg.appendChild(outline);
  const wrap = el('div', { className: 'bm-view' }, [svg]);
  wrap.appendChild(el('div', { className: 'bm-cap', text: label }));
  return wrap;
}

/**
 * Build the muscle map element.
 * @param {{primary:Set,secondary:Set}} regions
 * @param {object} [opts] { views:['front','back'], legend:true }
 */
export function bodyMap(regions, { views = ['front', 'back'], legend = true } = {}) {
  const primary = regions.primary || new Set();
  const secondary = regions.secondary || new Set();
  const row = el('div', { className: 'bodymap' },
    views.map((v) => v === 'back' ? view(BACK, 'خلفي', primary, secondary) : view(FRONT, 'أمامي', primary, secondary)));

  const parts = [row];
  if (legend && (primary.size || secondary.size)) {
    const names = [...primary, ...secondary].map((r) => REGION_LABEL_AR[r]).filter(Boolean);
    parts.push(el('div', { className: 'region-legend' }, [
      el('span', { className: 'rl' }, [el('i', { style: { background: 'var(--region-1)' } }), 'أساسي']),
      secondary.size ? el('span', { className: 'rl' }, [el('i', { style: { background: 'var(--region-2)' } }), 'ثانوي']) : null,
      el('span', { className: 'rl muted-sm', text: names.join('، ') }),
    ].filter(Boolean)));
  }
  return el('div', { className: 'stack', style: { gap: 'var(--s-2)' } }, parts);
}
