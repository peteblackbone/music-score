/**
 * model/commands.js — the command registry and the one entry point that
 * runs a command against the model.
 *
 * Kinds: 'nav' (moves; Right may append a measure), 'edit' (refused in
 * read-only mode), 'history' (undo / redo, run by the controller) and
 * 'buffer' (Escape). run() clamps the resulting cursor, clears the digit
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

const nav = (fn) => ({ fn, kind: 'nav' });
const edit = (fn) => ({ fn, kind: 'edit' });

export const COMMANDS = Object.freeze({
  moveLeft: nav(moveLeft),
  moveRight: nav(moveRight),
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
  digit: edit(digit),
  deleteNote: edit(deleteNote),
  toggleTie: edit(toggleTie),
  shorter: edit(shorter),
  longer: edit(longer),
  setDuration: edit(setDuration),
  cycleDots: edit(cycleDots),
  toggleTriplet: edit(toggleTriplet),
  toggleRest: edit(toggleRest),
  deleteBeat: edit(deleteBeat),
  insertBeat: edit(insertBeat),
  insertMeasureAfter: edit(insertMeasureAfter),
  insertMeasureBefore: edit(insertMeasureBefore),
  deleteMeasure: edit(deleteMeasure),
  undo: { fn: null, kind: 'history' },
  redo: { fn: null, kind: 'history' },
  clearBuffer: { fn: null, kind: 'buffer' },
});

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
