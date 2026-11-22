/**
 * model/settings/column.js — measure fields that apply to a whole column
 * (every track at one measure index), read and written the way the
 * renderer merges them: a field counts on a measure only when its value is
 * valid there (the renderer's canonicalizers), and the lowest track index
 * with a valid value wins.
 *
 * Writes are copy-on-write. A write pads a short track (or fills a hole)
 * with `{ beats: [] }` up to the measure; a delete never creates measures;
 * a value equal to the stored one is skipped, so a no-op keeps every
 * reference.
 */
import { canonicalEnding, canonicalJump } from '../../../navigation.js';
import { canonicalSection, canonicalRepeatCount } from '../../../scoreText.js';
import { tracksOf, measuresOf, measureAt, measureCount, isObj } from '../access.js';
import { timeSignatureAt, keySignatureAt } from '../fill.js';
import { same } from './validate.js';

const VALID = {
  barline: (v) => !!v,
  ending: (v) => canonicalEnding(v) != null,
  jump: (v) => canonicalJump(v) != null,
  section: (v) => canonicalSection(v) != null,
  repeatCount: (v) => canonicalRepeatCount(v) != null,
  segno: (v) => v === true,
  coda: (v) => v === true,
  timeSignature: (v) => v != null,
  keySignature: (v) => v != null,
};
/** The column-wide navigation fields copied to a new track. */
export const NAV_FIELDS = Object.freeze(['barline', 'ending', 'jump', 'section', 'repeatCount', 'segno', 'coda']);
/** Every field a removed track hands to the remaining tracks. */
export const COLUMN_FIELDS = Object.freeze([...NAV_FIELDS, 'timeSignature', 'keySignature']);

/** Whether measure `m` (or null) sets field `f` with a value the renderer reads. */
export const hasField = (m, f) => !!m && VALID[f](m[f]);

/** The raw value of field `f` at column `mi` from the lowest track index that sets it validly, else undefined. */
export function columnValue(score, mi, f) {
  for (const t of tracksOf(score)) {
    const m = measureAt(t, mi);
    if (hasField(m, f)) return m[f];
  }
  return undefined;
}

/** `track` with field `f` of measure `mi` set to `value` (undefined deletes); `track` itself when nothing changes. */
export function writeField(track, mi, f, value) {
  const m = measureAt(track, mi);
  if (value === undefined) {
    if (!m || !Object.hasOwn(m, f)) return track;
  } else if (m && Object.hasOwn(m, f) && same(m[f], value)) return track;
  const measures = measuresOf(track).slice();
  while (measures.length < mi) measures.push({ beats: [] });
  const base = m ?? { beats: [] };
  const next = { ...base };
  if (value === undefined) delete next[f];
  else next[f] = value;
  measures[mi] = next;
  return { ...track, measures };
}

/** `score` with track `ti` replaced by fn(track); `score` itself when fn returns the same track. */
function mapTrack(score, ti, fn) {
  const tracks = tracksOf(score);
  const next = fn(tracks[ti]);
  if (next === tracks[ti]) return score;
  const out = tracks.slice();
  out[ti] = next;
  return { ...score, tracks: out };
}

/** `score` with field `f` of measure `mi` of track `ti` set (undefined deletes). */
export const setTrackField = (score, ti, mi, f, value) => mapTrack(score, ti, (t) => writeField(t, mi, f, value));

/** `score` with field `f` of measure `mi` set on every track, hidden ones included (undefined deletes). */
export function setColumn(score, mi, f, value) {
  let out = score;
  tracksOf(score).forEach((_, ti) => { out = setTrackField(out, ti, mi, f, value); });
  return out;
}

const COMMON = { beats: 4, beatType: 4 };
const sameTime = (a, b) => a.beats === b.beats && a.beatType === b.beatType;

/**
 * The measures of a track added to `score`: one `{ beats: [] }` per
 * column; time and key signatures follow track 0 with as few writes as
 * possible (at measure 0 only when they differ from the score's baseline,
 * after that where track 0 changes); the navigation fields come from
 * columnValue, copied as stored; clefs are never copied.
 */
export function newTrackMeasures(score) {
  const count = measureCount(score);
  const has0 = tracksOf(score).length > 0;
  const baseTime = score.timeSignature || COMMON;
  const baseKey = score.keySignature ?? 0;
  const out = [];
  let prevTime = baseTime;
  let prevKey = baseKey;
  for (let mi = 0; mi < count; mi++) {
    const m = { beats: [] };
    if (has0) {
      const ts = timeSignatureAt(score, { track: 0, measure: mi });
      const key = keySignatureAt(score, { track: 0, measure: mi });
      if (!sameTime(ts, prevTime)) m.timeSignature = { beats: ts.beats, beatType: ts.beatType };
      if (key !== prevKey) m.keySignature = key;
      prevTime = ts;
      prevKey = key;
    }
    for (const f of NAV_FIELDS) {
      const v = columnValue(score, mi, f);
      if (v !== undefined) m[f] = v;
    }
    out.push(m);
  }
  return out;
}

/**
 * `score` before track `ti` is removed: each column field the removed track
 * sets where no remaining track sets it is copied (raw) to every remaining
 * track, so removing a track never removes a repeat, ending, jump or
 * signature change from the score.
 */
export function migrateRemoved(score, ti) {
  const tracks = tracksOf(score);
  const gone = tracks[ti];
  let out = score;
  measuresOf(gone).forEach((m, mi) => {
    if (!isObj(m)) return;
    for (const f of COLUMN_FIELDS) {
      if (!hasField(m, f)) continue;
      if (tracks.some((t, k) => k !== ti && hasField(measureAt(t, mi), f))) continue;
      tracks.forEach((_, k) => { if (k !== ti) out = setTrackField(out, k, mi, f, m[f]); });
    }
  });
  return out;
}
