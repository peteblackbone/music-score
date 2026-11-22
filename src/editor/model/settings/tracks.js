/**
 * model/settings/tracks.js — adding, removing and moving tracks.
 *
 * addTrack(presetOrSpec?, at?): an instrument preset id (default guitar6)
 * or `{ preset, name, label, clef, tuning, showStandardNotation,
 * showTablature, capo }` (spec fields win over the preset's), inserted at
 * `at` (default: after the last track) with one measure per column
 * (column.js newTrackMeasures). A clashing name gets a number. At most
 * LIMITS.tracks tracks (tooManyTracks).
 *
 * removeTrack(ti): refused for the only track (onlyTrack) and the only
 * visible one (lastVisible); column fields only it sets move to the others.
 *
 * moveTrack(from, to): the track keeps its identity; so does the cursor's.
 */
import { EDITOR_LIMITS } from '../limits.js';
import { tracksOf, isVisible } from '../access.js';
import { object, checkKeys, index, text, bool } from './validate.js';
import { INSTRUMENTS } from './instruments.js';
import { canonicalTuning } from './tuning.js';
import { checkClef, checkCapo, otherVisible, trackName, uniqueName } from './track.js';
import { newTrackMeasures, migrateRemoved } from './column.js';

const SPEC_KEYS = ['preset', 'name', 'label', 'clef', 'tuning', 'showStandardNotation', 'showTablature', 'capo'];

function preset(id) {
  if (typeof id !== 'string') throw new TypeError('Instrument preset must be a string');
  if (!Object.hasOwn(INSTRUMENTS, id)) throw new RangeError(`Unknown instrument preset: ${id}`);
  return INSTRUMENTS[id];
}

/** The new track (without measures) for `spec`, every field checked. */
function trackFromSpec(spec) {
  if (spec === undefined || typeof spec === 'string') spec = { preset: spec ?? 'guitar6' };
  object(spec, 'Track spec');
  checkKeys(spec, SPEC_KEYS, 'track spec');
  const p = preset(spec.preset ?? 'guitar6');
  const has = (k) => Object.hasOwn(spec, k) && spec[k] !== undefined;
  const name = has('name') ? text(spec.name, { label: 'Name' }) : p.name;
  const label = has('label') ? text(spec.label, { label: 'Short name' }) : undefined;
  const clef = has('clef') ? checkClef(spec.clef) : p.clef;
  const tuning = has('tuning') ? canonicalTuning(spec.tuning) : [...p.tuning];
  const notation = has('showStandardNotation') ? bool(spec.showStandardNotation, 'showStandardNotation') : p.staves.showStandardNotation;
  const tabStaff = has('showTablature') ? bool(spec.showTablature, 'showTablature') : p.staves.showTablature;
  const capo = has('capo') ? checkCapo(spec.capo) : undefined;
  return {
    name: name ?? p.name,
    ...(label ? { label } : {}),
    ...(clef ? { clef } : {}),
    showStandardNotation: notation,
    showTablature: tabStaff,
    tuning,
    ...(capo ? { capo } : {}),
  };
}

/** addTrack(presetOrSpec?, at?). */
export function addTrack(score, cursor, spec, at) {
  const tracks = tracksOf(score);
  const t = trackFromSpec(spec);
  const pos = at === undefined ? tracks.length : index(at, tracks.length + 1, 'Track position');
  if (tracks.length >= EDITOR_LIMITS.tracks) return { refused: { id: 'tooManyTracks' } };
  const track = { ...t, name: uniqueName(tracks, t.name), measures: newTrackMeasures(score) };
  const next = tracks.slice();
  next.splice(pos, 0, track);
  return {
    score: { ...score, tracks: next },
    cursor: { track: pos, measure: cursor.measure, beat: 0, string: cursor.string },
    announce: { id: 'trackAdded', n: pos + 1, name: trackName(track) },
  };
}

/** removeTrack(ti). */
export function removeTrack(score, cursor, ti) {
  const tracks = tracksOf(score);
  index(ti, tracks.length, 'Track index');
  if (tracks.length === 1) return { refused: { id: 'onlyTrack' } };
  if (isVisible(tracks[ti]) && !otherVisible(score, ti)) return { refused: { id: 'lastVisible' } };
  const migrated = migrateRemoved(score, ti);
  const next = tracksOf(migrated).slice();
  next.splice(ti, 1);
  let track = cursor.track;
  if (track === ti) track = Math.min(ti, next.length - 1);
  else if (track > ti) track -= 1;
  return {
    score: { ...migrated, tracks: next },
    cursor: { ...cursor, track },
    announce: { id: 'trackRemoved', n: ti + 1, name: trackName(tracks[ti]) },
  };
}

/** moveTrack(from, to). */
export function moveTrack(score, cursor, from, to) {
  const tracks = tracksOf(score);
  index(from, tracks.length, 'Track index');
  index(to, tracks.length, 'Track position');
  if (from === to) return { score };
  const next = tracks.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  const c = cursor.track;
  let track = c;
  if (c === from) track = to;
  else if (from < c && c <= to) track = c - 1;
  else if (to <= c && c < from) track = c + 1;
  return { score: { ...score, tracks: next }, cursor: { ...cursor, track }, announce: { id: 'trackMoved', n: to + 1, name: trackName(moved) } };
}
