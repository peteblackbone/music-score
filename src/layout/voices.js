/**
 * layout/voices.js — the shared columns of a two-voice measure (ui.md "Two
 * voices"): voice 1 (stems up) and voice 2 (stems down) are timed and laid
 * out separately (layout/timeline.js voiceEvents, forced stems); this
 * adjusts the events of both where they meet. Only two-voice measures get
 * here, so single-voice layout is untouched.
 *
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
 * - Extents: the column's left/right extents cover both voices; the own
 *   left extent (where graces start) is the same for both voices.
 *
 * Events are updated in place; chord layouts are replaced by copies, never
 * mutated. All widths are px. Pure functions, no DOM.
 */
import { stemDxSp, accidentalRightSp, placeAccidentalColumns, DOT_GAP_SP, DOT_STEP_SP, DOT_RADIUS_SP } from './chord.js';
import { accidentalGlyph, restForDuration } from '../glyphs.js';
import { glyphBox } from '../glyphMetrics.js';
import { key } from '../rational.js';

const REST_CLEAR_POS = 1;          // rest ink -> other voice's notehead (staff positions; 0.5 sp)
const REST_MAX_STEPS = 20;         // bound on the whole-space moves of one rest
const REST_LEDGER_OVERHANG_SP = 0.3;
const VARIANTS = [
  { chord: 'chord', left: 'left', own: 'ownLeft' },
  { chord: 'chordFirst', left: 'leftFirst', own: 'ownLeftFirst' },
];

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

/** One column where both voices have notes: union accidentals, dots and extents, per variant. */
function pairColumn(e1, el1, e2, el2, s) {
  const shift = clashShift(e1.chord, el1, e2.chord, el2, s);
  e2.dx = shift;
  VARIANTS.forEach((k) => {
    const a = { ...e1[k.chord] };
    const b = { ...e2[k.chord] };
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
 * Combine voice 1's events `ev1` and voice 2's `ev2` (voiceEvents, in beat
 * order of `measure.beats` / `measure.voice2Beats`) in place. Every voice-2
 * main event gets `dx` (px, its chord's clash shift; 0 = none).
 */
export function combineVoices(ev1, ev2, measure, theme) {
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
    const o = ev.wholeMeasureRest ? undefined : at[1 - v].get(key(ev.t));
    placeRest(ev, beats[v][i], v + 1, o === undefined ? null : [ev1, ev2][1 - v][o].chord, s);
  }));
}
