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
 * A two-voice measure draws one row per voice (drawBandRow): voice 1's as
 * above in `<g class="tab-rhythm">`, then voice 2's in `<g class="tab-rhythm
 * voice-2">`, the same shapes hanging from a lower stem top (tabRow2TopY,
 * once per system and TAB staff, below voice 1's deepest band ink) at the
 * column x. Rests merged with the other voice's (layout/voices.js) are
 * drawn once, voice 1's, in the staff as above; every other rest sits in
 * its own row at tabFlagScale without a knock-out (whole and half rests
 * with a leger line), a whole-measure rest centred in the bar.
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
  tabStemTopY, tabStemLengthSp, tabFlagGlyph, tabNoteDotDxSp, tabBandRest, tabBandRestY,
  TAB_DOT_ROW_SP, TAB_DOT_GAP_SP, TAB_REST_KNOCKOUT_SP,
} from '../layout/tabRhythm.js';
import { TEXT_ASCENT_EM, inkBounds } from '../layout/ink.js';
import { restForDuration } from '../glyphs.js';
import { glyphBox } from '../glyphMetrics.js';
import { smuflFontSizePx } from '../theme.js';
import { beamCount, isHiddenRest } from '../duration.js';
import { DOT_STEP_SP, DOT_RADIUS_SP } from '../layout/chord.js';
import { isTwoVoiceMeasure, voiceOf } from '../twoVoice.js';

const TUPLET_NUMBER_GAP_SP = 0.3; // primary beam's lower edge -> top of the tuplet number
const TUPLET_BRACKET_GAP_SP = 0.6; // lowest band ink -> tuplet bracket line
const TUPLET_HALF_SPAN_SP = 0.5;  // bracket end past a note's x
const ROW_MIN_DEPTH_SP = 2.5;     // voice 1's band depth below its stem top, counted at least this much
const ROW_GAP_SP = 1.5;           // voice 1's deepest band ink -> voice 2's stem top

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
 * Draw one band-row rest (ui.md §4: the tabFlagScale glyph centred below
 * the row's stem top `top`, no knock-out, dots on the row's dot line) into
 * a `<g class="tab-rest">`.
 */
function drawBandRest(parent, x, el, top, theme, wholeMeasure) {
  const s = theme.staffLineSpacing;
  const { glyph, box } = tabBandRest(wholeMeasure ? 'whole' : el.duration, theme);
  const y = tabBandRestY(top, box, s);
  const gEl = group({ class: 'tab-rest' });
  gEl.appendChild(glyphText(x, y, glyph, theme.fontFamily, smuflFontSizePx(theme) * theme.tabFlagScale,
    { fill: theme.tabFretColor, 'text-anchor': 'middle' }));
  const dots = wholeMeasure ? 0 : el.dots || 0;
  if (dots) appendDots(gEl, x + (box.width / 2 + TAB_DOT_GAP_SP) * s, top + TAB_DOT_ROW_SP * s, dots, theme);
  parent.appendChild(gEl);
  return { left: x - (box.width / 2) * s, right: x + (box.width / 2) * s, bottom: y - box.bottom * s };
}

/** Voice `voice`'s band row of two-voice measure `measure` (see drawBandRow), stems from `stemTop`. */
function twoVoiceRow(measure, voice, stemTop) {
  return voice === 1
    ? { elements: measure.elements, beamGroups: measure.beamGroups, tupletGroups: measure.tupletGroups, stemTop, xOf: (le) => le.x, restMode: 'row' }
    : { elements: measure.elements2, beamGroups: measure.beamGroups2, tupletGroups: measure.tupletGroups2, stemTop, xOf: (le) => le.x - le.dx, restMode: 'row' };
}

/**
 * Stem top (px) of voice 2's band row on one TAB staff of one system, from
 * the two-voice `measures` there: voice 1's rows are drawn into a detached
 * probe and measured (ui.md §4: T2 = T1 + (max(2.5, D1) + 1.5) sp).
 */
export function tabRow2TopY(measures, stringCount, lineBottom, theme) {
  const s = theme.staffLineSpacing;
  const stemTop = tabStemTopY(lineBottom, theme);
  const probe = group();
  measures.forEach((m) => drawBandRow(probe, twoVoiceRow(m, 1, stemTop), stringCount, lineBottom, theme));
  const depth = Math.max(0, inkBounds(probe, theme).bottom - stemTop);
  return stemTop + (Math.max(ROW_MIN_DEPTH_SP, depth / s) + ROW_GAP_SP) * s;
}

/**
 * Draw the rhythm band of one TAB measure into `g`. `measure` is a
 * LayoutMeasure (elements with x, beamGroups, tupletGroups, wholeRest,
 * padded); `lineBottom` the bottom string's y; `row2Y` voice 2's stem top
 * in a two-voice measure (tabRow2TopY; this measure's own when absent).
 */
export function drawTabRhythm(g, measure, stringCount, lineBottom, theme, row2Y = null) {
  if (measure.wholeRest && !measure.elements.length) {
    // Empty measure: authored `beats: []` gets a whole-measure rest; normalize's padding stays blank.
    const gEl = group({ class: 'tab-rhythm' });
    if (!measure.padded) drawRest(gEl, measure.wholeRest.x, null, stringCount, lineBottom, theme, true);
    if (gEl.children.length) g.appendChild(gEl);
    return;
  }

  const stemTop = tabStemTopY(lineBottom, theme);
  const rows = isTwoVoiceMeasure(measure)
    ? [['tab-rhythm', twoVoiceRow(measure, 1, stemTop)],
      ['tab-rhythm voice-2', twoVoiceRow(measure, 2, row2Y ?? tabRow2TopY([measure], stringCount, lineBottom, theme))]]
    : [['tab-rhythm', { elements: measure.elements, beamGroups: measure.beamGroups, tupletGroups: measure.tupletGroups, stemTop, xOf: (le) => le.x, restMode: 'staff' }]];
  rows.forEach(([cls, row]) => {
    const gEl = group({ class: cls });
    drawBandRow(gEl, row, stringCount, lineBottom, theme);
    if (gEl.children.length) g.appendChild(gEl);
  });
}

/**
 * One band row into `gEl`. `row` = `{ elements, beamGroups, tupletGroups,
 * stemTop, xOf, restMode }`: `xOf(layoutEl)` the beat's x, `restMode`
 * 'staff' (every rest in the staff) or 'row' (two-voice rules, see the
 * header). Per beat its rest or stem, flag and dots; then beams, then tuplets.
 */
function drawBandRow(gEl, row, stringCount, lineBottom, theme) {
  const s = theme.staffLineSpacing;
  const color = theme.tabFretColor;
  const { stemTop } = row;
  // Beat index -> its beam group (>= 2 notes) and the group's level count.
  const groupOf = new Map();
  row.beamGroups.forEach((grp) => {
    if (grp.length < 2) return;
    const levels = Math.max(...grp.map((i) => beamCount(row.elements[i].el.duration)));
    grp.forEach((i) => groupOf.set(i, { grp, levels }));
  });

  // Per beat: what the tuplet pass needs (x span and lowest ink).
  const drawn = new Map();
  row.elements.forEach((layoutEl) => {
    const { el, index } = layoutEl;
    const x = row.xOf(layoutEl);
    if (el.type === 'grace') return;
    if (el.type === 'rest') {
      if (isHiddenRest(el) || (layoutEl.restMerged && voiceOf(layoutEl) === 2)) return;
      drawn.set(index, row.restMode === 'staff' || layoutEl.restMerged
        ? drawRest(gEl, x, el, stringCount, lineBottom, theme, layoutEl.wholeMeasureRest)
        : drawBandRest(gEl, x, el, stemTop, theme, layoutEl.wholeMeasureRest));
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

  drawBeams(gEl, row, groupOf, drawn, theme);
  drawTuplets(gEl, row, groupOf, drawn, theme);
}

/**
 * Flat beams at the stem ends, one group at a time. The level / segment /
 * stub loop mirrors notation's renderBeams (draw/notation.js), with every
 * stem pointing down and the beam line horizontal.
 */
function drawBeams(g, row, groupOf, drawn, theme) {
  const s = theme.staffLineSpacing;
  const stemCap = beamStemCap(theme);
  row.beamGroups.forEach((grp) => {
    if (grp.length < 2) return;
    const { levels } = groupOf.get(grp[0]);
    const xs = grp.map((i) => row.xOf(row.elements[i]));
    const counts = grp.map((i) => beamCount(row.elements[i].el.duration));
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
 * lowest ink, as notation's renderTupletBracket but upside down. Nested
 * tuplets: inner and plain groups first, as above; then each outer group
 * (`depth: 0`) always as a bracket (`tab-tuplet tab-tuplet-outer`),
 * TUPLET_BRACKET_GAP_SP below the ink under its span, inner tuplets included.
 */
function drawTuplets(g, row, groupOf, drawn, theme) {
  const s = theme.staffLineSpacing;
  const color = theme.tabFretColor;
  const size = TUPLET_LABEL_SIZE_SP * s;
  const bracketY = (items) => Math.max(row.stemTop + theme.tabStemLengthSp * s, ...items.map((it) => it.bottom)) + TUPLET_BRACKET_GAP_SP * s;
  const itemsOf = (indices) => indices.filter((i) => drawn.has(i)).map((i) => drawn.get(i));
  row.tupletGroups.forEach(({ indices, count, depth }) => {
    if (depth === 0) return;
    const items = itemsOf(indices);
    if (!items.length) return;
    const beam = groupOf.get(indices[0]);
    if (beam && beam.grp.length === indices.length && beam.grp.every((i, k) => i === indices[k])) {
      const gEl = group({ class: 'tab-tuplet' });
      const midX = (row.xOf(row.elements[indices[0]]) + row.xOf(row.elements[indices[indices.length - 1]])) / 2;
      gEl.appendChild(tupletLabel(midX, items[0].stemEnd + TUPLET_NUMBER_GAP_SP * s + TEXT_ASCENT_EM * size, count, color, theme));
      g.appendChild(gEl);
    } else {
      tupletBracket(g, items[0].left, items[items.length - 1].right, bracketY(items), count, { tickDir: -1, color, className: 'tab-tuplet' }, theme);
    }
  });
  row.tupletGroups.forEach(({ indices, count, depth }) => {
    if (depth !== 0) return;
    const items = itemsOf(indices);
    if (!items.length) return;
    const left = items[0].left; const right = items[items.length - 1].right;
    const ink = inkBounds(g, theme, { xMin: left, xMax: right, overlap: true }).bottom;
    const y = Math.max(bracketY(items), Number.isFinite(ink) ? ink + TUPLET_BRACKET_GAP_SP * s : -Infinity);
    tupletBracket(g, left, right, y, count, { tickDir: -1, color, className: 'tab-tuplet tab-tuplet-outer' }, theme);
  });
}
