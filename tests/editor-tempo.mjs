// 2.3.0 score-wide tempo (requirements area 1, criteria 1-6) and the pickup measure (area 8, criteria 39-42):
// tempoAt / setTempo / removeTrack across tracks, hidden tracks, overfull measures, triplets, graces, voice 2
// and the slot; render parity of the editor's winners with the renderer's tempo changes on seeded random scores.
// Run via `node tests/run.js` (awaits summary()), or directly: `node tests/editor-tempo.mjs`.
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

register('./hooks.mjs', import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const io = await imp('src/editor/model/io.js');
const C = await imp('src/editor/model/cursor.js');
const TP = await imp('src/editor/model/settings/tempo.js');
const SC = await imp('src/editor/model/settings/score.js');
const TS = await imp('src/editor/model/settings/tracks.js');
const { describe } = await imp('src/editor/announce.js');
const { formatBpm } = await imp('src/expression.js');
const { sanitizeScore } = await imp('src/sanitize.js');
const { makeContainer } = await import('./dom-shim.mjs');
const { makeClock } = await import('./editor-shim.mjs');
const { ScoreEditor } = await imp('src/editor/ScoreEditor.js');
const { drawnTempos } = await import('./editor-pins-2.3.mjs');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const eq = (a, b, m = '') => {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${m} expected ${y}, got ${x}`);
};
const ok = (c, m = 'assertion failed') => { if (!c) throw new Error(m); };
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const model = (s) => io.parseInput(s);
const nt = (duration, string = 1, fret = 0, extra = {}) => ({ type: 'note', duration, notes: [{ string, fret }], ...extra });
const rest = (duration = 'quarter', extra = {}) => ({ type: 'rest', duration, ...extra });
const grace = (extra = {}) => ({ type: 'grace', duration: '16th', notes: [{ string: 2, fret: 3 }], ...extra });
const tab = (measures, extra = {}) => ({ name: 'Gtr', showTablature: true, ...extra, measures });
const cur = (track, measure, beat, string = 1) => ({ track, measure, beat, string });
const st = { duration: 'quarter', dots: 0, digit: null };
const info = (s, c) => C.cursorInfo(s, c, st);
const Q = (bpm, here) => ({ bpm, unit: 'quarter', dots: 0, text: null, here });
const marksAt = (s, measure) => TP.tempoMarks(s).marks.filter((m) => m.measure === measure).map((m) => [m.track, m.beat, m.raw]);
/** An editor with synchronous renders. */
function mk(score) {
  const clock = makeClock();
  clock.requestAnimationFrame = null; clock.cancelAnimationFrame = null;
  return new ScoreEditor(makeContainer(), score, { width: 900, clock });
}

// ---------- criteria 1-3 ----------
test('criterion 1: a mark on track 0 at measure 1 beat 1 is in force on track 1 at measure 3, here false', () => {
  const s = model({ tracks: [
    tab([{ beats: [nt('whole', 1, 0, { tempo: 132 })] }, { beats: [nt('whole')] }, { beats: [nt('whole')] }]),
    tab([{ beats: [nt('half'), nt('half')] }, { beats: [] }, { beats: [nt('quarter'), nt('half')] }], { name: 'B' }),
  ] });
  eq(info(s, cur(1, 2, 1)).tempo, Q(132, false));
  eq(info(s, cur(1, 0, 0)).tempo, Q(132, true), 'track 1 beat at the same onset: here');
  eq(info(s, cur(1, 0, 1)).tempo, Q(132, false));
  const ed = mk(s);
  ed.setCursor({ track: 1, measure: 2, beat: 1 });
  eq(ed.getCursorInfo().tempo, Q(132, false), 'through the public API');
  ed.destroy();
});
test('criterion 2: marks at one onset on tracks 1 and 2: the track-1 mark wins, whatever the beat indices (graces before it)', () => {
  const s = model({ tracks: [
    tab([{ beats: [nt('whole')] }]),
    tab([{ beats: [grace(), grace(), nt('half'), nt('half', 1, 0, { tempo: 100 })] }], { name: 'B' }),
    tab([{ beats: [nt('quarter'), nt('quarter'), nt('half', 1, 0, { tempo: 60 })] }], { name: 'C' }),
  ] });
  eq(TP.tempoAt(s, cur(0, 0, 1)), Q(100, false), 'slot of track 0 (onset = whole)');
  eq(TP.tempoAt(s, cur(2, 0, 2)), Q(100, true), 'track 2 at that onset sees the track-1 mark');
  eq(TP.tempoMarks(s).winners.map((w) => w.track), [1]);
  eq(drawnTempos(s), ['= 100'], 'the renderer agrees');
});
test('criterion 3: a mark only on a hidden track is reported (and drawn)', () => {
  const s = model({ tracks: [
    tab([{ beats: [nt('half'), nt('half')] }]),
    { name: 'Hidden', showStandardNotation: false, measures: [{ beats: [nt('half'), nt('half', 1, 0, { tempo: 77 })] }] },
  ] });
  eq(TP.tempoAt(s, cur(0, 0, 1)), Q(77, true));
  eq(TP.tempoAt(s, cur(0, 0, 0)), null);
  eq(drawnTempos(s), ['= 77']);
});
test('tempoAt: overfull measures, triplets, graces and voice 2: onsets are exact; voice 2 and grace marks are never read; slot here is false', () => {
  const s = model({ tracks: [
    tab([{ beats: [nt('whole'), nt('half', 1, 0, { tempo: 90 })] }, { beats: [nt('8th', 1, 0, { tuplet: 3 }), nt('8th', 1, 0, { tuplet: 3 }), nt('8th', 1, 0, { tuplet: 3 }), nt('quarter'), nt('half')] }]),
    tab([{ beats: [nt('whole'), nt('half')] }, { beats: [nt('quarter', 1, 0, { tempo: 50 }), grace({ tempo: 33 }), nt('quarter', 1, 0, { tempo: 55 }), nt('half')] }], { name: 'B' }),
    tab([{ voices: [{ beats: [nt('whole')] }, { beats: [nt('half'), nt('half', 1, 0, { tempo: 200 })] }] }], { name: 'V' }),
  ] });
  eq(TP.tempoAt(s, cur(1, 0, 1)), Q(90, true), 'overfull: onset 1 on another track');
  eq(TP.tempoAt(s, cur(1, 1, 0)), Q(50, true));
  eq(TP.tempoAt(s, cur(0, 1, 3)), Q(55, true), 'after a triplet group: onset 1/4 matches the beat after a grace');
  eq(TP.tempoAt(s, cur(0, 1, 1)), Q(50, false), 'inside the triplet');
  eq(TP.tempoAt(s, cur(1, 1, 4)), Q(55, false), 'slot position (onset = total)');
  ok(!TP.tempoMarks(s).marks.some((m) => m.raw === 33 || m.raw === 200), 'grace and voice-2 marks are not read');
  eq(drawnTempos(s), ['= 90', '= 50', '= 55']);
});

// ---------- criteria 4-6 ----------
test('criterion 4: setTempo(90) on track 1 at the onset of a track-0 mark leaves exactly one mark (track 1, drawn 90); one undo restores both', () => {
  const src = { tracks: [
    tab([{ beats: [nt('half'), nt('half', 1, 0, { tempo: 120 })] }]),
    tab([{ beats: [nt('quarter'), nt('quarter'), nt('half', 1, 0, { tempo: 'junk' })] }], { name: 'B' }),
    tab([{ beats: [nt('half'), nt('half', 1, 0, { tempo: 70 })] }], { name: 'C' }),
  ] };
  const ed = mk(src);
  const before = ed._model;
  ed.setCursor({ track: 1, measure: 0, beat: 2 });
  eq(ed.setTempo(90), true);
  eq(marksAt(ed._model, 0), [[1, 2, 90]]);
  eq(drawnTempos(ed._model), ['= 90']);
  eq(ed.getCursorInfo().tempo, Q(90, true));
  ok(sanitizeScore(ed._model) === ed._model);
  ed.undo();
  ok(ed._model === before, 'one undo step');
  eq(marksAt(ed._model, 0), [[0, 1, 120], [2, 1, 70]]);
  ed.destroy();
});
test('criterion 5: setTempo(null) clears the marks at that onset on every track; marks at other onsets stay; no mark at all is no change', () => {
  const s = model({ tracks: [
    tab([{ beats: [nt('half', 1, 0, { tempo: 60 }), nt('half', 1, 0, { tempo: 120 })] }]),
    tab([{ beats: [nt('quarter'), nt('quarter'), nt('half', 1, 0, { tempo: 130 })] }], { name: 'B' }),
  ] });
  const r = SC.setTempo(s, cur(1, 0, 2), null);
  eq(marksAt(r.score, 0), [[0, 0, 60]]);
  eq(describe(r.announce), 'Tempo removed');
  const r2 = TP.setTempo(r.score, cur(1, 0, 2), null);
  ok(r2.score === r.score, 'nothing to remove: same score');
  eq(TP.setTempo(s, cur(0, 0, 1), 120).score.tracks[1].measures[0].beats[2].tempo, undefined, 'same value on the winner still removes the shadowed mark');
});
test('criterion 6: removeTrack(0) moves a mark to track 1 when it has a beat at that onset; otherwise drops and announces it; shadowed marks drop silently', () => {
  const s = model({ tracks: [
    tab([{ beats: [nt('quarter', 1, 0, { tempo: 80 }), nt('quarter', 1, 0, { tempo: 90 }), nt('half', 1, 0, { tempo: 100 })] }]),
    tab([{ beats: [nt('half'), nt('half', 1, 0, { tempo: 111 })] }], { name: 'B' }),
    { name: 'Bass', showTablature: true, showStandardNotation: false, measures: [{ beats: [nt('whole'), nt('quarter')] }] },
  ] });
  eq(TP.lostTempoMarks(s, 0), 1, 'the mark at onset 1/4 has no beat on another track');
  const r = TS.removeTrack(s, cur(0, 0, 0), 0);
  eq(marksAt(r.score, 0), [[0, 0, 80], [0, 1, 100]], 'onset 0: the lowest remaining track only; onset 1/2: 100 replaces the shadowed 111');
  eq(describe(r.announce), 'Track 1 Gtr removed, 1 tempo mark removed');
  const two = model({ tracks: [tab([{ beats: [nt('8th', 1, 0, { tempo: 50 }), nt('8th', 1, 0, { tempo: 51 }), nt('half')] }]), tab([{ beats: [nt('quarter'), nt('half')] }], { name: 'B' })] });
  eq(describe(TS.removeTrack(two, cur(0, 0, 0), 0).announce), 'Track 1 Gtr removed, 1 tempo mark removed');
  const both = model({ tracks: [tab([{ beats: [nt('8th'), nt('8th', 1, 0, { tempo: 51 }), nt('8th', 1, 0, { tempo: 52 }), nt('8th')] }]), tab([{ beats: [nt('half')] }], { name: 'B' })] });
  eq(describe(TS.removeTrack(both, cur(0, 0, 0), 0).announce), 'Track 1 Gtr removed, 2 tempo marks removed');
  ok(sanitizeScore(r.score) === r.score);
});
test('moveTrack changes no tempo mark; the editor and the renderer agree on the winner after it', () => {
  const s = model({ tracks: [
    tab([{ beats: [nt('whole', 1, 0, { tempo: 60 })] }]),
    tab([{ beats: [nt('whole', 1, 0, { tempo: 70 })] }], { name: 'B' }),
  ] });
  const r = TS.moveTrack(s, cur(0, 0, 0), 1, 0);
  eq(TP.tempoAt(r.score, cur(0, 0, 0)).bpm, 70);
  eq(drawnTempos(r.score), ['= 70']);
});
test('tempoMarks is memoized per model and recomputed for a new one', () => {
  const s = model({ tracks: [tab([{ beats: [nt('whole', 1, 0, { tempo: 60 })] }])] });
  ok(TP.tempoMarks(s) === TP.tempoMarks(s));
  const r = TP.setTempo(s, cur(0, 0, 0), 61);
  eq(TP.tempoAt(r.score, cur(0, 0, 0)).bpm, 61);
});

// ---------- render parity ----------
const DURS = ['whole', 'half', 'quarter', '8th', '16th'];
/** A random raw multi-track score with tempo marks (some invalid) on main beats, graces, triplets, voice 2 and hidden tracks. */
function randomScore(rnd) {
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  const measures = 1 + Math.floor(rnd() * 5);
  const tracks = Array.from({ length: 1 + Math.floor(rnd() * 3) }, (_, ti) => {
    const ms = Array.from({ length: measures }, () => {
      const beats = [];
      const n = Math.floor(rnd() * 6);
      for (let k = 0; k < n; k++) {
        if (rnd() < 0.1) beats.push(grace(rnd() < 0.5 ? { tempo: 44 } : {}));
        const b = rnd() < 0.2 ? rest(pick(DURS)) : nt(pick(DURS), 1 + Math.floor(rnd() * 6), Math.floor(rnd() * 12));
        if (rnd() < 0.15) b.tuplet = 3;
        if (rnd() < 0.1) b.dots = 1;
        if (rnd() < 0.3) b.tempo = rnd() < 0.15 ? 'nope' : rnd() < 0.5 ? 40 + Math.floor(rnd() * 160) : { bpm: 40 + Math.floor(rnd() * 160), unit: 'half' };
        beats.push(b);
      }
      return rnd() < 0.15 ? { voices: [{ beats }, { beats: [nt('whole', 3, 1, { tempo: 199 })] }] } : { beats };
    });
    const hidden = ti > 0 && rnd() < 0.25;
    return hidden ? { name: `H${ti}`, showStandardNotation: false, measures: ms } : { name: `T${ti}`, showTablature: rnd() < 0.7, measures: ms };
  });
  if (!tracks.some((t) => t.showStandardNotation !== false || t.showTablature)) tracks[0].showStandardNotation = true;
  return { tracks };
}
test('render parity: on 50 seeded random multi-track scores the editor winners, in order, are the renderer\'s drawn tempo changes', () => {
  const rnd = mulberry32(2300);
  for (let i = 0; i < 50; i++) {
    const s = model(randomScore(rnd));
    const want = TP.tempoMarks(s).winners.map((w) => `= ${formatBpm(w.tempo.bpm)}`);
    eq(drawnTempos(s), want, `score ${i}`);
  }
});

// ---------- report ----------
export async function summary() {
  let fail = 0;
  for (const t of tests) {
    try { await t.fn(); console.log(`PASS editor-tempo: ${t.name}`); } catch (e) { fail++; console.log(`FAIL editor-tempo: ${t.name}\n  ${e.stack || e.message}`); }
  }
  return fail;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const f = await summary();
  console.log(f ? `\n${f} FAILED` : '\nALL PASSED');
  process.exit(f ? 1 : 0);
}
