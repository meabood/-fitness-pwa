// exercises/exerciseDetail.js — a focused progression page for one exercise.
// Answers "how am I progressing?": identity, current best working weight,
// best reps at relevant weights, last performance, a progression chart with a
// unit selector when history spans both kg and lb (never mixed), and recent
// sessions (same-day sessions kept distinct). Chronology matches the engine.

import { el, toast } from '../../core/dom.js';
import { on } from '../../core/events.js';
import { getExercise, archiveExercise, restoreExercise } from '../../data/exercises.repo.js';
import { getExerciseSetsEnriched } from '../../data/workouts.repo.js';
import { computeExerciseRecords, bestRepsByWeightList } from '../../domain/gymRecords.js';
import { lastPerformance, bySessionGroups } from '../../domain/workoutMemory.js';
import { exerciseUnitSeries } from '../../domain/statsData.js';
import { lineChart } from '../../core/svgChart.js';
import { formatWeight } from '../../core/num.js';
import { formatArabicDate, formatArabicDateShort } from '../../core/dates.js';
import { openExerciseEditor } from './exerciseSheets.js';
import { pageHead, hero, statLine, emptyState, exerciseTitle } from '../../core/ui.js';
import { openSheet } from '../../core/sheet.js';

export function renderExerciseDetail(root, ctx = {}) {
  const navigate = ctx.navigate || (() => {});
  const id = ctx.param;
  let chartUnit = null; // chosen progression unit when both exist

  async function draw() {
    const x = id ? await getExercise(id) : null;
    if (!x) {
      root.replaceChildren(el('div', { className: 'route-view stack' }, [
        pageHead('تمرين'),
        el('div', { className: 'notice', text: 'التمرين غير موجود.' }),
        el('button', { className: 'btn btn-secondary btn-block', text: 'رجوع', onClick: () => navigate('exercises') }),
      ]));
      return;
    }
    const sets = await getExerciseSetsEnriched(id);
    const { maxWeightByUnit } = computeExerciseRecords(sets);
    const bestReps = bestRepsByWeightList(sets);
    const last = lastPerformance(sets, {});

    const metaBits = [x.muscleGroup, x.equipment].filter(Boolean);
    const metaChips = metaBits.length
      ? el('div', { className: 'meta-chips' }, metaBits.map((m) => el('span', { className: 'meta-chip', text: m })))
      : null;

    root.replaceChildren(el('div', { className: 'route-view stack' }, [
      pageHead(exerciseTitle(x), { actionLabel: 'تعديل', onAction: () => openExerciseEditor({ exercise: x, afterChange: draw }) }),
      metaChips,
      bestPanel(maxWeightByUnit, last),
      chartPanel(sets),
      bestRepsPanel(bestReps),
      historySection(sets),
      manageSection(x),
    ].filter(Boolean)));

    function bestPanel(maxWeightByUnit, last) {
      const units = [...maxWeightByUnit.entries()];
      if (!units.length) {
        return emptyState({ icon: 'workout', title: 'لا توجد مجموعات أساسية بعد.', hint: 'سجّل مجموعة في جلسة لعرض تقدّمك.' });
      }
      // hero = heaviest working weight in the first unit; other unit as a stat
      const [u0, w0] = units[0];
      const lines = units.slice(1).map(([u, w]) => statLine(`أعلى وزن (${u})`, `${formatWeight(w)} ${u}`));
      if (last) {
        const same = last.workingSets.every((s) => s.weight === last.workingSets[0].weight && s.unit === last.workingSets[0].unit);
        const summary = same
          ? `${formatWeight(last.workingSets[0].weight)} ${last.workingSets[0].unit} × ${last.workingSets.map((s) => s.reps).join('/')}`
          : last.workingSets.map((s) => `${formatWeight(s.weight)}${s.unit}×${s.reps}`).join('، ');
        lines.push(statLine(`آخر أداء · ${formatArabicDateShort(last.date)}`, summary));
      }
      return el('div', { className: 'panel' }, [
        hero({ cap: 'أعلى وزن أساسي', value: formatWeight(w0), unit: u0 }),
        lines.length ? el('div', { style: { marginTop: 'var(--s-3)' } }, lines) : null,
      ].filter(Boolean));
    }

    function chartPanel(sets) {
      // units present among working sets
      const unitsSeen = [...new Set(sets.filter((s) => s.setType === 'working').map((s) => s.unit))];
      if (!unitsSeen.length) return el('div', {});
      const unit = chartUnit && unitsSeen.includes(chartUnit) ? chartUnit : unitsSeen[0];
      const series = exerciseUnitSeries(sets, unit);
      const head = el('div', { className: 'section-head' }, [el('h2', { text: 'التقدّم' })]);

      // unit selector only when both units have history (never mix on one series)
      const selector = unitsSeen.length > 1
        ? el('div', { className: 'seg', style: { maxWidth: '160px' } }, unitsSeen.map((u) =>
            el('button', { className: u === unit ? 'on' : '', text: u.toUpperCase(), onClick: () => { chartUnit = u; draw(); } })))
        : null;

      let body;
      if (series.maxWeight.length < 2) {
        body = el('div', { className: 'chart-empty', text: 'سجّل جلستين على الأقل بهذه الوحدة لعرض التقدّم.' });
      } else {
        const pts = series.maxWeight.map((p) => ({ x: p.x, y: p.y }));
        const ticks = [series.maxWeight[0], series.maxWeight[series.maxWeight.length - 1]]
          .map((p) => ({ x: p.x, label: formatArabicDateShort(p.date) }));
        body = el('div', { className: 'chart' }, [lineChart({
          series: [{ points: pts, color: '#2f7d3b', strokeWidth: 2, showPoints: true }],
          xTicks: ticks, formatY: (v) => formatWeight(v), ariaLabel: `تقدّم ${unit}`,
        })]);
      }
      return el('section', { className: 'section' }, [
        el('div', { className: 'row-inline', style: { justifyContent: 'space-between' } }, [head, selector].filter(Boolean)),
        el('div', { style: { marginTop: 'var(--s-2)' } }, [body]),
      ]);
    }

    function bestRepsPanel(bestReps) {
      if (!bestReps.length) return el('div', {});
      return el('section', { className: 'section' }, [
        el('div', { className: 'section-head' }, [el('h2', { text: 'أفضل العدّات حسب الوزن' })]),
        el('div', { className: 'list' }, bestReps.slice(0, 8).map((b) =>
          el('div', { className: 'statline', style: { padding: 'var(--s-3) var(--s-4)' } }, [
            el('span', { className: 'sl-label num', text: `${formatWeight(b.weight)} ${b.unit}` }),
            el('span', { className: 'sl-value num', text: `${b.reps} عدّة` }),
          ]))),
      ]);
    }

    function historySection(sets) {
      const groups = [...bySessionGroups(sets).entries()]
        .map(([sessionId, ss]) => ({
          sessionId,
          date: ss[0].sessionDate ?? ss[0].localDate,
          start: ss[0].sessionStart ?? '',
          seq: ss[0].sessionSeq ?? 0,
          sets: ss.slice().sort((a, b) => (a.order || 0) - (b.order || 0)),
        }))
        .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.start !== b.start ? (a.start < b.start ? 1 : -1) : b.seq - a.seq))
        .slice(0, 12);
      if (!groups.length) return el('div', {});
      return el('section', { className: 'section' }, [
        el('div', { className: 'section-head' }, [el('h2', { text: 'سجل الجلسات' })]),
        el('div', { className: 'list' }, groups.map((g) => el('button', {
          className: 'row', style: { width: '100%' }, onClick: () => navigate('session', g.sessionId),
        }, [
          el('div', { className: 'row-label' }, [
            el('div', { className: 'num', text: formatArabicDate(g.date) }),
            el('div', { className: 'sub num', text: g.sets.filter((s) => s.setType === 'working').map((s) => `${formatWeight(s.weight)}${s.unit}×${s.reps}`).join('، ') || 'إحماء فقط' }),
          ]),
          el('div', { className: 'chev', text: '‹' }),
        ]))),
      ]);
    }

    function manageSection(x) {
      return el('section', { className: 'section stack' }, [
        x.notes ? el('div', { className: 'notice', text: x.notes }) : null,
        el('button', { className: 'btn btn-ghost btn-block', text: 'تفاصيل وإدارة', onClick: () => openManage(x) }),
      ].filter(Boolean));
    }

    function openManage(x) {
      const body = el('div', { className: 'stack' }, [
        el('div', { className: 'list' }, [
          infoRow('المجموعة العضلية', x.muscleGroup || '—'),
          infoRow('الجهاز/الأداة', x.equipment || '—'),
          infoRow('الوحدة الافتراضية', (x.defaultUnit || '').toUpperCase() || '—'),
          infoRow('الحالة', x.status === 'archived' ? 'مؤرشف' : 'نشط'),
        ]),
        el('button', { className: 'btn btn-secondary btn-block', text: 'تعديل التمرين', onClick: () => { handle.close(); openExerciseEditor({ exercise: x, afterChange: draw }); } }),
        x.status === 'archived'
          ? el('button', { className: 'btn btn-ghost btn-block', text: 'استعادة', onClick: async () => { await restoreExercise(x.id); toast('تمت الاستعادة'); handle.close(); } })
          : el('button', { className: 'btn btn-danger btn-block', text: 'أرشفة', onClick: async () => { await archiveExercise(x.id); toast('تمت الأرشفة'); handle.close(); } }),
      ]);
      const handle = openSheet({ title: exerciseTitle(x), body });
    }
  }

  const unsub = on('exercises:changed', draw);
  const unsub2 = on('workout:changed', draw);
  draw();
  return () => { unsub(); unsub2(); };
}

function infoRow(label, value) {
  return el('div', { className: 'row' }, [
    el('div', { className: 'row-label', text: label }),
    el('div', { className: 'row-value', text: value }),
  ]);
}
