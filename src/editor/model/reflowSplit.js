/**
 * model/reflowSplit.js — splitting a beat that crosses the barline (2.3.1
 * Reflow) into tied pieces of plain durations.
 *
 * plainRun(o, end) is the fill rule (fill.js fillPlan): from onset `o` to
 * `end`, at each onset the largest plain duration (whole … 64th, no dots,
 * no tuplets) that fits and that the onset is a multiple of; null when no
 * such duration fits somewhere.
 *
 * splitBeat(beat, durations) is one piece per duration. Fields go by table:
 * BEAT_EVERY and NOTE_EVERY on every piece, NOTE_LAST on the last piece
 * only, BEAT_DROP rebuilt per piece (`dots` dropped), everything else
 * (tieEnd, slideIn, bend, tempo, text, dynamic, articulations, chord
 * diagrams, hairpins, unknown fields) on the first piece only. On a note
 * beat every note of the chord is tied from each piece to the next (a
 * piece but the last gets `tieStart`, a piece but the first `tieEnd`); a
 * rest gets no notes and no ties.
 */
import { R, add, sub, cmp } from '../../rational.js';
import { DURATIONS } from './durations.js';
import { isObj } from './access.js';

/** Beat fields every piece keeps. */
export const BEAT_EVERY = Object.freeze(['type', 'palmMute', 'letRing', 'vibrato', 'hidden', 'slash']);
/** Beat fields rebuilt per piece. */
export const BEAT_DROP = Object.freeze(['duration', 'dots', 'notes']);
/** Note fields every piece keeps. */
export const NOTE_EVERY = Object.freeze(['string', 'fret', 'pitch', 'harmonicFret', 'mute', 'ghost', 'harmonic']);
/** Note fields only the last piece keeps. */
export const NOTE_LAST = Object.freeze(['tieStart', 'hammerPull', 'slide', 'slideOut']);

/** The plain durations from onset `o` to `end` by the fill rule, or null when none fits somewhere. */
export function plainRun(o, end) {
  const out = [];
  let t = o;
  while (cmp(t, end) < 0) {
    const gap = sub(end, t);
    const k = DURATIONS.findIndex((_, i) => cmp(R(1, 2 ** i), gap) <= 0 && (t.n * 2 ** i) % t.d === 0);
    if (k < 0) return null;
    out.push(DURATIONS[k]);
    t = add(t, R(1, 2 ** k));
  }
  return out;
}

/** The fields of `obj` piece `i` of `n` keeps: `every` on all, `last` on the last, the rest on the first. */
function pick(obj, i, n, every, last) {
  const out = {};
  for (const k of Object.keys(obj)) {
    if (every.includes(k) || (last.includes(k) ? i === n - 1 : i === 0)) out[k] = obj[k];
  }
  return out;
}

/** Note `note` as it is on piece `i` of `n` (tied on to the next piece, from the previous one). */
function notePiece(note, i, n) {
  if (!isObj(note)) return note;
  const out = pick(note, i, n, NOTE_EVERY, NOTE_LAST);
  if (i < n - 1) out.tieStart = true;
  if (i > 0) out.tieEnd = true;
  return out;
}

/** `beat` split into one piece per duration of `durations` (see the header). */
export function splitBeat(beat, durations) {
  const n = durations.length;
  const rest = beat.type === 'rest';
  return durations.map((duration, i) => {
    const out = {};
    for (const k of Object.keys(beat)) {
      if (k === 'duration') out.duration = duration;
      else if (k === 'notes') { if (!rest && Array.isArray(beat.notes)) out.notes = beat.notes.map((x) => notePiece(x, i, n)); }
      else if (!BEAT_DROP.includes(k) && (BEAT_EVERY.includes(k) || i === 0)) out[k] = beat[k];
    }
    if (!('duration' in out)) out.duration = duration;
    return out;
  });
}
