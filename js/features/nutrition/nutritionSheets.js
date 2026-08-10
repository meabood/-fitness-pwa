// nutrition/nutritionSheets.js — add/edit nutrition entries.
// Add supports two paths: pick from the Meal Library (with a quantity), or a
// one-time food (optionally saved to the library). Calories are always entered.

import { el, toast } from '../../core/dom.js';
import { openSheet } from '../../core/sheet.js';
import { searchMeals, addMeal } from '../../data/meals.repo.js';
import {
  addEntryFromMeal, addOneTimeEntry, updateEntry, deleteEntry, duplicateEntry, copyEntryToDate,
} from '../../data/nutrition.repo.js';
import { computeFinals } from '../../domain/nutritionStats.js';
import { formatInt, formatWeight } from '../../core/num.js';
import { todayLocal } from '../../core/dates.js';

const QUANTS = [0.25, 0.5, 0.75, 1, 1.5, 2];

function labeled(t, node) { return el('div', { className: 'field' }, [el('label', { text: t }), node]); }
const txtIn = (v, ph) => el('input', { className: 'input', type: 'text', placeholder: ph || '', value: v || '' });
const numIn = (v, ph) => el('input', { className: 'input num', type: 'number', inputmode: 'decimal', step: '0.1', min: '0', placeholder: ph || '', value: v != null ? String(v) : '' });
const dateIn = (v) => el('input', { className: 'input num', type: 'date', value: v || todayLocal() });
const timeInp = (v) => el('input', { className: 'input num', type: 'time', value: v || '' });

const QUANT_LABEL = { 0.25: '¼', 0.5: '½', 0.75: '¾', 1: '1', 1.5: '1½', 2: '2' };

/** Quantity picker: quick chips + manual decimal input, kept in sync. */
function quantityControl(initial = 1) {
  const manual = numIn(initial, 'الكمية');
  const chipEls = new Map();
  function sync() { const v = Number(manual.value); chipEls.forEach((elc, q) => elc.classList.toggle('on', q === v)); }
  const chips = el('div', { className: 'qty-chips' }, QUANTS.map((q) => {
    const c = el('button', { className: 'chip', text: QUANT_LABEL[q] || String(q), onClick: () => { manual.value = String(q); sync(); manual.dispatchEvent(new Event('input')); } });
    chipEls.set(q, c); return c;
  }));
  manual.addEventListener('input', sync);
  sync();
  return { node: el('div', { className: 'stack', style: { gap: 'var(--s-2)' } }, [chips, manual]), get: () => Number(manual.value) };
}

/** Add-entry sheet with a small tab switch between Library and one-time. */
export function openAddEntrySheet({ localDate, afterChange } = {}) {
  const date = localDate || todayLocal();
  const body = el('div', { className: 'stack' });
  const handle = openSheet({ title: 'إضافة وجبة', body });

  const libBtn = el('button', { className: 'on', text: 'من المكتبة', onClick: () => setTab('lib') });
  const oneBtn = el('button', { text: 'إدخال يدوي', onClick: () => setTab('one') });
  const tabs = el('div', { className: 'seg' }, [libBtn, oneBtn]);
  const pane = el('div', { style: { marginTop: 'var(--s-4)' } });

  function setTab(which) {
    libBtn.classList.toggle('on', which === 'lib');
    oneBtn.classList.toggle('on', which === 'one');
    pane.replaceChildren(which === 'lib' ? libPane() : onePane());
  }

  function libPane() {
    const search = txtIn('', 'ابحث في المكتبة…');
    const results = el('div', { className: 'list' });
    const qc = quantityControl(1);
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
      const preview = () => {
        const { finalCalories, finalProtein } = computeFinals(selected.calories, selected.protein, qc.get());
        return `${formatInt(finalCalories)} سعرة${finalProtein != null ? ` • ${formatWeight(finalProtein)} بروتين` : ' • بروتين غير معروف'}`;
      };
      const previewEl = el('div', { className: 'notice num', text: preview() });
      selWrap.replaceChildren(el('div', { className: 'stack' }, [
        el('div', { className: 'section-head' }, [el('h2', { text: selected.name })]),
        labeled('الكمية', qc.node), previewEl,
        el('button', {
          className: 'btn btn-primary btn-block', text: 'إضافة',
          onClick: async () => {
            const q = qc.get();
            if (!(q > 0)) { toast('كمية غير صالحة'); return; }
            await addEntryFromMeal(selected, { quantity: q, localDate: date });
            toast('تمت الإضافة'); handle.close(); afterChange && afterChange();
          },
        }),
      ]));
      qc.node.querySelectorAll('button, input').forEach((n) => n.addEventListener('click', () => { previewEl.textContent = preview(); }));
      qc.node.querySelector('input')?.addEventListener('input', () => { previewEl.textContent = preview(); });
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
    const qc = quantityControl(1);
    const saveLib = el('input', { type: 'checkbox' });
    const saveLibRow = el('div', { className: 'toggle-row' }, [el('label', { text: 'حفظ في المكتبة أيضًا' }), saveLib]);
    return el('div', { className: 'stack' }, [
      labeled('الاسم', name), labeled('السعرات لكل حصة', cal),
      labeled('البروتين لكل حصة (اختياري)', prot), labeled('الحصة', serving),
      labeled('الكمية', qc.node), saveLibRow,
      el('button', {
        className: 'btn btn-primary btn-block', text: 'إضافة',
        onClick: async () => {
          try {
            await addOneTimeEntry({
              name: name.value, calories: cal.value,
              protein: prot.value === '' ? null : prot.value, // '' = unknown, not 0
              serving: serving.value, quantity: qc.get(), localDate: date,
            });
            if (saveLib.checked) {
              try { await addMeal({ name: name.value, calories: cal.value, protein: prot.value === '' ? null : prot.value, serving: serving.value }); } catch (_) {}
            }
            toast('تمت الإضافة'); handle.close(); afterChange && afterChange();
          } catch (err) {
            toast((err.errors && err.errors[0]) || 'تعذّرت الإضافة');
          }
        },
      }),
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

  const dup = el('button', { className: 'btn btn-secondary', text: 'تكرار', onClick: async () => { await duplicateEntry(entry.id); toast('تم'); handle.close(); afterChange && afterChange(); } });
  const copyDate = dateIn(entry.localDate);
  const copyBtn = el('button', { className: 'btn btn-secondary', text: 'نسخ إلى تاريخ', onClick: async () => { await copyEntryToDate(entry.id, copyDate.value); toast('تم النسخ'); handle.close(); afterChange && afterChange(); } });

  const del = el('button', {
    className: 'btn btn-danger btn-block', text: 'حذف',
    onClick: async () => {
      const confirm = el('button', { className: 'btn btn-danger btn-block', text: 'تأكيد الحذف', onClick: async () => { await deleteEntry(entry.id); toast('تم الحذف'); handle.close(); afterChange && afterChange(); } });
      del.replaceWith(el('div', { className: 'stack' }, [el('p', { className: 'muted center', text: 'لا يمكن التراجع.' }), confirm]));
    },
  });

  const body = el('div', { className: 'stack' }, [
    labeled('الاسم', name), labeled('السعرات لكل حصة', cal),
    labeled('البروتين لكل حصة (اختياري)', prot), labeled('الكمية', qc.node),
    labeled('التاريخ', date), labeled('الوقت', time), labeled('ملاحظة', note),
    el('div', { style: { marginTop: 'var(--s-4)' } }, [save]),
    el('div', { className: 'quick-add', style: { marginTop: 'var(--s-3)' } }, [dup]),
    el('div', { className: 'quick-add' }, [copyDate, copyBtn]),
    el('div', { style: { marginTop: 'var(--s-3)' } }, [del]),
  ]);
  const handle = openSheet({ title: 'تعديل الصنف', body });
  return handle;
}
