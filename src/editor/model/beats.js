/**
 * model/beats.js — beat-level commands: duration, dots, triplet, rest/note
 * toggle, delete beat and insert beat. They work on notation-only tracks
 * too (except rest → note, which needs a string).
 *
 * No reflow (E4): only the cursor beat changes, plus the current duration
 * and dots in the editor state. On the append slot the duration commands
 * change the state only.
 */
import { validTuplets } from '../../duration.js';
import { trackAt, hasTab, beatsAt, isGrace, isRest, clampDots, updateBeat, updateBeats, without } from './access.js';
import { DURATIONS } from './durations.js';
import { fixSeam, fixSeamsAround, prevMainBeat, nextMainBeat } from './ties.js';

const cursorBeat = (score, c) => beatsAt(score, c.track, c.measure)[c.beat] ?? null;
/** A new rest with the current duration and dots (no `dots` key at 0). */
const newRest = (state) => ({ type: 'rest', duration: state.duration, ...(state.dots ? { dots: state.dots } : {}) });

/** Set the cursor beat's duration (or the next duration on the slot) to `name`. */
function applyDuration(score, cursor, state, name) {
  const beat = cursorBeat(score, cursor);
  if (!beat) return { state: { ...state, duration: name }, announce: { id: 'nextDuration', duration: name, dots: state.dots } };
  const out = beat.duration === name ? score : updateBeat(score, cursor.track, cursor.measure, cursor.beat, (b) => ({ ...b, duration: name }));
  return { score: out, state: { ...state, duration: name }, announce: { id: 'duration', duration: name, dots: clampDots(beat.dots) } };
}

const step = (d) => (score, cursor, state) => {
  const beat = cursorBeat(score, cursor);
  const i = DURATIONS.indexOf(beat ? beat.duration : state.duration) + d;
  if (i < 0 || i >= DURATIONS.length) return { announce: { id: 'limit' } };
  return applyDuration(score, cursor, state, DURATIONS[i]);
};
/** Halve the duration, down to a 64th. */
export const shorter = step(1);
/** Double the duration, up to a whole. */
export const longer = step(-1);

/** Set the duration directly (additive API: ScoreEditor.setDuration). */
export function setDuration(score, cursor, state, ctx, name) {
  if (!DURATIONS.includes(name)) return { announce: { id: 'limit' } };
  return applyDuration(score, cursor, state, name);
}

/** Dots 0 → 1 → 2 → 0 (3 or 4 → 0); the key is deleted at 0. */
export function cycleDots(score, cursor, state) {
  const beat = cursorBeat(score, cursor);
  const cur = clampDots(beat ? beat.dots : state.dots);
  const dots = cur === 0 ? 1 : cur === 1 ? 2 : 0;
  const announce = { id: 'dots', duration: beat ? beat.duration : state.duration, dots };
  if (!beat) return { state: { ...state, dots }, announce };
  const out = updateBeat(score, cursor.track, cursor.measure, cursor.beat, (b) => (dots ? { ...b, dots } : without(b, 'dots')));
  return { score: out, state: { ...state, dots }, announce };
}

/** Toggle `tuplet: 3` on the cursor beat; refused on the slot and on beats with valid nested `tuplets`. */
export function toggleTriplet(score, cursor) {
  const beat = cursorBeat(score, cursor);
  if (!beat) return { announce: { id: 'noBeat' } };
  if (validTuplets(beat.tuplets)) return { announce: { id: 'nestedTuplet' } };
  const on = beat.tuplet == null;
  const out = updateBeat(score, cursor.track, cursor.measure, cursor.beat, (b) => (on ? { ...b, tuplet: 3 } : without(b, 'tuplet')));
  return { score: out, announce: { id: on ? 'tripletOn' : 'tripletOff' } };
}

/**
 * R: note → rest (notes and slash deleted, ties repaired); rest → note with
 * fret 0 on the cursor string (TAB tracks only); on the slot, a rest with
 * the current duration is appended and the cursor stays on it.
 */
export function toggleRest(score, cursor, state) {
  const { track: ti, measure: mi, beat: bi, string: s } = cursor;
  const beat = cursorBeat(score, cursor);
  if (!beat) {
    const at = beatsAt(score, ti, mi).length;
    const out = fixSeamsAround(updateBeats(score, ti, mi, (bs) => [...bs, newRest(state)]), ti, mi, at);
    return { score: out, cursor: { ...cursor, beat: at }, announce: { id: 'restInserted', duration: state.duration, dots: state.dots } };
  }
  if (!isRest(beat)) {
    const out = fixSeamsAround(updateBeat(score, ti, mi, bi, (b) => ({ ...without(b, 'notes', 'slash'), type: 'rest' })), ti, mi, bi);
    return { score: out, announce: { id: 'changedToRest' } };
  }
  if (!hasTab(trackAt(score, ti))) return { announce: { id: 'refusedNoTab' } };
  const out = updateBeat(score, ti, mi, bi, (b) => ({ ...without(b, 'hidden'), type: 'note', notes: [{ string: s, fret: 0 }] }));
  return { score: fixSeamsAround(out, ti, mi, bi, s), announce: { id: 'changedToNote' } };
}

/** First index of the run of graces just before index `k`. */
function leadingGraces(beats, k) {
  let i = k;
  while (i > 0 && isGrace(beats[i - 1])) i--;
  return i;
}

/** Delete the cursor beat with the graces just before it (E6); the cursor keeps the index (clamped later). */
export function deleteBeat(score, cursor) {
  const { track: ti, measure: mi, beat: bi } = cursor;
  const beats = beatsAt(score, ti, mi);
  if (bi >= beats.length) return { announce: { id: 'noBeat' } };
  const k = leadingGraces(beats, bi);
  let out = updateBeats(score, ti, mi, (bs) => [...bs.slice(0, k), ...bs.slice(bi + 1)]);
  out = fixSeam(out, ti, prevMainBeat(out, ti, mi, k), nextMainBeat(out, ti, mi, k - 1));
  return { score: out, cursor: { ...cursor, beat: k }, announce: { id: 'beatDeleted' } };
}

/** Insert a rest with the current duration before the cursor beat and its leading graces (E8); the cursor moves onto it. */
export function insertBeat(score, cursor, state) {
  const { track: ti, measure: mi, beat: bi } = cursor;
  const beats = beatsAt(score, ti, mi);
  const k = leadingGraces(beats, Math.min(bi, beats.length));
  const out = updateBeats(score, ti, mi, (bs) => [...bs.slice(0, k), newRest(state), ...bs.slice(k)]);
  return { score: fixSeamsAround(out, ti, mi, k), cursor: { ...cursor, beat: k }, announce: { id: 'restInserted', duration: state.duration, dots: state.dots } };
}
