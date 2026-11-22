/**
 * model/rangeEdit.js — the 2.3 delete keys with a selection (`ctx.selection`,
 * model/selection.js): Delete / Backspace turns the selected beats into
 * rests of the same lengths (clearRange), Ctrl+Delete removes them with
 * their graces (removeRange), Shift+Delete deletes the selected columns of
 * a measures selection (deleteSelectedColumns). Each is one command, so
 * one undo step; ties at the edges are repaired, and tempo marks that go
 * with removed beats are counted for the announcement.
 */
import { measureCount, beatsAt, isGrace, isRest, without, updateBeats } from './access.js';
import { fixTiesIn } from './ties.js';
import { deleteColumns } from './measures.js';
import { tempoMarks } from './settings/tempo.js';

/** The first slice of `slices` with a main beat in it, on `track` of `score`. */
function firstFilled(score, track, slices) {
  return slices.find((s) => beatsAt(score, { track, measure: s.measure }).slice(s.from, s.to).some((b) => !isGrace(b))) ?? slices[0];
}

/** Winning tempo marks (the drawn ones) on track `track` inside `slices`. */
export function tempoIn(score, track, slices) {
  const by = new Map(slices.map((s) => [s.measure, s]));
  return tempoMarks(score).winners.filter((w) => {
    const s = w.track === track && by.get(w.measure);
    return s && w.beat >= s.from && w.beat < s.to;
  }).length;
}

/** `score` with each slice's beats [from, to) replaced by fn(beats) on track `track`, then its ties repaired (`score` itself when no slice has beats). Exported for range edits to come (2.3.1 effects and transpose). */
export function eachSlice(score, track, slices, fn) {
  let out = score;
  for (const s of slices) {
    if (s.from >= s.to) continue;
    out = updateBeats(out, { track, measure: s.measure }, (bs) => [...bs.slice(0, s.from), ...fn(bs.slice(s.from, s.to)), ...bs.slice(s.to)]);
  }
  return out === score ? score : fixTiesIn(out, track, slices[0].measure, slices[slices.length - 1].measure);
}

/** A note beat as a rest of the same length (effects, unknown fields and tempo kept); rests unchanged. */
const asRest = (b) => (isRest(b) ? b : { ...without(b, 'notes', 'slash'), type: 'rest' });

/**
 * `score` with the selection's graces removed and its note beats turned
 * into rests: `{ score, cursor, count }` (score unchanged when there was
 * nothing to change; the cursor on the first selected beat).
 */
export function clearSlices(score, sel) {
  const { track, slices } = sel;
  const first = firstFilled(score, track, slices);
  let changed = false;
  const out = eachSlice(score, track, slices, (part) => {
    const next = part.filter((b) => !isGrace(b)).map(asRest);
    if (next.length !== part.length || next.some((b, i) => b !== part[i])) changed = true;
    return next;
  });
  return { score: changed ? out : score, cursor: { measure: first.measure, beat: first.from }, count: sel.info.beatCount };
}

/** `score` with the selection's beats and graces removed: `{ score, cursor, count, tempoRemoved }`. */
export function removeSlices(score, sel) {
  const { track, slices } = sel;
  const first = firstFilled(score, track, slices);
  return {
    score: eachSlice(score, track, slices, () => []),
    cursor: { measure: first.measure, beat: first.from },
    count: sel.info.beatCount,
    tempoRemoved: tempoIn(score, track, slices),
  };
}

/** Delete / Backspace with a selection. */
export function clearRange(score, cursor, state, ctx) {
  const r = clearSlices(score, ctx.selection);
  const id = r.score === score ? 'rangeAlreadyRests' : 'rangeCleared'; // nothing to change: say so
  return { score: r.score, cursor: { ...cursor, ...r.cursor }, announce: { id, count: r.count } };
}

/** Ctrl+Delete / Ctrl+Backspace with a selection; a zero-beat selection (blank measures) has no beats to delete. */
export function removeRange(score, cursor, state, ctx) {
  if (!ctx.selection.info.beatCount) return { announce: { id: 'rangeNoBeats' } };
  const r = removeSlices(score, ctx.selection);
  return { score: r.score, cursor: { ...cursor, ...r.cursor }, announce: { id: 'rangeRemoved', count: r.count, tempoRemoved: r.tempoRemoved } };
}

/** Shift+Delete with a selection: refused unless it covers whole measures; then those columns go from every track. */
export function deleteSelectedColumns(score, cursor, state, ctx) {
  const { info } = ctx.selection;
  if (info.kind !== 'measures') return { announce: { id: 'needsMeasureSelection' } };
  const [a, b] = info.measures;
  const all = a === 0 && b >= measureCount(score) - 1;
  const tempoRemoved = tempoMarks(score).winners.filter((w) => w.measure >= a && w.measure <= b).length;
  const out = deleteColumns(score, a, b);
  const announce = { id: 'columnsDeleted', a: a + 1, b: b + 1, all, tempoRemoved };
  return { score: out, cursor: { ...cursor, measure: Math.min(a, measureCount(out) - 1), beat: 0 }, announce };
}

/** Command `single`, or `range` when a selection is live (ctx.selection). */
export const ranged = (single, range) => (score, cursor, state, ctx, arg) => (ctx?.selection ? range : single)(score, cursor, state, ctx, arg);
