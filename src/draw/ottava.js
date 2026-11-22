/**
 * draw/ottava.js — ottava brackets of notation staves (`beat.ottava`,
 * expression.js ottavaKinds; ui.md "Ottava"): the 8va / 15ma glyph above
 * the staff, 8vb / 15mb below, then a dashed line to a solid hook pointing
 * at the staff where the run ends. The notes inside the run are already
 * drawn 1 or 2 octaves toward the staff (normalize.js `ottavaShift`).
 *
 * A run is the consecutive voice-1 main beats with the same kind (tied
 * beats inherit it; an empty measure ends it), split per system: the glyph
 * starts at the first head's left edge, a continuation "(8)" / "(15)" at
 * breakStartX on later systems; the line starts LINE_GAP_SP right of the
 * glyph and ends at breakEndX when the run continues on the next system,
 * else at the hook: HOOK_HEAD_GAP_SP right of the last head, or
 * HOOK_NEXT_GAP_SP before the next beat (or the barline), whichever is
 * further right. The line is at least MIN_LINE_SP long.
 *
 * The segments (ottavaSegments, from the layout only) are computed once per
 * render and handed to both: renderOttavaAlta runs after the fade / wah
 * marks and before pass 6 (its boxes go into `run.aboveBoxes` for the
 * fermatas, and chord symbols rise above it); renderOttavaBassa runs after
 * pass 6, below the dynamics line and the lyrics band (draw/lyrics.js).
 */
import { group, glyphText, line } from './svgUtil.js';
import { breakEndX, breakStartX, HEAD_HALF_SP } from './passes/common.js';
import { inkBounds } from '../layout/ink.js';
import { lyricsBottom } from './lyrics.js';
import { glyphStringBox } from '../glyphMetrics.js';
import { ottavaGlyph } from '../glyphs.js';
import { smuflFontSizePx } from '../theme.js';
import { ottavaKinds } from '../expression.js';

const LINE_GAP_SP = 0.3;        // glyph right -> dashed line
const HOOK_HEAD_GAP_SP = 0.3;   // last head's right edge -> hook
const HOOK_NEXT_GAP_SP = 0.5;   // hook -> the next beat / barline
const MIN_LINE_SP = 1;
const HOOK_SP = 1;              // hook length, toward the staff
const STROKE_SP = 0.16;
const DASH_SP = 0.6;
const DASH_GAP_SP = 0.5;
const STAFF_CLEAR_SP = 1;       // top / bottom line -> the glyph
const INK_CLEAR_SP = 0.5;       // staff ink under the bracket -> the glyph
const HOOK_INK_SP = 0.25;       // staff ink under the hook -> its tip
const HOOK_SPAN_SP = 0.2;       // half width of the span whose ink the hook clears

const ALTA = new Set(['8va', '15ma']);

/**
 * Bracket segments of every notation track: `[{ run, kind, cont, glyphX,
 * lineX2, hook }]` (one per run per system; `hook` true where the run ends).
 */
export function ottavaSegments(score, trackRuns, systems, theme) {
  const s = theme.staffLineSpacing;
  const out = [];
  score.tracks.forEach((track) => {
    if (!track.showStandardNotation) return;
    const kinds = ottavaKinds(track);
    if (!kinds.some((m) => m.v1.some(Boolean))) return;
    const runs = [];
    let cur = null;
    trackRuns.filter((r) => r.track === track && r.notationG).forEach((run) => run.measures.forEach((measure) => {
      const mains = measure.elements.filter((le) => le.el.type !== 'grace');
      if (!mains.length) cur = null;
      mains.forEach((le) => {
        const kind = kinds[measure.measureIndex]?.v1[le.index] || null;
        if (!kind) { cur = null; return; }
        if (!cur || cur.kind !== kind) { cur = { kind, beats: [] }; runs.push(cur); }
        cur.beats.push({ le, measure, run });
      });
    }));
    runs.forEach(({ kind, beats }) => {
      const bySys = [];
      beats.forEach((b) => {
        const last = bySys[bySys.length - 1];
        if (last && last.run === b.run) last.beats.push(b); else bySys.push({ run: b.run, beats: [b] });
      });
      bySys.forEach(({ run, beats: sb }, i) => {
        const cont = i > 0;
        const hook = i === bySys.length - 1;
        const glyphX = cont ? breakStartX(systems, run.sysIdx, theme) : sb[0].le.x - HEAD_HALF_SP * s;
        let lineX2 = breakEndX(systems, run.sysIdx, theme);
        if (hook) {
          const { le, measure } = sb[sb.length - 1];
          const after = measure.elements.slice(measure.elements.indexOf(le) + 1).find((e) => e.el.type !== 'grace');
          const nextX = after ? after.x : measure.endX;
          lineX2 = Math.max(le.x + (HEAD_HALF_SP + HOOK_HEAD_GAP_SP) * s, nextX - HOOK_NEXT_GAP_SP * s);
        }
        out.push({ run, kind, cont, glyphX, lineX2, hook });
      });
    });
  });
  return out;
}

/** Draw one bracket segment; `alta` above the staff, else below. Returns its ink boxes `[{ x1, x2, top }]`. */
function drawSegment(seg, alta, theme) {
  const s = theme.staffLineSpacing;
  const g = seg.run.notationG;
  const glyph = ottavaGlyph(seg.kind, seg.cont);
  const box = glyphStringBox(glyph);
  const glyphRight = seg.glyphX + box.width * s;
  const x1 = glyphRight + LINE_GAP_SP * s;
  const x2 = Math.max(seg.lineX2, x1 + MIN_LINE_SP * s);
  const span = inkBounds(g, theme, { xMin: seg.glyphX, xMax: x2, overlap: true });
  const hookInk = seg.hook ? inkBounds(g, theme, { xMin: x2 - HOOK_SPAN_SP * s, xMax: x2 + HOOK_SPAN_SP * s, overlap: true }) : null;
  const midOf = (baseline) => baseline - 0.5 * box.top * s;
  let baseline;
  if (alta) {
    const bottom = Math.min(-STAFF_CLEAR_SP * s, span.top - INK_CLEAR_SP * s);
    baseline = bottom + box.bottom * s;
    if (hookInk && Number.isFinite(hookInk.top)) baseline -= Math.max(0, midOf(baseline) + HOOK_SP * s - (hookInk.top - HOOK_INK_SP * s));
  } else {
    const lineBottom = seg.run.notationBaselineY;
    // below the lyrics band too (draw/lyrics.js), not only the lyrics under the span
    const spanBottom = Math.max(span.bottom, lyricsBottom(g, theme));
    const top = Math.max(lineBottom + STAFF_CLEAR_SP * s, (Number.isFinite(spanBottom) ? spanBottom : lineBottom) + INK_CLEAR_SP * s);
    baseline = top + box.top * s;
    if (hookInk && Number.isFinite(hookInk.bottom)) baseline += Math.max(0, hookInk.bottom + HOOK_INK_SP * s - (midOf(baseline) - HOOK_SP * s));
  }
  const y = midOf(baseline);
  const gg = group({ class: `ottava ottava-${seg.kind}${seg.cont ? ' ottava-cont' : ''}` });
  gg.appendChild(glyphText(seg.glyphX, baseline, glyph, theme.fontFamily, smuflFontSizePx(theme), { fill: theme.noteColor }));
  const stroke = { stroke: theme.noteColor, 'stroke-width': STROKE_SP * s, 'stroke-linecap': 'butt' };
  gg.appendChild(line(x1, y, x2, y, { ...stroke, 'stroke-dasharray': `${DASH_SP * s} ${DASH_GAP_SP * s}` }));
  if (seg.hook) gg.appendChild(line(x2, y, x2, y + (alta ? HOOK_SP : -HOOK_SP) * s, stroke));
  g.appendChild(gg);
  // The glyph's box reaches the line start, so a mark just right of the glyph clears the glyph, not only the line.
  return [
    { x1: seg.glyphX, x2: x1, top: baseline - box.top * s },
    { x1, x2, top: y - (STROKE_SP / 2) * s },
  ];
}

/** 8va / 15ma brackets of `segments` (ottavaSegments) above the notation staves; their boxes go into `run.aboveBoxes`. */
export function renderOttavaAlta(segments, theme) {
  segments.filter((seg) => ALTA.has(seg.kind)).forEach((seg) => {
    (seg.run.aboveBoxes ||= []).push(...drawSegment(seg, true, theme));
  });
}

/** 8vb / 15mb brackets of `segments` (ottavaSegments) below the notation staves, under the dynamics line. */
export function renderOttavaBassa(segments, theme) {
  segments.filter((seg) => !ALTA.has(seg.kind)).forEach((seg) => drawSegment(seg, false, theme));
}
