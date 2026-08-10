// weightSheets.js — the add / day-detail / edit forms shown in a bottom sheet.
// All user text is rendered safely via dom.el (textContent). Weight is kg.

import { el, toast } from '../../core/dom.js';
import { openSheet } from '../../core/sheet.js';
import {
  addWeight, updateWeight, deleteWeight, setOfficial, getEntriesForDate,
} from '../../data/weight.repo.js';
import { defaultNewMeasurementOfficial } from '../../domain/weightStats.js';
import { todayLocal, toLocalTime, formatArabicDate } from '../../core/dates.js';
import { formatWeight } from '../../core/num.js';

// ---- small field builders ----
function field(labelText, inputNode) {
  return el('div', { className: 'field' }, [
    el('label', { text: labelText }), inputNode,
  ]);
}
function weightInput(value) {
  return el('input', {
    className: 'input num', type: 'number', inputmode: 'decimal', step: '0.1',
    min: '0', placeholder: 'كجم', value: value != null ? String(value) : '',
  });
}
function dateInput(value) {
  return el('input', { className: 'input num', type: 'date', value: value || todayLocal() });
}
function timeInput(value) {
  return el('input', { className: 'input num', type: 'time', value: value || toLocalTime() });
}
function noteInput(value) {
  return el('input', { className: 'input', type: 'text', placeholder: 'ملاحظة (اختياري)', value: value || '' });
}
function toggle(labelText, checked) {
  const input = el('input', { type: 'checkbox' });
  input.checked = !!checked;
  const row = el('div', { className: 'toggle-row' }, [
    el('label', { text: labelText }), input,
  ]);
  return { row, input };
}

function validWeight(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n < 700; // sane human kg bound
}

/** Add a new measurement (optionally for a specific date). */
export async function openAddSheet({ date, afterChange } = {}) {
  const initialDate = date || todayLocal();
  const wIn = weightInput();
  const dIn = dateInput(initialDate);
  const tIn = timeInput();
  const nIn = noteInput();

  // Toggle default reflects the selected date: first measurement → official;
  // a date that already has an official → new measurement defaults to non-official.
  const initialHasOfficial = (await getEntriesForDate(initialDate)).some((e) => e.isOfficial === 1);
  const { row: offRow, input: offIn } = toggle(
    'الوزن الرسمي لهذا اليوم', defaultNewMeasurementOfficial(initialHasOfficial));

  // Keep the default in sync when the user changes the date.
  dIn.addEventListener('change', async () => {
    const hasOfficial = (await getEntriesForDate(dIn.value)).some((e) => e.isOfficial === 1);
    offIn.checked = defaultNewMeasurementOfficial(hasOfficial);
  });

  const save = el('button', {
    className: 'btn btn-primary btn-block', text: 'حفظ',
    onClick: async () => {
      if (!validWeight(wIn.value)) { toast('أدخل وزنًا صحيحًا'); wIn.focus(); return; }
      await addWeight({
        weightKg: Number(wIn.value), localDate: dIn.value, time: tIn.value,
        note: nIn.value, makeOfficial: offIn.checked,
      });
      toast('تم الحفظ');
      handle.close();
      afterChange && afterChange();
    },
  });

  const body = el('div', { className: 'stack' }, [
    field('الوزن (كجم)', wIn),
    field('التاريخ', dIn),
    field('الوقت', tIn),
    field('ملاحظة', nIn),
    offRow,
    el('div', { style: { marginTop: 'var(--s-5)' } }, [save]),
  ]);
  const handle = openSheet({ title: 'تسجيل وزن', body });
  return handle;
}

/** Edit an existing entry. */
export async function openEditSheet({ entry, afterChange }) {
  const wIn = weightInput(entry.weightKg);
  const dIn = dateInput(entry.localDate);
  const tIn = timeInput(entry.time);
  const nIn = noteInput(entry.note);
  const { row: offRow, input: offIn } = toggle('الوزن الرسمي لهذا اليوم', entry.isOfficial === 1);

  // The toggle's meaning and default depend on whether the date is being changed:
  //  * same date + already official → checked & disabled (to change the day's
  //    official, promote another measurement instead of un-officializing this one);
  //  * moving to another date (or not currently official) → enabled, defaulting to
  //    preserve the destination's existing official (unchecked) unless the
  //    destination has none (then checked). The user may override.
  async function syncOfficialToggle() {
    const movingAway = dIn.value !== entry.localDate;
    if (entry.isOfficial === 1 && !movingAway) {
      offIn.checked = true;
      offIn.disabled = true;
    } else {
      offIn.disabled = false;
      const rows = await getEntriesForDate(dIn.value);
      const destHasOfficial = rows.some((e) => e.isOfficial === 1 && e.id !== entry.id);
      offIn.checked = defaultNewMeasurementOfficial(destHasOfficial);
    }
  }
  dIn.addEventListener('change', syncOfficialToggle);
  await syncOfficialToggle();

  const save = el('button', {
    className: 'btn btn-primary btn-block', text: 'حفظ التغييرات',
    onClick: async () => {
      if (!validWeight(wIn.value)) { toast('أدخل وزنًا صحيحًا'); wIn.focus(); return; }
      await updateWeight(entry.id, {
        weightKg: Number(wIn.value), localDate: dIn.value, time: tIn.value,
        note: nIn.value, makeOfficial: offIn.checked,
      });
      toast('تم الحفظ');
      handle.close();
      afterChange && afterChange();
    },
  });

  const del = el('button', {
    className: 'btn btn-danger btn-block', text: 'حذف القياس',
    onClick: async () => {
      const del2 = el('button', {
        className: 'btn btn-danger btn-block', text: 'تأكيد الحذف',
        onClick: async () => {
          await deleteWeight(entry.id);
          toast('تم الحذف');
          handle.close();
          afterChange && afterChange();
        },
      });
      del.replaceWith(el('div', { className: 'stack' }, [
        el('p', { className: 'muted center', text: 'لا يمكن التراجع عن الحذف.' }), del2,
      ]));
    },
  });

  const body = el('div', { className: 'stack' }, [
    field('الوزن (كجم)', wIn),
    field('التاريخ', dIn),
    field('الوقت', tIn),
    field('ملاحظة', nIn),
    offRow,
    el('div', { style: { marginTop: 'var(--s-5)' } }, [save]),
    el('div', { style: { marginTop: 'var(--s-3)' } }, [del]),
  ]);
  const handle = openSheet({ title: 'تعديل القياس', body });
  return handle;
}

/** Day detail: all measurements for a date, with add / promote / edit / delete. */
export function openDaySheet({ localDate, afterChange }) {
  const body = el('div', { className: 'stack' });
  const handle = openSheet({ title: formatArabicDate(localDate), body });

  async function refresh() {
    const rows = await getEntriesForDate(localDate);
    const list = el('div', { className: 'list' },
      rows.map((r) => el('div', { className: 'row' }, [
        el('div', { className: 'row-label measure-row' }, [
          el('span', { className: 'm-weight num', text: `${formatWeight(r.weightKg)} كجم` }),
          r.time ? el('span', { className: 'm-time num', text: r.time }) : null,
          r.isOfficial === 1 ? el('span', { className: 'official-tag', text: 'رسمي' }) : null,
        ].filter(Boolean)),
        el('div', { className: 'row-actions' }, [
          r.isOfficial !== 1
            ? el('button', {
                className: 'link-btn', text: 'تعيين كرسمي',
                onClick: async () => { await setOfficial(r.id); await refresh(); afterChange && afterChange(); },
              })
            : null,
          el('button', {
            className: 'link-btn', text: 'تعديل',
            onClick: () => openEditSheet({ entry: r, afterChange: async () => { await refresh(); afterChange && afterChange(); } }),
          }),
        ].filter(Boolean)),
      ])));

    const addBtn = el('button', {
      className: 'btn btn-secondary btn-block', text: 'إضافة قياس لهذا اليوم',
      onClick: () => openAddSheet({ date: localDate, afterChange: async () => { await refresh(); afterChange && afterChange(); } }),
    });

    body.replaceChildren(
      rows.length ? list : el('p', { className: 'muted center', text: 'لا توجد قياسات.' }),
      el('div', { style: { marginTop: 'var(--s-4)' } }, [addBtn]),
    );
  }

  refresh();
  return handle;
}
