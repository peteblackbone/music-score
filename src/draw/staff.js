/**
 * draw/staff.js — staff lines, clef, key signature, time signature and
 * barlines for the standard-notation staff.
 */
import { line, group, glyphText, circle } from './svgUtil.js';
import { accidentalGlyph, timeSigDigits, clefGlyph } from '../glyphs.js';
import { keySignatureLayout, staffPositionToY } from '../pitch.js';
import { smuflFontSizePx } from '../theme.js';
import { KEY_STEP_SP, keySignatureWidthSp } from '../layout/systems.js';

/** Draw the 5 staff lines from x to endX, baseline y = bottom line. */
export function drawStaffLines(x, endX, baselineY, theme) {
  const g = group({ class: 'staff-lines' });
  for (let i = 0; i < 5; i++) {
    const y = baselineY + staffPositionToY(i * 2, theme.staffLineSpacing);
    g.appendChild(line(x, y, endX, y, {
      stroke: theme.staffLineColor,
      'stroke-width': theme.staffLineWidth,
    }));
  }
  return g;
}

/**
 * Clef at x (left edge). `octave`: draw the 8vb variant (gClef8vb U+E052 /
 * fClef8vb U+E064) used for guitar music written an octave above sounding
 * pitch; it has the same anchor as the plain clef.
 */
export function drawClef(x, baselineY, clef, octave, theme) {
  const fontSize = smuflFontSizePx(theme);
  const glyph = clefGlyph(clef, octave);
  // Bravura's clef glyphs are designed so the glyph baseline sits on the
  // staff line the clef "wraps": G4 (2nd line, position 2) for treble,
  // F3 (4th line, position 6) for bass.
  const anchorPos = clef === 'bass' ? 6 : 2;
  const y = baselineY + staffPositionToY(anchorPos, theme.staffLineSpacing);
  return glyphText(x, y, glyph, theme.fontFamily, fontSize, { fill: theme.noteColor });
}

/**
 * Key signature `keySig` (−7..7) at x (left edge of the first accidental),
 * accidentals KEY_STEP_SP apart. Changing to key 0 from `fromKey` draws
 * cancelling naturals in the old key's positions instead (ui.md §3).
 * Returns `{ node, width }` (width in px of the drawn accidentals).
 */
export function drawKeySignature(x, baselineY, keySig, clef, theme, fromKey = 0) {
  const fontSize = smuflFontSizePx(theme);
  const g = group({ class: 'key-signature' });
  const cancel = !keySig && fromKey;
  const layout = keySignatureLayout(cancel ? fromKey : keySig, clef);
  let cx = x;
  for (const item of layout) {
    const glyph = accidentalGlyph(cancel ? 'natural' : item.alter > 0 ? 'sharp' : 'flat');
    const y = baselineY + staffPositionToY(item.position, theme.staffLineSpacing);
    g.appendChild(glyphText(cx, y, glyph, theme.fontFamily, fontSize, { fill: theme.noteColor }));
    cx += KEY_STEP_SP * theme.staffLineSpacing;
  }
  return { node: g, width: keySignatureWidthSp(keySig, fromKey) * theme.staffLineSpacing };
}

export function drawTimeSignature(x, baselineY, timeSignature, theme) {
  const fontSize = smuflFontSizePx(theme);
  const g = group({ class: 'time-signature' });
  const numY = baselineY + staffPositionToY(6, theme.staffLineSpacing);
  const denY = baselineY + staffPositionToY(2, theme.staffLineSpacing);
  g.appendChild(glyphText(x, numY, timeSigDigits(timeSignature.beats), theme.fontFamily, fontSize, { fill: theme.noteColor }));
  g.appendChild(glyphText(x, denY, timeSigDigits(timeSignature.beatType), theme.fontFamily, fontSize, { fill: theme.noteColor }));
  return g;
}

// Barline weights and spacing (ui.md §6), in sp; the thin line is theme.staffLineWidth.
const THICK_SP = 0.5;
const BARLINE_SEPARATION_SP = 0.4;  // edge to edge, thin <-> thick / thin <-> thin
const REPEAT_DOT_GAP_SP = 0.4;      // thin line edge -> repeat dot edge
const REPEAT_DOT_RADIUS_SP = 0.2;

/**
 * Staff spaces (1-based, counted from the top line) that hold repeat dots:
 * notation spaces 2 and 3; on a tab staff the two spaces either side of
 * the centre, skipping the middle space when the space count is odd
 * (6 strings: 2 & 4; 4: 1 & 3; 5: 2 & 3; 7: 3 & 4).
 */
export function repeatDotSpaces(staff) {
  if (staff.kind !== 'tab') return [2, 3];
  const spaces = staff.lines - 1;
  if (spaces < 2) return [];
  if (spaces % 2 === 1) { const mid = (spaces + 1) / 2; return [mid - 1, mid + 1]; }
  return [spaces / 2, spaces / 2 + 1];
}

/**
 * Barline of one staff, spanning only its own lines (top line y = 0 to
 * `staff.lineBottom`). `type`: single | double | final | repeatEnd (closing
 * barlines: `x` is the measure end, the barline's right edge is flush with
 * it), repeatStart (opening: `x` is its left edge; thick, thin, dots) or
 * repeatEndStart (opening, replacing the previous measure's repeatEnd:
 * dots, thin, thick, thin, dots).
 * `staff`: `{ kind: 'notation'|'tab', lines, lineSpacing, lineBottom }`.
 */
export function drawStaffBarline(x, staff, type, theme) {
  const g = group({ class: 'barline' });
  const stroke = theme.staffLineColor;
  const s = theme.staffLineSpacing;
  const thin = theme.staffLineWidth;
  const thick = THICK_SP * s;
  const sep = BARLINE_SEPARATION_SP * s;
  const top = 0;
  const bottom = staff.lineBottom;
  const vline = (cx, w) => g.appendChild(line(cx, top, cx, bottom, { stroke, 'stroke-width': w }));
  const dots = (cx) => {
    const r = REPEAT_DOT_RADIUS_SP * s;
    repeatDotSpaces(staff).forEach((k) => {
      g.appendChild(circle(cx, (k - 0.5) * staff.lineSpacing, r, { fill: stroke }));
    });
  };
  const r = REPEAT_DOT_RADIUS_SP * s;
  if (type === 'final' || type === 'repeatEnd') {
    vline(x - thick / 2, thick);
    const thinX = x - thick - sep - thin / 2;
    vline(thinX, thin);
    if (type === 'repeatEnd') dots(thinX - thin / 2 - REPEAT_DOT_GAP_SP * s - r);
  } else if (type === 'double') {
    vline(x - thin / 2, thin);
    vline(x - thin - sep - thin / 2, thin);
  } else if (type === 'repeatStart') {
    vline(x + thick / 2, thick);
    const thinX = x + thick + sep + thin / 2;
    vline(thinX, thin);
    dots(thinX + thin / 2 + REPEAT_DOT_GAP_SP * s + r);
  } else if (type === 'repeatEndStart') {
    // Combined end-start repeat (opening: `x` is its left edge): dots, thin, thick, thin, dots.
    dots(x + r);
    const thin1X = x + 2 * r + REPEAT_DOT_GAP_SP * s + thin / 2;
    vline(thin1X, thin);
    const thickX = thin1X + thin / 2 + sep + thick / 2;
    vline(thickX, thick);
    const thin2X = thickX + thick / 2 + sep + thin / 2;
    vline(thin2X, thin);
    dots(thin2X + thin / 2 + REPEAT_DOT_GAP_SP * s + r);
  } else {
    vline(x - thin / 2, thin);
  }
  return g;
}
