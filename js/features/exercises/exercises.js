// exercises/exercises.js — Exercise Library. Search + filter by muscle group and
// equipment, switch active/archived, add/edit, archive/restore, and open detail.
// Normal selection prioritizes scanning; management sits behind an edit toggle.
// Permanent identity preserved: same name + different machine = separate records.

import { el, toast } from '../../core/dom.js';
import { on } from '../../core/events.js';
import { queryExercises, getArchivedExercises, getFacets, archiveExercise, restoreExercise } from '../../data/exercises.repo.js';
import { openExerciseEditor } from './exerciseSheets.js';
import { pageHead, segmented, chips, emptyState, exerciseTitle } from '../../core/ui.js';

export function renderExercises(root, ctx = {}) {
  const navigate = ctx.navigate || (() => {});
  let mode = 'active';
  let editing = false;
  let term = '', muscle = '', equipment = '';

  async function draw() {
    const [rows, facets] = await Promise.all([
      mode === 'active' ? queryExercises({ term, muscle, equipment }) : getArchivedExercises(),
      getFacets(),
    ]);

    root.replaceChildren(el('div', { className: 'route-view stack' }, [
      pageHead('مكتبة التمارين', { actionLabel: mode === 'active' ? (editing ? 'تم' : 'تحرير') : null, onAction: () => { editing = !editing; draw(); } }),
      segmented([{ key: 'active', label: 'نشطة' }, { key: 'archived', label: 'مؤرشفة' }], mode, (m) => { mode = m; editing = false; draw(); }),
      mode === 'active' ? filters(facets) : null,
      rows.length ? list(rows) : emptyState({ icon: 'workout', title: mode === 'active' ? 'لا توجد تمارين بعد.' : 'لا توجد تمارين مؤرشفة.', hint: mode === 'active' ? 'أضف تمرينًا لبناء مكتبتك.' : null }),
      el('button', { className: 'btn btn-primary btn-block', text: '+ إضافة تمرين جديد', onClick: () => openExerciseEditor({ afterChange: draw }) }),
    ].filter(Boolean)));

    function filters(facets) {
      const s = el('input', { className: 'input', type: 'search', placeholder: 'ابحث بالاسم…', value: term, attrs: { 'aria-label': 'بحث' } });
      s.addEventListener('input', () => { term = s.value; draw(); });
      const parts = [s];
      if (facets.muscles.length) {
        parts.push(chips([{ key: '', label: 'كل العضلات' }, ...facets.muscles.map((m) => ({ key: m, label: m }))], muscle, (v) => { muscle = v; draw(); }, { scroll: true }));
      }
      if (facets.equipment.length) {
        parts.push(chips([{ key: '', label: 'كل الأجهزة' }, ...facets.equipment.map((e) => ({ key: e, label: e }))], equipment, (v) => { equipment = v; draw(); }, { scroll: true }));
      }
      return el('div', { className: 'stack', style: { gap: 'var(--s-2)' } }, parts);
    }

    function list(rows) {
      return el('div', { className: 'list' }, rows.map((x) => el('div', { className: 'row' }, [
        el('button', { className: 'row-label', style: { background: 'none', border: 'none', textAlign: 'start' }, onClick: () => navigate('exercise', x.id) }, [
          el('div', { className: 'ex-title', text: exerciseTitle(x) }),
          el('div', { className: 'sub', text: [x.muscleGroup, x.equipment, x.defaultUnit?.toUpperCase()].filter(Boolean).join(' · ') || '—' }),
        ]),
        editing
          ? el('div', { className: 'row-actions' }, mode === 'active'
            ? [el('button', { className: 'link-btn', text: 'أرشفة', onClick: async () => { await archiveExercise(x.id); toast('تمت الأرشفة'); } })]
            : [el('button', { className: 'link-btn', text: 'استعادة', onClick: async () => { await restoreExercise(x.id); toast('تمت الاستعادة'); } })])
          : el('div', { className: 'chev', text: '‹' }),
      ])));
    }
  }

  const unsub = on('exercises:changed', draw);
  draw();
  return () => unsub();
}
