/**
 * draw/tabLinks.js — the per-note TAB links of pass 3
 * (draw/passes/tabTechniques.js): hammer-on/pull-off, slide and bend, drawn
 * into each run's TAB group. Writes `run.hpBoxes` (hammer-on/pull-off ink)
 * and `run.tabInkBoxes` (bend ink). Lives outside draw/passes/ and imports
 * nothing from it: the pass hands in the run / break helpers it needs.
 */
import {
  renderHammerPull, renderSlide, renderBend, normalizeBend, bendSemitones, SLIDE_END_INSET_SP,
} from './tab.js';
import { fretLabel, fretLabelWidth } from '../textMetrics.js';
import { isNaturalHarmonic, decoratesFretLabel } from '../harmonics.js';

const SLIDE_STUB_SP = 2;         // outgoing slide stroke across a system break (horizontal length)
const SLIDE_LABEL_CLEAR_SP = 0.2; // slide end -> edge of a wide (harmonic) fret-label knock-out

/**
 * Tab-only legato/slide/bend articulations of `track`.
 *
 * `hammerPull` and `slide` connect a note to the next note played on the
 * same string within the same track:
 *
 * - `hammerPull` (true | 'h' | 'p'): a small hammer-on/pull-off slur.
 *   `true` infers the direction from the fret numbers (ascending =
 *   hammer-on, descending = pull-off). Split across a system break, with
 *   the letter on the first segment only.
 * - `slide` (true | 'up' | 'down'): a diagonal slide stroke. `true`
 *   infers the direction the same way (ascending fret = slide up). Across
 *   a system break only a short outgoing stub (SLIDE_STUB_SP long) is
 *   drawn, never past 0.5 sp before the last barline.
 *
 * `bend` is drawn on the note itself (no target note needed):
 *
 * - `bend` (true | '1/4' | '1/2' | '1 1/2' | '2' | ... | { amount, release }):
 *   a curved arrow rising from the fret number labeled with the bend
 *   amount ("Full" for `true`/'full', otherwise the string as given).
 *   `release: true` (or the shorthand string ending in " release", e.g.
 *   `'full release'`) adds a second arrow curving back down, for a
 *   bend-and-release. Its width is limited by the next note on the system
 *   and by the system's last barline.
 *
 * A note could in principle set more than one of these (rare in
 * practice); each is drawn independently off the same string-position
 * data.
 *
 * `helpers` are draw/passes/common.js's `{ flattenRuns, breakEndX,
 * breakStartX }`. Returns the track's TAB notes in score order
 * (`{ run, sysIdx, g, x, y, string, fret, ... }`), for the pass's
 * per-beat marks.
 */
export function renderTabLinks(track, trackRuns, systems, theme, { flattenRuns, breakEndX, breakStartX }) {
  const s = theme.staffLineSpacing;
  const stringCount = track.tuning.length;
  const flat = [];
  flattenRuns(trackRuns, track, (layoutEl, run) => {
    const elDef = layoutEl.el;
    (elDef.notes || []).forEach((n) => {
      if (n.string == null) return;
      const y = run.tabBaselineY - (stringCount - n.string) * theme.tabStaffLineSpacing;
      // A decorated harmonic label ("<12>", "5(17)") is wider than the
      // default slide inset allows for: clear its knock-out instead.
      const slideInset = n.fret != null && decoratesFretLabel(n)
        ? Math.max(SLIDE_END_INSET_SP * s, fretLabelWidth(fretLabel(n), theme) / 2 + SLIDE_LABEL_CLEAR_SP * s)
        : SLIDE_END_INSET_SP * s;
      flat.push({
        run, sysIdx: run.sysIdx, g: run.tabG, x: layoutEl.x, y,
        string: n.string, fret: n.fret, hammerPull: n.hammerPull, slide: n.slide, bend: n.bend,
        naturalHarmonic: isNaturalHarmonic(n), slideInset,
      });
    });
  });

  flat.forEach((item, i) => {
    if (!item.hammerPull && !item.slide && !item.bend) return;
    const target = flat.slice(i + 1).find((c) => c.string === item.string);
    const sameSystem = target && target.sysIdx === item.sysIdx;
    const ascending = target && target.fret != null && item.fret != null ? target.fret > item.fret : true;
    const endX = breakEndX(systems, item.sysIdx, theme);

    if (item.hammerPull && target) {
      const raw = typeof item.hammerPull === 'string' ? item.hammerPull.toLowerCase() : '';
      let kind;
      if (['p', 'pull', 'pulloff', 'pull-off'].includes(raw)) kind = 'p';
      else if (['h', 'hammer', 'hammeron', 'hammer-on'].includes(raw)) kind = 'h';
      else kind = ascending ? 'h' : 'p';
      if (sameSystem) {
        item.run.hpBoxes.push(renderHammerPull(item.g, item.x, target.x, item.y, kind, theme));
      } else {
        // renderHammerPull insets each end by 0.3 sp; compensate so the split ends land 0.5 sp from barline/header.
        item.run.hpBoxes.push(renderHammerPull(item.g, item.x, endX + 0.3 * s, item.y, kind, theme, true));
        target.run.hpBoxes.push(renderHammerPull(target.g, breakStartX(systems, target.sysIdx, theme) - 0.3 * s, target.x, target.y, kind, theme, false));
      }
    }

    if (item.slide && target) {
      const raw = typeof item.slide === 'string' ? item.slide.toLowerCase() : '';
      let direction;
      if (['down', 'slidedown', 'slide-down'].includes(raw)) direction = 'down';
      else if (['up', 'slideup', 'slide-up'].includes(raw)) direction = 'up';
      else direction = ascending ? 'up' : 'down';
      // Across a break: only a short outgoing stub, starting just after the
      // fret number (renderSlide insets both ends by SLIDE_END_INSET_SP, or
      // the start by the note's wider slideInset), never past 0.5 sp before
      // the last barline.
      const stubEnd = Math.min(item.x + (2 * SLIDE_END_INSET_SP + SLIDE_STUB_SP) * s + (item.slideInset - SLIDE_END_INSET_SP * s),
        endX + SLIDE_END_INSET_SP * s);
      renderSlide(item.g, item.x, sameSystem ? target.x : stubEnd, item.y, direction, theme,
        item.slideInset, sameSystem ? target.slideInset : undefined);
    }

    if (item.bend) {
      const bendInfo = normalizeBend(item.bend);
      const semitones = bendSemitones(bendInfo.amount);
      // Scale the arc's height to the bend amount (a "full" step is the
      // 1.0 baseline) so a half bend visibly reads as smaller than a
      // full one, instead of every amount drawing the same size arc.
      bendInfo.heightFrac = Math.max(0.55, Math.min(1.3, semitones / 2));
      const next = flat.slice(i + 1).find((c) => c.sysIdx === item.sysIdx && c.x > item.x)?.x;
      // Never past the system's last barline.
      const nextX = Math.min(next ?? Infinity, systems[item.sysIdx].lastBarlineX);
      // The landing fret in parentheses is only meaningful for a bend
      // that's held at pitch with nothing else going on. A release
      // returns to the original pitch, and a "hold" bend sustains into
      // the next note (shown by the dashed tie instead), so neither
      // needs it — and both would collide with it anyway, since it
      // shares the same spot as their end-of-arc marks. A natural
      // harmonic's landing "fret" would be meaningless, so it has none.
      const targetFret = item.fret != null && !bendInfo.release && !bendInfo.hold && !item.naturalHarmonic
        ? Math.round(item.fret + semitones) : null;
      // Record its ink on the run (tagged with the note's x) for the technique-label pass.
      renderBend(item.g, item.x, item.y, bendInfo, theme, nextX, targetFret)
        .forEach((b) => item.run.tabInkBoxes.push({ ...b, noteX: item.x }));
    }
  });
  return flat;
}
