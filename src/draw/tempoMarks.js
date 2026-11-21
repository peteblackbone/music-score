/**
 * draw/tempoMarks.js — tempo changes (`beat.tempo`, expression.js tempoOf;
 * ui.md "Tempo change"): optional bold text, a metronome note (with dots)
 * and "= N", drawn after navigation (MusicScoreRenderer.js, with the
 * tempoText of draw/decor.js drawTempo) so they are the outermost marks
 * above each system's top staff (notation or TAB).
 *
 * Tempo changes come from voice-1 main beats; at one onset (measure +
 * time) the first track that has one wins. Each starts at its beat's head
 * left edge; one at the score's first onset starts right of the
 * tempoText (or at the time signature without one) and shares its
 * baseline. A mark's baseline is at least MIN_BASELINE_SP above the top
 * line and CLEARANCE_SP (plus the text's descent) above the ink under it;
 * marks are placed left to right, so later ones clear earlier ones.
 */
import { group, glyphText, text } from './svgUtil.js';
import { TEMPO_SIZE_SP } from './decor.js';
import { inkBounds, TEXT_DESCENT_EM } from '../layout/ink.js';
import { estimateTextWidth } from '../textMetrics.js';
import { glyphBox } from '../glyphMetrics.js';
import { Glyph, metNoteGlyph } from '../glyphs.js';
import { smuflFontSizePx } from '../theme.js';
import { tempoOf, formatBpm } from '../expression.js';

const MIN_BASELINE_SP = 2.5;
const CLEARANCE_SP = 0.75;
const NOTE_SCALE = 0.6;          // metronome note size relative to the SMuFL size
const TEXT_GAP_SP = 0.5;         // tempo text -> metronome note; tempoText -> a first-onset mark
const DOT_GAP_SP = 0.15;         // note -> dot, dot -> dot
const BPM_GAP_SP = 0.3;          // note / dots -> "= N"
const HEAD_HALF_SP = 0.59;

/**
 * Tempo changes of every system (`drawn`: drawSystem results with their
 * `runs`): `[[{ x, tempo, first }]]` per system, left to right; `first` at
 * the score's first onset.
 */
export function tempoChanges(drawn) {
  const seen = new Set();
  return drawn.map((d) => {
    const out = [];
    d.runs.forEach((run) => run.measures.forEach((m) => m.elements.forEach((le) => {
      if (le.el.type === 'grace' || !le.t) return;
      const tempo = tempoOf(le.el.tempo);
      const k = `${m.measureIndex}|${le.t.n}/${le.t.d}`;
      if (!tempo || seen.has(k)) return;
      seen.add(k);
      out.push({ x: le.x, tempo, first: m.measureIndex === 0 && le.t.n === 0 });
    })));
    return out.sort((a, b) => a.x - b.x);
  });
}

/** Horizontal layout of a tempo-change mark starting at `left`: its parts' x and total width. */
function markLayout(tempo, left, theme) {
  const s = theme.staffLineSpacing;
  const size = TEMPO_SIZE_SP * s;
  const u = NOTE_SCALE * s; // px per glyph unit at the metronome size
  let x = left;
  const textX = x;
  if (tempo.text) x += estimateTextWidth(tempo.text, size, { bold: true }) + TEXT_GAP_SP * s;
  const note = metNoteGlyph(tempo.unit);
  const noteBox = glyphBox(note);
  const noteX = x - noteBox.left * u;
  x += noteBox.width * u;
  const dotBox = glyphBox('metAugmentationDot');
  const dotXs = [];
  for (let i = 0; i < tempo.dots; i++) {
    x += DOT_GAP_SP * s;
    dotXs.push(x - dotBox.left * u);
    x += dotBox.width * u;
  }
  x += BPM_GAP_SP * s;
  const bpm = `= ${formatBpm(tempo.bpm)}`;
  const bpmX = x;
  x += estimateTextWidth(bpm, size);
  return { textX, note, noteBox, noteX, dotXs, bpm, bpmX, width: x - left };
}

/** Own baseline of a mark spanning `left .. left + width` in `g`. */
function markBaseline(g, left, width, theme) {
  const s = theme.staffLineSpacing;
  const top = inkBounds(g, theme, { xMin: left, xMax: left + width, overlap: true }).top;
  return Math.min(-MIN_BASELINE_SP * s, (Number.isFinite(top) ? top : 0) - CLEARANCE_SP * s - TEXT_DESCENT_EM * TEMPO_SIZE_SP * s);
}

/** Draw a tempo-change mark laid out by markLayout on baseline `y`. */
function drawMark(g, tempo, lay, y, theme) {
  const s = theme.staffLineSpacing;
  const size = TEMPO_SIZE_SP * s;
  const u = NOTE_SCALE * s;
  const gg = group({ class: 'tempo-change' });
  const textAttrs = { 'font-family': theme.textFontFamily, 'font-size': size, fill: theme.noteColor };
  if (tempo.text) gg.appendChild(text(lay.textX, y, tempo.text, { class: 'tempo-change-text', ...textAttrs, 'font-weight': 'bold' }));
  // The note's ink bottom on the baseline; dots at the notehead's height (the glyph origin).
  const noteY = y + lay.noteBox.bottom * u;
  const fontSize = NOTE_SCALE * smuflFontSizePx(theme);
  gg.appendChild(glyphText(lay.noteX, noteY, lay.note, theme.fontFamily, fontSize, { class: 'tempo-change-note', fill: theme.noteColor }));
  lay.dotXs.forEach((dx) => gg.appendChild(glyphText(dx, noteY, Glyph.metAugmentationDot, theme.fontFamily, fontSize, {
    class: 'tempo-change-dot', fill: theme.noteColor,
  })));
  gg.appendChild(text(lay.bpmX, y, lay.bpm, { class: 'tempo-change-bpm', ...textAttrs }));
  g.appendChild(gg);
}

/**
 * A tempo change at the score's first onset, when there is a tempoText:
 * drawn into `topG` starting TEXT_GAP_SP right of the tempoText (whose
 * right edge is `tempoTextRight`), on one baseline shared with it — the
 * higher of the tempoText's own (`tempoY`) and the mark's. Returns that
 * baseline (the mark is then left out by renderTempoChanges), or undefined
 * when there is no such change (the tempoText keeps its own baseline).
 */
export function renderFirstTempoChange(topG, changes, tempoTextRight, tempoY, theme) {
  const first = (changes[0] || []).find((m) => m.first);
  if (!first) return undefined;
  const lay = markLayout(first.tempo, tempoTextRight + TEXT_GAP_SP * theme.staffLineSpacing, theme);
  const y = Math.min(tempoY, markBaseline(topG, lay.textX, lay.width, theme));
  drawMark(topG, first.tempo, lay, y, theme);
  first.done = true;
  return y;
}

/**
 * Every tempo change not drawn yet, left to right per system, into each
 * system's top staff group: from its beat's head left edge, or the time
 * signature's x for one at the score's first onset.
 */
export function renderTempoChanges(drawn, systems, changes, theme) {
  const s = theme.staffLineSpacing;
  drawn.forEach((d, sysIdx) => {
    if (!d.staves.length) return;
    const topG = d.staves[0].g;
    changes[sysIdx].filter((m) => !m.done).forEach((m) => {
      const left = m.first ? systems[sysIdx].header.timeX : m.x - HEAD_HALF_SP * s;
      const lay = markLayout(m.tempo, left, theme);
      drawMark(topG, m.tempo, lay, markBaseline(topG, left, lay.width, theme), theme);
    });
  });
}
