/**
 * draw/header.js — the page header above the first system (ui.md §1):
 *
 * - row 1: `score.title`, centred on the page, the largest text (2.4 sp);
 * - row 2 (2.5 sp below the title baseline): `score.composer` right-aligned
 *   at the right margin and `score.tuningLabel` left-aligned at the left
 *   margin, italic, both 1.3 sp.
 *
 * A row whose texts are missing takes no space. The tempo mark is not part
 * of the header: it belongs to system 1 (draw/decor.js drawTempo).
 */
import { group, text } from './svgUtil.js';

const TITLE_SIZE_SP = 2.4;
const ROW2_SIZE_SP = 1.3;
const ROW2_BELOW_TITLE_SP = 2.5;  // title baseline -> row-2 baseline
const CAP_HEIGHT = 0.75;          // first baseline sits this many font sizes below the top margin

/**
 * Append the score header (if the score has a title, composer or tuning
 * label) to `svg`; `top` is the top margin y, `width` the page width.
 * Returns the last row's baseline, or null when nothing was drawn.
 */
export function drawScoreHeader(svg, score, theme, top, width) {
  const hasRow2 = !!(score.composer || score.tuningLabel);
  if (!score.title && !hasRow2) return null;
  const s = theme.staffLineSpacing;
  const headerG = group({ class: 'score-header' });
  let last = null;
  if (score.title) {
    last = top + CAP_HEIGHT * TITLE_SIZE_SP * s;
    headerG.appendChild(text(width / 2, last, score.title, {
      class: 'title', 'font-family': theme.textFontFamily, 'font-size': TITLE_SIZE_SP * s,
      'text-anchor': 'middle', fill: theme.noteColor,
    }));
  }
  if (hasRow2) {
    last = last != null ? last + ROW2_BELOW_TITLE_SP * s : top + CAP_HEIGHT * ROW2_SIZE_SP * s;
    if (score.tuningLabel) {
      headerG.appendChild(text(theme.marginLeftSp * s, last, score.tuningLabel, {
        class: 'tuning', 'font-family': theme.textFontFamily, 'font-size': ROW2_SIZE_SP * s, 'font-style': 'italic',
        fill: theme.noteColor,
      }));
    }
    if (score.composer) {
      headerG.appendChild(text(width - theme.marginRightSp * s, last, score.composer, {
        class: 'composer', 'font-family': theme.textFontFamily, 'font-size': ROW2_SIZE_SP * s,
        'text-anchor': 'end', fill: theme.noteColor,
      }));
    }
  }
  svg.appendChild(headerG);
  return last;
}
