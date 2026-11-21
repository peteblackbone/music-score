/**
 * clef.js — clef names and the clef in force (1.11).
 *
 * `track.clef` and `measure.clef` accept treble, bass, alto, tenor and the
 * octave variants treble8vb/8va/15mb/15ma and bass8vb/8va/15mb/15ma
 * (trimmed, any case). An unknown name is treble on a track and ignored on
 * a measure. A measure's clef applies from that measure until the next
 * change on the same track (measure order); on measure 0 it replaces the
 * track's clef. Octave variants are labels only: notes sit where the base
 * clef puts them (`writtenOctaveUp` still decides the sounding pitch).
 *
 * Positions and key signatures for treble/bass call pitch.js with exactly
 * 'treble' / 'bass' (the arguments the pre-1.11 code used); alto and tenor
 * are the treble positions moved up (bottom line F3 / D3 instead of E4).
 * Normalized scores are not changed: names are canonicalized here, at draw time.
 */
import { notePosition, staffPosition, keySignatureLayout } from './pitch.js';
import { Glyph } from './glyphs.js';

export const CLEF_NAMES = ['treble', 'bass', 'alto', 'tenor',
  'treble8vb', 'treble8va', 'treble15mb', 'treble15ma', 'bass8vb', 'bass8va', 'bass15mb', 'bass15ma'];
const NAME_SET = new Set(CLEF_NAMES);

/** Canonical clef name of `raw` (trimmed, lower case), or null when it is not a clef name. */
export function clefOf(raw) {
  if (typeof raw !== 'string') return null;
  const c = raw.trim().toLowerCase();
  return NAME_SET.has(c) ? c : null;
}

/** The clef a track opens with (before any measure clef): its canonical `clef`, else treble. */
export function trackClef(track) {
  return clefOf(track?.clef) ?? 'treble';
}

// track -> clef in force per measure index; assumes a track (and its measures' clefs) isn't mutated after first use
const TABLES = new WeakMap();

function clefTable(track) {
  let t = TABLES.get(track);
  if (!t) {
    t = [];
    let cur = trackClef(track);
    (track.measures || []).forEach((m) => { cur = clefOf(m?.clef) ?? cur; t.push(cur); });
    if (!t.length) t.push(cur);
    TABLES.set(track, t);
  }
  return t;
}

/** Clef in force on `track` at measure `mi` (indices past the end keep the last clef). */
export function clefAt(track, mi) {
  const t = clefTable(track);
  return t[Math.max(0, Math.min(mi, t.length - 1))];
}

/** The new clef when `track` changes clef at measure `mi` (> 0), else null. */
export function clefChangeAt(track, mi) {
  if (!(mi > 0)) return null;
  const c = clefAt(track, mi);
  return c !== clefAt(track, mi - 1) ? c : null;
}

/** The new clef when `track`'s notation staff changes clef at measure `mi` (> 0); null without notation or change. */
export function notationClefChange(track, mi) {
  return track.showStandardNotation ? clefChangeAt(track, mi) : null;
}

/** Base clef without its octave label: treble | bass | alto | tenor. */
export function clefBase(clef) {
  const c = clefOf(clef) ?? 'treble';
  return c.replace(/(8v[ab]|15m[ab])$/, '');
}

// Shift (staff positions) of alto / tenor relative to treble: E4 -> F3 / D3 on the bottom line.
const C_CLEF_SHIFT = { alto: 6, tenor: 8 };

/** Displayed staff position of `note` (0 = bottom line) under `clef`, ottava display shift included. */
export function clefNotePosition(note, clef) {
  const base = clefBase(clef);
  if (base === 'treble' || base === 'bass') return notePosition(note, base);
  return notePosition(note, 'treble') + C_CLEF_SHIFT[base];
}

// Key signature pitches of the C clefs (customary printed octaves).
const C_CLEF_KEYS = {
  alto: { sharp: ['F4', 'C4', 'G4', 'D4', 'A3', 'E4', 'B3'], flat: ['B3', 'E4', 'A3', 'D4', 'G3', 'C4', 'F3'] },
  tenor: { sharp: ['F3', 'C4', 'G3', 'D4', 'A3', 'E4', 'B3'], flat: ['B3', 'E4', 'A3', 'D4', 'G3', 'C4', 'F3'] },
};

/** Ordered `{ letter, alter, position }` accidentals of key `keySig` (−7..7) on a `clef` staff. */
export function clefKeySignatureLayout(keySig = 0, clef) {
  const base = clefBase(clef);
  if (base === 'treble' || base === 'bass') return keySignatureLayout(keySig, base);
  const sharp = keySig > 0;
  const pitches = C_CLEF_KEYS[base][sharp ? 'sharp' : 'flat'].slice(0, Math.min(Math.abs(keySig), 7));
  return pitches.map((p) => ({ letter: p[0], alter: sharp ? 1 : -1, position: staffPosition(p, 'treble') + C_CLEF_SHIFT[base] }));
}

const EXPLICIT_GLYPH = {
  treble8vb: 'gClef8vb', treble8va: 'gClef8va', treble15mb: 'gClef15mb', treble15ma: 'gClef15ma',
  bass8vb: 'fClef8vb', bass8va: 'fClef8va', bass15mb: 'fClef15mb', bass15ma: 'fClef15ma',
};
const PLAIN_GLYPH = { treble: ['gClef', 'gClef8vb'], bass: ['fClef', 'fClef8vb'], alto: ['cClef', 'cClef8vb'], tenor: ['cClef', 'cClef8vb'] };

/**
 * Clef glyph of `clef`. An explicit octave clef wins; otherwise `auto`
 * (track.octaveClef: guitar music written an octave up) picks the 8vb form.
 */
export function clefGlyphFor(clef, auto) {
  const c = clefOf(clef) ?? 'treble';
  if (EXPLICIT_GLYPH[c]) return Glyph[EXPLICIT_GLYPH[c]];
  return Glyph[PLAIN_GLYPH[c][auto ? 1 : 0]];
}

const ANCHOR = { treble: 2, bass: 6, alto: 4, tenor: 6 };

/**
 * Staff position of the line the clef glyph's baseline sits on: G4 line
 * (2) for treble, F3 line (6) for bass, middle C on the middle line (4) for
 * alto and the 4th line (6) for tenor. Octave variants use their base.
 */
export function clefAnchorPos(clef) {
  return ANCHOR[clefBase(clef)];
}
