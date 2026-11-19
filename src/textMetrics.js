/**
 * textMetrics.js — deterministic text-width estimate for layout (instrument
 * name indents, title, fret-number knock-outs), since the renderer cannot
 * measure text before drawing it (and the test DOM has no getBBox).
 * Per-character em widths for a serif text font; approximate by design.
 */

import { isNaturalHarmonic, touchFret } from './harmonics.js';
import { bendOf } from './directions.js';

const NARROW =new Set("il.,:;'!|()[]");
const WIDE = new Set('MWmw');

function charEm(ch) {
  if (ch === ' ') return 0.25;
  if (NARROW.has(ch)) return 0.28;
  if (WIDE.has(ch)) return 0.85;
  if (ch >= '0' && ch <= '9') return 0.5;
  if (ch >= 'a' && ch <= 'z') return 0.48;
  if (ch >= 'A' && ch <= 'Z') return 0.68;
  return 0.55;
}

/**
 * Estimated advance width in px of `str` set at `fontSizePx`.
 * `opts.bold` widens by 6%.
 */
export function estimateTextWidth(str, fontSizePx, opts = {}) {
  let em = 0;
  for (const ch of String(str ?? '')) em += charEm(ch);
  return em * fontSizePx * (opts.bold ? 1.06 : 1);
}

/**
 * Text shown on the tab staff for a note: the fret number, "x" for a
 * dead/muted note, "<12>" for a natural harmonic, "5(17)" for an
 * artificial/tapped harmonic with a touched fret, wrapped in parentheses
 * for a ghost note and a release note (`bend` of type 'release') and, with
 * `opts.tiedParens` (tiedFretOpts), a tied-to note (`tieEnd`); never twice.
 */
export function fretLabel(note, opts = {}) {
  if (note.mute) return note.ghost ? '(x)' : 'x';
  const tf = touchFret(note);
  const core = isNaturalHarmonic(note) ? `<${note.fret}>` : (tf != null ? `${note.fret}(${tf})` : String(note.fret));
  const paren = note.ghost || bendOf(note.bend)?.type === 'release' || (opts?.tiedParens && note.tieEnd);
  return paren ? `(${core})` : core;
}

/** Canonical `track.tiedFrets`: 'parens' (any case, trimmed) or null. */
export function tiedFretsMode(raw) {
  return typeof raw === 'string' && raw.trim().toLowerCase() === 'parens' ? 'parens' : null;
}

const TIED_PARENS = Object.freeze({ tiedParens: true });

/**
 * fretLabel options for beat `el` of `track` (normalized): tied-to frets in
 * parentheses when the track opts in (`tiedFrets: 'parens'`), main notes
 * only; undefined otherwise. Every caller that measures or draws a label
 * passes the same options.
 */
export function tiedFretOpts(track, el) {
  return track.tiedFrets === 'parens' && el.type !== 'grace' ? TIED_PARENS : undefined;
}

/** Width in px of a fret label's knock-out (estimated text width + 0.15 sp each side). */
export function fretLabelWidth(label, theme) {
  return estimateTextWidth(label, theme.tabFontSize) + 0.3 * theme.staffLineSpacing;
}
