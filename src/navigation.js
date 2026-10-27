/**
 * navigation.js — canonical forms of the measure-level navigation fields
 * (volta endings, segno, coda, jump texts) and their score-wide merge.
 * Pure functions, imports nothing.
 *
 * Measure fields (column-level: the union over all tracks, the lowest
 * track index wins on a conflicting `ending` / `jump`):
 * - `ending`: 1 | '2' | [1, 2] | { numbers, text?, open? } — numbers are
 *   safe integers >= 1 (numeric strings count), invalid items are dropped,
 *   the rest deduplicated and sorted (at most MAX_ENDING_NUMBERS, the
 *   lowest, are kept); `text` replaces the "1., 2." label;
 *   `open: true | false` overrides whether the bracket gets a right hook.
 * - `segno: true`, `coda: true` (only the boolean `true` counts).
 * - `jump`: 'D.C.', 'D.C. al Fine', 'D.C. al Coda', 'D.S.', 'D.S. al Fine',
 *   'D.S. al Coda', 'To Coda', 'Fine' (matched case-insensitively, whitespace
 *   collapsed); any other non-empty string is kept as plain text.
 */

export const JUMP_TEXTS = ['D.C.', 'D.C. al Fine', 'D.C. al Coda', 'D.S.', 'D.S. al Fine', 'D.S. al Coda', 'To Coda', 'Fine'];

/** One ending number: a safe integer >= 1 or a trimmed all-digit string; else null. */
function endingNumber(v) {
  let n = null;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string' && /^\d+$/.test(v.trim())) n = Number(v.trim());
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

/** Most ending numbers kept per ending (the lowest ones). */
export const MAX_ENDING_NUMBERS = 32;

/**
 * Ending numbers of a raw value (single number / string or an array of
 * them): sorted, unique, at most MAX_ENDING_NUMBERS (the lowest); [] for
 * garbage. Keeps a bounded sorted list, so a huge array is never sorted whole.
 */
export function endingNumbers(raw) {
  const items = Array.isArray(raw) ? raw : [raw];
  const out = [];
  for (const v of items) {
    const n = endingNumber(v);
    if (n == null) continue;
    if (out.length === MAX_ENDING_NUMBERS && n >= out[out.length - 1]) continue;
    let i = out.length;
    while (i > 0 && out[i - 1] > n) i--;
    if (out[i - 1] === n) continue;
    out.splice(i, 0, n);
    if (out.length > MAX_ENDING_NUMBERS) out.pop();
  }
  return out;
}

/** Canonical ending `{ numbers, text, open }` (text: string | null, open: boolean | null), or null when invalid. Idempotent. */
export function canonicalEnding(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const numbers = endingNumbers(raw.numbers);
    const text = typeof raw.text === 'string' && raw.text.trim() !== '' ? raw.text.trim() : null;
    const open = typeof raw.open === 'boolean' ? raw.open : null;
    return numbers.length || text ? { numbers, text, open } : null;
  }
  const numbers = endingNumbers(raw);
  return numbers.length ? { numbers, text: null, open: null } : null;
}

/** Identity of a canonical ending for bracket grouping (`open` is not part of it). */
export function endingKey(ending) {
  return `${ending.numbers.join(',')}|${ending.text ?? ''}`;
}

/** Label of a canonical ending: its text, else "1." / "1., 2.". */
export function endingLabel(ending) {
  return ending.text ?? ending.numbers.map((n) => `${n}.`).join(', ');
}

/** Canonical jump text: a standard text in its canonical spelling, other non-empty strings trimmed; else null. */
export function canonicalJump(raw) {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().replace(/\s+/g, ' ');
  if (!t) return null;
  const lower = t.toLowerCase();
  return JUMP_TEXTS.find((j) => j.toLowerCase() === lower) ?? t;
}

/** Kind of a canonical jump text: 'dc' | 'ds' | 'toCoda' | 'fine' | 'text'. */
export function jumpKind(text) {
  if (text === 'To Coda') return 'toCoda';
  if (text === 'Fine') return 'fine';
  if (JUMP_TEXTS.includes(text)) return text.startsWith('D.C.') ? 'dc' : 'ds';
  return 'text';
}

/**
 * Merge the navigation fields of all tracks per measure column:
 * `[{ ending, segno, coda, jump }]` of length `measureCount`. `ending` and
 * `jump` come from the lowest track index with a valid value; `segno` /
 * `coda` are true when any track sets them. Missing / null measures add nothing.
 */
export function mergeNavigation(rawTracks, measureCount) {
  const out = [];
  for (let mi = 0; mi < measureCount; mi++) {
    let ending = null; let jump = null; let segno = false; let coda = false;
    for (const track of rawTracks || []) {
      const m = track?.measures?.[mi];
      if (!m || typeof m !== 'object') continue;
      if (!ending) ending = canonicalEnding(m.ending);
      if (!jump) jump = canonicalJump(m.jump);
      if (m.segno === true) segno = true;
      if (m.coda === true) coda = true;
    }
    out.push({ ending, segno, coda, jump });
  }
  return out;
}
