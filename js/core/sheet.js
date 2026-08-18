// sheet.js — a mobile bottom-sheet modal. Used for add/edit/day-detail forms.
// Closes on backdrop tap, on the close button, and on Escape. Restores focus.

import { el } from './dom.js';
import { ICONS } from './icons.js';

/**
 * Open a bottom sheet.
 * @param {object} opts
 * @param {string} opts.title
 * @param {Node}   opts.body     content node
 * @param {Function} [opts.onClose]
 * @returns {{close: Function, sheet: HTMLElement}}
 */
export function openSheet({ title, body, onClose, dirty }) {
  const prevFocus = document.activeElement;

  const closeBtn = el('button', {
    className: 'sheet-close', attrs: { 'aria-label': 'إغلاق' }, html: ICONS.chevron,
    onClick: () => attemptClose(),
  });
  const head = el('div', { className: 'sheet-head' }, [
    el('h2', { className: 'sheet-title', text: title || '' }),
    closeBtn,
  ]);
  const sheet = el('div', {
    className: 'sheet', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': title || '' },
  }, [head, body]);
  const overlay = el('div', { className: 'sheet-overlay' }, [sheet]);

  function onKey(e) { if (e.key === 'Escape') attemptClose(); }

  let confirming = false;
  // Casual dismissal (backdrop / Escape / close button): if the form has
  // unsaved changes, confirm discarding first (item 12). Never warns when clean.
  function attemptClose() {
    if (dirty && dirty() && !confirming) {
      confirming = true;
      const bar = el('div', { className: 'dirty-guard' }, [
        el('span', { className: 'dg-msg', text: 'لديك تغييرات غير محفوظة' }),
        el('button', { className: 'dg-keep', text: 'متابعة التعديل', onClick: () => { confirming = false; bar.remove(); } }),
        el('button', { className: 'dg-discard', text: 'تجاهل التغييرات', onClick: () => { bar.remove(); close(true); } }),
      ]);
      sheet.append(bar);
      return;
    }
    close(true);
  }

  function close(force) {
    if (!force && dirty && dirty()) { attemptClose(); return; }
    document.removeEventListener('keydown', onKey);
    overlay.classList.remove('open');
    overlay.classList.add('closing');
    setTimeout(() => {
      overlay.remove();
      if (prevFocus && prevFocus.focus) prevFocus.focus();
      onClose && onClose();
    }, 160);
  }

  overlay.addEventListener('click', (e) => { if (e.target === overlay) attemptClose(); });
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
  requestAnimationFrame(() => {
    overlay.classList.add('open');
    // focus first field for fast entry
    sheet.querySelector('input, button, select, textarea')?.focus();
  });

  // Callers pass close() after a successful save → bypasses the guard by default.
  return { close: (force = true) => close(force), sheet };
}
