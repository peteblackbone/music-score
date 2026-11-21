/**
 * draw/expressionMarks.js — fade in / fade out / volume swell (`beat.fade`)
 * and wah open / closed (`beat.wah`) marks above a track's top staff
 * (notation, else TAB), voice-1 main beats only (ui.md "Fade & wah").
 * Called from MusicScoreRenderer.render() after pass 5 and before pass 6,
 * so chord symbols / diagrams (pass 6) rise above them; pass 7 (fermatas)
 * clears their boxes, recorded in `run.aboveBoxes` (`{ x1, x2, top }`).
 *
 * Each mark is centred on its beat at full SMuFL size, its ink bottom at
 * least STAFF_CLEAR_SP above the top line and MARK_CLEAR_SP above the
 * staff's ink under it (horizontal padding SPAN_PAD_SP). Fades are drawn
 * first, then wahs (so a wah lands above a fade on the same beat).
 * Consecutive beats with a mark of the same type on one system staff share
 * the highest bottom.
 */
import { glyphText } from './svgUtil.js';
import { tabTopY } from './passes/common.js';
import { inkBounds } from '../layout/ink.js';
import { glyphBox } from '../glyphMetrics.js';
import { fadeGlyph, wahGlyph } from '../glyphs.js';
import { smuflFontSizePx } from '../theme.js';
import { fadeOf, wahOf } from '../expression.js';

const STAFF_CLEAR_SP = 1;   // top line -> a mark's ink bottom
const MARK_CLEAR_SP = 0.4;  // staff ink under a mark -> its ink bottom (the stack gap above the staff)
const SPAN_PAD_SP = 0.1;    // horizontal padding of the span whose ink a mark clears

const TYPES = [
  { name: 'fade', kindOf: (el) => fadeOf(el.fade), glyphOf: fadeGlyph },
  { name: 'wah', kindOf: (el) => wahOf(el.wah), glyphOf: wahGlyph },
];

/** Fade and wah marks of every track (see the header). */
export function renderFadeWah(score, trackRuns, theme, systems) {
  const s = theme.staffLineSpacing;
  trackRuns.forEach((run) => {
    const g = run.notationG || run.tabG;
    if (!g) return;
    const topLine = run.notationG ? 0 : tabTopY(run, run.track.tuning.length, theme);
    const mains = run.measures.flatMap((m) => m.elements).filter((le) => le.el.type !== 'grace');
    TYPES.forEach((type) => {
      // Groups of consecutive main beats with a mark of this type.
      const groups = [];
      let cur = null;
      mains.forEach((le) => {
        const kind = type.kindOf(le.el);
        if (!kind) { cur = null; return; }
        if (!cur) { cur = []; groups.push(cur); }
        cur.push({ le, kind, glyph: type.glyphOf(kind) });
      });
      groups.forEach((group) => {
        const placed = group.map((m) => {
          const box = glyphBox(m.glyph);
          const half = (box.width / 2 + SPAN_PAD_SP) * s;
          const ink = inkBounds(g, theme, { xMin: m.le.x - half, xMax: m.le.x + half, overlap: true }).top;
          return { ...m, box, bottom: Math.min(topLine - STAFF_CLEAR_SP * s, ink - MARK_CLEAR_SP * s) };
        });
        const bottom = Math.min(...placed.map((m) => m.bottom));
        placed.forEach((m) => {
          const y = bottom + m.box.bottom * s;
          g.appendChild(glyphText(m.le.x, y, m.glyph, theme.fontFamily, smuflFontSizePx(theme), {
            class: `${type.name} ${type.name}-${m.kind}`, fill: theme.noteColor, 'text-anchor': 'middle',
          }));
          (run.aboveBoxes ||= []).push({ x1: m.le.x - (m.box.width / 2) * s, x2: m.le.x + (m.box.width / 2) * s, top: y - m.box.top * s });
        });
      });
    });
  });
}
