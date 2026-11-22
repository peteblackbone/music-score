/**
 * model/effects.js — effect commands built from the rows of effectTable.js,
 * and the effect words of the cursor position.
 *
 * effectCommand(def) is a 2.0-style command `(score, loc, state) →
 * { score?, announce }`. In order: a note row on a track without TAB says
 * needsTab; X where there is no note (slot, rest, empty string) adds a dead
 * note through the digit path; the slot says noBeat; a note row with no
 * note on the string says noNoteHere and a beat row on a rest (unless the
 * row works on rests) needsNote; otherwise the target steps to the row's
 * next value and the command announces `{ id: 'effect', name, step,
 * suffix }` (step -1 = off). Note rows act on the voice-1 note on the
 * cursor string; other notes of a chord keep their identity. Turning an
 * effect off deletes its keys; it never writes `false`.
 *
 * effectRange(def) (2.3.1) is the same row over a selection
 * (ctx.selection): note rows act on every voice-1 note with a string on the
 * selected non-rest main beats (TAB tracks only), beat rows on every
 * selected main beat (rests too with `onRest`); graces and voice 2 are left
 * alone and X never adds a note. When every target is at the same step they
 * all go to the next one, else all go to the start step. Ties are not
 * touched, so they are not repaired either.
 */
import {
  trackAt, hasTab, beatAt, isRest, isGrace, cursorNote, updateBeat, updateNote, without, measureAt, beatsOf, notesOf,
} from './access.js';
import { eachSlice } from './rangeEdit.js';
import { fretIntoSlot, fretIntoRest, fretIntoNote } from './notes.js';
import { EFFECTS, SUFFIXES } from './effectTable.js';

export { noLaterNoteOnString } from './effectTable.js';

const refuse = (id) => ({ announce: { id } });

/** The step after step `i` of row `def` (-1 = none or custom; the result -1 = off). */
export function nextStep(def, i) {
  if (i < 0) return def.start ?? (def.dir < 0 ? def.steps.length - 1 : 0);
  const n = i + def.dir;
  return n >= 0 && n < def.steps.length ? n : -1;
}

/**
 * `target` (a note or beat) with step `step` of row `def` written: the
 * owned keys the patch doesn't set are deleted (and the row's exclusive
 * keys), then the patch is spread, so keys already there keep their place.
 * Off (-1) deletes every owned key.
 */
export function writeStep(def, target, step) {
  if (def.write) return def.write(target, step, def);
  if (step < 0) return without(target, ...def.fields);
  const patch = def.steps[step];
  return { ...without(target, ...def.fields.filter((f) => !(f in patch)), ...def.exclusive), ...patch };
}

/** X where there is no note: fret 0 through the digit path (seams, ties, current duration on the slot), then `mute: true`. */
export function addDeadNote(score, loc, state) {
  const beat = beatAt(score, loc);
  const r = !beat ? fretIntoSlot(score, loc, state, 0) : isRest(beat) ? fretIntoRest(score, loc, 0) : fretIntoNote(score, loc, 0);
  return { score: updateNote(r.score, loc, (n) => ({ ...n, mute: true })), announce: { id: 'effect', name: 'deadNote', added: true } };
}

/** The spoken-suffix key (SUFFIXES) of row `def` after writing an "on" value at `loc` in `score`, or null. */
export function suffixOf(def, score, loc) {
  const sfx = Object.hasOwn(SUFFIXES, def.suffix ?? '') ? SUFFIXES[def.suffix] : null;
  return sfx && sfx.applies(score, loc, trackAt(score, loc.track)) ? def.suffix : null;
}

/** The command of effect row `def` (see the header). */
export function effectCommand(def) {
  const noteRow = def.level === 'note';
  return (score, loc, state) => {
    if (noteRow && !hasTab(trackAt(score, loc.track))) return refuse('needsTab');
    const beat = beatAt(score, loc);
    const target = noteRow ? cursorNote(score, loc) : beat;
    if (def.creates && !target) return addDeadNote(score, loc, state);
    if (!beat) return refuse('noBeat');
    if (noteRow && !target) return refuse('noNoteHere');
    if (!noteRow && isRest(beat) && !def.onRest) return refuse('needsNote');
    const step = nextStep(def, def.classify(target));
    const out = (noteRow ? updateNote : updateBeat)(score, loc, (t) => writeStep(def, t, step));
    return { score: out, announce: { id: 'effect', name: def.name, step, suffix: step >= 0 ? suffixOf(def, out, loc) : null } };
  };
}

/** The command of effect row `def` over the selection ctx.selection (see the header): one result, announced as `effectRange`. */
export function effectRange(def) {
  const noteRow = def.level === 'note';
  const onBeat = (b) => !isGrace(b) && (noteRow ? !isRest(b) && Array.isArray(b.notes) : !isRest(b) || def.onRest);
  const onNote = (n) => n.string != null;
  return (score, cursor, state, ctx) => {
    const { track: ti, slices } = ctx.selection;
    const track = trackAt(score, ti);
    if (noteRow && !hasTab(track)) return refuse('needsTab');
    const targets = [];
    for (const s of slices) {
      const beats = beatsOf(measureAt(track, s.measure));
      for (let k = s.from; k < s.to; k++) {
        if (!onBeat(beats[k])) continue;
        if (!noteRow) targets.push({ loc: { track: ti, measure: s.measure, beat: k }, t: beats[k] });
        else for (const n of notesOf(beats[k])) if (onNote(n)) targets.push({ loc: { track: ti, measure: s.measure, beat: k, string: n.string }, t: n });
      }
    }
    if (!targets.length) return refuse(!noteRow && def.onRest ? 'noBeatsInSelection' : 'noNotesInSelection');
    const steps = targets.map((x) => def.classify(x.t));
    const step = nextStep(def, steps.every((v) => v === steps[0]) ? steps[0] : -1);
    const write = (b) => {
      if (!onBeat(b)) return b;
      return noteRow ? { ...b, notes: b.notes.map((n) => (onNote(n) ? writeStep(def, n, step) : n)) } : writeStep(def, b, step);
    };
    const out = eachSlice(score, ti, slices, (part) => part.map(write), false);
    const suffix = step >= 0 && def.suffix && def.suffix !== 'link' ? suffixOf(def, out, targets[0].loc) : null;
    return { score: out, announce: { id: 'effectRange', name: def.name, step, count: targets.length, unit: noteRow ? 'note' : 'beat', suffix } };
  };
}

/**
 * The effects at `loc`, in table order: `note` words (TAB tracks with a note
 * on the cursor string), `beat` words (notes and rests) and `steps`,
 * `{ [rowName]: step }` for every effect present: the row's step index, or
 * -1 for a value the row doesn't write (custom). A row is present when its
 * value is one it writes, or (rows with `custom`) when its `info` lists
 * words; backward rows (`reverseOf`) are covered by their forward row. All empty
 * on the slot.
 */
export function effectState(score, loc) {
  const out = { note: [], beat: [], steps: {} };
  const beat = beatAt(score, loc);
  if (!beat) return out;
  const note = hasTab(trackAt(score, loc.track)) ? cursorNote(score, loc) : null;
  for (const d of EFFECTS) {
    const target = d.level === 'note' ? note : beat;
    if (!target || d.reverseOf) continue;
    const words = d.info ? d.info(target) : [];
    const step = d.classify(target);
    out[d.level].push(...words);
    if (step >= 0 || (d.custom && words.length)) out.steps[d.name] = step;
  }
  return out;
}

/** The effect words at `loc` (effectState without the steps): `{ note, beat }`. */
export function effectWords(score, loc) {
  const { note, beat } = effectState(score, loc);
  return { note, beat };
}
