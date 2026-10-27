/**
 * chordShapes.js — chord-diagram shapes: validation of an author shape
 * against a track's string count, the displayed fret window, and which
 * shape (if any) a beat shows. Pure, no imports, no DOM.
 *
 * Author shape (README "Chord diagrams"): `{ frets, fingers?, barre?,
 * baseFret? }` — `frets` low → high like `tuning` (integer 0–24; 'x', 'X',
 * null or -1 = muted), `fingers` per string (1–4 or 'T'; 0 / null = none),
 * `barre` `{ fret, from?, to? }` in note.string numbering (1 = highest
 * string; default from the lowest string to string 1), `baseFret` the fret
 * of the first displayed row.
 *
 * Validated shape: columns c = 0..n−1 run low → high (c = n − string).
 */

const MAX_FRET = 24;
const MAX_SPAN = 5;     // fretted span (max − min + 1) a diagram can show
const MIN_ROWS = 4;
const MIN_STRINGS = 3;
const MAX_STRINGS = 10;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && [Object.prototype, null].includes(Object.getPrototypeOf(v));

/** One fret entry: integer 0–24, null for muted ('x' / 'X' / null / −1), undefined when invalid. */
function fretEntry(v) {
  if (Number.isInteger(v) && v >= 0 && v <= MAX_FRET) return v;
  if (v === 'x' || v === 'X' || v === null || v === -1) return null;
  return undefined;
}

/**
 * Default first displayed fret for validated `frets` (integers or null):
 * 1 (with a nut) when nothing is fretted or the highest fret is ≤ 4, else
 * the lowest fretted fret.
 */
export function resolveBaseFret(frets) {
  const fretted = frets.filter((f) => Number.isInteger(f) && f > 0);
  if (!fretted.length || Math.max(...fretted) <= MIN_ROWS) return 1;
  return Math.min(...fretted);
}

function fingerEntry(v) {
  if (v === 0 || v == null) return null;
  if (Number.isInteger(v) && v >= 1 && v <= 4) return v;
  if (v === 'T' || v === 't') return 'T';
  return null;
}

/**
 * Validate an author shape for a track with `stringCount` strings (3–10).
 * Returns `{ frets, fingers, barre, baseFret, rows, showNut, hasMarkers,
 * hasFingers }` or null when the shape can't be drawn (not a plain object;
 * `frets` not an array of `stringCount` valid entries; fretted span > 5).
 * Bad fingers / barre / baseFret are dropped or recomputed, not fatal.
 */
export function validateShape(raw, stringCount) {
  if (!isPlainObject(raw)) return null;
  const n = stringCount;
  if (!Number.isInteger(n) || n < MIN_STRINGS || n > MAX_STRINGS) return null;
  if (!Array.isArray(raw.frets) || raw.frets.length !== n) return null;
  const frets = [];
  for (let c = 0; c < n; c++) {
    const f = fretEntry(raw.frets[c]);
    if (f === undefined) return null;
    frets.push(f);
  }
  const fretted = frets.filter((f) => f !== null && f > 0);
  const lo = fretted.length ? Math.min(...fretted) : null;
  const hi = fretted.length ? Math.max(...fretted) : null;
  if (fretted.length && hi - lo + 1 > MAX_SPAN) return null;

  const b = raw.baseFret;
  const baseFret = fretted.length && Number.isInteger(b) && b >= 1 && b <= lo && hi - b + 1 <= MAX_SPAN
    ? b : resolveBaseFret(frets);
  const rows = fretted.length ? Math.max(MIN_ROWS, hi - baseFret + 1) : MIN_ROWS;

  let fingers = null;
  if (Array.isArray(raw.fingers) && raw.fingers.length === n) {
    fingers = [];
    for (let c = 0; c < n; c++) fingers.push(frets[c] > 0 ? fingerEntry(raw.fingers[c]) : null);
    if (!fingers.some((f) => f !== null)) fingers = null;
  }

  let barre = null;
  const rb = raw.barre;
  if (isPlainObject(rb)) {
    const { fret: bf, from: rFrom, to: rTo } = rb;
    if (Number.isInteger(bf) && bf >= baseFret && bf <= baseFret + rows - 1) {
      const from = rFrom === undefined ? n : rFrom;
      const to = rTo === undefined ? 1 : rTo;
      const okString = (s) => Number.isInteger(s) && s >= 1 && s <= n;
      if (okString(from) && okString(to) && from !== to) {
        barre = { fret: bf, cLo: n - Math.max(from, to), cHi: n - Math.min(from, to) };
      }
    }
  }

  return {
    frets,
    fingers,
    barre,
    baseFret,
    rows,
    showNut: baseFret === 1,
    hasMarkers: frets.some((f) => f === null || f === 0),
    hasFingers: fingers !== null,
  };
}

/**
 * The validated shape a beat shows, or null (plain chord symbol / nothing):
 * 1. the track's `showChordDiagrams` is off → null (master switch, even
 *    over a beat override);
 * 2. `beat.chordDiagram === false` → null;
 * 3. a plain-object `beat.chordDiagram` → that shape (null when invalid —
 *    no dictionary fallback);
 * 4. else `score.chordShapes[beat.chord trimmed]` (own keys only,
 *    case-sensitive) when present;
 * 5. else null. Other `chordDiagram` values (true, strings, numbers) are
 *    ignored, so step 4 applies.
 */
export function resolveShape(beat, score, track) {
  if (!track || !track.showChordDiagrams || !beat) return null;
  const n = Array.isArray(track.tuning) ? track.tuning.length : 0;
  const own = beat.chordDiagram;
  if (own === false) return null;
  if (isPlainObject(own)) return validateShape(own, n);
  const dict = score && score.chordShapes;
  if (beat.chord == null || !isPlainObject(dict)) return null;
  const key = String(beat.chord).trim();
  if (!key || !Object.prototype.hasOwnProperty.call(dict, key)) return null;
  return validateShape(dict[key], n);
}
