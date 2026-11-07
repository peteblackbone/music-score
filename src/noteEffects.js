/**
 * noteEffects.js — pure canonicalizers for the beat-level note-effect
 * fields `vibrato`, `tremolo` and `fermata`. Each maps any raw value to
 * one canonical form, is idempotent (f(f(x)) === f(x)) and never throws.
 * They are applied when drawing, not in normalize.js, so the normalized
 * model is unchanged.
 */

const TREMOLO_STROKES = { '8th': 1, '16th': 2, '32nd': 3 };
const FERMATA_KINDS = ['normal', 'short', 'long'];

const word = (raw) => (typeof raw === 'string' ? raw.trim().toLowerCase() : null);

/**
 * `vibrato`: 'wide' (the string, trimmed, any case) → 'wide'; any other
 * truthy value → true (the normal wave); falsy → null (no vibrato).
 */
export function vibratoOf(raw) {
  if (!raw) return null;
  return word(raw) === 'wide' ? 'wide' : true;
}

/**
 * `tremolo`: '8th' | '16th' | '32nd' (trimmed, any case) → that speed; any
 * other truthy value (true, 2, 8, 'x', …) → true (three strokes, no speed
 * class); falsy → null.
 */
export function tremoloOf(raw) {
  if (!raw) return null;
  const w = word(raw);
  return Object.hasOwn(TREMOLO_STROKES, w ?? '') ? w : true;
}

/** Stroke count for a canonical tremolo value: 1 / 2 / 3 for '8th' / '16th' / '32nd', otherwise 3. */
export function tremoloStrokes(canonical) {
  return Object.hasOwn(TREMOLO_STROKES, canonical) ? TREMOLO_STROKES[canonical] : 3;
}

/**
 * `fermata`: true → 'normal'; 'normal' | 'short' | 'long' (trimmed, any
 * case) → that kind; anything else ('true', 1, false, null, …) → null.
 */
export function fermataOf(raw) {
  if (raw === true) return 'normal';
  const w = word(raw);
  return FERMATA_KINDS.includes(w) ? w : null;
}
