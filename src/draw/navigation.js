/**
 * draw/navigation.js — volta brackets and navigation marks (segno, coda,
 * jump texts) above the top staff of a system (notation or TAB), from the
 * system's layout (`system.voltas`, `system.marks`, layout/navigation.js).
 *
 * Called once per system after renderFermatas and before the tempo, so the
 * heights clear everything already in the top staff group (music, pick
 * strokes / tab labels / bends, chord symbols, fermatas): one bracket
 * height per system, then one baseline for all marks of the system above
 * the brackets. Anything appended to the group afterwards (only the tempo,
 * which clears the navigation itself) is not taken into account here.
 * Not a score-wide pass: it only reads one staff group.
 */
import { group, path, text, glyphText, svgD } from './svgUtil.js';
import { inkBounds, TEXT_DESCENT_EM } from '../layout/ink.js';
import { estimateTextWidth } from '../textMetrics.js';
import { glyphBox } from '../glyphMetrics.js';
import { Glyph } from '../glyphs.js';
import { smuflFontSizePx } from '../theme.js';
import { MARK_GLYPH_SCALE } from '../layout/navigation.js';

const VOLTA_MIN_HEIGHT_SP = 3;        // bracket line at least this far above the top line
const VOLTA_HOOK_SP = 1.5;
const VOLTA_CLEARANCE_SP = 0.5;       // hook ends -> ink below
const VOLTA_LINE_SP = 0.12;
const VOLTA_LABEL_SIZE_SP = 1.1;
const VOLTA_LABEL_X_SP = 0.4;         // bracket start -> label
const VOLTA_LABEL_BASELINE_SP = 1.2;  // bracket line -> label baseline
const MARK_MIN_BASELINE_SP = 2.5;
const MARK_CLEARANCE_SP = 0.75;
const JUMP_SIZE_SP = 1.2;
const TO_CODA_GLYPH_SCALE = 0.5;
const TO_CODA_GAP_SP = 0.3;           // "To Coda" text -> coda glyph

/**
 * Layout of a "To Coda" jump, right-aligned at mark.xEnd: coda glyph
 * origin `glyphX`, text end `textX` (text-anchor end), total `width` and
 * `descent` (px below the baseline). Shared by measuring and drawing.
 */
function toCodaParts(mark, theme) {
  const s = theme.staffLineSpacing;
  const size = JUMP_SIZE_SP * s;
  const b = glyphBox('coda');
  const glyphX = mark.xEnd - b.right * s * TO_CODA_GLYPH_SCALE;
  const textX = glyphX + b.left * s * TO_CODA_GLYPH_SCALE - TO_CODA_GAP_SP * s;
  const width = estimateTextWidth(mark.text, size, { bold: true }) + (TO_CODA_GAP_SP * s + b.width * s * TO_CODA_GLYPH_SCALE);
  const descent = Math.max(TEXT_DESCENT_EM * size, -b.bottom * s * TO_CODA_GLYPH_SCALE);
  return { glyphX, textX, width, descent };
}

/** Horizontal extent and descent (px below the baseline) of a mark. */
function markGeometry(mark, theme) {
  const s = theme.staffLineSpacing;
  if (mark.kind === 'segno' || mark.kind === 'coda') {
    const b = glyphBox(mark.kind);
    return { x1: mark.x + b.left * s * MARK_GLYPH_SCALE, x2: mark.x + b.right * s * MARK_GLYPH_SCALE, descent: -b.bottom * s * MARK_GLYPH_SCALE };
  }
  if (mark.jumpKind === 'toCoda') {
    const p = toCodaParts(mark, theme);
    return { x1: mark.xEnd - p.width, x2: mark.xEnd, descent: p.descent };
  }
  const size = JUMP_SIZE_SP * s;
  return { x1: mark.xEnd - estimateTextWidth(mark.text, size, { bold: true }), x2: mark.xEnd, descent: TEXT_DESCENT_EM * size };
}

function drawVolta(navG, v, y, theme) {
  const s = theme.staffLineSpacing;
  const w = VOLTA_LINE_SP * s;
  const hook = VOLTA_HOOK_SP * s;
  const hx1 = v.x1 + w / 2;
  const hx2 = v.x2 - w / 2;
  let d = v.leftHook ? svgD`M ${hx1} ${y + hook} L ${hx1} ${y}` : svgD`M ${v.x1} ${y}`;
  d += v.rightHook ? svgD` L ${hx2} ${y} L ${hx2} ${y + hook}` : svgD` L ${v.x2} ${y}`;
  const g = group({ class: `volta ${v.closed ? 'volta-closed' : 'volta-open'}` });
  g.appendChild(path(d, {
    fill: 'none', stroke: theme.noteColor, 'stroke-width': w, 'stroke-linecap': 'butt', 'stroke-linejoin': 'miter',
  }));
  if (v.label) {
    g.appendChild(text(v.x1 + VOLTA_LABEL_X_SP * s, y + VOLTA_LABEL_BASELINE_SP * s, v.label, {
      class: 'volta-number',
      'font-family': theme.textFontFamily,
      'font-size': VOLTA_LABEL_SIZE_SP * s,
      fill: theme.noteColor,
    }));
  }
  navG.appendChild(g);
}

function drawMark(navG, mark, baseline, theme) {
  const s = theme.staffLineSpacing;
  if (mark.kind === 'segno' || mark.kind === 'coda') {
    navG.appendChild(glyphText(mark.x, baseline, Glyph[mark.kind], theme.fontFamily, MARK_GLYPH_SCALE * smuflFontSizePx(theme), {
      class: mark.kind, fill: theme.noteColor,
    }));
    return;
  }
  const kindClass = mark.jumpKind === 'toCoda' ? ' to-coda' : mark.jumpKind === 'fine' ? ' fine' : '';
  const g = group({ class: `jump${kindClass}` });
  let textX = mark.xEnd;
  if (mark.jumpKind === 'toCoda') {
    const { glyphX, textX: tx } = toCodaParts(mark, theme);
    g.appendChild(glyphText(glyphX, baseline, Glyph.coda, theme.fontFamily, TO_CODA_GLYPH_SCALE * smuflFontSizePx(theme), { fill: theme.noteColor }));
    textX = tx;
  }
  g.appendChild(text(textX, baseline, mark.text, {
    'font-family': theme.textFontFamily,
    'font-size': JUMP_SIZE_SP * s,
    'font-weight': 'bold',
    'font-style': 'italic',
    'text-anchor': 'end',
    fill: theme.noteColor,
  }));
  navG.appendChild(g);
}

/**
 * Draw a system's volta brackets and navigation marks into `topG` (its top
 * staff group, local coordinates, top line at y = 0). Returns the appended
 * `<g class="navigation">`, or null (nothing appended) when the system has
 * no navigation content or no staff.
 */
export function renderNavigation(topG, system, theme) {
  const voltas = system?.voltas || [];
  const marks = system?.marks || [];
  if (!topG || (!voltas.length && !marks.length)) return null;
  const s = theme.staffLineSpacing;
  const navG = group({ class: 'navigation' });

  if (voltas.length) {
    const labelSize = VOLTA_LABEL_SIZE_SP * s;
    let top = Infinity;
    voltas.forEach((v) => {
      const labelRight = v.label ? v.x1 + VOLTA_LABEL_X_SP * s + estimateTextWidth(v.label, labelSize) : v.x2;
      top = Math.min(top, inkBounds(topG, theme, { xMin: v.x1, xMax: Math.max(v.x2, labelRight), overlap: true }).top);
    });
    if (!Number.isFinite(top)) top = 0;
    const y = Math.min(-VOLTA_MIN_HEIGHT_SP * s, top - (VOLTA_CLEARANCE_SP + VOLTA_HOOK_SP) * s);
    voltas.forEach((v) => drawVolta(navG, v, y, theme));
  }
  topG.appendChild(navG); // brackets now count as ink for the marks

  if (marks.length) {
    let baseline = -MARK_MIN_BASELINE_SP * s;
    marks.forEach((m) => {
      const geo = markGeometry(m, theme);
      const top = inkBounds(topG, theme, { xMin: geo.x1, xMax: geo.x2, overlap: true }).top;
      if (Number.isFinite(top)) baseline = Math.min(baseline, top - MARK_CLEARANCE_SP * s - geo.descent);
    });
    marks.forEach((m) => drawMark(navG, m, baseline, theme));
  }
  return navG;
}
