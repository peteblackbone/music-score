/**
 * model/limits.js — the editor's input size limits (2.0.0). A score past
 * any of them is rejected by loadScore / the constructor with
 * `Error('Score too large: …')` before it is repaired or rendered, so a
 * hostile or broken file cannot stall the page. The renderer itself
 * (MusicScoreRenderer) does not apply them. Public as ScoreEditor.LIMITS.
 */
export const EDITOR_LIMITS = Object.freeze({
  jsonChars: 5 * 1024 * 1024, // characters of JSON text (string input, or the object serialized)
  tracks: 32,
  measuresPerTrack: 2000,
  voicesPerMeasure: 4,
  beatsPerVoice: 256, // per measure: `beats` and each `voices[i].beats`
  notesPerBeat: 16,
  tuningStrings: 12,
  // 2.2 settings API caps (checked by the settings calls only; loadScore does not enforce them)
  textChars: 200, // single-line score, track, section and ending text (UTF-16 code units)
  longTextChars: 2000, // instructions and copyright
  timeSignatureBeats: 32,
  beatTypes: Object.freeze([1, 2, 4, 8, 16, 32]),
});

const L = EDITOR_LIMITS;
const too = (what, n, limit) => { throw new Error(`Score too large: ${n} ${what} (limit ${limit})`); };
const len = (v) => (Array.isArray(v) ? v.length : 0);
const objs = (v) => (Array.isArray(v) ? v.filter((x) => x !== null && typeof x === 'object') : []);

function checkBeats(beats) {
  if (len(beats) > L.beatsPerVoice) too('beats in a measure', len(beats), L.beatsPerVoice);
  for (const b of objs(beats)) if (len(b.notes) > L.notesPerBeat) too('notes in a beat', len(b.notes), L.notesPerBeat);
}

/** Throws `Error('Score too large: …')` when the parsed score `data` is past a limit (only arrays are counted). */
export function checkLimits(data) {
  if (len(data.tracks) > L.tracks) too('tracks', len(data.tracks), L.tracks);
  for (const t of objs(data.tracks)) {
    if (len(t.tuning) > L.tuningStrings) too('tuning strings', len(t.tuning), L.tuningStrings);
    if (len(t.measures) > L.measuresPerTrack) too('measures in a track', len(t.measures), L.measuresPerTrack);
    for (const m of objs(t.measures)) {
      checkBeats(m.beats);
      if (len(m.voices) > L.voicesPerMeasure) too('voices in a measure', len(m.voices), L.voicesPerMeasure);
      for (const v of objs(m.voices)) checkBeats(v.beats);
    }
  }
}

/** Throws when JSON text of `chars` characters is past the limit. */
export function checkJsonLength(chars) {
  if (chars > L.jsonChars) too('characters of JSON', chars, L.jsonChars);
}
