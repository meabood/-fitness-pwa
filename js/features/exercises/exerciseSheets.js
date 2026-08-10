// exercises/exerciseSheets.js — add / edit an exercise. Separate machines should
// be separate exercises (separate ids); the UI notes this rather than merging.

import { el, toast } from '../../core/dom.js';
import { openSheet } from '../../core/sheet.js';
import { addExercise, updateExercise, validateExercise } from '../../data/exercises.repo.js';
import { getConfig } from '../../data/settings.repo.js';

function labeled(t, node) { return el('div', { className: 'field' }, [el('label', { text: t }), node]); }
const txtIn = (v, ph) => el('input', { className: 'input', type: 'text', placeholder: ph || '', value: v || '' });

function unitSegment(value) {
  let cur = value;
  const btns = ['kg', 'lb'].map((u) => el('button', { className: u === cur ? 'on' : '', text: u.toUpperCase(), onClick: () => { cur = u; btns.forEach((b) => b.classList.toggle('on', b.textContent === u.toUpperCase())); } }));
  return { node: el('div', { className: 'seg' }, btns), get: () => cur };
}

export async function openExerciseEditor({ exercise, afterChange } = {}) {
  const defUnit = exercise?.defaultUnit || (await getConfig('defaultExerciseUnit')) || 'lb';
  const name = txtIn(exercise?.name, 'اسم التمرين');
  const muscle = txtIn(exercise?.muscleGroup, 'المجموعة العضلية (اختياري)');
  const equipment = txtIn(exercise?.equipment, 'نوع الجهاز/الأداة (اختياري)');
  const machine = txtIn(exercise?.machineId, 'معرّف الجهاز (اختياري)');
  const notes = txtIn(exercise?.notes, 'ملاحظات (اختياري)');
  const unit = unitSegment(defUnit);
  const errBox = el('div', {});

  const save = el('button', {
    className: 'btn btn-primary btn-block', text: exercise ? 'حفظ التغييرات' : 'إضافة',
    onClick: async () => {
      const data = { name: name.value, muscleGroup: muscle.value, equipment: equipment.value, machineId: machine.value, notes: notes.value, defaultUnit: unit.get() };
      const errors = validateExercise(data);
      if (errors.length) { errBox.replaceChildren(el('div', { className: 'notice', style: { color: 'var(--neg)' } }, errors.map((e) => el('div', { text: `• ${e}` })))); return; }
      try {
        if (exercise) await updateExercise(exercise.id, data); else await addExercise(data);
        toast('تم الحفظ'); handle.close(); afterChange && afterChange();
      } catch (err) { toast((err.errors && err.errors[0]) || 'تعذّر الحفظ'); }
    },
  });

  const body = el('div', { className: 'stack' }, [
    labeled('الاسم', name), labeled('المجموعة العضلية', muscle),
    labeled('الجهاز/الأداة', equipment), labeled('معرّف الجهاز', machine),
    el('p', { className: 'hint', text: 'الأجهزة المختلفة قد تختلف مقاومتها؛ أنشئ تمرينًا منفصلاً لكل جهاز إذا رغبت بفصل السجل.' }),
    labeled('الوحدة الافتراضية', unit.node), labeled('ملاحظات', notes),
    errBox, el('div', { style: { marginTop: 'var(--s-4)' } }, [save]),
  ]);
  const handle = openSheet({ title: exercise ? 'تعديل تمرين' : 'تمرين جديد', body });
  return handle;
}
