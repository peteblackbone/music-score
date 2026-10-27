/**
 * draw/whammy.js — whammy-bar lines other than the single-beat dip
 * (draw/tab.js renderWhammyDip): a dive that is held until a return, a
 * return, and a pre-dive. planWhammyLines turns a track's beats into line
 * segments (one per system the line passes through); whammyLineGeometry /
 * renderWhammyLine draw one segment once the TAB pass has found its height.
 *
 * A line has two levels: "deep" (the held bar position, `bottomY`, the
 * lowest and nearest the staff) and "top" (`depth` higher, where the dive
 * starts and the return ends, with the amount text above it). Every
 * segment is one polyline between points at those two levels.
 */
import { whammySpanX, whammyTextSize, bendSemitones, WHAMMY_TEXT_GAP_SP, WHAMMY_STROKE_WIDTH } from './tab.js';
import { beatWhammyAny, whammyLabel } from '../directions.js';
import { breakEndX, breakStartX } from './passes/common.js';
import { group, text, path, svgD } from './svgUtil.js';
import { TEXT_ASCENT_EM, TEXT_DESCENT_EM } from '../layout/ink.js';
import { estimateTextWidth } from '../textMetrics.js';

const DIVE_SP_PER_STEP = 1.2;     // depth of a whole-step dive
const DIVE_MIN_DEPTH_SP = 0.8;
const DIVE_MAX_DEPTH_SP = 2.4;

const HOLD_STOP_GAP_SP = 0.9;     // a hold ended by another whammy mark stops this far before it
const START_SP = 0.3;             // slope / release start -> right of the note's x (as for the dip)

/** Depth (sp) of a dive / pre-dive of `amount`: 1.2 sp per whole step, clamped to 0.8..2.4 ('1/2' .8, '1' / 'full' / unknown 1.2, '1 1/2' 1.8, '2' and up 2.4). */
export function whammyDepthSp(amount) {
  return Math.max(DIVE_MIN_DEPTH_SP, Math.min(DIVE_MAX_DEPTH_SP, (bendSemitones(amount) / 2) * DIVE_SP_PER_STEP));
}

/**
 * Line segments of the whammy dives / returns / pre-dives of a track.
 * `runs` are the track's runs (system by system, each with `sysIdx` and
 * `measures`), `systems` the layout's systems. Dips are not planned here
 * (they are drawn per beat). Returns, in order,
 * `{ run, cls, depth, label, labelX, pts: [{ x, deep }], noteX, notePieces }`:
 * `cls` the group class ('whammy whammy-dive' | '... whammy-hold' |
 * '... whammy-predive', plus ' whammy-return' when the rise is drawn),
 * `label` the amount text (null on continuations) centred on `labelX`,
 * `noteX` the x of the beat that starts the segment's first `notePieces`
 * straight pieces (slope, or lead-in and release) and its text.
 *
 * - dive at x: slope from x + 0.3 sp (width as a dip's, never past the last
 *   barline - 0.5 sp) down to deep, then held until a return;
 * - return while held: the hold runs to the beat and rises to the top;
 *   without a held dive it is ignored;
 * - a dip, dive or pre-dive while held ends the hold HOLD_STOP_GAP_SP before
 *   it, without a rise; a hold reaching a system break stops 0.5 sp before
 *   the last barline and resumes (class whammy-hold, no text) 0.5 sp after
 *   the next system's header, on every system up to the return or the end
 *   of the track;
 */
export function planWhammyLines(runs, systems, theme) {
  const sp = theme.staffLineSpacing;
  const segs = [];
  let held = null; // { seg, depth }
  const endHold = (x) => {
    const last = held.seg.pts[held.seg.pts.length - 1];
    if (x > last.x) held.seg.pts.push({ x, deep: true });
  };
  runs.forEach((run, ri) => {
    if (held) {
      endHold(breakEndX(systems, runs[ri - 1].sysIdx, theme));
      const seg = { run, cls: 'whammy whammy-hold', depth: held.depth, label: null, labelX: null, pts: [{ x: breakStartX(systems, run.sysIdx, theme), deep: true }], noteX: null, notePieces: 0 };
      segs.push(seg);
      held = { seg, depth: held.depth };
    }
    const els = run.measures.flatMap((m) => m.elements);
    const sysEnd = breakEndX(systems, run.sysIdx, theme);
    const barline = systems[run.sysIdx].lastBarlineX;
    // Slope / release extent of the mark at x: as a dip's, never past the system's end gap.
    const slope = (i) => {
      const s = whammySpanX(els[i].x, Math.min(i + 1 < els.length ? els[i + 1].x : Infinity, barline), theme);
      return { x1: s.x1, x2: Math.max(s.x1, Math.min(s.x2, sysEnd)) };
    };
    els.forEach((layoutEl, i) => {
      const w = beatWhammyAny(layoutEl.el);
      if (!w) return;
      const x = layoutEl.x;
      if (w.type === 'return') {
        if (!held) return;
        const s = slope(i);
        endHold(Math.min(Math.max(x + START_SP * sp, held.seg.pts[held.seg.pts.length - 1].x), s.x2));
        held.seg.pts.push({ x: s.x2, deep: false });
        held.seg.cls += ' whammy-return';
        held = null;
        return;
      }
      if (held) endHold(x - HOLD_STOP_GAP_SP * sp);
      held = null;
      if (w.type !== 'dive') return;
      const depth = whammyDepthSp(w.amount);
      const s = slope(i);
      const seg = { run, cls: 'whammy whammy-dive', depth, label: whammyLabel(w), labelX: (s.x1 + s.x2) / 2, pts: [{ x: s.x1, deep: false }, { x: s.x2, deep: true }], noteX: x, notePieces: 1 };
      segs.push(seg);
      held = { seg, depth };
    });
  });
  if (held) endHold(breakEndX(systems, runs[runs.length - 1].sysIdx, theme));
  return segs;
}


/**
 * Geometry of segment `seg` (planWhammyLines) with its deep level at
 * `bottomY`: the polyline `d` (absolute M / L), the amount text (italic,
 * centred on `labelX`, baseline GAP above the top level) and `boxes`: one
 * ink box per straight piece plus the text, all `text: true` (so label
 * dashes keep clear), tagged `noteX` for the slope / lead-in / release
 * pieces and the text of a dive / pre-dive (never for hold or rise pieces).
 */
export function whammyLineGeometry(seg, bottomY, theme) {
  const sp = theme.staffLineSpacing;
  const topY = bottomY - seg.depth * sp;
  const yOf = (p) => (p.deep ? bottomY : topY);
  let d = svgD`M ${seg.pts[0].x} ${yOf(seg.pts[0])}`;
  const boxes = [];
  for (let k = 1; k < seg.pts.length; k++) {
    const a = seg.pts[k - 1]; const b = seg.pts[k];
    d += svgD` L ${b.x} ${yOf(b)}`;
    boxes.push({
      x1: Math.min(a.x, b.x), x2: Math.max(a.x, b.x), top: Math.min(yOf(a), yOf(b)), bottom: Math.max(yOf(a), yOf(b)), text: true,
      ...(k <= seg.notePieces ? { noteX: seg.noteX } : {}),
    });
  }
  let label = null;
  if (seg.label) {
    const size = whammyTextSize(theme);
    const y = topY - WHAMMY_TEXT_GAP_SP * sp - TEXT_DESCENT_EM * size;
    const w = estimateTextWidth(seg.label, size);
    label = { text: seg.label, x: seg.labelX, y, size };
    boxes.push({ x1: seg.labelX - w / 2, x2: seg.labelX + w / 2, top: y - TEXT_ASCENT_EM * size, bottom: y + TEXT_DESCENT_EM * size, text: true, noteX: seg.noteX });
  }
  return { d, label, topY, bottomY, boxes };
}

/**
 * Draw segment `seg` into `g` (a run's TAB group) with its deep level at
 * `bottomY`: `<g class="whammy whammy-...">` with the polyline path and,
 * on the segment that starts the line, the italic amount text. Returns the
 * ink boxes from whammyLineGeometry.
 */
export function renderWhammyLine(g, seg, bottomY, theme) {
  const geo = whammyLineGeometry(seg, bottomY, theme);
  const color = theme.tabFretColor;
  const gEl = group({ class: seg.cls });
  gEl.appendChild(path(geo.d, {
    fill: 'none', stroke: color, 'stroke-width': WHAMMY_STROKE_WIDTH, 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
  }));
  if (geo.label) {
    gEl.appendChild(text(geo.label.x, geo.label.y, geo.label.text, {
      'font-family': theme.textFontFamily, 'font-style': 'italic', 'font-size': geo.label.size, 'text-anchor': 'middle', fill: color,
    }));
  }
  g.appendChild(gEl);
  return geo.boxes;
}
