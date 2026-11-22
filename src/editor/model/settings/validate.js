/**
 * model/settings/validate.js — argument checks shared by the 2.2 settings
 * operations. Every check throws before anything is built: TypeError for
 * a wrong type or an unknown key, RangeError for a value out of range. The
 * messages are short sentences, because the demo shows them inline.
 *
 * Patch keys are checked against an allowlist of own keys, so
 * `__proto__`, `constructor`, `tracks` or `measures` never get through.
 * Objects and arrays are copied once before they are checked (object(),
 * list()), and nested values are read into locals, so a getter can't hand
 * one value to the check and another to the model.
 */
import { EDITOR_LIMITS } from '../limits.js';

/** Line breaks a single-line field rejects. */
export const LINE_BREAK = /[\r\n\u2028\u2029]/;

/** Whether `v` is a plain object (an object literal or JSON object, not an array, class instance or null). */
export function plain(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** A shallow copy of `v` (each own enumerable value read once), checked to be a plain object; TypeError "<what> must be an object" otherwise. */
export function object(v, what) {
  if (!plain(v)) throw new TypeError(`${what} must be an object`);
  return { ...v };
}

/** A copy of array `v` (each item read once). */
export const list = (v) => [...v];

/** TypeError "Unknown <what> field: <k>" for the first own key of `obj` not in `allowed` (an array of names). */
export function checkKeys(obj, allowed, what) {
  const ok = Object.create(null);
  allowed.forEach((k) => { ok[k] = true; });
  for (const k of Object.keys(obj)) if (!Object.hasOwn(ok, k)) throw new TypeError(`Unknown ${what} field: ${k}`);
}

/** `v` checked to be an integer index 0 … length − 1. */
export function index(v, length, label) {
  if (typeof v !== 'number') throw new TypeError(`${label} must be a number`);
  if (!Number.isInteger(v) || v < 0 || v >= length) throw new RangeError(`${label} must be a whole number from 0 to ${length - 1}`);
  return v;
}

/** `v` checked to be an integer lo … hi. */
export function intIn(v, lo, hi, label) {
  if (typeof v !== 'number') throw new TypeError(`${label} must be a number`);
  if (!Number.isInteger(v) || v < lo || v > hi) throw new RangeError(`${label} must be a whole number from ${lo} to ${hi}`);
  return v;
}

/**
 * Text field `v`: null deletes (undefined), a string is trimmed (empty
 * deletes); single-line text rejects line breaks; at most `max` UTF-16
 * code units after trimming.
 */
export function text(v, { label, multiline = false, max = multiline ? EDITOR_LIMITS.longTextChars : EDITOR_LIMITS.textChars }) {
  if (v === null) return undefined;
  if (typeof v !== 'string') throw new TypeError(`${label} must be a string`);
  const t = v.trim();
  if (!multiline && LINE_BREAK.test(t)) throw new RangeError(`${label} must be a single line`);
  if (t.length > max) throw new RangeError(`${label} must be at most ${max} characters`);
  return t || undefined;
}

/** Flag `v`: true writes true; false or null deletes (undefined). */
export function flag(v, label) {
  if (v === true) return true;
  if (v === false || v === null) return undefined;
  throw new TypeError(`${label} must be true, false or null`);
}

/** `v` checked to be a boolean (written explicitly). */
export function bool(v, label) {
  if (typeof v !== 'boolean') throw new TypeError(`${label} must be true or false`);
  return v;
}

/** Deep equality of two JSON values. */
export const same = (a, b) => a === b || (a !== undefined && b !== undefined && JSON.stringify(a) === JSON.stringify(b));

/** `obj` with `key` set to `value` (undefined deletes); `obj` itself when nothing changes. */
export function withField(obj, key, value) {
  if (value === undefined) {
    if (!Object.hasOwn(obj, key)) return obj;
    const out = { ...obj };
    delete out[key];
    return out;
  }
  return Object.hasOwn(obj, key) && same(obj[key], value) ? obj : { ...obj, [key]: value };
}
