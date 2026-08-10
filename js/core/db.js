// db.js — IndexedDB foundation: open, versioned migrations, and small
// promise-based transaction helpers. This is the ONLY module that opens the DB.
//
// Migration policy (locked): the schema is versioned; upgrades run ordered
// migration steps and NEVER delete the database. Adding a store/index in a
// future version = append a new migration step; existing history is preserved.
//
// The full v1 schema below is created up front (all entities are known from the
// spec), so later stages consume existing stores without needing migrations.
// Booleans are not valid IndexedDB keys, so any flag that must be indexed is
// stored as 0/1 (e.g. weightEntries.isOfficial) — see the index notes.

export const DB_NAME = 'fitnessDB';

// Ordered migrations. MIGRATIONS[i] upgrades the DB TO version (i+1).
// The DB is opened at version = MIGRATIONS.length.
const MIGRATIONS = [
  // --- v1: create the complete initial schema ---
  function v1(db /*, tx, oldVersion */) {
    // key/value config
    db.createObjectStore('settings', { keyPath: 'key' });

    // calorie/protein target history (present from day one; see architecture)
    const targetHistory = db.createObjectStore('targetHistory', { keyPath: 'id' });
    targetHistory.createIndex('type', 'type', { unique: false });
    targetHistory.createIndex('type_effectiveFrom', ['type', 'effectiveFrom'], { unique: false });

    // meal library
    const meals = db.createObjectStore('meals', { keyPath: 'id' });
    meals.createIndex('status', 'status', { unique: false });
    meals.createIndex('name', 'name', { unique: false });

    // logged nutrition entries (snapshotted, immutable vs library edits)
    const nutritionEntries = db.createObjectStore('nutritionEntries', { keyPath: 'id' });
    nutritionEntries.createIndex('localDate', 'localDate', { unique: false });
    nutritionEntries.createIndex('sourceMealId', 'sourceMealId', { unique: false });

    // optional per-day completion state ("logged zero" vs "unlogged")
    db.createObjectStore('nutritionDays', { keyPath: 'localDate' });

    // weight entries; isOfficial stored as 0/1 so [localDate, isOfficial] indexes
    const weightEntries = db.createObjectStore('weightEntries', { keyPath: 'id' });
    weightEntries.createIndex('localDate', 'localDate', { unique: false });
    weightEntries.createIndex('localDate_isOfficial', ['localDate', 'isOfficial'], { unique: false });

    // weight goal plans + milestones
    const goalPlans = db.createObjectStore('goalPlans', { keyPath: 'id' });
    goalPlans.createIndex('status', 'status', { unique: false });
    const milestones = db.createObjectStore('milestones', { keyPath: 'id' });
    milestones.createIndex('planId', 'planId', { unique: false });

    // exercise library
    const exercises = db.createObjectStore('exercises', { keyPath: 'id' });
    exercises.createIndex('status', 'status', { unique: false });
    exercises.createIndex('muscleGroup', 'muscleGroup', { unique: false });
    exercises.createIndex('equipment', 'equipment', { unique: false });

    // routines / days / exercises
    const routines = db.createObjectStore('routines', { keyPath: 'id' });
    routines.createIndex('status', 'status', { unique: false });
    const routineDays = db.createObjectStore('routineDays', { keyPath: 'id' });
    routineDays.createIndex('routineId', 'routineId', { unique: false });
    const routineExercises = db.createObjectStore('routineExercises', { keyPath: 'id' });
    routineExercises.createIndex('routineDayId', 'routineDayId', { unique: false });
    routineExercises.createIndex('exerciseId', 'exerciseId', { unique: false });

    // workout sessions + sets
    const workoutSessions = db.createObjectStore('workoutSessions', { keyPath: 'id' });
    workoutSessions.createIndex('localDate', 'localDate', { unique: false });
    workoutSessions.createIndex('routineId', 'routineId', { unique: false });
    const workoutSets = db.createObjectStore('workoutSets', { keyPath: 'id' });
    workoutSets.createIndex('sessionId', 'sessionId', { unique: false });
    workoutSets.createIndex('exerciseId', 'exerciseId', { unique: false });
    // per-exercise chronological history in one range query (localDate denormalized onto sets)
    workoutSets.createIndex('exerciseId_localDate', ['exerciseId', 'localDate'], { unique: false });

    // derived, rebuildable PR/summary cache (raw sets remain authoritative)
    db.createObjectStore('exerciseStats', { keyPath: 'exerciseId' });
  },

  // --- future versions append here, e.g. ---
  // function v2(db, tx, oldVersion) { /* add store/index without deleting data */ },
];

export const SCHEMA_VERSION = MIGRATIONS.length;

let _dbPromise = null;

/** Open (and if needed upgrade) the database. Cached singleton. */
export function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, SCHEMA_VERSION);

    req.onupgradeneeded = (event) => {
      const db = req.result;
      const tx = req.transaction; // versionchange transaction
      const oldVersion = event.oldVersion || 0;
      // Run only the migrations needed to reach SCHEMA_VERSION. Never delete.
      for (let v = oldVersion; v < SCHEMA_VERSION; v++) {
        MIGRATIONS[v](db, tx, oldVersion);
      }
    };

    req.onsuccess = () => {
      const db = req.result;
      // If another tab requests a newer version, close so it isn't blocked.
      db.onversionchange = () => db.close();
      resolve(db);
    };

    req.onerror = () => reject(req.error);
    req.onblocked = () => console.warn('IndexedDB open blocked by another connection');
  });
  return _dbPromise;
}

/** Wrap an IDBRequest as a Promise. */
export function reqAsPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Run `fn(tx)` inside a transaction over `stores` with the given mode, resolving
 * with `fn`'s return value once the transaction completes. Any thrown error
 * aborts the transaction.
 */
export async function tx(stores, mode, fn) {
  const db = await openDB();
  const storeNames = [].concat(stores);
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeNames, mode);
    let result;
    let failed = false;
    t.oncomplete = () => { if (!failed) resolve(result); };
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('transaction aborted'));
    Promise.resolve()
      .then(() => fn(t))
      .then((r) => { result = r; })
      .catch((err) => { failed = true; try { t.abort(); } catch (_) {} reject(err); });
  });
}

// ---- convenience single-store operations ----

export async function put(store, value) {
  return tx(store, 'readwrite', (t) => reqAsPromise(t.objectStore(store).put(value)));
}
export async function get(store, key) {
  return tx(store, 'readonly', (t) => reqAsPromise(t.objectStore(store).get(key)));
}
export async function del(store, key) {
  return tx(store, 'readwrite', (t) => reqAsPromise(t.objectStore(store).delete(key)));
}
export async function getAll(store) {
  return tx(store, 'readonly', (t) => reqAsPromise(t.objectStore(store).getAll()));
}

/** getAll over an index, optionally constrained by an IDBKeyRange. */
export async function getAllByIndex(store, indexName, range) {
  return tx(store, 'readonly', (t) =>
    reqAsPromise(t.objectStore(store).index(indexName).getAll(range)));
}

export { openDB as default };
