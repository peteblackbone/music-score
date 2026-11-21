/**
 * scoreText.js — canonical forms of the score text fields (1.6.0) and the
 * capo / tuning chart helpers. Pure functions; the raw fields pass through
 * normalize.js untouched and are canonicalized here when drawing.
 *
 * Every canonicalizer is idempotent and returns null for anything that is
 * not a string, or is empty after trimming:
 * - text: trimmed, inner whitespace collapsed to one space;
 * - `measure.section`: 'Verse' or { letter, text } -> { letter | null, text | null }
 *   (letter kept only when 1-3 characters long; null when both are empty);
 * - `measure.repeatCount`: safe integer 2-99 (numeric strings count);
 * - `beat.text`: 'rit.' or { text, below } -> { text, below } (below only when `true`);
 * - `track.capo`: safe integer 1-30 (numeric strings count);
 * - `score.instructions` / `score.copyright`: split on line breaks, each
 *   line canonicalized, empty lines dropped, at most 8 lines.
 *
 * Tuning chart (`score.showTuningChart: true`): the strings whose pitch
 * differs from the reference tuning for the track's string count (every
 * string when there is no reference), highest string number first, as
 * "⑥ = D" (step and accidental as written, no octave).
 */
import { parsePitch, midiNumber } from './pitch.js';
import { clefAt, clefBase } from './clef.js';

/** Canonical text: trimmed, whitespace collapsed; null when not a string or empty. */
export function canonicalText(raw) {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().replace(/\s+/g, ' ');
  return t || null;
}

/** Canonical section `{ letter, text }` (each string | null), or null when both are empty. */
export function canonicalSection(raw) {
  if (typeof raw === 'string') {
    const text = canonicalText(raw);
    return text ? { letter: null, text } : null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  let letter = canonicalText(raw.letter);
  if (letter && [...letter].length > 3) letter = null;
  const text = canonicalText(raw.text);
  return letter || text ? { letter, text } : null;
}

/** A safe integer in [min, max] from a number or a trimmed all-digit string; else null. */
function boundedInteger(v, min, max) {
  let n = null;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string' && /^\d+$/.test(v.trim())) n = Number(v.trim());
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : null;
}

/** Canonical repeat count: 2-99, else null. */
export function canonicalRepeatCount(raw) {
  return boundedInteger(raw, 2, 99);
}

/** Canonical beat text `{ text, below }`, or null without text. */
export function canonicalBeatText(raw) {
  if (typeof raw === 'string') {
    const text = canonicalText(raw);
    return text ? { text, below: false } : null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const text = canonicalText(raw.text);
  return text ? { text, below: raw.below === true } : null;
}

/** Canonical capo fret: 1-30, else null. */
export function canonicalCapo(raw) {
  return boundedInteger(raw, 1, 30);
}

/** Canonical text lines (at most `max`, empty ones dropped), or null when there are none. */
export function canonicalLines(raw, max = 8) {
  if (typeof raw !== 'string') return null;
  const lines = raw.split(/\r?\n/).map(canonicalText).filter((l) => l != null).slice(0, max);
  return lines.length ? lines : null;
}

/** Reference tunings (low -> high) by string count; 'bass6' is the 6-string bass (bass clef). */
export const REFERENCE_TUNINGS = {
  4: ['E1', 'A1', 'D2', 'G2'],
  5: ['B0', 'E1', 'A1', 'D2', 'G2'],
  6: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'],
  bass6: ['B0', 'E1', 'A1', 'D2', 'G2', 'C3'],
  7: ['B1', 'E2', 'A2', 'D3', 'G3', 'B3', 'E4'],
  8: ['F#1', 'B1', 'E2', 'A2', 'D3', 'G3', 'B3', 'E4'],
};

/** Reference tuning for `n` strings (a bass-clef 6-string is a bass), or null when there is none. */
export function referenceTuning(n, clef) {
  if (n === 6 && clef === 'bass') return REFERENCE_TUNINGS.bass6;
  return REFERENCE_TUNINGS[n] ?? null;
}

/** String number label: ① - ⑩ (U+2460 - U+2469), "(11)" above. */
export function circledDigit(n) {
  return n >= 1 && n <= 10 ? String.fromCodePoint(0x245F + n) : `(${n})`;
}

const PITCH_RE = /^([A-Ga-g])(#{1,2}|b{1,2}|x)?(-?\d+)$/;

/** `{ name, midi }` of a tuning entry (name = step + accidental as written), or null when unparsable. */
function spell(p) {
  if (typeof p !== 'string') return null;
  const m = PITCH_RE.exec(p.trim());
  if (!m) return null;
  try {
    return { name: m[1].toUpperCase() + (m[2] || ''), midi: midiNumber(parsePitch(p)) };
  } catch {
    return null;
  }
}

const REFERENCE_MIDI = new Map(); // reference array -> its MIDI numbers
function referenceMidi(ref) {
  if (!REFERENCE_MIDI.has(ref)) REFERENCE_MIDI.set(ref, ref.map((p) => midiNumber(parsePitch(p))));
  return REFERENCE_MIDI.get(ref);
}

/** Tuning chart entries of a track ("⑥ = D", highest string number first; reference by the base of its first clef); [] when nothing differs. */
export function tuningChartEntries(track) {
  const tuning = track?.tuning;
  if (!Array.isArray(tuning)) return [];
  const n = tuning.length;
  const ref = referenceTuning(n, clefBase(clefAt(track, 0)));
  const refMidi = ref && referenceMidi(ref);
  const out = [];
  tuning.forEach((p, i) => {
    const sp = spell(p);
    if (!sp) return;
    if (refMidi && sp.midi === refMidi[i]) return;
    out.push(`${circledDigit(n - i)} = ${sp.name}`);
  });
  return out;
}

/**
 * Capo / tuning chart rows of a (normalized) score, one per visible track
 * with something to show: `{ name | null, capo: 'Capo fret N' | null, entries }`.
 * Tuning entries only when `score.showTuningChart === true`; the name only
 * when more than one track is visible (name -> label -> "Track N").
 */
export function capoTuningRows(score) {
  const tracks = score?.tracks || [];
  const visible = tracks.map((t, ti) => ({ t, ti })).filter(({ t }) => t && (t.showStandardNotation || t.showTablature));
  const rows = [];
  for (const { t, ti } of visible) {
    const fret = canonicalCapo(t.capo);
    const capo = fret != null ? `Capo fret ${fret}` : null;
    const entries = score.showTuningChart === true ? tuningChartEntries(t) : [];
    if (!capo && !entries.length) continue;
    const name = visible.length > 1 ? (canonicalText(t.name) ?? canonicalText(t.label) ?? `Track ${ti + 1}`) : null;
    rows.push({ name, capo, entries });
  }
  return rows;
}
