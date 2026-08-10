// meals/meals.js — Meal Library, optimized for reuse. Search, switch active/
// archived, add/edit, archive/restore, and (safe) permanent delete. Management
// sits behind an edit toggle. Editing a meal never changes historical nutrition
// snapshots (entries store their own snapshot).

import { el, toast } from '../../core/dom.js';
import { on } from '../../core/events.js';
import { getActiveMeals, getArchivedMeals, archiveMeal, restoreMeal, deleteMeal, searchMeals } from '../../data/meals.repo.js';
import { formatInt, formatWeight } from '../../core/num.js';
import { openMealEditor } from './mealSheets.js';
import { pageHead, segmented, emptyState } from '../../core/ui.js';

export function renderMeals(root, ctx = {}) {
  let mode = 'active';
  let editing = false;
  let term = '';

  async function draw() {
    const meals = mode === 'active' ? (term ? await searchMeals(term) : await getActiveMeals()) : await getArchivedMeals();

    root.replaceChildren(el('div', { className: 'route-view stack' }, [
      pageHead('مكتبة الوجبات', { actionLabel: mode === 'active' ? (editing ? 'تم' : 'تحرير') : null, onAction: () => { editing = !editing; draw(); } }),
      segmented([{ key: 'active', label: 'نشطة' }, { key: 'archived', label: 'مؤرشفة' }], mode, (m) => { mode = m; editing = false; draw(); }),
      mode === 'active' ? searchBar() : null,
      meals.length ? list(meals) : emptyState({ icon: 'nutrition', title: mode === 'active' ? 'لا توجد وجبات بعد.' : 'لا توجد وجبات مؤرشفة.', hint: mode === 'active' ? 'أضف وجباتك المتكررة لتسجيلها بسرعة.' : null }),
      el('button', { className: 'btn btn-primary btn-block', text: '+ إضافة وجبة جديدة', onClick: () => openMealEditor({ afterChange: draw }) }),
    ].filter(Boolean)));

    function searchBar() {
      const s = el('input', { className: 'input', type: 'search', placeholder: 'ابحث بالاسم…', value: term, attrs: { 'aria-label': 'بحث' } });
      s.addEventListener('input', () => { term = s.value; draw(); });
      return s;
    }
    function list(meals) {
      return el('div', { className: 'list' }, meals.map((m) => el('div', { className: 'row' }, [
        el('button', { className: 'row-label', style: { background: 'none', border: 'none', textAlign: 'start' }, onClick: () => openMealEditor({ meal: m, afterChange: draw }) }, [
          el('div', { text: m.name }),
          el('div', { className: 'sub num', text: `${formatInt(m.calories)} سعرة${m.protein != null ? ` · ${formatWeight(m.protein)} بروتين` : ' · بروتين غير معروف'}${m.serving ? ` · ${m.serving}` : ''}` }),
        ]),
        editing
          ? el('div', { className: 'row-actions' }, mode === 'active'
            ? [el('button', { className: 'link-btn', text: 'أرشفة', onClick: async () => { await archiveMeal(m.id); toast('تمت الأرشفة'); } })]
            : [
                el('button', { className: 'link-btn', text: 'استعادة', onClick: async () => { await restoreMeal(m.id); toast('تمت الاستعادة'); } }),
                el('button', { className: 'link-btn danger', text: 'حذف', onClick: async () => { await deleteMeal(m.id); toast('تم الحذف'); } }),
              ])
          : el('div', { className: 'chev', text: '‹' }),
      ])));
    }
  }

  const unsub = on('meals:changed', draw);
  draw();
  return () => unsub();
}
