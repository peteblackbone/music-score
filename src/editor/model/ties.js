/**
 * model/ties.js — keeping ties consistent across the seams commands
 * create or change.
 *
 * A note on string s of beat A is tied to the note on s of the next main
 * (non-grace) beat B of the same voice when A's note has `tieStart` and
 * B's has `tieEnd`. The main-beat neighbours look into the adjacent measure
 * only. fixSeam(A, B) removes both flags unless they still pair up, so an
 * edit never leaves a half tie behind. Beats are addressed by locations
 * (access.js); a neighbour is returned as a location, or null.
 */
import { beatsAt, beatAt, isGrace, notesOf, noteOn, updateNote, without, locAt, measureCount } from './access.js';

/** The main beat before `loc` in its measure, else the previous measure's last; or null. */
export function prevMainBeat(score, loc) {
  const beats = beatsAt(score, loc);
  for (let k = Math.min(loc.beat, beats.length) - 1; k >= 0; k--) if (!isGrace(beats[k])) return locAt(loc, { beat: k });
  return loc.measure > 0 ? lastMainIn(score, locAt(loc, { measure: loc.measure - 1 })) : null;
}

/** The main beat after `loc` in its measure, else the next measure's first; or null. */
export function nextMainBeat(score, loc) {
  const beats = beatsAt(score, loc);
  for (let k = Math.max(loc.beat + 1, 0); k < beats.length; k++) if (!isGrace(beats[k])) return locAt(loc, { beat: k });
  return firstMainIn(score, locAt(loc, { measure: loc.measure + 1 }));
}

/** The last main beat inside the measure of `loc` only, or null. */
export function lastMainIn(score, loc) {
  const beats = beatsAt(score, loc);
  for (let k = beats.length - 1; k >= 0; k--) if (!isGrace(beats[k])) return locAt(loc, { beat: k });
  return null;
}

/** The first main beat inside the measure of `loc` only, or null. */
export function firstMainIn(score, loc) {
  const k = beatsAt(score, loc).findIndex((b) => !isGrace(b));
  return k < 0 ? null : locAt(loc, { beat: k });
}

/** `score` with `flag` removed from the note at `loc` (on `loc.string`); unchanged when it is not set. */
export function stripFlag(score, loc, flag) {
  if (!loc) return score;
  return updateNote(score, loc, (n) => (n[flag] ? without(n, flag) : n));
}

/**
 * The seam between main beats A and B (locations or null) repaired on
 * string `string`, or on every string either has: unless A's note has
 * `tieStart` and B's note has `tieEnd`, both flags are removed.
 */
export function fixSeam(score, A, B, string = null) {
  const a = A ? beatAt(score, A) : null;
  const b = B ? beatAt(score, B) : null;
  const strings = string != null ? [string] : [...new Set([...notesOf(a), ...notesOf(b)].map((n) => n.string).filter((x) => x != null))];
  let out = score;
  for (const s of strings) {
    const na = a ? noteOn(a, s) : null;
    const nb = b ? noteOn(b, s) : null;
    if (na?.tieStart && nb?.tieEnd) continue;
    if (na?.tieStart) out = stripFlag(out, locAt(A, { string: s }), 'tieStart');
    if (nb?.tieEnd) out = stripFlag(out, locAt(B, { string: s }), 'tieEnd');
  }
  return out;
}

/** Both seams of the main beat at `loc` repaired (on `string`, or every string). */
export function fixSeamsAround(score, loc, string = null) {
  const out = fixSeam(score, prevMainBeat(score, loc), loc, string);
  return fixSeam(out, loc, nextMainBeat(out, loc), string);
}

/** The tie partners of the note at `loc` lose their flags (the note itself keeps its own). */
export function untiePartners(score, loc) {
  const note = noteOn(beatAt(score, loc), loc.string);
  if (!note) return score;
  let out = score;
  if (note.tieEnd) out = stripFlag(out, prevMainBeat(out, loc), 'tieStart');
  if (note.tieStart) out = stripFlag(out, nextMainBeat(out, loc), 'tieEnd');
  return out;
}

/** The note at `loc` and its partners untied. */
export function untieNote(score, loc) {
  return updateNote(untiePartners(score, loc), loc, (n) => without(n, 'tieStart', 'tieEnd'));
}

/**
 * Every seam of track `track` in measures m0 − 1 … m1 + 1 repaired (2.3
 * range edits): each main beat with its next main beat, and the first main
 * beat of a measure whose previous measure has none. Voice 1 only.
 */
export function fixTiesIn(score, track, m0, m1) {
  let out = score;
  const hi = Math.min(m1 + 1, measureCount(score) - 1);
  for (let mi = Math.max(0, m0 - 1); mi <= hi; mi++) {
    const loc = { track, measure: mi, beat: 0 };
    const first = firstMainIn(out, loc);
    if (first && !prevMainBeat(out, first)) out = fixSeam(out, null, first);
    const beats = beatsAt(out, loc);
    for (let k = 0; k < beats.length; k++) {
      if (isGrace(beats[k])) continue;
      const A = locAt(loc, { beat: k });
      out = fixSeam(out, A, nextMainBeat(out, A));
    }
  }
  return out;
}

