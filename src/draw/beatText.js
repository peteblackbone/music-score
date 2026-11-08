/**
 * draw/beatText.js — free text on a beat (`beat.text`, scoreText.js
 * canonicalBeatText): italic 1.2 sp, left edge at the beat's x, above the
 * track's top staff (notation, else TAB) or, with `below: true`, below its
 * bottom staff (TAB, else notation). Voice-1 note / rest beats only (grace
 * notes and voice 2 are ignored).
 *
 * Runs after renderFermatas and before navigation (MusicScoreRenderer.js),
 * outside the pass barrel (draw/passes.js): each text's baseline clears the
 * ink already under its estimated width by BEAT_TEXT_CLEARANCE_SP (music,
 * pick strokes / TAB labels / bends, chord diagrams / symbols, fermatas)
 * and sits at least BEAT_TEXT_MIN_ABOVE_SP above the top line. Texts are
 * appended one by one, left to right, so a later text also clears the
 * earlier ones; voltas and navigation marks then clear the texts. There is
 * no horizontal avoidance.
 */
import { text } from './svgUtil.js';
import { inkBounds, TEXT_ASCENT_EM, TEXT_DESCENT_EM } from '../layout/ink.js';
import { estimateTextWidth } from '../textMetrics.js';
import { canonicalBeatText } from '../scoreText.js';
import { tabTopY } from './passes/common.js';

const BEAT_TEXT_SIZE_SP = 1.2;
const BEAT_TEXT_CLEARANCE_SP = 0.5;   // text -> ink above / below which it sits
const BEAT_TEXT_MIN_ABOVE_SP = 1.5;   // top line -> baseline of a text above, at least
const BEAT_TEXT_SPAN_PAD_SP = 0.1;    // measured span beyond the text each side (a TAB stem at the beat x has stroke width and 2-dp coordinates)

/** Draw every beat text of every track run (see the module header). */
export function renderBeatText(trackRuns, theme) {
  const s = theme.staffLineSpacing;
  const size = BEAT_TEXT_SIZE_SP * s;
  trackRuns.forEach((run) => {
    if (!run.notationG && !run.tabG) return;
    const aboveG = run.notationG ?? run.tabG;
    const topLine = run.notationG ? 0 : tabTopY(run, run.track.tuning.length, theme);
    const belowG = run.tabG ?? run.notationG;
    const bottomLine = run.tabG ? run.tabBaselineY : run.notationBaselineY;
    run.measures.forEach((measure) => {
      measure.elements.forEach((le) => {
        if (le.el.type === 'grace') return;
        const t = canonicalBeatText(le.el.text);
        if (!t) return;
        const pad = BEAT_TEXT_SPAN_PAD_SP * s;
        const span = { xMin: le.x - pad, xMax: le.x + estimateTextWidth(t.text, size) + pad, overlap: true };
        let y;
        if (t.below) {
          const bottom = inkBounds(belowG, theme, span).bottom;
          y = (Number.isFinite(bottom) ? bottom : bottomLine) + BEAT_TEXT_CLEARANCE_SP * s + TEXT_ASCENT_EM * size;
        } else {
          const top = inkBounds(aboveG, theme, span).top;
          y = Math.min(topLine - BEAT_TEXT_MIN_ABOVE_SP * s, Number.isFinite(top) ? top - BEAT_TEXT_CLEARANCE_SP * s - TEXT_DESCENT_EM * size : Infinity);
        }
        (t.below ? belowG : aboveG).appendChild(text(le.x, y, t.text, {
          class: t.below ? 'beat-text beat-text-below' : 'beat-text',
          'font-family': theme.textFontFamily,
          'font-size': size,
          'font-style': 'italic',
          fill: theme.noteColor,
        }));
      });
    });
  });
}
