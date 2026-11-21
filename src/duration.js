/**
 * duration.js — rhythmic duration math shared by layout and rendering.
 * Durations are expressed as fractions of a whole note (numbers, or exact
 * rationals from rational.js where noted).
 */
import { R, add, mul } from './rational.js';

/** Whether a duration is short enough to normally take a flag/beam (eighth or shorter). */
export function isBeamable(duration) {
  return ['8th', '16th', '32nd', '64th'].includes(duration);
}

/** A rest that takes time but draws nothing and takes no room (`hidden: true`). */
export const isHiddenRest = (b) => b.type === 'rest' && !!b.hidden;

/** Number of beam lines (flags) for a given duration: 8th=1, 16th=2, 32nd=3, 64th=4 */
export function beamCount(duration) {
  return { '8th': 1, '16th': 2, '32nd': 3, '64th': 4 }[duration] || 0;
}

/**
 * Normalize a beat's `tuplet` field into `{ count, of }` — `count` notes
 * played in the time normally taken by `of` of them, e.g. a plain
 * `tuplet: 3` (or `{ count: 3 }`) is a standard triplet: 3 in the time of
 * 2. Defaults `of` to 2 since that covers the common cases (triplets,
 * quintuplets, septuplets all borrow time from the next power-of-two
 * grouping) without requiring the author to spell it out.
 */
export function normalizeTuplet(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') return { count: raw, of: 2 };
  return { count: raw.count ?? 3, of: raw.of ?? 2 };
}

const BASE_R = {
  whole: R(1), half: R(1, 2), quarter: R(1, 4), '8th': R(1, 8), '16th': R(1, 16), '32nd': R(1, 32), '64th': R(1, 64),
};

/** Exact effective duration of a beat (dots and every tuplet ratio of its chain applied), as a rational fraction of a whole note. */
export function durationR(el) {
  const base = BASE_R[el.duration];
  if (!base) throw new Error(`Unknown duration: ${el.duration}`);
  let value = base; let addend = base;
  for (let i = 0; i < (el.dots || 0); i++) { addend = mul(addend, R(1, 2)); value = add(value, addend); }
  return tupletChain(el).reduce((v, t) => mul(v, R(t.of, t.count)), value);
}

// Bounds of a strict `tuplets` entry: keeps every ratio product an exact, small rational.
const TUPLET_COUNT_MIN = 2;
const TUPLET_MAX = 64;
const inRange = (v, min) => Number.isInteger(v) && v >= min && v <= TUPLET_MAX;
/**
 * One strict `tuplets` entry: an integer n in 2–64 ({ count: n, of: 2 }) or
 * a plain { count: 2–64, of: 1–64 (default 2) } of integers; else null.
 */
function strictTuplet(raw) {
  if (typeof raw === 'number') return inRange(raw, TUPLET_COUNT_MIN) ? { count: raw, of: 2 } : null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const of = raw.of === undefined ? 2 : raw.of;
  return inRange(raw.count, TUPLET_COUNT_MIN) && inRange(of, 1) ? { count: raw.count, of } : null;
}

/**
 * A beat's `tuplets` field (nested tuplets, outer first): an array of 1–2
 * strict entries (see strictTuplet: integers, count 2–64, of 1–64) → `[{ count, of }]`; anything else —
 * not an array, empty, longer than 2, or any invalid entry — → null (the
 * whole field is ignored and `tuplet` applies).
 */
export function validTuplets(raw) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 2) return null;
  const out = raw.map(strictTuplet);
  return out.every(Boolean) ? out : null;
}

/**
 * The tuplet ratios a beat sits in, outer → inner: a valid `tuplets`
 * (overrides `tuplet`), else `[normalizeTuplet(tuplet)]`, else `[]`.
 */
export function tupletChain(el) {
  const nested = validTuplets(el.tuplets);
  if (nested) return nested;
  const t = normalizeTuplet(el.tuplet);
  return t ? [t] : [];
}

/** Written (notated) duration: dots applied, every tuplet ratio ignored. */
export const writtenR = (el) => durationR({ duration: el.duration, dots: el.dots });
/** Whether a reduced rational is 1/2^n (a plain, undotted note value). */
export const isPow2Value = (q) => q.n === 1 && (q.d & (q.d - 1)) === 0;
/** Whether two `{ count, of }` ratios are both present and equal. */
export const sameRatio = (a, b) => !!a && !!b && a.count === b.count && a.of === b.of;

/**
 * Beam/tuplet cell length (rational) for a time signature (ui.md §7):
 * compound meters (beats divisible by 3, more than 3, beat unit 8 or
 * shorter: 6/8, 9/8, 12/8, 6/16…) group in dotted beats of 3/beatType;
 * 3/8 is one cell for the whole bar; otherwise one beat unit (1/beatType).
 */
export function beamCellValue(timeSignature) {
  const { beats, beatType } = timeSignature;
  if (beats === 3 && beatType === 8) return R(3, 8);
  if (beatType >= 8 && beats % 3 === 0 && beats > 3) return R(3, beatType);
  return R(1, beatType);
}
