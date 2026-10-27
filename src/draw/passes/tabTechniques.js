/**
 * draw/passes/tabTechniques.js — pass 3 (draw/passes.js): tab
 * hammer-on/pull-off, slide, bend, tap "T" and whammy dip, drawn into each
 * run's TAB group. Reads `layoutEl.tabRendered` (fret and mark tops);
 * writes `run.tabInkBoxes` (bend, "T" and dip ink) and `run.hpBoxes`
 * (hammer-on/pull-off ink) for passes 4 and 5.
 */
import {
  renderHammerPull, renderSlide, renderBend, techniqueLabelSize, normalizeBend, bendSemitones,
  SLIDE_END_INSET_SP, renderTapMark, renderWhammyDip, whammyDipGeometry,
} from '../tab.js';
import { TEXT_ASCENT_EM, TEXT_DESCENT_EM } from '../../layout/ink.js';
import { estimateTextWidth, fretLabel, fretLabelWidth } from '../../textMetrics.js';
import { isNaturalHarmonic, decoratesFretLabel } from '../../harmonics.js';
import { beatTaps, beatWhammy } from '../../directions.js';
import { flattenRuns, tabTopY, inkTopInSpan, breakEndX, breakStartX } from './common.js';

const SLIDE_STUB_SP = 2;         // outgoing slide stroke across a system break (horizontal length)
const SLIDE_LABEL_CLEAR_SP = 0.2; // slide end -> edge of a wide (harmonic) fret-label knock-out
// Tap "T" on the TAB staff: baseline at least this far above the top line, the beat's topmost fret label and its tremolo / vibrato.
const TAP_STAFF_CLEAR_SP = 0.4;
const TAP_FRET_CLEAR_SP = 0.4;
const TAP_MARK_CLEAR_SP = 0.3;
// ...and raised clear of a nearby hammer-on/pull-off letter: its box at least this far from the letter's knock-out (sideways, or above it).
const TAP_HP_CLEAR_SP = 0.5;
// Whammy dip: its tip at least WHAMMY_STAFF_CLEAR_SP above the TAB top line and WHAMMY_CLEAR_SP above the ink under it.
const WHAMMY_STAFF_CLEAR_SP = 0.5;
const WHAMMY_CLEAR_SP = 0.4;
const WHAMMY_FRET_HALF_SP = 1; // horizontal reach assumed for another beat's fret label when checking a dip's span

/**
 * Tab-only legato/slide/bend articulations.
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
 * Then, per beat (main note beats only; directions.js):
 *
 * - a tapped note (`note.tap`, not a tapped harmonic) puts one bold "T"
 *   above the beat, above the TAB top line, the beat's topmost fret label
 *   and its tab tremolo / vibrato, raised above any hammer-on/pull-off
 *   letter it would come within TAP_HP_CLEAR_SP of;
 * - `whammy` draws a dip ("V" plus "-1/2") above the TAB staff, its width
 *   limited like a bend's, stacked above the beat's frets, marks, "T" and
 *   any bend under it.
 *
 * Bend, tap "T" and whammy-dip ink boxes are recorded on the run
 * (`run.tabInkBoxes`, each tagged with its note's x as `noteX`),
 * hammer-ons/pull-offs theirs on `run.hpBoxes`, for the label and
 * directions passes.
 */
export function renderTabArticulations(score, trackRuns, theme, systems) {
  const s = theme.staffLineSpacing;
  trackRuns.forEach((run) => { run.tabInkBoxes = []; run.hpBoxes = []; });
  score.tracks.forEach((track) => {
    if (!track.showTablature) return;
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

    // Per beat, after every note mark: tap "T", then whammy dip. Their ink
    // boxes join the bend boxes, so technique labels (and later dips) clear them.
    const beats = [];
    flattenRuns(trackRuns, track, (layoutEl, run) => beats.push({ layoutEl, run }));
    beats.forEach(({ layoutEl, run }) => {
      const el = layoutEl.el;
      const x = layoutEl.x;
      const taps = beatTaps(el);
      const dip = beatWhammy(el);
      if (!taps && !dip) return;
      const tabTop = tabTopY(run, stringCount, theme);
      const fretTop = layoutEl.tabRendered?.fretTopY ?? Infinity;
      const marksTop = layoutEl.tabRendered?.marksTopY ?? Infinity;
      if (taps) {
        let baselineY = Math.min(tabTop - TAP_STAFF_CLEAR_SP * s, fretTop - TAP_FRET_CLEAR_SP * s, marksTop - TAP_MARK_CLEAR_SP * s);
        // Raise the T above any H/P letter its box comes within TAP_HP_CLEAR_SP of (lowest letter first, so a raise
        // that reaches a higher letter clears that one too).
        const size = techniqueLabelSize(theme);
        const half = estimateTextWidth('T', size, { bold: true }) / 2;
        const pad = TAP_HP_CLEAR_SP * s;
        run.hpBoxes.filter((b) => b.letter && b.letter.x1 < x + half + pad && b.letter.x2 > x - half - pad)
          .map((b) => b.letter).sort((a, b) => b.top - a.top)
          .forEach((l) => {
            if (l.top < baselineY + TEXT_DESCENT_EM * size + pad && l.bottom > baselineY - TEXT_ASCENT_EM * size - pad) {
              baselineY = l.top - pad - TEXT_DESCENT_EM * size;
            }
          });
        run.tabInkBoxes.push({ ...renderTapMark(run.tabG, x, baselineY, theme.tabFretColor, theme), noteX: x });
      }
      if (dip) {
        // Width limited like a bend's: the next note in the system, never past the last barline.
        const next = flat.find((c) => c.sysIdx === run.sysIdx && c.x > x)?.x;
        const nextX = Math.min(next ?? Infinity, systems[run.sysIdx].lastBarlineX);
        const span = whammyDipGeometry(x, 0, dip, theme, nextX).boxes;
        const sx1 = Math.min(...span.map((b) => b.x1));
        const sx2 = Math.max(...span.map((b) => b.x2));
        // Ink under the dip: this beat's frets and marks, nearby beats' frets, and every bend / T / dip box in its span.
        const inkTop = Math.min(
          inkTopInSpan(sx1, sx2, { fretTopY: fretTop, marksTopY: marksTop, boxLists: [run.tabInkBoxes] }),
          ...beats.filter((o) => o.run === run && o.layoutEl !== layoutEl
            && o.layoutEl.x - WHAMMY_FRET_HALF_SP * s < sx2 && o.layoutEl.x + WHAMMY_FRET_HALF_SP * s > sx1)
            .map((o) => o.layoutEl.tabRendered?.fretTopY ?? Infinity),
        );
        const bottomY = Math.min(tabTop - WHAMMY_STAFF_CLEAR_SP * s, inkTop - WHAMMY_CLEAR_SP * s);
        renderWhammyDip(run.tabG, x, bottomY, dip, theme, nextX)
          .forEach((b) => run.tabInkBoxes.push({ ...b, noteX: x }));
      }
    });
  });
}
