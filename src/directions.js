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
 *   (priority tap > leftHandTap > slap > pop, one letter per beat; the
 *   left-hand tap glyph for `note.leftHandTap`, see hands.js);
 * - `beat.whammy` true | amount | `{ type, amount }`, type 'dip' (default),
 *   'dive', 'return' or 'predive': a whammy-bar mark on the TAB staff, its
 *   amount shown with a leading "-" (`true` and a missing amount mean '1/2');
 * - `beat.whammyScoop` (truthy): a whammy scoop into the beat (beatScoop;
 *   a pre-dive on the same beat wins); `beat.whammyBar` (truthy): a "w/bar"
 *   label run on the TAB staff, like let ring;
 * - `beat.rake` (truthy, 'down' | 'up'): a "rake" label run over the beat
 *   and the grace notes right before it;
 * - `note.trill` true | fret | pitch | `{ fret, pitch }`: "tr" and a wavy
 *   line above the beat, continued over the notes it is tied to (trillChain);
 * - `beat.arpeggio` true | 'up' | 'down': a vertical wavy line left of a
 *   chord of two or more notes ('up' / 'down' add an arrowhead);
 * - `beat.strum` 'down' | 'up': a strum arrow above the beat; it replaces
 *   the beat's pick stroke;
 * - `note.slideIn` 'below' | 'above' (true / 'up' = 'below', 'down' =
 *   'above') and `note.slideOut` 'down' | 'up' (true = 'down'): a short
 *   slide into the note from below / above, or off it downward / upward
 *   (slideMarks decides which are drawn; withNoteSlides canonicalizes);
 * - `note.bend`: a bend, pre-bend, release note or compound bend (bendOf);
 * - `note.slide` 'legato' (isLegatoSlide): a slide with a slur, not re-picked.
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
/** Label text of a whammy-bar ("w/bar") run. */
export const WHAMMY_BAR_LABEL = 'w/bar';
/** Letter shown above a beat for each tap-style mark (class name = the key). */
export const TAP_MARK_LETTERS = { tap: 'T', slap: 'S', pop: 'P' };
const PICK_KINDS = ['down', 'up'];
const WHAMMY_TYPES = ['dip', 'dive', 'return', 'predive'];
/** Label text of a rake run. */
export const RAKE_LABEL = 'rake';
const DEFAULT_DIP_AMOUNT = '1/2';

/**
 * Index of the note `items[i]` links to with a hammer-on/pull-off or slide:
 * the first later item on the same `string` (items in score order), or -1
 * (none, or `items[i]` has no string).
 */
export function linkTarget(items, i) {
  const string = items[i].string;
  if (string == null) return -1;
  for (let k = i + 1; k < items.length; k++) if (items[k].string === string) return k;
  return -1;
}

/** Whether a raw `note.slide` is a legato slide: the string 'legato' (trimmed, any case). Any other truthy slide is a shift slide. */
export function isLegatoSlide(raw) {
  return typeof raw === 'string' && raw.trim().toLowerCase() === 'legato';
}

/** Canonical slide-in ('below' | 'above') of a raw `note.slideIn`: true / 'up' / 'below' → 'below', 'down' / 'above' → 'above' (trimmed, any case), else null. Idempotent. */
export function slideInOf(raw) {
  if (raw === true) return 'below';
  if (typeof raw !== 'string') return null;
  const k = raw.trim().toLowerCase();
  if (k === 'up' || k === 'below') return 'below';
  return k === 'down' || k === 'above' ? 'above' : null;
}

/** Canonical slide-out ('down' | 'up') of a raw `note.slideOut`: true / 'down' → 'down', 'up' → 'up' (trimmed, any case), else null. Idempotent. */
export function slideOutOf(raw) {
  if (raw === true) return 'down';
  if (typeof raw !== 'string') return null;
  const k = raw.trim().toLowerCase();
  return PICK_KINDS.includes(k) ? k : null;
}

/** `note` itself unless it has a `slideIn` or `slideOut` field; then a copy with those (present) fields canonicalized (null when not understood). */
export function withNoteSlides(note) {
  const hasIn = note.slideIn !== undefined;
  const hasOut = note.slideOut !== undefined;
  if (!hasIn && !hasOut) return note;
  const out = { ...note };
  if (hasIn) out.slideIn = slideInOf(note.slideIn);
  if (hasOut) out.slideOut = slideOutOf(note.slideOut);
  return out;
}

/**
 * Slide-in / slide-out marks drawn for `items` (one per note of a track, in
 * score order: `{ string, slide, hammerPull, bend, slideIn, slideOut, grace }`),
 * `[{ slideIn, slideOut }]` (canonical or null). A grace note gets neither;
 * a slide-out is dropped when the note's own `slide` reaches a target or it
 * bends; a slide-in when the note is the target of an earlier slide or
 * hammer-on / pull-off (linkTarget; notes without a string are never targets).
 */
export function slideMarks(items) {
  const targeted = new Set();
  items.forEach((it, i) => {
    if (it.slide || it.hammerPull) targeted.add(linkTarget(items, i));
  });
  return items.map((it, i) => (it.grace ? { slideIn: null, slideOut: null } : {
    slideIn: targeted.has(i) ? null : slideInOf(it.slideIn),
    slideOut: (it.slide && linkTarget(items, i) >= 0) || it.bend ? null : slideOutOf(it.slideOut),
  }));
}

/**
 * A note's `bend` as `{ type, amount, release, hold }`, or null (falsy).
 * `type`: 'bend' (bent after picking), 'prebend' (bent before picking:
 * 'prebend' | 'pre-bend' | 'pb' + amount, optionally + ' release') or
 * 'release' (its own note returning to the unbent pitch: 'release' +
 * optional amount; `release` is always true, `amount` null when not given).
 * Other strings: the amount (empty → 'full'), optionally + ' release' (a
 * bend-and-release) or ' hold'. `true` and other non-objects → a full
 * bend. An object takes `type` ('bend', 'prebend' / 'pb' / 'pre-bend',
 * 'release'; trimmed, any case; else 'bend'), `amount` (as a string; else
 * 'full', or null for a release) and `release` / `hold` flags (`hold`
 * only on a plain bend that doesn't release).
 * A compound bend (bend-release-bend, or with a 'pb' prefix
 * pre-bend-release-bend), '<a> release <b>' or an object's `rebend`
 * (not on a release note), also has `rebend` (the second bend's amount)
 * with `release: true`, `hold: false`; other bends have no `rebend` key.
 */
/**
 * Split a trailing ' release' / ' hold' word (any case) off a bend string:
 * [rest (trimmed), 'release' | 'hold' | null]. `whole` also accepts the word
 * with nothing before it (a pre-bend's 'release'). A plain scan rather than
 * /\s+release$/, whose backtracking is quadratic on long runs of spaces.
 */
function splitBendSuffix(str, whole) {
  let i = str.length;
  while (i > 0 && !/\s/.test(str[i - 1])) i--;
  const word = str.slice(i).toLowerCase();
  if ((word === 'release' || word === 'hold') && (i > 0 || whole)) return [str.slice(0, i).trim(), word];
  return [str.trim(), null];
}

/**
 * A compound bend string's `{ amount, release: true, hold: false, rebend }`
 * ('<a> release <b>': exactly one 'release' word (any case) with words on
 * both sides and no 'hold' after it), or null. One linear split.
 */
function splitCompoundBend(str) {
  const tokens = str.split(/\s+/);
  const lower = tokens.map((t) => t.toLowerCase());
  const i = lower.indexOf('release');
  if (i <= 0 || i >= tokens.length - 1 || lower.indexOf('release', i + 1) >= 0 || lower.indexOf('hold', i + 1) >= 0) return null;
  return { amount: tokens.slice(0, i).join(' '), release: true, hold: false, rebend: tokens.slice(i + 1).join(' ') };
}

export function bendOf(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    const pre = /^(prebend|pre-bend|pb)\b\s*(.*)$/i.exec(trimmed);
    if (pre) {
      const compound = splitCompoundBend(pre[2]);
      if (compound) return { type: 'prebend', ...compound };
      const [rest, word] = splitBendSuffix(pre[2], true);
      return { type: 'prebend', amount: rest || 'full', release: word === 'release', hold: false };
    }
    const rel = /^release\b\s*(.*)$/i.exec(trimmed);
    if (rel) return { type: 'release', amount: rel[1] || null, release: true, hold: false };
    const compound = splitCompoundBend(trimmed);
    if (compound) return { type: 'bend', ...compound };
    const [rest, word] = splitBendSuffix(trimmed, false);
    return { type: 'bend', amount: rest || 'full', release: word === 'release', hold: word === 'hold' };
  }
  if (typeof raw === 'object') {
    const t = typeof raw.type === 'string' ? raw.type.trim().toLowerCase() : '';
    const type = ['prebend', 'pb', 'pre-bend'].includes(t) ? 'prebend' : (t === 'release' ? 'release' : 'bend');
    const release = type === 'release' || !!raw.release;
    const amount = raw.amount ? String(raw.amount) : (type === 'release' ? null : 'full');
    // Only a string or a finite number counts as a second bend; anything else (or blank) is no rebend.
    const rebend = (typeof raw.rebend === 'string' || Number.isFinite(raw.rebend)) && raw.rebend !== 0 ? String(raw.rebend).trim() : '';
    if (rebend && type !== 'release') return { type, amount, release: true, hold: false, rebend };
    return {
      type,
      amount,
      release,
      hold: type === 'bend' && !release && !!raw.hold,
    };
  }
  return { type: 'bend', amount: 'full', release: false, hold: false };
}

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

/** Whether a beat has a whammy scoop: a main note beat with `whammyScoop` and no pre-dive. */
export function beatScoop(el) {
  return isMainNoteBeat(el) && !!el.whammyScoop && whammyOf(el.whammy)?.type !== 'predive';
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

/** Whether tied-to note `b` continues note `a`: the same written MIDI number when both have a pitch, else the same string and fret. */
function continuesNote(a, b) {
  if (a.pitch != null && b.pitch != null) {
    try { return midiNumber(parsePitch(a.pitch)) === midiNumber(parsePitch(b.pitch)); } catch { return false; }
  }
  return a.string != null && a.string === b.string && a.fret === b.fret;
}

/**
 * Indices of the beats of one voice stream `els` (beat elements in score
 * order; null where the stream leaves the voice) that the trill on
 * `els[i]` continues over: from its trilled note (beatTrill), each later
 * beat with a `tieEnd` note continuing the current one (same written MIDI
 * number, or same string and fret without pitches), which then becomes
 * current. Grace notes are skipped; a null entry, a beat that isn't a main
 * note beat, a beat with its own trill or one with no such note ends the
 * chain. [] when `els[i]` has no trill or nothing is tied to it.
 */
export function trillChain(els, i) {
  const t = beatTrill(els[i]);
  if (!t) return [];
  const out = [];
  let cur = t.note;
  for (let k = i + 1; k < els.length; k++) {
    const el = els[k];
    if (el && el.type === 'grace') continue;
    if (!isMainNoteBeat(el) || beatTrill(el)) break;
    const next = el.notes.find((n) => n.tieEnd && continuesNote(cur, n));
    if (!next) break;
    out.push(k);
    cur = next;
  }
  return out;
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

/**
 * Mark of a beat's tap-style letter: 'tap', else 'leftHandTap' (a left-hand
 * tapped note that isn't a tapped harmonic), else 'slap', else 'pop', or
 * null (none, rest, grace).
 */
export function beatTapMark(el) {
  if (beatTaps(el)) return 'tap';
  if (!isMainNoteBeat(el)) return null;
  if (el.notes.some((n) => n.leftHandTap && harmonicOf(n) !== 'tapped')) return 'leftHandTap';
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
