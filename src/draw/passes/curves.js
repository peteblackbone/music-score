/**
 * draw/passes/curves.js — passes 1 and 2 (draw/passes.js): ties and slurs
 * (hammer-on / pull-off runs included), split across system breaks,
 * slide-in / slide-out lines, and grace-note slurs, drawn into each run's
 * notation group. Reads the rendered noteheads and stems; writes no run
 * fields. Tracks with two-voice measures get each of these per voice
 * (flattenRuns' voice streams): voice 1's ties and slurs above, voice 2's
 * below, each linking within its own voice.
 */
import { renderCurve, renderNoteSlide } from '../notation.js';
import { parsePitch, midiNumber } from '../../pitch.js';
import { slideMarks } from '../../directions.js';
import { flattenRuns, hasVoice2, breakEndX, breakStartX } from './common.js';
import { collectBeats, findSlurs } from './notationBeats.js';

const TIE_END_GAP_SP = 0.25;     // tie end beyond the notehead edge, and off its centre line
const GRACE_SLUR_CLEARANCE_SP = 0.6;
// Slide in / out: a NOTE_SLIDE_DX_SP x NOTE_SLIDE_DY_SP line NOTE_SLIDE_GAP_SP off the chord's extent,
// NOTE_SLIDE_CLEAR_SP clear of the neighbouring beats (rests / graces: NOTE_SLIDE_REST_EXT_SP each side) and the barlines.
const NOTE_SLIDE_DX_SP = 1.2;
const NOTE_SLIDE_DY_SP = 1;
const NOTE_SLIDE_GAP_SP = 0.2;
const NOTE_SLIDE_CLEAR_SP = 0.3;
const NOTE_SLIDE_REST_EXT_SP = 0.6;
const NOTE_SLIDE_MIN_SP = 0.4;   // skipped when clamping leaves a shorter line (horizontally)

/**
 * Draw an arc from `a` to `b` (`{ g, sysIdx, x, y }`), split into two
 * segments when they are in different systems. `draw(g, x1, y1, x2, y2, first)`
 * draws one segment (`first` = false for the continuation).
 */
function drawSplitArc(a, b, systems, theme, draw) {
  if (a.sysIdx === b.sysIdx) { draw(a.g, a.x, a.y, b.x, b.y, true); return; }
  draw(a.g, a.x, a.y, breakEndX(systems, a.sysIdx, theme), a.y, true);
  draw(b.g, breakStartX(systems, b.sysIdx, theme), b.y, b.x, b.y, false);
}

/**
 * Which side each notehead of a beat ties on (ui.md §7): a single note
 * opposite its stem; a chord's upper half above, lower half below, and the
 * middle note of an odd count opposite the stem; in a two-voice measure
 * (`voice` 1 | 2) all above for voice 1, all below for voice 2. Returns a
 * Map notehead → above (boolean).
 */
function tieSides(info, voice) {
  const heads = [...(info.noteheads || [])].sort((p, q) => p.position - q.position);
  if (voice) return new Map(heads.map((h) => [h, voice === 1]));
  const n = heads.length;
  const away = !info.stemUp; // opposite the stem: stem down -> above
  const sides = new Map();
  heads.forEach((h, r) => {
    let above;
    if (n === 1) above = away;
    else if (n % 2 === 0) above = r >= n / 2;
    else above = r === (n - 1) / 2 ? away : r > (n - 1) / 2;
    sides.set(h, above);
  });
  return sides;
}

/** Ties & slurs (per track; split across system breaks). */
export function renderTiesAndSlurs(score, trackRuns, theme, systems) {
  score.tracks.forEach((track) => {
    if (!track.showStandardNotation) return;
    (hasVoice2(trackRuns, track) ? [1, 2] : [1]).forEach((voice) => renderVoiceCurves(track, trackRuns, theme, systems, voice));
  });
}

/** Ties, slurs and slide-in / slide-out lines of one voice stream of a notation track. */
function renderVoiceCurves(track, trackRuns, theme, systems, voice) {
  const s = theme.staffLineSpacing;
  // One flat, ordered list of noteheads: { sysIdx, g, x, halfWidth, y, midi, tieStart, tieEnd, above, start }
  const flat = [];
  flattenRuns(trackRuns, track, (layoutEl, run) => {
    const info = layoutEl.rendered;
    if (!info || info.isRest || info.isGrace) return;
    const sides = tieSides(info, layoutEl.voice);
    const notes = layoutEl.el.notes || [];
    info.noteheads.forEach((h, i) => {
      const n = notes[i] || {};
      flat.push({
        sysIdx: run.sysIdx, g: run.notationG, x: h.x, halfWidth: h.halfWidth ?? 0.59 * s, y: h.y,
        midi: n.pitch != null ? midiNumber(parsePitch(n.pitch)) : null,
        tieStart: !!n.tieStart, tieEnd: !!n.tieEnd, above: sides.get(h), start: voice !== 2 || layoutEl.voice === 2,
      });
    });
  }, voice);
  // Ties: each tieStart to the next tieEnd with the same written MIDI number
  // (so enharmonic spellings still tie), opposite the stem.
  flat.forEach((item, i) => {
    if (!item.tieStart || !item.start) return;
    const target = flat.slice(i + 1).find((c) => c.midi === item.midi && c.tieEnd);
    if (!target) return;
    const dy = (item.above ? -1 : 1) * TIE_END_GAP_SP * s;
    drawSplitArc(
      { g: item.g, sysIdx: item.sysIdx, x: item.x + item.halfWidth + TIE_END_GAP_SP * s, y: item.y + dy },
      { g: target.g, sysIdx: target.sysIdx, x: target.x - target.halfWidth - TIE_END_GAP_SP * s, y: target.y + dy },
      systems, theme,
      (g, x1, y1, x2, y2) => renderCurve(g, x1, y1, x2, y2, item.above, theme, 'tie'),
    );
  });

  // Slurs: element-level, slurStart to the next slurEnd (and hammer-on /
  // pull-off runs, findSlurs), anchored to each end's own top (above) or
  // bottom (below) plus a clearance.
  const beats = collectBeats(trackRuns, track, theme, voice);
  findSlurs(beats, { auto: theme.hammerPullSlurs !== false, voice }).forEach(({ i, j, above, y1, y2 }) => {
    const a = beats[i]; const b = beats[j];
    drawSplitArc(
      { g: a.g, sysIdx: a.sysIdx, x: a.x, y: y1 },
      { g: b.g, sysIdx: b.sysIdx, x: b.x, y: y2 },
      systems, theme,
      (g, x1, y1, x2, y2) => renderCurve(g, x1, y1, x2, y2, above, theme, 'slur'),
    );
  });
  renderNoteSlides(track, trackRuns, theme, systems, voice);
}

/**
 * Slide-in / slide-out lines of a notation track (directions.js slideMarks
 * over its notes in score order). A slide-in rises from below ('below') or
 * falls from above ('above') to the notehead's height, ending
 * NOTE_SLIDE_GAP_SP left of the chord (accidentals included); a slide-out
 * leaves that far right of it (dots and flags included) downward / upward.
 * Shortened along its own slope to stay clear of the neighbouring beats on
 * the system, inside the measure and inside the break ends; skipped when
 * less than NOTE_SLIDE_MIN_SP is left. They take no room and record no ink.
 * Per voice stream: neighbours are the stream's; voice 2 marks only its own notes.
 */
function renderNoteSlides(track, trackRuns, theme, systems, voice) {
  const s = theme.staffLineSpacing;
  const beats = [];
  const notes = [];
  flattenRuns(trackRuns, track, (le, run, measure) => {
    const bi = beats.length;
    beats.push({ le, run, measure });
    (le.el.notes || []).forEach((n, k) => notes.push({
      bi, k, string: n.string, slide: n.slide, hammerPull: n.hammerPull, bend: n.bend,
      slideIn: n.slideIn, slideOut: n.slideOut, grace: le.el.type === 'grace',
    }));
  }, voice);
  const ext = (b, side) => (b.le.chord && b.le.el.type !== 'rest' && b.le.el.type !== 'grace'
    ? b.le.chord[side] : NOTE_SLIDE_REST_EXT_SP * s);
  const full = NOTE_SLIDE_DX_SP * s;
  slideMarks(notes).forEach(({ slideIn, slideOut }, ni) => {
    if (!slideIn && !slideOut) return;
    const { bi, k } = notes[ni];
    const { le, run, measure } = beats[bi];
    if (voice === 2 && le.voice !== 2) return;
    const h = le.rendered && !le.rendered.isRest ? le.rendered.noteheads?.[k] : null;
    if (!h) return;
    const prev = beats[bi - 1]?.run === run ? beats[bi - 1] : null;
    const next = beats[bi + 1]?.run === run ? beats[bi + 1] : null;
    if (slideIn) {
      const x2 = le.x - ext(beats[bi], 'leftExt') - NOTE_SLIDE_GAP_SP * s;
      const left = Math.max(prev ? prev.le.x + ext(prev, 'rightExt') + NOTE_SLIDE_CLEAR_SP * s : -Infinity,
        measure.contentX + NOTE_SLIDE_CLEAR_SP * s, breakStartX(systems, run.sysIdx, theme));
      const dx = Math.min(full, x2 - left);
      const dy = (slideIn === 'below' ? 1 : -1) * NOTE_SLIDE_DY_SP * s * (dx / full);
      if (dx >= NOTE_SLIDE_MIN_SP * s) renderNoteSlide(run.notationG, x2 - dx, h.y + dy, x2, h.y, `slide-in slide-in-${slideIn}`, theme);
    }
    if (slideOut) {
      const x1 = le.x + ext(beats[bi], 'rightExt') + NOTE_SLIDE_GAP_SP * s;
      const right = Math.min(next ? next.le.x - ext(next, 'leftExt') - NOTE_SLIDE_CLEAR_SP * s : Infinity,
        measure.endX - NOTE_SLIDE_CLEAR_SP * s, breakEndX(systems, run.sysIdx, theme));
      const dx = Math.min(full, right - x1);
      const dy = (slideOut === 'down' ? 1 : -1) * NOTE_SLIDE_DY_SP * s * (dx / full);
      if (dx >= NOTE_SLIDE_MIN_SP * s) renderNoteSlide(run.notationG, x1, h.y, x1 + dx, h.y + dy, `slide-out slide-out-${slideOut}`, theme);
    }
  });
}

/**
 * Grace notes carry no rhythmic value of their own — they're a quick
 * ornament that always resolves into the very next note. Auto-slur each
 * grace note to that next note (same system), on the notehead side (the
 * side away from the grace note's stem), so authors don't need to set
 * `slurStart`/`slurEnd` by hand just to get the expected visual link. In a
 * two-voice measure the next note is the grace's own voice's.
 */
export function renderGraceSlurs(score, trackRuns, theme) {
  const s = theme.staffLineSpacing;
  const c = GRACE_SLUR_CLEARANCE_SP * s;
  score.tracks.forEach((track) => {
    if (!track.showStandardNotation) return;
    (hasVoice2(trackRuns, track) ? [1, 2] : [1]).forEach((voice) => {
      const flat = [];
      flattenRuns(trackRuns, track, (layoutEl, run) => {
        const info = layoutEl.rendered;
        if (!info) return;
        flat.push({ sysIdx: run.sysIdx, g: run.notationG, x: layoutEl.x, info, start: voice !== 2 || layoutEl.voice === 2 });
      }, voice);
      renderStreamGraceSlurs(flat, c, theme);
    });
  });
}

/** Grace slurs of one stream (`flat`: rendered beats in order; `start`: may begin a slur). */
function renderStreamGraceSlurs(flat, c, theme) {
  const headYs = (info) => (info.noteheads || []).map((h) => h.y);
  flat.forEach((item, i) => {
    if (!item.info.isGrace || !item.start) return;
    const target = flat[i + 1];
    if (!target || target.sysIdx !== item.sysIdx || !headYs(target.info).length) return;
    const below = !!item.info.stemUp;
    const y1 = below ? Math.max(...headYs(item.info)) + c : Math.min(...headYs(item.info)) - c;
    const y2 = below ? Math.max(...headYs(target.info)) + c : Math.min(...headYs(target.info)) - c;
    renderCurve(item.g, item.x, y1, target.x, y2, !below, theme, 'slur');
  });
}
