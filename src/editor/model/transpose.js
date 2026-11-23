/**
 * model/transpose.js — the 2.3.1 transpose command (Ctrl+Up / Down ±1
 * semitone, Ctrl+Shift+Up / Down ±12): `transpose(score, cursor, state,
 * ctx, semis)`.
 *
 * A note stays on its string: only `fret` changes (and an integer
 * `harmonicFret` by the same amount); `pitch` is removed from every
 * changed note, `mute`, `harmonic` and other effects are kept. All or
 * nothing: when any fret would leave 0..ctx.maxFret nothing changes and the
 * first measure with a problem is named.
 * - No selection: the voice-1 note on the cursor string of a TAB track; its
 *   ties are removed (both partners).
 * - With a selection (TAB staff or not): every voice-1 note with a fret on
 *   the selected non-rest beats, graces included; notes without a fret
 *   (pitch-only) are skipped and counted. A main-beat tie survives when
 *   both notes were transposed, else both flags go; ties on graces are left
 *   alone. 2.3.2: over a column, every selected track, all or nothing; the
 *   first problem in track, then measure order is named with its track.
 */
import { trackAt, hasTab, isGrace, isRest, notesOf, cursorNote, updateNote, without } from './access.js';
import { untieNote, nextMainBeat, prevMainBeat, stripFlag } from './ties.js';
import { eachSlice, eachSelectedBeat, partsOf, onTracks } from './rangeEdit.js';

const refuse = (id, extra) => ({ announce: { id, ...extra } });
const fretted = (n) => Number.isInteger(n.fret);

/** Transpose by `semis` semitones (see the header). */
export function transpose(score, cursor, state, ctx, semis) {
  const max = ctx.maxFret;
  const ok = (f) => f >= 0 && f <= max;
  const fits = (n) => ok(n.fret + semis) && (!Number.isInteger(n.harmonicFret) || ok(n.harmonicFret + semis));
  const shifted = (n) => ({ ...without(n, 'pitch'), fret: n.fret + semis, ...(Number.isInteger(n.harmonicFret) ? { harmonicFret: n.harmonicFret + semis } : {}) });
  const outOfRange = (mi, track) => refuse('transposeRange', { measure: mi + 1, max, up: semis > 0, ...track });
  const sel = ctx.selection;
  if (!sel) {
    if (!hasTab(trackAt(score, cursor.track))) return refuse('needsTab');
    const n = cursorNote(score, cursor);
    if (!n) return refuse('noNoteToTranspose');
    if (!fretted(n)) return refuse('pitchOnlyNote'); // a note with a pitch but no fret
    if (!fits(n)) return outOfRange(cursor.measure);
    const out = updateNote(untieNote(score, cursor), cursor, shifted);
    return { score: out, announce: { id: 'transposed', semitones: semis, count: 1, fret: n.fret + semis } };
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
  const bad = targets.find((x) => !fits(x.n));
  if (bad) return outOfRange(bad.measure, sel.parts ? { track: bad.track + 1 } : {});
  const write = (b) => (isRest(b) || !Array.isArray(b.notes) ? b : { ...b, notes: b.notes.map((n) => (fretted(n) ? shifted(n) : n)) });
  let out = score;
  for (const p of parts) out = eachSlice(out, p.track, p.slices, (part) => part.map(write), false);
  const key = (loc, string) => `${loc.track}:${loc.measure}:${loc.beat}:${string}`;
  const moved = new Set(targets.filter((x) => !x.grace).map((x) => key(x, x.n.string)));
  for (const x of targets) {
    if (x.grace || x.n.string == null) continue;
    const loc = { track: x.track, measure: x.measure, beat: x.beat, string: x.n.string };
    for (const [flag, other, find] of [['tieStart', 'tieEnd', nextMainBeat], ['tieEnd', 'tieStart', prevMainBeat]]) {
      if (!x.n[flag]) continue;
      const p = find(score, loc);
      if (p && moved.has(key(p, x.n.string))) continue;
      out = stripFlag(out, loc, flag);
      if (p) out = stripFlag(out, { ...p, string: x.n.string }, other);
    }
  }
  return { score: out, announce: { id: 'transposed', semitones: semis, count: targets.length, skipped, ...onTracks(sel) } };
}
