/**
 * model/cursor.js — cursor positions, clamping, moves and the cursor
 * summary (getCursorInfo).
 *
 * Cursor: `{ track, measure, beat, string }`, always in voice 1. The
 * positions of a measure are its non-grace voice-1 beat indices, plus
 * `beats.length` (the append slot) when the measure is underfull or empty.
 * Moves are commands `(score, cursor, state, ctx) → { cursor, announce }`;
 * a move at an edge changes nothing (still consumed).
 */
import { toNumber, sub } from '../../rational.js';
import { validTuplets } from '../../duration.js';
import {
  tracksOf, trackAt, beatsAt, isGrace, isRest, isVisible, hasTab, hasNotation, measureCount, stringCount, clampDots, notesOf, noteOn,
} from './access.js';
import { measureFill, onsetOf } from './fill.js';
import { STANDARD_TUNING } from './defaultScore.js';
import { appendMeasure } from './measures.js';

const int = (v, d) => (Number.isFinite(v) ? Math.trunc(v) : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Cursor positions of track `ti` measure `mi` (see the header); never empty. */
export function positions(score, ti, mi) {
  const beats = beatsAt(score, ti, mi);
  const out = [];
  beats.forEach((b, i) => { if (!isGrace(b)) out.push(i); });
  if (measureFill(score, ti, mi) === 'under') out.push(beats.length);
  return out;
}

/** Index of the nearest visible track to `ti` (itself first, then ±1, ±2 …, lower first), or -1. */
function nearestVisible(tracks, ti) {
  for (let d = 0; d < tracks.length; d++) {
    if (isVisible(tracks[ti - d])) return ti - d;
    if (isVisible(tracks[ti + d])) return ti + d;
  }
  return -1;
}

/** `c` moved to a valid position: a visible track, an existing measure, a position at or after its beat, a string of the track. */
export function clampCursor(score, c) {
  const tracks = tracksOf(score);
  const want = clamp(int(c.track, 0), 0, Math.max(0, tracks.length - 1));
  const vis = nearestVisible(tracks, want);
  const track = vis < 0 ? want : vis;
  const measure = clamp(int(c.measure, 0), 0, measureCount(score) - 1);
  const pos = positions(score, track, measure);
  const b = int(c.beat, 0);
  const beat = pos.find((p) => p >= b) ?? pos[pos.length - 1];
  const string = clamp(int(c.string, 1), 1, stringCount(tracks[track]));
  return { track, measure, beat, string };
}

export const sameCursor = (a, b) => a.track === b.track && a.measure === b.measure && a.beat === b.beat && a.string === b.string;

/** `state` with the current duration and dots of the cursor beat (unchanged on the append slot). */
export function syncDuration(score, cursor, state) {
  const b = beatsAt(score, cursor.track, cursor.measure)[cursor.beat];
  if (!b || isGrace(b)) return state;
  const dots = clampDots(b.dots);
  return state.duration === b.duration && state.dots === dots ? state : { ...state, duration: b.duration, dots };
}

const at = (cursor, measure, beat) => ({ ...cursor, measure, beat });
const edge = (id) => ({ announce: { id } });

export function moveLeft(score, cursor) {
  const pos = positions(score, cursor.track, cursor.measure);
  const i = pos.indexOf(cursor.beat);
  if (i > 0) return { cursor: at(cursor, cursor.measure, pos[i - 1]) };
  if (cursor.measure === 0) return edge('startOfScore');
  const prev = positions(score, cursor.track, cursor.measure - 1);
  return { cursor: at(cursor, cursor.measure - 1, prev[prev.length - 1]) };
}

/**
 * Right: the next position, else the next measure's first. On the last beat
 * of a full (or overfull) last measure, with ctx.allowAppend, an empty
 * measure is appended and the cursor moves into it (an edit, one undo step).
 */
export function moveRight(score, cursor, state, ctx) {
  const pos = positions(score, cursor.track, cursor.measure);
  const i = pos.indexOf(cursor.beat);
  if (i >= 0 && i < pos.length - 1) return { cursor: at(cursor, cursor.measure, pos[i + 1]) };
  const count = measureCount(score);
  if (cursor.measure < count - 1) return { cursor: at(cursor, cursor.measure + 1, positions(score, cursor.track, cursor.measure + 1)[0]) };
  if (cursor.beat < beatsAt(score, cursor.track, cursor.measure).length && ctx?.allowAppend) {
    return { score: appendMeasure(score), cursor: at(cursor, count, 0), announce: { id: 'measureAdded', n: count + 1 } };
  }
  return edge('endOfScore');
}

const moveString = (d) => (score, cursor) => {
  if (!hasTab(trackAt(score, cursor.track))) return {};
  const string = clamp(cursor.string + d, 1, stringCount(trackAt(score, cursor.track)));
  return { cursor: { ...cursor, string } };
};
export const moveUp = moveString(-1);
export const moveDown = moveString(1);

const firstOf = (score, cursor, mi) => at(cursor, mi, positions(score, cursor.track, mi)[0]);
export function prevMeasure(score, cursor) {
  return cursor.measure > 0 ? { cursor: firstOf(score, cursor, cursor.measure - 1) } : edge('startOfScore');
}
export function nextMeasure(score, cursor) {
  return cursor.measure < measureCount(score) - 1 ? { cursor: firstOf(score, cursor, cursor.measure + 1) } : edge('endOfScore');
}
export const measureStart = (score, cursor) => ({ cursor: firstOf(score, cursor, cursor.measure) });
export function measureEnd(score, cursor) {
  const pos = positions(score, cursor.track, cursor.measure);
  return { cursor: at(cursor, cursor.measure, pos[pos.length - 1]) };
}
export const scoreStart = (score, cursor) => ({ cursor: firstOf(score, cursor, 0) });
/** Last measure, its last non-grace beat (0 when it has none; clamping then finds the position). */
export function scoreEnd(score, cursor) {
  const mi = measureCount(score) - 1;
  const beats = beatsAt(score, cursor.track, mi);
  let last = 0;
  beats.forEach((b, i) => { if (!isGrace(b)) last = i; });
  return { cursor: at(cursor, mi, last) };
}

/** The next visible track in direction `d`, at the same measure, on the position with the nearest onset (ties: the earlier). */
const changeTrack = (d) => (score, cursor) => {
  const tracks = tracksOf(score);
  let ti = cursor.track + d;
  while (ti >= 0 && ti < tracks.length && !isVisible(tracks[ti])) ti += d;
  if (ti < 0 || ti >= tracks.length) return edge(d < 0 ? 'firstTrack' : 'lastTrack');
  const t0 = onsetOf(beatsAt(score, cursor.track, cursor.measure), cursor.beat);
  const beats = beatsAt(score, ti, cursor.measure);
  let beat = null;
  let best = Infinity;
  for (const p of positions(score, ti, cursor.measure)) {
    const dist = Math.abs(toNumber(sub(onsetOf(beats, p), t0)));
    if (dist < best) { best = dist; beat = p; }
  }
  return { cursor: { track: ti, measure: cursor.measure, beat, string: clamp(cursor.string, 1, stringCount(tracks[ti])) } };
};
export const prevTrack = changeTrack(-1);
export const nextTrack = changeTrack(1);

/** Everything the status bar, announcements and overlay need about the cursor (getCursorInfo). */
export function cursorInfo(score, cursor, state) {
  const tracks = tracksOf(score);
  const track = tracks[cursor.track];
  const beats = beatsAt(score, cursor.track, cursor.measure);
  const b = cursor.beat < beats.length ? beats[cursor.beat] : null;
  const tab = hasTab(track);
  const note = b && tab ? noteOn(b, cursor.string) : null;
  const strings = stringCount(track);
  let beatNumber = 0;
  let beatTotal = 0;
  beats.forEach((x, i) => { if (!isGrace(x)) { beatTotal++; if (i <= cursor.beat) beatNumber++; } });
  return {
    track: cursor.track,
    measure: cursor.measure,
    beat: cursor.beat,
    string: cursor.string,
    voice: 1,
    fret: note && note.fret != null ? note.fret : null,
    duration: b ? b.duration : state.duration,
    dots: b ? clampDots(b.dots) : state.dots,
    triplet: !!b && b.tuplet != null && !validTuplets(b.tuplets),
    isRest: !!b && isRest(b),
    appendSlot: !b,
    empty: beatTotal === 0,
    fill: measureFill(score, cursor.track, cursor.measure),
    measureCount: measureCount(score),
    trackName: track ? String(track.name || track.label || '') : '',
    trackCount: tracks.length,
    stringCount: strings,
    tuningNote: tab ? (Array.isArray(track.tuning) && track.tuning.length ? track.tuning : STANDARD_TUNING)[strings - cursor.string] : null,
    hasTab: tab,
    hasNotation: hasNotation(track),
    beatNumber: b ? beatNumber : beatTotal,
    beatTotal,
    noteCount: notesOf(b).length,
    tied: !!note && !!(note.tieStart || note.tieEnd),
    frets: notesOf(b).filter((n) => n.fret != null).map((n) => n.fret),
  };
}
