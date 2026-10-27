/**
 * layout/timeline.js — one measure column (the same measure index across
 * all tracks) as a shared onset timeline (ui.md §4):
 *
 * - every non-grace event of every track starts at an exact rational time
 *   (tuplet-scaled); equal times across tracks/staves share one onset and
 *   therefore one x;
 * - each onset has a left and right extent (max over all staves) from
 *   layoutChord / rest glyph boxes / fret-label widths, and, on TAB staves
 *   with rhythm (track.tabRhythm), the band's flags, dots and rests
 *   (layout/tabRhythm.js);
 * - the gap from onset i to i+1 is max(ideal, collision minimum), with
 *   ideal = max(minNoteSpacing, quarterSpacing · √(Δt / ¼)) and minimum =
 *   rightExt(i) + leftExt(i+1) + 0.3 sp; the last onset → barline gap
 *   ("tail") is max(ideal(Δt_last) − 0.5 sp, rightExt + 1 sp);
 * - grace notes are not onsets: grace k (0 = nearest) sits at
 *   x − ownLeftExtent − (k + 1) · graceNoteWidthSp, left of the note it leads into;
 * - a whole-measure rest (the only event is one rest ≥ the bar) or an empty
 *   measure creates no onset; it is centred in the measure later.
 *
 * All widths are px. Pure functions, no DOM.
 */
import { R, ZERO, add, sub, cmp, key, toNumber, max as rmax } from '../rational.js';
import { durationR } from '../duration.js';
import { staffPosition } from '../pitch.js';
import { noteheadForDuration, restForDuration, flagForDuration } from '../glyphs.js';
import { glyphBox } from '../glyphMetrics.js';
import { groupBeams } from './beams.js';
import { layoutChord, DOT_GAP_SP, DOT_STEP_SP, DOT_RADIUS_SP } from './chord.js';
import { resolveMeasureAccidentals } from './accidentals.js';
import { fretLabel, fretLabelWidth } from '../textMetrics.js';
import { layoutHeadGlyph } from '../harmonics.js';
import { tabRhythmExtents } from './tabRhythm.js';

const COLLISION_PAD_SP = 0.3;
const TAIL_IDEAL_REDUCTION_SP = 0.5;
const TAIL_MIN_SP = 1;
const EMPTY_COLUMN_SP = 6;

/** Bar length of a time signature, as a fraction of a whole note. */
export function barDuration(ts) { return R(ts.beats, ts.beatType); }

/** Ideal gap (px) after an onset lasting `dt` (rational). */
export function idealGap(dt, theme) {
  const q = theme.quarterSpacingSp * Math.sqrt(toNumber(dt) / 0.25);
  return Math.max(theme.minNoteSpacingSp, q) * theme.staffLineSpacing;
}

/** Stem direction of a note/chord from its staff positions (far note below the middle line → up). */
export function stemUpFor(positions) {
  return (Math.min(...positions) + Math.max(...positions)) / 2 < 4;
}

/**
 * Notation-staff extents (px) and chord layout of one note/rest beat.
 * `stemUp` is the final direction (the beam group's when beamed);
 * `accNames` the accidental per note. Returns `{ left, right, chord }`.
 */
function notationExtents(el, positions, stemUp, accNames, beamed, theme) {
  const s = theme.staffLineSpacing;
  if (el.type === 'rest') {
    const half = (glyphBox(restForDuration(el.duration)).width / 2) * s;
    const right = el.dots ? Math.max(half, half + (DOT_GAP_SP + DOT_STEP_SP * (el.dots - 1) + DOT_RADIUS_SP) * s) : half;
    return { left: half, right, chord: null };
  }
  const notes = el.notes || [];
  if (!notes.length) return { left: 0, right: 0, chord: null };
  const chord = layoutChord(notes, positions, stemUp, accNames, {
    headGlyph: noteheadForDuration(el.duration),
    headGlyphs: notes.map((n) => layoutHeadGlyph(n, el.duration)),
    dots: el.dots || 0,
    duration: el.duration,
    flagged: !beamed && el.duration !== 'whole' && !!flagForDuration(el.duration, stemUp),
  }, theme);
  return { left: chord.leftExt, right: chord.rightExt, chord };
}

/** Tab-staff extents (px) of one beat: half the widest fret-label knock-out. */
function tabExtents(el, theme) {
  if (el.type === 'rest') return { left: 0, right: 0 };
  let half = 0;
  (el.notes || []).forEach((n) => {
    if (n.string == null || n.fret == null) return;
    half = Math.max(half, fretLabelWidth(fretLabel(n), theme) / 2);
  });
  return { left: half, right: half };
}

/**
 * Per-beat timing and extents of one track's measure `mi`.
 * Returns `{ events, end, wholeMeasureRest, empty }` where each event is
 * `{ t, grace: { anchor, k } | null, left, right, ownLeft, chord, accidentals,
 * leftFirst, ownLeftFirst, chordFirst, accidentalsFirst, wholeMeasureRest }`
 * (grace `anchor` = beat index of the note it leads into, or 'end' for
 * trailing graces; `k` = 0 for the grace nearest it). The `…First`
 * variants apply when the measure opens a system: tied continuations at
 * the first onset restate their accidental (ui.md §7).
 */
function trackEvents(track, mi, theme) {
  const measure = track.measures[mi];
  const beams = groupBeams(measure.beats, measure.timeSignature);
  const positionsOf = (el) => (el.notes || []).map((n) => (n.pitch == null ? 4 : staffPosition(n.pitch, track.clef)));
  // Final stem direction per beat: a beam group's shared direction (its overall range), else the beat's own.
  const groupStem = new Map();
  beams.forEach((grp) => {
    if (grp.length < 2) return;
    const all = grp.flatMap((i) => positionsOf(measure.beats[i]));
    if (!all.length) return;
    const up = stemUpFor(all);
    grp.forEach((i) => groupStem.set(i, up));
  });
  const accs = track.showStandardNotation ? resolveMeasureAccidentals(track, mi) : null;
  // Beats in a TAB beam group (no flag), only when the TAB staff shows rhythm.
  const tabBeamed = track.tabRhythm ? new Set(beams.filter((g) => g.length >= 2).flat()) : null;
  const graceW = theme.graceNoteWidthSp * theme.staffLineSpacing;
  // half a grace notehead: the leftmost grace's head pokes this far left of its slot
  const graceHalf = (glyphBox(noteheadForDuration('quarter')).width / 2) * theme.graceNoteScale * theme.staffLineSpacing;

  const mains = measure.beats.filter((b) => b.type !== 'grace');
  const wholeMeasureRest = mains.length === 1 && mains[0].type === 'rest'
    && cmp(durationR(mains[0]), barDuration(measure.timeSignature)) >= 0;

  let t = ZERO;
  let pending = [];
  const events = measure.beats.map((el, bi) => {
    if (el.type === 'grace') {
      const ev = { t: null, grace: { anchor: null, k: 0 }, left: 0, right: 0, ownLeft: 0, chord: null, accidentals: null };
      pending.push(ev);
      return ev;
    }
    let left = 0; let right = 0; let chord = null; let accidentals = null;
    let leftFirst = 0; let chordFirst = null; let accidentalsFirst = null;
    if (track.showStandardNotation) {
      const positions = positionsOf(el);
      const stemUp = groupStem.has(bi) ? groupStem.get(bi) : (positions.length ? stemUpFor(positions) : true);
      const beamed = groupStem.has(bi);
      accidentals = accs[bi].names;
      const n = notationExtents(el, positions, stemUp, accidentals, beamed, theme);
      left = n.left; right = n.right; chord = n.chord;
      leftFirst = left; chordFirst = chord; accidentalsFirst = accidentals;
      const restate = accs[bi].restate;
      if (cmp(t, ZERO) === 0 && restate.some((r, i) => r !== accidentals[i])) {
        const f = notationExtents(el, positions, stemUp, restate, beamed, theme);
        leftFirst = f.left; chordFirst = f.chord; accidentalsFirst = restate;
        right = Math.max(right, f.right);
      }
    }
    if (track.showTablature) {
      const tb = tabExtents(el, theme);
      left = Math.max(left, tb.left); right = Math.max(right, tb.right);
      leftFirst = Math.max(leftFirst, tb.left);
      if (tabBeamed) {
        const rx = tabRhythmExtents(el, tabBeamed.has(bi), theme);
        left = Math.max(left, rx.left); right = Math.max(right, rx.right);
        leftFirst = Math.max(leftFirst, rx.left);
      }
    }
    const graceLead = pending.length ? pending.length * graceW + graceHalf : 0;
    const ev = {
      t, grace: null, left: left + graceLead, right, ownLeft: left, chord, accidentals,
      leftFirst: leftFirst + graceLead, ownLeftFirst: leftFirst, chordFirst, accidentalsFirst,
      wholeMeasureRest: wholeMeasureRest && el.type === 'rest',
    };
    pending.forEach((g, j) => { g.grace.anchor = bi; g.grace.k = pending.length - 1 - j; });
    pending = [];
    t = add(t, durationR(el));
    return ev;
  });
  pending.forEach((g, j) => { g.grace.anchor = 'end'; g.grace.k = pending.length - 1 - j; });
  return { events, end: t, wholeMeasureRest, empty: mains.length === 0, trailingGraces: pending.length };
}

/**
 * Build the shared column for measure index `mi`.
 * @returns {{ measureIndex, duration, onsets: {t,leftExt,rightExt}[], gaps: {nat,min,weight}[],
 *   leadPad, extraIfFirstInSystem, tracks: { events, wholeMeasureRest, empty }[], naturalWidth, minWidth }}
 *   `gaps[i]` follows onset i (the last one is the tail to the barline);
 *   column width = leadPad + Σ gaps.
 */
export function buildColumn(mi, score, theme) {
  const s = theme.staffLineSpacing;
  const graceW = theme.graceNoteWidthSp * s;
  const tracks = score.tracks.map((track) => trackEvents(track, mi, theme));

  // Merge onsets across tracks (whole-measure rests and graces create none).
  const byKey = new Map();
  let end = ZERO;
  tracks.forEach((tr) => {
    end = rmax(end, tr.end);
    tr.events.forEach((ev) => {
      if (ev.grace || ev.wholeMeasureRest) return;
      const k = key(ev.t);
      const o = byKey.get(k) || { t: ev.t, leftExt: 0, leftExtFirst: 0, rightExt: 0 };
      o.leftExt = Math.max(o.leftExt, ev.left);
      o.leftExtFirst = Math.max(o.leftExtFirst, ev.leftFirst ?? ev.left);
      o.rightExt = Math.max(o.rightExt, ev.right);
      byKey.set(k, o);
    });
  });
  const onsets = [...byKey.values()].sort((a, b) => cmp(a.t, b.t));
  const index = new Map(onsets.map((o, i) => [key(o.t), i]));
  tracks.forEach((tr) => tr.events.forEach((ev) => {
    ev.onset = ev.grace || ev.wholeMeasureRest ? null : index.get(key(ev.t));
  }));
  const trailing = Math.max(0, ...tracks.map((tr) => tr.trailingGraces)) * graceW;
  const duration = rmax(end, barDuration(score.tracks[0]?.measures[mi].timeSignature || { beats: 4, beatType: 4 }));

  let leadPad = 0;
  const gaps = [];
  if (!onsets.length) {
    gaps.push({ nat: Math.max(EMPTY_COLUMN_SP * s, trailing + 2 * theme.measurePaddingSp * s), min: EMPTY_COLUMN_SP * s, weight: idealGap(duration, theme) });
  } else {
    leadPad = theme.measurePaddingSp * s + onsets[0].leftExt;
    onsets.forEach((o, i) => {
      const next = onsets[i + 1];
      if (next) {
        const ideal = idealGap(sub(next.t, o.t), theme);
        const min = o.rightExt + next.leftExt + COLLISION_PAD_SP * s;
        gaps.push({ nat: Math.max(ideal, min), min, weight: ideal });
      } else {
        const lastDt = sub(end, o.t);
        const ideal = cmp(lastDt, ZERO) > 0 ? idealGap(lastDt, theme) : theme.minNoteSpacingSp * s;
        const min = o.rightExt + TAIL_MIN_SP * s + trailing;
        gaps.push({ nat: Math.max(ideal - TAIL_IDEAL_REDUCTION_SP * s, min), min, weight: ideal });
      }
    });
  }
  const sum = (k) => gaps.reduce((a, g) => a + g[k], 0);
  return {
    measureIndex: mi,
    duration,
    onsets,
    gaps,
    leadPad,
    // extra lead padding when this measure opens a system (restated accidentals of tied notes)
    extraIfFirstInSystem: onsets.length ? Math.max(0, onsets[0].leftExtFirst - onsets[0].leftExt) : 0,
    tracks,
    naturalWidth: leadPad + sum('nat'),
    minWidth: leadPad + sum('min'),
  };
}
