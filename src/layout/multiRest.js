/**
 * layout/multiRest.js — multi-measure rests (1.11, opt-in with
 * `score.multiMeasureRests === true`).
 *
 * A rest measure is, in every track, a measure without a second voice whose
 * beats are empty (padded ones too) or exactly one visible rest at least a
 * bar long carrying nothing but `type`, `duration`, `dots`, empty `notes`
 * (and `slash: false`): any mark (fermata, text, tempo, dynamic, chord,
 * hairpin, …) keeps the measure out. Two or more consecutive rest measures
 * collapse into one column, the run's first measure; key/time/clef
 * changes, repeat-starts, segno, coda and sections may only sit on the
 * first measure, non-single barlines, jumps and repeat counts only on the
 * last; a measure under an ending never collapses. Runs are one column, so
 * they never cross a system break. The normalized model is not changed.
 *
 * Pure functions, no DOM; widths px.
 */
import { R, cmp } from '../rational.js';
import { durationR } from '../duration.js';
import { clefChangeAt } from '../clef.js';
import { idealGap } from './timeline.js';
import { glyphStringBox } from '../glyphMetrics.js';
import { timeSigDigits } from '../glyphs.js';

export const MULTI_REST_NATURAL_SP = 8;   // natural width of a multi-rest column
const MULTI_REST_MIN_SP = 4;              // never narrower than this (or the count + 2 sp)
export const MULTI_REST_INSET_SP = 1;     // content start / barline -> H-bar end
export const MULTI_REST_MIN_BAR_SP = 2;

const REST_KEYS = new Set(['type', 'duration', 'dots', 'notes', 'slash']);

function isPlainBarRest(b, bar) {
  if (!b || b.type !== 'rest' || b.hidden) return false;
  if (Object.keys(b).some((k) => !REST_KEYS.has(k))) return false;
  if (b.notes && b.notes.length) return false;
  if (b.slash !== undefined && b.slash !== false) return false;
  if (b.dots !== undefined && typeof b.dots !== 'number') return false;
  let d;
  try { d = durationR(b); } catch { return false; }
  return cmp(d, bar) >= 0;
}

/** Whether measure `mi` is a rest measure in every track (see the header). */
export function isRestMeasure(score, mi) {
  return score.tracks.every((t) => {
    const m = t.measures[mi];
    if (!m || m.voice2Beats) return false;
    const beats = m.beats || [];
    if (!beats.length) return true;
    const ts = m.timeSignature || { beats: 4, beatType: 4 };
    return beats.length === 1 && isPlainBarRest(beats[0], R(ts.beats, ts.beatType));
  });
}

const nav = (score, mi) => (score.navigation || [])[mi] || {};

/** Something that must stay on a run's first measure. */
function hasFirstOnly(score, mi) {
  const n = nav(score, mi);
  if (n.segno || n.coda || n.section) return true;
  return score.tracks.some((t) => {
    const m = t.measures[mi];
    return m.keyChanged || m.timeChanged || m.repeatStart || (t.showStandardNotation && clefChangeAt(t, mi));
  });
}

/** Something that must stay on a run's last measure. */
function hasLastOnly(score, mi) {
  const n = nav(score, mi);
  if (n.jump || n.repeatCount != null) return true;
  return score.tracks.some((t) => t.measures[mi].barline !== 'single');
}

/**
 * Runs of rest measures: `Map(firstMi -> lastMi)` for runs of 2 or more,
 * or null when the score does not opt in (`multiMeasureRests === true`).
 */
export function multiRestRuns(score) {
  if (score.multiMeasureRests !== true) return null;
  const count = score.measureCount ?? (score.tracks[0]?.measures.length || 0);
  const runs = new Map();
  if (!score.tracks.length) return runs;
  const rest = [];
  for (let mi = 0; mi < count; mi++) rest.push(isRestMeasure(score, mi) && !nav(score, mi).ending);
  let mi = 0;
  while (mi < count) {
    if (!rest[mi]) { mi++; continue; }
    let last = mi;
    while (last + 1 < count && rest[last + 1] && !hasLastOnly(score, last) && !hasFirstOnly(score, last + 1)) last++;
    if (last > mi) runs.set(mi, last);
    mi = last + 1;
  }
  return runs;
}

/** Width (sp) of the bar count digits. */
export function multiRestCountWidthSp(count) {
  return glyphStringBox(timeSigDigits(count)).width;
}

/**
 * Column of a run `first..last` replacing `col` (the first measure's
 * column): no onsets, one fixed gap (natural MULTI_REST_NATURAL_SP,
 * weighted like one bar), `lastMi` and `multiRest` (the bar count).
 */
export function multiRestColumn(first, last, col, score, theme) {
  const s = theme.staffLineSpacing;
  const count = last - first + 1;
  const min = Math.max(MULTI_REST_MIN_SP, multiRestCountWidthSp(count) + 2) * s;
  const ts = score.tracks[0]?.measures[first].timeSignature || { beats: 4, beatType: 4 };
  const gap = { nat: Math.max(MULTI_REST_NATURAL_SP * s, min), min, weight: idealGap(R(ts.beats, ts.beatType), theme) };
  return {
    ...col, onsets: [], gaps: [gap], leadPad: 0, extraIfFirstInSystem: 0,
    naturalWidth: gap.nat, minWidth: gap.min, lastMi: last, multiRest: count,
  };
}

// Width (sp) of a closing barline left of the measure end (thick 0.5, gaps 0.4, thin, repeat dots 0.4).
const CLOSING_BARLINE_SP = { double: 0.5, final: 1.0, repeatEnd: 1.8 };

/**
 * H-bar ends between a measure's content start and end: inset 1 sp each
 * side (from the left edge of a non-single closing barline `barline`), at
 * least 2 sp (centred).
 */
export function multiRestBar(contentX, endX, theme, barline = 'single') {
  const s = theme.staffLineSpacing;
  const right = endX - (CLOSING_BARLINE_SP[barline] || 0) * s;
  let x1 = contentX + MULTI_REST_INSET_SP * s;
  let x2 = right - MULTI_REST_INSET_SP * s;
  if (x2 - x1 < MULTI_REST_MIN_BAR_SP * s) {
    const c = (contentX + right) / 2;
    x1 = c - (MULTI_REST_MIN_BAR_SP / 2) * s;
    x2 = c + (MULTI_REST_MIN_BAR_SP / 2) * s;
  }
  return { x1, x2 };
}
