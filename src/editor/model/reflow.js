/**
 * model/reflow.js — the 2.3 Fill (F) and Reflow (Shift+F) commands on the
 * cursor track, voice 1.
 *
 * Fill appends rests to the cursor measure, or to each measure of the
 * selection: at each onset the largest plain duration (whole … 64th, no
 * dots, no tuplets) that fits and that the onset is a multiple of. A
 * measure that is full, overfull, a pickup or has a gap plain rests can't
 * write (an unfinished tuplet) is refused; with a selection such measures
 * are skipped and counted, each other one is filled all or nothing.
 *
 * Reflow moves the beats whose onset is at or past the measure's length
 * (with their leading graces) to the start of the next measure, adding a
 * measure to every track on the last one. A beat that crosses the barline
 * stays. One measure per press, no cascade. Ties at the seams are
 * repaired; tempo marks stay on their beats.
 */
import { R, ZERO, add, sub, cmp } from '../../rational.js';
import { beatsAt, isGrace, isPickup, measureCount, updateBeats, mainBeatNumber } from './access.js';
import { beatR, measureTotal, timeSignatureAt } from './fill.js';
import { DURATIONS } from './durations.js';
import { leadingGraces } from './beats.js';
import { appendMeasure } from './measures.js';
import { fixTiesIn } from './ties.js';
import { EDITOR_LIMITS } from './limits.js';

const capacity = (score, loc) => { const ts = timeSignatureAt(score, loc); return R(ts.beats, ts.beatType); };

/** The rest durations that fill measure `loc` (`{ track, measure }`), or `{ refused: id }`. */
export function fillPlan(score, loc) {
  if (loc.measure === 0 && isPickup(score)) return { refused: 'fillPickup' };
  const C = capacity(score, loc);
  let o = measureTotal(beatsAt(score, loc));
  const c = cmp(o, C);
  if (c >= 0) return { refused: c > 0 ? 'fillOver' : 'fillFull' };
  const rests = [];
  while (cmp(o, C) < 0) {
    const gap = sub(C, o);
    const k = DURATIONS.findIndex((_, i) => cmp(R(1, 2 ** i), gap) <= 0 && (o.n * 2 ** i) % o.d === 0);
    if (k < 0) return { refused: (o.n * 64) % o.d !== 0 ? 'fillTuplet' : 'fillCannot' };
    rests.push(DURATIONS[k]);
    o = add(o, R(1, 2 ** k));
  }
  return { rests };
}

/** `score` with `rests` appended to measure `loc` (after any trailing graces) and its seams repaired. */
function appendRests(score, loc, rests) {
  const out = updateBeats(score, loc, (bs) => [...bs, ...rests.map((duration) => ({ type: 'rest', duration }))]);
  return fixTiesIn(out, loc.track, loc.measure, loc.measure);
}

/** F: fill the cursor measure, or each measure of the selection (see the header). */
export function fill(score, cursor, state, ctx) {
  const sel = ctx?.selection;
  const [a, b] = sel ? sel.info.measures : [cursor.measure, cursor.measure];
  let out = score;
  let filled = 0;
  let added = 0;
  let refusal = null;
  for (let mi = a; mi <= b; mi++) {
    const loc = { track: cursor.track, measure: mi };
    let plan = fillPlan(out, loc);
    if (plan.rests && beatsAt(out, loc).length + plan.rests.length > EDITOR_LIMITS.beatsPerVoice) plan = { refused: 'tooLarge' };
    if (plan.refused) { refusal ??= plan.refused; continue; }
    out = appendRests(out, loc, plan.rests);
    filled++;
    added += plan.rests.length;
    if (a === b) return { score: out, announce: { id: 'filled', rests: plan.rests } };
  }
  const total = b - a + 1;
  if (total === 1) return { announce: { id: refusal } };
  if (!filled) return { announce: { id: 'nothingToFill' } };
  return { score: out, announce: { id: 'filledMany', count: filled, total, rests: added } };
}

/** Shift+F: move the overflow of the cursor measure to the next measure (see the header). */
export function reflow(score, cursor) {
  const loc = { track: cursor.track, measure: cursor.measure };
  const beats = beatsAt(score, loc);
  const C = capacity(score, loc);
  let t = ZERO;
  let k = -1;
  let crossing = null;
  for (let i = 0; i < beats.length && k < 0; i++) {
    if (isGrace(beats[i])) continue;
    if (cmp(t, C) >= 0) { k = i; break; }
    const end = add(t, beatR(beats[i]));
    if (cmp(end, C) > 0) crossing = mainBeatNumber(beats, i);
    t = end;
  }
  if (k < 0) return { announce: crossing ? { id: 'reflowCrossing', beat: crossing } : { id: 'reflowNothing' } };
  const from = leadingGraces(beats, k);
  const moved = beats.slice(from);
  const count = moved.filter((b) => !isGrace(b)).length;
  let out = score;
  const added = cursor.measure === measureCount(score) - 1;
  if (added) {
    if (measureCount(score) >= EDITOR_LIMITS.measuresPerTrack) return { announce: { id: 'tooLarge' } };
    out = appendMeasure(out);
  }
  const next = { track: cursor.track, measure: cursor.measure + 1 };
  if (beatsAt(out, next).length + moved.length > EDITOR_LIMITS.beatsPerVoice) return { announce: { id: 'tooLarge' } };
  out = updateBeats(out, loc, (bs) => bs.slice(0, from));
  out = updateBeats(out, next, (bs) => [...moved, ...bs]);
  out = fixTiesIn(out, cursor.track, cursor.measure, cursor.measure + 1);
  const follows = cursor.beat >= from && cursor.beat < beats.length;
  const c = follows ? { ...cursor, measure: cursor.measure + 1, beat: cursor.beat - from } : { ...cursor, beat: Math.min(cursor.beat, from) };
  return { score: out, cursor: c, announce: { id: 'reflowed', count, to: cursor.measure + 2, crossing, added } };
}
