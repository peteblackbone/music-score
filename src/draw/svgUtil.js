/**
 * svgUtil.js — tiny helpers for building SVG elements without a framework.
 * Every number written to the SVG is rounded to 2 decimals (`r2`): numeric
 * attributes in `el()`, path data via the `svgD` tagged template.
 */
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Round to 2 decimals; never returns -0. */
export function r2(v) {
  const r = Math.round(v * 100) / 100;
  return r === 0 ? 0 : r;
}

/**
 * Tagged template for path data / transforms: numbers are rounded with r2,
 * strings (e.g. a nested svgD result) pass through unchanged.
 *   svgD`M ${x} ${y} L ${x2} ${y2}`
 */
export function svgD(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => {
    out += (typeof v === 'number' ? String(r2(v)) : String(v)) + strings[i + 1];
  });
  return out;
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    node.setAttribute(k, typeof v === 'number' ? String(r2(v)) : String(v));
  }
  for (const child of children) node.appendChild(child);
  return node;
}

export function line(x1, y1, x2, y2, attrs = {}) {
  return el('line', { x1, y1, x2, y2, ...attrs });
}

export function text(x, y, str, attrs = {}) {
  const node = el('text', { x, y, ...attrs });
  node.textContent = str;
  return node;
}

export function glyphText(x, y, str, fontFamily, fontSizePx, attrs = {}) {
  return text(x, y, str, {
    'font-family': fontFamily,
    'font-size': fontSizePx,
    ...attrs,
  });
}

export function group(attrs = {}, children = []) {
  return el('g', attrs, children);
}

export function path(d, attrs = {}) {
  return el('path', { d, ...attrs });
}

export function circle(cx, cy, r, attrs = {}) {
  return el('circle', { cx, cy, r, ...attrs });
}

export function rect(x, y, width, height, attrs = {}) {
  return el('rect', { x, y, width, height, ...attrs });
}

/**
 * Build the `d` for a wavy horizontal line from x1 to x2 at height y —
 * alternating small quadratic-bezier bumps up/down, sine-wave-like. Used
 * for vibrato marks on both the notation and tab staves.
 */
export function wavyPathD(x1, x2, y, amplitude, wavelength) {
  let d = svgD`M ${x1} ${y}`;
  let x = x1;
  let up = true;
  while (x < x2 - wavelength / 14) { // stop short of a sliver segment (0.5 px at the default 7 px wavelength)
    const nx = Math.min(x + wavelength / 2, x2);
    const mx = (x + nx) / 2;
    d += svgD` Q ${mx} ${y + (up ? -amplitude : amplitude)} ${nx} ${y}`;
    x = nx;
    up = !up;
  }
  return d;
}

/**
 * wavyPathD turned upright: the `d` for a wavy vertical line at x from y1
 * to y2 (either way up), its bumps alternating left/right. Used for
 * arpeggio lines (draw/arpeggio.js).
 */
export function wavyPathDVertical(x, y1, y2, amplitude, wavelength) {
  const dir = y2 >= y1 ? 1 : -1;
  let d = svgD`M ${x} ${y1}`;
  let y = y1;
  let left = true;
  while ((y2 - y) * dir > wavelength / 14) { // stop short of a sliver segment, as wavyPathD does
    const ny = dir > 0 ? Math.min(y + wavelength / 2, y2) : Math.max(y - wavelength / 2, y2);
    const my = (y + ny) / 2;
    d += svgD` Q ${x + (left ? -amplitude : amplitude)} ${my} ${x} ${ny}`;
    y = ny;
    left = !left;
  }
  return d;
}
