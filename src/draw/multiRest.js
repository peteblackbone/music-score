/**
 * draw/multiRest.js — a multi-measure rest (layout/multiRest.js): a thick
 * H-bar between `measure.multiRest.x1` and `x2` with short vertical end
 * strokes, and the bar count in time-signature digits above the staff.
 *
 * Notation staff: the bar is centred on the middle line, the strokes run
 * from the 2nd to the 4th line, the count's box bottom sits
 * MULTI_REST_COUNT_GAP_SP above the top line. TAB staff (drawn only when the
 * track shows rhythm on TAB; the caller decides): the bar is centred at the
 * staff's mid-height, the strokes reach 1 sp above and below it, the count
 * sits above the top line.
 */
import { group, rect, line, glyphText } from './svgUtil.js';
import { timeSigDigits } from '../glyphs.js';
import { glyphStringBox } from '../glyphMetrics.js';
import { smuflFontSizePx } from '../theme.js';

export const H_BAR_THICKNESS_SP = 1.0;     // Bravura engravingDefaults hBarThickness
export const MULTI_REST_COUNT_GAP_SP = 0.5; // count box bottom -> top staff line
const TAB_STROKE_HALF_SP = 1;

/** Draw `measure.multiRest` on a staff whose bottom line is at `lineBottom` (`kind` 'notation' | 'tab'). */
export function renderMultiRest(g, measure, kind, lineBottom, theme) {
  const s = theme.staffLineSpacing;
  const { x1, x2, count } = measure.multiRest;
  const midY = lineBottom / 2;
  const half = kind === 'tab' ? TAB_STROKE_HALF_SP * s : s;
  const color = kind === 'tab' ? theme.tabFretColor : theme.noteColor;
  const bar = group({ class: 'multi-rest' });
  bar.appendChild(rect(x1, midY - (H_BAR_THICKNESS_SP / 2) * s, x2 - x1, H_BAR_THICKNESS_SP * s, { fill: color }));
  for (const x of [x1, x2]) {
    bar.appendChild(line(x, midY - half, x, midY + half, { stroke: color, 'stroke-width': theme.staffLineWidth }));
  }
  g.appendChild(bar);
  const digits = timeSigDigits(count);
  const box = glyphStringBox(digits);
  const y = -MULTI_REST_COUNT_GAP_SP * s + box.bottom * s;
  const num = group({ class: 'multi-rest-count' });
  num.appendChild(glyphText((x1 + x2) / 2, y, digits, theme.fontFamily, smuflFontSizePx(theme), { fill: color, 'text-anchor': 'middle' }));
  g.appendChild(num);
}
