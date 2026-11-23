/**
 * announce.js — the words the editor's live region speaks (ui.md §7).
 * Commands return descriptors `{ id, ...params }`; this module turns them,
 * and cursor moves, into text. Moves speak only what changed: the track
 * and measure parts when they change (or in full on focus), the string
 * alone for Up / Down, and the fill when entering a measure that is not
 * full. Effects are spoken after the duration (Up / Down: the note
 * effects only).
 */

import { FILL_WORDS, DURATION_WORDS, durationWords } from './model/durations.js';
import { EFFECT_BY_NAME, SUFFIXES } from './model/effectTable.js';
import { formatBpm } from '../expression.js';
import { canonicalEnding, endingLabel } from '../navigation.js';
import { EDITOR_LIMITS } from './model/limits.js';

export { durationWords };
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const fillWord = (f) => FILL_WORDS[f]?.word ?? f;
/** The effect text of `def` for descriptor `d`: added, the step's words, or off; plus the suffix. */
const effectText = (def, d) => `${d.added ? def.added : d.step >= 0 ? def.say[d.step] : def.off}${Object.hasOwn(SUFFIXES, d.suffix ?? '') ? SUFFIXES[d.suffix].text : ''}`;
/** 'Palm mute on, 8 beats' / 'Accent, 8 beats, not shown on TAB only': the step's words, the count of `unit` (2.3.2: the tracks, the skipped ones), the suffix. */
const rangeEffectText = (def, d) => `${d.step >= 0 ? def.say[d.step] : def.off}, ${plural(d.count, d.unit)}${onTracks(d.tracks)}${d.skippedTracks ? `, ${plural(d.skippedTracks, 'track')} without TAB skipped` : ''}${Object.hasOwn(SUFFIXES, d.suffix ?? '') ? SUFFIXES[d.suffix].text : ''}`;
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
  // 2.3.1 effects over a selection: the step's words, the count, the suffix once
  effectRange: (d) => (Object.hasOwn(EFFECT_BY_NAME, d.name) ? rangeEffectText(EFFECT_BY_NAME[d.name], d) : ''),
  noNotesInSelection: () => 'No notes in the selection',
  noBeatsInSelection: () => 'No beats in the selection',
  // 2.3.1 transpose
  transposed: (d) => (d.fret != null ? `Fret ${d.fret}, ${semitoneText(d.semitones)}` : `Transposed ${plural(d.count, 'note')} ${semitoneText(d.semitones)}${onTracks(d.tracks)}${skippedText(d.skipped)}`),
  transposeRange: (d) => `Can't transpose, measure ${d.measure}${d.track ? ` on track ${d.track}` : ''} would go ${d.up ? `above fret ${d.max}` : 'below fret 0'}`,
  noNoteToTranspose: () => 'No note here',
  pitchOnlyNote: () => 'Only fretted notes can be transposed',
  nothingToTranspose: (d) => `No fretted notes to transpose${skippedText(d.skipped)}`,
  // 2.2 settings
  noChange: () => 'No change',
  scoreUpdated: (d) => `${!d.key ? 'Score settings updated' : FLAG_KEYS.includes(d.key) ? `${d.label} ${d.on ? 'on' : 'off'}` : `${d.label} ${d.on ? 'set' : 'removed'}`}${d.mmrOn ? ', shown when rendered, not in the editor' : ''}`,
  tempoSet: (d) => (d.tempo ? `Tempo ${tempoText(d.tempo)} at measure ${d.measure}, beat ${d.beat}` : 'Tempo removed'),
  onlyTrack: () => 'A score needs at least one track',
  tooManyTracks: () => `A score has at most ${EDITOR_LIMITS.tracks} tracks`,
  lastVisible: () => 'At least one track must be visible',
  tooLarge: () => 'The score would be too large',
  trackUpdated: (d) => `${trackText(d)} updated${d.removed ? `, ${d.removed} note${d.removed === 1 ? '' : 's'} removed` : ''}`,
  trackAdded: (d) => `${trackText(d)} added`,
  trackRemoved: (d) => `${trackText(d)} removed${tempoRemoved(d.tempoDropped)}`,
  trackMoved: (d) => `Track${d.name ? ` ${d.name}` : ''} moved to position ${d.n}`,
  measureSet: (d) => (Object.hasOwn(MEASURE_TEXT, d.key) ? `${MEASURE_TEXT[d.key](d.value)}${d.key === 'clef' || d.key === 'timeSignature' || d.key === 'keySignature' ? (d.value == null ? ' at' : ' from') : ' at'} measure ${d.n}${d.tabOnly && d.value != null ? ', not shown on TAB only' : ''}` : ''),
  measureUpdated: (d) => `Measure ${d.n} settings updated${d.tabOnly ? ', clef not shown on TAB only' : ''}`,
  // 2.3 selection
  selectedBeats: (d) => `Selected measure ${d.m1} beat ${d.b1}${d.m1 !== d.m2 ? ` to measure ${d.m2} beat ${d.b2}` : d.b1 !== d.b2 ? ` to beat ${d.b2}` : ''}, ${beatsText(d.count)}`,
  selectedMeasures: (d) => `Selected measure${d.a !== d.b ? `s ${d.a} to ${d.b}` : ` ${d.a}`}, ${beatsText(d.count)}`,
  selectedAll: (d) => `Selected all of ${trackText(d)}, ${plural(d.measures, 'measure')}`,
  selectionCleared: () => 'Selection cleared',
  nothingToSelect: () => 'Nothing to select',
  // 2.3 range edits
  rangeCleared: (d) => `${plural(d.count, 'beat')} changed to rest${d.count === 1 ? '' : 's'}${onTracks(d.tracks)}`,
  rangeAlreadyRests: () => 'Already rests',
  copiedRests: (d) => `Copied ${plural(d.count, d.kind === 'measures' ? 'measure' : 'beat')}${tracksText(d.tracks)}, already rests`,
  rangeNoBeats: () => 'No beats to delete',
  rangeRemoved: (d) => `${plural(d.count, 'beat')} deleted${onTracks(d.tracks)}${tempoRemoved(d.tempoRemoved)}`,
  columnsDeleted: (d) => `${d.all ? 'All measures deleted, 1 empty measure left' : d.a === d.b ? `Measure ${d.a} deleted` : `Measures ${d.a} to ${d.b} deleted`}${tempoRemoved(d.tempoRemoved)}`,
  needsMeasureSelection: () => 'Select whole measures first',
  // 2.3 fill and reflow
  filled: (d) => `Added ${plural(d.rests.length, 'rest')}: ${d.rests.map((r) => DURATION_WORDS[r]).join(', ')}`,
  filledMany: (d) => `Filled ${d.count === d.total ? plural(d.count, 'measure') : `${d.count} of ${d.total} measures`}${onTracks(d.tracks)}, ${plural(d.rests, 'rest')} added`,
  fillFull: () => 'Measure already full',
  fillOver: () => 'Measure overfull, try Reflow',
  fillTuplet: () => 'Finish the tuplet first',
  fillPickup: () => 'Pickup measure, not filled',
  fillCannot: () => "Plain rests can't fill this measure",
  nothingToFill: () => 'Nothing to fill',
  reflowed: (d) => `${d.added ? `Measure ${d.to} added, moved ${plural(d.count, 'beat')} to it` : `Moved ${plural(d.count, 'beat')} to measure ${d.to}`}${d.split ? `, beat ${d.split} split at the barline` : ''}${d.crossing ? `, beat ${d.crossing} crosses the barline and stays` : ''}`,
  reflowedMany: (d) => `Reflowed ${plural(d.count, 'measure')}${d.added ? `, ${plural(d.added, 'measure')} added` : ''}${d.split ? `, ${plural(d.split, 'beat')} split` : ''}${d.crossing ? `, measure ${d.crossing.measure} beat ${d.crossing.beat} crosses the barline and stays` : ''}`,
  reflowCrossing: (d) => `Beat ${d.beat} crosses the barline and stays`,
  reflowNothing: () => 'Nothing to reflow',
  // 2.3 clipboard
  copied: (d) => `Copied ${plural(d.count, d.kind === 'measures' ? 'measure' : 'beat')}${tracksText(d.tracks)}`,
  cut: (d) => `Cut ${plural(d.count, d.kind === 'measures' ? 'measure' : 'beat')}${tracksText(d.tracks)}, now rests`,
  pasted: (d) => `${d.kind === 'measures' ? `Inserted ${plural(d.count, 'measure')} at measure ${d.at}${tracksText(d.tracks)}${notPasted(d.droppedTracks)}` : `Pasted ${plural(d.count, 'beat')}${d.replaced ? `, replaced ${d.replaced}` : ''}`}${droppedText(d.dropped)}${tempoRemoved(d.tempoRemoved)}`,
  pastedOver: (d) => {
    const r = d.count - d.added;
    const span = (n) => (n === 1 ? `measure ${d.at}` : `measures ${d.at} to ${d.at + n - 1}`);
    const where = r > 0 ? `over ${span(r)}${d.added ? `, ${plural(d.added, 'measure')} added` : ''}` : `at the end, ${span(d.count)}`;
    return `Pasted ${plural(d.count, 'measure')} ${where}${tracksText(d.tracks)}${notPasted(d.droppedTracks)}${droppedText(d.dropped)}${tempoRemoved(d.tempoRemoved)}`;
  },
  pasteNeedsMeasures: () => 'Select whole measures to paste measures',
  cutUnwritten: (d) => `Clipboard unavailable, nothing cut. ${plural(d.count, d.kind === 'measures' ? 'measure' : 'beat')}${tracksText(d.tracks)} copied in the editor`,
  nothingToCopy: () => 'Nothing to copy',
  nothingToPaste: () => 'Nothing to paste',
  notClip: () => 'Not a music-score clip',
  clipInvalid: () => 'Not a music-score clip',
  clipVersion: () => 'Unsupported clip version',
  clipTooLarge: () => 'Clip too large',
});

/** '1 beat' / '3 measures' (n of `word`). */
export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
/** 'no beats' / '1 beat' / '6 beats'. */
export const beatsText = (n) => (n ? plural(n, 'beat') : 'no beats');

/** 'no sharps or flats' / '1 sharp' / '3 flats'. */
export const keyWords = (k) => (!k ? 'no sharps or flats' : `${Math.abs(k)} ${k > 0 ? 'sharp' : 'flat'}${Math.abs(k) === 1 ? '' : 's'}`);
const BARLINE_WORDS = { single: 'Single', double: 'Double', final: 'Final', repeatStart: 'Repeat start', repeatEnd: 'Repeat end' };
/** The words of one measure field (before ' from measure n' / ' at measure n'). */
const MEASURE_TEXT = {
  timeSignature: (v) => (v ? `Time signature ${v.beats}/${v.beatType}` : 'Time signature change removed'),
  keySignature: (v) => (v != null ? `Key signature ${keyWords(v)}` : 'Key signature change removed'),
  clef: (v) => (v ? `Clef ${v.replace(/(8v[ab]|15m[ab])$/, ' $1')}` : 'Clef change removed'),
  barline: (v) => (v ? `${BARLINE_WORDS[v]} barline` : 'Barline removed'),
  repeatCount: (v) => (v ? `Repeat count ${v}` : 'Repeat count removed'),
  ending: (v) => (v != null ? `Ending ${endingLabel(canonicalEnding(v))}` : 'Ending removed'),
  segno: (v) => (v ? 'Segno' : 'Segno removed'),
  coda: (v) => (v ? 'Coda' : 'Coda removed'),
  jump: (v) => v ?? 'Jump removed',
  section: (v) => (v != null ? `Section ${typeof v === 'string' ? v : [v.letter, v.text].filter(Boolean).join(' ')}` : 'Section removed'),
  pickup: (v) => (v ? 'Pickup' : 'Pickup removed'),
};

/** 'up 1 semitone' / 'down an octave'. */
const semitoneText = (n) => `${n > 0 ? 'up' : 'down'} ${Math.abs(n) === 12 ? 'an octave' : plural(Math.abs(n), 'semitone')}`;
/** 2.3.2 column suffix: ' on 3 tracks' (empty without a track count). */
const onTracks = (n) => (n ? ` on ${plural(n, 'track')}` : '');
/** ', 3 tracks' / ', 1 clip track not pasted' (empty without a count). */
const tracksText = (n) => (n ? `, ${plural(n, 'track')}` : '');
const notPasted = (n) => (n ? `, ${plural(n, 'clip track')} not pasted` : '');
/** ', 2 pitch-only notes skipped' (empty for none). */
const skippedText = (n) => (n ? `, ${plural(n, 'pitch-only note')} skipped` : '');
/** ', 2 notes on missing strings dropped' (empty for none). */
const droppedText = (n) => (n ? `, ${plural(n, 'note')} on missing strings dropped` : '');
/** ', 1 tempo mark removed' / ', 2 tempo marks removed' (empty for none). */
export const tempoRemoved = (n) => (n ? `, ${n} tempo mark${n === 1 ? '' : 's'} removed` : '');
/** 'Track 2 Bass' / 'Track 2'. */
const trackText = (d) => `Track ${d.n}${d.name ? ` ${d.name}` : ''}`;

const FLAG_KEYS = ['showTuningChart', 'multiMeasureRests'];
/** '120' for a quarter beat, else '80, dotted quarter'. */
const tempoText = (t) => `${formatBpm(t.bpm)}${t.unit !== 'quarter' || t.dots ? `, ${durationWords(t.unit, t.dots)}` : ''}`;

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
  const fill = measureChanged && !info.empty && info.fill !== 'full' ? `, ${info.pickup && info.fill === 'under' ? 'pickup' : fillWord(info.fill)}` : '';
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
