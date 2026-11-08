/**
 * draw/passes/notationBeats.js — the rendered beats of a notation track in
 * score order with their slur anchors (collectBeats; it also reads
 * `run.chordBoxes`, written by renderChordSymbolsAndDynamics), the track's
 * slurs (findSlurs) and the lowest y a mark may reach above a beat
 * (beatClearTop). Shared by curves.js, playingDirections.js and
 * chordsFermatas.js. Reads only; draws nothing.
 */
import { elementTop, elementBottom } from '../notation.js';
import { vibratoClearSp } from '../noteMarks.js';
import { vibratoOf } from '../../noteEffects.js';
import { linkTarget } from '../../directions.js';
import { flattenRuns } from './common.js';

const SLUR_CLEARANCE_SP = 1.1;   // slur end -> note's top (above) / bottom (below)
const TUPLET_SLUR_CLEAR_SP = 0.9; // slur end above a tuplet bracket under it -> the bracket line

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
      voice: layoutEl.voice || 0,
    });
  }, voice);
  return beats;
}

/**
 * Slurs of a track: each `slurStart` beat to the next `slurEnd` beat and,
 * with `auto` (theme `hammerPullSlurs`, default on), one slur per run of
 * hammer-ons / pull-offs (hammerPullSpans). Returns `[{ i, j, above, y1,
 * y2 }]` (indices into `beats`; end heights, slurEnds), explicit slurs
 * first. With `voice` 2 (`beats` from collectBeats' voice-2 stream) only
 * slurs starting on a voice-2 beat count.
 */
export function findSlurs(beats, { auto = false, voice = 1 } = {}) {
  const out = [];
  const starts = (i) => voice !== 2 || beats[i].voice === 2;
  beats.forEach((item, i) => {
    if (!item.el.slurStart || !starts(i)) return;
    const j = beats.findIndex((c, k) => k > i && c.el.slurEnd);
    if (j === -1) return;
    out.push({ i, j, above: slurSide(beats, i, j) });
  });
  const explicit = out.map((sl) => ({ ...sl, ...slurEnds(beats, sl, false) }));
  return auto ? explicit.concat(hammerPullSpans(beats, out).filter((sl) => starts(sl.i)).map((sl) => ({ ...sl, ...slurEnds(beats, sl, true) }))) : explicit;
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
  if (beats.slice(i, j + 1).some((b) => b.voice)) return beats[i].voice !== 2;
  const dirs = beats.slice(i, j + 1)
    .filter((b) => b.info && !b.info.isRest && !b.info.isGrace && b.info.noteheads?.length)
    .map((b) => b.info.stemUp);
  return !(dirs.length && dirs.every((up) => up));
}

/**
 * Automatic slurs for hammer-ons / pull-offs: each `note.hammerPull` links
 * its beat to the beat of the next note on the same `string` (linkTarget,
 * as the TAB arc does; notes without a string never link). Links from or to
 * a grace note, or to a beat that isn't drawn as notes, are dropped;
 * overlapping links merge into one span; a span sharing a beat with an
 * explicit slur (`explicit`) is dropped. Returns `[{ i, j, above }]`.
 */
function hammerPullSpans(beats, explicit) {
  const items = [];
  beats.forEach((b, bi) => (b.el.notes || []).forEach((n) => {
    if (n.string != null) items.push({ bi, string: n.string, hammerPull: n.hammerPull, grace: b.el.type === 'grace' });
  }));
  const links = [];
  items.forEach((item, k) => {
    if (!item.hammerPull) return;
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
