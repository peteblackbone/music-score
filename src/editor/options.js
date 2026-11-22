/**
 * options.js — ScoreEditor option defaults and validation (pure).
 * Numeric options that are not finite numbers fall back to their default;
 * integers are floored and clamped to their range.
 */

export const DEFAULTS = Object.freeze({
  maxFret: 24,
  maxFretCap: 99, // sanitize keeps frets 0–99
  twoDigitDelayMs: 800,
  historyLimit: 200,
  historyCap: 10000,
});

/** `v` floored and clamped to [lo, hi]; `fallback` when `v` is not a finite number. */
export const intOption = (v, fallback, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.floor(v))) : fallback);

/** `v` when it is a finite number ≥ 0, else `fallback`. */
export const nonNegative = (v, fallback) => (Number.isFinite(v) && v >= 0 ? v : fallback);

/** The validated behaviour options of `o` (colours, width and theme are handled by style.js and the renderer). */
export function resolveOptions(o = {}) {
  return {
    readOnly: !!o.readOnly,
    maxFret: intOption(o.maxFret, DEFAULTS.maxFret, 0, DEFAULTS.maxFretCap),
    twoDigitDelayMs: nonNegative(o.twoDigitDelayMs, DEFAULTS.twoDigitDelayMs),
    historyLimit: intOption(o.historyLimit, DEFAULTS.historyLimit, 0, DEFAULTS.historyCap),
  };
}
