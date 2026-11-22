/**
 * model/io.js — score input and output for the editor.
 *
 * Input (a JSON string or a plain object) is cloned through JSON with a
 * reviver that drops `__proto__` keys, checked for `schemaVersion`
 * (missing, null or 1 accepted; the key is not kept) and against the
 * size limits (limits.js: `Score too large: …`), then repaired with
 * sanitizeScore until it reaches a fixed point, so every later command
 * starts from a model sanitize returns unchanged (B10).
 * Output is a JSON clone with `schemaVersion: 1` first.
 */
import { sanitizeScore } from '../../sanitize.js';
import { checkLimits, checkJsonLength } from './limits.js';

export const SCHEMA_VERSION = 1;

const reviver = (k, v) => (k === '__proto__' ? undefined : v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** sanitizeScore repeated until it returns its input (at most 3 times). */
export function sanitizeFixed(score) {
  let s = score;
  for (let i = 0; i < 3; i++) {
    const next = sanitizeScore(s);
    if (next === s) break;
    s = next;
  }
  return s;
}

/**
 * The editor model for `input` (JSON string or object). Throws
 * `Error('Score must be a JSON object')`, `Error('Unsupported schemaVersion')`,
 * `Error('Score too large: …')` (limits.js) or the JSON.parse SyntaxError;
 * never returns a partial result.
 */
export function parseInput(input) {
  const text = typeof input === 'string' ? input : JSON.stringify(input ?? null) ?? 'null';
  checkJsonLength(text.length);
  const data = JSON.parse(text, reviver);
  if (!isObj(data)) throw new Error('Score must be a JSON object');
  if (data.schemaVersion != null && data.schemaVersion !== SCHEMA_VERSION) throw new Error('Unsupported schemaVersion');
  checkLimits(data);
  delete data.schemaVersion;
  return sanitizeFixed(data);
}

/**
 * Characters of the JSON text of exportScore(model) (what getScore() returns,
 * `schemaVersion` included), without cloning: the size loadScore checks.
 */
export function exportedLength(model) {
  const json = JSON.stringify(model);
  return json.length + (json === '{}' ? 17 : 18); // '"schemaVersion":1' plus a comma when other keys follow
}

/** `{ schemaVersion: 1, ...a deep JSON clone of model }`. */
export function exportScore(model) {
  return { schemaVersion: SCHEMA_VERSION, ...JSON.parse(JSON.stringify(model)) };
}
