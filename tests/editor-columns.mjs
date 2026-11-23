// 2.3.2 column selection, column clipboard and column range edits at model level: the selection model
// (criteria 1-5), multi-track clips and their parsing (8, 10), pasteColumns (11-16), range edits over a
// column (17-22), B10 over the column operations and E12.
// Run via `node tests/run.js` (calls summary()), or directly: `node tests/editor-columns.mjs`.
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

register('./hooks.mjs', import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const io = await imp('src/editor/model/io.js');
const SEL = await imp('src/editor/model/selection.js');
const COL = await imp('src/editor/model/columns.js');
const C = await imp('src/editor/model/cursor.js');
const CMD = await imp('src/editor/model/commands.js');
const { describe } = await imp('src/editor/announce.js');
const { sanitizeScore } = await imp('src/sanitize.js');
const CL = await imp('src/editor/model/clip.js');
const PA = await imp('src/editor/model/paste.js');
const PC = await imp('src/editor/model/pasteColumns.js');
const { EDITOR_LIMITS: L } = await imp('src/editor/model/limits.js');

const results = [];
const test = (name, fn) => {
  try { fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, msg: e.stack || e.message }); }
};
const eq = (a, b, m = '') => {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${m} expected ${y}, got ${x}`);
};
const ok = (c, m = 'assertion failed') => { if (!c) throw new Error(m); };

const model = (s) => io.parseInput(s);
const nt = (duration, string = 1, fret = 0, extra = {}) => ({ type: 'note', duration, notes: [{ string, fret }], ...extra });
const rest = (duration, extra = {}) => ({ type: 'rest', duration, ...extra });
const tab = (measures, extra = {}) => ({ name: 'Gtr', showTablature: true, ...extra, measures });
const cur = (track, measure, beat, string = 1) => ({ track, measure, beat, string });
const T = (track, measure, beat) => ({ track, measure, beat });
const st = () => ({ duration: 'quarter', dots: 0, digit: null });
const run = (name, s, c, sel, arg) => CMD.run(name, s, c, st(), { maxFret: 24, now: 0, twoDigitDelayMs: 800, allowAppend: true, selection: sel }, arg);
const said = (r) => describe(r.announce);
const v1 = (s, ti, mi) => s.tracks[ti].measures[mi].beats;
const same = (s) => sanitizeScore(s) === s;
const BASS = ['E1', 'A1', 'D2', 'G2'];
/** 4 tracks: 0 TAB + notation, 1 hidden, 2 notation only, 3 a 4-string TAB-only bass; 4 measures each. */
const four = () => model({ tracks: [
  tab([{ beats: [nt('quarter', 1, 1), nt('quarter', 2, 2), nt('half', 3, 3)] }, { beats: [nt('whole', 1, 4)] }, { beats: [] }, { beats: [nt('half', 2, 5), nt('half', 2, 6)] }]),
  { name: 'Hidden', showStandardNotation: false, measures: [{ beats: [nt('whole')] }, { beats: [nt('whole')] }, { beats: [] }, { beats: [] }] },
  { name: 'Notes', measures: [{ beats: [{ type: 'note', duration: 'whole', notes: [{ pitch: 'C4' }] }] }, { beats: [nt('half', 2, 1), nt('half', 2, 3)] }, { beats: [] }, { beats: [rest('whole')] }] },
  tab([{ beats: [nt('whole', 4, 3)] }, { beats: [nt('whole', 4, 5)] }, { beats: [] }, { beats: [nt('whole', 1, 7)] }], { name: 'Bass', showStandardNotation: false, tuning: BASS }),
] });
const three = () => model({ tracks: [
  tab([{ beats: [nt('quarter', 1, 1), nt('quarter', 1, 2), nt('half', 1, 3)] }, { beats: [nt('quarter', 1, 4), nt('quarter', 1, 5), nt('half', 1, 6)] }, { beats: [nt('whole', 1, 7)] }]),
  tab([{ beats: [nt('half', 2, 1), nt('half', 2, 2)] }, { beats: [nt('half', 2, 3), nt('quarter', 2, 4), nt('quarter', 2, 5)] }, { beats: [nt('whole', 2, 6)] }], { name: 'B' }),
  tab([{ beats: [nt('whole', 3, 1)] }, { beats: [nt('whole', 3, 2)] }, { beats: [nt('whole', 3, 3)] }], { name: 'C' }),
] });

// ---------- selection model (criteria 1-5) ----------
test('columnRange: two ends on different tracks select measures min..max on every visible track between them; info shape; parts are whole-measure single-track ranges', () => {
  const s = three();
  const sel = COL.columnRange(s, T(0, 1, 1), T(1, 1, 2));
  eq(Object.keys(sel), ['track', 'tracks', 'anchor', 'focus', 'parts', 'info']);
  eq(sel.info, { kind: 'measures', track: 0, start: { measure: 1, beat: 0 }, end: { measure: 1, beat: 0 }, beatCount: 6, measures: [1, 1], tracks: [0, 1] });
  eq([sel.track, sel.tracks, sel.anchor, sel.focus], [0, [0, 1], T(0, 1, 1), T(1, 1, 2)], 'the ends keep their tracks and beats');
  eq(sel.parts.map((p) => p.info), [SEL.selectionRange(s, 0, { measure: 1, beat: 0 }, { measure: 1, beat: 2 }).info, SEL.selectionRange(s, 1, { measure: 1, beat: 0 }, { measure: 1, beat: 2 }).info]);
  eq(sel.parts.map((p) => p.info.kind), ['measures', 'measures']);
  const up = COL.columnRange(s, T(2, 2, 0), T(0, 0, 1));
  eq([up.tracks, up.info.measures, up.info.beatCount, up.track], [[0, 1, 2], [0, 2], 7 + 6 + 3, 0], 'either order');
  ok(!('slices' in up), 'no top-level slices');
});
test('selectionOf: one track is the 2.3.1 selectionRange (same object shape, no tracks field), two tracks a column; going back to one track restores the beat range', () => {
  const s = three();
  const one = COL.selectionOf(s, T(0, 1, 1), T(0, 1, 2));
  eq(one, SEL.selectionRange(s, 0, { measure: 1, beat: 1 }, { measure: 1, beat: 2 }));
  ok(!('tracks' in one.info) && !one.parts);
  const col = COL.selectionOf(s, T(0, 1, 1), T(1, 1, 1));
  eq(col.info.kind, 'measures');
  const back = COL.selectionOf(s, COL.anchorOf(col), T(0, 1, 1));
  eq([back.info.kind, back.info.start, back.info.beatCount], ['beats', { measure: 1, beat: 1 }, 1]);
});
test('anchorOf / focusOf carry the track: a single-track selection takes sel.track, a column its own ends; null without a selection', () => {
  const s = three();
  eq(COL.anchorOf(SEL.selectionRange(s, 1, { measure: 0, beat: 1 }, { measure: 1, beat: 0 })), T(1, 0, 1));
  eq(COL.focusOf(SEL.selectionRange(s, 1, { measure: 0, beat: 1 }, { measure: 1, beat: 0 })), T(1, 1, 0));
  const col = COL.columnRange(s, T(2, 0, 0), T(0, 1, 2));
  eq([COL.anchorOf(col), COL.focusOf(col)], [T(2, 0, 0), T(0, 1, 2)]);
  eq([COL.anchorOf(null), COL.focusOf(null)], [null, null]);
});
test('criterion 2: hidden tracks are skipped and not listed; visibleBetween in either order; fewer than 2 visible tracks between the ends is the single-track range on the focus track', () => {
  const s = four();
  eq([COL.visibleBetween(s, 0, 3), COL.visibleBetween(s, 3, 0), COL.visibleBetween(s, 1, 1), COL.visibleBetween(s, -4, 99)], [[0, 2, 3], [0, 2, 3], [], [0, 2, 3]]);
  const sel = COL.columnRange(s, T(0, 0, 0), T(3, 1, 0));
  eq([sel.tracks, sel.info.beatCount], [[0, 2, 3], 4 + 3 + 2]);
  const hiddenEnd = COL.columnRange(s, T(1, 0, 0), T(0, 0, 1));
  eq([hiddenEnd.parts, hiddenEnd.info], [undefined, SEL.selectionRange(s, 0, { measure: 0, beat: 0 }, { measure: 0, beat: 1 }).info]);
  eq(COL.wordsOf(s, sel), { id: 'selectedColumns', a: 1, b: 2, t1: 1, t2: 4, hidden: 1 });
});
test('blank and empty measures in a column: zero-beat parts count 0, the column still covers them; a column of blank measures has beatCount 0', () => {
  const s = four();
  const sel = COL.columnRange(s, T(0, 2, 0), T(3, 2, 0));
  eq([sel.info.beatCount, sel.parts.map((p) => p.info.beatCount), sel.parts.map((p) => p.slices.length)], [0, [0, 0, 0], [1, 1, 1]]);
  const rests = COL.columnRange(s, T(2, 3, 0), T(3, 3, 0));
  eq(rests.info.beatCount, 1 + 1);
});
test('criterion 3: column moves: columnPrev / columnNext move the focus by a whole measure (first / last position), at the edges Start / End of score; columnStay changes nothing', () => {
  const s = three();
  eq(COL.columnNext(s, cur(1, 0, 0)), { cursor: cur(1, 1, 2) });
  eq(COL.columnPrev(s, cur(1, 2, 0)), { cursor: cur(1, 1, 0) });
  eq(COL.columnPrev(s, cur(1, 0, 1)), { announce: { id: 'startOfScore' } });
  eq(COL.columnNext(s, cur(1, 2, 0)), { announce: { id: 'endOfScore' } });
  eq(COL.columnStay(s, cur(1, 2, 0)), {});
  const col = COL.columnRange(s, T(0, 0, 0), T(1, 0, 1));
  const f = COL.columnar(() => 'single', () => 'column');
  eq([f(s, cur(0, 0, 0), st(), { selection: col }), f(s, cur(0, 0, 0), st(), { selection: SEL.selectionRange(s, 0, { measure: 0, beat: 0 }, { measure: 0, beat: 1 }) }), f(s, cur(0, 0, 0), st(), {}), f(s, cur(0, 0, 0), st())], ['column', 'single', 'single', 'single']);
});
test('criterion 4: coversTrack is kind measures over every measure; allTracks anchors on the first visible track start and moves the cursor to the last visible track\'s last position; null with one visible track; the words say all tracks only when everything is covered', () => {
  const s = four();
  eq(COL.coversTrack(s, SEL.selectionRange(s, 0, { measure: 0, beat: 0 }, { measure: 3, beat: 1 })), true);
  eq(COL.coversTrack(s, SEL.selectionRange(s, 0, { measure: 0, beat: 0 }, { measure: 2, beat: 0 })), false);
  eq(COL.coversTrack(s, SEL.selectionRange(s, 0, { measure: 0, beat: 1 }, { measure: 3, beat: 1 })), false, 'beats');
  eq(COL.coversTrack(s, null), false);
  const all = COL.allTracks(s, cur(0, 1, 0, 3));
  eq(all, { anchor: T(0, 0, 0), cursor: cur(3, 3, 0, 3) });
  const sel = COL.selectionOf(s, all.anchor, all.cursor);
  eq([sel.tracks, sel.info.measures, COL.coversTrack(s, sel)], [[0, 2, 3], [0, 3], true]);
  eq([COL.wordsOf(s, sel, true), COL.wordsOf(s, sel, false).id], [{ id: 'selectedAllTracks' }, 'selectedColumns']);
  const part = COL.columnRange(s, T(0, 0, 0), T(2, 3, 0));
  eq(COL.wordsOf(s, part, true).id, 'selectedColumns', 'not every visible track');
  eq(COL.allTracks(model({ tracks: [tab([{ beats: [] }]), { showStandardNotation: false, measures: [{ beats: [] }] }] }), cur(0, 0, 0)), null);
  eq(COL.wordsOf(s, SEL.selectionRange(s, 0, { measure: 0, beat: 0 }, { measure: 3, beat: 1 }), true).id, 'selectedAll', 'single-track words unchanged');
});
test('criterion 5 (model): a column selection is re-derived identically from its ends after a model change that keeps its tracks', () => {
  const s = three();
  const col = COL.columnRange(s, T(0, 0, 2), T(2, 1, 0));
  const again = COL.selectionOf(s, COL.anchorOf(col), COL.focusOf(col));
  eq(again, col);
  ok(C.clampCursor(s, cur(col.focus.track, col.focus.measure, col.focus.beat)).track === 2);
});

// ---------- clip (criteria 8, 10) ----------
const TUNING = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'];
const clipOf = (kind, tracks) => JSON.stringify({ type: 'music-score-clip', version: 1, kind, tracks });
const refusedId = (x) => CL.parseClip(x).refused?.id;
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
test('criterion 8: a column of the visible tracks 0, 2, 3 over measures 3-4 copies one clip with 3 track entries of 2 measures, each with its own tuning, tempo removed; the hidden track is left out; a single-track clip is unchanged', () => {
  const s = four();
  const sel = COL.columnRange(s, T(0, 2, 0), T(3, 3, 0));
  const c = CL.buildClip(s, sel);
  eq([c.kind, c.count, c.tracks], ['measures', 2, 3]);
  const j = JSON.parse(c.text);
  eq([j.type, j.version, j.kind, j.tracks.length], ['music-score-clip', 1, 'measures', 3]);
  eq(j.tracks.map((t) => t.tuning), [TUNING, TUNING, BASS]);
  eq(j.tracks.map((t) => t.measures), [[{ beats: [] }, { beats: v1(s, 0, 3) }], [{ beats: [] }, { beats: v1(s, 2, 3) }], [{ beats: [] }, { beats: v1(s, 3, 3) }]]);
  const t = model({ tracks: [tab([{ beats: [nt('whole', 1, 1, { tempo: 90 })] }]), tab([{ voices: [{ beats: [nt('whole')] }, { beats: [nt('whole', 2, 2)] }] }], { name: 'B' })] });
  const tj = JSON.parse(CL.buildClip(t, COL.columnRange(t, T(0, 0, 0), T(1, 0, 0))).text);
  eq([tj.tracks[0].measures[0].beats[0].tempo, tj.tracks[1].measures[0].voices.length], [undefined, 2], 'tempo never copied; voices kept');
  const one = CL.buildClip(s, SEL.selectionRange(s, 0, { measure: 2, beat: 0 }, { measure: 3, beat: 1 }));
  eq(Object.keys(one), ['text', 'kind', 'count']);
  eq(JSON.parse(one.text).tracks.length, 1);
  const back = CL.parseClip(c.text).clip;
  eq([Object.keys(back), back.tracks.length, back.tracks.map((x) => x.tuning)], [['kind', 'tracks'], 3, [TUNING, TUNING, BASS]]);
  eq(CL.parseClip(one.text).clip.kind, 'measures', 'a one-entry clip parses to the 2.3.1 shape');
  ok(!('tracks' in CL.parseClip(one.text).clip));
});
test('criterion 10: parseClip refuses more than 32 tracks (too large), unequal measure counts, a multi-track beats clip, a track entry that is not a plain object, an invalid tuning in any entry, an empty list, __proto__ anywhere, more than 5 MB and anything over a per-track limit', () => {
  const e = (n = 1, extra = {}) => ({ tuning: TUNING, measures: Array.from({ length: n }, () => ({ beats: [nt('whole')] })), ...extra });
  eq(refusedId(clipOf('measures', Array.from({ length: 33 }, () => e()))), 'clipTooLarge');
  ok(CL.parseClip(clipOf('measures', Array.from({ length: 32 }, () => e()))).clip.tracks.length === 32, '32 is fine');
  eq(refusedId(clipOf('measures', [e(2), e(1)])), 'clipInvalid');
  eq(refusedId(clipOf('beats', [{ beats: [] }, { beats: [] }])), 'clipInvalid');
  for (const bad of [null, [], 'x', 3, [e()]]) eq(refusedId(clipOf('measures', [e(), bad])), 'clipInvalid', JSON.stringify(bad));
  eq(refusedId(clipOf('measures', [e(), e(1, { tuning: ['X9'] })])), 'clipInvalid');
  eq(refusedId(clipOf('measures', [e(), { tuning: TUNING, measures: [3] }])), 'clipInvalid');
  eq(refusedId(clipOf('measures', [e(), { tuning: TUNING }])), 'clipInvalid', 'no measures');
  eq(refusedId(clipOf('measures', [])), 'clipInvalid');
  eq(refusedId('{"type":"music-score-clip","version":1,"kind":"measures","tracks":[{"measures":[{"beats":[]}]},{"measures":[{"beats":[{"__proto__":{"x":1},"type":"rest","duration":"whole"}]}]}]}'), 'clipInvalid', 'nested __proto__ in entry 2');
  eq(refusedId(clipOf('measures', [e(), { ...e(), x: { y: [{ z: 1 }] } }]).replace('"z"', '"__proto__"')), 'clipInvalid');
  eq(refusedId(clipOf('measures', [e(), e(1, { pad: 'x'.repeat(L.jsonChars) })])), 'clipTooLarge');
  eq(refusedId(clipOf('measures', [e(), { tuning: TUNING, measures: [{ beats: Array.from({ length: 257 }, () => rest('64th')) }] }])), 'clipTooLarge', 'beats per voice in entry 2');
  eq(refusedId(clipOf('measures', [e(2001), e(2001)])), 'clipTooLarge', 'measures per track');
  eq(refusedId(clipOf('measures', [e(), { tuning: TUNING, measures: [{ beats: [{ type: 'note', duration: 'whole', notes: Array.from({ length: 17 }, (_, k) => ({ string: 1, fret: k })) }] }] }])), 'clipTooLarge', 'notes per beat');
});
test('criterion 10: every track entry is sanitized on its own, the same as a one-entry clip of it; a missing tuning stays null', () => {
  const entries = [
    { tuning: TUNING, measures: [{ beats: [{ type: 'note', duration: 'quarter', notes: [{ string: 9, fret: 2 }, { string: 1, fret: 3 }], junk: 1 }] }] },
    { measures: [{ voices: [{ beats: [rest('half')], tempo: 70 }, { beats: [nt('whole')] }] }] },
    { tuning: BASS, measures: [{ beats: [{ type: 'bogus', duration: 'x' }, nt('half', 4, 30)] }] },
  ];
  const multi = CL.parseClip(clipOf('measures', entries)).clip;
  for (let i = 0; i < 3; i++) {
    const one = CL.parseClip(clipOf('measures', [entries[i]])).clip;
    eq(multi.tracks[i], { tuning: one.tuning, measures: one.measures }, `entry ${i}`);
  }
  eq(multi.tracks[1].tuning, null);
  ok(multi.tracks[1].measures[0].voices.every((v) => Object.keys(v).join() === 'beats'), 'voices keep only their beats');
});
test('criterion 10 / security: parseClip never throws: 3000 mutated 3-track clips, throwing getters, nested __proto__ in entry 2, non-string inputs, proxies; every result is { clip } or { refused }', () => {
  const rnd = mulberry32(232);
  const base = JSON.parse(CL.buildClip(four(), COL.columnRange(four(), T(0, 0, 0), T(3, 3, 0))).text);
  const junk = [null, true, 0, -1, 1e309, 'x', '__proto__', [], {}, [[]], { beats: 1 }, { voices: [null] }, { voices: 'v' }, { type: 'note' }, { notes: [{}] }, Array(300).fill(rest('64th'))];
  const mutate = (v, depth) => {
    if (depth > 6 || v === null || typeof v !== 'object') return rnd() < 0.15 ? junk[Math.floor(rnd() * junk.length)] : v;
    if (Array.isArray(v)) {
      const out = v.map((x) => mutate(x, depth + 1));
      if (rnd() < 0.1) out.push(junk[Math.floor(rnd() * junk.length)]);
      if (rnd() < 0.1) out.pop();
      return out;
    }
    const out = {};
    for (const [k, x] of Object.entries(v)) if (rnd() > 0.05) out[k] = mutate(x, depth + 1);
    if (rnd() < 0.05) out[['tuning', 'measures', 'beats', 'kind', 'version'][Math.floor(rnd() * 5)]] = junk[Math.floor(rnd() * junk.length)];
    return out;
  };
  const shape = (r) => ok(r && typeof r === 'object' && (('clip' in r && !('refused' in r)) || (typeof r.refused?.id === 'string' && !('clip' in r))), JSON.stringify(r)?.slice(0, 200));
  let parsed = 0;
  for (let i = 0; i < 3000; i++) {
    const m = mutate(base, 0);
    const r = CL.parseClip(rnd() < 0.5 ? JSON.stringify(m) : m);
    shape(r);
    if (r.clip) parsed++;
  }
  ok(parsed > 20, `${parsed} parsed`);
  const getter = { type: 'music-score-clip', version: 1, kind: 'measures', tracks: [{ measures: [] }, {}] };
  Object.defineProperty(getter.tracks[1], 'measures', { enumerable: true, get() { throw new Error('boom'); } });
  eq(CL.parseClip(getter), { refused: { id: 'clipInvalid' } });
  const proxy = new Proxy({}, { get() { throw new Error('trap'); }, ownKeys() { throw new Error('trap'); } });
  shape(CL.parseClip(proxy));
  const cyclic = { type: 'music-score-clip', version: 1, kind: 'measures', tracks: [] };
  cyclic.tracks.push(cyclic);
  eq(CL.parseClip(cyclic), { refused: { id: 'clipInvalid' } });
  for (const x of [undefined, null, 1, Symbol('s'), () => 1, '', '{', '[]', '"x"', 'null']) shape(CL.parseClip(x));
  const nested = '{"type":"music-score-clip","version":1,"kind":"measures","tracks":[{"measures":[]},{"measures":[],"tuning":{"a":{"__proto__":null}}}]}';
  eq(CL.parseClip(nested), { refused: { id: 'clipInvalid' } });
});

// ---------- paste (criteria 11-16) ----------
const mclip = (tracks) => CL.parseClip(clipOf('measures', tracks)).clip;
const entry = (frets, tuning = TUNING, string = 1) => ({ tuning, measures: frets.map((f) => ({ beats: [nt('whole', string, f)] })) });
const fret = (s, ti, mi) => v1(s, ti, mi)[0]?.notes?.[0]?.fret;
test('criterion 11: Ctrl+V of a 2-track clip over a column (measures) selection overwrites from the selection first measure on each mapped track: measure fields kept, voice 2 replaced, other tracks byte-identical; one result', () => {
  const s = model({ tracks: [
    tab([{ beats: [nt('whole', 1, 1)] }, { timeSignature: { beats: 4, beatType: 4 }, barline: 'double', voices: [{ beats: [nt('whole', 1, 2)] }, { beats: [nt('whole', 2, 9)] }] }, { beats: [nt('whole', 1, 3)] }]),
    tab([{ beats: [nt('whole', 2, 1)] }, { beats: [nt('whole', 2, 2)] }, { beats: [nt('whole', 2, 3)] }], { name: 'B' }),
    tab([{ beats: [nt('whole', 3, 1)] }, { beats: [nt('whole', 3, 2)] }, { beats: [nt('whole', 3, 3)] }], { name: 'C' }),
  ] });
  const sel = COL.columnRange(s, T(0, 1, 0), T(1, 2, 0));
  const r = PC.pasteColumns(s, cur(1, 2, 0), sel, mclip([entry([10, 11]), entry([20, 21])]));
  eq(r.announce, { id: 'pastedOver', count: 2, at: 2, added: 0, dropped: 0, tempoRemoved: 0, tracks: 2, droppedTracks: 0 });
  eq(describe(r.announce), 'Pasted 2 measures over measures 2 to 3, 2 tracks');
  eq([fret(r.score, 0, 1), fret(r.score, 0, 2), fret(r.score, 1, 1), fret(r.score, 1, 2), fret(r.score, 0, 0)], [10, 11, 20, 21, 1]);
  const m = r.score.tracks[0].measures[1];
  eq([m.barline, m.timeSignature, m.voices, m.beats.length], ['double', { beats: 4, beatType: 4 }, undefined, 1], 'measure fields kept, voices replaced by the clip beats');
  ok(r.score.tracks[2] === s.tracks[2], 'the track the clip does not reach is the same object');
  ok(same(r.score));
  eq(r.cursor, cur(0, 2, 1), 'the end of the last written measure on the base track (the score ends there)');
});
test('criterion 11: past the end, columns are appended to every track (hidden and unmapped too); 2000 measures at most', () => {
  const s = four();
  const sel = COL.columnRange(s, T(0, 3, 0), T(2, 3, 0));
  const r = PC.pasteColumns(s, cur(2, 3, 0), sel, mclip([entry([1, 2, 3]), entry([4, 5, 6])]));
  eq([r.announce.added, r.score.tracks.map((t) => t.measures.length)], [2, [6, 6, 6, 6]]);
  eq(describe(r.announce), 'Pasted 3 measures over measure 4, 2 measures added, 2 tracks');
  eq([fret(r.score, 0, 5), fret(r.score, 2, 5), v1(r.score, 1, 5), v1(r.score, 3, 5)], [3, 6, [], []]);
  ok(same(r.score));
  const big = model({ tracks: [tab(Array.from({ length: 1999 }, () => ({ beats: [] }))), tab(Array.from({ length: 1999 }, () => ({ beats: [] })), { name: 'B' })] });
  eq(PC.pasteColumns(big, cur(0, 1998, 0), null, mclip([entry([1, 2]), entry([3, 4])])).score.tracks[1].measures.length, 2000, 'exactly 2000');
  eq(PC.pasteColumns(big, cur(0, 1998, 0), null, mclip([entry([1, 2, 3]), entry([3, 4, 5])])), { refused: { id: 'tooLarge' } });
  eq(PC.pasteColumns(big, cur(0, 1998, 0), null, mclip([entry([1]), entry([3])])).score.tracks[0].measures.length, 1999);
});
test('criterion 12: with no selection, blank target measures on every mapped track are overwritten; otherwise k columns are inserted once in every track; insert always inserts; a beats selection refuses Ctrl+V but takes the insert paste', () => {
  const s = model({ tracks: [tab([{ beats: [nt('whole')] }, { beats: [] }, { beats: [] }]), tab([{ beats: [nt('whole')] }, { beats: [rest('whole')] }, { beats: [] }], { name: 'B' }), tab([{ beats: [nt('whole')] }, { beats: [nt('whole')] }, { beats: [] }], { name: 'C' })] });
  const clip = mclip([entry([7, 8]), entry([9, 10])]);
  const over = PC.pasteColumns(s, cur(0, 1, 0), null, clip);
  eq([over.announce.id, over.score.tracks.map((t) => t.measures.length), fret(over.score, 1, 2)], ['pastedOver', [3, 3, 3], 10]);
  const slot = PC.pasteColumns(s, cur(0, 0, 1), null, clip);
  eq([slot.announce.id, fret(slot.score, 0, 1)], ['pastedOver', 7], 'from the slot of a measure with a beat: the next measure');
  const busy = PC.pasteColumns(s, cur(1, 1, 0), null, clip);
  eq([busy.announce.id, busy.score.tracks.map((t) => t.measures.length), fret(busy.score, 1, 1), fret(busy.score, 2, 2), v1(busy.score, 0, 1)], ['pasted', [5, 5, 5], 7, 10, []]);
  eq(describe(busy.announce), 'Inserted 2 measures at measure 2, 2 tracks');
  const ins = PC.pasteColumns(s, cur(0, 1, 0), null, clip, { insert: true });
  eq([ins.announce.id, ins.score.tracks[0].measures.length], ['pasted', 5]);
  const bs = model({ tracks: [tab([{ beats: [nt('half'), nt('half')] }]), tab([{ beats: [nt('whole')] }], { name: 'B' })] });
  const bsel = SEL.selectionRange(bs, 0, { measure: 0, beat: 0 }, { measure: 0, beat: 0 });
  eq(PC.pasteColumns(bs, cur(0, 0, 0), bsel, clip), { refused: { id: 'pasteNeedsMeasures' } });
  eq(PC.pasteColumns(bs, cur(0, 0, 0), bsel, clip, { insert: true }).announce.id, 'pasted');
  eq(PC.pasteColumns(bs, cur(0, 0, 0), null, mclip([{ measures: [] }, { measures: [] }])), { refused: { id: 'nothingToPaste' } });
});
test('criterion 13: 3 clip tracks with 2 visible tracks from the base: 2 written, "1 clip track not pasted"; hidden tracks are skipped by the mapping; 2 clip tracks on 4 tracks leave the other 2 untouched; a multi-track clip on a single-track selection maps from that track', () => {
  const s = four();
  const clip3 = mclip([entry([1]), entry([2]), entry([3], BASS, 4)]);
  const r = PC.pasteColumns(s, cur(2, 2, 0), null, clip3);
  eq([r.announce.tracks, r.announce.droppedTracks, fret(r.score, 2, 2), fret(r.score, 3, 2)], [2, 1, 1, 2]);
  eq(describe(r.announce), 'Pasted 1 measure over measure 3, 2 tracks, 1 clip track not pasted');
  ok(r.score.tracks[0].measures[2] === s.tracks[0].measures[2] && r.score.tracks[1] === s.tracks[1], 'track 0 and the hidden track untouched');
  const all = PC.pasteColumns(s, cur(0, 2, 0), null, clip3);
  eq([all.announce.tracks, fret(all.score, 0, 2), fret(all.score, 2, 2), fret(all.score, 3, 2), v1(all.score, 1, 2)], [3, 1, 2, 3, []], 'tracks 0, 2, 3; hidden 1 skipped');
  const two = model({ tracks: [tab([{ beats: [] }]), tab([{ beats: [] }], { name: 'B' }), tab([{ beats: [] }], { name: 'C' }), tab([{ beats: [] }], { name: 'D' })] });
  const r2 = PC.pasteColumns(two, cur(1, 0, 0), null, mclip([entry([5]), entry([6])]));
  eq([fret(r2.score, 1, 0), fret(r2.score, 2, 0)], [5, 6]);
  ok(r2.score.tracks[0] === two.tracks[0] && r2.score.tracks[3] === two.tracks[3], 'the other 2 untouched');
  const single = SEL.selectionRange(two, 2, { measure: 0, beat: 0 }, { measure: 0, beat: 0 });
  const r3 = PC.pasteColumns(two, cur(2, 0, 0), single, mclip([entry([5]), entry([6]), entry([7])]));
  eq([fret(r3.score, 2, 0), fret(r3.score, 3, 0), r3.announce.droppedTracks, describe(r3.announce)], [5, 6, 1, 'Pasted 1 measure over measure 1, 2 tracks, 1 clip track not pasted']);
});
test('criterion 14: each mapped track gets its own tuning fit; notes on missing strings are dropped and counted as one total', () => {
  const s = four();
  const clip = mclip([{ tuning: TUNING, measures: [{ beats: [{ type: 'note', duration: 'whole', notes: [{ string: 6, fret: 3 }, { string: 1, fret: 0 }] }] }] }, { tuning: TUNING, measures: [{ beats: [{ type: 'note', duration: 'whole', notes: [{ string: 5, fret: 3 }, { string: 6, fret: 1 }] }] }] }]);
  const r = PC.pasteColumns(s, cur(2, 2, 0), null, clip);
  eq([r.announce.dropped, v1(r.score, 2, 2)[0].notes.length, v1(r.score, 3, 2)[0].type], [2, 2, 'rest'], 'strings 5 and 6 do not exist on the bass: its beat becomes a rest');
  eq(describe(r.announce), 'Pasted 1 measure over measure 3, 2 tracks, 2 notes on missing strings dropped');
});
test('criterion 15: tempo marks on overwritten beats are rehomed per mapped track after all the writes; marks with no beat left are dropped and counted', () => {
  const s = model({ tracks: [
    tab([{ beats: [nt('whole')] }, { beats: [nt('half', 1, 0, { tempo: 80 }), nt('half', 1, 0, { tempo: 100 })] }]),
    tab([{ beats: [nt('whole')] }, { beats: [nt('whole', 2, 0, { tempo: 120 })] }], { name: 'B' }),
  ] });
  const sel = COL.columnRange(s, T(0, 1, 0), T(1, 1, 0));
  const r = PC.pasteColumns(s, cur(1, 1, 0), sel, mclip([entry([3]), entry([4])]));
  const tempos = r.score.tracks.map((t) => t.measures[1].beats.map((b) => b.tempo ?? null));
  eq([tempos, r.announce.tempoRemoved], [[[80], [null]], 1], 'the onset-0 mark rehomed on its track; the mid-measure mark has no beat; track 2 lost its own winner to track 1 (same onset)');
  eq(describe(r.announce), 'Pasted 1 measure over measure 2, 2 tracks, 1 tempo mark removed');
});
test('criterion 16: the cursor goes to the first position after the written measures on the base track (end of the last one at the end of the score); a 1-track clip on a column selection goes to the top part only', () => {
  const s = three();
  const r = PC.pasteColumns(s, cur(2, 0, 0), COL.columnRange(s, T(1, 0, 0), T(2, 0, 0)), mclip([entry([5]), entry([6])]));
  eq(r.cursor, cur(1, 1, 0));
  const end = PC.pasteColumns(s, cur(2, 2, 0), COL.columnRange(s, T(1, 2, 0), T(2, 2, 0)), mclip([entry([5]), entry([6])]));
  eq(end.cursor, cur(1, 2, 1));
  const one = PA.applyPaste(s, cur(2, 1, 0), COL.columnRange(s, T(0, 1, 0), T(2, 1, 0)), mclip([entry([9])]));
  eq([one.announce.id, fret(one.score, 0, 1), one.score.tracks[1] === s.tracks[1], one.score.tracks[2] === s.tracks[2], one.cursor.track], ['pastedOver', 9, true, true, 0]);
  eq(describe(one.announce), 'Pasted 1 measure over measure 2');
  const bclip = CL.parseClip(clipOf('beats', [{ tuning: TUNING, beats: [nt('quarter', 1, 9)] }])).clip;
  const ob = PA.applyPaste(s, cur(2, 1, 0), COL.columnRange(s, T(0, 1, 0), T(2, 1, 0)), bclip);
  eq([ob.announce.id, v1(ob.score, 0, 1).map((b) => b.notes[0].fret), ob.score.tracks[2] === s.tracks[2]], ['pasted', [9], true], 'a beats clip replaces the top part');
});

// ---------- range edits over a column (criteria 17-22) ----------
test('criterion 17: Delete turns the beats of every selected track into rests (graces go), hidden tracks untouched, the cursor on the top track; all rests already: "Already rests"', () => {
  const s = four();
  const sel = COL.columnRange(s, T(0, 0, 0), T(3, 1, 0));
  const r = run('deleteNote', s, cur(3, 1, 0), sel);
  eq(said(r), '9 beats changed to rests on 3 tracks');
  eq([r.announce, CMD.undoLabel('deleteNote', r.announce)], [{ id: 'rangeCleared', count: 9, tracks: 3 }, 'clear beats']);
  for (const ti of [0, 2, 3]) for (const mi of [0, 1]) ok(v1(r.score, ti, mi).every((b) => b.type === 'rest'), `track ${ti} measure ${mi}`);
  eq(r.score.tracks[1], s.tracks[1], 'the hidden track is the same object');
  eq([v1(r.score, 0, 3), v1(r.score, 3, 3)], [v1(s, 0, 3), v1(s, 3, 3)], 'measures outside the column untouched');
  eq(r.cursor, cur(0, 0, 0), 'the top track start');
  ok(same(r.score));
  const again = run('deleteNote', r.score, cur(3, 1, 0), COL.columnRange(r.score, T(0, 0, 0), T(3, 1, 0)));
  eq([again.changed, said(again)], [false, 'Already rests']);
});
test('criterion 18: Ctrl+Delete leaves the measures empty on every selected track, the measure count unchanged; winning tempo marks counted on the original score; no beats at all: "No beats to delete"', () => {
  const s = model({ tracks: [
    tab([{ beats: [nt('whole', 1, 1, { tempo: 90 })] }, { beats: [nt('whole')] }, { beats: [nt('whole')] }]),
    tab([{ beats: [nt('half', 2, 2), nt('half', 2, 3, { tempo: 100 })] }, { beats: [nt('whole')] }, { beats: [nt('whole')] }], { name: 'B' }),
  ] });
  const r = run('deleteBeat', s, cur(1, 1, 0), COL.columnRange(s, T(0, 0, 0), T(1, 1, 0)));
  eq(said(r), '5 beats deleted on 2 tracks, 2 tempo marks removed');
  eq([r.announce.tracks, CMD.undoLabel('deleteBeat', r.announce)], [2, 'delete beats']);
  eq(r.score.tracks.map((t) => t.measures.map((m) => m.beats.length)), [[0, 0, 1], [0, 0, 1]]);
  eq(r.cursor, cur(0, 0, 0));
  ok(same(r.score));
  const blank = model({ tracks: [tab([{ beats: [] }]), tab([{ beats: [] }], { name: 'B' })] });
  eq(said(run('deleteBeat', blank, cur(1, 0, 0), COL.columnRange(blank, T(0, 0, 0), T(1, 0, 0)))), 'No beats to delete');
});
test('Ctrl+Delete on a column whose top track has no beat in it: the cursor goes to the first removed beat of the first track that had one', () => {
  const s = model({ tracks: [tab([{ beats: [] }, { beats: [] }]), tab([{ beats: [] }, { beats: [nt('half'), nt('half')] }], { name: 'B' }), tab([{ beats: [nt('whole')] }, { beats: [] }], { name: 'C' })] });
  const r = run('deleteBeat', s, cur(2, 1, 0), COL.columnRange(s, T(0, 0, 0), T(2, 1, 0)));
  eq([said(r), r.cursor], ['3 beats deleted on 3 tracks', cur(1, 1, 0)]);
  eq(run('deleteBeat', s, cur(0, 0, 0), COL.columnRange(s, T(0, 0, 0), T(2, 0, 0))).cursor, cur(2, 0, 0), 'tracks 1 and 2 have no beat in measure 1');
});
test('criterion 19: Shift+Delete on a column deletes those columns from every track, hidden ones too', () => {
  const s = four();
  const r = run('deleteMeasure', s, cur(3, 1, 0), COL.columnRange(s, T(0, 0, 0), T(3, 1, 0)));
  eq([said(r), r.score.tracks.map((t) => t.measures.length)], ['Measures 1 to 2 deleted', [2, 2, 2, 2]]);
  eq(CMD.undoLabel('deleteMeasure', r.announce), 'delete measures');
});
test('criterion 20: F fills every measure of every selected track (cells counted), refused ones skipped and counted; one measure on 2 tracks is 2 cells; criterion 21: Shift+F ignores the column', () => {
  const s = model({ tracks: [
    tab([{ beats: [nt('quarter')] }, { beats: [nt('whole')] }]),
    tab([{ beats: [] }, { beats: [nt('half')] }], { name: 'B' }),
    tab([{ beats: [nt('half')] }, { beats: [nt('quarter')] }], { name: 'C' }),
  ] });
  const r = run('fill', s, cur(2, 1, 0), COL.columnRange(s, T(0, 0, 0), T(2, 1, 0)));
  eq(said(r), 'Filled 5 of 6 measures on 3 tracks, 7 rests added');
  eq([r.announce.tracks, r.announce.total, r.announce.count], [3, 6, 5]);
  eq(r.score.tracks.map((t) => t.measures.map((m) => m.beats.length)), [[3, 1], [1, 2], [2, 3]]);
  ok(same(r.score));
  const one = run('fill', s, cur(1, 0, 0), COL.columnRange(s, T(0, 0, 0), T(1, 0, 0)));
  eq(said(one), 'Filled 2 measures on 2 tracks, 3 rests added');
  const full = model({ tracks: [tab([{ beats: [nt('whole')] }]), tab([{ beats: [nt('whole')] }], { name: 'B' })] });
  eq(said(run('fill', full, cur(1, 0, 0), COL.columnRange(full, T(0, 0, 0), T(1, 0, 0)))), 'Nothing to fill');
  const over = model({ tracks: [tab([{ beats: [nt('whole'), nt('half')] }, { beats: [] }]), tab([{ beats: [nt('whole'), nt('whole')] }, { beats: [] }], { name: 'B' })] });
  const rf = run('reflow', over, cur(1, 0, 0), COL.columnRange(over, T(0, 0, 0), T(1, 0, 0)));
  eq([v1(rf.score, 0, 0).length, v1(rf.score, 1, 0).length, said(rf)], [2, 1, 'Moved 1 beat to measure 2'], 'Shift+F on the cursor track only');
});
test('criterion 22: a beat effect follows the toggle rule across all selected tracks; note effects skip notation-only tracks and count them; needsTab only when no selected track has TAB', () => {
  const s = four();
  const sel = COL.columnRange(s, T(0, 0, 0), T(3, 1, 0));
  const p = run('palmMute', s, cur(3, 1, 0), sel);
  eq(said(p), 'Palm mute on, 9 beats on 3 tracks');
  eq(p.announce.skippedTracks, 0);
  for (const ti of [0, 2, 3]) ok(v1(p.score, ti, 0).every((b) => b.palmMute === true), `track ${ti}`);
  eq(p.score.tracks[1], s.tracks[1], 'hidden track untouched');
  const off = run('palmMute', p.score, cur(3, 1, 0), COL.columnRange(p.score, T(0, 0, 0), T(3, 1, 0)));
  eq(said(off), 'Palm mute off, 9 beats on 3 tracks');
  const mixed = run('palmMute', s, cur(3, 1, 0), COL.columnRange(s, T(0, 0, 0), T(3, 0, 0)));
  const p2 = run('palmMute', mixed.score, cur(3, 1, 0), sel);
  eq(said(p2), 'Palm mute on, 9 beats on 3 tracks', 'mixed steps all go to the start step');
  const x = run('deadNote', s, cur(3, 1, 0), sel);
  eq(said(x), 'Dead note on, 6 notes on 2 tracks, 1 track without TAB skipped');
  eq(v1(x.score, 2, 1), v1(s, 2, 1), 'the notation-only track untouched');
  const notes = model({ tracks: [{ name: 'N', measures: [{ beats: [nt('whole')] }] }, { name: 'M', measures: [{ beats: [nt('whole')] }] }] });
  eq(said(run('deadNote', notes, cur(1, 0, 0), COL.columnRange(notes, T(0, 0, 0), T(1, 0, 0)))), 'Needs a TAB staff');
  ok(CMD.COMMANDS.palmMute.keepsSelection && same(x.score));
});
test('criterion 22: transpose covers every selected track (TAB or not), all or nothing; the first misfit in track then measure order is named with its track; ties survive only between transposed notes of the same track', () => {
  const tied = (fret, flag) => ({ type: 'note', duration: 'whole', notes: [{ string: 1, fret, [flag]: true }] });
  const s = model({ tracks: [
    tab([{ beats: [nt('whole', 1, 3)] }, { beats: [nt('whole', 1, 22)] }]),
    { name: 'Notes', measures: [{ beats: [{ type: 'note', duration: 'whole', notes: [{ pitch: 'C4' }, { string: 2, fret: 1 }] }] }, { beats: [nt('whole', 2, 23)] }] },
    tab([{ beats: [tied(1, 'tieStart')] }, { beats: [tied(1, 'tieEnd')] }], { name: 'C' }),
  ] });
  const all = COL.columnRange(s, T(0, 0, 0), T(2, 1, 0));
  const up = run('transpose', s, cur(2, 1, 0), all, 1);
  eq(said(up), 'Transposed 6 notes up 1 semitone on 3 tracks, 1 pitch-only note skipped');
  eq([v1(up.score, 0, 1)[0].notes[0].fret, v1(up.score, 1, 0)[0].notes, v1(up.score, 2, 0)[0].notes[0]], [23, [{ pitch: 'C4' }, { string: 2, fret: 2 }], { string: 1, fret: 2, tieStart: true }]);
  ok(same(up.score));
  const bad = run('transpose', s, cur(2, 1, 0), all, 3);
  eq([bad.changed, said(bad)], [false, "Can't transpose, measure 2 on track 1 would go above fret 24"]);
  const second = run('transpose', s, cur(2, 1, 0), COL.columnRange(s, T(1, 0, 0), T(2, 1, 0)), 2);
  eq(said(second), "Can't transpose, measure 2 on track 2 would go above fret 24", 'track numbers count from 1');
  const half = run('transpose', s, cur(2, 1, 0), COL.columnRange(s, T(0, 0, 0), T(2, 0, 0)), 1);
  eq([v1(half.score, 2, 0)[0].notes[0], v1(half.score, 2, 1)[0].notes[0]], [{ string: 1, fret: 2 }, { string: 1, fret: 1 }], 'a tie to an untransposed note goes on both sides');
});

// ---------- B10 / E12 (2.3.2) ----------
const RE = await imp('src/editor/model/rangeEdit.js');
test('eachSelectedBeat visits every selected beat, graces included, in track, measure, beat order with its location; a single-track selection is one part', () => {
  const s = model({ tracks: [
    tab([{ beats: [nt('half'), { type: 'grace', duration: '16th', notes: [{ string: 2, fret: 3 }] }, nt('half', 1, 2)] }, { beats: [nt('whole', 1, 3)] }]),
    tab([{ beats: [nt('whole', 2, 4)] }, { beats: [] }], { name: 'B' }),
  ] });
  const seen = [];
  RE.eachSelectedBeat(s, COL.columnRange(s, T(0, 0, 0), T(1, 1, 0)).parts, (b, loc) => seen.push([loc, b.type]));
  eq(seen, [[T(0, 0, 0), 'note'], [T(0, 0, 1), 'grace'], [T(0, 0, 2), 'note'], [T(0, 1, 0), 'note'], [T(1, 0, 0), 'note']]);
  const one = [];
  const sel = SEL.selectionRange(s, 0, { measure: 0, beat: 2 }, { measure: 1, beat: 0 });
  RE.eachSelectedBeat(s, RE.partsOf(sel), (b, loc) => one.push(loc));
  eq(one, [T(0, 0, 1), T(0, 0, 2), T(0, 1, 0)], 'the grace leading into beat 3 goes with it');
});
const { exampleScore } = await imp('examples/example-score.js');
const { leadRiff } = await imp('examples/lead-riff.js');
const { defaultScore } = await imp('src/editor/model/defaultScore.js');
const { EFFECTS } = await imp('src/editor/model/effectTable.js');
const grace = () => ({ type: 'grace', duration: '16th', notes: [{ string: 2, fret: 3 }] });
const B10_START = () => [
  ['default', defaultScore()], ['lead-riff', model(leadRiff)], ['example-score', model(exampleScore)], ['four', four()], ['three', three()],
  ['rich', model({ tracks: [
    tab([{ beats: [nt('quarter'), grace(), nt('quarter', 2, 2, { notes: [{ string: 2, fret: 2, tieStart: true }] }), rest('quarter'), nt('quarter', 1, 0, { dots: 1 })] },
      { voices: [{ beats: [grace(), nt('half', 2, 2, { notes: [{ string: 2, fret: 2, tieEnd: true }] }), nt('half', 1, 0, { tempo: 80 })] }, { beats: [nt('whole', 4, 0)] }] }, null, { beats: [] }]),
    { name: 'Notes', measures: [{ beats: [{ type: 'note', duration: 'half', notes: [{ pitch: 'C4' }, { string: 2, fret: 22 }] }] }, { beats: [nt('whole', 1, 1, { tempo: 70 })] }] },
    tab([{ beats: [] }], { tuning: BASS, showStandardNotation: false }),
  ] })],
];
const EDITS = ['digit', 'deleteNote', 'deleteNote', 'deleteBeat', 'deleteBeat', 'deleteMeasure', 'toggleRest', 'insertBeat', 'insertMeasureAfter', 'fill', 'fill', 'reflow', 'transpose', 'transpose', 'transpose', ...EFFECTS.map((d) => d.name)];
const NAVS = ['moveLeft', 'moveRight', 'moveDown', 'nextMeasure', 'prevMeasure', 'prevTrack', 'nextTrack', 'scoreStart'];
const SELECTS = ['selectPrevTrack', 'selectNextTrack', 'selectNextTrack', 'selectPrevTrack', 'selectLeft', 'selectRight', 'selectMeasureStart', 'selectMeasureEnd', 'selectPrevMeasure', 'selectNextMeasure', 'selectAll', 'selectAll', 'selectScoreStart', 'selectScoreEnd'];
const SEMIS = [1, -1, 12, -12];
/** The controller's _extend at model level (selection.js): Ctrl+A twice, D10, the normal path with edgeKeeps. */
function extend(s, c, state, sel, name) {
  const cmd = CMD.COMMANDS[name];
  if (cmd.fromStart && COL.coversTrack(s, sel)) {
    const all = COL.allTracks(s, c);
    if (all) return { c: all.cursor, state: C.syncDuration(s, all.cursor, state), sel: COL.selectionOf(s, all.anchor, all.cursor), all: true };
  }
  const here = { track: c.track, measure: c.measure, beat: c.beat };
  if (cmd.measureStep && !sel && C.positions(s, c).length === 1) return { c, state, sel: COL.selectionOf(s, here, c) };
  const anchor = cmd.fromStart ? { track: c.track, ...SEL.startOf(s, c) } : COL.anchorOf(sel) ?? here;
  const r = CMD.run(name, s, c, state, { allowAppend: false, selection: sel });
  if (cmd.edgeKeeps && !r.moved) return { c, state: r.state, sel };
  return { c: r.cursor, state: r.state, sel: COL.selectionOf(s, anchor, r.cursor) };
}
test('B10 (2.3.2): 6 start scores (one with a hidden, a notation-only and a 4-string track) x 2000 steps mixing track extends, column moves, Ctrl+A twice, column copy / cut / paste, Delete, Ctrl+Delete, Shift+Delete, F, effects and transpose keep sanitizeScore(model) === model, a valid cursor and a re-derivable selection; undo all restores the start, redo all the end', () => {
  const rnd = mulberry32(20261123);
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  for (const [label, start] of B10_START()) {
    let s = start;
    let c = C.clampCursor(s, cur(0, 0, 0));
    let state = st();
    let sel = null;
    let clipboard = null;
    const history = [];
    const seen = { column: 0, all: 0, colEdit: 0, colPaste: 0, colCut: 0, colCopy: 0 };
    const multi = s.tracks.filter((t) => t.showTablature || t.showStandardNotation !== false).length > 1;
    for (let i = 0; i < 2000; i++) {
      const r0 = rnd();
      const before = { s, c };
      let next = null;
      if (r0 < 0.3) {
        const x = extend(s, c, state, sel, pick(SELECTS));
        ({ c, state, sel } = x);
        if (x.all) seen.all++;
        if (sel?.parts) seen.column++;
      } else if (r0 < 0.36) {
        const range = sel ?? CL.cursorRange(s, c);
        if (range) { clipboard = CL.buildClip(s, range).text; if (sel?.parts) seen.colCopy++; }
      } else if (r0 < 0.40) {
        const range = sel ?? CL.cursorRange(s, c);
        if (range) {
          clipboard = CL.buildClip(s, range).text;
          const r = RE.clearParts(s, range);
          if (r.score !== s) { next = { score: r.score, cursor: { ...c, ...r.cursor } }; if (sel?.parts) seen.colCut++; sel = null; }
        }
      } else if (r0 < 0.50) {
        if (clipboard) {
          const clip = CL.parseClip(clipboard).clip; // a beats clip of more than 256 beats is refused (2.3)
          const r = clip ? (clip.tracks ? PC.pasteColumns : PA.applyPaste)(s, c, sel, clip, { insert: rnd() < 0.4 }) : { refused: true };
          if (!r.refused && io.exportedLength(r.score) <= L.jsonChars) { next = r; if (clip.tracks) seen.colPaste++; sel = null; }
        }
      } else {
        const name = rnd() < 0.2 ? pick(NAVS) : pick(EDITS);
        const r = CMD.run(name, s, c, state, { maxFret: 24, now: i * 1000, twoDigitDelayMs: 800, allowAppend: true, selection: sel }, name === 'transpose' ? pick(SEMIS) : Math.floor(rnd() * 10));
        state = r.state;
        if (r.changed) { next = r; if (sel?.parts) seen.colEdit++; } else c = r.cursor;
        if (r.changed && sel && CMD.COMMANDS[name].keepsSelection) sel = COL.selectionOf(r.score, COL.anchorOf(sel), COL.focusOf(sel));
        else if (r.changed || CMD.COMMANDS[name].kind === 'nav') sel = null;
      }
      if (next) {
        s = next.score;
        c = C.clampCursor(s, next.cursor ?? c);
        state = C.syncDuration(s, c, state);
        history.push({ before, after: { s, c } });
      }
      ok(sanitizeScore(s) === s, `${label} step ${i}: sanitize identity`);
      eq(C.clampCursor(s, c), c, `${label} step ${i}: valid cursor`);
      if (sel) eq(COL.selectionOf(s, COL.anchorOf(sel), COL.focusOf(sel))?.info, sel.info, `${label} step ${i}: valid selection`);
      if (sel?.parts) ok(sel.tracks.every((ti) => s.tracks[ti].showTablature || s.tracks[ti].showStandardNotation !== false), `${label} step ${i}: visible tracks only`);
    }
    if (multi) ok(seen.column > 50 && seen.all > 5 && seen.colEdit > 10 && seen.colPaste > 5 && seen.colCopy > 5 && history.length > 300, `${label}: ${JSON.stringify(seen)}, ${history.length} steps`);
    const end = s;
    for (let k = history.length - 1; k >= 0; k--) { ok(history[k].after.s === s); s = history[k].before.s; }
    ok(s === start, `${label}: undo all restores the start`);
    for (const h of history) s = h.after.s;
    ok(s === end, `${label}: redo all reaches the end`);
  }
});
test('E12 (2.3.2): unknown fields survive column Delete, Ctrl+Delete (beat fields go with their beats), F, effects, transpose, a column cut and an overwrite column paste (measure-level ones kept) when the operation does not own them', () => {
  const x = { keep: [1, { deep: true }] };
  const trk = (name, f) => ({ x, name, showTablature: true, measures: [
    { x, beats: [{ x, type: 'note', duration: 'half', notes: [{ x, string: 1, fret: f }] }] },
    { x, voices: [{ x, beats: [{ x, type: 'note', duration: 'half', notes: [{ x, string: 2, fret: f }] }] }, { x, beats: [] }] },
    { x, beats: [] },
  ] });
  const s0 = model({ x, tracks: [trk('A', 1), trk('B', 2)] });
  const count = (v) => (Array.isArray(v) ? v.reduce((a, y) => a + count(y), 0) : v && typeof v === 'object' ? (JSON.stringify(v.x) === JSON.stringify(x) ? 1 : 0) + Object.values(v).reduce((a, y) => a + count(y), 0) : 0);
  const n0 = count(s0);
  const col = COL.columnRange(s0, T(0, 0, 0), T(1, 1, 0));
  for (const name of ['fill', 'palmMute', 'deadNote']) eq(count(run(name, s0, cur(1, 1, 0), col).score), n0, name);
  eq(count(run('transpose', s0, cur(1, 1, 0), col, 3).score), n0, 'transpose');
  eq(count(run('deleteNote', s0, cur(1, 1, 0), col).score), n0 - 4, 'Delete keeps the beat fields on the rests; the 4 notes go with theirs');
  eq(count(run('deleteBeat', s0, cur(1, 1, 0), col).score), n0 - 8, 'Ctrl+Delete: 4 beats and 4 notes go');
  const clip = CL.parseClip(CL.buildClip(s0, col).text).clip;
  const over = PC.pasteColumns(s0, cur(0, 2, 0), null, clip);
  eq([over.announce.id, count(over.score)], ['pastedOver', n0 + 8], 'the blank measure 3 and its new measure 4 keep their own fields on both tracks; the pasted beats and notes bring theirs');
});

// ---------- report ----------
export function summary() {
  let fail = 0;
  for (const r of results) {
    if (r.ok) console.log(`PASS editor-columns: ${r.name}`);
    else { fail++; console.log(`FAIL editor-columns: ${r.name}\n  ${r.msg}`); }
  }
  return fail;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const f = summary();
  console.log(f ? `\n${f} FAILED` : '\nALL PASSED');
  process.exit(f ? 1 : 0);
}
