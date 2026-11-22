/**
 * keymap.js — keyboard event → editor command (requirements §D). Pure:
 * takes `{ key, code?, ctrlKey, shiftKey, altKey, metaKey, isComposing? }`
 * and returns `{ name, arg? }` or null (not consumed).
 *
 * Keys are matched on `key`, not `code` (keyboard layouts), letters case-
 * insensitively and only without Ctrl or Alt; Cmd counts as Ctrl. Never
 * bound: Tab, anything with Alt, F-keys, IME composition, Ctrl with keys
 * other than Z, Y, A, the arrows, Home, End, Delete and Backspace (so the
 * browser keeps Ctrl+W/T/N/L/P/S/I/M, Ctrl+1–9, Ctrl+PageUp/PageDown, and
 * Ctrl+C / X / V / Insert and Shift+Insert reach the native clipboard
 * events). 2.3 selection: Shift+Left / Right / Home / End, Ctrl+Shift+Left
 * / Right and Ctrl+A; F fills, Shift+F reflows. 2.3.1: Ctrl+Up / Down
 * transpose by a semitone, Ctrl+Shift+Up / Down by an octave, Ctrl+Shift+
 * Home / End select to the start / end of the score; Ctrl+Shift+V is the
 * Insert paste (a native paste, never a command). Reserved for later:
 * Shift+Up / Down, Shift+R / I (any other Ctrl+Shift key is unbound).
 * The effect letters come from EFFECT_KEYS (the rows of model/effectTable.js).
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
const SHIFT = { ArrowLeft: 'selectLeft', ArrowRight: 'selectRight', Home: 'selectMeasureStart', End: 'selectMeasureEnd' };
const CTRL_SHIFT = { ArrowLeft: 'selectPrevMeasure', ArrowRight: 'selectNextMeasure', Home: 'selectScoreStart', End: 'selectScoreEnd' };
const NO_SHIFT = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', 'Insert']);
const LETTERS = { r: 'toggleRest', l: 'toggleTie', i: 'insertBeat' };
/** `map[k]` when it is an own key (event keys such as 'toString' must not find inherited properties), else undefined. */
const own = (map, k) => (Object.hasOwn(map, k) ? map[k] : undefined);

/** Whether keyboard event `e` is a paste shortcut (Ctrl / Cmd+V, Shift+Insert): the 2.3 paste fallback, never a command. */
export const isPasteKey = (e) => !!e && !e.altKey && (((e.ctrlKey || e.metaKey) && typeof e.key === 'string' && e.key.toLowerCase() === 'v') || (!!e.shiftKey && e.key === 'Insert'));

/** Whether keyboard event `e` is the Insert paste shortcut (Ctrl / Cmd+Shift+V; never Shift+Insert): 2.3.1, a one-shot flag for the next paste. */
export const isInsertPasteKey = (e) => !!e && !e.altKey && !!(e.ctrlKey || e.metaKey) && !!e.shiftKey && typeof e.key === 'string' && e.key.toLowerCase() === 'v';

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
    if (k === 'a' && !shift) return cmd('selectAll');
    if (key === 'ArrowUp' || key === 'ArrowDown') return cmd('transpose', (key === 'ArrowUp' ? 1 : -1) * (shift ? 12 : 1));
    if (shift) return own(CTRL_SHIFT, key) ? cmd(CTRL_SHIFT[key]) : null;
    if (!own(CTRL, key)) return null;
    return cmd(CTRL[key]);
  }
  if (key === 'Delete' || key === 'Backspace') return cmd(shift ? 'deleteMeasure' : 'deleteNote');
  if (/^[0-9]$/.test(key)) return cmd('digit', Number(key));
  if (key === ',' && e.code === 'NumpadDecimal') return cmd('cycleDots');
  if (shift && own(SHIFT, key)) return cmd(SHIFT[key]);
  if (own(PLAIN, key)) return shift && NO_SHIFT.has(key) ? null : cmd(PLAIN[key]);
  if (key.length === 1) {
    const l = key.toLowerCase();
    if (l === 'm') return cmd(shift ? 'insertMeasureBefore' : 'insertMeasureAfter');
    if (l === 'f') return cmd(shift ? 'reflow' : 'fill');
    if (own(LETTERS, l) && !shift) return cmd(LETTERS[l]);
    const fx = own(EFFECT_KEYS, (shift ? 'Shift+' : '') + l);
    if (fx) return cmd(fx);
  }
  return null;
}
