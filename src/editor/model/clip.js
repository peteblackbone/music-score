/**
 * model/clip.js — the 2.3 clip format: what Copy writes and Paste reads.
 *
 *   { "type": "music-score-clip", "version": 1, "kind": "beats" | "measures",
 *     "tracks": [{ "tuning": [...], "beats": [...] }] }          // or "measures": [{ beats } | { voices }]
 *
 * A clip holds one track, or (2.3.2, measures clips only) 2 to 32 track
 * entries of equal measure counts: a column selection's visible tracks in
 * order. Beats clips are the selected voice-1 beats with
 * their graces; measures clips keep each measure's beats or voices only
 * (no time / key signature, clef, barline, navigation, pickup), and each
 * voice only its beats. `tempo` is never copied. parseClip treats its input as untrusted, the way
 * io.js parseInput does: a `__proto__` key anywhere refuses the whole clip,
 * LIMITS apply (per track entry), and every entry goes through sanitize.
 * It never throws.
 */
import { EDITOR_LIMITS, checkLimits } from './limits.js';
import { sanitizeFixed } from './io.js';
import { trackAt, measureAt, beatsOf, voicesOf, tuningOf, isObj, without } from './access.js';
import { leadingGraces } from './beats.js';
import { plain } from './settings/validate.js';
import { canonicalTuning } from './settings/tuning.js';

export const CLIP_TYPE = 'music-score-clip';
export const CLIP_MIME = 'application/x-music-score+json';
export const CLIP_VERSION = 1;

/** `beats` deep-cloned without `tempo`. */
const cleanBeats = (beats) => beats.map((b) => without(JSON.parse(JSON.stringify(b)), 'tempo'));
/**
 * Measure `m` (or a hole) as clip content: `{ voices: [{ beats }, …] }` or
 * `{ beats }`, tempo removed from every beat. A voice keeps only its beats
 * (the renderer reads nothing else there), so no voice-level field such as
 * a stray `tempo` travels in a clip.
 */
function clipMeasure(m) {
  const voices = voicesOf(m);
  if (voices) return { voices: voices.map((v) => ({ beats: cleanBeats(beatsOf({ voices: [v] })) })) };
  return { beats: cleanBeats(beatsOf(m)) };
}

/** The cursor beat with its leading graces as a one-beat range (`{ track, kind, slices, info }`), or null on the slot. */
export function cursorRange(score, cursor) {
  const beats = beatsOf(measureAt(trackAt(score, cursor.track), cursor.measure));
  if (cursor.beat >= beats.length) return null;
  const slice = { measure: cursor.measure, from: leadingGraces(beats, cursor.beat), to: cursor.beat + 1, first: false, last: false };
  return { track: cursor.track, slices: [slice], info: { kind: 'beats', beatCount: 1, measures: [cursor.measure, cursor.measure] } };
}

/** The clip of range `sel` (a selection or cursorRange): `{ text, kind, count }` (count: beats, or measures); a column selection adds `tracks`, its track count. */
export function buildClip(score, sel) {
  if (sel.parts) {
    const [a, b] = sel.info.measures;
    const tracks = sel.tracks.map((ti) => {
      const t = trackAt(score, ti);
      const measures = [];
      for (let mi = a; mi <= b; mi++) measures.push(clipMeasure(measureAt(t, mi)));
      return { tuning: [...tuningOf(t)], measures };
    });
    return { text: JSON.stringify({ type: CLIP_TYPE, version: CLIP_VERSION, kind: 'measures', tracks }), kind: 'measures', count: b - a + 1, tracks: tracks.length };
  }
  const track = trackAt(score, sel.track);
  const { kind } = sel.info;
  const entry = { tuning: [...tuningOf(track)] };
  let count;
  if (kind === 'measures') {
    const [a, b] = sel.info.measures;
    entry.measures = [];
    for (let mi = a; mi <= b; mi++) entry.measures.push(clipMeasure(measureAt(track, mi)));
    count = b - a + 1;
  } else {
    entry.beats = sel.slices.flatMap((s) => cleanBeats(beatsOf(measureAt(track, s.measure)).slice(s.from, s.to)));
    count = sel.info.beatCount;
  }
  return { text: JSON.stringify({ type: CLIP_TYPE, version: CLIP_VERSION, kind, tracks: [entry] }), kind, count };
}

/** Whether `text` (at most LIMITS.jsonChars long) parses to an object with `type: CLIP_TYPE`: the paste event's text/plain check, public as ScoreEditor.looksLikeClip. */
export function looksLikeClip(text) {
  if (typeof text !== 'string' || text.length > EDITOR_LIMITS.jsonChars || !text.includes(CLIP_TYPE)) return false;
  try { const v = JSON.parse(text); return plain(v) && v.type === CLIP_TYPE; } catch { return false; }
}

const refuse = (id) => ({ refused: { id } });

/** Track entry `t` of a clip of `kind` checked: `{ tuning, fake }` (fake: a one-track score of its measures for the limits and sanitize), or null when invalid. */
function entryOf(t, kind) {
  if (!plain(t)) return null;
  let tuning = null;
  if (t.tuning !== undefined) {
    try { tuning = canonicalTuning(t.tuning); } catch { return null; }
  }
  const content = kind === 'beats' ? t.beats : t.measures;
  if (!Array.isArray(content) || (kind === 'measures' && !content.every(plain))) return null;
  const measures = kind === 'beats' ? [{ beats: content }] : content.map((m) => (voicesOf(m) ? { voices: m.voices } : { beats: Array.isArray(m.beats) ? m.beats : [] }));
  return { tuning, fake: { tracks: [{ ...(tuning ? { tuning } : {}), showTablature: true, measures }] } };
}

/**
 * The clip in `input` (JSON text or a plain object): `{ clip: { kind,
 * tuning, beats | measures } }` for one track entry, `{ clip: { kind:
 * 'measures', tracks: [{ tuning, measures }, …] } }` for 2 to 32, or
 * `{ refused: { id } }`. Checks in order: type and size, parse, the entry
 * list, each entry, equal measure counts, the limits of every entry, then
 * sanitize each.
 */
export function parseClip(input) {
  try {
    let text;
    if (typeof input === 'string') text = input;
    else if (input !== null && typeof input === 'object') text = JSON.stringify(input);
    else return refuse('clipInvalid');
    if (text.length > EDITOR_LIMITS.jsonChars) return refuse('clipTooLarge');
    let proto = false;
    const data = JSON.parse(text, (k, v) => { if (k === '__proto__') { proto = true; return undefined; } return v; });
    if (proto || !plain(data)) return refuse('clipInvalid');
    if (data.type !== CLIP_TYPE) return refuse('notClip');
    if (data.version !== CLIP_VERSION) return refuse('clipVersion');
    const { kind, tracks } = data;
    if (kind !== 'beats' && kind !== 'measures') return refuse('clipInvalid');
    if (!Array.isArray(tracks) || !tracks.length) return refuse('clipInvalid');
    if (tracks.length > EDITOR_LIMITS.tracks) return refuse('clipTooLarge');
    if (kind === 'beats' && tracks.length > 1) return refuse('clipInvalid');
    const entries = [];
    for (const t of tracks) {
      const e = entryOf(t, kind);
      if (!e) return refuse('clipInvalid');
      entries.push(e);
    }
    const k = entries[0].fake.tracks[0].measures.length;
    if (entries.some((e) => e.fake.tracks[0].measures.length !== k)) return refuse('clipInvalid');
    for (const e of entries) {
      try { checkLimits(e.fake); } catch { return refuse('clipTooLarge'); }
    }
    const clean = entries.map((e) => ({ tuning: e.tuning, measures: sanitizeFixed(e.fake).tracks[0].measures.map((m) => clipMeasure(isObj(m) ? m : null)) }));
    if (clean.length > 1) return { clip: { kind: 'measures', tracks: clean } };
    const { tuning, measures } = clean[0];
    return { clip: kind === 'beats' ? { kind, tuning, beats: measures[0].beats } : { kind, tuning, measures } };
  } catch {
    return refuse('clipInvalid');
  }
}
