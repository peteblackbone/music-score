/**
 * model/access.js — reading and copy-on-write updating of the editor model
 * (a sanitized raw score).
 *
 * Locations: model functions address beats and notes with a location
 * `loc = { track, measure, beat, string, voice = 1 }` — the cursor shape.
 * Reads mirror normalize.js: voice 1 is `voices[0].beats` when `voices` is
 * a non-empty array, else `beats`; voice 2 is `voices[1].beats`; a missing
 * measure (null, false or out of range) reads as `{ beats: [] }`. In 2.0
 * only voice 1 is written; voice 2 is read-only.
 *
 * Updates copy only the edited path (score, tracks array, track, measures
 * array, measure, and in two-voice measures the voices array and
 * voices[0]); everything else keeps its identity, so an undo entry is a
 * pair of references. A missing measure is materialized as `{ beats: [] }`
 * on its first write; voice 2 and `measure.beats` of a two-voice measure
 * are never touched.
 */
import { STANDARD_TUNING } from './defaultScore.js';

export const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const DEFAULT_STRINGS = 6;
const MAX_DOTS = 4;

/** The voice of location `loc` (1 when missing). */
export const voiceOf = (loc) => loc.voice ?? 1;
/** `loc` with `changes` applied (a new location object). */
export const locAt = (loc, changes) => ({ ...loc, ...changes });

export const tracksOf = (score) => (Array.isArray(score.tracks) ? score.tracks : []);
export const trackAt = (score, ti) => tracksOf(score)[ti] ?? null;
export const measuresOf = (track) => (track && Array.isArray(track.measures) ? track.measures : []);

/** Tuning of a (sanitized) track, low to high: its own, else standard 6-string. */
export const tuningOf = (track) => (track && Array.isArray(track.tuning) && track.tuning.length ? track.tuning : STANDARD_TUNING);
/** String count of a (sanitized) track: its tuning length, else 6. */
export const stringCount = (track) => (track && Array.isArray(track.tuning) && track.tuning.length ? track.tuning.length : DEFAULT_STRINGS);
/** Open pitch of string `s` (1 = highest) of `track`, or null. */
export const openPitch = (track, s) => tuningOf(track)[stringCount(track) - s] ?? null;
/** Whether the track shows a TAB staff (normalize default: false). */
export const hasTab = (track) => !!track?.showTablature;
/** Whether the track shows a notation staff (normalize default: true). */
export const hasNotation = (track) => !!track && (track.showStandardNotation === undefined ? true : !!track.showStandardNotation);
export const isVisible = (track) => hasTab(track) || hasNotation(track);

/** Number of measure columns: the longest track's, hidden tracks included; at least 1. */
export function measureCount(score) {
  let n = 1;
  for (const t of tracksOf(score)) n = Math.max(n, measuresOf(t).length);
  return n;
}

/** Whether measure 1 is a pickup (2.3): any track has `measures[0].pickup === true`. */
export const isPickup = (score) => tracksOf(score).some((t) => measureAt(t, 0)?.pickup === true);

/** Track `track`'s measure `mi` when it is an object, else null (a hole). */
export function measureAt(track, mi) {
  const m = measuresOf(track)[mi];
  return isObj(m) ? m : null;
}

/** `m.voices` when it is a non-empty array (a two-voice measure), else null. */
export const voicesOf = (m) => (m && Array.isArray(m.voices) && m.voices.length ? m.voices : null);

/** Beats of `voice` (1 or 2) of measure `m` (null reads as no beats). */
export function beatsOf(m, voice = 1) {
  if (!m) return [];
  const voices = voicesOf(m);
  if (voices) return Array.isArray(voices[voice - 1]?.beats) ? voices[voice - 1].beats : [];
  if (voice !== 1) return [];
  return Array.isArray(m.beats) ? m.beats : [];
}

/** Beats of the measure and voice of `loc`. */
export const beatsAt = (score, loc) => beatsOf(measureAt(trackAt(score, loc.track), loc.measure), voiceOf(loc));
/** The beat at `loc` (null on the append slot). */
export const beatAt = (score, loc) => beatsAt(score, loc)[loc.beat] ?? null;
export const isGrace = (b) => b.type === 'grace';
export const isRest = (b) => b.type === 'rest';
/** Main-beat number (from 1) of beat index `k` in `beats`: the non-grace beats up to and including it. */
export function mainBeatNumber(beats, k) {
  let n = 0;
  for (let i = 0; i <= k && i < beats.length; i++) if (!isGrace(beats[i])) n++;
  return n;
}
export const notesOf = (b) => (Array.isArray(b?.notes) ? b.notes : []);
/** Index of the note on string `s` in beat `b`, or -1. */
export const noteIndexOn = (b, s) => notesOf(b).findIndex((n) => n.string === s);
export const noteOn = (b, s) => notesOf(b).find((n) => n.string === s) ?? null;
/** The note on `loc.string` of the (non-rest) beat at `loc`, or null. */
export function cursorNote(score, loc) {
  const b = beatAt(score, loc);
  return b && !isRest(b) ? noteOn(b, loc.string) : null;
}

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

/** `score` with the measure of `loc` replaced by fn(measure), a hole first becoming `{ beats: [] }`. */
export function updateMeasure(score, loc, fn) {
  return updateTrack(score, loc.track, (t) => {
    const measures = measuresOf(t).slice();
    while (measures.length < loc.measure) measures.push({ beats: [] });
    measures[loc.measure] = fn(measureAt(t, loc.measure) ?? { beats: [] });
    return { ...t, measures };
  });
}

/** `score` with the beats of `loc`'s measure replaced by fn(beats); voice 1 only (voice 2 is read-only in 2.0). */
export function updateBeats(score, loc, fn) {
  if (voiceOf(loc) !== 1) throw new Error('Only voice 1 can be edited');
  return updateMeasure(score, loc, (m) => {
    const voices = voicesOf(m);
    if (!voices) return { ...m, beats: fn(beatsOf(m)) };
    const v0 = voices[0];
    const beats = fn(beatsOf(m));
    const next = voices.slice();
    next[0] = isObj(v0) ? { ...v0, beats } : { beats };
    return { ...m, voices: next };
  });
}

/** `score` with the beat at `loc` replaced by fn(beat); `score` itself when fn returns the same beat. */
export function updateBeat(score, loc, fn) {
  const beat = beatAt(score, loc);
  const next = fn(beat);
  if (next === beat) return score;
  return updateBeats(score, loc, (beats) => beats.map((b, i) => (i === loc.beat ? next : b)));
}

/** `score` with the note on `loc.string` of the beat at `loc` replaced by fn(note); unchanged when there is none or fn returns it. */
export function updateNote(score, loc, fn) {
  return updateBeat(score, loc, (beat) => {
    const k = noteIndexOn(beat, loc.string);
    if (k < 0) return beat;
    const note = beat.notes[k];
    const next = fn(note);
    if (next === note) return beat;
    return { ...beat, notes: beat.notes.map((n, i) => (i === k ? next : n)) };
  });
}
