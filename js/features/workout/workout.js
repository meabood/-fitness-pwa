// workout/workout.js — the Workout tab hub: start a workout (from a routine day
// or ad-hoc), open routines and the exercise library, and see recent sessions.

import { el, toast } from '../../core/dom.js';
import { on } from '../../core/events.js';
import { openSheet } from '../../core/sheet.js';
import { getActiveRoutines, getDays } from '../../data/routines.repo.js';
import { startSession, getRecentSessions } from '../../data/workouts.repo.js';
import { formatArabicDate } from '../../core/dates.js';
import { pageHead, emptyState } from '../../core/ui.js';

export function renderWorkout(root, ctx = {}) {
  const navigate = ctx.navigate || (() => {});

  async function draw() {
    const recent = await getRecentSessions(10);

    root.replaceChildren(el('div', { className: 'route-view stack' }, [
      pageHead('التمارين'),

      el('button', { className: 'btn btn-primary btn-block', text: 'بدء تمرين', onClick: startFlow }),

      el('div', { className: 'list' }, [
        navRow('البرامج التدريبية', 'برامج الأيام والتمارين', () => navigate('routines')),
        navRow('مكتبة التمارين', 'التمارين ومجموعاتها العضلية والأجهزة', () => navigate('exercises')),
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

  async function startFlow() {
    const routines = await getActiveRoutines();
    const body = el('div', { className: 'stack' });
    const handle = openSheet({ title: 'بدء تمرين', body });

    const adHoc = el('button', { className: 'btn btn-secondary btn-block', text: 'تمرين حر (بدون برنامج)', onClick: async () => { const id = await startSession({}); handle.close(); navigate('session', id); } });

    if (!routines.length) {
      body.replaceChildren(el('div', { className: 'stack' }, [
        el('div', { className: 'notice', text: 'لا توجد برامج نشطة. يمكنك بدء تمرين حر أو إنشاء برنامج.' }),
        adHoc,
        el('button', { className: 'btn btn-ghost btn-block', text: 'إنشاء برنامج', onClick: () => { handle.close(); navigate('routines'); } }),
      ]));
      return;
    }

    async function showRoutine(r) {
      const days = await getDays(r.id);
      body.replaceChildren(el('div', { className: 'stack' }, [
        el('div', { className: 'section-head' }, [el('h2', { text: r.name }), el('button', { className: 'link-btn', text: 'رجوع', onClick: showList })]),
        days.length ? el('div', { className: 'list' }, days.map((d) => el('button', { className: 'row', style: { width: '100%' }, onClick: async () => { const id = await startSession({ routineId: r.id, routineDayId: d.id }); handle.close(); navigate('session', id); } }, [
          el('div', { className: 'row-label', text: d.name }), el('div', { className: 'chev', text: '‹' }),
        ]))) : el('div', { className: 'notice', text: 'لا توجد أيام في هذا البرنامج.' }),
      ]));
    }
    function showList() {
      body.replaceChildren(el('div', { className: 'stack' }, [
        el('div', { className: 'list' }, routines.map((r) => el('button', { className: 'row', style: { width: '100%' }, onClick: () => showRoutine(r) }, [
          el('div', { className: 'row-label', text: r.name }), el('div', { className: 'chev', text: '‹' }),
        ]))),
        el('div', { className: 'section-head' }, [el('h2', { text: 'أو' })]),
        adHoc,
      ]));
    }
    showList();
  }

  const unsub = on('workout:changed', draw);
  draw();
  return () => unsub();
}
