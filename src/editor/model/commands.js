/**
 * model/commands.js — the command registry and the one entry point that
 * runs a command against the model.
 *
 * Kinds: 'nav' (moves; Right may append a measure), 'edit' (refused in
 * read-only mode), 'history' (undo / redo, run by the controller),
 * 'buffer' (Escape, `cancelsBuffer`) and 2.3 'select' (moves that extend
 * the selection, run by the controller's _extend; `fromStart`: Select all;
 * 2.3.2 `edgeKeeps`: at an edge the selection stays; the column variants of
 * model/columns.js run while a column selection is live).
 * With a selection (ctx.selection) the three delete keys act on the range (model/rangeEdit.js), and (2.3.1) the effect
 * keys act on every selected beat or note (effects.js effectRange); `keepsSelection` marks the commands after
 * which the controller keeps the selection, re-derived, instead of clearing it. History commands name their `step`. Commands that can change the model carry their undo
 * `label`: a string, or a function of the command's announce descriptor. run() clamps the resulting cursor, clears the digit
 * buffer after anything but a digit, and re-syncs the current duration
 * when the position or the model changed.
 */
import {
  moveLeft, moveRight, moveUp, moveDown, prevMeasure, nextMeasure, measureStart, measureEnd, scoreStart, scoreEnd,
  prevTrack, nextTrack, clampCursor, sameCursor, syncDuration,
} from './cursor.js';
import { digit, deleteNote, toggleTie } from './notes.js';
import { shorter, longer, setDuration, cycleDots, toggleTriplet, toggleRest, deleteBeat, insertBeat } from './beats.js';
import { insertMeasureAfter, insertMeasureBefore, deleteMeasure } from './measures.js';
import { trackAt, isVisible } from './access.js';
import { EFFECTS } from './effectTable.js';
import { effectCommand, effectRange } from './effects.js';
import {
  selectLeft, selectRight, selectMeasureStart, selectMeasureEnd, selectPrevMeasure, selectNextMeasure, selectAll, selectScoreStart, selectScoreEnd,
} from './selection.js';
import { ranged, clearRange, removeRange, deleteSelectedColumns } from './rangeEdit.js';
import { fill, reflow } from './reflow.js';
import { columnar, columnPrev, columnNext, columnStay } from './columns.js';
import { transpose } from './transpose.js';

const nav = (fn, label) => ({ fn, kind: 'nav', label });
const edit = (fn, label) => ({ fn, kind: 'edit', label });
const select = (fn, extra) => ({ fn, kind: 'select', ...extra });
const keep = (c) => ({ ...c, keepsSelection: true });

export const COMMANDS = Object.freeze({
  moveLeft: nav(moveLeft),
  moveRight: nav(moveRight, 'add measure'),
  moveUp: nav(moveUp),
  moveDown: nav(moveDown),
  prevMeasure: nav(prevMeasure),
  nextMeasure: nav(nextMeasure),
  measureStart: nav(measureStart),
  measureEnd: nav(measureEnd),
  scoreStart: nav(scoreStart),
  scoreEnd: nav(scoreEnd),
  prevTrack: nav(prevTrack),
  nextTrack: nav(nextTrack),
  digit: edit(digit, (d) => `fret ${d?.fret}`),
  deleteNote: edit(ranged(deleteNote, clearRange), (d) => (d?.id === 'rangeCleared' ? 'clear beats' : 'delete note')),
  toggleTie: edit(toggleTie, 'tie'),
  shorter: edit(shorter, 'duration'),
  longer: edit(longer, 'duration'),
  setDuration: edit(setDuration, 'duration'),
  cycleDots: edit(cycleDots, 'dots'),
  toggleTriplet: edit(toggleTriplet, 'triplet'),
  toggleRest: edit(toggleRest, (d) => (d?.id === 'changedToNote' ? 'note' : 'rest')),
  deleteBeat: edit(ranged(deleteBeat, removeRange), (d) => (d?.id === 'rangeRemoved' ? 'delete beats' : 'delete beat')),
  insertBeat: edit(insertBeat, 'insert rest'),
  insertMeasureAfter: edit(insertMeasureAfter, 'insert measure'),
  insertMeasureBefore: edit(insertMeasureBefore, 'insert measure'),
  deleteMeasure: edit(ranged(deleteMeasure, deleteSelectedColumns), (d) => (d?.id === 'columnsDeleted' ? 'delete measures' : 'delete measure')),
  fill: edit(fill, 'fill'),
  reflow: edit(reflow, 'reflow'),
  transpose: keep(edit(transpose, 'transpose')), // 2.3.1, arg: semitones
  // 2.1 effects, one command per row of effectTable.js; 2.3.1: over the selection when there is one
  ...Object.fromEntries(EFFECTS.map((d) => [d.name, keep(edit(ranged(effectCommand(d), effectRange(d)), d.label))])),
  // 2.3 selection
  selectLeft: select(columnar(selectLeft, columnPrev)),
  selectRight: select(columnar(selectRight, columnNext)),
  selectMeasureStart: select(columnar(selectMeasureStart, columnStay)),
  selectMeasureEnd: select(columnar(selectMeasureEnd, columnStay)),
  selectPrevMeasure: select(columnar(selectPrevMeasure, columnPrev)),
  selectNextMeasure: select(columnar(selectNextMeasure, columnNext)),
  selectAll: select(selectAll, { fromStart: true }),
  selectScoreStart: select(selectScoreStart),
  selectScoreEnd: select(selectScoreEnd),
  selectPrevTrack: select(prevTrack, { edgeKeeps: true }), // 2.3.2: column selection
  selectNextTrack: select(nextTrack, { edgeKeeps: true }),
  undo: { fn: null, kind: 'history', step: 'undo' },
  redo: { fn: null, kind: 'history', step: 'redo' },
  clearBuffer: { fn: null, kind: 'buffer', cancelsBuffer: true },
});

/** The undo label of command `name` that announced `descriptor` ('fret 5', 'rest', 'insert measure' …). */
export function undoLabel(name, descriptor) {
  const label = COMMANDS[name]?.label;
  return typeof label === 'function' ? label(descriptor) : label ?? name;
}

/**
 * Run command `name` (nav or edit) → `{ score, cursor, state, changed,
 * moved, announce, coalesce }`. `changed` is true exactly when a new model
 * object came back; with no visible track every command is a no-op that
 * announces it.
 */
export function run(name, score, cursor, state, ctx, arg) {
  const def = COMMANDS[name];
  if (!def || !def.fn) throw new Error(`Unknown command: ${name}`);
  const cleared = state.digit && name !== 'digit' ? { ...state, digit: null } : state;
  if (!isVisible(trackAt(score, cursor.track))) {
    return { score, cursor, state: { ...state, digit: null }, changed: false, moved: false, announce: { id: 'noTrack' }, coalesce: false };
  }
  const res = def.fn(score, cursor, cleared, ctx, arg) || {};
  const nextScore = res.score ?? score;
  const nextCursor = clampCursor(nextScore, res.cursor ?? cursor);
  let nextState = res.state ?? cleared;
  if (name !== 'digit' && nextState.digit) nextState = { ...nextState, digit: null };
  const changed = nextScore !== score;
  const moved = !sameCursor(nextCursor, cursor);
  if (moved || changed) nextState = syncDuration(nextScore, nextCursor, nextState);
  return { score: nextScore, cursor: nextCursor, state: nextState, changed, moved, announce: res.announce ?? null, coalesce: !!res.coalesce };
}
