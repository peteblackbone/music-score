/**
 * model/selection.js — the 2.3 keyboard selection: one track, voice 1, from
 * an anchor to a focus (the cursor), both `{ measure, beat }` cursor
 * positions and both inclusive. Graces go with the main beat they lead
 * into; a range that runs to the end of a measure takes its trailing graces.
 *
 * A selection is cut into slices, one per measure: `{ measure, from, to,
 * first, last }`, the beat indices [from, to) it covers and whether it
 * starts at the measure's first position / ends at its last. Kind
 * 'measures' when every slice is a whole measure, else 'beats'; a range
 * with no main beat is no selection (null).
 *
 * Select commands are moves `(score, cursor, state, ctx) → { cursor,
 * announce? }`: they never return a score and run in read-only mode.
 */
import { tracksOf, trackAt, measureAt, beatsOf, isGrace, measureCount } from './access.js';
import { baseTimeSignature, fillOf } from './fill.js';
import { leadingGraces } from './beats.js';
import { positions, moveLeft, moveRight, measureStart, measureEnd } from './cursor.js';

const before = (a, b) => a.measure < b.measure || (a.measure === b.measure && a.beat <= b.beat);

/** The slices of track `ti` from position `anchor` to `focus` (either order), in one forward pass. */
export function rangeSlices(score, ti, anchor, focus) {
  const [lo, hi] = before(anchor, focus) ? [anchor, focus] : [focus, anchor];
  const track = trackAt(score, ti);
  let ts = baseTimeSignature(score, track);
  const out = [];
  for (let mi = 0; mi <= hi.measure; mi++) {
    const m = measureAt(track, mi);
    if (m?.timeSignature) ts = m.timeSignature;
    if (mi < lo.measure) continue;
    const beats = beatsOf(m);
    const pos = [];
    beats.forEach((b, k) => { if (!isGrace(b)) pos.push(k); });
    const f = fillOf(beats, ts);
    const slot = f === 'under' || f === 'empty';
    if (slot) pos.push(beats.length);
    const startPos = mi === lo.measure ? lo.beat : pos[0];
    const endPos = mi === hi.measure ? hi.beat : pos[pos.length - 1];
    const from = startPos >= beats.length ? beats.length : leadingGraces(beats, startPos);
    const lastMain = !slot && endPos === pos[pos.length - 1];
    const to = endPos >= beats.length || lastMain ? beats.length : endPos + 1;
    out.push({ measure: mi, from, to: Math.max(from, to), first: startPos === pos[0], last: endPos === pos[pos.length - 1] });
  }
  return out;
}

/** Main beats of track `ti` in `slices`, as `[{ measure, beat }]` of the first and last plus the count. */
function mainSpan(score, ti, slices) {
  const track = trackAt(score, ti);
  let first = null;
  let last = null;
  let count = 0;
  for (const s of slices) {
    const beats = beatsOf(measureAt(track, s.measure));
    for (let k = s.from; k < s.to; k++) {
      if (isGrace(beats[k])) continue;
      count++;
      last = { measure: s.measure, beat: k };
      first ??= last;
    }
  }
  return { first, last, count };
}

/**
 * The selection of track `ti` from `anchor` to `focus`: `{ track, anchor,
 * focus, slices, info }`, or null when it covers no main beat. `info` is
 * the public shape `{ kind, track, start, end, beatCount, measures }`.
 */
export function selectionRange(score, ti, anchor, focus) {
  const a = { measure: anchor.measure, beat: anchor.beat };
  const f = { measure: focus.measure, beat: focus.beat };
  const slices = rangeSlices(score, ti, a, f);
  const span = mainSpan(score, ti, slices);
  if (!span.count) return null;
  const kind = slices.every((s) => s.first && s.last) ? 'measures' : 'beats';
  const measures = kind === 'measures' ? [slices[0].measure, slices[slices.length - 1].measure] : [span.first.measure, span.last.measure];
  const info = { kind, track: ti, start: span.first, end: span.last, beatCount: span.count, measures };
  return { track: ti, anchor: a, focus: f, slices, info };
}

/** A copy of the public info of `sel` (null without one). */
export const selectionInfo = (sel) => (sel ? { ...sel.info, start: { ...sel.info.start }, end: { ...sel.info.end }, measures: [...sel.info.measures] } : null);

/** Main-beat number (from 1) of beat index `k` in its measure. */
const beatNumber = (score, ti, mi, k) => beatsOf(measureAt(trackAt(score, ti), mi)).slice(0, k + 1).filter((b) => !isGrace(b)).length;

/** The announcement descriptor of selection `sel` (`all`: made by Select all). */
export function selectionWords(score, sel, all = false) {
  const { info } = sel;
  if (all) {
    const t = trackAt(score, info.track);
    return { id: 'selectedAll', n: info.track + 1, name: t ? String(t.name || t.label || '') : '', measures: measureCount(score) };
  }
  if (info.kind === 'measures') return { id: 'selectedMeasures', a: info.measures[0] + 1, b: info.measures[1] + 1, count: info.beatCount };
  const num = (p) => beatNumber(score, info.track, p.measure, p.beat);
  return { id: 'selectedBeats', m1: info.start.measure + 1, b1: num(info.start), m2: info.end.measure + 1, b2: num(info.end), count: info.beatCount };
}

/** The first position of the score on the cursor's track (Select all's anchor). */
export const startOf = (score, cursor) => ({ measure: 0, beat: positions(score, { ...cursor, measure: 0 })[0] });

const at = (cursor, measure, beat) => ({ cursor: { ...cursor, measure, beat } });
const lastPos = (score, cursor, mi) => { const p = positions(score, { ...cursor, measure: mi }); return p[p.length - 1]; };

export const selectLeft = moveLeft;
/** Shift+Right never appends a measure. */
export const selectRight = (score, cursor, state, ctx) => moveRight(score, cursor, state, { ...ctx, allowAppend: false });
export const selectMeasureStart = measureStart;
export const selectMeasureEnd = measureEnd;
/** The first position of this measure; when already there, of the previous one. */
export function selectPrevMeasure(score, cursor) {
  const p = positions(score, cursor);
  if (cursor.beat !== p[0]) return at(cursor, cursor.measure, p[0]);
  if (cursor.measure === 0) return { announce: { id: 'startOfScore' } };
  return at(cursor, cursor.measure - 1, positions(score, { ...cursor, measure: cursor.measure - 1 })[0]);
}
/** The last position of this measure; when already there, of the next one. */
export function selectNextMeasure(score, cursor) {
  const last = lastPos(score, cursor, cursor.measure);
  if (cursor.beat !== last) return at(cursor, cursor.measure, last);
  if (cursor.measure >= measureCount(score) - 1) return { announce: { id: 'endOfScore' } };
  return at(cursor, cursor.measure + 1, lastPos(score, cursor, cursor.measure + 1));
}
/** Ctrl+A: the focus goes to the last position of the last measure (the anchor is startOf). */
export function selectAll(score, cursor) {
  const mi = measureCount(score) - 1;
  return at(cursor, mi, lastPos(score, cursor, mi));
}

/** Whether track `ti` exists (selection calls name tracks by index). */
export const hasTrack = (score, ti) => ti >= 0 && ti < tracksOf(score).length;
