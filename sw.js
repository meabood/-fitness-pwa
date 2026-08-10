// sw.js — minimal, safe service worker.
//
// Purpose (Part 1/3): app-shell caching + offline availability + safe static
// updates. It caches ONLY the app's own static assets. It never handles or
// caches personal data (all personal data lives in IndexedDB and never transits
// the network). Updating assets deletes only OLD STATIC caches — the service
// worker never touches IndexedDB, so updates can't erase history.

// Bump this string on each release to publish new assets. Old caches keyed by a
// previous version are removed on activate.
const CACHE = 'fitness-shell-v0.10.1';

// The app shell: static files required to boot offline.
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './styles/tokens.css',
  './styles/base.css',
  './styles/components.css',
  './js/app.js',
  './js/core/meta.js',
  './js/core/db.js',
  './js/core/ids.js',
  './js/core/dates.js',
  './js/core/dom.js',
  './js/core/events.js',
  './js/core/num.js',
  './js/core/icons.js',
  './js/core/storage.js',
  './js/core/sheet.js',
  './js/core/ui.js',
  './js/core/bodyMap.js',
  './js/domain/muscleMap.js',
  './js/domain/weightStats.js',
  './js/data/settings.repo.js',
  './js/data/weight.repo.js',
  './js/features/home/home.js',
  './js/features/settings/settings.js',
  './js/features/weight/weight.js',
  './js/features/weight/weightSheets.js',
  './js/domain/trajectory.js',
  './js/domain/weightAchievements.js',
  './js/domain/goalValidation.js',
  './js/data/goals.repo.js',
  './js/features/goals/goals.js',
  './js/features/goals/goalSheets.js',
  './js/domain/nutritionStats.js',
  './js/data/meals.repo.js',
  './js/data/nutrition.repo.js',
  './js/data/exercises.repo.js',
  './js/data/builtinExercises.js',
  './js/features/nutrition/nutrition.js',
  './js/features/nutrition/nutritionSheets.js',
  './js/features/meals/meals.js',
  './js/features/meals/mealSheets.js',
  './js/features/workout/workout.js',
  './js/features/exercises/exercises.js',
  './js/features/exercises/exerciseSheets.js',
  './js/features/exercises/exerciseDetail.js',
  './js/domain/workoutMemory.js',
  './js/domain/gymRecords.js',
  './js/core/svgChart.js',
  './js/domain/statsData.js',
  './js/data/backup.js',
  './js/features/stats/stats.js',
  './js/data/routines.repo.js',
  './js/data/workouts.repo.js',
  './js/features/exercises/exercisePicker.js',
  './js/features/routines/routines.js',
  './js/features/routines/routineEditor.js',
  './js/features/workout/session.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('fitness-shell-') && k !== CACHE)
            .map((k) => caches.delete(k)) // delete only old STATIC caches
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle same-origin GET navigations/assets. Everything else is ignored
  // (there are no cross-origin or non-GET app requests by design).
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigation requests: serve the cached shell so the SPA boots offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then((cached) => cached || fetch(req))
    );
    return;
  }

  // Static assets: cache-first, fall back to network, then cache the response.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        // Cache successful same-origin responses for future offline use.
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => cached); // offline and uncached: let it fail gracefully
    })
  );
});
