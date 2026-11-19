/**
 * draw/passes/notationBeats.js — the rendered beats of a notation track in
 * score order with their slur anchors (collectBeats; it also reads
 * `run.chordBoxes`, written by renderChordSymbolsAndDynamics), the track's
 * slurs (findSlurs), the lowest y a mark may reach above a beat
 * (beatClearTop), the outer edge of the slurs drawn above each beat
 * (slurAboveCurves) with the height a mark clears them at (slurClearTop /
 * slurClearSpan; curveEdgeOver also below a curve) and the beam groups of a
 * track (beamGroupsOf). Shared by curves.js, playingDirections.js,
 * chordsFermatas.js and draw/voice2Marks.js. Reads only; draws nothing.
 */
import { elementTop, elementBottom, curveOuterPoints } from '../notation.js';
import { vibratoClearSp } from '../noteMarks.js';
import { vibratoOf } from '../../noteEffects.js';
import { linkTarget, isLegatoSlide } from '../../directions.js';
import { flattenRuns, breakEndX, breakStartX } from './common.js';
import { voiceOf } from '../../twoVoice.js';

const SLUR_CLEARANCE_SP = 1.1;   // slur end -> note's top (above) / bottom (below)
const TUPLET_SLUR_CLEAR_SP = 0.9; // slur end above a tuplet bracket under it -> the bracket line
// Marks above a slur (slurClearTop): this far above its outer edge where it crosses the mark (not the slur's apex).
const SLUR_DIRECTION_CLEAR_SP = 0.5;

/**
 * Every rendered beat of a notation track, in score order, with its slur
 * anchors; `voice` picks the stream (flattenRuns). `item.voice` is the
 * element's voice in a two-voice measure, else 0.
 */
export function collectBeats(trackRuns, track, theme, voice = 1) {
  const s = theme.staffLineSpacing;
  const beats = [];
  flattenRuns(trackRuns, track, (layoutEl, run) => {
    const info = layoutEl.rendered;
    const top = info ? elementTop(info) : Infinity;
    const bottom = info ? elementBottom(info) : -Infinity;
    beats.push({
      sysIdx: run.sysIdx, g: run.notationG, x: layoutEl.x, el: layoutEl.el, layoutEl, info, baselineY: run.notationBaselineY,
      chordBoxes: run.chordBoxes || [],
      topY: top,
      anchorAbove: (Number.isFinite(top) ? top : run.notationBaselineY - 4 * s) - SLUR_CLEARANCE_SP * s,
      anchorBelow: (Number.isFinite(bottom) ? bottom : run.notationBaselineY) + SLUR_CLEARANCE_SP * s,
      tupletAbove: info?.tupletY != null ? info.tupletY - TUPLET_SLUR_CLEAR_SP * s : Infinity,
      voice: voiceOf(layoutEl),
    });
  }, voice);
  return beats;
}

/**
 * Slurs of a track: each `slurStart` beat to the next `slurEnd` beat and,
 * with `auto` (theme `hammerPullSlurs`, default on), one slur per run of
 * hammer-ons / pull-offs, plus (always) legato slides (hammerPullSpans). Returns `[{ i, j, above, y1,
 * y2 }]` (indices into `beats`; end heights, slurEnds), explicit slurs
 * first. With `voice` 2 (`beats` from collectBeats' voice-2 stream) only
 * slurs starting on a voice-2 beat count.
 */
export function findSlurs(beats, { auto = false, voice = 1 } = {}) {
  const out = [];
  const starts = (i) => voice !== 2 || voiceOf(beats[i]) === 2;
  beats.forEach((item, i) => {
    if (!item.el.slurStart || !starts(i)) return;
    const j = beats.findIndex((c, k) => k > i && c.el.slurEnd);
    if (j === -1) return;
    out.push({ i, j, above: slurSide(beats, i, j) });
  });
  const explicit = out.map((sl) => ({ ...sl, ...slurEnds(beats, sl, false) }));
  return explicit.concat(hammerPullSpans(beats, out, auto).filter((sl) => starts(sl.i)).map((sl) => ({ ...sl, ...slurEnds(beats, sl, true) })));
}

/**
 * End heights `{ y1, y2 }` of slur `sl`: each end's anchor on its side.
 * With `clearTuplets` (hammer-on / pull-off slurs; explicit slurs keep
 * their 1.2.0 ends) a slur above also clears every tuplet bracket under it
 * on the same system as that end (both ends on one system share the
 * higher of the two).
 */
function slurEnds(beats, { i, j, above }, clearTuplets) {
  const a = beats[i]; const b = beats[j];
  if (!above) return { y1: a.anchorBelow, y2: b.anchorBelow };
  if (!clearTuplets) return { y1: a.anchorAbove, y2: b.anchorAbove };
  const tuplets = (sysIdx) => Math.min(...beats.slice(i, j + 1).filter((c) => c.sysIdx === sysIdx).map((c) => c.tupletAbove));
  if (a.sysIdx !== b.sysIdx) return { y1: Math.min(a.anchorAbove, tuplets(a.sysIdx)), y2: Math.min(b.anchorAbove, tuplets(b.sysIdx)) };
  const t = tuplets(a.sysIdx);
  return { y1: Math.min(a.anchorAbove, t), y2: Math.min(b.anchorAbove, t) };
}

/**
 * Side of a slur over beats i..j (ui.md §7): all stems up → below; all
 * down → above; mixed → above (stemless notes count with their notional
 * direction; rests and grace notes don't count). True = above. A slur
 * touching a two-voice measure takes its start beat's voice side: voice 2
 * below, otherwise above.
 */
function slurSide(beats, i, j) {
  if (beats.slice(i, j + 1).some(voiceOf)) return voiceOf(beats[i]) !== 2;
  const dirs = beats.slice(i, j + 1)
    .filter((b) => b.info && !b.info.isRest && !b.info.isGrace && b.info.noteheads?.length)
    .map((b) => b.info.stemUp);
  return !(dirs.length && dirs.every((up) => up));
}

/**
 * Automatic slurs for hammer-ons / pull-offs: with `auto`, each
 * `note.hammerPull` links its beat to the beat of the next note on the same
 * `string` (linkTarget, as the TAB arc does; notes without a string never
 * link); a legato slide (`slide: 'legato'`) links the same way even without
 * `auto`. Links from or to
 * a grace note, or to a beat that isn't drawn as notes, are dropped;
 * overlapping links merge into one span; a span sharing a beat with an
 * explicit slur (`explicit`) is dropped. Returns `[{ i, j, above }]`.
 */
function hammerPullSpans(beats, explicit, auto) {
  const items = [];
  beats.forEach((b, bi) => (b.el.notes || []).forEach((n) => {
    if (n.string != null) items.push({ bi, string: n.string, hammerPull: n.hammerPull, legato: isLegatoSlide(n.slide), grace: b.el.type === 'grace' });
  }));
  const links = [];
  items.forEach((item, k) => {
    if (!((auto && item.hammerPull) || item.legato)) return;
    const t = linkTarget(items, k);
    if (t < 0 || item.grace || items[t].grace || items[t].bi === item.bi) return;
    const info = beats[items[t].bi].info;
    if (!info || info.isRest) return;
    links.push({ i: item.bi, j: items[t].bi });
  });
  links.sort((a, b) => a.i - b.i);
  const merged = [];
  links.forEach((l) => {
    const cur = merged[merged.length - 1];
    if (cur && l.i <= cur.j) cur.j = Math.max(cur.j, l.j);
    else merged.push({ ...l });
  });
  return merged
    .filter((a) => !explicit.some((e) => a.i <= e.j && e.i <= a.j))
    .map(({ i, j }) => ({ i, j, above: slurSide(beats, i, j) }));
}

/**
 * Lowest y a mark may reach above a rendered beat (`item` from
 * collectBeats): 1 sp above the staff and the beat's own top, 2 sp above a
 * vibrato (2.3 sp above a wide one; vibratoClearSp), 2.8 sp above a stemless tremolo, 0.6 sp above a tuplet bracket,
 * and at most `slurY` — by default `item.slurLimit` (slurAboveLimits: under
 * no slur drawn above it, as for fermatas).
 */
export function beatClearTop(item, sp, slurY = item.slurLimit) {
  const { el, info } = item;
  const isStemless = !info.isRest && info.stemTopY == null;
  return Math.min(
    item.baselineY - sp * 4 - sp,
    item.topY - sp,
    el.vibrato && !info.isRest ? item.topY - sp * vibratoClearSp(vibratoOf(el.vibrato)) : Infinity,
    el.tremolo && isStemless ? item.topY - sp * 2.8 : Infinity,
    info.tupletY != null ? info.tupletY - sp * 0.6 : Infinity,
    slurY,
  );
}

/**
 * Outer edge (curveOuterPoints) of each slur segment drawn above a beat,
 * recorded as `slurCurves` on every beat of `beats` (from collectBeats)
 * under it, split slurs per segment — the slur geometry renderTiesAndSlurs
 * draws, for marks placed at the slur's local height (slurClearTop).
 */
export function slurAboveCurves(beats, systems, theme) {
  beats.forEach((b) => { b.slurCurves = []; });
  const over = (from, to, sysIdx, x1, y1, x2, y2) => {
    const pts = curveOuterPoints(x1, y1, x2, y2, true, theme, 'slur');
    for (let k = from; k <= to; k++) {
      if (beats[k].sysIdx === sysIdx) beats[k].slurCurves.push(pts);
    }
  };
  findSlurs(beats, { auto: theme.hammerPullSlurs !== false }).forEach(({ i, j, above, y1, y2 }) => {
    if (!above) return;
    const a = beats[i]; const b = beats[j];
    if (a.sysIdx === b.sysIdx) {
      over(i, j, a.sysIdx, a.x, y1, b.x, y2);
    } else {
      over(i, j, a.sysIdx, a.x, y1, breakEndX(systems, a.sysIdx, theme), y1);
      over(i, j, b.sysIdx, breakStartX(systems, b.sysIdx, theme), y2, b.x, y2);
    }
  });
}

/** Point [x, y] of the cubic Bézier `pts` at parameter `t`. */
function bezierAt(pts, t) {
  const u = 1 - t;
  const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return [0, 1].map((c) => w.reduce((acc, wk, k) => acc + wk * pts[k][c], 0));
}

/**
 * Highest (min) y of a slur's outer edge `pts` over the x span (xa, xb),
 * clipped to the slur's own span; Infinity when they don't overlap. With
 * `below` (a curve bowing down) the lowest (max) y, -Infinity when they
 * don't overlap. The curve's x rises monotonically (control points at
 * 0.28 / 0.72 of its length), so each sampled x is found by bisection on t.
 */
export function curveEdgeOver(pts, xa, xb, below = false) {
  const x1 = Math.max(xa, pts[0][0]);
  const x2 = Math.min(xb, pts[3][0]);
  if (x1 > x2) return below ? -Infinity : Infinity;
  const SAMPLES = 8;
  let edge = below ? -Infinity : Infinity;
  for (let k = 0; k <= SAMPLES; k++) {
    const x = x1 + ((x2 - x1) * k) / SAMPLES;
    let lo = 0; let hi = 1;
    for (let n = 0; n < 40; n++) {
      const mid = (lo + hi) / 2;
      if (bezierAt(pts, mid)[0] < x) lo = mid; else hi = mid;
    }
    const y = bezierAt(pts, (lo + hi) / 2)[1];
    edge = below ? Math.max(edge, y) : Math.min(edge, y);
  }
  return edge;
}

/**
 * Lowest y for the bottom of a mark centred on beat `item` and `half`
 * wide each side: SLUR_DIRECTION_CLEAR_SP above every slur in
 * `item.slurCurves` (slurAboveCurves) where it crosses the mark; Infinity
 * when no slur is drawn above the beat.
 */
export function slurClearTop(item, half, sp) {
  return slurClearSpan(item, item.x - half, item.x + half, sp);
}

/** Like slurClearTop for a mark spanning the x range (xa, xb) instead of centred on the beat. */
export function slurClearSpan(item, xa, xb, sp) {
  return Math.min(Infinity, ...(item.slurCurves || [])
    .map((pts) => curveEdgeOver(pts, xa, xb) - SLUR_DIRECTION_CLEAR_SP * sp));
}

/**
 * Beam group of each beamed layout element of `track` (groups of 2+
 * beats, per measure): a Map layoutEl -> group key (the group's index
 * array). `voice` 2: voice 2's groups of two-voice measures (`beamGroups2`).
 */
export function beamGroupsOf(trackRuns, track, voice = 1) {
  const out = new Map();
  trackRuns.filter((r) => r.track === track).forEach((run) => {
    run.measures.forEach((measure) => {
      const [groups, elements] = voice === 2 ? [measure.beamGroups2, measure.elements2] : [measure.beamGroups, measure.elements];
      (groups || []).forEach((grp) => {
        if (grp.length < 2) return;
        grp.forEach((idx) => {
          const le = elements.find((e) => e.index === idx);
          if (le) out.set(le, grp);
        });
      });
    });
  });
  return out;
}
