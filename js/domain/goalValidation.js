// goalValidation.js — PURE validation for a weight-loss goal plan and its
// milestones. Returns human-readable Arabic errors. It NEVER reorders or repairs
// input: an inconsistent date/weight sequence is rejected so the UI can surface a
// clear message and let the user fix it.
//
// The app's goals are weight-loss oriented (final below start), matching the
// milestone-reached rule "official weight ≤ target".

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const inBounds = (w) => isNum(w) && w > 0 && w < 700;      // sane human kg
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * Validate a plan and its milestones AS ENTERED (order preserved).
 * @param {object} plan  {startWeight, startDate, finalWeight, finalDate}
 * @param {Array}  milestones  [{targetWeight, targetDate, label?}], in entry order
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateGoalPlan(plan, milestones = []) {
  const errors = [];
  const p = plan || {};

  // --- plan fields ---
  if (!inBounds(p.startWeight)) errors.push('وزن البداية غير صالح.');
  if (!inBounds(p.finalWeight)) errors.push('وزن الهدف غير صالح.');
  if (!isDate(p.startDate)) errors.push('تاريخ البداية غير صالح.');
  if (!isDate(p.finalDate)) errors.push('تاريخ الهدف غير صالح.');

  // Only continue cross-field checks if the basics are present.
  if (isDate(p.startDate) && isDate(p.finalDate) && p.startDate >= p.finalDate) {
    errors.push('تاريخ البداية يجب أن يسبق تاريخ الهدف.');
  }
  if (inBounds(p.startWeight) && inBounds(p.finalWeight) && p.finalWeight >= p.startWeight) {
    errors.push('وزن الهدف يجب أن يكون أقل من وزن البداية.');
  }

  // --- milestones (validated in entered order; never reordered) ---
  let prev = null;
  milestones.forEach((m, i) => {
    const n = i + 1;
    if (!inBounds(m.targetWeight)) { errors.push(`المرحلة ${n}: وزن غير صالح.`); return; }
    if (!isDate(m.targetDate)) { errors.push(`المرحلة ${n}: تاريخ غير صالح.`); return; }

    // within the plan envelope: finalWeight ≤ w < startWeight; start < date ≤ final
    if (inBounds(p.finalWeight) && inBounds(p.startWeight) &&
        !(m.targetWeight >= p.finalWeight && m.targetWeight < p.startWeight)) {
      errors.push(`المرحلة ${n}: الوزن يجب أن يكون بين وزن الهدف ووزن البداية.`);
    }
    if (isDate(p.startDate) && isDate(p.finalDate) &&
        !(m.targetDate > p.startDate && m.targetDate <= p.finalDate)) {
      errors.push(`المرحلة ${n}: التاريخ يجب أن يقع بين تاريخ البداية وتاريخ الهدف.`);
    }

    // consistent monotonic sequence AS ENTERED: dates strictly up, weights strictly down
    if (prev) {
      if (isDate(m.targetDate) && isDate(prev.targetDate) && !(m.targetDate > prev.targetDate)) {
        errors.push(`المرحلة ${n}: التواريخ يجب أن تكون بترتيب تصاعدي (بدون تكرار).`);
      }
      if (isNum(m.targetWeight) && isNum(prev.targetWeight) && !(m.targetWeight < prev.targetWeight)) {
        errors.push(`المرحلة ${n}: الأوزان يجب أن تتناقص مع تقدّم المراحل.`);
      }
    }
    prev = m;
  });

  return { ok: errors.length === 0, errors };
}
