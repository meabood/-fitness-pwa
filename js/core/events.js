// events.js — minimal in-memory pub/sub so an edit in one module can tell open
// views to re-render from fresh derivations. No storage, no network.
//
// Convention for topic names (used from Stage 2 onward):
//   'weight:changed'    — a weight entry was added/edited/deleted
//   'goals:changed'     — goal plan or milestones changed
//   'nutrition:changed' — a nutrition entry or day changed
//   'meals:changed'     — meal library changed
//   'workout:changed'   — a session/set changed (payload may carry exerciseId)
//   'settings:changed'  — settings/targets changed

const listeners = new Map(); // topic -> Set<fn>

export function on(topic, fn) {
  if (!listeners.has(topic)) listeners.set(topic, new Set());
  listeners.get(topic).add(fn);
  return () => off(topic, fn); // unsubscribe handle
}

export function off(topic, fn) {
  listeners.get(topic)?.delete(fn);
}

export function emit(topic, payload) {
  listeners.get(topic)?.forEach((fn) => {
    try { fn(payload); } catch (err) { console.error(`listener for "${topic}" failed`, err); }
  });
}
