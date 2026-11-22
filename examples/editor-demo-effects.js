/**
 * editor-demo-effects.js — the Effects toolbar group of editor.html (the
 * 2.1.0 effect keys as buttons). Not part of the package.
 *
 * Each button carries `data-effect` (the command name), `data-key` and
 * `data-shift`; a click runs that key through the editor's handleKey, so
 * the buttons follow exactly the keyboard rules (refusals included).
 * effectButtonState (pure, exported for the tests) derives each button's
 * state from getCursorInfo().effectSteps (the effect rows' step indices,
 * not the spoken words): toggles get `aria-pressed`, cycles a label naming
 * their current value.
 */
import { EFFECT_BY_NAME } from '../src/editor/model/effectTable.js';

/** The label word for each step of the cycle buttons' rows ('custom' for a value the row doesn't write). */
const STATE_WORDS = {
  slide: ['on', 'legato'],
  bend: ['full', 'half', 'full and release', 'pre-bend full', 'release'],
  vibrato: ['on', 'wide'],
  harmonic: ['natural', 'pinch'],
  accent: ['on', 'marcato'],
  staccato: ['on', 'staccatissimo'],
};
const TITLES = { slide: 'Slide', bend: 'Bend', vibrato: 'Vibrato', harmonic: 'Harmonic', accent: 'Accent', staccato: 'Staccato' };
const TOGGLES = ['hammerPull', 'palmMute', 'deadNote', 'ghostNote', 'letRing'];
/** The commands with a button, in toolbar order. */
export const BUTTONS = ['hammerPull', 'slide', 'bend', 'vibrato', 'palmMute', 'deadNote', 'ghostNote', 'harmonic', 'letRing', 'louder', 'softer', 'accent', 'staccato'];

/**
 * `{ [commandName]: { pressed } | { label } }` for the cursor `info`
 * (getCursorInfo): pressed for H/P, P.M., Dead, Ghost and Let ring; a
 * label for Slide, Bend, Vibrato, Harmonic, Dynamic + / − (with the current
 * dynamic when it is on the scale), Accent and Staccato.
 */
export function effectButtonState(info) {
  const steps = info?.effectSteps ?? {};
  const has = (name) => Object.hasOwn(steps, name);
  const dynamic = has('louder') && steps.louder >= 0 ? ` (${EFFECT_BY_NAME.louder.steps[steps.louder].dynamic})` : '';
  const state = (name) => {
    if (TOGGLES.includes(name)) return { pressed: has(name) };
    if (name === 'louder' || name === 'softer') return { label: `Dynamic ${name === 'louder' ? '+' : '−'}${dynamic}` };
    return { label: `${TITLES[name]}: ${!has(name) ? 'off' : steps[name] < 0 ? 'custom' : STATE_WORDS[name][steps[name]]}` };
  };
  const out = {};
  for (const name of BUTTONS) out[name] = state(name);
  return out;
}

/**
 * Wire the Effects `buttons` to `editor`: a click runs the button's key
 * through handleKey, refreshes the buttons and calls `back(event)` (the
 * demo returns focus to the editor after a pointer click). Returns
 * `refresh(info, readOnly)`, which the demo calls on cursor and change
 * events; read-only disables every button.
 */
export function wireEffects(buttons, editor, back) {
  const list = [...buttons];
  function refresh(info, readOnly) {
    const state = effectButtonState(info);
    list.forEach((b) => {
      const s = state[b.dataset.effect];
      if (s && 'pressed' in s) b.setAttribute('aria-pressed', String(s.pressed));
      if (s && s.label) b.textContent = s.label;
      b.disabled = !!readOnly;
    });
  }
  list.forEach((b) => b.addEventListener('click', (e) => {
    editor.handleKey({ key: b.dataset.key, shiftKey: b.dataset.shift === 'true' });
    refresh(editor.getCursorInfo(), editor.isReadOnly());
    back(e);
  }));
  return refresh;
}
