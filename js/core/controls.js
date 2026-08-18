// core/controls.js — reusable interaction primitives shared by Nutrition and
// Workout so the two features feel like one product. No domain logic here.
//
//   stepper()     compact −/value/+ quantity control with quick fractions
//   disclosure()  progressive-disclosure section for secondary details
//   swipeRow()    horizontal swipe-to-reveal-Delete row (with keyboard fallback)

import { el } from './dom.js';

const FRACT_LABEL = { 0.25: '¼', 0.5: '½', 0.75: '¾', 1: '1', 1.5: '1½', 2: '2', 3: '3' };
const fmtQty = (n) => {
  if (!Number.isFinite(n)) return '';
  return FRACT_LABEL[n] || (Math.round(n * 100) / 100).toString();
};

/**
 * Compact quantity stepper: [−] [value] [+] with a row of quick fractions and an
 * arbitrary manual value still supported (tap the value to type). onChange gets
 * the numeric value. `step` is the +/- increment.
 */
export function stepper(initial = 1, { min = 0, step = 1, fractions = [0.5, 1, 2], onChange } = {}) {
  let value = Number(initial) || 0;
  const emit = () => { onChange && onChange(value); };

  const field = el('input', {
    className: 'stp-val num', type: 'number', inputmode: 'decimal', step: String(step), min: String(min),
    value: String(value), attrs: { 'aria-label': 'القيمة' },
  });
  const setValue = (v, fromField) => {
    value = Math.max(min, Math.round(Number(v) * 100) / 100);
    if (!fromField) field.value = String(value);
    syncChips(); emit();
  };
  const dec = el('button', { className: 'stp-btn', attrs: { 'aria-label': 'إنقاص' }, text: '−', onClick: () => setValue(value - step) });
  const inc = el('button', { className: 'stp-btn', attrs: { 'aria-label': 'زيادة' }, text: '+', onClick: () => setValue(value + step) });
  field.addEventListener('input', () => { const n = Number(field.value); if (Number.isFinite(n)) setValue(n, true); });

  const chipEls = new Map();
  function syncChips() { chipEls.forEach((c, q) => c.classList.toggle('on', q === value)); }
  const chipRow = el('div', { className: 'stp-chips' }, fractions.map((q) => {
    const c = el('button', { className: 'chip', text: fmtQty(q), onClick: () => setValue(q) });
    chipEls.set(q, c); return c;
  }));
  syncChips();

  const node = el('div', { className: 'stepper' }, [
    el('div', { className: 'stp-row' }, [dec, field, inc]),
    chipRow,
  ]);
  return { node, get: () => value, set: (v) => setValue(v) };
}

/**
 * Progressive-disclosure block: a compact toggle that reveals `content`. Keeps
 * secondary details (date/time/note, advanced options) out of the primary view
 * until asked for. `open` sets the initial state.
 */
export function disclosure(label, content, { open = false } = {}) {
  const body = el('div', { className: 'disc-body', hidden: !open }, [content]);
  const caret = el('span', { className: 'disc-caret', text: open ? '▾' : '‹' });
  const btn = el('button', {
    className: 'disc-toggle', attrs: { 'aria-expanded': String(open) },
    onClick: () => {
      const nowOpen = body.hasAttribute('hidden');
      if (nowOpen) body.removeAttribute('hidden'); else body.setAttribute('hidden', '');
      btn.setAttribute('aria-expanded', String(nowOpen));
      caret.textContent = nowOpen ? '▾' : '‹';
    },
  }, [el('span', { text: label }), caret]);
  return el('div', { className: 'disclosure' }, [btn, body]);
}

/**
 * Swipe-to-reveal-Delete row. `content` is the row's interactive surface (e.g. a
 * button that opens an editor). Swiping horizontally reveals a Delete action;
 * `onDelete` runs on tap. A keyboard/no-touch fallback: a small always-present
 * delete affordance appears via the `.swipe-del` button behind the surface, and
 * long-press isn't required. RTL-aware (reveals from the inline-start side).
 */
export function swipeRow(content, { onDelete, deleteLabel = 'حذف' } = {}) {
  const del = el('button', { className: 'swipe-del', text: deleteLabel, attrs: { 'aria-label': deleteLabel }, onClick: (e) => { e.stopPropagation(); onDelete && onDelete(); } });
  const surface = el('div', { className: 'swipe-surface' }, [content]);
  const row = el('div', { className: 'swipe-row' }, [del, surface]);

  // The delete button is pinned at the inline-END side (physical right in LTR,
  // physical LEFT in RTL). To reveal it the surface must slide toward inline-
  // START — physical left in LTR (translateX negative), physical right in RTL
  // (translateX positive). `sign` maps "reveal amount" → physical translate so
  // the gesture and the button placement always agree, in both directions.
  const rtl = (document.documentElement.getAttribute('dir') || document.dir || '').toLowerCase() === 'rtl';
  const sign = rtl ? 1 : -1;

  let startX = 0, startY = 0, dx = 0, dragging = false, open = false;
  const REVEAL = 76;           // px width of the delete action
  const THRESH = 44;           // px of reveal needed to commit (guards accidents)
  // amount ≥ 0 reveals the button; clamped with a little rubber-banding.
  const setReveal = (amount) => {
    const a = Math.max(-12, Math.min(REVEAL + 12, amount));
    surface.style.transform = `translateX(${sign * a}px)`;
  };
  const openRow = () => { open = true; setReveal(REVEAL); };
  const closeRow = () => { open = false; setReveal(0); };

  surface.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    startX = e.touches[0].clientX; startY = e.touches[0].clientY; dragging = true;
    surface.style.transition = 'none';
  }, { passive: true });
  surface.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    dx = e.touches[0].clientX - startX;
    const dyAbs = Math.abs(e.touches[0].clientY - startY);
    if (dyAbs > Math.abs(dx)) return;           // vertical scroll wins
    // reveal grows when dragging toward inline-start (sign·dx > 0)
    const revealAmount = (open ? REVEAL : 0) + sign * dx;
    setReveal(revealAmount);
  }, { passive: true });
  surface.addEventListener('touchend', () => {
    if (!dragging) return;
    dragging = false;
    surface.style.transition = '';
    const revealAmount = (open ? REVEAL : 0) + sign * dx;
    if (revealAmount > THRESH) openRow(); else closeRow();
    dx = 0;
  });
  // tapping the surface while open closes it instead of activating
  surface.addEventListener('click', (e) => { if (open) { e.preventDefault(); e.stopPropagation(); closeRow(); } }, true);

  return row;
}
