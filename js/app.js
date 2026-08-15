// app.js — application bootstrap: hash router, bottom navigation, header, and
// service-worker registration. Keeps global state minimal (just the current
// route). No framework, native ES modules.

import { el } from './core/dom.js';
import { ICONS } from './core/icons.js';
import { openDB } from './core/db.js';
import { seedBuiltinExercises } from './data/exercises.repo.js';
import { renderHome } from './features/home/home.js';
import { renderWeight } from './features/weight/weight.js';
import { renderGoals } from './features/goals/goals.js';
import { renderNutrition } from './features/nutrition/nutrition.js';
import { renderMeals } from './features/meals/meals.js';
import { renderWorkout } from './features/workout/workout.js';
import { renderRoutines } from './features/routines/routines.js';
import { renderRoutineEditor } from './features/routines/routineEditor.js';
import { renderSession } from './features/workout/session.js';
import { renderStartWorkout } from './features/workout/startWorkout.js';
import { renderExercises } from './features/exercises/exercises.js';
import { renderExerciseDetail } from './features/exercises/exerciseDetail.js';
import { renderStats } from './features/stats/stats.js';
import { renderSettings } from './features/settings/settings.js';
import { APP_VERSION } from './core/meta.js';

// Route table. `nav: true` => appears in the bottom bar.
// A render fn receives (root, ctx) where ctx = { navigate, param }, and may
// return a cleanup function (called before the next route renders).
const ROUTES = {
  home:      { title: 'الرئيسية',   icon: 'home',      nav: true,  render: (root, ctx) => renderHome(root, ctx) },
  nutrition: { title: 'التغذية',     icon: 'nutrition', nav: true,  render: (root, ctx) => renderNutrition(root, ctx) },
  meals:     { title: 'مكتبة الوجبات', icon: 'nutrition', nav: false, parent: 'nutrition', render: (root, ctx) => renderMeals(root, ctx) },
  weight:    { title: 'الوزن',       icon: 'weight',    nav: true,  render: (root, ctx) => renderWeight(root, ctx) },
  goals:     { title: 'أهداف الوزن', icon: 'weight',    nav: false, parent: 'weight', render: (root) => renderGoals(root) },
  workout:   { title: 'التمارين',    icon: 'workout',   nav: true,  render: (root, ctx) => renderWorkout(root, ctx) },
  routines:  { title: 'البرامج',     icon: 'workout',   nav: false, parent: 'workout', render: (root, ctx) => renderRoutines(root, ctx) },
  routine:   { title: 'برنامج',      icon: 'workout',   nav: false, parent: 'routines', render: (root, ctx) => renderRoutineEditor(root, ctx) },
  session:   { title: 'جلسة',        icon: 'workout',   nav: false, parent: 'workout', render: (root, ctx) => renderSession(root, ctx) },
  start:     { title: 'ابدأ التمرين', icon: 'workout',   nav: false, parent: 'workout', render: (root, ctx) => renderStartWorkout(root, ctx) },
  exercises: { title: 'مكتبة التمارين', icon: 'workout', nav: false, parent: 'workout', render: (root, ctx) => renderExercises(root, ctx) },
  exercise:  { title: 'تمرين',       icon: 'workout',   nav: false, parent: 'exercises', render: (root, ctx) => renderExerciseDetail(root, ctx) },
  stats:     { title: 'الإحصائيات',  icon: 'stats',     nav: true,  render: (root, ctx) => renderStats(root, ctx) },
  settings:  { title: 'الإعدادات',   icon: 'settings',  nav: false, parent: 'home', render: (root, ctx) => renderSettings(root, ctx) },
};
const DEFAULT_ROUTE = 'home';

let mainEl, navEl, titleEl, leadEl, trailEl;
let activeCleanup = null; // teardown for the currently mounted route (if any)

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [key, param] = raw.split('/');
  return { key: ROUTES[key] ? key : DEFAULT_ROUTE, param: param ? decodeURIComponent(param) : null };
}

function currentRoute() {
  return parseHash().key;
}

export function navigate(key, param) {
  if (!ROUTES[key]) key = DEFAULT_ROUTE;
  const target = param != null ? `#/${key}/${encodeURIComponent(param)}` : `#/${key}`;
  if (location.hash === target) { renderRoute(); return; }
  location.hash = target;
}

async function renderRoute() {
  const { key, param } = parseHash();
  const route = ROUTES[key];
  titleEl.textContent = route.title;

  // Header leading control: back chevron on child routes, else nothing.
  // Trailing control: settings gear on primary (nav) routes only.
  const parent = route.parent;
  leadEl.replaceChildren(parent
    ? el('button', { className: 'header-back', attrs: { 'aria-label': 'رجوع' }, html: ICONS.chevron, onClick: () => navigate(parent) })
    : el('span', { style: { width: 'var(--tap)' } }));
  trailEl.replaceChildren(route.nav
    ? el('button', { className: 'header-btn', attrs: { 'aria-label': 'الإعدادات' }, html: ICONS.settings, onClick: () => navigate('settings') })
    : el('span', { style: { width: 'var(--tap)' } }));

  // Tear down the previous route so its listeners can't redraw over this one.
  if (activeCleanup) { try { activeCleanup(); } catch (_) {} activeCleanup = null; }

  // Update active nav state (detail routes highlight their parent tab where sensible).
  const navKey = route.nav ? key : (ROUTES[parent] && ROUTES[parent].nav ? parent : (parent === 'home' ? 'home' : key));
  navEl.querySelectorAll('.nav-item').forEach((btn) => {
    if (btn.dataset.route === navKey) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });

  // Render (render fns may be async and may return a cleanup function).
  try {
    const maybeCleanup = await route.render(mainEl, { navigate, param });
    if (typeof maybeCleanup === 'function') activeCleanup = maybeCleanup;
  } catch (err) {
    console.error('render failed', err);
    mainEl.replaceChildren(el('div', { className: 'notice', text: 'حدث خطأ أثناء عرض الشاشة.' }));
  }
  mainEl.scrollTo?.(0, 0);
  window.scrollTo(0, 0);
}

function buildShell() {
  const app = document.getElementById('app');

  // Header: leading (back) · title · trailing (settings gear on primary routes).
  titleEl = el('h1', { text: ROUTES[DEFAULT_ROUTE].title });
  leadEl = el('div', { className: 'header-lead' });
  trailEl = el('div', { className: 'header-trail' });
  const header = el('header', { className: 'app-header' }, [leadEl, titleEl, trailEl]);

  // Main mount point.
  mainEl = el('main', { className: 'app-main', id: 'main' });

  // Bottom navigation (nav routes only).
  navEl = el('nav', { className: 'app-nav', attrs: { 'aria-label': 'التنقل الرئيسي' } },
    Object.entries(ROUTES).filter(([, r]) => r.nav).map(([key, r]) =>
      el('button', {
        className: 'nav-item', dataset: { route: key },
        attrs: { 'aria-label': r.title },
        onClick: () => navigate(key),
      }, [
        el('span', { className: 'nav-ico', html: ICONS[r.icon] }),
        el('span', { text: r.title }),
      ])));

  app.replaceChildren(header, mainEl, navEl);
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('./sw.js', { scope: './' });
  } catch (err) {
    console.warn('SW registration failed (app still works online):', err);
  }
}

async function main() {
  buildShell();
  window.addEventListener('hashchange', renderRoute);

  // Open the DB early so schema/migrations run before any screen queries.
  try {
    await openDB();
  } catch (err) {
    console.error('DB open failed', err);
    mainEl.replaceChildren(el('div', { className: 'notice', text:
      'تعذّر فتح قاعدة البيانات المحلية. تأكّد أن المتصفح يسمح بتخزين البيانات.' }));
    return;
  }

  // Seed the built-in starter library idempotently (additive; never touches
  // user exercises or history). Non-fatal if it fails.
  try {
    await seedBuiltinExercises();
  } catch (err) {
    console.error('seed builtins failed', err);
  }

  await renderRoute();
  registerServiceWorker(); // non-blocking
}

main();
