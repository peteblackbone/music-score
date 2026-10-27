/**
 * directions.js — picking and playing directions, one place for the
 * questions normalize, the TAB pass, the label pass and the directions pass
 * ask about them:
 *
 * - `beat.letRing` (truthy): a "let ring" label run, like P.M.;
 * - `beat.pickStroke` 'down' | 'up': a pick-stroke mark (⊓ / ∨) above the
 *   beat; anything else is ignored;
 * - `note.tap` (truthy): a "T" above the beat (one per beat); a tapped
 *   harmonic already says "T.H." and gets no extra "T";
 * - `note.slap` / `note.pop` (truthy): an "S" / "P" in the tap "T" slot
 *   (priority tap > slap > pop, one letter per beat);
 * - `beat.whammy` true | amount | `{ type, amount }`, type 'dip' (default),
 *   'dive', 'return' or 'predive': a whammy-bar mark on the TAB staff, its
 *   amount shown with a leading "-" (`true` and a missing amount mean '1/2');
 * - `beat.rake` (truthy, 'down' | 'up'): a "rake" label run over the beat
 *   and the grace notes right before it;
 * - `note.trill` true | fret | pitch | `{ fret, pitch }`: "tr" and a wavy
 *   line above the beat;
 * - `beat.arpeggio` true | 'up' | 'down': a vertical wavy line left of a
 *   chord of two or more notes ('up' / 'down' add an arrowhead);
 * - `beat.strum` 'down' | 'up': a strum arrow above the beat; it replaces
 *   the beat's pick stroke.
 *
 * Rests and grace notes carry no pick stroke, tap, whammy, rake, arpeggio
 * or strum. Every
 * canonicalizer is idempotent and returns null for values it doesn't
 * understand. Pure functions, no DOM.
 */
import { harmonicOf } from './harmonics.js';
import { parsePitch, midiNumber } from './pitch.js';

/** Label text of a let-ring run. */
export const LET_RING_LABEL = 'let ring';
/** Letter shown above a beat for each tap-style mark (class name = the key). */
export const TAP_MARK_LETTERS = { tap: 'T', slap: 'S', pop: 'P' };
const PICK_KINDS = ['down', 'up'];
const WHAMMY_TYPES = ['dip', 'dive', 'return', 'predive'];
/** Label text of a rake run. */
export const RAKE_LABEL = 'rake';
const DEFAULT_DIP_AMOUNT = '1/2';

/** Whether `el` is a main (non-grace) beat with at least one note. */
export function isMainNoteBeat(el) {
  return !!el && el.type !== 'rest' && el.type !== 'grace' && (el.notes || []).length > 0;
}

/** Canonical pick stroke ('down' | 'up') of a raw `pickStroke` value, or null. Idempotent. */
export function pickStrokeKind(raw) {
  if (typeof raw !== 'string') return null;
  const k = raw.trim().toLowerCase();
  return PICK_KINDS.includes(k) ? k : null;
}

/** Canonical arpeggio of a raw `arpeggio` value: true | 'up' | 'down' (trimmed, any case), or null. Idempotent. */
export function arpeggioOf(raw) {
  if (raw === true) return true;
  if (typeof raw !== 'string') return null;
  const k = raw.trim().toLowerCase();
  return PICK_KINDS.includes(k) ? k : null;
}

/** Canonical strum direction ('down' | 'up') of a raw `strum` value, or null (`true` too). Idempotent. */
export function strumOf(raw) {
  return pickStrokeKind(raw);
}

/** Dip amount text without its sign: trimmed string / finite number, every leading '-' / '−' (and whitespace) removed; '' or invalid → null. */
function dipAmount(raw) {
  let str;
  if (typeof raw === 'string') str = raw;
  else if (typeof raw === 'number' && Number.isFinite(raw)) str = String(raw);
  else return null;
  const a = str.replace(/^[-−\s]+/, '').trim();
  return a || null;
}

/**
 * Canonical whammy mark `{ type, amount }` of a raw `whammy` value, or
 * null: `true` → a '1/2' dip; a string or finite number is a dip's amount;
 * an object takes `type` 'dip' (the default), 'dive', 'return' or 'predive'
 * (trimmed, any case; anything else → null) and the same amount rules, a
 * missing or empty amount meaning '1/2'. Idempotent.
 */
export function whammyOf(raw) {
  if (raw === true) return { type: 'dip', amount: DEFAULT_DIP_AMOUNT };
  if (typeof raw === 'string' || typeof raw === 'number') {
    const amount = dipAmount(raw);
    return amount ? { type: 'dip', amount } : null;
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const type = raw.type == null ? 'dip' : (typeof raw.type === 'string' ? raw.type.trim().toLowerCase() : null);
    if (!WHAMMY_TYPES.includes(type)) return null;
    if (raw.amount == null || (typeof raw.amount === 'string' && !raw.amount.trim())) {
      return { type, amount: DEFAULT_DIP_AMOUNT };
    }
    const amount = dipAmount(raw.amount);
    return amount ? { type, amount } : null;
  }
  return null;
}

/** Canonical whammy dip `{ type: 'dip', amount }` of a raw `whammy` value (whammyOf), or null for any other type. */
export function whammyDip(raw) {
  const w = whammyOf(raw);
  return w && w.type === 'dip' ? w : null;
}

/** Canonical rake of a raw `rake` value: 'down' | 'up' | true, or null (falsy). Idempotent. */
export function rakeOf(raw) {
  if (!raw) return null;
  const k = typeof raw === 'string' ? raw.trim().toLowerCase() : null;
  return PICK_KINDS.includes(k) ? k : true;
}

/**
 * Canonical trill `{ fret, pitch }` of a raw `note.trill` value, or null.
 * `true` → a plain trill (both null); an integer ≥ 1 or its digit string →
 * `fret`; a pitch string ("B3") → `pitch`; an object keeps a non-negative
 * integer `fret` (0 = open string) and a valid `pitch`, else null fields.
 * 0, false, '' and anything else → null. Idempotent.
 */
export function trillOf(raw) {
  if (raw === true) return { fret: null, pitch: null };
  if (typeof raw === 'number') return Number.isInteger(raw) && raw >= 1 ? { fret: raw, pitch: null } : null;
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (/^\d+$/.test(s)) return Number(s) >= 1 ? { fret: Number(s), pitch: null } : null;
    const pitch = trillPitch(s);
    return pitch ? { fret: null, pitch } : null;
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const fret = Number.isInteger(raw.fret) && raw.fret >= 0 ? raw.fret : null;
    return { fret, pitch: typeof raw.pitch === 'string' ? trillPitch(raw.pitch.trim()) : null };
  }
  return null;
}

/** `s` (trimmed) as a pitch with an uppercase step, or null when parsePitch rejects it. */
function trillPitch(s) {
  try { parsePitch(s); } catch { return null; }
  return s[0].toUpperCase() + s.slice(1);
}

/** Text shown with a dip, e.g. "-1/2". */
export function whammyLabel(dip) {
  return `-${dip.amount}`;
}

/** Pick stroke of a beat ('down' | 'up'), or null (none, rest, grace, or a strummed beat). */
export function beatPickStroke(el) {
  return isMainNoteBeat(el) && !strumOf(el.strum) ? pickStrokeKind(el.pickStroke) : null;
}

/** Arpeggio of a beat (true | 'up' | 'down'), or null (none, rest, grace, fewer than two notes). */
export function beatArpeggio(el) {
  return isMainNoteBeat(el) && el.notes.length >= 2 ? arpeggioOf(el.arpeggio) : null;
}

/** Strum direction of a beat ('down' | 'up'), or null (none, rest, grace). */
export function beatStrum(el) {
  return isMainNoteBeat(el) ? strumOf(el.strum) : null;
}

/** Whammy dip of a beat, or null (none, rest, grace, or a whammy of another type). */
export function beatWhammy(el) {
  return isMainNoteBeat(el) ? whammyDip(el.whammy) : null;
}

/** Whammy mark of any type of a beat (whammyOf), or null (none, rest, grace). */
export function beatWhammyAny(el) {
  return isMainNoteBeat(el) ? whammyOf(el.whammy) : null;
}

/** Whether a beat carries a rake. */
export function beatRake(el) {
  return isMainNoteBeat(el) && rakeOf(el.rake) != null;
}

/** First trilled note of a beat with its canonical trill, `{ note, trill }`, or null (none, rest, grace). */
export function beatTrill(el) {
  if (!isMainNoteBeat(el)) return null;
  for (const note of el.notes) {
    const trill = trillOf(note.trill);
    if (trill) return { note, trill };
  }
  return null;
}

/**
 * Fret a trill alternates with on the TAB staff: `trill.fret` when given;
 * else the trill pitch's nearest interval (-5..+6 semitones) from the
 * note's own pitch, applied to `note.fret`; null when that is unknown or
 * negative.
 */
export function trillTabFret(note, trill) {
  if (trill.fret != null) return trill.fret;
  if (!trill.pitch || !Number.isInteger(note.fret)) return null;
  let own;
  try { own = midiNumber(parsePitch(note.soundingPitch ?? note.pitch)); } catch { return null; }
  const d = ((((midiNumber(parsePitch(trill.pitch)) - own) % 12) + 12 + 5) % 12) - 5;
  return note.fret + d >= 0 ? note.fret + d : null;
}

/** Whether a beat shows a tap "T" (some tapped note that isn't a tapped harmonic). */
export function beatTaps(el) {
  return isMainNoteBeat(el) && el.notes.some((n) => n.tap && harmonicOf(n) !== 'tapped');
}

/** Mark of a beat's tap-style letter: 'tap', else 'slap', else 'pop', or null (none, rest, grace). */
export function beatTapMark(el) {
  if (beatTaps(el)) return 'tap';
  if (!isMainNoteBeat(el)) return null;
  if (el.notes.some((n) => n.slap)) return 'slap';
  return el.notes.some((n) => n.pop) ? 'pop' : null;
}

/**
 * `beat` itself unless it has a `pickStroke`, `whammy`, `rake`, `arpeggio`
 * or `strum` field; then a copy with those (present) fields canonicalized
 * (null when not understood).
 */
export function withDirections(beat) {
  const hasPick = beat.pickStroke !== undefined;
  const hasWhammy = beat.whammy !== undefined;
  const hasRake = beat.rake !== undefined;
  const hasArp = beat.arpeggio !== undefined;
  const hasStrum = beat.strum !== undefined;
  if (!hasPick && !hasWhammy && !hasRake && !hasArp && !hasStrum) return beat;
  const out = { ...beat };
  if (hasPick) out.pickStroke = pickStrokeKind(beat.pickStroke);
  if (hasWhammy) out.whammy = whammyOf(beat.whammy);
  if (hasRake) out.rake = rakeOf(beat.rake);
  if (hasArp) out.arpeggio = arpeggioOf(beat.arpeggio);
  if (hasStrum) out.strum = strumOf(beat.strum);
  return out;
}
