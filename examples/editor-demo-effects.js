/**
 * editor-demo-effects.js — the Effects toolbar group of editor.html (the
 * 2.1.0 effect keys as buttons). Not part of the package.
 *
 * Each button carries `data-effect` (the command name), `data-key` and
 * `data-shift`; a click runs that key through the editor's handleKey, so
 * the buttons follow exactly the keyboard rules (refusals included).
 * effectButtonState (pure, exported for the tests) derives each button's
 * state from getCursorInfo(): toggles get `aria-pressed`, cycles a label
 * naming their current value.
 */
import { DYNAMIC_SCALE } from '../src/editor/model/effectTable.js';

/**
 * `{ [commandName]: { pressed } | { label } }` for the cursor `info`
 * (getCursorInfo): pressed for H/P, P.M., Dead, Ghost and Let ring; a
 * label for Slide, Bend, Vibrato, Harmonic, Dynamic + / − (with the current
 * dynamic), Accent and Staccato.
 */
export function effectButtonState(info) {
  const note = info?.noteEffects ?? [];
  const beat = (info?.effects ?? []).slice(note.length);
  const bend = note.find((w) => w === 'bend' || w.startsWith('bend '));
  const harmonic = note.find((w) => w.endsWith(' harmonic'));
  const dynamic = beat.find((w) => DYNAMIC_SCALE.includes(w));
  const dyn = dynamic ? ` (${dynamic})` : '';
  const slide = note.includes('legato slide') ? 'legato' : note.includes('slide') ? 'on' : 'off';
  const articulation = (first, second) => (beat.includes(second) ? second : beat.includes(first) ? 'on' : 'off');
  return {
    hammerPull: { pressed: ['hammer/pull', 'hammer-on', 'pull-off'].some((w) => note.includes(w)) },
    slide: { label: `Slide: ${slide}` },
    bend: { label: `Bend: ${!bend ? 'off' : bend === 'bend' ? 'custom' : bend.slice(5)}` },
    vibrato: { label: `Vibrato: ${beat.includes('wide vibrato') ? 'wide' : beat.includes('vibrato') ? 'on' : 'off'}` },
    palmMute: { pressed: beat.includes('palm mute') },
    deadNote: { pressed: note.includes('dead') },
    ghostNote: { pressed: note.includes('ghost') },
    harmonic: { label: `Harmonic: ${harmonic ? harmonic.slice(0, -' harmonic'.length) : 'off'}` },
    letRing: { pressed: beat.includes('let ring') },
    louder: { label: `Dynamic +${dyn}` },
    softer: { label: `Dynamic −${dyn}` },
    accent: { label: `Accent: ${articulation('accent', 'marcato')}` },
    staccato: { label: `Staccato: ${articulation('staccato', 'staccatissimo')}` },
  };
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
