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
 * Ties across the changed barlines are repaired. Inserting before measure 1
 * moves its three carried fields to the new first measure and drops the 2.3
 * pickup flag; deleteColumns (2.3) deletes a range of columns in one pass
 * with the same result as deleting them one at a time.
 */
import { tracksOf, measuresOf, measureAt, measureCount, without, isObj } from './access.js';
import { fixSeam, lastMainIn, firstMainIn } from './ties.js';

const CARRY = ['timeSignature', 'keySignature', 'clef'];
const empty = () => ({ beats: [] });
const carried = (m) => Object.fromEntries(CARRY.filter((k) => m[k] != null).map((k) => [k, m[k]]));

/** `score` with `n` empty measures at index `at` of every track (ties across them broken). */
export function insertMeasuresAt(score, at, n) {
  const tracks = tracksOf(score);
  if (!tracks.length) return score;
  const fresh = (k) => Array.from({ length: k }, empty);
  let out = { ...score, tracks: tracks.map((t) => {
    const measures = measuresOf(t).slice();
    while (measures.length < at) measures.push(empty());
    // Before the opening measure: its time / key signature and clef move to the new first measure,
    // so the score still starts with them (as Guitar Pro does) instead of changing at measure 2.
    const first = at === 0 && measureAt(t, 0);
    if (first && (CARRY.some((k) => first[k] != null) || 'pickup' in first)) {
      measures.splice(0, 1, { ...carried(first), beats: [] }, ...fresh(n - 1), without(first, ...CARRY, 'pickup'));
    } else measures.splice(at, 0, ...fresh(n));
    return { ...t, measures };
  }) };
  tracks.forEach((_, ti) => {
    out = fixSeam(out, lastMainIn(out, { track: ti, measure: at - 1 }), null);
    out = fixSeam(out, null, firstMainIn(out, { track: ti, measure: at + n }));
  });
  return out;
}

/** `score` with an empty measure at index `at` of every track (insertMeasuresAt with n = 1). */
export const insertMeasureAt = (score, at) => insertMeasuresAt(score, at, 1);

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

/** Track measures `ms` with columns a..b deleted as deleteMeasure would, one at a time (`all`: every column goes). */
function dropColumns(ms, a, b, all) {
  if (ms.length <= a) return ms;
  const last = Math.min(b, ms.length - 1);
  if (all && last < b) return []; // a short track loses every measure, as with single deletes
  const obj = (m) => (isObj(m) ? m : null);
  const win = ms.slice(a, last + 2); // the deleted measures and the one after
  const gone = all ? last - a : last - a + 1; // with every column gone, the last one is cleared instead
  for (let i = 0; i < gone; i++) {
    const cur = obj(win[i]);
    if (!cur || i + 1 >= win.length) continue;
    const nxt = obj(win[i + 1]) ?? empty();
    const add = Object.entries(carried(cur)).filter(([k]) => nxt[k] == null);
    if (add.length) win[i + 1] = { ...nxt, ...Object.fromEntries(add) };
  }
  const rest = win.slice(gone);
  if (all && obj(rest[0])) rest[0] = { ...carried(rest[0]), beats: [] };
  return [...ms.slice(0, a), ...rest, ...ms.slice(last + 2)];
}

/**
 * `score` with columns a..b (inclusive) deleted from every track in one
 * pass: the carried fields of the latest deleted measure that sets each
 * one move to the measure after the range unless it sets its own; with
 * every column deleted one `{ ...carried, beats: [] }` is kept (pickup is
 * never carried); the seam at `a` is repaired. Same score when nothing changes.
 */
export function deleteColumns(score, a, b) {
  const tracks = tracksOf(score);
  const all = a === 0 && b >= measureCount(score) - 1;
  const next = tracks.map((t) => {
    const ms = dropColumns(measuresOf(t), a, b, all);
    return ms === measuresOf(t) || (all && JSON.stringify(ms) === JSON.stringify(measuresOf(t))) ? t : { ...t, measures: ms };
  });
  if (next.every((t, i) => t === tracks[i])) return score;
  let out = { ...score, tracks: next };
  if (!all) next.forEach((_, ti) => { out = fixSeam(out, lastMainIn(out, { track: ti, measure: a - 1 }), firstMainIn(out, { track: ti, measure: a })); });
  return out;
}

