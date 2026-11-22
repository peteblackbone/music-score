// 2.1.0 editor effects, pure model level: src/editor/model/effectTable.js, effects.js, the effect commands
// through run(), the digit / dead-note interplay and the keymap letters.
// Run via `node tests/run.js` (calls summary()), or directly: `node tests/editor-effects.mjs`.
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

register('./hooks.mjs', import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const { sanitizeScore } = await imp('src/sanitize.js');
const { bendOf } = await imp('src/directions.js');
const { normalizeBend } = await imp('src/draw/tab.js');
const io = await imp('src/editor/model/io.js');
const A = await imp('src/editor/model/access.js');
const { run, COMMANDS, undoLabel } = await imp('src/editor/model/commands.js');
const { EFFECTS, EFFECT_KEYS, EFFECT_BY_NAME, DYNAMIC_SCALE, SUFFIXES, bendStep } = await imp('src/editor/model/effectTable.js');
const E = await imp('src/editor/model/effects.js');
const cursorMod = await imp('src/editor/model/cursor.js');
const { keyToCommand } = await imp('src/editor/keymap.js');
const { describe, positionText, describeCursor } = await imp('src/editor/announce.js');

const results = [];
const test = (name, fn) => {
  try { fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, msg: e.stack || e.message }); }
};
const J = (o) => JSON.stringify(o);
// structural comparison (key order is not part of the contract)
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
const beatsOf = (s, ti = 0, mi = 0) => A.beatsAt(s, { track: ti, measure: mi });
const ST = { duration: 'quarter', dots: 0, digit: null };
const CTX = { maxFret: 24, now: 1000, twoDigitDelayMs: 800, allowAppend: true };
const go = (s, name, c = cur(0, 0, 0), st = ST, ctx = CTX) => run(name, s, c, st, ctx);
/** Press `name` `n` times at `c`; every result. */
const presses = (s, name, n, c = cur(0, 0, 0)) => {
  const out = [];
  let x = s;
  for (let i = 0; i < n; i++) { const r = go(x, name, c); out.push(r); x = r.score; }
  return out;
};
const pick = (o, fields) => Object.fromEntries(fields.filter((f) => f in o).map((f) => [f, o[f]]));
const NAMES = ['hammerPull', 'slide', 'slideInOut', 'bend', 'bendBack', 'vibrato', 'palmMute', 'deadNote', 'ghostNote', 'harmonic', 'letRing', 'louder', 'softer', 'accent', 'staccato'];
const NOTE_ROWS = NAMES.filter((n) => EFFECT_BY_NAME[n].level === 'note');
const BEAT_ROWS = NAMES.filter((n) => EFFECT_BY_NAME[n].level === 'beat');

// ---------- table ----------
test('table: 15 rows in the documented order, frozen, every row registered as an edit command with its label', () => {
  eq(EFFECTS.map((d) => d.name), NAMES);
  ok(Object.isFrozen(EFFECTS) && EFFECTS.every((d) => Object.isFrozen(d)), 'frozen');
  eq(NOTE_ROWS, ['hammerPull', 'slide', 'slideInOut', 'bend', 'bendBack', 'deadNote', 'ghostNote', 'harmonic']);
  for (const d of EFFECTS) {
    eq([COMMANDS[d.name].kind, COMMANDS[d.name].label], ['edit', d.label], d.name);
    eq(d.say.length, d.steps.length, `${d.name} says each step`);
    ok(d.classify && d.off, d.name);
  }
  eq(DYNAMIC_SCALE, ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff']);
  eq(Object.keys(EFFECT_KEYS).length, 15);
  // the backward rows share the forward row's values, classification and words
  for (const [back, fwd] of [['bendBack', 'bend'], ['softer', 'louder']]) {
    const b = EFFECT_BY_NAME[back], f = EFFECT_BY_NAME[fwd];
    ok(b.reverseOf === fwd && b.dir === -1 && f.dir === 1 && b.steps === f.steps && b.say === f.say && b.classify === f.classify && !b.info && f.info, back);
  }
  eq([EFFECT_BY_NAME.louder.start, EFFECT_BY_NAME.softer.start, EFFECT_BY_NAME.bendBack.start], [DYNAMIC_SCALE.indexOf('mf'), DYNAMIC_SCALE.indexOf('mp'), undefined]);
  eq(EFFECTS.filter((d) => d.reverseOf).map((d) => d.name), ['bendBack', 'softer']);
  eq(Object.fromEntries(Object.entries(SUFFIXES).map(([k, v]) => [k, v.text])), { link: ', no next note on this string', tabArtic: ', not shown on TAB only', noNotation: ', not shown on TAB only' });
  for (const d of EFFECTS) if (d.suffix) ok(Object.hasOwn(SUFFIXES, d.suffix), `${d.name}: suffix ${d.suffix} is in SUFFIXES`);
});
test('nextStep: from none the start (or first / last by direction); then by direction, off past the end', () => {
  const fwd = { steps: [1, 2, 3], dir: 1 };
  const back = { steps: [1, 2, 3], dir: -1 };
  eq([-1, 0, 1, 2].map((i) => E.nextStep(fwd, i)), [0, 1, 2, -1]);
  eq([-1, 0, 1, 2].map((i) => E.nextStep(back, i)), [2, -1, 0, 1]);
  eq(E.nextStep({ ...fwd, start: 1 }, -1), 1);
});

// ---------- AC1: each key cycles; off deletes ----------
const CYCLES = {
  hammerPull: [{ hammerPull: true }, {}],
  slide: [{ slide: true }, { slide: 'legato' }, {}],
  slideInOut: [{ slideIn: 'below' }, { slideIn: 'above' }, { slideOut: 'down' }, { slideOut: 'up' }, {}],
  bend: [...['full', '1/2', 'full release', 'prebend full', 'release'].map((bend) => ({ bend })), {}],
  bendBack: [...['release', 'prebend full', 'full release', '1/2', 'full'].map((bend) => ({ bend })), {}],
  vibrato: [{ vibrato: true }, { vibrato: 'wide' }, {}],
  palmMute: [{ palmMute: true }, {}],
  deadNote: [{ mute: true }, {}],
  ghostNote: [{ ghost: true }, {}],
  harmonic: [{ harmonic: 'natural' }, { harmonic: 'pinch' }, {}],
  letRing: [{ letRing: true }, {}],
  louder: [...['mf', 'f', 'ff', 'fff'].map((dynamic) => ({ dynamic })), {}],
  softer: [...['mp', 'p', 'pp', 'ppp'].map((dynamic) => ({ dynamic })), {}],
  accent: [{ articulations: ['accent'] }, { articulations: ['marcato'] }, {}],
  staccato: [{ articulations: ['staccato'] }, { articulations: ['staccatissimo'] }, {}],
};
const OWNED = ['hammerPull', 'slide', 'slideIn', 'slideOut', 'bend', 'vibrato', 'palmMute', 'mute', 'ghost', 'harmonic', 'letRing', 'dynamic', 'articulations'];
test('AC1: pressing each key repeatedly steps through exactly the listed values; off deletes the key (never false); cursor and duration unchanged', () => {
  const s0 = io.parseInput(sc(tab([{ beats: [nt('quarter', 1, 5, { dots: 1 }), nt('half', 2, 3)] }])));
  for (const name of NAMES) {
    const want = CYCLES[name];
    const rs = presses(s0, name, want.length * 2);
    const steps = [E.nextStep(EFFECT_BY_NAME[name], -1)];
    while (steps[steps.length - 1] >= 0) steps.push(E.nextStep(EFFECT_BY_NAME[name], steps[steps.length - 1]));
    eq(steps.length, want.length, `${name}: steps`);
    rs.forEach((r, i) => {
      const b = beatsOf(r.score)[0];
      const target = EFFECT_BY_NAME[name].level === 'note' ? b.notes[0] : b;
      eq(pick(target, OWNED), want[i % want.length], `${name} press ${i + 1}`);
      ok(!J(r.score).includes('false'), `${name}: never writes false`);
      ok(r.changed && !r.moved && J(r.cursor) === J(cur(0, 0, 0)), `${name}: changed, cursor kept`);
      eq([r.state.duration, r.state.dots], ['quarter', 1], `${name}: duration`);
      ok(sanitizeScore(r.score) === r.score, `${name} press ${i + 1}: sanitize-stable`);
      eq([r.announce.id, r.announce.name, r.announce.step], ['effect', name, steps[i % want.length]], `${name} announce`);
    });
    ok(beatsOf(rs[rs.length - 1].score)[1] === beatsOf(s0)[1], `${name}: other beat kept`);
  }
});

// ---------- AC2: chord identity ----------
test('AC2: in a chord only the note on the cursor string changes; the other notes, beats, measures and tracks keep their identity', () => {
  const s = sc(tab([{ beats: [{ type: 'note', duration: 'half', notes: [{ string: 1, fret: 3 }, { string: 2, fret: 5 }, { string: 3, fret: 7 }] }, nt('half')] }, { beats: [nt('whole')] }]), tab([{ beats: [nt('whole')] }]));
  for (const name of NOTE_ROWS) {
    const r = go(s, name, cur(0, 0, 0, 2));
    const [b0, b1] = beatsOf(r.score);
    const old = beatsOf(s)[0].notes;
    ok(b0.notes[0] === old[0] && b0.notes[2] === old[2], `${name}: other chord notes kept`);
    ok(b0.notes[1] !== old[1], `${name}: the cursor note changed`);
    ok(b1 === beatsOf(s)[1] && r.score.tracks[0].measures[1] === s.tracks[0].measures[1] && r.score.tracks[1] === s.tracks[1], `${name}: rest of the score kept`);
  }
  const r = go(s, 'palmMute', cur(0, 0, 0, 2));
  ok(beatsOf(r.score)[0].notes === beatsOf(s)[0].notes, 'a beat effect keeps the notes array');
});

// ---------- AC3: labels; the old model is never mutated ----------
test('AC3: undo labels are as listed (static per row) and an effect never mutates the model it started from', () => {
  const want = {
    hammerPull: 'hammer-on/pull-off', slide: 'slide', slideInOut: 'slide in/out', bend: 'bend', bendBack: 'bend', vibrato: 'vibrato', palmMute: 'palm mute',
    deadNote: 'dead note', ghostNote: 'ghost note', harmonic: 'harmonic', letRing: 'let ring', louder: 'dynamic', softer: 'dynamic', accent: 'accent', staccato: 'staccato',
  };
  for (const name of NAMES) eq([undoLabel(name, { id: 'effect', name, step: 0 }), undoLabel(name, { id: 'effect', name, step: -1 })], [want[name], want[name]], name);
  eq(undoLabel('deadNote', { id: 'effect', name: 'deadNote', added: true }), 'dead note');
  const s = sc(tab([{ beats: [nt('quarter'), rest('quarter')] }, { beats: [] }]));
  const json = J(s);
  for (const name of NAMES) for (const c of [cur(0, 0, 0), cur(0, 0, 1), cur(0, 1, 0)]) go(s, name, c);
  eq(J(s), json, 'input untouched');
});

// ---------- AC4: refusals ----------
test('AC4: refusal matrix — notation-only (needsTab, X too), slot (noBeat), rest and empty string (noNoteHere / needsNote); refusals change nothing', () => {
  const s = sc(
    tab([{ beats: [nt('quarter', 1, 5), rest('quarter')] }]),
    notation([{ beats: [{ type: 'note', duration: 'whole', notes: [{ pitch: 'C4' }] }] }]),
  );
  const refused = (name, c, id) => {
    const r = go(s, name, c);
    eq([r.changed, r.announce], [false, { id }], `${name} at ${J(c)}`);
    ok(r.score === s, `${name}: same model`);
  };
  for (const name of NOTE_ROWS) refused(name, cur(1, 0, 0), 'needsTab');
  for (const name of NOTE_ROWS.filter((n) => n !== 'deadNote')) {
    refused(name, cur(0, 0, 2), 'noBeat');
    refused(name, cur(0, 0, 1), 'noNoteHere');
    refused(name, cur(0, 0, 0, 4), 'noNoteHere');
  }
  for (const name of BEAT_ROWS) refused(name, cur(0, 0, 2), 'noBeat');
  for (const name of ['vibrato', 'letRing', 'accent', 'staccato']) refused(name, cur(0, 0, 1), 'needsNote');
  for (const name of ['palmMute', 'louder', 'softer']) ok(go(s, name, cur(0, 0, 1)).changed, `${name} works on a rest`);
  for (const name of BEAT_ROWS) ok(go(s, name, cur(0, 0, 0, 4)).changed, `${name} works with an empty cursor string`);
});

// ---------- AC5: X adds a dead note ----------
test('AC5: X on the slot, a rest and an empty string writes {string, fret: 0, mute: true} through the digit path (current duration, hidden dropped)', () => {
  const s = sc(tab([{ beats: [nt('quarter', 1, 5), rest('quarter', { hidden: true, dynamic: 'p', zz: 1 })] }]));
  const slot = go(s, 'deadNote', cur(0, 0, 2, 3), { duration: '8th', dots: 1, digit: null });
  eq(beatsOf(slot.score)[2], { type: 'note', duration: '8th', dots: 1, notes: [{ string: 3, fret: 0, mute: true }] });
  eq([slot.changed, slot.cursor, slot.announce], [true, cur(0, 0, 2, 3), { id: 'effect', name: 'deadNote', added: true }]);
  const r = go(s, 'deadNote', cur(0, 0, 1, 2));
  eq(beatsOf(r.score)[1], { type: 'note', duration: 'quarter', dynamic: 'p', zz: 1, notes: [{ string: 2, fret: 0, mute: true }] });
  const chord = go(s, 'deadNote', cur(0, 0, 0, 6));
  eq(beatsOf(chord.score)[0].notes, [{ string: 1, fret: 5 }, { string: 6, fret: 0, mute: true }]);
  ok(beatsOf(chord.score)[0].notes[0] === beatsOf(s)[0].notes[0], 'existing note kept');
  eq(chord.announce, { id: 'effect', name: 'deadNote', added: true });
  const empty = go(sc(tab([{ beats: [] }])), 'deadNote', cur(0, 0, 0, 1));
  eq(beatsOf(empty.score), [{ type: 'note', duration: 'quarter', notes: [{ string: 1, fret: 0, mute: true }] }]);
  ok(sanitizeScore(empty.score) === empty.score);
});
test('AC5: X next to ties repairs the seams like a digit (a dangling tieStart before a rest or the slot is removed; other strings kept)', () => {
  const s = sc(tab([
    { beats: [tn('half', 1, 5, { tieStart: true }), rest('quarter')] },
    { beats: [{ type: 'note', duration: 'half', notes: [{ string: 1, fret: 3, tieStart: true }, { string: 2, fret: 4, tieStart: true }] }] },
    { beats: [tn('whole', 2, 4, { tieEnd: true })] },
  ]));
  const r = go(s, 'deadNote', cur(0, 0, 1, 1));
  eq(beatsOf(r.score)[0].notes[0], { string: 1, fret: 5 }, 'tieStart into the new note removed');
  eq(beatsOf(r.score)[1].notes, [{ string: 1, fret: 0, mute: true }]);
  for (const c of [cur(0, 0, 1, 1), cur(0, 1, 1, 2), cur(0, 1, 0, 3)]) {
    const d = run('digit', s, c, ST, CTX, 0).score;
    eq(go(s, 'deadNote', c).score, A.updateNote(d, c, (n) => ({ ...n, mute: true })), `X = digit 0 + mute at ${J(c)}`);
  }
  const slot = go(s, 'deadNote', cur(0, 1, 1, 2)).score;
  eq([beatsOf(slot, 0, 1)[0].notes, beatsOf(slot, 0, 2)[0].notes], [[{ string: 1, fret: 3 }, { string: 2, fret: 4 }], [{ string: 2, fret: 4 }]], 'ties broken by the new beat are removed on both sides');
  const x = go(s, 'deadNote', cur(0, 0, 0, 1));
  eq(beatsOf(x.score)[0].notes[0], { string: 1, fret: 5, tieStart: true, mute: true }, 'a tied note can be muted in place');
});

// ---------- AC6: digits clear mute ----------
test('AC6: a digit on a muted note writes the fret and removes mute: the same fret, a different fret, and a two-digit fret', () => {
  const s = sc(tab([{ beats: [tn('quarter', 1, 5, { mute: true, zz: 1 }), nt('quarter')] }]));
  const rs = run('digit', s, cur(0, 0, 0), ST, CTX, 5);
  eq(beatsOf(rs.score)[0].notes[0], { string: 1, fret: 5, zz: 1 });
  ok(rs.changed, 'the same fret is a change (mute cleared)');
  const rd = run('digit', s, cur(0, 0, 0), ST, CTX, 7);
  eq(beatsOf(rd.score)[0].notes[0], { string: 1, fret: 7, zz: 1 });
  const x = go(sc(tab([{ beats: [] }])), 'deadNote', cur(0, 0, 0, 2));
  const d1 = run('digit', x.score, x.cursor, x.state, { ...CTX, now: 2000 }, 1);
  const d2 = run('digit', d1.score, d1.cursor, d1.state, { ...CTX, now: 2100 }, 2);
  eq([beatsOf(d1.score)[0].notes[0], beatsOf(d2.score)[0].notes[0], d2.coalesce], [{ string: 2, fret: 1 }, { string: 2, fret: 12 }, true]);
  const plain = sc(tab([{ beats: [nt('quarter', 1, 5)] }]));
  ok(run('digit', plain, cur(0, 0, 0), ST, CTX, 5).score === plain, 'the same fret on an unmuted note is still no change');
});

// ---------- AC7: exclusions ----------
test('AC7: H removes slide; S (on) removes hammerPull; X removes harmonic; N removes mute; Shift+S never touches slide', () => {
  const at = (flags, name) => beatsOf(go(sc(tab([{ beats: [tn('quarter', 1, 5, flags)] }])), name).score)[0].notes[0];
  eq(at({ slide: 'legato' }, 'hammerPull'), { string: 1, fret: 5, hammerPull: true });
  eq(at({ hammerPull: 'h' }, 'slide'), { string: 1, fret: 5, slide: true });
  eq(at({ harmonic: 'pinch', harmonicFret: 17 }, 'deadNote'), { string: 1, fret: 5, harmonicFret: 17, mute: true });
  eq(at({ mute: true }, 'harmonic'), { string: 1, fret: 5, harmonic: 'natural' });
  eq(at({ slide: true, slideIn: 'below' }, 'slideInOut'), { string: 1, fret: 5, slide: true, slideIn: 'above' });
  eq(at({ slide: 'legato', hammerPull: true }, 'slide'), { string: 1, fret: 5, hammerPull: true }, 'turning a slide off does not touch hammerPull');
  eq(at({ hammerPull: true, slide: true }, 'hammerPull'), { string: 1, fret: 5, slide: true }, 'H off does not touch slide');
  eq(at({ slideIn: 'below', slideOut: 'up' }, 'slideInOut'), { string: 1, fret: 5, slideIn: 'below' }, 'both fields = custom → step 1');
});
test('AC7 / AC1: custom values count as none — the next press writes step 1 (Shift+B: the last); truthy unknowns follow the renderer', () => {
  const at = (flags, name) => beatsOf(go(sc(tab([{ beats: [tn('quarter', 1, 5, flags)] }])), name).score)[0].notes[0];
  const bt = (fields, name) => beatsOf(go(sc(tab([{ beats: [nt('quarter', 1, 5, fields)] }])), name).score)[0];
  eq(at({ slide: 'up' }, 'slide').slide, true);
  eq(at({ slide: ' LEGATO ' }, 'slide').slide, undefined, 'legato in any case → off');
  eq(at({ hammerPull: 'p' }, 'hammerPull').hammerPull, undefined);
  eq(at({ slideIn: 'up' }, 'slideInOut').slideIn, 'above', "'up' = below");
  eq(at({ slideOut: true }, 'slideInOut'), { string: 1, fret: 5, slideOut: 'up' }, 'true = down');
  eq(at({ harmonic: 'artificial' }, 'harmonic').harmonic, 'natural', 'other kinds: custom');
  eq(at({ harmonic: true }, 'harmonic').harmonic, 'pinch', 'true counts as natural');
  eq(at({ harmonic: 'bogus' }, 'harmonic').harmonic, 'pinch', 'an unknown string is drawn natural');
  eq(bt({ vibrato: 'WIDE' }, 'vibrato').vibrato, undefined, 'wide in any case → off');
  eq(bt({ vibrato: 'x' }, 'vibrato').vibrato, 'wide', 'other truthy → wide');
  eq(bt({ palmMute: 'yes' }, 'palmMute').palmMute, undefined);
  eq(bt({ letRing: 1 }, 'letRing').letRing, undefined);
});

// ---------- AC8: bends ----------
test('AC8: B classifies with normalizeBend (true = full, pb full = prebend full); custom values step to full, Shift+B to release', () => {
  const b = (bend, name = 'bend') => beatsOf(go(sc(tab([{ beats: [tn('quarter', 1, 5, { bend })] }])), name).score)[0].notes[0].bend;
  eq([true, 'Full', ' full ', '1/2', 'full release', 'FULL Release', 'pb full', 'pre-bend full', 'prebend full', 'release', 'Release'].map((v) => b(v)),
    ['1/2', '1/2', '1/2', 'full release', 'prebend full', 'prebend full', 'release', 'release', 'release', undefined, undefined]);
  eq(['half', '1/4', '1/2 hold', 'full hold', 'full release full', 'pb full release', 'release 1/2', 'prebend 1/2', '1/2 release'].map((v) => b(v)), Array(9).fill('full'), 'custom → full');
  eq(['half', 'full release full', 'release 1/2'].map((v) => b(v, 'bendBack')), Array(3).fill('release'), 'custom → release backwards');
  eq([true, 'release', 'prebend full', '1/2'].map((v) => b(v, 'bendBack')), [undefined, 'prebend full', 'full release', 'full']);
});
test('AC8: normalizeBend (draw/tab.js) is bendOf, and agrees on every value the editor writes or classifies', () => {
  const vals = [true, 'full', '1/2', 'full release', 'prebend full', 'release', 'Full', 'pb full', 'pre-bend full', 'half', 'release 1/2', 'full release full', '1/2 hold', { type: 'pb', amount: 'full' }];
  for (const v of vals) eq(normalizeBend(v), bendOf(v), J(v));
  eq(['full', '1/2', 'full release', 'prebend full', 'release'].map(bendStep), [0, 1, 2, 3, 4]);
  eq([null, undefined, '', false, 0].map(bendStep), [-1, -1, -1, -1, -1]);
});

// ---------- AC9: dynamics ----------
test('AC9: D / Shift+D give mf / mp from nothing, one step per press, remove past fff / ppp; sfz, rfz, n and custom text count as nothing; rests work', () => {
  const d = (dynamic, name, type = 'note') => {
    const beat = type === 'rest' ? rest('quarter', dynamic === undefined ? {} : { dynamic }) : nt('quarter', 1, 0, dynamic === undefined ? {} : { dynamic });
    return beatsOf(go(sc(tab([{ beats: [beat] }])), name).score)[0].dynamic;
  };
  eq([d(undefined, 'louder'), d(undefined, 'softer')], ['mf', 'mp']);
  eq([d('fff', 'louder'), d('ppp', 'softer'), d('ppp', 'louder'), d('fff', 'softer')], [undefined, undefined, 'pp', 'ff']);
  eq(['sfz', 'rfz', 'n', 'F', 'cresc.', ''].map((v) => d(v, 'louder')), Array(6).fill('mf'));
  eq(['sfz', 'n'].map((v) => d(v, 'softer')), ['mp', 'mp']);
  eq([d(' f ', 'louder'), d('mf', 'softer')], ['ff', 'mp']);
  eq([d(undefined, 'louder', 'rest'), d('p', 'softer', 'rest')], ['mf', 'pp']);
});

// ---------- AC10: articulations ----------
test('AC10: A / Shift+A keep other entries in order, append the new one, count heavyAccent as marcato, delete an empty array and replace a non-array', () => {
  const a = (articulations, name) => beatsOf(go(sc(tab([{ beats: [nt('quarter', 1, 0, articulations === undefined ? {} : { articulations })] }])), name).score)[0].articulations;
  eq(a(['tenuto', 'accent', 'staccato'], 'accent'), ['tenuto', 'staccato', 'marcato']);
  eq(a(['tenuto', 'staccato', 'marcato'], 'accent'), ['tenuto', 'staccato']);
  eq(a(['heavyAccent', 'tenuto'], 'accent'), ['tenuto'], 'heavyAccent = marcato → off');
  eq(a(['accent', 'heavyAccent'], 'accent'), undefined, 'marcato wins; the whole group goes');
  eq(a(['marcato'], 'accent'), undefined, 'empty array deleted');
  eq(a(['marcato'], 'staccato'), ['marcato', 'staccato']);
  eq(a(['staccato', 'fermata'], 'staccato'), ['fermata', 'staccatissimo']);
  eq(a(['staccatissimo'], 'staccato'), undefined);
  eq([a('accent', 'accent'), a({ x: 1 }, 'staccato'), a(undefined, 'accent')], [['accent'], ['staccato'], ['accent']], 'non-array = []');
  const s = sc(tab([{ beats: [nt('quarter', 1, 0, { articulations: ['tenuto', 5, 'accent'] })] }]));
  eq(beatsOf(go(s, 'accent').score)[0].articulations, ['tenuto', 5, 'marcato'], 'non-string entries kept in place');
});

// ---------- AC11: notation-only ----------
test('AC11: on a notation-only track the beat effects work (also on chords without strings) and the note effects say "needs a TAB staff"', () => {
  const s = io.parseInput(sc(notation([{ beats: [{ type: 'note', duration: 'whole', notes: [{ pitch: 'C4' }, { pitch: 'E4' }] }] }])));
  for (const name of BEAT_ROWS) {
    const r = go(s, name);
    ok(r.changed && sanitizeScore(r.score) === r.score, name);
    ok(beatsOf(r.score)[0].notes === beatsOf(s)[0].notes, `${name}: notes kept`);
  }
  for (const name of NOTE_ROWS) eq(go(s, name).announce, { id: 'needsTab' }, name);
});

// ---------- AC12: suffixes ----------
test('AC12: H / S speak "no next note on this string" when voice 1 has no later note on the string in the track (across measures, graces count, voice 2 does not)', () => {
  const s = sc(tab([
    { beats: [nt('quarter', 1, 5), nt('quarter', 2, 7), nt('half', 3, 0)] },
    { voices: [{ beats: [nt('half', 4, 2), grace(3, 1), nt('half', 4, 0)] }, { beats: [nt('whole', 2, 9)] }] },
    { beats: [] },
  ]), tab([{ beats: [nt('whole', 1, 1)] }]));
  const sfx = (name, c, score = s) => go(score, name, c).announce.suffix;
  eq(sfx('hammerPull', cur(0, 0, 0, 1)), 'link', 'string 1 never comes back in this track (track 2 does not count)');
  eq(sfx('hammerPull', cur(0, 0, 1, 2)), 'link', 'string 2 only in voice 2 later');
  eq(sfx('hammerPull', cur(0, 0, 2, 3)), null, 'a grace on string 3 in the next measure is a target');
  eq(sfx('slide', cur(0, 1, 0, 4)), null, 'next note on string 4 in the same measure');
  eq(sfx('slide', cur(0, 1, 2, 4)), 'link', 'the last note');
  const on = go(s, 'hammerPull', cur(0, 0, 0, 1)).score;
  eq(go(on, 'hammerPull', cur(0, 0, 0, 1)).announce, { id: 'effect', name: 'hammerPull', step: -1, suffix: null }, 'none when turning off');
  const sl = go(s, 'slide', cur(0, 0, 0, 1));
  eq([sl.announce.suffix, go(sl.score, 'slide', cur(0, 0, 0, 1)).announce.suffix], ['link', 'link'], 'legato is on too');
  eq(E.noLaterNoteOnString(s, cur(0, 0, 2, 3)), false);
});
test('AC12: A / Shift+A speak "not shown on TAB only" on a TAB-only track without tabArticulations; D / Shift+D on any track without notation', () => {
  const tracks = [tabOnly([{ beats: [nt('whole')] }]), tabOnly([{ beats: [nt('whole')] }], { tabArticulations: true }), tab([{ beats: [nt('whole')] }]), notation([{ beats: [{ type: 'note', duration: 'whole', notes: [{ pitch: 'C4' }] }] }])];
  const s = sc(...tracks);
  const sfx = (name, ti, score = s) => go(score, name, cur(ti, 0, 0)).announce.suffix;
  eq([0, 1, 2, 3].map((ti) => sfx('accent', ti)), ['tabArtic', null, null, null]);
  eq([0, 1, 2, 3].map((ti) => sfx('staccato', ti)), ['tabArtic', null, null, null]);
  eq([0, 1, 2, 3].map((ti) => sfx('louder', ti)), ['noNotation', 'noNotation', null, null]);
  eq([0, 1, 2, 3].map((ti) => sfx('softer', ti)), ['noNotation', 'noNotation', null, null]);
  const marc = go(go(s, 'accent').score, 'accent').score;
  eq([go(marc, 'accent').announce.step, go(marc, 'accent').announce.suffix], [-1, null], 'none when turning off');
  const fff = sc(tabOnly([{ beats: [nt('whole', 1, 0, { dynamic: 'fff' })] }]));
  eq(go(fff, 'louder').announce.suffix, null);
  for (const name of ['palmMute', 'vibrato', 'bend', 'deadNote']) eq(go(s, name).announce.suffix, null, name);
});

// ---------- AC14: unknown fields ----------
test('AC14: unknown fields survive every effect command at every step (score, track, measure, beat, note) and on X', () => {
  const s = sc(tab([{ zzMeasure: 1, beats: [{ type: 'note', duration: 'quarter', zzBeat: 'x', notes: [{ string: 1, fret: 2, zzNote: 1 }, { string: 2, fret: 2, zzNote: 2 }] }, rest('quarter', { zzRest: 1 })] }], { zzTrack: true }));
  s.zzScore = { deep: true };
  for (const name of NAMES) {
    let x = s;
    for (let i = 0; i < 7; i++) {
      x = go(x, name).score;
      const out = J(x);
      for (const k of ['zzScore', 'zzTrack', 'zzMeasure', 'zzBeat', 'zzNote', 'zzRest']) ok(out.includes(`"${k}"`), `${name} press ${i + 1}: ${k} kept`);
    }
  }
  const x = go(s, 'deadNote', cur(0, 0, 1, 3)).score;
  eq(beatsOf(x)[1], { type: 'note', duration: 'quarter', zzRest: 1, notes: [{ string: 3, fret: 0, mute: true }] });
});

// ---------- effect words ----------
test('effectWords: note words (TAB, a note on the string) then beat words, in table order; empty on the slot; beat words only on rests and empty strings', () => {
  const note = { string: 1, fret: 5, hammerPull: 'p', slide: 'legato', slideIn: 'up', slideOut: true, bend: 'pb full', mute: true, ghost: true, harmonic: 'pinch' };
  const beat = { type: 'note', duration: 'quarter', vibrato: 'WIDE', palmMute: true, letRing: true, dynamic: ' mf ', articulations: ['heavyAccent', 'staccato', 'marcato', 'tenuto', 5], notes: [note] };
  const s = sc(tab([{ beats: [beat, rest('quarter', { palmMute: true, dynamic: 'p' }), tn('half', 2, 3, { bend: 'half', hammerPull: 'H' }, { vibrato: true })] }]), notation([{ beats: [{ ...beat, notes: [{ pitch: 'C4', bend: 'full' }] }] }]));
  const BEAT = ['wide vibrato', 'palm mute', 'let ring', 'mf', 'marcato', 'staccato', 'tenuto'];
  eq(E.effectWords(s, cur(0, 0, 0)), { note: ['pull-off', 'legato slide', 'slide in', 'slide out', 'bend pre-bend full', 'dead', 'ghost', 'pinch harmonic'], beat: BEAT });
  eq(E.effectWords(s, cur(0, 0, 0, 3)), { note: [], beat: BEAT }, 'empty string');
  eq(E.effectWords(s, cur(0, 0, 1)), { note: [], beat: ['palm mute', 'p'] }, 'rest');
  eq(E.effectWords(s, cur(0, 0, 2, 2)), { note: ['hammer-on', 'bend'], beat: ['vibrato'] }, 'custom bend = "bend"');
  eq(E.effectWords(s, cur(0, 0, 3)), { note: [], beat: [] }, 'slot');
  eq(E.effectWords(s, cur(1, 0, 0)), { note: [], beat: BEAT }, 'notation-only: beat words only');
  const words = (flags) => E.effectWords(sc(tab([{ beats: [tn('quarter', 1, 0, flags)] }])), cur(0, 0, 0)).note;
  eq([words({ hammerPull: true }), words({ bend: true }), words({ bend: '1/2' }), words({ bend: 'full release' }), words({ bend: 'release' }), words({ harmonic: true }), words({ slide: 'up' })],
    [['hammer/pull'], ['bend full'], ['bend half'], ['bend full and release'], ['bend release'], ['natural harmonic'], ['slide']]);
});

test('effectState / cursorInfo: steps per present effect (-1 = custom), backward rows covered by the forward row; beatEffects; effectWords unchanged', () => {
  const C = cursorMod;
  const s = sc(tab([{ beats: [
    tn('quarter', 1, 5, { hammerPull: 'h', bend: 'half', harmonic: 'artificial' }, { vibrato: 'x', dynamic: 'sfz', articulations: ['accent', 'staccatissimo', 'tenuto'] }),
    rest('quarter', { palmMute: true, dynamic: 'mp' }),
  ] }]), notation([{ beats: [{ type: 'note', duration: 'whole', letRing: true, notes: [{ pitch: 'C4', mute: true }] }] }]));
  const st = E.effectState(s, cur(0, 0, 0));
  eq(st.steps, { hammerPull: 0, bend: -1, harmonic: -1, vibrato: 0, louder: -1, accent: 0, staccato: 1 });
  eq([st.note, st.beat], [['hammer-on', 'bend', 'artificial harmonic'], ['vibrato', 'sfz', 'accent', 'staccatissimo', 'tenuto']]);
  eq(E.effectWords(s, cur(0, 0, 0)), { note: st.note, beat: st.beat });
  eq(E.effectState(s, cur(0, 0, 1)).steps, { palmMute: 0, louder: 3 }, 'rest: beat rows only');
  eq(E.effectState(s, cur(0, 0, 2)), { note: [], beat: [], steps: {} }, 'slot');
  eq(E.effectState(s, cur(1, 0, 0)).steps, { letRing: 0 }, 'notation-only: no note rows');
  const info = C.cursorInfo(s, cur(0, 0, 0), ST);
  eq([info.effects, info.noteEffects, info.beatEffects, info.effectSteps], [[...st.note, ...st.beat], st.note, st.beat, st.steps]);
  const none = E.effectState(sc(tab([{ beats: [tn('quarter', 1, 5, {}, { articulations: ['tenuto'] })] }])), cur(0, 0, 0));
  eq([none.steps, none.beat], [{}, ['tenuto']], 'other articulations: neither accent nor staccato is present');
  eq(E.effectState(sc(tab([{ beats: [tn('quarter', 1, 5, { slide: 'up', slideIn: 'x' })] }])), cur(0, 0, 0)).steps, { slide: -1 }, 'custom slide present; an unreadable slideIn lists no words and is absent');
});

// ---------- sanitize identity over every key on every kind of start ----------
{
  const { leadRiff } = await imp('examples/lead-riff.js');
  const { leadSoloF } = await imp('examples/lead-solo-f.js');
  const { exampleScore } = await imp('examples/example-score.js');
  test('sanitize: every effect key at every position of lead-riff, lead-solo-f and example-score keeps sanitizeScore(model) === model', () => {
    let edits = 0;
    for (const src of [leadRiff, leadSoloF, exampleScore]) {
      const s = io.parseInput(src);
      s.tracks.forEach((t, ti) => A.measuresOf(t).forEach((m, mi) => A.beatsOf(m).forEach((b, bi) => {
        if (b.type === 'grace') return;
        for (const name of NAMES) {
          const r = go(s, name, cur(ti, mi, bi, A.notesOf(b)[0]?.string ?? 1));
          if (r.changed) edits++;
          if (sanitizeScore(r.score) !== r.score) throw new Error(`${name} at ${ti}/${mi}/${bi}: sanitize changed the model`);
        }
      })));
    }
    ok(edits > 500, `${edits} edits`);
  });
}

// ---------- AC16: keymap ----------
const K = (key, mods = {}) => keyToCommand({ key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods });
test('AC16: the 15 effect keys map to their commands (either case without Shift = Caps Lock); Alt, Ctrl, Cmd, F-keys and Tab stay unconsumed', () => {
  const rows = [['h', 'hammerPull'], ['s', 'slide'], ['S+', 'slideInOut'], ['b', 'bend'], ['B+', 'bendBack'], ['v', 'vibrato'], ['p', 'palmMute'], ['x', 'deadNote'],
    ['g', 'ghostNote'], ['n', 'harmonic'], ['L+', 'letRing'], ['d', 'louder'], ['D+', 'softer'], ['a', 'accent'], ['A+', 'staccato']];
  for (const [k, name] of rows) {
    const shiftKey = k.endsWith('+');
    const letter = k[0];
    eq(K(letter, { shiftKey }), { name }, k);
    eq(K(shiftKey ? letter.toLowerCase() : letter.toUpperCase(), { shiftKey }), { name }, `${k} with Caps Lock`);
    for (const mods of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true, shiftKey: true }, { ctrlKey: true, shiftKey: true }]) eq(K(letter, { shiftKey, ...mods }), letter === 'a' && !shiftKey && !mods.altKey && !mods.shiftKey ? { name: 'selectAll' } : null, `${k} ${J(mods)}`); // 2.3: Ctrl+A selects all
  }
  eq(new Set(rows.map(([, n]) => n)).size, 15);
  eq(Object.entries(EFFECT_KEYS).map(([k, n]) => `${k}=${n}`).sort(), rows.map(([k, n]) => `${k.endsWith('+') ? `Shift+${k[0].toLowerCase()}` : k}=${n}`).sort());
  eq([K('Tab'), K('Tab', { shiftKey: true }), K('F1'), K('F12', { shiftKey: true }), K('h', { isComposing: true })], [null, null, null, null, null]);
  eq([K('r'), K('l'), K('i'), K('m'), K('M', { shiftKey: true })].map((c) => c.name), ['toggleRest', 'toggleTie', 'insertBeat', 'insertMeasureAfter', 'insertMeasureBefore'], '2.0 letters unchanged');
  eq([K('R', { shiftKey: true }), K('I', { shiftKey: true }), K('H', { shiftKey: true }), K('N', { shiftKey: true })], [null, null, null, null]);
});

// ---------- announce ----------
test('announce: effect descriptors in words (added / step / off, suffixes), needsNote, and effects in position text (missing lists speak nothing)', () => {
  eq(describe({ id: 'effect', name: 'bend', step: 1, suffix: null }), 'Bend half');
  eq(describe({ id: 'effect', name: 'bendBack', step: -1, suffix: null }), 'Bend off');
  eq(describe({ id: 'effect', name: 'deadNote', added: true }), 'Dead note added');
  eq(describe({ id: 'effect', name: 'slide', step: 0, suffix: 'link' }), 'Slide, no next note on this string');
  eq([describe({ id: 'effect', name: 'accent', step: 0, suffix: 'tabArtic' }), describe({ id: 'effect', name: 'softer', step: 3, suffix: 'noNotation' })], ['Accent, not shown on TAB only', 'Dynamic mp, not shown on TAB only']);
  eq([describe({ id: 'effect', name: 'nope', step: 0 }), describe({ id: 'needsNote' })], ['', 'Needs a note']);
  for (const d of EFFECTS) d.say.forEach((w, i) => eq(describe({ id: 'effect', name: d.name, step: i, suffix: null }), w));
  const info = { beatNumber: 2, string: 1, fret: 3, duration: 'quarter', dots: 0, triplet: false, isRest: false, appendSlot: false, hasTab: true, tied: true, noteCount: 1 };
  eq(positionText(info), 'beat 2, string 1, fret 3, quarter, tied', 'a 2.0-shaped info');
  eq(positionText({ ...info, effects: ['bend full', 'vibrato'] }), 'beat 2, string 1, fret 3, quarter, bend full, vibrato, tied');
  eq(positionText({ ...info, isRest: true, effects: ['palm mute'] }), 'beat 2, rest, quarter, palm mute');
  eq(positionText({ ...info, hasTab: false, effects: ['mf'] }), 'beat 2, note, quarter, mf');
  eq(positionText({ ...info, appendSlot: true, empty: true, effects: [] }), 'empty measure');
  const prev = { ...info, track: 0, measure: 0, beat: 1 };
  eq(describeCursor({ ...prev, string: 2, effects: ['ghost', 'vibrato'], noteEffects: ['ghost'] }, prev), 'String 2, fret 3, ghost');
});

// ---------- inherited-property names in score values and keys ----------
const PROTO_NAMES = ['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty', 'isPrototypeOf'];
const { durationWords } = await imp('src/editor/model/durations.js');
const demo = await imp('examples/editor-demo.js');
test('object-keyed lookups: score values and event keys named like Object.prototype members never find inherited properties', () => {
  for (const v of PROTO_NAMES) {
    const note = { string: 1, fret: 0, hammerPull: v, slide: v, slideIn: v, slideOut: v, bend: v, harmonic: v, mute: v, ghost: v };
    const beat = { type: 'note', duration: 'quarter', vibrato: v, palmMute: v, letRing: v, dynamic: v, articulations: [v], notes: [note] };
    const w = E.effectWords(sc(tab([{ beats: [beat] }])), cur(0, 0, 0));
    ok([...w.note, ...w.beat].every((x) => typeof x === 'string'), `${v}: every effect word is a string (${J([...w.note, ...w.beat])})`);
    eq(w.note[0], 'hammer/pull', `${v}: hammerPull`);
    eq(w.beat.includes(v), true, `${v}: dynamic / articulation shown as the string`);
    for (const name of NAMES) {
      const r = go(sc(tab([{ beats: [beat] }])), name);
      ok(r.changed && sanitizeScore(r.score) === r.score, `${v}: ${name} runs`);
    }
    eq(K(v), null, `key ${v}`);
    eq([K(v, { ctrlKey: true }), K(v, { shiftKey: true })], [null, null], `key ${v} with modifiers`);
    eq(durationWords(v), v, `durationWords(${v})`);
    eq(describe({ id: v }), '', `describe id ${v}`);
    eq(describe({ id: 'effect', name: v, step: 0 }), '', `describe effect ${v}`);
    eq(demo.newScore({ preset: v }).tracks[0].tuning, ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], `preset ${v}`);
  }
});

// ---------- report ----------
export function summary() {
  let fail = 0;
  for (const r of results) {
    if (r.ok) console.log(`PASS editor-effects: ${r.name}`);
    else { fail++; console.log(`FAIL editor-effects: ${r.name}\n  ${r.msg}`); }
  }
  return fail;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const f = summary();
  console.log(f ? `\n${f} FAILED` : '\nALL PASSED');
  process.exit(f ? 1 : 0);
}
