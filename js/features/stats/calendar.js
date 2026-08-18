// features/stats/calendar.js — the calendar-first history UI mounted at the top
// of Statistics. A compact monthly calendar with restrained per-day indicators
// (data-exists only), a unified Day Summary sheet, and a full-history list.
// Read-only: editing happens on the existing domain screens.

import { el } from '../../core/dom.js';
import { openSheet } from '../../core/sheet.js';
import { todayLocal, formatArabicDate, formatArabicDateShort, monthLabel } from '../../core/dates.js';
import { monthGrid, monthOfToday, prevMonth, nextMonth, WEEKDAYS_AR } from '../../domain/calendar.js';
import { getMonthIndicators, getDaySummary, getHistoryList } from '../../data/history.repo.js';
import { formatInt, formatWeight } from '../../core/num.js';

function fmtDur(sec) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/**
 * Mount the calendar into `container`, managing its own month/selection state so
 * navigating months never re-renders (or reloads) the charts below it.
 */
export function mountCalendar(container, { navigate }) {
  const today = todayLocal();
  const tm = monthOfToday();
  let year = tm.year, month0 = tm.month0;
  let selected = null; // selecting a date never creates data

  async function render() {
    const weeks = monthGrid(year, month0);
    const inMonth = weeks.flat().filter(Boolean).map((c) => c.date);
    // One aggregation per month (3 bounded queries), mapped to cells.
    let indicators = new Map();
    try { indicators = await getMonthIndicators(year, month0, inMonth); } catch (_) { indicators = new Map(); }

    const header = el('div', { className: 'cal-head' }, [
      // RTL convention (matches Nutrition date nav): previous is ›, next is ‹.
      el('button', { className: 'cal-nav', attrs: { 'aria-label': 'الشهر السابق' }, text: '›', onClick: () => { const p = prevMonth(year, month0); year = p.year; month0 = p.month0; render(); } }),
      el('div', { className: 'cal-title', text: monthLabel(year, month0) }),
      el('button', { className: 'cal-nav', attrs: { 'aria-label': 'الشهر التالي' }, text: '‹', onClick: () => { const n = nextMonth(year, month0); year = n.year; month0 = n.month0; render(); } }),
    ]);

    const isCurrentMonth = (year === tm.year && month0 === tm.month0);
    const subActions = el('div', { className: 'cal-subactions' }, [
      isCurrentMonth ? null : el('button', { className: 'sec-action', text: 'الشهر الحالي', onClick: () => { year = tm.year; month0 = tm.month0; render(); } }),
      el('button', { className: 'sec-action', text: 'عرض السجل', onClick: () => openHistoryList(navigate) }),
    ].filter(Boolean));

    const dow = el('div', { className: 'cal-dow' }, WEEKDAYS_AR.map((d) => el('span', { text: d })));

    const grid = el('div', { className: 'cal-grid' }, weeks.flat().map((cell) => {
      if (!cell) return el('span', { className: 'cal-cell empty' });
      const ind = indicators.get(cell.date) || {};
      const isToday = cell.date === today;
      const isSel = cell.date === selected;
      const dots = el('span', { className: 'cal-dots' }, [
        ind.nutrition ? el('i', { className: 'dot dot-nutrition', attrs: { 'aria-label': 'تغذية' } }) : null,
        ind.workout ? el('i', { className: 'dot dot-workout', attrs: { 'aria-label': 'تمرين' } }) : null,
        ind.weight ? el('i', { className: 'dot dot-weight', attrs: { 'aria-label': 'وزن' } }) : null,
      ].filter(Boolean));
      return el('button', {
        className: `cal-cell${isToday ? ' today' : ''}${isSel ? ' selected' : ''}`,
        attrs: { 'aria-label': formatArabicDate(cell.date), 'aria-current': isToday ? 'date' : null },
        onClick: () => { selected = cell.date; render(); openDaySummary(cell.date, navigate); },
      }, [
        el('span', { className: 'cal-num num', text: String(cell.day) }),
        dots,
      ]);
    }));

    container.replaceChildren(el('div', { className: 'calendar card' }, [header, subActions, dow, grid]));
  }

  render();
  return { refresh: render };
}

/** Unified Day Summary — the single implementation used by calendar and list. */
export async function openDaySummary(date, navigate) {
  const body = el('div', { className: 'stack', style: { minHeight: '80px' } }, [el('div', { className: 'notice', text: 'جارٍ التحميل…' })]);
  const handle = openSheet({ title: formatArabicDate(date), body });
  let sum;
  try { sum = await getDaySummary(date); } catch (_) { body.replaceChildren(el('div', { className: 'notice', text: 'تعذّر تحميل بيانات اليوم.' })); return; }

  const hasAny = !!(sum.nutrition || (sum.workouts && sum.workouts.length) || sum.weight);
  if (!hasAny) {
    body.replaceChildren(el('div', { className: 'day-empty' }, [
      el('div', { className: 'muted', text: 'لا توجد بيانات مسجلة لهذا اليوم' }),
    ]));
    return;
  }

  const sections = [];

  // Nutrition
  if (sum.nutrition) {
    const n = sum.nutrition;
    sections.push(el('div', { className: 'day-sec' }, [
      el('div', { className: 'day-sec-head' }, [el('h3', { text: 'التغذية' })]),
      el('div', { className: 'day-sec-body' }, [
        el('div', { className: 'num', text: `${formatInt(n.calories)} kcal` }),
        el('div', { className: 'muted-sm num', text: n.protein != null ? `${formatWeight(n.protein)} g بروتين` : 'البروتين غير معروف' }),
        el('div', { className: 'muted-sm num', text: `${formatInt(n.entryCount)} إدخالات` }),
      ]),
      el('button', { className: 'btn btn-secondary btn-block', text: 'عرض التفاصيل', onClick: () => { handle.close(); navigate('nutrition', date); } }),
    ]));
  }

  // Workout(s) — all sessions shown
  if (sum.workouts && sum.workouts.length) {
    const items = sum.workouts.map((w) => el('div', { className: 'day-workout' }, [
      el('div', {}, [
        el('div', { className: 'ex-title', text: w.name }),
        el('div', { className: 'muted-sm num', text: `${fmtDur(w.durationSec)} • ${formatInt(w.exerciseCount)} تمارين • ${formatInt(w.workingSetCount)} مجموعات${w.completed ? '' : ' • قيد التنفيذ'}` }),
      ]),
      el('button', { className: 'btn btn-secondary btn-sm', text: 'فتح', onClick: () => { handle.close(); navigate('session', w.id); } }),
    ]));
    sections.push(el('div', { className: 'day-sec' }, [
      el('div', { className: 'day-sec-head' }, [el('h3', { text: sum.workouts.length > 1 ? `التمارين (${sum.workouts.length})` : 'التمرين' })]),
      el('div', { className: 'stack', style: { gap: 'var(--s-2)' } }, items),
    ]));
  }

  // Weight — official prominent, disclose extras
  if (sum.weight) {
    const w = sum.weight;
    sections.push(el('div', { className: 'day-sec' }, [
      el('div', { className: 'day-sec-head' }, [el('h3', { text: 'الوزن' })]),
      el('div', { className: 'day-sec-body' }, [
        el('div', { className: 'num', text: w.weightKg != null ? `${formatWeight(w.weightKg)} kg` : '—' }),
        el('div', { className: 'muted-sm', text: w.isOfficial ? 'القياس الرسمي' : 'غير رسمي' }),
        w.others > 0 ? el('div', { className: 'muted-sm num', text: `و ${formatInt(w.others)} قياسات أخرى في هذا اليوم` }) : null,
      ].filter(Boolean)),
      el('button', { className: 'btn btn-secondary btn-block', text: 'فتح سجل الوزن', onClick: () => { handle.close(); navigate('weight', date); } }),
    ]));
  }

  body.replaceChildren(el('div', { className: 'stack' }, sections));
}

/** Full chronological history list — only dates with data, newest first. */
export async function openHistoryList(navigate) {
  const body = el('div', { className: 'stack', style: { minHeight: '80px' } }, [el('div', { className: 'notice', text: 'جارٍ التحميل…' })]);
  const handle = openSheet({ title: 'السجل', body });
  let rows;
  try { rows = await getHistoryList(); } catch (_) { body.replaceChildren(el('div', { className: 'notice', text: 'تعذّر تحميل السجل.' })); return; }
  if (!rows.length) { body.replaceChildren(el('div', { className: 'day-empty' }, [el('div', { className: 'muted', text: 'لا يوجد سجل بعد.' })])); return; }

  const list = el('div', { className: 'list' }, rows.map((r) => {
    const domains = [];
    if (r.nutrition) domains.push('تغذية');
    if (r.workouts && r.workouts.length) domains.push('تمرين');
    if (r.weight) domains.push('وزن');
    const facts = [];
    if (r.nutrition) facts.push(`${formatInt(r.nutrition.calories)} kcal`);
    if (r.workouts && r.workouts.length) facts.push(r.workouts.map((w) => w.name).join('، '));
    if (r.weight && r.weight.weightKg != null) facts.push(`${formatWeight(r.weight.weightKg)} kg`);
    return el('button', { className: 'row', style: { width: '100%' }, onClick: () => { handle.close(); openDaySummary(r.date, navigate); } }, [
      el('div', { className: 'row-label' }, [
        el('div', { text: formatArabicDateShort(r.date) }),
        el('div', { className: 'sub', text: domains.join(' · ') }),
        facts.length ? el('div', { className: 'sub num', text: facts.join(' · ') }) : null,
      ].filter(Boolean)),
      el('div', { className: 'chev', text: '‹' }),
    ]);
  }));
  body.replaceChildren(list);
}
