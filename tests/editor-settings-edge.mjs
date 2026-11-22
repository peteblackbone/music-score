// 2.2.0 editor settings, edge cases against the acceptance criteria: model level. Retuning with two voices,
// graces, slash beats and ties across measures; hidden tracks; track operations with the cursor on every
// position; column migration (every field, with and without a conflicting value); addTrack with mixed time /
// key changes and navigation marks (the drawing must not change); equal-to-in-force deletion over score, track
// and measure baselines; ending / section / jump forms; repeatCount and barline coupling.
// Run via `node tests/run.js` (calls summary()), or directly: `node tests/editor-settings-edge.mjs`.
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

register('./hooks.mjs', import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const { sanitizeScore } = await imp('src/sanitize.js');
const { normalizeScore } = await imp('src/normalize.js');
const io = await imp('src/editor/model/io.js');
const C = await imp('src/editor/model/cursor.js');
const F = await imp('src/editor/model/fill.js');
const T = await imp('src/editor/model/settings/tuning.js');
const TR = await imp('src/editor/model/settings/track.js');
const TS = await imp('src/editor/model/settings/tracks.js');
const MS = await imp('src/editor/model/settings/measureSettings.js');
const COL = await imp('src/editor/model/settings/column.js');
const { describe } = await imp('src/editor/announce.js');
const { JUMP_TEXTS } = await imp('src/navigation.js');
const { clefAt, CLEF_NAMES } = await imp('src/clef.js');
const { makeContainer } = await import('./dom-shim.mjs');
const { MusicScoreRenderer } = await imp('src/MusicScoreRenderer.js');

const results = [];
const test = (name, fn) => {
  try { fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, msg: e.stack || e.message }); }
};
const eq = (a, b, m = '') => {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${m} expected ${y}, got ${x}`);
};
const ok = (c, m = 'assertion failed') => { if (!c) throw new Error(m); };
const throws = (fn, Type, msg) => {
  try { fn(); } catch (e) {
    if (Type && !(e instanceof Type)) throw new Error(`threw ${e.constructor.name} "${e.message}", wanted ${Type.name}`);
    if (msg && !String(e.message).includes(msg)) throw new Error(`threw "${e.message}", wanted "${msg}"`);
    return;
  }
  throw new Error(`did not throw${msg ? ` "${msg}"` : ''}`);
};
const throwsClean = (s, fn, Type, msg) => { const before = JSON.stringify(s); throws(fn, Type, msg); eq(JSON.stringify(s), before, 'model unchanged after a throw'); };
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const model = (s) => io.parseInput(s);
const nt = (duration, string = 1, fret = 0, extra = {}) => ({ type: 'note', duration, notes: [{ string, fret }], ...extra });
const tn = (duration, string, fret, flags = {}, extra = {}) => ({ type: 'note', duration, notes: [{ string, fret, ...flags }], ...extra });
const rest = (duration = 'quarter', extra = {}) => ({ type: 'rest', duration, ...extra });
const graceB = (string = 2, fret = 3) => ({ type: 'grace', duration: '16th', notes: [{ string, fret }] });
const tab = (measures, extra = {}) => ({ name: 'Gtr', showTablature: true, ...extra, measures });
const cur = (track, measure, beat, string = 1) => ({ track, measure, beat, string });
const say = (r) => describe(r.announce);
const SEVEN = ['B1', 'E2', 'A2', 'D3', 'G3', 'B3', 'E4'];
const HIDDEN = { showStandardNotation: false, showTablature: false };

// ---------- retune: two voices, graces, slash beats, ties across measures ----------
function retuneFixture() {
  return model({ tracks: [tab([
    { beats: [
      tn('quarter', 7, 0, { tieStart: true }, { custom: 'a' }),
      { type: 'note', duration: 'quarter', notes: [{ string: 6, fret: 2 }, { string: 1, fret: 3, tieStart: true }] },
      graceB(6, 1),
      { type: 'note', duration: 'quarter', slash: true, notes: [{ string: 7, fret: 1 }] },
    ] },
    { voices: [
      { beats: [tn('quarter', 1, 3, { tieEnd: true }), tn('quarter', 5, 2, { pitch: 'B2' }), tn('half', 6, 0, { pitch: 'C3', tieStart: true })] },
      { beats: [tn('half', 7, 1, { tieEnd: true }), { type: 'note', duration: 'half', slash: true, notes: [{ string: 6, fret: 0 }] }] },
    ] },
    { beats: [tn('whole', 6, 4, { tieEnd: true, pitch: 'C3' }), nt('whole', 1, 3, { tempo: 90 })] },
  ], { tuning: SEVEN })] });
}
test('retune 7 -> 5 strings with two voices, graces, slash beats and ties across measures: exact result, removed count, droppedV1, untouched parts keep identity, sanitize-stable', () => {
  const s = retuneFixture();
  const t0 = s.tracks[0];
  const r = T.retuneTrack(t0, ['A2', 'D3', 'G3', 'B3', 'E4']);
  const [m0, m1, m2] = r.track.measures;
  eq(m0.beats, [
    rest('quarter', { custom: 'a' }),
    { type: 'note', duration: 'quarter', notes: [{ string: 1, fret: 3, tieStart: true }] },
    { type: 'note', duration: 'quarter', slash: true, notes: [] },
  ], 'voice 1: emptied beats become rests keeping their fields, the grace is dropped, the voice-1 slash beat stays with no notes');
  eq(m1.voices[0].beats, [tn('quarter', 1, 3, { tieEnd: true }), tn('quarter', 5, 2, { pitch: 'B2' }), { type: 'note', duration: 'half', notes: [{ pitch: 'C3' }] }],
    'the pitch of a removed-string note survives without string, fret and tie flags; string 5 kept its open pitch, so its pitch stays');
  eq(m1.voices[1].beats, [rest('half'), { type: 'rest', duration: 'half', slash: true }], 'voice 2 is edited too; a slash beat there becomes a rest');
  eq(m2.beats, [{ type: 'note', duration: 'whole', notes: [{ pitch: 'C3' }] }, nt('whole', 1, 3, { tempo: 90 })]);
  eq([r.removed, [...r.droppedV1]], [8, [[0, [2]]]], 'm0: 3 notes + 1 grace; voice 1 m1: 1; voice 2 m1: 2; m2: 1');
  ok(r.track.measures[2].beats[1] === t0.measures[2].beats[1], 'a beat nothing touched keeps its identity');
  eq(r.track.tuning, ['A2', 'D3', 'G3', 'B3', 'E4']);
  const out = { ...s, tracks: [r.track] };
  ok(sanitizeScore(out) === out);
  eq(t0, retuneFixture().tracks[0], 'the input track is not mutated');
});
test('retune 7 -> 5 strings with a changed tuning: pitch dropped only on strings whose open pitch changed, and only with a fret', () => {
  const s = retuneFixture();
  const r = T.retuneTrack(s.tracks[0], ['G2', 'D3', 'G3', 'B3', 'E4']);
  eq(r.track.measures[1].voices[0].beats[1], tn('quarter', 5, 2), 'string 5: open A2 became G2, so the pitch goes and the fret stays');
  eq(r.track.measures[1].voices[0].beats[0], tn('quarter', 1, 3, { tieEnd: true }), 'string 1 is the same');
  eq(r.removed, 8);
});
test('retune is symmetrical in the string count: adding strings at the low end changes nothing above them', () => {
  const s = retuneFixture();
  const six = T.retuneTrack(s.tracks[0], ['E2', 'A2', 'D3', 'G3', 'B3', 'E4']);
  const seven = T.retuneTrack(six.track, SEVEN);
  eq(seven.removed, 0);
  eq(seven.track.measures, six.track.measures, 'no note comes back, none changes');
  eq(seven.track.tuning, SEVEN);
});
test('retune: a tie that crosses a measure between kept strings is intact; the removed side of a tie leaves no half tie', () => {
  const s = model({ tracks: [tab([
    { beats: [tn('quarter', 1, 5, { tieStart: true }), tn('quarter', 7, 5, { tieStart: true, pitch: 'B1' })] },
    { beats: [tn('quarter', 1, 5, { tieEnd: true }), tn('quarter', 7, 5, { tieEnd: true, pitch: 'B1' })] },
  ], { tuning: SEVEN })] });
  const r = T.retuneTrack(s.tracks[0], ['E2', 'A2', 'D3', 'G3', 'B3', 'E4']);
  const [m0, m1] = r.track.measures;
  eq([m0.beats[0].notes[0].tieStart, m1.beats[0].notes[0].tieEnd], [true, true]);
  eq([m0.beats[1].notes, m1.beats[1].notes], [[{ pitch: 'B1' }], [{ pitch: 'B1' }]]);
  eq(r.removed, 2);
  const out = { ...s, tracks: [r.track] };
  ok(sanitizeScore(out) === out);
});
test('retune: a measure that has voices and measure.beats beside them: both are visited, only voices[0] feeds droppedV1', () => {
  const s = model({ tracks: [tab([{ voices: [{ beats: [graceB(7, 1), nt('quarter', 1, 0)] }, { beats: [graceB(7, 2)] }], beats: [graceB(7, 3), nt('whole', 1, 0)] }], { tuning: SEVEN })] });
  const r = T.retuneTrack(s.tracks[0], ['E2', 'A2', 'D3', 'G3', 'B3', 'E4']);
  const m = r.track.measures[0];
  eq([m.voices[0].beats.length, m.voices[1].beats.length, m.beats.length], [1, 0, 1]);
  eq([[...r.droppedV1], r.removed], [[[0, [0]]], 3]);
});
test('retune: a retune to the same pitches, in any case, is no change; a track without tuning counts as standard 6-string', () => {
  const s = retuneFixture();
  const r = TR.updateTrack(s, cur(0, 0, 0), 0, { tuning: SEVEN.map((p) => p.toLowerCase()) });
  ok(r.score === s, 'canonical equality');
  const bare = model({ tracks: [tab([{ beats: [tn('quarter', 6, 0, { pitch: 'E2' }), tn('quarter', 5, 0, { pitch: 'A2' })] }])] });
  const d = T.retuneTrack(bare.tracks[0], ['D2', 'A2', 'D3', 'G3', 'B3', 'E4']);
  eq(d.track.measures[0].beats.map((b) => b.notes[0].pitch), [undefined, 'A2'], 'the default tuning is E2 A2 ...: only string 6 changed');
  const seven = T.retuneTrack(bare.tracks[0], SEVEN);
  eq([seven.removed, seven.track.measures === bare.tracks[0].measures], [0, true]);
  const four = T.retuneTrack(bare.tracks[0], ['E1', 'A1', 'D2', 'G2']);
  eq(four.removed, 2);
  eq(four.track.measures[0].beats, [{ type: 'note', duration: 'quarter', notes: [{ pitch: 'E2' }] }, { type: 'note', duration: 'quarter', notes: [{ pitch: 'A2' }] }]);
});
test('retune on the whole through updateTrack: removing strings then adding them back does not bring the notes back; the cursor string clamps', () => {
  const s = model({ tracks: [tab([{ beats: [nt('quarter', 7, 3), nt('quarter', 1, 0)] }], { tuning: SEVEN })] });
  const six = TR.updateTrack(s, cur(0, 0, 0, 7), 0, { tuning: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'] });
  eq([six.score.tracks[0].measures[0].beats[0].type, say(six)], ['rest', 'Track 1 Gtr updated, 1 note removed']);
  const back = TR.updateTrack(six.score, six.cursor, 0, { tuning: SEVEN });
  eq(back.score.tracks[0].measures[0].beats[0].type, 'rest');
  eq(say(back), 'Track 1 Gtr updated');
  eq(C.clampCursor(six.score, six.cursor).string, 6);
});

// ---------- hidden tracks ----------
test('string count changes on hidden tracks: retuned like any other, counted, cursor on another track untouched; a hidden track with graces below the cursor does not move a cursor elsewhere', () => {
  const s = model({ tracks: [
    tab([{ beats: [nt('quarter', 1, 0), nt('quarter', 1, 2)] }]),
    tab([{ beats: [graceB(7, 1), nt('quarter', 7, 3), nt('quarter', 1, 0)] }], { ...HIDDEN, tuning: SEVEN, name: 'H' }),
  ] });
  const c = cur(0, 0, 1);
  const r = TR.updateTrack(s, c, 1, { tuning: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'] });
  eq(r.cursor, c, 'cursor on track 0 is not adjusted for track 1 graces');
  eq(r.score.tracks[1].measures[0].beats, [rest('quarter'), nt('quarter', 1, 0)]);
  eq(say(r), 'Track 2 H updated, 2 notes removed');
  ok(r.score.tracks[0] === s.tracks[0]);
  eq(r.score.tracks[1].showTablature, false, 'it stays hidden');
  const bump = TR.updateTrack(s, c, 1, { tuning: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], showTablature: true });
  ok(bump.score && !bump.refused, 'retune and show in one call');
  const add = TR.updateTrack(s, c, 1, { tuning: ['F#1', ...SEVEN] });
  eq(add.score.tracks[1].tuning.length, 8);
  eq(say(add), 'Track 2 H updated');
});
test('hidden tracks take part in column writes: updateMeasure writes on them, removeTrack migrates to them, addTrack copies from them when they set a field first', () => {
  const s = model({ tracks: [tab([{ beats: [] }, { beats: [] }]), tab([{ beats: [] }, { beats: [], jump: 'Fine' }], { ...HIDDEN, name: 'H' })] });
  const u = MS.updateMeasure(s, cur(0, 0, 0), 1, { segno: true });
  eq(u.score.tracks.map((t) => t.measures[1].segno), [true, true]);
  const a = TS.addTrack(s, cur(0, 0, 0));
  eq(a.score.tracks[2].measures[1].jump, 'Fine', 'a hidden track\'s jump is a column value');
  const r = TS.removeTrack(s, cur(0, 0, 0), 1);
  eq(r.score.tracks[0].measures[1].jump, 'Fine', 'a hidden track\'s jump is kept when it goes');
});

// ---------- add / remove / move with the cursor ----------
const fourTracks = () => model({ tracks: ['A', 'B', 'C', 'D'].map((name, i) => tab([{ beats: [nt('quarter', 1, i)] }, { beats: [nt('quarter', 1, i), nt('quarter', 1, 1)] }], i === 2 ? { name, ...HIDDEN } : { name })) });
test('cursor with every position: addTrack puts it on the new track keeping measure and string; beat resets', () => {
  const s = fourTracks();
  for (const c of [0, 1, 3]) for (let at = 0; at <= 4; at++) {
    const r = TS.addTrack(s, cur(c, 1, 1, 3), undefined, at);
    eq(r.cursor, cur(at, 1, 0, 3), `cursor ${c}, at ${at}`);
    eq(C.clampCursor(r.score, r.cursor).track, at, 'the new track is visible, so the clamp keeps it');
  }
  const hiddenNew = TS.addTrack(s, cur(0, 0, 0), { showTablature: false, showStandardNotation: false });
  eq(C.clampCursor(hiddenNew.score, hiddenNew.cursor).track, 3, 'a hidden new track: the clamp moves to the nearest visible one (before it wins ties)');
});
test('cursor with every position: removeTrack keeps the cursor on its track or the nearest visible one; undo state (before cursor) is the caller\'s, the result is always a valid cursor', () => {
  const s = fourTracks();
  const names = (r) => r.score.tracks.map((t) => t.name).join('');
  for (let c = 0; c < 4; c++) for (let ti = 0; ti < 4; ti++) {
    const r = TS.removeTrack(s, cur(c, 1, 1), ti);
    const cc = C.clampCursor(r.score, r.cursor);
    ok(C.sameCursor(cc, C.clampCursor(r.score, cc)), 'valid');
    if (c !== ti && c !== 2) eq(r.score.tracks[cc.track].name, s.tracks[c].name, `cursor ${c} stays on its track when ${ti} goes (${names(r)})`);
    eq(r.cursor.measure, 1);
  }
  eq(TS.removeTrack(s, cur(3, 1, 1), 3).cursor.track, 2, 'removing the cursor track at the end: the new last one');
  eq(C.clampCursor(TS.removeTrack(s, cur(3, 1, 1), 3).score, TS.removeTrack(s, cur(3, 1, 1), 3).cursor).track, 1, 'which is hidden: the nearest visible');
  eq(C.clampCursor(TS.removeTrack(s, cur(1, 1, 1), 1).score, TS.removeTrack(s, cur(1, 1, 1), 1).cursor).track, 0, 'the track after is hidden: the nearest visible one is before');
  eq(TS.removeTrack(s, cur(0, 0, 0), 2).score.tracks.map((t) => t.name), ['A', 'B', 'D'], 'a hidden track can be removed while others stay visible');
});
test('cursor with every position: moveTrack of a hidden track and with the cursor on or off it', () => {
  const s = fourTracks();
  for (let from = 0; from < 4; from++) for (let to = 0; to < 4; to++) for (let c = 0; c < 4; c++) {
    if (from === to) continue;
    const r = TS.moveTrack(s, cur(c, 1, 1, 2), from, to);
    eq(r.score.tracks[r.cursor.track], s.tracks[c]);
    eq([r.cursor.measure, r.cursor.beat, r.cursor.string], [1, 1, 2]);
    ok(sanitizeScore(r.score) === r.score);
  }
  eq(say(TS.moveTrack(s, cur(0, 0, 0), 2, 0)), 'Track C moved to position 1');
});
test('addTrack at every position keeps every other track by reference and inserts exactly one; 32 tracks is the cap, 31 still adds', () => {
  const s = fourTracks();
  for (let at = 0; at <= 4; at++) {
    const r = TS.addTrack(s, cur(0, 0, 0), 'bass4', at);
    eq(r.score.tracks.length, 5);
    const rest4 = r.score.tracks.filter((_, i) => i !== at);
    ok(rest4.every((t, i) => t === s.tracks[i]));
  }
  const thirtyOne = model({ tracks: Array.from({ length: 31 }, () => tab([{ beats: [] }])) });
  eq(TS.addTrack(thirtyOne, cur(0, 0, 0)).score.tracks.length, 32);
});

// ---------- removeTrack migration ----------
const FIELD_VALUES = {
  barline: ['double', 'final'],
  ending: [[1, 2], 3],
  jump: ['Fine', 'D.C.'],
  section: [{ letter: 'A', text: 'x' }, 'Verse'],
  repeatCount: [4, 3],
  segno: [true, true],
  coda: [true, true],
  timeSignature: [{ beats: 3, beatType: 4 }, { beats: 5, beatType: 8 }],
  keySignature: [2, -1],
};
const migrationScore = (f, onRemoved, onOther) => {
  const m = (v) => (v === undefined ? { beats: [] } : { beats: [], [f]: v });
  return model({ tracks: [
    tab([{ beats: [] }, m(onOther)], { name: 'A' }),
    tab([{ beats: [] }, m(onRemoved)], { name: 'B' }),
    tab([{ beats: [] }, { beats: [] }], { name: 'C', ...HIDDEN }),
  ] });
};
test('removeTrack: every column field (9) only the removed track sets goes, raw, to every remaining track, hidden ones too', () => {
  for (const f of Object.keys(FIELD_VALUES)) {
    const v = FIELD_VALUES[f][0];
    const s = migrationScore(f, v, undefined);
    const r = TS.removeTrack(s, cur(0, 0, 0), 1);
    eq(r.score.tracks.map((t) => t.measures[1][f]), [v, v], f);
    eq(r.score.tracks.map((t) => t.measures[0][f]), [undefined, undefined], `${f}: only the measure that had it`);
    ok(sanitizeScore(r.score) === r.score, f);
    eq(COL.columnValue(r.score, 1, f), COL.columnValue(s, 1, f), `${f}: the column value is the same before and after`);
  }
});
test('removeTrack: with a conflicting value on another track nothing is copied (the remaining value stays the winner, the others get nothing); the removed value is lost', () => {
  for (const f of Object.keys(FIELD_VALUES)) {
    const [mine, other] = FIELD_VALUES[f];
    const s = migrationScore(f, mine, other);
    const r = TS.removeTrack(s, cur(0, 0, 0), 1);
    eq(r.score.tracks.map((t) => t.measures[1][f]), [other, undefined], `${f}: A keeps its value, hidden C gets none`);
    ok(r.score.tracks[0] === s.tracks[0], `${f}: A is untouched`);
  }
});
test('removeTrack of the lowest-index owner when another track conflicts: the other track\'s value now wins (documented risk: removing a track can change which legacy value wins)', () => {
  const s = model({ tracks: [tab([{ beats: [], jump: 'Fine' }], { name: 'A' }), tab([{ beats: [], jump: 'D.C.' }], { name: 'B' })] });
  eq(MS.getMeasureSettings(s, 0, 0).jump, 'Fine');
  eq(MS.getMeasureSettings(TS.removeTrack(s, cur(0, 0, 0), 0).score, 0, 0).jump, 'D.C.');
});
test('removeTrack: invalid values on the removed track are not migrated; a longer removed track pads the others; trailing empty measures of the removed track vanish with it', () => {
  const s = model({ tracks: [
    tab([{ beats: [] }], { name: 'A' }),
    tab([{ beats: [] }, { beats: [], segno: false, coda: 'yes', ending: 'bogus', jump: 'Play twice?' }, { beats: [] }, { beats: [], repeatCount: 5, barline: 'repeatEnd' }, { beats: [] }], { name: 'B' }),
  ] });
  const r = TS.removeTrack(s, cur(0, 0, 0), 1);
  eq(r.score.tracks[0].measures.map((m) => Object.keys(m).sort().join()), ['beats', 'beats,jump', 'beats', 'barline,beats,repeatCount']);
  eq(r.score.tracks[0].measures[1].jump, 'Play twice?', 'a custom jump is a valid value the renderer reads, so it migrates');
  eq(r.score.tracks[0].measures[3], { beats: [], barline: 'repeatEnd', repeatCount: 5 });
  eq(MS.getMeasureSettings(r.score, 3, 0).repeatCount, 5);
});
test('removeTrack property: when no two tracks set the same column field at one measure, the column values (all 9 fields) and the merged navigation are the same after any removal', () => {
  const rnd = mulberry32(2211);
  const pick = (l) => l[Math.floor(rnd() * l.length)];
  const TIMES = [{ beats: 3, beatType: 4 }, { beats: 4, beatType: 4 }, { beats: 6, beatType: 8 }];
  let runs = 0;
  for (let i = 0; i < 300; i++) {
    const nT = 2 + Math.floor(rnd() * 3);
    const cols = 1 + Math.floor(rnd() * 5);
    const owner = new Map();
    const tracks = Array.from({ length: nT }, (_, ti) => tab(Array.from({ length: ti === 0 ? cols : Math.floor(rnd() * (cols + 1)) }, (_x, mi) => {
      if (rnd() < 0.1) return null;
      const m = { beats: [] };
      const may = (f, v, p) => { if (rnd() < p && (owner.get(`${mi}${f}`) ?? ti) === ti) { owner.set(`${mi}${f}`, ti); m[f] = v; } };
      may('timeSignature', pick(TIMES), 0.25); may('keySignature', Math.floor(rnd() * 7) - 3, 0.25);
      may('segno', true, 0.2); may('coda', true, 0.2); may('jump', pick(['D.C.', 'Fine', 'D.S. al Coda']), 0.2);
      may('section', pick(['A', { letter: 'B', text: 'x' }]), 0.2); may('ending', pick([1, [1, 2], { numbers: 3, text: 't' }]), 0.2);
      may('barline', pick(['double', 'final', 'repeatEnd', 'repeatStart']), 0.25);
      if (m.barline === 'repeatEnd') may('repeatCount', 3, 0.5);
      return m;
    }), { name: `T${ti}` }));
    const s = model({ tracks });
    const ti = Math.floor(rnd() * nT);
    const r = TS.removeTrack(s, cur(0, 0, 0), ti);
    ok(sanitizeScore(r.score) === r.score);
    const n0 = normalizeScore(s).navigation, n1 = normalizeScore(r.score).navigation;
    eq(n1, n0.slice(0, n1.length), `navigation, run ${i}`);
    ok(n0.slice(n1.length).every((c) => !c.segno && !c.coda && !c.jump && !c.ending && !c.section && !c.repeatCount), 'only empty trailing columns can disappear');
    for (let mi = 0; mi < n1.length; mi++) for (const f of COL.COLUMN_FIELDS) eq(COL.columnValue(r.score, mi, f), COL.columnValue(s, mi, f), `${f} at ${mi}, run ${i}`);
    runs++;
  }
  ok(runs === 300);
});

// ---------- addTrack: mixed time / key changes and navigation marks; the drawing must not change ----------
function randomScore(rnd) {
  const pick = (l) => l[Math.floor(rnd() * l.length)];
  const TIMES = [{ beats: 3, beatType: 4 }, { beats: 4, beatType: 4 }, { beats: 6, beatType: 8 }, { beats: 2, beatType: 2 }];
  const nT = 1 + Math.floor(rnd() * 4);
  const cols = 1 + Math.floor(rnd() * 6);
  const tracks = Array.from({ length: nT }, (_, ti) => {
    const t = tab(Array.from({ length: ti === 0 ? cols : Math.floor(rnd() * (cols + 1)) }, () => {
      if (rnd() < 0.1) return null;
      const m = { beats: [] };
      const may = (f, v, p = 0.2) => { if (rnd() < p) m[f] = v; };
      may('timeSignature', pick(TIMES), 0.3); may('keySignature', Math.floor(rnd() * 7) - 3, 0.3);
      may('segno', true); may('coda', true); may('jump', pick(['D.C.', 'Fine', 'D.S. al Coda'])); may('section', pick(['A', { letter: 'B', text: 'x' }]));
      may('ending', pick([1, [1, 2], { numbers: 3, text: 't' }])); may('barline', pick(['double', 'final', 'repeatEnd', 'repeatStart']));
      if (m.barline === 'repeatEnd') may('repeatCount', 3, 0.5);
      if (rnd() < 0.2) m.clef = pick(['bass', 'alto']);
      return m;
    }), { name: `T${ti}` });
    if (rnd() < 0.25) t.timeSignature = pick(TIMES);
    if (rnd() < 0.25) t.keySignature = Math.floor(rnd() * 5) - 2;
    return t;
  });
  const s = {};
  if (rnd() < 0.3) s.timeSignature = pick(TIMES);
  if (rnd() < 0.3) s.keySignature = Math.floor(rnd() * 5) - 2;
  return model({ ...s, tracks });
}
test('addTrack property: into random scores with mixed time / key changes, baselines at score and track level and navigation marks, the merged navigation is identical, the new track follows track 0 for time and key at every measure, clefs are not copied, the others keep identity', () => {
  const rnd = mulberry32(909);
  for (let i = 0; i < 400; i++) {
    const s = randomScore(rnd);
    const n0 = normalizeScore(s);
    const at = Math.floor(rnd() * (s.tracks.length + 1));
    const r = TS.addTrack(s, cur(0, 0, 0), undefined, at);
    const n1 = normalizeScore(r.score);
    eq(n1.navigation, n0.navigation, `navigation, run ${i}`);
    ok(sanitizeScore(r.score) === r.score, `sanitize, run ${i}`);
    const kept = r.score.tracks.filter((_, k) => k !== at);
    ok(kept.every((t, k) => t === s.tracks[k]), 'other tracks keep identity');
    const added = r.score.tracks[at];
    ok(added.measures.every((m) => !('clef' in m)) && !('timeSignature' in added) && !('keySignature' in added), 'no clefs, no track-level signatures');
    for (let mi = 0; mi < n0.navigation.length; mi++) {
      const a = n1.tracks[at].measures[mi], b = n0.tracks[0].measures[mi];
      eq([a.timeSignature, a.keySignature], [b.timeSignature, b.keySignature], `time / key at ${mi}, run ${i}`);
    }
    eq(added.measures.length, n0.navigation.length);
  }
});
test('addTrack render: the navigation, time and key drawing of the existing staves does not change; the new staves repeat each key / time change and add no navigation mark', () => {
  const s = model({ keySignature: 1, tracks: [tab([
    { timeSignature: { beats: 3, beatType: 4 }, segno: true, beats: [nt('quarter')] },
    { keySignature: 2, ending: [1, 2], beats: [] },
    { timeSignature: { beats: 6, beatType: 8 }, jump: 'D.S. al Coda', section: { letter: 'A', text: 'Verse' }, beats: [] },
    { barline: 'repeatEnd', repeatCount: 3, coda: true, keySignature: -1, beats: [] },
  ])] });
  const walk = (n, f, out = []) => { if (f(n)) out.push(n); n.children.forEach((c) => walk(c, f, out)); return out; };
  const classes = (n) => (n.getAttribute?.('class') || '').split(' ');
  const draw = (score) => { const b = makeContainer(); new MusicScoreRenderer(b, JSON.parse(JSON.stringify(score)), { width: 1400 }).render(); return b.children[0]; };
  const textsOf = (svg, cls) => walk(svg, (n) => classes(n).includes(cls)).map((n) => walk(n, (x) => x.tag === 'text').map((x) => x.textContent).join('|') + '#' + walk(n, (x) => x.tag === 'path').length);
  const count = (svg, cls) => walk(svg, (n) => classes(n).includes(cls)).length;
  const before = draw(s);
  const after = draw(TS.addTrack(s, cur(0, 0, 0)).score);
  for (const cls of ['volta', 'segno', 'coda', 'jump', 'repeat-count', 'section', 'navigation']) {
    ok(count(before, cls) > 0, `${cls} is drawn at all`);
    eq(textsOf(after, cls), textsOf(before, cls), `${cls}: same marks, same text`);
  }
  for (const cls of ['key-signature', 'time-signature']) {
    ok(count(before, cls) > 0);
    eq(count(after, cls), count(before, cls) * 2, `${cls}: one more staff carries each change`);
  }
  eq(count(after, 'staff-notation'), 2);
  eq(count(after, 'staff-tab'), 2);
});
test('addTrack: score-level baselines: no write where the score baseline already says it; a track-0 baseline different from the score\'s is written at measure 1', () => {
  const s = model({ timeSignature: { beats: 3, beatType: 4 }, keySignature: 2, tracks: [tab([{ beats: [] }, { beats: [] }]), tab([{ beats: [] }], { timeSignature: { beats: 6, beatType: 8 }, keySignature: -1 })] });
  eq(TS.addTrack(s, cur(0, 0, 0)).score.tracks[2].measures, [{ beats: [] }, { beats: [] }], 'track 0 has no baseline of its own: nothing to write');
  const t1 = TS.addTrack({ ...s, tracks: [s.tracks[1], s.tracks[0]] }, cur(0, 0, 0));
  eq(t1.score.tracks[2].measures[0], { beats: [], timeSignature: { beats: 6, beatType: 8 }, keySignature: -1 }, 'track 0 plays 6/8 with -1 against the score 3/4 with 2');
  eq(t1.score.tracks[2].measures.length, 2, 'as many measures as the longest track');
  ok(!('timeSignature' in t1.score.tracks[2]));
});
test('addTrack: track 0 with an explicit time signature equal to the baseline at measure 1 writes nothing; a track-0 change back to the baseline value is written', () => {
  const s = model({ tracks: [tab([{ timeSignature: { beats: 4, beatType: 4 }, beats: [] }, { timeSignature: { beats: 3, beatType: 4 }, beats: [] }, { timeSignature: { beats: 4, beatType: 4 }, beats: [] }, { beats: [] }])] });
  eq(TS.addTrack(s, cur(0, 0, 0)).score.tracks[1].measures.map((m) => m.timeSignature ?? null), [null, { beats: 3, beatType: 4 }, { beats: 4, beatType: 4 }, null]);
});
test('addTrack: the written time signatures are fresh objects (no sharing with track 0)', () => {
  const s = model({ tracks: [tab([{ timeSignature: { beats: 3, beatType: 4 }, beats: [] }])] });
  const r = TS.addTrack(s, cur(0, 0, 0));
  ok(r.score.tracks[1].measures[0].timeSignature !== s.tracks[0].measures[0].timeSignature);
});

// ---------- updateMeasure: equal-to-in-force deletion ----------
const base = () => model({ timeSignature: { beats: 3, beatType: 4 }, keySignature: 2, tracks: [
  tab([{ beats: [] }, { beats: [] }, { beats: [] }, { beats: [] }], { name: 'Plain' }),
  tab([{ beats: [] }, { beats: [] }, { beats: [] }, { beats: [] }], { name: 'Own', timeSignature: { beats: 6, beatType: 8 }, keySignature: -1 }),
  tab([{ beats: [] }, { timeSignature: { beats: 2, beatType: 4 }, keySignature: 5, beats: [] }, { beats: [] }], { name: 'Changes' }),
] });
const explicit = (score, f, mi) => score.tracks.map((t) => (t.measures[mi] && f in t.measures[mi] ? t.measures[mi][f] : null));
test('time signature equal to the value in force: deleted per track over score, track and measure baselines', () => {
  const s = base();
  const c = cur(0, 0, 0);
  eq(explicit(MS.updateMeasure(s, c, 0, { timeSignature: { beats: 3, beatType: 4 } }).score, 'timeSignature', 0), [null, { beats: 3, beatType: 4 }, null], 'measure 1: equal to the score baseline (Plain, Changes: nothing written), different from the track baseline (Own, 6/8: written)');
  eq(explicit(MS.updateMeasure(s, c, 0, { timeSignature: { beats: 6, beatType: 8 } }).score, 'timeSignature', 0), [{ beats: 6, beatType: 8 }, null, { beats: 6, beatType: 8 }]);
  eq(explicit(MS.updateMeasure(s, c, 2, { timeSignature: { beats: 2, beatType: 4 } }).score, 'timeSignature', 2), [{ beats: 2, beatType: 4 }, { beats: 2, beatType: 4 }, null], 'measure 3: Changes is in 2/4 from measure 2');
  eq(explicit(MS.updateMeasure(s, c, 2, { timeSignature: { beats: 3, beatType: 4 } }).score, 'timeSignature', 2), [null, { beats: 3, beatType: 4 }, { beats: 3, beatType: 4 }]);
  eq(explicit(MS.updateMeasure(s, c, 1, { timeSignature: { beats: 6, beatType: 8 } }).score, 'timeSignature', 1), [{ beats: 6, beatType: 8 }, null, { beats: 6, beatType: 8 }], 'measure 2: Changes\' own 2/4 is replaced');
  const redundant = model({ timeSignature: { beats: 3, beatType: 4 }, tracks: [tab([{ timeSignature: { beats: 3, beatType: 4 }, beats: [] }, { timeSignature: { beats: 3, beatType: 4 }, beats: [] }])] });
  eq(explicit(MS.updateMeasure(redundant, c, 0, { timeSignature: { beats: 3, beatType: 4 } }).score, 'timeSignature', 0), [null], 'an existing redundant change goes');
  eq(explicit(MS.updateMeasure(redundant, c, 1, { timeSignature: { beats: 3, beatType: 4 } }).score, 'timeSignature', 1), [null]);
  eq(explicit(MS.updateMeasure(redundant, c, 1, { timeSignature: null }).score, 'timeSignature', 1), [null]);
});
test('key signature equal to the value in force: deleted per track over score, track and measure baselines (0 counts as a value)', () => {
  const s = base();
  const c = cur(0, 0, 0);
  eq(explicit(MS.updateMeasure(s, c, 0, { keySignature: 2 }).score, 'keySignature', 0), [null, 2, null]);
  eq(explicit(MS.updateMeasure(s, c, 0, { keySignature: -1 }).score, 'keySignature', 0), [-1, null, -1]);
  eq(explicit(MS.updateMeasure(s, c, 0, { keySignature: 0 }).score, 'keySignature', 0), [0, 0, 0], '0 differs from the baselines here, so it is written');
  const flat = model({ tracks: [tab([{ beats: [] }, { keySignature: 3, beats: [] }, { beats: [] }])] });
  eq(explicit(MS.updateMeasure(flat, c, 0, { keySignature: 0 }).score, 'keySignature', 0), [null], 'no baseline: 0 is the default');
  eq(explicit(MS.updateMeasure(flat, c, 2, { keySignature: 3 }).score, 'keySignature', 2), [null], 'equal to the change at measure 2');
  eq(explicit(MS.updateMeasure(flat, c, 2, { keySignature: 0 }).score, 'keySignature', 2), [0]);
  eq(explicit(MS.updateMeasure(flat, c, 1, { keySignature: 0 }).score, 'keySignature', 1), [null], 'back to the baseline at measure 2 removes the change');
});
test('time / key / clef property: after any patch every track shows the requested value at that measure, earlier measures are unchanged, and no write repeats the value in force', () => {
  const rnd = mulberry32(31337);
  const pick = (l) => l[Math.floor(rnd() * l.length)];
  const TIMES = [{ beats: 3, beatType: 4 }, { beats: 4, beatType: 4 }, { beats: 6, beatType: 8 }];
  for (let i = 0; i < 500; i++) {
    const s = randomScore(rnd);
    const n0 = normalizeScore(s);
    const cols = n0.navigation.length;
    const mi = Math.floor(rnd() * cols);
    const patch = {};
    if (rnd() < 0.7) patch.timeSignature = pick(TIMES);
    if (rnd() < 0.7) patch.keySignature = Math.floor(rnd() * 5) - 2;
    if (mi > 0 && rnd() < 0.4) patch.clef = pick(['bass', 'treble', 'alto']);
    if (mi > 0 && rnd() < 0.15) patch.timeSignature = null;
    if (mi > 0 && rnd() < 0.15) patch.keySignature = null;
    const ti = Math.floor(rnd() * s.tracks.length);
    const r = MS.updateMeasure(s, cur(ti, 0, 0), mi, patch);
    const n1 = normalizeScore(r.score);
    ok(sanitizeScore(r.score) === r.score, `sanitize, run ${i}`);
    s.tracks.forEach((t, k) => {
      for (let m = 0; m < mi; m++) {
        const a = n0.tracks[k].measures[m], b = n1.tracks[k].measures[m];
        if (!a || !b) continue;
        eq([b.timeSignature, b.keySignature], [a.timeSignature, a.keySignature], `earlier measure ${m} track ${k} run ${i}`);
      }
      const now = n1.tracks[k].measures[mi];
      if (patch.timeSignature) eq(now.timeSignature, { ...now.timeSignature, ...patch.timeSignature }, `time, run ${i}`);
      if (typeof patch.keySignature === 'number') eq(now.keySignature, patch.keySignature, `key, run ${i}`);
      const m2 = r.score.tracks[k].measures[mi];
      const prev = mi > 0 ? n1.tracks[k].measures[mi - 1] : null;
      if (mi > 0 && 'timeSignature' in patch && m2?.timeSignature) ok(!(prev.timeSignature.beats === m2.timeSignature.beats && prev.timeSignature.beatType === m2.timeSignature.beatType), `redundant time write, run ${i}`);
      if (mi > 0 && 'keySignature' in patch && m2?.keySignature != null) ok(m2.keySignature !== prev.keySignature, `redundant key write, run ${i}`);
    });
    if (patch.clef) {
      eq(clefAt(r.score.tracks[ti], mi), patch.clef, `clef, run ${i}`);
      s.tracks.forEach((t, k) => { if (k !== ti) for (let m = 0; m < cols; m++) eq(clefAt(r.score.tracks[k], m), clefAt(t, m), `other track ${k} keeps its clef at ${m}`); });
    }
  }
});
test('clef equal to the clef in force over track and earlier-measure baselines deletes; a per-track clef never touches the other tracks; any clef name is accepted in any case', () => {
  const s = model({ tracks: [
    tab([{ beats: [] }, { clef: 'bass', beats: [] }, { beats: [] }], { clef: 'alto' }),
    tab([{ beats: [] }, { beats: [] }, { beats: [] }], { name: 'B' }),
  ] });
  const c = cur(0, 0, 0);
  eq(s.tracks[0].measures.map((m) => m.clef ?? null), [null, 'bass', null]);
  eq(MS.updateMeasure(s, c, 1, { clef: 'alto' }).score.tracks[0].measures[1].clef, undefined, 'alto is in force from the track baseline');
  eq(MS.updateMeasure(s, c, 2, { clef: 'bass' }).score.tracks[0].measures[2].clef, undefined, 'bass is in force from measure 2');
  eq(MS.updateMeasure(s, c, 2, { clef: 'alto' }).score.tracks[0].measures[2].clef, 'alto');
  const r = MS.updateMeasure(s, c, 2, { clef: 'TENOR' }, { track: 1 });
  eq([r.score.tracks[1].measures[2].clef, r.score.tracks[0] === s.tracks[0]], ['tenor', true]);
  for (const name of CLEF_NAMES) ok(MS.updateMeasure(s, c, 2, { clef: name.toUpperCase() }, { track: 1 }).score, name);
  eq(CLEF_NAMES.length, 12);
});

// ---------- ending / section / jump ----------
test('ending forms: number, array (sorted, deduplicated by throwing), object with text or open; always the shortest stored form; getMeasureSettings output accepted back unchanged', () => {
  const s = model({ tracks: [tab([{ beats: [] }, { beats: [] }]), tab([{ beats: [] }, { beats: [] }])] });
  const c = cur(0, 0, 0);
  const store = (v) => MS.updateMeasure(s, c, 1, { ending: v }).score.tracks.map((t) => t.measures[1].ending);
  const cases = [
    [1, [1, 1]], [[1], [1, 1]], [[2, 1], [[1, 2], [1, 2]]], [{ numbers: 1 }, [1, 1]], [{ numbers: [3] }, [3, 3]], [{ numbers: [2, 1, 3] }, [[1, 2, 3], [1, 2, 3]]],
    [{ numbers: 1, text: '  ' }, [1, 1]], [{ numbers: [1, 2], text: null }, [[1, 2], [1, 2]]], [{ numbers: 2, text: 'Last time' }, [{ numbers: 2, text: 'Last time' }, { numbers: 2, text: 'Last time' }]],
    [{ numbers: [1, 2], open: true }, Array(2).fill({ numbers: [1, 2], open: true })], [{ numbers: 1, text: 'x', open: false }, Array(2).fill({ numbers: 1, text: 'x', open: false })],
  ];
  for (const [input, want] of cases) {
    eq(store(input), want, JSON.stringify(input));
    const stored = MS.updateMeasure(s, c, 1, { ending: input }).score;
    const g = MS.getMeasureSettings(stored, 1, 0).ending;
    ok(MS.updateMeasure(stored, c, 1, { ending: g }).score === stored, `${JSON.stringify(input)}: getMeasureSettings().ending is a valid patch and a no-op`);
    ok(sanitizeScore(stored) === stored);
  }
  eq(MS.updateMeasure(s, c, 1, { ending: 99 }).score.tracks[0].measures[1].ending, 99);
  eq(MS.updateMeasure(s, c, 1, { ending: [99, 1] }).score.tracks[0].measures[1].ending, [1, 99]);
  eq(say(MS.updateMeasure(s, c, 1, { ending: { numbers: [1, 3], text: 'x' } })), 'Ending x at measure 2');
  eq(say(MS.updateMeasure(s, c, 1, { ending: 2, segno: true })), 'Measure 2 settings updated');
});
test('ending: replacing and removing; a legacy ending of an invalid form on a track is overwritten column-wide; unknown ending keys throw', () => {
  const s = model({ tracks: [tab([{ beats: [] }, { beats: [], ending: { numbers: [1], text: 'x', open: true } }]), tab([{ beats: [] }, { beats: [], ending: 'bogus' }])] });
  const c = cur(0, 0, 0);
  const a = MS.updateMeasure(s, c, 1, { ending: 2 }).score;
  eq(a.tracks.map((t) => t.measures[1].ending), [2, 2]);
  const b = MS.updateMeasure(s, c, 1, { ending: null }).score;
  eq(b.tracks.map((t) => 'ending' in t.measures[1]), [false, false], 'null removes it on every track, even an invalid one');
  eq(MS.getMeasureSettings(s, 1, 1).ending, { numbers: [1], text: 'x', open: true });
  throwsClean(s, () => MS.updateMeasure(s, c, 1, { ending: { numbers: [1], color: 'red' } }), TypeError, 'Unknown ending field');
  throwsClean(s, () => MS.updateMeasure(s, c, 1, { ending: { numbers: [1.5] } }), RangeError);
  throwsClean(s, () => MS.updateMeasure(s, c, 1, { ending: [1, 'x'] }), TypeError);
});
test('jump: all 8 standard texts in any case and spacing; a custom jump already in the file is kept by every other patch, reported as custom, and only null or a standard text replaces it', () => {
  const s = model({ tracks: [tab([{ beats: [] }, { beats: [], jump: 'Play twice', section: 'Verse' }, { beats: [] }]), tab([{ beats: [] }, { beats: [], jump: 'Fine' }, { beats: [] }])] });
  const c = cur(0, 0, 0);
  for (const j of JUMP_TEXTS) {
    for (const v of [j, j.toLowerCase(), `  ${j.toUpperCase()} `]) {
      const r = MS.updateMeasure(s, c, 2, { jump: v }).score;
      eq(r.tracks.map((t) => t.measures[2].jump), [j, j], v);
      eq(MS.getMeasureSettings(r, 2, 0).jumpCustom, false);
    }
  }
  const g = MS.getMeasureSettings(s, 1, 0);
  eq([g.jump, g.jumpCustom], ['Play twice', true], 'the lowest track index wins, and its text is custom');
  const other = MS.updateMeasure(s, c, 1, { section: 'Chorus', segno: true }).score;
  eq(other.tracks.map((t) => t.measures[1].jump), ['Play twice', 'Fine'], 'other fields leave both jumps as they are');
  eq(MS.getMeasureSettings(other, 1, 0).jump, 'Play twice');
  eq(MS.updateMeasure(s, c, 1, { jump: null }).score.tracks.map((t) => 'jump' in t.measures[1]), [false, false]);
  eq(MS.updateMeasure(s, c, 1, { jump: 'D.S.' }).score.tracks.map((t) => t.measures[1].jump), ['D.S.', 'D.S.']);
  eq(MS.updateMeasure(s, c, 1, { jump: 'fine' }).score.tracks.map((t) => t.measures[1].jump), ['Fine', 'Fine'], 'the track that held "Fine" is unchanged by reference');
  ok(MS.updateMeasure(s, c, 1, { jump: 'fine' }).score.tracks[1] === s.tracks[1]);
  throwsClean(s, () => MS.updateMeasure(s, c, 1, { jump: 'Play twice' }), RangeError, 'Jump must be one of');
  throwsClean(s, () => MS.updateMeasure(s, c, 1, { jump: '' }), RangeError);
});
test('section forms: text stored trimmed; {letter, text} stored as written; letter counts code points; both replace each other column-wide; null removes', () => {
  const s = model({ tracks: [tab([{ beats: [] }, { beats: [], section: 'Old' }]), tab([{ beats: [] }, { beats: [], section: { letter: 'Z', text: 'zz' } }])] });
  const c = cur(0, 0, 0);
  const at = (v) => MS.updateMeasure(s, c, 1, { section: v }).score.tracks.map((t) => t.measures[1].section);
  eq(at('  Chorus  '), ['Chorus', 'Chorus']);
  eq(at({ letter: ' A ', text: ' x ' }), Array(2).fill({ letter: 'A', text: 'x' }));
  eq(at({ letter: 'ABC' }), Array(2).fill({ letter: 'ABC' }));
  eq(at({ letter: 'A', text: '   ' }), Array(2).fill({ letter: 'A' }));
  eq(at({ letter: '😀😀😀' })[0], { letter: '😀😀😀' });
  eq(at(null), [undefined, undefined]);
  eq(at('x'.repeat(200))[0].length, 200);
  throwsClean(s, () => MS.updateMeasure(s, c, 1, { section: { letter: '😀😀😀😀' } }), RangeError);
  throwsClean(s, () => MS.updateMeasure(s, c, 1, { section: { letter: 'A\nB' } }), RangeError);
  throwsClean(s, () => MS.updateMeasure(s, c, 1, { section: { letter: 'A', text: 'x'.repeat(201) } }), RangeError);
  eq(at(''), [undefined, undefined], 'an empty string deletes it, like any text');
});

// ---------- barline / repeatCount coupling ----------
test('barline / repeatCount: in one patch (barline first), across patches, and what survives each barline change', () => {
  let s = model({ tracks: [tab([{ beats: [] }, { beats: [] }]), tab([{ beats: [] }, { beats: [] }])] });
  const c = cur(0, 0, 0);
  const col = (sc, f) => sc.tracks.map((t) => t.measures[1][f]);
  throwsClean(s, () => MS.updateMeasure(s, c, 1, { repeatCount: 3 }), RangeError, 'repeat end');
  throwsClean(s, () => MS.updateMeasure(s, c, 1, { barline: 'double', repeatCount: 3 }), RangeError);
  throwsClean(s, () => MS.updateMeasure(s, c, 1, { barline: null, repeatCount: 3 }), RangeError);
  throwsClean(s, () => MS.updateMeasure(s, c, 1, { barline: 'repeatStart', repeatCount: 3 }), RangeError);
  s = MS.updateMeasure(s, c, 1, { repeatCount: null }).score;
  ok(s.tracks.every((t) => !('repeatCount' in t.measures[1])), 'removing a count that is not there is no change');
  s = MS.updateMeasure(s, c, 1, { barline: 'repeatEnd' }).score;
  eq(col(s, 'repeatCount'), [undefined, undefined]);
  s = MS.updateMeasure(s, c, 1, { repeatCount: 5 }).score;
  eq([col(s, 'barline'), col(s, 'repeatCount')], [['repeatEnd', 'repeatEnd'], [5, 5]], 'across patches: the column barline satisfies the rule');
  const same = MS.updateMeasure(s, c, 1, { barline: 'repeatEnd' });
  ok(same.score === s, 'the same barline again keeps the count and changes nothing');
  eq(col(MS.updateMeasure(s, c, 1, { barline: 'repeatEnd', repeatCount: null }).score, 'repeatCount'), [undefined, undefined]);
  for (const b of ['single', 'double', 'final', 'repeatStart', null]) {
    const r = MS.updateMeasure(s, c, 1, { barline: b }).score;
    eq([col(r, 'barline'), col(r, 'repeatCount')], [[b ?? undefined, b ?? undefined], [undefined, undefined]], `${b}: the count goes in the same step`);
    throwsClean(r, () => MS.updateMeasure(r, c, 1, { repeatCount: 3 }), RangeError);
  }
  const one = MS.updateMeasure(s, c, 1, { barline: 'double' });
  eq(say(one), 'Double barline at measure 2');
  eq(MS.updateMeasure(s, c, 1, { barline: 'repeatEnd', repeatCount: 7 }).score.tracks.map((t) => t.measures[1].repeatCount), [7, 7]);
  eq(MS.updateMeasure(s, c, 1, { repeatCount: 2 }).score.tracks[0].measures[1].repeatCount, 2);
  eq(MS.updateMeasure(s, c, 1, { repeatCount: 99 }).score.tracks[0].measures[1].repeatCount, 99);
  throwsClean(s, () => MS.updateMeasure(s, c, 1, { repeatCount: 100 }), RangeError);
});
test('repeatCount rule reads the renderer\'s column barline: the lowest track index with a barline decides; a count on any track is overwritten column-wide', () => {
  const s = model({ tracks: [tab([{ beats: [] }, { beats: [], barline: 'double' }]), tab([{ beats: [] }, { beats: [], barline: 'repeatEnd', repeatCount: 3 }])] });
  const c = cur(0, 0, 0);
  eq(MS.getMeasureSettings(s, 1, 1).barline, 'double', 'the winner is track 0');
  throwsClean(s, () => MS.updateMeasure(s, c, 1, { repeatCount: 4 }), RangeError, 'repeat end');
  const fixed = MS.updateMeasure(s, c, 1, { barline: 'repeatEnd', repeatCount: 4 }).score;
  eq(fixed.tracks.map((t) => [t.measures[1].barline, t.measures[1].repeatCount]), [['repeatEnd', 4], ['repeatEnd', 4]]);
  const dbl = MS.updateMeasure(fixed, c, 1, { barline: 'double' }).score;
  eq(dbl.tracks.map((t) => 'repeatCount' in t.measures[1]), [false, false]);
  const hiddenHolds = model({ tracks: [tab([{ beats: [] }, { beats: [] }]), tab([{ beats: [] }, { beats: [], barline: 'repeatEnd' }], { ...HIDDEN })] });
  eq(MS.updateMeasure(hiddenHolds, c, 1, { repeatCount: 2 }).score.tracks.map((t) => t.measures[1].repeatCount), [2, 2], 'a hidden track\'s repeat end counts');
});
test('segno / coda / section / ending set together with barline: one patch applies every field; the messages say "settings updated"', () => {
  const s = model({ tracks: [tab([{ beats: [] }, { beats: [] }])] });
  const r = MS.updateMeasure(s, cur(0, 0, 0), 1, { barline: 'repeatEnd', repeatCount: 2, ending: 1, segno: true, coda: true, jump: 'Fine', section: 'S', timeSignature: { beats: 5, beatType: 4 }, keySignature: 1, clef: 'bass' });
  eq(r.score.tracks[0].measures[1], { beats: [], timeSignature: { beats: 5, beatType: 4 }, keySignature: 1, clef: 'bass', barline: 'repeatEnd', repeatCount: 2, ending: 1, segno: true, coda: true, jump: 'Fine', section: 'S' });
  eq(say(r), 'Measure 2 settings updated');
  ok(sanitizeScore(r.score) === r.score);
});
test('updateMeasure on a measure beyond a short track pads it with empty measures only for writes, never for deletes or equal values', () => {
  const s = model({ tracks: [tab([{ beats: [] }, { beats: [] }, { beats: [] }]), tab([{ beats: [] }])] });
  const w = MS.updateMeasure(s, cur(0, 0, 0), 2, { segno: true }).score;
  eq(w.tracks[1].measures, [{ beats: [] }, { beats: [] }, { beats: [], segno: true }]);
  eq(MS.updateMeasure(s, cur(0, 0, 0), 2, { segno: null, jump: null, ending: null }).score, s);
  eq(MS.updateMeasure(s, cur(0, 0, 0), 2, { timeSignature: null }).score.tracks[1].measures.length, 1, 'a delete does not create measures');
  const sameBase = MS.updateMeasure(s, cur(0, 0, 0), 2, { timeSignature: { beats: 4, beatType: 4 } });
  ok(sameBase.score === s, 'the default signature in force: nothing to write');
});

// ---------- getMeasureSettings across baselines ----------
test('getMeasureSettings: inherited and here over score, track and measure baselines for every track and measure equal normalizeScore; random scores', () => {
  const rnd = mulberry32(5150);
  for (let i = 0; i < 150; i++) {
    const s = randomScore(rnd);
    const n = normalizeScore(s);
    const cols = n.navigation.length;
    for (let ti = 0; ti < s.tracks.length; ti++) for (let mi = 0; mi < cols; mi++) {
      const g = MS.getMeasureSettings(s, mi, ti);
      const nm = n.tracks[ti].measures[mi];
      eq([g.timeSignature.beats, g.timeSignature.beatType, g.keySignature.value], [nm.timeSignature.beats, nm.timeSignature.beatType, nm.keySignature], `run ${i} ${ti}/${mi}`);
      eq(g.clef.value, clefAt(s.tracks[ti], mi));
      const col = n.navigation[mi];
      eq([g.segno, g.coda, g.jump, g.ending, g.repeatCount], [col.segno, col.coda, col.jump, col.ending, col.repeatCount ?? null], `nav, run ${i}`);
      const prev = mi > 0 ? n.tracks[ti].measures[mi - 1] : null;
      if (prev) {
        eq(g.timeSignature.inherited, { beats: prev.timeSignature.beats, beatType: prev.timeSignature.beatType });
        eq(g.keySignature.inherited, prev.keySignature);
      }
    }
  }
});

// ---------- sanitize identity across tracks, F1 ----------
test('every track operation result is sanitize-stable on random scores (add, remove, move, retune to every preset)', () => {
  const rnd = mulberry32(77);
  for (let i = 0; i < 200; i++) {
    const s = randomScore(rnd);
    for (const r of [TS.addTrack(s, cur(0, 0, 0)), s.tracks.length > 1 ? TS.removeTrack(s, cur(0, 0, 0), s.tracks.length - 1) : null, s.tracks.length > 1 ? TS.moveTrack(s, cur(0, 0, 0), 0, s.tracks.length - 1) : null]) {
      if (r && r.score) ok(sanitizeScore(r.score) === r.score, `run ${i}`);
    }
  }
  const ts = F.timeSignatureAt(model({ tracks: [tab([])] }), { track: 0, measure: 0 });
  eq([ts.beats, ts.beatType], [4, 4]);
});

// ---------- setTempo with voices, patch allowlists ----------
const SC = await imp('src/editor/model/settings/score.js');
test('setTempo on a two-voice measure writes voice 1 only (voices[0]), never measure.beats beside the voices or voice 2; tempoAt reads it back; the append slot is refused', () => {
  const s = model({ tracks: [tab([{ voices: [{ beats: [nt('half'), nt('half')] }, { beats: [nt('whole', 2, 0)] }], beats: [nt('whole')] }, { beats: [nt('whole')] }])] });
  const r = SC.setTempo(s, cur(0, 0, 1), 100);
  const m = r.score.tracks[0].measures[0];
  eq([m.voices[0].beats[1].tempo, 'tempo' in m.voices[0].beats[0], 'tempo' in m.voices[1].beats[0], 'tempo' in m.beats[0]], [100, false, false, false]);
  eq(SC.tempoAt(r.score, cur(0, 0, 1)), { bpm: 100, unit: 'quarter', dots: 0, text: null, here: true });
  eq(SC.tempoAt(r.score, cur(0, 1, 0)).here, false, 'carried into the next measure');
  eq(SC.setTempo(r.score, cur(0, 0, 1), null).score.tracks[0].measures[0].voices[0].beats[1], nt('half'));
  eq(SC.setTempo(s, cur(0, 0, 2), 90), { refused: { id: 'noBeat' } });
  ok(sanitizeScore(r.score) === r.score);
});
test('every patch allowlist rejects prototype and structure keys with a TypeError and leaves the model alone; inherited keys are not read', () => {
  const s = model({ tracks: [tab([{ beats: [nt('quarter')] }]), tab([{ beats: [] }])] });
  const c = cur(0, 0, 0);
  const keys = ['__proto__', 'constructor', 'prototype', 'hasOwnProperty', 'toString', 'tracks', 'measures', 'beats', 'voices', 'schemaVersion', 'notes'];
  const calls = [
    (p) => SC.updateScore(s, c, p), (p) => TR.updateTrack(s, c, 0, p), (p) => MS.updateMeasure(s, c, 0, p), (p) => TS.addTrack(s, c, p),
  ];
  for (const f of calls) for (const k of keys) {
    const patch = JSON.parse(`{"${k}": {"polluted": 1}}`);
    throwsClean(s, () => f(patch), TypeError, k === '__proto__' ? '__proto__' : '');
  }
  const inherited = Object.create({ title: 'inherited' });
  let r;
  try { r = SC.updateScore(s, c, inherited); } catch (e) { ok(e instanceof TypeError, 'a non-plain object is a TypeError'); }
  if (r) ok(r.score === s, 'inherited keys are ignored');
  ok(({}).polluted === undefined && !('polluted' in Object.prototype));
});

// ---------- report ----------
export function summary() {
  let fail = 0;
  for (const r of results) {
    if (r.ok) console.log(`PASS editor-settings-edge: ${r.name}`);
    else { fail++; console.log(`FAIL editor-settings-edge: ${r.name}\n  ${r.msg}`); }
  }
  return fail;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const f = summary();
  console.log(f ? `\n${f} FAILED` : '\nALL PASSED');
  process.exit(f ? 1 : 0);
}
