// exercises/exercisePicker.js — the fast "add exercise" flow. Search first
// (Arabic OR English), quick recent + broad muscle/equipment chips, tap to add.
// Custom-exercise creation is a secondary action. Selecting never opens detail
// and never mutates identity — it passes the chosen exercise's permanent id up.

import { el } from '../../core/dom.js';
import { openSheet } from '../../core/sheet.js';
import { queryExercises, getExercise } from '../../data/exercises.repo.js';
import { getRecentExerciseIds } from '../../data/workouts.repo.js';
import { groupToRegion } from '../../domain/muscleMap.js';
import { openExerciseEditor } from './exerciseSheets.js';

// Broad muscle chips → the set of regions they cover (via muscleMap).
const MUSCLE_CHIPS = [
  { key: 'chest', label: 'الصدر', regions: ['chest'] },
  { key: 'back', label: 'الظهر', regions: ['back'] },
  { key: 'shoulders', label: 'الأكتاف', regions: ['shoulders'] },
  { key: 'arms', label: 'الذراع', regions: ['biceps', 'triceps', 'forearms'] },
  { key: 'legs', label: 'الرجل', regions: ['quads', 'hamstrings', 'glutes', 'calves'] },
  { key: 'core', label: 'البطن', regions: ['core'] },
];
const EQUIP_CHIPS = [
  { key: 'جهاز', label: 'جهاز' },
  { key: 'كيبل', label: 'كيبل' },
  { key: 'دمبل', label: 'دمبل' },
  { key: 'بار', label: 'بار' },
  { key: 'وزن الجسم', label: 'وزن الجسم' },
];

export function openExercisePicker({ title = 'اختر تمرينًا', onPick } = {}) {
  const body = el('div', { className: 'stack picker' });
  const handle = openSheet({ title, body });

  let term = '';
  let muscle = null;     // chip key from MUSCLE_CHIPS
  let equipment = null;  // equipment string
  let showRecent = false;
  let recentIds = [];

  const search = el('input', { className: 'input', type: 'search', placeholder: 'بحث عن تمرين…', attrs: { 'aria-label': 'بحث عن تمرين' } });
  search.addEventListener('input', () => { term = search.value; paint(); });

  const filtersEl = el('div');
  const results = el('div', { className: 'list picker-list' });

  // load recent ids once (factual history only)
  getRecentExerciseIds(12).then((ids) => { recentIds = ids; paint(); });

  function chip(label, active, onClick) {
    return el('button', { className: `chip${active ? ' on' : ''}`, attrs: { 'aria-pressed': active ? 'true' : 'false' }, text: label, onClick });
  }

  function chipBars() {
    const muscleRow = el('div', { className: 'chips scroll' }, [
      recentIds.length ? chip('الأخيرة', showRecent, () => { showRecent = !showRecent; if (showRecent) { muscle = null; equipment = null; term = ''; search.value = ''; } paint(); }) : null,
      ...MUSCLE_CHIPS.map((m) => chip(m.label, muscle === m.key, () => { muscle = muscle === m.key ? null : m.key; showRecent = false; paint(); })),
    ].filter(Boolean));
    const equipRow = el('div', { className: 'chips scroll' }, EQUIP_CHIPS.map((e) =>
      chip(e.label, equipment === e.key, () => { equipment = equipment === e.key ? null : e.key; showRecent = false; paint(); })));
    return el('div', { className: 'stack', style: { gap: 'var(--s-2)' } }, [muscleRow, equipRow]);
  }

  function paint() { filtersEl.replaceChildren(chipBars()); render(); }

  function matchEquip(ex) {
    if (!equipment) return true;
    if (equipment === 'بار') return ex.equipment === 'بار' || ex.equipment === 'EZ بار';
    return ex.equipment === equipment;
  }
  function matchMuscle(ex) {
    if (!muscle) return true;
    const chipDef = MUSCLE_CHIPS.find((m) => m.key === muscle);
    const region = groupToRegion(ex.muscleGroup) || groupToRegion(ex.name);
    return region && chipDef.regions.includes(region);
  }

  function row(ex) {
    const region = groupToRegion(ex.muscleGroup) || groupToRegion(ex.name);
    return el('button', { className: 'row picker-row', onClick: () => { handle.close(); onPick && onPick(ex); } }, [
      el('div', { className: 'row-label' }, [
        el('div', { className: 'pk-ar', text: ex.name }),
        ex.nameEn ? el('div', { className: 'pk-en numeric-ltr', text: ex.nameEn }) : null,
        el('div', { className: 'sub', text: [ex.muscleGroup, ex.equipment].filter(Boolean).join(' · ') || '—' }),
      ].filter(Boolean)),
      region ? el('span', { className: 'pk-dot' }) : null,
    ].filter(Boolean));
  }

  async function render() {
    const all = await queryExercises({ term });
    const filtered = all.filter((ex) => matchMuscle(ex) && matchEquip(ex));

    const sections = [];
    const noFilters = !term && !muscle && !equipment;

    if ((showRecent || noFilters) && recentIds.length && !term && !muscle && !equipment) {
      const recent = (await Promise.all(recentIds.map((id) => getExercise(id))))
        .filter((x) => x && x.status !== 'archived');
      if (recent.length) {
        sections.push(el('div', { className: 'pk-head', text: 'الأخيرة' }));
        sections.push(el('div', { className: 'list' }, recent.map(row)));
        sections.push(el('div', { className: 'pk-head', text: 'كل التمارين' }));
      }
    }

    if (filtered.length) {
      sections.push(el('div', { className: 'list' }, filtered.map(row)));
    } else {
      sections.push(el('div', { className: 'empty-state' }, [
        el('p', { className: 'muted', text: 'لا توجد نتائج مطابقة.' }),
      ]));
    }
    results.replaceChildren(...sections);
  }

  const customBtn = el('button', {
    className: 'btn btn-tertiary btn-block', text: '+ تمرين مخصص',
    onClick: () => { handle.close(); openExerciseEditor({ afterChange: () => {} }); },
  });

  body.replaceChildren(search, filtersEl, results, el('div', { className: 'divider' }), customBtn);
  paint();
  return handle;
}
