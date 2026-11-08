/**
 * draw/handMarks.js — the shapes of the hand marks (hands.js): ornament
 * glyphs, the golpe glyph and the stacked right-hand letters above a beat
 * (placed by draw/passes/playingDirections.js and, for the golpe on TAB,
 * draw/passes/tabTechniques.js), and left-hand fingering digits beside the
 * notes, drawn per element by draw/system.js. Placement (the y of a mark's
 * bottom) is the caller's (layout/chord.js fingeringLayout decides the
 * fingering columns for spacing and drawing alike); this file only knows
 * the shapes.
 */
import { group, text, glyphText } from './svgUtil.js';
import { fingeringLayout, FINGER_SIZE_SP } from '../layout/chord.js';
import { ORNAMENT_GLYPH, ORNAMENT_CLASS } from '../hands.js';
import { Glyph } from '../glyphs.js';
import { glyphBox } from '../glyphMetrics.js';
import { smuflFontSizePx } from '../theme.js';
import { estimateTextWidth } from '../textMetrics.js';
import { TEXT_ASCENT_EM, TEXT_DESCENT_EM } from '../layout/ink.js';

// Baseline of a fingering digit below the note's centre, in em of its size (centres a digit's ink on the note).
const FINGER_CENTRE_EM = 0.35;
// Right-hand letters: italic, this size, stacked this far apart (baseline to baseline, em).
const RIGHT_FINGER_SIZE_SP = 1.1;
const RIGHT_FINGER_LINE_EM = 0.95;

/**
 * Draw `glyph` centred on `x` with its ink bottom at `bottomY` in
 * `<g class="cls">`; returns its ink box `{ x1, x2, top, bottom, text: true }`.
 */
function centredGlyph(g, x, bottomY, glyph, cls, color, theme) {
  const sp = theme.staffLineSpacing;
  const gb = glyphBox(glyph);
  const half = (gb.width / 2) * sp;
  g.appendChild(group({ class: cls }, [glyphText(x - gb.left * sp - half, bottomY + gb.bottom * sp, glyph, theme.fontFamily,
    smuflFontSizePx(theme), { fill: color })]));
  return { x1: x - half, x2: x + half, top: bottomY - (gb.top - gb.bottom) * sp, bottom: bottomY, text: true };
}

/** Half the width (px) of the ornament glyph of `kind` (hands.js ornamentOf). */
export function ornamentHalf(kind, theme) {
  return (glyphBox(Glyph[ORNAMENT_GLYPH[kind]]).width / 2) * theme.staffLineSpacing;
}

/**
 * Ornament `kind` ('turn' | 'invertedTurn' | 'upperMordent' |
 * 'lowerMordent') centred on `x`, ink bottom at `bottomY`, in
 * `<g class="ornament ornament-<kind>">`. Returns its ink box.
 */
export function renderOrnament(g, x, bottomY, kind, color, theme) {
  return centredGlyph(g, x, bottomY, Glyph[ORNAMENT_GLYPH[kind]], `ornament ${ORNAMENT_CLASS[kind]}`, color, theme);
}

/** Half the width (px) of the golpe glyph. */
export function golpeHalf(theme) {
  return (glyphBox(Glyph.guitarGolpe).width / 2) * theme.staffLineSpacing;
}

/**
 * Golpe (`kind` true | 'thumb' | 'finger') centred on `x`, ink bottom at
 * `bottomY`, in `<g class="golpe[ golpe-thumb|golpe-finger]">`. Returns its
 * ink box.
 */
export function renderGolpe(g, x, bottomY, kind, color, theme) {
  return centredGlyph(g, x, bottomY, Glyph.guitarGolpe, kind === true ? 'golpe' : `golpe golpe-${kind}`, color, theme);
}

/** Half the width (px) of the widest of the right-hand `letters`. */
export function rightFingeringHalf(letters, theme) {
  const size = RIGHT_FINGER_SIZE_SP * theme.staffLineSpacing;
  return Math.max(...letters.map((l) => estimateTextWidth(l, size))) / 2;
}

/** Height (px) of the right-hand `letters` stack as renderRightFingering draws it (top to `bottomY`). */
export function rightFingeringHeight(letters, theme) {
  const size = RIGHT_FINGER_SIZE_SP * theme.staffLineSpacing;
  return (TEXT_DESCENT_EM + (letters.length - 1) * RIGHT_FINGER_LINE_EM + TEXT_ASCENT_EM) * size;
}

/**
 * Right-hand letters (`letters`, lowest note first; hands.js
 * rightFingerStack) stacked upward, italic, centred on `x`, the lowest
 * letter's descent at `bottomY`, in `<g class="fingering-right">`. Returns
 * the ink box (estimated text extents).
 */
export function renderRightFingering(g, x, bottomY, letters, color, theme) {
  const size = RIGHT_FINGER_SIZE_SP * theme.staffLineSpacing;
  const half = rightFingeringHalf(letters, theme);
  const baseY = bottomY - TEXT_DESCENT_EM * size;
  const gEl = group({ class: 'fingering-right' });
  letters.forEach((l, k) => {
    gEl.appendChild(text(x, baseY - k * RIGHT_FINGER_LINE_EM * size, l, {
      'font-family': theme.textFontFamily,
      'font-style': 'italic',
      'font-size': size,
      'text-anchor': 'middle',
      fill: color,
    }));
  });
  g.appendChild(gEl);
  const top = baseY - (letters.length - 1) * RIGHT_FINGER_LINE_EM * size - TEXT_ASCENT_EM * size;
  return { x1: x - half, x2: x + half, top, bottom: bottomY, text: true };
}

/**
 * Left-hand fingering of a notation chord (`layoutEl` with `rendered` and
 * `chord`): `<g class="fingering-left">` with one plain digit (or "T") per
 * fingered note, right-aligned on its column (fingeringLayout) and centred
 * on the notehead's y. Nothing when no note has a finger.
 */
export function renderLeftFingering(g, layoutEl, theme) {
  const fl = fingeringLayout(layoutEl.el.notes || [], layoutEl.chord, theme);
  const heads = layoutEl.rendered?.noteheads || [];
  if (!fl || !heads.length) return;
  const size = FINGER_SIZE_SP * theme.staffLineSpacing;
  const gEl = group({ class: 'fingering-left' });
  fl.items.forEach((it) => {
    gEl.appendChild(text(layoutEl.x + it.dx, heads[it.noteIndex].y + FINGER_CENTRE_EM * size, it.label, {
      'font-family': theme.textFontFamily,
      'font-size': size,
      'text-anchor': 'end',
      fill: theme.noteColor,
    }));
  });
  g.appendChild(gEl);
}
