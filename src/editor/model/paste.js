/**
 * model/paste.js — applying a parsed clip (clip.js parseClip) at the
 * cursor of the cursor track (2.3, replace and insert in 2.3.1).
 *
 * The clip is first fitted to the target track with retuneTrack semantics
 * (tuning.js): notes on strings the track lacks are dropped and counted,
 * a beat left without notes becomes a rest, string+fret notes lose their
 * `pitch` where the open string differs. Then:
 * - pasteBeats: a beats clip is inserted before the cursor beat and its
 *   leading graces (or at the slot); a live selection is removed first and
 *   the beats go where it started, except with `insert`, which keeps the
 *   selected beats and inserts before the selection's start. Overflow
 *   stays (Reflow moves it). At most LIMITS.beatsPerVoice beats in the
 *   measure. The cursor stays on the beat (or slot) that followed.
 * - pasteMeasures: a measures clip of k measures starts at measure `a`:
 *   the selection's first measure, else the target measure (targetMeasure:
 *   the next one when the cursor is on the slot of a measure with a main
 *   beat). It overwrites k measures of the cursor track from `a` (Ctrl+V on
 *   a measures selection, or with no selection when they are all blank),
 *   appending empty columns to every track past the end; or it inserts k
 *   new columns before `a` (insert, or a measure with notes in the way).
 *   Ctrl+V on a beats selection is refused. An overwrite keeps the
 *   measure's own fields and replaces its beats and voices; tempo marks on
 *   overwritten beats move (settings/tempo.js rehomeTempo) or are dropped
 *   and counted. At most LIMITS.measuresPerTrack measures. The cursor goes
 *   to the first position after the written measures, else the end of the
 *   last one.
 * Ties at the edges are repaired; the result is sanitized.
 */
import { tracksOf, trackAt, measuresOf, measureAt, measureCount, beatsAt, isGrace, tuningOf, without, updateBeats, isBlankMeasure } from './access.js';
import { leadingGraces } from './beats.js';
import { insertMeasuresAt } from './measures.js';
import { fixTiesIn } from './ties.js';
import { removeSlices } from './rangeEdit.js';
import { retuneTrack } from './settings/tuning.js';
import { tempoMarks, rehomeTempo } from './settings/tempo.js';
import { sanitizeFixed } from './io.js';
import { STANDARD_TUNING } from './defaultScore.js';
import { EDITOR_LIMITS } from './limits.js';

const refuse = (id) => ({ refused: { id } });

/** Clip measures fitted to `tuning`: `{ measures, dropped }`. */
function fit(clip, tuning) {
  const measures = clip.kind === 'beats' ? [{ beats: clip.beats }] : clip.measures;
  const r = retuneTrack({ tuning: clip.tuning ?? [...STANDARD_TUNING], measures }, [...tuning]);
  return { measures: r.track.measures ?? measures, dropped: r.removed };
}

/** The measure a measures paste starts at with no selection: the cursor's, or the next one from the slot of a measure with a main beat. */
export function targetMeasure(score, cursor) {
  const beats = beatsAt(score, cursor);
  return cursor.beat >= beats.length && beats.some((b) => !isGrace(b)) ? cursor.measure + 1 : cursor.measure;
}

/** A beats clip `beats` pasted at the cursor or the selection (see the header). */
export function pasteBeats(score, cursor, sel, beats, dropped, insert = false) {
  const ti = sel?.track ?? cursor.track;
  const count = beats.filter((b) => !isGrace(b)).length;
  if (!beats.length) return refuse('nothingToPaste');
  let out = score;
  let at;
  let back;
  let tempoRemoved = 0;
  if (sel && !insert) {
    const r = removeSlices(score, sel);
    out = r.score;
    tempoRemoved = r.tempoRemoved || 0;
    at = { track: ti, measure: r.cursor.measure, beat: r.cursor.beat };
    back = at.beat;
  } else {
    const p = sel ? sel.info.start : cursor;
    const here = beatsAt(score, { track: ti, measure: p.measure });
    back = Math.min(p.beat, here.length);
    at = { track: ti, measure: p.measure, beat: leadingGraces(here, back) };
  }
  if (beatsAt(out, at).length + beats.length > EDITOR_LIMITS.beatsPerVoice) return refuse('tooLarge');
  out = updateBeats(out, at, (bs) => [...bs.slice(0, at.beat), ...beats, ...bs.slice(at.beat)]);
  out = sanitizeFixed(fixTiesIn(out, ti, at.measure, at.measure));
  const replaced = sel && !insert && sel.info.beatCount > 0 ? { replaced: sel.info.beatCount } : {};
  const announce = { id: 'pasted', kind: 'beats', count, dropped, ...replaced, tempoRemoved };
  return { score: out, cursor: { ...cursor, measure: at.measure, beat: back + beats.length }, announce };
}

/** A measures clip `measures` pasted over or before the start measure (see the header). */
export function pasteMeasures(score, cursor, sel, measures, dropped, insert = false) {
  const ti = sel?.track ?? cursor.track;
  const k = measures.length;
  if (!k) return refuse('nothingToPaste');
  const count = measureCount(score);
  let a;
  let over;
  if (insert) {
    a = sel ? sel.info.measures[0] : targetMeasure(score, cursor);
    over = false;
  } else if (sel) {
    if (sel.info.kind !== 'measures') return refuse('pasteNeedsMeasures');
    a = sel.info.measures[0];
    over = true;
  } else {
    a = targetMeasure(score, cursor);
    over = true;
    for (let i = 0; i < k && over; i++) over = isBlankMeasure(score, ti, a + i);
  }
  const added = over ? Math.max(0, a + k - count) : k;
  if (count + added > EDITOR_LIMITS.measuresPerTrack) return refuse('tooLarge');
  let out = score;
  let marks = [];
  if (!over) out = insertMeasuresAt(score, a, k);
  else {
    marks = tempoMarks(score).winners.filter((w) => w.track === ti && w.measure >= a && w.measure < Math.min(a + k, count));
    if (added > 0) out = insertMeasuresAt(score, count, added);
  }
  const tracks = tracksOf(out).slice();
  const ms = measuresOf(tracks[ti]).slice();
  while (ms.length < a + k) ms.push({ beats: [] });
  for (let i = 0; i < k; i++) ms[a + i] = { ...without(measureAt(tracks[ti], a + i) ?? {}, 'beats', 'voices'), ...measures[i] };
  tracks[ti] = { ...tracks[ti], measures: ms };
  out = fixTiesIn({ ...out, tracks }, ti, a, a + k - 1);
  let tempoRemoved = 0;
  if (over) ({ score: out, dropped: tempoRemoved } = rehomeTempo(out, ti, marks));
  out = sanitizeFixed(out);
  const end = a + k < measureCount(out) ? { measure: a + k, beat: 0 } : { measure: a + k - 1, beat: beatsAt(out, { track: ti, measure: a + k - 1 }).length };
  const announce = over
    ? { id: 'pastedOver', count: k, at: a + 1, added, dropped, tempoRemoved }
    : { id: 'pasted', kind: 'measures', count: k, at: a + 1, dropped };
  return { score: out, cursor: { ...cursor, ...end }, announce };
}

/** Paste `clip` into `score` at `cursor` (with `sel`, a live selection, or null; `insert`: Insert paste): `{ score, cursor, announce }` or `{ refused }`. */
export function applyPaste(score, cursor, sel, clip, { insert = false } = {}) {
  const { measures, dropped } = fit(clip, tuningOf(trackAt(score, sel?.track ?? cursor.track)));
  return clip.kind === 'beats'
    ? pasteBeats(score, cursor, sel, measures[0].beats, dropped, insert)
    : pasteMeasures(score, cursor, sel, measures, dropped, insert);
}
