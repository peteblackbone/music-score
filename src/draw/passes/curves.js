/**
 * draw/passes/curves.js — passes 1 and 2 (draw/passes.js): ties and slurs,
 * split across system breaks, and grace-note slurs, drawn into each run's
 * notation group. Reads the rendered noteheads and stems; writes no run
 * fields.
 */
import { renderCurve } from '../notation.js';
import { parsePitch, midiNumber } from '../../pitch.js';
import { flattenRuns, breakEndX, breakStartX } from './common.js';
import { collectBeats, findSlurs } from './notationBeats.js';

const TIE_END_GAP_SP = 0.25;     // tie end beyond the notehead edge, and off its centre line
const GRACE_SLUR_CLEARANCE_SP = 0.6;

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
 * middle note of an odd count opposite the stem. Returns a Map
 * notehead → above (boolean).
 */
function tieSides(info) {
  const heads = [...(info.noteheads || [])].sort((p, q) => p.position - q.position);
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
  const s = theme.staffLineSpacing;
  score.tracks.forEach((track) => {
    if (!track.showStandardNotation) return;
    // One flat, ordered list of noteheads: { sysIdx, g, x, halfWidth, y, midi, tieStart, tieEnd, above }
    const flat = [];
    flattenRuns(trackRuns, track, (layoutEl, run) => {
      const info = layoutEl.rendered;
      if (!info || info.isRest || info.isGrace) return;
      const sides = tieSides(info);
      const notes = layoutEl.el.notes || [];
      info.noteheads.forEach((h, i) => {
        const n = notes[i] || {};
        flat.push({
          sysIdx: run.sysIdx, g: run.notationG, x: h.x, halfWidth: h.halfWidth ?? 0.59 * s, y: h.y,
          midi: n.pitch != null ? midiNumber(parsePitch(n.pitch)) : null,
          tieStart: !!n.tieStart, tieEnd: !!n.tieEnd, above: sides.get(h),
        });
      });
    });
    // Ties: each tieStart to the next tieEnd with the same written MIDI number
    // (so enharmonic spellings still tie), opposite the stem.
    flat.forEach((item, i) => {
      if (!item.tieStart) return;
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

    // Slurs: element-level, slurStart to the next slurEnd, anchored to each
    // end's own top (above) or bottom (below) plus a clearance.
    const beats = collectBeats(trackRuns, track, theme);
    findSlurs(beats).forEach(({ i, j, above }) => {
      const a = beats[i]; const b = beats[j];
      const key = above ? 'anchorAbove' : 'anchorBelow';
      drawSplitArc(
        { g: a.g, sysIdx: a.sysIdx, x: a.x, y: a[key] },
        { g: b.g, sysIdx: b.sysIdx, x: b.x, y: b[key] },
        systems, theme,
        (g, x1, y1, x2, y2) => renderCurve(g, x1, y1, x2, y2, above, theme, 'slur'),
      );
    });
  });
}

/**
 * Grace notes carry no rhythmic value of their own — they're a quick
 * ornament that always resolves into the very next note. Auto-slur each
 * grace note to that next note (same system), on the notehead side (the
 * side away from the grace note's stem), so authors don't need to set
 * `slurStart`/`slurEnd` by hand just to get the expected visual link.
 */
export function renderGraceSlurs(score, trackRuns, theme) {
  const s = theme.staffLineSpacing;
  const c = GRACE_SLUR_CLEARANCE_SP * s;
  score.tracks.forEach((track) => {
    if (!track.showStandardNotation) return;
    const flat = [];
    flattenRuns(trackRuns, track, (layoutEl, run) => {
      const info = layoutEl.rendered;
      if (!info) return;
      flat.push({ sysIdx: run.sysIdx, g: run.notationG, x: layoutEl.x, info });
    });
    const headYs = (info) => (info.noteheads || []).map((h) => h.y);
    flat.forEach((item, i) => {
      if (!item.info.isGrace) return;
      const target = flat[i + 1];
      if (!target || target.sysIdx !== item.sysIdx || !headYs(target.info).length) return;
      const below = !!item.info.stemUp;
      const y1 = below ? Math.max(...headYs(item.info)) + c : Math.min(...headYs(item.info)) - c;
      const y2 = below ? Math.max(...headYs(target.info)) + c : Math.min(...headYs(target.info)) - c;
      renderCurve(item.g, item.x, y1, target.x, y2, !below, theme, 'slur');
    });
  });
}
