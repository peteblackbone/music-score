/**
 * layout/accidentals.js — which accidental each notehead of a measure
 * shows (ui.md §7), with accidentals carrying through the measure:
 *
 * - an altered step+octave keeps its alteration until the barline; a later
 *   note on the same step+octave gets an accidental only if its alteration
 *   differs (including a cancelling natural);
 * - a tied continuation (`tieEnd`) gets none and changes nothing, but its
 *   accidental relative to the key signature is reported as `restate`, to
 *   be shown when the note opens a new system;
 * - an explicit `note.accidental` is always drawn (compatibility) and
 *   becomes the active alteration;
 * - grace notes take part like any other note, in score order: an altered
 *   grace carries into the main notes after it and vice versa;
 * - in a two-voice measure both voices share the carry, in onset order
 *   (voice 1 first at the same onset; graces just before their note).
 *
 * Pure function, no DOM.
 */
import { displayPitch, createAccidentalState, accidentalNameForAlter, keySignatureAlterations } from '../pitch.js';
import { durationR } from '../duration.js';
import { ZERO, add, cmp } from '../rational.js';

/** Names and restates of one beat's notes, advancing the measure's accidental `state`. */
function resolveBeat(state, keyAlters, el) {
  const notes = el.notes || [];
  if (el.type === 'rest') {
    return { names: notes.map(() => null), restate: notes.map(() => null) };
  }
  const names = [];
  const restate = [];
  notes.forEach((n) => {
    if (n.pitch == null) { names.push(null); restate.push(null); return; }
    const p = displayPitch(n); // step + displayed octave (an ottava run moves the octave)
    if (n.accidental) {
      names.push(n.accidental); restate.push(n.accidental);
      state.set(p);
      return;
    }
    const keyName = p.alter !== (keyAlters[p.step] || 0) ? accidentalNameForAlter(p.alter) : null;
    if (n.tieEnd) {
      names.push(null); restate.push(keyName);
      return;
    }
    const name = p.alter !== state.current(p) ? accidentalNameForAlter(p.alter) : null;
    if (name) state.set(p);
    names.push(name); restate.push(name);
  });
  return { names, restate };
}

/**
 * @param {object} track - normalized track (notes carry their written `pitch`)
 * @param {number} mi - measure index
 * @returns {{ names: (string|null)[], restate: (string|null)[] }[]} one entry
 *   per beat of the measure, one value per note (null = no accidental).
 */
export function resolveMeasureAccidentals(track, mi) {
  const measure = track.measures[mi];
  const state = createAccidentalState(measure.keySignature);
  const keyAlters = keySignatureAlterations(measure.keySignature);
  return measure.beats.map((el) => resolveBeat(state, keyAlters, el));
}

/**
 * Both voices of a two-voice measure: `[perBeat1, perBeat2]`, each shaped
 * like resolveMeasureAccidentals' result, resolved in one shared carry.
 */
export function resolveVoiceAccidentals(track, mi) {
  const measure = track.measures[mi];
  const state = createAccidentalState(measure.keySignature);
  const keyAlters = keySignatureAlterations(measure.keySignature);
  // Onset of every beat (a grace takes its next main beat's onset, trailing graces the voice's end).
  const order = [];
  // plain data access: only two-voice measures have `voice2Beats` (twoVoice.js)
  [measure.beats, measure.voice2Beats || []].forEach((beats, v) => {
    let t = ZERO;
    let pending = [];
    beats.forEach((el, bi) => {
      const item = { v, bi, el, t: null };
      order.push(item);
      if (el.type === 'grace') { pending.push(item); return; }
      item.t = t;
      pending.forEach((g) => { g.t = t; });
      pending = [];
      t = add(t, durationR(el));
    });
    pending.forEach((g) => { g.t = t; });
  });
  order.sort((a, b) => cmp(a.t, b.t) || a.v - b.v || a.bi - b.bi);
  const out = [[], []];
  order.forEach(({ v, bi, el }) => { out[v][bi] = resolveBeat(state, keyAlters, el); });
  return out;
}
