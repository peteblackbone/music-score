/**
 * model/stringMove.js — the 2.3.3 transpose fallback: a note whose fret
 * would leave 0..maxFret moves to another string that plays the same
 * pitch. Pure, DOM-free; the MIDI numbers come from a local helper with
 * the sanitize pitch rule (it equals pitch.js midiNumber(parsePitch(p)),
 * which the editor model may not import).
 */
import { stringCount, openPitch } from './access.js';

const PITCH_RE = /^([A-Ga-g])(#{1,2}|b{1,2}|x)?(-?\d+)$/;
const STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const ALTER = { '': 0, '#': 1, '##': 2, x: 2, b: -1, bb: -2 };

/** The MIDI number of pitch string `p` ('E4' → 64), or NaN when it is not a pitch. */
export function midiOf(p) {
  const m = typeof p === 'string' ? PITCH_RE.exec(p.trim()) : null;
  return m ? (parseInt(m[3], 10) + 1) * 12 + STEP[m[1].toUpperCase()] + ALTER[m[2] ?? ''] : NaN;
}

/** Whether note `n` is a harmonic (it never moves to another string). */
export const isHarmonic = (n) => !!n.harmonic || n.harmonicFret != null;

/**
 * Where each note of `movers` (notes of one beat of `track` whose fret
 * plus `semis` leaves 0..max) goes: `Map(note → { string, fret })`, or
 * null when any of them has nowhere to go. The strings of the beat's other
 * notes are taken; movers are placed in ascending order of their string,
 * each on the free string nearest its own whose fret for the same pitch is
 * in 0..max (then the lower fret, then the lower string), which it takes.
 */
export function placeMoves(track, beatNotes, movers, semis, max) {
  const taken = new Set(beatNotes.filter((n) => !movers.includes(n) && n.string != null).map((n) => n.string));
  const open = (s) => midiOf(openPitch(track, s));
  const count = stringCount(track);
  const out = new Map();
  for (const n of [...movers].sort((a, b) => a.string - b.string)) {
    const pitch = open(n.string) + n.fret + semis;
    let best = null;
    for (let t = 1; t <= count; t++) {
      const fret = pitch - open(t);
      if (t === n.string || taken.has(t) || !(fret >= 0 && fret <= max)) continue;
      const d = Math.abs(t - n.string);
      if (!best || d < best.d || (d === best.d && fret < best.fret)) best = { string: t, fret, d };
    }
    if (!best) return null;
    taken.add(best.string);
    out.set(n, { string: best.string, fret: best.fret });
  }
  return out;
}
