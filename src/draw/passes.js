/**
 * draw/passes.js — score-wide drawing passes that run after every system
 * has been drawn, because what they connect or avoid can span measures.
 * Each pass appends to the staff group its marks belong to, in that
 * group's local coordinates, so they move with the staff and count towards
 * its ink extents. This file only re-exports them from draw/passes/:
 *
 * - common.js — helpers shared by several passes (runs in score order, TAB
 *   top line, ink under a span, split-arc ends at a system break)
 * - notationBeats.js — rendered notation beats with slur anchors, slurs, and
 *   the lowest y a mark may reach above a beat
 * - curves.js — ties and slurs, grace-note slurs
 * - tabTechniques.js — tab hammer-on/pull-off, slide, bend, tap "T" / slap /
 *   pop, trill, whammy dip and dive / return / pre-dive lines
 * - techniqueLabels.js — palm mute / harmonic / let-ring / rake label runs
 * - playingDirections.js — pick strokes, strum arrows (draw/strum.js),
 *   notation tap "T" / slap / pop and trills
 * - chordsFermatas.js — chord symbols, chord diagrams and dynamics, and fermatas
 *
 * `trackRuns` holds one entry per system per track:
 * `{ track, ti, sysIdx, measures, notationG, tabG, notationBaselineY,
 * tabBaselineY }` (baselines local to notationG / tabG), where `measures`
 * are the layout measures whose elements carry `rendered` (the info
 * returned by renderNotationElement/renderBeams). `systems` are the layout
 * systems (for `contentStartX` / `lastBarlineX`).
 *
 * Arcs crossing a system break (ties, slurs, H/P) are split (ui.md §7):
 * segment 1 runs from the starting note to 0.5 sp before the system's last
 * barline at the start's height, segment 2 from 0.5 sp after the next
 * system's header to the target note at the target's height, in the target
 * system's staff group; both are full arcs on the starting note's side.
 *
 * The pass order (MusicScoreRenderer.js) is load-bearing: 1
 * renderTiesAndSlurs, 2 renderGraceSlurs, 3 renderTabArticulations, 4
 * renderTechniqueLabelRuns, 5 renderPlayingDirections, 6
 * renderChordSymbolsAndDynamics, 7 renderFermatas. Later passes read what
 * earlier ones record:
 *
 * - `run.tabInkBoxes` (bend, tap "T" / slap "S" / pop "P", trill, whammy
 *   dip and dive / return / pre-dive line ink): written by 3, read by 3
 *   (trill, dip and line placement), 4 and 5
 * - `run.hpBoxes` (hammer-on/pull-off ink): written by 3, read by 3 (tap
 *   "T", trill, whammy line) and 5
 * - `run.labelBoxes` (technique-label text and dashes): written by 4, read
 *   by 5
 * - `run.chordBoxes` (chord symbols and chord diagrams): written by 6, read by 7 through
 *   collectBeats (empty before 6)
 * - `info.directionTopY` (top of a beat's pick stroke / strum / tap "T" / trill):
 *   written by 5, read by 7
 * - pass 6 measures the notation staff's ink, so it must follow the passes
 *   that draw there (1, 2 and 5).
 */
export { flattenRuns } from './passes/common.js';
export { renderTiesAndSlurs, renderGraceSlurs } from './passes/curves.js';
export { renderTabArticulations } from './passes/tabTechniques.js';
export { renderTechniqueLabelRuns } from './passes/techniqueLabels.js';
export { renderPlayingDirections } from './passes/playingDirections.js';
export { renderChordSymbolsAndDynamics, renderFermatas } from './passes/chordsFermatas.js';
