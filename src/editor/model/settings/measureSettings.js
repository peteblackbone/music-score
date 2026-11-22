/**
 * model/settings/measureSettings.js — settings of one measure column
 * (updateMeasure) and what is in force there (getMeasureSettings).
 *
 * Column-wide (written on every track, hidden ones included): time and
 * key signature, barline, repeatCount, ending, segno, coda, jump, section.
 * Per track: clef. A time or key signature equal to the one in force just
 * before the measure (per track; at measure 0 the track's, the score's or
 * the default) is deleted instead of written. Fields are validated first,
 * then applied in the order of PATCH_KEYS.
 */
import { clefOf, clefAt, trackClef } from '../../../clef.js';
import { canonicalJump, jumpKind, mergeNavigation, JUMP_TEXTS } from '../../../navigation.js';
import { EDITOR_LIMITS } from '../limits.js';
import { tracksOf, trackAt, measureAt, measureCount, hasTab, hasNotation } from '../access.js';
import { timeSignatureAt, keySignatureAt } from '../fill.js';
import { object, list, checkKeys, index, intIn, text, flag, LINE_BREAK } from './validate.js';
import { columnValue, setColumn, setTrackField } from './column.js';
import { checkClef } from './track.js';

export const PATCH_KEYS = Object.freeze(['timeSignature', 'keySignature', 'clef', 'barline', 'repeatCount', 'ending', 'segno', 'coda', 'jump', 'section']);
export const BARLINES = Object.freeze(['single', 'double', 'final', 'repeatStart', 'repeatEnd']);
const COMMON = { beats: 4, beatType: 4 };

function checkTime(raw) {
  const v = object(raw, 'Time signature');
  checkKeys(v, ['beats', 'beatType'], 'time signature');
  const { beats, beatType } = v;
  intIn(beats, 1, EDITOR_LIMITS.timeSignatureBeats, 'Beats');
  if (typeof beatType !== 'number') throw new TypeError('Beat type must be a number');
  if (!EDITOR_LIMITS.beatTypes.includes(beatType)) throw new RangeError(`Beat type must be one of ${EDITOR_LIMITS.beatTypes.join(', ')}`);
  return { beats, beatType };
}

/** Ending numbers: one integer 1–99 or an array of 1–32 unique ones → sorted array. */
function endingNumbers(v) {
  const nums = Array.isArray(v) ? list(v) : [v];
  if (Array.isArray(v) && (nums.length < 1 || nums.length > 32)) throw new RangeError('An ending has 1 to 32 numbers');
  nums.forEach((n) => intIn(n, 1, 99, 'Ending number'));
  if (new Set(nums).size !== nums.length) throw new RangeError('Each ending number can be used once');
  return nums.sort((a, b) => a - b);
}

/** Stored ending: a number, an array, or `{ numbers, text?, open? }` only with text or open. */
function checkEnding(v) {
  if (v === null) return undefined;
  const obj = typeof v === 'number' || Array.isArray(v) ? { numbers: v } : object(v, 'Ending');
  checkKeys(obj, ['numbers', 'text', 'open'], 'ending');
  const { numbers: rawNumbers, text: rawText, open } = obj;
  const nums = endingNumbers(rawNumbers);
  const words = rawText == null ? undefined : text(rawText, { label: 'Ending text' });
  if (open != null && typeof open !== 'boolean') throw new TypeError('Ending open must be true or false');
  const numbers = nums.length === 1 ? nums[0] : nums;
  if (!words && open == null) return numbers;
  return { numbers, ...(words ? { text: words } : {}), ...(open != null ? { open } : {}) };
}

/**
 * Stored section: trimmed text, or `{ letter, text? }`. An object without a
 * letter (null or missing, as getMeasureSettings reports a text-only
 * section) is stored as its text.
 */
function checkSection(raw) {
  if (raw === null) return undefined;
  if (typeof raw === 'string') return text(raw, { label: 'Section' });
  const v = object(raw, 'Section');
  checkKeys(v, ['letter', 'text'], 'section');
  const { letter: rawLetter, text: rawText } = v;
  const words = rawText == null ? undefined : text(rawText, { label: 'Section text' });
  if (rawLetter == null) {
    if (!words) throw new RangeError('A section needs a letter or text');
    return words;
  }
  if (typeof rawLetter !== 'string') throw new TypeError('Section letter must be a string');
  const letter = rawLetter.trim();
  if (LINE_BREAK.test(letter) || [...letter].length < 1 || [...letter].length > 3) throw new RangeError('Section letter must be 1 to 3 characters');
  return { letter, ...(words ? { text: words } : {}) };
}

function checkJump(v) {
  if (v === null) return undefined;
  if (typeof v !== 'string') throw new TypeError('Jump must be a string');
  const j = canonicalJump(v);
  if (!JUMP_TEXTS.includes(j)) throw new RangeError(`Jump must be one of ${JUMP_TEXTS.join(', ')}`);
  return j;
}

/** The checked values of `patch` at column `mi` (undefined = delete). */
function checkPatch(score, mi, raw) {
  const patch = object(raw, 'Measure settings');
  checkKeys(patch, PATCH_KEYS, 'measure');
  const has = (k) => Object.hasOwn(patch, k);
  const out = {};
  const nullAt0 = (k, what) => { if (mi === 0) throw new RangeError(`${what} can't be removed at measure 1`); return undefined; };
  if (has('timeSignature')) out.timeSignature = patch.timeSignature === null ? nullAt0('timeSignature', 'The time signature') : checkTime(patch.timeSignature);
  if (has('keySignature')) out.keySignature = patch.keySignature === null ? nullAt0('keySignature', 'The key signature') : intIn(patch.keySignature, -7, 7, 'Key signature');
  if (has('clef')) {
    if (mi === 0) throw new RangeError('Set the opening clef with updateTrack');
    out.clef = checkClef(patch.clef);
  }
  if (has('barline')) {
    const b = patch.barline;
    if (b !== null && typeof b !== 'string') throw new TypeError('Barline must be a string');
    if (b !== null && !BARLINES.includes(b)) throw new RangeError(`Barline must be one of ${BARLINES.join(', ')}`);
    out.barline = b ?? undefined;
  }
  if (has('repeatCount')) {
    const r = patch.repeatCount;
    out.repeatCount = r === null ? undefined : intIn(r, 2, 99, 'Repeat count');
    const barline = has('barline') ? out.barline : columnValue(score, mi, 'barline');
    if (r !== null && barline !== 'repeatEnd') throw new RangeError('A repeat count needs a repeat end barline');
  }
  if (has('ending')) out.ending = checkEnding(patch.ending);
  if (has('segno')) out.segno = flag(patch.segno, 'Segno');
  if (has('coda')) out.coda = flag(patch.coda, 'Coda');
  if (has('jump')) out.jump = checkJump(patch.jump);
  if (has('section')) out.section = checkSection(patch.section);
  return out;
}

const sameTime = (a, b) => a.beats === b.beats && a.beatType === b.beatType;
/** Time signature in force on track `ti` just before measure `mi` (the baseline at 0). */
function timeBefore(score, ti, mi) {
  const t = trackAt(score, ti);
  return mi === 0 ? (t?.timeSignature || score.timeSignature || COMMON) : timeSignatureAt(score, { track: ti, measure: mi - 1 });
}
function keyBefore(score, ti, mi) {
  const t = trackAt(score, ti);
  return mi === 0 ? (t?.keySignature ?? score.keySignature ?? 0) : keySignatureAt(score, { track: ti, measure: mi - 1 });
}

/** updateMeasure(mi, patch, { track }?). */
export function updateMeasure(score, cursor, mi, patch, opts) {
  index(mi, measureCount(score), 'Measure index');
  const o = opts === undefined ? {} : object(opts, 'Options');
  checkKeys(o, ['track'], 'option');
  const ti = o.track === undefined ? cursor.track : index(o.track, tracksOf(score).length, 'Track index');
  const v = checkPatch(score, mi, patch);
  if (Object.hasOwn(v, 'clef') && !trackAt(score, ti)) throw new RangeError('There is no track for the clef');
  const has = (k) => Object.hasOwn(v, k);
  let out = score;
  const tracks = tracksOf(score);
  if (has('timeSignature')) {
    tracks.forEach((_, k) => {
      const write = v.timeSignature && !sameTime(v.timeSignature, timeBefore(score, k, mi)) ? { ...v.timeSignature } : undefined;
      out = setTrackField(out, k, mi, 'timeSignature', write);
    });
  }
  if (has('keySignature')) {
    tracks.forEach((_, k) => {
      const write = v.keySignature !== undefined && v.keySignature !== keyBefore(score, k, mi) ? v.keySignature : undefined;
      out = setTrackField(out, k, mi, 'keySignature', write);
    });
  }
  const track = trackAt(score, ti);
  const tabOnly = has('clef') && hasTab(track) && !hasNotation(track);
  if (has('clef')) {
    const write = v.clef !== undefined && v.clef !== clefAt(track, mi - 1) ? v.clef : undefined;
    out = setTrackField(out, ti, mi, 'clef', write);
  }
  if (has('barline')) {
    out = setColumn(out, mi, 'barline', v.barline);
    if (v.barline !== 'repeatEnd') out = setColumn(out, mi, 'repeatCount', undefined);
  }
  for (const k of ['repeatCount', 'ending', 'segno', 'coda', 'jump', 'section']) if (has(k)) out = setColumn(out, mi, k, v[k]);
  const keys = Object.keys(v);
  const announce = keys.length === 1
    ? { id: 'measureSet', key: keys[0], value: v[keys[0]] ?? null, n: mi + 1, tabOnly }
    : { id: 'measureUpdated', n: mi + 1, tabOnly };
  return { score: out, announce };
}

/**
 * What is set and in force at column `mi` for track `ti`: time signature,
 * key signature and clef `{ …, here, inherited }` (here: track `ti` sets
 * it at `mi`; inherited: in force just before `mi`, the baseline at 0) and
 * the column's navigation as the renderer merges it.
 */
export function getMeasureSettings(score, mi, ti) {
  index(mi, measureCount(score), 'Measure index');
  const tracks = tracksOf(score);
  index(ti, tracks.length, 'Track index');
  const track = tracks[ti];
  const m = measureAt(track, mi);
  const ts = timeSignatureAt(score, { track: ti, measure: mi });
  const before = timeBefore(score, ti, mi);
  const nav = mergeNavigation(tracks.map((t) => ({ measures: [measureAt(t, mi)] })), 1)[0];
  return {
    measure: mi,
    track: ti,
    timeSignature: { beats: ts.beats, beatType: ts.beatType, here: m?.timeSignature != null, inherited: { beats: before.beats, beatType: before.beatType } },
    keySignature: { value: keySignatureAt(score, { track: ti, measure: mi }), here: m?.keySignature != null, inherited: keyBefore(score, ti, mi) },
    clef: { value: clefAt(track, mi), here: clefOf(m?.clef) != null, inherited: mi === 0 ? trackClef(track) : clefAt(track, mi - 1) },
    barline: columnValue(score, mi, 'barline') ?? null,
    repeatCount: nav.repeatCount ?? null,
    ending: nav.ending,
    segno: nav.segno,
    coda: nav.coda,
    jump: nav.jump,
    jumpCustom: nav.jump != null && jumpKind(nav.jump) === 'text',
    section: nav.section ?? null,
  };
}
