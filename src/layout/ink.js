/**
 * layout/ink.js — vertical ink extents of an already-drawn staff group,
 * computed from the nodes' own attributes (no getBBox, so it also works in
 * the test DOM). Used by layout/vertical.js to space staves by content.
 *
 * Supported: <line> (y1/y2 ± half stroke projected on y; full half stroke
 * with round/square caps), <rect> (y..y+height), <circle>
 * (cy ± r), <path> (every y in `d`; absolute M/L/C/Q/Z commands only — a
 * curve's control points over-estimate slightly, which is fine), <text>
 * (music-font glyphs: glyph box from glyphMetrics.js scaled by font-size/4;
 * other text: y − TEXT_ASCENT_EM·size .. y + TEXT_DESCENT_EM·size) and nested <g>.
 *
 * `opts.overlap` (opt-in) judges nodes by their horizontal extent instead
 * of their anchor (see nodeExtent; text widths are estimated).
 *
 * Staff groups must not contain nested `transform`s (rotations etc.):
 * coordinates are read as if every node were in the group's own space.
 */
import { glyphBox, hasGlyphBox, glyphStringBox } from '../glyphMetrics.js';
import { estimateTextWidth } from '../textMetrics.js';

const num = (n, a, d = 0) => {
  const v = n.getAttribute ? n.getAttribute(a) : null;
  return v == null ? d : Number(v);
};

/** Estimated ink above / below the baseline of non-music text, as a fraction of its font size. */
export const TEXT_ASCENT_EM = 0.8;
export const TEXT_DESCENT_EM = 0.25;

/**
 * Every x (axis 'x') or y (axis 'y') in a path's `d`: absolute M/L/C/Q/Z
 * commands only, coordinates taken as alternating x, y pairs.
 */
function pathCoords(d, axis) {
  const tokens = String(d).match(/[MLCQZ]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [];
  const parity = axis === 'y' ? 1 : 0;
  const out = [];
  let cmd = null; let idx = 0;
  for (const t of tokens) {
    if (/^[MLCQZ]$/i.test(t)) { cmd = t.toUpperCase(); idx = 0; continue; }
    if (cmd === 'Z' || cmd == null) continue;
    if (idx % 2 === parity) out.push(Number(t));
    idx++;
  }
  return out;
}

/** Whether `n` is music-font text: theme.fontFamily and at least one char with a glyph box. */
function isMusicText(n, theme) {
  const family = n.getAttribute('font-family') || '';
  return family === theme.fontFamily && [...(n.textContent || '')].some((ch) => hasGlyphBox(ch));
}

function textBounds(n, theme) {
  const y = num(n, 'y');
  const size = num(n, 'font-size', 16);
  const str = n.textContent || '';
  if (isMusicText(n, theme)) {
    let top = -Infinity; let bottom = Infinity;
    for (const ch of str) {
      const b = glyphBox(ch);
      top = Math.max(top, b.top); bottom = Math.min(bottom, b.bottom);
    }
    const scale = size / 4; // 1 sp = font-size / 4 for SMuFL fonts
    return { top: y - top * scale, bottom: y - bottom * scale };
  }
  return { top: y - TEXT_ASCENT_EM * size, bottom: y + TEXT_DESCENT_EM * size };
}

/** Leftmost x a node starts at (line/rect/circle/text anchor, a path's first point), or null. */
function nodeX(n, tag) {
  switch (tag) {
    case 'line': return Math.min(num(n, 'x1'), num(n, 'x2'));
    case 'rect': case 'text': return num(n, 'x');
    case 'circle': return num(n, 'cx');
    case 'path': {
      const m = /-?\d*\.?\d+/.exec(String(n.getAttribute('d')));
      return m ? Number(m[0]) : null;
    }
    default: return null;
  }
}

/**
 * Horizontal extent `{ x1, x2 }` of a leaf node, or null (groups, unknown
 * tags, empty paths): line x1..x2; rect x..x+width; circle cx ± r; path
 * min..max of its x coordinates; music-font text its glyph box scaled by
 * font-size/4; other text its estimated width (bold when font-weight is
 * bold). Text is shifted by its text-anchor (middle / end).
 */
function nodeExtent(n, tag, theme) {
  switch (tag) {
    case 'line': return { x1: Math.min(num(n, 'x1'), num(n, 'x2')), x2: Math.max(num(n, 'x1'), num(n, 'x2')) };
    case 'rect': return { x1: num(n, 'x'), x2: num(n, 'x') + num(n, 'width') };
    case 'circle': return { x1: num(n, 'cx') - num(n, 'r'), x2: num(n, 'cx') + num(n, 'r') };
    case 'path': {
      const xs = pathCoords(n.getAttribute('d'), 'x');
      return xs.length ? { x1: Math.min(...xs), x2: Math.max(...xs) } : null;
    }
    case 'text': {
      const x = num(n, 'x');
      const size = num(n, 'font-size', 16);
      const str = n.textContent || '';
      let left; let w;
      if (isMusicText(n, theme)) {
        const b = glyphStringBox(str);
        left = b.left * (size / 4); w = b.width * (size / 4);
      } else {
        left = 0; w = estimateTextWidth(str, size, { bold: n.getAttribute('font-weight') === 'bold' });
      }
      const anchor = n.getAttribute('text-anchor');
      const shift = anchor === 'middle' ? -w / 2 : anchor === 'end' ? -w : 0;
      return { x1: x + left + shift, x2: x + left + w + shift };
    }
    default: return null;
  }
}

/**
 * Top (smallest y) and bottom (largest y) of all ink in `g`, in g's local
 * px coordinates. Returns `{ top: Infinity, bottom: -Infinity }` if empty.
 * `opts.xMax` / `opts.xMin`: only count nodes that start at or left /
 * at or right of this x (approximate: a node is judged by its anchor /
 * first point). With `opts.overlap: true` a node counts when its
 * horizontal extent (nodeExtent) overlaps [xMin, xMax] instead; nodes
 * without an extent (groups) are always visited.
 */
export function inkBounds(g, theme, opts = {}) {
  let top = Infinity; let bottom = -Infinity;
  const add = (a, b) => { top = Math.min(top, a, b); bottom = Math.max(bottom, a, b); };
  const visit = (n) => {
    const tag = n.tag || (n.tagName || '').toLowerCase();
    if (opts.overlap) {
      const e = nodeExtent(n, tag, theme);
      if (e && (e.x2 < (opts.xMin ?? -Infinity) || e.x1 > (opts.xMax ?? Infinity))) return;
    } else {
      const x = opts.xMax != null || opts.xMin != null ? nodeX(n, tag) : null;
      if (x != null && (x > (opts.xMax ?? Infinity) || x < (opts.xMin ?? -Infinity))) return;
    }
    switch (tag) {
      case 'line': {
        // Half the stroke, projected on y: a butt-capped vertical line
        // (barline, stem) ends exactly at its end points.
        const dx = num(n, 'x2') - num(n, 'x1'); const dy = num(n, 'y2') - num(n, 'y1');
        const len = Math.hypot(dx, dy);
        const capped = ['round', 'square'].includes(n.getAttribute ? n.getAttribute('stroke-linecap') : null);
        const h = (num(n, 'stroke-width', 1) / 2) * (capped || len === 0 ? 1 : Math.abs(dx) / len);
        add(Math.min(num(n, 'y1'), num(n, 'y2')) - h, Math.max(num(n, 'y1'), num(n, 'y2')) + h);
        break;
      }
      case 'rect': add(num(n, 'y'), num(n, 'y') + num(n, 'height')); break;
      case 'circle': add(num(n, 'cy') - num(n, 'r'), num(n, 'cy') + num(n, 'r')); break;
      case 'path': {
        const ys = pathCoords(n.getAttribute('d'), 'y');
        if (ys.length) add(Math.min(...ys), Math.max(...ys));
        break;
      }
      case 'text': { const b = textBounds(n, theme); add(b.top, b.bottom); break; }
      default: break;
    }
    for (const c of n.children || []) visit(c);
  };
  visit(g);
  return { top, bottom };
}
