/**
 * editor-demo-measure.js — the Measure… dialog of editor.html: the cursor's
 * column (time and key signature, barline and repeat, ending, navigation),
 * the clef of the cursor's track and the tempo mark at the cursor beat.
 * Apply makes up to two calls: updateMeasure, then setTempo. Not part of
 * the package; uses the ScoreEditor public API only.
 *
 * Pure helpers (exported for the tests): keyCount, keyLabel, tempoLabel,
 * parseEnding, measureValues, measureErrors, measurePatch; BARLINES is the
 * demo's copy of the library's barline names (pinned by a parity test).
 */
import { ScoreEditor } from '../index.js';
import { durationWords } from '../src/editor/model/durations.js';
import { wireDialog, showErrors, callApi, withFocus } from './editor-demo-forms.js';

const LIMITS = ScoreEditor.LIMITS;
/** The barline names updateMeasure accepts (the Barline select's values). */
export const BARLINES = Object.freeze(['single', 'double', 'final', 'repeatStart', 'repeatEnd']);

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

/** Ending numbers typed as "1, 2" → `{ numbers }` or `{ error }`; empty text → `{ numbers: [] }`. */
export function parseEnding(textValue) {
  const t = String(textValue ?? '').trim();
  if (!t) return { numbers: [] };
  const parts = t.split(',').map((p) => p.trim());
  if (parts.some((p) => !/^\d+$/.test(p) || Number(p) < 1 || Number(p) > LIMITS.endingNumber)) return { error: `Use whole numbers from 1 to ${LIMITS.endingNumber}, separated by commas, such as 1, 2.` };
  const numbers = parts.map(Number);
  if (new Set(numbers).size !== numbers.length) return { error: 'Each number can be used once.' };
  if (numbers.length > LIMITS.endingNumbers) return { error: `At most ${LIMITS.endingNumbers} numbers.` };
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
    barline: BARLINES.includes(m.barline) ? m.barline : '',
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
  if (v.barline === 'repeatEnd' && String(v.repeatCount).trim() && !intText(v.repeatCount, 2, LIMITS.repeatCount)) out.repeatCount = `Repeat count must be a whole number from 2 to ${LIMITS.repeatCount}.`;
  const end = parseEnding(v.ending);
  if (end.error) out.ending = end.error;
  if (tempoOn && v.tempoMode === 'mark') {
    const bpm = Number(v.bpm);
    if (!String(v.bpm).trim() || !(bpm > 0 && bpm <= LIMITS.bpm) || Math.round(bpm * 100) / 100 !== bpm) out.bpm = `BPM must be above 0 and at most ${LIMITS.bpm}, with up to 2 decimals.`;
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

/** Wire the Measure… dialog (`opts.refresh` re-reads the page's status after the calls). */
export function wireMeasureDialog(doc, editor, { refresh = () => {} } = {}) {
  const $ = (id) => doc.getElementById(id);
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
}
