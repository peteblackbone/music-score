/**
 * layout/voices.js — the shared columns of a two-voice measure (ui.md "Two
 * voices"): voice 1 (stems up) and voice 2 (stems down) are timed and laid
 * out separately (layout/timeline.js voiceEvents, forced stems); this
 * adjusts the events of both where they meet. Only two-voice measures get
 * here, so single-voice layout is untouched.
 *
 * - Shared unison head (sharedHead): voice 1's lowest and voice 2's highest
 *   note are the same written pitch with the same accidental (or none on
 *   voice 2's, the carry being shared), head glyph,
 *   mute / ghost and dots, every other head at least a third away and no
 *   head displaced: voice 2 stays at the column x (`dx` 0), its head there
 *   is `shared` (drawn once, by voice 1), its accidental and its dot on
 *   that position dropped; the stems sit on either side of the one head.
 * - Notehead clash (both voices have notes at one onset and voice 2's top
 *   note is at most a second below voice 1's bottom note, a unison or
 *   crossed): voice 2's chord moves right (`ev.dx`, px) so its down-stem
 *   shares voice 1's up-stem x; stemless (whole) heads just touch; one more
 *   head width per displaced second on the inner side.
 * - Accidentals: wherever both voices have notes at one onset, one stack
 *   for the union of both voices' accidentals, left of every head
 *   (placeAccidentalColumns).
 * - Dots: voice 2 puts a line note's dot in the space below; on a clash one
 *   dot column right of both voices' heads, a voice-2 dot on a voice-1
 *   dot's position moving down one more space.
 * - Rests: voice 1 at pos 8, voice 2 at pos 0 (whole rest: 2), moved
 *   outward in whole spaces until 0.5 sp clear of the other voice's
 *   noteheads at the same onset (`ev.restPos`); a whole/half rest on a
 *   line outside the staff gets a ledger line (`ev.restLedger`).
 * - Merged rests (mergedRestPairs: both voices rest at one onset with the
 *   same duration, dots and length, neither hidden, both or neither
 *   whole-measure): one rest, voice 1's, at the single-voice position (no
 *   `restPos`); both events get `ev.restMerged` and voice 2's draws nothing.
 * - Extents: the column's left/right extents cover both voices; the own
 *   left extent (where graces start) is the same for both voices.
 * - TAB columns (tabColumnMarks): voice 2's beat as drawn on TAB
 *   (`tabEl`), and which voice supplies each TAB mark of a column.
 *
 * Events are updated in place; chord layouts are replaced by copies, never
 * mutated. All widths are px. Pure functions, no DOM.
 */
import { stemDxSp, accidentalRightSp, placeAccidentalColumns, DOT_GAP_SP, DOT_STEP_SP, DOT_RADIUS_SP } from './chord.js';
import { accidentalGlyph, restForDuration } from '../glyphs.js';
import { glyphBox } from '../glyphMetrics.js';
import { R, ZERO, add, cmp, key } from '../rational.js';
import { durationR, isHiddenRest } from '../duration.js';
import { parsePitch } from '../pitch.js';
import { beatTrill, beatTapMark, beatPickStroke, beatStrum } from '../directions.js';
import { beatGolpe, rightFingerStack } from '../hands.js';
import { tremoloOf, vibratoOf } from '../noteEffects.js';

const REST_CLEAR_POS = 1;          // rest ink -> other voice's notehead (staff positions; 0.5 sp)
const REST_MAX_STEPS = 20;         // bound on the whole-space moves of one rest
export const REST_LEDGER_OVERHANG_SP = 0.3; // ledger reach past a raised rest; also used by draw/notation.js
const VARIANTS = [
  { chord: 'chord', left: 'left', own: 'ownLeft' },
  { chord: 'chordFirst', left: 'leftFirst', own: 'ownLeftFirst' },
];

// TAB mark categories of a column (ui.md §3) and whether a beat has one; a strum takes voice 1's pick slot.
const TAB_MARKS = {
  tremolo: (b) => !!tremoloOf(b.tremolo),
  vibrato: (b) => !!vibratoOf(b.vibrato),
  trill: (b) => !!beatTrill(b),
  tap: (b) => !!beatTapMark(b),
  golpe: (b) => !!beatGolpe(b),
  right: (b) => !!rightFingerStack(b),
  pick: (b, v1) => !!beatPickStroke(b) || (v1 && !!beatStrum(b)),
};

const onLine = (pos) => ((pos % 2) + 2) % 2 === 0;
const uniqueSorted = (ps) => [...new Set(ps)].sort((a, b) => a - b);
const headRight = (c) => Math.max(...c.heads.map((h) => h.dx + h.width / 2));

/** Staff position of a rest of voice `voice` (1 | 2), clear of the other voice's chord `other` (or null). */
function restPosition(el, voice, other) {
  const box = glyphBox(restForDuration(el.duration));
  let pos = voice === 1 ? 8 : (el.duration === 'whole' ? 2 : 0);
  if (!other) return pos;
  if (voice === 1) {
    const top = Math.max(...other.heads.map((h) => h.pos + 2 * glyphBox(h.glyph).top));
    for (let i = 0; i < REST_MAX_STEPS && pos + 2 * box.bottom < top + REST_CLEAR_POS; i++) pos += 2;
  } else {
    const bottom = Math.min(...other.heads.map((h) => h.pos + 2 * glyphBox(h.glyph).bottom));
    for (let i = 0; i < REST_MAX_STEPS && pos + 2 * box.top > bottom - REST_CLEAR_POS; i++) pos -= 2;
  }
  return pos;
}

/** Rest position (and ledger line / extents) of rest event `ev` of voice `voice`. */
function placeRest(ev, el, voice, other, s) {
  ev.restPos = restPosition(el, voice, ev.wholeMeasureRest ? null : other);
  if ((el.duration === 'whole' || el.duration === 'half') && (ev.restPos >= 10 || ev.restPos <= -2)) {
    ev.restLedger = ev.restPos;
    const half = (glyphBox(restForDuration(el.duration)).width / 2 + REST_LEDGER_OVERHANG_SP) * s;
    ev.left = Math.max(ev.left, half); ev.ownLeft = Math.max(ev.ownLeft, half);
    ev.leftFirst = Math.max(ev.leftFirst, half); ev.ownLeftFirst = Math.max(ev.ownLeftFirst, half);
    ev.right = Math.max(ev.right, half);
  }
}

/** Voice 2's chord: a line note's dot goes in the space below. */
function dotsBelow(c) {
  return { ...c, dots: { ...c.dots, positions: uniqueSorted(c.heads.map((h) => (onLine(h.pos) ? h.pos - 1 : h.pos))) } };
}

/** Clash shift (px) of voice 2's chord `c2` against voice 1's `c1` (0 = none). */
function clashShift(c1, el1, c2, el2, s) {
  const minPos1 = Math.min(...c1.heads.map((h) => h.pos));
  const maxPos2 = Math.max(...c2.heads.map((h) => h.pos));
  if (maxPos2 < minPos1 - 1) return 0;
  let shift = el1.duration === 'whole' || el2.duration === 'whole'
    ? (c1.headWidth + c2.headWidth) / 2
    : (stemDxSp(c1.stemGlyph, true) - stemDxSp(c2.stemGlyph, false)) * s;
  if (c1.heads.some((h) => h.dx > c1.headWidth / 2)) shift += c1.headWidth;
  if (c2.heads.some((h) => h.dx < -c2.headWidth / 2)) shift += c2.headWidth;
  return shift;
}

/**
 * Index of voice 2's note that shares voice 1's notehead (see the header),
 * or -1. Both events are main note beats at one onset.
 */
function sharedHead(e1, el1, e2, el2) {
  if ((el1.dots || 0) !== (el2.dots || 0)) return -1;
  const n1 = el1.notes || []; const n2 = el2.notes || [];
  const c1 = e1.chord; const c2 = e2.chord;
  if (![e1.chord, e1.chordFirst, e2.chord, e2.chordFirst].every((c) => c.heads.every((h) => h.dx === 0))) return -1;
  const lo = Math.min(...c1.heads.map((h) => h.pos));
  const hi = Math.max(...c2.heads.map((h) => h.pos));
  if (lo !== hi) return -1;
  const i1 = c1.heads.findIndex((h) => h.pos === lo);
  const i2 = c2.heads.findIndex((h) => h.pos === hi);
  if (c1.heads.some((h, i) => i !== i1 && h.pos < lo + 2) || c2.heads.some((h, i) => i !== i2 && h.pos > hi - 2)) return -1;
  const a = n1[c1.heads[i1].noteIndex] || {}; const b = n2[c2.heads[i2].noteIndex] || {};
  if (a.pitch == null || b.pitch == null) return -1;
  const p = parsePitch(a.pitch); const q = parsePitch(b.pitch);
  if (p.step !== q.step || p.alter !== q.alter || p.octave !== q.octave) return -1;
  if (c1.heads[i1].glyph !== c2.heads[i2].glyph || !!a.mute !== !!b.mute || !!a.ghost !== !!b.ghost) return -1;
  // One carry for both voices (layout/accidentals.js): voice 2 shows no accidental voice 1 just showed at this onset.
  const accOf = (c, i) => c.accidentals.find((x) => x.noteIndex === c.heads[i].noteIndex)?.name ?? null;
  const sameAcc = (c1v, c2v) => accOf(c2v, i2) === null || accOf(c2v, i2) === accOf(c1v, i1);
  if (!sameAcc(e1.chord, e2.chord) || !sameAcc(e1.chordFirst, e2.chordFirst)) return -1;
  return c2.heads[i2].noteIndex;
}

/** Voice 2's chord with note `ni`'s head shared: flagged, its accidental and its own dot position dropped. */
function withSharedHead(c, ni) {
  const heads = c.heads.map((h) => (h.noteIndex === ni ? { ...h, shared: true } : h));
  const dotPos = (h) => (onLine(h.pos) ? h.pos - 1 : h.pos);
  const own = dotPos(c.heads.find((h) => h.noteIndex === ni));
  const positions = c.dots.positions.filter((p) => p !== own || heads.some((h) => !h.shared && dotPos(h) === p));
  return { ...c, heads, accidentals: c.accidentals.filter((x) => x.noteIndex !== ni), dots: { ...c.dots, positions } };
}

/** One column where both voices have notes: union accidentals, dots and extents, per variant. */
function pairColumn(e1, el1, e2, el2, s) {
  const shared = sharedHead(e1, el1, e2, el2);
  const shift = shared === -1 ? clashShift(e1.chord, el1, e2.chord, el2, s) : 0;
  e2.dx = shift;
  VARIANTS.forEach((k) => {
    const a = { ...e1[k.chord] };
    const b = shared === -1 ? { ...e2[k.chord] } : withSharedHead(e2[k.chord], shared);
    const items = [
      ...a.accidentals.map((x) => ({ key: `1:${x.noteIndex}`, name: x.name, pos: a.heads[x.noteIndex].pos, w: glyphBox(accidentalGlyph(x.name)).width })),
      ...b.accidentals.map((x) => ({ key: `2:${x.noteIndex}`, name: x.name, pos: b.heads[x.noteIndex].pos, w: glyphBox(accidentalGlyph(x.name)).width })),
    ];
    if (items.length) {
      const rightOf = (c, el) => accidentalRightSp(el.notes || [], c.heads.map((h) => h.dx / s), c.heads.map((h) => h.width / s));
      const placed = placeAccidentalColumns(items, Math.min(rightOf(a, el1), shift / s + rightOf(b, el2)));
      const ofVoice = (v, dx0) => placed.filter((p) => p.key[0] === v).map((p) => ({ noteIndex: +p.key.slice(2), name: p.name, dx: p.dx * s - dx0 }));
      a.accidentals = ofVoice('1', 0);
      b.accidentals = ofVoice('2', shift);
      a.leftExt = Math.max(a.leftExt, ...placed.map((p) => -p.dx * s));
      b.leftExt = Math.max(b.leftExt, ...b.accidentals.map((x) => -x.dx));
    }
    if (shift && (el1.dots || el2.dots)) {
      const dotDx = Math.max(headRight(a), shift + headRight(b)) + DOT_GAP_SP * s;
      a.dots = { ...a.dots, dx: dotDx };
      b.dots = { ...b.dots, dx: dotDx - shift };
      if (el1.dots && el2.dots) b.dots.positions = uniqueSorted(b.dots.positions.map((p) => (a.dots.positions.includes(p) ? p - 2 : p)));
      const reach = (n) => (DOT_STEP_SP * (n - 1) + DOT_RADIUS_SP) * s;
      if (el1.dots) a.rightExt = Math.max(a.rightExt, dotDx + reach(el1.dots));
      if (el2.dots) b.rightExt = Math.max(b.rightExt, dotDx - shift + reach(el2.dots));
    }
    // Both voices' graces start left of the whole column.
    const lead1 = e1[k.left] - e1[k.own];
    const lead2 = e2[k.left] - e2[k.own];
    const own = Math.max(e1[k.own], a.leftExt, e2[k.own], b.leftExt - shift);
    e1[k.own] = own; e1[k.left] = own + lead1;
    e2[k.own] = own; e2[k.left] = own + lead2;
    e1.right = Math.max(e1.right, a.rightExt);
    e2.right = Math.max(e2.right, shift + b.rightExt);
    e1[k.chord] = a; e2[k.chord] = b;
  });
}

/**
 * TAB columns of a two-voice measure's layout elements (`elements` voice
 * 1, `elements2` voice 2), in place. Every voice-2 element gets `tabEl`,
 * its beat as drawn on TAB: no beat-level marks, no note on a string voice
 * 1 frets at the same onset. At a voice-2 note's onset where voice 1 plays
 * a note, voice 1 wins each TAB mark category (TAB_MARKS) it has and a
 * category only voice 2 has is drawn from voice 2's beat in voice 1's
 * slot: voice 1's element gets `tabMarks` `{ [category]: beat, topString? }`
 * when voice 2 supplies one, or when a tremolo / vibrato column has a
 * voice-2 fret above voice 1's (`topString`: the column's top string). At
 * an onset without a voice-1 note (nothing, or a rest) the voice-2 element
 * is its own column (`tabOwn: true`), its `tabEl` keeping tremolo and
 * vibrato. Strum and whammy stay voice 1's.
 */
export function tabColumnMarks(elements, elements2) {
  const fretted = new Map();
  const v1At = new Map();
  elements.forEach((le) => {
    if (!le.t) return;
    const set = fretted.get(key(le.t)) || new Set();
    (le.el.notes || []).forEach((n) => { if (n.string != null && n.fret != null) set.add(n.string); });
    fretted.set(key(le.t), set);
    if (!le.wholeMeasureRest && !isHiddenRest(le.el)) v1At.set(key(le.t), le);
  });
  const strings = (notes) => notes.filter((n) => n.string != null && n.fret != null).map((n) => n.string);
  elements2.forEach((le) => {
    const { type, duration, dots, tuplet } = le.el;
    const taken = le.t && !le.wholeMeasureRest ? fretted.get(key(le.t)) : null;
    // `tuplets` only when the beat has it: the key stays absent otherwise, so pre-1.12 snapshots / model hashes don't change
    le.tabEl = { type, duration, dots, tuplet, ...(le.el.tuplets !== undefined ? { tuplets: le.el.tuplets } : {}), notes: (le.el.notes || []).filter((n) => !taken || !taken.has(n.string)) };
    if (!le.t || le.wholeMeasureRest || type !== 'note') return;
    const v1 = v1At.get(key(le.t));
    if (!v1 || v1.el.type !== 'note') {
      le.tabOwn = true;
      if (le.el.tremolo !== undefined) le.tabEl.tremolo = le.el.tremolo;
      if (le.el.vibrato !== undefined) le.tabEl.vibrato = le.el.vibrato;
      return;
    }
    const marks = {};
    Object.entries(TAB_MARKS).forEach(([cat, has]) => { if (!has(v1.el, true) && has(le.el, false)) marks[cat] = le.el; });
    const s1 = strings(v1.el.notes || []); const s2 = strings(le.tabEl.notes);
    const wavy = ['tremolo', 'vibrato'].some((cat) => TAB_MARKS[cat](marks[cat] || v1.el));
    const higher = wavy && s2.length && Math.min(...s2) < Math.min(...s1);
    if (!Object.keys(marks).length && !higher) return;
    v1.tabMarks = higher ? { ...marks, topString: Math.min(...s1, ...s2) } : marks;
  });
}

/**
 * Merged rest pairs of a two-voice measure (see the header): `{ v1, v2 }`,
 * Sets of beat indices into `beats1` / `beats2`. Onsets are exact (hidden
 * rests take time, graces none); `ts` is the measure's time signature.
 */
export function mergedRestPairs(beats1, beats2, ts) {
  const bar = R(ts.beats, ts.beatType);
  const restsAt = (beats) => {
    const mains = beats.filter((b) => b.type !== 'grace');
    const whole = mains.length === 1 && mains[0].type === 'rest' && cmp(durationR(mains[0]), bar) >= 0;
    const out = new Map();
    let t = ZERO;
    beats.forEach((b, i) => {
      if (b.type === 'grace') return;
      if (b.type === 'rest' && !isHiddenRest(b)) out.set(key(t), { i, b, whole });
      t = add(t, durationR(b));
    });
    return out;
  };
  const a = restsAt(beats1); const b = restsAt(beats2);
  const v1 = new Set(); const v2 = new Set();
  a.forEach((r1, k) => {
    const r2 = b.get(k);
    if (!r2 || r1.whole !== r2.whole || r1.b.duration !== r2.b.duration || (r1.b.dots || 0) !== (r2.b.dots || 0)) return;
    if (key(durationR(r1.b)) !== key(durationR(r2.b))) return; // tuplet ratio
    v1.add(r1.i); v2.add(r2.i);
  });
  return { v1, v2 };
}

/**
 * Combine voice 1's events `ev1` and voice 2's `ev2` (voiceEvents, in beat
 * order of `measure.beats` / `measure.voice2Beats`) in place. Every voice-2
 * main event gets `dx` (px, its chord's clash shift; 0 = none). `merged`
 * (mergedRestPairs) are the merged rests: no `restPos`, `restMerged: true`.
 */
export function combineVoices(ev1, ev2, measure, theme, merged = { v1: new Set(), v2: new Set() }) {
  const s = theme.staffLineSpacing;
  const beats = [measure.beats, measure.voice2Beats];
  const main = (ev) => !ev.grace && !ev.hidden;
  const at = [new Map(), new Map()];
  [ev1, ev2].forEach((evs, v) => evs.forEach((ev, i) => { if (main(ev) && !ev.wholeMeasureRest) at[v].set(key(ev.t), i); }));
  ev2.forEach((e2, j) => {
    if (!main(e2)) return;
    e2.dx = 0;
    if (e2.chord) {
      e2.chord = dotsBelow(e2.chord);
      e2.chordFirst = dotsBelow(e2.chordFirst);
    }
    const i = e2.wholeMeasureRest ? undefined : at[0].get(key(e2.t));
    if (i !== undefined && ev1[i].chord && e2.chord) pairColumn(ev1[i], beats[0][i], e2, beats[1][j], s);
  });
  [ev1, ev2].forEach((evs, v) => evs.forEach((ev, i) => {
    if (!main(ev) || beats[v][i].type !== 'rest') return;
    if ((v ? merged.v2 : merged.v1).has(i)) { ev.restMerged = true; return; }
    const o = ev.wholeMeasureRest ? undefined : at[1 - v].get(key(ev.t));
    placeRest(ev, beats[v][i], v + 1, o === undefined ? null : [ev1, ev2][1 - v][o].chord, s);
  }));
}
