/**
 * draw/passes/playingDirections.js — pass 5 (draw/passes.js): pick strokes
 * and notation tap "T" above the beat, clear of the slurs drawn above it.
 * On tab-only tracks reads `run.tabInkBoxes`, `run.hpBoxes` (pass 3) and
 * `run.labelBoxes` (pass 4); writes `info.directionTopY` for pass 7.
 */
import { renderPickStroke, curveOuterPoints } from '../notation.js';
import { renderTapMark, techniqueLabelSize } from '../tab.js';
import { TEXT_ASCENT_EM, TEXT_DESCENT_EM } from '../../layout/ink.js';
import { estimateTextWidth } from '../../textMetrics.js';
import { beatTaps, beatPickStroke } from '../../directions.js';
import { glyphBox } from '../../glyphMetrics.js';
import { pickStrokeGlyph } from '../../glyphs.js';
import { flattenRuns, tabTopY, inkTopInSpan, breakEndX, breakStartX } from './common.js';
import { collectBeats, findSlurs, beatClearTop } from './notationBeats.js';

// Playing directions above the notation staff: tap "T" then pick stroke, this far apart.
const DIRECTION_STACK_GAP_SP = 0.4;
// ...each this far above the slur's outer edge where it crosses the mark (not the slur's apex).
const SLUR_DIRECTION_CLEAR_SP = 0.5;
// Pick strokes on a tab-only track: bottom at least this far above the TAB top line, and above the ink under it.
const PICK_TAB_STAFF_CLEAR_SP = 1;
const PICK_TAB_CLEAR_SP = 0.4;

/**
 * Playing directions above the beat (main note beats only; directions.js),
 * after the technique labels and before chord symbols (which then clear
 * them through the staff's ink) and fermatas:
 *
 * - notation staff: a tap "T" (`note.tap`) then the pick stroke
 *   (`pickStroke` 'down' | 'up'), stacked DIRECTION_STACK_GAP_SP apart
 *   upward, clear of the staff, stem, articulations, vibrato / tremolo and
 *   tuplet bracket, and SLUR_DIRECTION_CLEAR_SP above a slur's outer edge
 *   where it crosses the mark (its local height, not its apex). Pick
 *   strokes on the beats of one beam group share one baseline, the highest
 *   of their own; a T stays on its beat (so at least DIRECTION_STACK_GAP_SP
 *   below that line). The top of the stack is recorded as
 *   `info.directionTopY` for renderFermatas. A track with a notation staff
 *   shows pick strokes there only.
 * - tab-only track: the pick stroke above the TAB staff, at least
 *   PICK_TAB_STAFF_CLEAR_SP above its top line and PICK_TAB_CLEAR_SP above
 *   the beat's frets / marks and any bend, "T", dip, technique label or
 *   hammer-on/pull-off ink under it.
 */
export function renderPlayingDirections(score, trackRuns, theme, systems) {
  const sp = theme.staffLineSpacing;
  score.tracks.forEach((track) => {
    if (track.showStandardNotation) {
      const beats = collectBeats(trackRuns, track, theme);
      beats.forEach((item) => { item.taps = beatTaps(item.el); item.pick = beatPickStroke(item.el); });
      const marked = beats.filter((item) => item.info && !item.info.isRest && !item.info.isGrace
        && (item.taps || item.pick));
      if (!marked.length) return;
      slurAboveCurves(beats, systems, theme);
      const tapSize = techniqueLabelSize(theme);
      const tapHalf = estimateTextWidth('T', tapSize, { bold: true }) / 2;
      // Each beat's own stack: T on the ink under it, then the pick stroke's own baseline.
      marked.forEach((item) => {
        if (item.taps) {
          item.tapBaselineY = beatClearTop(item, sp, slurClearTop(item, tapHalf, sp)) - TEXT_DESCENT_EM * tapSize;
          item.tapTop = item.tapBaselineY - TEXT_ASCENT_EM * tapSize;
        }
        if (item.pick) {
          const pickHalf = (glyphBox(pickStrokeGlyph(item.pick)).width / 2) * sp;
          item.pickBottomY = Math.min(
            beatClearTop(item, sp, slurClearTop(item, pickHalf, sp)),
            item.taps ? item.tapTop - DIRECTION_STACK_GAP_SP * sp : Infinity,
          );
        }
      });
      // Pick strokes of one beam group share the highest of their baselines (each stays clear of its own T).
      const groups = beamGroupsOf(trackRuns, track);
      const shared = new Map();
      marked.forEach((item) => {
        const key = groups.get(item.layoutEl);
        if (key && item.pick) shared.set(key, Math.min(shared.get(key) ?? Infinity, item.pickBottomY));
      });
      marked.forEach((item) => {
        let top;
        if (item.taps) top = renderTapMark(item.g, item.x, item.tapBaselineY, theme.noteColor, theme).top;
        if (item.pick) {
          const key = groups.get(item.layoutEl);
          top = renderPickStroke(item.g, item.x, key ? shared.get(key) : item.pickBottomY, item.pick, theme.noteColor, theme);
        }
        item.info.directionTopY = top;
      });
      return;
    }
    if (!track.showTablature) return;
    const stringCount = track.tuning.length;
    flattenRuns(trackRuns, track, (layoutEl, run) => {
      const kind = beatPickStroke(layoutEl.el);
      if (!kind) return;
      const x = layoutEl.x;
      const half = (glyphBox(pickStrokeGlyph(kind)).width / 2) * sp;
      const inkTop = inkTopInSpan(x - half, x + half, {
        fretTopY: layoutEl.tabRendered?.fretTopY ?? Infinity,
        marksTopY: layoutEl.tabRendered?.marksTopY ?? Infinity,
        boxLists: [run.tabInkBoxes || [], run.labelBoxes || [], run.hpBoxes || []],
      });
      const bottomY = Math.min(
        tabTopY(run, stringCount, theme) - PICK_TAB_STAFF_CLEAR_SP * sp,
        inkTop - PICK_TAB_CLEAR_SP * sp,
      );
      renderPickStroke(run.tabG, x, bottomY, kind, theme.tabFretColor, theme);
    });
  });
}

/**
 * Outer edge (curveOuterPoints) of each slur segment drawn above a beat,
 * recorded as `slurCurves` on every beat of `beats` (from collectBeats)
 * under it, split slurs per segment — the slur geometry renderTiesAndSlurs
 * draws, for marks placed at the slur's local height (slurClearTop).
 */
function slurAboveCurves(beats, systems, theme) {
  beats.forEach((b) => { b.slurCurves = []; });
  const over = (from, to, sysIdx, x1, y1, x2, y2) => {
    const pts = curveOuterPoints(x1, y1, x2, y2, true, theme, 'slur');
    for (let k = from; k <= to; k++) {
      if (beats[k].sysIdx === sysIdx) beats[k].slurCurves.push(pts);
    }
  };
  findSlurs(beats).forEach(({ i, j, above }) => {
    if (!above) return;
    const a = beats[i]; const b = beats[j];
    if (a.sysIdx === b.sysIdx) {
      over(i, j, a.sysIdx, a.x, a.anchorAbove, b.x, b.anchorAbove);
    } else {
      over(i, j, a.sysIdx, a.x, a.anchorAbove, breakEndX(systems, a.sysIdx, theme), a.anchorAbove);
      over(i, j, b.sysIdx, breakStartX(systems, b.sysIdx, theme), b.anchorAbove, b.x, b.anchorAbove);
    }
  });
}

/** Point [x, y] of the cubic Bézier `pts` at parameter `t`. */
function bezierAt(pts, t) {
  const u = 1 - t;
  const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return [0, 1].map((c) => w.reduce((acc, wk, k) => acc + wk * pts[k][c], 0));
}

/**
 * Highest (min) y of a slur's outer edge `pts` over the x span (xa, xb),
 * clipped to the slur's own span; Infinity when they don't overlap. The
 * curve's x rises monotonically (control points at 0.28 / 0.72 of its
 * length), so each sampled x is found by bisection on t.
 */
function curveTopOver(pts, xa, xb) {
  const x1 = Math.max(xa, pts[0][0]);
  const x2 = Math.min(xb, pts[3][0]);
  if (x1 > x2) return Infinity;
  const SAMPLES = 8;
  let top = Infinity;
  for (let k = 0; k <= SAMPLES; k++) {
    const x = x1 + ((x2 - x1) * k) / SAMPLES;
    let lo = 0; let hi = 1;
    for (let n = 0; n < 40; n++) {
      const mid = (lo + hi) / 2;
      if (bezierAt(pts, mid)[0] < x) lo = mid; else hi = mid;
    }
    top = Math.min(top, bezierAt(pts, (lo + hi) / 2)[1]);
  }
  return top;
}

/**
 * Lowest y for the bottom of a mark centred on beat `item` and `half`
 * wide each side: SLUR_DIRECTION_CLEAR_SP above every slur in
 * `item.slurCurves` (slurAboveCurves) where it crosses the mark; Infinity
 * when no slur is drawn above the beat.
 */
function slurClearTop(item, half, sp) {
  return Math.min(Infinity, ...(item.slurCurves || [])
    .map((pts) => curveTopOver(pts, item.x - half, item.x + half) - SLUR_DIRECTION_CLEAR_SP * sp));
}

/**
 * Beam group of each beamed layout element of `track` (groups of 2+
 * beats, per measure): a Map layoutEl -> group key (the group's index array).
 */
function beamGroupsOf(trackRuns, track) {
  const out = new Map();
  trackRuns.filter((r) => r.track === track).forEach((run) => {
    run.measures.forEach((measure) => {
      (measure.beamGroups || []).forEach((grp) => {
        if (grp.length < 2) return;
        grp.forEach((idx) => {
          const le = measure.elements.find((e) => e.index === idx);
          if (le) out.set(le, grp);
        });
      });
    });
  });
  return out;
}
