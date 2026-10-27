/**
 * glyphMetrics.js — approximate bounding boxes and stem anchors for the
 * SMuFL glyphs the renderer draws, in staff spaces (sp), SMuFL orientation
 * (x right, y UP, origin = the glyph's drawing origin).
 *
 * Values are transcribed (rounded, approximate) from Bravura's
 * bravura_metadata.json (SIL Open Font License); a few rarely used glyphs
 * are estimated and padded outward. They are used for horizontal spacing
 * before anything is drawn (layout) and for vertical ink extents after
 * drawing (layout/ink.js), because the test DOM has no getBBox. Exactness
 * is not required: a box slightly too big only adds a little space.
 *
 * Entry: { bBoxNE: [x, y], bBoxSW: [x, y], stemUpSE?: [x, y], stemDownNW?: [x, y] }
 */
import { Glyph } from './glyphs.js';

export const GLYPH_BOX = {
  // Clefs
  gClef: { bBoxNE: [2.684, 4.392], bBoxSW: [0, -2.632] },
  cClef: { bBoxNE: [2.796, 2.024], bBoxSW: [0, -2.024] },
  fClef: { bBoxNE: [2.736, 1.048], bBoxSW: [0, -2.54] },
  gClef8vb: { bBoxNE: [2.684, 4.392], bBoxSW: [0, -3.56] },
  fClef8vb: { bBoxNE: [2.736, 1.048], bBoxSW: [0, -3.44] },
  tabClef6: { bBoxNE: [1.632, 3.12], bBoxSW: [0, -3.12] }, // aspect ratio only (scaled to the staff)
  tabClef4: { bBoxNE: [1.632, 2.12], bBoxSW: [0, -2.12] },

  // Noteheads
  noteheadDoubleWhole: { bBoxNE: [2.2, 0.564], bBoxSW: [0, -0.564] },
  noteheadWhole: { bBoxNE: [1.688, 0.532], bBoxSW: [0, -0.532] },
  noteheadHalf: { bBoxNE: [1.18, 0.5], bBoxSW: [0, -0.5], stemUpSE: [1.18, 0.172], stemDownNW: [0, -0.172] },
  noteheadBlack: { bBoxNE: [1.18, 0.5], bBoxSW: [0, -0.5], stemUpSE: [1.18, 0.168], stemDownNW: [0, -0.168] },
  noteheadXBlack: { bBoxNE: [1.16, 0.5], bBoxSW: [0, -0.5], stemUpSE: [1.16, 0.0], stemDownNW: [0, 0.0] },
  noteheadDiamondWhole: { bBoxNE: [1.08, 0.5], bBoxSW: [0, -0.5] },
  noteheadDiamondHalf: { bBoxNE: [1.004, 0.5], bBoxSW: [0, -0.5], stemUpSE: [1.004, 0], stemDownNW: [0, 0] },
  noteheadDiamondBlack: { bBoxNE: [1.0, 0.5], bBoxSW: [0, -0.5], stemUpSE: [1.0, 0], stemDownNW: [0, 0] },

  // Rests
  restDoubleWhole: { bBoxNE: [0.5, 1.0], bBoxSW: [0, 0] },
  restWhole: { bBoxNE: [1.128, 0.036], bBoxSW: [0, -0.54] },
  restHalf: { bBoxNE: [1.128, 0.568], bBoxSW: [0, -0.008] },
  restQuarter: { bBoxNE: [1.08, 1.492], bBoxSW: [0, -1.5] },
  rest8th: { bBoxNE: [0.988, 0.696], bBoxSW: [0, -1.004] },
  rest16th: { bBoxNE: [1.28, 0.716], bBoxSW: [0, -2.0] },
  rest32nd: { bBoxNE: [1.452, 1.704], bBoxSW: [0, -2.0] },
  rest64th: { bBoxNE: [1.692, 1.72], bBoxSW: [0, -3.0] },

  // Flags (origin at the stem end)
  flag8thUp: { bBoxNE: [1.056, 0.03], bBoxSW: [0, -3.24] },
  flag8thDown: { bBoxNE: [1.224, 3.236], bBoxSW: [0, -0.04] },
  flag16thUp: { bBoxNE: [1.116, 0.01], bBoxSW: [0, -3.252] },
  flag16thDown: { bBoxNE: [1.164, 3.22], bBoxSW: [0, -0.04] },
  flag32ndUp: { bBoxNE: [1.044, 0.6], bBoxSW: [0, -3.248] },
  flag32ndDown: { bBoxNE: [1.092, 3.248], bBoxSW: [0, -0.688] },
  flag64thUp: { bBoxNE: [1.06, 1.2], bBoxSW: [0, -3.26] },
  flag64thDown: { bBoxNE: [1.1, 3.26], bBoxSW: [0, -1.3] },

  // Accidentals
  accidentalFlat: { bBoxNE: [0.904, 1.756], bBoxSW: [0, -0.7] },
  accidentalNatural: { bBoxNE: [0.672, 1.364], bBoxSW: [0, -1.34] },
  accidentalSharp: { bBoxNE: [0.996, 1.4], bBoxSW: [0, -1.392] },
  accidentalDoubleSharp: { bBoxNE: [0.988, 0.508], bBoxSW: [0, -0.5] },
  accidentalDoubleFlat: { bBoxNE: [1.644, 1.756], bBoxSW: [0, -0.7] },

  // Time signature digits (origin at the vertical centre of the digit)
  timeSig0: { bBoxNE: [1.8, 1.0], bBoxSW: [0, -1.0] },
  timeSig1: { bBoxNE: [1.26, 1.0], bBoxSW: [0, -1.0] },
  timeSig2: { bBoxNE: [1.64, 1.0], bBoxSW: [0, -1.0] },
  timeSig3: { bBoxNE: [1.54, 1.0], bBoxSW: [0, -1.0] },
  timeSig4: { bBoxNE: [1.8, 1.0], bBoxSW: [0, -1.0] },
  timeSig5: { bBoxNE: [1.56, 1.0], bBoxSW: [0, -1.0] },
  timeSig6: { bBoxNE: [1.64, 1.0], bBoxSW: [0, -1.0] },
  timeSig7: { bBoxNE: [1.66, 1.0], bBoxSW: [0, -1.0] },
  timeSig8: { bBoxNE: [1.7, 1.0], bBoxSW: [0, -1.0] },
  timeSig9: { bBoxNE: [1.64, 1.0], bBoxSW: [0, -1.0] },
  timeSigCommon: { bBoxNE: [1.6, 1.0], bBoxSW: [0, -1.0] },
  timeSigCutCommon: { bBoxNE: [1.6, 1.4], bBoxSW: [0, -1.4] },

  // Dots, articulations, fermatas
  augmentationDot: { bBoxNE: [0.4, 0.2], bBoxSW: [0, -0.2] },
  articAccentAbove: { bBoxNE: [1.356, 0.744], bBoxSW: [0, 0] },
  articAccentBelow: { bBoxNE: [1.356, 0], bBoxSW: [0, -0.744] },
  articStaccatoAbove: { bBoxNE: [0.336, 0.336], bBoxSW: [0, 0] },
  articStaccatoBelow: { bBoxNE: [0.336, 0], bBoxSW: [0, -0.336] },
  articTenutoAbove: { bBoxNE: [1.352, 0.164], bBoxSW: [0, 0] },
  articTenutoBelow: { bBoxNE: [1.352, 0], bBoxSW: [0, -0.164] },
  articStaccatissimoAbove: { bBoxNE: [0.4, 0.8], bBoxSW: [0, 0] },
  fermataAbove: { bBoxNE: [2.42, 1.364], bBoxSW: [0, -0.02] },
  fermataBelow: { bBoxNE: [2.42, 0.02], bBoxSW: [0, -1.364] },
  // Bowing marks / pick strokes (origin at the glyph's bottom)
  stringsDownBow: { bBoxNE: [1.248, 1.3], bBoxSW: [0, 0] },
  stringsUpBow: { bBoxNE: [1.0, 2.0], bBoxSW: [0, 0] },

  // Dynamics (letters; composed marks are measured per character)
  dynamicPiano: { bBoxNE: [1.6, 1.0], bBoxSW: [-0.2, -0.76] },
  dynamicMezzo: { bBoxNE: [1.9, 0.76], bBoxSW: [0, -0.06] },
  dynamicForte: { bBoxNE: [1.6, 1.6], bBoxSW: [-0.36, -0.62] },
  dynamicRinforzando: { bBoxNE: [1.12, 0.76], bBoxSW: [0, -0.06] },
  dynamicSforzando: { bBoxNE: [1.0, 0.8], bBoxSW: [0, -0.06] },
  dynamicZ: { bBoxNE: [1.2, 0.76], bBoxSW: [-0.1, -0.3] },
  dynamicNiente: { bBoxNE: [1.08, 0.76], bBoxSW: [0, -0.04] },

  // Misc
  repeatDot: { bBoxNE: [0.4, 0.2], bBoxSW: [0, -0.2] },
  segno: { bBoxNE: [2.2, 3.0], bBoxSW: [0, -0.1] },
  coda: { bBoxNE: [3.8, 3.62], bBoxSW: [0, -0.62] }, // measured from Bravura.woff2 ink (canvas measureText)
  ornamentTrill: { bBoxNE: [2.125, 1.563], bBoxSW: [0, -0.063] }, // measured the same way
};

const BY_CHAR = new Map();
for (const name of Object.keys(GLYPH_BOX)) {
  if (Glyph[name]) BY_CHAR.set(Glyph[name], name);
}

// Fallback for an unknown glyph: a generous 1 sp square-ish box.
const UNKNOWN = { bBoxNE: [1, 1], bBoxSW: [0, -1] };

function entry(nameOrChar) {
  return GLYPH_BOX[nameOrChar] || GLYPH_BOX[BY_CHAR.get(nameOrChar)] || null;
}

/**
 * Bounding box of one glyph, by Glyph name or by its character, as
 * `{ left, right, top, bottom, width }` in sp with y UP (top > bottom).
 * Unknown glyphs get a padded 1 sp box.
 */
export function glyphBox(nameOrChar) {
  const e = entry(nameOrChar) || UNKNOWN;
  return {
    left: e.bBoxSW[0], right: e.bBoxNE[0], top: e.bBoxNE[1], bottom: e.bBoxSW[1],
    width: e.bBoxNE[0] - e.bBoxSW[0],
  };
}

/** Whether `nameOrChar` is in the table (unknown glyphs still get a box). */
export function hasGlyphBox(nameOrChar) { return !!entry(nameOrChar); }

/**
 * Box of a string of glyphs set side by side (e.g. a composed dynamic or a
 * multi-digit time signature): widths add up, top/bottom are the extremes.
 */
export function glyphStringBox(str) {
  // Each glyph's advance is approximated by its right bbox edge.
  let right = 0; let top = -Infinity; let bottom = Infinity; let left = 0;
  let first = true;
  for (const ch of str) {
    const b = glyphBox(ch);
    if (first) { left = b.left; first = false; }
    right += b.right;
    top = Math.max(top, b.top);
    bottom = Math.min(bottom, b.bottom);
  }
  if (first) return { left: 0, right: 0, top: 0, bottom: 0, width: 0 };
  return { left, right, top, bottom, width: right - left };
}

/** Stem anchor of a notehead (sp, y up): `{ up: [x, y], down: [x, y] }`, or null. */
export function stemAnchors(nameOrChar) {
  const e = entry(nameOrChar);
  if (!e || !e.stemUpSE) return null;
  return { up: e.stemUpSE, down: e.stemDownNW };
}
