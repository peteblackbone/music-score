/**
 * pitch.js — scientific pitch notation helpers ("C#4", "Bb3", "E4", ...)
 * and staff-position math shared by the notation and tab renderers.
 */

const STEP_INDEX = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
const STEP_SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/**
 * Parse "C#4", "Bb3", "Ebb2", "F##5", "A4" -> { step, alter, octave }
 * alter: -2..+2 (flats negative, sharps positive)
 */
export function parsePitch(pitch) {
  const m = /^([A-Ga-g])(#{1,2}|b{1,2}|x)?(-?\d+)$/.exec(pitch.trim());
  if (!m) throw new Error(`Invalid pitch: "${pitch}"`);
  const step = m[1].toUpperCase();
  const accStr = m[2] || '';
  let alter = 0;
  if (accStr === '#' || accStr === 'x') alter = accStr === 'x' ? 2 : 1;
  else if (accStr === '##') alter = 2;
  else if (accStr === 'b') alter = -1;
  else if (accStr === 'bb') alter = -2;
  const octave = parseInt(m[3], 10);
  return { step, alter, octave };
}

/** Diatonic "letter index" across all octaves (C0=0, D0=1 ... B0=6, C1=7, ...) */
export function diatonicIndex({ step, octave }) {
  return octave * 7 + STEP_INDEX[step];
}

/** Approximate MIDI note number (useful for sorting/ties, not audio-accurate for double accidentals beyond +-2). */
export function midiNumber({ step, alter, octave }) {
  return (octave + 1) * 12 + STEP_SEMITONE[step] + alter;
}

// Reference note = the bottom staff line, given as its diatonic index.
const CLEF_REFERENCE = {
  treble: diatonicIndex({ step: 'E', octave: 4 }), // E4 = bottom line
  bass: diatonicIndex({ step: 'G', octave: 2 }),    // G2 = bottom line
};

/**
 * Staff position of a pitch, in half-line-spacing units, where 0 = bottom
 * staff line and increases going up. Every diatonic step = 1 unit (lines
 * and spaces alternate every unit).
 */
export function staffPosition(pitchStr, clef = 'treble') {
  const p = parsePitch(pitchStr);
  const ref = CLEF_REFERENCE[clef] ?? CLEF_REFERENCE.treble;
  return diatonicIndex(p) - ref;
}

/** Convert a staff position (see staffPosition) to a y-offset in px above the bottom staff line. */
export function staffPositionToY(position, lineSpacing) {
  return -(position * (lineSpacing / 2));
}

// Circle-of-fifths key signature helpers -----------------------------------

const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

/** For a key signature integer (-7..7 flats/sharps), return { letter: alter } map. */
export function keySignatureAlterations(keySig = 0) {
  const map = {};
  if (keySig > 0) {
    for (let i = 0; i < keySig; i++) map[SHARP_ORDER[i]] = 1;
  } else if (keySig < 0) {
    for (let i = 0; i < -keySig; i++) map[FLAT_ORDER[i]] = -1;
  }
  return map;
}

/** Ordered list of {letter, position} accidentals to draw at the clef, for a given clef's staff. */
export function keySignatureLayout(keySig = 0, clef = 'treble') {
  const order = keySig > 0 ? SHARP_ORDER.slice(0, keySig) : FLAT_ORDER.slice(0, -keySig);
  const alter = keySig > 0 ? 1 : -1;
  // Octave chosen per convention so accidentals sit in the customary printed positions.
  const octaves = {
    treble: keySig > 0
      ? { F: 5, C: 5, G: 5, D: 5, A: 4, E: 5, B: 4 }
      : { B: 4, E: 5, A: 4, D: 5, G: 4, C: 5, F: 4 },
    bass: keySig > 0
      ? { F: 3, C: 3, G: 3, D: 3, A: 2, E: 3, B: 2 }
      : { B: 2, E: 3, A: 2, D: 3, G: 2, C: 3, F: 2 },
  };
  const octMap = octaves[clef] || octaves.treble;
  return order.map((letter) => ({
    letter,
    alter,
    position: staffPosition(`${letter}${octMap[letter]}`, clef),
  }));
}

/**
 * Decide whether an accidental glyph should be printed before this note,
 * and which one, given the active key signature. This is a simplified
 * model (no "remember accidental for rest of measure" tracking) — see
 * README limitations. An explicit `note.accidental` always wins.
 */
export function resolveAccidental(pitchStr, keySig, explicitAccidental) {
  if (explicitAccidental) return explicitAccidental;
  const p = parsePitch(pitchStr);
  const keyAlters = keySignatureAlterations(keySig);
  const defaultAlter = keyAlters[p.step] || 0;
  if (p.alter === defaultAlter) return null;
  const names = { '-2': 'doubleFlat', '-1': 'flat', 0: 'natural', 1: 'sharp', 2: 'doubleSharp' };
  return names[String(p.alter)] ?? null;
}

/** Transpose a tuning pitch up by `fret` semitones, returning a spelled pitch string. */
export function pitchFromFret(openPitch, fret) {
  const p = parsePitch(openPitch);
  let midi = midiNumber(p) + fret;
  // Re-spell using a simple sharps-preferring chromatic scale.
  const CHROMA = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(midi / 12) - 1;
  const name = CHROMA[((midi % 12) + 12) % 12];
  const step = name[0];
  const alter = name.length > 1 ? 1 : 0;
  const alterStr = alter === 1 ? '#' : '';
  return `${step}${alterStr}${octave}`;
}

const ALTER_NAMES = { '-2': 'doubleFlat', '-1': 'flat', 0: 'natural', 1: 'sharp', 2: 'doubleSharp' };

/** Accidental name for an alteration (-2..2), e.g. 1 -> 'sharp', 0 -> 'natural'. */
export function accidentalNameForAlter(alter) {
  return ALTER_NAMES[String(alter)] ?? null;
}

/**
 * Accidental memory for one measure: which alteration each step+octave
 * currently has, starting from the key signature (`keySig`, -7..7). An
 * accidental applies to its step+octave until the barline; create a new
 * state per measure.
 * `current(p)` → active alteration of parsed pitch `p`'s step+octave;
 * `set(p)` records `p.alter` as the active one.
 */
export function createAccidentalState(keySig = 0) {
  const keyAlters = keySignatureAlterations(keySig);
  const altered = new Map();
  const id = (p) => `${p.step}${p.octave}`;
  return {
    current: (p) => (altered.has(id(p)) ? altered.get(id(p)) : (keyAlters[p.step] || 0)),
    set: (p) => { altered.set(id(p), p.alter); },
  };
}

/** Transpose a pitch string by whole octaves, keeping its spelling: ("C#4", 1) -> "C#5". */
export function transposeOctaves(pitchStr, n) {
  const m = /^([A-Ga-g])(#{1,2}|b{1,2}|x)?(-?\d+)$/.exec(String(pitchStr).trim());
  if (!m) throw new Error(`Invalid pitch: "${pitchStr}"`);
  return `${m[1]}${m[2] || ''}${parseInt(m[3], 10) + n}`;
}
