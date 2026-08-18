// nutrition/nutritionSheets.js — add/edit nutrition entries.
// Add supports two paths: pick from the Meal Library (with a quantity), or a
// one-time food (optionally saved to the library). Calories are always entered.

import { el, toast, snackbar } from '../../core/dom.js';
import { openSheet } from '../../core/sheet.js';
import { searchMeals, addMeal } from '../../data/meals.repo.js';
import {
  addEntryFromMeal, addOneTimeEntry, updateEntry, deleteEntry, duplicateEntry, copyEntryToDate, setEntrySource, restoreEntry,
} from '../../data/nutrition.repo.js';
import { computeFinals } from '../../domain/nutritionStats.js';
import { formatInt, formatWeight } from '../../core/num.js';
import { numericLTR } from '../../core/ui.js';
import { todayLocal } from '../../core/dates.js';
import { stepper, disclosure } from '../../core/controls.js';

function labeled(t, node) { return el('div', { className: 'field' }, [el('label', { text: t }), node]); }
const txtIn = (v, ph) => el('input', { className: 'input', type: 'text', placeholder: ph || '', value: v || '' });
const numIn = (v, ph) => el('input', { className: 'input num', type: 'number', inputmode: 'decimal', step: '0.1', min: '0', placeholder: ph || '', value: v != null ? String(v) : '' });
const dateIn = (v) => el('input', { className: 'input num', type: 'date', value: v || todayLocal() });
const timeInp = (v) => el('input', { className: 'input num', type: 'time', value: v || '' });

/** Quantity picker built on the shared stepper: −/value/+ with quick fractions. */
function quantityControl(initial = 1, onChange) {
  const s = stepper(initial, { min: 0, step: 1, fractions: [0.25, 0.5, 1, 2], onChange });
  return { node: s.node, get: () => s.get() };
}

/** Add-entry sheet with a small tab switch between Library and one-time. */
export function openAddEntrySheet({ localDate, afterChange } = {}) {
  const date = localDate || todayLocal();
  const body = el('div', { className: 'stack' });
  // Dirty guard: only the manual one-time pane holds typed values that could be
  // lost. Library-pick is a selection (no meaningful typed state). We track the
  // live one-time inputs and warn only if the user typed something.
  let oneRef = null;
  const isDirty = () => !!oneRef && (String(oneRef.name.value).trim() !== '' || String(oneRef.cal.value).trim() !== '' || String(oneRef.prot.value).trim() !== '' || String(oneRef.serving.value).trim() !== '');
  const handle = openSheet({ title: 'إضافة وجبة', body, dirty: isDirty });

  const libBtn = el('button', { className: 'on', text: 'من المكتبة', onClick: () => setTab('lib') });
  const oneBtn = el('button', { text: 'إدخال يدوي', onClick: () => setTab('one') });
  const tabs = el('div', { className: 'seg' }, [libBtn, oneBtn]);
  const pane = el('div', { style: { marginTop: 'var(--s-4)' } });

  function setTab(which) {
    libBtn.classList.toggle('on', which === 'lib');
    oneBtn.classList.toggle('on', which === 'one');
    if (which !== 'one') oneRef = null; // library pane has no typed state to guard
    pane.replaceChildren(which === 'lib' ? libPane() : onePane());
  }

  function libPane() {
    const search = txtIn('', 'ابحث في المكتبة…');
    const results = el('div', { className: 'list' });
    let qc = quantityControl(1); // rebound to the live control when a meal is selected
    let selected = null;

    async function refresh() {
      const meals = await searchMeals(search.value);
      results.replaceChildren(...(meals.length ? meals.map((m) => el('button', {
        className: 'row', onClick: () => { selected = m; renderSelected(); },
      }, [
        el('div', { className: 'row-label' }, [
          el('div', { text: m.name }),
          el('div', { className: 'sub num', text: `${formatInt(m.calories)} سعرة${m.protein != null ? ` • ${formatWeight(m.protein)} بروتين` : ''}${m.serving ? ` • ${m.serving}` : ''}` }),
        ]),
      ])) : [el('div', { className: 'row muted', text: 'لا توجد وجبات مطابقة.' })]));
    }
    const selWrap = el('div', {});
    function renderSelected() {
      if (!selected) { selWrap.replaceChildren(); return; }
      const calc = () => computeFinals(selected.calories, selected.protein, qc.get());
      const previewText = () => {
        const { finalCalories, finalProtein } = calc();
        return { cal: formatInt(finalCalories), prot: finalProtein != null ? `${formatWeight(finalProtein)} بروتين` : 'بروتين غير معروف' };
      };
      const calEl = el('span', { className: 'lt-cal num' });
      const protEl = el('span', { className: 'lt-prot num' });
      const paint = () => { const p = previewText(); calEl.replaceChildren(numericLTR(p.cal), el('span', { className: 'lt-unit', text: 'سعرة' })); protEl.textContent = p.prot; };
      // live total updates as quantity changes
      const qcLive = quantityControl(qc.get(), paint);
      const liveTotal = el('div', { className: 'live-total' }, [calEl, protEl]);
      selWrap.replaceChildren(el('div', { className: 'stack' }, [
        el('div', { className: 'section-head' }, [el('h2', { text: selected.name })]),
        el('div', { className: 'meal-facts muted-sm num', text: `${formatInt(selected.calories)} سعرة / حصة${selected.protein != null ? ` · ${formatWeight(selected.protein)} بروتين` : ' · بروتين غير معروف'}${selected.serving ? ` · ${selected.serving}` : ''}` }),
        labeled('الكمية', qcLive.node),
        liveTotal,
        el('button', {
          className: 'btn btn-primary btn-block', text: 'إضافة',
          onClick: async () => {
            const q = qcLive.get();
            if (!(q > 0)) { toast('كمية غير صالحة'); return; }
            await addEntryFromMeal(selected, { quantity: q, localDate: date });
            toast('تمت الإضافة'); handle.close(); afterChange && afterChange();
          },
        }),
      ]));
      paint();
      // rebind qc reference so Add reads the live control
      qc = qcLive;
    }
    search.addEventListener('input', refresh);
    refresh();
    return el('div', { className: 'stack' }, [labeled('بحث', search), results, selWrap]);
  }

  function onePane() {
    const name = txtIn('', 'اسم الصنف');
    const cal = numIn('', 'سعرات لكل حصة');
    const prot = numIn('', 'بروتين (اختياري)');
    const serving = txtIn('', 'وصف الحصة (اختياري)');
    const noteIn = txtIn('', 'ملاحظة (اختياري)');
    const dateInp = dateIn(date);
    const timeInpEl = timeInp('');
    oneRef = { name, cal, prot, serving }; // expose for the dirty guard

    // Live total reacts immediately to calories / protein / quantity. Unknown
    // protein (blank field) stays unknown — never coerced to 0.
    const calEl = el('span', { className: 'lt-cal num' });
    const protEl = el('span', { className: 'lt-prot num' });
    const paint = () => {
      const c = cal.value === '' ? null : Number(cal.value);
      const p = prot.value === '' ? null : Number(prot.value);
      const q = qc.get();
      const { finalCalories, finalProtein } = computeFinals(c == null ? 0 : c, p, q);
      calEl.replaceChildren(numericLTR(formatInt(finalCalories)), el('span', { className: 'lt-unit', text: 'سعرة' }));
      protEl.textContent = finalProtein != null ? `${formatWeight(finalProtein)} بروتين` : 'بروتين غير معروف';
    };
    const qc = quantityControl(1, paint);
    cal.addEventListener('input', paint);
    prot.addEventListener('input', paint);
    const liveTotal = el('div', { className: 'live-total' }, [calEl, protEl]);

    const saveLib = el('input', { type: 'checkbox' });
    const saveLibRow = el('label', { className: 'toggle-row secondary' }, [el('span', { className: 'muted-sm', text: 'حفظ في مكتبة الوجبات أيضًا' }), saveLib]);

    // Secondary metadata behind progressive disclosure so the first viewport is
    // the quick-logging task, not a long form.
    const secondary = disclosure('التاريخ والوقت وملاحظة', el('div', { className: 'stack' }, [
      labeled('الحصة', serving),
      el('div', { className: 'quick-add' }, [labeled('التاريخ', dateInp), labeled('الوقت', timeInpEl)]),
      labeled('ملاحظة', noteIn),
    ]));

    const addBtn = el('button', {
      className: 'btn btn-primary btn-block', text: 'إضافة',
      onClick: async () => {
        try {
          await addOneTimeEntry({
            name: name.value, calories: cal.value,
            protein: prot.value === '' ? null : prot.value, // '' = unknown, not 0
            serving: serving.value, quantity: qc.get(),
            localDate: dateInp.value || date,
            time: timeInpEl.value || undefined,
            note: noteIn.value || undefined,
          });
          if (saveLib.checked) {
            try { await addMeal({ name: name.value, calories: cal.value, protein: prot.value === '' ? null : prot.value, serving: serving.value }); } catch (_) {}
          }
          toast('تمت الإضافة'); handle.close(); afterChange && afterChange();
        } catch (err) {
          toast((err.errors && err.errors[0]) || 'تعذّرت الإضافة');
        }
      },
    });

    paint();
    return el('div', { className: 'stack' }, [
      el('div', { className: 'entry-kind muted-sm', text: 'تسجيل يدوي — صنف استهلكته الآن' }),
      labeled('الاسم', name),
      el('div', { className: 'quick-add' }, [labeled('سعرات/حصة', cal), labeled('بروتين/حصة (اختياري)', prot)]),
      labeled('الكمية', qc.node),
      liveTotal,
      addBtn,
      saveLibRow,
      secondary,
    ]);
  }

  body.replaceChildren(tabs, pane);
  setTab('lib');
  return handle;
}

/** Edit an existing entry with duplicate / copy-to-date / delete. */
export function openEditEntrySheet({ entry, afterChange }) {
  const name = txtIn(entry.nameSnapshot, 'الاسم');
  const cal = numIn(entry.kcalPerServingSnapshot, 'سعرات لكل حصة');
  const prot = numIn(entry.proteinPerServingSnapshot, 'بروتين (اختياري)');
  const qc = quantityControl(entry.quantity);
  const date = dateIn(entry.localDate);
  const time = timeInp(entry.time);
  const note = txtIn(entry.note, 'ملاحظة');
  // Dirty-tracking baseline for unsaved-change protection (item 12).
  const snapshot = () => [name.value, cal.value, prot.value, qc.get(), date.value, time.value, note.value].join('\u0001');
  const initial = snapshot();
  const isDirty = () => snapshot() !== initial;

  const save = el('button', {
    className: 'btn btn-primary btn-block', text: 'حفظ',
    onClick: async () => {
      try {
        await updateEntry(entry.id, {
          name: name.value, calories: cal.value,
          protein: prot.value === '' ? null : prot.value,
          quantity: qc.get(), localDate: date.value, time: time.value, note: note.value,
        });
        toast('تم الحفظ'); handle.close(); afterChange && afterChange();
      } catch (err) { toast((err.errors && err.errors[0]) || 'تعذّر الحفظ'); }
    },
  });

  const dup = el('button', { className: 'btn btn-secondary btn-block', text: 'تكرار في نفس اليوم', onClick: async () => { await duplicateEntry(entry.id); toast('تم'); handle.close(); afterChange && afterChange(); } });
  const copyDate = dateIn(entry.localDate);
  const copyBtn = el('button', { className: 'btn btn-secondary', text: 'نسخ', onClick: async () => { await copyEntryToDate(entry.id, copyDate.value); toast('تم النسخ'); handle.close(); afterChange && afterChange(); } });

  // Save this historical entry into the Meal Library as a NEW reusable meal.
  // Uses the entry's immutable per-serving SNAPSHOT (not the editable inputs),
  // never mutates the entry, and never merges with same-name meals (addMeal
  // always mints a new id). If the entry already came from a library meal, we
  // show a quiet confirmation instead of creating a duplicate.
  let saveToLib;
  if (entry.sourceMealId) {
    saveToLib = el('div', { className: 'muted-sm', style: { textAlign: 'center' }, text: 'محفوظة في المكتبة ✓' });
  } else {
    saveToLib = el('button', {
      className: 'btn btn-secondary btn-block', text: 'حفظ في مكتبة الوجبات',
      onClick: async () => {
        try {
          const mealId = await addMeal({
            name: entry.nameSnapshot,
            calories: entry.kcalPerServingSnapshot,
            protein: entry.proteinPerServingSnapshot,   // null stays unknown
            serving: entry.servingSnapshot,
          });
          if (mealId) await setEntrySource(entry.id, mealId);
          toast('أُضيفت إلى المكتبة');
          saveToLib.replaceWith(el('div', { className: 'muted-sm', style: { textAlign: 'center' }, text: 'محفوظة في المكتبة ✓' }));
          afterChange && afterChange();
        } catch (err) { toast((err.errors && err.errors[0]) || 'تعذّرت الإضافة'); }
      },
    });
  }

  // Delete lives in the secondary menu (a subtle link), not a dominating red
  // button. Deletion is Undo-able via the snackbar.
  const del = el('button', {
    className: 'link-btn danger block-link', text: 'حذف هذا الصنف',
    onClick: async () => {
      const rec = await deleteEntry(entry.id);
      handle.close(); afterChange && afterChange();
      snackbar('تم حذف الوجبة', { onAction: async () => { await restoreEntry(rec); afterChange && afterChange(); toast('تم التراجع'); } });
    },
  });

  // Secondary details (date/time/note) and secondary actions (repeat/copy/
  // library/delete) are disclosed on demand so the primary view stays focused
  // on the common correction: quantity + nutrition.
  const secondary = disclosure('تفاصيل إضافية', el('div', { className: 'stack' }, [
    labeled('التاريخ', date), labeled('الوقت', time), labeled('ملاحظة', note),
    el('div', { className: 'sheet-divider' }),
    dup,
    el('div', { className: 'quick-add' }, [copyDate, copyBtn]),
    saveToLib,
    del,
  ]));

  const body = el('div', { className: 'stack' }, [
    el('div', { className: 'entry-kind muted-sm', text: 'صنف مُسجّل — هذه الوجبة كما استهلكتها' }),
    labeled('الاسم', name), labeled('السعرات لكل حصة', cal),
    labeled('البروتين لكل حصة (اختياري)', prot), labeled('الكمية', qc.node),
    el('div', { style: { marginTop: 'var(--s-4)' } }, [save]),
    secondary,
  ]);
  const handle = openSheet({ title: 'تعديل الصنف', body, dirty: isDirty });
  return handle;
}
