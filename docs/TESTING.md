# Testing & running

## Why a local server is needed

The app uses ES modules and a service worker. Both require an **origin**
(`http://` or `https://`) — opening `index.html` via `file://` will not work.

## Run locally

From the project folder, start any static server on the origin root, e.g.:

```
python3 -m http.server 8000
```

Then open `http://localhost:8000/` in a browser. For iPhone testing, serve over
your LAN (or a tunnel) and open the LAN URL on the phone; use **Share → Add to
Home Screen** to install. Service workers require HTTPS on non-localhost origins.

## Automated checks (run in the container during Stage 1)

- Syntax check of every JS module (`node --check`) — pass.
- Pure-logic tests for `dates.js`, `num.js`, `ids.js` — pass (17 assertions),
  including local-date no-UTC-shift, `trailingWindow`, and the stable
  `weightKey` normalization (`0.1+0.2 → kg:300`, unit-scoped, round-trips).
- Precache manifest cross-checked against real files — all 24 assets exist.

## Stage 1 manual acceptance

1. App boots to Home with today's Arabic date; layout is RTL.
2. Bottom nav switches between الرئيسية / التغذية / الوزن / التمارين / الإحصائيات;
   the active tab is highlighted.
3. Gear icon opens الإعدادات.
4. In Settings: set a calorie target, set/clear the optional protein target,
   toggle default weight/exercise units — each shows a "saved" toast and the
   value persists across a reload (stored in IndexedDB).
5. Reopen the app — the DB is **not** reset; settings remain.
6. Privacy/security and app-info rows display; DB version shows `v1`.
7. Persistent-storage status shows, with an opt-in button when not yet granted.
   Startup never prompts for it automatically.

## Stage 2 acceptance (weight)

Pure logic (run in container, 20 assertions, all pass): the official-daily-weight
invariant via `chooseOfficialId` (sole-entry auto-official; promote clears
siblings — Part 2 Test 3; collapse duplicate officials; promote-latest after the
official is deleted), previous-official comparison that skips missing days
(Tuesday→Saturday, −0.4), timeline sorting, and newest-first history deltas.

Corrected behaviors (explicitly tested):
- **Added-measurement default (Fix 1).** A date's first measurement defaults to
  official; adding a measurement to a date that already has an official defaults
  it **non-official** (`defaultNewMeasurementOfficial`, `addOfficialPreference`),
  so a later entry never silently replaces the day's official. The user may opt in.
- **Moving an official entry (Fix 2).** Changing an entry's date does not carry
  its old official flag over (`moveOfficialDecision`): the moved entry arrives
  non-official and the destination's existing official is preserved, unless the
  destination has none (then the invariant promotes it) or the user explicitly
  promotes it. The old date re-normalizes after the entry leaves.

Manual (browser) checks:
1. Quick-add today's weight → it becomes today's official; Home and the Weight
   summary show it with the change vs the previous official.
2. Add a second measurement for today via "تاريخ آخر…"/day sheet → only one
   entry is marked رسمي; promoting another moves the رسمي tag and updates all
   comparisons/charts immediately (no reload).
3. Edit an old official weight → history deltas, the summary, and Home update
   automatically; nutrition/gym are untouched.
4. Delete the official measurement of a day that has others → another becomes
   official automatically; delete the last one → the date leaves the history.
5. Move an entry to another date (edit → change date) → both dates re-normalize
   their official correctly.

Repo/IndexedDB integration is exercised manually in the browser for now (a
headless IndexedDB polyfill isn't available offline in the build container); the
hard decision it relies on — `chooseOfficialId` — is covered by the unit tests
above, and the transactional application is a thin wrapper over it.



1. Load the app once while online (lets the service worker precache the shell).
2. Disable the network / enable Airplane Mode.
3. Reopen the app — it should boot offline, navigation works, Settings opens and
   still reads/writes values (IndexedDB is local).

Full offline coverage (log weight, add meal, start workout, charts, export
backup) is validated as those features land, culminating in the Stage 12 offline
procedure.

## Stage 3 acceptance (goals, trajectory, moving average, achievements)

Pure logic (run in container, 29 assertions, all pass):
- **7-day moving average = trailing 7 CALENDAR days, never last-7 measurements,
  never invents missing days.** Explicitly proven: entries far apart include only
  those within `[end-6, end]` (a recent-but-old weigh-in is excluded); sparse
  windows average only the endpoint; missing middle days are not counted as zero;
  no data → null (graceful).
- **Trajectory** via linear interpolation between anchors (start→milestones→
  final), clamped outside the range; tolerance band classifies ahead / on / behind.
- **Strict goal validation, no silent repair.** Rejected: final ≥ start; start not
  before final; milestone dates not ascending as entered; milestone weights not
  decreasing; milestone weight/date outside the plan envelope. Valid plans accepted.
- **Milestone==final dedupe.** A weigh-in that satisfies a milestone whose target
  equals the final goal surfaces the achievement once (final), the milestone is
  flagged `sameAsFinal`, and the entry is decorated a single time.
- **Milestone recalculation** (Part 2 Tests 1 & 2): first-qualifying date moves to
  the next qualifier when an earlier weigh-in is corrected up, and returns to
  unreached when nothing qualifies.
- **New-lowest** running derivation (strictly-lower; ties don't count).

Manual (browser): create a goal plan from Weight → الأهداف (or Settings → إدارة
أهداف الوزن); enter an invalid sequence and confirm inline rejection; log weights
and watch next-milestone/trajectory/moving-average and the ★ indicators update
live; correct an old weigh-in and confirm milestone dates/lows recompute.

### Stage 3 fixes (applied; explicitly tested)
- **Goal achievements respect `plan.startDate`.** Milestone/final `firstQualifying`
  runs over a timeline floored at the plan's start date, so a weigh-in recorded
  before the plan started can never satisfy the plan (Jan 104 kg does not achieve
  an Aug plan's 105 kg milestone); a post-start weigh-in achieves it with the
  correct date.
- **As-of ceiling — the current screen never reads the future.**
  `computeWeightSummary` takes an explicit `asOfDate` (default today) and considers
  only official weigh-ins with `localDate <= asOfDate` for latest context, the
  7-day moving average, remaining-to-goal, trajectory, and milestone/final status.
  Proven: with today = Aug 8 (105.8) and a future Aug 15 (103.0), today's summary
  still uses 105.8, the MA excludes Aug 15 (count 1), the milestone stays unreached,
  and remaining = 1.8 — identical to the summary computed without the future entry.
- **First weigh-in is a baseline, not a ★.** `runningLows` requires ≥1 prior
  official weigh-in before a strictly-lower value earns "new lowest"; the overall
  `lowest` statistic still tracks the minimum (which may be the first entry).

## Batch A — Stage 4 & 5 acceptance

Pure logic (run in container, 32-assertion combined suite, all pass) — Stage 1–3
regression plus:
- **Nutrition finals & protein.** Half-meal 540/62 ×0.5 → 270/31 (Part 2 Test 5);
  unknown protein (`null`) stays `null` through finals — never 0 (Part 2 Test 6);
  an explicitly typed 0 is 0 (distinct from unknown); arbitrary decimal quantity
  scales correctly.
- **Day totals.** Calories sum; protein sums only known entries and flags when any
  are unknown; all-unknown → protein total `null` (shown as "—"), never 0.
- **Remaining vs target.** 1840/2235 → 395 remaining; 2410/2235 → −175 exceeded;
  no target → null.
- **Missing ≠ zero.** A day counts for averages only if it has entries or is
  explicitly completed (completed-with-zero counts; unlogged does not).
- **Meal / entry / exercise validation.** Name and numeric calories required;
  protein optional (null allowed); entry quantity must be > 0; exercise name
  required and unit restricted to kg/lb.

Manual (browser):
1. Nutrition tab → add from Meal Library (search, pick, quantity chips, live
   preview) and as a one-time food (optionally "save to library"); daily total and
   remaining update live; protein shows "—"/"غير معروف" when unknown.
2. Edit a logged entry (name/cal/protein/quantity/date), duplicate it, copy to
   another date, and "copy previous day" — each creates independent records.
3. Edit a Meal Library item afterward and confirm the already-logged entry's
   values do NOT change (snapshot immutability, Part 2 Test 4 / Test 14).
4. Mark a day complete with no entries → it reads as a completed zero day, not a
   fabricated value; an unlogged day shows the add action instead.
5. Exercises: Workout → مكتبة التمارين; add exercises, filter by muscle/equipment,
   archive/restore, open an exercise's detail page. Two "same name, different
   machine" exercises keep separate ids.

## Stage 4 fixes + Batch B (Stage 6 & 7) acceptance

Pure logic (run in container, combined suites pass):
- **Stage 4 fixes (21 assertions).** Repo-level nutrition validation on
  `addOneTimeEntry`, `addEntryFromMeal`, and `updateEntry`: rejects empty name,
  negative/NaN/non-finite calories, zero/negative/NaN quantity, and negative/NaN
  protein; accepts null/'' protein (unknown) and explicit 0. `applyEntryPatch`
  validates the FULLY-MERGED entry before recompute, preserves `null` protein vs
  explicit `0`, and preserves the entry's time unless `time` is explicitly changed
  (regression covered).
- **Stage 7 set validation (8 assertions).** Weight finite ≥ 0 (bodyweight 0 ok),
  reps a positive integer, setType ∈ {warmup, working}, RIR optional and ≥ 0.
- **Exercise memory (workoutMemory, several assertions).** `lastPerformance`
  returns the most recent PRIOR working session (excluding the current one),
  recalling e.g. "105 lb 9/9/7"; warmups are excluded from working/max; a
  warmup-only history yields no last performance. **Remove-and-return**: memory is
  keyed solely on the permanent exercise id, so it resumes after the exercise
  leaves and rejoins routines. **Separate machines**: different ids never mix.

Manual (browser):
1. Workout → البرامج: create a routine, add days, add/reorder/replace/remove
   exercises. Then edit an exercise in the routine — confirm no history changes.
2. Workout → بدء تمرين: start from a routine day (or ad-hoc); log sets fast
   (prefill, ±reps, duplicate, warmup/working); each exercise shows its last
   working performance. Finish the workout.
3. Reopen a past session, change its date → its sets follow; edit/delete a set;
   delete a session removes its sets. Recent sessions list reflects changes.
4. Remove an exercise from every routine, then add it back later and start a
   session with it — its previous performance still appears (memory by id).

## Stage 7 fixes + Stage 8 (PRs) acceptance

Pure logic (run in container; fix suite 10 assertions, Stage 8 suite 25
assertions, consolidated Stage 1–8 suite 32 assertions — all pass):

Stage 7 fixes:
- **Memory as-of the current session.** `lastPerformance`/`getExerciseMemory` take
  the current session's date + createdAt and only consider strictly-earlier
  sessions. A future workout (Aug 15) is never "last performance" for Aug 8;
  editing an older session never reads a later one; same-day earlier sessions
  count, later ones don't.
- **Unit-safe memory.** `workingUnit` returns null for mixed units; `maxWorking
  weight` and `lastPerformance.workingWeight` are null across mixed units (no
  cross-unit `Math.max`). Prefill only fills a numeric weight when the historical
  unit matches the exercise's current default unit; otherwise the history is shown
  for context without prefilling.
- **Historical exercise correction.** The set editor has an exercise picker;
  changing `exerciseId` validates the destination exists, re-snapshots the set's
  unit to the destination's default, preserves other values, and emits both the
  old and new exercise ids so PRs recompute for both.
- **Routine-specific notes** are editable per exercise in the routine editor
  (add/edit/clear) without touching the Exercise Library or workout history.

Stage 8 PRs (all original scenarios):
- TEST3 new Rep PR (105×10 over 105×9); TEST4 corrected immediately (10→7 clears
  the ★); TEST5 new Weight PR (110 over 105); TEST6 warm-up reclassification
  excludes the set and recalculates the max; TEST7 delete returns the max to the
  next lower; TEST8 historical correction reassigns the record holder (Jan→8 makes
  Mar 105×9 the record). Same-session superseding (set1 and set2 both records when
  entered, current best = set2). Exercise-id isolation and unit isolation (kg/lb
  tracked separately, rep records keyed by unit+weight). Warm-ups never create a
  working PR. Session summary reports only genuine PRs; a first-time weight is a
  baseline, not a fake achievement.



Do not reset IndexedDB. Preserve prior data. Add migrations when the schema
changes. Verify existing functionality before moving on. Keep the app runnable.

## Batch D (Stages 9 + 10) acceptance

Four Stage-7-followup data-integrity fixes (tested, 26 assertions):
- **Session chronology, not set.createdAt.** PR replay and exercise-history order by
  the factual session timeline (session localDate → startTime → a stable seq
  tiebreaker → set.order). Two same-day sessions at different start times order by
  time even when the earlier one is backfilled later (higher createdAt). Repos join
  workoutSets with workoutSessions (`enrichSetsWithSession`) before the pure calc.
- **Exercise memory uses the same session chronology.** `lastPerformance` takes an
  `asOf:{localDate,startTime,seq}` cutoff; the evening session sees the morning one,
  the morning session never sees the later evening one, future sessions stay
  excluded, and writing an older session later never makes it look newer.
- **Repository-level weight validation.** `addWeight`/`updateWeight` reject NaN,
  Infinity, ≤0, ≥700 kg, invalid/empty dates, and malformed times before writing;
  valid existing data is untouched.
- **Repository-level settings/target validation.** Units limited to kg/lb, trajectory
  tolerance finite ≥0, calorie/protein targets finite ≥0 (null clears); no silent
  coercion.

Stage 9 (statistics) and Stage 10 (backup) — pure suites (statsData + backup) and
the consolidated Stage 1–10 suite (37 assertions) all pass:
- Missing nutrition days render as GAPS (y=null), never zero; a completed empty day
  is a real 0; averages count logged days only.
- Weight chart plots only actual official weigh-ins (no fabricated points) plus a
  separate MA line and a dashed target trajectory; milestone markers placed by date.
- Exercise chart is per exercise id AND per unit — kg and lb never mixed or compared.
- Backup validate rejects wrong format, newer backup/schema versions, non-array and
  corrupt stores. Replace restores every store's records identically; Merge adds only
  keys not already present and re-normalizes one-official-per-date. Reconstruction:
  weight summary + PRs rebuild identically from restored raw records.
- Restore clears store RECORDS inside a transaction and never deletes the database.



Do not reset IndexedDB. Preserve prior data. Add migrations when the schema
changes. Verify existing functionality before moving on. Keep the app runnable.

## Stage 10 hardening (post-Batch-D review)

Tested (18 hardening assertions + consolidated Stage 1–10 suite, all pass):
- **Incomplete backups are rejected.** `validateBackup` now requires every store
  in BACKUP_STORES to be present as an array. A backup missing `meals`,
  `workoutSets`, or `settings` fails; a malformed store value fails; explicitly
  empty stores present as `[]` stay valid. Because `importBackup` validates before
  planning or opening any write transaction, an invalid/incomplete file cannot
  clear or mutate IndexedDB — critical for Replace, which clears every store.
- **Merge is relationally validated (`planMerge`), not merely additive.** It
  rejects, before writing: id collisions whose existing record differs from the
  backup record (conflict — additive merge would silently keep the existing one),
  and any to-be-added child whose referenced parent will not exist after the merge
  (orphan) across milestones→goalPlans, routineDays→routines, routineExercises→
  routineDays/exercises, workoutSets→workoutSessions/exercises, and
  nutritionEntries.sourceMealId→meals (optional). Clean disjoint and identical
  merges still succeed.
- **Exercise progression keeps same-day sessions distinct.** Two sessions on the
  same localDate produce two points at distinct x positions, ordered by session
  start time, labelled with date + time; they are never aggregated.

## Stage 10 restore-integrity (final review)

Tested (19 assertions + consolidated Stage 1–10 suite, all pass):
- **Comprehensive Replace validation.** `validateBackup` now checks, before any
  clear/write: every store present as an array; a valid non-empty primary key for
  every record; no duplicate keys within a store; required field types per factual
  store (dates via `isValidLocalDate`, finite numbers, non-empty ids/names,
  enumerated target types); and internal referential integrity — orphan
  routineDay, routineExercise, workoutSet (session or exercise), or milestone are
  all rejected, as is a non-null `sourceMealId` pointing at a missing meal (null is
  allowed). Malformed backups are never silently repaired.
- **Invalid input cannot mutate the database.** `importBackup` validates first and
  throws a ValidationError before opening any transaction, so a malformed,
  incomplete, or orphaned backup performs no clear and no write.
- **Derived cache is never authoritative.** `exerciseStats` is a derived store: it
  is cleared on Replace and never repopulated from the backup, so a stale cache can
  never override or disagree with restored raw workout history; records recompute
  from raw sets on demand.

## UI/UX polish (v0.8.0) — acceptance

Presentation-only pass over the frozen Stage 1–10 engine. Verified:

- **Regression intact.** Full consolidated Stage 1–10 suite + backup/restore
  critical checks + new muscle-map logic: 36/36 pure assertions pass. Complete
  valid backup passes; incomplete, malformed, duplicate-key, and internal-orphan
  backups fail before any write; Replace stays atomic; conflicting Merge rejected
  before writes; derived `exerciseStats` never authoritative.
- **Every runtime module parses** (`node --check` across the tree) and **imports
  cleanly** (23 feature/shared modules), and every shared helper used by a screen
  is imported where used (no render-time ReferenceErrors).
- **Precache consistent**: the SW list matches the reachable import graph from
  `app.js` exactly (51 runtime modules, 61 assets); new modules `core/ui.js`,
  `core/bodyMap.js`, `domain/muscleMap.js` precached; removed `placeholder.js`
  dropped from the list and disk.
- **No external/network dependencies added**: no `http(s)`/CDN/font refs in
  js/css/html; no `fetch`/XHR/WebSocket in app modules; CSP `connect-src 'none'`
  unchanged; the service worker still never touches/deletes IndexedDB.

**Manual UX pass (reasoned)** across the 20 key journeys — Home glance; log
weight; same-day measurement management; trajectory + milestone timeline; log a
saved meal with a fractional quantity chip; one-time food; edit/copy entry; find
an exercise; exercise history with unit selection; browse a routine's muscle
map; start/continue a workout; scan previous performance (unit-safe, as-of);
enter/correct sets quickly; finish with a factual summary; review a PR ★; Weight/
Nutrition/Exercise statistics with sparse-data guards; export a backup;
understand Replace vs Merge; navigate Settings. Honest empty/unknown/unlogged
states throughout (unknown protein ≠ 0; unlogged day ≠ logged zero).

## Starter library + fast routine flow (v0.10.0) — acceptance

- **Seeding (14 checks):** seeds full library into a fresh DB; re-running creates
  0 duplicates; id-existence guard prevents dups even if the version flag is
  cleared; existing custom exercises and their objects are untouched; a built-in
  with a matching name is a SEPARATE identity (no merge); workoutSet exercise ids
  stay linked; ids are stable/deterministic; search matches EN + AR + alias;
  broad muscle/equipment filters return correct results; every built-in maps to a
  region; unknown muscle text → null (no invented anatomy); picker onPick surfaces
  the permanent id.
- **Real seed code + wiring (6 checks):** the repo seed skips existing ids, never
  deletes, records the version flag, short-circuits when already seeded; search
  covers EN + aliases; app.js seeds after `openDB`, before first render.
- **Regression intact:** full Stage 1–10 suite (14 assertions) still passes; RTL
  numeric isolation, restrained accent, safe-area, offline/precache all preserved.
- **Precache:** SW list matches the reachable graph (52 modules, 62 assets);
  `builtinExercises.js` precached. No external deps/network; CSP unchanged; SW
  never touches IndexedDB.

## Dashboard redesign + active workout (v0.11.0) — acceptance

Verified (offline, static + pure where DOM/IDB is required):
- Seeding + full Stage 1–10 regression: 18/18 pure assertions pass; v0.10.1
  built-in `defaultExerciseUnit`-at-creation behavior intact.
- 46 structural assertions across the new flows: routine→day→start; up-timer
  anchored to persisted `session.createdAt` and cleared on unmount; rest timer
  (90s, +30/skip) starts only after a working set; active session rehydrates from
  its id and the start flow resumes an existing incomplete session for the same
  day (no duplicates); previous-performance is reference-only (a set is written
  only on explicit ✓, never auto-added); finish marks complete and produces a
  factual summary (counts + real achievements) without deleting/mutating history.
- English-only display names (built-ins English, custom untouched; seeding never
  renames); no muscle/body diagram surfaced anywhere (`bodyMap.js` deleted).
- Home renders only from stored data: achievements gated on real new-low/reached
  flags and hidden when none; expected weight derived from trajectory; no
  randomness or fabricated status.
- RTL/bidi intact: `.num` isolates without forcing whole-element LTR; `.numeric-ltr`
  present; Home wraps mixed clusters in `numericLTR`.
- IndexedDB compatibility: no schema/migration change; DB never deleted; active
  workout/start never clear stores; seeding additive.
- Precache consistent (52 modules, 62 assets; shell + CSS + manifest cached); SW
  never references IndexedDB; no external URLs/fonts/CDNs; no `fetch` in app modules.

## Configurable rest + historical meal save (v0.12.0) — acceptance

- Rest settings + persistence (17 checks): global between/after defaults used when
  no override; per-routine-exercise overrides win; same exercise different rest per
  routine; cleared global → fallback while explicit 0 is respected; between-set rest
  on working-set commit; after-exercise rest via the next control; final exercise
  starts no rest; warm-up does not trigger rest; single countdown; +30; Skip;
  survives navigation with remaining derived from timestamps; expired never
  restarts; elapsed up-timer independent of the rest down-timer.
- Historical meal save + session actions (14 checks): entry saves to library using
  the immutable snapshot; entry and day totals unchanged; unknown protein stays
  null; already-linked entry shows quiet state (no dup); same-name meal not merged;
  saving alters no dates; new meal active/selectable; real source uses snapshot and
  guards linked entries; session swap/remove never edit the routine.
- Regression: starter-library + English-only names + seeding idempotency + v0.10.1
  unit + full Stage 1–10 all pass; backup validates WITH the new rest fields and
  remains valid WITHOUT them (backwards-compatible); rest fields + planned-rest
  snapshot round-trip through backup/restore.
- Syntax + import: all JS parses; 52 modules import; all used repo/helpers imported.
- Precache consistent (52 modules, 62 assets); no external deps; no
  localStorage/sessionStorage; no fetch in app modules; RTL `.num` isolate intact;
  no muscle diagram; version 0.12.0 / cache v0.12.0.

## Stage completion rule (every stage)

Never reset IndexedDB. Preserve prior data. Add migrations only when the schema
changes. Verify existing functionality before moving on. Keep the app runnable.
