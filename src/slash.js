/**
 * slash.js — rhythm slashes (1.11): `beat.slash === true` on a voice-1 note
 * beat shows only its rhythm — one slash head on the middle line of the
 * notation staff (stems up unless two voices, flags / beams / dots /
 * tuplets as usual; no accidentals, ledger lines, chords, ottava or ties)
 * and a slash head over a backing on TAB instead of frets. Its notes are
 * dropped (normalize.js, only when the beat has a `slash` key); beat-level
 * marks still draw. `slash` on rests, graces and voice-2 beats is ignored.
 */
import { Glyph } from './glyphs.js';
import { glyphBox } from './glyphMetrics.js';
import { isHiddenRest } from './duration.js';

/** Staff position of a slash head (the middle line). */
export const SLASH_POSITION = 4;
/** Stand-in note for the chord layout of a slash beat (no pitch, no marks). */
export const SLASH_HEAD = Object.freeze({});
/** Backing pad (sp) around a TAB slash head. */
export const TAB_SLASH_PAD_SP = 0.2;

/** Whether a normalized beat is drawn as a rhythm slash. */
export function isSlashBeat(el) {
  return !!el && el.type === 'note' && el.slash === true;
}

/**
 * Normalized beat `b` (it has a `slash` key): a voice-1 visible note beat
 * with `slash: true` keeps the flag and loses its notes; any other gets
 * `slash: false`.
 */
export function withSlash(b, voice1) {
  if (voice1 && b.type === 'note' && !isHiddenRest(b) && b.slash === true) return { ...b, slash: true, notes: [] };
  return { ...b, slash: false };
}

/** Slash notehead for a duration: whole, half (white) or the filled slash for shorter values. */
export function slashHeadGlyph(duration) {
  if (duration === 'whole') return Glyph.noteheadSlashWhiteWhole;
  if (duration === 'half') return Glyph.noteheadSlashWhiteHalf;
  return Glyph.noteheadSlashHorizontalEnds;
}

/** Half width (px) a TAB slash head (with its backing) takes either side of its column. */
export function tabSlashHalf(el, theme) {
  return (glyphBox(slashHeadGlyph(el.duration)).width / 2 + TAB_SLASH_PAD_SP) * theme.staffLineSpacing;
}
