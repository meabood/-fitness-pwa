# LOCKD — private fitness & health tracker (PWA)

A private, offline-first personal tracker for weight, nutrition, and gym — one
installable PWA, Arabic/RTL, iPhone-first. No backend, no accounts, no network
transmission of personal data. Everything lives locally in IndexedDB.

**Status: LOCKD identity + v0.16 completion (v0.16.2).** The product is now branded LOCKD (manifest, titles, APP_NAME) with a new minimal abstract-L app icon; persistent data identifiers are unchanged so installed data upgrades in place. Manual nutrition logging now matches the library flow (name + per-serving nutrition -> quantity -> live total -> Add, with secondary metadata disclosed and unknown protein preserved). The active workout set grid drops the redundant previous-performance column (kept only as the compact آخر مرة line) while preserving historical prefill, warm-ups, PRs, units, swipe-delete + Undo, and rest. Built over the approved Stage 1-10 engine.** Corrects two missing numericLTR imports that broke the live-total and previous-performance code paths, fixes swipe-to-delete so it reveals correctly in this RTL app, and removes a duplicate legacy .stepper CSS block that restyled the new quantity control. Product name centralized in meta.js (still "اللياقة" pending a chosen brand). Built on the v0.16.0 Nutrition + Workout UX pass over the approved Stage 1-10 engine.** High-frequency logging made dominant and fast: scannable nutrition rows with swipe-to-delete + Undo, a quantity stepper with live totals, progressive disclosure for secondary details, and a clear logged-entry vs Meal-Library-definition distinction. The active workout surfaces a compact "last time" line, swipe-to-delete sets with Undo, and a contextual sticky rest banner; delete is demoted from red buttons to swipe/link everywhere. Shared UI primitives (stepper/disclosure/swipeRow) unify Nutrition and Workout. The Home week card now scopes strictly to the Saturday week (honest empty state, renamed "first measurement this week"). All domain semantics preserved. Built over the approved Stage 1-10 engine.** The auto-generator now pairs its default start weight with that measurement own date (never a stale plan-start date), detects when a generated schedule needs a later final date and offers to extend it in one safe atomic commit (validator unchanged, never silently shortened), and Home replaces the redundant expected/actual box with a compact factual "this week" summary (week starts Saturday, nothing stored). The approved v0.15.0 horizontal scrollable milestone timeline is unchanged. Built over the approved Stage 1-10 engine.** Milestones now render as one shared horizontal, horizontally-scrollable timeline (Home compact, Weight, Goals) that never compresses labels — fixed min-width nodes with overflow scroll, RTL-safe auto-focus on the current milestone, restrained done/current/future/final states. A new "إنشاء مراحل تلقائيًا" generator builds the between-checkpoints sequence from start/final/step/frequency/date (prefilled from factual context), previews before saving, and commits atomically via the existing updatePlan with explicit add/replace-planned/cancel handling that preserves achieved milestones. Built over the approved Stage 1-10 engine.** Monthly calendar atop Statistics with data-exists dots and a unified Day Summary/history list; month arrows follow the app RTL convention (prev ›, next ‹) and opening Weight from a day preserves that date. Built over the approved Stage 1-10 engine.** Statistics now opens with a monthly calendar at the top (Saturday-first, restrained data-exists dots for nutrition/workout/weight), with the existing charts directly below. Tapping a day opens a unified Day Summary (nutrition totals with unknown-protein preserved, all same-day workouts with authoritative duration, official-weight-aware body weight) that links into the existing Nutrition/Session/Weight screens; a subtle "عرض السجل" opens a full newest-first history list using the same Day Summary. Month aggregation uses three bounded localDate index queries (no per-cell scans); grouping is by localDate (no UTC). Built on v0.13.2 over the approved Stage 1-10 engine.** Legacy completed workouts no longer accrue wall-clock time (duration derived from completedAt / clock end−start, never now()); legacy multiple-active sessions are detected with a non-destructive resolution banner; the Workout Hub uses the authoritative getActiveSession; unsaved-change protection now covers add-nutrition, add-weight, meal create/edit, exercise create/edit, and routine rename; the pre-restore safety backup has a distinguishable filename; and same-day earlier weights are valid outlier references. Built on v0.13.1 over the approved Stage 1-10 engine.** Post-audit fixes: one coherent workout-duration model (resume-after-finish no longer counts the idle gap; corrected duration is the live base; paused time excluded; survives reload), reopen safeguard wired, one-active-workout invariant enforced at the repo boundary, meal permanent-delete blocked when referenced (archive instead), safety-backup-before-replace no longer fails silently, historical add-set without reactivating, chronological body-weight outlier reference, stale-workout direct duration edit, same-session wrong-day change, empty-finish protection, unsaved-change guard, active-routine-filtered next-day suggestion, and session-swap rest preservation. Built on v0.13.0 over the approved Stage 1-10 engine.** Active routine + next-day suggestion, stale-workout recovery, pause/resume and editable workout duration, accidental-finish protection, resume-without-duplicate, Undo for set/entry/exercise deletions and set logging, wrong-day recovery, conservative weight/load typo guards, and backup safety (last-backup shown + auto safety snapshot before a full restore). Pure logic in domain/recovery.js; additive fields only. Built on the v0.12.1 baseline over the approved Stage 1-10 engine.** The rest countdown is persisted on the session record as a timestamp (restEndsAt/restKind), surviving reload and PWA relaunch (remaining derived from the clock; +30/Skip/finish handled; old sessions stay valid). Saving a historical nutrition entry to the Meal Library records the entry's sourceMealId via a snapshot-safe helper, preventing duplicate saves without altering any factual snapshot. Built on the v0.12.0 configurable-rest baseline over the approved Stage 1-10 engine.**
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
