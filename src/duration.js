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

/** Exact effective duration of a beat (dots and tuplet ratio applied), as a rational fraction of a whole note. */
export function durationR(el) {
  const base = BASE_R[el.duration];
  if (!base) throw new Error(`Unknown duration: ${el.duration}`);
  let value = base; let addend = base;
  for (let i = 0; i < (el.dots || 0); i++) { addend = mul(addend, R(1, 2)); value = add(value, addend); }
  const t = normalizeTuplet(el.tuplet);
  return t ? mul(value, R(t.of, t.count)) : value;
}

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
