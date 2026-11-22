/**
 * model/settings/tempo.js — score-wide tempo marks (2.3), read the way the
 * renderer's tempoChanges reads them: `beat.tempo` on voice-1 main beats
 * of every track, hidden ones included, valid when tempoOf accepts it, and
 * at one (measure, onset) the lowest track index wins.
 *
 * - tempoAt: the winning mark at or before the cursor's (measure, onset);
 *   the slot's onset is the measure's total; `here` only on a beat with a
 *   winner at exactly its onset.
 * - setTempo: writes the cursor beat and removes the other readable marks
 *   at the same (measure, onset) (null removes them all), one result.
 * - migrateTempo / lostTempoMarks: removeTrack moves each winning mark of
 *   the removed track to the lowest other track with a voice-1 main beat at
 *   exactly that onset, else counts it as dropped.
 */
import { tempoOf } from '../../../expression.js';
import { ZERO, add, cmp } from '../../../rational.js';
import { tracksOf, trackAt, measuresOf, measureAt, beatsOf, beatsAt, beatAt, isGrace, updateBeat, mainBeatNumber } from '../access.js';
import { beatR, onsetOf, measureTotal } from '../fill.js';
import { object, checkKeys, text, withField } from './validate.js';
import { EDITOR_LIMITS } from '../limits.js';

/** The beat units setTempo accepts (the renderer's tempoOf units). */
export const TEMPO_UNITS = Object.freeze(['whole', 'half', 'quarter', '8th', '16th', '32nd']);
const UNITS = TEMPO_UNITS;
const TEMPO_KEYS = ['bpm', 'unit', 'dots', 'text'];

/** The stored form of tempo `value`: null (remove), a bpm number (quarter beat), or `{ bpm, unit, dots?, text? }`. */
export function checkTempo(value) {
  if (value === null) return undefined;
  const obj = typeof value === 'number' ? { bpm: value } : object(value, 'Tempo');
  checkKeys(obj, TEMPO_KEYS, 'tempo');
  const { bpm } = obj;
  if (typeof bpm !== 'number') throw new TypeError('Tempo bpm must be a number');
  if (!(bpm > 0 && bpm <= EDITOR_LIMITS.bpm) || Math.round(bpm * 100) / 100 !== bpm) throw new RangeError(`BPM must be above 0 and at most ${EDITOR_LIMITS.bpm}, with up to 2 decimals`);
  const unit = obj.unit ?? 'quarter';
  if (typeof unit !== 'string') throw new TypeError('Tempo unit must be a string');
  if (!UNITS.includes(unit)) throw new RangeError(`Tempo unit must be one of ${UNITS.join(', ')}`);
  const dots = obj.dots ?? 0;
  if (typeof dots !== 'number') throw new TypeError('Tempo dots must be a number');
  if (!Number.isInteger(dots) || dots < 0 || dots > 2) throw new RangeError('Tempo dots must be 0, 1 or 2');
  const words = obj.text == null ? undefined : text(obj.text, { label: 'Tempo text' });
  if (unit === 'quarter' && !dots && !words) return bpm;
  return { bpm, unit, ...(dots ? { dots } : {}), ...(words ? { text: words } : {}) };
}

const memo = new WeakMap();
const order = (a, b) => a.measure - b.measure || cmp(a.onset, b.onset) || a.track - b.track;
const sameSpot = (a, b) => a.measure === b.measure && cmp(a.onset, b.onset) === 0;

/**
 * Every readable mark of `score` as `{ measure, onset, track, beat, raw,
 * tempo }`, sorted by measure, onset, track, plus the `winners` (the first
 * mark at each (measure, onset)). Memoized per model object.
 */
export function tempoMarks(score) {
  const hit = memo.get(score);
  if (hit) return hit;
  const marks = [];
  tracksOf(score).forEach((track, ti) => {
    measuresOf(track).forEach((_, mi) => {
      const beats = beatsOf(measureAt(track, mi));
      if (!beats.some((b) => b.tempo !== undefined)) return;
      let t = ZERO;
      beats.forEach((b, k) => {
        if (isGrace(b)) return;
        const tempo = b.tempo === undefined ? null : tempoOf(b.tempo);
        if (tempo) marks.push({ measure: mi, onset: t, track: ti, beat: k, raw: b.tempo, tempo });
        t = add(t, beatR(b));
      });
    });
  });
  marks.sort(order);
  const winners = marks.filter((m, i) => i === 0 || !sameSpot(m, marks[i - 1]));
  const out = { marks, winners };
  memo.set(score, out);
  return out;
}

/** The onset of the cursor position (the measure's total on the slot). */
const cursorOnset = (beats, beat) => (beat < beats.length ? onsetOf(beats, beat) : measureTotal(beats));

/** The tempo in force at the cursor across all tracks (see the header): `{ bpm, unit, dots, text, here }` or null. */
export function tempoAt(score, cursor) {
  const { winners } = tempoMarks(score);
  if (!winners.length) return null;
  const beats = beatsAt(score, cursor);
  const spot = { measure: cursor.measure, onset: cursorOnset(beats, cursor.beat) };
  let lo = 0;
  let hi = winners.length; // first winner after the spot
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (winners[mid].measure < spot.measure || (winners[mid].measure === spot.measure && cmp(winners[mid].onset, spot.onset) <= 0)) lo = mid + 1;
    else hi = mid;
  }
  if (!lo) return null;
  const w = winners[lo - 1];
  return { ...w.tempo, here: cursor.beat < beats.length && sameSpot(w, spot) };
}

/** setTempo(value): writes or removes `beat.tempo` on the cursor beat and removes the other readable marks at its onset; refused on the slot. */
export function setTempo(score, cursor, value) {
  const stored = checkTempo(value);
  if (!beatAt(score, cursor)) return { refused: { id: 'noBeat' } };
  const spot = { measure: cursor.measure, onset: onsetOf(beatsAt(score, cursor), cursor.beat) };
  let out = updateBeat(score, cursor, (b) => withField(b, 'tempo', stored));
  for (const m of tempoMarks(score).marks) {
    if (!sameSpot(m, spot) || (m.track === cursor.track && m.beat === cursor.beat)) continue;
    out = updateBeat(out, { track: m.track, measure: m.measure, beat: m.beat }, (b) => withField(b, 'tempo', undefined));
  }
  const t = stored === undefined ? null : tempoOf(stored);
  return { score: out, announce: { id: 'tempoSet', tempo: t, measure: cursor.measure + 1, beat: mainBeatNumber(beatsAt(score, cursor), cursor.beat) } };
}

/** Index of the voice-1 main beat of track `ti` measure `mi` at exactly `onset`, or -1. */
function mainBeatAt(score, ti, mi, onset) {
  let t = ZERO;
  const beats = beatsOf(measureAt(trackAt(score, ti), mi));
  for (let k = 0; k < beats.length; k++) {
    if (isGrace(beats[k])) continue;
    const c = cmp(t, onset);
    if (c === 0) return k;
    if (c > 0) return -1;
    t = add(t, beatR(beats[k]));
  }
  return -1;
}

/** Where each winning mark of track `ti` goes when it is removed: `[{ mark, track, beat }]`, track -1 when it is dropped. */
function moves(score, ti) {
  const n = tracksOf(score).length;
  return tempoMarks(score).winners.filter((w) => w.track === ti).map((w) => {
    for (let k = 0; k < n; k++) {
      if (k === ti) continue;
      const beat = mainBeatAt(score, k, w.measure, w.onset);
      if (beat >= 0) return { mark: w, track: k, beat };
    }
    return { mark: w, track: -1, beat: -1 };
  });
}

/** The tempo marks removing track `ti` would drop (no writes). */
export const lostTempoMarks = (score, ti) => moves(score, ti).filter((m) => m.track < 0).length;

/** `{ score, dropped }`: each winning mark of track `ti` copied (raw) to the beat that takes it over (see the header). */
export function migrateTempo(score, ti) {
  let out = score;
  let dropped = 0;
  for (const m of moves(score, ti)) {
    if (m.track < 0) { dropped++; continue; }
    out = updateBeat(out, { track: m.track, measure: m.mark.measure, beat: m.beat }, (b) => withField(b, 'tempo', m.mark.raw));
  }
  return { score: out, dropped };
}
