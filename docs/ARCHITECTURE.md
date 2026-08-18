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

## Starter exercise library + fast routine flow (v0.10.0)

A curated built-in library (`js/data/builtinExercises.js`, ~83 common exercises)
makes a fresh install immediately usable. It is **presentation data on the
existing schema** — no migration. Each record has a STABLE id (`builtin:<slug>`),
an Arabic display `name` (primary), an English `nameEn` (secondary + searchable),
`aliases`, and broad Arabic `muscleGroup`/`equipment` that `domain/muscleMap.js`
already understands.

**Idempotent seeding** (`seedBuiltinExercises`, run once after `openDB`): creates
a built-in only when its stable id is absent, so re-running never duplicates and
user-created exercises and workout history are never touched, renamed, reassigned,
or merged. A `builtinLibraryVersion` settings flag short-circuits the common case
and lets a future revision seed only newly added ids. A built-in the user archived
still exists by id and is skipped. Built-ins are additive: a user's "Chest press"
and the built-in "Chest Press (Machine)" remain separate permanent identities.

**Fast picker** (`exercisePicker.js`): search (Arabic OR English/alias) →
`الأخيرة` (from factual history) + broad muscle chips + equipment chips → tap to
add. Muscle chips map via `muscleMap` broad regions (not exact strings). Custom
creation is a secondary `+ تمرين مخصص` action. Selecting passes the exercise's
permanent id up; it never opens detail or mutates identity.

**Muscle visualization surfacing**: the existing local SVG (`bodyMap.js`) now
renders where it helps — the routine overview and each routine day (regions from
that day's exercises), and Exercise Detail (the exercise's broad region). It only
appears when the group maps to a region; unmapped groups show nothing (no invented
anatomy). Built-ins carry mapped Arabic groups, so the map is now consistently
visible.

## Dashboard redesign + active workout + English names (v0.11.0)

**English-only exercise names.** A display helper `exerciseTitle(ex)` returns
`ex.nameEn || ex.name`: built-ins show their English name; custom exercises show
the user's own entered name. This is presentation only — seeding never renames and
stored records are untouched. Applied across picker, library, detail, routine
editor, active workout, start flow, and stats.

**Muscle/body diagram removed.** The stylized SVG silhouette could not be trusted
for anatomical accuracy, so it is no longer surfaced anywhere user-facing
(`core/bodyMap.js` deleted). `domain/muscleMap.js` remains — used only for the
picker's broad muscle FILTER chips and text metadata, not for drawing anatomy.

**Home dashboard.** Rebuilt into calm, domain-tinted cards driven entirely by
stored data: weight (green) hero + next-goal sub-card, nutrition (amber) with a
protein mini-bar, workout (indigo) that is state-adaptive (start / continue /
done), a weight-goal mini timeline, and an achievements section that appears only
for real events (a genuine new low or a reached milestone). Expected-vs-actual is
derived from the trajectory; nothing is fabricated. Mixed numeric clusters use
`numericLTR`, preserving RTL correctness.

**Active workout (execution mode).** `session.js` is a dense logging screen with an
up-counting workout timer anchored to the persistent `session.createdAt`, every
planned exercise in saved order, a set grid (# · previous · weight · reps · ✓),
and a rest countdown (90s default, +30/skip) that starts only after a *working*
set. Previous-performance values are reference-only — prefilled into inputs but a
set is written solely on an explicit ✓. Finishing marks the session complete and
shows a factual summary (duration, exercise/set counts, real PRs) without mutating
history.

**Start flow.** `startWorkout.js` (route `start`, parent `workout`): choose a
routine, then a day; tapping a day resumes an existing incomplete session for that
day today or creates one, then enters the active workout. Selection only.

No schema/migration change; the Stage 1–10 engine and v0.10.1 built-in-unit
behavior are unchanged.

## Configurable rest timers + historical meal save (v0.12.0)

**Rest model.** Two distinct, configurable durations: rest *between sets* and rest
*after an exercise*. They live on the routine-exercise occurrence
(`restBetweenSets` / `restAfterExercise`, additive per-record fields on
`routineExercises` — no schema/migration change), so the same exercise can carry
different rest in different routines without touching exercise identity. Global
fallbacks (`restBetweenSetsDefault` 90s, `restAfterExerciseDefault` 120s) live in
settings under "تسجيل التمرين"; a cleared field falls back to these, and old
routines with no overrides simply use the defaults. At session start the values
are snapshotted into `plannedExercises` so an in-progress workout is unaffected by
later routine edits.

**Active-workout rest.** Committing a *working* set starts the between-set rest;
the per-exercise "التمرين التالي ⏭" control starts the after-exercise rest and
scrolls to the next exercise (the final exercise has no such control, so no
needless rest). The countdown is timestamp-based (module-scoped
`restBySession` holding `endsAt`), so it survives in-app navigation and derives
remaining time from the clock (no per-second persistence, no drift); expired rest
shows nothing. Exactly one countdown exists at a time; +30 and Skip adjust/clear
it. It is visually and functionally independent of the up-counting workout timer.

**Session-scoped exercise menu (⋯).** Swap, remove, per-exercise note, and reorder
— all scoped to today's session only. Swap reassigns the session's own sets via
`updateSet` (unit re-snapshotted, ids kept); remove deletes only this session's
sets for that exercise; note/reorder edit only the session's planned list. None of
these ever mutate the saved routine or other sessions' history. Permanent plan
edits remain in the Routine Editor.

**Historical nutrition → Meal Library.** The entry editor offers "حفظ في مكتبة
الوجبات", creating a NEW library meal from the entry's immutable per-serving
snapshot (name, kcal/serving, protein/serving — unknown stays unknown, serving).
It never mutates the entry, day totals, or other dates, and never merges by name
(`addMeal` always mints a new id). Entries already linked to a meal show a quiet
"محفوظة في المكتبة ✓" instead, avoiding accidental duplicates.

## Reliability & recovery (v0.13.0)

A pass focused on forgiving real-life mistakes. Core logic lives in the pure,
tested `domain/recovery.js`; repo additions are additive optional fields (no
schema/migration) and UI wires them in without disturbing factual data.

- **Active routine** (`settings.activeRoutineId`): the daily start flow goes
  straight to day selection for the active routine; a subtle "تغيير" switches it
  and routines can be marked active from the list. Nothing is ever set active
  silently — first use offers it, and history is never required.
- **Next-day suggestion**: `suggestNextDay` marks the day after the most recently
  completed one (wrapping); non-binding, and absent when history is ambiguous.
- **Stale-workout recovery**: an active session older than 6h surfaces a banner in
  the Workout hub to resume or finish; duration is never auto-corrected.
- **Pause / resume**: `pausedAt` + `pausedAccumSec` exclude paused time from the
  elapsed timer (rest countdown stays independent); persisted, so reload can't
  corrupt totals.
- **Editable duration**: a corrected factual duration (`durationSecOverride`) can
  be set from the summary/manager without touching sets, PRs, or identity.
- **Accidental-finish protection**: finishing warns only when work is logged yet
  some planned exercise still has no working set (`looksIncompleteForFinish`).
- **Resume finished workout**: reopening flips the SAME session back to active (no
  duplicate); `completedAt` supports reopen-as-active safeguards.
- **Undo everywhere**: logging a set, deleting a set, deleting a nutrition entry,
  and removing an exercise from a session all show an Undo snackbar. Undo restores
  the EXACT prior record (`restoreSet`, `restoreEntry`, `restoreExerciseToSession`)
  — same ids, snapshots, and order.
- **Wrong-day recovery**: an empty session can change its day or be cancelled in
  one tap; a session with logged sets keeps the strong two-step delete.
- **Typo/outlier guards**: conservative soft-confirms for an improbable body-weight
  jump (`isWeightOutlier`) or exercise load (`isLoadOutlier`); they never block an
  explicit confirmation and never fire on normal progression.
- **Backup safety**: successful exports record `lastBackupExportedAt` (shown in
  Settings), and a full-Replace restore auto-exports a safety snapshot first.

Session-scoped vs permanent stays intact: all in-workout edits touch only today's
session; permanent changes remain in the Routine Editor.

## Reliability correctness patch (v0.13.1)

Post-audit fixes making the v0.13.0 recovery features factually correct.

**One coherent duration model.** Sessions bank active seconds in `accumulatedSec`
and record `runningSince` while a segment runs; `paused`/`completed` stop it.
`elapsedSec` = banked + open segment (only while active, unpaused, running).
Pure transition patches (`startPatch`/`pausePatch`/`resumePatch`/`finishPatch`/
`reopenPatch`/`setDurationPatch`/`resetDurationPatch`) are applied by the repo.
This fixes resume-after-finish (the idle gap between finishing and reopening is
never counted), makes a manual correction the live base the timer counts on top
of, excludes paused time, survives reload (recomputed from `runningSince`), and
prevents a stale `durationSecOverride` from overwriting resumed time. Legacy
sessions read through a backward-compatible branch until their next mutation.

**Reopen safeguard wired.** The session UI resumes a completed workout as the
SAME session only when `canReopenAsActive` (≤24h); older workouts stay
history-editable (add/edit sets, edit duration) but are not reactivated.

**One active workout invariant.** Enforced at the repo boundary: `startSession`
throws `ActiveSessionExistsError` if an incomplete session exists;
`getActiveSession` is the single source of truth. Start/Home/Hub surface the open
workout with continue / cancel-empty actions instead of creating a second.

**Meal delete integrity.** `deleteMeal` refuses when `countEntriesForMeal > 0`
(would orphan `sourceMealId` — a state the backup validator rejects); the UI
offers archive instead. Snapshots and source links are never rewritten.

**Safety backup before Replace.** If the pre-restore export fails, the restore
stops and requires an explicit "المتابعة بدون نسخة أمان"; success is never
implied. Distinguishable filename `fitness-backup-before-restore`.

**Historical add-set.** Completed sessions show a "+ إضافة مجموعة" row that adds
to the same session without reactivating it, starting no workout/rest timer;
derived stats/PRs consume it (raw sets are authoritative).

**Body-weight outlier reference.** `referenceWeightBefore` compares against the
chronologically-prior measurement (by date/time, official-preferred), excluding
the edited entry — never a future/newer-created record.

**Other:** stale banner exposes تعديل المدة directly; wrong-day change uses the
same-session `changeSessionDay` (id preserved, duration reset) via a day picker;
empty-finish and partial-finish confirmations; unsaved-change guard in `openSheet`
(dirty-only) wired to nutrition-entry and weight-edit sheets; next-day suggestion
filters to the active routine; session swap carries the slot's rest config.

## Final reliability patch (v0.13.2)

Six audit fixes; no architectural changes.

**Legacy completed-duration.** `elapsedSec` no longer falls through to
`(now − createdAt)` for a completed pre-accumulator session — that made a
finished workout grow forever. It now derives a factual duration, never using
`now()`: manual `durationSecOverride` → `completedAt − createdAt` → clock
`endTime − startTime` (wrapping midnight) → `updatedAt − createdAt` → 0. Active
legacy sessions still use wall time (they are genuinely running). `reopenPatch`
banks this correct historical duration before starting the new segment, so
reopening a legacy workout continues from the right base.

**Legacy multiple-active detection.** `getAllActiveSessions()` surfaces every
incomplete session. The Workout Hub shows a resolution banner when more than one
exists (continue / finish each) — nothing is auto-picked, deleted, or finished.
The repo boundary still prevents any new second active session; a single-active
user sees no extra friction.

**Workout Hub active source.** The hub now uses the authoritative
`getActiveSession()` (and `getAllActiveSessions()`), not a `getRecentSessions(10)`
scan, so an old-but-active workout is never missed.

**Unsaved-change protection coverage.** The existing `openSheet({ dirty })` guard
is now wired to add-nutrition-entry (manual one-time + meal-quantity), add body
weight, Meal Library create/edit, exercise create/edit, and routine rename — in
addition to the nutrition-entry and weight edit sheets it already covered. It
warns only when values actually changed; Save and clean dismissals are silent.

**Safety-backup filename.** `downloadBackup(obj, prefix)` now honors the prefix
(previously ignored), so the pre-restore safety file is factually distinguishable:
`fitness-backup-before-restore-YYYY-MM-DD.json`. Manual backups keep
`fitness-backup-YYYY-MM-DD.json`. Failure still stops Replace and never claims a
backup exists.

**Same-day weight reference.** `referenceWeightBefore(entries, date, excludeId,
beforeTime)` now uses an earlier SAME-day measurement as the reference when time
ordering exists (08:00 → reference for a 20:00 entry), still excludes the edited
entry, and never uses a later/future measurement. Without a time it does not
guess same-day order.

## Calendar-first daily history (v0.14.0)

The Statistics page now opens with a monthly calendar at the top; the existing
charts remain directly below (no new tabs, one tap from the bottom nav).

**Layout.** `renderStats` draws `pageHead → #stats-calendar → "التحليلات" → tabs →
range → #stats-body`. The calendar owns its container and re-renders in place on
month navigation; tab/range interactions call `drawBody()` which only replaces the
analytics body, so the charts and calendar never reload each other. Nothing was
added to Home.

**Calendar** (`features/stats/calendar.js` + pure `domain/calendar.js`). A compact
Saturday-first grid (`WEEKDAYS_AR = س ح ن ث ر خ ج`) with ‹ / › month nav, a
"الشهر الحالي" return action, and a subtle "عرض السجل" secondary action — no
تقويم|قائمة switch. Today has an accent outline; the selected day has a filled
state; the two are always distinct. Selecting a day never writes data.

**Indicators = data-exists only.** Each in-month day shows up to three restrained
dots (nutrition / workout / weight) meaning a record exists for that local date —
never goal/target/adherence. Cells never show totals or text.

**Day Summary** (single implementation, used by both calendar cells and the
history list). Tapping a day opens one sheet with: nutrition (calories, protein
with unknown preserved, entry count → "عرض التفاصيل" opens Nutrition for that
date via a new optional date param), all workouts for the day (name, authoritative
`effectiveElapsedSec` duration, exercise + working-set counts → "فتح" opens the
session), and weight (official prominent, extra same-day measurements disclosed →
"فتح سجل الوزن"). Empty days show "لا توجد بيانات مسجلة لهذا اليوم".

**History list.** "عرض السجل" opens a compact list of every date with data,
newest first, no arbitrary limit; each row reuses the same Day Summary.

**Data layer** (`data/history.repo.js`, read-only, no new stores). A month is
aggregated with exactly three bounded `localDate` index range queries
(nutrition/session/weight) mapped to cells — never a per-cell scan. New bounded
helpers: `weight.getEntriesInRange`, `workouts.getSessionsInRange`. The Day
Summary fetches only the selected date (plus that day's session sets); the history
list makes one pass per domain. All grouping is by the stored `localDate` string,
so a late-night local record stays on its intended day (no UTC regrouping).

## Calendar RTL arrows + weight date context (v0.14.1)

Two follow-up fixes to the calendar-first history:

- **Month-arrow RTL consistency.** The calendar header now uses the same
  convention as the Nutrition date nav: previous month is `›` (points right),
  next month is `‹` (points left). Only the glyphs changed; `prevMonth`/
  `nextMonth` logic and the "الشهر الحالي" return are unchanged.
- **Weight keeps the selected date.** "فتح سجل الوزن" in the Day Summary now
  navigates with the selected date (`navigate('weight', date)`), and `renderWeight`
  opens that date's existing day sheet after its first render when given a valid
  date param. It reuses the existing sheet, creates no records, and normal
  bottom-nav to Weight (no param) is unchanged.

## Weight milestones UX (v0.15.0)

Two milestone problems solved without touching the goal engine, achievement
derivation, Calendar, or Reliability.

**Horizontal scrollable timeline** (`features/weight/milestoneTimeline.js`,
reused by Home, Weight, Goals). One shared component replaces the compressing
Home `goaldots` and the vertical `.timeline` lists. Each milestone is a
fixed-min-width node (`flex:0 0 auto; min-width`) inside an `overflow-x:auto`
strip, so many milestones never squeeze together — the strip scrolls instead and
weight/date labels never overlap. Connectors use logical props
(`inset-inline-*`) for correct RTL; weights render through `numericLTR` for bidi.
`buildItems` orders nodes heaviest→lightest and marks the first unreached as
`current`. On mount, `scrollIntoView({inline:'center'})` (inside rAF) auto-focuses
the current node — RTL-safe, no manual `scrollLeft`. States are restrained:
done / current / future / final (the final node is the plan goal).

**Home stays compact.** Home renders the timeline in `compact` mode (one
scannable row, auto-focused) plus the existing expected/actual summary — no long
milestone list, no giant section.

**Automatic generation** (`domain/milestoneGen.js` pure + `features/goals/
generatorSheet.js`). "إنشاء مراحل تلقائيًا" takes start weight, final weight,
step, frequency (daily/weekly/biweekly/monthly), and start date — prefilled from
factual context (latest official weight, plan final, plan start date) and never
silently guessing. `generateMilestones` emits the checkpoints strictly BETWEEN
start and final (the endpoints are the plan's own start/goal, which the existing
validator requires); e.g. 105.5→95 @0.5 weekly ⇒ 20 checkpoints (105.0 … 95.5),
with 95.0 shown as the final goal. 0.5-kg steps stay exact (1-dp rounding);
dates advance by the frequency interval (calendar months for monthly).

**Preview + safe commit.** Generation always previews ("سيتم إنشاء N مرحلة" +
dated list) before writing. Cancel writes nothing. When milestones already exist,
an explicit choice is required: add to current, replace only the unreached/planned
(achieved milestones are preserved via the derived reached-weight set), or cancel.
The commit goes through the existing `updatePlan` (atomic replace-all in one
transaction — no partial batches) after `validateGoalPlan`, so generated
milestones are ordinary milestone records with no separate store or duplicated
achievement truth, and remain manually editable in the plan editor afterward.

## Milestone generator context + weekly Home summary (v0.15.1)

Three review fixes; the approved v0.15.0 horizontal timeline is unchanged.

**Generator start pairing.** The generator no longer pairs a current weight with
an old plan-start date. When it defaults the start weight to the latest official
weigh-in, it also defaults the start date to THAT measurement's factual localDate
(currentOfficial = {weightKg, localDate} from s.latest); otherwise it falls back
to the plan's own start (weight+date together) or today. The start date field
stays editable, and the plan's historical startDate is never rewritten.

**Final-date conflict.** requiredFinalDate(generated, startDate, frequency)
computes when the goal weight is reached (one interval after the last
between-checkpoint, k=n+1). The preview compares it to the plan's finalDate; if
the schedule needs a later date it shows both (current vs required) and offers
explicit actions: update the final date to the required one (applied in the SAME
atomic updatePlan as the milestones), edit settings (back), or cancel (writes
nothing). The final date is only ever EXTENDED, never silently shortened, and the
existing validateGoalPlan is unchanged — impossible sequences are prevented.

**Home weekly summary.** The redundant green expected/actual/difference box under
the timeline is replaced by a compact "this week" card: week-start weight, latest
weight, weekly change, and next milestone/target. It derives purely from the
official weight timeline + the goal summary — nothing stored. Missing data is
honest: no in-week weigh-in shows "no measurement"; a single weigh-in shows "one
measurement" (never a fabricated 0). The week begins Saturday (weekStartDate,
matching the calendar), computed on localDate only (no UTC). The horizontal
milestone timeline remains above it.

## Nutrition + Workout UX pass (v0.16.0)

A presentation/interaction pass — no domain semantics changed. High-frequency
actions were made dominant, secondary details moved to progressive disclosure,
and destructive actions demoted from big red buttons to swipe + Undo.

**Shared primitives** (js/core/controls.js) used by both features:
- stepper — compact -/value/+ quantity control with quick fractions and manual
  entry; onChange drives live totals.
- disclosure — a toggle that reveals secondary details (date/time/note, RIR,
  repeat/copy, delete) so the primary view stays focused.
- swipeRow — swipe a row to reveal Delete; tap still activates the row. RTL-aware,
  keyboard/no-touch safe.

**Nutrition.** The daily list is now scannable rows: food name + quantity/serving,
calories in a warm nutrition tint, protein in a cool tint shown only when known
("بروتين غير معروف" otherwise — never 0). Swipe a row to delete → snackbar Undo
restoring the exact record. The add sheet keeps the Library/manual split but
foregrounds food -> nutrition -> quantity (stepper) -> live total -> Add. The edit
sheet leads with quantity/nutrition and discloses date/time/note/repeat/copy/
library/delete; delete is a subtle link, not a dominating red button. The Meal
Library editor is now clearly a reusable per-serving definition ("تعريف في
المكتبة") vs a logged entry ("صنف مُسجّل").

**Workout.** Each exercise shows a compact "آخر مرة" previous-performance line
(factual, grouped w×r tokens; clearly historical, distinct from today; no invented
progression). Logged sets swipe-to-delete → snackbar Undo (restoreSet); tapping a
set still opens the editor, which leads with weight/reps and discloses RIR +
delete. The rest timer remains a sticky, contextual banner shown only during rest.
Completed sessions keep the historical add-set row (no reopen, no rest timer).

**Home week card (correction).** weekSummary now scopes first/latest/change
strictly to the current Saturday-based week and exposes hasWeekData + priorLatest.
When the week has no official weigh-in, Home shows "لا يوجد قياس هذا الأسبوع"
(never a previous-week weight as this week's) with no fabricated change. The
"first" cell is renamed "أول قياس هذا الأسبوع" (it may be mid-week). Nothing new
is stored; localDate semantics unchanged.

Preserved unchanged: all nutrition calorie/protein/fraction math and unknown-protein
semantics; Meal Library referential integrity; nutrition Undo; workout duration
accumulator, pause/resume, one-active-session invariant, stale recovery, finish
protection, reopen safeguard, historical add-set, PR derivation, warm-up semantics,
units, rest persistence/config, exercise snapshots; backup/restore; official-weight
and Saturday-week semantics; the v0.15.x milestone timeline and generator.

## Polish fixes (v0.16.1)

Follow-up corrections to the v0.16.0 UX pass.

1. **Missing numericLTR imports (runtime bug).** nutritionSheets.js (live total)
   and session.js (previous-performance line) called numericLTR without importing
   it — those code paths threw the first time they ran. Both now import it from
   core/ui.js; the unused import was removed from core/controls.js. A repo-wide
   scan confirms no other feature uses numericLTR unimported.
2. **RTL swipe-to-delete direction.** The delete action is pinned at inline-END
   (physical left in this RTL app). swipeRow now computes a direction sign from
   the document dir and reveals by translating toward inline-start (positive X in
   RTL, negative in LTR), so the gesture uncovers the button instead of sliding
   onto it. Commit uses a direction-agnostic reveal amount; wrong-direction drags
   no longer open the row.
3. **Duplicate .stepper CSS.** A legacy row-oriented .stepper block (and the
   obsolete .qty-chips) still cascaded onto the new column-oriented stepper
   component, restyling its buttons/inputs. The legacy rules were removed; exactly
   one .stepper definition (the v0.16 component) remains.
4. **Product name.** APP_NAME is now centralized in core/meta.js as the single
   source of truth (manifest.webmanifest + index.html keep their own copies since
   they load before any module). The display name still reads "اللياقة" pending a
   chosen brand — update those three spots together to rebrand.

## LOCKD identity + v0.16 completion (v0.16.2)

Three goals, no domain changes.

**LOCKD branding.** The user-facing product name is now LOCKD, set in
manifest.webmanifest (name + short_name), index.html (title + apple-mobile-web-
app-title), and the centralized APP_NAME in core/meta.js. Persistent identifiers
are deliberately untouched — DB_NAME stays 'fitnessDB', the service-worker cache
keeps the 'fitness-shell-' prefix (its cleanup logic depends on it) — so existing
installed data upgrades in place. Branding is display-only; the app UI stays
content-first (no logo plastered across screens).

**LOCKD icon.** tools/make_icons.py regenerates all four assets (icon-192,
icon-512, icon-maskable-512, apple-touch-icon) from one PIL generator — no
external/runtime assets. The mark is an abstract dark-neutral "L" bracket
(vertical + horizontal rounded-cap strokes) with a short restrained blue latch
rising from the foot — reads as L / locked-in / completion without any gym or
padlock cliche. Near-white (#fbfbfd) background; standard icons carry subtly
rounded transparent corners, apple-touch and maskable are full-bleed with a
generous safe zone so platform masks never clip the mark. Blue is ~1/5 of the
mark — a small accent, not a blue-background icon.

**Manual Nutrition parity.** The manual pane now mirrors the library flow:
identity (name; calories + protein per serving side by side) -> quantity (shared
stepper) -> LIVE TOTAL -> Add. The live total recomputes via computeFinals on any
calories, protein, or quantity input; blank protein stays genuinely unknown
(null, never 0). Serving/date/time/note live behind a "التاريخ والوقت وملاحظة"
disclosure, and "Save to Meal Library" is a secondary toggle below the primary
Add. A "تسجيل يدوي" kind banner marks it as a consumption event, distinct from the
library definition editor ("تعريف في المكتبة").

**Workout set-grid simplification.** Previous performance was shown twice — the
"آخر مرة" line AND a "السابق" column in the grid. The redundant column is removed;
the grid is now four columns (# | weight | reps | ✓) with the reclaimed width
giving wider weight/reps inputs. The "آخر مرة" line stays near the exercise title.
Critically, only the visible column was removed: the historical PREFILL
(prevSets[existingCount] -> weight/reps inputs) and the outlier-guard reference to
previous performance are unchanged, as are warm-up semantics, PRs, units, set
edit, swipe-delete + Undo, historical add-set, and rest behavior.
