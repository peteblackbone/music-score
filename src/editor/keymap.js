/**
 * keymap.js — keyboard event → editor command (requirements §D). Pure:
 * takes `{ key, code?, ctrlKey, shiftKey, altKey, metaKey, isComposing? }`
 * and returns `{ name, arg? }` or null (not consumed).
 *
 * Keys are matched on `key`, not `code` (keyboard layouts), letters case-
 * insensitively and only without Ctrl or Alt; Cmd counts as Ctrl. Never
 * bound: Tab, anything with Alt, F-keys, IME composition, Ctrl with keys
 * other than Z, Y, the arrows, Home, End, Delete and Backspace (so the
 * browser keeps Ctrl+W/T/N/L/P/S/I/M, Ctrl+1–9, Ctrl+PageUp/PageDown),
 * Shift+arrows, Shift+Home/End and Shift+R / I (reserved). The effect
 * letters (H, S, Shift+S, B, Shift+B, V, P, X, G, N, Shift+L, D, Shift+D,
 * A, Shift+A) come from EFFECT_KEYS (model/effectTable.js).
 */
import { EFFECT_KEYS } from './model/effectTable.js';

const cmd = (name, arg) => (arg === undefined ? { name } : { name, arg });

const PLAIN = {
  ArrowLeft: 'moveLeft', ArrowRight: 'moveRight', ArrowUp: 'moveUp', ArrowDown: 'moveDown',
  Home: 'measureStart', End: 'measureEnd', PageUp: 'prevTrack', PageDown: 'nextTrack',
  Insert: 'insertBeat', Escape: 'clearBuffer',
  '+': 'shorter', '=': 'shorter', '-': 'longer', '.': 'cycleDots', '/': 'toggleTriplet',
};
const CTRL = {
  ArrowLeft: 'prevMeasure', ArrowRight: 'nextMeasure', Home: 'scoreStart', End: 'scoreEnd',
  Delete: 'deleteBeat', Backspace: 'deleteBeat',
};
const NO_SHIFT = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', 'Insert']);
const LETTERS = { r: 'toggleRest', l: 'toggleTie', i: 'insertBeat' };

/** The command for keyboard event `e`, or null. */
export function keyToCommand(e) {
  const key = e?.key;
  if (typeof key !== 'string' || !key) return null;
  if (e.isComposing || key === 'Process' || key === 'Dead' || key === 'Unidentified' || key === 'Tab') return null;
  if (e.altKey || /^F\d{1,2}$/.test(key)) return null;
  const shift = !!e.shiftKey;
  if (e.ctrlKey || e.metaKey) {
    const k = key.length === 1 ? key.toLowerCase() : key;
    if (k === 'z') return cmd(shift ? 'redo' : 'undo');
    if (k === 'y') return cmd('redo');
    if (shift || !CTRL[key]) return null;
    return cmd(CTRL[key]);
  }
  if (key === 'Delete' || key === 'Backspace') return cmd(shift ? 'deleteMeasure' : 'deleteNote');
  if (/^[0-9]$/.test(key)) return cmd('digit', Number(key));
  if (key === ',' && e.code === 'NumpadDecimal') return cmd('cycleDots');
  if (PLAIN[key]) return shift && NO_SHIFT.has(key) ? null : cmd(PLAIN[key]);
  if (key.length === 1) {
    const l = key.toLowerCase();
    if (l === 'm') return cmd(shift ? 'insertMeasureBefore' : 'insertMeasureAfter');
    if (LETTERS[l] && !shift) return cmd(LETTERS[l]);
    const fx = EFFECT_KEYS[(shift ? 'Shift+' : '') + l];
    if (fx) return cmd(fx);
  }
  return null;
}
