/**
 * model/ties.js — keeping ties consistent across the seams commands
 * create or change.
 *
 * A note on string s of beat A is tied to the note on s of the next main
 * (non-grace) voice-1 beat B when A's note has `tieStart` and B's has
 * `tieEnd`. The main-beat neighbours look into the adjacent measure only.
 * fixSeam(A, B) removes both flags unless they still pair up, so an edit
 * never leaves a half tie behind.
 */
import { beatsAt, isGrace, notesOf, noteOn, updateNote, without } from './access.js';

/** `{ mi, bi }` of the main beat before index `bi` of measure `mi` (or the previous measure's last), or null. */
export function prevMainBeat(score, ti, mi, bi) {
  const beats = beatsAt(score, ti, mi);
  for (let k = Math.min(bi, beats.length) - 1; k >= 0; k--) if (!isGrace(beats[k])) return { mi, bi: k };
  if (mi <= 0) return null;
  const prev = beatsAt(score, ti, mi - 1);
  for (let k = prev.length - 1; k >= 0; k--) if (!isGrace(prev[k])) return { mi: mi - 1, bi: k };
  return null;
}

/** `{ mi, bi }` of the main beat after index `bi` of measure `mi` (or the next measure's first), or null. */
export function nextMainBeat(score, ti, mi, bi) {
  const beats = beatsAt(score, ti, mi);
  for (let k = Math.max(bi + 1, 0); k < beats.length; k++) if (!isGrace(beats[k])) return { mi, bi: k };
  const next = beatsAt(score, ti, mi + 1);
  for (let k = 0; k < next.length; k++) if (!isGrace(next[k])) return { mi: mi + 1, bi: k };
  return null;
}

/** `{ mi, bi }` of the last main beat inside measure `mi` only, or null. */
export function lastMainIn(score, ti, mi) {
  const beats = beatsAt(score, ti, mi);
  for (let k = beats.length - 1; k >= 0; k--) if (!isGrace(beats[k])) return { mi, bi: k };
  return null;
}

/** `{ mi, bi }` of the first main beat inside measure `mi` only, or null. */
export function firstMainIn(score, ti, mi) {
  const k = beatsAt(score, ti, mi).findIndex((b) => !isGrace(b));
  return k < 0 ? null : { mi, bi: k };
}

const beatAt = (score, ti, loc) => (loc ? beatsAt(score, ti, loc.mi)[loc.bi] ?? null : null);

/** `score` with `flag` removed from the note on string `s` at `loc` (unchanged when it is not set). */
export function stripFlag(score, ti, loc, s, flag) {
  if (!loc) return score;
  return updateNote(score, ti, loc.mi, loc.bi, s, (n) => (n[flag] ? without(n, flag) : n));
}

/**
 * The seam between main beats A and B (`{ mi, bi }` or null) repaired on
 * string `s`, or on every string either has: unless A's note has
 * `tieStart` and B's note has `tieEnd`, both flags are removed.
 */
export function fixSeam(score, ti, A, B, s = null) {
  const a = beatAt(score, ti, A);
  const b = beatAt(score, ti, B);
  const strings = s != null ? [s] : [...new Set([...notesOf(a), ...notesOf(b)].map((n) => n.string).filter((x) => x != null))];
  let out = score;
  for (const str of strings) {
    const na = a ? noteOn(a, str) : null;
    const nb = b ? noteOn(b, str) : null;
    if (na?.tieStart && nb?.tieEnd) continue;
    if (na?.tieStart) out = stripFlag(out, ti, A, str, 'tieStart');
    if (nb?.tieEnd) out = stripFlag(out, ti, B, str, 'tieEnd');
  }
  return out;
}

/** Both seams of main beat `bi` of measure `mi` repaired (on string `s`, or every string). */
export function fixSeamsAround(score, ti, mi, bi, s = null) {
  const here = { mi, bi };
  const out = fixSeam(score, ti, prevMainBeat(score, ti, mi, bi), here, s);
  return fixSeam(out, ti, here, nextMainBeat(out, ti, mi, bi), s);
}

/** The tie partners of the note on string `s` at beat `bi` lose their flags (the note itself keeps its own). */
export function untiePartners(score, ti, mi, bi, s) {
  const note = noteOn(beatsAt(score, ti, mi)[bi], s);
  if (!note) return score;
  let out = score;
  if (note.tieEnd) out = stripFlag(out, ti, prevMainBeat(out, ti, mi, bi), s, 'tieStart');
  if (note.tieStart) out = stripFlag(out, ti, nextMainBeat(out, ti, mi, bi), s, 'tieEnd');
  return out;
}

/** The note on string `s` at beat `bi` and its partners untied. */
export function untieNote(score, ti, mi, bi, s) {
  const out = untiePartners(score, ti, mi, bi, s);
  return updateNote(out, ti, mi, bi, s, (n) => without(n, 'tieStart', 'tieEnd'));
}
