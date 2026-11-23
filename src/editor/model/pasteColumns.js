/**
 * model/pasteColumns.js — the 2.3.2 paste of a clip with several tracks
 * (clip.js parseClip `{ kind: 'measures', tracks: [{ tuning, measures }] }`).
 *
 * The base track is the selection's top track, else the cursor track. Clip
 * track i goes to the i-th visible track from the base upward; clip tracks
 * with no target are dropped and counted, visible tracks the clip doesn't
 * reach are untouched, hidden tracks are never written. The k measures
 * start at the selection's first measure (Ctrl+V on a beats selection is
 * refused), else at the target measure (paste.js targetMeasure). Ctrl+V
 * overwrites them on every mapped track by the 2.3.1 rules (on a measures
 * selection, or with no selection when they are blank on every mapped
 * track; columns are appended to every track past the end; tempo marks on
 * overwritten beats rehomed per track after all the writes); otherwise, and
 * always with `insert`, k columns are inserted once into every track and
 * filled on the mapped ones. Each mapped track gets its own tuning fit. At
 * most LIMITS.measuresPerTrack measures; the result is sanitized. The cursor
 * goes to the first position after the written measures on the base track.
 */
import { tracksOf, trackAt, tuningOf, isVisible } from './access.js';
import { rehomeTempo } from './settings/tempo.js';
import { sanitizeFixed } from './io.js';
import { fit, overwriteMeasures, planMeasures, afterMeasures } from './paste.js';

/** The first `n` visible track indices from `base` upward. */
function targetsFrom(score, base, n) {
  const tracks = tracksOf(score);
  const out = [];
  for (let ti = base; ti < tracks.length && out.length < n; ti++) if (isVisible(tracks[ti])) out.push(ti);
  return out;
}

/** Paste multi-track clip `clip` at `cursor` or over `sel` (a live selection, or null): `{ score, cursor, announce }` or `{ refused }` (see the header). */
export function pasteColumns(score, cursor, sel, clip, { insert = false } = {}) {
  const base = sel ? sel.track : cursor.track;
  const k = clip.tracks[0].measures.length;
  const targets = targetsFrom(score, base, clip.tracks.length);
  const droppedTracks = clip.tracks.length - targets.length;
  const plan = planMeasures(score, { ...cursor, track: base }, sel, targets, k, insert);
  if (plan.refused) return plan;
  const { a, over, added, marks } = plan;
  let out = plan.out;
  let dropped = 0;
  targets.forEach((ti, i) => {
    const f = fit({ kind: 'measures', ...clip.tracks[i] }, tuningOf(trackAt(out, ti)));
    dropped += f.dropped;
    out = overwriteMeasures(out, ti, a, f.measures);
  });
  let tempoRemoved = 0;
  if (over) {
    targets.forEach((ti, i) => {
      const r = rehomeTempo(out, ti, marks[i]);
      out = r.score;
      tempoRemoved += r.dropped;
    });
  }
  out = sanitizeFixed(out);
  const end = afterMeasures(out, base, a, k);
  const tracks = targets.length;
  const announce = over
    ? { id: 'pastedOver', count: k, at: a + 1, added, dropped, tempoRemoved, tracks, droppedTracks }
    : { id: 'pasted', kind: 'measures', count: k, at: a + 1, dropped, tracks, droppedTracks };
  return { score: out, cursor: { ...cursor, track: base, ...end }, announce };
}
