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
import { pageHead } from '../../core/ui.js';
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
      const dName = el('input', { className: 'input grow', type: 'text', value: day.name });
      dName.addEventListener('change', () => renameDay(day.id, dName.value));
      const exs = exercises.map((rx) => { const ex = exById.get(rx.exerciseId); return ex ? { muscleGroup: ex.muscleGroup, name: ex.name } : {}; });
      const regions = regionsForExercises(exs);

      return el('section', { className: 'section' }, [
        el('div', { className: 'entry' }, [
          dName,
          el('div', { className: 'stepper' }, [
            el('button', { attrs: { 'aria-label': 'أعلى' }, text: '▲', onClick: () => moveDay(routine.id, day.id, 'up') }),
            el('button', { attrs: { 'aria-label': 'أسفل' }, text: '▼', onClick: () => moveDay(routine.id, day.id, 'down') }),
          ]),
        ]),
        (regions.primary.size || regions.secondary.size)
          ? el('div', { style: { marginTop: 'var(--s-3)' } }, [bodyMap(regions, { legend: true })])
          : null,
        exercises.length
          ? el('div', { className: 'list', style: { marginTop: 'var(--s-3)' } }, exercises.map((rx) => exRow(day, rx)))
          : el('div', { className: 'notice', style: { marginTop: 'var(--s-3)' }, text: 'لا توجد تمارين في هذا اليوم.' }),
        el('div', { className: 'wrap-tags', style: { marginTop: 'var(--s-3)' } }, [
          el('button', { className: 'chip', text: '+ تمرين', onClick: () => openExercisePicker({ onPick: (x) => addExerciseToDay(day.id, x.id) }) }),
          el('button', { className: 'chip', text: 'نسخ اليوم', onClick: () => duplicateDay(day.id) }),
          el('button', { className: 'chip', text: 'حذف اليوم', onClick: () => deleteDay(day.id) }),
        ]),
      ].filter(Boolean));
    }

    function exRow(day, rx) {
      const hasNote = !!rx.note;
      return el('div', { className: 'row', style: { display: 'block' } }, [
        el('div', { className: 'row-inline' }, [
          el('div', { className: 'row-label grow', text: exName.get(rx.exerciseId) || 'تمرين (محذوف)' }),
          el('div', { className: 'row-actions' }, [
            el('button', { className: 'link-btn', attrs: { 'aria-label': 'أعلى' }, text: '▲', onClick: () => moveRoutineExercise(day.id, rx.id, 'up') }),
            el('button', { className: 'link-btn', attrs: { 'aria-label': 'أسفل' }, text: '▼', onClick: () => moveRoutineExercise(day.id, rx.id, 'down') }),
            el('button', { className: 'link-btn', text: 'استبدال', onClick: () => openExercisePicker({ onPick: (x) => replaceRoutineExercise(rx.id, x.id) }) }),
            el('button', { className: 'link-btn danger', text: 'إزالة', onClick: () => removeRoutineExercise(rx.id) }),
          ]),
        ]),
        noteEditor(rx, hasNote),
      ]);
    }

    function noteEditor(rx, hasNote) {
      const noteIn = el('input', { className: 'input', type: 'text', value: rx.note || '', placeholder: 'ملاحظة خاصة بالبرنامج (اختياري)' });
      noteIn.addEventListener('change', () => setRoutineExerciseNote(rx.id, noteIn.value));
      return el('div', { style: { marginTop: 'var(--s-2)' } }, [noteIn]);
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
