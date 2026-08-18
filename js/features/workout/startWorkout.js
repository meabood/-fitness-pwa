// workout/startWorkout.js — the fast "ابدأ التمرين" flow.
// With an ACTIVE routine set, the daily path is: pick a day → start (no
// repetitive routine selection). The active routine can be changed via a subtle
// "تغيير". History drives a non-binding next-day suggestion. Selection only —
// no editing/reordering/delete here.

import { el, toast } from '../../core/dom.js';
import { getActiveRoutines, getRoutineFull, getActiveRoutineId, setActiveRoutine } from '../../data/routines.repo.js';
import { getAllExercises } from '../../data/exercises.repo.js';
import { startSession, getSessionsForDate, getRecentSessions, getActiveSession, getSession, getSetsForSession, deleteSession } from '../../data/workouts.repo.js';
import { todayLocal } from '../../core/dates.js';
import { pageHead, emptyState, exerciseTitle } from '../../core/ui.js';
import { openSheet } from '../../core/sheet.js';
import { suggestNextDay, lastPerformedDayId } from '../../domain/recovery.js';

export function renderStartWorkout(root, ctx = {}) {
  const navigate = ctx.navigate || (() => {});
  // ctx.param: explicit routine override ("choose routine" path); otherwise the
  // active routine (or the only routine) is used automatically.
  const paramRoutineId = ctx.param || null;
  let choosing = false; // when true, show the routine list even if an active one exists

  async function draw() {
    const routines = await getActiveRoutines();

    if (!routines.length) {
      root.replaceChildren(el('div', { className: 'route-view stack' }, [
        pageHead('ابدأ التمرين'),
        emptyState({ icon: 'workout', title: 'لا توجد برامج بعد.', hint: 'أنشئ برنامجًا وأضف أيامًا لبدء تمرينك.', actionLabel: 'إنشاء برنامج', onAction: () => navigate('routines') }),
        el('button', { className: 'btn btn-tertiary btn-block', text: 'بدء تمرين حر بدون برنامج', onClick: startAdHoc }),
      ]));
      return;
    }

    // Decide which routine to show days for.
    let routineId = paramRoutineId;
    if (!routineId && !choosing) {
      routineId = (await getActiveRoutineId()) || (routines.length === 1 ? routines[0].id : null);
    }

    // Routine chooser (only when no active/param routine, or user tapped تغيير).
    if (!routineId) {
      root.replaceChildren(el('div', { className: 'route-view stack' }, [
        pageHead('ابدأ التمرين', { sub: 'اختر البرنامج' }),
        el('div', {}, routines.map(routineRow)),
        el('div', { className: 'divider' }),
        el('button', { className: 'btn btn-tertiary btn-block', text: 'تمرين حر بدون برنامج', onClick: startAdHoc }),
      ]));
      return;
    }

    // Day picker for the chosen routine.
    const full = await getRoutineFull(routineId);
    if (!full) { choosing = true; draw(); return; }
    const [allEx, recent, activeId, activeSession] = await Promise.all([getAllExercises(), getRecentSessions(30), getActiveRoutineId(), getActiveSession()]);
    const title = new Map(allEx.map((x) => [x.id, exerciseTitle(x)]));
    const orderedDays = full.days.map((d) => ({ id: d.day.id, name: d.day.name }));
    // Suggestion uses ONLY this routine's completed history (item 13).
    const suggestion = suggestNextDay(orderedDays, recent, routineId);
    const lastDayId = lastPerformedDayId(recent, routineId);
    const isActive = activeId === routineId;

    root.replaceChildren(el('div', { className: 'route-view stack' }, [
      // Surface an already-open workout instead of allowing a second one.
      activeSession ? openWorkoutBanner(activeSession) : null,
      // routine header row with subtle change + set-active
      el('div', { className: 'row-inline', style: { justifyContent: 'space-between', alignItems: 'baseline' } }, [
        el('div', {}, [
          el('div', { className: 'ph-title', text: full.routine.name }),
          el('div', { className: 'muted-sm', text: isActive ? 'الروتين النشط' : 'اختر اليوم للبدء' }),
        ]),
        el('button', { className: 'sec-action', text: 'تغيير', onClick: () => { choosing = true; draw(); } }),
      ]),
      !isActive ? el('button', { className: 'btn btn-tertiary btn-sm', text: 'تعيين كروتين نشط', onClick: async () => { await setActiveRoutine(routineId); draw(); } }) : null,
      full.days.length
        ? el('div', {}, full.days.map((d) => dayRow(routineId, d, title, suggestion, lastDayId)))
        : emptyState({ icon: 'workout', title: 'لا توجد أيام في هذا البرنامج.', actionLabel: 'تعديل البرنامج', onAction: () => navigate('routine', routineId) }),
    ].filter(Boolean)));

    function routineRow(r) {
      return el('button', { className: 'pickrow', onClick: () => { choosing = false; navigate('start', r.id); } }, [
        el('div', {}, [
          el('div', { style: { fontWeight: 'var(--w-medium)' }, text: r.name }),
          r.id === activeIdCache ? el('div', { className: 'muted-sm', text: 'الروتين النشط' }) : null,
        ].filter(Boolean)),
        el('div', { className: 'chev', text: '‹' }),
      ]);
    }
  }

  // Banner shown when an active workout already exists (one-active invariant).
  function openWorkoutBanner(active) {
    return el('div', { className: 'recovery-banner' }, [
      el('div', { className: 'rb-title', text: 'لديك تمرين مفتوح' }),
      el('div', { className: 'muted-sm', text: active.routineDayNameSnapshot || 'تمرين حر' }),
      el('div', { className: 'rb-actions' }, [
        el('button', { className: 'btn btn-primary btn-sm', text: 'متابعة التمرين الحالي', onClick: () => navigate('session', active.id) }),
      ]),
    ]);
  }

  let activeIdCache = null;
  getActiveRoutineId().then((id) => { activeIdCache = id; });

  function dayRow(routineId, d, title, suggestion, lastDayId) {
    const names = d.exercises.map((rx) => title.get(rx.exerciseId)).filter(Boolean).join(' · ');
    const isSuggested = suggestion && suggestion.id === d.day.id;
    const isLast = lastDayId === d.day.id;
    return el('button', { className: `pickrow${isSuggested ? ' suggested' : ''}`, onClick: () => begin(routineId, d.day.id) }, [
      el('div', { style: { minWidth: 0 } }, [
        el('div', { className: 'row-inline', style: { gap: 'var(--s-2)' } }, [
          el('div', { style: { fontWeight: 'var(--w-medium)' }, text: d.day.name }),
          isSuggested ? el('span', { className: 'pill-suggest', text: 'التالي المقترح' }) : null,
          isLast ? el('span', { className: 'muted-sm', text: 'آخر تمرين' }) : null,
        ].filter(Boolean)),
        el('div', { className: 'muted-sm', text: `${d.exercises.length} تمارين` }),
        names ? el('div', { className: 'pr-sub ex-title', text: names }) : null,
      ].filter(Boolean)),
      el('span', { className: 'icon-chip workout', style: { width: '38px', height: '38px' }, html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 5l12 7-12 7z"/></svg>' }),
    ]);
  }

  async function begin(rId, dayId) {
    const today = todayLocal();
    const todays = await getSessionsForDate(today);
    const existing = todays.find((s) => !s.completed && s.routineDayId === dayId);
    if (existing) { navigate('session', existing.id); return; }
    // Offer to set this routine active the first time (no silent replacement).
    const activeId = await getActiveRoutineId();
    if (!activeId) await setActiveRoutine(rId);
    try {
      const id = await startSession({ routineId: rId, routineDayId: dayId, localDate: today });
      navigate('session', id);
    } catch (err) {
      if (err && err.name === 'ActiveSessionExistsError') { surfaceActive(err.sessionId); return; }
      throw err;
    }
  }

  async function startAdHoc() {
    try {
      const id = await startSession({ localDate: todayLocal() });
      navigate('session', id);
    } catch (err) {
      if (err && err.name === 'ActiveSessionExistsError') { surfaceActive(err.sessionId); return; }
      throw err;
    }
  }

  // One active workout at a time: offer to continue it, or (if empty) cancel it.
  async function surfaceActive(sessionId) {
    const s = await getSession(sessionId);
    const setCount = s ? (await getSetsForSession(sessionId)).length : 0;
    const body = el('div', { className: 'stack' }, [
      el('p', { className: 'rb-title', text: 'لديك تمرين مفتوح' }),
      el('p', { className: 'muted-sm', text: (s && s.routineDayNameSnapshot) ? s.routineDayNameSnapshot : 'تمرين حر' }),
      el('button', { className: 'btn btn-primary btn-block', text: 'متابعة التمرين الحالي', onClick: () => { h.close(); navigate('session', sessionId); } }),
      setCount === 0
        ? el('button', { className: 'btn btn-danger btn-block', text: 'إلغاء الجلسة الفارغة', onClick: async () => { await deleteSession(sessionId); h.close(); toast('أُلغيت الجلسة'); draw(); } })
        : el('button', { className: 'btn btn-tertiary btn-block', text: 'إغلاق', onClick: () => h.close() }),
    ].filter(Boolean));
    const h = openSheet({ title: 'تمرين مفتوح', body });
  }

  draw();
}
