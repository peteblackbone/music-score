/**
 * hands.js — ornaments, fingering and the other hand marks, one place for
 * the questions normalize, layout and the drawing passes ask about them:
 *
 * - `note.ornament` 'turn' | 'invertedTurn' | 'upperMordent' |
 *   'lowerMordent' (trimmed, any case, spaces / '-' / '_' ignored; aliases
 *   'turnInverted', 'invertedMordent', 'shortTrill', 'mordent'): an
 *   ornament glyph above the beat, in the trill's slot (a trill wins);
 * - `note.finger` 0–4 or 'T' (digit strings and 't' accepted): a left-hand
 *   fingering digit left of the note on the notation staff;
 * - `note.rightFinger` 'p' | 'i' | 'm' | 'a' | 'c' (any case): a right-hand
 *   letter above the beat;
 * - `beat.golpe` true | 'thumb' | 'finger': a golpe glyph above the tap
 *   letter slot;
 * - `beat.pickScrape` true | 'down' | 'up': a "P.S." label run, like let
 *   ring (the direction is kept, not drawn);
 * - `beat.barre` fret 1–24 (or its digit string) | `{ fret, half }`: a
 *   barre label run "C II" / "½C V" (barreLabel);
 * - `note.leftHandTap` (truthy): the left-hand tapping glyph in the tap
 *   letter slot (directions.js beatTapMark).
 *
 * Rests and grace notes carry none of the beat marks. Every canonicalizer
 * is idempotent, never throws and returns null for values it doesn't
 * understand. Pure functions, no DOM.
 */
import { isMainNoteBeat, beatTrill } from './directions.js';
import { parsePitch, midiNumber } from './pitch.js';

const ORNAMENT_ALIASES = {
  turn: 'turn',
  invertedturn: 'invertedTurn', turninverted: 'invertedTurn',
  uppermordent: 'upperMordent', invertedmordent: 'upperMordent', shorttrill: 'upperMordent',
  lowermordent: 'lowerMordent', mordent: 'lowerMordent',
};
/** Glyph name (glyphs.js) of each ornament kind. */
export const ORNAMENT_GLYPH = {
  turn: 'ornamentTurn', invertedTurn: 'ornamentTurnInverted',
  upperMordent: 'ornamentShortTrill', lowerMordent: 'ornamentMordent',
};
/** Class name of each ornament kind (drawn with the class 'ornament'). */
export const ORNAMENT_CLASS = {
  turn: 'ornament-turn', invertedTurn: 'ornament-inverted-turn',
  upperMordent: 'ornament-upper-mordent', lowerMordent: 'ornament-lower-mordent',
};
const RIGHT_FINGERS = ['p', 'i', 'm', 'a', 'c'];
const GOLPE_KINDS = ['thumb', 'finger'];
const SCRAPE_KINDS = ['down', 'up'];
const MAX_BARRE_FRET = 24;

/** Canonical ornament kind of a raw `note.ornament` value, or null. Idempotent. */
export function ornamentOf(raw) {
  if (typeof raw !== 'string') return null;
  if (Object.hasOwn(ORNAMENT_GLYPH, raw)) return raw;
  const key = raw.trim().toLowerCase().replace(/[\s\-_]/g, '');
  return Object.hasOwn(ORNAMENT_ALIASES, key) ? ORNAMENT_ALIASES[key] : null;
}

/** Canonical left-hand finger of a raw `note.finger` value: 0–4 or 'T', or null. Idempotent. */
export function fingerOf(raw) {
  if (typeof raw === 'number') return Number.isInteger(raw) && raw >= 0 && raw <= 4 ? raw : null;
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (/^[0-4]$/.test(s)) return Number(s);
  return s === 'T' || s === 't' ? 'T' : null;
}

/** Canonical right-hand finger of a raw `note.rightFinger` value ('p' | 'i' | 'm' | 'a' | 'c'), or null. Idempotent. */
export function rightFingerOf(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase();
  return RIGHT_FINGERS.includes(s) ? s : null;
}

/** Canonical golpe of a raw `beat.golpe` value: true | 'thumb' | 'finger', or null. Idempotent. */
export function golpeOf(raw) {
  if (raw === true) return true;
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase();
  return GOLPE_KINDS.includes(s) ? s : null;
}

/** Canonical pick scrape of a raw `beat.pickScrape` value: true | 'down' | 'up', or null. Idempotent. */
export function pickScrapeOf(raw) {
  if (raw === true) return true;
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase();
  return SCRAPE_KINDS.includes(s) ? s : null;
}

/** `raw` as a barre fret 1–24 (an integer or its digit string), or null. */
function barreFret(raw) {
  const n = typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : raw;
  return Number.isInteger(n) && n >= 1 && n <= MAX_BARRE_FRET ? n : null;
}

/**
 * Canonical barre `{ fret, half }` of a raw `beat.barre` value: a fret
 * 1–24 (integer or digit string) is a full barre; an object needs such a
 * `fret` and is half only with `half: true`. Anything else → null.
 * Idempotent.
 */
export function barreOf(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const fret = barreFret(raw.fret);
    return fret == null ? null : { fret, half: raw.half === true };
  }
  const fret = barreFret(raw);
  return fret == null ? null : { fret, half: false };
}

/** Roman numeral of 1–24 (subtractive: IV, IX, XIV, XIX, XXIV). */
export function romanNumeral(n) {
  const units = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];
  return 'X'.repeat(Math.floor(n / 10)) + units[n % 10];
}

/** Label of a canonical barre: "C II", "½C V". */
export function barreLabel(b) {
  return `${b.half ? '½' : ''}C ${romanNumeral(b.fret)}`;
}

/** Ornament kind of a beat (first note with a valid one), or null (none, rest, grace, or a trilled beat). */
export function beatOrnament(el) {
  if (!isMainNoteBeat(el) || beatTrill(el)) return null;
  for (const note of el.notes) {
    const kind = ornamentOf(note.ornament);
    if (kind) return kind;
  }
  return null;
}

/** Golpe of a beat (true | 'thumb' | 'finger'), or null (none, rest, grace). */
export function beatGolpe(el) {
  return isMainNoteBeat(el) ? golpeOf(el.golpe) : null;
}

/** Pick scrape of a beat (true | 'down' | 'up'), or null (none, rest, grace). */
export function beatPickScrape(el) {
  return isMainNoteBeat(el) ? pickScrapeOf(el.pickScrape) : null;
}

/** Barre of a beat (`{ fret, half }`), or null (none, rest, grace). */
export function beatBarre(el) {
  return isMainNoteBeat(el) ? barreOf(el.barre) : null;
}

/** MIDI number of a note's pitch, or null when it has none or it doesn't parse. */
function noteMidi(note) {
  if (typeof note.pitch !== 'string') return null;
  try { return midiNumber(parsePitch(note.pitch)); } catch { return null; }
}

/**
 * Right-hand letters of a beat, lowest note first (by pitch; notes without
 * a pitch by string, the higher string number lower), or null (none, rest,
 * grace).
 */
export function rightFingerStack(el) {
  if (!isMainNoteBeat(el)) return null;
  const fingered = el.notes.map((note) => ({ note, letter: rightFingerOf(note.rightFinger), midi: noteMidi(note) }))
    .filter((f) => f.letter);
  if (!fingered.length) return null;
  fingered.sort((a, b) => (a.midi != null && b.midi != null ? a.midi - b.midi : (b.note.string ?? 0) - (a.note.string ?? 0)));
  return fingered.map((f) => f.letter);
}

/**
 * `note` itself unless it has an `ornament`, `finger` or `rightFinger`
 * field; then a copy with those (present) fields canonicalized (null when
 * not understood). `leftHandTap` passes through (read as truthy).
 */
export function withHandNote(note) {
  const hasOrn = note.ornament !== undefined;
  const hasFinger = note.finger !== undefined;
  const hasRight = note.rightFinger !== undefined;
  if (!hasOrn && !hasFinger && !hasRight) return note;
  const out = { ...note };
  if (hasOrn) out.ornament = ornamentOf(note.ornament);
  if (hasFinger) out.finger = fingerOf(note.finger);
  if (hasRight) out.rightFinger = rightFingerOf(note.rightFinger);
  return out;
}

/**
 * `beat` itself unless it has a `golpe`, `pickScrape` or `barre` field;
 * then a copy with those (present) fields canonicalized (null when not
 * understood).
 */
export function withHandBeat(beat) {
  const hasGolpe = beat.golpe !== undefined;
  const hasScrape = beat.pickScrape !== undefined;
  const hasBarre = beat.barre !== undefined;
  if (!hasGolpe && !hasScrape && !hasBarre) return beat;
  const out = { ...beat };
  if (hasGolpe) out.golpe = golpeOf(beat.golpe);
  if (hasScrape) out.pickScrape = pickScrapeOf(beat.pickScrape);
  if (hasBarre) out.barre = barreOf(beat.barre);
  return out;
}
