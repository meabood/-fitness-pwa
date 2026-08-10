// core/ui.js — small, reusable presentation helpers shared across screens.
// Pure DOM construction on top of dom.el; no data access, no framework. These
// encode the shared design language (hero metrics, segmented control, chips,
// progress, stat lines, empty states, sparklines) so screens stay consistent.

import { el } from './dom.js';
import { ICONS } from './icons.js';

/** Large screen title with optional subtitle + trailing action. */
export function pageHead(title, { sub = null, actionLabel = null, onAction = null } = {}) {
  return el('div', { className: 'page-head' }, [
    el('div', {}, [
      el('div', { className: 'ph-title', text: title }),
      sub ? el('div', { className: 'ph-sub num', text: sub }) : null,
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

/** Label · value line for quiet stat lists. tone: 'down'|'up'|'flat'|null. */
export function statLine(label, value, { tone = null } = {}) {
  return el('div', { className: 'statline' }, [
    el('span', { className: 'sl-label', text: label }),
    el('span', { className: `sl-value num${tone ? ` delta ${tone}` : ''}`, text: value }),
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
