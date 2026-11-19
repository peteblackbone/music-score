/**
 * draw/passes/playingDirections.js — pass 5 (draw/passes.js): pick strokes,
 * strum arrows, right-hand letters and the notation trill / ornament, tap
 * "T" and golpe above the beat, clear of the slurs drawn above it.
 * Slur clearance and beam groups come from notationBeats.js.
 * Above a TAB staff reads `run.tabInkBoxes`, `run.hpBoxes` (pass 3) and
 * `run.labelBoxes` (pass 4); writes `info.directionTopY` for pass 7. Voice
 * 2's marks (and fermatas) go below the notation staff (draw/voice2Marks.js).
 */
import { renderPickStroke } from '../notation.js';
import { renderTapMark, tapMarkHalf, tapMarkBox, techniqueLabelSize } from '../tab.js';
import { renderOrnament, ornamentHalf, renderRightFingering, rightFingeringHalf, renderGolpe, golpeHalf } from '../handMarks.js';
import { TEXT_DESCENT_EM } from '../../layout/ink.js';
import { beatTapMark, beatPickStroke, beatTrill, beatStrum } from '../../directions.js';
import { beatOrnament, beatGolpe, rightFingerStack } from '../../hands.js';
import { glyphBox } from '../../glyphMetrics.js';
import { pickStrokeGlyph, Glyph } from '../../glyphs.js';
import { trillEndX, trillRunEndX, trillRuns, renderTrill, trillChainWaves, renderTrillContinuation } from '../trill.js';
import { renderStrum, renderTabStrums, STRUM_HALF_SP } from '../strum.js';
import { renderVoice2Directions } from '../voice2Marks.js';
import { trackHasTwoVoices, tabMarkBeat } from '../../twoVoice.js';
import { flattenTabColumns, tabTopY, inkTopInSpan, breakEndX } from './common.js';
import { collectBeats, beatClearTop, slurAboveCurves, slurClearTop, slurClearSpan, beamGroupsOf } from './notationBeats.js';

// Playing directions above the notation staff: trill / ornament, right-hand letters, tap "T", golpe, then pick stroke / strum, this far apart.
const DIRECTION_STACK_GAP_SP = 0.4;
// A trill's bottom stays this far below the next rendered note's top.
const TRILL_NEXT_CLEAR_SP = 1;
// Pick strokes (and right-hand letters) on a tab-only track: bottom at least this far above the TAB top line, and above the ink under it.
const PICK_TAB_STAFF_CLEAR_SP = 1;
const PICK_TAB_CLEAR_SP = 0.4;

/**
 * Playing directions above the beat (main note beats only; directions.js),
 * after the technique labels and before chord symbols (which then clear
 * them through the staff's ink) and fermatas:
 *
 * - notation staff: a trill ("tr" and a wavy line, `note.trill`; draw/trill.js)
 *   or else an ornament (`note.ornament`; hands.js, draw/handMarks.js),
 *   then the right-hand letters (`note.rightFinger`, lowest note's at the
 *   bottom), then a tap "T" (`note.tap`; or the left-hand tap glyph, "S" or
 *   "P" for `note.leftHandTap` / `note.slap` / `note.pop`, one mark per
 *   beat, `beatTapMark`), then a golpe (`golpe`), then the pick stroke
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
 *   line, the highest of their own, each wave ending before the next "tr".
 *   A trill tied forward (trillChainWaves) runs over the tied notes instead,
 *   clear of them too, continuing (wave only) on each later system the ties
 *   reach; marks on a covered beat stack above the wave. The top of the stack is recorded as
 *   `info.directionTopY` for renderFermatas. A track with a notation staff
 *   shows pick strokes there only. A strum arrow (`strum`; draw/strum.js)
 *   takes the pick stroke's place on a track without a TAB staff; runs of
 *   strummed beats on a system (graces allowed; trillRuns) share the
 *   highest bottom of their own.
 * - voice 2 of a notation track's two-voice measures: the same marks and
 *   its fermatas below the staff (renderVoice2Directions), after voice 1's.
 * - tab-only track: the right-hand letters, then the pick stroke
 *   DIRECTION_STACK_GAP_SP above them, above the TAB staff, at least
 *   PICK_TAB_STAFF_CLEAR_SP above its top line and PICK_TAB_CLEAR_SP above
 *   the beat's frets / marks and any bend, "T", golpe, dip, technique label
 *   or hammer-on/pull-off ink under it; per TAB column in two-voice
 *   measures (voice 1's letters / pick stroke win as a whole, else voice
 *   2's). A track with a notation staff shows right-hand letters there only.
 * - TAB staff (notation + TAB and tab-only tracks): strum arrows
 *   (renderTabStrums, draw/strum.js), in the pick stroke's slot; a strum
 *   replaces a beat's pick stroke (beatPickStroke).
 */
export function renderPlayingDirections(score, trackRuns, theme, systems) {
  const sp = theme.staffLineSpacing;
  score.tracks.forEach((track) => {
    if (track.showTablature) renderTabStrums(trackRuns, track, theme);
    if (track.showStandardNotation) {
      renderNotationStack(track, trackRuns, theme, systems);
      if (trackHasTwoVoices(trackRuns, track)) renderVoice2Directions(track, trackRuns, theme, systems);
      return;
    }
    if (!track.showTablature) return;
    const stringCount = track.tuning.length;
    flattenTabColumns(trackRuns, track, (layoutEl, run) => {
      const kind = beatPickStroke(tabMarkBeat(layoutEl, 'pick'));
      const letters = rightFingerStack(tabMarkBeat(layoutEl, 'right'));
      if (!kind && !letters) return;
      const x = layoutEl.x - (layoutEl.dx || 0);
      // Lowest bottom for a mark `half` wide each side: clear of the TAB top line and the ink under it.
      const floor = (half) => Math.min(
        tabTopY(run, stringCount, theme) - PICK_TAB_STAFF_CLEAR_SP * sp,
        inkTopInSpan(x - half, x + half, {
          fretTopY: layoutEl.tabRendered?.fretTopY ?? Infinity,
          marksTopY: layoutEl.tabRendered?.marksTopY ?? Infinity,
          boxLists: [run.tabInkBoxes || [], run.labelBoxes || [], run.hpBoxes || []],
        }) - PICK_TAB_CLEAR_SP * sp,
      );
      const rightTop = letters
        ? renderRightFingering(run.tabG, x, floor(rightFingeringHalf(letters, theme)), letters, theme.tabFretColor, theme).top : Infinity;
      if (!kind) return;
      const bottomY = Math.min(floor((glyphBox(pickStrokeGlyph(kind)).width / 2) * sp), rightTop - DIRECTION_STACK_GAP_SP * sp);
      renderPickStroke(run.tabG, x, bottomY, kind, theme.tabFretColor, theme);
    });
  });
}

/** Voice 1's (or a single-voice track's) stack above the notation staff (see renderPlayingDirections). */
function renderNotationStack(track, trackRuns, theme, systems) {
  const sp = theme.staffLineSpacing;
  const beats = collectBeats(trackRuns, track, theme);
  beats.forEach((item) => {
    item.tapMark = beatTapMark(item.el); item.pick = beatPickStroke(item.el); item.trill = beatTrill(item.el);
    item.strum = track.showTablature ? null : beatStrum(item.el);
    item.ornament = beatOrnament(item.el); item.rightLetters = rightFingerStack(item.el); item.golpe = beatGolpe(item.el);
  });
  const marked = beats.filter((item) => item.info && !item.info.isRest && !item.info.isGrace
    && (item.tapMark || item.pick || item.trill || item.strum || item.ornament || item.rightLetters || item.golpe));
  if (!marked.length) return;
  slurAboveCurves(beats, systems, theme);
  const tapSize = techniqueLabelSize(theme);
  const trillHalf = (glyphBox(Glyph.ornamentTrill).width / 2) * sp;
  // Each trill's own bottom (the other trills' ink never counts), then one shared line per run of trills.
  const trilled = marked.filter((item) => item.trill);
  const runs = trillRuns(beats, (b) => trilled.includes(b), (b) => b.sysIdx, (b) => !!b.info?.isGrace);
  const els = beats.map((b) => b.el);
  const nextX = (b) => { const bi = beats.indexOf(b); return beats.find((c, ci) => ci > bi && c.sysIdx === b.sysIdx)?.x ?? Infinity; };
  trilled.forEach((item) => {
    const at = beats.indexOf(item);
    const later = beats.filter((b, bi) => bi > at && b.sysIdx === item.sysIdx);
    const nextOn = later[0];
    const run = runs.get(item);
    const wv = trillChainWaves(beats, at, els, { sysOf: (b) => b.sysIdx, xOf: (b) => b.x, nextX }, systems, theme);
    item.trillWaves = wv;
    item.trillEndX = wv ? wv.endX : trillRunEndX(trillEndX(item.x, nextOn ? nextOn.x : Infinity, breakEndX(systems, item.sysIdx, theme), theme),
      run[run.indexOf(item) + 1]?.x, theme);
    // Tied forward: also clear of the covered beats on this system, and of the first note after them.
    const own = wv ? wv.covered.filter((c) => c.sysIdx === item.sysIdx) : [];
    const from = own.length ? beats.indexOf(own[own.length - 1]) : at;
    const nextNote = later.find((b) => beats.indexOf(b) > from && b.info && !b.info.isRest);
    item.trillBottomY = Math.min(
      beatClearTop(item, sp, slurClearSpan(item, item.x - trillHalf, item.trillEndX, sp)),
      nextNote ? nextNote.topY - TRILL_NEXT_CLEAR_SP * sp : Infinity,
      ...own.map((c) => beatClearTop(c, sp, slurClearSpan(c, item.x - trillHalf, item.trillEndX, sp))),
    );
  });
  // Each beat's own stack, bottom up, each layer on the ink under it and the gap above the layer below:
  // trill / ornament, right-hand letters, T / LH tap / S / P, golpe, then the pick stroke's or strum's own bottom.
  const gap = DIRECTION_STACK_GAP_SP * sp;
  marked.forEach((item) => {
    let above = item.coverTop != null ? item.coverTop - gap : Infinity;
    const clear = (half) => Math.min(beatClearTop(item, sp, slurClearTop(item, half, sp)), above);
    if (item.trill) {
      const bottomY = Math.min(...runs.get(item).map((m) => m.trillBottomY));
      const drawn = renderTrill(item.g, item.x, bottomY, item.trillEndX, theme.noteColor, theme, null);
      item.trillTop = drawn.top;
      above = item.trillTop - gap;
      if (item.trillWaves) coverTrillChain(item, drawn, beats, theme);
    } else if (item.ornament) {
      item.ornamentTop = renderOrnament(item.g, item.x, clear(ornamentHalf(item.ornament, theme)), item.ornament, theme.noteColor, theme).top;
      above = item.ornamentTop - gap;
    }
    if (item.rightLetters) {
      const half = rightFingeringHalf(item.rightLetters, theme);
      item.rightTop = renderRightFingering(item.g, item.x, clear(half), item.rightLetters, theme.noteColor, theme).top;
      above = Math.min(above, item.rightTop - gap);
    }
    if (item.tapMark) {
      item.tapBaselineY = clear(tapMarkHalf(item.tapMark, theme)) - TEXT_DESCENT_EM * tapSize;
      item.tapTop = tapMarkBox(item.x, item.tapBaselineY, theme, item.tapMark).top;
      above = Math.min(above, item.tapTop - gap);
    }
    if (item.golpe) {
      item.golpeTop = renderGolpe(item.g, item.x, clear(golpeHalf(theme)), item.golpe, theme.noteColor, theme).top;
      above = Math.min(above, item.golpeTop - gap);
    }
    if (item.pick) item.pickBottomY = clear((glyphBox(pickStrokeGlyph(item.pick)).width / 2) * sp);
    if (item.strum) item.strumBottomY = clear(STRUM_HALF_SP * sp);
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
    let top = item.trill ? item.trillTop : item.ornamentTop;
    if (item.rightLetters) top = item.rightTop;
    if (item.tapMark) top = renderTapMark(item.g, item.x, item.tapBaselineY, theme.noteColor, theme, item.tapMark).top;
    if (item.golpe) top = item.golpeTop;
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
  // A covered beat without marks of its own: a fermata goes above the wave.
  beats.forEach((b) => { if (b.coverTop != null && !marked.includes(b)) b.info.directionTopY = b.coverTop; });
}

/**
 * Covered beats of the tied-forward trill on `item` (its `trillWaves`,
 * just drawn as `drawn`): those on its system stack above its wave; each
 * later system gets a continued wave clear of its covered beats (as the
 * trill's own bottom: beatClearTop, slurs, the next note's top), which they
 * then stack above (`coverTop`).
 */
function coverTrillChain(item, drawn, beats, theme) {
  const sp = theme.staffLineSpacing;
  const { covered, conts } = item.trillWaves;
  covered.filter((c) => c.sysIdx === item.sysIdx).forEach((c) => { c.coverTop = drawn.waveTop ?? drawn.top; });
  conts.forEach(({ items, x1, x2 }) => {
    const last = beats.indexOf(items[items.length - 1]);
    const nextNote = beats.find((b, bi) => bi > last && b.sysIdx === items[0].sysIdx && b.info && !b.info.isRest);
    const bottomY = Math.min(...items.map((c) => beatClearTop(c, sp, slurClearSpan(c, x1, x2, sp))),
      nextNote ? nextNote.topY - TRILL_NEXT_CLEAR_SP * sp : Infinity);
    const wave = renderTrillContinuation(items[0].g, x1, x2, bottomY, theme.noteColor, theme);
    if (wave) items.forEach((c) => { c.coverTop = wave.top; });
  });
}
