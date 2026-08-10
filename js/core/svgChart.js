// core/svgChart.js — a tiny, dependency-free SVG chart builder (no CDN, no libs).
// Produces an <svg> element. Supports multiple line series, dashed lines (for a
// target/trajectory), point markers (for milestones/records), and GAPS: a point
// with y == null breaks the line so unlogged days are never drawn as zero.

const NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}, children = []) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, String(attrs[k]));
  for (const c of [].concat(children)) if (c) e.appendChild(c);
  return e;
}

/**
 * @param {object} cfg
 *   series: [{ points:[{x:number,y:number|null}], color, dashed?, strokeWidth?, showPoints?, pointRadius? }]
 *   xMin,xMax,yMin,yMax  domains (auto-derived from data when omitted)
 *   width,height         viewBox size (renders responsive to container width)
 *   formatY, formatX     tick label formatters
 *   xTicks: [{x,label}]  explicit x tick positions/labels
 *   yTicksCount          number of horizontal gridlines (default 4)
 *   ariaLabel
 */
export function lineChart(cfg) {
  const {
    series = [], width = 340, height = 210,
    padding = { t: 12, r: 14, b: 26, l: 40 },
    formatY = (v) => `${Math.round(v)}`, xTicks = [], yTicksCount = 4, ariaLabel = 'مخطط',
  } = cfg;

  const allX = [], allY = [];
  for (const s of series) for (const p of s.points) { if (p.x != null) allX.push(p.x); if (p.y != null) allY.push(p.y); }
  const hasData = allY.length > 0;
  let { xMin, xMax, yMin, yMax } = cfg;
  if (xMin == null) xMin = hasData ? Math.min(...allX) : 0;
  if (xMax == null) xMax = hasData ? Math.max(...allX) : 1;
  if (yMin == null) yMin = hasData ? Math.min(...allY) : 0;
  if (yMax == null) yMax = hasData ? Math.max(...allY) : 1;
  if (xMax === xMin) xMax = xMin + 1;
  if (yMax === yMin) { yMax = yMin + 1; yMin = yMin - 1; }
  // pad y domain a little for breathing room
  const yPad = (yMax - yMin) * 0.08; yMin -= yPad; yMax += yPad;

  const iw = width - padding.l - padding.r;
  const ih = height - padding.t - padding.b;
  const sx = (x) => padding.l + ((x - xMin) / (xMax - xMin)) * iw;
  const sy = (y) => padding.t + (1 - (y - yMin) / (yMax - yMin)) * ih;

  const kids = [];

  // y gridlines + labels
  for (let i = 0; i <= yTicksCount; i++) {
    const v = yMin + (i / yTicksCount) * (yMax - yMin);
    const yy = sy(v);
    kids.push(svgEl('line', { x1: padding.l, y1: yy, x2: width - padding.r, y2: yy, stroke: 'var(--border)', 'stroke-width': 1 }));
    kids.push(svgEl('text', { x: padding.l - 6, y: yy + 3, 'text-anchor': 'end', 'font-size': 10, fill: 'var(--text-2)' }, [document.createTextNode(formatY(v))]));
  }
  // x ticks
  for (const t of xTicks) {
    const xx = sx(t.x);
    kids.push(svgEl('text', { x: xx, y: height - padding.b + 14, 'text-anchor': 'middle', 'font-size': 10, fill: 'var(--text-2)' }, [document.createTextNode(t.label)]));
  }

  // series
  for (const s of series) {
    const color = s.color || 'var(--accent)';
    // build path with gaps (null y breaks the line)
    let d = '', pen = false;
    for (const p of s.points) {
      if (p.y == null || p.x == null) { pen = false; continue; }
      const X = sx(p.x), Y = sy(p.y);
      d += `${pen ? 'L' : 'M'}${X.toFixed(1)} ${Y.toFixed(1)} `;
      pen = true;
    }
    if (d && s.showLine !== false) {
      kids.push(svgEl('path', { d: d.trim(), fill: 'none', stroke: color, 'stroke-width': s.strokeWidth || 2, 'stroke-dasharray': s.dashed ? '5 4' : null, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    }
    if (s.showPoints) {
      for (const p of s.points) if (p.y != null && p.x != null) {
        kids.push(svgEl('circle', { cx: sx(p.x), cy: sy(p.y), r: s.pointRadius || 2.5, fill: color }));
      }
    }
  }

  if (!hasData) {
    kids.push(svgEl('text', { x: width / 2, y: height / 2, 'text-anchor': 'middle', 'font-size': 12, fill: 'var(--text-2)' }, [document.createTextNode('لا توجد بيانات كافية')]));
  }

  return svgEl('svg', {
    viewBox: `0 0 ${width} ${height}`, width: '100%', height: 'auto',
    role: 'img', 'aria-label': ariaLabel, style: 'display:block',
  }, kids);
}

/** A small colored legend row. items: [{label,color,dashed}]. */
export function legend(items) {
  const el = document.createElement('div');
  el.className = 'chart-legend';
  for (const it of items) {
    const row = document.createElement('span');
    row.className = 'legend-item';
    const sw = document.createElement('span');
    sw.className = 'legend-swatch';
    sw.style.background = it.dashed ? 'transparent' : it.color;
    sw.style.borderTop = it.dashed ? `2px dashed ${it.color}` : 'none';
    row.appendChild(sw);
    row.appendChild(document.createTextNode(it.label));
    el.appendChild(row);
  }
  return el;
}
