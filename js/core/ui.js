// core/ui.js — small, reusable presentation helpers shared across screens.
// Pure DOM construction on top of dom.el; no data access, no framework. These
// encode the shared design language (hero metrics, segmented control, chips,
// progress, stat lines, empty states, sparklines) so screens stay consistent.

import { el } from './dom.js';
import { ICONS } from './icons.js';

/** Visible exercise title: English only. Built-ins carry nameEn ("Chest Press");
 * custom exercises have only the user-entered name (never renamed in storage). */
export function exerciseTitle(ex) {
  if (!ex) return '';
  return ex.nameEn || ex.name || '';
}

/**
 * A pure, number-led cluster forced to read left-to-right and never wrap:
 * ranges ("55 / 130"), arrows ("106 → 94"), value+unit ("105.7 كجم"), and
 * dates ("1 يناير 2027", "10 Aug 2026"). Use for numeric content whose internal
 * order must be stable regardless of the surrounding RTL context.
 */
export function numericLTR(text) {
  return el('span', { className: 'numeric-ltr', text: String(text) });
}

/** Value + unit as a number-led cluster (value dominant, unit smaller). */
export function valueUnit(value, unit) {
  return el('span', { className: 'val-cluster' }, [
    el('span', { className: 'v', text: String(value) }),
    unit ? el('span', { className: 'u', text: unit }) : null,
  ].filter(Boolean));
}

/** Refined vertical reorder control: two accessible up/down buttons. */
export function reorderControl({ onUp, onDown, labelUp = 'تحريك لأعلى', labelDown = 'تحريك لأسفل' } = {}) {
  const up = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg>';
  const down = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
  return el('div', { className: 'reorder' }, [
    el('button', { attrs: { 'aria-label': labelUp }, html: up, onClick: onUp }),
    el('button', { attrs: { 'aria-label': labelDown }, html: down, onClick: onDown }),
  ]);
}

/** Large screen title with optional subtitle (string or Node) + trailing action. */
export function pageHead(title, { sub = null, actionLabel = null, onAction = null } = {}) {
  let subNode = null;
  if (sub != null) {
    subNode = (typeof sub === 'object' && sub.nodeType) ? sub : el('div', { className: 'ph-sub num', text: sub });
    if (subNode.classList && !subNode.classList.contains('ph-sub')) subNode.classList.add('ph-sub');
  }
  return el('div', { className: 'page-head' }, [
    el('div', {}, [
      el('div', { className: 'ph-title', text: title }),
      subNode,
    ].filter(Boolean)),
    actionLabel ? el('button', { className: 'ph-action', text: actionLabel, onClick: onAction }) : null,
  ].filter(Boolean));
}

/** Segmented control. items:[{key,label}] → calls onChange(key). */
export function segmented(items, value, onChange) {
  return el('div', { className: 'seg', attrs: { role: 'tablist' } }, items.map((it) =>
    el('button', {
      className: it.key === value ? 'on' : '', attrs: { role: 'tab', 'aria-selected': it.key === value ? 'true' : 'false' },
      text: it.label, onClick: () => it.key !== value && onChange(it.key),
    })));
}

/** Chip row (single-select). items:[{key,label}] → onChange(key). */
export function chips(items, value, onChange, { scroll = false } = {}) {
  return el('div', { className: `chips${scroll ? ' scroll' : ''}` }, items.map((it) =>
    el('button', {
      className: `chip${it.key === value ? ' on' : ''}`, attrs: { 'aria-pressed': it.key === value ? 'true' : 'false' },
      text: it.label, onClick: () => onChange(it.key),
    })));
}

/**
 * Hero metric block. value/unit dominate; caption above, sub below.
 * sub can be an array of nodes/strings.
 */
export function hero({ cap = null, value, unit = null, sub = null } = {}) {
  return el('div', { className: 'hero' }, [
    cap ? el('div', { className: 'cap', text: cap }) : null,
    el('div', { className: 'val' }, [
      el('span', { className: 'n num', text: String(value) }),
      unit ? el('span', { className: 'u', text: unit }) : null,
    ].filter(Boolean)),
    sub ? el('div', { className: 'sub' }, [].concat(sub).filter(Boolean)) : null,
  ].filter(Boolean));
}

/** Progress bar. ratio 0..1 (values >1 clamp and flag `over`). */
export function progress(ratio, { over = false, thin = false } = {}) {
  const pct = Math.max(0, Math.min(1, ratio)) * 100;
  return el('div', { className: `progress${over ? ' over' : ''}${thin ? ' thin' : ''}`, attrs: { role: 'progressbar' } }, [
    el('i', { style: { width: `${pct}%` } }),
  ]);
}

/** Label · value line for quiet stat lists. value may be a string or a Node.
 * tone: 'down'|'up'|'flat'|null. */
export function statLine(label, value, { tone = null } = {}) {
  const valueNode = (value && typeof value === 'object' && value.nodeType)
    ? value
    : el('span', { className: `sl-value num${tone ? ` delta ${tone}` : ''}`, text: value });
  if (valueNode.classList && !valueNode.classList.contains('sl-value')) valueNode.classList.add('sl-value');
  return el('div', { className: 'statline' }, [
    el('span', { className: 'sl-label', text: label }),
    valueNode,
  ]);
}

/** Empty state: quiet icon, brief title, optional primary action. */
export function emptyState({ icon = 'stats', title, hint = null, actionLabel = null, onAction = null } = {}) {
  return el('div', { className: 'empty' }, [
    el('div', { className: 'empty-ico', html: ICONS[icon] || ICONS.stats }),
    el('div', { className: 'empty-title', text: title }),
    hint ? el('p', { className: 'muted', text: hint }) : null,
    actionLabel ? el('button', { className: 'btn btn-primary', text: actionLabel, onClick: onAction }) : null,
  ].filter(Boolean));
}

/**
 * Tiny inline sparkline (local SVG). points:[{x,y|null}] with null=gap.
 * Draws a single accent line, no axes — for at-a-glance trend only.
 */
export function sparkline(points, { width = 120, height = 34, color = 'var(--accent)', strokeWidth = 2 } = {}) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('aria-hidden', 'true');
  svg.style.display = 'block';
  const xs = points.filter((p) => p.x != null).map((p) => p.x);
  const ys = points.filter((p) => p.y != null).map((p) => p.y);
  if (ys.length >= 2) {
    const xMin = Math.min(...xs), xMax = Math.max(...xs) || xMin + 1;
    let yMin = Math.min(...ys), yMax = Math.max(...ys);
    if (yMax === yMin) { yMax += 1; yMin -= 1; }
    const pad = 3;
    const sx = (x) => pad + ((x - xMin) / (xMax - xMin || 1)) * (width - pad * 2);
    const sy = (y) => pad + (1 - (y - yMin) / (yMax - yMin)) * (height - pad * 2);
    let d = '', pen = false;
    for (const p of points) {
      if (p.y == null || p.x == null) { pen = false; continue; }
      d += `${pen ? 'L' : 'M'}${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)} `;
      pen = true;
    }
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d.trim());
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', String(strokeWidth));
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
    // end dot
    const last = [...points].reverse().find((p) => p.y != null);
    if (last) {
      const dot = document.createElementNS(NS, 'circle');
      dot.setAttribute('cx', sx(last.x).toFixed(1));
      dot.setAttribute('cy', sy(last.y).toFixed(1));
      dot.setAttribute('r', '2.5');
      dot.setAttribute('fill', color);
      svg.appendChild(dot);
    }
  }
  return svg;
}
