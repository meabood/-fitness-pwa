// meta.js — app-level constants shared across modules (kept dependency-free to
// avoid circular imports).

export const APP_VERSION = '0.16.2'; // LOCKD branding + icon, manual nutrition live total, workout set-grid simplification

// Single source of truth for the product name. The manifest + index.html carry
// their own copies (they load before any module), so update all three together
// when rebranding.
export const APP_NAME = 'LOCKD';
