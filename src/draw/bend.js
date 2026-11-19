/**
 * draw/bend.js — a compound bend on one TAB note (directions.js bendOf with
 * a `rebend`): bend-release-bend or pre-bend-release-bend, drawn as rise,
 * release fall and second rise, each capped by an arrowhead, with the two
 * amounts labelled over their peaks. Single bends stay in draw/tab.js
 * (renderBend); this module only adds the rise–fall–rise shape.
 */
import { arrowheadDir, bendSemitones, BEND_STROKE_WIDTH, ARROWHEAD_HALF_WIDTH } from './tab.js';
import { group, text, path, rect, svgD } from './svgUtil.js';

const REBEND_RISE_SP = 1.0;        // a rise's horizontal run (start -> peak)
const REBEND_FALL_SP = 1.2;        // the release fall's horizontal run (peak 1 -> foot)
const REBEND_MIN_FALL_SP = 0.6;    // squeezed by the next note, the fall still keeps this run
const REBEND_LABEL_GAP_SP = 0.3;   // between the two amount labels' knock-outs, side by side
const REBEND_LABEL_STACK_SP = 0.2; // ...or, staggered, between label 2's knock-out and label 1's

/** Height of a bend arc as a fraction of the full-step height: semitones / 2, clamped to 0.55..1.3 (as for single bends). */
export function bendHeightFrac(amount) {
  return Math.max(0.55, Math.min(1.3, bendSemitones(amount) / 2));
}

/** Amount label of `amount` centred on `peakX` above `peakY` (draw/tab.js bendGeometry's shape), with its knock-out. */
function amountLabel(amount, peakX, labelY, theme) {
  const spacing = theme.staffLineSpacing;
  const label = amount.toLowerCase() === 'full' ? 'Full' : amount;
  const size = Math.max(0.9 * spacing, theme.tabFontSize - 0.2 * spacing);
  const tw = size * 0.62 * label.length;
  const x = peakX - tw / 2;
  return { label, size, x, y: labelY, rx: x - 0.1 * spacing, ry: labelY - size, rw: tw + 0.3 * spacing, rh: size + 0.3 * spacing };
}

/**
 * Geometry of a compound bend as renderCompoundBend draws it (same
 * arguments; `bend` is bendOf's `{ type, amount, rebend }`): rise 1 from
 * x + 0.3 sp (a pre-bend: a vertical shaft over the note) to peak 1, a
 * release fall to the string level at `fallX`, rise 2 to peak 2. The fall
 * and rise 2 together span REBEND_FALL_SP + REBEND_RISE_SP, widened so the
 * two labels sit side by side, but cut to end 0.6 sp before `nextX` (never
 * below REBEND_RISE_SP + REBEND_MIN_FALL_SP); when that leaves the labels
 * too close, label 2 is staggered above label 1. Returns every coordinate
 * plus `boxes` (rise 1, fall, rise 2; the two labels with `text: true`).
 */
export function compoundBendGeometry(x, y, bend, theme, nextX) {
  const spacing = theme.staffLineSpacing;
  const arrow = 0.4 * spacing;
  const halfStroke = BEND_STROKE_WIDTH / 2;
  const baseY = y - theme.tabFontSize / 2 - 0.3 * spacing;
  const startX = x + 0.3 * spacing;
  const prebend = bend.type === 'prebend';
  const peak1X = prebend ? x : startX + REBEND_RISE_SP * spacing;
  const unit = theme.tabStaffLineSpacing * 1.8;
  const peak1Y = baseY - unit * bendHeightFrac(bend.amount);
  const peak2Y = baseY - unit * bendHeightFrac(bend.rebend);
  const riseH1 = baseY - peak1Y;

  const l1 = amountLabel(bend.amount, peak1X, peak1Y - 0.4 * spacing, theme);
  const rise = REBEND_RISE_SP * spacing;
  const span = (REBEND_FALL_SP + REBEND_RISE_SP) * spacing;
  const w2 = amountLabel(bend.rebend, 0, 0, theme).rw;
  const sep = (l1.rw + w2) / 2 + REBEND_LABEL_GAP_SP * spacing;
  const ideal = Math.max(span, sep);
  const room = nextX != null ? nextX - 0.6 * spacing - peak1X : ideal;
  const d = Math.max(rise + REBEND_MIN_FALL_SP * spacing, Math.min(ideal, room));
  const peak2X = peak1X + d;
  const fallX = peak2X - (d >= span ? rise : (d * rise) / span);
  const fallCtrl = { x: peak1X + 0.4 * (fallX - peak1X), y: peak1Y + 0.1 * riseH1 };

  let label2Y = peak2Y - 0.4 * spacing;
  if (d < sep) label2Y = Math.min(label2Y, l1.y - l1.size - 0.3 * spacing - REBEND_LABEL_STACK_SP * spacing);
  const l2 = amountLabel(bend.rebend, peak2X, label2Y, theme);

  const boxes = [
    prebend
      ? { x1: x - arrow * ARROWHEAD_HALF_WIDTH - halfStroke, x2: x + arrow * ARROWHEAD_HALF_WIDTH + halfStroke, top: peak1Y, bottom: baseY, text: false }
      : { x1: startX - halfStroke, x2: peak1X + arrow * ARROWHEAD_HALF_WIDTH, top: peak1Y, bottom: baseY + halfStroke, text: false },
    { x1: peak1X, x2: fallX + arrow, top: peak1Y, bottom: baseY + halfStroke, text: false },
    { x1: fallX - halfStroke, x2: peak2X + arrow * ARROWHEAD_HALF_WIDTH, top: peak2Y, bottom: baseY + halfStroke, text: false },
    ...[l1, l2].map((l) => ({ x1: l.rx, x2: l.rx + l.rw, top: l.ry, bottom: l.ry + l.rh, text: true })),
  ];
  return { arrow, baseY, startX, peak1X, peak1Y, fallX, peak2X, peak2Y, fallCtrl, labels: [l1, l2], boxes };
}

/** A rise from (x0, baseY) to the arrowhead at (px, py), as renderBend draws one: flat departure, vertical arrival. */
function risePath(gEl, x0, baseY, px, py, arrow, color) {
  const c1 = { x: x0 + (px - x0) * 0.88, y: baseY };
  const c2 = { x: px, y: py + (baseY - py) * 0.5 };
  gEl.appendChild(path(svgD`M ${x0} ${baseY} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${px} ${py}`, { fill: 'none', stroke: color, 'stroke-width': BEND_STROKE_WIDTH }));
  gEl.appendChild(arrowheadDir(px, py, px - c2.x, py - c2.y, arrow, color));
}

/**
 * Draw a compound bend on the fret number at (x, y): rise 1 (or a
 * pre-bend's shaft), the release fall (a quadratic arc, as a
 * bend-and-release's), rise 2, then the two amount labels (knock-out,
 * italic text), in a group of class "bend bend-rebend" (+ "bend-prebend").
 * No landing fret and no hold dash. `nextX` (the next note on the system,
 * or the last barline) limits the width (compoundBendGeometry). Returns the
 * ink boxes.
 */
export function renderCompoundBend(g, x, y, bend, theme, nextX) {
  const gEl = group({ class: bend.type === 'prebend' ? 'bend bend-rebend bend-prebend' : 'bend bend-rebend' });
  const color = theme.tabFretColor;
  const geo = compoundBendGeometry(x, y, bend, theme, nextX);
  const { arrow, baseY, startX, peak1X, peak1Y, fallX, peak2X, peak2Y, fallCtrl } = geo;

  if (bend.type === 'prebend') {
    gEl.appendChild(path(svgD`M ${peak1X} ${baseY} L ${peak1X} ${peak1Y}`, { fill: 'none', stroke: color, 'stroke-width': BEND_STROKE_WIDTH }));
    gEl.appendChild(arrowheadDir(peak1X, peak1Y, 0, -1, arrow, color));
  } else {
    risePath(gEl, startX, baseY, peak1X, peak1Y, arrow, color);
  }
  gEl.appendChild(path(svgD`M ${peak1X} ${peak1Y} Q ${fallCtrl.x} ${fallCtrl.y} ${fallX} ${baseY}`, { fill: 'none', stroke: color, 'stroke-width': BEND_STROKE_WIDTH }));
  gEl.appendChild(arrowheadDir(fallX, baseY, fallX - fallCtrl.x, baseY - fallCtrl.y, arrow, color));
  risePath(gEl, fallX, baseY, peak2X, peak2Y, arrow, color);

  geo.labels.forEach((a) => {
    gEl.appendChild(rect(a.rx, a.ry, a.rw, a.rh, { fill: theme.background || '#ffffff' }));
    gEl.appendChild(text(a.x, a.y, a.label, {
      'font-family': theme.textFontFamily,
      'font-style': 'italic',
      'font-size': a.size,
      'text-anchor': 'start',
      fill: color,
    }));
  });

  g.appendChild(gEl);
  return geo.boxes;
}
