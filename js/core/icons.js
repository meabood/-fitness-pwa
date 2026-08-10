// icons.js — trusted, static inline SVG. These strings contain NO user data and
// are the only place `html:` is used in dom.el. Stroke-based, 24×24, currentColor.

const svg = (paths) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const ICONS = {
  home:    svg('<path d="M3 10.5 12 4l9 6.5"/><path d="M5.5 9.5V20h13V9.5"/><path d="M9.5 20v-5h5v5"/>'),
  nutrition: svg('<path d="M7 3v7a3 3 0 0 0 6 0V3"/><path d="M10 3v18"/><path d="M17 3c-1.5 1-2 3-2 6s.5 4 2 4v8"/>'),
  weight:  svg('<circle cx="12" cy="12" r="8"/><path d="M12 12 15 8"/><path d="M8.5 7.5h7"/>'),
  workout: svg('<path d="M4 9v6M20 9v6M7 7v10M17 7v10"/><path d="M7 12h10"/>'),
  stats:   svg('<path d="M4 20V6M4 20h16"/><path d="M8 20v-5M12 20V9M16 20v-8"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M3 12h2M19 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  back:    svg('<path d="M15 5l-7 7 7 7"/>'),   // note: header flips for RTL via CSS if needed
  chevron: svg('<path d="M9 6l6 6-6 6"/>'),
};
