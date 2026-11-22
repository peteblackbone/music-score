/**
 * model/settings/tuning.js — tuning values and retuning a track.
 *
 * A tuning is 1 to 12 pitches, low to high, each a letter, an optional #
 * or b and an octave 0–9, written in canonical form ('Eb2', 'F#1').
 *
 * Retuning keeps every note's `string` and `fret`. Strings are counted from
 * the highest (string 1), so strings are added and removed at the low end:
 * - a note with both `fret` and `pitch` on a string whose open pitch
 *   changed loses `pitch` (the renderer then derives it from the fret);
 * - a note on a removed string is deleted from every beat array sanitize
 *   visits (`beats`, even beside `voices`, and every `voices[i].beats`,
 *   graces included); one with a valid `pitch` keeps it and loses only
 *   `string`, `fret` and its tie flags (its tie partner is on the same
 *   removed string, so no half tie is left);
 * - a beat left with no notes becomes a rest that keeps its other fields,
 *   except a voice-1 `slash: true` note beat (sanitize keeps those with
 *   `notes: []`); an emptied grace is dropped.
 * Everything is copy-on-write; pitch is never written.
 */
import { isValidPitch } from '../../../sanitize.js';
import { EDITOR_LIMITS } from '../limits.js';
import { STANDARD_TUNING } from '../defaultScore.js';
import { isObj, voicesOf, without } from '../access.js';

const PITCH = /^\s*([A-Ga-g])([#b]?)(\d)\s*$/;

/** The canonical copy of tuning `value`; TypeError / RangeError when it is not one. */
export function canonicalTuning(raw) {
  if (!Array.isArray(raw)) throw new TypeError('Tuning must be an array of pitches');
  const value = [...raw];
  if (value.length < 1 || value.length > EDITOR_LIMITS.tuningStrings) throw new RangeError(`A tuning has 1 to ${EDITOR_LIMITS.tuningStrings} strings`);
  return value.map((p) => {
    if (typeof p !== 'string') throw new TypeError('Each tuning pitch must be a string');
    const m = PITCH.exec(p);
    if (!m) throw new RangeError(`Use a note and octave from 0 to 9, such as E2 or F#3 (got "${p}")`);
    return m[1].toUpperCase() + m[2] + m[3];
  });
}

/** The repaired beat after its notes changed (see the header); null drops it (an emptied grace). */
function repairBeat(b, notes, voice1) {
  if (notes.length) return { ...b, notes };
  if (b.type === 'grace') return null;
  if (voice1 && b.type === 'note' && b.slash === true) return { ...b, notes };
  if (b.type === 'rest') return { ...b, notes };
  const r = { ...b, type: 'rest' };
  delete r.notes;
  return r;
}

/**
 * Track `track` retuned to canonical `tuning` → `{ track, removed,
 * droppedV1 }`: `removed` counts the notes taken off removed strings,
 * `droppedV1` maps a measure index to the dropped grace indices of the
 * voice-1 beats the cursor walks (voices[0] in a two-voice measure).
 */
export function retuneTrack(track, tuning) {
  const own = Array.isArray(track.tuning) && track.tuning.length ? track.tuning : null;
  const old = own ?? STANDARD_TUNING;
  const droppedV1 = new Map();
  if (old.length === tuning.length && old.every((p, i) => p === tuning[i])) return { track, removed: 0, droppedV1 };
  const oldN = old.length;
  const newN = tuning.length;
  const changed = (s) => s <= Math.min(oldN, newN) && old[oldN - s] !== tuning[newN - s];
  const gone = (s) => s > newN && s <= oldN;
  let removed = 0;

  const fixNote = (n) => {
    if (gone(n.string)) {
      removed++;
      return isValidPitch(n.pitch) ? without(n, 'string', 'fret', 'tieStart', 'tieEnd') : null;
    }
    return changed(n.string) && n.fret != null && n.pitch != null ? without(n, 'pitch') : n;
  };
  /** `beats` fixed; `drops` (optional) collects the indices of dropped graces. */
  const fixBeats = (beats, voice1, drops) => {
    let any = false;
    const out = [];
    beats.forEach((b, i) => {
      if (!isObj(b) || !Array.isArray(b.notes)) { out.push(b); return; }
      let touched = false;
      const notes = [];
      for (const n of b.notes) {
        const x = fixNote(n);
        if (x !== n) touched = true;
        if (x) notes.push(x);
      }
      if (!touched) { out.push(b); return; }
      any = true;
      const nb = repairBeat(b, notes, voice1);
      if (nb) out.push(nb);
      else drops?.push(i);
    });
    return any ? out : beats;
  };

  const measures = Array.isArray(track.measures) ? track.measures.map((m, mi) => {
    if (!isObj(m)) return m;
    const voices = voicesOf(m);
    const drops = [];
    let out = m;
    if (Array.isArray(m.beats)) {
      const beats = fixBeats(m.beats, true, voices ? null : drops);
      if (beats !== m.beats) out = { ...out, beats };
    }
    if (Array.isArray(m.voices)) {
      const next = m.voices.map((v, i) => {
        if (!isObj(v) || !Array.isArray(v.beats)) return v;
        const beats = fixBeats(v.beats, i === 0, voices && i === 0 ? drops : null);
        return beats === v.beats ? v : { ...v, beats };
      });
      if (next.some((v, i) => v !== m.voices[i])) out = { ...out, voices: next };
    }
    if (drops.length) droppedV1.set(mi, drops);
    return out;
  }) : track.measures;
  const next = { ...track, tuning: [...tuning] };
  if (measures !== undefined && measures.some((m, i) => m !== track.measures[i])) next.measures = measures;
  return { track: next, removed, droppedV1 };
}
