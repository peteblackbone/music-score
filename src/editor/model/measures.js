/**
 * model/measures.js — column-wide measure commands (E9, E10): insert an
 * empty measure in every track, delete a measure from every track that has
 * it, and append one at the end (Right from a full last measure).
 *
 * Inserted measures are plain `{ beats: [] }`; short tracks are padded up
 * to the index first. A deleted measure takes its voices and navigation
 * marks with it, but its time signature, key signature and clef move to
 * the next measure when that one does not set its own. The score keeps at
 * least one measure: deleting the only one empties it, keeping those three.
 * Ties across the changed barlines are repaired.
 */
import { tracksOf, measuresOf, measureAt, measureCount } from './access.js';
import { fixSeam, lastMainIn, firstMainIn } from './ties.js';

const CARRY = ['timeSignature', 'keySignature', 'clef'];
const empty = () => ({ beats: [] });
const carried = (m) => Object.fromEntries(CARRY.filter((k) => m[k] != null).map((k) => [k, m[k]]));

/** `score` with an empty measure at index `at` of every track (ties across it broken). */
export function insertMeasureAt(score, at) {
  const tracks = tracksOf(score);
  if (!tracks.length) return score;
  let out = { ...score, tracks: tracks.map((t) => {
    const measures = measuresOf(t).slice();
    while (measures.length < at) measures.push(empty());
    // Before the opening measure: its time / key signature and clef move to the new first measure,
    // so the score still starts with them (as Guitar Pro does) instead of changing at measure 2.
    const first = at === 0 && measureAt(t, 0);
    if (first && (CARRY.some((k) => first[k] != null) || 'pickup' in first)) {
      const rest = { ...first };
      [...CARRY, 'pickup'].forEach((k) => { delete rest[k]; });
      measures.splice(0, 1, { ...carried(first), beats: [] }, rest);
    } else measures.splice(at, 0, empty());
    return { ...t, measures };
  }) };
  tracks.forEach((_, ti) => {
    out = fixSeam(out, lastMainIn(out, { track: ti, measure: at - 1 }), null);
    out = fixSeam(out, null, firstMainIn(out, { track: ti, measure: at + 1 }));
  });
  return out;
}

const inserted = (score, cursor, at) => ({
  score: insertMeasureAt(score, at),
  cursor: { ...cursor, measure: at, beat: 0 },
  announce: { id: 'measureInserted', n: at + 1 },
});
/** M: an empty measure after the cursor measure, in every track. */
export const insertMeasureAfter = (score, cursor) => inserted(score, cursor, cursor.measure + 1);
/** Shift+M: an empty measure before the cursor measure, in every track. */
export const insertMeasureBefore = (score, cursor) => inserted(score, cursor, cursor.measure);

/** `score` with an empty measure appended after the last column. */
export const appendMeasure = (score) => insertMeasureAt(score, measureCount(score));

/** Shift+Delete: delete the cursor measure in every track (see the header). */
export function deleteMeasure(score, cursor) {
  const m = cursor.measure;
  const tracks = tracksOf(score);
  if (measureCount(score) === 1) {
    let changed = false;
    const next = tracks.map((t) => {
      const old = measureAt(t, 0);
      if (!old) return t;
      const cleared = { ...carried(old), beats: [] };
      if (JSON.stringify(cleared) === JSON.stringify(old)) return t;
      changed = true;
      const measures = measuresOf(t).slice();
      measures[0] = cleared;
      return { ...t, measures };
    });
    const announce = { id: 'measureCleared' };
    return changed ? { score: { ...score, tracks: next }, cursor: { ...cursor, measure: 0, beat: 0 }, announce } : { announce };
  }
  const touched = [];
  let out = { ...score, tracks: tracks.map((t, ti) => {
    const measures = measuresOf(t);
    if (measures.length <= m) return t;
    touched.push(ti);
    const copy = measures.slice();
    const cur = measureAt(t, m);
    if (cur && m + 1 < copy.length) {
      const nxt = measureAt(t, m + 1) ?? empty();
      const add = Object.entries(carried(cur)).filter(([k]) => nxt[k] == null);
      if (add.length) copy[m + 1] = { ...nxt, ...Object.fromEntries(add) };
    }
    copy.splice(m, 1);
    return { ...t, measures: copy };
  }) };
  for (const ti of touched) out = fixSeam(out, lastMainIn(out, { track: ti, measure: m - 1 }), firstMainIn(out, { track: ti, measure: m }));
  const count = measureCount(out);
  return { score: out, cursor: { ...cursor, measure: Math.min(m, count - 1), beat: 0 }, announce: { id: 'measureDeleted', n: m + 1 } };
}
