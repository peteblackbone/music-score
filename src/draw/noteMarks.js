/**
 * draw/noteMarks.js — marks attached to a single notation beat:
 * articulations, tremolo-picking strokes and vibrato waves, plus the
 * beat's top/bottom extent (elementTop / elementBottom) they stack on.
 */
import { line, group, glyphText, path, wavyPathD } from './svgUtil.js';
import { Glyph } from '../glyphs.js';
import { staffPositionToY } from '../pitch.js';
import { smuflFontSizePx } from '../theme.js';
import { stemUpFor } from '../layout/timeline.js';
import { tremoloStrokes } from '../noteEffects.js';

// Articulations stack outward from the notehead in this fixed order,
// regardless of the order the author listed them in: staccatissimo or
// staccato, then tenuto, then marcato or accent (normalizeArticulations).
const ARTIC_GLYPHS = {
  staccato: { above: Glyph.articStaccatoAbove, below: Glyph.articStaccatoBelow },
  staccatissimo: { above: Glyph.articStaccatissimoAbove, below: Glyph.articStaccatissimoBelow },
  tenuto: { above: Glyph.articTenutoAbove, below: Glyph.articTenutoBelow },
  accent: { above: Glyph.articAccentAbove, below: Glyph.articAccentBelow },
  marcato: { above: Glyph.articMarcatoAbove, below: Glyph.articMarcatoBelow },
};
// Bravura draws each articulation with its origin on the edge nearest the
// staff, so shifting by half the glyph's height (in staff spaces) centres
// it on its target staff position (staccatissimo and marcato: half the
// measured glyphMetrics.js heights).
const ARTIC_HALF_HEIGHT_SP = { staccato: 0.17, staccatissimo: 0.59, tenuto: 0.08, accent: 0.37, marcato: 0.5 };

// Vibrato wave per kind (noteEffects.js vibratoOf): amplitude and wavelength
// in sp, stroke width in px. A wide wave also sits VIB_WIDE_LIFT_SP higher.
const VIB = {
  normal: { amp: 0.2, wave: 0.7, stroke: 1.2 },
  wide: { amp: 0.35, wave: 1.0, stroke: 1.6 },
};
const VIB_WIDE_LIFT_SP = 0.15;

/**
 * How far (sp) above a vibrato beat's top a mark above it must stay
 * (beatClearTop): 0.7 sp above the wave's top control point for either kind.
 */
export function vibratoClearSp(kind) {
  return kind === 'wide' ? 2.3 : 2;
}

/**
 * Vertical offsets (in stroke gaps) of `n` tremolo strokes, centred on 0:
 * n = 3 gives -1, 0, 1; n = 2 gives -0.5, 0.5; n = 1 gives 0.
 */
export function strokeOffsets(n) {
  return Array.from({ length: n }, (_, i) => i - (n - 1) / 2);
}

/**
 * Draw tremolo-picking marks: short parallel diagonal strokes (three by
 * default) crossing the note's stem (or, for a stemless whole note, hanging just
 * above its topmost notehead) — the standard way to mark a single
 * sustained note as rapidly alternate-picked rather than struck once.
 * `info` is the object `renderNotationElement`/`renderBeams` returned for
 * this note, so the marks land on its *final* stem geometry (beamed notes
 * only know their real stem length after `renderBeams` runs). `below`
 * (voice 2): a whole note's marks hang below its lowest notehead instead.
 * `speed` (noteEffects.js tremoloOf): '8th' | '16th' | '32nd' draws 1 / 2 / 3
 * strokes centred where the three would be and adds the class
 * `tremolo-<speed>`; true draws the plain three.
 */
export function renderTremolo(g, info, theme, { below = false, speed = true } = {}) {
  const gEl = group({ class: typeof speed === 'string' ? `tremolo tremolo-${speed}` : 'tremolo' });
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
  } else if (below) {
    const bottomY = Math.max(info.articBottomY ?? -Infinity, ...(info.noteheads || []).map((n) => n.y));
    cx = info.x;
    midY = bottomY + 1.3 * spacing;
  } else {
    // No stem (whole note) — hang the marks just above the topmost notehead
    // (or its articulations, if it has any above).
    const topY = Math.min(info.articTopY ?? Infinity, ...(info.noteheads || []).map((n) => n.y));
    cx = info.x;
    midY = topY - 1.3 * spacing;
  }

  for (const k of strokeOffsets(tremoloStrokes(speed))) {
    const cy = midY + k * gap;
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
 * `kind` (noteEffects.js vibratoOf): 'wide' draws a taller, longer, heavier
 * wave (class `vibrato vibrato-wide`) lifted VIB_WIDE_LIFT_SP; true the
 * normal one.
 */
export function renderVibrato(g, info, width, theme, kind = true) {
  const wide = kind === 'wide';
  const v = wide ? VIB.wide : VIB.normal;
  const gEl = group({ class: wide ? 'vibrato vibrato-wide' : 'vibrato' });
  const color = theme.noteColor;
  const spacing = theme.staffLineSpacing;
  const y = elementTop(info) - spacing * 1.1 - (wide ? VIB_WIDE_LIFT_SP * spacing : 0);
  const x1 = info.x + 0.5 * spacing;
  const x2 = x1 + Math.max(1.4 * spacing, Math.min(3.4 * spacing, (width ?? 2.8 * spacing) - 0.8 * spacing));
  gEl.appendChild(path(wavyPathD(x1, x2, y, v.amp * spacing, v.wave * spacing), {
    fill: 'none', stroke: color, 'stroke-width': v.stroke, 'stroke-linecap': 'round',
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
 * in stacking order (nearest the notehead first): staccatissimo (beats
 * staccato) or staccato, then tenuto, then marcato (alias 'heavyAccent';
 * beats accent) or accent. Names match exactly; unknown names, duplicates
 * and non-array values are silently dropped.
 */
export function normalizeArticulations(raw) {
  if (!Array.isArray(raw)) return [];
  const has = (name) => raw.includes(name);
  const inner = has('staccatissimo') ? 'staccatissimo' : has('staccato') ? 'staccato' : null;
  const mid = has('tenuto') ? 'tenuto' : null;
  const outer = has('marcato') || has('heavyAccent') ? 'marcato' : has('accent') ? 'accent' : null;
  return [inner, mid, outer].filter(Boolean);
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
 *
 * In a two-voice measure (`voice` 1 | 2) the marks go on the stem side
 * instead (above voice 1, below voice 2): the first centred 1 sp beyond
 * the stem tip or outer beam (a whole note: beyond its outer notehead),
 * rounded outward to a space inside the staff.
 */
export function renderArticulations(g, info, marks, baselineY, theme, voice) {
  if (!marks.length || !(info.noteheads || []).length) return;
  const spacing = theme.staffLineSpacing;
  const fontSize = smuflFontSizePx(theme);
  let above;
  let pos;
  if (voice) {
    above = voice === 1;
    const d = above ? 1 : -1;
    const tipY = above ? info.stemTopY : info.stemBottomY;
    if (tipY == null) {
      const n = above ? info.maxPos : info.minPos;
      pos = n + d * (Math.abs(n) % 2 === 1 ? 2 : 3);
    } else {
      pos = (baselineY - tipY) / (spacing / 2) + d * 2;
      if (pos >= 0 && pos <= 8) pos = above ? 2 * Math.ceil((pos - 1) / 2) + 1 : 2 * Math.floor((pos - 1) / 2) + 1;
    }
  } else {
    const stemUp = info.duration === 'whole' ? stemUpFor([info.minPos, info.maxPos]) : info.stemUp;
    above = !stemUp;
    const n = stemUp ? info.minPos : info.maxPos;
    pos = n + (stemUp ? -1 : 1) * (Math.abs(n) % 2 === 1 ? 2 : 3);
  }
  const side = above ? 'above' : 'below';
  const dir = above ? 1 : -1; // staff-position direction away from the notehead

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
  if (above) info.articTopY = edgeY;
  else info.articBottomY = edgeY;
}
