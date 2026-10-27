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
 * - `beat.whammy` true | amount | `{ type: 'dip', amount }`: a whammy-bar
 *   dip on the TAB staff, its amount shown with a leading "-" (`true` and a
 *   missing amount mean '1/2').
 *
 * Rests and grace notes carry no pick stroke, tap or whammy dip. Every
 * canonicalizer is idempotent and returns null for values it doesn't
 * understand. Pure functions, no DOM.
 */
import { harmonicOf } from './harmonics.js';

/** Label text of a let-ring run. */
export const LET_RING_LABEL = 'let ring';
/** Letter shown above a beat for each tap-style mark (class name = the key). */
export const TAP_MARK_LETTERS = { tap: 'T', slap: 'S', pop: 'P' };
const PICK_KINDS = ['down', 'up'];
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
 * Canonical whammy dip `{ type: 'dip', amount }` of a raw `whammy` value, or
 * null: `true` → '1/2'; a string or finite number is the amount; an object
 * needs `type` 'dip' (the default) and takes the same amount rules, a
 * missing or empty amount meaning '1/2'. Idempotent.
 */
export function whammyDip(raw) {
  if (raw === true) return { type: 'dip', amount: DEFAULT_DIP_AMOUNT };
  if (typeof raw === 'string' || typeof raw === 'number') {
    const amount = dipAmount(raw);
    return amount ? { type: 'dip', amount } : null;
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const type = raw.type == null ? 'dip' : (typeof raw.type === 'string' ? raw.type.trim().toLowerCase() : null);
    if (type !== 'dip') return null;
    if (raw.amount == null || (typeof raw.amount === 'string' && !raw.amount.trim())) {
      return { type: 'dip', amount: DEFAULT_DIP_AMOUNT };
    }
    const amount = dipAmount(raw.amount);
    return amount ? { type: 'dip', amount } : null;
  }
  return null;
}

/** Text shown with a dip, e.g. "-1/2". */
export function whammyLabel(dip) {
  return `-${dip.amount}`;
}

/** Pick stroke of a beat ('down' | 'up'), or null (none, rest, grace). */
export function beatPickStroke(el) {
  return isMainNoteBeat(el) ? pickStrokeKind(el.pickStroke) : null;
}

/** Whammy dip of a beat, or null (none, rest, grace). */
export function beatWhammy(el) {
  return isMainNoteBeat(el) ? whammyDip(el.whammy) : null;
}

/** Whether a beat shows a tap "T" (some tapped note that isn't a tapped harmonic). */
export function beatTaps(el) {
  return isMainNoteBeat(el) && el.notes.some((n) => n.tap && harmonicOf(n) !== 'tapped');
}

/**
 * `beat` itself unless it has a `pickStroke` or `whammy` field; then a copy
 * with those (present) fields canonicalized (null when not understood).
 */
export function withDirections(beat) {
  const hasPick = beat.pickStroke !== undefined;
  const hasWhammy = beat.whammy !== undefined;
  if (!hasPick && !hasWhammy) return beat;
  const out = { ...beat };
  if (hasPick) out.pickStroke = pickStrokeKind(beat.pickStroke);
  if (hasWhammy) out.whammy = whammyDip(beat.whammy);
  return out;
}
