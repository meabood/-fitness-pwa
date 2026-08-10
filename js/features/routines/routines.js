// routines/routines.js — training plans. Normal browsing prioritizes routine
// identity + a light day/exercise/muscle summary and starting the workout.
// Management (duplicate/archive/restore) lives behind an explicit edit toggle:
// CONSUMPTION MODE != EDITING MODE.

import { el, toast } from '../../core/dom.js';
import { on } from '../../core/events.js';
import {
  getActiveRoutines, getArchivedRoutines, createRoutine, duplicateRoutine,
  archiveRoutine, restoreRoutine, getRoutineFull,
} from '../../data/routines.repo.js';
import { getAllExercises } from '../../data/exercises.repo.js';
import { regionsForExercises, REGION_LABEL_AR } from '../../domain/muscleMap.js';
import { pageHead, segmented, emptyState } from '../../core/ui.js';

export function renderRoutines(root, ctx = {}) {
  const navigate = ctx.navigate || (() => {});
  let mode = 'active';
  let editing = false;

  async function draw() {
    const [routines, allEx] = await Promise.all([
      mode === 'active' ? getActiveRoutines() : getArchivedRoutines(),
      getAllExercises(),
    ]);
    const exById = new Map(allEx.map((x) => [x.id, x]));

    // enrich each active routine with a light summary (days · exercises · regions)
    const summaries = new Map();
    if (mode === 'active') {
      for (const r of routines) {
        const full = await getRoutineFull(r.id);
        const exs = [];
        for (const d of (full?.days || [])) for (const rx of d.exercises) {
          const ex = exById.get(rx.exerciseId);
          if (ex) exs.push({ muscleGroup: ex.muscleGroup, name: ex.name });
        }
        summaries.set(r.id, { days: full?.days.length || 0, exercises: exs.length, regions: regionsForExercises(exs) });
      }
    }

    root.replaceChildren(el('div', { className: 'route-view stack' }, [
      pageHead('البرامج', { actionLabel: mode === 'active' ? (editing ? 'تم' : 'تحرير') : null, onAction: () => { editing = !editing; draw(); } }),
      segmented([{ key: 'active', label: 'نشطة' }, { key: 'archived', label: 'مؤرشفة' }], mode, (m) => { mode = m; editing = false; draw(); }),
      mode === 'active' ? quickCreate() : null,
      routines.length
        ? el('div', { className: 'stack' }, routines.map((r) => routineCard(r, summaries.get(r.id))))
        : emptyState({ icon: 'workout', title: mode === 'active' ? 'لا توجد برامج بعد.' : 'لا توجد برامج مؤرشفة.', hint: mode === 'active' ? 'أنشئ برنامجًا لتنظيم أيام تمرينك.' : null }),
    ].filter(Boolean)));

    function quickCreate() {
      const input = el('input', { className: 'input grow', type: 'text', placeholder: 'اسم البرنامج الجديد' });
      const create = async () => { const name = input.value.trim(); if (!name) { toast('أدخل اسمًا'); return; } const id = await createRoutine(name); input.value = ''; navigate('routine', id); };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') create(); });
      return el('div', { className: 'entry' }, [input, el('button', { className: 'btn btn-primary', text: 'إنشاء', onClick: create })]);
    }

    function routineCard(r, sum) {
      const chips = sum ? [...sum.regions.primary, ...sum.regions.secondary].map((rg) => REGION_LABEL_AR[rg]).filter(Boolean) : [];
      const metaBits = [];
      if (sum) { metaBits.push(`${sum.days} أيام`); metaBits.push(`${sum.exercises} تمارين`); }
      const open = () => navigate('routine', r.id);
      return el('div', { className: 'panel' }, [
        el('div', { className: 'row-inline', style: { justifyContent: 'space-between', alignItems: 'flex-start' } }, [
          el('button', { className: 'grow', style: { background: 'none', border: 'none', textAlign: 'start', padding: 0 }, onClick: open }, [
            el('div', { className: 'ex-name', text: r.name }),
            metaBits.length ? el('div', { className: 'muted', style: { fontSize: 'var(--t-sm)', marginTop: '2px' }, text: metaBits.join(' · ') }) : null,
            chips.length ? el('div', { className: 'muted-sm', style: { marginTop: '4px' }, text: chips.join(' · ') }) : null,
            r.notes ? el('div', { className: 'muted-sm', style: { marginTop: '4px' }, text: r.notes }) : null,
          ].filter(Boolean)),
          !editing ? el('div', { className: 'chev', text: '‹' }) : null,
        ].filter(Boolean)),
        editing ? el('div', { className: 'row-inline', style: { marginTop: 'var(--s-3)', gap: 'var(--s-2)' } }, mode === 'active'
          ? [
              el('button', { className: 'btn btn-secondary', text: 'فتح', onClick: open }),
              el('button', { className: 'btn btn-secondary', text: 'نسخ', onClick: async () => { await duplicateRoutine(r.id); toast('تم النسخ'); } }),
              el('button', { className: 'btn btn-danger', text: 'أرشفة', onClick: async () => { await archiveRoutine(r.id); toast('تمت الأرشفة'); } }),
            ]
          : [el('button', { className: 'btn btn-secondary', text: 'استعادة', onClick: async () => { await restoreRoutine(r.id); toast('تمت الاستعادة'); } })]) : null,
      ].filter(Boolean));
    }
  }

  const unsub = on('routines:changed', draw);
  draw();
  return () => unsub();
}
