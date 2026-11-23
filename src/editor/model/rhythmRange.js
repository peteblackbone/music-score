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
 * announcement carries the column's track count. R and L need a string:
 * they use the selected tracks with TAB only and count the others skipped.
 */
import { validTuplets } from '../../duration.js';
import { trackAt, hasTab, isGrace, isRest, clampDots, notesOf, noteOn, stringCount, without } from './access.js';
import { DURATIONS } from './durations.js';
import { fixTiesIn, nextMainBeat } from './ties.js';
import { eachSlice, eachSelectedBeat, partsOf, tracksField, asRest } from './rangeEdit.js';

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

/** The parts of `sel` on tracks with TAB, and the column fields `{ tracks, skippedTracks }` (nothing for one track). */
function tabParts(score, sel) {
  const parts = partsOf(sel);
  const usable = parts.filter((p) => hasTab(trackAt(score, p.track)));
  return { usable, cols: sel.parts ? { tracks: usable.length, skippedTracks: parts.length - usable.length } : {} };
}

/** R over a range: any note → every note beat a rest (as Delete); all rests → notes at fret 0 on the cursor string (clamped per track). Ties repaired. */
export function restRange(score, cursor, state, ctx) {
  const { usable, cols } = tabParts(score, ctx.selection);
  if (!usable.length) return refuse('needsTab');
  const targets = mainBeats(score, usable);
  if (!targets.length) return refuse('noBeatsInSelection');
  const notes = targets.filter(({ b }) => !isRest(b)).length;
  if (notes) return { score: mapMain(score, usable, asRest, true), announce: { id: 'rangeToRest', count: notes, ...cols } };
  const toNote = (b, loc) => ({ ...without(b, 'hidden'), type: 'note', notes: [{ string: Math.min(cursor.string, stringCount(trackAt(score, loc.track))), fret: 0 }] });
  return { score: mapMain(score, usable, toNote, true), announce: { id: 'rangeToNote', count: targets.length, ...cols } };
}

const noteKey = (loc, string) => `${loc.track}:${loc.measure}:${loc.beat}:${string}`;
const sameLoc = (a, b) => !!a && a.track === b.track && a.measure === b.measure && a.beat === b.beat;

/** The tie pairs of `parts`: neighbouring main beats (a rest breaks them) with a note on the same string at the same integer fret. */
function tiePairs(score, parts) {
  const pairs = [];
  for (const p of parts) {
    let prev = null;
    for (const x of mainBeats(score, [p])) {
      const next = prev && !isRest(prev.b) && !isRest(x.b) && (prev.loc.measure === x.loc.measure || sameLoc(nextMainBeat(score, prev.loc), x.loc));
      for (const a of next ? notesOf(prev.b) : []) {
        const c = a.string != null && Number.isInteger(a.fret) ? noteOn(x.b, a.string) : null;
        if (c && c.fret === a.fret) pairs.push({ from: prev.loc, to: x.loc, string: a.string, tied: !!a.tieStart && !!c.tieEnd });
      }
      prev = x;
    }
  }
  return pairs;
}

/** L over a range: every pair already tied → all untied, else all tied; only the tie flags change (never frets or pitch). */
export function tieRange(score, cursor, state, ctx) {
  const { usable, cols } = tabParts(score, ctx.selection);
  if (!usable.length) return refuse('needsTab');
  const pairs = tiePairs(score, usable);
  if (!pairs.length) return refuse('nothingToTie');
  const tie = !pairs.every((x) => x.tied);
  const flags = new Map();
  const want = (loc, string, flag) => {
    const k = noteKey(loc, string);
    flags.set(k, [...(flags.get(k) ?? []), flag]);
  };
  for (const x of pairs) { want(x.from, x.string, 'tieStart'); want(x.to, x.string, 'tieEnd'); }
  const write = (n, list) => list.reduce((m, f) => (tie ? (m[f] ? m : { ...m, [f]: true }) : without(m, f)), n);
  const out = mapMain(score, usable, (b, loc) => {
    if (isRest(b) || !Array.isArray(b.notes)) return b;
    const notes = b.notes.map((n) => (n.string != null && flags.has(noteKey(loc, n.string)) ? write(n, flags.get(noteKey(loc, n.string))) : n));
    return notes.some((n, i) => n !== b.notes[i]) ? { ...b, notes } : b;
  });
  return { score: out, announce: { id: 'rangeTie', tied: tie, count: pairs.length, ...cols } };
}
