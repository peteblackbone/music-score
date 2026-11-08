/**
 * draw/notation.js — noteheads, stems, flags, beams, rests, accidentals,
 * ties, slurs and dynamics for the standard-notation staff.
 */
import { line, group, glyphText, path, text, circle, svgD } from './svgUtil.js';
import {
  Glyph, restForDuration, flagForDuration, accidentalGlyph, dynamicGlyph, pickStrokeGlyph,
} from '../glyphs.js';
import { layoutHeadGlyph } from '../harmonics.js';
import { staffPosition, staffPositionToY } from '../pitch.js';
import { smuflFontSizePx } from '../theme.js';
import { beamCount } from '../duration.js';
import {
  stemDxSp, stemDySp, dotPosition, DOT_GAP_SP, DOT_STEP_SP, DOT_RADIUS_SP,
  graceAccidentalRight, GRACE_STEM_DX_SP, GRACE_SLASH_DX_SP,
  GHOST_PAREN_DX_SP, GHOST_PAREN_SIZE_SP, GHOST_PAREN_BASELINE,
} from '../layout/chord.js';
import { stemUpFor } from '../layout/timeline.js';
import { glyphBox } from '../glyphMetrics.js';
import { REST_LEDGER_OVERHANG_SP } from '../layout/voices.js';
import { voiceOf } from '../twoVoice.js';
export { normalizeArticulations, renderArticulations, renderTremolo, renderVibrato, elementTop, elementBottom } from './noteMarks.js';

const STEM_LENGTH_SPACES = 3.5;
const REST_POSITION = { whole: 6, half: 4, quarter: 4, '8th': 4, '16th': 4, '32nd': 4, '64th': 4 };

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
    // A voice-2 rest merged with voice 1's (layout/voices.js) is drawn once, by voice 1.
    if (el.hidden || (layoutEl.restMerged && voiceOf(layoutEl) === 2)) return { isRest: true, hidden: true, x, noteheads: [] };
    if (opts.wholeMeasureRest) {
      renderWholeMeasureRest(g, x, layoutEl.baselineY, theme, layoutEl.restPos ?? 6);
      return { isRest: true, x, noteheads: [] };
    }
    // Two-voice measures place rests per voice (layout/voices.js), with a ledger line outside the staff.
    const pos = layoutEl.restPos ?? REST_POSITION[el.duration] ?? 4;
    const glyph = restForDuration(el.duration);
    const y = layoutEl.baselineY + staffPositionToY(pos, spacing);
    if (layoutEl.restLedger != null) {
      const half = (glyphBox(glyph).width / 2 + REST_LEDGER_OVERHANG_SP) * spacing;
      drawLedgerLines(g, x - half, x + half, layoutEl.restLedger, layoutEl.restLedger, layoutEl.baselineY, theme, true);
    }
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
 * line (pos 6; a two-voice measure passes its voice's line), centred on `x`
 * (the layout centres it between the measure's barlines), whatever the meter.
 */
export function renderWholeMeasureRest(g, x, baselineY, theme, pos = 6) {
  const y = baselineY + staffPositionToY(pos, theme.staffLineSpacing);
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
 * Accidentals (`layoutEl.accidentals`, decided by the layout like any
 * other note's) sit left of the head (or of a stem-down slash) at grace
 * size, graceAccidentalRight; the layout leaves room for them
 * (graceAccidentalRoom).
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
  // Two-voice measures: voice 1's graces stem up, voice 2's down.
  const stemUp = voiceOf(layoutEl) ? voiceOf(layoutEl) === 1 : stemUpFor(positions);

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
    const acc = layoutEl.accidentals?.[i];
    if (acc) {
      const glyph = accidentalGlyph(acc);
      const right = x + graceAccidentalRight(glyphBox(headGlyph).width, stemUp, theme) * spacing;
      g.appendChild(glyphText(right - glyphBox(glyph).width * spacing * scale, y, glyph, theme.fontFamily, fontSize, {
        fill: theme.noteColor,
      }));
    }
    noteheads.push({ pitch: note.pitch, x, y, position: pos, halfWidth: (glyphBox(headGlyph).width / 2) * spacing * scale });
  });

  const extremePos = stemUp ? maxPos : minPos;
  const noteY = layoutEl.baselineY + staffPositionToY(extremePos, spacing);
  const stemAttachX = x + (stemUp ? GRACE_STEM_DX_SP : -GRACE_STEM_DX_SP) * spacing;
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
  const slashDx = GRACE_SLASH_DX_SP * spacing;
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

/** Ledger lines from x1 to x2 for every ledger position the chord range `minPos..maxPos` needs (`only`: just the one at maxPos). */
function drawLedgerLines(g, x1, x2, minPos, maxPos, baselineY, theme, only = false) {
  const spacing = theme.staffLineSpacing;
  const ledger = (p) => {
    const y = baselineY + staffPositionToY(p, spacing);
    g.appendChild(line(x1, y, x2, y, { stroke: theme.staffLineColor, 'stroke-width': theme.staffLineWidth }));
  };
  if (only) { ledger(maxPos); return; }
  for (let p = 10; p <= maxPos; p += 2) ledger(p);
  for (let p = -2; p >= minPos; p -= 2) ledger(p);
}

const MAX_BEAM_HALF_RISE_SPACES = 1.25; // clamps how steep a beam is allowed to slope
const MIN_STEM_SPACES = 2.5;             // no beamed note gets a stem shorter than this

/**
 * Draw beams for groups of >=2 eligible notes; for groups of length 1 the
 * individual flag glyph (already drawn in renderNotationElement) stands.
 * `rendered` maps element index -> info returned by renderNotationElement.
 * `forcedStemUp` (two-voice measures) overrides the group's direction.
 *
 * Every note in a beam group shares one stem direction and one straight
 * beam line: the line's natural slope follows the first/last notehead,
 * clamped so it never gets too steep, and then nudged further from the
 * noteheads if needed so no note in between ends up with a too-short
 * stem. Stems for beamed notes are drawn here (not in
 * renderNotationElement) because they can't be finalized until this
 * shared line is known.
 */
export function renderBeams(g, measureLayout, rendered, theme, baselineY, forcedStemUp) {
  const spacing = theme.staffLineSpacing;
  for (const beamGroup of measureLayout.beamGroups) {
    if (beamGroup.length < 2) continue;
    const infos = beamGroup.map((idx) => rendered[idx]).filter(Boolean);
    if (infos.length < 2) continue;

    // One shared stem direction for the whole group, based on its overall pitch range.
    const overallMin = Math.min(...infos.map((i) => i.minPos));
    const overallMax = Math.max(...infos.map((i) => i.maxPos));
    const stemUp = forcedStemUp ?? stemUpFor([overallMin, overallMax]);
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

const FERMATA_GLYPHS = { normal: Glyph.fermataAbove, short: Glyph.fermataShortAbove, long: Glyph.fermataLongAbove };

/** Glyph of a fermata kind (noteEffects.js fermataOf): 'normal' | 'short' | 'long'. */
export function fermataGlyph(kind) {
  return FERMATA_GLYPHS[kind];
}

/**
 * Draw a fermata above a beat, centred on `x` with its bottom edge at
 * `bottomY` (already resolved by the caller to clear everything else
 * drawn above that beat). `kind` 'short' / 'long' draws the short / long
 * fermata in `<g class="fermata fermata-<kind>">`; 'normal' the usual one
 * in `<g class="fermata">`.
 */
export function renderFermata(g, x, bottomY, theme, kind = 'normal') {
  const gEl = group({ class: kind === 'normal' ? 'fermata' : `fermata fermata-${kind}` });
  // Each fermata glyph's origin already sits on its bottom edge.
  gEl.appendChild(glyphText(x, bottomY, fermataGlyph(kind), theme.fontFamily, smuflFontSizePx(theme), {
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

/** A slide-in / slide-out line on the notation staff, (x1, y1) → (x2, y2), in a group of class `cls`. */
export function renderNoteSlide(g, x1, y1, x2, y2, cls, theme) {
  g.appendChild(group({ class: cls }, [
    line(x1, y1, x2, y2, { stroke: theme.noteColor, 'stroke-width': 1.3, 'stroke-linecap': 'round' }),
  ]));
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
