/**
 * draw/tabRhythm.js — rhythm on a TAB staff (ui.md "rhythm on TAB staves"),
 * drawn per measure by drawTabMeasure (draw/system.js) after the fret
 * labels when `track.tabRhythm` is on, into one `<g class="tab-rhythm">`:
 *
 * - stems hang down from a fixed line below the bottom string (one per
 *   note/chord beat, pitch-only beats included; half notes a short stem,
 *   whole notes none), never crossing the staff;
 * - beams (layout/beams.js groupBeams) are flat, the primary beam's lower
 *   edge at the stem ends and secondary levels stacking toward the staff;
 *   partial levels get stubs, as in notation's renderBeams;
 * - unbeamed 8th–64th notes get stem-down flags at tabFlagScale size;
 * - augmentation dots sit on one row just under the stem tops;
 * - tuplets (tupletGroups) get a number under a beam group that covers
 *   exactly the tuplet, else a bracket with up-ticks below the band
 *   (`<g class="tab-tuplet">`);
 * - rests (`<g class="tab-rest">`) sit inside the staff: whole/half rests
 *   on a string line, shorter ones centred on the staff over a background
 *   knock-out; a whole-measure rest (or an authored empty measure) is
 *   centred in the bar; measures padded by normalize stay blank.
 *
 * Grace notes get nothing here (their fret label is drawn by draw/tab.js).
 * Everything is tabFretColor; geometry shared with the timeline's
 * horizontal extents lives in layout/tabRhythm.js.
 */
import { line, group, glyphText, circle, rect } from './svgUtil.js';
import {
  beamShape, beamStemCap, BEAM_STUB_SP, BEAM_LEVEL_GAP_SP,
  tupletBracket, tupletLabel, TUPLET_LABEL_SIZE_SP,
} from './notation.js';
import {
  tabStemTopY, tabStemLengthSp, tabFlagGlyph, tabNoteDotDxSp,
  TAB_DOT_ROW_SP, TAB_DOT_GAP_SP, TAB_REST_KNOCKOUT_SP,
} from '../layout/tabRhythm.js';
import { TEXT_ASCENT_EM } from '../layout/ink.js';
import { restForDuration } from '../glyphs.js';
import { glyphBox } from '../glyphMetrics.js';
import { smuflFontSizePx } from '../theme.js';
import { beamCount } from '../duration.js';
import { DOT_STEP_SP, DOT_RADIUS_SP } from '../layout/chord.js';

const TUPLET_NUMBER_GAP_SP = 0.3; // primary beam's lower edge -> top of the tuplet number
const TUPLET_BRACKET_GAP_SP = 0.6; // lowest band ink -> tuplet bracket line
const TUPLET_HALF_SPAN_SP = 0.5;  // bracket end past a note's x

/** Append `dots` augmentation dots in a row, the first centred at (x, y). */
function appendDots(g, x, y, dots, theme) {
  const s = theme.staffLineSpacing;
  for (let i = 0; i < dots; i++) g.appendChild(circle(x + i * DOT_STEP_SP * s, y, DOT_RADIUS_SP * s, { fill: theme.tabFretColor }));
}

/**
 * Rest glyph, its box (sp, y up) and its origin y (ui.md §6): strings
 * 1..n top to bottom, c = (n + 1) / 2; a whole rest hangs from string
 * floor(c), a half rest sits on string ceil(c), shorter rests are centred
 * on the staff.
 */
function restGeometry(duration, stringCount, lineBottom, theme) {
  const s = theme.staffLineSpacing;
  const glyph = restForDuration(duration);
  const box = glyphBox(glyph);
  const c = (stringCount + 1) / 2;
  const stringY = (k) => lineBottom - (stringCount - k) * theme.tabStaffLineSpacing;
  let y;
  if (duration === 'whole') y = stringY(Math.floor(c));
  else if (duration === 'half') y = stringY(Math.ceil(c));
  else y = lineBottom / 2 + ((box.top + box.bottom) / 2) * s;
  return { glyph, box, y };
}

/** Draw one rest (glyph, knock-out for quarter and shorter, dots) into a `<g class="tab-rest">`. */
function drawRest(parent, x, el, stringCount, lineBottom, theme, wholeMeasure) {
  const s = theme.staffLineSpacing;
  const color = theme.tabFretColor;
  const duration = wholeMeasure ? 'whole' : el.duration;
  const { glyph, box, y } = restGeometry(duration, stringCount, lineBottom, theme);
  const gEl = group({ class: 'tab-rest' });
  if (duration !== 'whole' && duration !== 'half') {
    const pad = TAB_REST_KNOCKOUT_SP * s;
    gEl.appendChild(rect(x - (box.width / 2) * s - pad, y - box.top * s - pad,
      box.width * s + 2 * pad, (box.top - box.bottom) * s + 2 * pad, { fill: theme.background || '#ffffff' }));
  }
  gEl.appendChild(glyphText(x, y, glyph, theme.fontFamily, smuflFontSizePx(theme), { fill: color, 'text-anchor': 'middle' }));
  const dots = wholeMeasure ? 0 : el.dots || 0;
  if (dots) {
    // In a space at or just above the staff centre.
    const dotY = stringCount % 2 ? lineBottom / 2 - theme.tabStaffLineSpacing / 2 : lineBottom / 2;
    const dotX = x + (box.width / 2 + TAB_DOT_GAP_SP) * s;
    appendDots(gEl, dotX, dotY, dots, theme);
  }
  parent.appendChild(gEl);
  return { left: x - (box.width / 2) * s, right: x + (box.width / 2) * s, bottom: y - box.bottom * s };
}

/**
 * Draw the rhythm band of one TAB measure into `g`. `measure` is a
 * LayoutMeasure (elements with x, beamGroups, tupletGroups, wholeRest,
 * padded); `lineBottom` the bottom string's y.
 */
export function drawTabRhythm(g, measure, stringCount, lineBottom, theme) {
  const s = theme.staffLineSpacing;
  const color = theme.tabFretColor;
  const gEl = group({ class: 'tab-rhythm' });

  if (measure.wholeRest && !measure.elements.length) {
    // Empty measure: authored `beats: []` gets a whole-measure rest; normalize's padding stays blank.
    if (!measure.padded) drawRest(gEl, measure.wholeRest.x, null, stringCount, lineBottom, theme, true);
    if (gEl.children.length) g.appendChild(gEl);
    return;
  }

  const stemTop = tabStemTopY(lineBottom, theme);
  // Beat index -> its beam group (>= 2 notes) and the group's level count.
  const groupOf = new Map();
  measure.beamGroups.forEach((grp) => {
    if (grp.length < 2) return;
    const levels = Math.max(...grp.map((i) => beamCount(measure.elements[i].el.duration)));
    grp.forEach((i) => groupOf.set(i, { grp, levels }));
  });

  // Per beat: what the tuplet pass needs (x span and lowest ink).
  const drawn = new Map();
  measure.elements.forEach((layoutEl) => {
    const { el, x, index } = layoutEl;
    if (el.type === 'grace') return;
    if (el.type === 'rest') {
      drawn.set(index, drawRest(gEl, x, el, stringCount, lineBottom, theme, layoutEl.wholeMeasureRest));
      return;
    }
    const beam = groupOf.get(index);
    const levels = beam ? beam.levels : beamCount(el.duration);
    const stemEnd = stemTop + tabStemLengthSp(el.duration, levels, theme) * s;
    let bottom = stemEnd;
    if (el.duration !== 'whole') {
      gEl.appendChild(line(x, stemTop, x, stemEnd, { stroke: color, 'stroke-width': theme.stemWidth }));
    }
    const flag = el.duration === 'whole' ? null : tabFlagGlyph(el.duration, !!beam);
    if (flag) {
      const scale = theme.tabFlagScale;
      gEl.appendChild(glyphText(x, stemEnd, flag, theme.fontFamily, smuflFontSizePx(theme) * scale, { fill: color }));
      bottom = Math.max(bottom, stemEnd - glyphBox(flag).bottom * scale * s);
    }
    const dots = el.dots || 0;
    if (dots) {
      const dotX = x + tabNoteDotDxSp(el.duration, flag, theme) * s;
      const dotY = stemTop + TAB_DOT_ROW_SP * s;
      appendDots(gEl, dotX, dotY, dots, theme);
    }
    drawn.set(index, {
      left: x - TUPLET_HALF_SPAN_SP * s, right: x + TUPLET_HALF_SPAN_SP * s, bottom, stemEnd,
    });
  });

  drawBeams(gEl, measure, groupOf, drawn, theme);
  drawTuplets(gEl, measure, groupOf, drawn, stemTop, theme);
  if (gEl.children.length) g.appendChild(gEl);
}

/**
 * Flat beams at the stem ends, one group at a time. The level / segment /
 * stub loop mirrors notation's renderBeams (draw/notation.js), with every
 * stem pointing down and the beam line horizontal.
 */
function drawBeams(g, measure, groupOf, drawn, theme) {
  const s = theme.staffLineSpacing;
  const stemCap = beamStemCap(theme);
  measure.beamGroups.forEach((grp) => {
    if (grp.length < 2) return;
    const { levels } = groupOf.get(grp[0]);
    const xs = grp.map((i) => measure.elements[i].x);
    const counts = grp.map((i) => beamCount(measure.elements[i].el.duration));
    const stemEnd = drawn.get(grp[0]).stemEnd;
    for (let lvl = 0; lvl < levels; lvl++) {
      const y = stemEnd - lvl * (theme.beamWidth + BEAM_LEVEL_GAP_SP * s);
      let segStart = null;
      for (let i = 0; i < grp.length; i++) {
        const has = counts[i] >= lvl + 1;
        if (has && segStart === null) segStart = i;
        const isLast = i === grp.length - 1;
        if ((!has || isLast) && segStart !== null) {
          const segEnd = has ? i : i - 1;
          const xa = segStart === 0 ? xs[segStart] - stemCap : xs[segStart];
          if (segStart === segEnd) {
            // stub for a lone note on this level, pointing toward its neighbour
            const stubDir = segEnd === grp.length - 1 ? -1 : 1;
            g.appendChild(beamShape(xa, y, xs[segStart] + stubDir * BEAM_STUB_SP * s, y, theme.beamWidth, -1, theme.tabFretColor));
          } else {
            const xb = segEnd === grp.length - 1 ? xs[segEnd] + stemCap : xs[segEnd];
            g.appendChild(beamShape(xa, y, xb, y, theme.beamWidth, -1, theme.tabFretColor));
          }
          segStart = null;
        }
      }
    }
  });
}

/**
 * Tuplets: a number under a beam group that covers exactly the tuplet's
 * beats, else a bracket (up-ticks, number in a gap) below the band's
 * lowest ink, as notation's renderTupletBracket but upside down.
 */
function drawTuplets(g, measure, groupOf, drawn, stemTop, theme) {
  const s = theme.staffLineSpacing;
  const color = theme.tabFretColor;
  const size = TUPLET_LABEL_SIZE_SP * s;
  measure.tupletGroups.forEach(({ indices, count }) => {
    const items = indices.filter((i) => drawn.has(i)).map((i) => drawn.get(i));
    if (!items.length) return;
    const beam = groupOf.get(indices[0]);
    if (beam && beam.grp.length === indices.length && beam.grp.every((i, k) => i === indices[k])) {
      const gEl = group({ class: 'tab-tuplet' });
      const midX = (measure.elements[indices[0]].x + measure.elements[indices[indices.length - 1]].x) / 2;
      gEl.appendChild(tupletLabel(midX, items[0].stemEnd + TUPLET_NUMBER_GAP_SP * s + TEXT_ASCENT_EM * size, count, color, theme));
      g.appendChild(gEl);
    } else {
      const y = Math.max(stemTop + theme.tabStemLengthSp * s, ...items.map((it) => it.bottom)) + TUPLET_BRACKET_GAP_SP * s;
      tupletBracket(g, items[0].left, items[items.length - 1].right, y, count, { tickDir: -1, color, className: 'tab-tuplet' }, theme);
    }
  });
}
