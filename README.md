# اللياقة — private fitness & health tracker (PWA)

A private, offline-first personal tracker for weight, nutrition, and gym — one
installable PWA, Arabic/RTL, iPhone-first. No backend, no accounts, no network
transmission of personal data. Everything lives locally in IndexedDB.

**Status: Full UI/UX polish (v0.8.0) — over the approved Stage 1–10 engine.**
A cohesive, iPhone-first presentation pass: a calm, typography-led design language
("data-rich, visually quiet"), a Home dashboard with three glanceable regions, a
fast one-handed workout logger (dominant weight×reps, scannable previous
performance, subtle PR ★), a local offline SVG muscle visualization for routines,
a progress-journey Weight screen, personal fast Nutrition with quantity chips, a
focused Exercise Detail with unit-safe progression, segmented Statistics with
sparse-data guards, and clearer Backup/Restore language — all with honest empty/
unknown/unlogged states, RTL-correct navigation, safe-area handling, and
accessibility (touch targets, labels, status-not-by-color-alone, reduced motion).
No schema, calculation, or backup semantics changed; the Stage 1–10 engine is
frozen. Performance/long-history and the security/offline audit remain (Stages
11–12). See `docs/ARCHITECTURE.md` for the design-system notes and tracker.

## Run

ES modules + a service worker require an origin — `file://` won't work.

```
python3 -m http.server 8000
# open http://localhost:8000/
```

On iPhone: serve over your LAN/HTTPS, open in Safari, then **Share → Add to Home
Screen**.

## What works in Stage 1

- Boots to a Home screen with today's date and action-oriented empty states
  (no fabricated numbers).
- Bottom navigation across Home / Nutrition / Weight / Workout / Stats, plus a
  Settings screen via the gear icon.
- Settings: daily calorie target, optional protein target (kept in a
  target-history store), default weight/exercise units, persistent-storage
  status + opt-in, privacy summary, app/DB version, and a backup reminder.
- Fully local IndexedDB with versioned migrations that never wipe data.

## Docs

- `docs/ARCHITECTURE.md` — locked decisions, schema, stage tracker
- `docs/TESTING.md` — how to run + Stage 1 acceptance + offline test
- `docs/SECURITY.md` — interim security posture (full audit at Stage 12)

## Backups

Because storage is local, export a JSON backup periodically (arrives in Stage
10). Persistent storage is only an extra durability measure, never a substitute
for backups.
