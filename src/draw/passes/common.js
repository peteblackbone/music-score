/**
 * draw/passes/common.js — helpers shared by several score-wide passes
 * (draw/passes.js): walking a track's runs in score order, a run's TAB top
 * line, the topmost ink under a horizontal span, and where a split arc ends
 * and resumes at a system break. Reads only; draws nothing.
 */

const BREAK_GAP_SP = 0.5;        // split arc -> last barline / system header

/**
 * Visit every layout element of `track`, in score order (system by system,
 * measure by measure), calling `visit(layoutEl, run)` where `run` is the
 * `trackRuns` entry the element belongs to.
 */
export function flattenRuns(trackRuns, track, visit) {
  trackRuns.filter((r) => r.track === track).forEach((run) => {
    run.measures.forEach((measure) => {
      measure.elements.forEach((layoutEl) => visit(layoutEl, run));
    });
  });
}

/** y of the top line of a run's TAB staff with `stringCount` strings. */
export function tabTopY(run, stringCount, theme) {
  return run.tabBaselineY - (stringCount - 1) * theme.tabStaffLineSpacing;
}

/**
 * Topmost ink y under the horizontal span (x1, x2): the min of `fretTopY`,
 * `marksTopY` and the `top` of every box in `boxLists` overlapping the span
 * (Infinity when there is none).
 */
export function inkTopInSpan(x1, x2, { fretTopY = Infinity, marksTopY = Infinity, boxLists = [] }) {
  return Math.min(
    fretTopY, marksTopY,
    ...boxLists.flatMap((boxes) => boxes.filter((b) => b.x1 < x2 && b.x2 > x1).map((b) => b.top)),
  );
}

/** x where segment 1 of a split arc ends in system `sysIdx`, and where segment 2 starts. */
export const breakEndX = (systems, sysIdx, theme) => systems[sysIdx].lastBarlineX - BREAK_GAP_SP * theme.staffLineSpacing;
export const breakStartX = (systems, sysIdx, theme) => systems[sysIdx].contentStartX + BREAK_GAP_SP * theme.staffLineSpacing;
