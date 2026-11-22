/**
 * model/clip.js — the 2.3 clip format: what Copy writes and Paste reads.
 *
 *   { "type": "music-score-clip", "version": 1, "kind": "beats" | "measures",
 *     "tracks": [{ "tuning": [...], "beats": [...] }] }          // or "measures": [{ beats } | { voices }]
 *
 * A clip holds one track. Beats clips are the selected voice-1 beats with
 * their graces; measures clips keep each measure's beats or voices only
 * (no time / key signature, clef, barline, navigation, pickup), and each
 * voice only its beats. `tempo` is never copied. parseClip treats its input as untrusted, the way
 * io.js parseInput does: a `__proto__` key anywhere refuses the whole clip,
 * LIMITS apply, and the result goes through sanitize. It never throws.
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

/** The clip of range `sel` (a selection or cursorRange): `{ text, kind, count }` (count: beats, or measures). */
export function buildClip(score, sel) {
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

/** Whether `text` parses to an object with `type: CLIP_TYPE` (the paste event's text/plain check). */
export function looksLikeClip(text) {
  if (typeof text !== 'string' || text.length > EDITOR_LIMITS.jsonChars || !text.includes(CLIP_TYPE)) return false;
  try { const v = JSON.parse(text); return plain(v) && v.type === CLIP_TYPE; } catch { return false; }
}

const refuse = (id) => ({ refused: { id } });

/** The clip in `input` (JSON text or a plain object): `{ clip: { kind, tuning, beats | measures } }` or `{ refused: { id } }`. */
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
    if (!Array.isArray(tracks) || tracks.length !== 1 || !plain(tracks[0])) return refuse('clipInvalid');
    const t = tracks[0];
    let tuning = null;
    if (t.tuning !== undefined) {
      try { tuning = canonicalTuning(t.tuning); } catch { return refuse('clipInvalid'); }
    }
    const content = kind === 'beats' ? t.beats : t.measures;
    if (!Array.isArray(content) || (kind === 'measures' && !content.every(plain))) return refuse('clipInvalid');
    const measures = kind === 'beats' ? [{ beats: content }] : content.map((m) => (voicesOf(m) ? { voices: m.voices } : { beats: Array.isArray(m.beats) ? m.beats : [] }));
    const fake = { tracks: [{ ...(tuning ? { tuning } : {}), showTablature: true, measures }] };
    try { checkLimits(fake); } catch { return refuse('clipTooLarge'); }
    const clean = sanitizeFixed(fake).tracks[0].measures.map((m) => clipMeasure(isObj(m) ? m : null));
    return { clip: kind === 'beats' ? { kind, tuning, beats: clean[0].beats } : { kind, tuning, measures: clean } };
  } catch {
    return refuse('clipInvalid');
  }
}
