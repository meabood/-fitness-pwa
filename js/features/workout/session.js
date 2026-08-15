// workout/session.js — ACTIVE WORKOUT (today's execution). Dense logging with an
// up-counting workout timer, planned exercises in order, a set grid
// (# · previous · weight · reps · ✓), a timestamp-based rest timer that resumes
// across in-app navigation, and a SESSION-SCOPED per-exercise action menu
// (swap / remove / note / reorder / next). These actions edit only TODAY's
// session — never the saved routine, never other sessions' history. All factual
// semantics (PR flags, memory chronology, unit snapshots, identity) unchanged.

import { el, toast } from '../../core/dom.js';
import { on } from '../../core/events.js';
import {
  getSession, getSetsForSession, getExerciseMemory, addSet, updateSet, deleteSet,
  addExerciseToSession, setSessionCompleted, setSessionNotes, updateSession, deleteSession,
  getExerciseRecords, getSessionAchievements,
  setSessionExerciseNote, removeExerciseFromSession, swapExerciseInSession, moveExerciseInSession,
  setSessionRest, clearSessionRest,
} from '../../data/workouts.repo.js';
import { getAllExercises } from '../../data/exercises.repo.js';
import { getConfig } from '../../data/settings.repo.js';
import { openExercisePicker } from '../exercises/exercisePicker.js';
import { openSheet } from '../../core/sheet.js';
import { formatWeight } from '../../core/num.js';
import { formatArabicDate } from '../../core/dates.js';
import { pageHead, exerciseTitle } from '../../core/ui.js';

const REST_BETWEEN_FALLBACK = 90;   // seconds, used if no per-exercise + no global
const REST_AFTER_FALLBACK = 120;

export function renderSession(root, ctx = {}) {
  const navigate = ctx.navigate || (() => {});
  const sessionId = ctx.param;

  let tickTimer = null;      // single 1s interval driving BOTH timers' displays
  let headerTimeEl = null;
  let restEl = null;
  let sessionStartMs = 0;
  // Rest countdown is TIMESTAMP-based and persisted on the session record, so it
  // survives SPA navigation AND full reload / PWA relaunch. These closure vars
  // mirror the persisted values (session.restEndsAt / session.restKind); the DB
  // is the source of truth and is re-read on every draw().
  let restEndsAt = 0;
  let restKind = 'set';
  let restCleared = false;   // guard so expiry clears the record only once

  function fmtClock(totalSec) {
    const s = Math.max(0, Math.floor(totalSec));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${pad(h)}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`;
  }

  function restRemaining() {
    if (!restEndsAt) return 0;
    const left = Math.ceil((restEndsAt - Date.now()) / 1000);
    if (left <= 0) {
      restEndsAt = 0;
      if (!restCleared) { restCleared = true; clearSessionRest(sessionId); } // expired → clear persisted state once
      return 0;
    }
    return left;
  }
  function startRest(seconds, kind) {
    if (!seconds || seconds <= 0) return;
    restEndsAt = Date.now() + seconds * 1000; restKind = kind; restCleared = false;
    setSessionRest(sessionId, { endsAt: restEndsAt, kind });   // persist timestamp only
    paintRest();
  }
  function addRestSeconds(delta) {
    if (!restEndsAt) return;
    restEndsAt += delta * 1000;
    if (restEndsAt <= Date.now()) { skipRest(); return; }
    setSessionRest(sessionId, { endsAt: restEndsAt, kind: restKind }); // +30 persists
    paintRest();
  }
  function skipRest() { restEndsAt = 0; restCleared = true; clearSessionRest(sessionId); paintRest(); } // Skip persists (clears)

  function paintRest() {
    if (!restEl) return;
    const left = restRemaining();
    if (left <= 0) { restEl.replaceChildren(); restEl.style.display = 'none'; return; }
    restEl.style.display = 'flex';
    restEl.replaceChildren(
      el('span', { html: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>' }),
      el('span', { text: restKind === 'exercise' ? 'راحة بعد التمرين' : 'راحة' }),
      el('span', { className: 'rt-time', text: fmtClock(left) }),
      el('span', { className: 'grow' }),
      el('button', { text: '+30', onClick: () => addRestSeconds(30) }),
      el('button', { text: 'تخطٍّ', onClick: skipRest }),
    );
  }

  function stopTick() { if (tickTimer) { clearInterval(tickTimer); tickTimer = null; } }

  async function draw() {
    const session = sessionId ? await getSession(sessionId) : null;
    if (!session) {
      stopTick();
      root.replaceChildren(el('div', { className: 'route-view stack' }, [
        pageHead('جلسة'),
        el('div', { className: 'notice', text: 'الجلسة غير موجودة.' }),
        el('button', { className: 'btn btn-secondary btn-block', text: 'رجوع', onClick: () => navigate('workout') }),
      ]));
      return;
    }
    sessionStartMs = session.createdAt || Date.now();

    // Reconstruct the rest countdown from the persisted timestamp (survives
    // reload / relaunch). Expired rest is ignored and cleared.
    restEndsAt = session.restEndsAt || 0;
    restKind = session.restKind || 'set';
    restCleared = false;
    if (restEndsAt && restEndsAt <= Date.now()) { restEndsAt = 0; restCleared = true; clearSessionRest(session.id); }

    const [sets, allEx, gBetween, gAfter] = await Promise.all([
      getSetsForSession(session.id),
      getAllExercises(),
      getConfig('restBetweenSetsDefault'),
      getConfig('restAfterExerciseDefault'),
    ]);
    const globalBetween = (gBetween == null || gBetween === '') ? REST_BETWEEN_FALLBACK : (Number.isFinite(Number(gBetween)) ? Number(gBetween) : REST_BETWEEN_FALLBACK);
    const globalAfter = (gAfter == null || gAfter === '') ? REST_AFTER_FALLBACK : (Number.isFinite(Number(gAfter)) ? Number(gAfter) : REST_AFTER_FALLBACK);

    const exOf = new Map(allEx.map((x) => [x.id, x]));
    const titleOf = (id) => { const ex = exOf.get(id); return ex ? exerciseTitle(ex) : 'تمرين'; };
    const unitOf = new Map(allEx.map((x) => [x.id, x.defaultUnit]));
    const plannedOf = new Map();
    (session.plannedExercises || []).forEach((p) => plannedOf.set(p.exerciseId, p));

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

    const setsByEx = new Map();
    for (const s of sets) { if (!setsByEx.has(s.exerciseId)) setsByEx.set(s.exerciseId, []); setsByEx.get(s.exerciseId).push(s); }

    const completed = session.completed;

    // resolve rest durations for an exercise: per-exercise snapshot ?? global
    const restBetweenFor = (exId) => { const p = plannedOf.get(exId); return (p && p.restBetweenSets != null) ? p.restBetweenSets : globalBetween; };
    const restAfterFor = (exId) => { const p = plannedOf.get(exId); return (p && p.restAfterExercise != null) ? p.restAfterExercise : globalAfter; };

    headerTimeEl = el('span', { className: 'wtimer', text: fmtClock((Date.now() - sessionStartMs) / 1000) });
    const header = el('div', { className: 'page-head' }, [
      el('div', {}, [
        el('div', { className: 'ph-title', text: session.routineDayNameSnapshot || 'تمرين' }),
        el('div', { className: 'ph-sub', text: session.routineNameSnapshot || formatArabicDate(session.localDate) }),
      ]),
      completed ? el('span', { className: 'badge-new', text: 'مكتملة' }) : headerTimeEl,
    ]);

    restEl = el('div', { className: 'resttimer', style: { display: 'none' } });

    root.replaceChildren(el('div', { className: 'route-view stack workout-active' }, [
      header,
      ...order.map((exId, i) => exerciseBlock(exId, setsByEx.get(exId) || [], memory.get(exId), session, i, order.length)),
      el('button', { className: 'btn btn-secondary btn-block', text: '+ إضافة تمرين', onClick: () => openExercisePicker({ onPick: (x) => addExerciseToSession(session.id, x.id) }) }),
      footer(session),
      restEl,
    ]));

    // single ticking loop drives up-timer + rest display (independent values)
    stopTick();
    paintRest();
    if (!completed) {
      tickTimer = setInterval(() => {
        if (headerTimeEl) headerTimeEl.textContent = fmtClock((Date.now() - sessionStartMs) / 1000);
        paintRest();
      }, 1000);
    }

    function exerciseBlock(exId, exSets, mem, session, index, total) {
      const unit = unitOf.get(exId) || (exSets[0] ? exSets[0].unit : 'lb');
      const prevSets = (mem && mem.workingSets) ? mem.workingSets : [];
      const rec = records.get(exId);
      const planned = plannedOf.get(exId);
      const note = planned ? planned.note : '';

      const grid = el('div', { className: 'setgrid' }, [
        el('div', { className: 'sg-head' }, [
          el('span', { text: '#' }), el('span', { text: 'السابق' }),
          el('span', { text: (unit || 'lb').toUpperCase() }), el('span', { text: 'عدّات' }), el('span', { text: '' }),
        ]),
        ...exSets.map((s, i) => loggedRow(s, i, prevSets, rec)),
        completed ? null : addRow(exId, unit, exSets.length, prevSets, session),
      ].filter(Boolean));

      const menuBtn = completed ? null : el('button', {
        className: 'ex-menu-btn', attrs: { 'aria-label': 'خيارات التمرين' },
        html: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
        onClick: () => openExerciseMenu(exId, index, total, session),
      });

      const nextBtn = (!completed && index < total - 1) ? el('button', {
        className: 'link-btn', text: 'التمرين التالي ⏭',
        onClick: () => { startRest(restAfterFor(exId), 'exercise'); const blocks = root.querySelectorAll('.workout-active > section'); if (blocks[index + 1]) blocks[index + 1].scrollIntoView({ behavior: 'smooth', block: 'start' }); },
      }) : null;

      return el('section', { className: 'section' }, [
        el('div', { className: 'ex-head' }, [
          el('div', { className: 'ex-name ex-title', text: titleOf(exId) }),
          menuBtn,
        ].filter(Boolean)),
        note ? el('div', { className: 'ex-note', text: note }) : null,
        grid,
        nextBtn ? el('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--s-2)' } }, [nextBtn]) : null,
      ].filter(Boolean));
    }

    function prevText(prevSets, idx) {
      const p = prevSets[idx];
      return p ? `${formatWeight(p.weight)} ${p.unit} × ${p.reps}` : '—';
    }

    function loggedRow(s, idx, prevSets, rec) {
      const flags = rec && rec.setFlags ? rec.setFlags.get(s.id) : null;
      const isWarm = s.setType === 'warmup';
      const pr = flags && (flags.weightPR || flags.repPR);
      return el('div', { className: `sg-row done${isWarm ? ' warm' : ''}`, onClick: () => completed ? openSetEditor(s) : openSetEditor(s) }, [
        el('span', { className: 'cell-in', style: { textAlign: 'center', color: 'var(--text-3)' }, text: isWarm ? '↑' : String(idx + 1) }),
        el('span', { className: 'prevcell', text: prevText(prevSets, idx) }),
        el('span', { className: 'cell-in num', text: formatWeight(s.weight) }),
        el('span', { className: 'cell-in num', text: String(s.reps) }),
        el('span', { className: 'setcheck on', attrs: { 'aria-label': pr ? 'مجموعة مسجّلة — رقم قياسي' : 'مجموعة مسجّلة' }, html: pr
          ? '<span style="font-size:14px">★</span>'
          : '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>' }),
      ]);
    }

    function addRow(exId, unit, existingCount, prevSets, session) {
      const wIn = el('input', { className: 'input cell-in num', type: 'number', inputmode: 'decimal', step: '0.5', min: '0', placeholder: '—', attrs: { 'aria-label': `الوزن (${unit})` } });
      const rIn = el('input', { className: 'input cell-in num', type: 'number', inputmode: 'numeric', step: '1', min: '1', placeholder: '—', attrs: { 'aria-label': 'التكرارات' } });
      const p = prevSets[existingCount];               // reference only — never logged automatically
      if (p && p.unit === unit) wIn.value = String(p.weight);
      if (p) rIn.value = String(p.reps);
      let setType = 'working';

      const commit = async () => {
        try {
          await addSet({ sessionId: session.id, exerciseId: exId, weight: wIn.value, reps: rIn.value, setType });
          if (setType === 'working') startRest(restBetweenFor(exId), 'set'); // between-set rest
        } catch (err) { toast((err.errors && err.errors[0]) || 'أدخل وزنًا وعدّات صحيحة'); }
      };
      const check = el('button', { className: 'setcheck', attrs: { 'aria-label': 'تسجيل المجموعة' }, html: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>', onClick: commit });
      rIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); });

      const warmToggle = el('button', { className: 'warm-toggle', attrs: { 'aria-label': 'تبديل الإحماء' }, text: 'إحماء', onClick: () => { setType = setType === 'working' ? 'warmup' : 'working'; warmToggle.classList.toggle('on', setType === 'warmup'); } });

      return el('div', {}, [
        el('div', { className: 'sg-row' }, [
          el('span', { className: 'cell-in', style: { textAlign: 'center', color: 'var(--text-3)' }, text: '+' }),
          el('span', { className: 'prevcell', text: prevText(prevSets, existingCount) }),
          wIn, rIn, check,
        ]),
        el('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: '2px' } }, [warmToggle]),
      ]);
    }

    // ── SESSION-SCOPED per-exercise menu (does NOT edit the saved routine) ──
    function openExerciseMenu(exId, index, total, session) {
      const noteIn = el('input', { className: 'input', type: 'text', value: (plannedOf.get(exId) || {}).note || '', placeholder: 'ملاحظة لهذا التمرين (اليوم فقط)' });
      noteIn.addEventListener('change', () => setSessionExerciseNote(session.id, exId, noteIn.value));

      const swap = el('button', { className: 'btn btn-secondary btn-block', text: 'تبديل التمرين', onClick: () => {
        openExercisePicker({ title: 'تبديل التمرين (لهذه الجلسة)', onPick: async (x) => { await swapExerciseInSession(session.id, exId, x.id); toast('تم التبديل لهذه الجلسة'); handle.close(); } });
      } });

      const reorder = el('div', { className: 'row-inline', style: { gap: 'var(--s-2)' } }, [
        el('button', { className: 'btn btn-secondary grow', text: '▲ لأعلى', attrs: { disabled: index === 0 ? 'true' : null }, onClick: async () => { await moveExerciseInSession(session.id, exId, 'up'); handle.close(); } }),
        el('button', { className: 'btn btn-secondary grow', text: 'لأسفل ▼', attrs: { disabled: index >= total - 1 ? 'true' : null }, onClick: async () => { await moveExerciseInSession(session.id, exId, 'down'); handle.close(); } }),
      ]);

      let removeArmed = false;
      const remove = el('button', { className: 'btn btn-danger btn-block', text: 'إزالة من هذه الجلسة', onClick: async () => {
        if (!removeArmed) { removeArmed = true; remove.textContent = 'تأكيد الإزالة — تُحذف مجموعات اليوم فقط'; return; }
        await removeExerciseFromSession(session.id, exId); toast('أُزيل من جلسة اليوم'); handle.close();
      } });

      const body = el('div', { className: 'stack' }, [
        el('p', { className: 'hint', text: 'هذه التغييرات تخص تمرين اليوم فقط ولا تعدّل البرنامج المحفوظ.' }),
        el('div', { className: 'field' }, [el('label', { text: 'ملاحظة اليوم' }), noteIn]),
        swap,
        reorder,
        el('div', { className: 'divider' }),
        remove,
      ]);
      const handle = openSheet({ title: titleOf(exId), body });
    }

    function footer(session) {
      const finish = el('button', {
        className: session.completed ? 'btn btn-secondary btn-block' : 'btn btn-primary btn-block',
        text: session.completed ? 'إعادة فتح التمرين' : 'إنهاء التمرين',
        onClick: async () => {
          if (session.completed) { await setSessionCompleted(session.id, false); return; }
          await setSessionCompleted(session.id, true);
          restEndsAt = 0; restCleared = true; clearSessionRest(session.id);
          stopTick();
          showSummary(session.id);
        },
      });
      const manage = el('button', { className: 'btn btn-tertiary btn-block', text: 'تفاصيل الجلسة', onClick: () => openSessionManager(session) });
      return el('section', { className: 'section stack' }, [finish, manage]);
    }

    async function showSummary(id) {
      const s = await getSession(id);
      const sets2 = await getSetsForSession(id);
      const achievements = await getSessionAchievements(id);
      const working = sets2.filter((x) => x.setType === 'working').length;
      const exCount = new Set(sets2.map((x) => x.exerciseId)).size;
      const mins = s.createdAt ? Math.max(1, Math.round((Date.now() - s.createdAt) / 60000)) : null;
      const stat = (label, value) => el('div', { className: 'sum-stat' }, [
        el('div', { className: 'num', style: { fontSize: 'var(--t-lg)', fontWeight: 'var(--w-semibold)' }, text: String(value) }),
        el('div', { className: 'muted-sm', text: label }),
      ]);
      const body = el('div', { className: 'stack' }, [
        el('div', { className: 'sum-grid' }, [mins != null ? stat('دقيقة', mins) : null, stat('تمارين', exCount), stat('مجموعات', working)].filter(Boolean)),
        achievements && achievements.length
          ? el('div', { className: 'stack', style: { gap: 'var(--s-2)' } }, [
              el('div', { className: 'pk-head', text: 'إنجازات جديدة' }),
              ...achievements.map((a) => el('div', { className: 'row-inline', style: { gap: 'var(--s-2)' } }, [
                el('span', { className: 'star', text: '★' }),
                el('span', { className: 'ex-title', text: titleOf(a.exerciseId) }),
                el('span', { className: 'muted-sm', text: a.type === 'weight' ? `وزن ${formatWeight(a.weight)} ${a.unit}` : `${a.reps} عند ${formatWeight(a.weight)} ${a.unit}` }),
              ])),
            ])
          : null,
        el('button', { className: 'btn btn-primary btn-block', text: 'تم', onClick: () => { handle.close(); navigate('workout'); } }),
      ].filter(Boolean));
      const handle = openSheet({ title: `تمرين ${s.routineDayNameSnapshot || ''}`.trim(), body });
    }

    function openSessionManager(session) {
      const date = el('input', { className: 'input num', type: 'date', value: session.localDate });
      date.addEventListener('change', () => updateSession(session.id, { localDate: date.value }));
      const notes = el('input', { className: 'input', type: 'text', value: session.notes, placeholder: 'ملاحظات الجلسة' });
      notes.addEventListener('change', () => setSessionNotes(session.id, notes.value));
      const del = el('button', {
        className: 'btn btn-danger btn-block', text: 'حذف الجلسة',
        onClick: () => {
          const confirm = el('button', { className: 'btn btn-danger btn-block', text: 'تأكيد الحذف — لا يمكن التراجع', onClick: async () => { await deleteSession(session.id); toast('تم الحذف'); handle.close(); stopTick(); navigate('workout'); } });
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
      let setType = s.setType;
      const workBtn = el('button', { className: setType === 'working' ? 'on' : '', text: 'أساسية', onClick: () => setKind('working') });
      const warmBtn = el('button', { className: setType === 'warmup' ? 'on' : '', text: 'إحماء', onClick: () => setKind('warmup') });
      function setKind(k) { setType = k; workBtn.classList.toggle('on', k === 'working'); warmBtn.classList.toggle('on', k === 'warmup'); }
      const save = el('button', {
        className: 'btn btn-primary btn-block', text: 'حفظ',
        onClick: async () => { try { await updateSet(s.id, { weight: wIn.value, reps: rIn.value, setType, rir: rirIn.value === '' ? null : rirIn.value }); toast('تم الحفظ'); handle.close(); } catch (err) { toast((err.errors && err.errors[0]) || 'قيمة غير صالحة'); } },
      });
      const del = el('button', { className: 'btn btn-danger btn-block', text: 'حذف المجموعة', onClick: async () => { await deleteSet(s.id); toast('تم الحذف'); handle.close(); } });
      const body = el('div', { className: 'stack' }, [
        el('div', { className: 'row-inline' }, [
          el('div', { className: 'field grow', style: { marginTop: 0 } }, [el('label', { text: 'الوزن' }), wIn]),
          el('div', { className: 'field grow', style: { marginTop: 0 } }, [el('label', { text: 'التكرارات' }), rIn]),
        ]),
        el('div', { className: 'field' }, [el('label', { text: 'النوع' }), el('div', { className: 'seg-inline' }, [workBtn, warmBtn])]),
        el('div', { className: 'field' }, [el('label', { text: 'RIR (اختياري)' }), rirIn]),
        save, el('div', { className: 'divider' }), del,
      ]);
      const handle = openSheet({ title: 'تعديل المجموعة', body });
    }
  }

  const unsub = on('workout:changed', draw);
  draw();
  return () => { unsub(); stopTick(); };
}
