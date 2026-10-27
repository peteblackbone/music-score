/**
 * layout/tabRhythm.js — geometry of the rhythm band below a TAB staff
 * (ui.md "rhythm on TAB staves"): stems hang down from a fixed line below
 * the bottom string, beams are flat at the stem ends, unbeamed 8th–64th
 * notes get scaled-down flags, dots sit on one row, rests sit inside the
 * staff. Shared by the timeline (horizontal extents, only when the track
 * has `tabRhythm`) and by draw/tabRhythm.js, so the room reserved and the
 * ink drawn can't drift apart. Pure functions, no DOM.
 *
 * Distances ending in `_SP` are staff spaces (theme.staffLineSpacing).
 */
import { flagForDuration, restForDuration } from '../glyphs.js';
import { glyphBox } from '../glyphMetrics.js';
import { DOT_STEP_SP, DOT_RADIUS_SP } from './chord.js';

export const TAB_LEVEL_STEP_SP = 0.75;    // extra stem length per beam level beyond 2 (32nd, 64th)
export const TAB_DOT_ROW_SP = 0.9;        // stem top -> the row of augmentation dots
export const TAB_DOT_GAP_SP = 0.5;        // stem / whole-note x / rest box right edge -> first dot
export const TAB_FLAG_DOT_GAP_SP = 0.35;  // scaled flag's right edge -> first dot
export const TAB_REST_KNOCKOUT_SP = 0.2;  // rest knock-out margin around the glyph box
export const TAB_STEM_CLEARANCE_SP = 0.2; // min gap between a bottom-string fret knock-out and the stem tops
const TAB_FRET_KNOCKOUT_PAD_SP = 0.1;     // fret knock-out margin beyond half the tab font size

/** Half-height (px) of a fret label's background knock-out (draw/tab.js), centred on its string. */
export function tabFretKnockoutHalf(theme) {
  return theme.tabFontSize / 2 + TAB_FRET_KNOCKOUT_PAD_SP * theme.staffLineSpacing;
}

/**
 * y of the stem tops (constant per staff), `lineBottom` = the bottom
 * string's y: tabStemGapSp below it, but never closer than TAB_STEM_CLEARANCE_SP under a
 * bottom-string fret knock-out.
 */
export function tabStemTopY(lineBottom, theme) {
  const s = theme.staffLineSpacing;
  const knockHalfSp = tabFretKnockoutHalf(theme) / s;
  return lineBottom + Math.max(theme.tabStemGapSp, knockHalfSp + TAB_STEM_CLEARANCE_SP) * s;
}

/**
 * Stem length in sp for `duration` with `levels` beam/flag levels (a beam
 * group's maximum when beamed): half notes a short stem, whole notes none,
 * quarter and shorter tabStemLengthSp plus 0.75 sp per level beyond 2.
 */
export function tabStemLengthSp(duration, levels, theme) {
  if (duration === 'whole') return 0;
  if (duration === 'half') return theme.tabHalfStemLengthSp;
  return theme.tabStemLengthSp + TAB_LEVEL_STEP_SP * Math.max(0, levels - 2);
}

/** Flag glyph of an unbeamed 8th–64th note (stem down), else null. */
export function tabFlagGlyph(duration, beamed) {
  return beamed ? null : flagForDuration(duration, false);
}

/** First augmentation dot's x offset (sp) from the beat x: past the scaled flag, or 0.5 sp past the stem. */
export function tabNoteDotDxSp(duration, flagGlyph, theme) {
  return flagGlyph ? glyphBox(flagGlyph).width * theme.tabFlagScale + TAB_FLAG_DOT_GAP_SP : TAB_DOT_GAP_SP;
}

/**
 * Horizontal extents (px) the rhythm band needs around a beat's x (ui.md
 * §8): `{ left, right }`. Rests: half the glyph box each side (plus dots
 * on the right); notes: nothing on the left, the scaled flag and/or dots
 * on the right. Not for grace notes.
 */
export function tabRhythmExtents(el, beamed, theme) {
  const s = theme.staffLineSpacing;
  const dots = el.dots || 0;
  if (el.type === 'rest') {
    const half = glyphBox(restForDuration(el.duration)).width / 2;
    const right = dots ? half + TAB_DOT_GAP_SP + (dots - 1) * DOT_STEP_SP + DOT_RADIUS_SP : half;
    return { left: half * s, right: right * s };
  }
  const flag = tabFlagGlyph(el.duration, beamed);
  const flagRight = flag ? glyphBox(flag).right * theme.tabFlagScale : 0;
  const dotRight = dots ? tabNoteDotDxSp(el.duration, flag, theme) + (dots - 1) * DOT_STEP_SP + DOT_RADIUS_SP : 0;
  return { left: 0, right: Math.max(flagRight, dotRight) * s };
}
