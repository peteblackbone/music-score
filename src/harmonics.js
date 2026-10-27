/**
 * harmonics.js — guitar harmonics (`note.harmonic`), one place for the
 * questions normalize, layout and drawing ask about them:
 *
 * - kind: 'natural' | 'artificial' | 'pinch' | 'tapped' | 'semi'
 *   (`true` or an unknown string → 'natural'); a muted note is never a
 *   harmonic (mute wins);
 * - natural → diamond notehead at the written (touch) pitch and "<12>" on
 *   the TAB staff, no text label;
 * - artificial / tapped → normal notehead, "5(17)" on the TAB staff when an
 *   integer `harmonicFret` (the touched fret) is given, label "A.H." / "T.H.";
 * - pinch / semi → normal notehead, plain fret, label "P.H." / "S.H.".
 *
 * Pure functions, no DOM.
 */
import { noteheadForDuration, diamondNoteheadForDuration } from './glyphs.js';

/** Technique label per harmonic kind (natural has none). */
export const HARMONIC_LABELS = { artificial: 'A.H.', tapped: 'T.H.', pinch: 'P.H.', semi: 'S.H.' };
const KINDS = ['natural', 'artificial', 'pinch', 'tapped', 'semi'];
// One label per beat: the first of these among the beat's (non-muted) harmonics.
const LABEL_PRIORITY = ['artificial', 'tapped', 'pinch', 'semi'];

/** Canonical kind of a raw `harmonic` value, or null (falsy). Idempotent. */
export function harmonicKind(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') {
    const k = raw.trim().toLowerCase();
    return KINDS.includes(k) ? k : 'natural';
  }
  return 'natural';
}

/** Harmonic kind of a note, or null (none, or muted). */
export function harmonicOf(note) {
  return note.mute ? null : harmonicKind(note.harmonic);
}

/** Whether `note` is a natural harmonic (muted notes never are). */
export function isNaturalHarmonic(note) { return harmonicOf(note) === 'natural'; }

/** Touched fret of an artificial/tapped harmonic (integer `harmonicFret`), else null. */
export function touchFret(note) {
  const kind = harmonicOf(note);
  return Number.isInteger(note.harmonicFret) && (kind === 'artificial' || kind === 'tapped')
    ? note.harmonicFret : null;
}

/** Whether the TAB fret label is decorated ("<12>" or "5(17)"). */
export function decoratesFretLabel(note) {
  return harmonicOf(note) === 'natural' || touchFret(note) != null;
}

/** Notehead glyph used for layout of `note` at `duration` (diamond for a natural harmonic). */
export function layoutHeadGlyph(note, duration) {
  return isNaturalHarmonic(note) ? diamondNoteheadForDuration(duration) : noteheadForDuration(duration);
}

/** Label kind of a beat's notes (first of A.H. > T.H. > P.H. > S.H.), or null. */
export function beatHarmonicLabelKind(notes) {
  const kinds = new Set(notes.map(harmonicOf));
  return LABEL_PRIORITY.find((k) => kinds.has(k)) ?? null;
}
