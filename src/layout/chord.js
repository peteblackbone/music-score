/**
 * layout/chord.js — horizontal arrangement of one chord (or single note)
 * around its onset x (ui.md §7): notehead columns (seconds displaced to
 * the other side of the stem), accidental columns, ledger-line span, dot
 * column and stem x, plus the left/right extents the spacing
 * (layout/timeline.js) reserves. The same result is used for spacing and
 * for drawing (draw/notation.js), so the two cannot disagree.
 *
 * - Seconds: stem up → walk from the bottom, the upper note of a second
 *   goes right of the stem; stem down → walk from the top, the lower note
 *   goes left. Stemless (whole) notes use the stem-up rule.
 * - Accidentals: columns right to left starting 0.25 sp left of the
 *   leftmost notehead; placed top, bottom, 2nd from top, 2nd from bottom…
 *   each into the first column where it is ≥ 6 staff positions from every
 *   accidental already there (so top and bottom share column 1 when
 *   ≥ 6 apart). Column pitch ≥ 1.1 sp (wider for wide glyphs).
 * - Ledger lines: across all head columns, 0.3 sp beyond each side.
 * - Dots: first centre 0.5 sp right of the rightmost head column, further
 *   dots 0.5 sp apart; a note on a line puts its dot in the space above.
 * - Stem: at the notehead's SMuFL stem anchor (right edge when up, left
 *   edge when down).
 * - Mixed heads (per-note glyphs, e.g. diamonds): the widest head is the
 *   reference for the seconds offset and the stem; a narrower head shifts
 *   so its stem-side edge touches the stem (stemless chords: centred).
 *
 * All returned offsets are px relative to the onset x. Pure function, no DOM.
 */
import { glyphBox, stemAnchors } from '../glyphMetrics.js';
import { accidentalGlyph, flagForDuration } from '../glyphs.js';

export const DOT_GAP_SP = 0.5;            // head right edge -> first dot centre
export const DOT_STEP_SP = 0.5;           // between successive dot centres
export const DOT_RADIUS_SP = 0.17;
const ACC_HEAD_GAP_SP = 0.25;             // accidental column 1 -> leftmost notehead
const ACC_COLUMN_SP = 1.1;                // minimum column pitch
const ACC_COLUMN_GAP_SP = 0.1;            // min gap between a wide accidental and the next column
const ACC_CLEAR_POSITIONS = 6;            // accidentals this far apart (staff positions) may share a column
const LEDGER_OVERHANG_SP = 0.3;
export const GHOST_PAREN_DX_SP = 0.95;    // ghost-note parenthesis centre, from the head centre
export const GHOST_PAREN_SIZE_SP = 2.6;   // ghost-note parenthesis font size
export const GHOST_PAREN_BASELINE = 0.32; // parenthesis baseline below the head centre, as a fraction of its font size
const GHOST_PAREN_HALF_SP = 0.37;         // half the parenthesis width (GHOST_PAREN_SIZE_SP text)
export const ARPEGGIO_CLEAR_SP = 0.4;     // chord ink -> nearest arpeggio ink
export const ARPEGGIO_HALF_SP = 0.3;      // half the arpeggio mark's width (its arrowhead; the wave is ±0.25)
export const ARPEGGIO_ROOM_SP = 1.0;      // left room an arpeggio adds: CLEAR + 2 · HALF

/** Stem x offset (sp) from the head centre for a head glyph, up or down. */
export function stemDxSp(headGlyph, stemUp) {
  const box = glyphBox(headGlyph);
  const a = stemAnchors(headGlyph);
  const half = box.width / 2;
  if (!a) return stemUp ? half : -half;
  return stemUp ? a.up[0] - half : a.down[0] - half;
}

/** Stem attachment y offset (sp, y DOWN as in SVG) from the head centre. */
export function stemDySp(headGlyph, stemUp) {
  const a = stemAnchors(headGlyph);
  if (!a) return 0;
  return stemUp ? -a.up[1] : -a.down[1];
}

/** Leftmost notation ink of a chord (accidentals, parentheses, heads, ledger lines), px left of the onset x; 0 for null. */
export function arpeggioInnerLeft(chord) {
  return chord ? Math.max(chord.leftExt, -chord.ledgerSpan.left) : 0;
}

/** Staff position where a dot for a note at `pos` sits (the space above a line note). */
export function dotPosition(pos) {
  return ((pos % 2) + 2) % 2 === 0 ? pos + 1 : pos;
}

/**
 * @param {object[]} notes - the beat's notes
 * @param {number[]} positions - staff position of each note
 * @param {boolean} stemUp - final stem direction (beam group's, when beamed)
 * @param {(string|null)[]} accNames - accidental to draw per note (null = none)
 * @param {object} opts - `{ headGlyph, headGlyphs?, dots, duration, flagged }`:
 *   notehead glyph for the duration, optional per-note glyphs (falling back
 *   to `headGlyph`), dot count, and whether an unbeamed flag is drawn
 * @param {object} theme
 * @returns {{ stemUp, headWidth, stemGlyph, heads: {noteIndex,pos,dx,glyph,width}[],
 *   accidentals: {noteIndex,name,dx}[], dots: { dx, step, radius, positions: number[] },
 *   ledgerSpan: { left, right }, stemDx, leftExt, rightExt }}
 *   accidental `dx` is the glyph's left edge (draw text-anchor start).
 */
export function layoutChord(notes, positions, stemUp, accNames, opts, theme) {
  const s = theme.staffLineSpacing;
  // Per-note head glyphs (e.g. a diamond for a natural harmonic); the widest
  // is the reference for the seconds offset and the stem anchor.
  const glyphs = positions.map((_, i) => opts.headGlyphs?.[i] ?? opts.headGlyph);
  const widths = glyphs.map((g) => glyphBox(g).width);
  let ref = 0;
  widths.forEach((w, i) => { if (w > widths[ref]) ref = i; });
  const stemGlyph = glyphs.length ? glyphs[ref] : opts.headGlyph;
  const headW = glyphBox(stemGlyph).width;
  const stemless = opts.duration === 'whole';
  const walkUp = stemless || stemUp;

  // Notehead columns: 0 = normal side, ±headW = displaced across the stem.
  const order = positions.map((pos, i) => ({ i, pos })).sort((a, b) => (walkUp ? a.pos - b.pos : b.pos - a.pos));
  const dxSp = new Array(positions.length).fill(0);
  let prev = null;
  order.forEach((h) => {
    if (prev && Math.abs(h.pos - prev.pos) === 1 && dxSp[prev.i] === 0) {
      dxSp[h.i] = walkUp ? headW : -headW;
    }
    prev = h;
  });
  // A head narrower than the reference shifts so its stem-side edge touches the stem.
  const hdx = dxSp.map((d, i) => d + (stemless ? 0 : (d === 0 ? 1 : -1) * (stemUp ? 1 : -1) * (headW - widths[i]) / 2));
  const heads = positions.map((pos, i) => ({ noteIndex: i, pos, dx: hdx[i] * s, glyph: glyphs[i], width: widths[i] * s }));
  const headLeft = Math.min(...hdx.map((d, i) => d - widths[i] / 2));
  const headRight = Math.max(...hdx.map((d, i) => d + widths[i] / 2));

  // Accidental columns.
  const accs = accNames.map((name, i) => (name ? { i, name, pos: positions[i], w: glyphBox(accidentalGlyph(name)).width } : null))
    .filter(Boolean).sort((a, b) => b.pos - a.pos);
  const placeOrder = [];
  for (let lo = 0, hi = accs.length - 1; lo <= hi; lo++, hi--) {
    placeOrder.push(accs[lo]);
    if (hi !== lo) placeOrder.push(accs[hi]);
  }
  const columns = []; // [{ items: [], width }]
  placeOrder.forEach((a) => {
    let c = columns.findIndex((col) => col.items.every((b) => Math.abs(b.pos - a.pos) >= ACC_CLEAR_POSITIONS));
    if (c === -1) { columns.push({ items: [], width: 0 }); c = columns.length - 1; }
    columns[c].items.push(a);
    columns[c].width = Math.max(columns[c].width, a.w);
    a.col = c;
  });
  // Accidentals go left of a ghost note's parenthesis, not between it and the head.
  const ghostLeft = notes.some((n) => n.ghost) ? Math.min(...hdx, 0) - GHOST_PAREN_DX_SP - GHOST_PAREN_HALF_SP : headLeft;
  const colRight = [];
  let right = Math.min(headLeft, ghostLeft) - ACC_HEAD_GAP_SP;
  columns.forEach((col, c) => {
    colRight[c] = right;
    right -= Math.max(ACC_COLUMN_SP, col.width + ACC_COLUMN_GAP_SP);
  });
  const accidentals = accs.map((a) => ({ noteIndex: a.i, name: a.name, dx: (colRight[a.col] - a.w) * s }))
    .sort((a, b) => a.noteIndex - b.noteIndex);

  let leftExt = -headLeft * s;
  let rightExt = headRight * s;
  accidentals.forEach((a) => { leftExt = Math.max(leftExt, -a.dx); });
  if (notes.some((n) => n.ghost)) {
    leftExt = Math.max(leftExt, (-Math.min(...hdx, 0) + GHOST_PAREN_DX_SP + GHOST_PAREN_HALF_SP) * s);
    rightExt = Math.max(rightExt, (Math.max(...hdx, 0) + GHOST_PAREN_DX_SP + GHOST_PAREN_HALF_SP) * s);
  }
  const dotDx = (headRight + DOT_GAP_SP) * s;
  if (opts.dots) {
    rightExt = Math.max(rightExt, dotDx + (DOT_STEP_SP * (opts.dots - 1) + DOT_RADIUS_SP) * s);
  }
  const stemDx = stemless ? 0 : stemDxSp(stemGlyph, stemUp) * s;
  if (opts.flagged) {
    const flag = glyphBox(flagForDuration(opts.duration, stemUp) || '');
    rightExt = Math.max(rightExt, stemDx + flag.right * s);
  }
  const dotPositions = [...new Set(positions.map(dotPosition))].sort((a, b) => a - b);
  return {
    stemUp,
    headWidth: headW * s,
    stemGlyph,
    heads,
    accidentals,
    dots: { dx: dotDx, step: DOT_STEP_SP * s, radius: DOT_RADIUS_SP * s, positions: dotPositions },
    ledgerSpan: { left: (headLeft - LEDGER_OVERHANG_SP) * s, right: (headRight + LEDGER_OVERHANG_SP) * s },
    stemDx,
    leftExt,
    rightExt,
  };
}
