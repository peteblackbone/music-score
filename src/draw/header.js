/**
 * draw/header.js — the page header above the first system (ui.md §1).
 * Rows, top to bottom:
 *
 * 1. `score.title`, centred on the page, the largest text (2.4 sp);
 * 2. `score.subtitle`, centred, 1.6 sp;
 * 3. `score.artist`, centred, 1.4 sp;
 * 4. `score.album`, centred, 1.3 sp;
 * 5. credits: `score.tuningLabel` left-aligned at the left margin, italic,
 *    and `score.composer` right-aligned at the right margin, both 1.3 sp;
 * 6. credits: "Words by W" left and "Music by M" right (1.3 sp), or a
 *    single "Words & Music by M" on the right when `words` equals `music`;
 * 7. `score.instructions`, one left-aligned italic 1.2 sp line per text
 *    line, 1.6 sp apart;
 * 8. capo / tuning chart (scoreText.js capoTuningRows), one 1.2 sp line per
 *    track, 1.6 sp apart: "Name: Capo fret 2   ⑥ = D  ⑤ = A".
 *
 * Each row's first baseline sits 2.5 sp below the title's baseline, else
 * 2 sp below the previous row's last baseline (the first drawn row: its
 * cap height below the top margin). A row whose texts are missing takes no
 * space. Title, composer and tuning label are drawn as given; the other
 * texts are canonicalized (scoreText.js). The tempo mark is not part of the
 * header: it belongs to system 1 (draw/decor.js drawTempo).
 */
import { group, text } from './svgUtil.js';
import { estimateTextWidth } from '../textMetrics.js';
import { canonicalText, canonicalLines, capoTuningRows } from '../scoreText.js';

const TITLE_SIZE_SP = 2.4;
const SUBTITLE_SIZE_SP = 1.6;
const ARTIST_SIZE_SP = 1.4;
const ALBUM_SIZE_SP = 1.3;
const CREDITS_SIZE_SP = 1.3;
const INSTRUCTIONS_SIZE_SP = 1.2;
const LINE_STEP_SP = 1.6;         // instructions / tuning chart: baseline -> next line's baseline
const BELOW_TITLE_SP = 2.5;       // title baseline -> next row's baseline
const BELOW_ROW_SP = 2.0;         // other rows
const CAPO_GAP_SP = 1.5;          // "Capo fret N" -> first tuning entry
const ENTRY_GAP_SP = 1.0;         // tuning entry -> next entry
const CAP_HEIGHT = 0.75;          // first baseline sits this many font sizes below the top margin

/**
 * Append the score header (if any of its rows has text) to `svg`; `top` is
 * the top margin y, `width` the page width. Returns the last baseline, or
 * null when nothing was drawn.
 */
export function drawScoreHeader(svg, score, theme, top, width) {
  const s = theme.staffLineSpacing;
  const font = theme.textFontFamily;
  const left = theme.marginLeftSp * s;
  const right = width - theme.marginRightSp * s;
  const rows = []; // { size, isTitle, step, lines: [(g, y) => void] }
  const addRow = (size, lines, step = 0, isTitle = false) => { if (lines.length) rows.push({ size, isTitle, step, lines }); };
  const centred = (str, size, cls) => (g, y) => g.appendChild(text(width / 2, y, str, {
    class: cls, 'font-family': font, 'font-size': size * s, 'text-anchor': 'middle', fill: theme.noteColor,
  }));
  const atLeft = (str, size, cls, italic) => (g, y) => g.appendChild(text(left, y, str, {
    class: cls, 'font-family': font, 'font-size': size * s, ...(italic ? { 'font-style': 'italic' } : {}), fill: theme.noteColor,
  }));
  const atRight = (str, size, cls) => (g, y) => g.appendChild(text(right, y, str, {
    class: cls, 'font-family': font, 'font-size': size * s, 'text-anchor': 'end', fill: theme.noteColor,
  }));
  const both = (...draws) => (g, y) => draws.forEach((d) => d && d(g, y));

  if (score.title) addRow(TITLE_SIZE_SP, [centred(score.title, TITLE_SIZE_SP, 'title')], 0, true);
  const subtitle = canonicalText(score.subtitle);
  if (subtitle) addRow(SUBTITLE_SIZE_SP, [centred(subtitle, SUBTITLE_SIZE_SP, 'subtitle')]);
  const artist = canonicalText(score.artist);
  if (artist) addRow(ARTIST_SIZE_SP, [centred(artist, ARTIST_SIZE_SP, 'artist')]);
  const album = canonicalText(score.album);
  if (album) addRow(ALBUM_SIZE_SP, [centred(album, ALBUM_SIZE_SP, 'album')]);
  if (score.composer || score.tuningLabel) {
    addRow(CREDITS_SIZE_SP, [both(
      score.tuningLabel && atLeft(score.tuningLabel, CREDITS_SIZE_SP, 'tuning', true),
      score.composer && atRight(score.composer, CREDITS_SIZE_SP, 'composer'),
    )]);
  }
  const words = canonicalText(score.words);
  const music = canonicalText(score.music);
  if (words && words === music) {
    addRow(CREDITS_SIZE_SP, [atRight(`Words & Music by ${music}`, CREDITS_SIZE_SP, 'words-music')]);
  } else if (words || music) {
    addRow(CREDITS_SIZE_SP, [both(
      words && atLeft(`Words by ${words}`, CREDITS_SIZE_SP, 'words', false),
      music && atRight(`Music by ${music}`, CREDITS_SIZE_SP, 'music'),
    )]);
  }
  const instructions = canonicalLines(score.instructions) || [];
  addRow(INSTRUCTIONS_SIZE_SP, instructions.map((l) => atLeft(l, INSTRUCTIONS_SIZE_SP, 'instructions', true)), LINE_STEP_SP);
  addRow(INSTRUCTIONS_SIZE_SP, capoTuningRows(score).map((r) => (g, y) => drawTuningLine(g, r, left, y, theme)), LINE_STEP_SP);

  if (!rows.length) return null;
  const headerG = group({ class: 'score-header' });
  let last = null;
  let prev = null;
  for (const row of rows) {
    row.lines.forEach((draw, i) => {
      if (i > 0) last += row.step * s;
      else if (last == null) last = top + CAP_HEIGHT * row.size * s;
      else last += (prev.isTitle ? BELOW_TITLE_SP : BELOW_ROW_SP) * s;
      draw(headerG, last);
    });
    prev = row;
  }
  svg.appendChild(headerG);
  return last;
}

/** One capo / tuning chart line: `<g class="tuning-chart">` of texts laid out by estimated widths. */
function drawTuningLine(headerG, row, x0, y, theme) {
  const s = theme.staffLineSpacing;
  const size = INSTRUCTIONS_SIZE_SP * s;
  const pieces = [...(row.capo ? [row.capo] : []), ...row.entries];
  if (row.name) pieces[0] = `${row.name}: ${pieces[0]}`;
  const g = group({ class: 'tuning-chart' });
  let x = x0;
  pieces.forEach((str, i) => {
    g.appendChild(text(x, y, str, { 'font-family': theme.textFontFamily, 'font-size': size, fill: theme.noteColor }));
    x += estimateTextWidth(str, size) + (i === 0 && row.capo ? CAPO_GAP_SP : ENTRY_GAP_SP) * s;
  });
  headerG.appendChild(g);
}
