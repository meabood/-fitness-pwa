// meals/mealSheets.js — add / edit a Meal Library item. Protein may be left
// blank (unknown); it is never coerced to 0. Editing never rewrites logged
// history (entries are snapshots).

import { el, toast } from '../../core/dom.js';
import { openSheet } from '../../core/sheet.js';
import { addMeal, updateMeal, validateMeal } from '../../data/meals.repo.js';

function labeled(t, node) { return el('div', { className: 'field' }, [el('label', { text: t }), node]); }
const txtIn = (v, ph) => el('input', { className: 'input', type: 'text', placeholder: ph || '', value: v || '' });
const numIn = (v, ph) => el('input', { className: 'input num', type: 'number', inputmode: 'decimal', step: '0.1', min: '0', placeholder: ph || '', value: v != null ? String(v) : '' });

export function openMealEditor({ meal, afterChange } = {}) {
  const name = txtIn(meal?.name, 'اسم الوجبة');
  const cal = numIn(meal?.calories, 'سعرات لكل حصة');
  const prot = numIn(meal?.protein, 'بروتين (اختياري)');
  const serving = txtIn(meal?.serving, 'وصف الحصة (اختياري)');
  const notes = txtIn(meal?.notes, 'ملاحظات (اختياري)');
  const errBox = el('div', {});

  const save = el('button', {
    className: 'btn btn-primary btn-block', text: meal ? 'حفظ التغييرات' : 'إضافة',
    onClick: async () => {
      const data = { name: name.value, calories: cal.value, protein: prot.value === '' ? null : prot.value, serving: serving.value, notes: notes.value };
      const errors = validateMeal(data);
      if (errors.length) { errBox.replaceChildren(el('div', { className: 'notice', style: { color: 'var(--neg)' } }, errors.map((e) => el('div', { text: `• ${e}` })))); return; }
      try {
        if (meal) await updateMeal(meal.id, data); else await addMeal(data);
        toast('تم الحفظ'); handle.close(); afterChange && afterChange();
      } catch (err) { toast((err.errors && err.errors[0]) || 'تعذّر الحفظ'); }
    },
  });

  const body = el('div', { className: 'stack' }, [
    labeled('الاسم', name), labeled('السعرات لكل حصة', cal),
    labeled('البروتين لكل حصة (اختياري)', prot),
    el('p', { className: 'hint', text: 'اترك البروتين فارغًا إذا كان غير معروف — لن يُحتسب صفرًا.' }),
    labeled('الحصة', serving), labeled('ملاحظات', notes),
    errBox, el('div', { style: { marginTop: 'var(--s-4)' } }, [save]),
  ]);
  const handle = openSheet({ title: meal ? 'تعديل وجبة' : 'وجبة جديدة', body });
  return handle;
}
