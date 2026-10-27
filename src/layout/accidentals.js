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
 * - grace notes draw no accidentals and don't affect the measure's state.
 *
 * Pure function, no DOM.
 */
import { parsePitch, createAccidentalState, accidentalNameForAlter, keySignatureAlterations } from '../pitch.js';

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
  return measure.beats.map((el) => {
    const notes = el.notes || [];
    if (el.type === 'grace' || el.type === 'rest') {
      return { names: notes.map(() => null), restate: notes.map(() => null) };
    }
    const names = [];
    const restate = [];
    notes.forEach((n) => {
      if (n.pitch == null) { names.push(null); restate.push(null); return; }
      const p = parsePitch(n.pitch);
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
  });
}
