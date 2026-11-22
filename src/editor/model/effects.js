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
 */
import {
  trackAt, hasTab, beatAt, isRest, cursorNote, updateBeat, updateNote, without,
} from './access.js';
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

/**
 * The effect words at `loc`, in table order: `note` (TAB tracks with a note
 * on the cursor string) and `beat` (notes and rests); both empty on the slot.
 */
export function effectWords(score, loc) {
  const out = { note: [], beat: [] };
  const beat = beatAt(score, loc);
  if (!beat) return out;
  const note = hasTab(trackAt(score, loc.track)) ? cursorNote(score, loc) : null;
  for (const d of EFFECTS) {
    const target = d.level === 'note' ? note : beat;
    if (d.info && target) out[d.level].push(...d.info(target));
  }
  return out;
}
