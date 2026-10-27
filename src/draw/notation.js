/**
 * draw/notation.js — noteheads, stems, flags, beams, rests, accidentals,
 * ties, slurs and dynamics for the standard-notation staff.
 */
import { line, group, glyphText, path, text, circle, wavyPathD, svgD } from './svgUtil.js';
import {
  Glyph, restForDuration, flagForDuration, accidentalGlyph, dynamicGlyph, pickStrokeGlyph,
} from '../glyphs.js';
import { layoutHeadGlyph } from '../harmonics.js';
import { staffPosition, staffPositionToY } from '../pitch.js';
import { smuflFontSizePx } from '../theme.js';
import { beamCount } from '../duration.js';
import {
  stemDxSp, stemDySp, dotPosition, DOT_GAP_SP, DOT_STEP_SP, DOT_RADIUS_SP,
  GHOST_PAREN_DX_SP, GHOST_PAREN_SIZE_SP, GHOST_PAREN_BASELINE,
} from '../layout/chord.js';
import { stemUpFor } from '../layout/timeline.js';
import { glyphBox } from '../glyphMetrics.js';

const STEM_LENGTH_SPACES = 3.5;
const REST_POSITION = { whole: 6, half: 4, quarter: 4, '8th': 4, '16th': 4, '32nd': 4, '64th': 4 };

// Articulations stack outward from the notehead in this fixed order,
// regardless of the order the author listed them in.
const ARTIC_ORDER = ['staccato', 'tenuto', 'accent'];
const ARTIC_GLYPHS = {
  staccato: { above: Glyph.articStaccatoAbove, below: Glyph.articStaccatoBelow },
  tenuto: { above: Glyph.articTenutoAbove, below: Glyph.articTenutoBelow },
  accent: { above: Glyph.articAccentAbove, below: Glyph.articAccentBelow },
};
// Bravura draws each articulation with its origin on the edge nearest the
// staff, so shifting by half the glyph's height (in staff spaces) centres
// it on its target staff position.
const ARTIC_HALF_HEIGHT_SP = { staccato: 0.17, tenuto: 0.08, accent: 0.37 };
const DYNAMIC_SIZE_EXTRA_SP = 1.4;   // dynamic glyphs are set this much larger than theme.dynamicFontSize

/**
 * Stem geometry of a rendered note for direction `stemUp`: x at the
 * notehead's stem anchor, base at the far notehead's anchor, natural tip
 * 3.5 sp beyond the near-tip notehead and at least reaching the middle
 * line (notes with ledger lines). Returns `{ x, baseY, tipY, tipNoteY }`.
 */
export function stemGeometry(info, stemUp, baselineY, theme) {
  const s = theme.staffLineSpacing;
  const headGlyph = info.headGlyph || Glyph.noteheadBlack;
  // The base note's own head decides the attachment height (a diamond's vertex).
  const baseGlyph = (stemUp ? info.stemBaseGlyphUp : info.stemBaseGlyphDown) || headGlyph;
  const x = info.x + stemDxSp(headGlyph, stemUp) * s;
  const basePos = stemUp ? info.minPos : info.maxPos;
  const tipNotePos = stemUp ? info.maxPos : info.minPos;
  const tipPos = stemUp ? Math.max(tipNotePos + 2 * STEM_LENGTH_SPACES, 4) : Math.min(tipNotePos - 2 * STEM_LENGTH_SPACES, 4);
  const posY = (p) => baselineY + staffPositionToY(p, s);
  return {
    x,
    baseY: posY(basePos) + stemDySp(baseGlyph, stemUp) * s,
    tipY: posY(tipPos),
    tipNoteY: posY(tipNotePos),
  };
}

/**
 * Render one element (note/chord/rest) of the standard-notation staff,
 * arranged by its chord layout (`layoutEl.chord`, layout/chord.js).
 * Returns rendering info used later for beams/ties/slurs/dynamics.
 */
export function renderNotationElement(g, layoutEl, measure, track, theme, opts = {}) {
  const fontSize = smuflFontSizePx(theme);
  const spacing = theme.staffLineSpacing;
  const el = layoutEl.el;
  const x = layoutEl.x;
  const clef = track.clef;

  if (el.type === 'rest') {
    if (opts.wholeMeasureRest) {
      renderWholeMeasureRest(g, x, layoutEl.baselineY, theme);
      return { isRest: true, x, noteheads: [] };
    }
    const pos = REST_POSITION[el.duration] ?? 4;
    const glyph = restForDuration(el.duration);
    const y = layoutEl.baselineY + staffPositionToY(pos, spacing);
    g.appendChild(glyphText(x, y, glyph, theme.fontFamily, fontSize, {
      fill: theme.noteColor, 'text-anchor': 'middle',
    }));
    if (el.dots) {
      const dx = (glyphBox(glyph).width / 2 + DOT_GAP_SP) * spacing;
      drawDots(g, x + dx, [dotPosition(pos)], el.dots, layoutEl.baselineY, theme);
    }
    return { isRest: true, x, noteheads: [] };
  }

  if (el.type === 'grace') return renderGraceNote(g, layoutEl, track, theme);

  const notes = el.notes || [];
  const positions = notes.map((n) => staffPosition(n.pitch, clef));
  const minPos = Math.min(...positions);
  const maxPos = Math.max(...positions);
  const chord = layoutEl.chord;
  if (!chord) throw new Error('renderNotationElement: layoutEl.chord is missing');
  const stemUp = chord.stemUp;
  const noteheads = [];

  // Ledger lines first (under the noteheads), spanning every head column.
  drawLedgerLines(g, x + chord.ledgerSpan.left, x + chord.ledgerSpan.right, minPos, maxPos, layoutEl.baselineY, theme);

  notes.forEach((note, i) => {
    const pos = positions[i];
    const hx = x + chord.heads[i].dx;
    const y = layoutEl.baselineY + staffPositionToY(pos, spacing);
    // Dead/muted note: a percussive, indeterminate-pitch strike — shown
    // with an "x" notehead instead of the usual oval, regardless of
    // duration (matching how tab software always uses a solid x). Otherwise
    // the chord layout's head (a diamond for a natural harmonic).
    const glyph = note.mute ? Glyph.noteheadXBlack : chord.heads[i].glyph;
    g.appendChild(glyphText(hx, y, glyph, theme.fontFamily, fontSize, {
      fill: theme.noteColor, 'text-anchor': 'middle',
    }));
    // Ghost note: a note played very quietly/buried (as opposed to a
    // dead/muted note, which is silenced/percussive) — shown as the
    // notehead bracketed by a pair of parentheses, tight against its sides.
    if (note.ghost) {
      const parenSize = spacing * GHOST_PAREN_SIZE_SP;
      const parenY = y + parenSize * GHOST_PAREN_BASELINE;
      const parenDx = spacing * GHOST_PAREN_DX_SP;
      g.appendChild(text(hx - parenDx, parenY, '(', {
        'font-family': theme.textFontFamily,
        'font-size': parenSize,
        'text-anchor': 'middle',
        fill: theme.noteColor,
      }));
      g.appendChild(text(hx + parenDx, parenY, ')', {
        'font-family': theme.textFontFamily,
        'font-size': parenSize,
        'text-anchor': 'middle',
        fill: theme.noteColor,
      }));
    }
    // Accidental: decided by the layout (measure carry-through) and placed in its chord-layout column.
    const acc = chord.accidentals.find((a) => a.noteIndex === i);
    if (acc) {
      g.appendChild(glyphText(x + acc.dx, y, accidentalGlyph(acc.name), theme.fontFamily, fontSize, {
        fill: theme.noteColor,
      }));
    }
    noteheads.push({
      pitch: note.pitch, x: hx, y, position: pos, halfWidth: chord.heads[i].width / 2,
      tieStart: !!note.tieStart, tieEnd: !!note.tieEnd,
    });
  });
  if (el.dots) drawDots(g, x + chord.dots.dx, chord.dots.positions, el.dots, layoutEl.baselineY, theme);

  const info = {
    isRest: false, x, noteheads, stemUp, minPos, maxPos, duration: el.duration, headGlyph: chord.stemGlyph,
    stemBaseGlyphUp: chord.heads[positions.indexOf(minPos)].glyph,
    stemBaseGlyphDown: chord.heads[positions.indexOf(maxPos)].glyph,
  };
  if (el.duration === 'whole') return info;

  // A beamed note's stem length depends on the *whole group's* shared
  // slope (computed in renderBeams once every note's position is known),
  // so when this note belongs to a beam group we only report the raw
  // pitch data here and let renderBeams draw both the stem and the beam
  // together. Un-beamed notes get their normal fixed-length stem now.
  const stem = stemGeometry(info, stemUp, layoutEl.baselineY, theme);
  info.stemAttachX = stem.x;
  info.noteY = stem.tipNoteY;
  if (opts.beamed) return { ...info, beamed: true };

  g.appendChild(line(stem.x, stem.baseY, stem.x, stem.tipY, {
    stroke: theme.noteColor, 'stroke-width': theme.stemWidth,
  }));
  info.stemTopY = stemUp ? stem.tipY : stem.baseY;
  info.stemBottomY = stemUp ? stem.baseY : stem.tipY;

  const flagGlyph = flagForDuration(el.duration, stemUp);
  if (flagGlyph) {
    g.appendChild(glyphText(stem.x, stem.tipY, flagGlyph, theme.fontFamily, fontSize, {
      fill: theme.noteColor,
    }));
  }
  info.hasFlagGlyph = !!flagGlyph;
  return info;
}

/**
 * Whole-measure rest (ui.md §4): the whole-rest glyph hung from the fourth
 * line (pos 6), centred on `x` (the layout centres it between the
 * measure's barlines), whatever the meter.
 */
export function renderWholeMeasureRest(g, x, baselineY, theme) {
  const y = baselineY + staffPositionToY(6, theme.staffLineSpacing);
  g.appendChild(glyphText(x, y, Glyph.restWhole, theme.fontFamily, smuflFontSizePx(theme), {
    fill: theme.noteColor, 'text-anchor': 'middle',
  }));
}

/**
 * Render a grace note: a small crushed/"acciaccatura" ornament squeezed
 * into its own tiny slot just before the note it decorates, drawn at
 * `theme.graceNoteScale` size with a diagonal slash across its stem (the
 * standard mark distinguishing a grace note from a normal short note).
 * Most often used to notate a fast hammer-on/pull-off in standard
 * notation when there's no spare rhythmic value to give it a full note —
 * the tab staff shows the same technique via the target note's ordinary
 * `hammerPull` slur, so this only needs to handle the notation side.
 * `renderGraceSlurs` (draw/passes/curves.js) auto-slurs each grace note to the very next note
 * after rendering, so this just needs to return
 * enough info (`x`, `noteheads`, `stemTopY`/`stemBottomY`) for that pass
 * and for tremolo/vibrato to build on, same shape as a normal note.
 */
function renderGraceNote(g, layoutEl, track, theme) {
  const spacing = theme.staffLineSpacing;
  const scale = theme.graceNoteScale;
  const fontSize = smuflFontSizePx(theme) * scale;
  const el = layoutEl.el;
  const x = layoutEl.x;
  const clef = track.clef;

  const notes = el.notes || [];
  const positions = notes.map((n) => staffPosition(n.pitch, clef));
  const minPos = Math.min(...positions);
  const maxPos = Math.max(...positions);
  const stemUp = stemUpFor(positions);

  const noteheads = [];
  notes.forEach((note, i) => {
    const pos = positions[i];
    const y = layoutEl.baselineY + staffPositionToY(pos, spacing);
    const headGlyph = layoutHeadGlyph(note, '8th'); // black head; black diamond for a natural harmonic
    g.appendChild(glyphText(x, y, headGlyph, theme.fontFamily, fontSize, {
      fill: theme.noteColor, 'text-anchor': 'middle',
    }));
    const ledgerHalf = (glyphBox(headGlyph).width / 2 + 0.3) * spacing * scale;
    drawLedgerLines(g, x - ledgerHalf, x + ledgerHalf, pos, pos, layoutEl.baselineY, theme);
    noteheads.push({ pitch: note.pitch, x, y, position: pos, halfWidth: (glyphBox(headGlyph).width / 2) * spacing * scale });
  });

  const extremePos = stemUp ? maxPos : minPos;
  const noteY = layoutEl.baselineY + staffPositionToY(extremePos, spacing);
  const stemAttachX = x + (stemUp ? 0.4 : -0.4) * spacing;
  const stemLen = STEM_LENGTH_SPACES * spacing * scale;
  const stemEndY = noteY + (stemUp ? -1 : 1) * stemLen;
  g.appendChild(line(stemAttachX, noteY, stemAttachX, stemEndY, {
    stroke: theme.noteColor, 'stroke-width': theme.stemWidth * 0.9,
  }));
  g.appendChild(glyphText(stemAttachX, stemEndY, flagForDuration('8th', stemUp), theme.fontFamily, fontSize, {
    fill: theme.noteColor,
  }));
  // The slash: a short diagonal stroke crossing the stem partway up,
  // marking this as a crushed grace note rather than a plain short note.
  const slashMidY = noteY + (stemEndY - noteY) * 0.5;
  const slashDx = 0.5 * spacing;
  const slashDy = 0.45 * spacing * (stemUp ? 1 : -1);
  g.appendChild(line(
    stemAttachX - slashDx, slashMidY + slashDy,
    stemAttachX + slashDx, slashMidY - slashDy,
    { stroke: theme.noteColor, 'stroke-width': 1.3 }
  ));

  const stemTopY = stemUp ? stemEndY : noteY;
  const stemBottomY = stemUp ? noteY : stemEndY;
  return {
    isRest: false, isGrace: true, x, noteheads, stemUp, stemAttachX, stemTopY, stemBottomY,
    noteY, minPos, maxPos, duration: '8th',
  };
}

/** Augmentation dots: `count` per dot position, first centre at `x`, DOT_STEP_SP apart. */
function drawDots(g, x, dotPositions, count, baselineY, theme) {
  const spacing = theme.staffLineSpacing;
  dotPositions.forEach((dotPos) => {
    const y = baselineY + staffPositionToY(dotPos, spacing);
    for (let i = 0; i < count; i++) {
      g.appendChild(circle(x + i * DOT_STEP_SP * spacing, y, DOT_RADIUS_SP * spacing, { fill: theme.noteColor }));
    }
  });
}

/** Ledger lines from x1 to x2 for every ledger position the chord range `minPos..maxPos` needs. */
function drawLedgerLines(g, x1, x2, minPos, maxPos, baselineY, theme) {
  const spacing = theme.staffLineSpacing;
  const ledger = (p) => {
    const y = baselineY + staffPositionToY(p, spacing);
    g.appendChild(line(x1, y, x2, y, { stroke: theme.staffLineColor, 'stroke-width': theme.staffLineWidth }));
  };
  for (let p = 10; p <= maxPos; p += 2) ledger(p);
  for (let p = -2; p >= minPos; p -= 2) ledger(p);
}

const MAX_BEAM_HALF_RISE_SPACES = 1.25; // clamps how steep a beam is allowed to slope
const MIN_STEM_SPACES = 2.5;             // no beamed note gets a stem shorter than this

/**
 * Draw beams for groups of >=2 eligible notes; for groups of length 1 the
 * individual flag glyph (already drawn in renderNotationElement) stands.
 * `rendered` maps element index -> info returned by renderNotationElement.
 *
 * Every note in a beam group shares one stem direction and one straight
 * beam line: the line's natural slope follows the first/last notehead,
 * clamped so it never gets too steep, and then nudged further from the
 * noteheads if needed so no note in between ends up with a too-short
 * stem. Stems for beamed notes are drawn here (not in
 * renderNotationElement) because they can't be finalized until this
 * shared line is known.
 */
export function renderBeams(g, measureLayout, rendered, theme, baselineY) {
  const spacing = theme.staffLineSpacing;
  for (const beamGroup of measureLayout.beamGroups) {
    if (beamGroup.length < 2) continue;
    const infos = beamGroup.map((idx) => rendered[idx]).filter(Boolean);
    if (infos.length < 2) continue;

    // One shared stem direction for the whole group, based on its overall pitch range.
    const overallMin = Math.min(...infos.map((i) => i.minPos));
    const overallMax = Math.max(...infos.map((i) => i.maxPos));
    const stemUp = stemUpFor([overallMin, overallMax]);
    const dirSign = stemUp ? -1 : 1; // direction from notehead toward the stem tip
    const extendSign = stemUp ? 1 : -1; // secondary beams thicken toward the notehead

    infos.forEach((info) => {
      // Recompute each stem from the group's final direction at the
      // notehead's stem anchor (layout already chose this direction for
      // the chord layout, so heads and stems agree).
      info.stemUp = stemUp;
      const stem = stemGeometry(info, stemUp, baselineY, theme);
      info.stemAttachX = stem.x;
      info.noteY = stem.tipNoteY;
      info.stemBaseY = stem.baseY;
      info.naturalTipY = stem.tipY;
    });

    const first = infos[0];
    const last = infos[infos.length - 1];
    const x0 = first.stemAttachX;
    const x1 = last.stemAttachX;

    // Natural slope from each end note's own standard-length stem, then clamped.
    const naturalY0 = first.naturalTipY;
    const naturalY1 = last.naturalTipY;
    const avgY = (naturalY0 + naturalY1) / 2;
    const maxHalfRise = MAX_BEAM_HALF_RISE_SPACES * spacing;
    const halfRise = Math.max(-maxHalfRise, Math.min(maxHalfRise, (naturalY1 - naturalY0) / 2));
    let yStart = avgY - halfRise;
    let yEnd = avgY + halfRise;

    // Make sure every note in between still gets at least a minimum-length stem.
    // (interp reads yStart/yEnd live, so it reflects the deficit shift below.)
    const interp = (px) => (x1 === x0 ? yStart : yStart + (yEnd - yStart) * ((px - x0) / (x1 - x0)));
    const minStem = MIN_STEM_SPACES * spacing;
    let deficit = 0;
    infos.forEach((info) => {
      const beamY = interp(info.stemAttachX);
      const len = dirSign === -1 ? info.noteY - beamY : beamY - info.noteY;
      deficit = Math.max(deficit, minStem - len);
    });
    if (deficit > 0) {
      yStart += dirSign * deficit;
      yEnd += dirSign * deficit;
    }

    // Draw each beamed note's stem now that the shared line is final.
    infos.forEach((info) => {
      const beamY = interp(info.stemAttachX);
      g.appendChild(line(info.stemAttachX, info.stemBaseY, info.stemAttachX, beamY, {
        stroke: theme.noteColor, 'stroke-width': theme.stemWidth,
      }));
      info.stemTopY = stemUp ? beamY : info.stemBaseY;
      info.stemBottomY = stemUp ? info.stemBaseY : beamY;
    });

    const levels = Math.max(...infos.map((i) => beamCount(i.duration)));
    // A stroked <line>'s width is centered on its coordinate, but a filled
    // polygon's edge is a hard cut at its coordinate — so at the outermost
    // stems, half the stem's stroke width pokes out past the beam's flat
    // edge as a tiny visible sliver. Widening the beam past the true stem
    // x by half a stem-width (plus a hair for anti-aliasing) swallows it
    // so the stem and beam read as one continuous shape.
    const stemCap = beamStemCap(theme);

    for (let lvl = 0; lvl < levels; lvl++) {
      const off = extendSign * lvl * (theme.beamWidth + BEAM_LEVEL_GAP_SP * spacing);
      // Only draw this beam level across the sub-range of notes that actually have >= lvl+1 flags.
      let segStart = null;
      for (let i = 0; i < infos.length; i++) {
        const has = beamCount(infos[i].duration) >= lvl + 1;
        if (has && segStart === null) segStart = i;
        const isLast = i === infos.length - 1;
        if ((!has || isLast) && segStart !== null) {
          const segEnd = has ? i : i - 1;
          const trueXa = infos[segStart].stemAttachX;
          const trueXb = infos[segEnd].stemAttachX;
          const ya = interp(trueXa) + off;
          const xa = segStart === 0 ? trueXa - stemCap : trueXa;
          if (segStart === segEnd) {
            // stub beam for a lone short note within the group (points toward its neighbor)
            const stubDir = (segEnd === infos.length - 1) ? -1 : 1;
            g.appendChild(beamShape(xa, ya, trueXa + stubDir * BEAM_STUB_SP * spacing, ya, theme.beamWidth, extendSign, theme.noteColor));
          } else {
            const yb = interp(trueXb) + off;
            const xb = segEnd === infos.length - 1 ? trueXb + stemCap : trueXb;
            g.appendChild(beamShape(xa, ya, xb, yb, theme.beamWidth, extendSign, theme.noteColor));
          }
          segStart = null;
        }
      }
    }
  }
}

export const BEAM_STUB_SP = 0.9;      // partial-beam stub length
export const BEAM_LEVEL_GAP_SP = 0.2; // gap between stacked beam levels (added to theme.beamWidth)

/** How far a beam runs past its outermost stems' x (px): half a stem width plus a hair for anti-aliasing. */
export const beamStemCap = (theme) => theme.stemWidth / 2 + 0.04 * theme.staffLineSpacing;

/**
 * One beam (a primary or secondary stroke) as a filled parallelogram with
 * vertical end edges, matching engraving convention: thickness is measured
 * vertically (constant regardless of slope) and each end is cut straight
 * up-and-down where it meets a stem, not slanted like a stroked line's cap.
 */
export function beamShape(x1, y1, x2, y2, thickness, extendSign, color) {
  const d = svgD`M ${x1} ${y1} L ${x2} ${y2} L ${x2} ${y2 + thickness * extendSign} L ${x1} ${y1 + thickness * extendSign} Z`;
  return path(d, { fill: color, stroke: 'none' });
}

/**
 * Draw tremolo-picking marks: three short parallel diagonal strokes
 * crossing the note's stem (or, for a stemless whole note, hanging just
 * above its topmost notehead) — the standard way to mark a single
 * sustained note as rapidly alternate-picked rather than struck once.
 * `info` is the object `renderNotationElement`/`renderBeams` returned for
 * this note, so the marks land on its *final* stem geometry (beamed notes
 * only know their real stem length after `renderBeams` runs).
 */
export function renderTremolo(g, info, theme) {
  const gEl = group({ class: 'tremolo' });
  const color = theme.noteColor;
  const spacing = theme.staffLineSpacing;
  const strokeLen = 0.8 * spacing;
  const gap = 0.5 * spacing;
  const rad = (-32 * Math.PI) / 180; // lean like "/", matching the strokes' conventional angle
  const hx = Math.cos(rad) * (strokeLen / 2);
  const hy = Math.sin(rad) * (strokeLen / 2);

  let cx, midY;
  if (info.stemTopY != null && info.stemBottomY != null) {
    cx = info.stemAttachX;
    midY = (info.stemTopY + info.stemBottomY) / 2;
  } else {
    // No stem (whole note) — hang the marks just above the topmost notehead
    // (or its articulations, if it has any above).
    const topY = Math.min(info.articTopY ?? Infinity, ...(info.noteheads || []).map((n) => n.y));
    cx = info.x;
    midY = topY - 1.3 * spacing;
  }

  for (let i = -1; i <= 1; i++) {
    const cy = midY + i * gap;
    gEl.appendChild(line(cx - hx, cy + hy, cx + hx, cy - hy, {
      stroke: color, 'stroke-width': 1.6, 'stroke-linecap': 'round',
    }));
  }
  g.appendChild(gEl);
}

/**
 * Draw a vibrato mark: a short wavy horizontal line above the note — above
 * its stem tip if it has one, otherwise above its topmost notehead —
 * spanning roughly the note's own column width (`width`, its allotted
 * horizontal layout space), the standard way to show a sustained pitch
 * wobbled with the fretting hand. `info` is the object
 * `renderNotationElement`/`renderBeams` returned for this note, same as
 * `renderTremolo`, so it lands on the note's *final* stem geometry.
 */
export function renderVibrato(g, info, width, theme) {
  const gEl = group({ class: 'vibrato' });
  const color = theme.noteColor;
  const spacing = theme.staffLineSpacing;
  const y = elementTop(info) - spacing * 1.1;
  const x1 = info.x + 0.5 * spacing;
  const x2 = x1 + Math.max(1.4 * spacing, Math.min(3.4 * spacing, (width ?? 2.8 * spacing) - 0.8 * spacing));
  gEl.appendChild(path(wavyPathD(x1, x2, y, 0.2 * spacing, 0.7 * spacing), {
    fill: 'none', stroke: color, 'stroke-width': 1.2, 'stroke-linecap': 'round',
  }));
  g.appendChild(gEl);
}

/**
 * Highest drawn point (smallest y) of a rendered beat: its stem tip,
 * above-staff articulations or topmost notehead, whichever is highest.
 * `info` is the object `renderNotationElement`/`renderBeams` returned.
 * Returns Infinity when the beat has none of these (e.g. a rest); callers
 * supply their own fallback.
 */
export function elementTop(info) {
  const noteheadYs = (info.noteheads || []).map((n) => n.y);
  return Math.min(info.stemTopY ?? Infinity, info.articTopY ?? Infinity, ...(noteheadYs.length ? noteheadYs : [Infinity]));
}

/**
 * Lowest drawn point (largest y) of a rendered beat: its stem tip (stem
 * down), below-staff articulations or lowest notehead. The mirror of
 * elementTop; returns -Infinity when the beat has none of these.
 */
export function elementBottom(info) {
  const noteheadYs = (info.noteheads || []).map((n) => n.y);
  return Math.max(info.stemBottomY ?? -Infinity, info.articBottomY ?? -Infinity, ...(noteheadYs.length ? noteheadYs : [-Infinity]));
}

/**
 * Turn a beat's raw `articulations` field into the list of marks to draw,
 * in stacking order (nearest the notehead first). Unknown names,
 * duplicates and non-array values are silently dropped.
 */
export function normalizeArticulations(raw) {
  return Array.isArray(raw) ? ARTIC_ORDER.filter((name) => raw.includes(name)) : [];
}

/**
 * Draw a beat's articulation marks (from `normalizeArticulations`) on the
 * side opposite the stem, starting at the outermost notehead on that side
 * and stacking outward one staff space per mark, each centred in a staff
 * space (never on a line). Stem direction comes from `info`'s final
 * geometry, so beamed notes use their group's shared direction; whole
 * notes (no stem) use the usual middle-line rule. Records the outer edge
 * of the stack as `info.articTopY` (marks above) or `info.articBottomY`
 * (marks below) for the slur/tuplet/vibrato/dynamic/fermata passes.
 */
export function renderArticulations(g, info, marks, baselineY, theme) {
  if (!marks.length || !(info.noteheads || []).length) return;
  const spacing = theme.staffLineSpacing;
  const fontSize = smuflFontSizePx(theme);
  const stemUp = info.duration === 'whole' ? stemUpFor([info.minPos, info.maxPos]) : info.stemUp;
  const side = stemUp ? 'below' : 'above';
  const dir = stemUp ? -1 : 1; // staff-position direction away from the notehead
  const n = stemUp ? info.minPos : info.maxPos;
  let pos = n + dir * (Math.abs(n) % 2 === 1 ? 2 : 3);

  const gEl = group({ class: 'articulations' });
  let edgeY;
  marks.forEach((name) => {
    const half = ARTIC_HALF_HEIGHT_SP[name] * spacing;
    const centerY = baselineY + staffPositionToY(pos, spacing);
    gEl.appendChild(glyphText(info.x, centerY + dir * half, ARTIC_GLYPHS[name][side], theme.fontFamily, fontSize, {
      fill: theme.noteColor, 'text-anchor': 'middle',
    }));
    edgeY = centerY - dir * half;
    pos += dir * 2;
  });
  g.appendChild(gEl);
  if (stemUp) info.articBottomY = edgeY;
  else info.articTopY = edgeY;
}

/**
 * Draw a fermata above a beat, centred on `x` with its bottom edge at
 * `bottomY` (already resolved by the caller to clear everything else
 * drawn above that beat).
 */
export function renderFermata(g, x, bottomY, theme) {
  const gEl = group({ class: 'fermata' });
  // fermataAbove's origin already sits on its bottom edge.
  gEl.appendChild(glyphText(x, bottomY, Glyph.fermataAbove, theme.fontFamily, smuflFontSizePx(theme), {
    fill: theme.noteColor, 'text-anchor': 'middle',
  }));
  g.appendChild(gEl);
}

/**
 * Draw a pick stroke ('down' → down-bow U+E610, 'up' → up-bow U+E612) at
 * full SMuFL size, centred on `x` with its bottom edge at `bottomY`
 * (resolved by the caller), in `<g class="pick-stroke pick-stroke-<kind>">`.
 * Returns the y of the glyph's top.
 */
export function renderPickStroke(g, x, bottomY, kind, color, theme) {
  const glyph = pickStrokeGlyph(kind);
  const gEl = group({ class: `pick-stroke pick-stroke-${kind}` });
  // Both glyphs' origin sits on their bottom edge.
  gEl.appendChild(glyphText(x, bottomY, glyph, theme.fontFamily, smuflFontSizePx(theme), {
    fill: color, 'text-anchor': 'middle',
  }));
  g.appendChild(gEl);
  return bottomY - glyphBox(glyph).top * theme.staffLineSpacing;
}

export const TUPLET_LABEL_SIZE_SP = 1.1;   // tuplet number font size
const TUPLET_GAP_PER_DIGIT_EM = 0.62;      // bracket gap per digit of the number (× font size)
const TUPLET_GAP_PAD_SP = 0.4;             // extra bracket gap around the number
const TUPLET_BASELINE_EM = 0.36;           // bracket line -> number baseline (× font size)
const TUPLET_TICK_SP = 0.5;                // end tick length
const TUPLET_STROKE_WIDTH = 1;

/** The tuplet number as italic `<text>` centred on `x`, baseline `y`. */
export function tupletLabel(x, y, count, color, theme) {
  return text(x, y, String(count), {
    'font-family': theme.textFontFamily,
    'font-style': 'italic',
    'font-size': TUPLET_LABEL_SIZE_SP * theme.staffLineSpacing,
    'text-anchor': 'middle',
    fill: color,
  });
}

/**
 * Append a tuplet bracket to `g` inside a new `<g class={className}>`: a
 * horizontal line at `y` from x1 to x2 with a short tick at each end
 * (`tickDir` +1 = ticks down, -1 = up) and the count centred in a gap in
 * the line. Shared by notation (renderTupletBracket) and TAB rhythm.
 */
export function tupletBracket(g, x1, x2, y, count, { tickDir, color, className }, theme) {
  const gEl = group({ class: className });
  const spacing = theme.staffLineSpacing;
  const tick = tickDir * TUPLET_TICK_SP * spacing;
  const labelSize = TUPLET_LABEL_SIZE_SP * spacing;
  const gap = labelSize * TUPLET_GAP_PER_DIGIT_EM * String(count).length + TUPLET_GAP_PAD_SP * spacing;
  const midX = (x1 + x2) / 2;
  gEl.appendChild(path(svgD`M ${x1} ${y + tick} L ${x1} ${y} L ${midX - gap / 2} ${y}`, {
    fill: 'none', stroke: color, 'stroke-width': TUPLET_STROKE_WIDTH,
  }));
  gEl.appendChild(path(svgD`M ${midX + gap / 2} ${y} L ${x2} ${y} L ${x2} ${y + tick}`, {
    fill: 'none', stroke: color, 'stroke-width': TUPLET_STROKE_WIDTH,
  }));
  gEl.appendChild(tupletLabel(midX, y + labelSize * TUPLET_BASELINE_EM, count, color, theme));
  g.appendChild(gEl);
}

/**
 * Draw a tuplet bracket (e.g. "⌐3⌐") over a run of notes: two short
 * downward ticks at each end joined by a horizontal line, with the count
 * centered in a gap in the line — standard engraving for a triplet/etc.
 * `y` is the line's height (already resolved by the caller from the
 * group's actual topmost point, same pattern as the slur pass).
 */
export function renderTupletBracket(g, x1, x2, y, count, theme) {
  tupletBracket(g, x1, x2, y, count, { tickDir: 1, color: theme.noteColor, className: 'tuplet' }, theme);
}

/** Font size (px) of chord symbols. */
export const chordSymbolFontSize = (theme) => theme.dynamicFontSize;

/**
 * Draw a chord symbol (e.g. "F", "C/E") above the staff, left edge at this
 * beat's x, on baseline `y` (local; the score-wide pass in passes/chordsFermatas.js puts
 * every chord symbol of a system's staff on one baseline clear of its ink).
 * `anchor` is the SVG text-anchor: 'start' (plain symbols) or 'middle'
 * (the name centred over a chord diagram, draw/chordDiagram.js).
 */
export function renderChordSymbol(g, x, y, chord, theme, anchor = 'start') {
  g.appendChild(text(x, y, chord, {
    class: 'chord-symbol',
    'font-family': theme.textFontFamily,
    'font-weight': 'bold',
    'font-size': chordSymbolFontSize(theme),
    'text-anchor': anchor,
    fill: theme.noteColor,
  }));
}

/**
 * How far a tie/slur of horizontal length `dist` bows out from its ends
 * (shared with the fermata pass, which clears slur apexes).
 */
export function curveBow(dist, kind, theme) {
  const spacing = theme.staffLineSpacing;
  return Math.max(0.9 * spacing, Math.min(2.6 * spacing, dist * (kind === 'tie' ? 0.16 : 0.24)));
}

/**
 * Outer edge of a tie/slur as renderCurve draws it (same arguments): the
 * cubic Bézier `[[x1, y1], [c1x, outerY1], [c2x, outerY2], [x2, y2]]`
 * bowing `curveBow` past its ends, on the `above` side.
 */
export function curveOuterPoints(x1, y1, x2, y2, above, theme, kind) {
  const dx = x2 - x1;
  const bow = curveBow(Math.abs(dx), kind, theme);
  const dir = above ? -1 : 1;
  return [[x1, y1], [x1 + dx * 0.28, y1 + dir * bow], [x1 + dx * 0.72, y2 + dir * bow], [x2, y2]];
}

/**
 * Draw a tie/slur between two {x,y} points of the same staff group as a tapered, lens-shaped fill — thin (pointed) at each end and
 * thickest at the midpoint — the way engraved ties/slurs actually look,
 * rather than a single even-width stroke.
 */
export function renderCurve(g, x1, y1, x2, y2, above, theme, kind) {
  const dx = x2 - x1;
  const dist = Math.abs(dx);
  const isTie = kind === 'tie';
  const spacing = theme.staffLineSpacing;
  const bow = curveBow(dist, kind, theme);
  const thickness = Math.max(0.14 * spacing, Math.min(0.32 * spacing, dist * 0.03));
  const dir = above ? -1 : 1;

  const [, [c1x, outerY1], [c2x, outerY2]] = curveOuterPoints(x1, y1, x2, y2, above, theme, kind);
  const innerY1 = y1 + dir * (bow - thickness);
  const innerY2 = y2 + dir * (bow - thickness);

  const d = svgD`M ${x1} ${y1} `
    + svgD`C ${c1x} ${outerY1}, ${c2x} ${outerY2}, ${x2} ${y2} `
    + svgD`C ${c2x} ${innerY2}, ${c1x} ${innerY1}, ${x1} ${y1} Z`;
  g.appendChild(path(d, {
    class: kind === 'tie' ? 'tie' : 'slur',
    fill: kind === 'tie' ? theme.tieColor : theme.slurColor,
    stroke: 'none',
  }));
}

/** Font size (px) of dynamic glyphs. */
export const dynamicFontSizePx = (theme) => theme.dynamicFontSize + DYNAMIC_SIZE_EXTRA_SP * theme.staffLineSpacing;

/**
 * Draw a dynamic mark below the staff, centred on `x`, on baseline `y`
 * (local; resolved by the score-wide pass in passes/chordsFermatas.js to one baseline per
 * system's staff, clear of everything below it).
 */
export function renderDynamic(g, x, y, mark, theme) {
  g.appendChild(glyphText(x, y, dynamicGlyph(mark), theme.fontFamily, dynamicFontSizePx(theme), {
    class: 'dynamic', fill: theme.dynamicColor, 'text-anchor': 'middle', 'font-style': 'italic',
  }));
}
