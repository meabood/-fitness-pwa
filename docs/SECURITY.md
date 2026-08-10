# Security (interim — Stage 1)

This is the running security summary. A full source audit against the complete
checklist is performed at Stage 12; the answers below reflect the code as of
Stage 1 and are expected to hold throughout.

| Question | Answer |
|---|---|
| External APIs | No |
| External services | No |
| Analytics | No |
| Tracking | No |
| Cloud synchronization | No |
| Personal data transmitted | No |
| Requested device permissions | None (no camera/mic/location/contacts/BLE/notifications) |
| Runtime external dependencies | None |
| Local data store | IndexedDB (`fitnessDB`) on the device |

## Controls in place now

- **Strict CSP** in `index.html`: `default-src 'self'`, `connect-src 'none'`,
  `object-src 'none'`, `frame-src 'none'`, `base-uri 'none'`, no external
  script/style/font sources. (`connect-src 'none'` structurally blocks
  `fetch`/XHR/WebSocket/EventSource for app data.)
- **No network I/O for data.** The app contains no `fetch`/`XMLHttpRequest`/
  `WebSocket`/`EventSource` calls. The service worker fetches only the app's own
  same-origin static assets for install/update; it never handles personal data.
- **Safe DOM rendering.** All user text is rendered via `textContent` /
  `createTextNode` in `js/core/dom.js`. `innerHTML` is used only for trusted,
  static inline SVG icons that contain no user data. No `eval` / `new Function`.
- **Service worker scope.** Caches only static shell assets under a versioned
  cache; on update it deletes only old static caches and never touches IndexedDB,
  so updates cannot erase history.
- **No cookies, no storage of secrets** (there are none — no accounts/auth).

## Notes / to re-verify at Stage 12

- Re-grep the full source for the banned APIs above once all modules exist.
- Confirm backup import validation rejects malformed/oversized/legacy files
  before touching the live DB (Stage 10).
- Confirm no user-controlled string ever reaches `innerHTML` as new features add
  rendering paths.
