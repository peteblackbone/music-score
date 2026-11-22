/**
 * model/notes.js — note-level commands on the cursor string: fret entry
 * (with the two-digit buffer), delete note and toggle tie. TAB tracks only;
 * notation-only tracks refuse them.
 *
 * Fret entry writes `string` and `fret`, deletes `pitch` on the note it
 * frets and `slash` on the beat, and never writes pitch, soundingPitch or
 * fromFret. Every shape it produces is one sanitize keeps unchanged.
 */
import {
  trackAt, hasTab, beatsAt, isRest, notesOf, noteOn, noteIndexOn, updateBeat, updateBeats, updateNote, without,
} from './access.js';
import { prevMainBeat, fixSeam, fixSeamsAround, nextMainBeat, untiePartners, stripFlag } from './ties.js';

const refuse = (id, extra) => ({ announce: { id, ...extra } });
const tabOnly = (score, cursor) => hasTab(trackAt(score, cursor.track));

/** Whether the digit buffer `buf` is live at `cursor` at time `now`. */
export const bufferLive = (buf, cursor, ctx) => !!buf && buf.track === cursor.track && buf.measure === cursor.measure
  && buf.beat === cursor.beat && buf.string === cursor.string && ctx.now - buf.time <= ctx.twoDigitDelayMs;

/**
 * Digit `n` on the cursor string (E1–E3, E11). A second digit within the
 * delay at the same position makes first·10 + n when that is ≤ maxFret
 * (`coalesce: true`, buffer cleared); otherwise `n` applies and starts a
 * new buffer.
 */
export function digit(score, cursor, state, ctx, n) {
  const noBuf = { ...state, digit: null };
  if (!tabOnly(score, cursor)) return { state: noBuf, ...refuse('refusedNoTab') };
  if (!(n <= ctx.maxFret)) return { state: noBuf, ...refuse('refusedMaxFret', { max: ctx.maxFret }) };
  const { track: ti, measure: mi, beat: bi, string: s } = cursor;
  const buf = state.digit;
  let fret = n;
  let coalesce = false;
  let next = { track: ti, measure: mi, beat: bi, string: s, first: n, time: ctx.now };
  if (bufferLive(buf, cursor, ctx) && buf.first * 10 + n <= ctx.maxFret) {
    fret = buf.first * 10 + n;
    coalesce = true;
    next = null;
  }
  const beats = beatsAt(score, ti, mi);
  let out = score;
  let announce = { id: 'fret', fret };
  if (bi >= beats.length) {
    // append slot or empty measure: a new note beat after any trailing graces (which then lead into it)
    const beat = { type: 'note', duration: state.duration, ...(state.dots ? { dots: state.dots } : {}), notes: [{ string: s, fret }] };
    out = updateBeats(score, ti, mi, (bs) => [...bs, beat]);
    out = fixSeamsAround(out, ti, mi, beats.length);
  } else if (isRest(beats[bi])) {
    out = updateBeat(score, ti, mi, bi, (b) => ({ ...without(b, 'hidden', 'slash'), type: 'note', notes: [{ string: s, fret }] }));
    out = fixSeamsAround(out, ti, mi, bi, s);
  } else {
    const old = noteOn(beats[bi], s);
    if (old && old.fret !== fret) {
      // re-fretting unties the note and its partners
      out = untiePartners(score, ti, mi, bi, s);
      out = updateNote(out, ti, mi, bi, s, (x) => ({ ...without(x, 'pitch', 'tieStart', 'tieEnd'), fret }));
    } else if (!old) {
      out = updateBeat(score, ti, mi, bi, (b) => ({ ...b, notes: [...notesOf(b), { string: s, fret }] }));
      out = fixSeamsAround(out, ti, mi, bi, s);
      const count = notesOf(beats[bi]).length + 1;
      if (count > 1) announce = { id: 'chordNote', fret, count };
    }
    out = updateBeat(out, ti, mi, bi, (b) => without(b, 'slash'));
  }
  return { score: out, state: { ...state, digit: next }, announce, coalesce };
}

/** Delete the note on the cursor string (E5); the last note leaves a rest of the same duration. Partners are untied. */
export function deleteNote(score, cursor) {
  if (!tabOnly(score, cursor)) return refuse('needsTab');
  const { track: ti, measure: mi, beat: bi, string: s } = cursor;
  const beat = beatsAt(score, ti, mi)[bi];
  if (!beat || isRest(beat) || noteIndexOn(beat, s) < 0) return refuse('noNote');
  let out = untiePartners(score, ti, mi, bi, s);
  let nowRest = false;
  out = updateBeat(out, ti, mi, bi, (b) => {
    const k = noteIndexOn(b, s);
    const notes = b.notes.filter((_, i) => i !== k);
    if (notes.length) return { ...b, notes };
    nowRest = true;
    return { ...without(b, 'notes', 'slash'), type: 'rest' };
  });
  return { score: out, announce: { id: nowRest ? 'noteDeletedRest' : 'noteDeleted' } };
}

/**
 * Toggle the tie into the cursor note (E7): with `tieEnd`, remove it and the
 * partner's `tieStart`; otherwise tie from the note on the same string of
 * the previous main beat (maybe in the previous measure), copying its fret.
 */
export function toggleTie(score, cursor) {
  if (!tabOnly(score, cursor)) return refuse('needsTab');
  const { track: ti, measure: mi, beat: bi, string: s } = cursor;
  const beat = beatsAt(score, ti, mi)[bi];
  const note = beat && !isRest(beat) ? noteOn(beat, s) : null;
  if (!note) return refuse('noNoteHere');
  const here = { mi, bi };
  if (note.tieEnd) {
    const out = stripFlag(score, ti, prevMainBeat(score, ti, mi, bi), s, 'tieStart');
    return { score: stripFlag(out, ti, here, s, 'tieEnd'), announce: { id: 'tieRemoved' } };
  }
  const p = prevMainBeat(score, ti, mi, bi);
  const pb = p ? beatsAt(score, ti, p.mi)[p.bi] : null;
  const pn = pb && !isRest(pb) ? noteOn(pb, s) : null;
  if (!pn || pn.fret == null) return refuse('nothingToTie');
  let out = updateNote(score, ti, p.mi, p.bi, s, (x) => (x.tieStart === true ? x : { ...x, tieStart: true }));
  out = updateNote(out, ti, mi, bi, s, (x) => ({ ...without(x, 'pitch'), tieEnd: true, fret: pn.fret }));
  // a different fret breaks the tie onward
  if (note.fret !== pn.fret && note.tieStart) out = fixSeam(stripFlag(out, ti, here, s, 'tieStart'), ti, here, nextMainBeat(out, ti, mi, bi), s);
  return { score: out, announce: { id: 'tiedTo', fret: pn.fret } };
}
