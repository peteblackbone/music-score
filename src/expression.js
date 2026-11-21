/**
 * expression.js — canonical forms of the 1.10 expression fields of a beat:
 * `hairpin`, `fade`, `wah`, `ottava` and `tempo`. Pure functions: anything
 * not understood is null, nothing throws. Strings are trimmed and
 * lower-cased before matching. The raw beat fields pass through
 * normalize.js unchanged (like `beat.text`); drawing canonicalizes them.
 *
 * - hairpinOf: 'cresc' | 'crescendo' | '<' -> 'cresc'; 'dim' | 'diminuendo'
 *   | 'decresc' | 'decrescendo' | '>' -> 'dim'
 * - fadeOf: 'in' | 'out' | 'swell'
 * - wahOf: 'open' | 'o' -> 'open'; 'closed' | 'close' | '+' -> 'closed'
 * - ottavaOf: '8va' | '8vb' | '15ma' | '15mb'
 * - tempoOf: a number (bpm) or `{ bpm, unit, dots, text }` -> `{ bpm, unit,
 *   dots, text }`: bpm finite in (0, 1000]; unit 'whole' | 'half' |
 *   'quarter' | '8th' | '16th' | '32nd' (default 'quarter'); dots an integer
 *   clamped to 0..2; text trimmed (empty -> null)
 *
 * Ottava display shift (ottavaKinds / withOttavaShifts): notes inside an
 * ottava run are drawn 1 or 2 octaves toward the staff (OTTAVA_SHIFT, in
 * staff positions); the written pitch, sounding pitch and frets are
 * untouched. normalize.js adds `ottavaShift` to the notes of tracks that
 * have a valid `beat.ottava` only; pitch.js notePosition / displayPitch
 * read it.
 */
import { durationR } from './duration.js';
import { ZERO, add, cmp } from './rational.js';

const HAIRPINS = {
  cresc: 'cresc', crescendo: 'cresc', '<': 'cresc',
  dim: 'dim', diminuendo: 'dim', decresc: 'dim', decrescendo: 'dim', '>': 'dim',
};
const FADES = { in: 'in', out: 'out', swell: 'swell' };
const WAHS = { open: 'open', o: 'open', closed: 'closed', close: 'closed', '+': 'closed' };
const OTTAVAS = { '8va': '8va', '8vb': '8vb', '15ma': '15ma', '15mb': '15mb' };
const TEMPO_UNITS = ['whole', 'half', 'quarter', '8th', '16th', '32nd'];
const MAX_BPM = 1000;
const MAX_TEMPO_DOTS = 2;

/** Staff-position shift of the notes inside an ottava run, as displayed (the written pitch is untouched). */
export const OTTAVA_SHIFT = { '8va': -7, '15ma': -14, '8vb': 7, '15mb': 14 };

/** `raw` trimmed and lower-cased looked up in `table` (own keys only), or null. */
function lookup(table, raw) {
  if (typeof raw !== 'string') return null;
  const k = raw.trim().toLowerCase();
  return Object.hasOwn(table, k) ? table[k] : null;
}

export const hairpinOf = (raw) => lookup(HAIRPINS, raw);
export const fadeOf = (raw) => lookup(FADES, raw);
export const wahOf = (raw) => lookup(WAHS, raw);
export const ottavaOf = (raw) => lookup(OTTAVAS, raw);

/** A number, or a non-empty numeric string, as a number; else NaN. */
function numberOf(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') return Number(v);
  return NaN;
}

/** Canonical tempo change of `beat.tempo` (see the header), or null. */
export function tempoOf(raw) {
  const obj = raw != null && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  const bpm = numberOf(obj ? obj.bpm : raw);
  if (!Number.isFinite(bpm) || bpm <= 0 || bpm > MAX_BPM) return null;
  if (!obj) return { bpm, unit: 'quarter', dots: 0, text: null };
  const unit = typeof obj.unit === 'string' && TEMPO_UNITS.includes(obj.unit.trim().toLowerCase()) ? obj.unit.trim().toLowerCase() : 'quarter';
  const d = numberOf(obj.dots);
  const dots = Number.isFinite(d) && d > 0 ? Math.min(MAX_TEMPO_DOTS, Math.floor(d)) : 0;
  const text = typeof obj.text === 'string' && obj.text.trim() ? obj.text.trim() : null;
  return { bpm, unit, dots, text };
}

/** "= N" number of a tempo mark: at most 2 decimals, trailing zeros stripped (120, 92.5, 60.33). */
export function formatBpm(bpm) {
  return String(Math.round(bpm * 100) / 100);
}

/** Whether every note of a main beat is a tied continuation (and it has at least one). */
const allTied = (b) => b.type !== 'rest' && (b.notes || []).length > 0 && b.notes.every((n) => n.tieEnd);

/**
 * Kinds of one voice's beats: main beats from `mainKind(b, prev, t, dur)`
 * (prev = the previous main beat's kind, carried in `state.prev`), graces
 * the kind of the main beat they lead into (trailing graces: the last main
 * beat's). Returns the per-beat kinds (null outside a run).
 */
function voiceKinds(beats, state, mainKind) {
  const kinds = beats.map(() => null);
  let t = ZERO;
  let pending = [];
  let last = null;
  beats.forEach((b, i) => {
    if (b.type === 'grace') { pending.push(i); return; }
    let dur = null;
    try { dur = durationR(b); } catch { dur = null; }
    const k = mainKind(b, state.prev, t, dur);
    kinds[i] = k;
    pending.forEach((g) => { kinds[g] = k; });
    pending = [];
    state.prev = k;
    last = k;
    if (dur) t = add(t, dur);
  });
  pending.forEach((g) => { kinds[g] = last; });
  return kinds;
}

/**
 * Ottava kind ('8va' | '8vb' | '15ma' | '15mb' | null) of every beat of a
 * normalized track: `[{ v1: kind[], v2: kind[] }]` per measure, indexed like
 * `measure.beats` / `measure.voice2Beats` (v2 empty without a voice 2).
 * - voice 1: a main beat's own ottavaOf(beat.ottava) (rests count, hidden
 *   too); without one, a beat whose notes are all tied continuations
 *   inherits the previous main beat's kind (chains, across barlines);
 * - voice 2: a main beat takes the kind of the voice-1 main beat covering
 *   its onset, else inherits through ties like voice 1;
 * - graces take the kind of the main beat they lead into (trailing graces
 *   the measure's last main beat's); an empty measure ends every run.
 */
export function ottavaKinds(track) {
  const s1 = { prev: null };
  const s2 = { prev: null };
  return (track.measures || []).map((m) => {
    const beats = m.beats || [];
    if (!beats.some((b) => b.type !== 'grace')) { s1.prev = null; s2.prev = null; }
    const spans = [];
    const v1 = voiceKinds(beats, s1, (b, prev, t, dur) => {
      const k = ottavaOf(b.ottava) || (prev && allTied(b) ? prev : null);
      if (dur) spans.push({ t, end: add(t, dur), k });
      return k;
    });
    const beats2 = m.voice2Beats || [];
    if (!beats2.length) s2.prev = null;
    const v2 = voiceKinds(beats2, s2, (b, prev, t) => {
      const cover = spans.find((sp) => cmp(sp.t, t) <= 0 && cmp(t, sp.end) < 0);
      return (cover && cover.k) || (prev && allTied(b) ? prev : null);
    });
    return { v1, v2 };
  });
}

/**
 * `track` with `ottavaShift` (OTTAVA_SHIFT of its beat's kind, ottavaKinds)
 * on every pitched note inside an ottava run; measures, beats and notes are
 * copied where they change. Returns `track` itself when no voice-1 main
 * beat has a valid `ottava`.
 */
export function withOttavaShifts(track) {
  const has = (track.measures || []).some((m) => (m.beats || []).some((b) => b.type !== 'grace' && ottavaOf(b.ottava)));
  if (!has) return track;
  const kinds = ottavaKinds(track);
  const shiftBeats = (beats, ks) => beats.map((b, i) => {
    const k = ks[i];
    if (!k || !(b.notes || []).some((n) => n.pitch != null)) return b;
    return { ...b, notes: b.notes.map((n) => (n.pitch != null ? { ...n, ottavaShift: OTTAVA_SHIFT[k] } : n)) };
  });
  return {
    ...track,
    measures: track.measures.map((m, mi) => ({
      ...m,
      beats: shiftBeats(m.beats || [], kinds[mi].v1),
      ...(m.voice2Beats ? { voice2Beats: shiftBeats(m.voice2Beats, kinds[mi].v2) } : {}),
    })),
  };
}
