/**
 * draw/passes/chordsFermatas.js — passes 6 and 7 (draw/passes.js): chord
 * symbols, chord diagrams and dynamics, one row / baseline per system
 * staff clear of the staff ink drawn so far (including passes 1, 2 and
 * 5), then fermatas. Pass 6 writes `run.chordBoxes`; pass 7 reads it (via
 * collectBeats) and `info.directionTopY` (pass 5).
 */
import {
  renderFermata, curveBow, renderChordSymbol, renderDynamic, chordSymbolFontSize, dynamicFontSizePx,
} from '../notation.js';
import { inkBounds, TEXT_ASCENT_EM, TEXT_DESCENT_EM } from '../../layout/ink.js';
import { estimateTextWidth } from '../../textMetrics.js';
import { glyphBox, glyphStringBox } from '../../glyphMetrics.js';
import { Glyph, dynamicGlyph } from '../../glyphs.js';
import { resolveShape } from '../../chordShapes.js';
import { renderChordDiagram, chordDiagramMetrics, NAME_GAP_SP } from '../chordDiagram.js';
import { breakEndX, breakStartX, tabTopY } from './common.js';
import { collectBeats, findSlurs, beatClearTop } from './notationBeats.js';

// Chord symbols: one baseline per system staff, at least CHORD_MIN_BASELINE_SP
// above the top line and with the (estimated) text bottom CHORD_CLEARANCE_SP
// above the highest ink of the staff's music.
const CHORD_MIN_BASELINE_SP = 2.5;
const CHORD_CLEARANCE_SP = 0.75;
// Chord diagrams: one bottom-aligned row per system staff, the grid's ink
// bottom (fingers included) at least DIAGRAM_MIN_CLEAR_SP above the top line
// and CHORD_CLEARANCE_SP above the highest ink of the staff's music.
const DIAGRAM_MIN_CLEAR_SP = 1.5;
// Dynamics: one baseline per system staff, at least DYNAMIC_MIN_BASELINE_SP
// below the bottom line and with the glyphs' top DYNAMIC_CLEARANCE_SP below
// the lowest ink of the staff's music.
const DYNAMIC_MIN_BASELINE_SP = 2;
const DYNAMIC_CLEARANCE_SP = 0.75;
// Fermata order above a beat: notes / articulations / tuplet / slur, then the
// chord-symbol line, then the fermata, its bottom this far above any chord
// symbol it overlaps horizontally.
const FERMATA_CHORD_GAP_SP = 0.5;
const FERMATA_DIRECTION_GAP_SP = 0.5; // fermata bottom -> top of a beat's pick stroke / tap "T" (renderPlayingDirections)

/**
 * Chord symbols (above) and dynamics (below) of every notation staff, one
 * common baseline each per system (lead-sheet / Gould practice): chord
 * symbols raised clear of the highest ink of that staff's music in the
 * system (notes, ledger lines, stems, beams, articulations, tuplet
 * brackets, slurs, grace notes and their slurs), dynamics lowered clear of
 * its lowest ink (incl. below-staff articulations and slurs). Only ink at
 * or right of the system's content start counts, so the clef, key
 * signature and measure number don't push the line out. Runs after the
 * tie/slur/grace-slur passes and before the fermata pass; records the
 * chord-symbol boxes on the run (`run.chordBoxes`) for the fermatas.
 *
 * Chord diagrams (chordShapes.resolveShape; tracks with
 * `showChordDiagrams`): one bottom-aligned row per system staff above the
 * music (layoutChordRow), each centred on its beat with its name on the
 * chord-symbol baseline (raised above the row when needed); their full
 * boxes go into `run.chordBoxes`, so fermatas clear them. A tab-only track
 * gets its diagrams (and their names) above the TAB staff, clear of the
 * TAB ink drawn so far (pick strokes, technique labels, bends); it draws
 * no plain chord symbols and no dynamics.
 */
export function renderChordSymbolsAndDynamics(score, trackRuns, theme, systems) {
  const s = theme.staffLineSpacing;
  trackRuns.forEach((run) => {
    run.chordBoxes = [];
    const staffG = run.notationG || run.tabG;
    if (!staffG) return;
    const onTab = !run.notationG;
    const shapes = chordShapesOf(run, score);
    const items = run.measures.flatMap((m) => m.elements)
      .filter((le) => shapes.has(le) || (!onTab && (le.el.chord || le.el.dynamic)));
    if (!items.length) return;
    const sys = systems[run.sysIdx];
    const ink = inkBounds(staffG, theme, { xMin: sys.contentStartX });
    const lineBottom = run.notationBaselineY;

    const chords = items.filter((le) => le.el.chord || shapes.has(le));
    if (chords.length) {
      const size = chordSymbolFontSize(theme);
      const staffTop = onTab ? tabTopY(run, run.track.tuning.length, theme) : 0;
      const top = Number.isFinite(ink.top) ? ink.top : staffTop;
      let y = Math.min(staffTop - CHORD_MIN_BASELINE_SP * s, top - CHORD_CLEARANCE_SP * s - chordNameDescent(theme));
      // `row` is non-null exactly when some beat has a shape; the diagram branch below (shapes.has(le)) relies on it.
      const row = shapes.size ? layoutChordRow(chords.filter((le) => shapes.has(le)), shapes, staffTop, top, sys, theme) : null;
      if (row) y = Math.min(y, row.nameY);
      chords.forEach((le) => {
        if (shapes.has(le)) {
          const name = le.el.chord ? String(le.el.chord).trim() : '';
          run.chordBoxes.push(renderChordDiagram(staffG, {
            cx: row.cx.get(le), gridBottom: row.gridBottom, rows: row.rows, shape: shapes.get(le), name, nameY: y,
          }, theme));
          return;
        }
        const str = String(le.el.chord);
        renderChordSymbol(run.notationG, le.x, y, str, theme);
        run.chordBoxes.push({
          x1: le.x, x2: le.x + estimateTextWidth(str, size, { bold: true }), top: y - TEXT_ASCENT_EM * size,
        });
      });
    }

    const dynamics = items.filter((le) => le.el.dynamic);
    if (dynamics.length) {
      const scale = dynamicFontSizePx(theme) / 4; // px per glyph unit (1 sp = font-size / 4)
      const glyphTop = Math.max(...dynamics.map((le) => glyphStringBox(dynamicGlyph(le.el.dynamic)).top)) * scale;
      const bottom = Number.isFinite(ink.bottom) ? ink.bottom : lineBottom;
      const y = Math.max(lineBottom + DYNAMIC_MIN_BASELINE_SP * s, bottom + DYNAMIC_CLEARANCE_SP * s + glyphTop);
      dynamics.forEach((le) => renderDynamic(run.notationG, le.x, y, le.el.dynamic, theme));
    }
  });
}

/** Chord-name ink below its baseline (TEXT_DESCENT_EM of the chord-symbol size), in px. */
const chordNameDescent = (theme) => TEXT_DESCENT_EM * chordSymbolFontSize(theme);

/**
 * The validated chord-diagram shape of every element of `run` that shows
 * one (chordShapes.resolveShape), keyed by layout element; whole-measure
 * rests never do (their chord symbol stays plain).
 */
function chordShapesOf(run, score) {
  const shapes = new Map();
  run.measures.forEach((m) => m.elements.forEach((le) => {
    if (le.wholeMeasureRest || !(le.el.chord || le.el.chordDiagram)) return;
    const shape = resolveShape(le.el, score, run.track);
    if (shape) shapes.set(le, shape);
  }));
  return shapes;
}

/**
 * One system staff's row of chord diagrams (`diagrams`, layout elements
 * with a shape in `shapes`): every grid gets the row's largest row count
 * and one grid bottom, its ink (fingers included) DIAGRAM_MIN_CLEAR_SP above
 * `staffTop` and CHORD_CLEARANCE_SP above `inkTop`; each centre is the
 * beat's x clamped so the diagram stays between the system's content start
 * and staff end (the left edge wins when it can't fit). `nameY` is the
 * name baseline NAME_GAP_SP above the highest diagram top.
 */
function layoutChordRow(diagrams, shapes, staffTop, inkTop, sys, theme) {
  const s = theme.staffLineSpacing;
  const rows = Math.max(...diagrams.map((le) => shapes.get(le).rows));
  const metrics = diagrams.map((le) => chordDiagramMetrics(shapes.get(le), rows, theme));
  const below = Math.max(...metrics.map((m) => m.belowGrid));
  const gridBottom = Math.min(staffTop - DIAGRAM_MIN_CLEAR_SP * s, inkTop - CHORD_CLEARANCE_SP * s) - below;
  const diagramTop = Math.min(...metrics.map((m) => gridBottom - m.gridH - m.aboveGrid));
  const cx = new Map(diagrams.map((le, i) => [le,
    Math.max(sys.contentStartX + metrics[i].left, Math.min(le.x, sys.staffEndX - metrics[i].right))]));
  return {
    rows, gridBottom, cx, nameY: diagramTop - NAME_GAP_SP * s - chordNameDescent(theme),
  };
}

/**
 * Highest point of each slur drawn above a beat (a cubic whose control
 * points sit `bow` past its ends peaks 0.75 * bow beyond them), less
 * 1.2 sp, recorded as `slurLimit` on every beat of `beats` (from
 * collectBeats) under it — Infinity when none; a split slur per segment.
 */
function slurAboveLimits(beats, systems, theme) {
  const sp = theme.staffLineSpacing;
  beats.forEach((b) => { b.slurLimit = Infinity; });
  const limitOver = (from, to, sysIdx, y1, y2, x1, x2) => {
    const bow = curveBow(Math.abs(x2 - x1), 'slur', theme);
    const limit = Math.min(y1, y2) - 0.75 * bow - sp * 1.2;
    for (let k = from; k <= to; k++) {
      if (beats[k].sysIdx === sysIdx) beats[k].slurLimit = Math.min(beats[k].slurLimit, limit);
    }
  };
  findSlurs(beats).forEach(({ i, j, above }) => {
    if (!above) return;
    const a = beats[i]; const b = beats[j];
    if (a.sysIdx === b.sysIdx) {
      limitOver(i, j, a.sysIdx, a.anchorAbove, b.anchorAbove, a.x, b.x);
    } else {
      limitOver(i, j, a.sysIdx, a.anchorAbove, a.anchorAbove, a.x, breakEndX(systems, a.sysIdx, theme));
      limitOver(i, j, b.sysIdx, b.anchorAbove, b.anchorAbove, breakStartX(systems, b.sysIdx, theme), b.x);
    }
  });
}

/**
 * Fermata: `fermata: true` on a note or rest beat draws a fermata above
 * it (notation staff only; ignored on grace notes). It's the outermost
 * mark of its beat, so its bottom edge is set clear of everything else
 * that can sit above the note: the staff itself, the note's stem/
 * noteheads/articulations, a vibrato or whole-note tremolo, a tuplet
 * bracket, any slur drawn above the beat, the beat's pick stroke / tap "T"
 * (`info.directionTopY`, FERMATA_DIRECTION_GAP_SP) and any chord symbol it
 * overlaps (the chord-symbol line sits below fermatas). Runs after every
 * system is drawn (a slur can start in an earlier measure) and after
 * renderPlayingDirections and renderChordSymbolsAndDynamics.
 */
export function renderFermatas(score, trackRuns, theme, systems) {
  const sp = theme.staffLineSpacing;
  score.tracks.forEach((track) => {
    if (!track.showStandardNotation) return;
    const beats = collectBeats(trackRuns, track, theme);
    if (!beats.some((item) => item.el.fermata === true)) return;
    slurAboveLimits(beats, systems, theme);

    const halfFermata = (glyphBox(Glyph.fermataAbove).width / 2) * sp;
    beats.forEach((item) => {
      const { el, info } = item;
      if (el.fermata !== true || !info || info.isGrace) return;
      const bottomY = Math.min(
        beatClearTop(item, sp),
        info.directionTopY != null ? info.directionTopY - FERMATA_DIRECTION_GAP_SP * sp : Infinity,
        ...item.chordBoxes
          .filter((b) => b.x1 < item.x + halfFermata && b.x2 > item.x - halfFermata)
          .map((b) => b.top - FERMATA_CHORD_GAP_SP * sp),
      );
      renderFermata(item.g, item.x, bottomY, theme);
    });
  });
}
