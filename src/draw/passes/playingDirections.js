/**
 * draw/passes/playingDirections.js — pass 5 (draw/passes.js): pick strokes,
 * strum arrows and notation tap "T" above the beat, clear of the slurs
 * drawn above it.
 * Slur clearance and beam groups come from notationBeats.js.
 * Above a TAB staff reads `run.tabInkBoxes`, `run.hpBoxes` (pass 3) and
 * `run.labelBoxes` (pass 4); writes `info.directionTopY` for pass 7.
 */
import { renderPickStroke } from '../notation.js';
import { renderTapMark, techniqueLabelSize } from '../tab.js';
import { TEXT_ASCENT_EM, TEXT_DESCENT_EM } from '../../layout/ink.js';
import { estimateTextWidth } from '../../textMetrics.js';
import { beatTapMark, beatPickStroke, beatTrill, beatStrum, TAP_MARK_LETTERS } from '../../directions.js';
import { glyphBox } from '../../glyphMetrics.js';
import { pickStrokeGlyph, Glyph } from '../../glyphs.js';
import { trillEndX, trillRunEndX, trillRuns, renderTrill } from '../trill.js';
import { renderStrum, renderTabStrums, STRUM_HALF_SP } from '../strum.js';
import { flattenRuns, tabTopY, inkTopInSpan, breakEndX } from './common.js';
import { collectBeats, beatClearTop, slurAboveCurves, slurClearTop, slurClearSpan, beamGroupsOf } from './notationBeats.js';

// Playing directions above the notation staff: trill, tap "T" then pick stroke / strum, this far apart.
const DIRECTION_STACK_GAP_SP = 0.4;
// A trill's bottom stays this far below the next rendered note's top.
const TRILL_NEXT_CLEAR_SP = 1;
// Pick strokes on a tab-only track: bottom at least this far above the TAB top line, and above the ink under it.
const PICK_TAB_STAFF_CLEAR_SP = 1;
const PICK_TAB_CLEAR_SP = 0.4;

/**
 * Playing directions above the beat (main note beats only; directions.js),
 * after the technique labels and before chord symbols (which then clear
 * them through the staff's ink) and fermatas:
 *
 * - notation staff: a trill ("tr" and a wavy line, `note.trill`; draw/trill.js),
 *   then a tap "T" (`note.tap`; or "S" / "P" for `note.slap` /
 *   `note.pop`, one letter per beat, `beatTapMark`) then the pick stroke
 *   (`pickStroke` 'down' | 'up'), stacked DIRECTION_STACK_GAP_SP apart
 *   upward, clear of the staff, stem, articulations, vibrato / tremolo and
 *   tuplet bracket, and 0.5 sp above a slur's outer edge (slurClearTop)
 *   where it crosses the mark (its local height, not its apex). Pick
 *   strokes on the beats of one beam group share one baseline, the highest
 *   of their own; a T stays on its beat (so at least DIRECTION_STACK_GAP_SP
 *   below that line). A trill spans from its beat to 0.8 sp before the next
 *   beat (never past the last barline), sits above the vibrato / tremolo and
 *   below the next rendered note's top by TRILL_NEXT_CLEAR_SP; consecutive
 *   trills on a system (graces between them allowed; trillRuns) share one
 *   line, the highest of their own, each wave ending before the next "tr". The top of the stack is recorded as
 *   `info.directionTopY` for renderFermatas. A track with a notation staff
 *   shows pick strokes there only. A strum arrow (`strum`; draw/strum.js)
 *   takes the pick stroke's place on a track without a TAB staff; runs of
 *   strummed beats on a system (graces allowed; trillRuns) share the
 *   highest bottom of their own.
 * - tab-only track: the pick stroke above the TAB staff, at least
 *   PICK_TAB_STAFF_CLEAR_SP above its top line and PICK_TAB_CLEAR_SP above
 *   the beat's frets / marks and any bend, "T", dip, technique label or
 *   hammer-on/pull-off ink under it.
 * - TAB staff (notation + TAB and tab-only tracks): strum arrows
 *   (renderTabStrums, draw/strum.js), in the pick stroke's slot; a strum
 *   replaces a beat's pick stroke (beatPickStroke).
 */
export function renderPlayingDirections(score, trackRuns, theme, systems) {
  const sp = theme.staffLineSpacing;
  score.tracks.forEach((track) => {
    if (track.showTablature) renderTabStrums(trackRuns, track, theme);
    if (track.showStandardNotation) {
      const beats = collectBeats(trackRuns, track, theme);
      beats.forEach((item) => {
        item.tapMark = beatTapMark(item.el); item.pick = beatPickStroke(item.el); item.trill = beatTrill(item.el);
        item.strum = track.showTablature ? null : beatStrum(item.el);
      });
      const marked = beats.filter((item) => item.info && !item.info.isRest && !item.info.isGrace
        && (item.tapMark || item.pick || item.trill || item.strum));
      if (!marked.length) return;
      slurAboveCurves(beats, systems, theme);
      const tapSize = techniqueLabelSize(theme);
      const trillHalf = (glyphBox(Glyph.ornamentTrill).width / 2) * sp;
      // Each trill's own bottom (the other trills' ink never counts), then one shared line per run of trills.
      const trilled = marked.filter((item) => item.trill);
      const runs = trillRuns(beats, (b) => trilled.includes(b), (b) => b.sysIdx, (b) => !!b.info?.isGrace);
      trilled.forEach((item) => {
        const at = beats.indexOf(item);
        const later = beats.filter((b, bi) => bi > at && b.sysIdx === item.sysIdx);
        const nextOn = later[0];
        const run = runs.get(item);
        item.trillEndX = trillRunEndX(trillEndX(item.x, nextOn ? nextOn.x : Infinity, breakEndX(systems, item.sysIdx, theme), theme),
          run[run.indexOf(item) + 1]?.x, theme);
        const nextNote = later.find((b) => b.info && !b.info.isRest);
        item.trillBottomY = Math.min(
          beatClearTop(item, sp, slurClearSpan(item, item.x - trillHalf, item.trillEndX, sp)),
          nextNote ? nextNote.topY - TRILL_NEXT_CLEAR_SP * sp : Infinity,
        );
      });
      // Each beat's own stack: trill, then T / S / P on the ink under it, then the pick stroke's own baseline.
      marked.forEach((item) => {
        if (item.trill) {
          const bottomY = Math.min(...runs.get(item).map((m) => m.trillBottomY));
          item.trillTop = renderTrill(item.g, item.x, bottomY, item.trillEndX, theme.noteColor, theme, null).top;
        }
        if (item.tapMark) {
          const tapHalf = estimateTextWidth(TAP_MARK_LETTERS[item.tapMark], tapSize, { bold: true }) / 2;
          item.tapBaselineY = Math.min(beatClearTop(item, sp, slurClearTop(item, tapHalf, sp)),
            item.trill ? item.trillTop - DIRECTION_STACK_GAP_SP * sp : Infinity) - TEXT_DESCENT_EM * tapSize;
          item.tapTop = item.tapBaselineY - TEXT_ASCENT_EM * tapSize;
        }
        if (item.pick) {
          const pickHalf = (glyphBox(pickStrokeGlyph(item.pick)).width / 2) * sp;
          item.pickBottomY = Math.min(
            beatClearTop(item, sp, slurClearTop(item, pickHalf, sp)),
            item.tapMark ? item.tapTop - DIRECTION_STACK_GAP_SP * sp : Infinity,
            item.trill ? item.trillTop - DIRECTION_STACK_GAP_SP * sp : Infinity,
          );
        }
        if (item.strum) {
          item.strumBottomY = Math.min(
            beatClearTop(item, sp, slurClearTop(item, STRUM_HALF_SP * sp, sp)),
            item.tapMark ? item.tapTop - DIRECTION_STACK_GAP_SP * sp : Infinity,
            item.trill ? item.trillTop - DIRECTION_STACK_GAP_SP * sp : Infinity,
          );
        }
      });
      // Strum arrows of one run share the highest of their bottoms.
      const strumRuns = trillRuns(beats, (b) => !!b.strum && marked.includes(b), (b) => b.sysIdx, (b) => !!b.info?.isGrace);
      // Pick strokes of one beam group share the highest of their baselines (each stays clear of its own T).
      const groups = beamGroupsOf(trackRuns, track);
      const shared = new Map();
      marked.forEach((item) => {
        const key = groups.get(item.layoutEl);
        if (key && item.pick) shared.set(key, Math.min(shared.get(key) ?? Infinity, item.pickBottomY));
      });
      marked.forEach((item) => {
        let top = item.trill ? item.trillTop : undefined;
        if (item.tapMark) top = renderTapMark(item.g, item.x, item.tapBaselineY, theme.noteColor, theme, item.tapMark).top;
        if (item.pick) {
          const key = groups.get(item.layoutEl);
          top = renderPickStroke(item.g, item.x, key ? shared.get(key) : item.pickBottomY, item.pick, theme.noteColor, theme);
        }
        if (item.strum) {
          const bottomY = Math.min(...strumRuns.get(item).map((m) => m.strumBottomY));
          top = renderStrum(item.g, item.x, bottomY, item.strum, theme.noteColor, theme).top;
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
