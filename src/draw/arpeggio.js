/**
 * draw/arpeggio.js — the arpeggio mark: a vertical wavy line left of a
 * chord, spanning its noteheads (notation) or its fretted strings (TAB),
 * with an arrowhead at the top ('up') or the bottom ('down') and none for
 * `true`. Drawn per element by draw/system.js, right after the chord. The
 * room it needs is reserved by the timeline (layout/timeline.js), so the
 * line sits ARPEGGIO_CLEAR_SP left of the chord's leftmost ink.
 */
import { group, path, wavyPathDVertical } from './svgUtil.js';
import { arrowheadDir } from './tab.js';
import { arpeggioInnerLeft, ARPEGGIO_CLEAR_SP, ARPEGGIO_HALF_SP } from '../layout/chord.js';
import { tabExtents } from '../layout/timeline.js';

const ARPEGGIO_WAVE_AMP_SP = 0.25;
const ARPEGGIO_WAVE_LEN_SP = 0.8;
const ARPEGGIO_HEAD_SP = 0.5;       // arrowhead length (its half-width, 0.6 of it, is ARPEGGIO_HALF_SP)
const ARPEGGIO_SPAN_PAD_SP = 0.5;   // line end beyond the outermost notehead / string
const ARPEGGIO_STROKE_WIDTH = 1.1;

/**
 * Draw an arpeggio in `<g class="arpeggio[ arpeggio-up|down]">`: the wave
 * at `cx` from `y1` (top) to `y2` (bottom), its arrowhead tip at `y1`
 * ('up') or `y2` ('down'); `true` draws no head. The wave runs from the end
 * away from the head to the head's base. Returns `{ x1, x2, top, bottom }`.
 */
export function renderArpeggio(g, cx, y1, y2, kind, color, theme) {
  const sp = theme.staffLineSpacing;
  const head = ARPEGGIO_HEAD_SP * sp;
  const gEl = group({ class: kind === true ? 'arpeggio' : `arpeggio arpeggio-${kind}` });
  const [from, to] = kind === 'up' ? [y2, y1 + head] : kind === 'down' ? [y1, y2 - head] : [y1, y2];
  gEl.appendChild(path(wavyPathDVertical(cx, from, to, ARPEGGIO_WAVE_AMP_SP * sp, ARPEGGIO_WAVE_LEN_SP * sp), {
    fill: 'none', stroke: color, 'stroke-width': ARPEGGIO_STROKE_WIDTH, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  }));
  if (kind === 'up') gEl.appendChild(arrowheadDir(cx, y1, 0, -1, head, color));
  if (kind === 'down') gEl.appendChild(arrowheadDir(cx, y2, 0, 1, head, color));
  g.appendChild(gEl);
  const half = ARPEGGIO_HALF_SP * sp;
  return { x1: cx - half, x2: cx + half, top: y1, bottom: y2 };
}

/** Centre x of an arpeggio whose chord ink reaches `inner` px left of the beat x. */
function arpeggioX(x, inner, theme) {
  return x - inner - (ARPEGGIO_CLEAR_SP + ARPEGGIO_HALF_SP) * theme.staffLineSpacing;
}

/**
 * Arpeggio of a notation chord (`layoutEl` with `rendered` and `chord`):
 * left of its accidentals / parentheses / heads / ledger lines, from the
 * highest notehead − 0.5 sp to the lowest + 0.5 sp.
 */
export function renderNotationArpeggio(g, layoutEl, kind, theme) {
  const ys = (layoutEl.rendered?.noteheads || []).map((n) => n.y);
  if (!ys.length) return;
  const pad = ARPEGGIO_SPAN_PAD_SP * theme.staffLineSpacing;
  const cx = arpeggioX(layoutEl.x, arpeggioInnerLeft(layoutEl.chord), theme);
  renderArpeggio(g, cx, Math.min(...ys) - pad, Math.max(...ys) + pad, kind, theme.noteColor, theme);
}

/**
 * Arpeggio of a TAB chord (`layoutEl` with `tabBaselineY`): left of its
 * widest fret knock-out, over the strings of its fretted notes ± 0.5 sp;
 * nothing when no note has a string and fret.
 */
export function renderTabArpeggio(g, layoutEl, stringCount, kind, theme) {
  const ys = (layoutEl.el.notes || []).filter((n) => n.string != null && n.fret != null)
    .map((n) => layoutEl.tabBaselineY - (stringCount - n.string) * theme.tabStaffLineSpacing);
  if (!ys.length) return;
  const pad = ARPEGGIO_SPAN_PAD_SP * theme.staffLineSpacing;
  const cx = arpeggioX(layoutEl.x, tabExtents(layoutEl.el, theme).left, theme);
  renderArpeggio(g, cx, Math.min(...ys) - pad, Math.max(...ys) + pad, kind, theme.tabFretColor, theme);
}
