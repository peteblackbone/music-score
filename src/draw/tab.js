/**
 * draw/tab.js — tablature staff: N horizontal string-lines with fret
 * numbers, one column per rhythmic element, mirroring the notation staff.
 */
import { line, group, text, glyphText, path, rect, wavyPathD, svgD } from './svgUtil.js';
import { tabClefMetrics } from '../layout/systems.js';
import { fretLabel, fretLabelWidth, estimateTextWidth } from '../textMetrics.js';
import { TEXT_ASCENT_EM, TEXT_DESCENT_EM } from '../layout/ink.js';
import { whammyLabel } from '../directions.js';
import { tabFretKnockoutHalf } from '../layout/tabRhythm.js';

/** Draw the tab staff lines for `stringCount` strings, baseline = bottom (highest-numbered) string. */
export function drawTabStaffLines(x, endX, baselineY, stringCount, theme) {
  const g = group({ class: 'tab-lines' });
  for (let i = 0; i < stringCount; i++) {
    const y = baselineY - i * theme.tabStaffLineSpacing;
    g.appendChild(line(x, y, endX, y, { stroke: theme.staffLineColor, 'stroke-width': theme.staffLineWidth }));
  }
  return g;
}

/**
 * TAB clef, left edge at `x`, vertically centred on the TAB staff (bottom
 * string at `baselineY`): the SMuFL 6- or 4-string TAB clef glyph scaled to
 * the staff, or stacked T/A/B letters for other string counts (see
 * tabClefMetrics in layout/systems.js).
 */
export function drawTabClef(x, baselineY, stringCount, theme) {
  const g = group({ class: 'tab-clef' });
  const span = (stringCount - 1) * theme.tabStaffLineSpacing;
  const midY = baselineY - span / 2;
  const m = tabClefMetrics(stringCount, theme);
  if (m.glyph) {
    // The glyph's origin is its vertical centre (symmetric box).
    g.appendChild(glyphText(x, midY, m.glyph, theme.fontFamily, m.fontSize, { fill: theme.tabFretColor }));
    return g;
  }
  const cell = (0.6 * span) / 3;
  ['T', 'A', 'B'].forEach((ch, i) => {
    g.appendChild(text(x + m.width / 2, midY - 1.5 * cell + (i + 0.5) * cell + 0.35 * m.fontSize, ch, {
      'font-family': theme.textFontFamily,
      'font-weight': 'bold',
      'font-size': m.fontSize,
      'text-anchor': 'middle',
      fill: theme.tabFretColor,
    }));
  });
  return g;
}

/**
 * Render one element (note/chord/rest) on the tab staff. `stringCount` strings,
 * string 1 = highest-pitched (top line), matching common tab convention.
 * Returns `{ fretTopY, marksTopY }` — the top of the topmost fret label's
 * knock-out and of the tab tremolo / vibrato ink (Infinity when there is
 * none) — for the score-wide passes; undefined for a rest.
 */
export function renderTabElement(g, layoutEl, stringCount, theme) {
  const spacing = theme.staffLineSpacing;
  const el = layoutEl.el;
  const x = layoutEl.x;
  if (el.type === 'rest') return undefined; // no fret label for a rest; draw/tabRhythm.js draws the rest when track.tabRhythm is on
  const notes = el.notes || [];
  let fretTopY = Infinity;
  let marksTopY = Infinity;
  notes.forEach((note) => {
    if (note.string == null || note.fret == null) return;
    const y = layoutEl.tabBaselineY - (stringCount - note.string) * theme.tabStaffLineSpacing;
    // A dead/muted note (a percussive, indeterminate-pitch strike) shows
    // "x" in place of the fret number — the fret value is still needed for
    // string positioning and pitch derivation, it's just not displayed. A
    // ghost note (played very quietly/buried, not silenced) is shown as
    // the fret number in parentheses instead — same position, just
    // wrapped (and combines with `mute` as "(x)" if somehow both are set).
    const label = fretLabel(note);
    // White backing rect so the fret number doesn't collide with the string line.
    const w = fretLabelWidth(label, theme);
    const knockHalf = tabFretKnockoutHalf(theme);
    g.appendChild(rect(x - w / 2, y - knockHalf, w, 2 * knockHalf, {
      fill: theme.background || '#ffffff',
    }));
    fretTopY = Math.min(fretTopY, y - knockHalf);
    g.appendChild(text(x, y + theme.tabFontSize / 2 - 0.1 * spacing, label, {
      'font-family': theme.textFontFamily,
      'font-size': theme.tabFontSize,
      'text-anchor': 'middle',
      fill: theme.tabFretColor,
    }));
  });

  // Tremolo picking / vibrato: marks hanging above the topmost fret number
  // in this beat, mirroring the ones drawn on the notation staff above.
  // When both are set, vibrato stacks above the tremolo marks so they
  // don't overlap.
  if (el.tremolo || el.vibrato) {
    const usedYs = notes.filter((n) => n.string != null && n.fret != null)
      .map((n) => layoutEl.tabBaselineY - (stringCount - n.string) * theme.tabStaffLineSpacing);
    if (usedYs.length) {
      const baseTopY = Math.min(...usedYs) - theme.tabFontSize - 0.5 * spacing;
      if (el.tremolo) marksTopY = Math.min(marksTopY, renderTabTremolo(g, x, baseTopY, theme));
      if (el.vibrato) {
        const vibratoY = el.tremolo ? baseTopY - 1.0 * spacing : baseTopY;
        const span = Math.max(1.4 * spacing, Math.min(3.4 * spacing, (layoutEl.width ?? 2.8 * spacing) - 0.8 * spacing));
        marksTopY = Math.min(marksTopY, renderTabVibrato(g, x + 0.5 * spacing, vibratoY, span, theme));
      }
    }
  }
  return { fretTopY, marksTopY };
}

/**
 * The tab-side counterpart to `renderTremolo` in notation.js: three short
 * parallel diagonal strokes marking rapid alternate-picking on a single
 * held fret, hung above it instead of crossing a stem (tab has none).
 * Returns the top of its strokes (centre lines; stroke widths are fixed px
 * and stay out of positions so layout scales exactly with the staff).
 */
function renderTabTremolo(g, x, y, theme) {
  const gEl = group({ class: 'tab-tremolo' });
  const color = theme.tabFretColor;
  const strokeLen = 0.7 * theme.staffLineSpacing;
  const gap = 0.4 * theme.staffLineSpacing;
  const rad = (-32 * Math.PI) / 180;
  const hx = Math.cos(rad) * (strokeLen / 2);
  const hy = Math.sin(rad) * (strokeLen / 2);
  for (let i = -1; i <= 1; i++) {
    const cy = y + i * gap;
    gEl.appendChild(line(x - hx, cy + hy, x + hx, cy - hy, {
      stroke: color, 'stroke-width': 1.3, 'stroke-linecap': 'round',
    }));
  }
  g.appendChild(gEl);
  return y - gap - Math.abs(hy);
}

/**
 * The tab-side counterpart to `renderVibrato` in notation.js: a short wavy
 * horizontal line hung above the fret number, spanning roughly the note's
 * own column width, marking a pitch wobbled with the fretting hand.
 * Returns the top of its wave (control points included, like layout/ink.js;
 * stroke width left out, as for the tremolo).
 */
function renderTabVibrato(g, x1, y, span, theme) {
  const gEl = group({ class: 'tab-vibrato' });
  gEl.appendChild(path(wavyPathD(x1, x1 + span, y, 0.18 * theme.staffLineSpacing, 0.6 * theme.staffLineSpacing), {
    fill: 'none', stroke: theme.tabFretColor, 'stroke-width': 1.1, 'stroke-linecap': 'round',
  }));
  g.appendChild(gEl);
  return y - 0.18 * theme.staffLineSpacing;
}

/**
 * Draw a hammer-on ("H") or pull-off ("P") articulation: a small slur
 * hugging the two fret numbers on the same string, with the letter
 * centered above its peak. `kind` is 'h' or 'p'. `showLabel: false` omits
 * the letter (the second half of an arc split across a system break).
 * Returns its box `{ x1, x2, top, bottom }` (arc centre line incl. its
 * control point, and the letter's knock-out when drawn), plus that
 * knock-out alone as `letter` (same shape) when the letter is drawn.
 */
export function renderHammerPull(g, x1, x2, y, kind, theme, showLabel = true) {
  const gEl = group({ class: `hammer-pull hammer-pull-${kind}` });
  const spacing = theme.staffLineSpacing;
  const midX = (x1 + x2) / 2;
  const baseY = y - theme.tabFontSize / 2 - 0.3 * spacing;
  const bow = Math.min(1.3 * spacing, Math.max(0.7 * spacing, (x2 - x1) * 0.28));
  const peakY = baseY - bow;
  const d = svgD`M ${x1 + 0.3 * spacing} ${baseY} Q ${midX} ${peakY} ${x2 - 0.3 * spacing} ${baseY}`;
  gEl.appendChild(path(d, { fill: 'none', stroke: theme.tabFretColor, 'stroke-width': 1.1 }));
  const box = { x1: x1 + 0.3 * spacing, x2: x2 - 0.3 * spacing, top: peakY, bottom: baseY };

  // Some tab styles omit the "H"/"P" letter entirely and let the plain
  // slur (ascending = hammer-on, descending = pull-off) speak for itself.
  if (theme.hammerPullLabels === false || !showLabel) { g.appendChild(gEl); return box; }

  const label = kind === 'p' ? 'P' : 'H';
  const labelSize = Math.max(0.9 * spacing, theme.tabFontSize - 0.2 * spacing);
  const labelY = peakY - 0.1 * spacing;
  const w = labelSize + 0.2 * spacing;
  gEl.appendChild(rect(midX - w / 2, labelY - labelSize, w, labelSize + 0.2 * spacing, {
    fill: theme.background || '#ffffff',
  }));
  gEl.appendChild(text(midX, labelY, label, {
    'font-family': theme.textFontFamily,
    'font-weight': 'bold',
    'font-size': labelSize,
    'text-anchor': 'middle',
    fill: theme.tabFretColor,
  }));
  g.appendChild(gEl);
  return {
    x1: Math.min(box.x1, midX - w / 2), x2: Math.max(box.x2, midX + w / 2), top: Math.min(box.top, labelY - labelSize), bottom: box.bottom,
    letter: { x1: midX - w / 2, x2: midX + w / 2, top: labelY - labelSize, bottom: labelY + 0.2 * spacing },
  };
}

/**
 * Draw a slide: a short diagonal stroke between two fret numbers on the
 * same string. Both notes sit on the same string line (same y), so the
 * slant is a stylized indicator rather than a literal pitch line —
 * rising left-to-right for a slide up, falling left-to-right for a
 * slide down, matching how tab notation conventionally shows it.
 * `startInset` / `endInset` (px) override the default SLIDE_END_INSET_SP
 * inset at either end (wider fret labels such as "<12>").
 */
export const SLIDE_END_INSET_SP = 0.7; // each end of the slide stroke -> its note's x (clears the fret number)

export function renderSlide(g, x1, x2, y, direction, theme, startInset, endInset) {
  const spacing = theme.staffLineSpacing;
  const margin = SLIDE_END_INSET_SP * spacing;
  const xa = Math.min(x1 + (startInset ?? margin), (x1 + x2) / 2);
  const xb = Math.max(x2 - (endInset ?? margin), (x1 + x2) / 2);
  const rise = theme.tabFontSize * 0.4;
  const ya = direction === 'down' ? y - rise / 2 : y + rise / 2;
  const yb = direction === 'down' ? y + rise / 2 : y - rise / 2;
  // Mask the plain string-line dash in this gap so the diagonal reads
  // cleanly instead of crossing it (real tab replaces the dash here).
  g.appendChild(rect(xa - 0.2 * spacing, y - rise / 2 - 0.2 * spacing, (xb - xa) + 0.4 * spacing, rise + 0.4 * spacing, {
    fill: theme.background || '#ffffff',
  }));
  g.appendChild(line(xa, ya, xb, yb, {
    stroke: theme.tabFretColor, 'stroke-width': 1.3, 'stroke-linecap': 'round',
  }));
}

/** Font size (px) of the technique labels ("P.M.", "A.H.", ...) above the TAB staff. */
export function techniqueLabelSize(theme) {
  return Math.max(0.9 * theme.staffLineSpacing, theme.tabFontSize - 0.1 * theme.staffLineSpacing);
}

/** Minimum gap (em of the label size) between a technique label's text and its dashed line. */
export const LABEL_DASH_GAP_EM = 0.3;

/**
 * Dashed extension line of a technique-label run drawn by
 * renderTechniqueLabel (same x1, x2, labelY, label): where it starts, its
 * y, the height of the closing tick at x2, and whether the run is long
 * enough for it to be drawn at all. The dash starts 2.6 label sizes after
 * x1, or LABEL_DASH_GAP_EM after the end of a wider `label`'s (estimated,
 * bold) text — "let ring"; P.M. / A.H. / T.H. / P.H. / S.H. always fit in
 * the 2.6.
 */
export function techniqueLabelDash(x1, x2, labelY, theme, label) {
  const labelSize = techniqueLabelSize(theme);
  const textEnd = label == null ? 0 : estimateTextWidth(label, labelSize, { bold: true }) + LABEL_DASH_GAP_EM * labelSize;
  const dashStartX = x1 + Math.max(labelSize * 2.6, textEnd);
  return {
    dashStartX,
    dashY: labelY - labelSize * 0.32,
    tick: labelSize * 0.5,
    hasDash: x2 > dashStartX + 0.4 * theme.staffLineSpacing,
  };
}

/**
 * Draw a technique-label run above (or below) a span of consecutive notes:
 * the italic label text at the start of the run, a dashed extension line
 * running over every note it covers, and a short downward tick capping the
 * end. Used for palm-mute ("P.M."), harmonic ("A.H.", "T.H.", "P.H.",
 * "S.H.") and let-ring ("let ring") runs. The caller lays out the run, so
 * only its horizontal extent and the resolved label baseline are passed in,
 * not per-note geometry.
 *
 * @param {SVGGElement} g  Parent group to append the run's group to.
 * @param {number} x1      Left x of the run (where the label text starts).
 * @param {number} x2      Right x of the run (where the dashed line ends and the tick is drawn).
 * @param {number} labelY  Label text baseline y, already resolved by the caller (incl. lane stacking).
 * @param {string} label   Label text, e.g. "P.M.", "A.H." or "let ring".
 * @param {string} cls     CSS class for the run's group element.
 * @param {string} color   Color for the text, dashed line and tick.
 * @param {object} theme   Active theme (staff spacing, fonts, sizes).
 */
export function renderTechniqueLabel(g, x1, x2, labelY, label, cls, color, theme) {
  const gEl = group({ class: cls });
  const labelSize = techniqueLabelSize(theme);
  gEl.appendChild(text(x1, labelY, label, {
    'font-family': theme.textFontFamily,
    'font-style': 'italic',
    'font-weight': 'bold',
    'font-size': labelSize,
    'text-anchor': 'start',
    fill: color,
  }));
  const { dashStartX, dashY, tick, hasDash } = techniqueLabelDash(x1, x2, labelY, theme, label);
  if (hasDash) {
    gEl.appendChild(path(svgD`M ${dashStartX} ${dashY} L ${x2} ${dashY}`, {
      fill: 'none', stroke: color, 'stroke-width': 1, 'stroke-dasharray': '2,2',
    }));
    // Small closing tick marking the end of the run, like a bracket close.
    gEl.appendChild(line(x2, dashY - tick / 2, x2, dashY + tick / 2, {
      stroke: color, 'stroke-width': 1,
    }));
  }
  g.appendChild(gEl);
}

/**
 * Draw a tap mark: a bold upright "T" at the technique-label size, centred
 * on `x`, baseline `baselineY` (resolved by the caller), in `<g class="tap">`.
 * Used above the TAB staff (renderTabArticulations) and above the notation
 * staff (renderPlayingDirections). Returns its ink box
 * `{ x1, x2, top, bottom, text: true }` (estimated text extents).
 */
export function renderTapMark(g, x, baselineY, color, theme) {
  const size = techniqueLabelSize(theme);
  const gEl = group({ class: 'tap' });
  gEl.appendChild(text(x, baselineY, 'T', {
    'font-family': theme.textFontFamily,
    'font-weight': 'bold',
    'font-size': size,
    'text-anchor': 'middle',
    fill: color,
  }));
  g.appendChild(gEl);
  const w = estimateTextWidth('T', size, { bold: true });
  return { x1: x - w / 2, x2: x + w / 2, top: baselineY - TEXT_ASCENT_EM * size, bottom: baselineY + TEXT_DESCENT_EM * size, text: true };
}

const WHAMMY_START_SP = 0.3;      // dip start -> right of the note's x
const WHAMMY_MIN_WIDTH_SP = 1.6;  // dip width clamp
const WHAMMY_MAX_WIDTH_SP = 2.8;
const WHAMMY_NEXT_GAP_SP = 0.9;   // dip width = room to the next note less this
const WHAMMY_DEPTH_SP = 0.8;      // fixed depth of the "V"
const WHAMMY_TEXT_GAP_SP = 0.3;   // amount text bottom -> top of the "V"
const WHAMMY_STROKE_WIDTH = 1.1;

/**
 * Geometry of a whammy-bar dip as renderWhammyDip draws it (same
 * arguments): a "V" from (x1, yTop) down to (xm, bottomY) and back up to
 * (x2, yTop), starting WHAMMY_START_SP right of the note at `x`, its width
 * the room to `nextX` less WHAMMY_NEXT_GAP_SP, clamped to
 * WHAMMY_MIN_WIDTH_SP..WHAMMY_MAX_WIDTH_SP; the amount text ("-1/2") is
 * centred above it. `boxes`: ink boxes of the V and the text, both
 * `text: true` so technique-label dashes keep clear of them as well (unlike
 * a bend's rise). Only the vertical values depend on `bottomY`. Boxes
 * follow centre lines (no fixed-px stroke width), so they scale exactly
 * with the staff.
 */
export function whammyDipGeometry(x, bottomY, dip, theme, nextX) {
  const sp = theme.staffLineSpacing;
  const x1 = x + WHAMMY_START_SP * sp;
  const width = Math.max(WHAMMY_MIN_WIDTH_SP * sp, Math.min(WHAMMY_MAX_WIDTH_SP * sp, nextX - x - WHAMMY_NEXT_GAP_SP * sp));
  const x2 = x1 + width;
  const xm = (x1 + x2) / 2;
  const yTop = bottomY - WHAMMY_DEPTH_SP * sp;
  const label = whammyLabel(dip);
  const size = Math.max(0.9 * sp, theme.tabFontSize - 0.2 * sp);
  const textY = yTop - WHAMMY_TEXT_GAP_SP * sp - TEXT_DESCENT_EM * size;
  const tw = estimateTextWidth(label, size);
  return {
    x1, xm, x2, yTop, bottomY, label, size, textY,
    boxes: [
      { x1, x2, top: yTop, bottom: bottomY, text: true },
      { x1: xm - tw / 2, x2: xm + tw / 2, top: textY - TEXT_ASCENT_EM * size, bottom: textY + TEXT_DESCENT_EM * size, text: true },
    ],
  };
}

/**
 * Draw a whammy-bar dip above the TAB staff for the note at `x`: the "V"
 * with its tip at `bottomY` (resolved by the caller) and the italic amount
 * with a leading "-" above it, in `<g class="whammy whammy-dip">`. `dip` is
 * a canonical `{ type: 'dip', amount }` (directions.js). Returns the ink
 * boxes from whammyDipGeometry.
 */
export function renderWhammyDip(g, x, bottomY, dip, theme, nextX) {
  const geo = whammyDipGeometry(x, bottomY, dip, theme, nextX);
  const color = theme.tabFretColor;
  const gEl = group({ class: 'whammy whammy-dip' });
  gEl.appendChild(path(svgD`M ${geo.x1} ${geo.yTop} L ${geo.xm} ${geo.bottomY} L ${geo.x2} ${geo.yTop}`, {
    fill: 'none', stroke: color, 'stroke-width': WHAMMY_STROKE_WIDTH, 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
  }));
  gEl.appendChild(text(geo.xm, geo.textY, geo.label, {
    'font-family': theme.textFontFamily,
    'font-style': 'italic',
    'font-size': geo.size,
    'text-anchor': 'middle',
    fill: color,
  }));
  g.appendChild(gEl);
  return geo.boxes;
}

/**
 * A small filled triangle arrowhead, tip at (x, y), pointing along the
 * direction vector (dx, dy) — i.e. the direction travel arrives from, not
 * a fixed compass direction. Using the actual path tangent here (rather
 * than a hardcoded "up"/"down") keeps the arrowhead visually aligned with
 * the curve it caps, instead of appearing to point off at an angle.
 */
function arrowheadDir(x, y, dx, dy, size, color) {
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const bx = x - ux * size, by = y - uy * size; // base center, behind the tip
  const px = -uy, py = ux; // perpendicular unit vector
  const half = size * ARROWHEAD_HALF_WIDTH;
  const d = svgD`M ${x} ${y} L ${bx + px * half} ${by + py * half} L ${bx - px * half} ${by - py * half} Z`;
  return path(d, { fill: color, stroke: 'none' });
}

const BEND_STROKE_WIDTH = 1.1;    // bend rise / release / hold stroke width (px)
const ARROWHEAD_HALF_WIDTH = 0.6; // arrowheadDir's half base width, as a fraction of its size

/**
 * Geometry of a bend as renderBend draws it (same arguments): every
 * coordinate renderBend draws from, plus `boxes` — conservative axis-aligned
 * ink boxes `{ x1, x2, top, bottom, text }` of its pieces (rise + arrowhead;
 * release stroke + arrowhead or hold dash; and, with `text: true`, the
 * amount-label and landing-fret knock-outs). renderTechniqueLabelRuns
 * (passes/techniqueLabels.js) uses the boxes to keep P.M./harmonic labels clear of bends.
 */
export function bendGeometry(x, y, bend, theme, nextX, targetFret) {
  const spacing = theme.staffLineSpacing;
  const arrow = 0.4 * spacing;
  const baseY = y - theme.tabFontSize / 2 - 0.3 * spacing;
  const width = nextX != null ? Math.max(2.2 * spacing, Math.min(3.4 * spacing, nextX - x - 0.6 * spacing)) : 2.8 * spacing;
  const startX = x + 0.3 * spacing;
  const endX = startX + width;
  // The rise's curved "elbow" sits fairly close to the note; the fall is
  // the long, gentle sweep that carries most of the remaining horizontal
  // distance.
  const peakX = startX + Math.min(1.6 * spacing, width * 0.5);
  // Scaled by the bend amount (a "full" step is the 1.0 baseline — see
  // renderTabArticulations in passes/tabTechniques.js) so a half bend's arc is visibly smaller than a
  // full bend's, not the same size with a different label.
  const heightFrac = bend.heightFrac ?? 1;
  const bendHeight = theme.tabStaffLineSpacing * 1.8 * heightFrac;
  const peakY = baseY - bendHeight;
  const riseH = baseY - peakY;
  const halfStroke = BEND_STROKE_WIDTH / 2;
  const boxes = [{ x1: startX - halfStroke, x2: peakX + arrow * ARROWHEAD_HALF_WIDTH, top: peakY, bottom: baseY + halfStroke, text: false }];

  // Landing fret, only if there's clear room before the next fret number/bend.
  let target = null;
  if (targetFret != null) {
    const tLabel = `(${targetFret})`;
    const tSize = theme.tabFontSize - 0.1 * spacing;
    const tw = 0.65 * spacing * tLabel.length + 0.2 * spacing;
    const tx = peakX + 0.8 * spacing;
    const ty = peakY + tSize;
    const clearance = nextX != null ? nextX - (tx + tw) : Infinity;
    if (clearance >= 0.4 * spacing) {
      target = { label: tLabel, size: tSize, x: tx, y: ty, rx: tx - 0.1 * spacing, ry: ty - tSize, rw: tw, rh: tSize + 0.2 * spacing };
      boxes.push({ x1: target.rx, x2: target.rx + target.rw, top: target.ry, bottom: target.ry + target.rh, text: true });
    }
  }

  let releaseCtrl = null;
  let holdEndX = null;
  if (bend.release) {
    releaseCtrl = { x: peakX + (endX - peakX) * 0.4, y: peakY + riseH * 0.1 };
    boxes.push({ x1: peakX, x2: endX + arrow, top: peakY, bottom: baseY + halfStroke, text: false });
  } else if (bend.hold) {
    const holdEnd = nextX != null ? nextX - 0.3 * spacing : endX;
    if (holdEnd > peakX + 0.4 * spacing) {
      holdEndX = holdEnd;
      boxes.push({ x1: peakX, x2: holdEndX, top: peakY - halfStroke, bottom: peakY + halfStroke, text: false });
    }
  }

  // Amount label, tucked over the (near-start) crest.
  const label = bend.amount.toLowerCase() === 'full' ? 'Full' : bend.amount;
  const labelSize = Math.max(0.9 * spacing, theme.tabFontSize - 0.2 * spacing);
  const labelX = peakX - (labelSize * 0.62 * label.length) / 2;
  const labelY = peakY - 0.4 * spacing;
  const w = labelSize * 0.62 * label.length + 0.3 * spacing;
  const amount = { label, size: labelSize, x: labelX, y: labelY, rx: labelX - 0.1 * spacing, ry: labelY - labelSize, rw: w, rh: labelSize + 0.3 * spacing };
  boxes.push({ x1: amount.rx, x2: amount.rx + amount.rw, top: amount.ry, bottom: amount.ry + amount.rh, text: true });

  return { arrow, baseY, startX, endX, peakX, peakY, riseH, target, releaseCtrl, holdEndX, amount, boxes };
}

/**
 * Draw a bend (and optional release/hold) on a single fret number, matching
 * the conventional tab-notation shape: a short, steep rise straight off the
 * fret number up to an arrowhead (the amount label sitting just above it).
 * A plain bend stops there — no return stroke, since only an explicit
 * `release` actually comes back down. `bend` is
 * `{ amount, release, hold }` (see normalizeBend below);
 * when `release` is set, a second arrowhead caps the landing to mark a
 * deliberate release. When `hold` is set, the pitch is sustained rather
 * than released or landed statically, so instead of a landing curve a
 * dashed horizontal line runs from the peak toward the next note (which
 * typically has its own bend rise, tied together visually by the dash).
 * `targetFret`, if given, is printed in parentheses at the landing point
 * (the fret you'd play to get the same pitch the bend reaches) — the
 * standard way tab shows where a whole/half-step bend ends up (skipped for
 * `release`/`hold`, since neither lands on a new static pitch). `nextX`, if
 * given, caps how wide the arc may reach so it doesn't run into the next
 * fret number in a tight beat. All coordinates come from bendGeometry;
 * returns its ink `boxes`.
 */
export function renderBend(g, x, y, bend, theme, nextX, targetFret) {
  const gEl = group({ class: 'bend' });
  const color = theme.tabFretColor;
  const geo = bendGeometry(x, y, bend, theme, nextX, targetFret);
  const { arrow, baseY, startX, endX, peakX, peakY, riseH } = geo;

  // Landing fret, in parentheses, printed just to the right of the
  // arrowhead tip (a plain bend has no return stroke, so there's no more
  // "string line" landing spot to anchor it to — this matches how tab
  // conventionally shows it right after the arrow) — only if there's clear
  // room before the next fret number/bend, so it doesn't collide in a
  // tight beat. Drawn *before* the arrowhead below so its white background
  // never paints over it even though they sit close together.
  if (geo.target) {
    const t = geo.target;
    gEl.appendChild(rect(t.rx, t.ry, t.rw, t.rh, {
      fill: theme.background || '#ffffff',
    }));
    gEl.appendChild(text(t.x, t.y, t.label, {
      'font-family': theme.textFontFamily,
      'font-size': t.size,
      'text-anchor': 'start',
      fill: color,
    }));
  }

  // Rising stroke: leaves the note almost flat (hugging the string line,
  // barely bent) and curves progressively harder until it's a straight
  // vertical shaft running up to the arrowhead. The control points make
  // that happen: c1 sits level with the note (horizontal departure), c2
  // sits directly below the tip (vertical arrival) — so nearly all of the
  // curve's bend happens in a short elbow, and the last stretch below the
  // tip is essentially a straight vertical line.
  const c1 = { x: startX + (peakX - startX) * 0.88, y: baseY };
  const c2 = { x: peakX, y: peakY + riseH * 0.5 };
  const d1 = svgD`M ${startX} ${baseY} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${peakX} ${peakY}`;
  gEl.appendChild(path(d1, { fill: 'none', stroke: color, 'stroke-width': BEND_STROKE_WIDTH }));
  gEl.appendChild(arrowheadDir(peakX, peakY, peakX - c2.x, peakY - c2.y, arrow, color));

  if (bend.release) {
    // Release stroke: steeper and more direct than the plain landing
    // curve below, but still a genuine arc — not a straight diagonal. A
    // single control point offset up-and-out from the direct peak→landing
    // line gives it a real bow while keeping the arrival heading mostly
    // downward, so the second arrowhead reads as a deliberate drop.
    const releaseCtrl = geo.releaseCtrl;
    const d2 = svgD`M ${peakX} ${peakY} Q ${releaseCtrl.x} ${releaseCtrl.y} ${endX} ${baseY}`;
    gEl.appendChild(path(d2, { fill: 'none', stroke: color, 'stroke-width': BEND_STROKE_WIDTH }));
    gEl.appendChild(arrowheadDir(endX, baseY, endX - releaseCtrl.x, baseY - releaseCtrl.y, arrow, color));
  } else if (bend.hold) {
    // Bend-and-hold: the raised pitch is sustained into the next note
    // rather than released back down, so there's no landing curve here —
    // instead a dashed horizontal line at the peak (held-pitch) height
    // runs toward the next note, which conventionally carries its own
    // rise + arrowhead + label repeating the bend, tied together by this
    // dash (matching how real tab notates a bend held across into the
    // next attack).
    if (geo.holdEndX != null) {
      const d2 = svgD`M ${peakX} ${peakY} L ${geo.holdEndX} ${peakY}`;
      gEl.appendChild(path(d2, { fill: 'none', stroke: color, 'stroke-width': BEND_STROKE_WIDTH, 'stroke-dasharray': '3,2' }));
    }
  }
  // A plain bend (no release, no hold) draws nothing further — just the
  // rise + arrowhead + label above. There's no return stroke, because a
  // plain bend never comes back down to the original pitch on its own;
  // only an explicit `release` does (and a `hold` ties into the next
  // note instead), so drawing a falling curve here would visually imply
  // a release that isn't actually happening.

  // Amount label, tucked over the (near-start) crest — also drawn last so
  // its background can't be papered over by anything else either.
  const a = geo.amount;
  gEl.appendChild(rect(a.rx, a.ry, a.rw, a.rh, {
    fill: theme.background || '#ffffff',
  }));
  gEl.appendChild(text(a.x, a.y, a.label, {
    'font-family': theme.textFontFamily,
    'font-style': 'italic',
    'font-size': a.size,
    'text-anchor': 'start',
    fill: color,
  }));

  g.appendChild(gEl);
  return geo.boxes;
}

/**
 * Normalize a note's `bend` field into `{ amount, release, hold }`.
 * `release` and `hold` are mutually exclusive — `release` wins if a string
 * somehow specifies both (e.g. via `{ release: true, hold: true }`).
 */
export function normalizeBend(raw) {
  if (raw === true) return { amount: 'full', release: false, hold: false };
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    const release = /\s+release$/i.test(trimmed);
    const hold = !release && /\s+hold$/i.test(trimmed);
    const amount = trimmed.replace(/\s+(release|hold)$/i, '') || 'full';
    return { amount, release, hold };
  }
  const release = !!raw?.release;
  return { amount: raw?.amount || 'full', release, hold: !release && !!raw?.hold };
}

/**
 * Convert a bend amount label ("full", "1/2", "1 1/2", "2", ...) into
 * semitones, so the landing fret can be shown in parentheses (e.g. a
 * "full" bend on fret 7 lands on the pitch of fret 9). "full" = a whole
 * step (2 semitones); fractional/mixed-number labels are read in whole
 * steps too (e.g. "1/2" = a half step = 1 semitone, "1 1/2" = 3 semitones).
 */
export function bendSemitones(amount) {
  const a = String(amount).trim().toLowerCase();
  if (a === 'full') return 2;
  const mixed = a.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return (Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3])) * 2;
  const frac = a.match(/^(\d+)\/(\d+)$/);
  if (frac) return (Number(frac[1]) / Number(frac[2])) * 2;
  const whole = a.match(/^(\d+(?:\.\d+)?)$/);
  if (whole) return Number(whole[1]) * 2;
  return 2; // unrecognized label: assume a full step
}
