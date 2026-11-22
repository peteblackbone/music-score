/**
 * model/notes.js — note-level commands on the cursor string: fret entry
 * (with the two-digit buffer), delete note and toggle tie. TAB tracks only;
 * notation-only tracks refuse them. The cursor is the location (access.js).
 *
 * Fret entry writes `string` and `fret`, deletes `pitch` on the note it
 * frets and `slash` on the beat, and never writes pitch, soundingPitch or
 * fromFret. Every shape it produces is one sanitize keeps unchanged.
 */
import {
  trackAt, hasTab, beatsAt, beatAt, isRest, notesOf, noteIndexOn, cursorNote,
  updateBeat, updateBeats, updateNote, without, locAt,
} from './access.js';
import { prevMainBeat, fixSeam, fixSeamsAround, nextMainBeat, untiePartners, stripFlag } from './ties.js';

const refuse = (id, extra) => ({ announce: { id, ...extra } });
const tabOnly = (score, loc) => hasTab(trackAt(score, loc.track));

/** Whether the digit buffer `buf` is live at `loc` at ctx.now. */
export const bufferLive = (buf, loc, ctx) => !!buf && buf.track === loc.track && buf.measure === loc.measure
  && buf.beat === loc.beat && buf.string === loc.string && ctx.now - buf.time <= ctx.twoDigitDelayMs;

/** Append slot or empty measure: a new note beat with the current duration, after any trailing graces (which then lead into it). */
export function fretIntoSlot(score, loc, state, fret) {
  const at = locAt(loc, { beat: beatsAt(score, loc).length });
  const beat = { type: 'note', duration: state.duration, ...(state.dots ? { dots: state.dots } : {}), notes: [{ string: loc.string, fret }] };
  return { score: fixSeamsAround(updateBeats(score, at, (bs) => [...bs, beat]), at), announce: { id: 'fret', fret } };
}

/** A rest becomes a note beat with this one note, keeping its other fields (`hidden` and `slash` dropped). */
export function fretIntoRest(score, loc, fret) {
  const out = updateBeat(score, loc, (b) => ({ ...without(b, 'hidden', 'slash'), type: 'note', notes: [{ string: loc.string, fret }] }));
  return { score: fixSeamsAround(out, loc, loc.string), announce: { id: 'fret', fret } };
}

/** A note beat: re-fret the note on the string (untying it when the fret changes) or add it to the chord; `slash` dropped. */
export function fretIntoNote(score, loc, fret) {
  const old = cursorNote(score, loc);
  let out = score;
  let announce = { id: 'fret', fret };
  if (old && old.fret !== fret) {
    out = updateNote(untiePartners(score, loc), loc, (x) => ({ ...without(x, 'pitch', 'tieStart', 'tieEnd'), fret }));
  } else if (!old) {
    const count = notesOf(beatAt(score, loc)).length + 1;
    out = updateBeat(score, loc, (b) => ({ ...b, notes: [...notesOf(b), { string: loc.string, fret }] }));
    out = fixSeamsAround(out, loc, loc.string);
    if (count > 1) announce = { id: 'chordNote', fret, count };
  }
  return { score: updateBeat(out, loc, (b) => without(b, 'slash')), announce };
}

/**
 * Digit `n` on the cursor string (E1–E3, E11). A second digit within the
 * delay at the same position makes first·10 + n when that is ≤ maxFret
 * (`coalesce: true`, buffer cleared); otherwise `n` applies and starts a
 * new buffer.
 */
export function digit(score, loc, state, ctx, n) {
  const noBuf = { ...state, digit: null };
  if (!tabOnly(score, loc)) return { state: noBuf, ...refuse('refusedNoTab') };
  if (!(n <= ctx.maxFret)) return { state: noBuf, ...refuse('refusedMaxFret', { max: ctx.maxFret }) };
  const buf = state.digit;
  const combine = bufferLive(buf, loc, ctx) && buf.first * 10 + n <= ctx.maxFret;
  const fret = combine ? buf.first * 10 + n : n;
  const next = combine ? null : { track: loc.track, measure: loc.measure, beat: loc.beat, string: loc.string, first: n, time: ctx.now };
  const beat = beatAt(score, loc);
  const r = !beat ? fretIntoSlot(score, loc, state, fret) : isRest(beat) ? fretIntoRest(score, loc, fret) : fretIntoNote(score, loc, fret);
  return { ...r, state: { ...state, digit: next }, coalesce: combine };
}

/** Delete the note on the cursor string (E5); the last note leaves a rest of the same duration. Partners are untied. */
export function deleteNote(score, loc) {
  if (!tabOnly(score, loc)) return refuse('needsTab');
  if (!cursorNote(score, loc)) return refuse('noNote');
  let nowRest = false;
  const out = updateBeat(untiePartners(score, loc), loc, (b) => {
    const k = noteIndexOn(b, loc.string);
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
export function toggleTie(score, loc) {
  if (!tabOnly(score, loc)) return refuse('needsTab');
  const note = cursorNote(score, loc);
  if (!note) return refuse('noNoteHere');
  if (note.tieEnd) {
    const out = stripFlag(score, prevMainBeat(score, loc), 'tieStart');
    return { score: stripFlag(out, loc, 'tieEnd'), announce: { id: 'tieRemoved' } };
  }
  const p = prevMainBeat(score, loc);
  const pn = p ? cursorNote(score, p) : null;
  if (!pn || pn.fret == null) return refuse('nothingToTie');
  let out = updateNote(score, p, (x) => (x.tieStart === true ? x : { ...x, tieStart: true }));
  out = updateNote(out, loc, (x) => ({ ...without(x, 'pitch'), tieEnd: true, fret: pn.fret }));
  // a different fret breaks the tie onward
  if (note.fret !== pn.fret && note.tieStart) out = fixSeam(stripFlag(out, loc, 'tieStart'), loc, nextMainBeat(out, loc), loc.string);
  return { score: out, announce: { id: 'tiedTo', fret: pn.fret } };
}
