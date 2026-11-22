/**
 * announce.js — the words the editor's live region speaks (ui.md §7).
 * Commands return descriptors `{ id, ...params }`; this module turns them,
 * and cursor moves, into text. Moves speak only what changed: the track
 * and measure parts when they change (or in full on focus), the string
 * alone for Up / Down, and the fill when entering a measure that is not
 * full. Effects are spoken after the duration (Up / Down: the note
 * effects only).
 */

import { FILL_WORDS, durationWords } from './model/durations.js';
import { EFFECT_BY_NAME } from './model/effectTable.js';

export { durationWords };
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const fillWord = (f) => FILL_WORDS[f]?.word ?? f;
const EFFECT_SUFFIX = { link: ', no next note on this string', tabArtic: ', not shown on TAB only', noNotation: ', not shown on TAB only' };
/** The effect text of `def` for descriptor `d`: added, the step's words, or off; plus the suffix. */
const effectText = (def, d) => `${d.added ? def.added : d.step >= 0 ? def.say[d.step] : def.off}${EFFECT_SUFFIX[d.suffix] ?? ''}`;
/** ', hammer/pull, palm mute' (empty when there are none). */
const effectsText = (list) => (list?.length ? `, ${list.join(', ')}` : '');

export const MESSAGES = Object.freeze({
  fret: (d) => `Fret ${d.fret}`,
  chordNote: (d) => `Fret ${d.fret} added, chord of ${d.count}`,
  noteDeleted: () => 'Note deleted',
  noteDeletedRest: () => 'Note deleted, now rest',
  beatDeleted: () => 'Beat deleted.',
  changedToRest: () => 'Changed to rest',
  changedToNote: () => 'Changed to note',
  duration: (d) => cap(durationWords(d.duration, d.dots)),
  nextDuration: (d) => `Next: ${durationWords(d.duration, d.dots)}`,
  dots: (d) => (d.dots ? cap(durationWords(d.duration, d.dots)) : `${cap(durationWords(d.duration))}, no dot`),
  tripletOn: () => 'Triplet on',
  tripletOff: () => 'Triplet off',
  tiedTo: (d) => `Tied to fret ${d.fret}`,
  tieRemoved: () => 'Tie removed',
  nothingToTie: () => 'Nothing to tie to',
  noNoteHere: () => 'No note on this string',
  noNote: () => 'No note to delete',
  restInserted: (d) => `Rest inserted, ${durationWords(d.duration, d.dots)}`,
  measureInserted: (d) => `Measure ${d.n} inserted`,
  measureDeleted: (d) => `Measure ${d.n} deleted`,
  measureCleared: () => 'Measure cleared',
  measureAdded: (d) => `Measure ${d.n} added`,
  undo: (d) => `Undo: ${d.label}`,
  redo: (d) => `Redo: ${d.label}`,
  nothingToUndo: () => 'Nothing to undo',
  nothingToRedo: () => 'Nothing to redo',
  readOnly: () => 'Read-only',
  refusedNoTab: () => 'Fret entry needs a TAB staff',
  needsTab: () => 'Needs a TAB staff',
  refusedMaxFret: (d) => `Frets go up to ${d.max}`,
  limit: () => 'No further duration',
  noBeat: () => 'No beat here',
  nestedTuplet: () => 'Nested tuplet, unchanged',
  startOfScore: () => 'Start of score',
  endOfScore: () => 'End of score',
  firstTrack: () => 'First track',
  lastTrack: () => 'Last track',
  noTrack: () => 'No visible track',
  needsNote: () => 'Needs a note',
  effect: (d) => (Object.hasOwn(EFFECT_BY_NAME, d.name) ? effectText(EFFECT_BY_NAME[d.name], d) : ''),
});

/** The text of descriptor `d` (empty for unknown ids). */
export function describe(d) {
  const f = d && Object.hasOwn(MESSAGES, d.id) && MESSAGES[d.id];
  return f ? f(d) : '';
}

/** 'string 3, fret 5' / 'string 3, empty'. */
const stringText = (info) => `string ${info.string}, ${info.fret != null ? `fret ${info.fret}` : 'empty'}`;

/** The cursor position part of a move announcement. */
export function positionText(info) {
  const dur = durationWords(info.duration, info.dots, info.triplet);
  if (info.appendSlot) return info.empty ? 'empty measure' : `end of measure, ${durationWords(info.duration, info.dots)}`;
  const beat = `beat ${info.beatNumber}`;
  const fx = effectsText(info.effects);
  if (info.isRest) return `${beat}, rest, ${dur}${fx}`;
  if (!info.hasTab) return `${beat}, ${info.noteCount > 1 ? `chord of ${info.noteCount}` : 'note'}, ${dur}${fx}`;
  return `${beat}, ${stringText(info)}, ${dur}${fx}${info.tied ? ', tied' : ''}`;
}

/** The move announcement from `prev` to `info` (cursorInfo objects); `full` speaks every part. */
export function describeCursor(info, prev = null, full = false) {
  const trackChanged = full || !prev || prev.track !== info.track;
  const measureChanged = trackChanged || prev.measure !== info.measure;
  if (!measureChanged && prev.beat === info.beat && prev.string !== info.string && info.hasTab) return cap(stringText(info)) + effectsText(info.noteEffects);
  const parts = [];
  if (trackChanged) parts.push(`Track ${info.track + 1}${info.trackName ? ` ${info.trackName}` : ''}`);
  if (measureChanged) parts.push(`measure ${info.measure + 1}`);
  parts.push(positionText(info));
  const fill = measureChanged && !info.empty && info.fill !== 'full' ? `, ${fillWord(info.fill)}` : '';
  return cap(parts.join(', ') + fill);
}

/**
 * The announcement after an edit: the descriptor's text, the new position
 * after 'Beat deleted.', and the measure's fill when the measure or its
 * fill changed (', measure full' / ', measure overfull' / ', measure underfull').
 */
export function describeEdit(d, info, prev) {
  let text = describe(d);
  if (d?.id === 'beatDeleted') text += ` ${cap(positionText(info))}`;
  if (prev && !info.empty && (prev.track !== info.track || prev.measure !== info.measure || prev.fill !== info.fill)) {
    text += `, measure ${fillWord(info.fill)}`;
  }
  return text;
}
