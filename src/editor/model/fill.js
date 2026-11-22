/**
 * model/fill.js — how full a measure is (voice 1 only; hidden rests count).
 * Time signatures carry forward as in normalize.js: the track's, else the
 * score's, else 4/4, replaced by every measure up to the one asked about
 * that sets its own. Key signatures carry forward the same way (keySignatureAt).
 */
import { R, ZERO, add, cmp } from '../../rational.js';
import { durationR } from '../../duration.js';
import { trackAt, tracksOf, measureAt, beatsOf, beatsAt, isGrace, clampDots, measureCount } from './access.js';

/** The default time signature (4/4). */
export const COMMON_TIME = Object.freeze({ beats: 4, beatType: 4 });
/** Whether time signatures `a` and `b` are the same meter (other fields ignored). */
export const sameTime = (a, b) => a.beats === b.beats && a.beatType === b.beatType;
/** The time signature a track opens with: its own, else the score's, else 4/4 (`track` may be null: the score's baseline). */
export const baseTimeSignature = (score, track) => track?.timeSignature || score.timeSignature || COMMON_TIME;
/** The key signature a track opens with: its own, else the score's, else 0. */
export const baseKeySignature = (score, track) => track?.keySignature ?? score.keySignature ?? 0;

/** Time signature in force at the measure of `loc` (`{ track, measure }`). */
export function timeSignatureAt(score, loc) {
  const track = trackAt(score, loc.track);
  let cur = baseTimeSignature(score, track);
  for (let k = 0; k <= loc.measure; k++) {
    const m = measureAt(track, k);
    if (m?.timeSignature) cur = m.timeSignature;
  }
  return cur;
}

/** Key signature in force at the measure of `loc`: the track's, else the score's, else 0, replaced by every measure up to it that sets one. */
export function keySignatureAt(score, loc) {
  const track = trackAt(score, loc.track);
  let cur = baseKeySignature(score, track);
  for (let k = 0; k <= loc.measure; k++) {
    const m = measureAt(track, k);
    if (m?.keySignature != null) cur = m.keySignature;
  }
  return cur;
}

/** Exact duration of a beat as layout reads it (dots clamped to 0..4). */
export const beatR = (b) => durationR({ duration: b.duration, dots: clampDots(b.dots), tuplet: b.tuplet, tuplets: b.tuplets });

/** Sum of the non-grace beats before index `i` (all of them when i = beats.length). */
export function onsetOf(beats, i) {
  let t = ZERO;
  for (let k = 0; k < i && k < beats.length; k++) if (!isGrace(beats[k])) t = add(t, beatR(beats[k]));
  return t;
}

export const measureTotal = (beats) => onsetOf(beats, beats.length);

/** 'under' | 'full' | 'over' of `beats` against time signature `ts`; 'empty' with no non-grace beat. */
export function fillOf(beats, ts) {
  if (!beats.some((b) => !isGrace(b))) return 'empty';
  const c = cmp(measureTotal(beats), R(ts.beats, ts.beatType));
  return c < 0 ? 'under' : c > 0 ? 'over' : 'full';
}

/** Fill of the measure of `loc` (voice 1): 'under' | 'full' | 'over' (an empty measure or a hole is 'under'). */
export function measureFill(score, loc) {
  const f = fillOf(beatsAt(score, { track: loc.track, measure: loc.measure }), timeSignatureAt(score, loc));
  return f === 'empty' ? 'under' : f;
}

/** measureFill with the indices checked: RangeError unless `ti` is a track and `mi` a measure column. */
export function checkedMeasureFill(score, ti, mi) {
  if (!Number.isInteger(ti) || ti < 0 || ti >= tracksOf(score).length) throw new RangeError('track out of range');
  if (!Number.isInteger(mi) || mi < 0 || mi >= measureCount(score)) throw new RangeError('measure out of range');
  return measureFill(score, { track: ti, measure: mi });
}

/** Per track, per measure column: 'empty' | 'under' | 'full' | 'over', in one forward pass. */
export function fillTable(score) {
  const count = measureCount(score);
  return tracksOf(score).map((track) => {
    let ts = baseTimeSignature(score, track);
    const out = [];
    for (let mi = 0; mi < count; mi++) {
      const m = measureAt(track, mi);
      if (m?.timeSignature) ts = m.timeSignature;
      out.push(fillOf(beatsOf(m), ts));
    }
    return out;
  });
}
