/**
 * editor-demo-tracks.js — the Tracks… dialog of editor.html: the track
 * list (move, remove, add: one API call each, applied at once) and the
 * edit panel of the selected track (names, clef, staves, TAB options,
 * tuning, capo: one updateTrack call on Apply). Not part of the package;
 * uses the ScoreEditor public API only.
 *
 * Pending panel changes are confirmed before the selection changes or a
 * list action runs. Strings are added and removed at the low end; removing
 * strings that have notes asks first, with the count (voice 1, voice 2 and
 * graces, the same count the library reports).
 *
 * Pure helpers (exported for the tests): instrumentOptions, tuningRows,
 * matchPreset, presetGroups, notesOnRemovedStrings, trackNoteCount,
 * lowerFourth, trackLabel, trackValues, trackPatch, trackErrors.
 */
import { ScoreEditor } from '../index.js';
import { wireDialog, showErrors, setFieldError, clearFieldError, callApi, withFocus } from './editor-demo-settings.js';

const MIN_STRINGS = 4;
const PITCH = /^\s*([A-Ga-g])([#b]?)([0-9])\s*$/;

/** `[{ value, label }]` of every instrument preset, in table order (New dialog and Add track). */
export const instrumentOptions = () => Object.entries(ScoreEditor.INSTRUMENTS).map(([value, i]) => ({ value, label: i.label }));

/** One row per string, low to high: `{ label: 'String 6 (lowest)', value }`. */
export function tuningRows(tuning) {
  const n = tuning.length;
  return tuning.map((value, i) => ({ label: `String ${n - i}${i === 0 ? ' (lowest)' : i === n - 1 ? ' (highest)' : ''}`, value }));
}

/** Canonical pitch of `p` ('f#3' → 'F#3'), or null when it isn't a note and octave 0–9. */
export function canonicalPitch(p) {
  const m = PITCH.exec(String(p ?? ''));
  return m ? m[1].toUpperCase() + m[2] + m[3] : null;
}

/** The preset key ('guitar6:1') whose tuning equals `tuning` (canonical pitches), or null. */
export function matchPreset(tuning) {
  const canon = tuning.map(canonicalPitch);
  for (const [id, list] of Object.entries(ScoreEditor.TUNINGS)) {
    const i = list.findIndex((p) => p.tuning.length === canon.length && p.tuning.every((x, k) => x === canon[k]));
    if (i >= 0) return `${id}:${i}`;
  }
  return null;
}

/** Presets with `count` strings grouped by instrument: `[{ label, options: [{ value, text }] }]`. */
export function presetGroups(count) {
  return Object.entries(ScoreEditor.TUNINGS)
    .filter(([id]) => ScoreEditor.INSTRUMENTS[id].tuning.length === count)
    .map(([id, list]) => ({ label: ScoreEditor.INSTRUMENTS[id].label, options: list.map((p, i) => ({ value: `${id}:${i}`, text: `${p.name} (${p.tuning.join(' ')})` })) }));
}

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** A perfect fourth below `p`, clamped to octave 0 ('E2' → 'B1', 'C0' → 'G0'); 'E2' for an unreadable pitch. */
export function lowerFourth(p) {
  const c = canonicalPitch(p);
  if (!c) return 'E2';
  const m = PITCH.exec(c);
  const midi = (Number(m[3]) + 1) * 12 + PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) - 5;
  const oct = Math.floor(midi / 12) - 1;
  return `${NAMES[((midi % 12) + 12) % 12]}${Math.max(0, oct)}`;
}

/** Every beat array sanitize visits in `track` (beats, and each voice's beats). */
function beatArrays(track) {
  const out = [];
  for (const m of track?.measures || []) {
    if (!m || typeof m !== 'object') continue;
    if (Array.isArray(m.beats)) out.push(m.beats);
    if (Array.isArray(m.voices)) m.voices.forEach((v) => { if (v && Array.isArray(v.beats)) out.push(v.beats); });
  }
  return out;
}
const countNotes = (track, keep) => beatArrays(track).reduce((n, beats) => n + beats.reduce((k, b) => k
  + (b && typeof b === 'object' && Array.isArray(b.notes) ? b.notes.filter(keep).length : 0), 0), 0);
const stringCountOf = (t) => (Array.isArray(t?.tuning) && t.tuning.length ? t.tuning.length : 6);

/** Notes of track `ti` of `score` (getScore()) on the strings a tuning of `newCount` strings removes (equals updateTrack's count). */
export function notesOnRemovedStrings(score, ti, newCount) {
  const t = score.tracks[ti];
  const old = stringCountOf(t);
  return newCount >= old ? 0 : countNotes(t, (n) => n && n.string > newCount && n.string <= old);
}
/** Every note of track `ti` (voice 1, voice 2 and graces). */
export const trackNoteCount = (score, ti) => countNotes(score.tracks[ti], (n) => !!n && typeof n === 'object');

/** List text of track `t` at index `i`: '1. Guitar', '2. Track 2 (hidden)'. */
export function trackLabel(t, i) {
  const hidden = !t.showTablature && t.showStandardNotation === false;
  return `${i + 1}. ${String(t.name || '').trim() || `Track ${i + 1}`}${hidden ? ' (hidden)' : ''}`;
}

/** The edit panel's values for track `t` with opening clef `clef` (getMeasureSettings(0, ti).clef.value). */
export function trackValues(t, clef) {
  const capo = Number.isInteger(t.capo) && t.capo >= 1 && t.capo <= 30 ? t.capo : 0;
  return {
    name: t.name ?? '',
    label: t.label ?? '',
    clef,
    notation: t.showStandardNotation !== false,
    tab: !!t.showTablature,
    rhythm: t.tabRhythm === true ? 'true' : t.tabRhythm === false ? 'false' : 'auto',
    artic: t.tabArticulations === true,
    tied: typeof t.tiedFrets === 'string' && t.tiedFrets.trim().toLowerCase() === 'parens',
    tuning: Array.isArray(t.tuning) && t.tuning.length ? [...t.tuning] : null,
    capo: String(capo),
  };
}

/** Panel errors: `{ field | 'string<i>': message }`; `lastVisible` true when no other track is visible. */
export function trackErrors(v, { lastVisible = false } = {}) {
  const out = {};
  (v.tuning || []).forEach((p, i) => { if (!canonicalPitch(p)) out[`string${i}`] = 'Use a note and octave from 0 to 9, such as E2 or F#3.'; });
  if (!/^\d+$/.test(String(v.capo).trim()) || Number(v.capo) > 30) out.capo = 'Capo must be a whole number from 0 to 30.';
  if (lastVisible && !v.notation && !v.tab) out.tab = 'At least one track must be visible.';
  return out;
}

/** The updateTrack patch from `before` to `v` (trackValues shapes): changed fields only. */
export function trackPatch(before, v) {
  const patch = {};
  for (const k of ['name', 'label']) {
    const x = String(v[k] ?? '').trim();
    if (x !== String(before[k] ?? '').trim()) patch[k] = x || null;
  }
  if (v.clef !== before.clef) patch.clef = v.clef;
  if (v.notation !== before.notation) patch.showStandardNotation = v.notation;
  if (v.tab !== before.tab) patch.showTablature = v.tab;
  if (v.rhythm !== before.rhythm) patch.tabRhythm = v.rhythm === 'auto' ? null : v.rhythm === 'true';
  if (v.artic !== before.artic) patch.tabArticulations = v.artic ? true : null;
  if (v.tied !== before.tied) patch.tiedFrets = v.tied ? 'parens' : null;
  if (v.tuning) {
    const canon = v.tuning.map(canonicalPitch);
    // a track without a tuning reads as standard 6-string guitar, so writing that is no change
    const old = (before.tuning ?? ScoreEditor.TUNINGS.guitar6[0].tuning).map(canonicalPitch);
    if (canon.length !== old.length || canon.some((p, i) => p !== old[i])) patch.tuning = canon;
  }
  if (Number(v.capo) !== Number(before.capo)) patch.capo = Number(v.capo);
  return patch;
}

/** Wire the Tracks… dialog (`opts.refresh` re-reads the page's status after each call). */
export function wireTracksDialog(doc, editor, { refresh = () => {} } = {}) {
  const $ = (id) => doc.getElementById(id);
  const form = $('tracks-form');
  const list = $('tr-list');
  const alert = $('tracks-error');
  const status = $('tr-status');
  let sel = 0;
  let before = null;
  let tuning = null; // the panel's string values, low to high, or null (no tuning)

  for (const { value, label } of instrumentOptions()) {
    const o = doc.createElement('option');
    o.value = value;
    o.textContent = label;
    $('tr-add-preset').append(o);
  }

  const score = () => editor.getScore();
  const tracks = () => score().tracks;
  const otherVisible = () => tracks().some((t, i) => i !== sel && (t.showTablature || t.showStandardNotation !== false));
  const nameOf = (i) => String(tracks()[i]?.name || '').trim() || `Track ${i + 1}`;

  function readPanel() {
    return {
      name: $('tr-name').value, label: $('tr-label').value, clef: $('tr-clef').value,
      notation: $('tr-notation').checked, tab: $('tr-tab').checked,
      rhythm: doc.querySelector('input[name="tr-rhythm"]:checked')?.value ?? 'auto',
      artic: $('tr-artic').checked, tied: $('tr-tied').checked,
      tuning: tuning ? [...tuning] : null, capo: $('tr-capo').value,
    };
  }
  const pending = () => !!before && Object.keys(trackPatch(before, readPanel())).length > 0;
  /** True when it is fine to leave the panel (no pending changes, or the user discards them). */
  const leavePanel = () => !pending() || doc.defaultView.confirm(`Discard your changes to "${nameOf(sel)}"?`);

  function buildList() {
    const ts = tracks();
    list.replaceChildren(...ts.map((t, i) => {
      const o = doc.createElement('option');
      o.value = String(i);
      o.textContent = trackLabel(t, i);
      return o;
    }));
    list.size = Math.min(ts.length, 8);
    list.value = String(sel);
    withFocus(form, () => {
      $('tr-up').disabled = sel === 0;
      $('tr-down').disabled = sel === ts.length - 1;
      $('tr-remove').disabled = ts.length === 1;
      $('tr-remove-help').hidden = ts.length !== 1;
      $('tr-add').disabled = ts.length >= ScoreEditor.LIMITS.tracks;
      $('tr-add-help').hidden = ts.length < ScoreEditor.LIMITS.tracks;
    });
  }

  function renderPresets() {
    const select = $('tr-preset');
    const custom = doc.createElement('option');
    custom.value = 'custom';
    custom.textContent = 'Custom';
    const groups = presetGroups(tuning.length).map((g) => {
      const og = doc.createElement('optgroup');
      og.label = g.label;
      g.options.forEach(({ value, text }) => { const o = doc.createElement('option'); o.value = value; o.textContent = text; og.append(o); });
      return og;
    });
    select.replaceChildren(custom, ...groups);
    select.value = matchPreset(tuning) ?? 'custom';
    if (!select.value) select.value = 'custom';
  }

  function renderStrings(focusIndex = -1) {
    const on = !!tuning;
    $('tr-tuning-on').hidden = !on;
    $('tr-tuning-off').hidden = on;
    if (!on) return;
    const box = $('tr-strings');
    box.replaceChildren(...tuningRows(tuning).map((row, i) => {
      const div = doc.createElement('div');
      div.className = 'row';
      const label = doc.createElement('label');
      label.htmlFor = `tr-string-${i}`;
      label.textContent = row.label;
      const input = doc.createElement('input');
      input.type = 'text';
      input.id = `tr-string-${i}`;
      input.value = row.value;
      input.maxLength = 4;
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.addEventListener('input', () => { tuning[i] = input.value; $('tr-preset').value = matchPreset(tuning) ?? 'custom'; });
      div.append(label, ' ', input);
      return div;
    }));
    renderPresets();
    withFocus(form, () => {
      $('tr-add-string').disabled = tuning.length >= ScoreEditor.LIMITS.tuningStrings;
      $('tr-remove-string').disabled = tuning.length <= MIN_STRINGS;
    });
    if (focusIndex >= 0) $(`tr-string-${focusIndex}`).focus();
  }

  function syncStaves() {
    const notation = $('tr-notation').checked;
    const tab = $('tr-tab').checked;
    $('tr-staves-help').hidden = notation || tab;
    if (!notation && !tab && !otherVisible()) setFieldError(doc, $('tr-tab'), 'At least one track must be visible.');
    else clearFieldError(doc, $('tr-tab'));
    withFocus(form, () => { $('tr-tab-options').disabled = !tab; });
  }

  function loadPanel() {
    const t = tracks()[sel];
    const clef = editor.getMeasureSettings(0, sel).clef.value;
    before = trackValues(t, clef);
    $('tr-panel-title').textContent = `Track ${sel + 1}: ${nameOf(sel)}`;
    $('tr-name').value = before.name;
    $('tr-label').value = before.label;
    $('tr-clef').value = before.clef;
    $('tr-notation').checked = before.notation;
    $('tr-tab').checked = before.tab;
    doc.querySelector(`input[name="tr-rhythm"][value="${before.rhythm}"]`).checked = true;
    $('tr-artic').checked = before.artic;
    $('tr-tied').checked = before.tied;
    $('tr-capo').value = before.capo;
    $('tr-string-note').textContent = '';
    form.querySelectorAll('[aria-invalid="true"]').forEach((el) => clearFieldError(doc, el));
    tuning = before.tuning ? [...before.tuning] : null;
    renderStrings();
    syncStaves();
  }

  function refreshAll(message) {
    buildList();
    loadPanel();
    alert.textContent = '';
    if (message != null) status.textContent = message;
    refresh();
  }

  list.addEventListener('change', () => {
    const next = Number(list.value);
    if (next === sel) return;
    if (!leavePanel()) { list.value = String(sel); return; }
    sel = next;
    refreshAll();
  });
  const move = (d) => {
    if (!leavePanel()) return;
    if (callApi(editor, alert, () => editor.moveTrack(sel, sel + d))) { sel += d; refreshAll(editor.lastMessage); }
  };
  $('tr-up').addEventListener('click', () => move(-1));
  $('tr-down').addEventListener('click', () => move(1));
  $('tr-add').addEventListener('click', () => {
    if (!leavePanel()) return;
    if (callApi(editor, alert, () => editor.addTrack($('tr-add-preset').value, sel + 1))) { sel += 1; refreshAll(editor.lastMessage); }
  });
  $('tr-remove').addEventListener('click', () => {
    if (!leavePanel()) return;
    const n = trackNoteCount(score(), sel);
    const ask = n ? `Remove track "${nameOf(sel)}"? Its ${n} note${n === 1 ? '' : 's'} will be deleted.` : `Remove track "${nameOf(sel)}"?`;
    if (!doc.defaultView.confirm(ask)) return;
    if (callApi(editor, alert, () => editor.removeTrack(sel))) {
      sel = Math.min(sel, tracks().length - 1);
      refreshAll(editor.lastMessage);
      list.focus();
    }
  });
  $('tr-preset').addEventListener('change', () => {
    const [id, i] = $('tr-preset').value.split(':');
    if (!i) return;
    tuning = [...ScoreEditor.TUNINGS[id][Number(i)].tuning];
    renderStrings();
  });
  $('tr-add-string').addEventListener('click', () => {
    tuning.unshift(lowerFourth(tuning[0]));
    $('tr-string-note').textContent = '';
    renderStrings(0);
  });
  $('tr-remove-string').addEventListener('click', () => {
    const s = tuning.length;
    tuning.shift();
    const k = notesOnRemovedStrings(score(), sel, s - 1) - notesOnRemovedStrings(score(), sel, s);
    $('tr-string-note').textContent = k ? `String ${s} has ${k} note${k === 1 ? '' : 's'}. They'll be deleted when you apply.` : '';
    renderStrings();
  });
  $('tr-add-tuning').addEventListener('click', () => {
    tuning = [...ScoreEditor.TUNINGS.guitar6[0].tuning];
    renderStrings(0);
  });

  wireDialog(doc, editor, {
    dialog: $('tracks-dialog'), form, opener: $('tracks-btn'), cancel: $('tracks-cancel'), alert,
    open() {
      sel = editor.getCursor().track;
      status.textContent = '';
      buildList();
      loadPanel();
    },
    apply() {
      const v = readPanel();
      const errs = trackErrors(v, { lastVisible: !otherVisible() });
      const fields = [...(v.tuning || []).map((_, i) => [`string${i}`, $(`tr-string-${i}`)]), ['tab', $('tr-tab')], ['capo', $('tr-capo')]];
      if (showErrors(doc, alert, fields.filter(([k]) => errs[k]).map(([k, el]) => [el, errs[k]]))) return false;
      const patch = trackPatch(before, v);
      if (!Object.keys(patch).length) return true;
      if (patch.tuning) {
        const old = before.tuning ? before.tuning.length : 6;
        const lost = notesOnRemovedStrings(score(), sel, patch.tuning.length);
        const k = old - patch.tuning.length;
        if (lost && !doc.defaultView.confirm(`Remove ${k} string${k === 1 ? '' : 's'}? ${lost} note${lost === 1 ? '' : 's'} on ${k === 1 ? 'it' : 'them'} will be deleted.`)) return false;
      }
      const done = callApi(editor, alert, () => editor.updateTrack(sel, patch));
      refresh();
      return done;
    },
  });
  // after wireDialog's listener, which clears a field's error on change: the staves check sets it again live
  form.addEventListener('change', (e) => { if (e.target === $('tr-notation') || e.target === $('tr-tab')) syncStaves(); });
}
