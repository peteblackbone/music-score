/**
 * draw/passes/techniqueLabels.js — pass 4 (draw/passes.js): palm mute,
 * harmonic and let-ring label runs, stacked in lanes beside the staff.
 * Reads `run.tabInkBoxes` (pass 3); writes `run.labelBoxes` for pass 5.
 */
import { renderTechniqueLabel, techniqueLabelSize, techniqueLabelDash } from '../tab.js';
import { TEXT_ASCENT_EM, TEXT_DESCENT_EM } from '../../layout/ink.js';
import { estimateTextWidth } from '../../textMetrics.js';
import { HARMONIC_LABELS, beatHarmonicLabelKind } from '../../harmonics.js';
import { LET_RING_LABEL } from '../../directions.js';
import { flattenRuns, breakEndX } from './common.js';

const LABEL_LANE_GAP_SP = 0.4;   // vertical gap between stacked technique-label lanes
const LABEL_STACK_PAD_SP = 0.5;  // horizontal overlap tolerance when deciding technique labels must stack
const BEND_LABEL_CLEAR_SP = 0.2; // min gap between a technique label (text / dash) and bend ink
const BEND_LABEL_MIN_DASH_SP = 1; // min dash length left for a label moved right of its first beat's bend

/**
 * Technique-label runs of every track — three kinds, each a label plus a
 * dashed line over consecutive beats (renderTechniqueLabel): palm mute
 * ("P.M."), harmonics ("A.H." / "T.H." / "P.H." / "S.H.") and let ring
 * ("let ring"), stacked in lanes in that order outward from the staff.
 *
 * Palm mute: `palmMute: true` on a beat (not per note — it's a
 * right-hand technique that applies to the whole strike, not individual
 * strings) marks that note/rest as part of a muted passage. Consecutive
 * marked beats within the same system are grouped into one run and drawn
 * as a single "P.M." label + dashed line spanning all of them, rather
 * than one label per note, ending no later than 0.5 sp before the
 * system's last barline. Drawn just above the tab staff (in the gap
 * between it and the notation staff above) when the track has one — the
 * conventional place — otherwise below the notation staff.
 *
 * Harmonics (artificial / tapped / pinch / semi; natural harmonics have no
 * label) get the same kind of run, one label per beat by priority
 * A.H. > T.H. > P.H. > S.H. (harmonics.js): consecutive beats with the same
 * label kind form a run; rests, grace notes and other beats end it. P.M.
 * runs are drawn first, in the lane nearest the staff; a harmonic run moves
 * one lane further out (techniqueLabelSize + 0.4 sp) than every P.M. run of
 * the same system it overlaps (label/dash extents, ±0.5 sp).
 *
 * Bends (recorded on the runs by renderTabArticulations as ink boxes,
 * `run.tabInkBoxes`) keep every run clear of their ink: the label text may not touch any bend
 * piece and the dashed line may not cross a bend's amount text or landing
 * fret (BEND_LABEL_CLEAR_SP apart). Lanes are tried from the nearest
 * allowed one outward; in each, the label first stays at the run's first
 * beat, then — if that beat's own bend is in the way and the run is long
 * enough for the label plus BEND_LABEL_MIN_DASH_SP of dash — it starts just
 * right of that bend's ink. Runs without a conflicting bend are unaffected.
 *
 * Let ring (`letRing: true` on a beat) gets the same kind of run, labelled
 * "let ring" (its dashed line starts after the full text), drawn last and
 * one lane further out than every P.M. / harmonic run of the system it
 * overlaps. An unmarked rest between two let-ring beats of the same system
 * continues the run (the strings keep ringing); an unmarked note or grace
 * note ends it. Tap "T" and whammy-dip ink (recorded with the bends by
 * renderTabArticulations) is avoided the same way as bend ink.
 *
 * Records every drawn run's text and dash boxes on its run
 * (`run.labelBoxes`) for renderPlayingDirections.
 */
export function renderTechniqueLabelRuns(score, trackRuns, theme, systems) {
  const s = theme.staffLineSpacing;
  const size = techniqueLabelSize(theme);
  const laneStep = size + LABEL_LANE_GAP_SP * s;
  const clear = BEND_LABEL_CLEAR_SP * s;
  const hits = (a, b) => a.x1 < b.x2 + clear && b.x1 < a.x2 + clear && a.top < b.bottom + clear && b.top < a.bottom + clear;
  trackRuns.forEach((run) => { run.labelBoxes = []; });
  score.tracks.forEach((track) => {
    const flat = [];
    const outward = track.showTablature ? -1 : 1; // away from the staff the label belongs to
    flattenRuns(trackRuns, track, (layoutEl, run) => {
      const labelY = track.showTablature
        ? run.tabBaselineY - (track.tuning.length - 1) * theme.tabStaffLineSpacing - 0.6 * s
        : run.notationBaselineY + s * 3.3;
      const harmonic = layoutEl.el.type === 'grace' ? null : beatHarmonicLabelKind(layoutEl.el.notes || []);
      flat.push({
        run, sysIdx: run.sysIdx, g: run.tabG || run.notationG, x: layoutEl.x, labelY, palmMute: !!layoutEl.el.palmMute, harmonic,
        letRing: !!layoutEl.el.letRing, bridge: layoutEl.el.type === 'rest', tabInkBoxes: run.tabInkBoxes || [],
      });
    });
    markRinging(flat);

    // Horizontal extent of a drawn run (label text or dashed line, whichever is longer).
    const extent = (r, labelX, label) => ({
      sysIdx: r.start.sysIdx, x1: labelX, x2: Math.max(r.endX, labelX + estimateTextWidth(label, size, { bold: true })),
    });
    // Ink boxes of run `r` drawn at `labelX` / `labelY`: its label text and (if drawn) its dashed line + tick.
    const inkBoxes = (r, label, labelX, labelY) => {
      const textBox = { x1: labelX, x2: labelX + estimateTextWidth(label, size, { bold: true }), top: labelY - TEXT_ASCENT_EM * size, bottom: labelY + TEXT_DESCENT_EM * size };
      const dash = techniqueLabelDash(labelX, r.endX, labelY, theme, label);
      const dashBox = dash.hasDash && { x1: dash.dashStartX, x2: r.endX, top: dash.dashY - dash.tick / 2, bottom: dash.dashY + dash.tick / 2 };
      return { textBox, dashBox };
    };
    // Label + dash of run `r` at `labelX` in lane `lane` clear of every bend, and outside every placed run in `below` it overlaps?
    const fits = (r, label, labelX, lane, below) => {
      const labelY = r.start.labelY + outward * lane * laneStep;
      const box = extent(r, labelX, label);
      if (below.some((b) => b.sysIdx === box.sysIdx && b.lane >= lane && box.x1 < b.x2 + LABEL_STACK_PAD_SP * s && b.x1 < box.x2 + LABEL_STACK_PAD_SP * s)) return false;
      const { textBox, dashBox } = inkBoxes(r, label, labelX, labelY);
      return r.start.tabInkBoxes.every((b) => !hits(textBox, b) && !(dashBox && b.text && hits(dashBox, b)));
    };
    // Nearest lane (and start x) where the run fits; `below` = already placed runs it must stack outside of.
    const place = (r, label, below) => {
      const own = r.start.tabInkBoxes.filter((b) => b.noteX === r.start.x);
      const shiftX = own.length ? Math.max(...own.map((b) => b.x2)) + clear : null;
      for (let lane = 0; ; lane++) {
        if (fits(r, label, r.start.x, lane, below)) return { labelX: r.start.x, lane };
        if (shiftX != null && techniqueLabelDash(shiftX, r.endX, 0, theme, label).dashStartX + BEND_LABEL_MIN_DASH_SP * s <= r.endX
          && fits(r, label, shiftX, lane, below)) return { labelX: shiftX, lane };
      }
    };
    // Draw run `r`; records its ink boxes on its run (`labelBoxes`) and returns its extent and lane.
    const draw = (r, label, cls, below) => {
      const { labelX, lane } = place(r, label, below);
      const labelY = r.start.labelY + outward * lane * laneStep;
      renderTechniqueLabel(r.start.g, labelX, r.endX, labelY, label, cls, theme.tabFretColor, theme);
      const { textBox, dashBox } = inkBoxes(r, label, labelX, labelY);
      r.start.run.labelBoxes.push(textBox);
      if (dashBox) r.start.run.labelBoxes.push(dashBox);
      return { ...extent(r, labelX, label), lane };
    };

    const pmBoxes = labelRuns(flat, (it) => (it.palmMute ? 'pm' : null), systems, theme)
      .map((r) => draw(r, 'P.M.', 'palm-mute', []));
    const harmonicBoxes = labelRuns(flat, (it) => it.harmonic, systems, theme)
      .map((r) => draw(r, HARMONIC_LABELS[r.kind], `harmonic harmonic-${r.kind}`, pmBoxes));
    // Let ring last, outside every P.M. and harmonic run it overlaps.
    const placed = [...pmBoxes, ...harmonicBoxes];
    const ringBoxes = labelRuns(flat, (it) => (it.ringing ? 'let-ring' : null), systems, theme)
      .map((r) => draw(r, LET_RING_LABEL, 'let-ring', placed));
  });
}

/**
 * Sets `ringing` on every label item (renderTechniqueLabelRuns) that belongs
 * to a let-ring run: beats with `letRing`, and unmarked rests (`bridge`)
 * lying between two let-ring beats of the same system. Anything else —
 * an unmarked note or grace note, a system break — ends the run.
 */
function markRinging(flat) {
  const ringsAt = (k, sysIdx) => k >= 0 && k < flat.length && flat[k].sysIdx === sysIdx && flat[k].letRing;
  flat.forEach((it, i) => {
    if (it.letRing || !it.bridge) { it.ringing = it.letRing; return; }
    const isGap = (k) => k >= 0 && k < flat.length && flat[k].sysIdx === it.sysIdx && !flat[k].letRing && flat[k].bridge;
    let a = i - 1; while (isGap(a)) a--;
    let b = i + 1; while (isGap(b)) b++;
    it.ringing = ringsAt(a, it.sysIdx) && ringsAt(b, it.sysIdx);
  });
}

/**
 * Runs of consecutive beats (same system) sharing the same non-null
 * `kindOf(item)`: `[{ kind, start, endX }]`.
 */
function labelRuns(flat, kindOf, systems, theme) {
  const s = theme.staffLineSpacing;
  const runs = [];
  let i = 0;
  while (i < flat.length) {
    const kind = kindOf(flat[i]);
    if (!kind) { i++; continue; }
    let j = i;
    while (j + 1 < flat.length && kindOf(flat[j + 1]) === kind && flat[j + 1].sysIdx === flat[i].sysIdx) j++;
    const start = flat[i];
    const next = flat[j + 1];
    // Extend the dashed line to just before the next note if there is
    // one right after (same system), otherwise a fixed run-out length.
    const runEnd = next && next.sysIdx === start.sysIdx ? next.x - 0.6 * s : flat[j].x + 2.2 * s;
    const endX = Math.min(runEnd, breakEndX(systems, start.sysIdx, theme));
    runs.push({ kind, start, endX });
    i = j + 1;
  }
  return runs;
}
