// routines/routineEditor.js — edit one routine: its days and each day's ordered
// exercises, plus a per-day muscle map (broad regions) that updates as exercises
// change. Reordering uses up/down (thumb-friendly). Removing an exercise from a
// routine never affects workout history (that lives in workoutSets by id).

import { el, toast } from '../../core/dom.js';
import { on } from '../../core/events.js';
import {
  getRoutineFull, renameRoutine, setRoutineNotes, archiveRoutine, restoreRoutine, duplicateRoutine,
  addDay, renameDay, deleteDay, duplicateDay, moveDay,
  addExerciseToDay, removeRoutineExercise, replaceRoutineExercise, setRoutineExerciseNote, moveRoutineExercise,
} from '../../data/routines.repo.js';
import { getAllExercises } from '../../data/exercises.repo.js';
import { openExercisePicker } from '../exercises/exercisePicker.js';
import { regionsForExercises } from '../../domain/muscleMap.js';
import { bodyMap } from '../../core/bodyMap.js';
import { pageHead, reorderControl } from '../../core/ui.js';
import { openSheet } from '../../core/sheet.js';

export function renderRoutineEditor(root, ctx = {}) {
  const navigate = ctx.navigate || (() => {});
  const routineId = ctx.param;

  async function draw() {
    const [full, allEx] = await Promise.all([getRoutineFull(routineId), getAllExercises()]);
    if (!full) {
      root.replaceChildren(el('div', { className: 'route-view stack' }, [
        pageHead('برنامج'),
        el('div', { className: 'notice', text: 'البرنامج غير موجود.' }),
        el('button', { className: 'btn btn-secondary btn-block', text: 'رجوع', onClick: () => navigate('routines') }),
      ]));
      return;
    }
    const exById = new Map(allEx.map((x) => [x.id, x]));
    const exName = new Map(allEx.map((x) => [x.id, x.name]));
    const { routine, days } = full;

    // overall muscle map across the whole routine
    const allInRoutine = [];
    for (const d of days) for (const rx of d.exercises) { const ex = exById.get(rx.exerciseId); if (ex) allInRoutine.push({ muscleGroup: ex.muscleGroup, name: ex.name }); }
    const overall = regionsForExercises(allInRoutine);

    const newDay = el('input', { className: 'input grow', type: 'text', placeholder: 'اسم اليوم (مثال: دفع)' });
    const addDayBtn = el('button', { className: 'btn btn-primary', text: 'إضافة', onClick: async () => { const n = newDay.value.trim(); if (!n) { toast('أدخل اسمًا'); return; } await addDay(routine.id, n); newDay.value = ''; } });

    root.replaceChildren(el('div', { className: 'route-view stack' }, [
      pageHead(routine.name, { actionLabel: 'تفاصيل', onAction: () => openRoutineSettings(routine) }),

      (overall.primary.size || overall.secondary.size)
        ? el('div', { className: 'panel' }, [bodyMap(overall)])
        : null,

      el('div', { className: 'section-head' }, [el('h2', { text: 'الأيام' })]),
      ...days.map((d, i) => dayCard(d, i, days.length)),
      el('div', { className: 'entry' }, [newDay, addDayBtn]),
    ].filter(Boolean)));

    function dayCard({ day, exercises }, idx, total) {
      const dName = el('input', { className: 'input', type: 'text', value: day.name, attrs: { 'aria-label': 'اسم اليوم' } });
      dName.addEventListener('change', () => renameDay(day.id, dName.value));
      const exs = exercises.map((rx) => { const ex = exById.get(rx.exerciseId); return ex ? { muscleGroup: ex.muscleGroup, name: ex.name } : {}; });
      const regions = regionsForExercises(exs);

      return el('section', { className: 'day-card' }, [
        el('div', { className: 'day-head' }, [
          el('div', { className: 'grow' }, [
            dName,
            el('div', { className: 'day-meta', text: `${exercises.length} تمارين` }),
          ]),
          reorderControl({ onUp: () => moveDay(routine.id, day.id, 'up'), onDown: () => moveDay(routine.id, day.id, 'down'), labelUp: 'تحريك اليوم لأعلى', labelDown: 'تحريك اليوم لأسفل' }),
        ]),
        (regions.primary.size || regions.secondary.size)
          ? el('div', { style: { marginTop: 'var(--s-3)' } }, [bodyMap(regions, { legend: true })])
          : null,
        exercises.length
          ? el('div', { style: { marginTop: 'var(--s-3)' } }, exercises.map((rx) => exRow(day, rx)))
          : el('div', { className: 'empty-state', style: { padding: 'var(--s-4)' } }, [el('span', { className: 'muted', text: 'لا توجد تمارين في هذا اليوم.' })]),
        el('div', { className: 'day-actions' }, [
          el('button', { className: 'btn btn-primary btn-sm', text: '+ تمرين', onClick: () => openExercisePicker({ onPick: (x) => addExerciseToDay(day.id, x.id) }) }),
          el('button', { className: 'btn btn-tertiary btn-sm', text: 'نسخ اليوم', onClick: () => duplicateDay(day.id) }),
          el('span', { className: 'spacer' }),
          el('button', { className: 'btn btn-tertiary danger btn-sm', text: 'حذف اليوم', onClick: () => deleteDay(day.id) }),
        ]),
      ].filter(Boolean));
    }

    function exRow(day, rx) {
      const noteIn = el('input', { className: 'input input-sm', type: 'text', value: rx.note || '', placeholder: 'ملاحظة (اختياري)', attrs: { 'aria-label': 'ملاحظة التمرين' } });
      noteIn.addEventListener('change', () => setRoutineExerciseNote(rx.id, noteIn.value));
      return el('div', { className: 'ex-line' }, [
        reorderControl({ onUp: () => moveRoutineExercise(day.id, rx.id, 'up'), onDown: () => moveRoutineExercise(day.id, rx.id, 'down'), labelUp: 'تحريك التمرين لأعلى', labelDown: 'تحريك التمرين لأسفل' }),
        el('div', { className: 'ex-nm' }, [
          el('div', { className: 'ex-nm-title', text: exName.get(rx.exerciseId) || 'تمرين (محذوف)' }),
          noteIn,
        ]),
        el('button', { className: 'link-btn', text: 'استبدال', onClick: () => openExercisePicker({ onPick: (x) => replaceRoutineExercise(rx.id, x.id) }) }),
        el('button', { className: 'link-btn danger', text: 'إزالة', onClick: () => removeRoutineExercise(rx.id) }),
      ]);
    }

    function openRoutineSettings(routine) {
      const nameInput = el('input', { className: 'input', type: 'text', value: routine.name });
      nameInput.addEventListener('change', () => renameRoutine(routine.id, nameInput.value));
      const notesInput = el('input', { className: 'input', type: 'text', value: routine.notes, placeholder: 'ملاحظات (اختياري)' });
      notesInput.addEventListener('change', () => setRoutineNotes(routine.id, notesInput.value));
      const body = el('div', { className: 'stack' }, [
        el('div', { className: 'field' }, [el('label', { text: 'اسم البرنامج' }), nameInput]),
        el('div', { className: 'field' }, [el('label', { text: 'ملاحظات' }), notesInput]),
        el('div', { className: 'divider' }),
        el('button', { className: 'btn btn-secondary btn-block', text: 'نسخ البرنامج', onClick: async () => { const id = await duplicateRoutine(routine.id); toast('تم النسخ'); handle.close(); navigate('routine', id); } }),
        routine.status === 'archived'
          ? el('button', { className: 'btn btn-ghost btn-block', text: 'استعادة', onClick: async () => { await restoreRoutine(routine.id); toast('تمت الاستعادة'); handle.close(); } })
          : el('button', { className: 'btn btn-danger btn-block', text: 'أرشفة البرنامج', onClick: async () => { await archiveRoutine(routine.id); toast('تمت الأرشفة'); handle.close(); navigate('routines'); } }),
      ]);
      const handle = openSheet({ title: 'تفاصيل البرنامج', body });
    }
  }

  const unsub = on('routines:changed', draw);
  const unsub2 = on('exercises:changed', draw);
  draw();
  return () => { unsub(); unsub2(); };
}
