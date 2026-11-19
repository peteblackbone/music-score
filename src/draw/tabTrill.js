/**
 * draw/tabTrill.js — trills on the TAB staff for pass 3
 * (draw/passes/tabTechniques.js): plans each trill of a run of consecutive
 * trills (trillPlan) and draws the run at one level (renderTabTrillRun),
 * a trill tied forward over the columns of its tied notes and on later
 * systems (trill.js trillChainWaves).
 * Lives outside draw/passes/; the pass hands in its per-track state.
 */
import { beatTrill, trillTabFret } from '../directions.js';
import { trillEndX, trillRunEndX, trillGeometry, renderTrill, trillChainWaves, renderTrillContinuation } from './trill.js';
import { flattenRuns, tabTopY, inkTopInSpan, breakEndX } from './passes/common.js';
import { tabMarkBeat, voiceOf } from '../twoVoice.js';

// Trill "tr": bottom at least this far above the TAB top line and above the ink under it.
const TRILL_TAB_STAFF_CLEAR_SP = 0.4;
const TRILL_TAB_CLEAR_SP = 0.4;
// A neighbouring beat's tremolo / vibrato spans from this far left to this far right of its x (vibrato: 0.5 + up to 3.4 sp right).
const TRILL_MARKS_LEFT_SP = 0.5;
const TRILL_MARKS_REACH_SP = 4;
const FRET_HALF_SP = 1; // horizontal reach assumed for another beat's fret label when checking a trill's span

/**
 * Draw the trill run starting at TAB beat `beat` (a key of `ctx.runs`,
 * trillRuns' map): every trill of the run at the highest of their own
 * bottoms (trillPlan), its ink recorded on the run's `tabInkBoxes` (tagged
 * with the trill's x as `noteX`) and each trilled beat's wave top in
 * `ctx.trillTops`. A trill tied forward (tabChainWaves) runs over the
 * columns of its tied notes, which get its wave top in `ctx.trillTops` too
 * (so their T / golpe / dip stack above it), and continues on later systems
 * (coverTabChain). `ctx`: `{ runs, beats, flat, stringCount, systems,
 * theme, trillTops, track, trackRuns }` (renderTabArticulations' per-track
 * state).
 */
export function renderTabTrillRun(beat, ctx) {
  const { runs, beats, flat, stringCount, systems, theme, trillTops } = ctx;
  const waves = runs.get(beat).map((m) => tabChainWaves(m, ctx));
  const plans = runs.get(beat).map((m, i, all) => trillPlan(m, all[i + 1], beats, flat, stringCount, systems, theme, waves[i]?.endX));
  const bottomY = Math.min(...plans.map((pl) => pl.bottomY));
  plans.forEach((pl, i) => {
    const drawn = renderTrill(pl.run.tabG, pl.x, bottomY, pl.endX, theme.tabFretColor, theme, pl.suffix);
    drawn.boxes.forEach((b) => pl.run.tabInkBoxes.push({ ...b, noteX: pl.x }));
    trillTops.set(pl.beat, drawn.top);
    if (waves[i]) coverTabChain(waves[i], pl.run, drawn, ctx);
  });
}

/**
 * Voice `v`'s stream of `ctx.track` (flattenRuns), built once per context:
 * `{ items: [{ layoutEl, run, x }], els }`, `els` the beat elements (null
 * where voice 2's stream passes through a single-voice measure).
 */
function voiceStream(ctx, v) {
  ctx.streams ??= {};
  if (!ctx.streams[v]) {
    const items = [];
    flattenRuns(ctx.trackRuns, ctx.track, (layoutEl, run) => items.push({ layoutEl, run, x: layoutEl.x - (layoutEl.dx || 0) }), v);
    ctx.streams[v] = { items, els: items.map((it) => (v === 2 && voiceOf(it.layoutEl) !== 2 ? null : it.layoutEl.el)) };
  }
  return ctx.streams[v];
}

/**
 * trillChainWaves of the trill at TAB column `beat`, in the stream of the
 * voice that supplies it (voice 2 when tabMarkBeat picks voice 2's beat or
 * the column is voice 2's own), or null. A wave ends before the next voice-1
 * TAB note on its system.
 */
function tabChainWaves(beat, ctx) {
  const { layoutEl } = beat;
  const src = tabMarkBeat(layoutEl, 'trill');
  const v = src !== layoutEl.el || voiceOf(layoutEl) === 2 ? 2 : 1;
  const { items, els } = voiceStream(ctx, v);
  const at = items.findIndex((it) => (v === 2 ? voiceOf(it.layoutEl) === 2 && it.layoutEl.el === src : it.layoutEl === layoutEl));
  if (at < 0) return null;
  const nextX = (it) => ctx.flat.find((c) => c.sysIdx === it.run.sysIdx && c.x > it.x)?.x ?? Infinity;
  return trillChainWaves(items, at, els, { sysOf: (it) => it.run.sysIdx, xOf: (it) => it.x, nextX }, ctx.systems, ctx.theme);
}

/**
 * The covered columns of a tied-forward trill (`wv`, drawn as `drawn` on
 * `run`): those on its run get its wave top in `ctx.trillTops`; each later
 * system gets a continued wave clear of the TAB top line and the ink under
 * it (as a trill's own bottom), its boxes on that run's `tabInkBoxes` (no
 * `noteX`), and its columns that wave's top. Columns trilled themselves
 * keep their own trill.
 */
function coverTabChain(wv, run, drawn, ctx) {
  const { beats, stringCount, theme, trillTops } = ctx;
  const s = theme.staffLineSpacing;
  const cover = (items, top) => items.forEach((c) => beats
    .filter((b) => b.run === c.run && Math.abs(b.x - c.x) < 1e-6 && !beatTrill(tabMarkBeat(b.layoutEl, 'trill')))
    .forEach((b) => trillTops.set(b, top)));
  cover(wv.covered.filter((c) => c.run === run), drawn.waveTop ?? drawn.top);
  wv.conts.forEach(({ items, x1, x2 }) => {
    const r = items[0].run;
    const bottomY = Math.min(tabTopY(r, stringCount, theme) - TRILL_TAB_STAFF_CLEAR_SP * s, spanInk(r, x1, x2, beats, s) - TRILL_TAB_CLEAR_SP * s);
    const wave = renderTrillContinuation(r.tabG, x1, x2, bottomY, theme.tabFretColor, theme);
    if (!wave) return;
    wave.boxes.forEach((b) => r.tabInkBoxes.push(b));
    cover(items, wave.top);
  });
}

/**
 * Topmost ink under (x1, x2) on `run`: every bend / T / dip / H-P box drawn
 * so far, `own`'s frets and marks (the trill's own column, if any) and the
 * other columns' frets (within FRET_HALF_SP) and marks (TRILL_MARKS_LEFT_SP
 * left to TRILL_MARKS_REACH_SP right of their x).
 */
function spanInk(run, x1, x2, beats, s, own = null) {
  return Math.min(
    inkTopInSpan(x1, x2, {
      fretTopY: own?.tabRendered?.fretTopY ?? Infinity, marksTopY: own?.tabRendered?.marksTopY ?? Infinity,
      boxLists: [run.tabInkBoxes, run.hpBoxes],
    }),
    ...beats.filter((o) => o.run === run && o.layoutEl !== own).flatMap(({ layoutEl: ol, x: ox }) => [
      ox - FRET_HALF_SP * s < x2 && ox + FRET_HALF_SP * s > x1 ? (ol.tabRendered?.fretTopY ?? Infinity) : Infinity,
      ox - TRILL_MARKS_LEFT_SP * s < x2 && ox + TRILL_MARKS_REACH_SP * s > x1 ? (ol.tabRendered?.marksTopY ?? Infinity) : Infinity,
    ]),
  );
}

/**
 * A trill on TAB beat `beat` (from renderTabArticulations' `beats`) as it
 * would sit alone: `{ beat, run, x, endX, suffix, bottomY }`. The wave runs
 * to just before the next note on the system (and the run's next trill,
 * `nextTrill`, when there is one), or to `chainEndX` when the trill is tied
 * forward; "(n)" follows "tr" when the
 * other fret is known; `bottomY` clears the TAB top line and the ink under
 * the trill - the beat's frets and marks, nearby beats' frets and marks,
 * and every bend / T / dip / H-P box drawn so far in its span (spanInk).
 */
function trillPlan(beat, nextTrill, beats, flat, stringCount, systems, theme, chainEndX) {
  const s = theme.staffLineSpacing;
  const { layoutEl, run, x } = beat;
  const trilled = beatTrill(tabMarkBeat(layoutEl, 'trill'));
  const next = flat.find((c) => c.sysIdx === run.sysIdx && c.x > x)?.x;
  const endX = chainEndX ?? trillRunEndX(trillEndX(x, next ?? Infinity, breakEndX(systems, run.sysIdx, theme), theme), nextTrill?.x, theme);
  const fret = trillTabFret(trilled.note, trilled.trill);
  const suffix = fret != null ? `(${fret})` : null;
  const span = trillGeometry(x, 0, endX, theme, suffix);
  const inkTop = spanInk(run, span.x1, span.x2, beats, s, layoutEl);
  const bottomY = Math.min(tabTopY(run, stringCount, theme) - TRILL_TAB_STAFF_CLEAR_SP * s, inkTop - TRILL_TAB_CLEAR_SP * s);
  return { beat, run, x, endX, suffix, bottomY };
}
