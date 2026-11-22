/**
 * editor-demo-settings.js — the Score… dialog of editor.html, the Time /
 * Key / Tempo status items and the read-only state of the three settings
 * buttons; wires the Measure… dialog (editor-demo-measure.js). The form
 * helpers are in editor-demo-forms.js. Not part of the package; uses the
 * ScoreEditor public API only.
 *
 * Pure helpers (exported for the tests): scoreValues, scorePatch,
 * scoreErrors, statusText; SCORE_TEXT / SCORE_FLAGS are the demo's copy of
 * the library's score fields (pinned by a parity test).
 */
import { ScoreEditor } from '../index.js';
import { wireDialog, showErrors, callApi } from './editor-demo-forms.js';
import { keyCount, tempoLabel, wireMeasureDialog } from './editor-demo-measure.js';

const LIMITS = ScoreEditor.LIMITS;
export const SCORE_TEXT = ['title', 'subtitle', 'artist', 'album', 'composer', 'words', 'music', 'tempoText', 'tuningLabel', 'instructions', 'copyright'];
export const SCORE_FLAGS = ['showTuningChart', 'multiMeasureRests'];
const LONG = ['instructions', 'copyright'];

/** The status bar's `{ time, key, tempo }` texts for getCursorInfo() `info`. */
export function statusText(info) {
  const ts = info?.timeSignature;
  return {
    time: ts ? `${ts.beats}/${ts.beatType}` : '–',
    key: info ? keyCount(info.keySignature ?? 0) : '–',
    tempo: info?.tempo ? tempoLabel(info.tempo) : '–',
  };
}

/** Form values of the Score dialog for score `s` (getScore()): text fields as strings, flags as booleans. */
export function scoreValues(s) {
  const out = {};
  SCORE_TEXT.forEach((k) => { out[k] = typeof s?.[k] === 'string' ? s[k] : ''; });
  SCORE_FLAGS.forEach((k) => { out[k] = s?.[k] === true; });
  return out;
}

/** The updateScore patch from `before` (scoreValues) to `values`: changed keys only; empty text → null; a cleared box → null. */
export function scorePatch(before, values) {
  const patch = {};
  SCORE_TEXT.forEach((k) => {
    const v = String(values[k] ?? '').trim();
    if (v !== String(before[k] ?? '').trim()) patch[k] = v || null;
  });
  SCORE_FLAGS.forEach((k) => {
    if (!!values[k] !== !!before[k]) patch[k] = values[k] ? true : null;
  });
  return patch;
}

/** Score dialog errors: `{ field: message }` (empty when every field is fine). */
export function scoreErrors(values) {
  const out = {};
  SCORE_TEXT.forEach((k) => {
    const max = LONG.includes(k) ? LIMITS.longTextChars : LIMITS.textChars;
    if (String(values[k] ?? '').trim().length > max) out[k] = `At most ${max} characters.`;
  });
  return out;
}

/**
 * Wire the Score… and Measure… dialogs and the status extras. Returns
 * `refreshSettings(info, readOnly)`: the status items, and the three
 * settings buttons disabled in read-only mode.
 */
export function wireSettings(doc, editor, { refresh = () => {} } = {}) {
  const $ = (id) => doc.getElementById(id);
  const buttons = [$('score-btn'), $('tracks-btn'), $('measure-btn')];

  // Score…
  const scoreForm = $('score-form');
  const scoreFields = [...scoreForm.querySelectorAll('[data-field]')];
  let scoreBefore = null;
  const readScore = () => Object.fromEntries(scoreFields.map((el) => [el.dataset.field, el.type === 'checkbox' ? el.checked : el.value]));
  wireDialog(doc, editor, {
    dialog: $('score-dialog'), form: scoreForm, opener: $('score-btn'), cancel: $('score-cancel'), alert: $('score-error'),
    open() {
      scoreBefore = scoreValues(editor.getScore());
      scoreFields.forEach((el) => { if (el.type === 'checkbox') el.checked = scoreBefore[el.dataset.field]; else el.value = scoreBefore[el.dataset.field]; });
    },
    apply() {
      const values = readScore();
      const errs = scoreErrors(values);
      if (showErrors(doc, $('score-error'), scoreFields.filter((el) => errs[el.dataset.field]).map((el) => [el, errs[el.dataset.field]]))) return false;
      const patch = scorePatch(scoreBefore, values);
      if (!Object.keys(patch).length) return true;
      const done = callApi(editor, $('score-error'), () => editor.updateScore(patch));
      refresh();
      return done;
    },
  });

  wireMeasureDialog(doc, editor, { refresh });

  return function refreshSettings(info, readOnly) {
    const st = statusText(info);
    $('st-time').textContent = st.time;
    $('st-key').textContent = st.key;
    $('st-tempo').textContent = st.tempo;
    buttons.forEach((b) => { b.disabled = !!readOnly; });
  };
}
