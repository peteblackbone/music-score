// 2.0.0 editor edge cases against the acceptance criteria (pure model level: src/editor/model/*, keymap, demo helpers).
// Complements tests/editor-model.mjs: two-voice measures, graces, hidden rests, ties across barlines and column
// edits, fill transitions, tracks of every kind, maxFret logic and model-wide invariants after random commands.
// Run via `node tests/run.js` (calls summary()), or directly: `node tests/editor-edge.mjs`.
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

register('./hooks.mjs', import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const { sanitizeScore } = await imp('src/sanitize.js');
const io = await imp('src/editor/model/io.js');
const A = await imp('src/editor/model/access.js');
const F = await imp('src/editor/model/fill.js');
const C = await imp('src/editor/model/cursor.js');
const T = await imp('src/editor/model/ties.js');
const { run, COMMANDS } = await imp('src/editor/model/commands.js');
const { keyToCommand } = await imp('src/editor/keymap.js');
const { EFFECTS } = await imp('src/editor/model/effectTable.js');
const demo = await imp('examples/editor-demo.js');
const { exampleScore } = await imp('examples/example-score.js');
const { leadRiff } = await imp('examples/lead-riff.js');
const { leadSoloF } = await imp('examples/lead-solo-f.js');

const results = [];
const test = (name, fn) => {
  try { fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, msg: e.stack || e.message }); }
};
const J = (o) => JSON.stringify(o);
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const eq = (a, b, m = '') => {
  const x = J(canon(a)), y = J(canon(b));
  if (x !== y) throw new Error(`${m} expected ${y}, got ${x}`);
};
const ok = (c, m = 'assertion failed') => { if (!c) throw new Error(m); };
const clone = (o) => JSON.parse(J(o));
const nt = (duration, string = 1, fret = 0, extra = {}) => ({ type: 'note', duration, notes: [{ string, fret }], ...extra });
const tn = (duration, string, fret, flags = {}, extra = {}) => ({ type: 'note', duration, notes: [{ string, fret, ...flags }], ...extra });
const rest = (duration = 'quarter', extra = {}) => ({ type: 'rest', duration, ...extra });
const hid = (duration = 'quarter', extra = {}) => rest(duration, { hidden: true, ...extra });
const grace = (string = 2, fret = 3) => ({ type: 'grace', duration: '16th', notes: [{ string, fret }] });
const tab = (measures, extra = {}) => ({ name: 'Gtr', showTablature: true, ...extra, measures });
const notation = (measures, extra = {}) => ({ name: 'Std', showTablature: false, ...extra, measures });
const tabOnly = (measures, extra = {}) => ({ name: 'Tab', showStandardNotation: false, showTablature: true, ...extra, measures });
const hidden = (measures = [{ beats: [] }]) => ({ name: 'Hidden', showStandardNotation: false, showTablature: false, measures });
const sc = (...tracks) => ({ tracks });
const cur = (track, measure, beat, string = 1) => ({ track, measure, beat, string });
const beatsOf = (s, ti = 0, mi = 0) => A.beatsAt(s, { track: ti, measure: mi });
const ST = () => ({ duration: 'quarter', dots: 0, digit: null });

/** A model driven by keys, as ScoreEditor does it (without history): `p.key('5')`, `p.go('ArrowRight', '3')`. */
function play(input, { at = cur(0, 0, 0), maxFret = 24, delay = 800, append = true } = {}) {
  const s0 = io.parseInput(input);
  const cursor0 = C.clampCursor(s0, at);
  const p = { start: s0, score: s0, cursor: cursor0, state: C.syncDuration(s0, cursor0, ST()), now: 1000, announce: null, last: null };
  p.wait = (ms) => { p.now += ms; return p; };
  p.cmd = (name, arg) => {
    const r = run(name, p.score, p.cursor, p.state, { maxFret, now: p.now, twoDigitDelayMs: delay, allowAppend: append }, arg);
    p.score = r.score; p.cursor = r.cursor; p.state = r.state; p.announce = r.announce; p.last = r;
    return p;
  };
  p.key = (k, mods = {}) => {
    const c = keyToCommand({ key: k, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods });
    if (!c) throw new Error(`unmapped key ${k}`);
    return p.cmd(c.name, c.arg);
  };
  p.go = (...ks) => { ks.forEach((k) => (typeof k === 'string' ? p.key(k) : p.key(k[0], k[1]))); return p; };
  p.beats = (ti = 0, mi = 0) => beatsOf(p.score, ti, mi);
  p.fill = (ti = 0, mi = 0) => F.measureFill(p.score, { track: ti, measure: mi });
  return p;
}
const CTRL = (k) => [k, { ctrlKey: true }];
const SHIFT = (k) => [k, { shiftKey: true }];

const tieErrors = (s) => {
  const errs = [];
  s.tracks.forEach((t, ti) => (t.measures || []).forEach((m, mi) => {
    if (!m) return;
    A.beatsOf(m).forEach((b, bi) => (b.notes || []).forEach((n) => {
      if (b.type === 'grace') return;
      const loc = { track: ti, measure: mi, beat: bi, string: n.string };
      if (n.tieStart) {
        const nx = T.nextMainBeat(s, loc);
        const nn = nx && A.noteOn(A.beatAt(s, nx), n.string);
        if (!nn || !nn.tieEnd || nn.fret !== n.fret) errs.push(`dangling tieStart t${ti} m${mi} b${bi} s${n.string}`);
      }
      if (n.tieEnd) {
        const pv = T.prevMainBeat(s, loc);
        const pn = pv && A.noteOn(A.beatAt(s, pv), n.string);
        if (!pn || !pn.tieStart) errs.push(`dangling tieEnd t${ti} m${mi} b${bi} s${n.string}`);
      }
    }));
  }));
  return errs;
};
// ---------- C8 / E10: two-voice measures, voice 2 byte for byte ----------
const v2obj = () => ({ beats: [nt('whole', 4, 4, { dynamic: 'f', palmMute: true }), grace(1, 1)], stem: 'down', custom: { deep: [1, 2, { x: 1 }] } });
const twoVoice = () => ({ beats: [nt('whole', 6, 6)], voices: [
  { beats: [tn('quarter', 1, 3), grace(), tn('quarter', 1, 3), hid(), nt('quarter', 2, 5)], stem: 'up' },
  v2obj(),
] });
const voiceScore = () => sc(tab([twoVoice(), { beats: [nt('whole')] }, { voices: [{ beats: [nt('quarter')] }, { beats: [nt('half', 3, 3)] }] }, { beats: [] }]));
const VOICE_CASES = [
  ['digit on a note (chord)', cur(0, 0, 0, 2), 'digit', 7],
  ['digit re-fret', cur(0, 0, 0, 1), 'digit', 9],
  ['digit on a hidden rest', cur(0, 0, 3, 1), 'digit', 2],
  ['deleteNote', cur(0, 0, 0, 1), 'deleteNote'],
  ['deleteNote (last note -> rest)', cur(0, 0, 4, 2), 'deleteNote'],
  ['toggleTie', cur(0, 0, 2, 1), 'toggleTie'],
  ['shorter', cur(0, 0, 2), 'shorter'],
  ['longer', cur(0, 0, 2), 'longer'],
  ['setDuration', cur(0, 0, 2), 'setDuration', 'half'],
  ['cycleDots', cur(0, 0, 2), 'cycleDots'],
  ['toggleTriplet', cur(0, 0, 0), 'toggleTriplet'],
  ['toggleRest (note -> rest)', cur(0, 0, 0), 'toggleRest'],
  ['toggleRest (hidden rest -> note)', cur(0, 0, 3), 'toggleRest'],
  ['deleteBeat (with its leading grace)', cur(0, 0, 2), 'deleteBeat'],
  ['insertBeat (before the grace)', cur(0, 0, 2), 'insertBeat'],
  ['digit on the append slot', cur(0, 2, 1, 4), 'digit', 5],
  ['toggleRest on the append slot', cur(0, 2, 1), 'toggleRest'],
  ['insertBeat on the append slot', cur(0, 2, 1), 'insertBeat'],
];
test('C8: every beat/note command on a two-voice measure leaves voice 2 and measure.beats identical (===) and voice 1 extras intact', () => {
  for (const [label, at, name, arg] of VOICE_CASES) {
    const p = play(voiceScore(), { at });
    const s = p.start;
    const m0 = s.tracks[0].measures[0];
    const m2 = s.tracks[0].measures[2];
    const bytes = J([m0.voices[1], m0.beats, m2.voices[1]]);
    p.cmd(name, arg);
    ok(p.last.changed, `${label}: changed`);
    const out = p.score.tracks[0].measures;
    const target = out[at.measure];
    const old = s.tracks[0].measures[at.measure];
    ok(target.voices[1] === old.voices[1], `${label}: voice 2 same object`);
    ok(target.beats === old.beats, `${label}: measure.beats same object`);
    ok(target.voices !== old.voices, `${label}: voices array copied (copy on write)`);
    eq(J([out[0].voices[1], out[0].beats, out[2].voices[1]]), bytes, `${label}: bytes`);
    eq(target.voices[0].stem ?? 'none', at.measure === 0 ? 'up' : 'none', `${label}: voice-1 extras kept`);
    ok(out[1] === s.tracks[0].measures[1], `${label}: untouched measure shared`);
    ok(sanitizeScore(p.score) === p.score, `${label}: sanitize-stable`);
    ok(J(target.voices[0].beats) !== J(old.voices[0].beats), `${label}: voice 1 did change`);
  }
});
test('C8: the same commands through the real key table leave voice 2 (and its identity) alone', () => {
  const p = play(voiceScore(), { at: cur(0, 0, 2) });
  p.go('5', 'ArrowRight', 'r', 'ArrowLeft', '+', '.', '/', CTRL('Delete'), 'Insert', 'l');
  ok(p.score !== p.start);
  ok(p.score.tracks[0].measures[0].voices[1] === p.start.tracks[0].measures[0].voices[1]);
  eq(p.score.tracks[0].measures[0].voices[1], v2obj());
});
test('C8: voices[0] without beats is created on the first edit; voice 2 is kept; measure.beats is not created', () => {
  const p = play(sc(tab([{ voices: [{}, { beats: [nt('whole', 3, 3)] }] }]))).key('4');
  eq(p.score.tracks[0].measures[0].voices[0].beats, [nt('quarter', 1, 4)]);
  ok(p.score.tracks[0].measures[0].voices[1] === p.start.tracks[0].measures[0].voices[1]);
  ok(!('beats' in p.score.tracks[0].measures[0]));
});
test('C8 / E10: insert / delete measure keep every other two-voice measure (and its voice 2) by reference; a deleted two-voice measure takes its voices along', () => {
  const ms = (p) => p.score.tracks[0].measures;
  const ins = play(voiceScore(), { at: cur(0, 0, 0) }).key('m');
  const s = ins.start.tracks[0].measures;
  eq(ms(ins).length, 5);
  ok(ms(ins)[0] === s[0] && ms(ins)[3] === s[2], 'two-voice measures shared');
  eq(ms(ins)[1], { beats: [] }, 'the inserted measure is a plain empty one');
  const insB = play(voiceScore(), { at: cur(0, 2, 0) }).key('M', { shiftKey: true });
  ok(ms(insB)[3] === insB.start.tracks[0].measures[2] && ms(insB)[0] === insB.start.tracks[0].measures[0]);
  const del = play(voiceScore(), { at: cur(0, 0, 0) }).key('Delete', { shiftKey: true });
  eq(ms(del).length, 3);
  ok(ms(del)[0] === del.start.tracks[0].measures[1] && ms(del)[1] === del.start.tracks[0].measures[2], 'later measures shared');
  ok(!J(del.score).includes('"stem":"down"'), 'voice 2 of the deleted measure is gone');
  const del2 = play(voiceScore(), { at: cur(0, 2, 0) }).key('Delete', { shiftKey: true });
  ok(ms(del2)[0] === del2.start.tracks[0].measures[0], 'deleting a later measure leaves the first alone');
});
test('C8: deleting the only (two-voice) measure empties it: voices and measure.beats go, signature keys stay', () => {
  const p = play(sc(tab([{ timeSignature: { beats: 3, beatType: 4 }, clef: 'bass', keySignature: 2, voices: [{ beats: [nt('half')] }, { beats: [nt('half')] }] }]))).key('Delete', { shiftKey: true });
  eq(p.score.tracks[0].measures, [{ timeSignature: { beats: 3, beatType: 4 }, clef: 'bass', keySignature: 2, beats: [] }]);
});
test('C8: tie into a two-voice measure uses voice 1 only (voice 2 notes on the same string are not partners)', () => {
  const p = play(sc(tab([
    { voices: [{ beats: [tn('whole', 1, 5)] }, { beats: [nt('whole', 1, 9)] }] },
    { voices: [{ beats: [tn('whole', 1, 0)] }, { beats: [nt('whole', 1, 9)] }] },
  ])), { at: cur(0, 1, 0, 1) }).key('l');
  eq(p.score.tracks[0].measures[0].voices[0].beats[0].notes[0], { string: 1, fret: 5, tieStart: true });
  eq(p.score.tracks[0].measures[1].voices[0].beats[0].notes[0], { string: 1, fret: 5, tieEnd: true });
  ok(p.score.tracks[0].measures[1].voices[1] === p.start.tracks[0].measures[1].voices[1]);
  ok(p.score.tracks[0].measures[0].voices[1] === p.start.tracks[0].measures[0].voices[1]);
});

// ---------- C2 / E6 / E8: graces and hidden rests ----------
const graced = () => sc(tab([{ beats: [tn('quarter', 1, 1), grace(), grace(3, 4), tn('quarter', 1, 2), nt('quarter', 1, 3), grace(1, 9), nt('quarter', 1, 4)] }]));
test('E8: Insert puts the rest before the cursor beat AND all its leading graces; the graces stay attached to the old beat; cursor on the new rest', () => {
  const p = play(graced(), { at: cur(0, 0, 3) }).key('Insert');
  eq(p.beats().map((b) => b.type), ['note', 'rest', 'grace', 'grace', 'note', 'note', 'grace', 'note']);
  eq(p.cursor, cur(0, 0, 1));
  const q = play(graced(), { at: cur(0, 0, 6) }).key('i');
  eq(q.beats().map((b) => b.type), ['note', 'grace', 'grace', 'note', 'note', 'rest', 'grace', 'note'], 'before the single grace of beat 6');
  eq(q.cursor, cur(0, 0, 5));
  const first = play(graced(), { at: cur(0, 0, 0) }).key('Insert');
  eq(first.beats().map((b) => b.type).slice(0, 3), ['rest', 'note', 'grace']);
});
test('E8: Insert on the append slot goes before the trailing graces; in an empty measure it makes the first beat', () => {
  const p = play(sc(tab([{ beats: [nt('quarter'), grace(), grace()] }])), { at: cur(0, 0, 3) }).key('Insert');
  eq(p.beats().map((b) => b.type), ['note', 'rest', 'grace', 'grace']);
  eq(p.cursor, cur(0, 0, 1));
  const e = play(sc(tab([{ beats: [] }]))).key('Insert');
  eq([e.beats(), e.cursor], [[rest('quarter')], cur(0, 0, 0)]);
});
test('E6: Delete beat removes the cursor beat with its leading graces only; other graces and the following beats keep identity', () => {
  const s = graced();
  const p = play(s, { at: cur(0, 0, 3) }).key('Delete', { ctrlKey: true });
  eq(p.beats().map((b) => b.type), ['note', 'note', 'grace', 'note']);
  ok(p.beats()[1] === p.start.tracks[0].measures[0].beats[4] && p.beats()[2] === p.start.tracks[0].measures[0].beats[5], 'later beats and their grace shared');
  eq(p.cursor, cur(0, 0, 1), 'cursor on the beat that took its place');
  const q = play(s, { at: cur(0, 0, 6) }).key('Backspace', { ctrlKey: true });
  eq(q.beats().map((b) => b.type), ['note', 'grace', 'grace', 'note', 'note']);
  eq(q.cursor, cur(0, 0, 5), 'append slot of the now underfull measure');
  const first = play(s, { at: cur(0, 0, 0) }).key('Delete', { ctrlKey: true });
  eq(first.beats().map((b) => b.type), ['grace', 'grace', 'note', 'note', 'grace', 'note'], 'the graces after beat 0 belong to beat 3');
  eq(first.cursor, cur(0, 0, 2), 'cursor skips the now leading graces');
  ok(first.last.changed && sanitizeScore(first.score) === first.score);
});
test('E6: deleting a beat repairs a tie across the gap and across graces (tie halves removed)', () => {
  const s = sc(tab([{ beats: [tn('quarter', 1, 5, { tieStart: true }), grace(), tn('quarter', 1, 5, { tieEnd: true }), nt('half', 1, 5)] }]));
  const p = play(s, { at: cur(0, 0, 2) }).key('Delete', { ctrlKey: true });
  eq(p.beats().map((b) => b.notes?.[0]?.tieStart ?? b.notes?.[0]?.tieEnd ?? false), [false, false], 'no half tie is left');
  const q = play(s, { at: cur(0, 0, 0) }).key('Delete', { ctrlKey: true });
  eq(q.beats()[1].notes[0].tieEnd, undefined);
  const ins = play(s, { at: cur(0, 0, 2) }).key('Insert');
  eq(ins.beats().filter((b) => b.notes?.some((n) => n.tieStart || n.tieEnd)).length, 0, 'a rest inserted inside a tie breaks it');
});
test('E8: a rest inserted between two NON-tied beats leaves every flag alone; inserting before a tied pair start keeps the pair', () => {
  const s = sc(tab([{ beats: [tn('quarter', 1, 5, { tieStart: true }), tn('quarter', 1, 5, { tieEnd: true }), nt('half')] }]));
  const p = play(s, { at: cur(0, 0, 0) }).key('Insert');
  eq([p.beats()[1].notes[0].tieStart, p.beats()[2].notes[0].tieEnd], [true, true]);
});
test('C2: cursor navigation skips graces but visits hidden rests; fill counts hidden rests, not graces', () => {
  const s = sc(tab([{ beats: [nt('quarter'), grace(), hid(), grace(), hid('8th')] }]));
  const p = play(s);
  const seen = [p.cursor.beat];
  for (let i = 0; i < 5; i++) { p.key('ArrowRight'); seen.push(p.cursor.beat); }
  eq(seen, [0, 2, 4, 5, 5, 5], 'quarter, hidden quarter, hidden 8th, then the (underfull) slot at index 5');
  eq(p.fill(), 'under');
  eq(play(sc(tab([{ beats: [nt('quarter'), grace(), hid('half'), hid()] }]))).fill(), 'full');
  eq(play(sc(tab([{ beats: [nt('quarter'), grace(), hid('half'), hid()] }]))).key('End').cursor, cur(0, 0, 3), 'full: End stops on the last beat');
});
test('E1 / E5 / E6 / R on hidden rests: digit and R make a visible note, Delete says no note, Delete beat removes it, duration keeps hidden', () => {
  const s = sc(tab([{ beats: [hid('half', { dynamic: 'p' }), nt('half')] }]));
  const d = play(s).key('5');
  eq(d.beats()[0], { type: 'note', duration: 'half', dynamic: 'p', notes: [{ string: 1, fret: 5 }] }, 'hidden dropped, other fields kept');
  const r = play(s).key('r');
  eq(r.beats()[0], { type: 'note', duration: 'half', dynamic: 'p', notes: [{ string: 1, fret: 0 }] });
  const del = play(s).key('Delete');
  eq([del.last.changed, del.announce.id], [false, 'noNote']);
  const sh = play(s).key('+');
  eq(sh.beats()[0], { type: 'rest', duration: 'quarter', hidden: true, dynamic: 'p' }, 'duration changes keep hidden');
  eq(play(s).key('Delete', { ctrlKey: true }).beats().length, 1);
  const tie = play(sc(tab([{ beats: [hid('half'), nt('half', 1, 3)] }])), { at: cur(0, 0, 1) }).key('l');
  eq([tie.last.changed, tie.announce.id], [false, 'nothingToTie'], 'a hidden rest is not a tie partner');
});

// ---------- E7: ties across barlines, deleted and inserted measures ----------
const tieAcross = () => sc(tab([
  { beats: [tn('whole', 1, 5, { tieStart: true })] },
  { beats: [tn('whole', 1, 5, { tieEnd: true, tieStart: true })] },
  { beats: [tn('whole', 1, 5, { tieEnd: true })] },
  { beats: [nt('whole', 1, 7)] },
]));
const flags = (s, ti = 0) => s.tracks[ti].measures.map((m) => A.beatsOf(m).flatMap((b) => (b.notes || []).map((n) => `${n.tieEnd ? '<' : ''}${n.fret}${n.tieStart ? '>' : ''}`)).join(','));
test('E7: a tie chain across barlines: deleting the middle measure re-pairs its neighbours (same fret) and never leaves a half tie', () => {
  eq(flags(tieAcross()), ['5>', '<5>', '<5', '7']);
  const p = play(tieAcross(), { at: cur(0, 1, 0) }).key('Delete', { shiftKey: true });
  eq(flags(p.score), ['5>', '<5', '7']);
  eq(tieErrors(p.score), []);
});
test('E7: delete the first / last measure of a chain, delete after the chain, insert a measure inside the tie (before and after)', () => {
  eq(flags(play(tieAcross(), { at: cur(0, 0, 0) }).key('Delete', { shiftKey: true }).score), ['5>', '<5', '7'], 'chain start removed: the first half-tie flag went with it, the rest stays paired');
  eq(flags(play(tieAcross(), { at: cur(0, 2, 0) }).key('Delete', { shiftKey: true }).score), ['5>', '<5', '7'], 'chain end removed: the previous note loses its dangling tieStart');
  eq(flags(play(tieAcross(), { at: cur(0, 1, 0) }).key('m').score), ['5>', '<5', '', '5', '7'], 'insert after the middle measure');
  eq(flags(play(tieAcross(), { at: cur(0, 1, 0) }).key('M', { shiftKey: true }).score), ['5', '', '5>', '<5', '7'], 'insert before the middle measure');
  eq(flags(play(tieAcross(), { at: cur(0, 3, 0) }).key('Delete', { shiftKey: true }).score), ['5>', '<5>', '<5'], 'deleting after the chain changes nothing');
});
test('E7: ties are fixed in every track a column command touches', () => {
  const t = () => tab([{ beats: [tn('whole', 2, 3, { tieStart: true })] }, { beats: [tn('whole', 2, 3, { tieEnd: true })] }]);
  const s = sc(t(), t(), tabOnly([{ beats: [tn('whole', 2, 3, { tieStart: true })] }, { beats: [tn('whole', 2, 3, { tieEnd: true })] }]));
  for (const k of [['m'], ['Delete', { shiftKey: true }]]) {
    const at = k[0] === 'm' ? cur(0, 0, 0) : cur(0, 1, 0);
    const p = play(s, { at }).key(k[0], k[1]);
    for (let ti = 0; ti < 3; ti++) ok(!flags(p.score, ti).some((f) => f.includes('<') || f.includes('>')), `track ${ti} after ${k[0]}: ${flags(p.score, ti)}`);
  }
});
test('E7: L on a string with a chord only ties that string; deleting a note unties only its own partners; other strings keep their ties', () => {
  const s = sc(tab([{ beats: [{ type: 'note', duration: 'half', notes: [{ string: 1, fret: 3 }, { string: 2, fret: 5 }] }, { type: 'note', duration: 'half', notes: [{ string: 1, fret: 0 }, { string: 2, fret: 0 }] }] }]));
  const p = play(s, { at: cur(0, 0, 1, 1) }).key('l').key('ArrowDown').key('l');
  eq(p.beats()[1].notes, [{ string: 1, fret: 3, tieEnd: true }, { string: 2, fret: 5, tieEnd: true }]);
  eq(p.beats()[0].notes.map((n) => n.tieStart), [true, true]);
  const d = play(p.score, { at: cur(0, 0, 1, 1) }).key('Delete');
  eq(d.beats()[0].notes, [{ string: 1, fret: 3 }, { string: 2, fret: 5, tieStart: true }], 'string 1 partner untied, string 2 tie intact');
  eq(d.beats()[1].notes, [{ string: 2, fret: 5, tieEnd: true }]);
  const u = play(p.score, { at: cur(0, 0, 1, 2) }).key('l');
  eq(u.beats()[0].notes.map((n) => n.tieStart ?? false), [true, false]);
});
test('E7: L right after a re-fret / delete / R / duration change: the model never keeps a half tie', () => {
  const s = sc(tab([{ beats: [tn('half', 1, 5, { tieStart: true }), tn('half', 1, 5, { tieEnd: true })] }, { beats: [nt('whole', 1, 5)] }]));
  const at = (b) => cur(0, 0, b, 1);
  const half = (x) => flags(x.score);
  eq(half(play(s, { at: at(1) }).key('7')), ['5,7', '5']);
  eq(half(play(s, { at: at(0) }).key('7')), ['7,5', '5']);
  eq(half(play(s, { at: at(0) }).key('r')), ['5', '5']);
  eq(play(s, { at: at(1) }).key('r').beats()[1], rest('half'));
  eq(half(play(s, { at: at(1) }).key('5')), ['5>,<5', '5'], 'same fret again keeps the tie');
  eq(half(play(s, { at: at(1) }).key('+')), ['5>,<5', '5'], 'duration changes keep the tie');
  eq(half(play(s, { at: at(0) }).key('Delete')), ['5', '5'], 'deleting the start note removes the end flag');
  eq(half(play(s, { at: at(1) }).key('Delete')), ['5', '5'], 'deleting the end note removes the start flag');
  eq(half(play(s, { at: at(1) }).key('l')), ['5,5', '5'], 'L on a tied note removes both flags');
});
test('E7: L toggles off the tie of a note whose previous beat was meanwhile replaced; L with no partner on the string announces "nothingToTie" and changes nothing', () => {
  const s = sc(tab([{ beats: [nt('half', 2, 5), nt('half', 1, 3)] }]));
  const p = play(s, { at: cur(0, 0, 1, 1) }).key('l');
  eq([p.last.changed, p.announce.id], [false, 'nothingToTie']);
  const first = play(s, { at: cur(0, 0, 0, 2) }).key('l');
  eq([first.last.changed, first.announce.id], [false, 'nothingToTie'], 'start of score');
  const onRest = play(sc(tab([{ beats: [nt('half'), rest('half')] }])), { at: cur(0, 0, 1) }).key('l');
  eq(onRest.announce.id, 'noNoteHere');
  const noFret = play(sc(tab([{ beats: [{ type: 'note', duration: 'half', notes: [{ string: 1, pitch: 'E4' }] }, nt('half', 1, 2)] }])), { at: cur(0, 0, 1) }).key('l');
  eq(noFret.announce.id, 'nothingToTie', 'a partner needs a fret');
});
test('E7: L copies the fret, drops pitch on the cursor note and breaks a tie that continued with another fret', () => {
  const s = sc(tab([{ beats: [nt('quarter', 1, 5), { type: 'note', duration: 'quarter', notes: [{ string: 1, fret: 2, pitch: 'F#4', tieStart: true }] }, tn('quarter', 1, 2, { tieEnd: true })] }]));
  const p = play(s, { at: cur(0, 0, 1) }).key('l');
  eq(p.beats()[1].notes[0], { string: 1, fret: 5, tieEnd: true }, 'tieStart of the old chain removed because the fret changed');
  eq(p.beats()[2].notes[0], { string: 1, fret: 2 });
  ok(sanitizeScore(p.score) === p.score);
});

// ---------- E9: delete only measure, carry-forward ----------
test('E9: deleting the only measure keeps time / key / clef in every track and empties the beats; repeated deletes are no-ops', () => {
  const s = sc(
    tab([{ timeSignature: { beats: 3, beatType: 4 }, keySignature: -2, clef: 'bass', beats: [nt('half'), nt('quarter')], ending: 1, segno: true }]),
    notation([{ beats: [nt('whole')] }]),
    hidden([{ timeSignature: { beats: 2, beatType: 4 }, beats: [] }]),
  );
  const p = play(s).key('Delete', { shiftKey: true });
  eq(p.score.tracks[0].measures, [{ timeSignature: { beats: 3, beatType: 4 }, keySignature: -2, clef: 'bass', beats: [] }]);
  eq(p.score.tracks[1].measures, [{ beats: [] }]);
  ok(p.score.tracks[2] === io.parseInput(s).tracks[2] || J(p.score.tracks[2]) === J(io.parseInput(s).tracks[2]));
  eq([p.cursor, p.announce.id], [cur(0, 0, 0), 'measureCleared']);
  const again = play(p.score).key('Delete', { shiftKey: true });
  eq([again.last.changed, J(again.score)], [false, J(p.score)]);
  ok(sanitizeScore(p.score) === p.score);
});
test('E9: carry-forward of time / key / clef when deleting a measure that sets them (first, middle, with own settings on the next, over holes)', () => {
  const s = () => sc(tab([
    { timeSignature: { beats: 3, beatType: 4 }, keySignature: 2, clef: 'bass', beats: [] },
    { beats: [] },
    { keySignature: 5, beats: [] },
    { timeSignature: { beats: 6, beatType: 8 }, beats: [] },
  ]));
  const a = play(s(), { at: cur(0, 0, 0) }).key('Delete', { shiftKey: true });
  eq(a.score.tracks[0].measures[0], { beats: [], timeSignature: { beats: 3, beatType: 4 }, keySignature: 2, clef: 'bass' });
  eq(a.fill(), 'under');
  const b = play(s(), { at: cur(0, 2, 0) }).key('Delete', { shiftKey: true });
  eq(b.score.tracks[0].measures[2], { timeSignature: { beats: 6, beatType: 8 }, beats: [], keySignature: 5 }, 'next had its own time: only key carried');
  const c = play(s(), { at: cur(0, 3, 0) }).key('Delete', { shiftKey: true });
  eq(c.score.tracks[0].measures.length, 3, 'last measure: nothing to carry to');
  const holes = play(sc(tab([{ keySignature: 3, beats: [] }, null, { beats: [] }])), { at: cur(0, 0, 0) }).key('Delete', { shiftKey: true });
  eq(holes.score.tracks[0].measures[0], { beats: [], keySignature: 3 }, 'a hole is materialized to receive the carried key');
  ok([a, b, c, holes].every((x) => sanitizeScore(x.score) === x.score));
});
test('E9: the fill of the measures after a deleted time-signature measure does not change (the signature is carried, not lost)', () => {
  const s = sc(tab([
    { timeSignature: { beats: 3, beatType: 4 }, beats: [nt('quarter'), nt('quarter'), nt('quarter')] },
    { beats: [nt('quarter'), nt('quarter'), nt('quarter')] },
    { beats: [nt('quarter'), nt('quarter'), nt('quarter')] },
  ]));
  const p = play(s, { at: cur(0, 0, 0) });
  eq([0, 1, 2].map((m) => p.fill(0, m)), ['full', 'full', 'full']);
  p.key('Delete', { shiftKey: true });
  eq([0, 1].map((m) => p.fill(0, m)), ['full', 'full']);
});
test('E9: measure commands pad short tracks lazily, include hidden tracks, and keep every track the same length after insert', () => {
  const s = sc(tab([{ beats: [nt('whole')] }, { beats: [nt('whole')] }, { beats: [nt('whole')] }]), tab([{ beats: [nt('whole')] }]), hidden([{ beats: [] }, { beats: [] }]));
  const p = play(s, { at: cur(0, 1, 0) }).key('m');
  eq(p.score.tracks.map((t) => t.measures.length), [4, 3, 3]);
  const q = play(s, { at: cur(0, 2, 0) }).key('Delete', { shiftKey: true });
  eq(q.score.tracks.map((t) => t.measures.length), [2, 1, 2], 'a track without that measure is untouched, hidden tracks lose it too');
  ok(q.score.tracks[1] === io.parseInput(s).tracks[1] || J(q.score.tracks[1]) === J(io.parseInput(s).tracks[1]));
});

// ---------- fill transitions (E4, G4) ----------
test('E4 / G4: under -> full -> over -> full -> under through entry, duration, dots, triplet, insert and delete; neighbours never reflow', () => {
  const p = play(sc(tab([{ beats: [] }, { beats: [nt('whole', 1, 9)] }])));
  const seen = [];
  const note = () => seen.push(p.fill());
  p.key('5'); note();
  p.go('ArrowRight', '5', 'ArrowRight', '5'); note();
  p.go('ArrowRight', '5'); note();
  eq(seen, ['under', 'under', 'full']);
  p.go('Home', '-'); note();
  p.key('+'); note();
  p.go('.'); note();
  p.key('.'); note();
  p.key('.'); note();
  eq(seen.slice(3), ['over', 'full', 'over', 'over', 'full']);
  p.go('Insert'); note();
  p.go(CTRL('Delete')); note();
  p.go('ArrowRight', CTRL('Delete')); note();
  eq(seen.slice(8), ['over', 'full', 'under']);
  eq(J(p.beats(0, 1)), J([nt('whole', 1, 9)]), 'the next measure never moves');
  p.go('ArrowLeft', '/'); note();
  eq(p.beats()[0].tuplet, 3);
  eq(seen.slice(-1), ['under']);
});
test('E4: three triplet eighths fill exactly a quarter; the measure is full with 4 such groups of a quarter (exact rationals, no float drift)', () => {
  const trip = (n) => Array.from({ length: n }, () => nt('8th', 1, 0, { tuplet: 3 }));
  eq(play(sc(tab([{ beats: [...trip(3), nt('half'), nt('quarter')] }]))).fill(), 'full');
  eq(play(sc(tab([{ beats: [...trip(12)] }]))).fill(), 'full');
  eq(play(sc(tab([{ beats: [...trip(11)] }]))).fill(), 'under');
  eq(play(sc(tab([{ beats: [...trip(13)] }]))).fill(), 'over');
  const dotted = play(sc(tab([{ beats: [nt('half', 1, 0, { dots: 1 }), nt('quarter')] }])));
  eq(dotted.fill(), 'full');
  eq(play(sc(tab([{ beats: [nt('half', 1, 0, { dots: 2 }), nt('8th')] }]))).fill(), 'full', 'double-dotted half 7/8 + 1/8');
  eq(play(sc(tab([{ beats: [nt('half', 1, 0, { dots: 2 }), nt('quarter')] }]))).fill(), 'over');
});
test('E4: fill with measure time signatures (3/4, 6/8, 2/2-like, carry-forward) and in tracks with their own signature', () => {
  const s = sc(tab([
    { timeSignature: { beats: 6, beatType: 8 }, beats: Array.from({ length: 6 }, () => nt('8th')) },
    { beats: Array.from({ length: 6 }, () => nt('8th')) },
    { timeSignature: { beats: 2, beatType: 2 }, beats: [nt('half'), nt('half')] },
    { timeSignature: { beats: 3, beatType: 4 }, beats: [nt('half'), nt('half')] },
  ]), tab([{ beats: [nt('whole')] }], { timeSignature: { beats: 3, beatType: 4 } }));
  const p = play(s);
  eq([0, 1, 2, 3].map((m) => p.fill(0, m)), ['full', 'full', 'full', 'over']);
  eq(p.fill(1, 0), 'over');
  eq(F.fillTable(p.score).map((r) => r.join()), ['full,full,full,over', 'over,empty,empty,empty']);
});
test('E4: Right from the last beat of a FULL measure goes to the next measure, never to the slot; from an overfull measure too', () => {
  const s = sc(tab([{ beats: [nt('half'), nt('half')] }, { beats: [nt('whole'), nt('quarter')] }, { beats: [] }]));
  const p = play(s, { at: cur(0, 0, 1) }).key('ArrowRight');
  eq(p.cursor, cur(0, 1, 0));
  p.go('ArrowRight', 'ArrowRight');
  eq(p.cursor, cur(0, 2, 0));
  p.key('ArrowLeft');
  eq(p.cursor, cur(0, 1, 1), 'Left mirrors it: into the last beat of the overfull measure');
  eq(play(s, { at: cur(0, 1, 1) }).key('End').cursor, cur(0, 1, 1));
});

// ---------- C4 appending, C3 empty ----------
test('C4: Right at the end of the last measure appends one empty measure per press only when the measure is full (never from an empty or underfull one)', () => {
  const p = play(sc(tab([{ beats: [nt('whole')] }])));
  p.key('ArrowRight');
  eq([p.score.tracks[0].measures.length, p.cursor, p.last.changed, p.announce], [2, cur(0, 1, 0), true, { id: 'measureAdded', n: 2 }]);
  p.key('ArrowRight');
  eq([p.score.tracks[0].measures.length, p.last.changed, p.announce.id], [2, false, 'endOfScore'], 'empty last measure: end of score');
  p.go('+', '+', '5');
  eq(p.beats(0, 1), [nt('quarter', 1, 5)], 'the current duration is the whole note from beat 0 until shortened');
  p.key('ArrowRight');
  eq(p.cursor, cur(0, 1, 1), 'underfull: to the slot');
  p.key('ArrowRight');
  eq([p.score.tracks[0].measures.length, p.announce.id], [2, 'endOfScore']);
  const ro = play(sc(tab([{ beats: [nt('whole')] }])), { append: false }).key('ArrowRight');
  eq([ro.score.tracks[0].measures.length, ro.last.changed, ro.announce.id], [1, false, 'endOfScore']);
});
test('C4: appending pads every track (including notation-only and hidden ones) to the new column', () => {
  const p = play(sc(tab([{ beats: [nt('whole')] }]), notation([{ beats: [nt('whole')] }]), hidden()), { at: cur(0, 0, 0) }).key('ArrowRight');
  eq(p.score.tracks.map((t) => t.measures.length), [2, 2, 2]);
});
test('C3: an empty measure has one position (beat 0, the slot); every navigation key keeps it there; edits that need a beat are refused', () => {
  const p = play(sc(tab([{ beats: [] }, { beats: [] }])));
  eq(C.positions(p.score, { track: 0, measure: 0 }), [0]);
  for (const k of ['ArrowLeft', 'Home', 'End', 'ArrowUp']) { p.key(k); eq(p.cursor.beat, 0, k); }
  for (const [k, id] of [['Delete', 'noNote'], [CTRL('Delete'), 'noBeat'], ['/', 'noBeat'], ['l', 'noNoteHere']]) {
    p.go(k);
    eq([p.last.changed, p.announce.id], [false, id], String(k));
  }
  p.key('+'); p.key('.');
  eq([p.last.changed, p.state.duration, p.state.dots], [false, '8th', 1], '+/. on the slot change the state only');
  p.key('5');
  eq(p.beats()[0], nt('8th', 1, 5, { dots: 1 }), 'the next beat uses the current duration and dots');
});

// ---------- E6 cursor clamp ----------
test('E6: deleting beats down to nothing: cursor clamped each time, the measure ends as beats: [], then Right goes on', () => {
  const p = play(sc(tab([{ beats: [nt('quarter'), nt('quarter'), nt('half')] }, { beats: [nt('whole')] }])), { at: cur(0, 0, 2) });
  p.key('Delete', { ctrlKey: true });
  eq([p.beats().length, p.cursor], [2, cur(0, 0, 2)]);
  p.key('Delete', { ctrlKey: true });
  eq(p.last.announce.id, 'noBeat', 'on the slot: nothing happens');
  p.go('ArrowLeft', CTRL('Delete'));
  eq([p.beats().length, p.cursor], [1, cur(0, 0, 1)]);
  p.go('ArrowLeft', CTRL('Delete'));
  eq([p.score.tracks[0].measures[0], p.cursor], [{ beats: [] }, cur(0, 0, 0)]);
  p.key('ArrowRight');
  eq(p.cursor, cur(0, 1, 0));
});

// ---------- C5 / C6 / C7 / C10: tracks of every kind ----------
test('C5: PageDown / PageUp across different time signatures, triplets, dotted notes and graces pick the nearest onset (ties earlier)', () => {
  const s = sc(
    tab([{ beats: [nt('8th', 1, 1, { tuplet: 3 }), nt('8th', 1, 1, { tuplet: 3 }), nt('8th', 1, 1, { tuplet: 3 }), grace(), nt('half', 1, 1, { dots: 1 })] }]),
    tab([{ beats: [nt('quarter'), nt('quarter')] }], { timeSignature: { beats: 3, beatType: 4 } }),
    tab([{ beats: [nt('16th'), nt('16th'), nt('8th'), nt('quarter'), nt('half')] }]),
  );
  const down = (b) => { const p = play(s, { at: cur(0, 0, b) }); return p.key('PageDown').cursor.beat; };
  eq([0, 1, 2, 4].map(down), [0, 0, 1, 1], 'onsets 0, 1/12, 1/6, 1/4 against 0, 1/4, 1/2');
  const twice = (b) => play(s, { at: cur(0, 0, b) }).go('PageDown', 'PageDown').cursor;
  eq(twice(4), cur(2, 0, 3), 'onset 1/4 on the third track is the quarter');
  const up = (b) => play(s, { at: cur(2, 0, b) }).key('PageUp').cursor.beat;
  eq([0, 1, 2, 3, 4].map(up), [0, 0, 0, 1, 2], 'onsets 0, 1/16, 1/8 (tie between 0 and 1/4: the earlier), 1/4, 1/2 (the append slot of the underfull 3/4 measure)');
  const slot = play(s, { at: cur(1, 0, 2) }).key('PageDown');
  eq(slot.cursor, cur(2, 0, 4), 'append slot onset 1/2 -> the beat at onset 1/2 in the next track');
});
test('C5: PageDown to a track with no such measure (a hole) lands on its empty position; string clamped to the new tuning', () => {
  const s = sc(tab([{ beats: [nt('whole')] }, { beats: [nt('whole')] }]), tabOnly([{ beats: [nt('whole')] }], { tuning: ['E1', 'A1', 'D2', 'G2'] }));
  const p = play(s, { at: cur(0, 1, 0, 6) }).key('PageDown');
  eq(p.cursor, cur(1, 1, 0, 4));
  eq(p.score, io.parseInput(s), 'moving does not pad the short track');
  p.key('5');
  eq(p.score.tracks[1].measures.length, 2, 'padded on the first write');
});
test('C10: hidden tracks are skipped by PageUp/PageDown, never hold the cursor, and the first/last visible track reports the edge', () => {
  const s = sc(hidden(), notation([{ beats: [nt('whole')] }]), hidden(), tab([{ beats: [nt('whole')] }]), hidden());
  const p = play(s);
  eq(p.cursor.track, 1, 'the start clamps to the first visible track');
  p.key('PageDown'); eq(p.cursor.track, 3);
  p.key('PageDown'); eq([p.cursor.track, p.announce.id], [3, 'lastTrack']);
  p.go('PageUp', 'PageUp'); eq([p.cursor.track, p.announce.id], [1, 'firstTrack']);
  eq(C.clampCursor(p.score, cur(2, 0, 0)).track, 1, 'hidden track -> nearest visible, lower first');
  eq(C.clampCursor(p.score, cur(4, 0, 0)).track, 3);
  eq(C.clampCursor(p.score, cur(0, 0, 0)).track, 1);
});
test('C10: no visible track at all: every command is a no-op that announces "noTrack"; nothing throws', () => {
  for (const s of [sc(hidden(), hidden()), { tracks: [] }, {}]) {
    const model = io.parseInput(s);
    for (const name of Object.keys(COMMANDS).filter((n) => COMMANDS[n].fn)) {
      const r = run(name, model, cur(0, 0, 0), ST(), { maxFret: 24, now: 0, twoDigitDelayMs: 800, allowAppend: true }, name === 'digit' ? 5 : name === 'setDuration' ? 'half' : undefined);
      eq([r.changed, r.moved, r.announce.id, r.score === model], [false, false, 'noTrack', true], name);
    }
  }
});
test('C6: a notation-only track allows every beat-level command, has no string movement, refuses digits / note edits / ties with the right message', () => {
  const s = sc(notation([{ beats: [{ type: 'note', duration: 'quarter', notes: [{ pitch: 'C4' }, { pitch: 'E4' }] }, rest('quarter'), nt('half', 1, 0, { pitch: 'G4' })] }, { beats: [] }]));
  const p = play(s);
  const before = p.score;
  p.key('ArrowDown'); eq([p.cursor.string, p.last.changed, p.last.moved], [1, false, false]);
  p.key('ArrowUp'); eq(p.cursor.string, 1);
  for (const d of ['0', '5', '9']) { p.key(d); eq([p.announce.id, p.score === before], ['refusedNoTab', true], d); }
  p.key('Delete'); eq([p.announce.id, p.score === before], ['needsTab', true]);
  p.key('l'); eq([p.announce.id, p.score === before], ['needsTab', true]);
  p.go('ArrowRight', 'r');
  eq([p.last.changed, p.announce.id, p.beats()[1].type], [false, 'refusedNoTab', 'rest'], 'rest -> note needs a string');
  p.go('ArrowLeft', 'r');
  eq(p.beats()[0], rest('quarter'), 'note -> rest works (chord notes all removed)');
  p.go('+'); eq(p.beats()[0].duration, '8th');
  p.go('-', '-'); eq(p.beats()[0].duration, 'half');
  p.go('.'); eq(p.beats()[0].dots, 1);
  p.go('/'); eq(p.beats()[0].tuplet, 3);
  p.go('Insert'); eq(p.beats().length, 4);
  p.go('ArrowRight', CTRL('Delete')); eq(p.beats().length, 3);
  p.go('m', SHIFT('Delete'));
  eq(p.score.tracks[0].measures.length, 2);
  p.go(CTRL('ArrowLeft'), 'End', CTRL('End'), CTRL('Home'), 'PageDown');
  ok(sanitizeScore(p.score) === p.score);
  const info = C.cursorInfo(p.score, p.cursor, p.state);
  eq([info.hasTab, info.hasNotation, info.fret, info.tuningNote], [false, true, null, null]);
});
test('C7: a tab-only track works fully (digits, chords, ties, rests, durations, delete, insert, measures) and keeps notation off', () => {
  const p = play(sc(tabOnly([{ beats: [] }], { tuning: ['E1', 'A1', 'D2', 'G2', 'B2'] })));
  p.go('5', 'ArrowDown', '7', 'ArrowRight');
  eq(p.beats()[0].notes, [{ string: 1, fret: 5 }, { string: 2, fret: 7 }]);
  p.go('l');
  eq(p.announce.id, 'noNoteHere', 'the append slot has no note to tie');
  p.go('3');
  eq(p.cursor, cur(0, 0, 1, 2));
  p.go('ArrowLeft', 'ArrowUp', 'ArrowUp', 'ArrowUp');
  eq(p.cursor, cur(0, 0, 0, 1));
  for (let i = 0; i < 8; i++) p.key('ArrowDown');
  eq(p.cursor.string, 5, 'clamped to the 5-string tuning');
  p.go('9', 'r');
  eq(p.beats()[0].type, 'rest');
  p.go('r');
  eq(p.beats()[0].notes, [{ string: 5, fret: 0 }]);
  p.go('ArrowRight', 'l');
  eq(p.announce.id, 'noNoteHere', 'the cursor is on string 5 of the next beat, which has no note there');
  p.go('m', 'Delete');
  eq(p.score.tracks[0].measures.length, 2);
  eq(p.score.tracks[0].showStandardNotation, false);
  ok(sanitizeScore(p.score) === p.score);
});

// ---------- C9: current duration ----------
test('C9: moving onto a beat takes its duration and dots; the append slot and empty measures keep them; the default is a quarter', () => {
  const s = sc(tab([{ beats: [nt('half', 1, 1, { dots: 1 }), nt('8th', 1, 2, { tuplet: 3 })] }, { beats: [] }]));
  const p = play(s);
  eq(p.state, { duration: 'half', dots: 1, digit: null }, 'initial cursor beat');
  p.key('ArrowRight'); eq([p.state.duration, p.state.dots], ['8th', 0]);
  p.key('ArrowRight'); eq([p.state.duration, p.state.dots], ['8th', 0], 'slot keeps');
  p.go('+', '.');
  p.key('ArrowRight'); eq([p.state.duration, p.state.dots], ['16th', 1], 'empty measure keeps what the slot set');
  p.key('5'); eq(p.beats(0, 1)[0], nt('16th', 1, 5, { dots: 1 }));
  eq(play(sc(tab([{ beats: [] }]))).state, ST());
});

// ---------- E1 / E2: maxFret and two-digit logic ----------
const entry = (maxFret, seq, gaps = 100) => {
  const p = play(sc(tab([{ beats: [] }])), { maxFret });
  for (const k of seq) { p.key(k); p.wait(gaps); }
  return p;
};
test('E2: maxFret 24 two-digit logic: 12 and 24 combine, 25 / 30 replace with the second digit, 0 then n is n', () => {
  const fretOf = (seq, mf = 24) => entry(mf, seq).beats()[0]?.notes[0].fret;
  eq([fretOf(['1', '2']), fretOf(['2', '4']), fretOf(['2', '5']), fretOf(['3', '0']), fretOf(['0', '7']), fretOf(['1', '0']), fretOf(['1', '9']), fretOf(['2', '0'])], [12, 24, 5, 0, 7, 10, 19, 20]);
});
test('E2: maxFret 9 never combines (every second digit replaces); maxFret 0 only accepts 0; maxFret 99 combines everything', () => {
  const fretOf = (mf, seq) => entry(mf, seq).beats()[0]?.notes[0].fret;
  eq([fretOf(9, ['1', '2']), fretOf(9, ['9', '9']), fretOf(9, ['0', '5'])], [2, 9, 5]);
  eq([fretOf(0, ['0']), fretOf(0, ['0', '0'])], [0, 0]);
  const refused = entry(0, ['1']);
  eq([refused.beats().length, refused.announce], [0, { id: 'refusedMaxFret', max: 0 }]);
  eq([fretOf(99, ['9', '9']), fretOf(99, ['5', '0']), fretOf(99, ['1', '0'])], [99, 50, 10]);
  const nine = entry(9, ['9', '9']);
  eq(nine.beats().length, 1, 'a replace keeps one note on the string');
});
test('E2: maxFret 12 / 13 boundary; a refused digit clears the buffer; an unrefused digit above the previous buffer starts a new one', () => {
  const fretOf = (mf, seq) => entry(mf, seq).beats()[0]?.notes[0].fret;
  eq([fretOf(12, ['1', '2']), fretOf(12, ['1', '3']), fretOf(13, ['1', '3']), fretOf(12, ['9', '1', '2'])], [12, 3, 13, 12]);
  const p = entry(5, ['3', '9']);
  eq([p.beats()[0].notes[0].fret, p.state.digit], [3, null], 'refused 9 leaves fret 3 and no buffer');
  p.key('2');
  eq(p.beats()[0].notes[0].fret, 2, 'not combined with the 3 before the refusal');
});
test('E2: the delay boundary (<= twoDigitDelayMs combines, +1 ms replaces), a moved cursor or another command ends the buffer, a different string does not combine', () => {
  const mk = () => play(sc(tab([{ beats: [nt('whole', 1, 0)] }])), { delay: 800 });
  const a = mk().key('1').wait(800).key('2');
  eq(a.beats()[0].notes[0].fret, 12);
  const b = mk().key('1').wait(801).key('2');
  eq(b.beats()[0].notes[0].fret, 2);
  const c = mk().key('1').go('ArrowDown', 'ArrowUp').key('2');
  eq(c.beats()[0].notes[0].fret, 2, 'moving away and back ends the buffer');
  const d = mk().key('1').key('ArrowDown').key('2');
  eq(d.beats()[0].notes.map((n) => n.fret), [1, 2], 'second digit on another string is its own note');
  const e = mk().key('1').key('+').key('-').key('2');
  eq(e.beats()[0].notes[0].fret, 2, 'any other command ends it');
  const z = play(sc(tab([{ beats: [nt('whole', 1, 0)] }])), { delay: 0 }).key('1').wait(1).key('2');
  eq(z.beats()[0].notes[0].fret, 2, 'a zero delay combines only within the same millisecond');
  eq(play(sc(tab([{ beats: [nt('whole', 1, 0)] }])), { delay: 0 }).key('1').key('2').beats()[0].notes[0].fret, 12);
});
test('E2: a two-digit entry on a rest and on the append slot becomes ONE note; the coalesce flag is set only for the combining digit', () => {
  const p = play(sc(tab([{ beats: [rest('half')] }])));
  p.key('1');
  eq(p.last.coalesce, false);
  p.wait(10).key('2');
  eq([p.last.coalesce, p.beats().length, p.beats()[0].notes], [true, 1, [{ string: 1, fret: 12 }]]);
  p.wait(10).key('3');
  eq([p.last.coalesce, p.beats()[0].notes[0].fret], [false, 3], 'after a combined pair the next digit starts fresh');
});
test('E1: fret entry on every string of a 7-string and 4-string track writes string + fret only; Up/Down never leave the tuning', () => {
  for (const [tuning, n] of [[['B1', 'E2', 'A2', 'D3', 'G3', 'B3', 'E4'], 7], [['E1', 'A1', 'D2', 'G2'], 4]]) {
    const p = play(sc(tab([{ beats: [] }], { tuning })));
    for (let i = 0; i < n + 2; i++) p.key('ArrowDown');
    eq(p.cursor.string, n);
    for (let i = 0; i < n; i++) p.go(String(i % 10), 'ArrowUp');
    eq(p.beats()[0].notes.map((x) => x.string).sort(), Array.from({ length: n }, (_, i) => i + 1));
    ok(p.beats()[0].notes.every((x) => Object.keys(x).sort().join() === 'fret,string'), 'no pitch / soundingPitch / fromFret written');
  }
});
test('E3: fretting a note that had pitch, soundingPitch and fromFret removes pitch only on that note; E11: slash is dropped by a fret on a slash beat, kept by other edits', () => {
  const s = sc(tab([{ beats: [{ type: 'note', duration: 'quarter', slash: true, notes: [{ string: 1, fret: 2, pitch: 'F#4' }, { string: 2, fret: 3, pitch: 'D4' }] }, { type: 'note', duration: 'quarter', slash: true, notes: [{ string: 1, fret: 0 }] }] }]));
  const p = play(s).key('7');
  eq(p.beats()[0], { type: 'note', duration: 'quarter', notes: [{ string: 1, fret: 7 }, { string: 2, fret: 3, pitch: 'D4' }] });
  const q = play(s, { at: cur(0, 0, 1) }).go('+', '.');
  eq(q.beats()[1].slash, true, 'slash survives rhythm edits');
});

// ---------- E5 / E1 chords ----------
test('E5: deleting notes of a chord one by one: the beat stays a note until the last one, then a rest of the same duration with other fields kept', () => {
  const s = sc(tab([{ beats: [{ type: 'note', duration: '8th', dots: 1, dynamic: 'mf', notes: [{ string: 1, fret: 1 }, { string: 3, fret: 3 }] }] }]));
  const p = play(s).key('Delete');
  eq(p.beats()[0].notes, [{ string: 3, fret: 3 }]);
  p.key('Delete');
  eq([p.last.changed, p.announce.id], [false, 'noNote'], 'no note on string 1 any more');
  p.go('ArrowDown', 'ArrowDown', 'Backspace');
  eq(p.beats()[0], { type: 'rest', duration: '8th', dots: 1, dynamic: 'mf' });
  p.key('Delete');
  eq(p.last.changed, false);
});

// ---------- Shift+R/L/I etc. and key table through the model ----------
test('D: Delete and Backspace always delete the cursor note, even right after a digit (live buffer)', () => {
  for (const k of ['Delete', 'Backspace']) {
    const p = play(sc(tab([{ beats: [nt('whole', 1, 3)] }])));
    p.key('1');
    ok(p.state.digit, 'buffer live');
    p.key(k);
    eq([p.beats()[0].type, p.state.digit], ['rest', null], k);
  }
});

// ---------- model-wide invariants after random commands ----------
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const FUZZ = ['moveLeft', 'moveRight', 'moveRight', 'moveUp', 'moveDown', 'prevMeasure', 'nextMeasure', 'measureStart', 'measureEnd', 'scoreStart', 'scoreEnd', 'prevTrack', 'nextTrack',
  ...Array(8).fill('digit'), 'deleteNote', 'toggleTie', 'toggleTie', 'toggleTie', 'shorter', 'longer', 'cycleDots', 'toggleTriplet', 'toggleRest', 'toggleRest', 'deleteBeat', 'insertBeat',
  'insertMeasureAfter', 'insertMeasureBefore', 'deleteMeasure', 'setDuration',
  // 2.1 effects
  ...EFFECTS.map((d) => d.name)];
const fuzzStart = () => sc(
  tab([
    { beats: [tn('quarter', 1, 5, { tieStart: true }), tn('quarter', 1, 5, { tieEnd: true }), grace(), nt('half', 2, 3)] },
    { beats: [tn('whole', 1, 5, { tieStart: true })] },
    { beats: [tn('whole', 1, 5, { tieEnd: true })], timeSignature: { beats: 3, beatType: 4 } },
    { beats: [nt('quarter'), hid(), grace(), nt('half')], voices: [{ beats: [nt('quarter'), hid(), grace(), nt('half')] }, { beats: [nt('whole', 4, 4)], marker: 1 }] },
    { beats: [] },
  ]),
  notation([{ beats: [nt('whole')] }, { beats: [nt('half')] }]),
  tabOnly([{ beats: [nt('quarter', 4, 1)] }], { tuning: ['E1', 'A1', 'D2', 'G2'] }),
  hidden(),
);
const COLUMN = new Set(['insertMeasureAfter', 'insertMeasureBefore', 'deleteMeasure', 'moveRight']);
test('invariants: after 12 seeds x 500 random commands ties stay paired, voice 2 and measure.beats of two-voice measures are never touched, one note per string, frets within maxFret', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const rnd = mulberry32(seed * 7919);
    const maxFret = [24, 9, 99, 0][seed % 4];
    const p = play(fuzzStart(), { maxFret });
    for (let i = 0; i < 500; i++) {
      const name = FUZZ[Math.floor(rnd() * FUZZ.length)];
      p.wait(rnd() < 0.6 ? 100 : 1500);
      const before = p.score;
      const arg = name === 'digit' ? Math.floor(rnd() * 10) : name === 'setDuration' ? ['whole', 'half', 'quarter', '8th', '64th'][Math.floor(rnd() * 5)] : undefined;
      p.cmd(name, arg);
      const where = `seed ${seed} step ${i} ${name}`;
      ok(sanitizeScore(p.score) === p.score, `${where}: sanitize`);
      eq(tieErrors(p.score), [], where);
      ok(J(C.clampCursor(p.score, p.cursor)) === J(p.cursor), `${where}: cursor valid`);
      if (!COLUMN.has(name)) {
        const keep = (s) => J(s.tracks.flatMap((t, ti) => (t.measures || []).map((m, mi) => (m && m.voices ? [ti, mi, m.voices[1], m.beats] : null)).filter(Boolean)));
        eq(keep(p.score), keep(before), `${where}: voice 2`);
      }
      p.score.tracks.forEach((t) => (t.measures || []).forEach((m) => {
        if (!m) return;
        for (const v of [1, 2]) {
          for (const b of A.beatsOf(m, v)) {
            const strings = (b.notes || []).map((n) => n.string);
            eq(new Set(strings).size, strings.length, `${where}: one note per string`);
          }
        }
        for (const b of A.beatsOf(m)) for (const n of b.notes || []) if (n.fret != null) ok(n.fret >= 0 && n.fret <= 99 && Number.isInteger(n.fret), `${where}: fret ${n.fret}`);
      }));
    }
  }
});
test('invariants: entered frets never exceed maxFret (0, 9, 24, 99) and the editor never writes pitch, soundingPitch or fromFret', () => {
  for (const maxFret of [0, 9, 24, 99]) {
    const rnd = mulberry32(maxFret + 3);
    const p = play(sc(tab([{ beats: [] }], { tuning: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'] })), { maxFret });
    const keys = [...'0123456789'.split('').flatMap((d) => [d, d]), 'ArrowRight', 'ArrowDown', 'ArrowUp', 'r', 'Insert', 'm'];
    for (let i = 0; i < 800; i++) { p.wait(rnd() < 0.7 ? 100 : 900); p.key(keys[Math.floor(rnd() * keys.length)]); }
    const frets = p.score.tracks[0].measures.flatMap((m) => A.beatsOf(m).flatMap((b) => (b.notes || []).map((n) => n.fret)));
    ok(frets.length > 10, `${maxFret}: enough notes`);
    ok(frets.every((f) => f >= 0 && f <= maxFret), `${maxFret}: max ${Math.max(...frets)}`);
    ok(!/pitch|soundingPitch|fromFret/.test(J(p.score)), 'no pitch fields');
  }
});

// ---------- F2: exact undo of every command (model snapshots) ----------
test('F2: every command is reversible by restoring the previous model object (deep-equal) — each of 400 steps recorded and compared back', () => {
  const rnd = mulberry32(99);
  const p = play(fuzzStart());
  const snaps = [];
  for (let i = 0; i < 400; i++) {
    p.wait(200);
    const name = FUZZ[Math.floor(rnd() * FUZZ.length)];
    const before = { score: p.score, json: J(p.score) };
    p.cmd(name, name === 'digit' ? Math.floor(rnd() * 10) : name === 'setDuration' ? 'half' : undefined);
    if (p.last.changed) snaps.push(before);
    eq(J(before.score), before.json, `step ${i} ${name}: the old model object was not mutated`);
  }
  ok(snaps.length > 100, `${snaps.length} edits`);
});

// ---------- B4 / E12 model level: unknown fields ----------
test('E12: unknown fields at every level survive every command that does not own them (score, track, measure, beat, note, voice)', () => {
  const s = sc(tab([{ zzMeasure: { a: [1] }, beats: [{ type: 'note', duration: 'quarter', zzBeat: 'x', notes: [{ string: 1, fret: 2, zzNote: 1 }] }, { type: 'note', duration: 'quarter', zzBeat: 'y', notes: [{ string: 2, fret: 2, zzNote: 2 }] }] }], { zzTrack: true }));
  s.zzScore = { deep: true };
  const p = play(s);
  p.go('5', 'ArrowRight', '+', '.', '/', 'ArrowRight', 'ArrowLeft', 'l', 'r', 'r', 'Insert', 'm', 'Delete');
  const out = JSON.stringify(p.score);
  for (const k of ['zzScore', 'zzTrack', 'zzMeasure', 'zzBeat', 'zzNote']) ok(out.includes(k), `${k} kept`);
  eq(p.score.zzScore, { deep: true });
  const re = play(s).key('7');
  eq(re.beats()[0].notes[0], { string: 1, fret: 7, zzNote: 1 });
  const del = play(s).key('Delete');
  eq(del.beats()[0], { type: 'rest', duration: 'quarter', zzBeat: 'x' });
  // 2.1: every effect key, pressed through its whole cycle, on the note and on the rest it leaves
  const fx = play(s);
  const EFFECT_KEYS = EFFECTS.map((d) => (d.shift ? SHIFT(d.key) : d.key));
  for (let i = 0; i < 9; i++) fx.go(...EFFECT_KEYS);
  fx.go('ArrowRight', 'Delete', ...EFFECT_KEYS, 'r', ...EFFECT_KEYS);
  const fxOut = JSON.stringify(fx.score);
  for (const k of ['zzScore', 'zzTrack', 'zzMeasure', 'zzBeat', 'zzNote']) ok(fxOut.includes(k), `effects: ${k} kept`);
  ok(fx.beats()[1].zzBeat === 'y' && fx.beats()[0].notes[0].zzNote === 1, 'effects: beat and note fields kept');
});

// ---------- H: demo helpers ----------
test('H5: sanitizeFilename edge cases (non-strings, whitespace, dots, path separators, only symbols)', () => {
  eq([123, '   ', '.', '..', 'a.b', 'My: Song / Take 2?', '-_-', '日本語', null, [], 'a'.repeat(5)].map((t) => demo.sanitizeFilename(t)),
    ['123.json', 'score.json', 'score.json', 'score.json', 'ab.json', 'My Song  Take 2.json', '-_-.json', 'score.json', 'score.json', 'score.json', 'aaaaa.json']);
  ok(/^[A-Za-z0-9\-_ ]+\.json$/.test(demo.sanitizeFilename('<script>alert(1)</script>')));
});
test('H2: newScore clamps beats 1-16 and beatType to 2/4/8/16, accepts numeric strings, ignores bad presets; every result loads into the editor model unchanged', () => {
  eq([demo.newScore({ beats: '3' }).tracks[0].timeSignature, demo.newScore({ beats: 17 }).tracks[0].timeSignature.beats, demo.newScore({ beats: 2.5 }).tracks[0].timeSignature.beats, demo.newScore({ beatType: '8' }).tracks[0].timeSignature.beatType, demo.newScore({ beatType: 3 }).tracks[0].timeSignature.beatType],
    [{ beats: 3, beatType: 4 }, 16, 4, 8, 4]);
  for (const preset of ['guitar6', 'bass4', 'guitar7', 'nope']) for (const tabOnlyFlag of [false, true]) {
    const sc1 = demo.newScore({ preset, tabOnly: tabOnlyFlag, beats: 7, beatType: 8, title: '  x  ' });
    ok(io.parseInput(sc1) && J(io.parseInput(sc1)) === J(sc1), `${preset} ${tabOnlyFlag}`);
    const p = play(sc1).go('5', 'ArrowRight');
    eq(p.beats()[0].notes[0].fret, 5);
  }
});
test('H4: readAutosave never throws on odd stored values and never returns a non-object score', () => {
  const store = (v) => ({ getItem: () => v });
  eq(['"str"', '123', 'true', '[]', '', ' ', 'undefined', '{"a":'].map((v) => demo.readAutosave(store(v)).status), ['corrupt', 'corrupt', 'corrupt', 'corrupt', 'corrupt', 'corrupt', 'corrupt', 'corrupt']);
  eq(demo.readAutosave(store('{}')), { status: 'ok', score: {} });
  eq(demo.readAutosave({}).status, 'unavailable', 'no getItem at all');
  eq(demo.readAutosave(null).status, 'unavailable');
});
test('H: the three demo examples and the default score load into the model as sanitize fixed points and survive a full key walk without a throw', () => {
  for (const [name, score] of [['lead-riff', leadRiff], ['lead-solo-f', leadSoloF], ['example-score', exampleScore]]) {
    const p = play(clone(score));
    ok(sanitizeScore(p.score) === p.score, name);
    for (let i = 0; i < 400; i++) p.key(['ArrowRight', '5', 'ArrowDown', 'ArrowRight', 'l', 'PageDown'][i % 6]);
    ok(sanitizeScore(p.score) === p.score, `${name} after the walk`);
  }
});

// ---------- orchestrator follow-ups (2.0.0) ----------
test('E9: Shift+M before the opening measure moves its time / key signature and clef to the new first measure', () => {
  const sc = { tracks: [{ tuning: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], measures: [
    { timeSignature: { beats: 3, beatType: 4 }, keySignature: 2, clef: 'treble', barline: 'repeatStart', beats: [{ type: 'note', duration: 'half', dots: 1, notes: [{ string: 1, fret: 3 }] }] },
  ] }] };
  const ms = play(sc, { at: cur(0, 0, 0) }).key('M', { shiftKey: true }).score.tracks[0].measures;
  eq(ms[0], { timeSignature: { beats: 3, beatType: 4 }, keySignature: 2, clef: 'treble', beats: [] });
  eq(ms[1], { barline: 'repeatStart', beats: [{ type: 'note', duration: 'half', dots: 1, notes: [{ string: 1, fret: 3 }] }] });
  const after = play(sc).key('M', { shiftKey: true }).score;
  eq(sanitizeScore(after) === after, true, 'model stays sanitize-stable');
  const plain = play({ tracks: [{ measures: [{ beats: [] }] }] }).key('M', { shiftKey: true }).score.tracks[0].measures;
  eq(plain, [{ beats: [] }, { beats: [] }], 'no signature: plain empty measure');
});
test('H5: sanitizeFilename caps the name at 100 characters', () => {
  eq(demo.sanitizeFilename('a'.repeat(300)), `${'a'.repeat(100)}.json`);
});

// ---------- report ----------
export function summary() {
  let fail = 0;
  for (const r of results) {
    if (r.ok) console.log(`PASS editor-edge: ${r.name}`);
    else { fail++; console.log(`FAIL editor-edge: ${r.name}\n  ${r.msg}`); }
  }
  return fail;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const f = summary();
  console.log(f ? `\n${f} FAILED` : '\nALL PASSED');
  process.exit(f ? 1 : 0);
}
