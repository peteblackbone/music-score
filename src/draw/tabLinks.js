/**
 * draw/tabLinks.js — the per-note TAB links of pass 3
 * (draw/passes/tabTechniques.js): hammer-on/pull-off, slide, slide in / out
 * and bend, drawn into each run's TAB group. Writes `run.hpBoxes` (hammer-on/pull-off ink)
 * and `run.tabInkBoxes` (bend ink). Lives outside draw/passes/ and imports
 * nothing from it: the pass hands in the run / break helpers it needs.
 */
import {
  renderHammerPull, renderSlide, renderSlideMark, renderBend, normalizeBend, bendSemitones, SLIDE_END_INSET_SP,
} from './tab.js';
import { renderCompoundBend } from './bend.js';
import { fretLabel, fretLabelWidth, tiedFretOpts } from '../textMetrics.js';
import { isNaturalHarmonic, decoratesFretLabel } from '../harmonics.js';
import { linkTarget, slideMarks, bendOf } from '../directions.js';
import { tabFretKnockoutHalf } from '../layout/tabRhythm.js';
import { trackHasTwoVoices, isTwoVoiceMeasure, voiceOf } from '../twoVoice.js';

const SLIDE_STUB_SP = 2;         // outgoing slide stroke across a system break (horizontal length)
const SLIDE_LABEL_CLEAR_SP = 0.2; // slide end -> edge of a wide (harmonic) fret-label knock-out
const TAB_SLIDE_MARK_SP = 1.5;   // slide-in / slide-out stroke (horizontal length) beside the fret label
const SLIDE_MARK_EDGE_SP = 0.3;  // ...never closer than this to the measure's barlines
const SLIDE_MARK_MIN_SP = 0.4;   // ...and skipped when clamping leaves less than this

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
 * `slideIn` / `slideOut` (directions.js slideMarks) are drawn on the note
 * itself: a TAB_SLIDE_MARK_SP diagonal rising into the fret label from
 * below ('below') or falling into it from above ('above'), or leaving it
 * downward / upward, on the string line; shortened so it stays
 * SLIDE_END_INSET_SP clear of the neighbouring notes' x, SLIDE_MARK_EDGE_SP
 * inside the measure and inside the system's break ends, and skipped when
 * less than SLIDE_MARK_MIN_SP is left.
 *
 * `bend` is drawn on the note itself (no target note needed):
 *
 * - `bend` (true | '1/4' | '1/2' | '1 1/2' | '2' | ... | { amount, release }):
 *   a curved arrow rising from the fret number labeled with the bend
 *   amount ("Full" for `true`/'full', otherwise the string as given).
 *   `release: true` (or the shorthand string ending in " release", e.g.
 *   `'full release'`) adds a second arrow curving back down, for a
 *   bend-and-release. Its width is limited by the next note on the system
 *   and by the system's last barline; a release fall (bend-and-release or
 *   release note) also ends short of the fret knock-out of a later note
 *   on the same system whose band its arrowhead would reach (in practice
 *   the string just above; tab.js bendGeometry).
 *   A compound bend ('full release full', 'pb 1/2 release 1/2' or
 *   `{ amount, rebend }`) rises, falls back and rises again, both amounts
 *   labelled (draw/bend.js); a release note after it defaults to the rebend.
 *   A pre-bend ('prebend …' / 'pb …' or
 *   `type: 'prebend'`) is a straight vertical arrow over the fret; a release
 *   note ('release [amount]' or `type: 'release'`) is only the falling
 *   arrow, its fret in parentheses, its amount defaulting to the last bend
 *   on the same string (see bendOf in directions.js).
 *
 * A note could in principle set more than one of these (rare in
 * practice); each is drawn independently off the same string-position
 * data.
 *
 * Two-voice measures link within each voice (flattenRuns' voice streams;
 * voice 2's notes as drawn on TAB, `tabEl`), while neighbour, next-note and
 * obstacle limits also look at the other voice's notes there.
 *
 * `helpers` are draw/passes/common.js's `{ flattenRuns, breakEndX,
 * breakStartX }`. Returns the track's TAB notes in score order
 * (`{ run, sysIdx, g, x, y, string, fret, ... }`; voice 1 in two-voice
 * measures), for the pass's per-beat marks.
 */
export function renderTabLinks(track, trackRuns, systems, theme, helpers) {
  const flat = collectTabNotes(track, trackRuns, theme, helpers.flattenRuns, 1);
  if (!trackHasTwoVoices(trackRuns, track)) {
    drawTabLinks(flat, [], () => true, systems, theme, helpers);
    return flat;
  }
  const flat2 = collectTabNotes(track, trackRuns, theme, helpers.flattenRuns, 2);
  drawTabLinks(flat, flat2.filter((c) => c.voice === 2), () => true, systems, theme, helpers);
  drawTabLinks(flat2, flat.filter((c) => isTwoVoiceMeasure(c.measure)), (item) => item.voice === 2, systems, theme, helpers);
  return flat;
}

/** The TAB notes of one voice stream of `track` in score order (see renderTabLinks). */
function collectTabNotes(track, trackRuns, theme, flattenRuns, voice) {
  const s = theme.staffLineSpacing;
  const stringCount = track.tuning.length;
  const flat = [];
  // A note's fret-label knock-out box (null without a fret), an obstacle for release falls.
  const knockHalf = tabFretKnockoutHalf(theme);
  const knockOf = (n, x, y, opts) => {
    if (n.fret == null) return null;
    const w = fretLabelWidth(fretLabel(n, opts), theme);
    return { x1: x - w / 2, x2: x + w / 2, top: y - knockHalf, bottom: y + knockHalf };
  };
  flattenRuns(trackRuns, track, (layoutEl, run, measure) => {
    const elDef = layoutEl.tabEl || layoutEl.el;
    const opts = tiedFretOpts(track, elDef); // the label drawn (a tied-to fret may be "(5)")
    const x = layoutEl.x - (layoutEl.dx || 0); // TAB has no clash shift
    (elDef.notes || []).forEach((n) => {
      if (n.string == null) return;
      const y = run.tabBaselineY - (stringCount - n.string) * theme.tabStaffLineSpacing;
      // A decorated harmonic label ("<12>", "5(17)"), a release note's "(7)" or a tied-to "(5)"
      // is wider than the default slide inset allows for: clear its knock-out instead.
      const slideInset = n.fret != null && (decoratesFretLabel(n) || bendOf(n.bend)?.type === 'release' || (opts && n.tieEnd && !n.mute))
        ? Math.max(SLIDE_END_INSET_SP * s, fretLabelWidth(fretLabel(n, opts), theme) / 2 + SLIDE_LABEL_CLEAR_SP * s)
        : SLIDE_END_INSET_SP * s;
      flat.push({
        run, sysIdx: run.sysIdx, g: run.tabG, x, y,
        string: n.string, fret: n.fret, hammerPull: n.hammerPull, slide: n.slide, bend: n.bend,
        naturalHarmonic: isNaturalHarmonic(n), slideInset,
        grace: elDef.type === 'grace', slideIn: n.slideIn, slideOut: n.slideOut, measure,
        knock: knockOf(n, x, y, opts),
        ...(voiceOf(layoutEl) ? { voice: voiceOf(layoutEl) } : {}),
      });
    });
  }, voice);
  return flat;
}

/**
 * Draw the links of the TAB notes `flat` (one voice stream) that start on
 * an item passing `startFilter`; `other` holds the other voice's notes,
 * which only limit lengths.
 */
function drawTabLinks(flat, other, startFilter, systems, theme, { breakEndX, breakStartX }) {
  const s = theme.staffLineSpacing;
  const marks = slideMarks(flat);
  const lastBendAmount = new Map(); // string -> amount of its latest bend / pre-bend, a release note's default
  const all = other.length ? flat.concat(other) : flat;
  // Nearest other note x on the item's system before (-1) / after (+1) it, or -/+Infinity.
  const neighbourX = (item, dir) => (dir < 0 ? Math.max : Math.min)(
    dir * Infinity, ...all.filter((c) => c.sysIdx === item.sysIdx && dir * (c.x - item.x) > 0).map((c) => c.x));
  const later = (item) => (c) => c.sysIdx === item.sysIdx && c.x > item.x;
  // A bend's width limit: the next note on the system, never past the system's
  // last barline (nor the other voice's next note).
  const bendNextX = (item, i) => {
    const next = flat.slice(i + 1).find(later(item))?.x;
    return other.length
      ? Math.min(next ?? Infinity, ...other.filter(later(item)).map((c) => c.x), systems[item.sysIdx].lastBarlineX)
      : Math.min(next ?? Infinity, systems[item.sysIdx].lastBarlineX);
  };

  flat.forEach((item, i) => {
    const { slideIn, slideOut } = marks[i];
    if (!item.hammerPull && !item.slide && !item.bend && !slideIn && !slideOut) return;
    if (!startFilter(item)) return;
    const target = flat[linkTarget(flat, i)];
    const sameSystem = target && target.sysIdx === item.sysIdx;
    const ascending = target && target.fret != null && item.fret != null ? target.fret > item.fret : true;
    const endX = breakEndX(systems, item.sysIdx, theme);

    if (slideIn) {
      const left = Math.max(neighbourX(item, -1) + SLIDE_END_INSET_SP * s, item.measure.contentX + SLIDE_MARK_EDGE_SP * s,
        breakStartX(systems, item.sysIdx, theme));
      const x1 = Math.max(item.x - item.slideInset - TAB_SLIDE_MARK_SP * s, left);
      if (item.x - item.slideInset - x1 >= SLIDE_MARK_MIN_SP * s) {
        renderSlideMark(item.g, x1, item.x, item.y, slideIn === 'below' ? 'up' : 'down', theme, 0, item.slideInset, `slide-in slide-in-${slideIn}`);
      }
    }

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

    if (slideOut) {
      const right = Math.min(neighbourX(item, 1) - SLIDE_END_INSET_SP * s, item.measure.endX - SLIDE_MARK_EDGE_SP * s, endX);
      const x2 = Math.min(item.x + item.slideInset + TAB_SLIDE_MARK_SP * s, right);
      if (x2 - item.x - item.slideInset >= SLIDE_MARK_MIN_SP * s) {
        renderSlideMark(item.g, item.x, x2, item.y, slideOut, theme, item.slideInset, 0, `slide-out slide-out-${slideOut}`);
      }
    }

    if (item.bend) {
      const bendInfo = normalizeBend(item.bend);
      if (bendInfo.rebend != null) {
        // A compound bend ends at its second bend: a later release note defaults to that amount.
        lastBendAmount.set(item.string, bendInfo.rebend);
        renderCompoundBend(item.g, item.x, item.y, bendInfo, theme, bendNextX(item, i))
          .forEach((b) => item.run.tabInkBoxes.push({ ...b, noteX: item.x }));
        return;
      }
      if (bendInfo.type === 'release' && bendInfo.amount == null) bendInfo.amount = lastBendAmount.get(item.string) ?? 'full';
      else if (bendInfo.type !== 'release') lastBendAmount.set(item.string, bendInfo.amount);
      const semitones = bendSemitones(bendInfo.amount);
      // Scale the arc's height to the bend amount (a "full" step is the
      // 1.0 baseline) so a half bend visibly reads as smaller than a
      // full one, instead of every amount drawing the same size arc.
      bendInfo.heightFrac = Math.max(0.55, Math.min(1.3, semitones / 2));
      const nextX = bendNextX(item, i);
      // The landing fret in parentheses is only meaningful for a bend
      // that's held at pitch with nothing else going on. A release
      // returns to the original pitch, and a "hold" bend sustains into
      // the next note (shown by the dashed tie instead), so neither
      // needs it — and both would collide with it anyway, since it
      // shares the same spot as their end-of-arc marks. A natural
      // harmonic's landing "fret" would be meaningless, so it has none; nor
      // does a pre-bend (already bent when picked) or a release note.
      const targetFret = item.fret != null && bendInfo.type === 'bend' && !bendInfo.release && !bendInfo.hold && !item.naturalHarmonic
        ? Math.round(item.fret + semitones) : null;
      // A release fall ends short of later fret labels its arrowhead would reach.
      const obstacles = bendInfo.release
        ? flat.slice(i + 1).concat(other).filter((c) => later(item)(c) && c.knock).map((c) => c.knock) : null;
      // Record its ink on the run (tagged with the note's x) for the technique-label pass.
      renderBend(item.g, item.x, item.y, bendInfo, theme, nextX, targetFret, obstacles)
        .forEach((b) => item.run.tabInkBoxes.push({ ...b, noteX: item.x }));
    }
  });
}
