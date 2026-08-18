// goals/goals.js — goal management (reached via Weight / Settings). A hero for
// the active plan + trajectory, a milestone timeline, and plan management. All
// derived from weight history; historical edits recompute achievements.

import { el } from '../../core/dom.js';
import { on } from '../../core/events.js';
import { getActivePlanWithMilestones, archivePlan } from '../../data/goals.repo.js';
import { getAllEntries } from '../../data/weight.repo.js';
import { getConfig } from '../../data/settings.repo.js';
import { computeWeightSummary } from '../../domain/weightAchievements.js';
import { formatWeight } from '../../core/num.js';
import { formatArabicDate, formatArabicDateShort } from '../../core/dates.js';
import { openPlanEditor } from './goalSheets.js';
import { openGeneratorSheet } from './generatorSheet.js';
import { milestoneTimeline } from '../weight/milestoneTimeline.js';
import { pageHead, hero, statLine, emptyState, numericLTR } from '../../core/ui.js';

const trajectoryText = {
  ahead: (d) => `متقدم بـ ${formatWeight(Math.abs(d))} كجم`,
  on: () => 'على المسار تقريبًا',
  behind: (d) => `متأخر بـ ${formatWeight(Math.abs(d))} كجم`,
};

export function renderGoals(root) {
  async function draw() {
    const [{ plan, milestones }, entries, tol] = await Promise.all([
      getActivePlanWithMilestones(),
      getAllEntries(),
      getConfig('trajectoryToleranceKg'),
    ]);

    if (!plan) {
      root.replaceChildren(el('div', { className: 'route-view stack' }, [
        pageHead('أهداف الوزن'),
        emptyState({ icon: 'weight', title: 'لا توجد خطة هدف نشطة.', hint: 'حدّد وزن البداية والهدف لتتبّع تقدّمك.', actionLabel: 'إنشاء خطة هدف', onAction: () => openPlanEditor({ afterChange: draw }) }),
      ]));
      return;
    }

    const s = computeWeightSummary(entries, plan, milestones, { toleranceKg: tol });

    root.replaceChildren(el('div', { className: 'route-view stack' }, [
      pageHead(plan.name || 'أهداف الوزن', { sub: numericLTR(`${formatWeight(plan.startWeight)} → ${formatWeight(plan.finalWeight)} كجم`) }),
      statusPanel(s),
      milestonesSection(s),
      el('section', { className: 'section stack' }, [
        el('button', { className: 'btn btn-secondary btn-block', text: 'إنشاء مراحل تلقائيًا', onClick: () => openGeneratorSheet({ plan, milestones, summary: s, currentOfficial: currentOfficial(s), afterChange: draw }) }),
        el('button', { className: 'btn btn-secondary btn-block', text: 'تعديل الخطة', onClick: () => openPlanEditor({ existing: { plan, milestones }, afterChange: draw }) }),
        el('button', { className: 'btn btn-ghost btn-block', text: 'أرشفة الخطة', onClick: async () => { await archivePlan(plan.id); draw(); } }),
      ]),
    ]));
  }

  // Latest official weigh-in as generation context (factual; may be null).
  // Includes its own localDate so the generator can pair weight WITH its date.
  function currentOfficial(s) { return s.latest ? { weightKg: s.latest.weightKg, localDate: s.latest.localDate } : null; }

  function statusPanel(s) {
    const lines = [];
    if (s.trajectory && s.trajectory.status) {
      const tone = s.trajectory.status === 'ahead' ? 'down' : s.trajectory.status === 'behind' ? 'up' : 'flat';
      lines.push(statLine('المسار', trajectoryText[s.trajectory.status](s.trajectory.deltaKg), { tone }));
    }
    if (s.next) {
      lines.push(statLine(s.next.kind === 'final' ? 'الهدف النهائي' : 'الهدف القادم',
        numericLTR(`${formatWeight(s.next.targetWeight)} كجم${s.next.remainingKg != null ? ` • متبقٍ ${formatWeight(s.next.remainingKg)}` : ''}`)));
      if (s.next.targetDate) lines.push(statLine('التاريخ المستهدف', numericLTR(formatArabicDate(s.next.targetDate))));
    } else if (s.finalStatus?.reached) {
      lines.push(statLine('الحالة', 'تم الوصول إلى الهدف'));
    }
    const cap = s.next ? 'المتبقّي للهدف' : 'الهدف';
    const bigVal = s.next && s.next.remainingKg != null ? formatWeight(s.next.remainingKg) : formatWeight(pl(s));
    return el('div', { className: 'panel' }, [
      hero({ cap, value: bigVal, unit: 'كجم' }),
      lines.length ? el('div', { style: { marginTop: 'var(--s-3)' } }, lines) : null,
    ].filter(Boolean));
  }

  function pl(s) { return s.finalStatus ? s.finalStatus.targetWeight : 0; }

  function milestonesSection(s) {
    const ms = (s.milestones || []).filter((m) => !m.sameAsFinal);
    const total = ms.length + (s.finalStatus ? 1 : 0);
    if (!total) return el('div', {});
    const done = ms.filter((m) => m.reached).length + (s.finalStatus && s.finalStatus.reached ? 1 : 0);
    return el('section', { className: 'section' }, [
      el('div', { className: 'section-head' }, [
        el('h2', { text: 'المراحل' }),
        el('span', { className: 'aux num', text: `${done}/${total}` }),
      ]),
      milestoneTimeline(s),
    ]);
  }

  const unsub1 = on('goals:changed', draw);
  const unsub2 = on('weight:changed', draw);
  draw();
  return () => { unsub1(); unsub2(); };
}
