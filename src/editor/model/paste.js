/**
 * model/paste.js — applying a parsed clip (clip.js parseClip) at the
 * cursor of the cursor track (2.3).
 *
 * The clip is first fitted to the target track with retuneTrack semantics
 * (tuning.js): notes on strings the track lacks are dropped and counted,
 * a beat left without notes becomes a rest, string+fret notes lose their
 * `pitch` where the open string differs. Then:
 * - a beats clip is inserted before the cursor beat and its leading graces
 *   (or at the slot); a live selection is removed first and the beats go
 *   where it started. Overflow stays (Reflow moves it). At most
 *   LIMITS.beatsPerVoice beats in the measure. The cursor stays on the
 *   beat (or slot) that followed, now after the pasted beats.
 * - a measures clip is inserted as new measures before the cursor measure
 *   (the selection's first measure; the selection is not removed) in every
 *   track, the clip's content going into the cursor track's new measures;
 *   at most LIMITS.measuresPerTrack measures.
 * Ties at the edges are repaired; the result is sanitized.
 */
import { tracksOf, trackAt, measureCount, beatsAt, isGrace, tuningOf, without, updateBeats } from './access.js';
import { leadingGraces } from './beats.js';
import { insertMeasuresAt } from './measures.js';
import { fixTiesIn } from './ties.js';
import { removeSlices } from './rangeEdit.js';
import { retuneTrack } from './settings/tuning.js';
import { sanitizeFixed } from './io.js';
import { STANDARD_TUNING } from './defaultScore.js';
import { EDITOR_LIMITS } from './limits.js';

const tooLarge = { refused: { id: 'tooLarge' } };

/** Clip measures fitted to `tuning`: `{ measures, dropped }`. */
function fit(clip, tuning) {
  const measures = clip.kind === 'beats' ? [{ beats: clip.beats }] : clip.measures;
  const r = retuneTrack({ tuning: clip.tuning ?? [...STANDARD_TUNING], measures }, [...tuning]);
  return { measures: r.track.measures ?? measures, dropped: r.removed };
}

/** Paste `clip` into `score` at `cursor` (with `sel`, a live selection, or null): `{ score, cursor, announce }` or `{ refused }`. */
export function applyPaste(score, cursor, sel, clip) {
  const ti = cursor.track;
  const { measures, dropped } = fit(clip, tuningOf(trackAt(score, ti)));
  if (clip.kind === 'beats') {
    const beats = measures[0].beats;
    const count = beats.filter((b) => !isGrace(b)).length;
    if (!beats.length) return { refused: { id: 'nothingToPaste' } };
    let out = score;
    let at;
    let tempoRemoved = 0;
    if (sel) {
      const r = removeSlices(score, sel);
      out = r.score;
      tempoRemoved = r.tempoRemoved || 0;
      at = { track: ti, measure: r.cursor.measure, beat: r.cursor.beat };
    } else {
      const here = beatsAt(score, cursor);
      at = { track: ti, measure: cursor.measure, beat: leadingGraces(here, Math.min(cursor.beat, here.length)) };
    }
    if (beatsAt(out, at).length + beats.length > EDITOR_LIMITS.beatsPerVoice) return tooLarge;
    out = updateBeats(out, at, (bs) => [...bs.slice(0, at.beat), ...beats, ...bs.slice(at.beat)]);
    out = sanitizeFixed(fixTiesIn(out, ti, at.measure, at.measure));
    const shift = sel ? at.beat : Math.min(cursor.beat, beatsAt(score, cursor).length);
    const announce = { id: 'pasted', kind: 'beats', count, dropped, ...(sel ? { replaced: sel.info.beatCount } : {}), tempoRemoved };
    return { score: out, cursor: { ...cursor, measure: at.measure, beat: shift + beats.length }, announce };
  }
  const k = measures.length;
  if (!k) return { refused: { id: 'nothingToPaste' } };
  if (measureCount(score) + k > EDITOR_LIMITS.measuresPerTrack) return tooLarge;
  const a = sel ? sel.slices[0].measure : cursor.measure;
  let out = insertMeasuresAt(score, a, k);
  const tracks = tracksOf(out).slice();
  const ms = tracks[ti].measures.slice();
  for (let i = 0; i < k; i++) ms[a + i] = { ...without(ms[a + i], 'beats'), ...measures[i] };
  tracks[ti] = { ...tracks[ti], measures: ms };
  out = sanitizeFixed(fixTiesIn({ ...out, tracks }, ti, a, a + k - 1));
  return { score: out, cursor: { ...cursor, measure: a + k }, announce: { id: 'pasted', kind: 'measures', count: k, at: a + 1, dropped } };
}
