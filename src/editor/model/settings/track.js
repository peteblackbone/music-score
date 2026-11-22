/**
 * model/settings/track.js — updateTrack: a track's names, opening clef,
 * staves, TAB options, capo and tuning.
 *
 * Fields: name, label (single-line text); clef (a renderer clef name,
 * written canonical; it also deletes `measures[0].clef`; null deletes
 * both); showStandardNotation, showTablature (booleans, always written);
 * tabRhythm ('auto' or null deletes, true / false written); tabArticulations
 * (flag); tiedFrets ('parens', or null / false deletes); capo (1–30, 0 or
 * null deletes); tuning (model/settings/tuning.js, applied first).
 * A change that would leave no visible track is refused (lastVisible).
 */
import { clefOf } from '../../../clef.js';
import { tracksOf, isVisible, measureAt, measuresOf } from '../access.js';
import { object, checkKeys, index, text, flag, bool, withField } from './validate.js';
import { canonicalTuning, retuneTrack } from './tuning.js';

export const TRACK_FIELDS = Object.freeze(['name', 'label', 'clef', 'showStandardNotation', 'showTablature', 'tabRhythm', 'tabArticulations', 'tiedFrets', 'capo', 'tuning']);

/** Canonical clef name of `v`, or undefined for null; throws otherwise. */
export function checkClef(v) {
  if (v === null) return undefined;
  if (typeof v !== 'string') throw new TypeError('Clef must be a string');
  const c = clefOf(v);
  if (!c) throw new RangeError(`Unknown clef: ${v}`);
  return c;
}

/** Capo `v`: 1–30, or undefined for 0 / null. */
export function checkCapo(v) {
  if (v === null || v === 0) return undefined;
  if (typeof v !== 'number') throw new TypeError('Capo must be a number');
  if (!Number.isInteger(v) || v < 1 || v > 30) throw new RangeError('Capo must be a whole number from 0 to 30');
  return v;
}

const CHECK = {
  name: (v) => text(v, { label: 'Name' }),
  label: (v) => text(v, { label: 'Short name' }),
  clef: checkClef,
  showStandardNotation: (v) => bool(v, 'showStandardNotation'),
  showTablature: (v) => bool(v, 'showTablature'),
  tabRhythm: (v) => {
    if (v === null || v === 'auto') return undefined;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') throw new RangeError('tabRhythm must be "auto", true, false or null');
    throw new TypeError('tabRhythm must be "auto", true, false or null');
  },
  tabArticulations: (v) => flag(v, 'tabArticulations'),
  tiedFrets: (v) => {
    if (v === null || v === false) return undefined;
    if (v === 'parens') return v;
    if (typeof v === 'string') throw new RangeError('tiedFrets must be "parens", false or null');
    throw new TypeError('tiedFrets must be "parens", false or null');
  },
  capo: checkCapo,
  tuning: canonicalTuning,
};

/** The values track patch `patch` writes (undefined = delete), every key checked first. */
export function checkTrackPatch(raw) {
  const patch = object(raw, 'Track settings');
  checkKeys(patch, TRACK_FIELDS, 'track');
  const out = {};
  for (const k of TRACK_FIELDS) if (Object.hasOwn(patch, k)) out[k] = CHECK[k](patch[k]);
  return out;
}

/** `track` with checked `values` applied → `{ track, removed, droppedV1 }` (tuning first). */
export function applyTrackPatch(track, values) {
  let out = track;
  let removed = 0;
  let droppedV1 = new Map();
  if (Object.hasOwn(values, 'tuning')) ({ track: out, removed, droppedV1 } = retuneTrack(out, values.tuning));
  for (const [k, v] of Object.entries(values)) {
    if (k === 'tuning') continue;
    out = withField(out, k, v);
    if (k === 'clef' && measureAt(out, 0) && Object.hasOwn(measureAt(out, 0), 'clef')) {
      const measures = measuresOf(out).slice();
      measures[0] = withField(measures[0], 'clef', undefined);
      out = { ...out, measures };
    }
  }
  return { track: out, removed, droppedV1 };
}

/** Whether a track other than `ti` is visible. */
export const otherVisible = (score, ti) => tracksOf(score).some((t, k) => k !== ti && isVisible(t));

/** The name a track is announced by: its name, else its label (may be empty). */
export const trackName = (t) => String(t?.name || t?.label || '');

/** updateTrack(ti, patch). */
export function updateTrack(score, cursor, ti, patch) {
  const tracks = tracksOf(score);
  index(ti, tracks.length, 'Track index');
  const values = checkTrackPatch(patch);
  const old = tracks[ti];
  const { track, removed, droppedV1 } = applyTrackPatch(old, values);
  if (track === old) return { score };
  if (isVisible(old) && !isVisible(track) && !otherVisible(score, ti)) return { refused: { id: 'lastVisible' } };
  const next = tracks.slice();
  next[ti] = track;
  let c = cursor;
  const drops = cursor.track === ti ? droppedV1.get(cursor.measure) : null;
  if (drops) c = { ...cursor, beat: cursor.beat - drops.filter((i) => i < cursor.beat).length };
  return { score: { ...score, tracks: next }, cursor: c, announce: { id: 'trackUpdated', n: ti + 1, name: trackName(track), removed } };
}

/** `name` when no track uses it (trimmed, any case), else the first free "name n" with n ≥ 2. */
export function uniqueName(tracks, name) {
  const used = new Set(tracks.map((t) => String(t?.name ?? '').trim().toLowerCase()));
  if (!used.has(name.trim().toLowerCase())) return name;
  for (let n = 2; ; n++) if (!used.has(`${name} ${n}`.trim().toLowerCase())) return `${name} ${n}`;
}
