/**
 * draw/tabTrill.js — trills on the TAB staff for pass 3
 * (draw/passes/tabTechniques.js): plans each trill of a run of consecutive
 * trills (trillPlan) and draws the run at one level (renderTabTrillRun).
 * Lives outside draw/passes/; the pass hands in its per-track state.
 */
import { beatTrill, trillTabFret } from '../directions.js';
import { trillEndX, trillRunEndX, trillGeometry, renderTrill } from './trill.js';
import { tabTopY, inkTopInSpan, breakEndX } from './passes/common.js';
import { tabMarkBeat } from '../twoVoice.js';

// Trill "tr": bottom at least this far above the TAB top line and above the ink under it.
const TRILL_TAB_STAFF_CLEAR_SP = 0.4;
const TRILL_TAB_CLEAR_SP = 0.4;
// A neighbouring beat's tremolo / vibrato spans from this far left to this far right of its x (vibrato: 0.5 + up to 3.4 sp right).
const TRILL_MARKS_LEFT_SP = 0.5;
const TRILL_MARKS_REACH_SP = 4;
const FRET_HALF_SP = 1; // horizontal reach assumed for another beat's fret label when checking a trill's span

/**
 * Draw the trill run starting at TAB beat `beat` (a key of `ctx.runs`,
 * trillRuns' map): every trill of the run at the highest of their own
 * bottoms (trillPlan), its ink recorded on the run's `tabInkBoxes` (tagged
 * with the trill's x as `noteX`) and each trilled beat's wave top in
 * `ctx.trillTops`. `ctx`: `{ runs, beats, flat, stringCount, systems, theme,
 * trillTops }` (renderTabArticulations' per-track state).
 */
export function renderTabTrillRun(beat, ctx) {
  const { runs, beats, flat, stringCount, systems, theme, trillTops } = ctx;
  const plans = runs.get(beat).map((m, i, all) => trillPlan(m, all[i + 1], beats, flat, stringCount, systems, theme));
  const bottomY = Math.min(...plans.map((pl) => pl.bottomY));
  plans.forEach((pl) => {
    const drawn = renderTrill(pl.run.tabG, pl.x, bottomY, pl.endX, theme.tabFretColor, theme, pl.suffix);
    drawn.boxes.forEach((b) => pl.run.tabInkBoxes.push({ ...b, noteX: pl.x }));
    trillTops.set(pl.beat, drawn.top);
  });
}

/**
 * A trill on TAB beat `beat` (from renderTabArticulations' `beats`) as it
 * would sit alone: `{ beat, run, x, endX, suffix, bottomY }`. The wave runs
 * to just before the next note on the system (and the run's next trill,
 * `nextTrill`, when there is one); "(n)" follows "tr" when the
 * other fret is known; `bottomY` clears the TAB top line and the ink under
 * the trill - the beat's frets and marks, nearby beats' frets and marks,
 * and every bend / T / dip / H-P box drawn so far in its span.
 */
function trillPlan(beat, nextTrill, beats, flat, stringCount, systems, theme) {
  const s = theme.staffLineSpacing;
  const { layoutEl, run, x } = beat;
  const trilled = beatTrill(tabMarkBeat(layoutEl, 'trill'));
  const next = flat.find((c) => c.sysIdx === run.sysIdx && c.x > x)?.x;
  const endX = trillRunEndX(trillEndX(x, next ?? Infinity, breakEndX(systems, run.sysIdx, theme), theme), nextTrill?.x, theme);
  const fret = trillTabFret(trilled.note, trilled.trill);
  const suffix = fret != null ? `(${fret})` : null;
  const span = trillGeometry(x, 0, endX, theme, suffix);
  const inkTop = Math.min(
    inkTopInSpan(span.x1, span.x2, {
      fretTopY: layoutEl.tabRendered?.fretTopY ?? Infinity, marksTopY: layoutEl.tabRendered?.marksTopY ?? Infinity,
      boxLists: [run.tabInkBoxes, run.hpBoxes],
    }),
    ...beats.filter((o) => o.run === run && o.layoutEl !== layoutEl).flatMap(({ layoutEl: ol, x: ox }) => [
      ox - FRET_HALF_SP * s < span.x2 && ox + FRET_HALF_SP * s > span.x1 ? (ol.tabRendered?.fretTopY ?? Infinity) : Infinity,
      ox - TRILL_MARKS_LEFT_SP * s < span.x2 && ox + TRILL_MARKS_REACH_SP * s > span.x1 ? (ol.tabRendered?.marksTopY ?? Infinity) : Infinity,
    ]),
  );
  const bottomY = Math.min(tabTopY(run, stringCount, theme) - TRILL_TAB_STAFF_CLEAR_SP * s, inkTop - TRILL_TAB_CLEAR_SP * s);
  return { beat, run, x, endX, suffix, bottomY };
}
