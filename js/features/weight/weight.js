// weight/weight.js — the Weight tab: a progress journey. A strong current-state
// hero (official weight, change, 7-day average, trajectory, next milestone),
// a restrained chart (official actual vs 7-day MA vs dashed target trajectory +
// milestone markers), a milestone timeline, and the official history. Everything
// derived recomputes on change; no factual semantics changed.

import { el, toast } from '../../core/dom.js';
import { on } from '../../core/events.js';
import { addWeight, getAllEntries } from '../../data/weight.repo.js';
import { getActivePlanWithMilestones } from '../../data/goals.repo.js';
import { getConfig } from '../../data/settings.repo.js';
import { previousOfficialBefore, changeKg, officialHistoryRows } from '../../domain/weightStats.js';
import { computeWeightSummary } from '../../domain/weightAchievements.js';
import { milestoneTimeline } from './milestoneTimeline.js';
import { weightSeries, rangeDays } from '../../domain/statsData.js';
import { lineChart, legend } from '../../core/svgChart.js';
import { formatWeight, formatDelta } from '../../core/num.js';
import { todayLocal, addDays, formatArabicDate, formatArabicDateShort, isValidLocalDate } from '../../core/dates.js';
import { pageHead, hero, statLine, chips, numericLTR } from '../../core/ui.js';
import { openAddSheet, openDaySheet } from './weightSheets.js';

const RANGES = [
  { key: '30d', label: '٣٠ يومًا', days: 30 },
  { key: '3m', label: '٣ أشهر', days: 91 },
  { key: '6m', label: '٦ أشهر', days: 182 },
  { key: '1y', label: 'سنة', days: 365 },
  { key: 'all', label: 'الكل', days: null },
];
const COL = { actual: '#2f7d3b', ma: '#c98a1b', target: '#8a8f98' };

const trajectoryText = {
  ahead: (d) => `متقدم عن المسار بـ ${formatWeight(Math.abs(d))} كجم`,
  on: () => 'على المسار تقريبًا',
  behind: (d) => `متأخر عن المسار بـ ${formatWeight(Math.abs(d))} كجم`,
};

export function renderWeight(root, ctx = {}) {
  const navigate = ctx.navigate || (() => {});
  let rangeKey = '3m';

  async function draw() {
    const [entries, { plan, milestones }, tol] = await Promise.all([
      getAllEntries(),
      getActivePlanWithMilestones(),
      getConfig('trajectoryToleranceKg'),
    ]);
    const s = computeWeightSummary(entries, plan, milestones, { toleranceKg: tol });
    const today = todayLocal();
    const todayOfficial = s.timeline.find((e) => e.localDate === today) || null;

    root.replaceChildren(el('div', { className: 'route-view stack' }, [
      pageHead('الوزن', { actionLabel: 'الأهداف', onAction: () => navigate('goals') }),
      quickAdd(draw),
      heroPanel(s, todayOfficial),
      chartPanel(entries, plan, milestones),
      milestonePanel(s),
      history(entries, s, draw),
    ]));
  }

  function quickAdd(afterChange) {
    const input = el('input', {
      className: 'input num grow', type: 'number', inputmode: 'decimal', step: '0.1',
      min: '0', placeholder: 'وزن اليوم (كجم)', attrs: { 'aria-label': 'وزن اليوم بالكيلوغرام' },
    });
    const save = async () => {
      const n = Number(input.value);
      if (!Number.isFinite(n) || n <= 0 || n >= 700) { toast('أدخل وزنًا صحيحًا'); input.focus(); return; }
      await addWeight({ weightKg: n });
      input.value = '';
      toast('تم الحفظ');
      afterChange();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    return el('div', { className: 'stack', style: { gap: 'var(--s-2)' } }, [
      el('div', { className: 'entry' }, [input, el('button', { className: 'btn btn-primary', text: 'حفظ', onClick: save })]),
      el('button', { className: 'link-btn', style: { alignSelf: 'flex-start' }, text: 'تسجيل لتاريخ آخر…', onClick: () => openAddSheet({ afterChange }) }),
    ]);
  }

  function heroPanel(s, todayOfficial) {
    if (!s.latest) {
      return el('div', { className: 'empty' }, [
        el('div', { className: 'empty-title', text: 'لم تسجّل وزنك بعد.' }),
        el('p', { className: 'muted', text: 'أدخل وزنك بالأعلى لتبدأ رحلتك.' }),
      ]);
    }
    const latest = s.latest;
    const isToday = latest.localDate === todayLocal();
    const prev = previousOfficialBefore(s.timeline, latest.localDate);
    const d = changeKg(prev, latest);
    const isNewLow = s.decorations.get(latest.id)?.newLow;

    const subBits = [];
    if (d != null) subBits.push(el('span', { className: `delta ${d < 0 ? 'down' : d > 0 ? 'up' : 'flat'} num`, text: `${formatDelta(d)} كجم` }));
    if (!isToday) subBits.push(el('span', { className: 'num muted', text: formatArabicDateShort(latest.localDate) }));
    if (isNewLow) subBits.push(el('span', { className: 'badge-new', text: 'أقل وزن ★' }));

    const lines = [];
    if (s.movingAvg && s.movingAvg.avg != null) lines.push(statLine('متوسط 7 أيام', `${formatWeight(s.movingAvg.avg)} كجم`));
    if (s.trajectory && s.trajectory.status) {
      const tone = s.trajectory.status === 'ahead' ? 'down' : s.trajectory.status === 'behind' ? 'up' : 'flat';
      lines.push(statLine('المسار', trajectoryText[s.trajectory.status](s.trajectory.deltaKg), { tone }));
    }
    if (s.next) lines.push(statLine(s.next.kind === 'final' ? 'الهدف النهائي' : 'الهدف القادم',
      `${formatWeight(s.next.targetWeight)} كجم${s.next.remainingKg != null ? ` • متبقٍ ${formatWeight(s.next.remainingKg)}` : ''}`));

    return el('div', { className: 'panel' }, [
      hero({ cap: isToday ? 'وزن اليوم' : 'آخر وزن رسمي', value: formatWeight(latest.weightKg), unit: 'كجم', sub: subBits }),
      lines.length ? el('div', { style: { marginTop: 'var(--s-3)' } }, lines) : null,
    ].filter(Boolean));
  }

  function chartPanel(entries, plan, milestones) {
    const range = RANGES.find((r) => r.key === rangeKey);
    const earliest = entries.length ? entries.map((e) => e.localDate).sort()[0] : todayLocal();
    const from = range.days == null ? earliest : addDays(todayLocal(), -(range.days - 1));
    const days = rangeDays(from, todayLocal());
    const series = weightSeries(days, entries, plan, milestones);

    const head = el('div', { className: 'section-head' }, [el('h2', { text: 'المخطط' })]);
    const rangeRow = chips(RANGES.map((r) => ({ key: r.key, label: r.label })), rangeKey, (k) => { rangeKey = k; draw(); }, { scroll: true });

    let body;
    if (series.actual.length < 2) {
      body = el('div', { className: 'chart-empty', text: 'سجّل قياسين على الأقل لعرض المخطط.' });
    } else {
      const idx = new Map(days.map((d, i) => [d, i]));
      const ticks = [days[0], days[Math.floor(days.length / 2)], days[days.length - 1]].map((d) => ({ x: idx.get(d), label: formatArabicDateShort(d) }));
      body = el('div', { className: 'chart' }, [
        lineChart({
          series: [
            { points: series.trajectory, color: COL.target, dashed: true, strokeWidth: 1.5 },
            { points: series.ma, color: COL.ma, strokeWidth: 1.5 },
            { points: series.actual, color: COL.actual, strokeWidth: 2, showPoints: true },
            { points: series.milestones, color: COL.actual, showLine: false, showPoints: true, pointRadius: 4 },
          ],
          xTicks: ticks, formatY: (v) => formatWeight(v), ariaLabel: 'مخطط الوزن',
        }),
        legend([{ label: 'الوزن الفعلي', color: COL.actual }, { label: 'متوسط 7 أيام', color: COL.ma }, { label: 'المسار المستهدف', color: COL.target, dashed: true }]),
      ]);
    }
    return el('section', { className: 'section' }, [head, rangeRow, el('div', { style: { marginTop: 'var(--s-3)' } }, [body])]);
  }

  function milestonePanel(s) {
    const ms = (s.milestones || []).filter((m) => !m.sameAsFinal);
    const total = ms.length + (s.finalStatus ? 1 : 0);
    if (!total) return el('div', {});
    return el('section', { className: 'section' }, [
      el('div', { className: 'section-head' }, [el('h2', { text: 'المراحل' })]),
      milestoneTimeline(s),
    ]);
  }

  function history(entries, s, afterChange) {
    const rows = officialHistoryRows(entries);
    const head = el('div', { className: 'section-head' }, [
      el('h2', { text: 'السجل' }),
      el('span', { className: 'aux num', text: rows.length ? String(rows.length) : '' }),
    ]);
    if (!rows.length) {
      return el('section', { className: 'section' }, [head, el('div', { className: 'empty' }, [el('div', { className: 'empty-title', text: 'لا يوجد سجل وزن بعد.' })])]);
    }
    const list = el('div', { className: 'list' }, rows.map(({ entry, delta }) => {
      const deco = s.decorations.get(entry.id) || { newLow: false, tags: [] };
      const tags = [];
      if (deco.newLow) tags.push(el('span', { className: 'badge-new', text: 'أقل وزن ★' }));
      for (const t of deco.tags) {
        if (t.type === 'final') tags.push(el('span', { className: 'badge-new', text: 'الهدف ★' }));
        else tags.push(el('span', { className: 'badge-new', text: `مرحلة ${formatWeight(t.targetWeight)} ★` }));
      }
      return el('button', { className: 'row', onClick: () => openDaySheet({ localDate: entry.localDate, afterChange }) }, [
        el('div', { className: 'row-label' }, [
          numericLTR(formatArabicDate(entry.localDate)),
          tags.length ? el('div', { className: 'wrap-tags', style: { marginTop: '2px' } }, tags) : null,
          entry.note ? el('div', { className: 'sub', text: entry.note }) : null,
        ].filter(Boolean)),
        el('div', { style: { textAlign: 'end' } }, [
          el('span', { className: 'hist-weight numeric-ltr', text: `${formatWeight(entry.weightKg)} كجم` }),
          delta != null ? el('div', { className: `delta ${delta < 0 ? 'down' : delta > 0 ? 'up' : 'flat'} num`, text: `${formatDelta(delta)}` }) : null,
        ].filter(Boolean)),
      ]);
    }));
    return el('section', { className: 'section' }, [head, list]);
  }

  const unsub1 = on('weight:changed', draw);
  const unsub2 = on('goals:changed', draw);
  draw().then(() => {
    // If navigated with a valid date (e.g. from the calendar Day Summary), open
    // that date's existing day sheet so the selected-date context is preserved.
    // Reuses the existing sheet; creates no records.
    if (ctx.param && isValidLocalDate(ctx.param)) {
      openDaySheet({ localDate: ctx.param, afterChange: draw });
    }
  });
  return () => { unsub1(); unsub2(); };
}
