/**
 * draw/handMarks.js — the shapes of the hand marks (hands.js): left-hand
 * fingering digits beside the notes, drawn per element by draw/system.js.
 * Placement is the caller's (layout/chord.js fingeringLayout decides the
 * fingering columns for spacing and drawing alike); this file only knows
 * the shapes.
 */
import { group, text } from './svgUtil.js';
import { fingeringLayout, FINGER_SIZE_SP } from '../layout/chord.js';

// Baseline of a fingering digit below the note's centre, in em of its size (centres a digit's ink on the note).
const FINGER_CENTRE_EM = 0.35;

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
