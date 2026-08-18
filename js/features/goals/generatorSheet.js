// features/goals/generatorSheet.js — "إنشاء مراحل تلقائيًا". Generates a
// milestone sequence from a few inputs, PREVIEWS it before saving, and never
// silently overwrites existing milestones. Writes through the existing
// updatePlan (atomic replace-all) so generated milestones are ordinary
// milestones with no separate store or duplicated truth.

import { el, toast } from '../../core/dom.js';
import { openSheet } from '../../core/sheet.js';
import { updatePlan, ValidationError } from '../../data/goals.repo.js';
import { generateMilestones, mergeMilestones, toStorageMilestones, requiredFinalDate, FREQUENCIES } from '../../domain/milestoneGen.js';
import { validateGoalPlan } from '../../domain/goalValidation.js';
import { numericLTR } from '../../core/ui.js';
import { formatWeight } from '../../core/num.js';
import { formatArabicDateShort, todayLocal } from '../../core/dates.js';

const labeled = (t, node) => el('div', { className: 'field' }, [el('label', { text: t }), node]);
const wIn = (v) => el('input', { className: 'input num', type: 'number', inputmode: 'decimal', step: '0.1', min: '0', placeholder: 'كجم', value: v != null ? String(v) : '' });
const dIn = (v) => el('input', { className: 'input num', type: 'date', value: v || '' });

/**
 * @param plan       active plan (provides factual context + write target)
 * @param milestones existing milestones (raw records) for conflict handling
 * @param summary    computeWeightSummary output (for reached-weight preservation)
 * @param currentOfficialWeight number|null — today's official weight if any
 * @param afterChange callback after a successful write
 */
export function openGeneratorSheet({ plan, milestones = [], summary, currentOfficial = null, afterChange } = {}) {
  if (!plan) { toast('أنشئ خطة هدف أولًا'); return; }

  // Prefill from existing factual context; don't invent missing values, and
  // never pair a current weight with an old plan-start date. If we default the
  // start weight to the latest official measurement, we default the start date
  // to THAT measurement's factual localDate; otherwise fall back to the plan's
  // own start (weight+date together) or today.
  const useLatest = currentOfficial != null && currentOfficial.weightKg != null;
  const startDefault = useLatest ? currentOfficial.weightKg
    : (plan.startWeight != null ? plan.startWeight : null);
  const startDateDefault = useLatest
    ? (currentOfficial.localDate || todayLocal())
    : (plan.startDate || todayLocal());
  const startW = wIn(startDefault);
  const finalW = wIn(plan.finalWeight != null ? plan.finalWeight : null);
  const stepW = wIn(0.5);
  const startD = dIn(startDateDefault);

  let frequency = 'weekly';
  const freqSeg = el('div', { className: 'seg' }, FREQUENCIES.map((f) => {
    const b = el('button', { className: f.key === frequency ? 'on' : '', text: f.label, onClick: () => {
      frequency = f.key;
      [...freqSeg.children].forEach((c) => c.classList.toggle('on', c === b));
    } });
    return b;
  }));

  const errorsBox = el('div', {});
  const showError = (msg) => errorsBox.replaceChildren(el('div', { className: 'notice', style: { color: 'var(--neg)' } }, [el('div', { text: msg })]));
  const clearError = () => errorsBox.replaceChildren();

  const previewBtn = el('button', {
    className: 'btn btn-primary btn-block', text: 'معاينة المراحل',
    onClick: () => {
      clearError();
      const res = generateMilestones({
        startWeight: startW.value === '' ? NaN : Number(startW.value),
        finalWeight: finalW.value === '' ? NaN : Number(finalW.value),
        step: stepW.value === '' ? NaN : Number(stepW.value),
        startDate: startD.value,
        frequency,
      });
      if (!res.ok) { showError(res.error); return; }
      openPreview(res.milestones);
    },
  });

  const body = el('div', { className: 'stack' }, [
    el('p', { className: 'muted-sm', text: 'أنشئ سلسلة مراحل تلقائيًا بدل إدخالها واحدة واحدة. ستتم معاينتها قبل الحفظ.' }),
    el('div', { className: 'quick-add' }, [labeled('من وزن', startW), labeled('إلى وزن الهدف', finalW)]),
    el('div', { className: 'quick-add' }, [labeled('مقدار التغيّر لكل مرحلة', stepW), labeled('تاريخ البداية', startD)]),
    labeled('التكرار', freqSeg),
    errorsBox,
    el('div', { style: { marginTop: 'var(--s-4)' } }, [previewBtn]),
  ]);

  const handle = openSheet({ title: 'إنشاء مراحل تلقائيًا', body });

  const errorsBox2 = el('div', {});
  let previewHandle = null;

  // ── Preview step ──
  function openPreview(generated) {
    const rows = generated.map((m) => el('div', { className: 'gen-row' }, [
      el('span', { className: 'gen-date' }, [numericLTR(formatArabicDateShort(m.targetDate))]),
      el('span', { className: 'gen-w' }, [numericLTR(`${formatWeight(m.targetWeight)} كجم`)]),
    ]));

    // The date the goal weight is reached by this schedule. If it's later than
    // the plan's current finalDate, committing as-is would fail validation, so
    // we surface the conflict and require an explicit choice (never silent).
    const reqFinal = requiredFinalDate(generated, startD.value, frequency);
    const finalTooEarly = plan.finalDate && reqFinal > plan.finalDate;

    const hasExisting = (milestones || []).length > 0;
    let actions;
    if (finalTooEarly) {
      const conflict = el('div', { className: 'gen-conflict' }, [
        el('div', { className: 'row-inline', style: { justifyContent: 'space-between' } }, [
          el('span', { className: 'muted-sm', text: 'تاريخ الهدف الحالي' }),
          el('span', { className: 'num', text: formatArabicDateShort(plan.finalDate) }),
        ]),
        el('div', { className: 'row-inline', style: { justifyContent: 'space-between' } }, [
          el('span', { className: 'muted-sm', text: 'الجدول الجديد يتطلب' }),
          el('span', { className: 'num', text: formatArabicDateShort(reqFinal) }),
        ]),
      ]);
      actions = [
        conflict,
        el('button', { className: 'btn btn-primary btn-block', text: `تحديث تاريخ الهدف إلى ${formatArabicDateShort(reqFinal)}`, onClick: () => commit(generated, hasExisting ? 'add' : 'new', reqFinal) }),
        hasExisting ? el('button', { className: 'btn btn-secondary btn-block', text: `استبدال غير المتحققة + تحديث التاريخ`, onClick: () => commit(generated, 'replace', reqFinal) }) : null,
        el('button', { className: 'btn btn-secondary btn-block', text: 'تعديل الإعدادات', onClick: () => previewHandle && previewHandle.close() }),
        el('button', { className: 'btn btn-ghost btn-block', text: 'إلغاء', onClick: () => { if (previewHandle) previewHandle.close(); handle.close(); } }),
      ].filter(Boolean);
    } else {
      actions = hasExisting ? conflictActions(generated) : [
        el('button', { className: 'btn btn-primary btn-block', text: 'إنشاء المراحل', onClick: () => commit(generated, 'new') }),
      ];
    }

    const pv = el('div', { className: 'stack' }, [
      el('div', { className: 'gen-count', text: `سيتم إنشاء ${generated.length} مرحلة` }),
      finalTooEarly ? el('p', { className: 'muted-sm', text: 'الجدول الجديد يمتد بعد تاريخ الهدف الحالي. اختر إجراءً:' })
        : (hasExisting ? el('p', { className: 'muted-sm', text: 'لديك مراحل حالية. اختر كيف تريد تطبيق المراحل الجديدة:' }) : null),
      el('div', { className: 'gen-list' }, rows),
      errorsBox2,
      el('div', { className: 'stack', style: { marginTop: 'var(--s-4)', gap: 'var(--s-2)' } }, actions),
    ].filter(Boolean));

    previewHandle = openSheet({ title: 'معاينة المراحل', body: pv });
  }

  function conflictActions(generated) {
    return [
      el('button', { className: 'btn btn-primary btn-block', text: 'إضافة إلى المراحل الحالية', onClick: () => commit(generated, 'add') }),
      el('button', { className: 'btn btn-secondary btn-block', text: 'استبدال المراحل غير المتحققة', onClick: () => commit(generated, 'replace') }),
      el('button', { className: 'btn btn-ghost btn-block', text: 'إلغاء', onClick: () => previewHandle && previewHandle.close() }),
    ];
  }

  // ── Commit (atomic via updatePlan replace-all) ──
  // finalDateOverride (optional): a later goal date the user explicitly accepted.
  // We never shorten an existing later finalDate, and never change it silently.
  async function commit(generated, strategy, finalDateOverride = null) {
    // Preserve achieved milestone facts: keep milestones whose target weight is
    // already reached (derived), replace only the unreached/planned ones.
    const reached = new Set(
      (summary && summary.milestones ? summary.milestones : [])
        .filter((m) => m.reached)
        .map((m) => Math.round(Number(m.targetWeight) * 10) / 10),
    );
    const existingForMerge = (milestones || []).map((m) => ({ targetWeight: m.targetWeight, targetDate: m.targetDate, label: m.label || '' }));
    const merged = strategy === 'new'
      ? generated
      : mergeMilestones(existingForMerge, generated, strategy, reached);
    const finalList = toStorageMilestones(merged);

    // Only extend the final date; never shorten an already-later one.
    let finalDate = plan.finalDate;
    if (finalDateOverride && (!finalDate || finalDateOverride > finalDate)) finalDate = finalDateOverride;

    const planData = {
      name: plan.name,
      startWeight: plan.startWeight,
      startDate: plan.startDate,       // existing plan history is never rewritten
      finalWeight: plan.finalWeight,
      finalDate,
    };
    const { ok, errors } = validateGoalPlan(planData, finalList);
    if (!ok) { errorsBox2.replaceChildren(el('div', { className: 'notice', style: { color: 'var(--neg)' } }, errors.map((e) => el('div', { text: `• ${e}` })))); return; }

    try {
      await updatePlan(plan.id, planData, finalList); // atomic replace-all; no partial writes
      toast('تم إنشاء المراحل');
      if (previewHandle) previewHandle.close();
      handle.close();
      afterChange && afterChange();
    } catch (err) {
      if (err instanceof ValidationError) errorsBox2.replaceChildren(el('div', { className: 'notice', style: { color: 'var(--neg)' } }, err.errors.map((e) => el('div', { text: `• ${e}` }))));
      else { console.error(err); toast('تعذّر إنشاء المراحل'); }
    }
  }

  return handle;
}
