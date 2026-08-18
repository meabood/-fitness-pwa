// home/home.js — the daily dashboard. Calm, glanceable, domain-tinted cards:
// weight (green) with next-goal sub-card, nutrition (amber), workout (indigo),
// a weight-goal mini timeline, and real achievements. Every value is factual;
// unknown/unlogged states are honest (never shown as 0).

import { el } from '../../core/dom.js';
import { on } from '../../core/events.js';
import { ICONS } from '../../core/icons.js';
import { formatArabicDate, formatArabicDateShort, todayLocal } from '../../core/dates.js';
import { formatWeight, formatDelta, formatInt } from '../../core/num.js';
import { pageHead, progress, sparkline, numericLTR, exerciseTitle } from '../../core/ui.js';
import { getAllEntries } from '../../data/weight.repo.js';
import { getActivePlanWithMilestones } from '../../data/goals.repo.js';
import { getConfig, getTargetForDate } from '../../data/settings.repo.js';
import { getEntriesForDate, getDay } from '../../data/nutrition.repo.js';
import { getSessionsForDate } from '../../data/workouts.repo.js';
import { dayTotals, remaining } from '../../domain/nutritionStats.js';
import { previousOfficialBefore, changeKg, weekSummary } from '../../domain/weightStats.js';
import { computeWeightSummary } from '../../domain/weightAchievements.js';
import { milestoneTimeline } from '../weight/milestoneTimeline.js';

const trajStatus = {
  ahead: { text: 'متقدم على المسار', cls: 'down' },
  on: { text: 'على المسار تقريبًا', cls: 'flat' },
  behind: { text: 'متأخر عن المسار', cls: 'up' },
};

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
      pageHead('👋 صباح الخير', { sub: formatArabicDate(today) }),
      weightCard(s, navigate),
      el('div', { className: 'dgrid' }, [
        nutritionCard(nutEntries, nutDay, calTarget, protTarget, navigate),
        workoutCard(sessions, navigate),
      ]),
      goalsSection(s, plan, navigate),
      achievementsSection(s, navigate),
    ].filter(Boolean)));
  }

  // ── Weight card (hero + next-goal sub-card) ──
  function weightCard(s, navigate) {
    const latest = s.latest;
    const card = el('button', { className: 'dcard', style: { width: '100%', textAlign: 'start', display: 'block' }, onClick: () => navigate('weight') });

    if (!latest) {
      card.append(el('div', { className: 'row-inline', style: { gap: 'var(--s-3)' } }, [
        el('span', { className: 'icon-chip weight', html: ICONS.scale }),
        el('div', { className: 'grow' }, [el('div', { style: { fontWeight: 'var(--w-medium)' }, text: 'تتبّع وزنك' }), el('div', { className: 'muted-sm', text: 'سجّل أول وزن لتبدأ' })]),
        el('span', { className: 'chev', text: '‹' }),
      ]));
      return card;
    }

    const isToday = latest.localDate === todayLocal();
    const prev = previousOfficialBefore(s.timeline, latest.localDate);
    const d = changeKg(prev, latest);
    const recent = s.timeline.slice(-12).map((e, i) => ({ x: i, y: e.weightKg }));

    const heroCol = el('div', { className: 'grow' }, [
      el('div', { className: 'dcard-head', style: { marginBottom: 'var(--s-2)' } }, [
        el('span', { className: 'icon-chip weight', html: ICONS.scale }),
        el('span', { className: 't', text: isToday ? 'الوزن اليوم' : 'آخر وزن رسمي' }),
      ]),
      el('div', { className: 'val-cluster', style: { fontSize: 'var(--t-metric)', fontWeight: 'var(--w-semibold)' } }, [
        el('span', { text: formatWeight(latest.weightKg) }), el('span', { className: 'u', text: 'كجم' }),
      ]),
      d != null ? el('div', { className: `delta ${d < 0 ? 'down' : d > 0 ? 'up' : 'flat'}`, style: { marginTop: '2px' } }, [
        numericLTR(`${formatDelta(d)} كجم`),
      ]) : null,
      el('div', { className: 'muted-sm', style: { marginTop: '2px' }, text: 'عن آخر وزن رسمي' }),
    ].filter(Boolean));

    const spark = recent.length >= 2 ? el('div', { style: { flex: '0 0 auto', alignSelf: 'flex-start' } }, [sparkline(recent, { width: 120, height: 44, color: 'var(--weight)' })]) : null;

    card.append(el('div', { className: 'row-inline', style: { alignItems: 'flex-start', gap: 'var(--s-3)' } }, [heroCol, spark].filter(Boolean)));

    // next-goal sub-card
    if (s.next) {
      const t = s.trajectory && s.trajectory.status ? trajStatus[s.trajectory.status] : null;
      card.append(el('div', { className: 'dcard', style: { marginTop: 'var(--s-3)', background: 'var(--surface-2)', border: 'none' } }, [
        el('div', { className: 'muted-sm', text: s.next.kind === 'final' ? 'هدفك النهائي' : 'هدفك القادم' }),
        el('div', { className: 'val-cluster', style: { fontSize: 'var(--t-lg)', fontWeight: 'var(--w-semibold)', marginTop: '2px' } }, [
          el('span', { text: formatWeight(s.next.targetWeight) }), el('span', { className: 'u', text: 'كجم' }),
        ]),
        s.next.remainingKg != null ? el('div', { className: 'muted-sm', style: { marginTop: '2px' } }, [numericLTR(`باقي ${formatWeight(s.next.remainingKg)} كجم`)]) : null,
        t ? el('div', { className: `delta ${t.cls}`, style: { marginTop: 'var(--s-2)', fontSize: 'var(--t-sm)' }, text: `● ${t.text}` }) : null,
      ].filter(Boolean)));
    }
    return card;
  }

  // ── Nutrition card (amber) ──
  function nutritionCard(entries, day, calTarget, protTarget, navigate) {
    const totals = dayTotals(entries);
    const card = el('button', { className: 'dcard tint-nutrition', style: { width: '100%', textAlign: 'start', display: 'block' }, onClick: () => navigate('nutrition') });
    card.append(el('div', { className: 'dcard-head' }, [
      el('span', { className: 'icon-chip nutrition', html: ICONS.nutrition }),
      el('span', { className: 't', text: 'التغذية اليوم' }),
    ]));

    if (!entries.length && !day?.completed) {
      card.append(el('div', { className: 'muted-sm', text: 'لا وجبات بعد' }));
      card.append(el('div', { className: 'btn btn-primary btn-sm', style: { marginTop: 'var(--s-2)', textAlign: 'center' }, text: 'إضافة وجبة' }));
      return card;
    }

    const rem = calTarget != null ? remaining(totals.calories, calTarget) : null;
    card.append(el('div', { className: 'val-cluster', style: { fontSize: 'var(--t-lg)', fontWeight: 'var(--w-semibold)' } }, [
      el('span', { text: formatInt(totals.calories) }),
      calTarget != null ? el('span', { className: 'u', text: `/ ${formatInt(calTarget)}` }) : el('span', { className: 'u', text: 'سعرة' }),
    ]));
    if (calTarget != null) {
      const ratio = totals.calories / calTarget;
      card.append(el('div', { style: { marginTop: 'var(--s-2)' } }, [progressNutrition(ratio)]));
      card.append(el('div', { className: 'muted-sm', style: { marginTop: 'var(--s-2)' } }, [numericLTR(`${rem >= 0 ? 'باقي' : 'فوق'} ${formatInt(Math.abs(rem))} سعرة`)]));
    }
    // protein mini
    const protLine = el('div', { style: { marginTop: 'var(--s-3)' } }, [
      el('div', { className: 'row-inline', style: { justifyContent: 'space-between' } }, [
        el('span', { className: 'muted-sm', text: 'البروتين' }),
        el('span', { className: 'num', style: { fontWeight: 'var(--w-medium)' }, text: totals.protein == null ? 'غير معروف' : `${formatWeight(totals.protein)} جم` }),
      ]),
    ]);
    if (totals.protein != null && protTarget != null) {
      protLine.append(el('div', { style: { marginTop: 'var(--s-1)' } }, [progressProtein(totals.protein / protTarget)]));
      protLine.append(el('div', { className: 'muted-sm', style: { marginTop: '2px' } }, [numericLTR(`الهدف: ${formatWeight(protTarget)} جم`)]));
    }
    card.append(protLine);
    return card;
  }

  // ── Workout card (indigo) ──
  function workoutCard(sessions, navigate) {
    const todays = (sessions || []).slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    const active = todays.find((x) => !x.completed);
    const done = !active && todays.length;

    const card = el('div', { className: 'dcard tint-workout' });
    card.append(el('div', { className: 'dcard-head' }, [
      el('span', { className: 'icon-chip workout', html: ICONS.workout }),
      el('span', { className: 't', text: 'التمرين' }),
    ]));

    if (active) {
      card.append(el('div', { style: { fontWeight: 'var(--w-medium)' }, text: active.routineDayNameSnapshot || 'تمرين حر' }));
      card.append(el('div', { className: 'muted-sm', style: { marginBottom: 'var(--s-3)' }, text: 'قيد التنفيذ' }));
      card.append(el('button', { className: 'btn btn-primary btn-block', text: 'متابعة التمرين', onClick: () => navigate('session', active.id) }));
      return card;
    }
    if (done) {
      const last = todays[todays.length - 1];
      card.append(el('div', { style: { fontWeight: 'var(--w-medium)' }, text: `✓ ${last.routineDayNameSnapshot || 'تمرين'}` }));
      card.append(el('div', { className: 'muted-sm', style: { marginBottom: 'var(--s-3)' }, text: 'اكتمل اليوم' }));
      card.append(el('button', { className: 'btn btn-secondary btn-block', text: 'عرض الجلسة', onClick: () => navigate('session', last.id) }));
      return card;
    }
    card.append(el('div', { style: { fontWeight: 'var(--w-semibold)', fontSize: 'var(--t-md)' }, text: 'جاهز لتمرين اليوم؟' }));
    card.append(el('div', { className: 'muted-sm', style: { marginBottom: 'var(--s-3)' }, text: 'سجّل تمارينك وتابع تقدّمك' }));
    card.append(el('button', { className: 'btn btn-primary btn-block', onClick: () => navigate('start') }, [
      el('span', { html: ICONS.play, style: { display: 'inline-flex', verticalAlign: 'middle', marginInlineEnd: '6px' } }), 'ابدأ التمرين',
    ]));
    return card;
  }

  // ── Weight goals mini timeline ──
  function goalsSection(s, plan, navigate) {
    const hasMs = (s.milestones || []).some((m) => !m.sameAsFinal) || !!s.finalStatus;
    if (!hasMs) return null;
    // Compact, horizontally scrollable timeline (auto-focused on the current
    // milestone). It never compresses many milestones into the viewport and
    // never adds a long list below — Home stays compact.
    const track = milestoneTimeline(s, { compact: true });

    // Compact "this week" summary (replaces the old expected/actual/diff box).
    // Everything shown is scoped strictly to the current Saturday-based week; a
    // previous-week weigh-in is never presented as this week's. Nothing stored.
    const wk = weekSummary(s.timeline || [], todayLocal());
    let summary = null;
    {
      const cell = (label, node, sub) => el('div', { className: 'grow', style: { textAlign: 'center' } }, [
        el('div', { className: 'muted-sm', text: label }), node, sub || null,
      ].filter(Boolean));
      const bigNum = (txt) => el('div', { className: 'num', style: { fontWeight: 'var(--w-semibold)' } }, [numericLTR(txt)]);
      const nextTargetTxt = s.next ? `${formatWeight(s.next.targetWeight)} كجم` : (s.finalStatus && s.finalStatus.reached ? 'تحقّق الهدف' : '—');
      const nextLabel = s.next && s.next.kind === 'final' ? 'الهدف' : 'المرحلة القادمة';

      const head = el('div', { className: 'wk-head muted-sm', text: 'هذا الأسبوع' });
      let row;
      if (!wk.hasWeekData) {
        // No official measurement this week — say so plainly; never show a
        // prior-week weight as if it were this week's, and no fabricated change.
        row = el('div', { className: 'row-inline', style: { marginTop: 'var(--s-2)' } }, [
          cell('القياس', el('div', { className: 'muted-sm', text: 'لا يوجد قياس هذا الأسبوع' })),
          cell(nextLabel, bigNum(nextTargetTxt)),
        ]);
      } else {
        const changeCell = wk.changeKg != null
          ? cell('التغير', el('div', { className: `delta ${wk.changeKg < 0 ? 'down' : wk.changeKg > 0 ? 'up' : 'flat'}`, style: { fontWeight: 'var(--w-semibold)' } }, [numericLTR(`${formatDelta(wk.changeKg)} كجم`)]))
          : cell('التغير', el('div', { className: 'muted-sm', text: 'قياس واحد' }));
        row = el('div', { className: 'row-inline', style: { marginTop: 'var(--s-2)' } }, [
          cell('أول قياس هذا الأسبوع', bigNum(`${formatWeight(wk.firstInWeek.weightKg)} كجم`)),
          cell('آخر وزن', bigNum(`${formatWeight(wk.latestInWeek.weightKg)} كجم`)),
          changeCell,
          cell(nextLabel, bigNum(nextTargetTxt)),
        ]);
      }
      summary = el('div', { className: 'dcard', style: { background: 'var(--weight-soft)', border: 'none', marginTop: 'var(--s-3)' } }, [head, row]);
    }

    return el('section', { className: 'section' }, [
      el('div', { className: 'section-head' }, [el('h2', { text: 'أهداف الوزن' }), el('button', { className: 'sec-action', text: 'عرض الكل', onClick: () => navigate('goals') })]),
      track,
      summary,
    ].filter(Boolean));
  }

  // ── Achievements (real only) ──
  function achievementsSection(s, navigate) {
    const items = [];
    if (s.latest && s.decorations.get(s.latest.id)?.newLow) {
      items.push({ icon: 'star', tint: 'star', title: 'أقل وزن جديد', value: `${formatWeight(s.latest.weightKg)} كجم`, date: s.latest.localDate });
    }
    const reached = (s.milestones || []).filter((m) => m.reached && !m.sameAsFinal).slice(-1)[0];
    if (reached) items.push({ icon: 'trophy', tint: 'workout', title: 'وصلت لهدف', value: `${formatWeight(reached.targetWeight)} كجم`, date: reached.achievedDate });
    if (!items.length) return null;

    return el('section', { className: 'section' }, [
      el('div', { className: 'section-head' }, [el('h2', { text: 'إنجازاتك' }), el('button', { className: 'sec-action', text: 'عرض الكل', onClick: () => navigate('weight') })]),
      el('div', { className: 'dgrid' }, items.map((a) => el('div', { className: 'dcard' }, [
        el('span', { className: `icon-chip ${a.tint}`, html: a.icon === 'trophy' ? ICONS.trophy : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.9 6.3 6.9.6-5.2 4.5 1.6 6.7L12 17l-6.2 3.6 1.6-6.7L2.2 8.9l6.9-.6z"/></svg>' }),
        el('div', { style: { marginTop: 'var(--s-2)', fontWeight: 'var(--w-medium)' }, text: a.title }),
        el('div', { className: 'num', style: { fontWeight: 'var(--w-semibold)' }, text: a.value }),
        a.date ? el('div', { className: 'muted-sm' }, [numericLTR(formatArabicDateShort(a.date))]) : null,
      ].filter(Boolean)))),
    ]);
  }

  const unsubs = ['weight:changed', 'goals:changed', 'nutrition:changed', 'settings:changed', 'workout:changed'].map((t) => on(t, draw));
  draw();
  return () => unsubs.forEach((u) => u());
}

// domain-tinted progress helpers
function progressNutrition(ratio) { const p = progress(ratio, { over: ratio > 1 }); p.classList.add('nutrition'); return p; }
function progressProtein(ratio) { const p = progress(ratio); p.classList.add('protein'); return p; }
