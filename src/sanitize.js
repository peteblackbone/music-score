/**
 * sanitize.js — repairs malformed score input before normalization
 * (1.12.1), so render() never throws or runs away on bad data, such as a
 * half-built score in an editor. Called first by normalizeScore.
 *
 * Copy-on-write: an object is copied only when something under it is
 * repaired, so a valid score comes back as the same objects (identical
 * output), and the author's input is never mutated.
 *
 * Repairs (everything else passes through untouched):
 * - `score` not an object → empty score; `tracks` not an array → [];
 *   a track that is not an object is dropped.
 * - `tuning` that is not a non-empty array of pitch strings → removed (the
 *   standard 6-string default applies).
 * - `measures` not an array → []; a measure that is not an object → an
 *   empty measure (keeps the measures of every track aligned); a missing
 *   (null) one is left for normalize to pad.
 * - `timeSignature` (score, track, measure) without integer `beats` 1–64
 *   and `beatType` 1–64 → removed (the previous one carries on); likewise
 *   a `keySignature` that is not an integer -7–7.
 * - `beats` (measure or voice) not an array → []; a beat that is not an
 *   object is dropped.
 * - `duration` not one of whole … 64th → 'quarter' (graces keep theirs).
 * - `tuplet`: a number or `count` / `of` that is not an integer 1–64 →
 *   removed.
 * - `dynamic` that is not a string → removed.
 * - `notes` not an array → []; a note that is not an object is dropped;
 *   `pitch` that is not a pitch string with octave -1–10 → removed;
 *   `fret` that is not an integer 0–99 → removed; `string` that is not an
 *   integer 1 – string count → removed (the note leaves the TAB). A note
 *   left with neither a pitch nor a `string` and `fret` is dropped.
 * - a note beat (or a beat of no / another type) left with no notes,
 *   except a voice-1 `slash: true` note beat → a rest of the same
 *   duration; a grace left with no notes → dropped.
 */

const DURATIONS = new Set(['whole', 'half', 'quarter', '8th', '16th', '32nd', '64th']);
const PITCH_RE = /^([A-Ga-g])(#{1,2}|b{1,2}|x)?(-?\d+)$/;
const DEFAULT_STRINGS = 6;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const intIn = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

/** Whether `p` is a pitch string parsePitch accepts, with octave -1..10. */
export function isValidPitch(p) {
  if (typeof p !== 'string') return false;
  const m = PITCH_RE.exec(p.trim());
  return !!m && intIn(Number(m[3]), -1, 10);
}

/** `obj` with `changes` applied (keys set to undefined are deleted), or `obj` itself when nothing changes. */
function patch(obj, changes) {
  const keys = Object.keys(changes).filter((k) => changes[k] !== obj[k] || (changes[k] === undefined && k in obj));
  if (!keys.length) return obj;
  const out = { ...obj };
  keys.forEach((k) => { if (changes[k] === undefined) delete out[k]; else out[k] = changes[k]; });
  return out;
}

/** Returned by a mapArray callback to drop the item. */
const DROP = Symbol('drop');

/** `arr` mapped by `fn` (DROP results removed), or `arr` itself when every item comes back unchanged. */
function mapArray(arr, fn) {
  let changed = false;
  const out = [];
  arr.forEach((item, i) => {
    const r = fn(item, i);
    if (r !== item) changed = true;
    if (r !== DROP) out.push(r);
  });
  return changed ? out : arr;
}

const validTime = (ts) => isObj(ts) && intIn(ts.beats, 1, 64) && intIn(ts.beatType, 1, 64);
const timeFix = (o) => ('timeSignature' in o && o.timeSignature != null && !validTime(o.timeSignature) ? { timeSignature: undefined } : {});
const keyFix = (o) => (o.keySignature != null && !intIn(o.keySignature, -7, 7) ? { keySignature: undefined } : {});
/** The time and key signature repairs shared by score, track and measure. */
const sigFix = (o) => ({ ...timeFix(o), ...keyFix(o) });

function validTuplet(t) {
  if (t == null) return true;
  if (typeof t === 'number') return intIn(t, 1, 64);
  if (isObj(t)) return (t.count === undefined || intIn(t.count, 1, 64)) && (t.of === undefined || intIn(t.of, 1, 64));
  return true; // other values keep their existing meaning (normalizeTuplet)
}

function sanitizeNote(n, stringCount) {
  if (!isObj(n)) return DROP;
  const changes = {};
  if (n.pitch != null && !isValidPitch(n.pitch)) changes.pitch = undefined;
  if (n.fret != null && !intIn(n.fret, 0, 99)) changes.fret = undefined;
  if (n.string != null && !intIn(n.string, 1, stringCount)) changes.string = undefined;
  const out = patch(n, changes);
  const hasPitch = out.pitch != null;
  const hasTab = out.string != null && out.fret != null;
  return hasPitch || hasTab ? out : DROP;
}

function sanitizeBeat(b, stringCount, voice1) {
  if (!isObj(b)) return DROP;
  const changes = {};
  if (b.type !== 'grace' && !DURATIONS.has(b.duration)) changes.duration = 'quarter';
  if (!validTuplet(b.tuplet)) changes.tuplet = undefined;
  if (b.dynamic != null && typeof b.dynamic !== 'string') changes.dynamic = undefined;
  if (b.notes !== undefined) {
    changes.notes = Array.isArray(b.notes) ? mapArray(b.notes, (n) => sanitizeNote(n, stringCount)) : [];
  }
  const out = patch(b, changes);
  const empty = !Array.isArray(out.notes) || !out.notes.length;
  if (out.type === 'grace' && empty) return DROP;
  if (out.type !== 'rest' && empty && !(voice1 && out.type === 'note' && out.slash === true)) {
    const rest = { ...out, type: 'rest' };
    delete rest.notes;
    return rest;
  }
  return out;
}

const sanitizeBeats = (beats, stringCount, voice1) => (Array.isArray(beats)
  ? mapArray(beats, (b) => sanitizeBeat(b, stringCount, voice1))
  : []);

function sanitizeMeasure(m, stringCount) {
  if (m == null || m === false) return m; // a missing measure is padded by normalize
  if (!isObj(m)) return { beats: [] };
  const changes = sigFix(m);
  if ('beats' in m && m.beats != null) changes.beats = sanitizeBeats(m.beats, stringCount, true);
  if (Array.isArray(m.voices)) {
    changes.voices = mapArray(m.voices, (v, i) => (isObj(v) && 'beats' in v ? patch(v, { beats: sanitizeBeats(v.beats, stringCount, i === 0) }) : v));
  }
  return patch(m, changes);
}

function sanitizeTrack(t) {
  if (!isObj(t)) return DROP;
  const changes = sigFix(t);
  const tuningOk = Array.isArray(t.tuning) && t.tuning.length > 0 && t.tuning.every(isValidPitch);
  if (t.tuning != null && !tuningOk) changes.tuning = undefined;
  const stringCount = tuningOk ? t.tuning.length : DEFAULT_STRINGS;
  if (t.measures != null) {
    changes.measures = Array.isArray(t.measures) ? mapArray(t.measures, (m) => sanitizeMeasure(m, stringCount)) : [];
  }
  return patch(t, changes);
}

/** The repaired score (see the module header); `score` itself when it is already valid. */
export function sanitizeScore(score) {
  if (!isObj(score)) return { tracks: [] };
  const changes = sigFix(score);
  if (score.tracks != null) changes.tracks = Array.isArray(score.tracks) ? mapArray(score.tracks, sanitizeTrack) : [];
  return patch(score, changes);
}
