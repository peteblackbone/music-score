/**
 * layout/beams.js — rhythmic-cell bucketing of a measure's beats, and the
 * beam and tuplet groupings built on it. Pure functions, no DOM/SVG here.
 */
import { isBeamable, normalizeTuplet, durationR, beamCellValue } from '../duration.js';
import { R, ZERO, add, mul, cmp } from '../rational.js';

/**
 * The rhythmic cell index each beat starts in, using `beamCellValue` (one
 * beat unit; a dotted beat in compound meters; the whole bar in 3/8) as
 * the cell length, in exact fractions. Grace notes borrow no time from the
 * beat they lead into — they sit in their own tiny slot just before the
 * note they decorate — so they count as zero duration and must not shift
 * that note's cell bucket. Returns one cell index per beat.
 */
export function beatCells(beats, timeSignature) {
  const cell = beamCellValue(timeSignature);
  let pos = ZERO;
  return beats.map((el) => {
    const index = Math.floor((pos.n * cell.d) / (pos.d * cell.n));
    if (el.type !== 'grace') pos = add(pos, durationR(el));
    return index;
  });
}

/** Group a measure's elements into beam clusters. Returns array of index-arrays. */
export function groupBeams(beats, timeSignature) {
  const cells = beatCells(beats, timeSignature);
  const groups = [];
  let current = [];
  let currentCell = null;
  beats.forEach((el, idx) => {
    const cell = cells[idx];
    const eligible = el.type === 'note' && isBeamable(el.duration);
    if (eligible && (current.length === 0 || cell === currentCell)) {
      current.push(idx);
      currentCell = cell;
    } else {
      if (current.length) groups.push(current);
      current = eligible ? [idx] : [];
      currentCell = eligible ? cell : null;
    }
  });
  if (current.length) groups.push(current);
  return groups;
}

/** Written (notated) duration: dots applied, tuplet ratio ignored. */
const writtenR = (el) => durationR({ duration: el.duration, dots: el.dots });
/** Whether a reduced rational is 1/2^n (a plain, undotted note value). */
const isPow2Value = (q) => q.n === 1 && (q.d & (q.d - 1)) === 0;
const sameRatio = (a, b) => !!b && a.count === b.count && a.of === b.of;

/**
 * Group consecutive beats sharing the same normalized tuplet ratio into one
 * bracket each (exact rationals). Returns `[{ indices, count }]` in measure
 * order; `indices` may skip a grace note that sits inside the tuplet.
 * - Run: same-ratio beats from the group's first beat. Grace notes are
 *   skipped (never members); a ratio change, a non-tuplet beat or the
 *   barline ends the run.
 * - Complete point: the summed WRITTEN duration W (dots included, ratio
 *   ignored) divided by `count` is a plain power-of-two value, and W is at
 *   least `count` × the shortest written value so far — the second check
 *   stops a 16th sextuplet from closing after three 16ths. So three
 *   quarter-note triplets in 4/4 make one bracket, while 8th triplets still
 *   get one per beat.
 * - Close: at the first complete point, unless it falls inside the beat
 *   cell of the group's first beat and a later complete point ends exactly
 *   on that cell's end (so [8th, 16th, 16th, 8th] as a triplet stays one
 *   group). A run that never completes falls back to one bracket per
 *   rhythmic cell (beatCells), as before.
 */
export function tupletGroups(beats, timeSignature) {
  const cell = beamCellValue(timeSignature);
  const cells = beatCells(beats, timeSignature);
  const onset = [];
  let pos = ZERO;
  beats.forEach((el) => { onset.push(pos); if (el.type !== 'grace') pos = add(pos, durationR(el)); });
  const out = [];
  let qi = 0;
  while (qi < beats.length) {
    const t0 = beats[qi].type === 'grace' ? null : normalizeTuplet(beats[qi].tuplet);
    if (!t0) { qi++; continue; }
    const run = [];
    for (let i = qi; i < beats.length; i++) {
      if (beats[i].type === 'grace') continue;
      if (!sameRatio(t0, normalizeTuplet(beats[i].tuplet))) break;
      run.push(i);
    }
    const cellEnd = mul(R(cells[qi] + 1), cell);
    let W = ZERO;
    let shortest = null;
    let first = -1;
    let close = -1;
    for (let k = 0; k < run.length; k++) {
      const el = beats[run[k]];
      const w = writtenR(el);
      W = add(W, w);
      if (!shortest || cmp(w, shortest) < 0) shortest = w;
      const end = add(onset[run[k]], durationR(el));
      const plainUnit = isPow2Value(mul(W, R(1, t0.count)));
      const longEnough = cmp(W, mul(shortest, R(t0.count))) >= 0;
      const complete = plainUnit && longEnough;
      if (first < 0) {
        // First complete point: close now if it reaches the end of the first beat's cell.
        if (complete) { first = k; if (cmp(end, cellEnd) >= 0) { close = k; break; } }
      } else {
        // Inside the cell: prefer a later complete point ending exactly on the cell end.
        if (cmp(end, cellEnd) > 0) break;
        if (complete && cmp(end, cellEnd) === 0) { close = k; break; }
      }
    }
    if (close < 0) close = first;
    const indices = close >= 0 ? run.slice(0, close + 1) : run.filter((i) => cells[i] === cells[qi]);
    out.push({ indices, count: t0.count });
    qi = indices[indices.length - 1] + 1;
  }
  return out;
}
