/**
 * draw/lyrics.js — lyrics under the staff (1.12.0, `beat.lyric`; parsed by
 * ../lyrics.js). Drawn by renderLyrics, a non-pass call between passes 5
 * and 6 (MusicScoreRenderer.js), so the dynamics line (pass 6), 8vb / 15mb
 * brackets and beat text below — which all measure the staff ink — move
 * below the lyrics, and only where there are lyrics.
 *
 * Per track run, into the notation group (else the TAB group, rhythm band
 * included) inside one `<g class="lyrics">`:
 * - verse v's baseline: the group's lowest ink right of the system header
 *   (measured before anything is drawn here) + LYRIC_INK_GAP_SP + the text
 *   ascent, then VERSE_STEP_EM × lyricFontSize per verse, so every verse of
 *   a track shares its baseline across the system;
 * - each syllable `<text class="lyric" data-verse="N">` (N 1-based) centred
 *   on its beat x, textFontFamily, lyricFontSize, noteColor;
 * - a hyphenated syllable: one `<text class="lyric-hyphen">-</text>`
 *   centred between its right edge and the next verse-N syllable's left
 *   edge (rests skipped); when that syllable is on a later system, between
 *   its right edge and this system's last barline, nothing on the next
 *   system; no next syllable → no hyphen;
 * - an extended syllable: `<line class="lyric-extender">` on the baseline
 *   from EXTENDER_GAP_SP right of the syllable to the right edge of the
 *   head of the last note beat before the next verse-N syllable, a rest
 *   (hidden ones too), a multi-measure rest or empty measure, or the end;
 *   split at system breaks (to the last barline, then from the next
 *   system's content start); a segment of length ≤ 0 is dropped.
 * Voice 1 only; widths are estimates (textMetrics.js). 8vb / 15mb
 * brackets and beat text below clear the whole band (lyricsBottom).
 */
import { lyricsOf } from '../lyrics.js';
import { group, line, text } from './svgUtil.js';
import { inkBounds, TEXT_ASCENT_EM } from '../layout/ink.js';
import { HEAD_HALF_SP } from './passes/common.js';
import { estimateTextWidth } from '../textMetrics.js';

const LYRIC_INK_GAP_SP = 0.8;  // lowest staff ink -> top of verse 1
const VERSE_STEP_EM = 1.3;     // verse n -> verse n + 1 baseline (x lyricFontSize)
const EXTENDER_GAP_SP = 0.2;   // syllable right edge -> extender start
const EXTENDER_STROKE_SP = 0.1;  // extender line width (1 px at the default 10 px staff space)

/**
 * Lowest ink of the lyrics band drawn into staff group `g` (its `<g
 * class="lyrics">`), or -Infinity without lyrics. Marks placed below the
 * staff after the lyrics by their own span's ink (8vb / 15mb brackets,
 * beat text below) also clear this, so they never sit in a verse row that
 * has no syllable under their span.
 */
export function lyricsBottom(g, theme) {
  const lg = g.children.find((c) => c.getAttribute && c.getAttribute('class') === 'lyrics');
  return lg ? inkBounds(lg, theme).bottom : -Infinity;
}

/** A track's voice-1 items in score order: note beats `{ le, run, syl }` and stops (`{ stop: true }`). */
function trackItems(trackRuns, track) {
  const items = [];
  trackRuns.filter((r) => r.track === track).forEach((run) => run.measures.forEach((measure) => {
    if (measure.multiRest || (measure.wholeRest && !measure.elements.length)) { items.push({ stop: true }); return; }
    measure.elements.forEach((le) => {
      if (le.el.type === 'grace') return;
      if (le.el.type !== 'note') { items.push({ stop: true }); return; }
      items.push({ le, run, syl: lyricsOf(le.el) });
    });
  }));
  return items;
}

/** The first item after index `i` with a verse-`v` syllable, or null (an index loop: no per-syllable array copies). */
function nextSyllable(items, i, v) {
  for (let j = i + 1; j < items.length; j++) if (items[j].syl?.[v]) return items[j];
  return null;
}

/**
 * The extender segments `{ run, x1, x2 }` of item `it` (index `i`, verse
 * `v`) starting at `x1`: to the head right edge of the last note item
 * before the next verse-`v` syllable / stop / end, split at system breaks
 * (to the last barline; whole intermediate systems; then from the content
 * start). `runAt` maps sysIdx → the track's run. Segments of length ≤ 0
 * are dropped.
 */
function extenderSegments(items, i, v, x1, runAt, systems, theme) {
  const s = theme.staffLineSpacing;
  const { run } = items[i];
  let last = items[i];
  for (let j = i + 1; j < items.length && !items[j].stop && !items[j].syl?.[v]; j++) last = items[j];
  const x2 = last.le.x + HEAD_HALF_SP * s;
  const segs = [];
  const seg = (r, a, b) => { if (r && b - a > 0) segs.push({ run: r, x1: a, x2: b }); };
  if (last.run.sysIdx === run.sysIdx) { seg(run, x1, x2); return segs; }
  seg(run, x1, systems[run.sysIdx].lastBarlineX);
  for (let k = run.sysIdx + 1; k < last.run.sysIdx; k++) seg(runAt.get(k), systems[k].contentStartX, systems[k].lastBarlineX);
  seg(last.run, systems[last.run.sysIdx].contentStartX, x2);
  return segs;
}

/**
 * What to draw, per track run (Map run → `{ syllables: [{ verse, x, text }],
 * hyphens: [{ verse, x }], extenders: [{ verse, x1, x2 }] }`, score order;
 * `verse` 0-based). Hyphens and extenders follow the module header.
 */
function collectLyricOps(score, trackRuns, theme, systems) {
  const s = theme.staffLineSpacing;
  const width = (t) => estimateTextWidth(t, theme.lyricFontSize);
  const ops = new Map();
  const opsOf = (run) => {
    if (!ops.has(run)) ops.set(run, { syllables: [], hyphens: [], extenders: [] });
    return ops.get(run);
  };
  score.tracks.forEach((track) => {
    const runAt = new Map(trackRuns.filter((r) => r.track === track).map((r) => [r.sysIdx, r]));
    const items = trackItems(trackRuns, track);
    items.forEach((it, i) => (it.syl || []).forEach((syl, verse) => {
      if (!syl) return;
      const { run, le } = it;
      const right = le.x + width(syl.text) / 2;
      opsOf(run).syllables.push({ verse, x: le.x, text: syl.text });
      if (syl.hyphen) {
        const next = nextSyllable(items, i, verse);
        if (!next) return;
        const end = next.run.sysIdx === run.sysIdx ? next.le.x - width(next.syl[verse].text) / 2 : systems[run.sysIdx].lastBarlineX;
        opsOf(run).hyphens.push({ verse, x: (right + end) / 2 });
        return;
      }
      if (!syl.extend) return;
      extenderSegments(items, i, verse, right + EXTENDER_GAP_SP * s, runAt, systems, theme)
        .forEach(({ run: r, x1, x2 }) => opsOf(r).extenders.push({ verse, x1, x2 }));
    }));
  });
  return ops;
}

/**
 * Draw the collected ops: per run one `<g class="lyrics">` in the
 * notation group (else TAB), baselines from the group's ink measured
 * before it; per verse its syllables, hyphens, then extenders.
 */
function drawLyricOps(ops, theme, systems) {
  const s = theme.staffLineSpacing;
  const size = theme.lyricFontSize;
  ops.forEach((o, run) => {
    const g = run.notationG ?? run.tabG;
    if (!g) return;
    const ink = inkBounds(g, theme, { xMin: systems[run.sysIdx].contentStartX });
    const bottom = Number.isFinite(ink.bottom) ? ink.bottom : (run.notationG ? run.notationBaselineY : run.tabBaselineY);
    const baseY = (v) => bottom + LYRIC_INK_GAP_SP * s + TEXT_ASCENT_EM * size + v * VERSE_STEP_EM * size;
    const textAttrs = (cls, v) => ({
      class: cls, 'data-verse': v + 1, 'font-family': theme.textFontFamily, 'font-size': size, 'text-anchor': 'middle', fill: theme.noteColor,
    });
    const lg = group({ class: 'lyrics' });
    const verses = [...new Set([...o.syllables, ...o.hyphens, ...o.extenders].map((op) => op.verse))].sort((a, b) => a - b);
    verses.forEach((verse) => {
      const y = baseY(verse);
      o.syllables.filter((op) => op.verse === verse).forEach((op) => lg.appendChild(text(op.x, y, op.text, textAttrs('lyric', verse))));
      o.hyphens.filter((op) => op.verse === verse).forEach((op) => lg.appendChild(text(op.x, y, '-', textAttrs('lyric-hyphen', verse))));
      o.extenders.filter((op) => op.verse === verse).forEach((op) => lg.appendChild(line(op.x1, y, op.x2, y, {
        class: 'lyric-extender', 'data-verse': verse + 1, stroke: theme.noteColor, 'stroke-width': EXTENDER_STROKE_SP * s, 'stroke-linecap': 'butt',
      })));
    });
    g.appendChild(lg);
  });
}

/**
 * Draw every track's lyrics (see the module header). `systems` are the
 * layout systems (contentStartX / lastBarlineX).
 */
export function renderLyrics(score, trackRuns, theme, systems) {
  drawLyricOps(collectLyricOps(score, trackRuns, theme, systems), theme, systems);
}
