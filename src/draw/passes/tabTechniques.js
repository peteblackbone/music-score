/**
 * draw/passes/tabTechniques.js — pass 3 (draw/passes.js): tab
 * hammer-on/pull-off, slide and bend (draw/tabLinks.js), tap "T", golpe and
 * whammy dip, drawn into each run's TAB group. Reads `layoutEl.tabRendered` (fret
 * and mark tops); writes `run.tabInkBoxes` (bend, "T", golpe and dip ink) and
 * `run.hpBoxes` (hammer-on/pull-off ink) for passes 4 and 5.
 */
import {
  techniqueLabelSize, renderTapMark, tapMarkHalf, renderWhammyDip, whammyDipGeometry,
} from '../tab.js';
import { renderTabLinks } from '../tabLinks.js';
import { TEXT_ASCENT_EM, TEXT_DESCENT_EM } from '../../layout/ink.js';
import { beatTapMark, beatWhammy, beatTrill, trillTabFret } from '../../directions.js';
import { trillEndX, trillRunEndX, trillGeometry, trillRuns, renderTrill } from '../trill.js';
import { renderGolpe, golpeHalf } from '../handMarks.js';
import { beatGolpe } from '../../hands.js';
import { planWhammyLines, renderWhammyLine } from '../whammy.js';
import { flattenRuns, tabTopY, inkTopInSpan, breakEndX, breakStartX } from './common.js';

// Tap "T" / slap "S" / pop "P" on the TAB staff: baseline at least this far above the top line, the beat's topmost fret label and its tremolo / vibrato.
const TAP_STAFF_CLEAR_SP = 0.4;
const TAP_FRET_CLEAR_SP = 0.4;
const TAP_MARK_CLEAR_SP = 0.3;
// Trill "tr": bottom at least this far above the TAB top line and above the ink under it; the T / S / P above it clears it by TAP_TRILL_CLEAR_SP.
const TRILL_TAB_STAFF_CLEAR_SP = 0.4;
const TRILL_TAB_CLEAR_SP = 0.4;
const TAP_TRILL_CLEAR_SP = 0.4;
// A neighbouring beat's tremolo / vibrato spans from this far left to this far right of its x (vibrato: 0.5 + up to 3.4 sp right).
const TRILL_MARKS_LEFT_SP = 0.5;
const TRILL_MARKS_REACH_SP = 4;
// ...and raised clear of a nearby hammer-on/pull-off letter: its box at least this far from the letter's knock-out (sideways, or above it).
const TAP_HP_CLEAR_SP = 0.5;
// Whammy dip: its tip at least WHAMMY_STAFF_CLEAR_SP above the TAB top line and WHAMMY_CLEAR_SP above the ink under it.
const WHAMMY_STAFF_CLEAR_SP = 0.5;
const WHAMMY_CLEAR_SP = 0.4;
const WHAMMY_FRET_HALF_SP = 1; // horizontal reach assumed for another beat's fret label when checking a dip's span

/**
 * Tab-only articulations. First the per-note links of each TAB track
 * (hammer-on/pull-off, slide, bend: draw/tabLinks.js renderTabLinks).
 *
 * Then, per beat (main note beats only; directions.js):
 *
 * - a trill (`note.trill`) draws "tr" and a wavy line (draw/trill.js) above
 *   the beat's frets and marks and the TAB top line, "(n)" after the glyph
 *   when the fret it alternates with is known; the wave ends 0.8 sp before
 *   the next beat and never past the system's last barline; consecutive
 *   trills on a system (graces between them allowed; trillRuns) share one
 *   line, the highest of their own, each wave ending before the next "tr",
 *   drawn before the run's T / S / P and dips;
 * - a tapped note (`note.tap`, not a tapped harmonic) puts one bold "T"
 *   above the beat, above the TAB top line, the beat's topmost fret label
 *   and its tab tremolo / vibrato, raised above any hammer-on/pull-off
 *   letter it would come within TAP_HP_CLEAR_SP of, and above a trill; a
 *   slapped / popped note (`note.slap` / `note.pop`) gets an "S" / "P" the
 *   same way, in the same slot, and a left-hand tapped note
 *   (`note.leftHandTap`) the left-hand tapping glyph (one mark per beat,
 *   priority T > left-hand tap > S > P; `beatTapMark`);
 * - a golpe (`golpe`; draw/handMarks.js) sits on the T's baseline, at
 *   least TAP_TRILL_CLEAR_SP above the beat's T / S / P and any trill, T or
 *   hammer-on/pull-off ink in its span; the wider left-hand tap glyph clears
 *   the trill / T ink in its span the same way;
 * - `whammy` draws a dip ("V" plus "-1/2") above the TAB staff, its width
 *   limited like a bend's, stacked above the beat's frets, marks, "T" / "S" /
 *   "P", golpe, trill and any bend under it;
 * - after all beats, whammy dives, returns and pre-dives (draw/whammy.js):
 *   one line per system segment, each at one level above the frets, marks,
 *   letters, trills, bends and dips under it, 0.5 sp above the TAB top line.
 *
 * Bend, trill, tap "T", golpe and whammy-dip ink boxes are recorded on the run
 * (`run.tabInkBoxes`, each tagged with its note's x as `noteX`),
 * hammer-ons/pull-offs theirs on `run.hpBoxes`, for the label and
 * directions passes.
 */
export function renderTabArticulations(score, trackRuns, theme, systems) {
  const s = theme.staffLineSpacing;
  trackRuns.forEach((run) => { run.tabInkBoxes = []; run.hpBoxes = []; });
  score.tracks.forEach((track) => {
    if (!track.showTablature) return;
    const stringCount = track.tuning.length;
    const flat = renderTabLinks(track, trackRuns, systems, theme, { flattenRuns, breakEndX, breakStartX });

    // Per beat, after every note mark: tap "T", then whammy dip. Their ink
    // boxes join the bend boxes, so technique labels (and later dips) clear them.
    const beats = [];
    flattenRuns(trackRuns, track, (layoutEl, run) => beats.push({ layoutEl, run }));
    // Consecutive trills on a system share one line: drawn together at the run's first beat, at the highest of their own bottoms.
    const runs = trillRuns(beats, (b) => !!beatTrill(b.layoutEl.el), (b) => b.run.sysIdx, (b) => b.layoutEl.el.type === 'grace');
    const trillTops = new Map();
    beats.forEach((beat) => {
      const { layoutEl, run } = beat;
      const el = layoutEl.el;
      const x = layoutEl.x;
      const mark = beatTapMark(el);
      const dip = beatWhammy(el);
      const trilled = beatTrill(el);
      const golpe = beatGolpe(el);
      if (!mark && !dip && !trilled && !golpe) return;
      const tabTop = tabTopY(run, stringCount, theme);
      const fretTop = layoutEl.tabRendered?.fretTopY ?? Infinity;
      const marksTop = layoutEl.tabRendered?.marksTopY ?? Infinity;
      if (trilled && !trillTops.has(beat)) {
        const plans = runs.get(beat).map((m, i, all) => trillPlan(m, all[i + 1], beats, flat, stringCount, systems, theme));
        const bottomY = Math.min(...plans.map((pl) => pl.bottomY));
        plans.forEach((pl) => {
          const drawn = renderTrill(pl.run.tabG, pl.x, bottomY, pl.endX, theme.tabFretColor, theme, pl.suffix);
          drawn.boxes.forEach((b) => pl.run.tabInkBoxes.push({ ...b, noteX: pl.x }));
          trillTops.set(pl.beat, drawn.top);
        });
      }
      const trillTop = trilled ? trillTops.get(beat) : Infinity;
      const size = techniqueLabelSize(theme);
      // The T's baseline on the beat's own ink (frets, marks, trill).
      const tapBase = Math.min(tabTop - TAP_STAFF_CLEAR_SP * s, fretTop - TAP_FRET_CLEAR_SP * s, marksTop - TAP_MARK_CLEAR_SP * s,
        trillTop - TAP_TRILL_CLEAR_SP * s - TEXT_DESCENT_EM * size);
      if (mark) {
        let baselineY = tapBase;
        // Raise the T above any H/P letter its box comes within TAP_HP_CLEAR_SP of (lowest letter first, so a raise
        // that reaches a higher letter clears that one too).
        const half = tapMarkHalf(mark, theme);
        // The wider left-hand tap glyph also clears the trill / T ink drawn so far in its span (a neighbouring trill's wave).
        if (mark === 'leftHandTap') {
          baselineY = Math.min(baselineY, inkTopInSpan(x - half, x + half, { boxLists: [run.tabInkBoxes] }) - TAP_TRILL_CLEAR_SP * s - TEXT_DESCENT_EM * size);
        }
        const pad = TAP_HP_CLEAR_SP * s;
        run.hpBoxes.filter((b) => b.letter && b.letter.x1 < x + half + pad && b.letter.x2 > x - half - pad)
          .map((b) => b.letter).sort((a, b) => b.top - a.top)
          .forEach((l) => {
            if (l.top < baselineY + TEXT_DESCENT_EM * size + pad && l.bottom > baselineY - TEXT_ASCENT_EM * size - pad) {
              baselineY = l.top - pad - TEXT_DESCENT_EM * size;
            }
          });
        run.tabInkBoxes.push({ ...renderTapMark(run.tabG, x, baselineY, theme.tabFretColor, theme, mark), noteX: x });
      }
      if (golpe) {
        // On the T's baseline, TAP_TRILL_CLEAR_SP above the T / trill / hammer-on/pull-off ink drawn so far in its span.
        const half = golpeHalf(theme);
        const inkTop = inkTopInSpan(x - half, x + half, { boxLists: [run.tabInkBoxes, run.hpBoxes] });
        run.tabInkBoxes.push({ ...renderGolpe(run.tabG, x, Math.min(tapBase, inkTop - TAP_TRILL_CLEAR_SP * s), golpe, theme.tabFretColor, theme), noteX: x });
      }
      if (dip) {
        // Width limited like a bend's: the next note in the system, never past the last barline.
        const next = flat.find((c) => c.sysIdx === run.sysIdx && c.x > x)?.x;
        const nextX = Math.min(next ?? Infinity, systems[run.sysIdx].lastBarlineX);
        const span = whammyDipGeometry(x, 0, dip, theme, nextX).boxes;
        const sx1 = Math.min(...span.map((b) => b.x1));
        const sx2 = Math.max(...span.map((b) => b.x2));
        // Ink under the dip: this beat's frets and marks, nearby beats' frets, and every bend / T / dip box in its span.
        const inkTop = Math.min(
          inkTopInSpan(sx1, sx2, { fretTopY: fretTop, marksTopY: marksTop, boxLists: [run.tabInkBoxes] }),
          ...beats.filter((o) => o.run === run && o.layoutEl !== layoutEl
            && o.layoutEl.x - WHAMMY_FRET_HALF_SP * s < sx2 && o.layoutEl.x + WHAMMY_FRET_HALF_SP * s > sx1)
            .map((o) => o.layoutEl.tabRendered?.fretTopY ?? Infinity),
        );
        const bottomY = Math.min(tabTop - WHAMMY_STAFF_CLEAR_SP * s, inkTop - WHAMMY_CLEAR_SP * s);
        renderWhammyDip(run.tabG, x, bottomY, dip, theme, nextX)
          .forEach((b) => run.tabInkBoxes.push({ ...b, noteX: x }));
      }
    });

    // Whammy dive / hold / return lines last, above every per-beat mark under them, one level per segment.
    planWhammyLines(trackRuns.filter((r) => r.track === track), systems, theme).forEach((seg) => {
      const run = seg.run;
      const lx1 = Math.min(...seg.pts.map((p) => p.x));
      const lx2 = Math.max(...seg.pts.map((p) => p.x));
      const inkTop = Math.min(
        inkTopInSpan(lx1, lx2, { boxLists: [run.tabInkBoxes, run.hpBoxes] }),
        ...beats.filter((o) => o.run === run && o.layoutEl.x > lx1 - WHAMMY_FRET_HALF_SP * s && o.layoutEl.x < lx2 + WHAMMY_FRET_HALF_SP * s)
          .flatMap((o) => [o.layoutEl.tabRendered?.fretTopY ?? Infinity, o.layoutEl.tabRendered?.marksTopY ?? Infinity]),
      );
      const bottomY = Math.min(tabTopY(run, stringCount, theme) - WHAMMY_STAFF_CLEAR_SP * s, inkTop - WHAMMY_CLEAR_SP * s);
      renderWhammyLine(run.tabG, seg, bottomY, theme).forEach((b) => run.tabInkBoxes.push(b));
    });
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
  const { layoutEl, run } = beat;
  const x = layoutEl.x;
  const trilled = beatTrill(layoutEl.el);
  const next = flat.find((c) => c.sysIdx === run.sysIdx && c.x > x)?.x;
  const endX = trillRunEndX(trillEndX(x, next ?? Infinity, breakEndX(systems, run.sysIdx, theme), theme), nextTrill?.layoutEl.x, theme);
  const fret = trillTabFret(trilled.note, trilled.trill);
  const suffix = fret != null ? `(${fret})` : null;
  const span = trillGeometry(x, 0, endX, theme, suffix);
  const inkTop = Math.min(
    inkTopInSpan(span.x1, span.x2, {
      fretTopY: layoutEl.tabRendered?.fretTopY ?? Infinity, marksTopY: layoutEl.tabRendered?.marksTopY ?? Infinity,
      boxLists: [run.tabInkBoxes, run.hpBoxes],
    }),
    ...beats.filter((o) => o.run === run && o.layoutEl !== layoutEl).flatMap(({ layoutEl: ol }) => [
      ol.x - WHAMMY_FRET_HALF_SP * s < span.x2 && ol.x + WHAMMY_FRET_HALF_SP * s > span.x1 ? (ol.tabRendered?.fretTopY ?? Infinity) : Infinity,
      ol.x - TRILL_MARKS_LEFT_SP * s < span.x2 && ol.x + TRILL_MARKS_REACH_SP * s > span.x1 ? (ol.tabRendered?.marksTopY ?? Infinity) : Infinity,
    ]),
  );
  const bottomY = Math.min(tabTopY(run, stringCount, theme) - TRILL_TAB_STAFF_CLEAR_SP * s, inkTop - TRILL_TAB_CLEAR_SP * s);
  return { beat, run, x, endX, suffix, bottomY };
}
