/**
 * draw/dynamicsLine.js — the dynamics line below a notation staff, drawn by
 * pass 6 (draw/passes/chordsFermatas.js): voice-1 dynamics, voice-2
 * dynamics and crescendo / diminuendo hairpins (`beat.hairpin`,
 * expression.js hairpinOf), one baseline per system staff. Lives outside
 * draw/passes/ so that pass stays small.
 *
 * Hairpins (ui.md "Hairpins"): consecutive voice-1 main beats with the same
 * kind form one hairpin (graces are skipped, rests count, an empty measure
 * ends it, a beat with a dynamic in either voice starts a new one). It
 * starts DYNAMIC_GAP_SP right of a dynamic at its first onset, else at the
 * first head's left edge; it ends DYNAMIC_GAP_SP left of a dynamic at the
 * next onset, else NEXT_ONSET_GAP_SP before that onset, else (no next
 * onset on the system) at breakEndX. At least MIN_LENGTH_SP long. Across a
 * system break it is split: later segments start at breakStartX and the
 * break-side narrow end opens BREAK_OPENING_SP (Gould).
 *
 * Voice-2 dynamics (main beats only) are centred on the voice-2 element on
 * the same baseline; voice 1 wins an onset where both have one.
 */
import { renderDynamic, dynamicFontSizePx } from './notation.js';
import { path, svgD } from './svgUtil.js';
import { breakEndX, breakStartX, HEAD_HALF_SP } from './passes/common.js';
import { glyphStringBox } from '../glyphMetrics.js';
import { dynamicGlyph } from '../glyphs.js';
import { hairpinOf } from '../expression.js';

// Dynamics: one baseline per system staff, at least DYNAMIC_MIN_BASELINE_SP
// below the bottom line and with the glyphs' top (or a hairpin's top edge)
// DYNAMIC_CLEARANCE_SP below the lowest ink of the staff's music.
const DYNAMIC_MIN_BASELINE_SP = 2;
const DYNAMIC_CLEARANCE_SP = 0.75;
const HAIRPIN_CENTRE_U = 0.38;      // hairpin centre line above the dynamics baseline, in glyph units (x-height middle)
const HAIRPIN_OPENING_SP = 1;
const BREAK_OPENING_SP = 0.3;       // narrow end of a hairpin at a system break
const HAIRPIN_STROKE_SP = 0.16;
const DYNAMIC_GAP_SP = 0.4;         // a dynamic's edge <-> a hairpin end
const NEXT_ONSET_GAP_SP = 0.8;      // hairpin end -> the next onset (no dynamic there)
const MIN_LENGTH_SP = 2;

const sameT = (a, b) => !!(a && b) && a.n === b.n && a.d === b.d;
const isMain = (le) => le.el.type !== 'grace';

/** Voice-2 main element of `measure` at onset `t` with a dynamic, when voice 1 has none there. */
function v2DynamicAt(measure, t) {
  if (!measure.elements2 || measure.elements.some((le) => isMain(le) && sameT(le.t, t) && le.el.dynamic)) return null;
  return measure.elements2.find((le) => isMain(le) && sameT(le.t, t) && le.el.dynamic) || null;
}

/** The dynamic drawn at onset `t` of `measure` (voice 1's, else voice 2's): its layout element, or null. */
function dynamicAt(measure, t) {
  return measure.elements.find((le) => isMain(le) && sameT(le.t, t) && le.el.dynamic) || v2DynamicAt(measure, t);
}

/** Horizontal extent of the dynamic glyphs drawn centred on `le.x` (as layout/ink.js measures them). */
function dynamicEdges(le, theme) {
  const u = dynamicFontSizePx(theme) / 4;
  const b = glyphStringBox(dynamicGlyph(le.el.dynamic));
  const x1 = le.x + b.left * u - (b.width * u) / 2;
  return { x1, x2: x1 + b.width * u };
}

/** Onsets of a measure (both voices' main elements), sorted by time: `[{ t, x }]` (voice 1's x first). */
function onsetsOf(measure) {
  const all = [...measure.elements, ...(measure.elements2 || [])].filter((le) => isMain(le) && le.t);
  return all.sort((a, b) => a.t.n * b.t.d - b.t.n * a.t.d);
}

/**
 * Hairpin runs of every notation track: Map(trackRun -> segments), each
 * segment `{ sysIdx, x1, x2, open1, open2, kind, cont }` (openings in sp,
 * open1 at x1); `cont` on the segments after a system break.
 */
export function hairpinsByRun(score, trackRuns, systems, theme) {
  const s = theme.staffLineSpacing;
  const out = new Map();
  score.tracks.forEach((track) => {
    if (!track.showStandardNotation) return;
    const runs = trackRuns.filter((r) => r.track === track && r.notationG);
    // Hairpin runs: [{ kind, beats: [{ le, measure, run }] }]
    const pins = [];
    let cur = null;
    runs.forEach((run) => run.measures.forEach((measure) => {
      const mains = measure.elements.filter(isMain);
      if (!mains.length) cur = null;
      mains.forEach((le) => {
        const kind = hairpinOf(le.el.hairpin);
        if (!kind) { cur = null; return; }
        if (!cur || cur.kind !== kind || dynamicAt(measure, le.t)) {
          cur = { kind, beats: [] };
          pins.push(cur);
        }
        cur.beats.push({ le, measure, run });
      });
    }));
    pins.forEach((pin) => {
      const first = pin.beats[0];
      const last = pin.beats[pin.beats.length - 1];
      const startDyn = dynamicAt(first.measure, first.le.t);
      const x1 = startDyn ? dynamicEdges(startDyn, theme).x2 + DYNAMIC_GAP_SP * s : first.le.x - HEAD_HALF_SP * s;
      const endX = hairpinEndX(last, systems, theme);
      const sysFirst = first.run.sysIdx;
      const sysLast = last.run.sysIdx;
      for (let sysIdx = sysFirst; sysIdx <= sysLast; sysIdx++) {
        const run = runs.find((r) => r.sysIdx === sysIdx);
        if (!run) continue;
        const a = sysIdx === sysFirst ? x1 : breakStartX(systems, sysIdx, theme);
        const limit = breakEndX(systems, sysIdx, theme);
        let b = sysIdx === sysLast ? endX : limit;
        if (b - a < MIN_LENGTH_SP * s) b = Math.min(a + MIN_LENGTH_SP * s, limit);
        const cresc = pin.kind === 'cresc';
        const isFirst = sysIdx === sysFirst;
        const isLast = sysIdx === sysLast;
        // The narrow end is closed where the hairpin really starts (cresc) / ends (dim); at a break it opens.
        const closedAtBreak = (isFirst && isLast) || (cresc ? isFirst : isLast);
        const narrow = closedAtBreak ? 0 : BREAK_OPENING_SP;
        const seg = {
          sysIdx, x1: a, x2: b, kind: pin.kind, cont: !isFirst,
          open1: cresc ? narrow : HAIRPIN_OPENING_SP,
          open2: cresc ? HAIRPIN_OPENING_SP : narrow,
        };
        if (!out.has(run)) out.set(run, []);
        out.get(run).push(seg);
      }
    });
  });
  return out;
}

/**
 * x where a hairpin whose last beat is `last` ends, on that beat's system:
 * before the next onset (same measure, else the next measure of the
 * system), clear of a dynamic there; breakEndX when there is none.
 */
function hairpinEndX(last, systems, theme) {
  const s = theme.staffLineSpacing;
  const { le, measure, run } = last;
  let next = onsetsOf(measure).find((o) => o.t.n * le.t.d > le.t.n * o.t.d);
  let nextMeasure = measure;
  if (!next) {
    const mi = run.measures.indexOf(measure);
    nextMeasure = run.measures[mi + 1];
    next = nextMeasure ? onsetsOf(nextMeasure)[0] : null;
    if (nextMeasure && !next) return nextMeasure.x - NEXT_ONSET_GAP_SP * s; // an empty measure: stop before its barline
  }
  if (!next) return breakEndX(systems, run.sysIdx, theme);
  const dyn = dynamicAt(nextMeasure, next.t);
  return dyn ? dynamicEdges(dyn, theme).x1 - DYNAMIC_GAP_SP * s : next.x - NEXT_ONSET_GAP_SP * s;
}

/**
 * What a system staff's dynamics line draws: `{ v1, v2, segs }` (voice-1
 * elements with a dynamic, graces included, in order; voice-2 main
 * elements with a dynamic at an onset where voice 1 has none; this run's
 * hairpin segments from `pins`), or null when all are empty.
 */
export function dynamicsLineOf(run, pins) {
  const v1 = run.measures.flatMap((m) => m.elements).filter((le) => le.el.dynamic);
  const v2 = run.measures.flatMap((m) => (m.elements2 || []).filter((le) => isMain(le) && le.el.dynamic && v2DynamicAt(m, le.t) === le));
  const segs = pins.get(run) || [];
  return v1.length || v2.length || segs.length ? { v1, v2, segs } : null;
}

/**
 * Draw a dynamics line into the notation group `g`: the baseline at least
 * DYNAMIC_MIN_BASELINE_SP below the bottom line (`lineBottom`) and with the
 * dynamics' glyph top (and the hairpins' top edge) DYNAMIC_CLEARANCE_SP
 * below the staff's lowest ink (`ink`, measured before chord symbols);
 * voice-1 dynamics, voice-2 dynamics, then one path per hairpin segment.
 */
export function renderDynamicsLine(g, line, ink, lineBottom, theme) {
  const s = theme.staffLineSpacing;
  const scale = dynamicFontSizePx(theme) / 4; // px per glyph unit (1 sp = font-size / 4)
  const drawn = [...line.v1, ...line.v2];
  const glyphTop = drawn.length ? Math.max(...drawn.map((le) => glyphStringBox(dynamicGlyph(le.el.dynamic)).top)) * scale : -Infinity;
  const pinTop = line.segs.length ? HAIRPIN_CENTRE_U * scale + (HAIRPIN_OPENING_SP / 2) * s : -Infinity;
  const bottom = Number.isFinite(ink.bottom) ? ink.bottom : lineBottom;
  const y = Math.max(lineBottom + DYNAMIC_MIN_BASELINE_SP * s, bottom + DYNAMIC_CLEARANCE_SP * s + Math.max(glyphTop, pinTop));
  drawn.forEach((le) => renderDynamic(g, le.x, y, le.el.dynamic, theme));
  const c = y - HAIRPIN_CENTRE_U * scale;
  line.segs.forEach((seg) => g.appendChild(path(hairpinD(seg, c, s), {
    class: `hairpin hairpin-${seg.kind}${seg.cont ? ' hairpin-cont' : ''}`,
    fill: 'none',
    stroke: theme.dynamicColor,
    'stroke-width': HAIRPIN_STROKE_SP * s,
    'stroke-linecap': 'butt',
    'stroke-linejoin': 'miter',
  })));
}

/** Path data of a hairpin segment around centre line `c` (absolute M / L only): one polyline through a closed end, else two lines. */
function hairpinD(seg, c, s) {
  const h1 = (seg.open1 / 2) * s; const h2 = (seg.open2 / 2) * s;
  if (seg.open1 === 0) return svgD`M ${seg.x2} ${c - h2} L ${seg.x1} ${c} L ${seg.x2} ${c + h2}`;
  if (seg.open2 === 0) return svgD`M ${seg.x1} ${c - h1} L ${seg.x2} ${c} L ${seg.x1} ${c + h1}`;
  return svgD`M ${seg.x1} ${c - h1} L ${seg.x2} ${c - h2} M ${seg.x1} ${c + h1} L ${seg.x2} ${c + h2}`;
}
