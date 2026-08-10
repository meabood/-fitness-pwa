# Architecture

One installable, offline-first PWA. Vanilla JS (native ES modules), no framework,
no bundler, no runtime third-party dependencies. Arabic, RTL, iPhone-first.
Personal data lives only in IndexedDB on the device.

## Locked decisions (from architecture review + approved adjustments)

- **Facts vs. derived.** Stores hold user-entered facts. Totals, moving averages,
  goal/milestone status, PRs, achievements, and charts are *derived* on demand
  from facts — never stored as the source of truth. Editing a fact re-derives
  dependents automatically (no manual "recalculate").
- **Historical immutability.** Logged records snapshot the values that existed
  at logging time (nutrition entries snapshot meal name/kcal/protein; workout
  sessions snapshot routine/day names; sets snapshot unit). Editing a
  library/template item never rewrites history, because history doesn't read it.
- **Date strategy.** Calendar day is a local `YYYY-MM-DD` string computed from
  local time (never `toISOString()`), so entries don't shift across midnight in
  UTC+3. `js/core/dates.js` is the only module that reads the clock.
- **IDs.** `crypto.randomUUID()` (with fallback) — permanent, opaque.
- **Schema versioning.** `js/core/db.js` runs ordered migrations and never
  deletes the database. The full v1 schema is created up front; later stages
  append migration steps only when the schema changes. **From Stage 2 on, the v1
  schema is immutable: any change must be a new non-destructive migration step
  appended to `MIGRATIONS`, never an edit to `v1`.**
- **Record shape vs schema.** v1 fixes object stores and indexes, not per-record
  fields (IndexedDB is schemaless per record). Adding a field to stored records —
  e.g. `workoutSessions.plannedExercises` (a snapshot of the day's exercises at
  start) — needs no migration and does not touch v1.
- **Persistent storage (adjustment #1).** Never auto-requested on startup. We
  passively check `persisted()`; the request is an explicit Settings button.
  It is a durability supplement, not a replacement for JSON backups.
- **Nutrition finals (adjustment #2).** Entries store `kcalPerServingSnapshot`,
  `proteinPerServingSnapshot` (nullable), `quantity`, **and** the recorded
  `finalCalories` / `finalProtein` (null when protein unknown — never 0).
- **PR cache keys (adjustment #3).** "Best reps at weight" uses a stable
  normalized `unit:milliUnits` key (`js/core/num.js#weightKey`), never a raw
  float. Raw `workoutSets` remain authoritative; the cache is rebuildable.
- **Charts.** Custom lightweight SVG (approved) → zero runtime dependencies.

## Module map (Stage 1 present in **bold**)

```
core/    db, ids, dates, dom, events, num, icons, storage, meta   ← all present
data/    settings.repo                                            ← present
         (meals, nutrition, weight, goals, exercises, routines,
          workouts repos arrive in later stages)
domain/  (pure calculators: weightStats, trajectory,
          weightAchievements, nutritionStats, gymRecords …)       ← later stages
features/ home, settings, placeholder(weight/nutrition/workout/stats)
```

## IndexedDB schema (v1, created now)

All entity stores and indexes are created in migration v1 so later stages consume
them without migrations. Notable: `weightEntries.isOfficial` is stored as `0/1`
(booleans aren't valid IndexedDB keys) to support the `[localDate, isOfficial]`
index; `workoutSets.localDate` is denormalized from its session to give a
`[exerciseId, localDate]` per-exercise history in one range query. `targetHistory`
exists from day one so per-date target comparison is possible later without a
history-rewriting migration.

## Stage tracker

- [x] **Stage 1** — shell, RTL nav, IndexedDB foundation + full v1 schema,
      Settings foundation, manifest, service worker, offline shell.
- [x] **Stage 2** — weight entry (quick + full), multiple daily measurements,
      the official-daily-weight invariant, previous-official comparison, history,
      and full editing/deletion. Home now shows today's official weight + change.
- [x] **Stage 3** — goal plans + milestones (validated, one active), goal
      trajectory (linear interpolation + tolerance band), 7-day trailing-calendar
      moving average, and dynamic weight achievements (new-lowest / milestone /
      final), with milestone-equals-final dedupe. Surfaced on Weight, Goals, Home.
- [ ] Stage 4 — meal library, nutrition entries, snapshots, day completion
- [x] **Stage 4** — Meal Library (CRUD, archive/restore, search), nutrition
      logging with snapshots + recorded `finalCalories`/`finalProtein` (unknown
      protein stays null), quantity scaling, one-time foods, daily totals vs the
      date's target, per-day completion state, and day navigation.
- [x] **Stage 5** — Exercise Library (CRUD, archive/restore, search, muscle/
      equipment filters), permanent exercise identity, and the exercise-detail
      foundation. Workout tab is now a hub linking to the library.
- [x] **Stage 6** — workout routines: routines (CRUD, duplicate, archive/restore)
      → ordered days (add/rename/delete/duplicate/reorder) → ordered exercise
      references (add/remove/replace/reorder/note). Removing an exercise from a
      routine never touches workout history.
- [x] **Stage 7** — workout sessions (snapshot routine/day names + planned
      exercise list at start), fast set logging (unit snapshot, warmup/working,
      optional RIR, prefill/duplicate/±reps), exercise memory (last working
      performance by permanent id — resumes after removal/return; separate
      machines stay separate), and full historical editing (date change cascades
      to the session's sets). Raw sets are authoritative.
- [x] **Stage 8** — dynamic personal records: Weight PR and Rep-PR-at-exact-weight,
      derived from raw working sets (warm-ups excluded, unit-scoped, per exercise
      id), with live ★ indicators, an end-of-workout achievement summary, and full
      historical recalculation on edit/delete/reclassify. First working set / first
      set at a weight is a baseline, not a ★.
- [x] **Stage 9** — statistics with a custom dependency-free SVG chart (no CDN/lib):
      weight (actual official points only + 7-day MA + dashed target trajectory +
      milestone markers), nutrition (calories/protein vs target, unlogged days are
      GAPS not zeros, averages over logged days only), and per-exercise progression
      (max working weight over time, one unit at a time — kg/lb never mixed). Range
      filter 7d/30d/3m/6m/1y/all. Pure transforms in domain/statsData.js.
- [x] **Stage 10** — full JSON backup export + restore. Pure serialize/validate/
      plan core. `validateBackup` is comprehensive: every store present as an array,
      per-store primary keys required, no duplicate keys, required field types per
      factual store, and INTERNAL referential integrity (milestones→goalPlans,
      routineDays→routines, routineExercises→routineDays/exercises, workoutSets→
      sessions/exercises, nutritionEntries.sourceMealId→meals when non-null) — an
      orphaned or malformed record is rejected before any clear/write, so Replace
      can never clear data for an invalid file. Replace clears each store's RECORDS
      in one transaction and restores fully (never deletes the DB/schema). Merge is
      relationally validated (`planMerge`: rejects conflicting collisions and
      post-merge orphans) then re-normalizes the weight invariant. `exerciseStats`
      is derived — cleared on Replace and never restored from the backup as factual
      (raw workoutSets stay authoritative). Download via local Blob URL (no network).
- [ ] Stage 11 — performance + long-history + migration testing
- [ ] Stage 12 — security audit, offline test, backup round-trip, SECURITY.md

## UI/UX design system (v0.8.0)

The application received a full presentation pass over the frozen Stage 1–10
engine. No schema, migration, repository, or calculation was changed; every
value shown is still derived on demand from the authoritative records.

**Design language.** Light, calm, typography-led ("data-rich, visually quiet").
One restrained accent plus neutrals; numbers are the visual anchors (hero
metrics). Tokens live in `styles/tokens.css`; shared components in
`styles/components.css`.

**Shared helpers** (`js/core/ui.js`): `pageHead`, `segmented`, `chips`, `hero`,
`progress`, `statLine`, `emptyState`, and a dependency-free inline `sparkline`.
These encode the one visual language reused across every screen, keeping the
vanilla-JS architecture (no framework, no build step).

**Navigation.** Five primary tabs (الرئيسية/التغذية/الوزن/التمارين/الإحصائيات);
Settings is secondary (header gear). The header is a three-slot bar
(back · title · gear); child routes declare a `parent` for back navigation. The
back affordance is a right-pointing chevron — the correct "back" direction in
RTL — so it is never mirrored. Drill-in rows use a left-pointing `‹`.

**Muscle visualization** (`js/domain/muscleMap.js` + `js/core/bodyMap.js`).
A local, offline SVG front/back silhouette highlights broad regions for a
routine/day. Mapping is a documented *heuristic*: the exercise `muscleGroup`
field is free text, so `groupToRegion` keyword-matches Arabic/Latin cues to broad
regions only (chest, back, shoulders, biceps, triceps, forearms, core, glutes,
quads, hamstrings, calves). It infers **no** activation percentages and modifies
**no** stored data; unclassifiable groups are left unmapped rather than guessed.
Primary vs secondary emphasis is a presentation heuristic based on how many of a
day's exercises hit a region. It updates automatically as a routine/day changes.

**Consumption vs editing.** Routines, the Exercise Library, and the Meal Library
show management controls only when an explicit "تحرير" (edit) mode is entered.
Normal browsing stays clean.

**Accessibility / RTL / mobile.** Tabular-lining numerals via `.num`; touch
targets ≥44px; `aria-label`s on icon-only controls; status never by color alone
(★ + text tags for PRs, done/○ for milestones); `prefers-reduced-motion`
respected; safe-area insets on header, main padding, bottom nav, and sheets.
Charts keep a sparse-data guard (a clear message instead of a misleading line).

**Convenience without corrupting facts.** "Duplicate last set" and prefilled
inputs never mark a set as performed — only an explicit add/save writes a record,
and weight prefill respects the exercise's unit (never coerces kg↔lb).
