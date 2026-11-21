/**
 * layout/index.js — turns a normalized score into absolute pixel x
 * positions: shared measure columns (layout/timeline.js), system breaking
 * and justification (layout/systems.js), then per system, per track, per
 * measure: opening barline / mid-system signature positions, element x
 * (onset x; grace notes left of their main note; whole-measure rests
 * centred), closing barline type and courtesy signatures. Vertical
 * placement happens after drawing (layout/vertical.js). Pure functions, no
 * DOM/SVG here.
 *
 * LayoutModel: `{ width, overflow, systems: [{ measureIndices, indent,
 * startX, staffEndX, contentStartX, lastBarlineX, headerWidth, header: { clefX, tabClefX, keyX, timeX,
 * showTime }, justified, courtesy: { clefX?, keyX, timeX, endX } | null,
 * tracks: [{ courtesy: { key, time, clef? } | null, measures: [LayoutMeasure] }],
 * voltas: [VoltaPart], marks: [Mark] }] }` (voltas / marks: layout/navigation.js)
 * LayoutMeasure: `{ measureIndex, x, contentX, endX, timeSignature,
 * keySignature, barline ('none' when merged into the next repeat-start),
 * startBarline: { type, x } | null, midSig: { keyX, timeX, key, time } | null,
 * clefChange?: { x, clef } (mid-system clef change of this track's notation staff, only when present),
 * wholeRest: { x } | null, padded, showHeader, elements: [{ index, el, x, width, t,
 * chord, accidentals, wholeMeasureRest }], beamGroups, tupletGroups }`.
 * A multi-measure rest (layout/multiRest.js, `score.multiMeasureRests`) is one
 * LayoutMeasure for its whole run: `measureIndex` = the run's first measure,
 * no elements / beam or tuplet groups / wholeRest, the last measure's closing
 * barline, and `multiRest: { count, lastMi, x1, x2 }` (H-bar ends; only when present).
 * Two-voice measures (normalize.js `voice2Beats`) also get `elements2`,
 * `beamGroups2`, `tupletGroups2` (voice 2, indices into `voice2Beats`) and
 * `wholeRest: null`; every element of such a measure has `voice` (1 | 2),
 * rests their `restPos` (`restLedger`) or, merged with the other voice's
 * rest (layout/voices.js), `restMerged: true`, voice-2 elements `dx` (clash shift,
 * already in `x`) and `tabEl` (the beat as drawn on TAB: no beat marks,
 * no note on a string voice 1 frets at the same onset), TAB columns their
 * `tabMarks` / `tabOwn` (layout/voices.js tabColumnMarks).
 */
import { groupBeams, tupletGroups } from './beams.js';
import { cmp } from '../rational.js';
import { buildColumn } from './timeline.js';
import {
  breakSystems, justifySystem, openingLayout, courtesyWidth, courtesyLayout, trackSignatureChange, trackCourtesy, lastOf,
  REPEAT_START_WIDTH_SP,
} from './systems.js';
import { navigationLayout } from './navigation.js';
import { isTwoVoiceMeasure } from '../twoVoice.js';
import { tabColumnMarks } from './voices.js';
import { notationClefChange } from '../clef.js';
import { multiRestRuns, multiRestColumn, multiRestBar } from './multiRest.js';

/** Closing barline type of track `track`'s measure `mi` within a system. */
function closingBarline(track, mi, nextOpening) {
  const m = track.measures[mi];
  if (nextOpening && nextOpening.mergedPrev) return 'none';
  const next = track.measures[mi + 1];
  // A key change turns a preceding single barline into a thin double (ui.md §3).
  if (next && next.keyChanged && m.barline === 'single' && track.showStandardNotation) return 'double';
  return m.barline;
}

/**
 * Layout elements of one voice's `beats` from their timeline `events` in
 * placed column `p` (system-local measure index `li`): onset x, whole-measure
 * rests centred, graces left of the note they lead into.
 */
function placeElements(beats, events, p, li, pad, graceW) {
  const elements = beats.map((el, bi) => {
    const ev = events[bi];
    if (ev.grace) return null; // placed below, once their main note is
    if (ev.hidden) {
      // no ink: at the last onset at or before it (passes that look it up get a sensible x)
      let i = -1;
      p.col.onsets.forEach((o, oi) => { if (cmp(o.t, ev.t) <= 0) i = oi; });
      const x = p.onsetX.length ? p.onsetX[Math.max(i, 0)] : (p.contentX + p.endX) / 2;
      return { index: bi, el, x, width: 0, t: ev.t, chord: null, accidentals: null, wholeMeasureRest: false };
    }
    if (ev.wholeMeasureRest) {
      return { index: bi, el, x: (p.contentX + p.endX) / 2, width: p.endX - p.contentX, t: ev.t, chord: null, accidentals: null, wholeMeasureRest: true };
    }
    return {
      index: bi, el, x: p.onsetX[ev.onset], width: p.gaps[ev.onset], t: ev.t,
      chord: li === 0 ? ev.chordFirst : ev.chord,
      accidentals: li === 0 ? ev.accidentalsFirst : ev.accidentals,
      wholeMeasureRest: false,
    };
  });
  beats.forEach((el, bi) => {
    const ev = events[bi];
    if (!ev.grace) return;
    const anchorX = ev.grace.anchor === 'end'
      ? p.endX - pad
      : elements[ev.grace.anchor].x - events[ev.grace.anchor][li === 0 ? 'ownLeftFirst' : 'ownLeft'];
    elements[bi] = {
      index: bi, el, x: anchorX - (ev.grace.k + 1) * graceW - ev.grace.accDx, width: graceW, t: null,
      chord: null, accidentals: ev.accidentals, wholeMeasureRest: false,
    };
  });
  return elements;
}

/** Voice tags of a two-voice measure's elements of voice `voice` (see the header). */
function tagVoice(elements, events, voice) {
  elements.forEach((le) => {
    const ev = events[le.index];
    le.voice = voice;
    if (ev.restPos != null) le.restPos = ev.restPos;
    if (ev.restLedger != null) le.restLedger = ev.restLedger;
    if (ev.restMerged) le.restMerged = true;
    if (voice === 2) { le.dx = ev.dx || 0; le.x += le.dx; }
  });
}

/**
 * Compute the full layout. `containerWidth` is the requested SVG width;
 * the returned `width` only exceeds it when a single measure cannot fit
 * even compressed (`overflow: true`).
 */
export function computeLayout(score, theme, containerWidth) {
  const s = theme.staffLineSpacing;
  const measureCount = score.measureCount ?? (score.tracks[0]?.measures.length || 0);
  const columns = [];
  for (let mi = 0; mi < measureCount; mi++) columns.push(buildColumn(mi, score, theme));
  // Multi-measure rests (opt-in): a run's first column stands for the whole run (lastOf).
  multiRestRuns(score)?.forEach((last, first) => { columns[first] = multiRestColumn(first, last, columns[first], score, theme); });
  const graceW = theme.graceNoteWidthSp * s;
  const pad = theme.measurePaddingSp * s;

  const breaks = breakSystems(columns, score, theme, containerWidth);
  let width = containerWidth;
  let overflow = false;

  const systems = breaks.map((sys, si) => {
    const isLast = si === breaks.length - 1;
    const just = justifySystem(sys, columns, score, theme, isLast);
    const startX = theme.marginLeftSp * s + sys.indent;

    // Measure columns, left to right.
    let x = startX + sys.header.width;
    const placed = sys.measureIndices.map((mi, li) => {
      const col = columns[mi];
      const opening = openingLayout(mi, score, theme, li === 0 ? sys.header : null);
      const contentX = x + opening.width;
      const gaps = just.gaps[li];
      const onsetX = [];
      let cx = contentX + col.leadPad + (li === 0 ? col.extraIfFirstInSystem : 0);
      col.onsets.forEach((o, i) => { onsetX.push(cx); cx += gaps[i]; });
      const endX = col.onsets.length ? cx : contentX + gaps[0];
      const p = { mi, x, contentX, endX, opening, onsetX, gaps, col };
      x = endX;
      return p;
    });
    const last = placed[placed.length - 1];
    const nextMi = lastOf(columns, last.mi) + 1;
    const courtesy = !isLast && courtesyWidth(nextMi, score, theme) > 0
      ? courtesyLayout(nextMi, score, theme, last.endX) : null;
    const staffEndX = courtesy ? courtesy.endX : last.endX;
    if (just.overflow) {
      overflow = true;
      width = Math.max(width, staffEndX + theme.marginRightSp * s);
    }

    const tracks = score.tracks.map((track, ti) => ({
      courtesy: courtesy ? trackCourtesy(track, nextMi) : null,
      measures: placed.map((p, li) => {
        const measure = track.measures[p.mi];
        const tev = p.col.tracks[ti];
        const run = p.col.lastMi != null;
        const elements = run ? [] : placeElements(measure.beats, tev.events, p, li, pad, graceW);
        let voice2 = null;
        if (!run && isTwoVoiceMeasure(measure)) {
          voice2 = { elements2: placeElements(measure.voice2Beats, tev.events2, p, li, pad, graceW) };
          tagVoice(elements, tev.events, 1);
          tagVoice(voice2.elements2, tev.events2, 2);
          tabColumnMarks(elements, voice2.elements2);
          voice2.beamGroups2 = groupBeams(measure.voice2Beats, measure.timeSignature);
          voice2.tupletGroups2 = tupletGroups(measure.voice2Beats, measure.timeSignature);
        }
        const next = placed[li + 1];
        const sig = p.opening.sig ? trackSignatureChange(track, p.mi) : null;
        const barline = closingBarline(track, lastOf(columns, p.mi), next ? next.opening : null);
        const clef = p.opening.clefX != null ? notationClefChange(track, p.mi) : null;
        return {
          measureIndex: p.mi,
          x: p.x,
          contentX: p.contentX,
          endX: p.endX,
          width: p.endX - p.x,
          timeSignature: measure.timeSignature,
          keySignature: measure.keySignature,
          barline,
          startBarline: p.opening.repeatX != null ? { type: p.opening.repeatType, x: p.x + p.opening.repeatX } : null,
          midSig: sig ? { keyX: p.x + p.opening.sig.keyX, timeX: p.x + p.opening.sig.timeX, ...sig } : null,
          ...(clef ? { clefChange: { x: p.x + p.opening.clefX, clef } } : {}),
          wholeRest: !run && tev.empty ? { x: (p.contentX + p.endX) / 2 } : null,
          padded: !!measure.padded, // added by normalize to pad a shorter track (not authored)
          showHeader: li === 0,
          elements,
          beamGroups: run ? [] : groupBeams(measure.beats, measure.timeSignature),
          tupletGroups: run ? [] : tupletGroups(measure.beats, measure.timeSignature),
          ...(run ? { multiRest: { count: p.col.multiRest, lastMi: p.col.lastMi, ...multiRestBar(p.contentX, p.endX, theme, barline) } } : {}),
          ...voice2,
        };
      }),
    }));

    const h = sys.header;
    const firstOpening = placed[0].opening;
    return {
      measureIndices: sys.measureIndices,
      indent: sys.indent,
      startX,
      staffEndX,
      // where music after the header starts (after an opening repeat barline), and the last barline:
      // continuation arcs across system breaks run from / to these (ui.md §7)
      contentStartX: firstOpening.repeatX != null
        ? placed[0].x + firstOpening.repeatX + REPEAT_START_WIDTH_SP * s
        : startX + h.itemsEnd,
      lastBarlineX: last.endX,
      headerWidth: h.width,
      header: {
        clefX: startX + h.clefX, tabClefX: startX + h.tabClefX, keyX: startX + h.keyX, timeX: startX + h.timeX,
        showTime: h.showTime,
      },
      justified: just.justified,
      courtesy,
      tracks,
    };
  });

  // Volta brackets and navigation marks (no horizontal change).
  navigationLayout(systems, score, theme).forEach((n, i) => Object.assign(systems[i], n));

  return { systems, width, overflow };
}
