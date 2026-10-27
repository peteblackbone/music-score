/**
 * draw/passes/notationBeats.js — the rendered beats of a notation track in
 * score order with their slur anchors (collectBeats; it also reads
 * `run.chordBoxes`, written by renderChordSymbolsAndDynamics), the track's
 * slurs (findSlurs) and the lowest y a mark may reach above a beat
 * (beatClearTop). Shared by curves.js, playingDirections.js and
 * chordsFermatas.js. Reads only; draws nothing.
 */
import { elementTop, elementBottom } from '../notation.js';
import { flattenRuns } from './common.js';

const SLUR_CLEARANCE_SP = 1.1;   // slur end -> note's top (above) / bottom (below)

/** Every rendered beat of a notation track, in score order, with its slur anchors. */
export function collectBeats(trackRuns, track, theme) {
  const s = theme.staffLineSpacing;
  const beats = [];
  flattenRuns(trackRuns, track, (layoutEl, run) => {
    const info = layoutEl.rendered;
    const top = info ? elementTop(info) : Infinity;
    const bottom = info ? elementBottom(info) : -Infinity;
    beats.push({
      sysIdx: run.sysIdx, g: run.notationG, x: layoutEl.x, el: layoutEl.el, layoutEl, info, baselineY: run.notationBaselineY,
      chordBoxes: run.chordBoxes || [],
      topY: top,
      anchorAbove: (Number.isFinite(top) ? top : run.notationBaselineY - 4 * s) - SLUR_CLEARANCE_SP * s,
      anchorBelow: (Number.isFinite(bottom) ? bottom : run.notationBaselineY) + SLUR_CLEARANCE_SP * s,
    });
  });
  return beats;
}

/**
 * Slurs of a track: each `slurStart` beat to the next `slurEnd` beat.
 * Side (ui.md §7): all stems up → below; all down → above; mixed → above
 * (stemless notes count with their notional direction; rests and grace
 * notes don't count). Returns `[{ i, j, above }]` (indices into `beats`).
 */
export function findSlurs(beats) {
  const out = [];
  beats.forEach((item, i) => {
    if (!item.el.slurStart) return;
    const j = beats.findIndex((c, k) => k > i && c.el.slurEnd);
    if (j === -1) return;
    const dirs = beats.slice(i, j + 1)
      .filter((b) => b.info && !b.info.isRest && !b.info.isGrace && b.info.noteheads?.length)
      .map((b) => b.info.stemUp);
    const above = !(dirs.length && dirs.every((up) => up));
    out.push({ i, j, above });
  });
  return out;
}

/**
 * Lowest y a mark may reach above a rendered beat (`item` from
 * collectBeats): 1 sp above the staff and the beat's own top, 2 sp above a
 * vibrato, 2.8 sp above a stemless tremolo, 0.6 sp above a tuplet bracket,
 * and at most `slurY` — by default `item.slurLimit` (slurAboveLimits: under
 * no slur drawn above it, as for fermatas).
 */
export function beatClearTop(item, sp, slurY = item.slurLimit) {
  const { el, info } = item;
  const isStemless = !info.isRest && info.stemTopY == null;
  return Math.min(
    item.baselineY - sp * 4 - sp,
    item.topY - sp,
    el.vibrato && !info.isRest ? item.topY - sp * 2 : Infinity,
    el.tremolo && isStemless ? item.topY - sp * 2.8 : Infinity,
    info.tupletY != null ? info.tupletY - sp * 0.6 : Infinity,
    slurY,
  );
}
