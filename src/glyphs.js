/**
 * glyphs.js
 * -----------------------------------------------------------------------
 * SMuFL (Standard Music Font Layout) codepoint table.
 *
 * These codepoints are part of the public, stable SMuFL specification
 * (https://w3c.github.io/smufl/) and are implemented identically by every
 * conformant music font (Bravura, Petaluma, Leland, ...). We ship Bravura
 * by default (see font.js) but any SMuFL font can be swapped in via
 * `MusicScoreRenderer({ fontFamily: '...' })`.
 *
 * Codepoints are written as \uXXXX escapes (rather than literal glyphs)
 * so this file stays plain ASCII and diff/copy-paste safely.
 */

export const Glyph = {
  // Clefs
  gClef: '',
  cClef: '',
  fClef: '',
  gClef8vb: '',
  fClef8vb: '',
  tabClef6: '', // 6stringTabClef
  tabClef4: '', // 4stringTabClef

  // Noteheads
  noteheadDoubleWhole: '',
  noteheadWhole: '',
  noteheadHalf: '',
  noteheadBlack: '',
  noteheadXBlack: '',
  noteheadDiamondWhole: '\uE0D8',
  noteheadDiamondHalf: '\uE0D9',
  noteheadDiamondBlack: '\uE0DB',

  // Rests
  restMaxima: '',
  restLonga: '',
  restDoubleWhole: '',
  restWhole: '',
  restHalf: '',
  restQuarter: '',
  rest8th: '',
  rest16th: '',
  rest32nd: '',
  rest64th: '',

  // Flags
  flag8thUp: '',
  flag8thDown: '',
  flag16thUp: '',
  flag16thDown: '',
  flag32ndUp: '',
  flag32ndDown: '',
  flag64thUp: '',
  flag64thDown: '',

  // Accidentals
  accidentalFlat: '',
  accidentalNatural: '',
  accidentalSharp: '',
  accidentalDoubleSharp: '',
  accidentalDoubleFlat: '',

  // Time signature digits
  timeSig0: '',
  timeSig1: '',
  timeSig2: '',
  timeSig3: '',
  timeSig4: '',
  timeSig5: '',
  timeSig6: '',
  timeSig7: '',
  timeSig8: '',
  timeSig9: '',
  timeSigCommon: '',
  timeSigCutCommon: '',

  // Augmentation / articulation
  augmentationDot: '',
  articAccentAbove: '',
  articAccentBelow: '',
  articStaccatoAbove: '',
  articStaccatoBelow: '',
  articTenutoAbove: '',
  articTenutoBelow: '',
  articStaccatissimoAbove: '',

  // Dynamics
  dynamicPiano: '',
  dynamicMezzo: '',
  dynamicForte: '',
  dynamicRinforzando: '',
  dynamicSforzando: '',
  dynamicZ: '',
  dynamicNiente: '',

  // Repeats / barlines / misc
  barlineSingle: '',
  barlineDouble: '',
  barlineFinal: '',
  repeatDot: '',
  segno: '',
  coda: '',
  fermataAbove: '',
  fermataBelow: '',

  // Bowing marks, used as pick strokes (down-bow = downstroke, up-bow "V" = upstroke)
  stringsDownBow: '',
  stringsUpBow: '',

  brace:'',
};

/** Clef name ('treble' | 'bass') -> clef glyph; `octave` picks the 8vb variant (gClef8vb / fClef8vb). */
export function clefGlyph(clef, octave) {
  if (clef === 'bass') return octave ? Glyph.fClef8vb : Glyph.fClef;
  return octave ? Glyph.gClef8vb : Glyph.gClef;
}

/** Pick stroke ('down' | 'up') -> bowing glyph (down-bow / up-bow), or null */
export function pickStrokeGlyph(kind) {
  if (kind === 'down') return Glyph.stringsDownBow;
  if (kind === 'up') return Glyph.stringsUpBow;
  return null;
}

/** Duration -> notehead glyph */
export function noteheadForDuration(duration) {
  if (duration === 'whole') return Glyph.noteheadWhole;
  if (duration === 'half') return Glyph.noteheadHalf;
  return Glyph.noteheadBlack; // quarter and shorter
}

/** Duration -> diamond notehead glyph (natural harmonics) */
export function diamondNoteheadForDuration(duration) {
  if (duration === 'whole') return Glyph.noteheadDiamondWhole;
  if (duration === 'half') return Glyph.noteheadDiamondHalf;
  return Glyph.noteheadDiamondBlack; // quarter and shorter
}

/** Duration -> rest glyph */
export function restForDuration(duration) {
  switch (duration) {
    case 'whole': return Glyph.restWhole;
    case 'half': return Glyph.restHalf;
    case 'quarter': return Glyph.restQuarter;
    case '8th': return Glyph.rest8th;
    case '16th': return Glyph.rest16th;
    case '32nd': return Glyph.rest32nd;
    case '64th': return Glyph.rest64th;
    default: return Glyph.restQuarter;
  }
}

/** Duration -> flag glyph (stem-direction aware). Returns null if the
 *  duration doesn't need a flag (half note / whole note / quarter). */
export function flagForDuration(duration, stemUp) {
  const map = {
    '8th': [Glyph.flag8thUp, Glyph.flag8thDown],
    '16th': [Glyph.flag16thUp, Glyph.flag16thDown],
    '32nd': [Glyph.flag32ndUp, Glyph.flag32ndDown],
    '64th': [Glyph.flag64thUp, Glyph.flag64thDown],
  };
  const pair = map[duration];
  if (!pair) return null;
  return stemUp ? pair[0] : pair[1];
}

/** Accidental name -> glyph */
export function accidentalGlyph(name) {
  switch (name) {
    case 'sharp': return Glyph.accidentalSharp;
    case 'flat': return Glyph.accidentalFlat;
    case 'natural': return Glyph.accidentalNatural;
    case 'doubleSharp': return Glyph.accidentalDoubleSharp;
    case 'doubleFlat': return Glyph.accidentalDoubleFlat;
    default: return '';
  }
}

/** Dynamic mark name -> glyph string (marks like "mf" are composed) */
export function dynamicGlyph(mark) {
  const table = {
    p: Glyph.dynamicPiano,
    pp: Glyph.dynamicPiano + Glyph.dynamicPiano,
    ppp: Glyph.dynamicPiano + Glyph.dynamicPiano + Glyph.dynamicPiano,
    mp: Glyph.dynamicMezzo + Glyph.dynamicPiano,
    mf: Glyph.dynamicMezzo + Glyph.dynamicForte,
    f: Glyph.dynamicForte,
    ff: Glyph.dynamicForte + Glyph.dynamicForte,
    fff: Glyph.dynamicForte + Glyph.dynamicForte + Glyph.dynamicForte,
    // SMuFL's dynamicSforzando/dynamicRinforzando are the single letters s/r, so compose s+f+z / r+f+z.
    sfz: Glyph.dynamicSforzando + Glyph.dynamicForte + Glyph.dynamicZ,
    rfz: Glyph.dynamicRinforzando + Glyph.dynamicForte + Glyph.dynamicZ,
    n: Glyph.dynamicNiente,
  };
  return table[mark] || mark;
}

const TIME_SIG_DIGITS = [
  Glyph.timeSig0, Glyph.timeSig1, Glyph.timeSig2, Glyph.timeSig3, Glyph.timeSig4,
  Glyph.timeSig5, Glyph.timeSig6, Glyph.timeSig7, Glyph.timeSig8, Glyph.timeSig9,
];

/** Render a number (e.g. 12) as a string of SMuFL time-signature digit glyphs */
export function timeSigDigits(n) {
  return String(n).split('').map((d) => TIME_SIG_DIGITS[Number(d)]).join('');
}
