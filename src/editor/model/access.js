/**
 * model/access.js — reading and copy-on-write updating of the editor model
 * (a sanitized raw score). Reads mirror normalize.js: voice 1 is
 * `voices[0].beats` when `voices` is a non-empty array, else `beats`; a
 * missing measure (null, false or out of range) reads as `{ beats: [] }`.
 *
 * Updates copy only the edited path (score, tracks array, track, measures
 * array, measure, and in two-voice measures the voices array and
 * voices[0]); everything else keeps its identity, so an undo entry is a
 * pair of references. A missing measure is materialized as `{ beats: [] }`
 * on its first write; voice 2 and `measure.beats` of a two-voice measure
 * are never touched.
 */

export const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const DEFAULT_STRINGS = 6;
const MAX_DOTS = 4;

export const tracksOf = (score) => (Array.isArray(score.tracks) ? score.tracks : []);
export const trackAt = (score, ti) => tracksOf(score)[ti] ?? null;
export const measuresOf = (track) => (track && Array.isArray(track.measures) ? track.measures : []);

/** String count of a (sanitized) track: its tuning length, else 6. */
export const stringCount = (track) => (track && Array.isArray(track.tuning) && track.tuning.length ? track.tuning.length : DEFAULT_STRINGS);
/** Whether the track shows a TAB staff (normalize default: false). */
export const hasTab = (track) => !!track?.showTablature;
/** Whether the track shows a notation staff (normalize default: true). */
export const hasNotation = (track) => !!track && (track.showStandardNotation === undefined ? true : !!track.showStandardNotation);
export const isVisible = (track) => hasTab(track) || hasNotation(track);

/** Number of measure columns: the longest track's, hidden tracks included; at least 1. */
export const measureCount = (score) => Math.max(1, ...tracksOf(score).map((t) => measuresOf(t).length));

/** Track `track`'s measure `mi` when it is an object, else null (a hole). */
export function measureAt(track, mi) {
  const m = measuresOf(track)[mi];
  return isObj(m) ? m : null;
}

/** `m.voices` when it is a non-empty array (a two-voice measure), else null. */
export const voicesOf = (m) => (m && Array.isArray(m.voices) && m.voices.length ? m.voices : null);

/** Voice-1 beats of measure `m` (null reads as no beats). */
export function beatsOf(m) {
  if (!m) return [];
  const voices = voicesOf(m);
  if (voices) return Array.isArray(voices[0]?.beats) ? voices[0].beats : [];
  return Array.isArray(m.beats) ? m.beats : [];
}

export const beatsAt = (score, ti, mi) => beatsOf(measureAt(trackAt(score, ti), mi));
export const isGrace = (b) => b.type === 'grace';
export const isRest = (b) => b.type === 'rest';
export const notesOf = (b) => (Array.isArray(b?.notes) ? b.notes : []);
/** Index of the note on string `s` in beat `b`, or -1. */
export const noteIndexOn = (b, s) => notesOf(b).findIndex((n) => n.string === s);
export const noteOn = (b, s) => notesOf(b).find((n) => n.string === s) ?? null;

/** Augmentation dots as normalize reads them: an integer 0..4. */
export function clampDots(d) {
  const n = typeof d === 'string' && d.trim() !== '' ? Number(d) : d;
  return typeof n === 'number' && n > 0 ? Math.min(MAX_DOTS, Math.floor(n)) : 0;
}

/** A shallow copy of `obj` without `keys` (obj itself when it has none of them). */
export function without(obj, ...keys) {
  if (!keys.some((k) => k in obj)) return obj;
  const out = { ...obj };
  keys.forEach((k) => delete out[k]);
  return out;
}

/** `score` with track `ti` replaced by fn(track). */
export function updateTrack(score, ti, fn) {
  const tracks = tracksOf(score).slice();
  tracks[ti] = fn(tracks[ti]);
  return { ...score, tracks };
}

/** `score` with track `ti`'s measure `mi` replaced by fn(measure), a hole first becoming `{ beats: [] }`. */
export function updateMeasure(score, ti, mi, fn) {
  return updateTrack(score, ti, (t) => {
    const measures = measuresOf(t).slice();
    while (measures.length < mi) measures.push({ beats: [] });
    measures[mi] = fn(measureAt(t, mi) ?? { beats: [] });
    return { ...t, measures };
  });
}

/** `score` with track `ti`'s measure `mi` voice-1 beats replaced by fn(beats); voice 2 keeps its reference. */
export function updateBeats(score, ti, mi, fn) {
  return updateMeasure(score, ti, mi, (m) => {
    const voices = voicesOf(m);
    if (!voices) return { ...m, beats: fn(beatsOf(m)) };
    const v0 = voices[0];
    const beats = fn(beatsOf(m));
    const next = voices.slice();
    next[0] = isObj(v0) ? { ...v0, beats } : { beats };
    return { ...m, voices: next };
  });
}

/** `score` with voice-1 beat `bi` replaced by fn(beat); `score` itself when fn returns the same beat. */
export function updateBeat(score, ti, mi, bi, fn) {
  const beat = beatsAt(score, ti, mi)[bi];
  const next = fn(beat);
  if (next === beat) return score;
  return updateBeats(score, ti, mi, (beats) => beats.map((b, i) => (i === bi ? next : b)));
}

/** `score` with the note on string `s` of beat `bi` replaced by fn(note); unchanged when there is none or fn returns it. */
export function updateNote(score, ti, mi, bi, s, fn) {
  return updateBeat(score, ti, mi, bi, (beat) => {
    const k = noteIndexOn(beat, s);
    if (k < 0) return beat;
    const note = beat.notes[k];
    const next = fn(note);
    if (next === note) return beat;
    return { ...beat, notes: beat.notes.map((n, i) => (i === k ? next : n)) };
  });
}
