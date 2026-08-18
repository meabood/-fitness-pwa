// workout/workout.js — the Workout tab hub: start a workout (routine → day),
// open routines and the exercise library, and see recent sessions.

import { el, toast } from '../../core/dom.js';
import { on } from '../../core/events.js';
import { getRecentSessions, getSession, setSessionCompleted, setSessionDuration, getActiveSession, getAllActiveSessions, deleteSession } from '../../data/workouts.repo.js';
import { formatArabicDate } from '../../core/dates.js';
import { pageHead, emptyState } from '../../core/ui.js';
import { openSheet } from '../../core/sheet.js';
import { isStaleWorkout, effectiveElapsedSec } from '../../domain/recovery.js';

export function renderWorkout(root, ctx = {}) {
  const navigate = ctx.navigate || (() => {});

  async function draw() {
    // Authoritative active-session source — not a recent-list scan, so a
    // genuinely active workout is surfaced even if it is old (item 3).
    const [recent, active, actives] = await Promise.all([
      getRecentSessions(10), getActiveSession(), getAllActiveSessions(),
    ]);
    const stale = active && isStaleWorkout(active);
    const multiActive = actives.length > 1; // legacy-invalid state (item 2)

    function fmtDur(sec) {
      const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
      return h > 0 ? `${h}س ${m}د` : `${m}د`;
    }

    root.replaceChildren(el('div', { className: 'route-view stack' }, [
      pageHead('التمارين'),

      // Legacy-invalid state: more than one active session (item 2). Never
      // silently pick/delete — let the user resolve each.
      multiActive
        ? el('div', { className: 'recovery-banner' }, [
            el('div', { className: 'rb-title', text: 'لديك أكثر من تمرين مفتوح' }),
            el('div', { className: 'muted-sm', text: `وُجد ${actives.length} تمارين مفتوحة. اختر ما تريد فعله بكل واحد.` }),
            el('div', { className: 'stack', style: { gap: 'var(--s-2)', marginTop: 'var(--s-3)' } }, actives.map((s) => el('div', { className: 'row-inline', style: { justifyContent: 'space-between', gap: 'var(--s-2)', flexWrap: 'wrap' } }, [
              el('div', { className: 'muted-sm', text: `${s.routineDayNameSnapshot || 'تمرين حر'} • ${formatArabicDate(s.localDate)} • ${fmtDur(effectiveElapsedSec(s))}` }),
              el('div', { className: 'rb-actions', style: { marginTop: 0 } }, [
                el('button', { className: 'btn btn-primary btn-sm', text: 'متابعة', onClick: () => navigate('session', s.id) }),
                el('button', { className: 'btn btn-secondary btn-sm', text: 'إنهاء', onClick: async () => { await setSessionCompleted(s.id, true); draw(); } }),
              ]),
            ]))),
            el('p', { className: 'hint', text: 'لن يُحذف أو يُنهى أي تمرين تلقائيًا.' }),
          ])
        : null,

      stale
        ? el('div', { className: 'recovery-banner' }, [
            el('div', { className: 'rb-title', text: 'لديك تمرين ما زال مفتوحًا' }),
            el('div', { className: 'muted-sm num', text: `بدأ ${formatArabicDate(active.localDate)} • المدة الحالية ${fmtDur(effectiveElapsedSec(active))}` }),
            el('div', { className: 'rb-actions' }, [
              el('button', { className: 'btn btn-primary btn-sm', text: 'استئناف التمرين', onClick: () => navigate('session', active.id) }),
              el('button', { className: 'btn btn-secondary btn-sm', text: 'تعديل المدة', onClick: () => openStaleDurationEditor(active) }),
              el('button', { className: 'btn btn-secondary btn-sm', text: 'إنهاء التمرين', onClick: async () => { await setSessionCompleted(active.id, true); draw(); } }),
            ]),
            el('p', { className: 'hint', text: 'لن يتم تعديل المدة تلقائيًا.' }),
          ])
        : (active && !multiActive
            ? el('button', { className: 'btn btn-primary btn-block', text: 'متابعة التمرين الحالي', onClick: () => navigate('session', active.id) })
            : (!active ? el('button', { className: 'btn btn-primary btn-block', text: 'ابدأ التمرين', onClick: () => navigate('start') }) : null)),

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

  // Direct duration recovery for a stale workout (item 9) — no auto-guessing.
  async function openStaleDurationEditor(active) {
    const cur = effectiveElapsedSec(active);
    const hh = el('input', { className: 'input num', type: 'number', inputmode: 'numeric', min: '0', value: String(Math.floor(cur / 3600)) });
    const mm = el('input', { className: 'input num', type: 'number', inputmode: 'numeric', min: '0', max: '59', value: String(Math.floor((cur % 3600) / 60)) });
    const save = el('button', { className: 'btn btn-primary btn-block', text: 'حفظ المدة', onClick: async () => {
      const secs = (Math.max(0, parseInt(hh.value || '0', 10)) * 3600) + (Math.max(0, parseInt(mm.value || '0', 10)) * 60);
      await setSessionDuration(active.id, secs); toast('تم حفظ المدة'); h.close(); draw();
    } });
    const body = el('div', { className: 'stack' }, [
      el('p', { className: 'muted-sm', text: 'صحّح مدة هذا التمرين. لا يغيّر المجموعات أو التمارين.' }),
      el('div', { className: 'row-inline' }, [
        el('div', { className: 'field grow', style: { marginTop: 0 } }, [el('label', { text: 'ساعات' }), hh]),
        el('div', { className: 'field grow', style: { marginTop: 0 } }, [el('label', { text: 'دقائق' }), mm]),
      ]),
      save,
    ]);
    const h = openSheet({ title: 'مدة التمرين', body });
  }

  const unsub = on('workout:changed', draw);
  draw();
  return () => unsub();
}
