/**
 * draw/chordDiagram.js — one chord diagram (fretboard box): strings
 * vertical (low → high, left → right), frets horizontal, a nut when the
 * window starts at fret 1 else "Nfr" right of the first row, dots, a solid
 * rounded barre, ○ / × above the strings, fingers below, and the chord
 * name centred above. Primitives only (lines, rects, circles, paths,
 * text), so layout/ink.js measures it exactly. Placement (which beats,
 * the shared row height and name baseline) is pass 6's job
 * (draw/passes/chordsFermatas.js); shapes come from chordShapes.js.
 *
 * All sizes are in staff spaces (sp), so the diagram scales with
 * `theme.staffLineSpacing`.
 */
import { group, line, rect, circle, path, text, svgD } from './svgUtil.js';
import { renderChordSymbol, chordSymbolFontSize } from './notation.js';
import { TEXT_ASCENT_EM } from '../layout/ink.js';
import { estimateTextWidth } from '../textMetrics.js';

export const STRING_GAP_SP = 1.0;      // between two string lines
export const FRET_GAP_SP = 1.2;        // between two fret lines (one row)
const GRID_LINE_SP = 0.1;              // string / fret line thickness (butt caps)
const NUT_SP = 0.4;                    // nut thickness; its bottom edge on the grid top
const DOT_R_SP = 0.4;                  // fretted-note dot radius
const BARRE_H_SP = 0.8;                // barre bar height (rounded ends, rx = half the height)
const OPEN_R_SP = 0.3;                 // ○ radius
const OPEN_STROKE_SP = 0.1;
const MUTED_ARM_SP = 0.3;              // × half width / height
const MUTED_STROKE_SP = 0.12;
const MARKER_CY_SP = 1.0;              // ○ / × centre above the grid top
const LABEL_SIZE_SP = 1.0;             // "Nfr" and finger font size
const BASE_FRET_GAP_SP = 0.3;          // rightmost dot edge -> "Nfr"
const BASE_FRET_BASELINE_EM = 0.3;     // "Nfr" baseline below the first row's centre (em of its size)
const FINGER_BASELINE_SP = 1.1;        // grid bottom -> finger baseline
const LABEL_DESCENT_SP = 0.25;         // finger text ink below its baseline (TEXT_DESCENT_EM at 1 sp)
export const NAME_GAP_SP = 0.3;        // diagram top -> chord-name text bottom

const baseFretLabel = (baseFret) => `${baseFret}fr`;

/**
 * Horizontal and vertical extents of a diagram drawn with `rows` rows, in
 * px relative to its centre x and its grid: `left` / `right` of the
 * centre (dots at the outer strings, plus "Nfr" on the right), `aboveGrid`
 * (○ / × markers, else the nut or half a fret line), `gridH`, `belowGrid`
 * (fingers, else half a fret line).
 */
export function chordDiagramMetrics(shape, rows, theme) {
  const s = theme.staffLineSpacing;
  const n = shape.frets.length;
  const half = ((n - 1) / 2) * STRING_GAP_SP * s + DOT_R_SP * s;
  const fr = shape.baseFret > 1
    ? BASE_FRET_GAP_SP * s + estimateTextWidth(baseFretLabel(shape.baseFret), LABEL_SIZE_SP * s)
    : 0;
  const markerTop = MARKER_CY_SP + OPEN_R_SP + OPEN_STROKE_SP / 2;
  let aboveGrid = GRID_LINE_SP / 2;
  if (shape.hasMarkers) aboveGrid = markerTop;
  else if (shape.showNut) aboveGrid = NUT_SP;
  return {
    left: half,
    right: half + fr,
    aboveGrid: aboveGrid * s,
    gridH: rows * FRET_GAP_SP * s,
    belowGrid: (shape.hasFingers ? FINGER_BASELINE_SP + LABEL_DESCENT_SP : GRID_LINE_SP / 2) * s,
  };
}

/**
 * Draw one diagram into `g`: `shape` from chordShapes.validateShape,
 * centred on `cx`, grid bottom at `gridBottom`, `rows` rows (≥ shape.rows),
 * and the chord `name` (if any) centred above on baseline `nameY`.
 * Returns the diagram's box `{ x1, x2, top }` (name included).
 */
export function renderChordDiagram(g, { cx, gridBottom, rows, shape, name, nameY }, theme) {
  const s = theme.staffLineSpacing;
  const color = theme.noteColor;
  const n = shape.frets.length;
  const m = chordDiagramMetrics(shape, rows, theme);
  const gridTop = gridBottom - m.gridH;
  const colX = (c) => cx + (c - (n - 1) / 2) * STRING_GAP_SP * s;
  const rowY = (fret) => gridTop + (fret - shape.baseFret + 0.5) * FRET_GAP_SP * s;
  const lw = GRID_LINE_SP * s;
  const xL = colX(0) - lw / 2;           // grid outer edges (half a string line out)
  const xR = colX(n - 1) + lw / 2;
  const labelSize = LABEL_SIZE_SP * s;
  const labelAttrs = { 'font-family': theme.textFontFamily, 'font-size': labelSize, fill: color };

  const out = group({ class: 'chord-diagram' });
  const grid = group({ class: 'chord-diagram-grid' });
  const stroke = { stroke: color, 'stroke-width': lw, 'stroke-linecap': 'butt' };
  for (let c = 0; c < n; c++) grid.appendChild(line(colX(c), gridTop, colX(c), gridBottom, stroke));
  for (let k = shape.showNut ? 1 : 0; k <= rows; k++) {
    const y = gridTop + k * FRET_GAP_SP * s;
    grid.appendChild(line(xL, y, xR, y, stroke));
  }
  if (shape.showNut) {
    grid.appendChild(line(xL, gridTop - (NUT_SP / 2) * s, xR, gridTop - (NUT_SP / 2) * s, {
      class: 'chord-diagram-nut', stroke: color, 'stroke-width': NUT_SP * s, 'stroke-linecap': 'butt',
    }));
  }
  out.appendChild(grid);

  if (shape.baseFret > 1) {
    out.appendChild(text(colX(n - 1) + (DOT_R_SP + BASE_FRET_GAP_SP) * s, rowY(shape.baseFret) + BASE_FRET_BASELINE_EM * labelSize,
      baseFretLabel(shape.baseFret), { class: 'chord-diagram-base-fret', ...labelAttrs, 'text-anchor': 'start' }));
  }

  const { barre } = shape;
  if (barre) {
    const h = BARRE_H_SP * s;
    out.appendChild(rect(colX(barre.cLo) - DOT_R_SP * s, rowY(barre.fret) - h / 2,
      colX(barre.cHi) - colX(barre.cLo) + 2 * DOT_R_SP * s, h, { class: 'chord-diagram-barre', rx: h / 2, ry: h / 2, fill: color }));
  }

  const markerY = gridTop - MARKER_CY_SP * s;
  shape.frets.forEach((fret, c) => {
    const x = colX(c);
    if (fret === null) {
      const a = MUTED_ARM_SP * s;
      out.appendChild(path(svgD`M ${x - a} ${markerY - a} L ${x + a} ${markerY + a} M ${x - a} ${markerY + a} L ${x + a} ${markerY - a}`, {
        class: 'chord-diagram-muted', fill: 'none', stroke: color, 'stroke-width': MUTED_STROKE_SP * s,
      }));
    } else if (fret === 0) {
      out.appendChild(circle(x, markerY, OPEN_R_SP * s, {
        class: 'chord-diagram-open', fill: 'none', stroke: color, 'stroke-width': OPEN_STROKE_SP * s,
      }));
    } else if (!(barre && fret === barre.fret && c >= barre.cLo && c <= barre.cHi)) {
      out.appendChild(circle(x, rowY(fret), DOT_R_SP * s, { class: 'chord-diagram-fret', fill: color }));
    }
  });

  if (shape.fingers) {
    shape.fingers.forEach((f, c) => {
      if (f === null) return;
      out.appendChild(text(colX(c), gridBottom + FINGER_BASELINE_SP * s, String(f),
        { class: 'chord-diagram-finger', ...labelAttrs, 'text-anchor': 'middle' }));
    });
  }

  let x1 = cx - m.left;
  let x2 = cx + m.right;
  let top = gridTop - m.aboveGrid;
  if (name) {
    const size = chordSymbolFontSize(theme);
    renderChordSymbol(out, cx, nameY, name, theme, 'middle');
    const w = estimateTextWidth(name, size, { bold: true });
    x1 = Math.min(x1, cx - w / 2);
    x2 = Math.max(x2, cx + w / 2);
    top = Math.min(top, nameY - TEXT_ASCENT_EM * size);
  }
  g.appendChild(out);
  return { x1, x2, top };
}
