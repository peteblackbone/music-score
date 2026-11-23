/**
 * model/transpose.js — the 2.3.1 transpose command (Ctrl+Up / Down ±1
 * semitone, Ctrl+Shift+Up / Down ±12): `transpose(score, cursor, state,
 * ctx, semis)`.
 *
 * A note that fits stays on its string: only `fret` changes (and an
 * integer `harmonicFret` by the same amount); `pitch` is removed from every
 * changed note, `mute`, `harmonic` and other effects are kept. 2.3.3: a
 * note whose fret would leave 0..ctx.maxFret moves to the nearest free
 * string that plays the same pitch (stringMove.js), keeping its effects; a
 * harmonic (or a note without a string) never moves. All or nothing: when
 * any note can't be placed nothing changes and the first measure with a
 * problem is named.
 * - No selection: the voice-1 note on the cursor string of a TAB track; its
 *   ties are removed (both partners); the cursor follows a moved note.
 * - With a selection (TAB staff or not): every voice-1 note with a fret on
 *   the selected non-rest beats, graces included; notes without a fret
 *   (pitch-only) are skipped and counted. A main-beat tie survives when
 *   both notes were transposed and neither moved, or both moved to the
 *   same string and fret; else both flags go. Ties on graces are left
 *   alone, except that a moved grace drops its own. 2.3.2: over a column,
 *   every selected track, all or nothing; the first problem in track, then
 *   measure order is named with its track.
 */
import { trackAt, hasTab, isGrace, isRest, notesOf, beatAt, cursorNote, updateNote, without } from './access.js';
import { untieNote, nextMainBeat, prevMainBeat, stripFlag } from './ties.js';
import { eachSlice, eachSelectedBeat, partsOf, tracksField } from './rangeEdit.js';
import { isHarmonic, placeMoves } from './stringMove.js';

const refuse = (id, extra) => ({ announce: { id, ...extra } });
const fretted = (n) => Number.isInteger(n.fret);
const key = (loc, string) => `${loc.track}:${loc.measure}:${loc.beat}:${string}`;

/** Transpose by `semis` semitones (see the header). */
export function transpose(score, cursor, state, ctx, semis) {
  const max = ctx.maxFret;
  const ok = (f) => f >= 0 && f <= max;
  const fits = (n) => ok(n.fret + semis) && (!Number.isInteger(n.harmonicFret) || ok(n.harmonicFret + semis));
  const shifted = (n) => ({ ...without(n, 'pitch'), fret: n.fret + semis, ...(Number.isInteger(n.harmonicFret) ? { harmonicFret: n.harmonicFret + semis } : {}) });
  const outOfRange = (mi, extra) => refuse('transposeRange', { measure: mi + 1, max, up: semis > 0, ...extra });
  const sel = ctx.selection;
  if (!sel) {
    if (!hasTab(trackAt(score, cursor.track))) return refuse('needsTab');
    const n = cursorNote(score, cursor);
    if (!n) return refuse('noNoteToTranspose');
    if (!fretted(n)) return refuse('pitchOnlyNote'); // a note with a pitch but no fret
    if (fits(n)) {
      const out = updateNote(untieNote(score, cursor), cursor, shifted);
      return { score: out, announce: { id: 'transposed', semitones: semis, count: 1, fret: n.fret + semis } };
    }
    if (isHarmonic(n)) return outOfRange(cursor.measure, { harmonic: true });
    const to = placeMoves(trackAt(score, cursor.track), notesOf(beatAt(score, cursor)), [n], semis, max)?.get(n);
    if (!to) return outOfRange(cursor.measure);
    const out = updateNote(untieNote(score, cursor), cursor, (x) => ({ ...without(x, 'pitch'), string: to.string, fret: to.fret }));
    return { score: out, cursor: { ...cursor, string: to.string }, announce: { id: 'transposed', semitones: semis, count: 1, moved: 1 } };
  }
  const parts = partsOf(sel);
  const targets = [];
  let skipped = 0;
  eachSelectedBeat(score, parts, (b, loc) => {
    if (isRest(b)) return;
    for (const n of notesOf(b)) {
      if (fretted(n)) targets.push({ ...loc, n, grace: isGrace(b) });
      else skipped++;
    }
  });
  if (!targets.length) return refuse('nothingToTranspose', { skipped });
  const groups = new Map(); // the misfits of each beat, in target order
  for (const x of targets) {
    if (fits(x.n)) continue;
    const k = key(x, '');
    if (!groups.has(k)) groups.set(k, { at: x, movers: [] });
    groups.get(k).movers.push(x.n);
  }
  const moves = new Map(); // track:measure:beat:original string → { string, fret }
  for (const { at, movers } of groups.values()) {
    const where = sel.parts ? { track: at.track + 1 } : {};
    const stuck = movers.find((n) => isHarmonic(n) || n.string == null);
    if (stuck) return outOfRange(at.measure, { ...where, ...(isHarmonic(stuck) ? { harmonic: true } : {}) });
    const placed = placeMoves(trackAt(score, at.track), notesOf(beatAt(score, at)), movers, semis, max);
    if (!placed) return outOfRange(at.measure, where);
    for (const [n, to] of placed) moves.set(key(at, n.string), to);
  }
  const write = (b, loc) => {
    if (isRest(b) || !Array.isArray(b.notes)) return b;
    const drop = isGrace(b) ? ['pitch', 'tieStart', 'tieEnd'] : ['pitch'];
    return { ...b, notes: b.notes.map((n) => {
      if (!fretted(n)) return n;
      const to = n.string != null && moves.get(key(loc, n.string));
      return to ? { ...without(n, ...drop), string: to.string, fret: to.fret } : shifted(n);
    }) };
  };
  let out = score;
  for (const p of parts) out = eachSlice(out, p.track, p.slices, (part, s) => part.map((b, i) => write(b, { track: p.track, measure: s.measure, beat: s.from + i })), false);
  const done = new Set(targets.filter((x) => !x.grace).map((x) => key(x, x.n.string)));
  for (const x of targets) {
    if (x.grace || x.n.string == null) continue;
    const mine = moves.get(key(x, x.n.string));
    const here = { track: x.track, measure: x.measure, beat: x.beat, string: mine?.string ?? x.n.string };
    for (const [flag, other, find] of [['tieStart', 'tieEnd', nextMainBeat], ['tieEnd', 'tieStart', prevMainBeat]]) {
      if (!x.n[flag]) continue;
      const p = find(score, here);
      const theirs = p && moves.get(key(p, x.n.string));
      const kept = p && done.has(key(p, x.n.string)) && (mine && theirs ? mine.string === theirs.string && mine.fret === theirs.fret : !mine && !theirs);
      if (kept) continue;
      out = stripFlag(out, here, flag);
      if (p) out = stripFlag(out, { ...p, string: theirs?.string ?? x.n.string }, other);
    }
  }
  const follow = moves.get(key(cursor, cursor.string));
  return {
    score: out,
    ...(follow ? { cursor: { ...cursor, string: follow.string } } : {}),
    announce: { id: 'transposed', semitones: semis, count: targets.length, moved: moves.size, skipped, ...tracksField(sel) },
  };
}
