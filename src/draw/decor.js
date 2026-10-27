/**
 * draw/decor.js — system decorations that are not part of a measure's
 * content (ui.md §1, §2, §4): measure numbers, the tempo mark, the
 * system-start joining line, the notation+TAB bracket and horizontal
 * instrument names.
 *
 * Measure numbers and the tempo are drawn into a staff group before
 * vertical placement (local coordinates, top line at y = 0) so they count
 * towards its ink; joining line, bracket and names are drawn afterwards in
 * the system group, in absolute coordinates.
 */
import { text, line, rect, group } from './svgUtil.js';
import { NAME_SIZE_SP, NAME_GAP_SP, BRACKET_WIDTH_SP, systemHasBracket } from '../layout/systems.js';
import { estimateTextWidth } from '../textMetrics.js';

const MEASURE_NUMBER_SIZE_SP = 1.0;
const MEASURE_NUMBER_BASELINE_SP = 2; // above the top line of the top staff (clears the treble clef top, ~1.4 sp)
const TEMPO_SIZE_SP = 1.3;
const TEMPO_MIN_BASELINE_SP = 2.5;    // tempo baseline at least this far above the top line
const TEMPO_CLEARANCE_SP = 0.75;      // ... and this far above anything in the first measure
const BRACKET_THICK_SP = 0.5;
const BRACKET_GAP_SP = 0.5;           // bracket -> joining line
const BRACKET_HOOK_SP = 1;            // hooks reach this far right of the bracket's right edge
const BRACKET_HOOK_THICK_SP = 0.25;

/**
 * Measure number of a system's first measure, left edge at `x`, drawn into
 * the system's top staff group `g` (local coords, top line at y = 0).
 */
export function drawMeasureNumber(g, x, number, theme) {
  const s = theme.staffLineSpacing;
  g.appendChild(text(x, -MEASURE_NUMBER_BASELINE_SP * s, String(number), {
    class: 'measure-number',
    'font-family': theme.textFontFamily,
    'font-size': MEASURE_NUMBER_SIZE_SP * s,
    'font-style': 'italic',
    fill: theme.noteColor,
  }));
}

/** Estimated width in px of the tempo mark (bold, as drawn by drawTempo). */
export function tempoTextWidth(tempoText, theme) {
  return estimateTextWidth(tempoText, TEMPO_SIZE_SP * theme.staffLineSpacing, { bold: true });
}

/**
 * Tempo mark above system 1 (ui.md §1): left edge at `x` (the time
 * signature's x), bold, in the top staff group `g` (local coords).
 * `firstMeasureTop` is the top ink y of the first measure in that group;
 * the baseline is ≥ 2.5 sp above the top line and ≥ 0.75 sp above it.
 */
export function drawTempo(g, x, tempoText, firstMeasureTop, theme) {
  const s = theme.staffLineSpacing;
  const top = Number.isFinite(firstMeasureTop) ? firstMeasureTop : 0;
  const y = Math.min(-TEMPO_MIN_BASELINE_SP * s, top - TEMPO_CLEARANCE_SP * s);
  g.appendChild(text(x, y, tempoText, {
    class: 'tempo',
    'font-family': theme.textFontFamily,
    'font-size': TEMPO_SIZE_SP * s,
    'font-weight': 'bold',
    fill: theme.noteColor,
  }));
}

/**
 * Joining line, brackets and instrument names of one placed system.
 * `staves`: top to bottom `{ ti, kind, y (top line, absolute), lineBottom }`;
 * `system`: its layout (`startX`); `sysIdx` 0 for the first system.
 */
export function drawSystemDecor(systemG, system, sysIdx, staves, score, theme) {
  const s = theme.staffLineSpacing;
  if (!staves.length) return;
  const x = system.startX;
  const bottomOf = (st) => st.y + st.lineBottom;

  // Joining line: only with 2+ staves (a single staff has no initial barline).
  if (staves.length >= 2) {
    systemG.appendChild(line(x + theme.staffLineWidth / 2, staves[0].y, x + theme.staffLineWidth / 2, bottomOf(staves[staves.length - 1]), {
      class: 'system-join', stroke: theme.staffLineColor, 'stroke-width': theme.staffLineWidth,
    }));
  }

  // Per-track staff span.
  const tracks = new Map();
  staves.forEach((st) => {
    const t = tracks.get(st.ti) || { top: st.y, bottom: bottomOf(st), count: 0 };
    t.bottom = bottomOf(st); t.count++;
    tracks.set(st.ti, t);
  });

  // Bracket on a notation+TAB pair, only when the system holds 2+ instruments.
  const bracket = systemHasBracket(score);
  if (bracket) {
    tracks.forEach((t) => {
      if (t.count < 2) return;
      const right = x - BRACKET_GAP_SP * s;
      const left = right - BRACKET_THICK_SP * s;
      const hookT = BRACKET_HOOK_THICK_SP * s;
      const hookW = right + BRACKET_HOOK_SP * s - left;
      const gB = group({ class: 'bracket' });
      gB.appendChild(rect(left, t.top - hookT, BRACKET_THICK_SP * s, t.bottom - t.top + 2 * hookT, { fill: theme.staffLineColor }));
      gB.appendChild(rect(left, t.top - hookT, hookW, hookT, { fill: theme.staffLineColor }));
      gB.appendChild(rect(left, t.bottom, hookW, hookT, { fill: theme.staffLineColor }));
      systemG.appendChild(gB);
    });
  }

  // Instrument names: horizontal, right-aligned left of the system start
  // (and of the bracket), centred on the track's staves.
  const size = NAME_SIZE_SP * s;
  const nameRight = x - NAME_GAP_SP * s - (bracket ? BRACKET_WIDTH_SP * s : 0);
  tracks.forEach((t, ti) => {
    const track = score.tracks[ti];
    const str = sysIdx === 0 ? (track.name || track.label) : track.label;
    if (!str) return;
    systemG.appendChild(text(nameRight, (t.top + t.bottom) / 2 + 0.35 * size, str, {
      class: 'instrument-name',
      'font-family': theme.textFontFamily,
      'font-size': size,
      'text-anchor': 'end',
      fill: theme.noteColor,
    }));
  });
}
