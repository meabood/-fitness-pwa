// home/home.js — the daily dashboard. Three calm regions answer, at a glance:
// where is my weight, how is today's nutrition, and what about my workout.
// Every value is factual; unlogged/unknown states are shown honestly, never as 0.

import { el } from '../../core/dom.js';
import { on } from '../../core/events.js';
import { formatArabicDate, formatArabicDateShort, todayLocal } from '../../core/dates.js';
import { formatWeight, formatDelta, formatInt } from '../../core/num.js';
import { pageHead, hero, progress, statLine, sparkline } from '../../core/ui.js';
import { getAllEntries } from '../../data/weight.repo.js';
import { getActivePlanWithMilestones } from '../../data/goals.repo.js';
import { getConfig, getTargetForDate } from '../../data/settings.repo.js';
import { getEntriesForDate, getDay } from '../../data/nutrition.repo.js';
import { getSessionsForDate } from '../../data/workouts.repo.js';
import { dayTotals, remaining } from '../../domain/nutritionStats.js';
import { previousOfficialBefore, changeKg } from '../../domain/weightStats.js';
import { computeWeightSummary } from '../../domain/weightAchievements.js';

export function renderHome(root, { navigate }) {
  async function draw() {
    const today = todayLocal();
    const [entries, { plan, milestones }, tol, nutEntries, nutDay, calTarget, protTarget, sessions] = await Promise.all([
      getAllEntries(),
      getActivePlanWithMilestones(),
      getConfig('trajectoryToleranceKg'),
      getEntriesForDate(today),
      getDay(today),
      getTargetForDate('calorie', today),
      getTargetForDate('protein', today),
      getSessionsForDate(today),
    ]);
    const s = computeWeightSummary(entries, plan, milestones, { toleranceKg: tol });

    root.replaceChildren(el('div', { className: 'route-view stack' }, [
      pageHead('مساء الخير', { sub: formatArabicDate(today) }),
      weightRegion(s, plan, navigate),
      nutritionRegion(nutEntries, nutDay, calTarget, protTarget, navigate),
      workoutRegion(sessions, navigate),
    ]));
  }

  const unsubs = ['weight:changed', 'goals:changed', 'nutrition:changed', 'settings:changed', 'workout:changed']
    .map((t) => on(t, draw));
  draw();
  return () => unsubs.forEach((u) => u());
}

// ── Weight ─────────────────────────────────────────────────────────
function weightRegion(s, plan, navigate) {
  const head = sectionHead('الوزن', 'التفاصيل', () => navigate('weight'));
  const latest = s.latest;

  if (!latest) {
    return el('section', { className: 'section' }, [head, el('div', { className: 'panel' }, [
      el('p', { className: 'muted', style: { marginBottom: 'var(--s-3)' }, text: 'لم تسجّل وزنك بعد.' }),
      el('button', { className: 'btn btn-primary btn-block', text: 'تسجيل الوزن', onClick: () => navigate('weight') }),
    ])]);
  }

  const prev = previousOfficialBefore(s.timeline, latest.localDate);
  const d = changeKg(prev, latest);
  const isToday = latest.localDate === todayLocal();

  // recent official weights → sparkline (actual points only, no fabrication)
  const recent = s.timeline.slice(-10).map((e, i) => ({ x: i, y: e.weightKg }));

  const subBits = [];
  if (d != null) subBits.push(el('span', { className: `delta ${d < 0 ? 'down' : d > 0 ? 'up' : 'flat'} num`, text: `${formatDelta(d)} كجم` }));
  if (s.movingAvg && s.movingAvg.avg != null) subBits.push(el('span', { className: 'num', text: `متوسط 7 أيام ${formatWeight(s.movingAvg.avg)}` }));
  if (!isToday) subBits.push(el('span', { className: 'num muted', text: formatArabicDateShort(latest.localDate) }));

  const heroRow = el('div', { className: 'row-inline', style: { justifyContent: 'space-between', alignItems: 'flex-end' } }, [
    hero({ cap: isToday ? 'وزن اليوم' : 'آخر وزن رسمي', value: formatWeight(latest.weightKg), unit: 'كجم', sub: subBits }),
    recent.length >= 2 ? el('div', { style: { flex: '0 0 auto' } }, [sparkline(recent, { width: 116, height: 40 })]) : null,
  ].filter(Boolean));

  const parts = [heroRow];

  // overall goal progress (factual: start → final via latest)
  if (plan && Number.isFinite(plan.startWeight) && Number.isFinite(plan.finalWeight) && plan.startWeight !== plan.finalWeight) {
    const ratio = (plan.startWeight - latest.weightKg) / (plan.startWeight - plan.finalWeight);
    parts.push(el('div', { style: { marginTop: 'var(--s-3)' } }, [progress(ratio, { thin: true })]));
  }
  if (s.next) {
    parts.push(el('div', { style: { marginTop: 'var(--s-3)' } }, [
      statLine(s.next.kind === 'final' ? 'الهدف النهائي' : 'الهدف القادم',
        `${formatWeight(s.next.targetWeight)} كجم${s.next.remainingKg != null ? ` • متبقٍ ${formatWeight(s.next.remainingKg)}` : ''}`),
    ]));
  }

  return el('section', { className: 'section' }, [head, el('button', { className: 'panel press', style: { width: '100%', textAlign: 'start', display: 'block' }, onClick: () => navigate('weight') }, parts)]);
}

// ── Nutrition ──────────────────────────────────────────────────────
function nutritionRegion(entries, day, calTarget, protTarget, navigate) {
  const head = sectionHead('التغذية', 'اليوم', () => navigate('nutrition'));

  if (!entries.length && !day?.completed) {
    return el('section', { className: 'section' }, [head, el('div', { className: 'panel' }, [
      el('p', { className: 'muted', style: { marginBottom: 'var(--s-3)' }, text: 'لا توجد وجبات مسجّلة اليوم.' }),
      el('button', { className: 'btn btn-primary btn-block', text: 'إضافة وجبة', onClick: () => navigate('nutrition') }),
    ])]);
  }

  const totals = dayTotals(entries);
  const rem = calTarget != null ? remaining(totals.calories, calTarget) : null;

  const subBits = [];
  subBits.push(el('span', { className: 'num', text: totals.protein == null ? 'بروتين غير معروف' : `${formatInt(totals.protein)} جم بروتين` }));
  if (rem != null) subBits.push(el('span', { className: `num ${rem >= 0 ? '' : 'delta up'}`, text: `${rem >= 0 ? 'متبقٍ' : 'فوق'} ${formatInt(Math.abs(rem))}` }));

  const parts = [
    hero({
      cap: calTarget != null ? 'السعرات' : 'السعرات (بدون هدف)',
      value: formatInt(totals.calories),
      unit: calTarget != null ? `/ ${formatInt(calTarget)}` : 'سعرة',
      sub: subBits,
    }),
  ];
  if (calTarget != null) {
    const ratio = totals.calories / calTarget;
    parts.push(el('div', { style: { marginTop: 'var(--s-3)' } }, [progress(ratio, { over: ratio > 1 })]));
  }

  return el('section', { className: 'section' }, [
    head,
    el('button', { className: 'panel press', style: { width: '100%', textAlign: 'start', display: 'block' }, onClick: () => navigate('nutrition') }, parts),
    el('button', { className: 'btn btn-secondary btn-block', style: { marginTop: 'var(--s-3)' }, text: 'إضافة وجبة', onClick: () => navigate('nutrition') }),
  ]);
}

// ── Workout ────────────────────────────────────────────────────────
function workoutRegion(sessions, navigate) {
  const head = sectionHead('التمارين', 'الكل', () => navigate('workout'));
  const todays = (sessions || []).slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  if (!todays.length) {
    return el('section', { className: 'section' }, [head, el('div', { className: 'panel' }, [
      el('p', { className: 'muted', style: { marginBottom: 'var(--s-3)' }, text: 'لا يوجد تمرين اليوم.' }),
      el('button', { className: 'btn btn-primary btn-block', text: 'ابدأ التمرين', onClick: () => navigate('workout') }),
    ])]);
  }

  const active = todays.find((s) => !s.completed);
  const target = active || todays[todays.length - 1];
  const done = !active;

  const title = target.routineDayNameSnapshot || 'تمرين حر';
  const context = target.routineNameSnapshot ? target.routineNameSnapshot : (done ? 'مكتمل' : 'قيد التنفيذ');

  const panel = el('button', { className: 'panel press', style: { width: '100%', textAlign: 'start', display: 'block' }, onClick: () => navigate('session', target.id) }, [
    el('div', { className: 'row-inline', style: { justifyContent: 'space-between' } }, [
      el('div', {}, [
        el('div', { className: 'ex-name', text: (done ? '✓ ' : '') + title }),
        el('div', { className: 'muted', style: { fontSize: 'var(--t-sm)', marginTop: '2px' }, text: context }),
      ]),
      el('div', { className: 'chev', text: '‹' }),
    ]),
  ]);

  return el('section', { className: 'section' }, [
    head, panel,
    active ? el('button', { className: 'btn btn-primary btn-block', style: { marginTop: 'var(--s-3)' }, text: 'متابعة التمرين', onClick: () => navigate('session', active.id) }) : null,
  ].filter(Boolean));
}

// ── shared ─────────────────────────────────────────────────────────
function sectionHead(title, actionLabel, onAction) {
  return el('div', { className: 'section-head' }, [
    el('h2', { text: title }),
    el('button', { className: 'sec-action', text: actionLabel, onClick: onAction }),
  ]);
}
