// workout/workout.js — the Workout tab hub: start a workout (routine → day),
// open routines and the exercise library, and see recent sessions.

import { el } from '../../core/dom.js';
import { on } from '../../core/events.js';
import { getRecentSessions } from '../../data/workouts.repo.js';
import { formatArabicDate } from '../../core/dates.js';
import { pageHead, emptyState } from '../../core/ui.js';

export function renderWorkout(root, ctx = {}) {
  const navigate = ctx.navigate || (() => {});

  async function draw() {
    const recent = await getRecentSessions(10);
    const active = recent.find((s) => !s.completed);

    root.replaceChildren(el('div', { className: 'route-view stack' }, [
      pageHead('التمارين'),

      active
        ? el('button', { className: 'btn btn-primary btn-block', text: 'متابعة التمرين الحالي', onClick: () => navigate('session', active.id) })
        : el('button', { className: 'btn btn-primary btn-block', text: 'ابدأ التمرين', onClick: () => navigate('start') }),

      el('div', { className: 'list' }, [
        navRow('البرامج التدريبية', 'برامج الأيام والتمارين', () => navigate('routines')),
        navRow('مكتبة التمارين', 'التمارين والأجهزة', () => navigate('exercises')),
      ]),

      el('div', { className: 'section-head' }, [el('h2', { text: 'جلسات أخيرة' })]),
      recent.length
        ? el('div', { className: 'list' }, recent.map(sessionRow))
        : emptyState({ icon: 'workout', title: 'لا توجد جلسات بعد.', hint: 'ابدأ تمرينًا لتظهر جلساتك هنا.' }),
    ]));

    function navRow(title, sub, onClick) {
      return el('button', { className: 'row', style: { width: '100%' }, onClick }, [
        el('div', { className: 'row-label' }, [el('div', { text: title }), el('div', { className: 'sub', text: sub })]),
        el('div', { className: 'chev', text: '‹' }),
      ]);
    }
    function sessionRow(s) {
      return el('button', { className: 'row', style: { width: '100%' }, onClick: () => navigate('session', s.id) }, [
        el('div', { className: 'row-label' }, [
          el('div', { text: s.routineDayNameSnapshot || 'تمرين حر' }),
          el('div', { className: 'sub num', text: `${formatArabicDate(s.localDate)}${s.completed ? ' • مكتملة' : ' • قيد التنفيذ'}` }),
        ]),
        el('div', { className: 'chev', text: '‹' }),
      ]);
    }
  }

  const unsub = on('workout:changed', draw);
  draw();
  return () => unsub();
}
