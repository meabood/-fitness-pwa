// nutrition/nutrition.js — a per-day log with date navigation, daily totals vs
// the target that applied on that date, per-day completion, and entry management.
// A day with no entries is "unlogged" (not zero) unless marked complete.
// Unknown protein stays distinct from zero. No snapshot semantics changed.

import { el, toast, snackbar } from '../../core/dom.js';
import { on } from '../../core/events.js';
import { getEntriesForDate, getDay, setDayCompleted, copyDay, deleteEntry, restoreEntry } from '../../data/nutrition.repo.js';
import { getTargetForDate } from '../../data/settings.repo.js';
import { dayTotals, remaining } from '../../domain/nutritionStats.js';
import { formatInt, formatWeight } from '../../core/num.js';
import { todayLocal, addDays, formatArabicDate, isValidLocalDate } from '../../core/dates.js';
import { pageHead, hero, progress, statLine, emptyState, numericLTR, valueUnit } from '../../core/ui.js';
import { swipeRow } from '../../core/controls.js';
import { openAddEntrySheet, openEditEntrySheet } from './nutritionSheets.js';

// Compact quantity label (¼ ½ ¾ …) for scannable rows.
const FRACT = { 0.25: '¼', 0.5: '½', 0.75: '¾', 1.5: '1½' };
const fmtQ = (n) => FRACT[n] || String(Math.round(n * 100) / 100);

export function renderNutrition(root, ctx = {}) {
  const navigate = ctx.navigate || (() => {});
  let current = (ctx.param && isValidLocalDate(ctx.param)) ? ctx.param : todayLocal();

  async function draw() {
    const [entries, day, calTarget, protTarget] = await Promise.all([
      getEntriesForDate(current),
      getDay(current),
      getTargetForDate('calorie', current),
      getTargetForDate('protein', current),
    ]);
    const totals = dayTotals(entries);

    root.replaceChildren(el('div', { className: 'route-view stack' }, [
      pageHead('التغذية', { actionLabel: 'مكتبة الوجبات', onAction: () => navigate('meals') }),
      dateBar(),
      summary(entries, totals, day, calTarget, protTarget),
      list(entries, day),
    ]));

    // RTL: previous is to the RIGHT, next to the LEFT.
    function dateBar() {
      const picker = el('input', { className: 'input num grow', type: 'date', value: current, style: { textAlign: 'center' }, attrs: { 'aria-label': 'التاريخ' } });
      picker.addEventListener('change', () => { current = picker.value || todayLocal(); draw(); });
      const prevBtn = el('button', { className: 'chip', attrs: { 'aria-label': 'اليوم السابق' }, text: '›', onClick: () => { current = addDays(current, -1); draw(); } });
      const nextBtn = el('button', { className: 'chip', attrs: { 'aria-label': 'اليوم التالي' }, text: '‹', onClick: () => { current = addDays(current, 1); draw(); } });
      return el('div', { className: 'entry', style: { alignItems: 'stretch' } }, [prevBtn, picker, nextBtn]);
    }

    function summary(entries, totals, day, calTarget, protTarget) {
      const rem = calTarget != null ? remaining(totals.calories, calTarget) : null;
      const parts = [
        hero({
          cap: calTarget != null ? 'السعرات' : 'السعرات (بدون هدف)',
          value: formatInt(totals.calories),
          unit: calTarget != null ? `/ ${formatInt(calTarget)}` : 'سعرة',
        }),
      ];
      if (calTarget != null) {
        const ratio = totals.calories / calTarget;
        parts.push(el('div', { style: { marginTop: 'var(--s-3)' } }, [progress(ratio, { over: ratio > 1 })]));
      }
      const lines = [];
      if (rem != null) lines.push(statLine(rem >= 0 ? 'المتبقّي' : 'فوق الهدف', numericLTR(`${formatInt(Math.abs(rem))} سعرة`), { tone: rem >= 0 ? 'down' : 'up' }));
      lines.push(statLine('البروتين', totals.protein == null
        ? 'غير معروف'
        : numericLTR(`${formatWeight(totals.protein)}${protTarget != null ? ` / ${formatWeight(protTarget)}` : ''} جم${totals.hasUnknownProtein ? ' •' : ''}`)));
      if (totals.hasUnknownProtein) lines.push(el('p', { className: 'muted-sm', text: 'بعض الأصناف بدون بروتين معروف.' }));
      parts.push(el('div', { style: { marginTop: 'var(--s-3)' } }, lines));

      const completeBtn = el('button', {
        className: day?.completed ? 'btn btn-ghost btn-block' : 'btn btn-secondary btn-block',
        style: { marginTop: 'var(--s-3)' },
        text: day?.completed ? 'اليوم مكتمل — إلغاء' : 'إنهاء اليوم',
        onClick: async () => { await setDayCompleted(current, !day?.completed); },
      });
      return el('div', { className: 'stack', style: { gap: 'var(--s-2)' } }, [el('div', { className: 'panel' }, parts), completeBtn]);
    }

    function list(entries, day) {
      const head = el('div', { className: 'section-head' }, [
        el('h2', { text: 'الأصناف' }),
        el('button', { className: 'sec-action', text: 'نسخ اليوم السابق', onClick: async () => { const n = await copyDay(addDays(current, -1), current); toast(n ? `تم نسخ ${n}` : 'لا يوجد ما يُنسخ'); } }),
      ]);
      if (!entries.length) {
        return el('section', { className: 'section' }, [
          head,
          emptyState({
            icon: 'nutrition',
            title: day?.completed ? 'يوم مكتمل بدون أصناف.' : 'لا توجد أصناف مسجّلة.',
            hint: day?.completed ? null : 'أضف وجبة من مكتبتك أو أدخل صنفًا يدويًا.',
            actionLabel: 'إضافة وجبة', onAction: () => openAddEntrySheet({ localDate: current, afterChange: draw }),
          }),
        ]);
      }
      // Scannable rows: food name + quantity/serving, calories prominent (warm
      // tint), protein shown only when known. Swipe a row to reveal Delete → Undo.
      const rows = entries.map((e) => {
        const qtyServe = [
          e.quantity !== 1 ? `×${fmtQ(e.quantity)}` : null,
          e.servingSnapshot || null,
        ].filter(Boolean).join(' · ');
        const surface = el('button', { className: 'nrow', onClick: () => openEditEntrySheet({ entry: e, afterChange: draw }) }, [
          el('div', { className: 'nrow-main' }, [
            el('div', { className: 'nrow-name', text: e.nameSnapshot }),
            qtyServe ? el('div', { className: 'nrow-sub' }, [numericLTR(qtyServe)]) : null,
          ].filter(Boolean)),
          el('div', { className: 'nrow-vals' }, [
            el('div', { className: 'nrow-cal num' }, [numericLTR(`${formatInt(e.finalCalories)}`), el('span', { className: 'nrow-unit', text: 'سعرة' })]),
            e.finalProtein != null
              ? el('div', { className: 'nrow-prot num' }, [numericLTR(`${formatWeight(e.finalProtein)} بروتين`)])
              : el('div', { className: 'nrow-prot unknown', text: 'بروتين غير معروف' }),
          ]),
        ]);
        return swipeRow(surface, {
          onDelete: async () => {
            const rec = await deleteEntry(e.id);
            draw();
            snackbar('تم حذف الوجبة', { onAction: async () => { await restoreEntry(rec); draw(); toast('تم التراجع'); } });
          },
        });
      });
      return el('section', { className: 'section' }, [
        head, el('div', { className: 'list nlist' }, rows),
        el('button', { className: 'btn btn-primary btn-block', style: { marginTop: 'var(--s-4)' }, text: '+ إضافة وجبة', onClick: () => openAddEntrySheet({ localDate: current, afterChange: draw }) }),
      ]);
    }
  }

  const unsub = on('nutrition:changed', draw);
  const unsub2 = on('settings:changed', draw);
  draw();
  return () => { unsub(); unsub2(); };
}
