/**
 * editor-demo-settings.js — the Score… and Measure… dialogs of editor.html,
 * the Time / Key / Tempo status items, and the form helpers the Tracks…
 * dialog shares (editor-demo-tracks.js). Not part of the package; uses the
 * ScoreEditor public API only.
 *
 * Every dialog: open → rebuild from the API, clear errors, showModal, focus
 * the first enabled field. Apply → check the fields here (inline errors,
 * the dialog stays open), build a patch of the changed fields only, then:
 * an empty patch closes silently; a call that returns true closes and
 * focuses the editor (the library announces); false shows the library's
 * reason (editor.lastMessage) in the alert line; a throw shows
 * "Couldn't apply: <message>.". Cancel / Esc close and focus the opener.
 *
 * Pure helpers (exported for the tests): scoreValues, scorePatch,
 * measureValues, measureErrors, measurePatch, statusText, keyLabel,
 * keyCount, parseEnding.
 */
import { ScoreEditor } from '../index.js';
import { durationWords } from '../src/editor/model/durations.js';

const LIMITS = ScoreEditor.LIMITS;
export const SCORE_TEXT = ['title', 'subtitle', 'artist', 'album', 'composer', 'words', 'music', 'tempoText', 'tuningLabel', 'instructions', 'copyright'];
export const SCORE_FLAGS = ['showTuningChart', 'multiMeasureRests'];
const LONG = ['instructions', 'copyright'];

// ---------- pure helpers ----------
const MAJOR = { 1: ['C', 'G', 'D', 'A', 'E', 'B', 'F sharp', 'C sharp'], [-1]: ['C', 'F', 'B flat', 'E flat', 'A flat', 'D flat', 'G flat', 'C flat'] };
const MINOR = { 1: ['A', 'E', 'B', 'F sharp', 'C sharp', 'G sharp', 'D sharp', 'A sharp'], [-1]: ['A', 'D', 'G', 'C', 'F', 'B flat', 'E flat', 'A flat'] };
/** '2 sharps' / '1 flat' / 'none'. */
export const keyCount = (n) => (!n ? 'none' : `${Math.abs(n)} ${n > 0 ? 'sharp' : 'flat'}${Math.abs(n) === 1 ? '' : 's'}`);
/** 'No sharps or flats (C major / A minor)' / '3 flats (E flat major / C minor)'. */
export function keyLabel(n) {
  const side = n < 0 ? -1 : 1;
  const k = Math.abs(n);
  return `${n ? keyCount(n) : 'No sharps or flats'} (${MAJOR[side][k]} major / ${MINOR[side][k]} minor)`;
}
const bpmText = (bpm) => String(Math.round(bpm * 100) / 100);
/** '120 bpm' for a quarter beat, else 'dotted quarter = 80'; with text 'Allegro, 120 bpm'. */
export function tempoLabel(t) {
  const core = t.unit === 'quarter' && !t.dots ? `${bpmText(t.bpm)} bpm` : `${durationWords(t.unit, t.dots)} = ${bpmText(t.bpm)}`;
  return t.text ? `${t.text}, ${core}` : core;
}
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

/** Ending numbers typed as "1, 2" → `{ numbers }` or `{ error }`; empty text → `{ numbers: [] }`. */
export function parseEnding(textValue) {
  const t = String(textValue ?? '').trim();
  if (!t) return { numbers: [] };
  const parts = t.split(',').map((p) => p.trim());
  if (parts.some((p) => !/^\d+$/.test(p) || Number(p) < 1 || Number(p) > 99)) return { error: 'Use whole numbers from 1 to 99, separated by commas, such as 1, 2.' };
  const numbers = parts.map(Number);
  if (new Set(numbers).size !== numbers.length) return { error: 'Each number can be used once.' };
  if (numbers.length > 32) return { error: 'At most 32 numbers.' };
  return { numbers: numbers.sort((a, b) => a - b) };
}

/**
 * Form values of the Measure dialog from getMeasureSettings `m` and the
 * cursor `info` (getCursorInfo): what the fields show when it opens.
 */
export function measureValues(m, info) {
  const t = info?.tempo;
  const here = !!t?.here;
  return {
    timeMode: m.timeSignature.here ? 'change' : 'same',
    beats: String(m.timeSignature.beats),
    beatType: String(m.timeSignature.beatType),
    keyMode: m.keySignature.here ? 'change' : 'same',
    key: String(m.keySignature.value),
    barline: ['single', 'double', 'final', 'repeatStart', 'repeatEnd'].includes(m.barline) ? m.barline : '',
    repeatCount: m.repeatCount != null ? String(m.repeatCount) : '',
    ending: m.ending ? m.ending.numbers.join(', ') : '',
    endingText: m.ending?.text ?? '',
    endingOpen: m.ending?.open === true,
    segno: m.segno,
    coda: m.coda,
    jump: m.jump == null ? '' : m.jumpCustom ? 'custom' : m.jump,
    sectionLetter: m.section?.letter ?? '',
    sectionText: m.section?.text ?? '',
    clefMode: m.clef.here ? 'change' : 'same',
    clef: m.clef.value,
    tempoMode: here ? 'mark' : 'none',
    bpm: here ? bpmText(t.bpm) : t ? bpmText(t.bpm) : '120',
    unit: here ? t.unit : t?.unit ?? 'quarter',
    dots: String(here ? t.dots : t?.dots ?? 0),
    tempoText: here ? t.text ?? '' : '',
  };
}

const intText = (v, lo, hi) => /^\d+$/.test(String(v).trim()) && Number(v) >= lo && Number(v) <= hi;
/** Measure dialog errors: `{ field: message }`; `tempoOn` false skips the tempo fields. */
export function measureErrors(v, { tempoOn = true } = {}) {
  const out = {};
  if (!intText(v.beats, 1, LIMITS.timeSignatureBeats)) out.beats = `Beats must be a whole number from 1 to ${LIMITS.timeSignatureBeats}.`;
  if (v.barline === 'repeatEnd' && String(v.repeatCount).trim() && !intText(v.repeatCount, 2, 99)) out.repeatCount = 'Repeat count must be a whole number from 2 to 99.';
  const end = parseEnding(v.ending);
  if (end.error) out.ending = end.error;
  if (tempoOn && v.tempoMode === 'mark') {
    const bpm = Number(v.bpm);
    if (!String(v.bpm).trim() || !(bpm > 0 && bpm <= 1000) || Math.round(bpm * 100) / 100 !== bpm) out.bpm = 'BPM must be above 0 and at most 1000, with up to 2 decimals.';
  }
  return out;
}

const sameJSON = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The calls Apply makes for Measure values `v` against getMeasureSettings
 * `m` at measure `mi`: `{ patch, tempo }` — `patch` holds the changed
 * fields only (an ending as a number or an array, as an object only with
 * text or an open end), `tempo` is undefined when unchanged, else the
 * setTempo value (null removes). `info` is getCursorInfo().
 */
export function measurePatch(m, v, mi, info) {
  const patch = {};
  const ts = { beats: Number(v.beats), beatType: Number(v.beatType) };
  const cur = { beats: m.timeSignature.beats, beatType: m.timeSignature.beatType };
  if (mi === 0) {
    if (!sameJSON(ts, cur)) patch.timeSignature = ts;
  } else if (v.timeMode === 'same') {
    if (m.timeSignature.here) patch.timeSignature = null;
  } else if (m.timeSignature.here ? !sameJSON(ts, cur) : !sameJSON(ts, m.timeSignature.inherited)) patch.timeSignature = ts;
  const key = Number(v.key);
  if (mi === 0) {
    if (key !== m.keySignature.value) patch.keySignature = key;
  } else if (v.keyMode === 'same') {
    if (m.keySignature.here) patch.keySignature = null;
  } else if (key !== (m.keySignature.here ? m.keySignature.value : m.keySignature.inherited)) patch.keySignature = key;
  if (mi > 0) {
    if (v.clefMode === 'same') {
      if (m.clef.here) patch.clef = null;
    } else if (v.clef !== (m.clef.here ? m.clef.value : m.clef.inherited)) patch.clef = v.clef;
  }
  const oldBar = measureValues(m, info).barline;
  if (v.barline !== oldBar) patch.barline = v.barline || null;
  if (v.barline === 'repeatEnd') {
    const count = String(v.repeatCount).trim() ? Number(v.repeatCount) : null;
    if (count !== (m.repeatCount ?? null) || (count != null && v.barline !== oldBar)) patch.repeatCount = count;
  }
  const { numbers = [] } = parseEnding(v.ending);
  const words = String(v.endingText ?? '').trim();
  const open = !!v.endingOpen;
  const old = m.ending;
  const changedEnding = numbers.length
    ? !old || !sameJSON(numbers, old.numbers) || words !== (old.text ?? '') || open !== (old.open === true)
    : !!old;
  if (changedEnding) {
    if (!numbers.length) patch.ending = null;
    else if (!words && !open) patch.ending = numbers.length === 1 ? numbers[0] : numbers;
    else patch.ending = { numbers, ...(words ? { text: words } : {}), ...(open ? { open: true } : {}) };
  }
  if (!!v.segno !== m.segno) patch.segno = v.segno ? true : null;
  if (!!v.coda !== m.coda) patch.coda = v.coda ? true : null;
  if (v.jump !== 'custom' && (v.jump || null) !== (m.jumpCustom ? '\0' : m.jump)) patch.jump = v.jump || null;
  const letter = String(v.sectionLetter ?? '').trim();
  const stext = String(v.sectionText ?? '').trim();
  const oldSec = m.section;
  if (letter !== (oldSec?.letter ?? '') || stext !== (oldSec?.text ?? '')) {
    patch.section = !letter && !stext ? null : letter ? { letter, ...(stext ? { text: stext } : {}) } : stext;
  }
  let tempo;
  const t = info?.tempo;
  if (!info?.appendSlot) {
    if (v.tempoMode === 'none') {
      if (t?.here) tempo = null;
    } else {
      const next = { bpm: Number(v.bpm), unit: v.unit, dots: Number(v.dots), text: String(v.tempoText ?? '').trim() || null };
      const prev = t?.here ? { bpm: t.bpm, unit: t.unit, dots: t.dots, text: t.text } : null;
      if (!sameJSON(next, prev)) tempo = { bpm: next.bpm, unit: next.unit, dots: next.dots, ...(next.text ? { text: next.text } : {}) };
    }
  }
  return { patch, tempo };
}

// ---------- form helpers (shared with editor-demo-tracks.js) ----------
/** Show `message` in `input`'s error slot (`<id>-err`, created after the input when missing); aria-invalid and the error id first in aria-describedby. */
export function setFieldError(doc, input, message) {
  const id = `${input.id}-err`;
  let p = doc.getElementById(id);
  if (!p) {
    p = doc.createElement('p');
    p.className = 'field-error';
    p.id = id;
    input.after(p);
  }
  p.textContent = message;
  p.hidden = false;
  if (!input.dataset.describedby) input.dataset.describedby = input.getAttribute('aria-describedby') ?? '';
  input.setAttribute('aria-invalid', 'true');
  input.setAttribute('aria-describedby', [id, input.dataset.describedby].filter(Boolean).join(' '));
}
/** Clear `input`'s error. */
export function clearFieldError(doc, input) {
  if (input.getAttribute('aria-invalid') !== 'true') return;
  const p = doc.getElementById(`${input.id}-err`);
  if (p) { p.textContent = ''; p.hidden = true; }
  input.removeAttribute('aria-invalid');
  if (input.dataset.describedby) input.setAttribute('aria-describedby', input.dataset.describedby);
  else input.removeAttribute('aria-describedby');
  delete input.dataset.describedby;
}
/** Clear every field error of `form` and its alert line. */
export function clearErrors(doc, form, alert) {
  form.querySelectorAll('[aria-invalid="true"]').forEach((el) => clearFieldError(doc, el));
  alert.textContent = '';
}
/** Show `errors` (`[[input, message]]`): inline, the count in the alert, focus on the first; true when there were any. */
export function showErrors(doc, alert, errors) {
  if (!errors.length) return false;
  errors.forEach(([input, msg]) => setFieldError(doc, input, msg));
  alert.textContent = `Couldn't apply: ${errors.length === 1 ? '1 field needs' : `${errors.length} fields need`} fixing.`;
  errors[0][0].focus();
  return true;
}
/** Run API call `fn`: true when it returned true; else the reason (false: lastMessage; a throw: its message) goes to `alert`. */
export function callApi(editor, alert, fn) {
  try {
    if (fn()) return true;
    alert.textContent = editor.lastMessage;
  } catch (err) {
    alert.textContent = `Couldn't apply: ${String(err.message).replace(/\.$/, '')}.`;
  }
  return false;
}
const focusable = (el) => !el.disabled && !el.hidden && !el.closest('[hidden]') && !el.closest('fieldset:disabled');
/** The first enabled field of `form` (a checked radio of a group counts for its group). */
export function firstField(form) {
  return [...form.querySelectorAll('input, select, textarea, button')]
    .filter((el) => focusable(el) && (el.type !== 'radio' || el.checked))[0] ?? null;
}
/**
 * Run `fn` (which may disable or hide controls of `form`); if the control
 * that had focus can't keep it, focus moves to the nearest enabled control
 * after it, else before it, so focus never falls to the page.
 */
export function withFocus(form, fn) {
  const had = form.ownerDocument.activeElement;
  fn();
  if (!had || !form.contains(had) || focusable(had)) return;
  const all = [...form.querySelectorAll('input, select, textarea, button')].filter(focusable);
  const after = all.find((x) => had.compareDocumentPosition(x) & 4);
  const before = all.filter((x) => had.compareDocumentPosition(x) & 2).pop();
  (after ?? before)?.focus();
}

/**
 * Wire one dialog: the `opener` button opens it (open() rebuilds it, then
 * showModal and focus the first field); submit runs apply(), which returns
 * true to close and focus the editor; Cancel / Esc focus the opener.
 */
export function wireDialog(doc, editor, { dialog, form, opener, cancel, alert, open, apply }) {
  let applied = false;
  opener.addEventListener('click', () => {
    applied = false;
    clearErrors(doc, form, alert);
    open();
    dialog.showModal();
    firstField(form)?.focus();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    alert.textContent = '';
    if (!apply()) return;
    applied = true;
    dialog.close();
    editor.focus();
  });
  form.addEventListener('input', (e) => clearFieldError(doc, e.target));
  form.addEventListener('change', (e) => clearFieldError(doc, e.target));
  cancel.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { if (!applied) opener.focus(); });
}

// ---------- the two dialogs ----------
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

  // Measure…
  const ms = (id) => $(`ms-${id}`);
  const radio = (name, value) => doc.querySelector(`input[name="${name}"][value="${value}"]`);
  const checked = (name) => doc.querySelector(`input[name="${name}"]:checked`)?.value;
  const measureForm = $('measure-form');
  let opened = null; // { m, info, mi, ti }
  const syncMeasure = () => withFocus(measureForm, () => {
    const mi = opened.mi;
    const timeOn = mi === 0 || checked('ms-time') === 'change';
    ms('beats').disabled = !timeOn;
    ms('beat-type').disabled = !timeOn;
    ms('key').disabled = !(mi === 0 || checked('ms-key-mode') === 'change');
    const isEnd = ms('barline').value === 'repeatEnd';
    if (!isEnd) ms('repeat').value = '';
    ms('repeat').disabled = !isEnd;
    const hasEnding = !!ms('ending').value.trim();
    ms('ending-text').disabled = !hasEnding;
    ms('ending-open').disabled = !hasEnding;
    ms('clef').disabled = mi === 0 || checked('ms-clef-mode') !== 'change';
    const tempoOff = ms('tempo-set').disabled;
    const markOn = !tempoOff && checked('ms-tempo-mode') === 'mark';
    ['bpm', 'unit', 'dots', 'tempo-text'].forEach((k) => { ms(k).disabled = !markOn; });
  });
  measureForm.addEventListener('change', () => { if (opened) syncMeasure(); });
  ms('ending').addEventListener('input', () => { if (opened) syncMeasure(); });
  wireDialog(doc, editor, {
    dialog: $('measure-dialog'), form: measureForm, opener: $('measure-btn'), cancel: $('measure-cancel'), alert: $('measure-error'),
    open() {
      const info = editor.getCursorInfo();
      const mi = info.measure;
      const ti = info.track;
      const m = editor.getMeasureSettings(mi, ti);
      opened = { m, info, mi, ti };
      const v = measureValues(m, info);
      $('measure-title').textContent = `Measure ${mi + 1}`;
      ms('time-modes').hidden = mi === 0;
      ms('key-modes').hidden = mi === 0;
      ms('time-start').hidden = mi !== 0;
      ms('key-start').hidden = mi !== 0;
      const ih = m.timeSignature.inherited;
      ms('time-same-label').textContent = `No change (${ih.beats}/${ih.beatType} continues)`;
      ms('key-same-label').textContent = `No change (${m.keySignature.inherited ? keyCount(m.keySignature.inherited) : 'no sharps or flats'} continues)`;
      radio('ms-time', v.timeMode).checked = true;
      radio('ms-key-mode', v.keyMode).checked = true;
      ms('beats').value = v.beats;
      ms('beat-type').value = v.beatType;
      ms('key').value = v.key;
      ms('barline').value = v.barline;
      ms('repeat').value = v.repeatCount;
      ms('ending').value = v.ending;
      ms('ending-text').value = v.endingText;
      ms('ending-open').checked = v.endingOpen;
      ms('segno').checked = v.segno;
      ms('coda').checked = v.coda;
      const jump = ms('jump');
      jump.querySelector('option[value="custom"]')?.remove();
      if (m.jumpCustom) {
        const o = doc.createElement('option');
        o.value = 'custom';
        o.textContent = `Custom: "${m.jump}" (kept)`;
        jump.append(o);
      }
      jump.value = v.jump;
      ms('section-letter').value = v.sectionLetter;
      ms('section-text').value = v.sectionText;
      const track = editor.getScore().tracks[ti] ?? {};
      $('ms-track-heading').textContent = `This track only (${info.trackName || `Track ${ti + 1}`})`;
      ms('clef-set').disabled = mi === 0;
      ms('clef-modes').hidden = mi === 0;
      ms('clef-start').hidden = mi !== 0;
      ms('clef-tab').hidden = !(track.showTablature && track.showStandardNotation === false);
      ms('clef-same-label').textContent = `No change (${ms('clef').querySelector(`option[value="${m.clef.inherited}"]`)?.textContent ?? m.clef.inherited} continues)`;
      radio('ms-clef-mode', v.clefMode).checked = true;
      ms('clef').value = v.clef;
      const noBeat = info.appendSlot || info.empty;
      ms('tempo-set').disabled = noBeat;
      ms('tempo-off').hidden = !noBeat;
      $('ms-tempo-legend').textContent = noBeat ? 'Tempo' : `Tempo at beat ${info.beatNumber}`;
      const t = info.tempo;
      ms('tempo-none-label').textContent = t && !t.here ? `No tempo mark here (${tempoLabel(t)} continues)` : 'No tempo mark here';
      radio('ms-tempo-mode', v.tempoMode).checked = true;
      ms('bpm').value = v.bpm;
      ms('unit').value = v.unit;
      ms('dots').value = v.dots;
      ms('tempo-text').value = v.tempoText;
      syncMeasure();
    },
    apply() {
      const { m, info, mi, ti } = opened;
      const v = {
        timeMode: checked('ms-time'), beats: ms('beats').value, beatType: ms('beat-type').value, keyMode: checked('ms-key-mode'), key: ms('key').value,
        barline: ms('barline').value, repeatCount: ms('repeat').value, ending: ms('ending').value, endingText: ms('ending-text').value, endingOpen: ms('ending-open').checked,
        segno: ms('segno').checked, coda: ms('coda').checked, jump: ms('jump').value, sectionLetter: ms('section-letter').value, sectionText: ms('section-text').value,
        clefMode: checked('ms-clef-mode'), clef: ms('clef').value,
        tempoMode: checked('ms-tempo-mode'), bpm: ms('bpm').value, unit: ms('unit').value, dots: ms('dots').value, tempoText: ms('tempo-text').value,
      };
      const errs = measureErrors(v, { tempoOn: !ms('tempo-set').disabled });
      const fieldOf = { beats: ms('beats'), repeatCount: ms('repeat'), ending: ms('ending'), bpm: ms('bpm') };
      if (showErrors(doc, $('measure-error'), Object.keys(fieldOf).filter((k) => errs[k]).map((k) => [fieldOf[k], errs[k]]))) return false;
      const { patch, tempo } = measurePatch(m, v, mi, info);
      const alert = $('measure-error');
      let ok = true;
      if (Object.keys(patch).length) ok = callApi(editor, alert, () => editor.updateMeasure(mi, patch, { track: ti }));
      if (ok && tempo !== undefined) ok = callApi(editor, alert, () => editor.setTempo(tempo));
      refresh();
      // the dialog stays open after a failed call: later Applies compare against what is applied now
      if (!ok) opened = { ...opened, m: editor.getMeasureSettings(mi, ti), info: editor.getCursorInfo() };
      return ok;
    },
  });

  return function refreshSettings(info, readOnly) {
    const st = statusText(info);
    $('st-time').textContent = st.time;
    $('st-key').textContent = st.key;
    $('st-tempo').textContent = st.tempo;
    buttons.forEach((b) => { b.disabled = !!readOnly; });
  };
}
