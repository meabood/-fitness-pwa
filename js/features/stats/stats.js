// features/stats/stats.js — the Statistics section: three subsections (الوزن /
// التغذية / التمارين) with a range filter, drawn with the custom SVG chart.
// All series come from pure transforms in domain/statsData.js.

import { el } from '../../core/dom.js';
import { on } from '../../core/events.js';
import { getAll } from '../../core/db.js';
import { todayLocal, addDays, formatArabicDateShort } from '../../core/dates.js';
import { lineChart, legend } from '../../core/svgChart.js';
import { getAllEntries } from '../../data/weight.repo.js';
import { getActivePlanWithMilestones } from '../../data/goals.repo.js';
import { getEntriesInRange } from '../../data/nutrition.repo.js';
import { getTargetRows, targetAtFromRows } from '../../data/settings.repo.js';
import { getActiveExercises } from '../../data/exercises.repo.js';
import { getExerciseSetsEnriched } from '../../data/workouts.repo.js';
import { openExercisePicker } from '../exercises/exercisePicker.js';
import { rangeDays, dayIndex, nutritionSeries, weightSeries, exerciseUnitSeries } from '../../domain/statsData.js';
import { formatWeight, formatInt } from '../../core/num.js';
import { pageHead, segmented, chips, statLine } from '../../core/ui.js';

const RANGES = [
  { key: '7d', label: '٧ أيام', days: 7 },
  { key: '30d', label: '٣٠ يومًا', days: 30 },
  { key: '3m', label: '٣ أشهر', days: 91 },
  { key: '6m', label: '٦ أشهر', days: 182 },
  { key: '1y', label: 'سنة', days: 365 },
  { key: 'all', label: 'الكل', days: null },
];

const COL = { actual: '#2f7d3b', ma: '#c98a1b', target: '#8a8f98', cal: '#2f6fd0', protein: '#7d3b8a' };

export function renderStats(root, ctx = {}) {
  const navigate = ctx.navigate || (() => {});
  let tab = 'weight';
  let rangeKey = '30d';
  let exerciseId = null, exerciseName = '';

  function rangeBounds(days, earliest) {
    const to = todayLocal();
    if (days == null) return { from: earliest || to, to };
    return { from: addDays(to, -(days - 1)), to };
  }
  function xTicksFor(days) {
    if (!days.length) return [];
    const idx = dayIndex(days);
    const mid = days[Math.floor(days.length / 2)];
    const picks = [days[0], mid, days[days.length - 1]];
    return [...new Set(picks)].map((d) => ({ x: idx.get(d), label: formatArabicDateShort(d) }));
  }

  async function draw() {
    root.replaceChildren(el('div', { className: 'route-view stack' }, [
      pageHead('الإحصائيات'),
      tabs(),
      rangeBar(),
      el('div', { id: 'stats-body' }, [el('div', { className: 'notice', text: 'جارٍ التحميل…' })]),
    ]));
    const body = root.querySelector('#stats-body');
    if (tab === 'weight') body.replaceChildren(await weightPanel());
    else if (tab === 'nutrition') body.replaceChildren(await nutritionPanel());
    else body.replaceChildren(await exercisePanel());
  }

  function tabs() {
    return segmented([
      { key: 'weight', label: 'الوزن' }, { key: 'nutrition', label: 'التغذية' }, { key: 'exercise', label: 'التمارين' },
    ], tab, (k) => { tab = k; draw(); });
  }
  function rangeBar() {
    return chips(RANGES.map((r) => ({ key: r.key, label: r.label })), rangeKey, (k) => { rangeKey = k; draw(); }, { scroll: true });
  }

  async function weightPanel() {
    const [entries, { plan, milestones }] = await Promise.all([getAllEntries(), getActivePlanWithMilestones()]);
    const earliest = entries.length ? entries.map((e) => e.localDate).sort()[0] : todayLocal();
    const { from, to } = rangeBounds(RANGES.find((r) => r.key === rangeKey).days, earliest);
    const days = rangeDays(from, to);
    const s = weightSeries(days, entries, plan, milestones);

    if (s.actual.length < 2) {
      return el('div', { className: 'stack' }, [
        el('div', { className: 'chart-empty', text: 'لا توجد قياسات كافية في هذه المدة. سجّل قياسين على الأقل.' }),
        s.actual.length === 1 ? el('div', { className: 'list' }, [stat('عدد القياسات', '1')]) : null,
      ].filter(Boolean));
    }

    const chart = lineChart({
      series: [
        { points: s.trajectory, color: COL.target, dashed: true, strokeWidth: 1.5 },
        { points: s.ma, color: COL.ma, strokeWidth: 1.5 },
        { points: s.actual, color: COL.actual, strokeWidth: 2, showPoints: true },
        { points: s.milestones, color: COL.actual, showLine: false, showPoints: true, pointRadius: 4 },
      ],
      xTicks: xTicksFor(days), formatY: (v) => formatWeight(v), ariaLabel: 'مخطط الوزن',
    });
    const last = s.actual.length ? s.actual[s.actual.length - 1].y : null;
    const first = s.actual.length ? s.actual[0].y : null;
    return el('div', { className: 'stack' }, [
      chart,
      legend([{ label: 'الوزن الفعلي', color: COL.actual }, { label: 'متوسط 7 أيام', color: COL.ma }, { label: 'المسار المستهدف', color: COL.target, dashed: true }]),
      el('div', { className: 'list' }, [
        stat('عدد القياسات', String(s.actual.length)),
        last != null ? stat('آخر وزن', `${formatWeight(last)} كجم`) : null,
        (first != null && last != null) ? stat('التغير خلال المدة', `${formatWeight(last - first)} كجم`) : null,
      ].filter(Boolean)),
      s.actual.length === 0 ? el('div', { className: 'notice', text: 'لا توجد قياسات في هذه المدة.' }) : null,
    ].filter(Boolean));
  }

  async function nutritionPanel() {
    const days0 = RANGES.find((r) => r.key === rangeKey).days;
    const { from, to } = rangeBounds(days0, addDays(todayLocal(), -(days0 || 30) + 1));
    const days = rangeDays(from, to);
    const [entries, calRows, proRows, allDays] = await Promise.all([
      getEntriesInRange(from, to), getTargetRows('calorie'), getTargetRows('protein'), getAll('nutritionDays'),
    ]);
    const entriesByDate = new Map();
    for (const e of entries) { if (!entriesByDate.has(e.localDate)) entriesByDate.set(e.localDate, []); entriesByDate.get(e.localDate).push(e); }
    const completedSet = new Set(allDays.filter((d) => d.completed).map((d) => d.localDate));
    const series = nutritionSeries(days, entriesByDate, completedSet, (d) => targetAtFromRows(calRows, d));
    const proteinTargetAt = (d) => targetAtFromRows(proRows, d);
    const proteinTarget = days.map((d, i) => ({ x: i, y: proteinTargetAt(d) }));

    const loggedCount = series.calories.filter((p) => p.y != null).length;
    if (loggedCount < 2) {
      return el('div', { className: 'chart-empty', text: 'سجّل يومين على الأقل لعرض اتجاه التغذية. الأيام غير المسجّلة تبقى فجوات ولا تُحتسب صفرًا.' });
    }

    const calChart = lineChart({
      series: [
        { points: series.calorieTarget, color: COL.target, dashed: true, strokeWidth: 1.5 },
        { points: series.calories, color: COL.cal, strokeWidth: 2, showPoints: true },
      ],
      xTicks: xTicksFor(days), formatY: (v) => formatInt(v), ariaLabel: 'مخطط السعرات',
    });
    const proChart = lineChart({
      series: [
        { points: proteinTarget, color: COL.target, dashed: true, strokeWidth: 1.5 },
        { points: series.protein, color: COL.protein, strokeWidth: 2, showPoints: true },
      ],
      xTicks: xTicksFor(days), formatY: (v) => formatInt(v), ariaLabel: 'مخطط البروتين',
    });

    // averages over LOGGED days only (missing days excluded — never counted as 0)
    const loggedCals = series.calories.filter((p) => p.y != null).map((p) => p.y);
    const loggedPro = series.protein.filter((p) => p.y != null).map((p) => p.y);
    const avg = (a) => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null;

    return el('div', { className: 'stack' }, [
      el('div', { className: 'section-head' }, [el('h2', { text: 'السعرات' })]),
      calChart,
      legend([{ label: 'السعرات', color: COL.cal }, { label: 'الهدف', color: COL.target, dashed: true }]),
      el('div', { className: 'section-head' }, [el('h2', { text: 'البروتين' })]),
      proChart,
      legend([{ label: 'البروتين', color: COL.protein }, { label: 'الهدف', color: COL.target, dashed: true }]),
      el('div', { className: 'list' }, [
        stat('أيام مسجّلة', String(loggedCals.length)),
        avg(loggedCals) != null ? stat('متوسط السعرات (الأيام المسجّلة)', `${formatInt(avg(loggedCals))}`) : null,
        avg(loggedPro) != null ? stat('متوسط البروتين (الأيام المسجّلة)', `${formatInt(avg(loggedPro))} جم`) : null,
      ].filter(Boolean)),
      el('p', { className: 'hint', text: 'الأيام غير المسجّلة تظهر كفجوات ولا تُحتسب صفرًا.' }),
    ]);
  }

  async function exercisePanel() {
    const actives = await getActiveExercises();
    const pick = el('button', { className: 'btn btn-secondary btn-block', text: exerciseName ? `التمرين: ${exerciseName}` : 'اختر تمرينًا', onClick: () => openExercisePicker({ onPick: (x) => { exerciseId = x.id; exerciseName = x.nameEn || x.name; draw(); } }) });
    if (!exerciseId) {
      return el('div', { className: 'stack' }, [
        pick,
        actives.length ? el('div', { className: 'notice', text: 'اختر تمرينًا لعرض تطوّر أعلى وزن أساسي عبر الزمن.' }) : el('div', { className: 'notice', text: 'لا توجد تمارين بعد.' }),
      ]);
    }
    const sets = await getExerciseSetsEnriched(exerciseId);
    // choose unit: the most-used working unit; never mix
    const units = [...new Set(sets.filter((s) => s.setType === 'working').map((s) => s.unit))];
    const unit = units[0] || 'kg';
    const series = exerciseUnitSeries(sets, unit);
    const pts = series.maxWeight; // x is a distinct sequential index per session
    const points = pts.map((p) => ({ x: p.x, y: p.y }));
    // friendly x labels: first & last session. Include time when two sessions
    // share a date so same-day sessions are visibly distinct.
    const labelFor = (p) => {
      const sameDay = pts.filter((q) => q.date === p.date).length > 1;
      return sameDay && p.start ? `${formatArabicDateShort(p.date)} ${p.start}` : formatArabicDateShort(p.date);
    };
    const xTicks = pts.length ? [...new Set([0, pts.length - 1])].map((i) => ({ x: pts[i].x, label: labelFor(pts[i]) })) : [];

    const chart = lineChart({
      series: [{ points, color: COL.actual, strokeWidth: 2, showPoints: true }],
      xTicks, formatY: (v) => formatWeight(v), ariaLabel: 'تطور الوزن',
    });
    return el('div', { className: 'stack' }, [
      pick,
      el('div', { className: 'section-head' }, [el('h2', { text: `أعلى وزن أساسي (${unit})` })]),
      pts.length ? chart : el('div', { className: 'notice', text: 'لا توجد مجموعات أساسية لهذا التمرين بعد.' }),
      units.length > 1 ? el('p', { className: 'hint', text: `هذا التمرين يحتوي على وحدات متعددة (${units.join(' و ')}). يُعرض ${unit} فقط لتجنّب خلط الوحدات.` }) : null,
    ].filter(Boolean));
  }

  const unsub1 = on('weight:changed', () => { if (tab === 'weight') draw(); });
  const unsub2 = on('nutrition:changed', () => { if (tab === 'nutrition') draw(); });
  const unsub3 = on('workout:changed', () => { if (tab === 'exercise') draw(); });
  const unsub4 = on('goals:changed', () => { if (tab === 'weight') draw(); });
  draw();
  return () => { unsub1(); unsub2(); unsub3(); unsub4(); };
}

function stat(label, value) {
  return el('div', { className: 'row' }, [
    el('div', { className: 'row-label', text: label }),
    el('div', { className: 'row-value num', text: value }),
  ]);
}
