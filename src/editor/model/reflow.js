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
 * measure to every track on the last one. 2.3.1: a beat that crosses the
 * barline is split into tied pieces of plain durations (reflowSplit.js),
 * the part after the barline moving on; a tuplet beat, or one plain
 * durations can't write, stays. Then Reflow carries on into each following
 * measure while it is overfull (a cascade, all or nothing against the
 * limits, one result); it never pulls beats back. Trailing graces after a
 * split beat stay. Ties at the seams are repaired; tempo marks stay on
 * their beats; the cursor follows its beat.
 */
import { R, ZERO, add, sub, cmp } from '../../rational.js';
import { beatsAt, isGrace, isPickup, measureCount, updateBeats, mainBeatNumber } from './access.js';
import { beatR, measureTotal, timeSignatureAt, measureFill } from './fill.js';
import { plainRun, splitBeat } from './reflowSplit.js';
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

/**
 * One measure of Reflow (see the header) on `loc` (`{ track, measure }`):
 * `{ score, count, added, split, crossing, from, afterCount }` (count: main
 * beats moved; split / crossing: the beat number of a split / staying beat;
 * from: the first index that moved; afterCount: the split pieces that open
 * the next measure), `{ crossing }` with nothing to move, or `{ refused }`.
 */
function reflowStep(score, loc) {
  const beats = beatsAt(score, loc);
  const C = capacity(score, loc);
  let t = ZERO;
  let k = -1;
  let cross = -1;
  let span = null;
  for (let i = 0; i < beats.length; i++) {
    if (isGrace(beats[i])) continue;
    if (cmp(t, C) >= 0) { k = i; break; }
    const end = add(t, beatR(beats[i]));
    if (cmp(end, C) > 0) { cross = i; span = [t, end]; }
    t = end;
  }
  let before = null;
  let pieces = null;
  if (cross >= 0 && !('tuplet' in beats[cross]) && !('tuplets' in beats[cross])) {
    before = plainRun(span[0], C);
    const after = before && plainRun(ZERO, sub(span[1], C));
    if (after) pieces = splitBeat(beats[cross], [...before, ...after]);
  }
  const crossing = cross >= 0 && !pieces ? mainBeatNumber(beats, cross) : null;
  const from = k >= 0 ? leadingGraces(beats, k) : beats.length;
  if (!pieces && k < 0) return { crossing };
  const kept = pieces ? [...beats.slice(0, cross), ...pieces.slice(0, before.length), ...beats.slice(cross + 1, from)] : beats.slice(0, from);
  const afterPieces = pieces ? pieces.slice(before.length) : [];
  const moved = [...afterPieces, ...beats.slice(from)];
  let out = score;
  const added = loc.measure === measureCount(score) - 1;
  if (added) {
    if (measureCount(score) >= EDITOR_LIMITS.measuresPerTrack) return { refused: 'tooLarge' };
    out = appendMeasure(out);
  }
  const next = { track: loc.track, measure: loc.measure + 1 };
  if (kept.length > EDITOR_LIMITS.beatsPerVoice || beatsAt(out, next).length + moved.length > EDITOR_LIMITS.beatsPerVoice) return { refused: 'tooLarge' };
  out = updateBeats(out, loc, () => kept);
  out = updateBeats(out, next, (bs) => [...moved, ...bs]);
  out = fixTiesIn(out, loc.track, loc.measure, loc.measure + 1);
  const count = moved.filter((b) => !isGrace(b)).length;
  return { score: out, count, added, split: pieces ? mainBeatNumber(beats, cross) : null, crossing, from, afterCount: afterPieces.length };
}

/** Shift+F: reflow the cursor measure, then each following measure while it is overfull (see the header). */
export function reflow(score, cursor) {
  const track = cursor.track;
  let out = score;
  let c = cursor;
  let steps = 0;
  let added = 0;
  let split = 0;
  let crossing = null;
  let first = null;
  for (let mi = cursor.measure; mi < measureCount(out); mi++) {
    if (mi > cursor.measure && measureFill(out, { track, measure: mi }) !== 'over') break;
    const st = reflowStep(out, { track, measure: mi });
    if (st.refused) return { announce: { id: st.refused } };
    if (st.crossing) crossing ??= { measure: mi + 1, beat: st.crossing };
    if (!st.score) break;
    steps++;
    first ??= st;
    if (st.added) added++;
    if (st.split) split++;
    out = st.score;
    if (c.measure === mi && c.beat >= st.from) c = { ...c, measure: mi + 1, beat: st.afterCount + (c.beat - st.from) };
  }
  if (!steps) return { announce: crossing ? { id: 'reflowCrossing', beat: crossing.beat } : { id: 'reflowNothing' } };
  if (steps === 1) {
    return { score: out, cursor: c, announce: { id: 'reflowed', count: first.count, to: cursor.measure + 2, crossing: first.crossing, added: first.added, split: first.split } };
  }
  return { score: out, cursor: c, announce: { id: 'reflowedMany', count: steps, added, split, crossing } };
}
