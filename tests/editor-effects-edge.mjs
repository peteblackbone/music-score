// 2.1.0 editor effects, edge cases against the criteria (AC1-AC15): ties, X seams and slots, dead notes inside two-digit
// entries, link suffixes vs the renderer, bend forms, dynamics / articulations oddities, rests, track kinds, read-only,
// undo by reference, R / delete / insert, two-voice measures, effect word order and move announcements.
// Run via `node tests/run.js` (awaits summary()), or directly: `node tests/editor-effects-edge.mjs`.
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

register('./hooks.mjs', import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const { makeContainer, serialize } = await import('./dom-shim.mjs');
const { makeClock } = await import('./editor-shim.mjs');
const { MusicScoreRenderer } = await imp('src/MusicScoreRenderer.js');
const { ScoreEditor } = await imp('src/editor/ScoreEditor.js');
const { sanitizeScore } = await imp('src/sanitize.js');
const io = await imp('src/editor/model/io.js');
const A = await imp('src/editor/model/access.js');
const { run } = await imp('src/editor/model/commands.js');
const { EFFECT_BY_NAME, bendStep } = await imp('src/editor/model/effectTable.js');
const E = await imp('src/editor/model/effects.js');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const J = (o) => JSON.stringify(o);
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const eq = (a, b, m = '') => {
  const x = J(canon(a)), y = J(canon(b));
  if (x !== y) throw new Error(`${m} expected ${y}, got ${x}`);
};
const ok = (c, m = 'assertion failed') => { if (!c) throw new Error(m); };
const nt = (duration, string = 1, fret = 0, extra = {}) => ({ type: 'note', duration, notes: [{ string, fret }], ...extra });
const tn = (duration, string, fret, flags = {}, extra = {}) => ({ type: 'note', duration, notes: [{ string, fret, ...flags }], ...extra });
const rest = (duration = 'quarter', extra = {}) => ({ type: 'rest', duration, ...extra });
const grace = (string = 2, fret = 3) => ({ type: 'grace', duration: '16th', notes: [{ string, fret }] });
const tab = (measures, extra = {}) => ({ name: 'Gtr', showTablature: true, ...extra, measures });
const tabOnly = (measures, extra = {}) => ({ name: 'Tab', showStandardNotation: false, showTablature: true, ...extra, measures });
const notation = (measures, extra = {}) => ({ name: 'Std', ...extra, measures });
const sc = (...tracks) => ({ tracks });
const cur = (track, measure, beat, string = 1) => ({ track, measure, beat, string });
const beatsOf = (s, ti = 0, mi = 0, voice = 1) => A.beatsAt(s, { track: ti, measure: mi, voice });
const ST = { duration: 'quarter', dots: 0, digit: null };
const CTX = { maxFret: 24, now: 1000, twoDigitDelayMs: 800, allowAppend: true };
const go = (s, name, c = cur(0, 0, 0), st = ST, ctx = CTX) => run(name, s, c, st, ctx);
const NAMES = ['hammerPull', 'slide', 'slideInOut', 'bend', 'bendBack', 'vibrato', 'palmMute', 'deadNote', 'ghostNote', 'harmonic', 'letRing', 'louder', 'softer', 'accent', 'staccato'];
const NOTE_ROWS = NAMES.filter((n) => EFFECT_BY_NAME[n].level === 'note');
const BEAT_ROWS = NAMES.filter((n) => EFFECT_BY_NAME[n].level === 'beat');
const key = (k, mods = {}) => ({ key: k, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods });
const K = (spec) => (spec.startsWith('Shift+') ? key(spec.slice(6).toUpperCase(), { shiftKey: true }) : key(spec));
const SPEC = { hammerPull: 'h', slide: 's', slideInOut: 'Shift+s', bend: 'b', bendBack: 'Shift+b', vibrato: 'v', palmMute: 'p', deadNote: 'x', ghostNote: 'g', harmonic: 'n', letRing: 'Shift+l', louder: 'd', softer: 'Shift+d', accent: 'a', staccato: 'Shift+a' };

/** An editor with a manual clock; `say(...specs)` presses keys and returns the live region text. */
function mk(score, opts = {}) {
  const clock = makeClock();
  clock.requestAnimationFrame = null; clock.cancelAnimationFrame = null;
  const box = makeContainer();
  const ed = new ScoreEditor(box, score, { width: 900, clock, ...opts });
  const live = box.children[0].children[1];
  const say = (...specs) => { specs.forEach((s) => ed.handleKey(typeof s === 'string' ? K(s) : s)); clock.advance(150); return live.textContent.replace(/ $/, ''); };
  return { ed, box, clock, say };
}
const classesOf = (s, width = 900) => {
  const box = makeContainer();
  new MusicScoreRenderer(box, s, { width }).render();
  const out = serialize(box.children[0]);
  return new Set([...out.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(' ')));
};

// ---------- ties ----------
test('ties: every effect on a tieStart and on a tieEnd note keeps the tie flags and the partner beat (by reference), at every step of every cycle', () => {
  const s = sc(tab([{ beats: [tn('half', 1, 5, { tieStart: true }), tn('half', 1, 5, { tieEnd: true, tieStart: true })] }, { beats: [tn('whole', 1, 5, { tieEnd: true })] }]));
  for (const name of NAMES) {
    for (const [c, flags] of [[cur(0, 0, 0), ['tieStart']], [cur(0, 0, 1), ['tieEnd', 'tieStart']], [cur(0, 1, 0), ['tieEnd']]]) {
      let x = s;
      for (let i = 0; i < 7; i++) {
        const r = go(x, name, c);
        ok(r.changed, `${name} press ${i + 1} at ${J(c)}`);
        x = r.score;
        const n = A.cursorNote(x, c);
        for (const f of flags) ok(n[f] === true, `${name} press ${i + 1} at ${J(c)}: ${f} kept`);
        ok(sanitizeScore(x) === x, `${name}: sanitize-stable`);
      }
      // the other beats are untouched by reference unless the effect is on the beat that holds them
      const r = go(s, name, c);
      for (const other of [cur(0, 0, 0), cur(0, 0, 1), cur(0, 1, 0)].filter((o) => o.measure !== c.measure || o.beat !== c.beat)) {
        ok(A.beatAt(r.score, other) === A.beatAt(s, other), `${name}: beat ${J(other)} kept by reference`);
      }
    }
  }
});
test('ties: X on an empty string next to tied neighbours on another string leaves those ties alone; on a tied string\'s rest it equals digit 0 + mute', () => {
  const s = sc(tab([{ beats: [{ type: 'note', duration: 'half', notes: [{ string: 1, fret: 5, tieStart: true }] }, { type: 'note', duration: 'half', notes: [{ string: 1, fret: 5, tieEnd: true }] }] }]));
  for (const c of [cur(0, 0, 0, 2), cur(0, 0, 1, 2), cur(0, 0, 0, 6)]) {
    const r = go(s, 'deadNote', c);
    eq(r.announce, { id: 'effect', name: 'deadNote', added: true });
    ok(A.cursorNote(r.score, cur(0, 0, 0, 1)).tieStart === true && A.cursorNote(r.score, cur(0, 0, 1, 1)).tieEnd === true, `string-1 tie intact for ${J(c)}`);
    ok(A.cursorNote(r.score, c).mute === true && A.cursorNote(r.score, c).fret === 0);
  }
  const t = sc(tab([{ beats: [tn('quarter', 1, 5, { tieStart: true }), rest('quarter'), tn('quarter', 1, 5, { tieEnd: true })] }]));
  const x = go(t, 'deadNote', cur(0, 0, 1, 1)).score;
  const d = run('digit', t, cur(0, 0, 1, 1), ST, CTX, 0).score;
  eq(x, A.updateNote(d, cur(0, 0, 1, 1), (n) => ({ ...n, mute: true })));
  ok(sanitizeScore(x) === x);
});
test('ties: N and X on a tied note; N removes mute, X removes harmonic, neither touches the tie', () => {
  const s = sc(tab([{ beats: [tn('half', 1, 5, { tieStart: true, harmonic: 'natural' }), tn('half', 1, 5, { tieEnd: true, mute: true })] }]));
  eq(A.cursorNote(go(s, 'deadNote', cur(0, 0, 0)).score, cur(0, 0, 0)), { string: 1, fret: 5, tieStart: true, mute: true });
  eq(A.cursorNote(go(s, 'harmonic', cur(0, 0, 1)).score, cur(0, 0, 1)), { string: 1, fret: 5, tieEnd: true, harmonic: 'natural' });
});

// ---------- X: slots, full and empty measures ----------
test('X on the append slot of a full measure adds a fifth beat (as the digit path does); on an empty measure and a missing one it writes the first beat', () => {
  const full = sc(tab([{ beats: [nt('quarter'), nt('quarter'), nt('quarter'), nt('quarter')] }]));
  const r = go(full, 'deadNote', cur(0, 0, 4, 2), { duration: 'half', dots: 0, digit: null });
  eq(beatsOf(r.score).length, 5);
  eq(beatsOf(r.score)[4], { type: 'note', duration: 'half', notes: [{ string: 2, fret: 0, mute: true }] });
  ok(beatsOf(r.score).slice(0, 4).every((b, i) => b === beatsOf(full)[i]), 'existing beats kept by reference');
  const d = run('digit', full, cur(0, 0, 4, 2), { duration: 'half', dots: 0, digit: null }, CTX, 0).score;
  eq(r.score, A.updateNote(d, cur(0, 0, 4, 2), (n) => ({ ...n, mute: true })), 'same as digit 0 + mute');
  const emptyM = go(sc(tab([{ beats: [] }, { beats: [nt('whole')] }])), 'deadNote', cur(0, 0, 0, 3), { duration: '8th', dots: 2, digit: null });
  eq(beatsOf(emptyM.score)[0], { type: 'note', duration: '8th', dots: 2, notes: [{ string: 3, fret: 0, mute: true }] });
  const hole = go(sc(tab([{ beats: [nt('whole')] }, null])), 'deadNote', cur(0, 1, 0, 1));
  eq(beatsOf(hole.score, 0, 1), [{ type: 'note', duration: 'quarter', notes: [{ string: 1, fret: 0, mute: true }] }]);
  ok(sanitizeScore(hole.score) === hole.score && sanitizeScore(r.score) === r.score);
  const slot = go(full, 'deadNote', cur(0, 0, 4, 2));
  ok(!slot.moved && slot.changed, 'cursor kept');
});
test('X before a trailing grace / next to graces repairs the seam as a digit does', () => {
  const s = sc(tab([{ beats: [nt('quarter', 2, 3), grace(2, 1)] }]));
  const r = go(s, 'deadNote', cur(0, 0, 2, 2));
  const d = run('digit', s, cur(0, 0, 2, 2), ST, CTX, 0).score;
  eq(r.score, A.updateNote(d, cur(0, 0, 2, 2), (n) => ({ ...n, mute: true })));
});

// ---------- digit on a dead note inside a two-digit entry ----------
test('a digit on a dead note within a two-digit entry: the first digit clears mute, the second combines, mute stays gone; X between the digits re-mutes the combined fret', () => {
  const s0 = sc(tab([{ beats: [tn('quarter', 1, 5, { mute: true })] }]));
  const d1 = run('digit', s0, cur(0, 0, 0), ST, { ...CTX, now: 2000 }, 1);
  eq(A.cursorNote(d1.score, cur(0, 0, 0)), { string: 1, fret: 1 });
  const d2 = run('digit', d1.score, d1.cursor, d1.state, { ...CTX, now: 2100 }, 2);
  eq([A.cursorNote(d2.score, cur(0, 0, 0)), d2.coalesce], [{ string: 1, fret: 12 }, true]);
  // a dead note whose fret is already the first digit: the same-fret digit still clears mute, and the second digit coalesces
  const s1 = sc(tab([{ beats: [tn('quarter', 1, 1, { mute: true })] }]));
  const e1 = run('digit', s1, cur(0, 0, 0), ST, { ...CTX, now: 2000 }, 1);
  eq(A.cursorNote(e1.score, cur(0, 0, 0)), { string: 1, fret: 1 });
  const e2 = run('digit', e1.score, e1.cursor, e1.state, { ...CTX, now: 2100 }, 3);
  eq(A.cursorNote(e2.score, cur(0, 0, 0)), { string: 1, fret: 13 });
  // X between the two digits: the second digit then re-frets the note and clears the mute again
  const x = go(d1.score, 'deadNote', d1.cursor, d1.state, { ...CTX, now: 2050 });
  eq(A.cursorNote(x.score, cur(0, 0, 0)), { string: 1, fret: 1, mute: true });
  const f = run('digit', x.score, x.cursor, x.state ?? d1.state, { ...CTX, now: 2100 }, 2);
  ok(!('mute' in A.cursorNote(f.score, cur(0, 0, 0))), 'the second digit clears mute');
  // a dead note on an absent string: X then a digit replaces the fret and drops mute
  const y = go(sc(tab([{ beats: [] }])), 'deadNote', cur(0, 0, 0, 4));
  eq(A.cursorNote(run('digit', y.score, y.cursor, y.state, CTX, 7).score, cur(0, 0, 0, 4)), { string: 4, fret: 7 });
});

// ---------- link suffix vs the renderer ----------
test('H / S suffix: no later note only in a later measure, only a grace, only voice 2, only on another track, only after a rest', () => {
  const sfx = (measures, c, name = 'hammerPull', extra = {}) => go(sc(tab(measures), tab([{ beats: [nt('whole', 1, 1), nt('whole', 2, 1)] }]), ...(extra.more ?? [])), name, c).announce.suffix;
  // the next note on the string is in a later measure
  eq(sfx([{ beats: [nt('whole', 1, 5)] }, { beats: [nt('whole', 1, 7)] }], cur(0, 0, 0, 1)), null);
  eq(sfx([{ beats: [nt('whole', 1, 5)] }, { beats: [] }, { beats: [nt('whole', 1, 7)] }], cur(0, 0, 0, 1)), null, 'across an empty measure');
  eq(sfx([{ beats: [nt('whole', 1, 5)] }, { beats: [nt('whole', 2, 7)] }], cur(0, 0, 0, 1)), 'link', 'other strings only');
  // only a grace later
  eq(sfx([{ beats: [nt('quarter', 1, 5), grace(1, 3), nt('quarter', 2, 0)] }], cur(0, 0, 0, 1), 'slide'), null);
  eq(sfx([{ beats: [nt('quarter', 1, 5), nt('quarter', 2, 0)] }, { beats: [grace(1, 3)] }], cur(0, 0, 0, 1)), null, 'a grace in the next measure');
  // a grace BEFORE the note is not a target
  eq(sfx([{ beats: [grace(1, 3), nt('quarter', 1, 5)] }], cur(0, 0, 1, 1)), 'link');
  // only voice 2 later, in the same and in a later measure
  eq(sfx([{ voices: [{ beats: [nt('half', 1, 5)] }, { beats: [nt('half', 1, 9), nt('half', 1, 10)] }] }], cur(0, 0, 0, 1)), 'link', 'voice 2 of the same measure');
  eq(sfx([{ beats: [nt('whole', 1, 5)] }, { voices: [{ beats: [nt('whole', 2, 0)] }, { beats: [nt('whole', 1, 9)] }] }], cur(0, 0, 0, 1)), 'link', 'voice 2 of a later measure');
  eq(sfx([{ beats: [nt('whole', 1, 5)] }, { voices: [{ beats: [nt('whole', 1, 0)] }, { beats: [nt('whole', 1, 9)] }] }], cur(0, 0, 0, 1)), null, 'voice 1 of a later two-voice measure counts');
  // voice 1 note in a two-voice measure, next voice-1 note in the same measure
  eq(sfx([{ voices: [{ beats: [nt('half', 1, 5), nt('half', 1, 6)] }, { beats: [nt('whole', 2, 9)] }] }], cur(0, 0, 0, 1)), null);
  // only on another track / only rests later / notes on the string in the same beat (another chord note) do not count
  eq(sfx([{ beats: [nt('quarter', 1, 5), rest('quarter'), rest('half')] }], cur(0, 0, 0, 1)), 'link', 'rests are not targets');
  eq(sfx([{ beats: [{ type: 'note', duration: 'whole', notes: [{ string: 1, fret: 5 }, { string: 2, fret: 5 }] }] }], cur(0, 0, 0, 1)), 'link', 'same beat, other string');
  eq(sfx([{ beats: [nt('quarter', 1, 5), { type: 'note', duration: 'quarter', notes: [{ string: 3, fret: 1 }, { string: 1, fret: 2 }] }] }], cur(0, 0, 0, 1)), null, 'a later chord note on the string');
});
test('H / S suffix agrees with the renderer: the TAB arc is drawn exactly when no suffix is spoken (later measure, grace, voice 2, rests)', () => {
  const cases = [
    [[{ beats: [nt('whole', 1, 5)] }, { beats: [nt('whole', 1, 7)] }], 'later measure'],
    [[{ beats: [nt('half', 1, 5), nt('half', 1, 7)] }], 'same measure'],
    [[{ beats: [nt('whole', 1, 5)] }], 'nothing later'],
    [[{ voices: [{ beats: [nt('half', 1, 5), rest('half')] }, { beats: [nt('half', 1, 9), nt('half', 1, 11)] }] }], 'voice 2 only'],
    [[{ beats: [nt('half', 1, 5), rest('half')] }, { beats: [nt('whole', 1, 7)] }], 'across a rest'],
  ];
  for (const [measures, label] of cases) {
    const s = io.parseInput(sc(tab(measures, { tuning: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'] })));
    const r = go(s, 'hammerPull', cur(0, 0, 0, 1));
    const spoken = r.announce.suffix === 'link';
    const drawn = classesOf(r.score).has('hammer-pull');
    ok(drawn === !spoken, `${label}: suffix ${r.announce.suffix}, hammer-pull drawn ${drawn}`);
  }
});

// ---------- bends ----------
test('bend: every renderer-recognized form classifies as bendOf says (strings, objects, compound); steps are exactly the five; custom -> full / release', () => {
  const via = (v, name = 'bend') => A.cursorNote(go(sc(tab([{ beats: [tn('quarter', 1, 5, { bend: v })] }])), name).score, cur(0, 0, 0)).bend;
  const forms = [
    ['full', '1/2'], ['FULL', '1/2'], [' full ', '1/2'], [true, '1/2'], [{ amount: 'full' }, '1/2'], [{ type: 'bend', amount: 'full' }, '1/2'], [{ type: ' BEND ', amount: ' Full ' }, '1/2'],
    ['1/2', 'full release'], [{ amount: '1/2' }, 'full release'],
    ['full release', 'prebend full'], [{ amount: 'full', release: true }, 'prebend full'],
    ['prebend full', 'release'], ['pb full', 'release'], ['pre-bend', 'release'], ['PB Full', 'release'], [{ type: 'pb', amount: 'full' }, 'release'], [{ type: 'prebend' }, 'release'], [5, '1/2'], [[1], '1/2'],
    ['release', undefined], [{ type: 'release' }, undefined], ['Release', undefined],
  ];
  for (const [v, next] of forms) eq(via(v), next, `B from ${J(v)}`);
  const custom = ['half', '1/4', '3/4', '2', 'full hold', '1/2 hold', 'full release full', '1/2 release 1/2', 'pb full release', 'prebend 1/2', 'release 1/2', 'release full', '??', { amount: 'full', hold: true }, { amount: 'full', release: true, rebend: 'full' }, { type: 'release', amount: '1/2' }, { type: 'pb', amount: '1/2' }, { type: 'bend', amount: 5 }];
  for (const v of custom) { eq(bendStep(v), -1, `custom ${J(v)}`); eq(via(v), 'full', `B from custom ${J(v)}`); eq(via(v, 'bendBack'), 'release', `Shift+B from custom ${J(v)}`); }
});
test('bend: Shift+B is the exact inverse of B on every value (and from off); full cycles close after 6 presses either way', () => {
  const vals = ['full', '1/2', 'full release', 'prebend full', 'release'];
  const at = (bend) => sc(tab([{ beats: [tn('quarter', 1, 5, bend === undefined ? {} : { bend })] }]));
  const bendOfScore = (s) => A.cursorNote(s, cur(0, 0, 0)).bend;
  for (const v of [...vals, undefined]) {
    const s = at(v);
    eq(bendOfScore(go(go(s, 'bend').score, 'bendBack').score), v, `B then Shift+B from ${v}`);
    eq(bendOfScore(go(go(s, 'bendBack').score, 'bend').score), v, `Shift+B then B from ${v}`);
  }
  let f = at(undefined), b = at(undefined);
  const seqF = [], seqB = [];
  for (let i = 0; i < 6; i++) { f = go(f, 'bend').score; b = go(b, 'bendBack').score; seqF.push(bendOfScore(f)); seqB.push(bendOfScore(b)); }
  eq(seqF, [...vals, undefined]);
  eq(seqB, [...vals].reverse().concat(undefined));
  eq(bendOfScore(go(f, 'bend').score), 'full', 'wraps');
});

// ---------- dynamics ----------
test('dynamics: case, whitespace, custom text and non-strings count as nothing or are trimmed exactly', () => {
  const d = (dynamic, name = 'louder') => A.beatAt(go(sc(tab([{ beats: [nt('quarter', 1, 0, dynamic === undefined ? {} : { dynamic })] }])), name).score, cur(0, 0, 0)).dynamic;
  eq(['MF', 'Mf', 'FFF', 'Ppp', 'mf!', 'mezzo', '   ', '', 5, null, { a: 1 }, ['f'], true].map((v) => d(v)), Array(13).fill('mf'), 'louder from custom');
  eq(['MF', 'PPP', 'x', 7].map((v) => d(v, 'softer')), Array(4).fill('mp'), 'softer from custom');
  eq([d(' mf '), d('\tf\n'), d(' mp ', 'softer'), d('fff '), d(' ppp', 'softer')], ['f', 'ff', 'p', undefined, undefined]);
  const full = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff'];
  for (let i = 0; i < 8; i++) { eq(d(full[i], 'louder'), full[i + 1], `louder from ${full[i]}`); eq(d(full[i], 'softer'), full[i - 1], `softer from ${full[i]}`); }
  const info = (dynamic) => E.effectWords(sc(tab([{ beats: [nt('quarter', 1, 0, { dynamic })] }])), cur(0, 0, 0)).beat;
  eq([info('MF'), info(' mf '), info(''), info('  '), info(5)], [['MF'], ['mf'], [], [], []]);
});

// ---------- articulations ----------
test('articulations: duplicates and non-strings: groups removed completely, other entries (by reference) kept in order, info de-duplicated and strings only', () => {
  const obj = { a: 1 };
  const a = (articulations, name) => A.beatAt(go(sc(tab([{ beats: [nt('quarter', 1, 0, { articulations })] }])), name).score, cur(0, 0, 0)).articulations;
  eq(a(['accent', 'accent'], 'accent'), ['marcato'], 'dup accent -> marcato, both removed');
  eq(a(['marcato', 'marcato'], 'accent'), undefined, 'dup marcato -> off');
  eq(a(['accent', 'tenuto', 'accent'], 'accent'), ['tenuto', 'marcato']);
  eq(a(['staccato', 'staccato'], 'staccato'), ['staccatissimo']);
  eq(a(['staccatissimo', 'staccato', 'staccatissimo'], 'staccato'), undefined);
  eq(a(['accent', 'staccato', 'accent', 'staccato'], 'staccato'), ['accent', 'accent', 'staccatissimo'], 'only the staccato group is touched');
  eq(a([], 'accent'), ['accent'], 'empty array');
  eq(a([null, 5, 'accent', undefined], 'accent'), [null, 5, undefined, 'marcato'].map((v) => (v === undefined ? null : v)), 'non-strings kept (JSON shows undefined as null)');
  const r = A.beatAt(go(sc(tab([{ beats: [nt('quarter', 1, 0, { articulations: [obj, 'accent'] })] }])), 'accent').score, cur(0, 0, 0)).articulations;
  ok(r[0] === obj && r[1] === 'marcato', 'object entry kept by reference');
  eq(a([5, 'marcato'], 'accent'), [5], 'only a non-string left: kept, not deleted');
  eq(a([obj], 'staccato').length, 2);
  eq(a(['heavyAccent', 'heavyAccent'], 'accent'), undefined);
  eq(a(['heavyAccent', 'accent'], 'accent'), undefined, 'marcato group wins');
  const info = (articulations) => E.effectWords(sc(tab([{ beats: [nt('quarter', 1, 0, { articulations })] }])), cur(0, 0, 0)).beat;
  eq([info(['staccato', 'staccato', 'accent']), info([5, null, 'heavyAccent', 'marcato']), info('accent'), info([])], [['staccato', 'accent'], ['marcato'], [], []]);
});

// ---------- rests ----------
test('vibrato on a rest and on a whole-measure rest says needsNote; P, D and Shift+D work there; Shift+L, A and Shift+A refuse; rests keep beat effects', () => {
  const s = sc(tab([{ beats: [rest('whole')] }, { beats: [rest('quarter', { palmMute: true, vibrato: true }), rest('quarter')] }]));
  for (const c of [cur(0, 0, 0, 1), cur(0, 0, 0, 3), cur(0, 1, 0, 1), cur(0, 1, 1, 1)]) {
    for (const name of ['vibrato', 'letRing', 'accent', 'staccato']) { const r = go(s, name, c); eq([r.changed, r.announce, r.score === s], [false, { id: 'needsNote' }, true], `${name} at ${J(c)}`); }
    for (const name of ['palmMute', 'louder', 'softer']) ok(go(s, name, c).changed, `${name} on a rest at ${J(c)}`);
    for (const name of NOTE_ROWS.filter((n) => n !== 'deadNote')) eq(go(s, name, c).announce, { id: 'noNoteHere' }, `${name} at ${J(c)}`);
  }
  eq(go(s, 'palmMute', cur(0, 1, 0)).score === s, false);
  const off = go(s, 'palmMute', cur(0, 1, 0)).score;
  eq(A.beatAt(off, cur(0, 1, 0)), { type: 'rest', duration: 'quarter', vibrato: true }, 'a rest keeps a vibrato it already had');
  eq(A.beatAt(go(s, 'louder', cur(0, 0, 0)).score, cur(0, 0, 0)), { type: 'rest', duration: 'whole', dynamic: 'mf' });
  eq(go(s, 'deadNote', cur(0, 0, 0, 2)).announce, { id: 'effect', name: 'deadNote', added: true }, 'X on a whole rest adds a note');
  eq(A.beatAt(go(s, 'deadNote', cur(0, 0, 0, 2)).score, cur(0, 0, 0)), { type: 'note', duration: 'whole', notes: [{ string: 2, fret: 0, mute: true }] });
});

// ---------- track kinds ----------
test('every key on a TAB-only track works like on a TAB+notation track (writes, same announce but suffixes); on a notation-only track the note rows say needsTab everywhere (X too)', () => {
  const body = () => [{ beats: [{ type: 'note', duration: 'half', notes: [{ string: 1, fret: 5 }, { string: 2, fret: 3 }] }, rest('quarter'), nt('quarter', 3, 0)] }];
  const s = sc(tab(body()), tabOnly(body()), notation([{ beats: [{ type: 'note', duration: 'half', notes: [{ pitch: 'C4' }] }, rest('quarter'), { type: 'note', duration: 'quarter', notes: [{ pitch: 'E4' }] }] }]));
  for (const name of NAMES) {
    for (const c of [cur(0, 0, 0, 1), cur(0, 0, 0, 2), cur(0, 0, 1, 1), cur(0, 0, 3, 1)]) {
      const a = go(s, name, c), b = go(s, name, { ...c, track: 1 });
      eq([a.changed, a.announce.id, a.announce.name], [b.changed, b.announce.id, b.announce.name], `${name} at ${J(c)}`);
      eq(beatsOf(a.score, 0), beatsOf(b.score, 1), `${name} writes the same on the TAB-only track`);
    }
    for (const c of [cur(2, 0, 0, 1), cur(2, 0, 1, 1), cur(2, 0, 3, 1)]) {
      const r = go(s, name, c);
      if (NOTE_ROWS.includes(name)) eq([r.changed, r.announce], [false, { id: 'needsTab' }], `${name} at ${J(c)}`);
      else if (c.beat === 3) eq(r.announce, { id: 'noBeat' }, `${name} slot`);
      else if (c.beat === 1) eq(r.announce.id, ['palmMute', 'louder', 'softer'].includes(name) ? 'effect' : 'needsNote', `${name} rest`);
      else ok(r.changed, `${name} on a notation note`);
      ok(r.changed || r.score === s, 'a refusal changes nothing');
    }
  }
});
test('notation-only track: effect words list only beat words; chords of pitches keep notes by reference for every beat key', () => {
  const s = sc(notation([{ beats: [{ type: 'note', duration: 'whole', vibrato: true, palmMute: true, notes: [{ pitch: 'C4', bend: 'full', mute: true, ghost: true }, { pitch: 'E4' }] }] }]));
  eq(E.effectWords(s, cur(0, 0, 0)), { note: [], beat: ['vibrato', 'palm mute'] });
  for (const name of BEAT_ROWS) ok(A.beatAt(go(s, name).score, cur(0, 0, 0)).notes === A.beatAt(s, cur(0, 0, 0)).notes, name);
});

// ---------- read-only ----------
test('read-only: every key at every kind of position (note, rest, empty string, slot, notation track) says "Read-only", is not consumed and changes nothing', () => {
  const s = sc(tab([{ beats: [nt('quarter', 1, 5), rest('quarter')] }]), notation([{ beats: [{ type: 'note', duration: 'whole', notes: [{ pitch: 'C4' }] }] }]));
  const { ed, say } = mk(s, { readOnly: true });
  const before = ed._model;
  for (const where of [{ track: 0, measure: 0, beat: 0, string: 1 }, { track: 0, measure: 0, beat: 0, string: 4 }, { track: 0, measure: 0, beat: 1, string: 1 }, { track: 0, measure: 0, beat: 2, string: 1 }, { track: 1, measure: 0, beat: 0 }]) {
    ed.setCursor(where);
    for (const name of NAMES) {
      eq(ed.handleKey(K(SPEC[name])), false, `${name} at ${J(where)}`);
      eq(say().trim(), 'Read-only', `${name} at ${J(where)}`);
    }
  }
  ok(ed._model === before && !ed.canUndo(), 'unchanged');
  ed.destroy();
});

// ---------- undo / redo ----------
test('undo / redo by reference: every key on every kind of target (note, add paths of X, off presses), and a whole sequence undone and redone', () => {
  const base = () => sc(tab([{ beats: [tn('quarter', 1, 5, { tieStart: true }), rest('quarter'), nt('quarter', 2, 3)] }, { beats: [] }]));
  const wheres = [{ beat: 0, string: 1 }, { beat: 0, string: 4 }, { beat: 1, string: 2 }, { beat: 3, string: 3 }, { measure: 1, beat: 0, string: 2 }];
  for (const w of wheres) for (const name of NAMES) {
    const { ed } = mk(base());
    ed.setCursor({ track: 0, measure: 0, beat: 0, string: 1, ...w });
    const before = ed._model;
    const consumed = ed.handleKey(K(SPEC[name]));
    if (ed._model === before) { ok(!ed.canUndo(), `${name} at ${J(w)}: a refusal adds no entry`); ed.destroy(); continue; }
    ok(consumed);
    const after = ed._model;
    ed.undo();
    ok(ed._model === before, `${name} at ${J(w)}: undo restores by reference`);
    ed.redo();
    ok(ed._model === after, `${name} at ${J(w)}: redo restores by reference`);
    ed.destroy();
  }
  // a whole cycle of presses: N presses = N entries; undo N times lands on the original object
  for (const name of NAMES) {
    const { ed } = mk(base());
    const start = ed._model;
    const seen = [start];
    for (let i = 0; i < 7; i++) { ed.handleKey(K(SPEC[name])); seen.push(ed._model); }
    for (let i = 7; i > 0; i--) { ed.undo(); ok(ed._model === seen[i - 1], `${name}: undo ${8 - i} by reference`); }
    ok(!ed.canUndo(), `${name}: back at the start`);
    for (let i = 1; i <= 7; i++) { ed.redo(); ok(ed._model === seen[i], `${name}: redo ${i} by reference`); }
    ed.destroy();
  }
  // all fifteen keys in a row at one note
  const { ed } = mk(base());
  const start = ed._model;
  const seen = [start];
  for (const name of NAMES) { ed.handleKey(K(SPEC[name])); seen.push(ed._model); }
  for (let i = NAMES.length; i > 0; i--) { ed.undo(); ok(ed._model === seen[i - 1]); }
  ed.destroy();
});

// ---------- R toggle / delete / insert ----------
test('R, delete note and delete / insert beat keep the beat effects (E12) and the other beats\' effects; note effects go with the note', () => {
  const rich = { type: 'note', duration: 'quarter', vibrato: 'wide', palmMute: true, letRing: true, dynamic: 'f', articulations: ['accent', 'staccato'], notes: [{ string: 1, fret: 5, bend: 'full', ghost: true }, { string: 2, fret: 3, harmonic: 'pinch' }] };
  const s = sc(tab([{ beats: [rich, nt('quarter', 1, 0, { palmMute: true }), nt('half', 2, 2, { dynamic: 'p' })] }]));
  const BEAT = { vibrato: 'wide', palmMute: true, letRing: true, dynamic: 'f', articulations: ['accent', 'staccato'] };
  const r = go(s, 'toggleRest', cur(0, 0, 0));
  eq(pickBeat(A.beatAt(r.score, cur(0, 0, 0))), BEAT);
  eq(A.beatAt(r.score, cur(0, 0, 0)).type, 'rest');
  ok(beatsOf(r.score)[1] === beatsOf(s)[1] && beatsOf(r.score)[2] === beatsOf(s)[2], 'neighbours kept by reference');
  const back = go(r.score, 'toggleRest', cur(0, 0, 0, 1));
  eq(pickBeat(A.beatAt(back.score, cur(0, 0, 0))), BEAT, 'beat effects survive rest -> note');
  eq(A.beatAt(back.score, cur(0, 0, 0)).type, 'note');
  ok(sanitizeScore(back.score) === back.score && sanitizeScore(r.score) === r.score);
  // delete the notes one by one: the chord note's effect stays on the other note, the last note leaves a rest with the beat effects
  const d1 = go(s, 'deleteNote', cur(0, 0, 0, 1));
  eq(A.beatAt(d1.score, cur(0, 0, 0)).notes, [{ string: 2, fret: 3, harmonic: 'pinch' }]);
  ok(A.beatAt(d1.score, cur(0, 0, 0)).notes[0] === A.beatAt(s, cur(0, 0, 0)).notes[1], 'other chord note kept by reference');
  const d2 = go(d1.score, 'deleteNote', cur(0, 0, 0, 2));
  eq([A.beatAt(d2.score, cur(0, 0, 0)).type, pickBeat(A.beatAt(d2.score, cur(0, 0, 0)))], ['rest', BEAT]);
  // delete / insert beat: the beats around keep their identity and so their effects
  const del = go(s, 'deleteBeat', cur(0, 0, 1));
  ok(beatsOf(del.score)[0] === beatsOf(s)[0] && beatsOf(del.score)[1] === beatsOf(s)[2], 'deleteBeat keeps the others');
  const ins = go(s, 'insertBeat', cur(0, 0, 1));
  ok(beatsOf(ins.score).filter((b) => b === beatsOf(s)[0] || b === beatsOf(s)[1] || b === beatsOf(s)[2]).length === 3, 'insertBeat keeps all three');
  // an effect pressed on the beat afterwards works as before
  const after = go(ins.score, 'vibrato', cur(0, 0, 1));
  ok(after.changed || after.announce.id === 'needsNote');
  // an effect on a note whose neighbour is toggled to a rest keeps its own effects
  const rr = go(go(s, 'ghostNote', cur(0, 0, 2, 2)).score, 'toggleRest', cur(0, 0, 1)).score;
  eq(A.cursorNote(rr, cur(0, 0, 2, 2)), { string: 2, fret: 2, ghost: true });
});
const pickBeat = (b) => Object.fromEntries(['vibrato', 'palmMute', 'letRing', 'dynamic', 'articulations'].filter((k) => k in b).map((k) => [k, b[k]]));

// ---------- two voices ----------
test('two-voice measures: every key edits voice 1 only; voice 2, the voices array siblings and other measures keep their identity; X on the slot appends to voice 1', () => {
  const v2 = { beats: [nt('half', 1, 9, { palmMute: true }), rest('half')] };
  const m0 = { voices: [{ beats: [tn('half', 1, 5, { tieStart: true }), nt('half', 2, 3)], zz: 1 }, v2], zzM: true };
  const m1 = { beats: [nt('whole')] };
  const s = sc(tab([m0, m1]));
  for (const name of NAMES) {
    for (const c of [cur(0, 0, 0, 1), cur(0, 0, 1, 2), cur(0, 0, 0, 5), cur(0, 0, 2, 3)]) {
      const r = go(s, name, c);
      if (!r.changed) continue;
      const m = r.score.tracks[0].measures[0];
      ok(m.voices[1] === v2, `${name} at ${J(c)}: voice 2 kept by reference`);
      ok(r.score.tracks[0].measures[1] === m1, `${name}: other measure kept`);
      ok(m.zzM === true && m.voices[0].zz === 1, `${name}: unknown fields kept`);
      ok(!('beats' in m), `${name}: no top-level beats written into a two-voice measure`);
      ok(sanitizeScore(r.score) === r.score, `${name}: sanitize-stable`);
    }
  }
  eq(beatsOf(go(s, 'deadNote', cur(0, 0, 2, 4)).score).length, 3);
  eq(beatsOf(go(s, 'palmMute', cur(0, 0, 0)).score, 0, 0, 2), v2.beats, 'voice 2 beats unchanged');
  eq(E.effectWords(s, cur(0, 0, 0)), { note: [], beat: [] }, 'no effects words from voice 2 at voice 1 position');
});

// ---------- word order ----------
test('effect words: table order whatever the order the keys were pressed in; and the cursor info lists the same order', () => {
  const combos = [['hammerPull', 'slideInOut', 'bend', 'ghostNote', 'deadNote', 'vibrato', 'palmMute', 'letRing', 'louder', 'accent', 'staccato'], ['slide', 'harmonic', 'ghostNote', 'bend']];
  const want = [
    ['hammer/pull', 'slide in', 'bend full', 'dead', 'ghost', 'vibrato', 'palm mute', 'let ring', 'mf', 'staccato', 'marcato'],
    ['slide', 'bend full', 'ghost', 'natural harmonic'],
  ];
  // A is pressed once more at the end of the first list: accent -> marcato goes after the staccato entry
  const press = (names) => {
    let x = sc(tab([{ beats: [nt('quarter', 1, 5)] }]));
    for (const n of names) x = go(x, n).score;
    if (names.includes('accent')) x = go(x, 'accent').score;
    return x;
  };
  const words = (names) => { const w = E.effectWords(press(names), cur(0, 0, 0)); return [...w.note, ...w.beat]; };
  eq(words(combos[0]), want[0]);
  eq(words(combos[1]), want[1]);
  eq(words([...combos[1]].reverse()), want[1]);
  const rev = words([...combos[0]].reverse());
  // order: note words first, in table order, then beat words in table order; the articulation order follows the list, so compare without it
  eq(rev.slice(0, 8), want[0].slice(0, 8));
  eq(new Set(rev), new Set(want[0]));
  // both exclusive pairs stored raw (a hand-written score): both words are listed
  const raw = sc(tab([{ beats: [tn('quarter', 1, 5, { hammerPull: true, slide: true, mute: true, harmonic: 'natural', slideIn: true, slideOut: 'down' })] }]));
  eq(E.effectWords(raw, cur(0, 0, 0)).note, ['hammer/pull', 'slide', 'slide in', 'slide out', 'dead', 'natural harmonic']);
  const { ed } = mk(sc(tab([{ beats: [nt('quarter', 1, 5)] }])));
  for (const name of ['staccato', 'accent', 'louder', 'letRing', 'palmMute', 'vibrato', 'ghostNote', 'bend', 'slideInOut', 'hammerPull']) ed.handleKey(K(SPEC[name]));
  eq(ed.getCursorInfo().effects, ['hammer/pull', 'slide in', 'bend full', 'ghost', 'vibrato', 'palm mute', 'let ring', 'mf', 'staccato', 'accent']);
  eq(ed.getCursorInfo().noteEffects, ['hammer/pull', 'slide in', 'bend full', 'ghost']);
  ed.destroy();
});

// ---------- announcements ----------
test('move announcements: combined effects after the duration (dots, triplets), before ", tied"; rests; measure and track moves; Up / Down speak note effects only', () => {
  const s = sc(
    tab([
      { beats: [tn('quarter', 1, 5, { hammerPull: true, ghost: true }, { vibrato: true, dynamic: 'mf', dots: 1 }), { type: 'note', duration: 'quarter', tuplet: 3, letRing: true, notes: [{ string: 1, fret: 5, tieEnd: true, bend: '1/2' }] }, rest('quarter', { palmMute: true })] },
      { beats: [tn('whole', 3, 2, { harmonic: 'pinch', mute: true }, { articulations: ['accent', 'staccato'], dynamic: 'ff' })] },
    ]),
    notation([{ beats: [{ type: 'note', duration: 'whole', vibrato: 'wide', notes: [{ pitch: 'C4', bend: 'full' }, { pitch: 'E4' }] }] }]),
    tabOnly([{ beats: [nt('whole', 2, 2, { palmMute: true })] }]),
  );
  const { ed, say } = mk(s);
  const at = (c) => { ed.setCursor({ track: 0, measure: 0, beat: 0, string: 1, ...c }); return say(); };
  at({ beat: 2 });
  eq(at({}), 'Beat 1, string 1, fret 5, dotted quarter, hammer/pull, ghost, vibrato, mf');
  eq(say('ArrowRight'), 'Beat 2, string 1, fret 5, quarter, triplet, bend half, let ring, tied');
  eq(say('ArrowRight'), 'Beat 3, rest, quarter, palm mute');
  eq(say('ArrowLeft', 'ArrowLeft'), 'Beat 1, string 1, fret 5, dotted quarter, hammer/pull, ghost, vibrato, mf');
  eq(say('ArrowDown'), 'String 2, empty');
  eq(say('ArrowUp'), 'String 1, fret 5, hammer/pull, ghost');
  eq(say('ArrowDown', 'ArrowDown', 'ArrowDown'), 'String 4, empty');
  eq(at({ measure: 1, beat: 0, string: 3 }), 'Measure 2, beat 1, string 3, fret 2, whole, dead, pinch harmonic, ff, accent, staccato');
  eq(at({ track: 1 }), 'Track 2 Std, measure 1, beat 1, chord of 2, whole, wide vibrato');
  eq(at({ track: 2, string: 2 }), 'Track 3 Tab, measure 1, beat 1, string 2, fret 2, whole, palm mute');
  ed.destroy();
});

// ---------- empty / hole measures, demo state through the real editor ----------
test('hole and empty measures: every key but X says "No beat here" (and changes nothing); X writes the first beat', () => {
  for (const measures of [[null], [{ beats: [] }], [{}], [{ voices: [{ beats: [] }, { beats: [nt('whole')] }] }]]) {
    const s = sc(tab(measures));
    for (const name of NAMES) {
      const r = go(s, name, cur(0, 0, 0, 2));
      if (name === 'deadNote') { eq(beatsOf(r.score), [{ type: 'note', duration: 'quarter', notes: [{ string: 2, fret: 0, mute: true }] }], J(measures)); ok(sanitizeScore(r.score) === r.score); } else eq([r.changed, r.announce, r.score === s], [false, { id: 'noBeat' }, true], `${name} on ${J(measures)}`);
    }
  }
});
test('demo state through the real editor: effectButtonState follows every key press (toggles pressed, cycle labels) and clears on undo', async () => {
  const { effectButtonState } = await imp('examples/editor-demo-effects.js');
  const { ed, say } = mk(sc(tab([{ beats: [nt('quarter', 1, 5)] }])));
  const st = () => effectButtonState(ed.getCursorInfo());
  const labels = (name, spec, n) => Array.from({ length: n }, () => { say(spec); return st()[name].label ?? st()[name].pressed; });
  eq(labels('bend', 'b', 6), ['Bend: full', 'Bend: half', 'Bend: full and release', 'Bend: pre-bend full', 'Bend: release', 'Bend: off']);
  eq(labels('slide', 's', 3), ['Slide: on', 'Slide: legato', 'Slide: off']);
  eq(labels('vibrato', 'v', 3), ['Vibrato: on', 'Vibrato: wide', 'Vibrato: off']);
  eq(labels('harmonic', 'n', 3), ['Harmonic: natural', 'Harmonic: pinch', 'Harmonic: off']);
  eq(labels('accent', 'a', 3), ['Accent: on', 'Accent: marcato', 'Accent: off']);
  eq(labels('staccato', 'Shift+a', 3), ['Staccato: on', 'Staccato: staccatissimo', 'Staccato: off']);
  eq(labels('louder', 'd', 2), ['Dynamic + (mf)', 'Dynamic + (f)']);
  eq(st().softer.label, 'Dynamic − (f)');
  eq([labels('hammerPull', 'h', 2), labels('deadNote', 'x', 2), labels('ghostNote', 'g', 2), labels('palmMute', 'p', 2), labels('letRing', 'Shift+l', 2)], Array(5).fill([true, false]));
  say('h');
  eq(st().hammerPull, { pressed: true });
  say(key('z', { ctrlKey: true }));
  eq(st().hammerPull, { pressed: false });
  ed.destroy();
});

export async function summary() {
  let fail = 0;
  for (const t of tests) {
    try { await t.fn(); console.log(`PASS editor-effects-edge: ${t.name}`); } catch (e) { fail++; console.log(`FAIL editor-effects-edge: ${t.name}\n  ${e.stack || e.message}`); }
  }
  return fail;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const f = await summary();
  console.log(f ? `\n${f} FAILED` : '\nALL PASSED');
  process.exit(f ? 1 : 0);
}
