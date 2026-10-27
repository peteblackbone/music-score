/**
 * draw/strum.js — the strum arrow: a vertical shaft with a filled
 * arrowhead, pointing down for a down strum and up for an up strum
 * (`beat.strum`), STRUM_HEIGHT_SP tall from tip to tail. Drawn by pass 5
 * (draw/passes/playingDirections.js): above the TAB staff when the track
 * has one (renderTabStrums, here), else above the notation staff. Takes no
 * horizontal room.
 */
import { group, path, svgD } from './svgUtil.js';
import { arrowheadDir } from './tab.js';
import { beatStrum } from '../directions.js';
import { trillRuns } from './trill.js';
import { flattenRuns, tabTopY, inkTopInSpan } from './passes/common.js';

const STRUM_HEIGHT_SP = 1.5;          // tip to tail, arrowhead included
const STRUM_HEAD_SP = 0.5;            // arrowhead length (half-width 0.6 of it = STRUM_HALF_SP)
export const STRUM_HALF_SP = 0.3;     // half the arrow's width
const STRUM_SHAFT_SHORT_SP = 0.4;     // shaft end -> tip (the shaft ends inside the arrowhead)
const STRUM_STROKE_WIDTH = 1.1;
// Above the TAB staff: bottom at least this far above its top line, and above the ink under the arrow.
const STRUM_TAB_STAFF_CLEAR_SP = 1;
const STRUM_TAB_CLEAR_SP = 0.4;

/**
 * Geometry of a strum arrow centred on `x` with its bottom at `bottomY`:
 * `{ x1, x2, top, bottom, tipY, tailY }` — the tip at the bottom ('down')
 * or the top ('up').
 */
export function strumGeometry(x, bottomY, kind, theme) {
  const sp = theme.staffLineSpacing;
  const top = bottomY - STRUM_HEIGHT_SP * sp;
  return {
    x1: x - STRUM_HALF_SP * sp, x2: x + STRUM_HALF_SP * sp, top, bottom: bottomY,
    tipY: kind === 'down' ? bottomY : top, tailY: kind === 'down' ? top : bottomY,
  };
}

/**
 * Draw a strum arrow (strumGeometry) in `<g class="strum strum-down|up">`:
 * the shaft from the tail to just inside the arrowhead, then the
 * arrowhead. Returns `{ top }`.
 */
export function renderStrum(g, x, bottomY, kind, color, theme) {
  const sp = theme.staffLineSpacing;
  const geo = strumGeometry(x, bottomY, kind, theme);
  const dir = kind === 'down' ? 1 : -1;
  const gEl = group({ class: `strum strum-${kind}` });
  gEl.appendChild(path(svgD`M ${x} ${geo.tailY} L ${x} ${geo.tipY - dir * STRUM_SHAFT_SHORT_SP * sp}`, {
    fill: 'none', stroke: color, 'stroke-width': STRUM_STROKE_WIDTH, 'stroke-linecap': 'butt',
  }));
  gEl.appendChild(arrowheadDir(x, geo.tipY, 0, dir, STRUM_HEAD_SP * sp, color));
  g.appendChild(gEl);
  return { top: geo.top };
}

/**
 * Strum arrows of `track` above its TAB staff (notation + TAB and tab-only
 * tracks): each strummed beat's own bottom is STRUM_TAB_STAFF_CLEAR_SP above
 * the top line and STRUM_TAB_CLEAR_SP above the beat's frets / marks and any
 * bend, "T", trill, dip, whammy line, technique label or hammer-on/pull-off
 * ink under the arrow (`run.tabInkBoxes`, `run.labelBoxes`, `run.hpBoxes`);
 * consecutive strummed beats on a system (graces between them allowed;
 * trillRuns) share the highest of their bottoms. In `run.tabG`, in the TAB
 * fret colour.
 */
export function renderTabStrums(trackRuns, track, theme) {
  const sp = theme.staffLineSpacing;
  const stringCount = track.tuning.length;
  const beats = [];
  flattenRuns(trackRuns, track, (layoutEl, run) => beats.push({ layoutEl, run, kind: beatStrum(layoutEl.el) }));
  const strummed = beats.filter((b) => b.kind);
  if (!strummed.length) return;
  strummed.forEach((b) => {
    const x = b.layoutEl.x;
    const inkTop = inkTopInSpan(x - STRUM_HALF_SP * sp, x + STRUM_HALF_SP * sp, {
      fretTopY: b.layoutEl.tabRendered?.fretTopY ?? Infinity,
      marksTopY: b.layoutEl.tabRendered?.marksTopY ?? Infinity,
      boxLists: [b.run.tabInkBoxes || [], b.run.labelBoxes || [], b.run.hpBoxes || []],
    });
    b.bottomY = Math.min(tabTopY(b.run, stringCount, theme) - STRUM_TAB_STAFF_CLEAR_SP * sp, inkTop - STRUM_TAB_CLEAR_SP * sp);
  });
  const runs = trillRuns(beats, (b) => !!b.kind, (b) => b.run.sysIdx, (b) => b.layoutEl.el.type === 'grace');
  strummed.forEach((b) => {
    const bottomY = Math.min(...runs.get(b).map((m) => m.bottomY));
    renderStrum(b.run.tabG, b.layoutEl.x, bottomY, b.kind, theme.tabFretColor, theme);
  });
}
