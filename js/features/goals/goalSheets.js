// goals/goalSheets.js — create/edit a weight goal plan and its milestones.
// Validation errors are shown inline; invalid input is rejected (never repaired).

import { el, toast } from '../../core/dom.js';
import { openSheet } from '../../core/sheet.js';
import { createPlan, updatePlan, ValidationError } from '../../data/goals.repo.js';
import { validateGoalPlan } from '../../domain/goalValidation.js';
import { todayLocal } from '../../core/dates.js';

function labeled(labelText, node) {
  return el('div', { className: 'field' }, [el('label', { text: labelText }), node]);
}
const wInput = (v) => el('input', { className: 'input num', type: 'number', inputmode: 'decimal', step: '0.1', min: '0', placeholder: 'كجم', value: v != null ? String(v) : '' });
const dInput = (v) => el('input', { className: 'input num', type: 'date', value: v || '' });

/** @param {object} [existing] { plan, milestones } to edit; omit to create new. */
export function openPlanEditor({ existing, afterChange } = {}) {
  const plan = existing?.plan;
  const nameIn = el('input', { className: 'input', type: 'text', placeholder: 'اسم الخطة', value: plan?.name || 'خطة الوزن' });
  const startW = wInput(plan?.startWeight);
  const startD = dInput(plan?.startDate || todayLocal());
  const finalW = wInput(plan?.finalWeight);
  const finalD = dInput(plan?.finalDate);

  // milestone rows
  const rowsWrap = el('div', { className: 'stack' });
  const milestoneRows = [];
  function addRow(m) {
    const w = wInput(m?.targetWeight);
    const d = dInput(m?.targetDate);
    const label = el('input', { className: 'input', type: 'text', placeholder: 'وسم (اختياري)', value: m?.label || '' });
    const remove = el('button', { className: 'link-btn danger', text: 'حذف', onClick: () => {
      const i = milestoneRows.indexOf(ref); if (i >= 0) milestoneRows.splice(i, 1); rowEl.remove();
    } });
    const rowEl = el('div', { className: 'list', style: { padding: 'var(--s-3)' } }, [
      el('div', { className: 'quick-add' }, [w, d]),
      el('div', { style: { marginTop: 'var(--s-2)', display: 'flex', gap: 'var(--s-2)', alignItems: 'center' } }, [label, remove]),
    ]);
    const ref = { w, d, label };
    milestoneRows.push(ref);
    rowsWrap.append(rowEl);
  }
  (existing?.milestones || []).forEach(addRow);

  const errorsBox = el('div', {});
  function showErrors(errors) {
    errorsBox.replaceChildren(el('div', { className: 'notice', style: { color: 'var(--neg)' } },
      errors.map((e) => el('div', { text: `• ${e}` }))));
  }
  function clearErrors() { errorsBox.replaceChildren(); }

  function collect() {
    const planData = {
      name: nameIn.value,
      startWeight: startW.value === '' ? NaN : Number(startW.value),
      startDate: startD.value,
      finalWeight: finalW.value === '' ? NaN : Number(finalW.value),
      finalDate: finalD.value,
    };
    const milestones = milestoneRows.map((r) => ({
      targetWeight: r.w.value === '' ? NaN : Number(r.w.value),
      targetDate: r.d.value,
      label: r.label.value,
    }));
    return { planData, milestones };
  }

  const save = el('button', {
    className: 'btn btn-primary btn-block', text: plan ? 'حفظ التغييرات' : 'إنشاء الخطة',
    onClick: async () => {
      const { planData, milestones } = collect();
      const { ok, errors } = validateGoalPlan(planData, milestones);
      if (!ok) { showErrors(errors); toast('تحقّق من المدخلات'); return; }
      clearErrors();
      try {
        if (plan) await updatePlan(plan.id, planData, milestones);
        else await createPlan(planData, milestones, { activate: true });
        toast('تم الحفظ');
        handle.close();
        afterChange && afterChange();
      } catch (err) {
        if (err instanceof ValidationError) showErrors(err.errors);
        else { console.error(err); toast('تعذّر الحفظ'); }
      }
    },
  });

  const body = el('div', { className: 'stack' }, [
    labeled('اسم الخطة', nameIn),
    el('div', { className: 'quick-add' }, [labeled('وزن البداية', startW), labeled('تاريخ البداية', startD)]),
    el('div', { className: 'quick-add' }, [labeled('وزن الهدف', finalW), labeled('تاريخ الهدف', finalD)]),
    el('div', { className: 'section-head', style: { marginTop: 'var(--s-5)' } }, [
      el('h2', { text: 'المراحل' }),
      el('button', { className: 'link-btn', text: 'إضافة مرحلة', onClick: () => addRow() }),
    ]),
    rowsWrap,
    errorsBox,
    el('div', { style: { marginTop: 'var(--s-5)' } }, [save]),
  ]);

  const handle = openSheet({ title: plan ? 'تعديل خطة الهدف' : 'خطة هدف جديدة', body });
  return handle;
}
