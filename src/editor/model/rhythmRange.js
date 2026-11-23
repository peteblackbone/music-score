/**
 * model/rhythmRange.js — the 2.3.3 rhythm keys over a selection
 * (ctx.selection): + / = / -, the duration palette (setDuration), dots,
 * triplet, R and L. Commands.js runs these instead of the single-beat
 * commands of beats.js / notes.js when a selection is live.
 *
 * Targets are the voice-1 main beats of every selected part (the slot,
 * graces and voice 2 never); nothing reflows, so measures may end up over
 * or under. Each key is one result, so one undo step; a key that changes
 * nothing returns the same score (no undo step) and still speaks. Every
 * announcement carries the column's track count.
 */
import { validTuplets } from '../../duration.js';
import { isGrace, clampDots, without } from './access.js';
import { DURATIONS } from './durations.js';
import { fixTiesIn } from './ties.js';
import { eachSlice, eachSelectedBeat, partsOf, tracksField } from './rangeEdit.js';

const refuse = (id, extra) => ({ announce: { id, ...extra } });

/** The selected main beats of `parts`, as `[{ b, loc }]` in track, measure, beat order. */
export function mainBeats(score, parts) {
  const out = [];
  eachSelectedBeat(score, parts, (b, loc) => { if (!isGrace(b)) out.push({ b, loc }); });
  return out;
}

/**
 * `score` with every selected main beat of `parts` replaced by fn(beat,
 * loc); graces kept. With `repair`, the ties of each changed part are
 * repaired across its measures. `score` itself when fn changes nothing.
 */
export function mapMain(score, parts, fn, repair = false) {
  let out = score;
  for (const p of parts) {
    let changed = false;
    const next = eachSlice(out, p.track, p.slices, (part, s) => part.map((b, i) => {
      if (isGrace(b)) return b;
      const nb = fn(b, { track: p.track, measure: s.measure, beat: s.from + i });
      if (nb !== b) changed = true;
      return nb;
    }), false);
    if (!changed) continue;
    out = repair ? fixTiesIn(next, p.track, p.slices[0].measure, p.slices[p.slices.length - 1].measure) : next;
  }
  return out;
}

/** The `rangeDuration` descriptor: the duration (and dots) when every result is the same, else `dir`; setDuration (no `dir`) always names it. */
function durationSaid(sel, targets, durs, dir) {
  const dots = targets.map(({ b }) => clampDots(b.dots));
  const sameDots = dots.every((x) => x === dots[0]);
  const same = durs.every((x) => x === durs[0]) && (sameDots || !dir);
  return { id: 'rangeDuration', count: targets.length, ...(same ? { duration: durs[0], dots: sameDots ? dots[0] : 0 } : { dir }), ...tracksField(sel) };
}

const stepRange = (d, dir) => (score, cursor, state, ctx) => {
  const sel = ctx.selection;
  const parts = partsOf(sel);
  const targets = mainBeats(score, parts);
  if (!targets.length) return refuse('noBeatsInSelection');
  const durs = targets.map(({ b }) => DURATIONS[DURATIONS.indexOf(b.duration) + d]);
  if (durs.some((x) => x === undefined)) return refuse('durationLimit');
  const out = mapMain(score, parts, (b) => ({ ...b, duration: DURATIONS[DURATIONS.indexOf(b.duration) + d] }));
  return { score: out, announce: durationSaid(sel, targets, durs, dir) };
};
/** + / = over a range: every target one step shorter; none past a 64th. */
export const shorterRange = stepRange(1, 'halved');
/** - over a range: every target one step longer; none past a whole. */
export const longerRange = stepRange(-1, 'doubled');

/** The duration palette over a range (ScoreEditor.setDuration): every target gets `name`; the current duration too. */
export function setDurationRange(score, cursor, state, ctx, name) {
  if (!DURATIONS.includes(name)) return refuse('limit');
  const sel = ctx.selection;
  const parts = partsOf(sel);
  const targets = mainBeats(score, parts);
  if (!targets.length) return refuse('noBeatsInSelection');
  const out = mapMain(score, parts, (b) => (b.duration === name ? b : { ...b, duration: name }));
  return { score: out, state: { ...state, duration: name }, announce: durationSaid(sel, targets, targets.map(() => name), null) };
}

/** . over a range: all the same dot count → the next (0 → 1 → 2 → 0), mixed → 1; the key is deleted at 0. */
export function dotsRange(score, cursor, state, ctx) {
  const sel = ctx.selection;
  const parts = partsOf(sel);
  const targets = mainBeats(score, parts);
  if (!targets.length) return refuse('noBeatsInSelection');
  const cur = targets.map(({ b }) => clampDots(b.dots));
  const dots = !cur.every((x) => x === cur[0]) ? 1 : cur[0] === 0 ? 1 : cur[0] === 1 ? 2 : 0;
  const out = mapMain(score, parts, (b) => (!dots ? without(b, 'dots') : b.dots === dots ? b : { ...b, dots }));
  return { score: out, announce: { id: 'rangeDots', dots, count: targets.length, ...tracksField(sel) } };
}

/** / over a range: beats with valid nested `tuplets` are skipped; all the others triplets → off, else `tuplet: 3` where it is missing. */
export function tripletRange(score, cursor, state, ctx) {
  const sel = ctx.selection;
  const parts = partsOf(sel);
  const targets = mainBeats(score, parts);
  if (!targets.length) return refuse('noBeatsInSelection');
  const eligible = targets.filter(({ b }) => !validTuplets(b.tuplets));
  if (!eligible.length) return refuse('nestedTuplet');
  const on = !eligible.every(({ b }) => b.tuplet != null);
  const out = mapMain(score, parts, (b) => {
    if (validTuplets(b.tuplets)) return b;
    if (!on) return without(b, 'tuplet');
    return b.tuplet == null ? { ...b, tuplet: 3 } : b;
  });
  return { score: out, announce: { id: 'rangeTriplet', on, count: eligible.length, skipped: targets.length - eligible.length, ...tracksField(sel) } };
}
