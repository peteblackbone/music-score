/**
 * expression.js — canonical forms of the 1.10 expression fields of a beat:
 * `hairpin`, `fade`, `wah`, `ottava` and `tempo`. Pure functions: anything
 * not understood is null, nothing throws. Strings are trimmed and
 * lower-cased before matching. The raw beat fields pass through
 * normalize.js unchanged (like `beat.text`); drawing canonicalizes them.
 *
 * - hairpinOf: 'cresc' | 'crescendo' | '<' -> 'cresc'; 'dim' | 'diminuendo'
 *   | 'decresc' | 'decrescendo' | '>' -> 'dim'
 * - fadeOf: 'in' | 'out' | 'swell'
 * - wahOf: 'open' | 'o' -> 'open'; 'closed' | 'close' | '+' -> 'closed'
 * - ottavaOf: '8va' | '8vb' | '15ma' | '15mb'
 * - tempoOf: a number (bpm) or `{ bpm, unit, dots, text }` -> `{ bpm, unit,
 *   dots, text }`: bpm finite in (0, 1000]; unit 'whole' | 'half' |
 *   'quarter' | '8th' | '16th' | '32nd' (default 'quarter'); dots an integer
 *   clamped to 0..2; text trimmed (empty -> null)
 */

const HAIRPINS = {
  cresc: 'cresc', crescendo: 'cresc', '<': 'cresc',
  dim: 'dim', diminuendo: 'dim', decresc: 'dim', decrescendo: 'dim', '>': 'dim',
};
const FADES = { in: 'in', out: 'out', swell: 'swell' };
const WAHS = { open: 'open', o: 'open', closed: 'closed', close: 'closed', '+': 'closed' };
const OTTAVAS = { '8va': '8va', '8vb': '8vb', '15ma': '15ma', '15mb': '15mb' };
const TEMPO_UNITS = ['whole', 'half', 'quarter', '8th', '16th', '32nd'];
const MAX_BPM = 1000;
const MAX_TEMPO_DOTS = 2;

/** Staff-position shift of the notes inside an ottava run, as displayed (the written pitch is untouched). */
export const OTTAVA_SHIFT = { '8va': -7, '15ma': -14, '8vb': 7, '15mb': 14 };

/** `raw` trimmed and lower-cased looked up in `table` (own keys only), or null. */
function lookup(table, raw) {
  if (typeof raw !== 'string') return null;
  const k = raw.trim().toLowerCase();
  return Object.hasOwn(table, k) ? table[k] : null;
}

export const hairpinOf = (raw) => lookup(HAIRPINS, raw);
export const fadeOf = (raw) => lookup(FADES, raw);
export const wahOf = (raw) => lookup(WAHS, raw);
export const ottavaOf = (raw) => lookup(OTTAVAS, raw);

/** A number, or a non-empty numeric string, as a number; else NaN. */
function numberOf(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') return Number(v);
  return NaN;
}

/** Canonical tempo change of `beat.tempo` (see the header), or null. */
export function tempoOf(raw) {
  const obj = raw != null && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  const bpm = numberOf(obj ? obj.bpm : raw);
  if (!Number.isFinite(bpm) || bpm <= 0 || bpm > MAX_BPM) return null;
  if (!obj) return { bpm, unit: 'quarter', dots: 0, text: null };
  const unit = typeof obj.unit === 'string' && TEMPO_UNITS.includes(obj.unit.trim().toLowerCase()) ? obj.unit.trim().toLowerCase() : 'quarter';
  const d = numberOf(obj.dots);
  const dots = Number.isFinite(d) && d > 0 ? Math.min(MAX_TEMPO_DOTS, Math.floor(d)) : 0;
  const text = typeof obj.text === 'string' && obj.text.trim() ? obj.text.trim() : null;
  return { bpm, unit, dots, text };
}

/** "= N" number of a tempo mark: at most 2 decimals, trailing zeros stripped (120, 92.5, 60.33). */
export function formatBpm(bpm) {
  return String(Math.round(bpm * 100) / 100);
}
