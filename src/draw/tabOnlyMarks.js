/**
 * draw/tabOnlyMarks.js — articulations and fermatas above the TAB staff of
 * a tab-only track (1.11, opt-in with `track.tabArticulations === true`;
 * tracks that show notation keep theirs on the notation staff).
 *
 * Per TAB column (passes/common.js flattenTabColumns): voice 1 wins each
 * kind of mark; a mark only voice 2 has is drawn in voice 1's place (at the
 * column x). Articulations come from note beats only, fermatas from note
 * and rest beats; grace notes get neither.
 *
 * - renderTabOnlyArticulations (after pass 2, before pass 3): the marks of
 *   `normalizeArticulations` stacked upward in its order (nearest first),
 *   the first TAB_ARTIC_STAFF_CLEAR_SP above the TAB top line and clear of
 *   the column's frets and TAB tremolo / vibrato, then
 *   TAB_ARTIC_STACK_GAP_SP apart, in `<g class="tab-articulations">`. The
 *   column's `tabRendered.marksTopY` is raised to the stack top and the
 *   stack's box is recorded on `run.tabOnlyBoxes`, which pass 3 seeds
 *   `run.tabInkBoxes` with: tap marks, technique labels and pick strokes
 *   stack outside it; bends are drawn over it.
 * - renderTabOnlyFermatas (after pass 7, before beat text): the fermata
 *   (noteEffects.js fermataOf kinds) TAB_FERMATA_GAP_SP above the TAB top
 *   line and every ink already in the TAB group over its width, in
 *   `<g class="tab-fermata">` around renderFermata's group.
 */
import { group, glyphText } from './svgUtil.js';
import { Glyph } from '../glyphs.js';
import { glyphBox } from '../glyphMetrics.js';
import { smuflFontSizePx } from '../theme.js';
import { normalizeArticulations, renderFermata, fermataGlyph } from './notation.js';
import { fermataOf } from '../noteEffects.js';
import { inkBounds } from '../layout/ink.js';
import { key } from '../rational.js';
import { flattenTabColumns, tabTopY } from './passes/common.js';

const TAB_ARTIC_STAFF_CLEAR_SP = 0.5;
const TAB_ARTIC_FRET_CLEAR_SP = 0.3;   // above the column's frets and TAB tremolo / vibrato
const TAB_ARTIC_STACK_GAP_SP = 0.25;
const TAB_FERMATA_GAP_SP = 0.5;

const ABOVE = {
  staccato: Glyph.articStaccatoAbove, staccatissimo: Glyph.articStaccatissimoAbove, tenuto: Glyph.articTenutoAbove,
  accent: Glyph.articAccentAbove, marcato: Glyph.articMarcatoAbove,
};

/** Whether `track` draws articulations and fermatas on its TAB staff. */
export function hasTabOnlyMarks(track) {
  return track.tabArticulations === true && !!track.showTablature && !track.showStandardNotation;
}

const sameT = (a, b) => a.t && b.t && key(a.t) === key(b.t);

/**
 * Columns of `track` that carry a mark picked by `pick(el)` (null = none):
 * `[{ layoutEl, run, x, value }]`, voice 1 winning each column (see the header).
 */
export function tabOnlyColumns(trackRuns, track, pick) {
  const out = [];
  flattenTabColumns(trackRuns, track, (le, run, measure) => {
    if (le.el.type === 'grace') return;
    if (le.voice === 2) {
      // voice 2's own column: drawn only when voice 1 has no such mark at this onset
      const v1 = measure.elements.find((o) => o.el.type !== 'grace' && sameT(o, le));
      if (v1 && pick(v1.el) != null) return;
      const value = pick(le.el);
      if (value != null) out.push({ layoutEl: le, run, x: le.x - (le.dx || 0), value });
      return;
    }
    let value = pick(le.el);
    if (value == null && measure.elements2) {
      const v2 = measure.elements2.find((o) => !o.tabOwn && o.el.type !== 'grace' && sameT(o, le));
      if (v2) value = pick(v2.el);
    }
    if (value != null) out.push({ layoutEl: le, run, x: le.x, value });
  });
  return out;
}

const articulationsOf = (el) => {
  if (el.type !== 'note') return null;
  const marks = normalizeArticulations(el.articulations);
  return marks.length ? marks : null;
};
const fermataKind = (el) => (el.type === 'note' || el.type === 'rest' ? fermataOf(el.fermata) : null);

/** Articulations above the TAB staff of every tab-only track with `tabArticulations` (see the header). */
export function renderTabOnlyArticulations(score, trackRuns, theme) {
  const s = theme.staffLineSpacing;
  trackRuns.forEach((run) => { run.tabOnlyBoxes = []; });
  score.tracks.forEach((track) => {
    if (!hasTabOnlyMarks(track)) return;
    const fontSize = smuflFontSizePx(theme);
    tabOnlyColumns(trackRuns, track, articulationsOf).forEach(({ layoutEl, run, x, value }) => {
      const r = layoutEl.tabRendered || {};
      let bottom = Math.min(tabTopY(run, track.tuning.length, theme) - TAB_ARTIC_STAFF_CLEAR_SP * s,
        (r.fretTopY ?? Infinity) - TAB_ARTIC_FRET_CLEAR_SP * s, (r.marksTopY ?? Infinity) - TAB_ARTIC_FRET_CLEAR_SP * s);
      const first = bottom;
      let x1 = Infinity; let x2 = -Infinity;
      const gEl = group({ class: 'tab-articulations' });
      value.forEach((name) => {
        const box = glyphBox(ABOVE[name]);
        gEl.appendChild(glyphText(x, bottom + box.bottom * s, ABOVE[name], theme.fontFamily, fontSize, { fill: theme.tabFretColor, 'text-anchor': 'middle' }));
        x1 = Math.min(x1, x - (box.width / 2) * s);
        x2 = Math.max(x2, x + (box.width / 2) * s);
        bottom = bottom - (box.top - box.bottom) * s - TAB_ARTIC_STACK_GAP_SP * s;
      });
      run.tabG.appendChild(gEl);
      const top = bottom + TAB_ARTIC_STACK_GAP_SP * s;
      layoutEl.tabRendered = { ...r, marksTopY: Math.min(r.marksTopY ?? Infinity, top) };
      run.tabOnlyBoxes.push({ x1, x2, top, bottom: first, text: true });
    });
  });
}

/** Fermatas above the TAB staff of every tab-only track with `tabArticulations` (see the header). */
export function renderTabOnlyFermatas(score, trackRuns, theme) {
  const s = theme.staffLineSpacing;
  score.tracks.forEach((track) => {
    if (!hasTabOnlyMarks(track)) return;
    tabOnlyColumns(trackRuns, track, fermataKind).forEach(({ run, x, value }) => {
      const half = (glyphBox(fermataGlyph(value)).width / 2) * s;
      const ink = inkBounds(run.tabG, theme, { xMin: x - half, xMax: x + half, overlap: true }).top;
      const bottom = Math.min(tabTopY(run, track.tuning.length, theme), ink) - TAB_FERMATA_GAP_SP * s;
      const gEl = group({ class: 'tab-fermata' });
      renderFermata(gEl, x, bottom, theme, value);
      run.tabG.appendChild(gEl);
    });
  });
}
