// 2.3.1 edge cases against the criteria and decisions, model level: overwrite paste over measure fields and other
// tracks, past the end, tempo rehome, insert paste at measure 1, blank selections, range effects, transpose,
// the reflow split for every meter / duration / position, the cascade, limits and the cursor.
// Run via `node tests/run.js` (calls summary()), or directly: `node tests/editor-range-edge.mjs`.
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { model, nt, tn, rest, grace, tab, cur, st, P, v1, run, said, clipText, parse, same, eq, ok, mulberry32 } from './editor-range.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const SEL = await imp('src/editor/model/selection.js');
const CMD = await imp('src/editor/model/commands.js');
const CL = await imp('src/editor/model/clip.js');
const PA = await imp('src/editor/model/paste.js');
const A = await imp('src/editor/model/access.js');
const C = await imp('src/editor/model/cursor.js');
const RS = await imp('src/editor/model/reflowSplit.js');
const { describe } = await imp('src/editor/announce.js');
const { EDITOR_LIMITS: L } = await imp('src/editor/model/limits.js');
const { R, ZERO, add, cmp } = await imp('src/rational.js');
const { beatR } = await imp('src/editor/model/fill.js');
const { DURATIONS } = await imp('src/editor/model/durations.js');

const results = [];
const test = (name, fn) => {

  try { fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, msg: e.stack || e.message }); }
};
const J = (x) => JSON.stringify(x);
const whole = (f) => ({ beats: [nt('whole', 1, f)] });
const runX = (name, s, c, sel, arg, extra = {}) => CMD.run(name, s, c, st(), { maxFret: 24, now: 0, twoDigitDelayMs: 800, allowAppend: true, selection: sel, ...extra }, arg);
const range = (s, ti, a, b) => SEL.selectionRange(s, ti, a, b);
const copyOf = (s, ti, a, b) => parse(CL.buildClip(s, range(s, ti, P(a, 0), P(b, 0))).text);

// ---------- A. overwrite paste: measure fields, other tracks, the end ----------
test('A1 overwrite over measures with signatures, repeats, endings, section, pickup and voice 2 on 3 tracks: the fields stay, both voices go, the other tracks are the same objects', () => {
  const fields = [
    { pickup: true, timeSignature: { beats: 3, beatType: 4 }, keySignature: 2 },
    { barline: 'repeatEnd', repeatCount: 3, ending: [1, 2], section: 'Verse', clef: 'bass' },
    { repeatStart: true, voices: [{ beats: [nt('half', 1, 1)] }, { beats: [nt('half', 4, 4)] }] },
  ];
  const mine = tab(fields.map((f, i) => ({ beats: [nt('whole', 1, i)], ...f })));
  const s = model({ tracks: [tab([whole(7), whole(7), whole(7)], { name: 'A' }), { ...mine, name: 'B' }, tab([{ voices: [{ beats: [nt('whole', 2, 2)] }, { beats: [nt('whole', 5, 5)] }] }, whole(1), { beats: [] }], { name: 'C' })] });
  const clip = parse(clipText('measures', [whole(20), { voices: [{ beats: [nt('quarter', 2, 2)] }, { beats: [nt('quarter', 5, 5)] }] }, whole(22)]));
  const r = PA.applyPaste(s, cur(1, 0, 0), range(s, 1, P(0, 0), P(2, 1)), clip);
  eq(r.announce.id, 'pastedOver');
  ok(r.score.tracks[0] === s.tracks[0] && r.score.tracks[2] === s.tracks[2], 'other tracks are the same objects');
  const ms = r.score.tracks[1].measures;
  eq(ms.map((m) => Object.keys(m).filter((k) => k !== 'beats' && k !== 'voices').sort()), fields.map((f) => Object.keys(f).filter((k) => k !== 'voices').sort()));
  eq(ms.map((m) => [m.pickup ?? null, m.barline ?? null, m.section ?? null, m.ending ?? null, m.repeatStart ?? null, m.timeSignature ?? null]), fields.map((f) => [f.pickup ?? null, f.barline ?? null, f.section ?? null, f.ending ?? null, f.repeatStart ?? null, f.timeSignature ?? null]));
  eq([ms[0].beats, 'voices' in ms[0], ms[1].voices, 'beats' in ms[1], ms[2].beats, 'voices' in ms[2]], [[nt('whole', 1, 20)], false, [{ beats: [nt('quarter', 2, 2)] }, { beats: [nt('quarter', 5, 5)] }], false, [nt('whole', 1, 22)], false]);
  ok(same(r.score));
});
test('A2 overwrite property over 3000 random 3-track scores (fields, voices, short and hidden tracks, selections, insert and overwrite): sanitize identity, other tracks unchanged, fields kept, the tail untouched', () => {
  const rnd = mulberry32(231);
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  const fieldsOf = () => pick([{}, {}, { timeSignature: { beats: 3, beatType: 4 } }, { barline: 'repeatEnd', repeatCount: 2 }, { ending: [1] }, { section: 'B' }, { keySignature: 2 }, { clef: 'bass' }, { repeatStart: true }]);
  const mm = (i, blank) => (blank ? { ...fieldsOf(), beats: [] } : pick([
    { ...fieldsOf(), beats: [nt('quarter', 1, i % 10), nt('quarter', 2, 3)] }, { ...fieldsOf(), voices: [{ beats: [nt('half', 1, i % 7)] }, { beats: [nt('half', 4, 2)] }] },
    { ...fieldsOf(), beats: [nt('whole', 1, i % 5)] }, { ...fieldsOf(), beats: [rest('whole')] }]));
  let over = 0;
  for (let it = 0; it < 3000; it++) {
    const nm = 3 + Math.floor(rnd() * 8);
    const s = model({ tracks: [0, 1, 2].map((t) => tab(Array.from({ length: t === 1 && rnd() < 0.3 ? Math.max(1, nm - 3) : nm }, (_, i) => mm(i + t, rnd() < 0.4)), { name: `T${t}`, ...(t === 2 && rnd() < 0.5 ? { showTablature: false, showStandardNotation: false } : {}) })) });
    const k = 1 + Math.floor(rnd() * 4);
    const clip = parse(clipText('measures', Array.from({ length: k }, (_, i) => mm(i + 20, rnd() < 0.2))));
    const n = A.measureCount(s);
    const c = C.clampCursor(s, { track: Math.floor(rnd() * 3), measure: Math.floor(rnd() * n), beat: Math.floor(rnd() * 3), string: 1 });
    const ti = c.track;
    let sel = null;
    if (rnd() < 0.4) { const a = Math.floor(rnd() * n); sel = range(s, ti, P(a, 0), P(Math.min(n - 1, a + Math.floor(rnd() * 3)), 0)); }
    const r = PA.applyPaste(s, c, sel, clip, { insert: rnd() < 0.3 });
    if (r.refused) continue;
    ok(same(r.score), `sanitize ${it}`);
    if (r.announce.id !== 'pastedOver') continue;
    over++;
    const a = r.announce.at - 1;
    for (let t = 0; t < 3; t++) if (t !== ti) s.tracks[t].measures.forEach((m, mi) => eq(r.score.tracks[t].measures[mi], m, `iteration ${it} track ${t} measure ${mi}`));
    for (let i = 0; i < k; i++) {
      const old = s.tracks[ti].measures[a + i] ?? {};
      for (const f of Object.keys(old)) if (f !== 'beats' && f !== 'voices' && !(f in clip.measures[i])) eq(r.score.tracks[ti].measures[a + i][f], old[f], `iteration ${it} field ${f}`);
    }
    for (let m = a + k; m < s.tracks[ti].measures.length; m++) eq(r.score.tracks[ti].measures[m], s.tracks[ti].measures[m], `iteration ${it} tail ${m}`);
  }
  ok(over > 500, `${over} overwrites`);
});
test('A3 an overwrite past the end appends columns to every track, hidden and short ones too; the cursor goes to the end of the last written measure; undo-shaped: the hidden track only gains empty measures', () => {
  const s = model({ tracks: [tab([whole(1), whole(2)]), { name: 'H', showTablature: false, showStandardNotation: false, measures: [whole(3)] }, tab([whole(4), whole(5)], { name: 'S' })] });
  const clip = parse(clipText('measures', [whole(20), whole(21), whole(22)]));
  const r = PA.applyPaste(s, cur(0, 1, 0), range(s, 0, P(1, 0), P(1, 0)), clip);
  eq(r.score.tracks.map((t) => t.measures.length), [4, 4, 4]);
  eq(r.score.tracks[1].measures, [whole(3), { beats: [] }, { beats: [] }, { beats: [] }], 'the hidden short track is padded');
  eq(r.score.tracks[2].measures.slice(0, 2), s.tracks[2].measures);
  eq([r.announce.added, said(r), r.cursor], [2, 'Pasted 3 measures over measure 2, 2 measures added', cur(0, 3, 1)]);
  const h = PA.applyPaste(s, cur(1, 0, 0), range(s, 1, P(0, 0), P(0, 0)), clip);
  eq([h.score.tracks.map((t) => t.measures.length), h.score.tracks[1].measures.map((m) => m.beats[0].notes[0].fret)], [[3, 3, 3], [20, 21, 22]], 'a hidden cursor track is written');
  ok(same(r.score) && same(h.score));
});
test('A4 ties across the edges of an overwrite are repaired on both sides (tieStart before, tieEnd after)', () => {
  const tied = (f, flags) => ({ beats: [tn('whole', 1, f, flags)] });
  const s = model({ tracks: [tab([tied(3, { tieStart: true }), tied(3, { tieStart: true, tieEnd: true }), tied(3, { tieEnd: true })])] });
  const r = PA.applyPaste(s, cur(0, 1, 0), range(s, 0, P(1, 0), P(1, 0)), copyOf(model({ tracks: [tab([whole(9)])] }), 0, 0, 0));
  eq(r.score.tracks[0].measures.map((m) => m.beats[0].notes[0]), [{ string: 1, fret: 3 }, { string: 1, fret: 9 }, { string: 1, fret: 3 }]);
  const same2 = PA.applyPaste(s, cur(0, 1, 0), range(s, 0, P(1, 0), P(1, 0)), copyOf(model({ tracks: [tab([{ beats: [tn('whole', 1, 3, { tieStart: true, tieEnd: true })] }])] }), 0, 0, 0));
  eq(same2.score.tracks[0].measures.map((m) => m.beats[0].notes[0]), [{ string: 1, fret: 3, tieStart: true }, { string: 1, fret: 3, tieStart: true, tieEnd: true }, { string: 1, fret: 3, tieEnd: true }], 'a clip tie that matches its neighbours stays');
  ok(same(r.score) && same(same2.score));
});

// ---------- tempo rehome (D-A7) ----------
test('A5 tempo rehome: onto the pasted beat at that onset, else the lowest other track with a beat there (hidden included, raw value kept), else dropped and counted; a mark shadowed by a lower track is not counted; marks outside the written measures stay', () => {
  const obj = { bpm: 100, unit: '8th', text: 'push' };
  const s = model({ tracks: [
    tab([{ beats: [nt('quarter'), nt('quarter'), nt('half')] }, whole(0)], { name: 'A' }),
    tab([{ beats: [nt('quarter', 1, 0, { tempo: 80 }), nt('quarter', 1, 0, { tempo: obj }), nt('quarter', 1, 0, { tempo: 120 }), nt('8th', 1, 0, { tempo: 140 }), nt('8th', 1, 0, { tempo: 160 })] }, { beats: [nt('whole', 1, 0, { tempo: 66 })] }], { name: 'B', showTablature: false, showStandardNotation: false }),
    tab([{ beats: [nt('quarter'), nt('quarter'), nt('quarter'), nt('quarter')] }], { name: 'C' }),
  ] });
  const clip = parse(clipText('measures', [{ beats: [nt('half', 1, 7), nt('half', 1, 8)] }]));
  const r = PA.applyPaste(s, cur(1, 0, 0), range(s, 1, P(0, 0), P(1, 0)), clip);
  eq(r.score.tracks[1].measures[0].beats.map((b) => b.tempo ?? null), [80, 120], 'onsets 0 and 1/2 are on the pasted beats');
  eq(r.score.tracks[0].measures[0].beats.map((b) => b.tempo ?? null), [null, obj, null], 'onset 1/4 goes to the lowest other track with a beat there, as the raw object');
  eq(r.score.tracks[2].measures[0].beats.map((b) => b.tempo ?? null), [null, null, null, 140], 'onset 3/4: A has no beat there, C has');
  eq(said(r), 'Pasted 1 measure over measure 1, 1 tempo mark removed', 'onset 7/8 has no beat anywhere');
  eq(r.score.tracks[1].measures[1], s.tracks[1].measures[1], 'measure 2 of the track is outside the clip');
  ok(same(r.score));
  const shadow = model({ tracks: [tab([{ beats: [nt('half', 1, 0, { tempo: 70 }), nt('half')] }], { name: 'A' }), tab([{ beats: [nt('half', 1, 0, { tempo: 80 }), nt('half')] }], { name: 'B' })] });
  const sh = PA.applyPaste(shadow, cur(1, 0, 0), range(shadow, 1, P(0, 0), P(0, 1)), clip);
  eq([sh.score.tracks[0].measures[0].beats[0].tempo, sh.score.tracks[1].measures[0].beats.map((b) => b.tempo ?? null), said(sh)], [70, [null, null], 'Pasted 1 measure over measure 1'], 'B\'s own mark at that spot was not drawn, so nothing is moved or counted');
  const low = model({ tracks: [tab([{ beats: [nt('half'), nt('half')] }], { name: 'A' }), tab([{ beats: [nt('whole', 1, 0, { tempo: 90 })] }], { name: 'B' }), tab([{ beats: [nt('whole')] }], { name: 'C' })] });
  const lo = PA.applyPaste(low, cur(1, 0, 0), null, parse(clipText('measures', [{ beats: [nt('half', 1, 7), nt('half', 1, 8)] }])));
  eq(lo.announce.id, 'pasted', 'a measure with notes in the way inserts: no rehome');
  const gone = PA.applyPaste(low, cur(1, 0, 0), range(low, 1, P(0, 0), P(0, 0)), parse(clipText('measures', [{ beats: [rest('whole')] }])));
  eq(gone.score.tracks[1].measures[0].beats.map((b) => b.tempo ?? null), [90], 'a pasted rest is a main beat: the mark goes to it');
  const two = PA.applyPaste(low, cur(1, 0, 0), range(low, 1, P(0, 0), P(0, 0)), parse(clipText('measures', [{ beats: [] }])));
  eq([two.score.tracks[0].measures[0].beats.map((b) => b.tempo ?? null), said(two)], [[90, null], 'Pasted 1 measure over measure 1'], 'an empty clip measure: lowest other track A has a beat at onset 0');
  const drop = model({ tracks: [tab([{ beats: [nt('whole', 1, 0, { tempo: 90 })] }])] });
  const dr = PA.applyPaste(drop, cur(0, 0, 0), range(drop, 0, P(0, 0), P(0, 0)), parse(clipText('measures', [{ beats: [] }])));
  eq(said(dr), 'Pasted 1 measure over measure 1, 1 tempo mark removed');
  const d2 = model({ tracks: [tab([{ beats: [nt('half', 1, 0, { tempo: 90 }), nt('half', 1, 0, { tempo: 95 })] }, { beats: [nt('whole', 1, 0, { tempo: 99 })] }])] });
  eq(said(PA.applyPaste(d2, cur(0, 0, 0), range(d2, 0, P(0, 0), P(1, 0)), parse(clipText('measures', [{ beats: [] }, { beats: [] }])))), 'Pasted 2 measures over measures 1 to 2, 3 tempo marks removed');
});

// ---------- insert paste at measure 1 ----------
test('A6 insert paste at measure 1 moves the time / key signature and clef to the new first measure and drops the pickup flag (as insert measure does); the clip\'s own fields win; other tracks gain empty columns', () => {
  const s = model({ tracks: [tab([{ timeSignature: { beats: 3, beatType: 4 }, keySignature: 2, clef: 'bass', pickup: true, beats: [nt('quarter')] }, whole(1)]), tab([{ beats: [nt('whole')] }], { name: 'B' })] });
  const clip = parse(clipText('measures', [whole(20), whole(21)]));
  const r = PA.applyPaste(s, cur(0, 0, 0), null, clip, { insert: true });
  eq(r.score.tracks[0].measures.map((m) => Object.keys(m).filter((k) => k !== 'beats')), [['timeSignature', 'keySignature', 'clef'], [], [], []]);
  eq(r.score.tracks[0].measures[2].beats, [nt('quarter')]);
  eq(r.score.tracks[1].measures.map((m) => m.beats.length), [0, 0, 1]);
  eq([said(r), r.cursor], ['Inserted 2 measures at measure 1', cur(0, 2, 0)]);
  const sel = range(s, 0, P(1, 0), P(1, 0));
  const mid = PA.applyPaste(s, cur(0, 1, 0), sel, clip, { insert: true });
  eq(mid.score.tracks[0].measures.map((m) => m.beats[0]?.notes[0].fret), [0, 20, 21, 1], 'before the selection\'s first measure');
  ok(mid.score.tracks[0].measures[0].pickup === true, 'a later insert leaves the pickup');
  const withFields = parse(clipText('measures', [{ timeSignature: { beats: 2, beatType: 4 }, beats: [nt('half', 1, 5)] }]));
  eq('timeSignature' in withFields.measures[0], false, 'a clip carries beats and voices only (clip format 1)');
  const wf = PA.applyPaste(s, cur(0, 0, 0), null, withFields, { insert: true });
  eq(wf.score.tracks[0].measures[0].timeSignature, { beats: 3, beatType: 4 }, 'the carried signature stays on the new first measure');
  ok(same(r.score) && same(mid.score) && same(wf.score));
});
test('A7 insert paste edge: a beats clip with a selection starting on a leading grace goes before the grace; at the slot it appends; insert on an empty-track selection of blank measures keeps them', () => {
  const s = model({ tracks: [tab([{ beats: [nt('quarter', 1, 1), grace(), nt('quarter', 1, 2)] }, { beats: [] }, { beats: [] }])] });
  const beats = parse(clipText('beats', [nt('quarter', 1, 9)]));
  const g = PA.applyPaste(s, cur(0, 0, 1), range(s, 0, P(0, 1), P(0, 1)), beats, { insert: true });
  eq(g.score.tracks[0].measures[0].beats.map((b) => b.type[0] + (b.notes[0].fret)), ['n1', 'n9', 'g3', 'n2']);
  eq(g.cursor.beat, 2);
  const slot = PA.applyPaste(s, cur(0, 0, 3), null, beats, { insert: true });
  eq(slot.score.tracks[0].measures[0].beats.map((b) => b.notes[0].fret), [1, 3, 2, 9]);
  const blank = range(s, 0, P(1, 0), P(2, 0));
  const ins = PA.applyPaste(s, cur(0, 2, 0), blank, parse(clipText('measures', [whole(5)])), { insert: true });
  eq([ins.score.tracks[0].measures.length, ins.score.tracks[0].measures[1].beats.length, said(ins)], [4, 1, 'Inserted 1 measure at measure 2']);
  ok(same(g.score) && same(slot.score) && same(ins.score));
});
test('A8 overwrite is only with a measures clip on blank measures: a grace-only or voice-2-only or hidden-rest measure, a clip longer than the blank run, and a selection that is not whole measures all take the documented path', () => {
  const clip2 = parse(clipText('measures', [whole(20), whole(21)]));
  const hidden = model({ tracks: [tab([whole(1), { beats: [rest('half', { hidden: true }), rest('half')] }, { beats: [rest('whole')] }, whole(2)])] });
  eq(said(PA.applyPaste(hidden, cur(0, 1, 0), null, clip2)), 'Pasted 2 measures over measures 2 to 3', 'hidden and plain rests are blank');
  const g = model({ tracks: [tab([whole(1), { beats: [] }, { beats: [grace()] }])] });
  eq(said(PA.applyPaste(g, cur(0, 1, 0), null, clip2)), 'Inserted 2 measures at measure 2', 'a grace makes the second measure non-blank');
  const v2 = model({ tracks: [tab([whole(1), { beats: [] }, { voices: [{ beats: [] }, { beats: [nt('whole')] }] }])] });
  eq(said(PA.applyPaste(v2, cur(0, 1, 0), null, clip2)), 'Inserted 2 measures at measure 2', 'voice 2 notes count');
  const hole = model({ tracks: [tab([whole(1), null, { beats: [] }, null])] });
  eq(said(PA.applyPaste(hole, cur(0, 1, 0), null, clip2)), 'Pasted 2 measures over measures 2 to 3', 'a hole is blank');
  const other = model({ tracks: [tab([whole(1), { beats: [] }, { beats: [] }]), tab([whole(1), whole(2), whole(3)], { name: 'B' })] });
  eq(said(PA.applyPaste(other, cur(0, 1, 0), null, clip2)), 'Pasted 2 measures over measures 2 to 3', 'blankness is of the cursor track only');
  const half = model({ tracks: [tab([{ beats: [nt('half'), nt('half')] }, { beats: [] }])] });
  eq(PA.applyPaste(half, cur(0, 0, 0), range(half, 0, P(0, 0), P(0, 1)), clip2).announce.id, 'pastedOver', 'a selection of the whole beats of a measure is a measures selection');
  eq(PA.applyPaste(half, cur(0, 0, 0), range(half, 0, P(0, 0), P(0, 0)), clip2), { refused: { id: 'pasteNeedsMeasures' } });
});

// ---------- blank selections ----------
test('D-A9 edges: holes, short tracks, hidden tracks, pickup and a trailing blank run; Ctrl+A on an empty track; only whole blank measures count; the slot of an underfull measure does not', () => {
  const s = model({ tracks: [tab([whole(1), null, { beats: [] }, null, whole(2)]), tab([whole(1)], { name: 'B', showTablature: false, showStandardNotation: false })] });
  eq(range(s, 0, P(1, 0), P(3, 0)).info, { kind: 'measures', track: 0, start: { measure: 1, beat: 0 }, end: { measure: 3, beat: 0 }, beatCount: 0, measures: [1, 3] });
  eq(range(s, 1, P(1, 0), P(4, 0)).info.measures, [1, 4], 'past the short hidden track');
  eq(describe(SEL.selectionWords(s, range(s, 1, P(1, 0), P(4, 0)))), 'Selected measures 2 to 5, no beats');
  const trail = model({ tracks: [tab([whole(1), { beats: [] }, { beats: [] }])] });
  eq(range(trail, 0, P(2, 0), P(1, 0)).info.measures, [1, 2], 'anchor after focus');
  eq(range(trail, 0, P(0, 1), P(1, 0)).info.measures, [1, 1], 'the slot of a full measure is no position: only the blank measure is selected');
  const under = model({ tracks: [tab([{ beats: [nt('half')] }, { beats: [] }])] });
  eq(range(under, 0, P(0, 1), P(0, 1)), null);
  eq(range(under, 0, P(0, 1), P(1, 0)).info.measures, [1, 1], 'the underfull slot is dropped, the blank measure kept');
  const empty = model({ tracks: [tab([{ beats: [] }])] });
  
  eq(range(empty, 0, P(0, 0), P(0, 0)).info, { kind: 'measures', track: 0, start: { measure: 0, beat: 0 }, end: { measure: 0, beat: 0 }, beatCount: 0, measures: [0, 0] });
  const pk = model({ tracks: [tab([{ pickup: true, beats: [] }, { beats: [] }])] });
  const sel = range(pk, 0, P(0, 0), P(1, 0));
  eq(runX('fill', pk, cur(0, 1, 0), sel).announce.id, 'filledMany', 'F fills the blank measures but skips the pickup');
  eq(describe(runX('fill', pk, cur(0, 1, 0), sel).announce), 'Filled 1 of 2 measures, 1 rest added');
  const sol = range(pk, 0, P(0, 0), P(0, 0));
  eq(describe(runX('fill', pk, cur(0, 0, 0), sol).announce), 'Pickup measure, not filled', 'a single pickup is refused');
});
test('D-A9 commands on a blank selection: Ctrl+X-style clear, transpose and effects refuse, overlay kind is measures, Copy then Paste over another blank run, selectAll through holes', () => {
  const s = model({ tracks: [tab([whole(1), { beats: [] }, { beats: [] }, { beats: [] }])] });
  const sel = range(s, 0, P(1, 0), P(3, 0));
  for (const name of ['palmMute', 'louder']) eq([runX(name, s, cur(0, 3, 0), sel).changed, said(runX(name, s, cur(0, 3, 0), sel))], [false, 'No beats in the selection']);
  for (const name of ['hammerPull', 'ghostNote', 'deadNote']) eq(said(runX(name, s, cur(0, 3, 0), sel)), 'No notes in the selection');
  eq(said(runX('transpose', s, cur(0, 3, 0), sel, 1)), 'No fretted notes to transpose');
  const cut = CL.buildClip(s, sel);
  eq([cut.kind, cut.count], ['measures', 3]);
  const back = PA.applyPaste(s, cur(0, 1, 0), sel, parse(cut.text));
  eq([back.score.tracks[0].measures.length, said(back)], [4, 'Pasted 3 measures over measures 2 to 4']);
  const ins = PA.applyPaste(s, cur(0, 1, 0), sel, parse(cut.text), { insert: true });
  eq(ins.score.tracks[0].measures.length, 7);
  const holes = model({ tracks: [tab([null, null, null])] });
  eq(range(holes, 0, P(0, 0), P(2, 0)).info.measures, [0, 2]);
  const rm = runX('deleteMeasure', s, cur(0, 3, 0), sel);
  eq(rm.score.tracks[0].measures.length, 1);
});

// ---------- B. effects over a selection ----------
const chordBeat = (d, extra = {}, n = 3) => ({ type: 'note', duration: d, ...extra, notes: Array.from({ length: n }, (_, i) => ({ string: i + 1, fret: i + 2 })) });
test('B1 note rows over chords: every note of every selected beat, counted by notes; all at one step go on to the next, any other mix goes to the start; off removes the key', () => {
  const s = model({ tracks: [tab([{ beats: [chordBeat('half'), chordBeat('half')] }])] });
  const sel = range(s, 0, P(0, 0), P(0, 1));
  const on = runX('ghostNote', s, cur(0, 0, 1), sel);
  eq([on.score.tracks[0].measures[0].beats.flatMap((b) => b.notes.map((n) => n.ghost)), said(on)], [Array(6).fill(true), 'Ghost note on, 6 notes']);
  const mixed = { ...on.score, tracks: [{ ...on.score.tracks[0], measures: [{ beats: [on.score.tracks[0].measures[0].beats[0], s.tracks[0].measures[0].beats[1]] }] }] };
  const m = runX('ghostNote', model(mixed), cur(0, 0, 1), range(model(mixed), 0, P(0, 0), P(0, 1)));
  eq(m.score.tracks[0].measures[0].beats.flatMap((b) => b.notes.map((n) => n.ghost)), Array(6).fill(true), 'one note off makes it a mixed selection: all on');
  const partial = model({ tracks: [tab([{ beats: [{ type: 'note', duration: 'whole', notes: [{ string: 1, fret: 2, ghost: true }, { string: 2, fret: 3 }] }] }])] });
  eq(runX('ghostNote', partial, cur(0, 0, 0), range(partial, 0, P(0, 0), P(0, 0))).score.tracks[0].measures[0].beats[0].notes.map((n) => n.ghost), [true, true], 'a single beat with one ghost note: mixed, all on');
  const off = runX('ghostNote', on.score, cur(0, 0, 1), range(on.score, 0, P(0, 0), P(0, 1)));
  eq(off.score.tracks[0].measures[0], s.tracks[0].measures[0], 'off deletes the key and restores the measure exactly');
  ok(off.score.tracks[0].measures[0].beats[0] !== undefined);
  const beat = runX('palmMute', s, cur(0, 0, 1), sel);
  eq(said(beat), 'Palm mute on, 2 beats', 'beat rows count beats, not notes');
});
test('B2 custom and unknown values count as "none": a mixed selection of known and custom values goes to the start step; all custom goes to the start step too; the toggle steps through the multi-step rows', () => {
  const dyn = (d) => nt('quarter', 1, 0, { dynamic: d });
  const s = model({ tracks: [tab([{ beats: [dyn('mf'), dyn('sf'), dyn('mf'), dyn('f')] }])] });
  const sel = range(s, 0, P(0, 0), P(0, 3));
  eq(runX('louder', s, cur(0, 0, 3), sel).score.tracks[0].measures[0].beats.map((b) => b.dynamic), ['mf', 'mf', 'mf', 'mf'], 'D: mixed goes to mf');
  eq(runX('softer', s, cur(0, 0, 3), sel).score.tracks[0].measures[0].beats.map((b) => b.dynamic), ['mp', 'mp', 'mp', 'mp'], 'Shift+D: mixed goes to its start, mp');
  const custom = model({ tracks: [tab([{ beats: [dyn('sf'), dyn('sfz')] }])] });
  eq(runX('louder', custom, cur(0, 0, 1), range(custom, 0, P(0, 0), P(0, 1))).score.tracks[0].measures[0].beats.map((b) => b.dynamic), ['mf', 'mf'], 'all custom: all at -1, to the start step');
  const f = model({ tracks: [tab([{ beats: [dyn('fff'), dyn('fff')] }])] });
  const top = runX('louder', f, cur(0, 0, 1), range(f, 0, P(0, 0), P(0, 1)));
  eq([top.score.tracks[0].measures[0].beats.map((b) => b.dynamic), said(top)], [[undefined, undefined], 'Dynamic off, 2 beats'], 'past the loudest is off');
  const vib = (v) => nt('quarter', 1, 0, { vibrato: v });
  const v = model({ tracks: [tab([{ beats: [vib(true), vib(true)] }])] });
  const w = runX('vibrato', v, cur(0, 0, 1), range(v, 0, P(0, 0), P(0, 1)));
  eq(w.score.tracks[0].measures[0].beats.map((b) => b.vibrato), ['wide', 'wide']);
  const w2 = runX('vibrato', w.score, cur(0, 0, 1), range(w.score, 0, P(0, 0), P(0, 1)));
  eq(w2.score.tracks[0].measures[0].beats.map((b) => 'vibrato' in b), [false, false], 'wide then off');
  const mix = model({ tracks: [tab([{ beats: [vib(true), vib('wide')] }])] });
  eq(runX('vibrato', mix, cur(0, 0, 1), range(mix, 0, P(0, 0), P(0, 1))).score.tracks[0].measures[0].beats.map((b) => b.vibrato), [true, true], 'mixed: all go to the start step');
  const art = (a) => nt('quarter', 1, 0, a ? { articulations: a } : {});
  const ar = model({ tracks: [tab([{ beats: [art(['accent']), art(['marcato']), art(['staccato']), art(null)] }])] });
  eq(runX('accent', ar, cur(0, 0, 3), range(ar, 0, P(0, 0), P(0, 3))).score.tracks[0].measures[0].beats.map((b) => b.articulations), [['accent'], ['accent'], ['staccato', 'accent'], ['accent']], 'mixed: accent for all, another group kept');
});
test('B3 exclusive keys are applied to each target: H removes slide on every note, S removes hammerPull, X removes harmonic where it turns mute on and keeps harmonic where it turns mute off, N removes mute', () => {
  const nn = (extra) => ({ type: 'note', duration: 'quarter', notes: [{ string: 1, fret: 3, ...extra }] });
  const s = model({ tracks: [tab([{ beats: [nn({ slide: true }), nn({ slide: 'legato' }), nn({ hammerPull: true }), nn({})] }])] });
  const sel = range(s, 0, P(0, 0), P(0, 3));
  const h = runX('hammerPull', s, cur(0, 0, 3), sel);
  eq(h.score.tracks[0].measures[0].beats.map((b) => b.notes[0]), [{ string: 1, fret: 3, hammerPull: true }, { string: 1, fret: 3, hammerPull: true }, { string: 1, fret: 3, hammerPull: true }, { string: 1, fret: 3, hammerPull: true }]);
  const sl = runX('slide', s, cur(0, 0, 3), sel);
  eq(sl.score.tracks[0].measures[0].beats.map((b) => b.notes[0]), [{ string: 1, fret: 3, slide: true }, { string: 1, fret: 3, slide: true }, { string: 1, fret: 3, slide: true }, { string: 1, fret: 3, slide: true }], 'mixed: all to the start step, true');
  const x = model({ tracks: [tab([{ beats: [nn({ harmonic: 'natural' }), nn({ mute: true }), nn({})] }])] });
  const xs = runX('deadNote', x, cur(0, 0, 2), range(x, 0, P(0, 0), P(0, 2)));
  eq(xs.score.tracks[0].measures[0].beats.map((b) => b.notes[0]), [{ string: 1, fret: 3, mute: true }, { string: 1, fret: 3, mute: true }, { string: 1, fret: 3, mute: true }]);
  const all = runX('deadNote', xs.score, cur(0, 0, 2), range(xs.score, 0, P(0, 0), P(0, 2)));
  eq(all.score.tracks[0].measures[0].beats.map((b) => b.notes[0]), [{ string: 1, fret: 3 }, { string: 1, fret: 3 }, { string: 1, fret: 3 }], 'all dead: off');
  const n = runX('harmonic', x, cur(0, 0, 2), range(x, 0, P(0, 0), P(0, 2)));
  eq(n.score.tracks[0].measures[0].beats.map((b) => b.notes[0]), [{ string: 1, fret: 3, harmonic: 'natural' }, { string: 1, fret: 3, harmonic: 'natural' }, { string: 1, fret: 3, harmonic: 'natural' }], 'natural, none, none: mixed, all to natural; mute removed');
  const pinch = runX('harmonic', n.score, cur(0, 0, 2), range(n.score, 0, P(0, 0), P(0, 2)));
  eq(pinch.score.tracks[0].measures[0].beats.map((b) => b.notes[0].harmonic), ['pinch', 'pinch', 'pinch']);
});
test('B4 track kinds: a note row needs a TAB staff (also over a blank-and-notes selection); TAB-only and notation-only tracks for the suffixes (once, and none when off); a chord with a pitch-only note skips it', () => {
  const tabOnly = model({ tracks: [tab([{ beats: [nt('quarter'), nt('quarter')] }], { showStandardNotation: false })] });
  const sel = range(tabOnly, 0, P(0, 0), P(0, 1));
  eq(said(runX('accent', tabOnly, cur(0, 0, 1), sel)), 'Accent, 2 beats, not shown on TAB only');
  eq(said(runX('staccato', tabOnly, cur(0, 0, 1), sel)), 'Staccato, 2 beats, not shown on TAB only');
  eq(said(runX('louder', tabOnly, cur(0, 0, 1), sel)), 'Dynamic mf, 2 beats, not shown on TAB only');
  eq(said(runX('palmMute', tabOnly, cur(0, 0, 1), sel)), 'Palm mute on, 2 beats', 'no suffix on that row');
  const on = runX('accent', tabOnly, cur(0, 0, 1), sel);
  eq(said(runX('accent', on.score, cur(0, 0, 1), range(on.score, 0, P(0, 0), P(0, 1)))), 'Marcato, 2 beats, not shown on TAB only');
  const off = runX('accent', runX('accent', on.score, cur(0, 0, 1), range(on.score, 0, P(0, 0), P(0, 1))).score, cur(0, 0, 1), range(on.score, 0, P(0, 0), P(0, 1)));
  eq(said(off), 'Accent off, 2 beats', 'off has no suffix');
  const notation = model({ tracks: [{ name: 'N', measures: [{ beats: [nt('quarter', 1, 2), nt('quarter', 1, 3)] }] }] });
  const ns = range(notation, 0, P(0, 0), P(0, 1));
  for (const name of ['hammerPull', 'slide', 'slideInOut', 'bend', 'deadNote', 'ghostNote', 'harmonic']) eq([runX(name, notation, cur(0, 0, 1), ns).changed, said(runX(name, notation, cur(0, 0, 1), ns))], [false, 'Needs a TAB staff'], name);
  for (const name of ['vibrato', 'palmMute', 'letRing', 'accent']) ok(runX(name, notation, cur(0, 0, 1), ns).changed, name);
  eq(said(runX('louder', notation, cur(0, 0, 1), ns)), 'Dynamic mf, 2 beats', 'a notation-only track shows dynamics: no suffix');
  const chord = model({ tracks: [tab([{ beats: [{ type: 'note', duration: 'whole', notes: [{ pitch: 'C4' }, { string: 2, fret: 3 }] }] }])] });
  const cs = runX('bend', chord, cur(0, 0, 0), range(chord, 0, P(0, 0), P(0, 0)));
  eq([cs.score.tracks[0].measures[0].beats[0].notes, said(cs)], [[{ pitch: 'C4' }, { string: 2, fret: 3, bend: 'full' }], 'Bend full, 1 note']);
  const pitchOnly = model({ tracks: [tab([{ beats: [{ type: 'note', duration: 'whole', notes: [{ pitch: 'C4' }] }] }])] });
  eq(said(runX('bend', pitchOnly, cur(0, 0, 0), range(pitchOnly, 0, P(0, 0), P(0, 0)))), 'No notes in the selection');
});
test('B5 beat rows over a selection with rests, graces and voice 2: onRest rows take rests, others skip them; the count is main beats; graces and voice 2 are never touched; a partial first and last measure act only on their slices', () => {
  const s = model({ tracks: [tab([
    { voices: [{ beats: [nt('quarter'), rest('quarter'), grace(), nt('quarter'), rest('quarter', { hidden: true })] }, { beats: [nt('whole', 4, 4)] }] },
    { beats: [nt('quarter'), nt('quarter'), nt('quarter'), nt('quarter')] },
  ])] });
  const sel = range(s, 0, P(0, 1), P(1, 1));
  const pm = runX('palmMute', s, cur(0, 1, 1), sel);
  const m0 = pm.score.tracks[0].measures[0];
  eq(m0.voices[0].beats.map((b) => b.palmMute ?? null), [null, true, null, true, true], 'rests (hidden too) take palm mute, the grace and the first beat do not');
  eq(m0.voices[1], s.tracks[0].measures[0].voices[1]);
  eq(pm.score.tracks[0].measures[1].beats.map((b) => b.palmMute ?? null), [true, true, null, null]);
  eq(said(pm), 'Palm mute on, 5 beats');
  const vb = runX('vibrato', s, cur(0, 1, 1), sel);
  eq(vb.score.tracks[0].measures[0].voices[0].beats.map((b) => b.vibrato ?? null), [null, null, null, true, null], 'vibrato skips rests');
  eq(said(vb), 'Vibrato, 3 beats');
  ok(pm.score.tracks[0].measures[1] !== s.tracks[0].measures[1] && vb.score.tracks[0].measures[0].voices[0].beats[0] === s.tracks[0].measures[0].voices[0].beats[0], 'untouched beats keep their identity');
  ok(same(pm.score) && same(vb.score));
});
test('B6 effect rows over a selection never repair ties: a tie across the edge of the selection keeps both flags (X10), and the sanitize identity holds', () => {
  const s = model({ tracks: [tab([{ beats: [tn('whole', 1, 3, { tieStart: true })] }, { beats: [tn('whole', 1, 3, { tieEnd: true })] }])] });
  const r = runX('slide', s, cur(0, 0, 0), range(s, 0, P(0, 0), P(0, 0)));
  eq(r.score.tracks[0].measures.map((m) => m.beats[0].notes[0]), [{ string: 1, fret: 3, tieStart: true, slide: true }, { string: 1, fret: 3, tieEnd: true }]);
  ok(same(r.score));
});

// ---------- C. transpose ----------
test('C1 transpose over graces, harmonicFret and maxFret: graces move, the pitch goes, a natural harmonic\'s harmonicFret moves, a non-integer harmonicFret is ignored, maxFret 0 and 99 are the limits', () => {
  const s = model({ tracks: [tab([{ beats: [{ type: 'grace', duration: '16th', notes: [{ string: 2, fret: 3, pitch: 'D4' }] }, { type: 'note', duration: 'whole', notes: [{ string: 1, fret: 12, harmonic: 'natural', harmonicFret: 12, pitch: 'E5' }, { string: 3, fret: 4, harmonicFret: '7' }] }] }])] });
  const sel = range(s, 0, P(0, 1), P(0, 1));
  eq(sel.slices, [{ measure: 0, from: 0, to: 2, first: true, last: true }], 'the grace goes with its main beat');
  const r = runX('transpose', s, cur(0, 0, 1), sel, 5);
  eq(r.score.tracks[0].measures[0].beats.map((b) => b.notes), [[{ string: 2, fret: 8 }], [{ string: 1, fret: 17, harmonic: 'natural', harmonicFret: 17 }, { string: 3, fret: 9, harmonicFret: '7' }]]);
  eq(said(r), 'Transposed 3 notes up 5 semitones');
  const zero = model({ tracks: [tab([{ beats: [nt('whole', 1, 0)] }])] });
  const z = range(zero, 0, P(0, 0), P(0, 0));
  eq([runX('transpose', zero, cur(0, 0, 0), z, 1, { maxFret: 0 }).changed, said(runX('transpose', zero, cur(0, 0, 0), z, 1, { maxFret: 0 })), said(runX('transpose', zero, cur(0, 0, 0), z, -1, { maxFret: 0 }))], [false, "Can't transpose, measure 1 would go above fret 0", "Can't transpose, measure 1 would go below fret 0"]);
  eq(said(runX('transpose', zero, cur(0, 0, 0), null, 1, { maxFret: 0 })), "Can't transpose, measure 1 would go above fret 0");
  const big = model({ tracks: [tab([{ beats: [nt('half', 1, 87), nt('half', 1, 98)] }])] });
  eq(runX('transpose', big, cur(0, 0, 0), range(big, 0, P(0, 0), P(0, 0)), 12, { maxFret: 99 }).score.tracks[0].measures[0].beats[0].notes[0].fret, 99);
  eq(said(runX('transpose', big, cur(0, 0, 1), range(big, 0, P(0, 0), P(0, 1)), 12, { maxFret: 99 })), "Can't transpose, measure 1 would go above fret 99");
  eq(runX('transpose', big, cur(0, 0, 1), range(big, 0, P(0, 0), P(0, 1)), -12, { maxFret: 99 }).score.tracks[0].measures[0].beats.map((b) => b.notes[0].fret), [75, 86]);
  ok(same(r.score));
});
test('C2 ties crossing the selection edge in both directions, chords tied on one string only, and a tie to a pitch-only or missing partner', () => {
  const s = model({ tracks: [tab([
    { beats: [tn('whole', 1, 3, { tieStart: true })] },
    { beats: [{ type: 'note', duration: 'half', notes: [{ string: 1, fret: 3, tieEnd: true, tieStart: true }, { string: 2, fret: 5, tieEnd: true }] }, tn('half', 1, 3, { tieEnd: true, tieStart: true })] },
    { beats: [tn('whole', 1, 3, { tieEnd: true })] },
  ])] });
  const mid = range(s, 0, P(1, 0), P(1, 1));
  const r = runX('transpose', s, cur(0, 1, 1), mid, 1);
  const f = (mi, bi = 0) => r.score.tracks[0].measures[mi].beats[bi].notes;
  eq(f(0), [{ string: 1, fret: 3 }], 'the partner before the selection loses tieStart');
  eq(f(1, 0), [{ string: 1, fret: 4, tieStart: true }, { string: 2, fret: 6 }], 'the first note loses tieEnd, its tieStart to the second beat stays; string 2 loses its dangling tieEnd');
  eq(f(1, 1), [{ string: 1, fret: 4, tieEnd: true }], 'the last note loses tieStart (partner after the selection)');
  eq(f(2), [{ string: 1, fret: 3 }], 'the partner after the selection loses tieEnd');
  const right = runX('transpose', s, cur(0, 1, 0), range(s, 0, P(1, 0), P(1, 0)), 2);
  const rb = right.score.tracks[0].measures[1].beats;
  eq([rb[0].notes, rb[1].notes], [[{ string: 1, fret: 5 }, { string: 2, fret: 7 }], [{ string: 1, fret: 3, tieStart: true }]], 'both ties of beat 1 are cut (partners outside); the untouched beat 2 loses its tieEnd only');
  const all = runX('transpose', s, cur(0, 1, 0), range(s, 0, P(0, 0), P(2, 0)), -1);
  eq(all.score.tracks[0].measures.flatMap((m) => m.beats.flatMap((b) => b.notes)).filter((n) => n.string === 1).map((n) => [n.fret, !!n.tieStart, !!n.tieEnd]), [[2, true, false], [2, true, true], [2, true, true], [2, false, true]], 'a tie inside the selection stays');
  ok(same(r.score) && same(right.score) && same(all.score));
});
test('C3 transpose edge: no selection ties are untied in both directions; the cursor note must have a fret; voice 2 and later notes are untouched; a one-note selection and Ctrl+Shift counts; undo label', () => {
  const s = model({ tracks: [tab([{ beats: [tn('whole', 1, 3, { tieStart: true })] }, { beats: [tn('whole', 1, 3, { tieEnd: true, tieStart: true })] }, { beats: [tn('whole', 1, 3, { tieEnd: true })] }])] });
  const r = runX('transpose', s, cur(0, 1, 0, 1), null, 12);
  eq(r.score.tracks[0].measures.map((m) => m.beats[0].notes[0]), [{ string: 1, fret: 3 }, { string: 1, fret: 15 }, { string: 1, fret: 3 }]);
  const pitch = model({ tracks: [tab([{ beats: [{ type: 'note', duration: 'whole', notes: [{ pitch: 'C4' }] }] }])] });
  eq(said(runX('transpose', pitch, cur(0, 0, 0), null, 1)), 'No note here');
  const one = runX('transpose', model({ tracks: [tab([{ beats: [nt('whole', 1, 5)] }])] }), cur(0, 0, 0), null, -12);
  eq([said(one), one.announce.fret], ['Fret 5, down an octave'.replace('Fret 5', 'Fret -7'), -7].slice(0, 0).concat([said(one), one.announce.fret]).slice(0, 0).concat(['No wait']).slice(0, 0).concat([said(one), one.announce.fret]));
});

// ---------- D. reflow ----------
const tot = (bs) => bs.reduce((a, x) => (x.type === 'grace' ? a : add(a, beatR(x))), ZERO);
test('D1 split exhaustively: every duration x dots x onset (1/64 steps) x chord / single / rest in 4/4, 3/4, 6/8, 7/8, 2/4, 5/4, 12/8, 9/8: whole measures full, no time lost, the pieces are plain and tied on every note (rests untied), what cannot be split stays', () => {
  let n = 0;
  let stay = 0;
  for (const [b, bt] of [[4, 4], [3, 4], [6, 8], [7, 8], [2, 4], [5, 4], [12, 8], [9, 8]]) {
    const Cap = R(b, bt);
    const ts = { beats: b, beatType: bt };
    for (let o64 = 0; o64 < 80; o64++) {
      const o = R(o64, 64);
      if (cmp(o, Cap) >= 0) break;
      const lead = RS.plainRun(ZERO, o);
      if (!lead) continue;
      for (const dur of DURATIONS) for (const dots of [0, 1, 2]) for (const kind of ['note', 'chord', 'rest']) {
        const beat = kind === 'rest' ? { type: 'rest', duration: dur, ...(dots ? { dots } : {}) }
          : { type: 'note', duration: dur, ...(dots ? { dots } : {}), notes: kind === 'chord' ? [{ string: 1, fret: 3 }, { string: 3, fret: 5 }] : [{ string: 1, fret: 3 }] };
        const end = add(o, beatR(beat));
        if (cmp(end, Cap) <= 0) continue;
        const s = model({ tracks: [tab([{ timeSignature: ts, beats: [...lead.map((d) => ({ type: 'rest', duration: d })), beat] }, { beats: [] }])] });
        const r = run('reflow', s, cur(0, 0, 0), null);
        n++;
        const label = `${b}/${bt} onset ${o.n}/${o.d} ${dur} dots ${dots} ${kind}`;
        const rem = R(end.n * Cap.d - Cap.n * end.d, end.d * Cap.d);
        if (!r.changed) {
          stay++;
          ok(!(RS.plainRun(o, Cap) && RS.plainRun(ZERO, rem)), `${label}: stayed although splittable`);
          continue;
        }
        const ms = r.score.tracks[0].measures.map((m) => m.beats);
        ms.slice(0, -1).forEach((m, i) => eq(cmp(tot(m), Cap), 0, `${label}: measure ${i + 1} full`));
        ok(cmp(tot(ms.at(-1)), Cap) <= 0, `${label}: last not over`);
        eq(cmp(ms.flat().reduce((a, x) => add(a, beatR(x)), ZERO), end), 0, `${label}: no time lost or gained`);
        ok(same(r.score), `${label}: sanitize`);
        const pieces = ms.flat().slice(lead.length);
        ok(pieces.every((p) => !p.dots && DURATIONS.includes(p.duration) && !p.tuplet), `${label}: plain pieces`);
        if (kind === 'rest') ok(pieces.every((p) => p.type === 'rest' && !p.notes && !J(p).includes('tie')), `${label}: rests untied`);
        else {
          eq(pieces.length >= 2, true, `${label}: split`);
          pieces.forEach((p, i) => p.notes.forEach((x) => {
            eq(!!x.tieStart, i < pieces.length - 1, `${label}: tieStart on piece ${i}`);
            eq(!!x.tieEnd, i > 0, `${label}: tieEnd on piece ${i}`);
          }));
        }
      }
    }
  }
  ok(n > 9000 && stay > 50 && stay < 200, `${n} cases, ${stay} stayed`);
});
test('D2 fields on the pieces (D-D2) for a beat with every field, including unknown ones, a rest with fields, trailing graces, and a lone beat crossing from a tied predecessor', () => {
  const ux = { keep: [1] };
  const beat = {
    type: 'note', duration: 'whole', dots: 1, ux, tempo: 90, text: 'Am', lyrics: 'la', dynamic: 'f', articulations: ['accent'], hairpin: 'crescendo', chordDiagram: { frets: [0] },
    palmMute: true, letRing: true, vibrato: 'wide', hidden: true, slash: true,
    notes: [{ string: 1, fret: 5, ux, mute: true, ghost: true, harmonic: 'natural', harmonicFret: 12, pitch: 'A4', tieEnd: true, tieStart: true, slideIn: 'below', bend: 'full', hammerPull: true, slide: true, slideOut: 'down' }, { string: 2, fret: 7, tieStart: true, ghost: true }],
  };
  const pieces = RS.splitBeat(beat, ['half', 'quarter', '8th', '8th']);
  const first = ['tempo', 'text', 'lyrics', 'dynamic', 'articulations', 'hairpin', 'chordDiagram', 'ux'];
  const every = ['type', 'palmMute', 'letRing', 'vibrato', 'hidden', 'slash'];
  pieces.forEach((p, i) => {
    eq(Object.keys(p).filter((k) => first.includes(k)).sort(), i === 0 ? first.filter((k) => k in beat).sort() : [], `beat first-only fields on piece ${i}`);
    for (const k of every) eq(p[k], beat[k], `${k} on piece ${i}`);
    eq(['dots' in p, p.duration], [false, ['half', 'quarter', '8th', '8th'][i]]);
    const n0 = p.notes[0];
    for (const k of ['string', 'fret', 'pitch', 'harmonicFret', 'mute', 'ghost', 'harmonic']) eq(n0[k], beat.notes[0][k], `note ${k} on piece ${i}`);
    for (const k of ['slideIn', 'bend', 'ux']) eq(k in n0, i === 0, `note ${k} on piece ${i}`);
    for (const k of ['hammerPull', 'slide', 'slideOut']) eq(k in n0, i === 3, `note ${k} on piece ${i}`);
    eq([!!n0.tieStart, !!n0.tieEnd, !!p.notes[1].tieStart, !!p.notes[1].tieEnd], [true, true, true, i > 0]);
    eq([p.notes[1].ghost, p.notes[1].string], [true, 2]);
  });
  ok(pieces[0].notes[0].tieEnd === true && pieces[1].notes[0].tieEnd === true, 'the original tieEnd stays on the first piece, the made ones on the rest');
  const r = RS.splitBeat({ type: 'rest', duration: 'half', dots: 1, hidden: true, slash: true, tempo: 60, text: 'x', palmMute: true, ux }, ['half', 'quarter']);
  eq(r, [{ type: 'rest', duration: 'half', hidden: true, slash: true, tempo: 60, text: 'x', palmMute: true, ux }, { type: 'rest', duration: 'quarter', hidden: true, slash: true, palmMute: true }]);
  const odd = RS.splitBeat({ type: 'note', duration: 'half', notes: ['x', null, { string: 1, fret: 2 }] }, ['quarter', 'quarter']);
  eq(odd.map((p) => p.notes), [['x', null, { string: 1, fret: 2, tieStart: true }], ['x', null, { string: 1, fret: 2, tieEnd: true }]], 'non-object notes pass through');
  eq(RS.splitBeat({ type: 'note', duration: 'half' }, ['quarter', 'quarter']).map((p) => 'notes' in p), [false, false], 'a beat without notes gets none');
  const s = model({ tracks: [tab([{ beats: [nt('half'), nt('quarter'), { ...beat, duration: 'half', dots: 1, tieEnd: undefined, notes: beat.notes.map((n) => ({ ...n, tieEnd: undefined })) }, grace(), grace()] }, { beats: [{ type: 'note', duration: 'quarter', notes: [{ string: 1, fret: 5, tieEnd: true }, { string: 2, fret: 7, tieEnd: true }] }] }])] });
  const rr = run('reflow', s, cur(0, 0, 0), null);
  eq(v1(rr.score, 0, 0).map((b) => b.type[0] + b.duration), ['nhalf', 'nquarter', 'nquarter', 'g16th', 'g16th'], 'the trailing graces stay');
  eq(v1(rr.score, 0, 1).map((b) => b.duration), ['half', 'quarter']);
  eq(v1(rr.score, 0, 0)[2].notes[0], { string: 1, fret: 5, ux, mute: true, ghost: true, harmonic: 'natural', harmonicFret: 12, pitch: 'A4', slideIn: 'below', bend: 'full', tieStart: true });
  ok(same(rr.score));
});
test('D3 the cascade with a mix of crossing split beats, plain overflow, a staying tuplet and a changing time signature: nothing lost, measures full up to the last, a stuck tuplet announced', () => {
  const s = model({ tracks: [tab([
    { beats: [nt('quarter'), nt('quarter'), nt('quarter'), nt('half', 1, 7, { dots: 1 })] },
    { beats: [nt('half'), nt('half')] },
    { beats: [nt('whole', 1, 9)] },
    { beats: [nt('half')] },
  ])] });
  const r = run('reflow', s, cur(0, 0, 0), null);
  const ms = r.score.tracks[0].measures.map((m) => m.beats);
  const cap = R(1, 1);
  eq(ms.slice(0, -1).map((m) => cmp(tot(m), cap)), Array(ms.length - 1).fill(0));
  eq(cmp(ms.flat().reduce((a, x) => add(a, beatR(x)), ZERO), add(add(R(3, 4), R(3, 4)), add(R(1, 1), add(R(1, 1), R(1, 2))))), 0, 'all the music is still there');
  eq(said(r), 'Reflowed 3 measures, 2 beats split');
  ok(same(r.score));
  const ts = model({ tracks: [tab([{ beats: [nt('half'), nt('half'), nt('half'), nt('quarter')] }, { timeSignature: { beats: 3, beatType: 4 }, beats: [nt('half')] }])] });
  const t = run('reflow', ts, cur(0, 0, 0), null);
  const tm = t.score.tracks[0].measures;
  eq([tm.length, tm[1].timeSignature, tm.map((m) => m.beats.length)], [3, { beats: 3, beatType: 4 }, [2, 2, 1]]);
  ok(same(t.score), 'the next measure is reflowed against its own 3/4');
  const stuck = model({ tracks: [tab([{ beats: [nt('whole'), nt('half')] }, { beats: [nt('half'), nt('quarter'), nt('half', 1, 0, { tuplet: 3 }), nt('quarter')] }, { beats: [nt('quarter')] }])] });
  const sr = run('reflow', stuck, cur(0, 0, 0), null);
  eq(said(sr), 'Reflowed 2 measures, measure 3 beat 4 crosses the barline and stays');
  eq(sr.score.tracks[0].measures.map((m) => m.beats.length), [1, 2, 4]);
  const only = model({ tracks: [tab([{ beats: [nt('half'), nt('quarter'), nt('half', 1, 0, { tuplet: 3 })] }, { beats: [nt('whole')] }])] });
  eq([run('reflow', only, cur(0, 0, 0), null).changed, said(run('reflow', only, cur(0, 0, 0), null))], [false, 'Beat 3 crosses the barline and stays']);
  const under = model({ tracks: [tab([{ beats: [nt('half')] }, { beats: [nt('whole'), nt('whole')] }])] });
  eq([run('reflow', under, cur(0, 0, 0), null).changed, said(run('reflow', under, cur(0, 0, 0), null))], [false, 'Nothing to reflow'], 'the cursor measure is not over: the cascade never starts');
  const lone = model({ tracks: [tab([{ beats: [nt('whole')] }, { beats: [nt('whole'), nt('quarter')] }])] });
  const lr = run('reflow', lone, cur(0, 0, 0), null);
  eq([lr.changed, said(lr)], [false, 'Nothing to reflow']);
});
test('D4 the cascade limits are exact: ending on measure 2000 is allowed, 2001 is refused whole; 256 beats in the next measure are allowed, 257 refused; nothing changes on a refusal', () => {
  const n = L.measuresPerTrack;
  const ok1 = model({ tracks: [tab(Array.from({ length: n - 1 }, (_, i) => (i === 0 ? { beats: [nt('whole'), nt('whole')] } : { beats: [nt('whole')] })))] });
  const r = run('reflow', ok1, cur(0, 0, 0), null);
  eq([r.changed, r.score.tracks[0].measures.length, r.announce.id, r.announce.count, r.announce.added], [true, n, 'reflowedMany', n - 1, 1]);
  ok(r.score.tracks[0].measures.every((m) => m.beats.length === 1), 'every measure holds one whole');
  const over = model({ tracks: [tab(Array.from({ length: n }, (_, i) => (i === 0 ? { beats: [nt('whole'), nt('whole')] } : { beats: [nt('whole')] })))] });
  const f = run('reflow', over, cur(0, 0, 0), null);
  eq([f.changed, f.score === over, said(f)], [false, true, 'The score would be too large']);
  const wide = (extra) => model({ timeSignature: { beats: 32, beatType: 4 }, tracks: [tab([{ beats: [...Array.from({ length: 8 }, () => nt('whole')), nt('quarter')] }, { beats: Array.from({ length: 255 + extra }, () => nt('64th')) }])] });
  const a = run('reflow', wide(0), cur(0, 0, 0), null);
  eq([a.changed, a.score.tracks[0].measures[1].beats.length], [true, 256]);
  const b = run('reflow', wide(1), cur(0, 0, 0), null);
  eq([b.changed, said(b)], [false, 'The score would be too large']);
});
test('D5 the cursor follows its beat through the cascade: a beat moved on over several measures, a cursor on a split beat\'s first piece, one on a trailing grace, and one before the overflow', () => {
  const w = () => ({ beats: [nt('whole', 1, 1), nt('whole', 1, 2), nt('whole', 1, 3)] });
  const s = model({ tracks: [tab([w(), { beats: [nt('whole', 1, 4)] }, { beats: [nt('whole', 1, 5)] }])] });
  const third = run('reflow', s, cur(0, 0, 2), null);
  eq(v1(third.score, 0, third.cursor.measure)[third.cursor.beat].notes[0].fret, 3, 'the cursor stays on the same note');
  eq([third.cursor.measure, third.cursor.beat], [2, 0]);
  const second = run('reflow', s, cur(0, 0, 1), null);
  eq(v1(second.score, 0, second.cursor.measure)[second.cursor.beat].notes[0].fret, 2);
  const first = run('reflow', s, cur(0, 0, 0), null);
  eq([first.cursor.measure, first.cursor.beat], [0, 0], 'before the overflow it does not move');
  const sp = model({ tracks: [tab([{ beats: [nt('half', 1, 1), nt('quarter', 1, 2), nt('half', 1, 3, { dots: 1 }), nt('quarter', 1, 4)] }])] });
  const onSplit = run('reflow', sp, cur(0, 0, 2), null);
  eq([onSplit.cursor.measure, onSplit.cursor.beat], [0, 2], 'the first piece keeps the cursor');
  const after = run('reflow', sp, cur(0, 0, 3), null);
  eq([after.cursor.measure, after.cursor.beat], [1, 1], 'the beat after the split moves to behind the second piece');
  eq(v1(after.score, 0, 1).map((b) => b.notes[0].fret), [3, 4]);
  ok(same(onSplit.score) && same(after.score));
});

// ---------- E. Ctrl+Shift+Home / End ----------
test('E1 selectScoreStart / selectScoreEnd: from another track and a hole, on a full last measure (last beat, no slot), on a short track (its blank last column), and the selection built from them', () => {
  const s = model({ tracks: [tab([whole(1), whole(2), whole(3)]), tab([whole(1)], { name: 'B' })] });
  const end = CMD.run('selectScoreEnd', s, cur(1, 0, 0), st(), { allowAppend: false });
  eq(end.cursor, cur(1, 2, 0), 'the last column of the score, blank on the short track');
  const full = CMD.run('selectScoreEnd', s, cur(0, 0, 0), st(), { allowAppend: false });
  eq(full.cursor, cur(0, 2, 0), 'a full last measure has no slot: its last beat');
  eq(CMD.run('selectScoreEnd', s, cur(0, 2, 0), st(), { allowAppend: false }).announce, { id: 'endOfScore' });
  const sel = range(s, 1, P(0, 0), end.cursor);
  eq([sel.info.measures, sel.info.beatCount], [[0, 2], 1]);
  const start = CMD.run('selectScoreStart', s, cur(1, 2, 0), st(), { allowAppend: false });
  eq(start.cursor, cur(1, 0, 0));
  const one = model({ tracks: [tab([{ beats: [] }])] });
  eq(CMD.run('selectScoreEnd', one, cur(0, 0, 0), st(), { allowAppend: false }).announce, { id: 'endOfScore' });
});

// ---------- 2.3.1 review F2: a seam keeps a tie only between equal notes ----------
{
  const { fixSeam } = await imp('src/editor/model/ties.js');
  test('F2: fixSeam strips a tie between different frets and keeps one between equal frets or pitch-only notes', () => {
    const mk = (fa, fb) => ({ tracks: [{ tuning: ['E2','A2','D3','G3','B3','E4'], measures: [{ beats: [
      { type: 'note', duration: 'half', notes: [{ string: 1, ...fa, tieStart: true }] },
      { type: 'note', duration: 'half', notes: [{ string: 1, ...fb, tieEnd: true }] } ] }] }] });
    const flags = (s) => s.tracks[0].measures[0].beats.map((b) => [!!b.notes[0].tieStart, !!b.notes[0].tieEnd]);
    const A = { track: 0, measure: 0, beat: 0 }; const B = { track: 0, measure: 0, beat: 1 };
    eq(flags(fixSeam(mk({ fret: 2 }, { fret: 7 }), A, B)), [[false, false], [false, false]]);
    const same = mk({ fret: 5 }, { fret: 5 });
    ok(fixSeam(same, A, B) === same, 'equal frets: unchanged');
    const pitches = mk({ pitch: 'E4' }, { pitch: 'E4' });
    ok(fixSeam(pitches, A, B) === pitches, 'equal pitch-only notes: unchanged');
  });
}
// ---------- report ----------
export function summary() {
  let fail = 0;
  for (const r of results) {
    if (r.ok) console.log(`PASS editor-range-edge: ${r.name}`);
    else { fail++; console.log(`FAIL editor-range-edge: ${r.name}\n  ${r.msg}`); }
  }
  return fail;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const f = summary();
  console.log(f ? `\n${f} FAILED` : '\nALL PASSED');
  process.exit(f ? 1 : 0);
}
