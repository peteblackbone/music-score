/**
 * model/columns.js — the 2.3.2 column selection: anchor and focus on
 * different visible tracks select whole measures min…max of the two ends
 * on every visible track between them (hidden tracks never). A column
 * selection is `{ track, tracks, anchor, focus, parts, info }`: `tracks`
 * ascending, `track` = tracks[0], `parts` one single-track selectionRange
 * (model/selection.js) per track over whole measures a..b. The ends keep
 * their own tracks and beats; the snap to whole measures is computed here,
 * never stored, so going back to one track restores the beat range.
 *
 * Also the column-mode select moves (Shift+Left / Right and Ctrl+Shift+
 * Left / Right move the focus a whole measure, Shift+Home / End change
 * nothing), the second Ctrl+A (every measure of every visible track) and
 * the selection words. DOM-free.
 */
import { tracksOf, isVisible, measureCount } from './access.js';
import { positions, clampCursor } from './cursor.js';
import { selectionRange, selectionWords } from './selection.js';

const end = (sel, p) => (sel ? { track: sel[p].track ?? sel.track, measure: sel[p].measure, beat: sel[p].beat } : null);
/** The anchor of selection `sel` with its track (`{ track, measure, beat }`), or null. */
export const anchorOf = (sel) => end(sel, 'anchor');
/** The focus of selection `sel` with its track, or null. */
export const focusOf = (sel) => end(sel, 'focus');

/** The visible track indices from `t1` to `t2` (either order, inclusive), ascending. */
export function visibleBetween(score, t1, t2) {
  const tracks = tracksOf(score);
  const out = [];
  for (let ti = Math.max(0, Math.min(t1, t2)); ti <= Math.min(tracks.length - 1, Math.max(t1, t2)); ti++) if (isVisible(tracks[ti])) out.push(ti);
  return out;
}

const firstPos = (score, ti, mi) => positions(score, { track: ti, measure: mi })[0];
const lastPos = (score, ti, mi) => { const p = positions(score, { track: ti, measure: mi }); return p[p.length - 1]; };

/**
 * The column selection from `anchor` to `focus` (`{ track, measure, beat }`
 * each): kind 'measures', beatCount the total of the parts. Fewer than two
 * visible tracks between the ends: the single-track selection on the one
 * visible track between them, else on the visible track nearest the focus
 * (never a hidden track).
 */
export function columnRange(score, anchor, focus) {
  const a = Math.min(anchor.measure, focus.measure);
  const b = Math.max(anchor.measure, focus.measure);
  const tracks = visibleBetween(score, anchor.track, focus.track);
  if (tracks.length < 2) return selectionRange(score, tracks[0] ?? clampCursor(score, { track: focus.track, measure: 0, beat: 0 }).track, anchor, focus);
  const parts = tracks.map((ti) => selectionRange(score, ti, { measure: a, beat: firstPos(score, ti, a) }, { measure: b, beat: lastPos(score, ti, b) }));
  let beatCount = 0;
  for (const p of parts) beatCount += p.info.beatCount;
  const info = { kind: 'measures', track: tracks[0], start: { measure: a, beat: 0 }, end: { measure: b, beat: 0 }, beatCount, measures: [a, b], tracks };
  const at = (p) => ({ track: p.track, measure: p.measure, beat: p.beat });
  return { track: tracks[0], tracks, anchor: at(anchor), focus: at(focus), parts, info };
}

/** The selection from `anchor` to `focus` (with tracks): single-track on one track, else a column. */
export function selectionOf(score, anchor, focus) {
  return anchor.track === focus.track ? selectionRange(score, focus.track, anchor, focus) : columnRange(score, anchor, focus);
}

/** Whether `sel` covers every measure (kind 'measures' over [0, last]): a second Ctrl+A then selects all tracks. */
export const coversTrack = (score, sel) => !!sel && sel.info.kind === 'measures' && sel.info.measures[0] === 0 && sel.info.measures[1] === measureCount(score) - 1;

/** The second Ctrl+A: `{ anchor, cursor }` from the first visible track's start to the last one's last position; null with fewer than 2 visible tracks. */
export function allTracks(score, cursor) {
  const vis = visibleBetween(score, 0, tracksOf(score).length - 1);
  if (vis.length < 2) return null;
  const mi = measureCount(score) - 1;
  const last = vis[vis.length - 1];
  return {
    anchor: { track: vis[0], measure: 0, beat: firstPos(score, vis[0], 0) },
    cursor: clampCursor(score, { ...cursor, track: last, measure: mi, beat: lastPos(score, last, mi) }),
  };
}

/** The words of column selection `sel` (`all`: made by Select all): all tracks, else measures and tracks (1-based) with the hidden ones skipped. */
export function columnWords(score, sel, all = false) {
  const { tracks, measures } = sel.info;
  const t1 = tracks[0];
  const t2 = tracks[tracks.length - 1];
  const every = visibleBetween(score, 0, tracksOf(score).length - 1).length === tracks.length;
  if (all && every && coversTrack(score, sel)) return { id: 'selectedAllTracks' };
  return { id: 'selectedColumns', a: measures[0] + 1, b: measures[1] + 1, t1: t1 + 1, t2: t2 + 1, hidden: t2 - t1 + 1 - tracks.length };
}

/** The words of any selection. */
export const wordsOf = (score, sel, all = false) => (sel.parts ? columnWords(score, sel, all) : selectionWords(score, sel, all));

/** A select command: `single`, or `column` while a column selection is live (ctx.selection.parts). */
export const columnar = (single, column) => (score, cursor, state, ctx) => (ctx?.selection?.parts ? column : single)(score, cursor, state, ctx);

/** Column mode Left / Ctrl+Shift+Left: the first position of the previous measure, else Start of score. */
export function columnPrev(score, cursor) {
  if (cursor.measure === 0) return { announce: { id: 'startOfScore' } };
  return { cursor: { ...cursor, measure: cursor.measure - 1, beat: firstPos(score, cursor.track, cursor.measure - 1) } };
}
/** Column mode Right / Ctrl+Shift+Right: the last position of the next measure, else End of score. */
export function columnNext(score, cursor) {
  if (cursor.measure >= measureCount(score) - 1) return { announce: { id: 'endOfScore' } };
  return { cursor: { ...cursor, measure: cursor.measure + 1, beat: lastPos(score, cursor.track, cursor.measure + 1) } };
}
/** Column mode Shift+Home / End: nothing changes (the controller repeats the words). */
export const columnStay = () => ({});
