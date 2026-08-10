// exercises/exercisePicker.js — reusable sheet to pick an active exercise.
// Used by the routine editor (add/replace) and the session screen (add exercise).

import { el } from '../../core/dom.js';
import { openSheet } from '../../core/sheet.js';
import { queryExercises } from '../../data/exercises.repo.js';

export function openExercisePicker({ title = 'اختر تمرينًا', onPick } = {}) {
  const body = el('div', { className: 'stack' });
  const handle = openSheet({ title, body });
  const search = el('input', { className: 'input', type: "search", placeholder: "ابحث…", attrs: { "aria-label": "بحث" } });
  const results = el('div', { className: 'list' });

  async function refresh() {
    const rows = await queryExercises({ term: search.value });
    results.replaceChildren(...(rows.length
      ? rows.map((x) => el('button', { className: 'row', onClick: () => { handle.close(); onPick && onPick(x); } }, [
          el('div', { className: 'row-label' }, [
            el('div', { text: x.name }),
            el('div', { className: 'sub', text: [x.muscleGroup, x.equipment, (x.defaultUnit || '').toUpperCase()].filter(Boolean).join(' • ') }),
          ]),
        ]))
      : [el('div', { className: 'row muted', text: 'لا توجد تمارين. أضِفها من مكتبة التمارين أولًا.' })]));
  }
  search.addEventListener('input', refresh);
  refresh();
  body.replaceChildren(search, results);
  return handle;
}
