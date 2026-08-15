// settings/settings.js — Settings foundation (Stage 1).
// Functional now: daily calorie target, optional protein target, default units,
// persistent-storage status/opt-in, privacy summary, app info, backup reminder.
// Backup export/restore is wired to a placeholder until Stage 10.

import { el, toast } from '../../core/dom.js';
import { openSheet } from '../../core/sheet.js';
import {
  getConfig, setConfig, getCurrentTarget, setTarget,
} from '../../data/settings.repo.js';
import { exportBackup, downloadBackup, importBackup, validateBackup } from '../../data/backup.js';
import { isPersisted, requestPersist, estimate, storageSupported } from '../../core/storage.js';
import { SCHEMA_VERSION } from '../../core/db.js';
import { APP_VERSION } from '../../core/meta.js';
import { pageHead, segmented } from '../../core/ui.js';

export async function renderSettings(root, ctx = {}) {
  const navigate = ctx.navigate || (() => {});
  // Load current values up front.
  const [calorieTarget, proteinTarget, weightUnit, exerciseUnit, restBetween, restAfter, persisted, est] =
    await Promise.all([
      getCurrentTarget('calorie'),
      getCurrentTarget('protein'),
      getConfig('defaultWeightUnit'),
      getConfig('defaultExerciseUnit'),
      getConfig('restBetweenSetsDefault'),
      getConfig('restAfterExerciseDefault'),
      isPersisted(),
      estimate(),
    ]);

  const view = el('div', { className: 'route-view stack' }, [
    pageHead('الإعدادات'),

    // ---- Targets ----
    section('الأهداف اليومية', [
      numberField({
        id: 'calorieTarget', label: 'هدف السعرات (سعرة/اليوم)',
        value: calorieTarget, placeholder: 'مثال: 2235',
        hint: 'يُستخدم لعرض المتبقّي. تغييره لا يغيّر السجلّ التاريخي.',
        onSave: async (v) => { await setTarget('calorie', v); toast('تم حفظ هدف السعرات'); },
        allowClear: false,
      }),
      numberField({
        id: 'proteinTarget', label: 'هدف البروتين (جم/اليوم) — اختياري',
        value: proteinTarget, placeholder: 'اتركه فارغًا لإخفاء المقارنة',
        hint: 'اختياري. بدون هدف، يُعرض البروتين المستهلك فقط.',
        onSave: async (v) => { await setTarget('protein', v); toast(v == null ? 'تم مسح هدف البروتين' : 'تم حفظ هدف البروتين'); },
        allowClear: true,
      }),
    ]),

    // ---- Units ----
    section('الوحدات', [
      segmentField({
        label: 'وحدة الوزن الافتراضية', value: weightUnit, options: ['kg', 'lb'],
        onChange: async (v) => { await setConfig('defaultWeightUnit', v); toast('تم الحفظ'); },
      }),
      segmentField({
        label: 'وحدة التمارين الافتراضية', value: exerciseUnit, options: ['kg', 'lb'],
        onChange: async (v) => { await setConfig('defaultExerciseUnit', v); toast('تم الحفظ'); },
      }),
    ]),

    // ---- Workout logging (rest defaults) ----
    section('تسجيل التمرين', [
      numberField({
        id: 'restBetween', label: 'راحة بين المجموعات (ثانية)', value: restBetween,
        placeholder: '90', hint: 'تُستخدم افتراضيًا ما لم يُحدَّد وقت خاص للتمرين في البرنامج.', allowClear: true,
        onSave: async (v) => { await setConfig('restBetweenSetsDefault', v === null ? null : v); toast('تم الحفظ'); },
      }),
      numberField({
        id: 'restAfter', label: 'راحة بعد التمرين (ثانية)', value: restAfter,
        placeholder: '120', hint: 'راحة أطول عند الانتقال إلى التمرين التالي.', allowClear: true,
        onSave: async (v) => { await setConfig('restAfterExerciseDefault', v === null ? null : v); toast('تم الحفظ'); },
      }),
    ]),

    // ---- Goals ----
    section('الأهداف', [
      el('div', { className: 'list' }, [
        rowButton('إدارة أهداف الوزن', () => navigate('goals')),
      ]),
    ]),

    // ---- Backup ----
    section('النسخ الاحتياطي', [
      el('div', { className: 'list' }, [
        rowButton('تصدير نسخة احتياطية (JSON)', async () => {
          try { const data = await exportBackup(); downloadBackup(data); toast('تم إنشاء ملف النسخة'); }
          catch (e) { toast('تعذّر التصدير'); }
        }),
        rowButton('استعادة من نسخة احتياطية', () => openRestoreFlow()),
      ]),
      el('div', { className: 'notice', text:
        'التصدير يحفظ نسخة كاملة من بياناتك في ملف على جهازك. عند الاستعادة: «استبدال كامل» يستبدل بياناتك الحالية بالكامل بمحتوى الملف، و«دمج آمن» يضيف الجديد فقط وقد يرفض الملف إذا تعارضت بياناته مع الموجود. بياناتك محفوظة محليًا فقط؛ خذ نسخة دوريًا.' }),
    ]),

    // ---- Durability / persistent storage ----
    section('المتانة والتخزين', [
      el('div', { className: 'list' }, [
        infoRow('التخزين الدائم', persisted ? 'مُفعّل' : (storageSupported() ? 'غير مُفعّل' : 'غير مدعوم')),
        est ? infoRow('المساحة المستخدمة', formatBytes(est.usage)) : null,
      ].filter(Boolean)),
      !persisted && storageSupported()
        ? el('button', {
            className: 'btn btn-secondary btn-block', text: 'طلب تفعيل التخزين الدائم',
            onClick: async (e) => {
              const ok = await requestPersist();
              toast(ok ? 'تم تفعيل التخزين الدائم' : 'لم يُفعّل — استمرّ في أخذ نسخ احتياطية');
              if (ok) e.target.remove();
            },
          })
        : null,
      el('div', { className: 'notice', text:
        'التخزين الدائم إجراء متانة إضافي فقط، وليس بديلًا عن النسخ الاحتياطية اليدوية.' }),
    ].filter(Boolean)),

    // ---- Privacy & security ----
    section('الخصوصية والأمان', [
      el('div', { className: 'list' }, [
        infoRow('خدمات خارجية', 'لا'),
        infoRow('تحليلات أو تتبّع', 'لا'),
        infoRow('مزامنة سحابية', 'لا'),
        infoRow('إرسال بيانات شخصية', 'لا'),
        infoRow('مكان تخزين البيانات', 'محليًا (IndexedDB)'),
      ]),
    ]),

    // ---- App info ----
    section('عن التطبيق', [
      el('div', { className: 'list' }, [
        infoRow('إصدار التطبيق', APP_VERSION),
        infoRow('إصدار قاعدة البيانات', `v${SCHEMA_VERSION}`),
      ]),
    ]),
  ]);

  root.replaceChildren(view);

  // ---- Restore flow: pick file → validate → choose mode (with warning) → apply ----
  function openRestoreFlow() {
    const fileInput = el('input', { type: 'file', accept: 'application/json,.json', style: { display: 'none' } });
    const body = el('div', { className: 'stack' }, [
      el('p', { text: 'اختر ملف نسخة احتياطية (JSON) سبق تصديره من التطبيق.' }),
      el('button', { className: 'btn btn-secondary btn-block', text: 'اختيار ملف', onClick: () => fileInput.click() }),
      el('div', { className: 'notice', text: 'يُنصح بشدة بتصدير نسخة احتياطية حالية قبل الاستعادة.' }),
      fileInput,
    ]);
    const handle = openSheet({ title: 'استعادة من نسخة احتياطية', body });

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      let obj;
      try { obj = JSON.parse(await file.text()); }
      catch { body.replaceChildren(el('div', { className: 'notice', style: { color: 'var(--neg)' }, text: 'الملف ليس JSON صالحًا.' })); return; }
      const v = validateBackup(obj);
      if (!v.ok) {
        body.replaceChildren(el('div', { className: 'notice', style: { color: 'var(--neg)' } }, [el('div', { text: 'الملف غير صالح للاستعادة:' }), ...v.errors.map((e) => el('div', { text: `• ${e}` }))]));
        return;
      }
      const counts = Object.entries(obj.data).reduce((n, [, arr]) => n + (Array.isArray(arr) ? arr.length : 0), 0);
      body.replaceChildren(el('div', { className: 'stack' }, [
        el('div', { className: 'notice', text: `ملف صالح • ${counts} سجل • من ${String(obj.exportTimestamp || '').slice(0, 10)}` }),
        el('p', { text: 'اختر طريقة الاستعادة:' }),
        el('button', {
          className: 'btn btn-danger btn-block', text: 'استبدال كامل (يمسح البيانات الحالية)',
          onClick: (ev) => {
            const confirm = el('button', {
              className: 'btn btn-danger btn-block',
              text: 'تأكيد الاستبدال الكامل — لا يمكن التراجع',
              onClick: async () => { await doImport(obj, 'replace', handle); },
            });
            ev.currentTarget.replaceWith(confirm);
          },
        }),
        el('p', { className: 'hint', text: 'الاستبدال يمسح السجلات الحالية ويستعيد محتوى الملف بالكامل. هذا الخيار هو الأكثر موثوقية.' }),
        el('button', {
          className: 'btn btn-secondary btn-block', text: 'دمج آمن (إضافة الجديد فقط)',
          onClick: async () => { await doImport(obj, 'merge', handle); },
        }),
        el('p', { className: 'hint', text: 'الدمج يضيف السجلات غير الموجودة فقط ولا يعدّل الموجود.' }),
      ]));
    });
  }

  async function doImport(obj, mode, handle) {
    try {
      const res = await importBackup(obj, { mode });
      const total = Object.values(res.counts).reduce((a, b) => a + b, 0);
      toast(mode === 'replace' ? `تمت الاستعادة (${total} سجل)` : 'تم الدمج');
      handle.close();
      renderSettings(root, ctx); // re-render with restored values
    } catch (e) {
      toast((e.errors && e.errors[0]) || 'تعذّرت الاستعادة');
    }
  }
}

// ---- small builders ----

function section(title, children) {
  return el('section', { className: 'section' }, [
    el('div', { className: 'section-head' }, [el('h2', { text: title })]),
    el('div', { className: 'stack' }, children),
  ]);
}

function numberField({ id, label, value, placeholder, hint, onSave, allowClear }) {
  const input = el('input', {
    id, className: 'input num', type: 'number', inputmode: 'decimal',
    placeholder: placeholder || '', value: value != null ? String(value) : '',
  });
  const save = async () => {
    const raw = input.value.trim();
    if (raw === '') {
      if (allowClear) { await onSave(null); }
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) { toast('قيمة غير صالحة'); return; }
    await onSave(n);
  };
  input.addEventListener('change', save);
  input.addEventListener('blur', save);
  return el('div', { className: 'field' }, [
    el('label', { attrs: { for: id }, text: label }),
    input,
    hint ? el('p', { className: 'hint', text: hint }) : null,
  ].filter(Boolean));
}

function segmentField({ label, value, options, onChange }) {
  let cur = value;
  const wrap = el('div', {});
  const build = () => wrap.replaceChildren(segmented(
    options.map((o) => ({ key: o, label: o.toUpperCase() })), cur,
    async (v) => { cur = v; build(); await onChange(v); },
  ));
  build();
  return el('div', { className: 'field' }, [el('label', { text: label }), wrap]);
}

function infoRow(label, value) {
  return el('div', { className: 'row' }, [
    el('div', { className: 'row-label', text: label }),
    el('div', { className: 'row-value num', text: value }),
  ]);
}

function rowButton(label, onClick) {
  return el('button', { className: 'row', onClick }, [
    el('div', { className: 'row-label', text: label }),
    el('div', { className: 'chev', text: '‹' }), // RTL chevron
  ]);
}

function formatBytes(n) {
  if (n == null) return '—';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}
