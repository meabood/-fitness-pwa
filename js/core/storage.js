// storage.js — persistent-storage durability helper.
//
// Approved policy (adjustment #1):
//  * Do NOT call navigator.storage.persist() automatically on startup.
//  * We may safely CHECK navigator.storage.persisted().
//  * A request is only made on an explicit user action (a button in Settings).
//  * Persistent storage is only an ADDITIONAL durability measure. It is never a
//    replacement for manual JSON backups, and the UI says so.

/** Is the Storage manager available? */
export function storageSupported() {
  return typeof navigator !== 'undefined' && !!navigator.storage;
}

/** Passive check — does the origin already have persistent storage? Never prompts. */
export async function isPersisted() {
  if (!storageSupported() || !navigator.storage.persisted) return false;
  try { return await navigator.storage.persisted(); } catch { return false; }
}

/**
 * Explicit, user-initiated request for persistent storage. Call ONLY from a
 * button handler. Returns the resulting boolean (may be granted silently by the
 * platform, prompted, or denied — behavior is platform-specific, incl. iOS).
 */
export async function requestPersist() {
  if (!storageSupported() || !navigator.storage.persist) return false;
  try { return await navigator.storage.persist(); } catch { return false; }
}

/** Best-effort storage estimate { usage, quota } in bytes, or null. */
export async function estimate() {
  if (!storageSupported() || !navigator.storage.estimate) return null;
  try { return await navigator.storage.estimate(); } catch { return null; }
}
