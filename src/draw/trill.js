/**
 * draw/trill.js — the trill mark: the "tr" glyph (SMuFL ornamentTrill) with
 * a wavy line after it, centred on the beat, drawn above the notation staff
 * (draw/passes/playingDirections.js) and above the TAB staff
 * (draw/passes/tabTechniques.js), where "(7)" - the fret the trill
 * alternates with - follows the glyph. Placement (the y of the mark's
 * bottom) is the caller's; this file only knows the shape.
 */
import { group, text, glyphText, path, wavyPathD } from './svgUtil.js';
import { whammyTextSize } from './tab.js';
import { Glyph } from '../glyphs.js';
import { glyphBox } from '../glyphMetrics.js';
import { smuflFontSizePx } from '../theme.js';
import { estimateTextWidth } from '../textMetrics.js';
import { TEXT_ASCENT_EM, TEXT_DESCENT_EM } from '../layout/ink.js';

const TRILL_NEXT_GAP_SP = 0.8;    // wave end -> the next beat on the system
const TRILL_WAVE_GAP_SP = 0.25;   // glyph (or suffix) -> start of the wave
const TRILL_WAVE_RAISE_SP = 0.5;  // wave centre line above the glyph's baseline
const TRILL_WAVE_AMP_SP = 0.2;
const TRILL_WAVE_LEN_SP = 0.7;
const TRILL_MIN_WAVE_SP = 0.7;    // shorter waves are left out
const TRILL_SUFFIX_GAP_SP = 0.15; // glyph -> suffix text
const TRILL_STROKE_WIDTH = 1.1;

/**
 * Runs of consecutive trilled beats on one system, which share one trill
 * line: `beats` in score order; `trilled(b)`, `sysOf(b)` and `isGrace(b)`
 * read a beat. A beat that is neither trilled nor a grace (a plain note or
 * a rest) or a new system ends the run; grace notes don't. Returns a Map
 * trilled beat -> its run (the run's trilled beats in order; a single
 * trill is a run of one).
 */
export function trillRuns(beats, trilled, sysOf, isGrace) {
  const out = new Map();
  let cur = null;
  beats.forEach((b) => {
    if (cur && sysOf(b) !== sysOf(cur[0])) cur = null;
    if (trilled(b)) {
      if (!cur) cur = [];
      cur.push(b);
      out.set(b, cur);
    } else if (!isGrace(b)) cur = null;
  });
  return out;
}

/** Right end of a trill's wave: 0.8 sp before the next beat (`nextX`, Infinity when none), never past `breakEnd`. */
export function trillEndX(x, nextX, breakEnd, theme) {
  return Math.min(nextX - TRILL_NEXT_GAP_SP * theme.staffLineSpacing, breakEnd);
}

/**
 * Wave end `endX` (trillEndX) of a trill followed in its run (trillRuns)
 * by the trill at `nextTrillX`: also TRILL_WAVE_GAP_SP before that trill's
 * glyph, which sits on the same line. Unchanged when `nextTrillX` is
 * undefined (the run's last trill).
 */
export function trillRunEndX(endX, nextTrillX, theme) {
  if (nextTrillX === undefined) return endX;
  const sp = theme.staffLineSpacing;
  return Math.min(endX, nextTrillX - (glyphBox(Glyph.ornamentTrill).width / 2 + TRILL_WAVE_GAP_SP) * sp);
}

/**
 * Geometry of a trill as renderTrill draws it: the glyph centred on `x`
 * with its ink bottom at `bottomY`, the optional upright `suffix` text
 * ("(7)") after it, then the wave up to `endX` (left out when shorter than
 * TRILL_MIN_WAVE_SP). Returns `{ x1, x2, top, baselineY, glyphSize,
 * glyphX, suffix, wave, boxes }` — `x1`..`x2` the whole extent (glyph and
 * suffix when there is no wave), `top` the highest ink (wave control points
 * included), `wave` `{ x1, x2, y }` or null, and `boxes` the ink boxes of
 * glyph, suffix and wave (`text: true`). Only vertical values depend on
 * `bottomY`.
 */
export function trillGeometry(x, bottomY, endX, theme, suffix = null) {
  const sp = theme.staffLineSpacing;
  const gb = glyphBox(Glyph.ornamentTrill);
  const half = (gb.width * sp) / 2;
  const baselineY = bottomY + gb.bottom * sp;
  const boxes = [{ x1: x - half, x2: x + half, top: baselineY - gb.top * sp, bottom: bottomY, text: true }];
  let right = x + half;
  let suffixInfo = null;
  if (suffix) {
    const size = whammyTextSize(theme);
    const sx = right + TRILL_SUFFIX_GAP_SP * sp;
    const w = estimateTextWidth(suffix, size);
    suffixInfo = { text: suffix, x: sx, size };
    boxes.push({ x1: sx, x2: sx + w, top: baselineY - TEXT_ASCENT_EM * size, bottom: baselineY + TEXT_DESCENT_EM * size, text: true });
    right = sx + w;
  }
  const wx1 = right + TRILL_WAVE_GAP_SP * sp;
  let wave = null;
  if (endX - wx1 >= TRILL_MIN_WAVE_SP * sp) {
    wave = { x1: wx1, x2: endX, y: baselineY - TRILL_WAVE_RAISE_SP * sp };
    const amp = TRILL_WAVE_AMP_SP * sp;
    boxes.push({ x1: wave.x1, x2: wave.x2, top: wave.y - amp, bottom: wave.y + amp, text: true });
  }
  return {
    x1: x - half, x2: wave ? wave.x2 : right, top: Math.min(...boxes.map((b) => b.top)), baselineY,
    glyphSize: smuflFontSizePx(theme), glyphX: x, suffix: suffixInfo, wave, boxes,
  };
}

/**
 * Draw a trill for the beat at `x`, its glyph's ink bottom at `bottomY`
 * (resolved by the caller), in `<g class="trill">`: the "tr" glyph, the
 * optional `suffix` text and the wave to `endX`. Returns `{ top, boxes }`
 * from trillGeometry.
 */
export function renderTrill(g, x, bottomY, endX, color, theme, suffix) {
  const geo = trillGeometry(x, bottomY, endX, theme, suffix);
  const gEl = group({ class: 'trill' });
  gEl.appendChild(glyphText(geo.glyphX, geo.baselineY, Glyph.ornamentTrill, theme.fontFamily, geo.glyphSize, {
    fill: color, 'text-anchor': 'middle',
  }));
  if (geo.suffix) {
    gEl.appendChild(text(geo.suffix.x, geo.baselineY, geo.suffix.text, {
      'font-family': theme.textFontFamily, 'font-size': geo.suffix.size, 'text-anchor': 'start', fill: color,
    }));
  }
  if (geo.wave) {
    const sp = theme.staffLineSpacing;
    gEl.appendChild(path(wavyPathD(geo.wave.x1, geo.wave.x2, geo.wave.y, TRILL_WAVE_AMP_SP * sp, TRILL_WAVE_LEN_SP * sp), {
      fill: 'none', stroke: color, 'stroke-width': TRILL_STROKE_WIDTH, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    }));
  }
  g.appendChild(gEl);
  return { top: geo.top, boxes: geo.boxes };
}
