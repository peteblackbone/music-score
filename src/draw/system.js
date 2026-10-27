/**
 * draw/system.js — draws one system (line of music). Every staff of every
 * track gets its own group, `<g class="staff staff-notation|staff-tab"
 * data-track="ti">`, drawn with its top line at y = 0 (notation bottom line
 * at 4 sp, tab bottom string at (strings − 1) · tabStaffLineSpacing); the
 * renderer later measures each group's ink (layout/ink.js) and moves it
 * into place with `transform="translate(0,Y)"`. Staff groups contain no
 * nested transforms.
 *
 * Per staff: staff lines, system header (clef, key, time), each measure's
 * opening repeat barline, mid-system key/time change, content and closing
 * barline, and the courtesy signature after the last barline.
 */
import { group } from './svgUtil.js';
import { drawStaffLines, drawClef, drawKeySignature, drawTimeSignature, drawStaffBarline } from './staff.js';
import {
  renderNotationElement, renderBeams, renderTremolo, renderVibrato,
  renderTupletBracket, normalizeArticulations, renderArticulations, elementTop,
  renderWholeMeasureRest,
} from './notation.js';
import { drawTabStaffLines, drawTabClef, renderTabElement } from './tab.js';
import { drawTabRhythm } from './tabRhythm.js';
import { drawMeasureNumber } from './decor.js';
import { renderNotationArpeggio, renderTabArpeggio } from './arpeggio.js';
import { beatArpeggio } from '../directions.js';
import { glyphBox } from '../glyphMetrics.js';
import { noteheadForDuration } from '../glyphs.js';

// Top staff line -> lowest allowed tuplet bracket line. The end ticks hang 0.5 sp below the
// line and the number is centred on it, so 1 sp keeps both at least 0.5 sp clear of the staff.
const TUPLET_STAFF_CLEAR_SP = 1;

/** Local y of a staff's bottom line (its top line is y = 0). */
export function staffLineBottom(track, kind, theme) {
  return kind === 'tab'
    ? (track.tuning.length - 1) * theme.tabStaffLineSpacing
    : 4 * theme.staffLineSpacing;
}

/**
 * Draw system `sysIdx` into a new `<g class="system system-N">` appended to
 * `svg`. Returns `{ systemG, staves, runs }`:
 * - `staves`: top to bottom, `{ g, ti, kind, track, lineBottom }`;
 * - `runs`: one per track, `{ track, ti, sysIdx, measures, notationG, tabG,
 *   notationBaselineY, tabBaselineY }` (baselines local to their group) for
 *   the score-wide passes (draw/passes.js, in draw/passes/); each measure's elements carry
 *   their `rendered` info.
 */
export function drawSystem(svg, system, sysIdx, score, theme) {
  const systemG = group({ class: `system system-${sysIdx}` });
  const staves = [];
  const runs = [];

  score.tracks.forEach((track, ti) => {
    const measures = system.tracks[ti].measures;
    const run = { track, ti, sysIdx, measures, notationG: null, tabG: null, notationBaselineY: null, tabBaselineY: null };
    for (const kind of ['notation', 'tab']) {
      if (kind === 'notation' ? !track.showStandardNotation : !track.showTablature) continue;
      const g = group({ class: `staff staff-${kind}`, 'data-track': ti });
      const lineBottom = staffLineBottom(track, kind, theme);
      const staff = { g, ti, kind, track, lineBottom };
      drawStaff(g, system, sysIdx, staff, theme);
      systemG.appendChild(g);
      staves.push(staff);
      if (kind === 'notation') { run.notationG = g; run.notationBaselineY = lineBottom; } else { run.tabG = g; run.tabBaselineY = lineBottom; }
    }
    runs.push(run);
  });

  // Measure number of the system's first measure, systems 2+ only (ui.md §4).
  if (sysIdx > 0 && staves.length) {
    drawMeasureNumber(staves[0].g, system.startX, system.measureIndices[0] + 1, theme);
  }

  svg.appendChild(systemG);
  return { systemG, staves, runs };
}

/** One staff of one track across the whole system. */
function drawStaff(g, system, sysIdx, staff, theme) {
  const { track, kind, lineBottom } = staff;
  const measures = system.tracks[staff.ti].measures;
  if (kind === 'notation') g.appendChild(drawStaffLines(system.startX, system.staffEndX, lineBottom, theme));
  else g.appendChild(drawTabStaffLines(system.startX, system.staffEndX, lineBottom, track.tuning.length, theme));

  drawSystemHeader(g, system, measures[0], staff, theme);
  measures.forEach((measure) => drawMeasure(g, measure, staff, theme));
  if (system.courtesy) {
    drawSignatureChange(g, system.courtesy, system.tracks[staff.ti].courtesy, staff, theme, 'courtesy');
  }
}

/** Clef, key signature and (system 1 / changes only) time signature at the system start. */
function drawSystemHeader(g, system, firstMeasure, staff, theme) {
  const { track, kind, lineBottom } = staff;
  const h = system.header;
  if (kind === 'tab') {
    g.appendChild(drawTabClef(h.tabClefX, lineBottom, track.tuning.length, theme));
    // A tab-only track shows the time signature on its TAB staff (ui.md §3).
    if (h.showTime && !track.showStandardNotation) {
      g.appendChild(drawTimeSignature(h.timeX, tabTimeBaseline(staff, theme), firstMeasure.timeSignature, theme));
    }
    return;
  }
  g.appendChild(drawClef(h.clefX, lineBottom, track.clef, track.octaveClef, theme));
  if (firstMeasure.keySignature) {
    g.appendChild(drawKeySignature(h.keyX, lineBottom, firstMeasure.keySignature, track.clef, theme).node);
  }
  if (h.showTime) g.appendChild(drawTimeSignature(h.timeX, lineBottom, firstMeasure.timeSignature, theme));
}

/**
 * A key and/or time signature drawn after the start of a measure
 * (mid-system change) or after the system's last barline (courtesy).
 * `pos` gives the x of each part: `{ keyX, timeX }`; `sig` what to draw:
 * `{ key: { to, from } | null, time: ts | null }`.
 */
function drawSignatureChange(g, pos, sig, staff, theme, cls) {
  if (!sig) return;
  const { track, lineBottom } = staff;
  const tabOnly = staff.kind === 'tab' && !track.showStandardNotation;
  if (staff.kind !== 'notation' && !tabOnly) return;
  if (tabOnly && !sig.time) return;
  const parts = cls ? group({ class: cls }) : g;
  if (sig.key && !tabOnly) {
    parts.appendChild(drawKeySignature(pos.keyX, lineBottom, sig.key.to, track.clef, theme, sig.key.from).node);
  }
  if (sig.time) parts.appendChild(drawTimeSignature(pos.timeX, tabOnly ? tabTimeBaseline(staff, theme) : lineBottom, sig.time, theme));
  if (parts !== g) g.appendChild(parts);
}

/**
 * drawTimeSignature centres its digits 2 sp above the given "bottom line";
 * this is the value that centres them on a TAB staff instead.
 */
function tabTimeBaseline(staff, theme) {
  return staff.lineBottom / 2 + 2 * theme.staffLineSpacing;
}

/** One measure of one staff: opening repeat, mid-system change, content, closing barline. */
function drawMeasure(g, measure, staff, theme) {
  const { track, kind, lineBottom } = staff;
  if (measure.startBarline) {
    g.appendChild(drawStaffBarline(measure.startBarline.x, barlineStaff(staff, theme), measure.startBarline.type, theme));
  }
  if (measure.midSig) drawSignatureChange(g, measure.midSig, measure.midSig, staff, theme, null);

  if (kind === 'notation') drawNotationMeasure(g, measure, track, lineBottom, theme);
  else drawTabMeasure(g, measure, track, lineBottom, theme);

  if (measure.barline !== 'none') {
    g.appendChild(drawStaffBarline(measure.endX, barlineStaff(staff, theme), measure.barline, theme));
  }
}

/** What drawStaffBarline needs: line count/spacing (repeat dots) and the bottom line's y. */
function barlineStaff(staff, theme) {
  return staff.kind === 'tab'
    ? { kind: 'tab', lines: staff.track.tuning.length, lineSpacing: theme.tabStaffLineSpacing, lineBottom: staff.lineBottom }
    : { kind: 'notation', lines: 5, lineSpacing: theme.staffLineSpacing, lineBottom: staff.lineBottom };
}

/**
 * Notation-staff content of one measure: notes/rests (recording each
 * element's info on `layoutEl.rendered`), beams, articulations,
 * tremolo/vibrato, arpeggio lines and tuplet brackets. Chord symbols and dynamics are
 * drawn later by a score-wide pass (passes/chordsFermatas.js), once everything they must
 * clear is on the staff.
 */
function drawNotationMeasure(g, measure, track, notationBaselineY, theme) {
  if (measure.wholeRest && !measure.elements.length) {
    // Empty measure: an implicit whole-measure rest (ui.md §4, design Q9).
    renderWholeMeasureRest(g, measure.wholeRest.x, notationBaselineY, theme);
    return;
  }
  const rendered = {};
  const beamedIndices = new Set();
  measure.beamGroups.forEach((grp) => { if (grp.length >= 2) grp.forEach((i) => beamedIndices.add(i)); });
  measure.elements.forEach((layoutEl) => {
    const info = renderNotationElement(
      g,
      { ...layoutEl, baselineY: notationBaselineY },
      measure,
      track,
      theme,
      { beamed: beamedIndices.has(layoutEl.index), wholeMeasureRest: !!layoutEl.wholeMeasureRest }
    );
    rendered[layoutEl.index] = info;
    layoutEl.rendered = info; // kept for the tie/slur pass, which runs after every system is drawn
  });
  renderBeams(g, measure, rendered, theme, notationBaselineY);
  measure.elements.forEach((layoutEl) => {
    if (!layoutEl.rendered || layoutEl.rendered.isRest) return;
    const marks = layoutEl.el.type === 'note' ? normalizeArticulations(layoutEl.el.articulations) : [];
    if (marks.length) renderArticulations(g, layoutEl.rendered, marks, notationBaselineY, theme);
    if (layoutEl.el.tremolo) renderTremolo(g, layoutEl.rendered, theme);
    if (layoutEl.el.vibrato) renderVibrato(g, layoutEl.rendered, layoutEl.width, theme);
    const arp = beatArpeggio(layoutEl.el);
    if (arp) renderNotationArpeggio(g, { ...layoutEl, baselineY: notationBaselineY }, arp, theme);
  });

  drawTupletBrackets(g, measure, notationBaselineY, theme);
}

/**
 * Tuplet brackets: one per complete tuplet — a run of same-ratio beats,
 * which may span several beats (see tupletGroups in layout/beams.js) —
 * set clear of the group's highest point and never inside the staff,
 * spanning the first notehead's left edge to the last notehead's right
 * edge. Records the bracket height as `info.tupletY` for the fermata pass.
 */
function drawTupletBrackets(g, measure, notationBaselineY, theme) {
  const s = theme.staffLineSpacing;
  measure.tupletGroups.forEach(({ indices, count }) => {
    const grp = indices.map((i) => measure.elements[i]);
    const infos = grp.map((le) => le.rendered).filter(Boolean);
    const clearance = s * 1.6;
    const topY = infos.length
      ? Math.min(...infos.map(elementTop))
      : notationBaselineY - s * 4;
    // Keep the bracket (line, end ticks and number) outside the staff: never lower than
    // TUPLET_STAFF_CLEAR_SP above the top line, even over low notes with stems down.
    const y = Math.min(topY - clearance, notationBaselineY - s * 4 - s * TUPLET_STAFF_CLEAR_SP);
    infos.forEach((info) => { info.tupletY = y; }); // for the fermata pass
    const halfHead = (le) => (glyphBox(noteheadForDuration(le.el.duration)).width / 2) * s;
    const x1 = grp[0].x - halfHead(grp[0]);
    const x2 = grp[grp.length - 1].x + halfHead(grp[grp.length - 1]);
    renderTupletBracket(g, x1, x2, y, count, theme);
  });
}

/**
 * Tab-staff content of one measure: fret numbers, per-beat tab marks and
 * arpeggio lines, then, when the track shows rhythm on its TAB staff (`track.tabRhythm`),
 * stems, beams, flags, dots, tuplets and rests (draw/tabRhythm.js) — drawn
 * before the score-wide passes, so slides, H/P arcs and bends sit on top
 * of rest knock-outs. Records each element's fret / marks tops on
 * `layoutEl.tabRendered` for the score-wide passes (undefined for rests).
 */
function drawTabMeasure(g, measure, track, tabBaselineY, theme) {
  measure.elements.forEach((layoutEl) => {
    layoutEl.tabRendered = renderTabElement(g, { ...layoutEl, tabBaselineY }, track.tuning.length, theme);
    const arp = beatArpeggio(layoutEl.el);
    if (arp) renderTabArpeggio(g, { ...layoutEl, tabBaselineY }, track.tuning.length, arp, theme);
  });
  if (track.tabRhythm) drawTabRhythm(g, measure, track.tuning.length, tabBaselineY, theme);
}
