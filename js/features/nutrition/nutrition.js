// nutrition/nutrition.js — a per-day log with date navigation, daily totals vs
// the target that applied on that date, per-day completion, and entry management.
// A day with no entries is "unlogged" (not zero) unless marked complete.
// Unknown protein stays distinct from zero. No snapshot semantics changed.

import { el, toast } from '../../core/dom.js';
import { on } from '../../core/events.js';
import { getEntriesForDate, getDay, setDayCompleted, copyDay } from '../../data/nutrition.repo.js';
import { getTargetForDate } from '../../data/settings.repo.js';
import { dayTotals, remaining } from '../../domain/nutritionStats.js';
import { formatInt, formatWeight } from '../../core/num.js';
import { todayLocal, addDays, formatArabicDate } from '../../core/dates.js';
import { pageHead, hero, progress, statLine, emptyState } from '../../core/ui.js';
import { openAddEntrySheet, openEditEntrySheet } from './nutritionSheets.js';

export function renderNutrition(root, ctx = {}) {
  const navigate = ctx.navigate || (() => {});
  let current = todayLocal();

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
      const prevBtn = el('button', { className: 'chip', attrs: { 'aria-label': 'اليوم السابق' }, text: '‹', onClick: () => { current = addDays(current, -1); draw(); } });
      const nextBtn = el('button', { className: 'chip', attrs: { 'aria-label': 'اليوم التالي' }, text: '›', onClick: () => { current = addDays(current, 1); draw(); } });
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
      if (rem != null) lines.push(statLine(rem >= 0 ? 'المتبقّي' : 'فوق الهدف', `${formatInt(Math.abs(rem))} سعرة`, { tone: rem >= 0 ? 'down' : 'up' }));
      lines.push(statLine('البروتين', totals.protein == null
        ? 'غير معروف'
        : `${formatWeight(totals.protein)} جم${protTarget != null ? ` / ${formatWeight(protTarget)}` : ''}${totals.hasUnknownProtein ? ' • بعضه غير معروف' : ''}`));
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
      const rows = entries.map((e) => el('button', { className: 'row', onClick: () => openEditEntrySheet({ entry: e, afterChange: draw }) }, [
        el('div', { className: 'row-label' }, [
          el('div', { text: e.nameSnapshot }),
          el('div', { className: 'sub num', text: `${e.quantity !== 1 ? `×${e.quantity} • ` : ''}${e.finalProtein != null ? `${formatWeight(e.finalProtein)} جم بروتين` : 'بروتين غير معروف'}${e.servingSnapshot ? ` • ${e.servingSnapshot}` : ''}` }),
        ]),
        el('div', { className: 'row-value num', style: { fontWeight: 'var(--w-medium)' }, text: `${formatInt(e.finalCalories)}` }),
      ]));
      return el('section', { className: 'section' }, [
        head, el('div', { className: 'list' }, rows),
        el('button', { className: 'btn btn-primary btn-block', style: { marginTop: 'var(--s-4)' }, text: '+ إضافة وجبة', onClick: () => openAddEntrySheet({ localDate: current, afterChange: draw }) }),
      ]);
    }
  }

  const unsub = on('nutrition:changed', draw);
  const unsub2 = on('settings:changed', draw);
  draw();
  return () => { unsub(); unsub2(); };
}
