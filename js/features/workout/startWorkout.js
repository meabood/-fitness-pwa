// workout/startWorkout.js — the fast "ابدأ التمرين" flow. SELECTION ONLY:
// choose a routine, then a day; tapping a day creates the session and jumps
// straight into the active workout. No editing/reordering/delete here.

import { el } from '../../core/dom.js';
import { getActiveRoutines, getRoutineFull } from '../../data/routines.repo.js';
import { getAllExercises } from '../../data/exercises.repo.js';
import { startSession, getSessionsForDate } from '../../data/workouts.repo.js';
import { todayLocal } from '../../core/dates.js';
import { pageHead, emptyState, exerciseTitle } from '../../core/ui.js';

export function renderStartWorkout(root, ctx = {}) {
  const navigate = ctx.navigate || (() => {});
  const routineId = ctx.param || null;

  async function draw() {
    const routines = await getActiveRoutines();

    if (!routines.length) {
      root.replaceChildren(el('div', { className: 'route-view stack' }, [
        pageHead('ابدأ التمرين'),
        emptyState({ icon: 'workout', title: 'لا توجد برامج بعد.', hint: 'أنشئ برنامجًا وأضف أيامًا لبدء تمرينك.', actionLabel: 'إنشاء برنامج', onAction: () => navigate('routines') }),
        el('button', { className: 'btn btn-tertiary btn-block', text: 'بدء تمرين حر بدون برنامج', onClick: () => startAdHoc() }),
      ]));
      return;
    }

    // Step 2: a routine is chosen → show its days (or auto if single routine + no param handled below).
    if (routineId) {
      const full = await getRoutineFull(routineId);
      if (!full) { navigate('start'); return; }
      const allEx = await getAllExercises();
      const title = new Map(allEx.map((x) => [x.id, exerciseTitle(x)]));
      root.replaceChildren(el('div', { className: 'route-view stack' }, [
        pageHead(full.routine.name, { sub: 'اختر اليوم للبدء' }),
        full.days.length
          ? el('div', {}, full.days.map((d) => dayRow(d, title)))
          : emptyState({ icon: 'workout', title: 'لا توجد أيام في هذا البرنامج.', actionLabel: 'تعديل البرنامج', onAction: () => navigate('routine', routineId) }),
      ]));
      return;
    }

    // Step 1: choose a routine (selection only).
    root.replaceChildren(el('div', { className: 'route-view stack' }, [
      pageHead('ابدأ التمرين', { sub: 'اختر البرنامج' }),
      el('div', {}, routines.map(routineRow)),
      el('div', { className: 'divider' }),
      el('button', { className: 'btn btn-tertiary btn-block', text: 'تمرين حر بدون برنامج', onClick: () => startAdHoc() }),
    ]));

    function routineRow(r) {
      return el('button', { className: 'pickrow', onClick: () => navigate('start', r.id) }, [
        el('div', {}, [
          el('div', { style: { fontWeight: 'var(--w-medium)' }, text: r.name }),
          r.notes ? el('div', { className: 'pr-sub', text: r.notes }) : null,
        ].filter(Boolean)),
        el('div', { className: 'chev', text: '‹' }),
      ]);
    }
  }

  function dayRow(d, title) {
    const names = d.exercises.map((rx) => title.get(rx.exerciseId)).filter(Boolean).join(' · ');
    return el('button', { className: 'pickrow', onClick: () => begin(routineId, d.day.id) }, [
      el('div', { style: { minWidth: 0 } }, [
        el('div', { style: { fontWeight: 'var(--w-medium)' }, text: d.day.name }),
        el('div', { className: 'muted-sm', text: `${d.exercises.length} تمارين` }),
        names ? el('div', { className: 'pr-sub ex-title', text: names }) : null,
      ].filter(Boolean)),
      el('span', { className: 'icon-chip workout', style: { width: '38px', height: '38px' }, html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 5l12 7-12 7z"/></svg>' }),
    ]);
  }

  async function begin(rId, dayId) {
    // Resume an existing active (incomplete) session for this day today instead of
    // creating a duplicate.
    const today = todayLocal();
    const todays = await getSessionsForDate(today);
    const existing = todays.find((s) => !s.completed && s.routineDayId === dayId);
    if (existing) { navigate('session', existing.id); return; }
    const id = await startSession({ routineId: rId, routineDayId: dayId, localDate: today });
    navigate('session', id);
  }

  async function startAdHoc() {
    const id = await startSession({ localDate: todayLocal() });
    navigate('session', id);
  }

  draw();
}
