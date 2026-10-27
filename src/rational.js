/**
 * rational.js — exact fractions for rhythmic time (onsets, durations), so
 * tuplets line up across tracks without floating-point drift. Values are
 * immutable `{ n, d }` objects, always gcd-reduced with a positive
 * denominator. Pure functions, no DOM.
 */

function gcd(a, b) {
  a = Math.abs(a); b = Math.abs(b);
  while (b) { const t = a % b; a = b; b = t; }
  return a || 1;
}

/** Fraction n/d (d defaults to 1), reduced. */
export function R(n, d = 1) {
  if (d === 0) throw new Error('rational: zero denominator');
  if (d < 0) { n = -n; d = -d; }
  const g = gcd(n, d);
  return Object.freeze({ n: n / g, d: d / g });
}

export const ZERO = R(0);

export function add(a, b) { return R(a.n * b.d + b.n * a.d, a.d * b.d); }
export function sub(a, b) { return R(a.n * b.d - b.n * a.d, a.d * b.d); }
export function mul(a, b) { return R(a.n * b.n, a.d * b.d); }

/** -1, 0 or 1. */
export function cmp(a, b) {
  const v = a.n * b.d - b.n * a.d;
  return v < 0 ? -1 : v > 0 ? 1 : 0;
}

/** Larger of two fractions. */
export function max(a, b) { return cmp(a, b) >= 0 ? a : b; }

/** Stable string key, e.g. "3/8", usable in Maps. */
export function key(a) { return `${a.n}/${a.d}`; }

export function toNumber(a) { return a.n / a.d; }
