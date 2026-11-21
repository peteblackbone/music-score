/**
 * layout/tuplets.js — tuplet grouping for voices with nested tuplets (a
 * beat whose valid `tuplets` chain has two entries, outer → inner).
 * tupletGroups (layout/beams.js) hands such a voice over here; every other
 * voice keeps today's grouping untouched. Pure functions, exact rationals.
 *
 * Output `[{ indices, count, depth? }]`, sorted by first index, an outer
 * group before its inner groups: an outer group holding at least one inner
 * group gets `depth: 0`, each inner group `depth: 1`, any other group no
 * `depth` (drawn exactly like a plain tuplet).
 */
import {
  durationR, tupletChain, validTuplets, beamCellValue, writtenR, isPow2Value, sameRatio,
} from '../duration.js';
import { R, ZERO, add, mul, cmp } from '../rational.js';

const cellIndex = (pos, cell) => Math.floor((pos.n * cell.d) / (pos.d * cell.n));

/** Whether some non-grace beat of the voice has a valid 2-entry `tuplets` chain. */
export function hasNestedTuplets(beats) {
  return beats.some((b) => b.type !== 'grace' && validTuplets(b.tuplets)?.length === 2);
}

/**
 * Split `run` (indices sharing one ratio) into groups by tupletGroups' close
 * rule: `unit(i)` is the beat's value counted for completeness, `onset(i)` /
 * `end(i)` its time and `cellOf(i)` its rhythmic cell (cell length `cell`).
 * A group closes at its first complete point unless that point falls inside
 * the first beat's cell and a later complete point ends exactly on the cell
 * end; a run that never completes falls back to one group per cell. Every
 * step takes at least one beat, so the loop always ends.
 * Keep in sync with tupletGroups in layout/beams.js (same rule, generalized).
 */
function splitRun(run, count, { unit, end, cellOf, cell }) {
  const groups = [];
  let rest = run;
  while (rest.length) {
    const cellEnd = mul(R(cellOf(rest[0]) + 1), cell);
    let W = ZERO; let shortest = null; let first = -1; let close = -1;
    for (let k = 0; k < rest.length; k++) {
      const w = unit(rest[k]);
      W = add(W, w);
      if (!shortest || cmp(w, shortest) < 0) shortest = w;
      const e = end(rest[k]);
      const complete = isPow2Value(mul(W, R(1, count))) && cmp(W, mul(shortest, R(count))) >= 0;
      if (first < 0) {
        if (complete) { first = k; if (cmp(e, cellEnd) >= 0) { close = k; break; } }
      } else {
        if (cmp(e, cellEnd) > 0) break;
        if (complete && cmp(e, cellEnd) === 0) { close = k; break; }
      }
    }
    if (close < 0) close = first;
    let indices = close >= 0 ? rest.slice(0, close + 1) : rest.filter((i) => cellOf(i) === cellOf(rest[0]));
    // always advance: a cell that compares to nothing (e.g. NaN time) still yields its first beat
    if (!indices.length) indices = [rest[0]];
    groups.push(indices);
    rest = rest.slice(rest.indexOf(indices[indices.length - 1]) + 1);
  }
  return groups;
}

/**
 * Nested tuplet groups of one voice. Outer pass: runs of consecutive
 * non-grace beats with the same outer ratio (chain[0]), split by the close
 * rule in outer-frame units (written value × every inner ratio) with real
 * onsets and beat cells. Inner pass, per outer group: maximal runs of
 * consecutive members with a 2-entry chain and the same chain[1], split by
 * the close rule in written units, timed in the outer frame (running sum of
 * outer-frame units from the outer group's first beat) with frame cells.
 */
export function nestedTupletGroups(beats, timeSignature) {
  const cell = beamCellValue(timeSignature);
  const chains = beats.map((b) => (b.type === 'grace' ? [] : tupletChain(b)));
  const onset = []; const cells = [];
  let pos = ZERO;
  beats.forEach((el) => {
    onset.push(pos); cells.push(cellIndex(pos, cell));
    if (el.type !== 'grace') pos = add(pos, durationR(el));
  });
  const frameUnit = (i) => chains[i].slice(1).reduce((v, t) => mul(v, R(t.of, t.count)), writtenR(beats[i]));
  const out = [];
  let qi = 0;
  while (qi < beats.length) {
    const t0 = chains[qi][0];
    if (!t0) { qi++; continue; }
    const run = [];
    for (let i = qi; i < beats.length; i++) {
      if (beats[i].type === 'grace') continue;
      if (!sameRatio(t0, chains[i][0])) break;
      run.push(i);
    }
    splitRun(run, t0.count, {
      unit: frameUnit, end: (i) => add(onset[i], durationR(beats[i])), cellOf: (i) => cells[i], cell,
    }).forEach((indices) => {
      const frameOnset = new Map();
      let f = ZERO;
      indices.forEach((i) => { frameOnset.set(i, f); f = add(f, frameUnit(i)); });
      const inner = [];
      for (let k = 0; k < indices.length;) {
        const t1 = chains[indices[k]][1];
        if (!t1) { k++; continue; }
        const irun = [];
        while (k < indices.length && sameRatio(t1, chains[indices[k]][1])) irun.push(indices[k++]);
        splitRun(irun, t1.count, {
          unit: (i) => writtenR(beats[i]), end: (i) => add(frameOnset.get(i), frameUnit(i)),
          cellOf: (i) => cellIndex(frameOnset.get(i), cell), cell,
        }).forEach((g) => inner.push({ indices: g, count: t1.count, depth: 1 }));
      }
      out.push(inner.length ? { indices, count: t0.count, depth: 0 } : { indices, count: t0.count }, ...inner);
    });
    qi = run[run.length - 1] + 1;
  }
  return out;
}
