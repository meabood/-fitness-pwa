// workout/session.js — the workout session screen (live logging AND editing a
// historical session). Per exercise it shows the last working performance
// (exercise memory), the sets logged this session, and a fast add row.
// Everything derived (memory, PRs) recomputes from raw sets. Presentation tuned
// for one-handed logging while training; no factual semantics changed.

import { el, toast } from '../../core/dom.js';
import { on } from '../../core/events.js';
import {
  getSession, getSetsForSession, getExerciseMemory, addSet, updateSet, deleteSet,
  addExerciseToSession, setSessionCompleted, setSessionNotes, updateSession, deleteSession,
  getExerciseRecords, getSessionAchievements,
} from '../../data/workouts.repo.js';
import { getAllExercises } from '../../data/exercises.repo.js';
import { openExercisePicker } from '../exercises/exercisePicker.js';
import { openSheet } from '../../core/sheet.js';
import { formatWeight } from '../../core/num.js';
import { formatArabicDate, formatArabicDateShort } from '../../core/dates.js';
import { pageHead } from '../../core/ui.js';

export function renderSession(root, ctx = {}) {
  const navigate = ctx.navigate || (() => {});
  const sessionId = ctx.param;

  async function draw() {
    const session = sessionId ? await getSession(sessionId) : null;
    if (!session) {
      root.replaceChildren(el('div', { className: 'route-view stack' }, [
        pageHead('جلسة'),
        el('div', { className: 'notice', text: 'الجلسة غير موجودة.' }),
        el('button', { className: 'btn btn-secondary btn-block', text: 'رجوع', onClick: () => navigate('workout') }),
      ]));
      return;
    }
    const [sets, allEx] = await Promise.all([getSetsForSession(session.id), getAllExercises()]);
    const nameOf = new Map(allEx.map((x) => [x.id, x.name]));
    const unitOf = new Map(allEx.map((x) => [x.id, x.defaultUnit]));
    const noteOf = new Map();
    (session.plannedExercises || []).forEach((p) => {
      if (!nameOf.has(p.exerciseId)) nameOf.set(p.exerciseId, p.nameSnapshot);
      if (p.note) noteOf.set(p.exerciseId, p.note);
    });

    const order = [];
    (session.plannedExercises || []).forEach((p) => order.push(p.exerciseId));
    for (const s of sets) if (!order.includes(s.exerciseId)) order.push(s.exerciseId);

    const memCtx = { excludeSessionId: session.id, asOf: { localDate: session.localDate, startTime: session.startTime || '', seq: session.createdAt || 0 } };
    const memory = new Map();
    const records = new Map();
    await Promise.all(order.map(async (exId) => {
      memory.set(exId, await getExerciseMemory(exId, memCtx));
      records.set(exId, await getExerciseRecords(exId));
    }));
    const achievements = await getSessionAchievements(session.id);

    const setsByEx = new Map();
    for (const s of sets) { if (!setsByEx.has(s.exerciseId)) setsByEx.set(s.exerciseId, []); setsByEx.get(s.exerciseId).push(s); }

    const workingCount = sets.filter((s) => s.setType === 'working').length;
    const subParts = [formatArabicDate(session.localDate)];
    if (session.routineNameSnapshot) subParts.push(session.routineNameSnapshot);
    subParts.push(session.completed ? 'مكتملة' : `${workingCount} مجموعة`);

    root.replaceChildren(el('div', { className: 'route-view stack' }, [
      pageHead(session.routineDayNameSnapshot || 'تمرين', { sub: subParts.join(' · ') }),
      ...order.map((exId) => exerciseBlock(exId, setsByEx.get(exId) || [], memory.get(exId), session)),
      el('button', { className: 'btn btn-secondary btn-block', text: '+ إضافة تمرين', onClick: () => openExercisePicker({ onPick: (x) => addExerciseToSession(session.id, x.id) }) }),
      achievementsSummary(achievements),
      footer(session),
    ]));

    function prevBlock(mem) {
      if (!mem || !mem.workingSets || !mem.workingSets.length) {
        return el('div', { className: 'prev' }, [el('div', { className: 'prev-none', text: 'لا يوجد سجل سابق لهذا التمرين.' })]);
      }
      return el('div', { className: 'prev' }, [
        el('div', { className: 'prev-head' }, [
          el('span', { className: 'ttl', text: 'آخر مرة' }),
          el('span', { className: 'dt num', text: formatArabicDateShort(mem.date) }),
        ]),
        el('div', { className: 'prev-sets' }, mem.workingSets.map((s) =>
          el('span', { className: 'ps num', text: `${formatWeight(s.weight)} ${s.unit} × ${s.reps}` }))),
      ]);
    }

    function exerciseBlock(exId, exSets, mem, session) {
      const currentUnit = unitOf.get(exId) || (exSets[0] ? exSets[0].unit : 'kg');
      const last = exSets[exSets.length - 1] || null;
      let prefillWeight = '';
      if (last && last.unit === currentUnit) prefillWeight = last.weight;
      else if (!last && mem && mem.unit === currentUnit && mem.workingWeight != null) prefillWeight = mem.workingWeight;
      const prefillReps = last ? last.reps : (mem && mem.workingSets[0] ? mem.workingSets[0].reps : '');

      const wIn = el('input', { className: 'input num grow', type: 'number', inputmode: 'decimal', step: '0.5', min: '0', attrs: { 'aria-label': `الوزن (${currentUnit})` }, placeholder: currentUnit, value: prefillWeight !== '' && prefillWeight != null ? String(prefillWeight) : '' });
      const rIn = el('input', { className: 'input num', type: 'number', inputmode: 'numeric', step: '1', min: '1', attrs: { 'aria-label': 'التكرارات' }, placeholder: 'عدّات', value: prefillReps !== '' && prefillReps != null ? String(prefillReps) : '' });
      const decR = el('button', { attrs: { 'aria-label': 'إنقاص' }, text: '−', onClick: () => { rIn.value = String(Math.max(1, (Number(rIn.value) || 0) - 1)); } });
      const incR = el('button', { attrs: { 'aria-label': 'زيادة' }, text: '+', onClick: () => { rIn.value = String((Number(rIn.value) || 0) + 1); } });
      let setType = 'working';
      const workBtn = el('button', { className: 'on', text: 'أساسية', onClick: () => setKind('working') });
      const warmBtn = el('button', { text: 'إحماء', onClick: () => setKind('warmup') });
      function setKind(k) { setType = k; workBtn.classList.toggle('on', k === 'working'); warmBtn.classList.toggle('on', k === 'warmup'); }

      const addBtn = el('button', {
        className: 'btn btn-primary', text: 'إضافة',
        onClick: async () => {
          try { await addSet({ sessionId: session.id, exerciseId: exId, weight: wIn.value, reps: rIn.value, setType }); }
          catch (err) { toast((err.errors && err.errors[0]) || 'قيمة غير صالحة'); }
        },
      });
      const dupBtn = last ? el('button', { className: 'link-btn', text: 'تكرار آخر مجموعة', onClick: async () => { try { await addSet({ sessionId: session.id, exerciseId: exId, weight: last.weight, reps: last.reps, setType: last.setType, rir: last.rir, note: last.note }); } catch (_) {} } }) : null;

      const note = noteOf.get(exId);
      let workingIdx = 0;

      return el('section', { className: 'section' }, [
        el('div', { className: 'ex-head' }, [el('div', { className: 'ex-name', text: nameOf.get(exId) || 'تمرين' })]),
        note ? el('div', { className: 'ex-note', text: note }) : null,
        el('div', { style: { marginTop: 'var(--s-3)' } }, [prevBlock(mem)]),
        exSets.length
          ? el('div', { className: 'list', style: { marginTop: 'var(--s-3)' } }, exSets.map((s) => setRow(s, records.get(exId), s.setType === 'working' ? ++workingIdx : null)))
          : null,
        el('div', { className: 'entry', style: { marginTop: 'var(--s-3)' } }, [wIn, el('div', { className: 'stepper' }, [decR, rIn, incR])]),
        el('div', { className: 'entry', style: { marginTop: 'var(--s-2)' } }, [el('div', { className: 'seg-inline' }, [workBtn, warmBtn]), el('div', { className: 'grow' }), addBtn]),
        dupBtn ? el('div', { style: { marginTop: 'var(--s-2)' } }, [dupBtn]) : null,
      ].filter(Boolean));
    }

    function setRow(s, rec, idx) {
      const flags = rec && rec.setFlags ? rec.setFlags.get(s.id) : null;
      const isWarm = s.setType === 'warmup';
      return el('button', { className: `setrow${isWarm ? ' warm' : ''}`, onClick: () => openSetEditor(s) }, [
        el('span', { className: 'sr-idx', text: isWarm ? '↑' : (idx != null ? String(idx) : '') }),
        el('span', { className: 'sr-main' }, [
          el('span', { className: 'sr-w num', text: formatWeight(s.weight) }),
          el('span', { className: 'sr-u', text: s.unit }),
          el('span', { className: 'sr-x', text: '×' }),
          el('span', { className: 'sr-r num', text: String(s.reps) }),
        ]),
        el('span', { className: 'sr-tags' }, [
          isWarm ? el('span', { className: 'official-tag', text: 'إحماء' }) : null,
          flags && flags.weightPR ? el('span', { className: 'badge-new', attrs: { title: 'وزن جديد' }, text: 'وزن ★' }) : null,
          flags && flags.repPR ? el('span', { className: 'badge-new', attrs: { title: 'أفضل عدّات' }, text: 'عدّات ★' }) : null,
          s.rir != null ? el('span', { className: 'muted-sm', text: `RIR ${s.rir}` }) : null,
        ].filter(Boolean)),
      ]);
    }

    function achievementsSummary(list) {
      if (!list || !list.length) return el('div', {});
      return el('section', { className: 'section' }, [
        el('div', { className: 'section-head' }, [el('h2', { text: 'إنجازات اليوم' })]),
        el('div', { className: 'list' }, list.map((a) => el('div', { className: 'row' }, [
          el('div', { className: 'row-label num', text: a.type === 'weight'
            ? `${nameOf.get(a.exerciseId) || 'تمرين'} — وزن جديد ${formatWeight(a.weight)} ${a.unit}`
            : `${nameOf.get(a.exerciseId) || 'تمرين'} — أفضل عدّات ${a.reps} عند ${formatWeight(a.weight)} ${a.unit}` }),
          el('span', { className: 'star', text: '★' }),
        ]))),
      ]);
    }

    function footer(session) {
      const finish = el('button', { className: session.completed ? 'btn btn-secondary btn-block' : 'btn btn-primary btn-block', text: session.completed ? 'إلغاء الإكمال' : 'إنهاء التمرين', onClick: () => setSessionCompleted(session.id, !session.completed) });
      const manage = el('button', { className: 'btn btn-ghost btn-block', text: 'تفاصيل الجلسة', onClick: () => openSessionManager(session) });
      return el('section', { className: 'section stack' }, [finish, manage]);
    }

    function openSessionManager(session) {
      const date = el('input', { className: 'input num', type: 'date', value: session.localDate });
      date.addEventListener('change', () => updateSession(session.id, { localDate: date.value }));
      const notes = el('input', { className: 'input', type: 'text', value: session.notes, placeholder: 'ملاحظات الجلسة' });
      notes.addEventListener('change', () => setSessionNotes(session.id, notes.value));
      const del = el('button', {
        className: 'btn btn-danger btn-block', text: 'حذف الجلسة',
        onClick: () => {
          const confirm = el('button', { className: 'btn btn-danger btn-block', text: 'تأكيد الحذف — لا يمكن التراجع', onClick: async () => { await deleteSession(session.id); toast('تم الحذف'); handle.close(); navigate('workout'); } });
          del.replaceWith(confirm);
        },
      });
      const body = el('div', { className: 'stack' }, [
        el('div', { className: 'field' }, [el('label', { text: 'التاريخ' }), date]),
        el('div', { className: 'field' }, [el('label', { text: 'ملاحظات' }), notes]),
        el('div', { className: 'divider' }),
        del,
      ]);
      const handle = openSheet({ title: 'تفاصيل الجلسة', body });
    }

    function openSetEditor(s) {
      const wIn = el('input', { className: 'input num', type: 'number', inputmode: 'decimal', step: '0.5', min: '0', value: String(s.weight) });
      const rIn = el('input', { className: 'input num', type: 'number', inputmode: 'numeric', step: '1', min: '1', value: String(s.reps) });
      const rirIn = el('input', { className: 'input num', type: 'number', inputmode: 'numeric', step: '1', min: '0', value: s.rir != null ? String(s.rir) : '', placeholder: 'RIR (اختياري)' });
      const noteIn = el('input', { className: 'input', type: 'text', value: s.note || '', placeholder: 'ملاحظة' });
      let setType = s.setType;
      const workBtn = el('button', { className: setType === 'working' ? 'on' : '', text: 'أساسية', onClick: () => setKind('working') });
      const warmBtn = el('button', { className: setType === 'warmup' ? 'on' : '', text: 'إحماء', onClick: () => setKind('warmup') });
      function setKind(k) { setType = k; workBtn.classList.toggle('on', k === 'working'); warmBtn.classList.toggle('on', k === 'warmup'); }

      const exField = el('div', { className: 'field' }, [
        el('label', { text: 'التمرين' }),
        el('div', { className: 'row-inline' }, [
          el('div', { className: 'input grow', style: { display: 'flex', alignItems: 'center' }, text: nameOf.get(s.exerciseId) || 'تمرين' }),
          el('button', {
            className: 'btn btn-secondary', text: 'تغيير',
            onClick: () => openExercisePicker({
              title: 'تغيير تمرين المجموعة',
              onPick: async (x) => {
                try { await updateSet(s.id, { exerciseId: x.id }); toast('تم تغيير التمرين'); handle.close(); }
                catch (err) { toast((err.errors && err.errors[0]) || 'تعذّر التغيير'); }
              },
            }),
          }),
        ]),
        el('p', { className: 'hint', text: 'تغيير التمرين ينقل المجموعة ويحدّث وحدتها إلى الوحدة الافتراضية للتمرين الجديد.' }),
      ]);
      const save = el('button', {
        className: 'btn btn-primary btn-block', text: 'حفظ',
        onClick: async () => { try { await updateSet(s.id, { weight: wIn.value, reps: rIn.value, setType, rir: rirIn.value === '' ? null : rirIn.value, note: noteIn.value }); toast('تم الحفظ'); handle.close(); } catch (err) { toast((err.errors && err.errors[0]) || 'قيمة غير صالحة'); } },
      });
      const del = el('button', { className: 'btn btn-danger btn-block', text: 'حذف المجموعة', onClick: async () => { await deleteSet(s.id); toast('تم الحذف'); handle.close(); } });
      const body = el('div', { className: 'stack' }, [
        exField,
        el('div', { className: 'row-inline' }, [
          el('div', { className: 'field grow', style: { marginTop: 0 } }, [el('label', { text: 'الوزن' }), wIn]),
          el('div', { className: 'field grow', style: { marginTop: 0 } }, [el('label', { text: 'التكرارات' }), rIn]),
        ]),
        el('div', { className: 'field' }, [el('label', { text: 'النوع' }), el('div', { className: 'seg-inline' }, [workBtn, warmBtn])]),
        el('div', { className: 'field' }, [el('label', { text: 'RIR (اختياري)' }), rirIn]),
        el('div', { className: 'field' }, [el('label', { text: 'ملاحظة' }), noteIn]),
        save,
        el('div', { className: 'divider' }),
        del,
      ]);
      const handle = openSheet({ title: 'تعديل المجموعة', body });
    }
  }

  const unsub = on('workout:changed', draw);
  draw();
  return () => unsub();
}
