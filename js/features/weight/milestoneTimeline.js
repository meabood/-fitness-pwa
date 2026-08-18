// features/weight/milestoneTimeline.js — one reusable horizontal, horizontally
// scrollable milestone timeline used by Home, Weight, and Goals. It never
// compresses many milestones into the viewport: each node has a minimum width
// and the strip scrolls. On mount it auto-focuses the current/next milestone so
// a long plan doesn't always start at the beginning.
//
// Visual states (restrained, existing tokens): done / current / future / final.
// Weight values use numericLTR for correct bidi in the RTL layout.
// This is display only — it never changes achievement semantics.

import { el } from '../../core/dom.js';
import { numericLTR } from '../../core/ui.js';
import { formatWeight } from '../../core/num.js';
import { formatArabicDateShort } from '../../core/dates.js';

/**
 * Build the ordered timeline items from a weight summary.
 * Order is heaviest → lightest (reads as start → goal progress), matching the
 * existing Home/Weight ordering. Milestones equal to the final are excluded
 * (the final node covers them).
 */
export function buildItems(summary) {
  const ms = (summary.milestones || []).filter((m) => !m.sameAsFinal).map((m) => ({
    w: m.targetWeight,
    date: m.reached ? m.achievedDate : m.targetDate,
    done: m.reached,
    final: false,
  }));
  if (summary.finalStatus) {
    ms.push({
      w: summary.finalStatus.targetWeight,
      date: summary.finalStatus.reached ? summary.finalStatus.achievedDate : summary.finalStatus.targetDate,
      done: summary.finalStatus.reached,
      final: true,
    });
  }
  ms.sort((a, b) => b.w - a.w);
  // current = first not-yet-done node (the relevant target right now)
  const currentIdx = ms.findIndex((m) => !m.done);
  return { items: ms, currentIdx };
}

/**
 * Render the timeline.
 * @param summary computeWeightSummary output
 * @param opts { compact } — compact hides the section header chrome (Home)
 * @returns HTMLElement (empty <div> when there are no milestones)
 */
export function milestoneTimeline(summary, opts = {}) {
  const { compact = false } = opts;
  const { items, currentIdx } = buildItems(summary);
  if (!items.length) return el('div', {});

  const strip = el('div', { className: 'ms-strip', attrs: { role: 'list', 'aria-label': 'مراحل الوزن' } });

  items.forEach((it, i) => {
    const state = it.final ? 'final' : it.done ? 'done' : (i === currentIdx ? 'current' : 'future');
    const node = el('div', { className: `ms-node ${state}`, attrs: { role: 'listitem' } }, [
      el('span', { className: 'ms-line ms-line-before' }),
      el('span', { className: 'ms-line ms-line-after' }),
      el('span', { className: 'ms-dot', html: it.done
        ? '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>'
        : '' }),
      el('span', { className: 'ms-w' }, [numericLTR(formatWeight(it.w))]),
      el('span', { className: 'ms-u', text: 'كجم' }),
      el('span', { className: 'ms-date' }, [it.date ? numericLTR(formatArabicDateShort(it.date)) : el('span', { text: '—' })]),
      it.final ? el('span', { className: 'ms-tag', text: 'الهدف' }) : null,
    ].filter(Boolean));
    // mark the ends so CSS can hide the dangling connector
    if (i === 0) node.classList.add('is-first');
    if (i === items.length - 1) node.classList.add('is-last');
    strip.append(node);
  });

  // Auto-focus the current (or final, if all done) node after attach. Using
  // scrollIntoView avoids manual RTL scrollLeft math (which differs per engine).
  const focusIdx = currentIdx >= 0 ? currentIdx : items.length - 1;
  requestAnimationFrame(() => {
    const target = strip.children[focusIdx];
    if (target && typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ block: 'nearest', inline: 'center' });
    }
  });

  if (compact) return el('div', { className: 'ms-timeline compact' }, [strip]);
  return el('div', { className: 'ms-timeline' }, [strip]);
}
