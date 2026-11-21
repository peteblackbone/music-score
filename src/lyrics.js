/**
 * lyrics.js — canonical form of `beat.lyric` (1.12.0) and the horizontal
 * room a beat's syllables need. Pure functions; the raw field passes
 * through normalize.js untouched and is canonicalized here when laying out
 * and drawing.
 *
 * `beat.lyric`: a string (verse 1) or an array (index = verse, the first
 * MAX_VERSES used). Each entry is a string or `{ text, hyphen, extend }`:
 * - string: canonical text (scoreText.js canonicalText); exactly one
 *   trailing marker is stripped — '-' sets `hyphen` (the word goes on),
 *   '_' sets `extend` (an extender line follows) — and the rest
 *   canonicalized again;
 * - object (not an array): canonical `text`, `hyphen === true`,
 *   `extend === true`; a hyphen wins over an extender;
 * - anything else, or no text left → no syllable (null).
 * Only note beats (slash beats included) carry lyrics: rests and grace
 * notes ignore the field; voice 2 is ignored by the callers.
 */
import { canonicalText } from './scoreText.js';
import { estimateTextWidth } from './textMetrics.js';

const MAX_VERSES = 8;
const LYRIC_PAD_SP = 0.25;  // half a syllable + this either side of the beat x
const HYPHEN_ROOM_SP = 0.6; // extra room right of a hyphenated syllable (+ the hyphen's width)

/** One verse entry → `{ text, hyphen, extend }`, or null (see the header). */
function canonicalSyllable(raw) {
  if (typeof raw === 'string') {
    let text = canonicalText(raw);
    if (!text) return null;
    const hyphen = text.endsWith('-');
    const extend = !hyphen && text.endsWith('_');
    if (hyphen || extend) text = canonicalText(text.slice(0, -1));
    return text ? { text, hyphen, extend } : null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const text = canonicalText(raw.text);
  if (!text) return null;
  const hyphen = raw.hyphen === true;
  return { text, hyphen, extend: !hyphen && raw.extend === true };
}

/**
 * Canonical lyrics: an array (verse index → `{ text, hyphen, extend }` |
 * null, at most MAX_VERSES long), or null when no verse has a syllable.
 * Idempotent.
 */
export function canonicalLyrics(raw) {
  let verses;
  if (typeof raw === 'string') verses = [canonicalSyllable(raw)];
  else if (Array.isArray(raw)) verses = raw.slice(0, MAX_VERSES).map(canonicalSyllable);
  else return null;
  return verses.some(Boolean) ? verses : null;
}

/** A layout/score element's canonical lyrics: null unless it is a note beat with a syllable. */
export function lyricsOf(el) {
  return el && el.type === 'note' ? canonicalLyrics(el.lyric) : null;
}

/**
 * Horizontal room (px) a beat's syllables need either side of its x:
 * `{ left, right }` = the widest verse's half width + LYRIC_PAD_SP, a
 * hyphenated verse adding the hyphen's width + HYPHEN_ROOM_SP on the
 * right; null without lyrics. Widths are estimates (textMetrics.js).
 */
export function lyricExtents(el, theme) {
  const verses = lyricsOf(el);
  if (!verses) return null;
  const size = theme.lyricFontSize;
  const s = theme.staffLineSpacing;
  let left = 0; let right = 0;
  verses.forEach((v) => {
    if (!v) return;
    const half = estimateTextWidth(v.text, size) / 2 + LYRIC_PAD_SP * s;
    left = Math.max(left, half);
    right = Math.max(right, half + (v.hyphen ? estimateTextWidth('-', size) + HYPHEN_ROOM_SP * s : 0));
  });
  return { left, right };
}
