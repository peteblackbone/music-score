// 2.0.0 editor edge cases against the acceptance criteria, controller level (ScoreEditor under the DOM shim).
// Complements tests/editor-dom.mjs: loadScore atomicity for every limit, schemaVersion, deep-clone independence,
// every public method after destroy, read-only for every edit key, handleKey for every row of the key table (D1),
// history cap with two-digit coalescing, exact undo of mixed sequences, multiMeasureRests view copy, tracks of every
// kind, fill announcements and bands, unknown fields, the title in the aria-label.
// Run via `node tests/run.js` (awaits summary()), or directly: `node tests/editor-edge-dom.mjs`.
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

register('./hooks.mjs', import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const { makeContainer, serialize } = await import('./dom-shim.mjs');
const { makeClock } = await import('./editor-shim.mjs');
const { ScoreEditor } = await imp('src/editor/ScoreEditor.js');
const { sanitizeScore } = await imp('src/sanitize.js');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const J = (o) => JSON.stringify(o);
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const eq = (a, b, m = '') => {
  const x = J(canon(a)), y = J(canon(b));
  if (x !== y) throw new Error(`${m} expected ${y}, got ${x}`);
};
const ok = (c, m = 'assertion failed') => { if (!c) throw new Error(m); };
const clone = (o) => JSON.parse(J(o));
const nt = (duration, string = 1, fret = 0, extra = {}) => ({ type: 'note', duration, notes: [{ string, fret }], ...extra });
const tn = (duration, string, fret, flags = {}) => ({ type: 'note', duration, notes: [{ string, fret, ...flags }] });
const rest = (duration = 'quarter', extra = {}) => ({ type: 'rest', duration, ...extra });
const tab = (measures, extra = {}) => ({ name: 'Gtr', showTablature: true, ...extra, measures });
const key = (k, mods = {}) => ({ key: k, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods });
const CTRL = { ctrlKey: true };
const SHIFT = { shiftKey: true };

/** An editor in a fresh container with a manual clock; `raf: true` coalesces renders until clock.frame(). */
function mk(score, opts = {}, { raf = false } = {}) {
  const clock = makeClock();
  if (!raf) { clock.requestAnimationFrame = null; clock.cancelAnimationFrame = null; }
  const box = makeContainer();
  const ed = new ScoreEditor(box, score, { width: 900, clock, ...opts });
  const events = [];
  ed.on('change', (e) => events.push(['change', e]));
  ed.on('cursor', (e) => events.push(['cursor', e]));
  const rootEl = box.children[0];
  return { ed, box, clock, events, root: rootEl, host: rootEl.children[0], live: rootEl.children[1], svg: () => rootEl.children[0].children[0] };
}
const press = (ed, ...keys) => keys.map((k) => ed.handleKey(typeof k === 'string' ? key(k) : k));
const beats = (ed, ti = 0, mi = 0) => { const m = ed.getScore().tracks[ti].measures[mi]; return m.voices ? m.voices[0].beats : m.beats; };
const findAll = (n, f, out = []) => { if (f(n)) out.push(n); n.children.forEach((c) => findAll(c, f, out)); return out; };
const byClass = (n, c) => findAll(n, (x) => (x.getAttribute?.('class') || '').split(' ').includes(c));
/** Advance past the 150 ms debounce and read the live region; `raw` keeps the trailing no-break space of a repeated message. */
const say = (t, clock, raw = false) => { clock.advance(150); return raw ? t.live.textContent : t.live.textContent.replace(/[s ]+$/, ''); };
const cursorOf = (ed) => { const c = ed.getCursor(); return [c.track, c.measure, c.beat, c.string]; };

/** Two tracks (TAB + notation, TAB only), two 4/4 measures each. */
const fixture = () => ({ title: 'Fixture', tracks: [
  tab([{ beats: [tn('quarter', 1, 3), tn('quarter', 2, 5), tn('half', 2, 7)] }, { beats: [tn('half', 1, 0), tn('quarter', 6, 3)] }]),
  tab([{ beats: [nt('whole', 4, 2)] }, { beats: [nt('half', 5, 1), nt('half', 5, 2)] }], { name: 'Tab', showStandardNotation: false }),
] });

// ---------- B2 / I1 ----------
test('B2: the default score is one guitar track, standard tuning, notation + TAB, 4/4, one empty measure; width and theme options reach the renderer', () => {
  const { ed, svg } = mk(undefined, { theme: { background: '#fefefe' } });
  const t = ed.getScore().tracks[0];
  eq([t.name, t.tuning, t.showStandardNotation, t.showTablature, t.timeSignature, t.measures], ['Guitar', ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], true, true, { beats: 4, beatType: 4 }, [{ beats: [] }]]);
  eq(svg().getAttribute('width'), '900');
  ok(serialize(svg()).includes('#fefefe'), 'theme override used');
  eq(ed.getCursor(), { track: 0, measure: 0, beat: 0, string: 1 });
  eq(ed.getCursorInfo().appendSlot, true);
});
test('I1: the title is the aria-label as text (markup stays text), follows loadScore, falls back to "Untitled score" without a title', () => {
  const { ed, root, box } = mk({ title: '<img src=x onerror=alert(1)> & "q"', tracks: [tab([{ beats: [] }])] });
  eq(root.getAttribute('aria-label'), '<img src=x onerror=alert(1)> & "q"');
  ok(findAll(box, (n) => n.tag === 'img').length === 0, 'no element created from the title');
  ed.loadScore({ title: 'Second', tracks: [tab([{ beats: [] }])] });
  eq(root.getAttribute('aria-label'), 'Second');
  ed.loadScore({ tracks: [tab([{ beats: [] }])] });
  eq(root.getAttribute('aria-label'), 'Untitled score');
});

// ---------- B3: loadScore atomicity for every limit ----------
const big = {
  'too many tracks': () => ({ tracks: Array.from({ length: 33 }, () => tab([{ beats: [] }])) }),
  'too many measures': () => ({ tracks: [tab(Array.from({ length: 2001 }, () => ({ beats: [] })))] }),
  'too many beats': () => ({ tracks: [tab([{ beats: Array.from({ length: 257 }, () => rest('64th')) }])] }),
  'too many beats in voice 2': () => ({ tracks: [tab([{ voices: [{ beats: [] }, { beats: Array.from({ length: 257 }, () => rest('64th')) }] }])] }),
  'too many notes': () => ({ tracks: [tab([{ beats: [{ type: 'note', duration: 'whole', notes: Array.from({ length: 17 }, (_, i) => ({ string: 1, fret: i })) }] }])] }),
  'too many voices': () => ({ tracks: [tab([{ voices: Array.from({ length: 5 }, () => ({ beats: [] })) }])] }),
  'too many strings': () => ({ tracks: [tab([{ beats: [] }], { tuning: Array.from({ length: 13 }, () => 'E2') })] }),
  'json too long (string)': () => `{"title":"${'x'.repeat(5 * 1024 * 1024)}"}`,
  'json too long (object)': () => ({ title: 'x'.repeat(5 * 1024 * 1024 + 1) }),
};
test('B3: a load past any structure limit (and a bad schemaVersion, bad JSON, non-object) throws and changes NOTHING: model, cursor, current duration, history, events, DOM, live two-digit buffer', () => {
  const { ed, events, box, clock } = mk(fixture());
  ed.setCursor({ measure: 1, beat: 1, string: 6 });
  press(ed, '+', '4');
  clock.advance(100);
  events.length = 0;
  const snap = () => ({ score: J(ed.getScore()), cursor: ed.getCursor(), dom: serialize(box), info: J(ed.getCursorInfo()), undo: ed.canUndo() });
  const before = snap();
  for (const [name, make] of Object.entries(big)) {
    let msg = ''; try { ed.loadScore(make()); } catch (e) { msg = e.message; }
    ok(msg.startsWith('Score too large'), `${name}: ${msg}`);
  }
  for (const bad of ['{x', '[]', 'null', 42, undefined, { schemaVersion: 2 }, { schemaVersion: 0 }, { schemaVersion: '1' }, { schemaVersion: 1.5 }, { schemaVersion: true }, { schemaVersion: false }]) {
    let threw = false; try { ed.loadScore(bad); } catch { threw = true; }
    ok(threw, J(bad));
  }
  eq(snap(), before);
  eq(events, []);
  press(ed, '3');
  eq(beats(ed, 0, 1)[1].notes[0].fret, 3, 'the digit buffer was live and kept: 4 then 3 is 43 > maxFret, so 3 replaces it');
  ok(ed.undo() && ed.undo(), 'history intact');
  eq([beats(ed, 0, 1)[1].notes[0].fret, ed.getCursorInfo().duration], [3, '8th'], 'back to the state after the + step');
});
test('B3: a failed load keeps a live two-digit buffer (typing the second digit still combines)', () => {
  const { ed, clock } = mk(fixture());
  press(ed, '1');
  clock.advance(200);
  try { ed.loadScore('{"schemaVersion":9}'); } catch { /* expected */ }
  press(ed, '2');
  eq(beats(ed)[0].notes[0].fret, 12);
  eq(ed.undo(), true);
  eq(beats(ed)[0].notes[0].fret, 3, 'still one undo step');
});
test('B3: a successful load ends a live two-digit buffer and the old history; loading while read-only works', () => {
  const { ed, clock } = mk(fixture());
  press(ed, '1');
  ed.loadScore(fixture());
  clock.advance(100);
  press(ed, '2');
  eq(beats(ed)[0].notes[0].fret, 2, 'not 12');
  eq([ed.canUndo(), ed.canRedo()], [true, false]);
  ed.loadScore(fixture());
  eq(ed.canUndo(), false);
  ed.setReadOnly(true);
  ed.loadScore({ title: 'RO', tracks: [tab([{ beats: [nt('whole', 1, 9)] }])] });
  eq([ed.getScore().title, ed.isReadOnly(), ed.getCursor()], ['RO', true, { track: 0, measure: 0, beat: 0, string: 1 }]);
});
test('B3: the constructor rejects every limit with an empty container and nothing listening', () => {
  for (const [name, make] of Object.entries(big)) {
    const box = makeContainer();
    let msg = ''; try { new ScoreEditor(box, make()); } catch (e) { msg = e.message; }
    ok(msg.startsWith('Score too large'), `${name}: ${msg}`);
    eq(box.children.length, 0, name);
  }
});
test('B3: scores at exactly the limits are accepted (32 tracks, 256 beats, 16 notes, 12 strings, 4 voices; 2000 measures is covered at the io level)', () => {
  const at = {
    tracks: { tracks: Array.from({ length: 32 }, () => tab([{ beats: [] }])) },
    beats: { tracks: [tab([{ beats: Array.from({ length: 256 }, () => rest('64th')) }])] },
    notes: { tracks: [tab([{ beats: [{ type: 'note', duration: 'whole', notes: Array.from({ length: 16 }, (_, i) => ({ string: i % 6 + 1, fret: i })) }] }])] },
    strings: { tracks: [tab([{ beats: [] }], { tuning: Array.from({ length: 12 }, () => 'E2') })] },
    voices: { tracks: [tab([{ voices: Array.from({ length: 4 }, () => ({ beats: [] })) }])] },
  };
  for (const [name, s] of Object.entries(at)) {
    const { ed } = mk(s);
    ok(ed.getScore().tracks.length >= 1, name);
    ed.destroy();
  }
});

// ---------- B4: schemaVersion, clone independence, unknown fields ----------
test('B4: schemaVersion 1 is emitted first and round-trips: getScore -> JSON text -> new editor -> getScore is byte-identical; a missing or null version loads', () => {
  const { ed } = mk(fixture());
  press(ed, '5', 'ArrowRight', 'r');
  const out = ed.getScore();
  eq(Object.keys(out)[0], 'schemaVersion');
  eq(out.schemaVersion, 1);
  const text = J(out);
  const { ed: ed2 } = mk(text);
  eq(J(ed2.getScore()), text);
  const { ed: ed3 } = mk(clone({ ...out, schemaVersion: null }));
  eq(J(ed3.getScore()), text);
  const { ed: ed4 } = mk(clone(Object.fromEntries(Object.entries(out).filter(([k]) => k !== 'schemaVersion'))));
  eq(J(ed4.getScore()), text);
  ed2.loadScore(ed.toJSON());
  eq(J(ed2.getScore()), text);
});
test('B4: getScore results and the input are independent of the editor, however deep they are mutated; no internal keys leak', () => {
  const input = { ...fixture(), customTop: { a: [1, { b: 2 }] } };
  const frozen = (o) => { Object.values(o).forEach((v) => v && typeof v === 'object' && frozen(v)); return Object.freeze(o); };
  const { ed } = mk(frozen(clone(input)));
  press(ed, '9', 'ArrowRight', '8');
  const a = ed.getScore();
  const b = ed.getScore();
  ok(a !== b && a.tracks !== b.tracks && a.tracks[0].measures[0].beats[0] !== b.tracks[0].measures[0].beats[0] && a.tracks[0].measures[0].beats[0].notes !== b.tracks[0].measures[0].beats[0].notes, 'fresh objects at every depth');
  const snap = J(b);
  a.tracks[0].measures[0].beats[0].notes[0].fret = 99;
  a.tracks[0].measures[0].beats.push({ junk: 1 });
  a.tracks.length = 0;
  a.customTop.a[1].b = 'changed';
  delete a.title;
  a.schemaVersion = 7;
  eq(J(ed.getScore()), snap, 'editor unchanged');
  const t = ed.getScore();
  eq(Object.keys(t).sort(), ['customTop', 'schemaVersion', 'title', 'tracks']);
  eq(Object.keys(t.tracks[0]).sort(), ['measures', 'name', 'showTablature']);
  ok(!/_model|_cursor|_state|history|digit/.test(J(t)), 'no internal keys');
  ed.undo(); ed.undo();
  eq(ed.getScore().tracks, input.tracks, 'undo back to the input');
  const live = clone(input);
  const { ed: ed2 } = mk(live);
  const keep = J(live);
  press(ed2, '5', 'm', 'r', key('Delete', CTRL));
  eq(J(live), keep, 'the input object was never touched by loads or edits');
  live.tracks[0].measures[0].beats[0].notes[0].fret = 77;
  eq(ed2.getScore().tracks[0].measures[0].beats[0].notes[0].fret === 77, false, 'mutating the input afterwards does not reach the editor');
});
test('E12: unknown fields at score, track, measure, beat, note and voice level survive load, edits, undo and getScore', () => {
  const s = { zzScore: { deep: [1, 2] }, title: 'T', tracks: [tab([
    { zzMeasure: 1, beats: [{ type: 'note', duration: 'quarter', zzBeat: 'x', notes: [{ string: 1, fret: 2, zzNote: 1 }] }] },
    { voices: [{ zzVoice: 1, beats: [nt('whole')] }, { beats: [nt('whole', 3, 3)], zzVoice2: 2 }] },
  ], { zzTrack: true })] };
  const { ed } = mk(s);
  const all = () => J(ed.getScore());
  for (const k of ['zzScore', 'zzTrack', 'zzMeasure', 'zzBeat', 'zzNote', 'zzVoice', 'zzVoice2']) ok(all().includes(k), `${k} after load`);
  press(ed, '7', '+', '.', '/', 'ArrowRight', 'l', 'ArrowRight', 'ArrowRight', 'r', 'm', 'M');
  press(ed, key('Delete', { ctrlKey: true }), key('Delete', SHIFT));
  for (const k of ['zzScore', 'zzTrack', 'zzNote', 'zzVoice', 'zzVoice2']) ok(all().includes(k), `${k} after edits`);
  while (ed.undo());
  eq(J(canon(ed.getScore())), J(canon({ schemaVersion: 1, ...s })));
});

// ---------- B8: destroy ----------
test('B8: after destroy EVERY public method throws "ScoreEditor destroyed" (checked by enumerating the prototype); destroy itself stays idempotent', () => {
  const { ed } = mk(fixture());
  ed.destroy();
  const names = Object.getOwnPropertyNames(ScoreEditor.prototype).filter((n) => n !== 'constructor' && !n.startsWith('_') && n !== 'destroy');
  for (const must of ['loadScore', 'getScore', 'toJSON', 'getCursor', 'setCursor', 'getCursorInfo', 'getMeasureFill', 'handleKey', 'setDuration', 'focus', 'undo', 'redo', 'canUndo', 'canRedo', 'setReadOnly', 'isReadOnly', 'setWidth', 'refresh', 'on', 'off']) ok(names.includes(must), `${must} is public`);
  const args = { loadScore: [{}], setCursor: [{}], getMeasureFill: [0, 0], handleKey: [key('ArrowRight')], setDuration: ['half'], setReadOnly: [true], setWidth: [800], on: ['change', () => {}], off: ['change', () => {}] };
  for (const n of names) {
    let msg = null;
    try { ed[n](...(args[n] || [])); } catch (e) { msg = e.message; }
    eq(msg, 'ScoreEditor destroyed', n);
  }
  ed.destroy();
});
test('B8: destroy with a pending frame, a pending announcement and a live digit buffer leaves no timers or frames; late frames, timers and key events do nothing', () => {
  const { ed, clock, box, root, host } = mk(fixture(), {}, { raf: true });
  press(ed, '1');
  ed.setCursor({ beat: 1 });
  ok(clock.pendingFrames() === 1 && clock.pendingTimers() === 1);
  ed.destroy();
  eq([clock.pendingFrames(), clock.pendingTimers(), box.children.length], [0, 0, 0]);
  clock.advance(5000); clock.frame();
  root.dispatch('keydown', key('ArrowRight'));
  root.dispatch('focus'); root.dispatch('blur');
  host.dispatch('mousedown', { button: 0, clientX: 10, clientY: 10 });
  eq(box.children.length, 0);
  let n = 0; try { ed.getScore(); } catch { n++; }
  eq(n, 1);
});
test('B8: events registered with on() are gone after destroy (no late change / cursor events from a pending render)', () => {
  const { ed, events, clock } = mk(fixture(), {}, { raf: true });
  press(ed, '5');
  ed.destroy();
  clock.frame();
  eq(events.filter((e) => e[0] === 'change'), []);
});

// ---------- B9: read-only for every edit key ----------
const EDIT_KEYS = [
  key('0'), key('5'), key('9'), key('7', { code: 'Numpad7' }), key('+'), key('='), key('+', { code: 'NumpadAdd' }), key('-'), key('-', { code: 'NumpadSubtract' }),
  key('.'), key(',', { code: 'NumpadDecimal' }), key('/'), key('/', { code: 'NumpadDivide' }), key('r'), key('R'), key('l'), key('L'),
  key('Delete'), key('Backspace'), key('Delete', CTRL), key('Backspace', { metaKey: true }), key('Insert'), key('i'), key('I'),
  key('m'), key('M', SHIFT), key('Delete', SHIFT), key('Backspace', SHIFT), key('z', CTRL), key('y', CTRL), key('z', { ctrlKey: true, shiftKey: true }), key('z', { metaKey: true }),
];
test('B9: in read-only mode EVERY edit key (digits, numpad, rhythm, rest, tie, deletes, inserts, measures, undo / redo) returns false with no change, no history, no event; nothing throws', () => {
  const { ed, events } = mk(fixture(), { readOnly: true });
  const before = J(ed.getScore());
  ed.setCursor({ measure: 1, beat: 1 });
  for (const k of EDIT_KEYS) eq(ed.handleKey(k), false, `${k.key} ${k.code || ''} ${k.ctrlKey ? 'ctrl' : ''}${k.shiftKey ? 'shift' : ''}${k.metaKey ? 'meta' : ''}`);
  ed.setCursor({ measure: 1, beat: 2 });
  eq(ed.handleKey(key('ArrowRight')), true);
  eq(ed.setDuration('half'), false);
  eq(ed.getCursor().measure, 1, 'Right from the last beat of the last (underfull) measure does not append');
  ed.setCursor({ measure: 1, beat: 1 });
  eq(J(ed.getScore()), before);
  eq(events.filter((e) => e[0] === 'change'), []);
  ed.setReadOnly(false);
  eq([ed.canUndo(), ed.canRedo(), ed.undo()], [false, false, false], 'history stayed empty');
  eq(ed.handleKey(key('5')), true);
});
test('B9: Right on the last beat of a FULL last measure does not append while read-only, and does after setReadOnly(false)', () => {
  const { ed } = mk({ tracks: [tab([{ beats: [nt('whole')] }])] }, { readOnly: true });
  ed.handleKey(key('ArrowRight'));
  eq(ed.getScore().tracks[0].measures.length, 1);
  ed.setReadOnly(false);
  ed.handleKey(key('ArrowRight'));
  eq(ed.getScore().tracks[0].measures.length, 2);
});
test('B9: all navigation keys work read-only (and are consumed); read-only mid two-digit entry ends the buffer', () => {
  const { ed, clock } = mk(fixture());
  press(ed, '1');
  ed.setReadOnly(true);
  ed.setReadOnly(false);
  clock.advance(100);
  press(ed, '2');
  eq(beats(ed)[0].notes[0].fret, 2, 'not combined across a read-only toggle');
  ed.setReadOnly(true);
  const moves = [key('ArrowRight'), key('ArrowLeft'), key('ArrowDown'), key('ArrowUp'), key('ArrowRight', CTRL), key('ArrowLeft', CTRL), key('End'), key('Home'), key('End', CTRL), key('Home', CTRL), key('PageDown'), key('PageUp')];
  eq(moves.map((k) => ed.handleKey(k)), moves.map(() => true));
});

// ---------- D1: every row of the key table through handleKey ----------
test('D1: every row of the key table has an effect through handleKey (editor level), with Cmd counted as Ctrl and numpad variants', () => {
  const run = (k, at = {}, check) => {
    const { ed } = mk(fixture());
    ed.setCursor({ track: 0, measure: 0, beat: 1, string: 2, ...at });
    const before = { score: J(ed.getScore()), cur: cursorOf(ed), info: ed.getCursorInfo() };
    const res = ed.handleKey(k);
    ok(res === true, `${k.key} consumed`);
    check(ed, before);
  };
  const cursorIs = (...c) => (ed) => eq(cursorOf(ed), c);
  const changed = (ed, b) => ok(J(ed.getScore()) !== b.score, 'model changed');
  const fretIs = (n) => (ed) => eq(beats(ed)[1].notes.find((x) => x.string === 2).fret, n);
  run(key('ArrowLeft'), {}, cursorIs(0, 0, 0, 2));
  run(key('ArrowRight'), {}, cursorIs(0, 0, 2, 2));
  run(key('ArrowUp'), {}, cursorIs(0, 0, 1, 1));
  run(key('ArrowDown'), {}, cursorIs(0, 0, 1, 3));
  run(key('ArrowLeft', CTRL), { measure: 1, beat: 1 }, cursorIs(0, 0, 0, 2));
  run(key('ArrowRight', CTRL), {}, cursorIs(0, 1, 0, 2));
  run(key('ArrowRight', { metaKey: true }), {}, cursorIs(0, 1, 0, 2));
  run(key('Home'), {}, cursorIs(0, 0, 0, 2));
  run(key('End'), {}, cursorIs(0, 0, 2, 2));
  run(key('Home', CTRL), { measure: 1, beat: 1 }, cursorIs(0, 0, 0, 2));
  run(key('End', CTRL), {}, cursorIs(0, 1, 1, 2));
  run(key('PageDown'), {}, (ed) => eq(cursorOf(ed).slice(0, 2), [1, 0]));
  run(key('PageUp'), { track: 1 }, (ed) => eq(cursorOf(ed).slice(0, 2), [0, 0]));
  for (const [k, n] of [[key('7'), 7], [key('7', { code: 'Numpad7' }), 7], [key('0'), 0]]) run(k, {}, fretIs(n));
  run(key('+'), {}, (ed) => eq(beats(ed)[1].duration, '8th'));
  run(key('='), {}, (ed) => eq(beats(ed)[1].duration, '8th'));
  run(key('+', { code: 'NumpadAdd' }), {}, (ed) => eq(beats(ed)[1].duration, '8th'));
  run(key('-'), {}, (ed) => eq(beats(ed)[1].duration, 'half'));
  run(key('-', { code: 'NumpadSubtract' }), {}, (ed) => eq(beats(ed)[1].duration, 'half'));
  run(key('.'), {}, (ed) => eq(beats(ed)[1].dots, 1));
  run(key(',', { code: 'NumpadDecimal' }), {}, (ed) => eq(beats(ed)[1].dots, 1));
  run(key('/'), {}, (ed) => eq(beats(ed)[1].tuplet, 3));
  run(key('/', { code: 'NumpadDivide' }), {}, (ed) => eq(beats(ed)[1].tuplet, 3));
  for (const k of ['r', 'R']) run(key(k), {}, (ed) => eq(beats(ed)[1].type, 'rest'));
  for (const k of ['l', 'L']) {
    run(key(k), { beat: 2, string: 2 }, (ed) => {
      eq(beats(ed)[2].notes[0], { string: 2, fret: 5, tieEnd: true });
      eq(beats(ed)[1].notes[0].tieStart, true);
    });
  }
  run(key('l'), { beat: 1, string: 2 }, (ed, b) => eq([J(ed.getScore()), ed.getCursorInfo().fret], [b.score, 5]));
  for (const k of ['Delete', 'Backspace']) run(key(k), {}, (ed) => eq(beats(ed)[1].type, 'rest'));
  run(key('Delete', CTRL), {}, (ed) => eq(beats(ed).length, 2));
  run(key('Backspace', { metaKey: true }), {}, (ed) => eq(beats(ed).length, 2));
  for (const k of ['Insert', 'i', 'I']) run(key(k), {}, (ed) => eq([beats(ed).length, beats(ed)[1].type, cursorOf(ed)[2]], [4, 'rest', 1]));
  run(key('m'), {}, (ed) => eq([ed.getScore().tracks.map((t) => t.measures.length), cursorOf(ed).slice(1, 3)], [[3, 3], [1, 0]]));
  run(key('M', SHIFT), {}, (ed) => eq([ed.getScore().tracks.map((t) => t.measures.length), cursorOf(ed).slice(1, 3)], [[3, 3], [0, 0]]));
  for (const k of ['Delete', 'Backspace']) run(key(k, SHIFT), {}, (ed) => eq([ed.getScore().tracks.map((t) => t.measures.length), ed.getScore().title], [[1, 1], 'Fixture']));
});
test('D1: Escape is consumed only while a two-digit entry is live; undo / redo keys (Ctrl, Cmd, Ctrl+Shift+Z, Ctrl+Y) walk history', () => {
  const { ed, clock } = mk(fixture());
  eq(ed.handleKey(key('Escape')), false);
  press(ed, '1');
  eq(ed.handleKey(key('Escape')), true);
  clock.advance(10);
  press(ed, '2');
  eq(beats(ed)[0].notes[0].fret, 2, 'Escape ended the entry');
  press(ed, 'ArrowRight', '+');
  eq(ed.handleKey(key('z', CTRL)), true);
  eq(beats(ed)[1].duration, 'quarter');
  eq(ed.handleKey(key('y', CTRL)), true);
  eq(beats(ed)[1].duration, '8th');
  eq(ed.handleKey(key('z', { metaKey: true })), true);
  eq(ed.handleKey(key('Z', { ctrlKey: true, shiftKey: true })), true);
  eq(beats(ed)[1].duration, '8th');
  eq(ed.handleKey(key('z', CTRL)) && ed.handleKey(key('z', CTRL)), true);
  eq(beats(ed)[0].notes[0].fret, 1, 'back past the "+" and the 2, to the state after the 1');
});
test('D: the keydown listener ignores keys from other targets, defaultPrevented events and keys with Alt; page-reserved keys are never prevented', () => {
  const { ed, root } = mk(fixture());
  const before = ed.getCursor();
  const prevented = (k, extra = {}) => root.dispatch('keydown', { ...key(k.key, k), ...extra }).defaultPrevented;
  eq([key('ArrowRight', { altKey: true }), key('ArrowLeft', { altKey: true }), key('w', CTRL), key('t', CTRL), key('n', CTRL), key('l', CTRL), key('p', CTRL), key('s', CTRL), key('i', CTRL), key('m', CTRL), key('1', CTRL), key('9', CTRL), key('F5', {}), key('Tab'), key('Tab', SHIFT)].map((k) => prevented(k)), Array(15).fill(false));
  eq(ed.getCursor(), before);
  eq(prevented(key('ArrowRight')), true);
  eq(prevented(key('ArrowRight'), { target: { other: true } }), false);
});

test('B7 / B5 / B6: malformed events and arguments are refused without throwing or changing anything (handleKey, on, setCursor, setDuration, setWidth)', () => {
  const { ed, events } = mk(fixture());
  const before = J(ed.getScore());
  eq([undefined, null, {}, 'a', 5, { key: '' }, { key: 7 }, { key: 'ArrowRight', isComposing: true }].map((e) => ed.handleKey(e)), Array(8).fill(false));
  let msg = ''; try { ed.on('change', null); } catch (e) { msg = e.message; }
  eq(msg, 'listener must be a function');
  eq(typeof ed.on('whatever', () => {}), 'function');
  const c = ed.getCursor();
  eq([ed.setCursor(null), ed.setCursor('x'), ed.setCursor({ beat: NaN, measure: Infinity })], [c, c, c]);
  eq([ed.setDuration(), ed.setDuration('nope'), ed.setDuration(5)], [false, false, false]);
  for (const bad of ['800', NaN, 0, -5, Infinity, null]) { let t = false; try { ed.setWidth(bad); } catch (e) { t = e instanceof RangeError; } ok(t, `setWidth(${bad})`); }
  eq([J(ed.getScore()), events], [before, []]);
});

// ---------- F: history cap and coalescing ----------
test('F4 / E2: with a history cap, a two-digit fret still counts as ONE step and the oldest steps are dropped (cap 1, 2, 3)', () => {
  for (const cap of [1, 2, 3]) {
    const { ed, clock } = mk(fixture(), { historyLimit: cap });
    ed.setCursor({ beat: 0, string: 1 });
    press(ed, '+', '.', '/', 'ArrowRight');
    clock.advance(2000);
    press(ed, '1');
    clock.advance(100);
    press(ed, '2');
    let n = 0; while (ed.undo()) n++;
    eq(n, cap, `cap ${cap}`);
    if (cap >= 1) ok(ed.canRedo());
  }
  const { ed, clock } = mk(fixture(), { historyLimit: 2 });
  press(ed, '+', '1'); clock.advance(100); press(ed, '2');
  eq(beats(ed)[0].notes[0].fret, 12);
  ed.undo();
  eq(beats(ed)[0].notes[0].fret, 3, 'the coalesced step restores the state before the FIRST digit');
  eq(beats(ed)[0].duration, '8th', 'the older step is still there');
});
test('F4: cap 0 records nothing (two digits included) and never breaks entry; a cap is not applied to redo after undo', () => {
  const { ed, clock } = mk(fixture(), { historyLimit: 0 });
  press(ed, '1'); clock.advance(100); press(ed, '2');
  eq(beats(ed)[0].notes[0].fret, 12);
  eq([ed.canUndo(), ed.undo()], [false, false]);
  const { ed: e2 } = mk(fixture(), { historyLimit: 3 });
  press(e2, '+', '.', '/', 'r');
  e2.undo(); e2.undo(); e2.undo();
  eq([e2.canRedo(), e2.canUndo()], [true, false]);
  press(e2, '5');
  eq([e2.canRedo(), e2.canUndo()], [false, true]);
});
test('F1 / E2: two-digit fret = two change events but ONE undo step; the cursor comes back too; undo ends the buffer so a later digit replaces', () => {
  const { ed, clock, events } = mk(fixture());
  ed.setCursor({ beat: 2, string: 5 });
  events.length = 0;
  press(ed, '1');
  clock.advance(50);
  press(ed, '2');
  eq(events.filter((e) => e[0] === 'change').map((e) => e[1].source + ':' + e[1].command), ['edit:digit', 'edit:digit']);
  ed.undo();
  eq([ed.canUndo(), ed.getCursor(), beats(ed)[2].notes.length], [false, { track: 0, measure: 0, beat: 2, string: 5 }, 1]);
  clock.advance(10);
  press(ed, '3');
  eq(beats(ed)[2].notes.find((n) => n.string === 5).fret, 3, 'not 13 after the undo');
  press(ed, '4');
  eq(beats(ed)[2].notes.find((n) => n.string === 5).fret, 4, 'a new buffer after the 3: 34 > maxFret, so 4 replaces it');
});
test('F1: auto-appended measure (Right at the end) is ONE step: undo removes it and restores the cursor, redo brings it back', () => {
  const { ed } = mk({ tracks: [tab([{ beats: [nt('whole')] }]), tab([{ beats: [nt('whole')] }], { showStandardNotation: false })] });
  press(ed, 'ArrowRight');
  eq([ed.getScore().tracks.map((t) => t.measures.length), ed.getCursor().measure], [[2, 2], 1]);
  eq(ed.undo(), true);
  eq([ed.getScore().tracks.map((t) => t.measures.length), ed.getCursor().measure, ed.canUndo()], [[1, 1], 0, false]);
  eq(ed.redo(), true);
  eq([ed.getScore().tracks.map((t) => t.measures.length), ed.getCursor().measure], [[2, 2], 1]);
});
const MIXED = ['5', 'ArrowRight', '7', key('ArrowDown'), '3', '+', '.', '/', 'r', 'r', 'l', 'ArrowLeft', 'Insert', key('Delete', CTRL), 'm', 'ArrowRight', '9', key('Delete', SHIFT),
  key('M', SHIFT), 'PageDown', '4', 'ArrowRight', '2', 'ArrowRight', 'ArrowRight', 'Delete', 'PageUp', key('Delete', CTRL), key('Delete', CTRL), '-', '-', '6'];
test('F2: undo restores the EXACT model and cursor after every step of a mixed 30-key session; redo restores every state after (clock advanced past the digit delay between keys)', () => {
  const { ed, clock } = mk(fixture());
  const states = [{ score: J(ed.getScore()), cursor: ed.getCursor() }];
  for (const k of MIXED) {
    clock.advance(1000);
    const n0 = ed._history.size();
    press(ed, typeof k === 'string' ? key(k) : k);
    if (ed._history.size() > n0) states.push({ score: J(ed.getScore()), cursor: ed.getCursor() });
  }
  ok(states.length > 15, `${states.length} model states`);
  for (let i = states.length - 1; i > 0; i--) {
    ok(ed.undo(), `undo ${i}`);
    eq(J(ed.getScore()), states[i - 1].score, `undo to state ${i - 1}`);
  }
  eq(ed.canUndo(), false);
  for (let i = 1; i < states.length; i++) {
    ok(ed.redo(), `redo ${i}`);
    eq(J(ed.getScore()), states[i].score, `redo to state ${i}`);
    eq(ed.getCursor(), states[i].cursor, `redo cursor ${i}`);
  }
  eq(ed.canRedo(), false);
});
test('F5: undo / redo emit change with their source only when something moved; an empty stack emits nothing and returns false', () => {
  const { ed, events } = mk(fixture());
  eq([ed.undo(), ed.redo()], [false, false]);
  eq(events, []);
  press(ed, '8');
  events.length = 0;
  ed.undo(); ed.redo();
  eq(events.filter((e) => e[0] === 'change').map((e) => e[1]), [{ source: 'undo' }, { source: 'redo' }]);
});

// ---------- A6: multiMeasureRests ----------
test('A6: multiMeasureRests stays true in the JSON through load, edits, undo and getScore; every measure of a rest run is individually addressable in the editor view', () => {
  const sc = { multiMeasureRests: true, tracks: [tab([{ beats: [nt('whole')] }, ...Array.from({ length: 4 }, () => ({ beats: [rest('whole')] })), { beats: [nt('whole', 2, 2)] }])] };
  const keep = J(sc);
  const { ed } = mk(sc);
  eq(ed.getScore().multiMeasureRests, true);
  eq(J(sc), keep, 'input untouched');
  const map = ed._view.renderer.getHitMap();
  eq(map.measures.filter((m) => m.ti === 0).map((m) => m.measureIndex), [0, 1, 2, 3, 4, 5]);
  ok(map.measures.every((m) => m.lastMeasureIndex === undefined), 'no collapsed run');
  for (let mi = 1; mi <= 4; mi++) { ed.setCursor({ measure: mi, beat: 0 }); eq(ed.getCursor().measure, mi); }
  press(ed, '5');
  eq(ed.getScore().tracks[0].measures[4].beats[0].type, 'note');
  ed.undo();
  eq([ed.getScore().multiMeasureRests, ed.getScore().tracks[0].measures[4].beats[0].type], [true, 'rest']);
  ok(!/multi-rest|multiRest|multirest/i.test(serialize(ed._view.root)), 'no multi-measure rest drawn');
  ed.loadScore({ ...clone(sc), multiMeasureRests: false });
  eq(ed.getScore().multiMeasureRests, false);
});

// ---------- C6 / C7 / C10 at controller level ----------
test('C6: notation-only track: digits are refused with "Fret entry needs a TAB staff", Up/Down are consumed no-ops, the overlay has a notation column and no string box', () => {
  const { ed, svg, live, clock } = mk({ tracks: [{ name: 'Std', showTablature: false, measures: [{ beats: [{ type: 'note', duration: 'quarter', notes: [{ pitch: 'C4' }] }, rest('quarter')] }] }] });
  const before = J(ed.getScore());
  eq(press(ed, '5', 'ArrowDown', 'ArrowUp', 'Delete', 'l'), [true, true, true, true, true]);
  eq(J(ed.getScore()), before);
  eq(say({ live }, clock), 'Needs a TAB staff', 'the last refusal is spoken');
  press(ed, '5');
  eq(say({ live }, clock), 'Fret entry needs a TAB staff');
  eq([byClass(svg(), 'editor-col-notation').length, byClass(svg(), 'editor-col-tab').length, byClass(svg(), 'editor-string').length], [1, 0, 0]);
  ed.setCursor({ beat: 1 });
  press(ed, 'r');
  eq(say({ live }, clock), 'Fret entry needs a TAB staff');
  eq(ed.getCursorInfo().hasTab, false);
  press(ed, 'ArrowLeft', '+', '.');
  eq(beats(ed)[0].duration, '8th');
  eq(beats(ed)[0].dots, 1);
});
test('C7: a tab-only track gets the TAB column and string box, no notation column, and edits like any other', () => {
  const { ed, svg } = mk({ tracks: [tab([{ beats: [] }], { showStandardNotation: false })] });
  const shapes = () => [byClass(svg(), 'editor-col-notation').length, byClass(svg(), 'editor-col-tab').length, byClass(svg(), 'editor-slot').length, byClass(svg(), 'editor-string').length];
  eq(shapes(), [0, 0, 1, 1], 'empty measure: a dashed slot on the one staff, plus the string box');
  press(ed, '5', 'ArrowDown', '7', 'ArrowRight', '2', 'ArrowRight');
  eq(beats(ed).map((b) => b.notes.map((n) => n.fret)), [[5, 7], [2]]);
  eq(shapes(), [0, 0, 1, 1], 'on the append slot');
  ed.setCursor({ beat: 0 });
  eq(shapes(), [0, 1, 0, 1], 'on a beat: the TAB column and the string box, no notation column');
});
test('C10: hidden tracks get no overlay, are skipped by PageUp/PageDown and the cursor info; a hidden FIRST track starts the cursor on the first visible one', () => {
  const hid = { name: 'H', showStandardNotation: false, showTablature: false, measures: [{ beats: [nt('whole')] }] };
  const { ed, svg } = mk({ tracks: [hid, tab([{ beats: [nt('whole')] }]), hid, tab([{ beats: [nt('whole')] }], { name: 'B' })] });
  eq(ed.getCursor().track, 1);
  eq(ed.getCursorInfo().trackName, 'Gtr');
  press(ed, 'PageDown');
  eq([ed.getCursor().track, ed.getCursorInfo().trackName], [3, 'B']);
  press(ed, 'PageDown');
  eq(ed.getCursor().track, 3);
  eq(ed.setCursor({ track: 2 }).track, 1, 'hidden target -> nearest visible, lower first');
  eq(byClass(svg(), 'editor-col-tab').length, 1);
  ed.setCursor({ track: 3 });
  press(ed, 'm');
  eq(ed.getScore().tracks.map((t) => t.measures.length), [2, 2, 2, 2], 'hidden tracks get the column too');
});
test('C10: a score with no visible track: keys are consumed, nothing changes, the live region says "No visible track"; Right never appends', () => {
  const { ed, live, clock } = mk({ tracks: [{ name: 'H', showStandardNotation: false, showTablature: false, measures: [{ beats: [nt('whole')] }] }] });
  const before = J(ed.getScore());
  eq(press(ed, '5', 'ArrowRight', 'ArrowRight', 'm', 'r', key('Delete', SHIFT)), Array(6).fill(true));
  eq(J(ed.getScore()), before);
  eq(say({ live }, clock), 'No visible track');
  const { ed: e2 } = mk({ tracks: [] });
  eq(press(e2, '5', 'm', 'ArrowRight').every(Boolean), true);
  eq(e2.getScore().tracks, []);
});

// ---------- C9 / G4 / I2: durations, fill bands and announcements ----------
test('C9: the palette (setDuration), dots and triplet apply to the NEXT beat typed on the append slot and are taken back from the beat the cursor moves onto; undo re-syncs them', () => {
  const { ed } = mk({ tracks: [tab([{ beats: [nt('half', 1, 0, { dots: 1 })] }])] });
  eq(ed.getCursorInfo().duration, 'half');
  press(ed, 'ArrowRight');
  eq([ed.getCursorInfo().appendSlot, ed.getCursorInfo().duration, ed.getCursorInfo().dots], [true, 'half', 1], 'slot keeps the previous beat values');
  ed.setDuration('16th');
  press(ed, '4');
  eq(beats(ed)[1], nt('16th', 1, 4, { dots: 1 }));
  press(ed, 'ArrowLeft');
  eq([ed.getCursorInfo().duration, ed.getCursorInfo().dots], ['half', 1]);
  ed.setDuration('whole');
  eq(beats(ed)[0].duration, 'whole');
  ed.undo();
  eq([ed.getCursorInfo().duration, beats(ed)[0].duration], ['half', 'half']);
  eq(ed.setDuration('nope'), false);
  eq(ed.setDuration('64th'), true);
  press(ed, 'ArrowRight');
  eq(ed.getCursorInfo().duration, '16th', 'moving onto a beat takes its duration');
});
test('G4 / I2: fill transitions are announced once, in words, on the edit that causes them, and the over / under bands follow the model (also after undo)', () => {
  const { ed, svg, live, clock } = mk({ tracks: [tab([{ beats: [] }])] });
  const bands = () => [byClass(svg(), 'editor-band-over').length > 0, byClass(svg(), 'editor-band-under').length > 0];
  const typed = [];
  for (let i = 0; i < 4; i++) { press(ed, '5'); typed.push(say({ live }, clock)); if (i < 3) press(ed, 'ArrowRight'); }
  eq(typed, ['Fret 5', 'Fret 5', 'Fret 5', 'Fret 5, measure full']);
  eq([ed.getMeasureFill(0, 0), bands()], ['full', [false, false]]);
  press(ed, 'ArrowLeft', '-');
  eq(say({ live }, clock), 'Half, measure overfull');
  eq([ed.getMeasureFill(0, 0), bands()], ['over', [true, false]]);
  press(ed, '+');
  eq(say({ live }, clock), 'Quarter, measure full');
  eq(bands(), [false, false]);
  press(ed, key('Delete', CTRL));
  eq(say({ live }, clock), 'Beat deleted. Beat 3, string 1, fret 5, quarter, measure underfull');
  eq([ed.getMeasureFill(0, 0), bands()], ['under', [false, true]]);
  ed.undo();
  eq([ed.getMeasureFill(0, 0), bands()], ['full', [false, false]]);
  ed.undo();
  eq([ed.getMeasureFill(0, 0), bands()], ['over', [true, false]]);
  ed.redo(); ed.redo();
  eq(ed.getMeasureFill(0, 0), 'under');
  press(ed, 'm');
  eq([ed.getMeasureFill(0, 1), bands()], ['under', [false, true]], 'the empty new measure gets no band of its own; measure 1 keeps its underfull band');
});
test('G4: an overfull measure never moves its neighbours, and the cursor can still move through every beat of it', () => {
  const { ed } = mk({ tracks: [tab([{ beats: [nt('whole'), nt('whole'), nt('half')] }, { beats: [nt('whole', 2, 2)] }])] });
  eq(ed.getMeasureFill(0, 0), 'over');
  const seen = [];
  for (let i = 0; i < 4; i++) { seen.push(cursorOf(ed).slice(1, 3).join(':')); press(ed, 'ArrowRight'); }
  eq(seen, ['0:0', '0:1', '0:2', '1:0']);
  eq(beats(ed, 0, 1), [nt('whole', 2, 2)]);
});
test('I2: the live region repeats an identical message with a trailing no-break space and says nothing for silent no-ops it already reported', () => {
  const { ed, live, clock } = mk(fixture());
  press(ed, 'Delete');
  eq(say({ live }, clock), 'Note deleted, now rest');
  press(ed, 'Delete');
  eq(say({ live }, clock, true), 'No note to delete');
  press(ed, 'Delete');
  const again = say({ live }, clock, true);
  eq([again.startsWith('No note to delete'), again.length, again === 'No note to delete'], [true, 'No note to delete'.length + 1, false]);
});

// ---------- click ----------
test('click: clicking a note on the notation staff of a TAB track keeps the cursor string; clicking another track moves track; clicking an empty measure puts the cursor on its slot', () => {
  const { ed, host } = mk({ tracks: [tab([{ beats: [nt('quarter', 1, 3), nt('quarter', 2, 4)] }, { beats: [] }]), tab([{ beats: [nt('whole', 3, 0)] }], { showStandardNotation: false })] });
  ed.setCursor({ string: 4 });
  const map = ed._view.renderer.getHitMap();
  const nstaff = map.staves.find((s) => s.ti === 0 && s.kind === 'notation');
  const el = map.elements.find((e) => e.ti === 0 && e.measureIndex === 0 && e.beatIndex === 1);
  host.dispatch('mousedown', { button: 0, clientX: el.x + 1, clientY: nstaff.y + nstaff.lineBottom / 2 });
  eq(ed.getCursor(), { track: 0, measure: 0, beat: 1, string: 4 });
  const t2 = map.staves.find((s) => s.ti === 1);
  const el2 = map.elements.find((e) => e.ti === 1 && e.measureIndex === 0);
  host.dispatch('mousedown', { button: 0, clientX: el2.x + 1, clientY: t2.y + 2 * 15 });
  eq(cursorOf(ed).slice(0, 3), [1, 0, 0]);
  eq(ed.getCursor().string, 3);
  const m1 = map.measures.find((m) => m.ti === 0 && m.measureIndex === 1);
  const tab0 = map.staves.find((s) => s.ti === 0 && s.kind === 'tab');
  host.dispatch('mousedown', { button: 0, clientX: m1.contentX + 5, clientY: tab0.y + 15 });
  eq(cursorOf(ed).slice(0, 3), [0, 1, 0]);
});

// ---------- A4 / A5: hit map for every kind of track ----------
test('A4 / A5: hit testing on notation-only, tab-only and hidden tracks: no string on notation, string by line on TAB, hidden tracks never hit, tab-only string y = staff.y + (n-1) * spacing', async () => {
  const { MusicScoreRenderer } = await imp('src/MusicScoreRenderer.js');
  const { resolveTheme } = await imp('src/theme.js');
  const th = resolveTheme();
  const score = { tracks: [
    { name: 'N', showTablature: false, measures: [{ beats: [nt('quarter'), nt('quarter'), nt('half')] }] },
    { name: 'H', showStandardNotation: false, showTablature: false, measures: [{ beats: [nt('whole')] }] },
    { name: 'T', showStandardNotation: false, showTablature: true, tuning: ['E1', 'A1', 'D2', 'G2'], measures: [{ beats: [nt('quarter'), nt('quarter'), nt('half')] }] },
  ] };
  const box = makeContainer();
  const r = new MusicScoreRenderer(box, clone(score), { width: 900 });
  r.render();
  const map = r.getHitMap();
  eq(map.staves.map((s) => [s.ti, s.kind]), [[0, 'notation'], [2, 'tab']]);
  const n = map.staves[0];
  const t = map.staves[1];
  const e0 = map.elements.filter((e) => e.ti === 0 && !e.isGrace);
  const hitN = r.hitTest(e0[1].x, n.y + n.lineBottom / 2);
  eq(hitN, { ti: 0, measureIndex: 0, beatIndex: 1 });
  ok(!('string' in hitN), 'no string key on notation');
  const e2 = map.elements.filter((e) => e.ti === 2);
  for (let k = 1; k <= 4; k++) eq(r.hitTest(e2[2].x, t.y + (k - 1) * th.tabStaffLineSpacing), { ti: 2, measureIndex: 0, beatIndex: 2, string: k }, `string ${k}`);
  eq(r.hitTest(e2[0].x, t.y + 10 * th.tabStaffLineSpacing), null, 'below the staff');
  eq(r.hitTest(e2[0].x, map.staves[0].y - 50), null, 'above the first staff');
  ok(map.elements.every((e) => e.ti !== 1), 'hidden track has no elements');
  ok(map.measures.every((m) => m.ti !== 1));
});

// ---------- model-level invariants through the controller ----------
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const RANDOM = [...'0123456789'.split('').map((k) => key(k)), key('ArrowRight'), key('ArrowRight'), key('ArrowLeft'), key('ArrowDown'), key('ArrowUp'), key('r'), key('l'), key('Delete'), key('m'), key('M', SHIFT),
  key('+'), key('-'), key('.'), key('/'), key('Insert'), key('Delete', CTRL), key('Delete', SHIFT), key('PageDown'), key('PageUp'), key('Home'), key('End'), key('Home', CTRL), key('End', CTRL), key('Escape')];
test('B10 / F2 (editor): after 400 random keys (timing varied) undoing everything restores the start byte for byte and redoing everything the end; every step is sanitize-stable', () => {
  for (const seed of [1, 2, 3]) {
    const rnd = mulberry32(seed * 104729);
    const { ed, clock } = mk(fixture(), { historyLimit: 10000 });
    const start = J(ed.getScore());
    for (let i = 0; i < 400; i++) {
      clock.advance(rnd() < 0.5 ? 100 : 1200);
      ed.handleKey(RANDOM[Math.floor(rnd() * RANDOM.length)]);
      if (sanitizeScore(ed._model) !== ed._model) throw new Error(`seed ${seed} step ${i}: model changed by sanitize`);
    }
    const end = J(ed.getScore());
    let n = 0; while (ed.undo()) n++;
    ok(n > 50, `${n} undo steps`);
    eq(J(ed.getScore()), start, `seed ${seed}: undo all`);
    while (ed.redo());
    eq(J(ed.getScore()), end, `seed ${seed}: redo all`);
    ed.destroy();
  }
});

// ---------- report ----------
export async function summary() {
  let fail = 0;
  for (const t of tests) {
    try { await t.fn(); console.log(`PASS editor-edge-dom: ${t.name}`); } catch (e) { fail++; console.log(`FAIL editor-edge-dom: ${t.name}\n  ${e.stack || e.message}`); }
  }
  return fail;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const f = await summary();
  console.log(f ? `\n${f} FAILED` : '\nALL PASSED');
  process.exit(f ? 1 : 0);
}
