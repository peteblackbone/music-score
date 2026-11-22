// 2.1.0 editor effects under the DOM shim: the effect keys through ScoreEditor (undo, refusals, read-only),
// the spoken text and cursor info, a render check of every value the editor writes, and the demo's Effects group.
// Run via `node tests/run.js` (awaits summary()), or directly: `node tests/editor-effects-dom.mjs`.
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
const { keyToCommand } = await imp('src/editor/keymap.js');
const { effectButtonState, wireEffects, BUTTONS } = await imp('examples/editor-demo-effects.js');
const { EFFECT_BY_NAME } = await imp('src/editor/model/effectTable.js');
const fs = await import('node:fs');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const eq = (a, b, m = '') => {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${m} expected ${y}, got ${x}`);
};
const ok = (c, m = 'assertion failed') => { if (!c) throw new Error(m); };
const nt = (duration, string = 1, fret = 0, extra = {}) => ({ type: 'note', duration, notes: [{ string, fret }], ...extra });
const tn = (duration, string, fret, flags = {}, extra = {}) => ({ type: 'note', duration, notes: [{ string, fret, ...flags }], ...extra });
const rest = (duration = 'quarter', extra = {}) => ({ type: 'rest', duration, ...extra });
const key = (k, mods = {}) => ({ key: k, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods });
const K = (spec) => (spec.startsWith('Shift+') ? key(spec.slice(6).toUpperCase(), { shiftKey: true }) : key(spec));
const EFFECT_KEYS = ['h', 's', 'Shift+s', 'b', 'Shift+b', 'v', 'p', 'x', 'g', 'n', 'Shift+l', 'd', 'Shift+d', 'a', 'Shift+a'];
const LABELS = ['hammer-on/pull-off', 'slide', 'slide in/out', 'bend', 'bend', 'vibrato', 'palm mute', 'dead note', 'ghost note', 'harmonic', 'let ring', 'dynamic', 'dynamic', 'accent', 'staccato'];

/** An editor in a fresh container with a manual clock (renders synchronously). */
function mk(score, opts = {}) {
  const clock = makeClock();
  clock.requestAnimationFrame = null; clock.cancelAnimationFrame = null;
  const box = makeContainer();
  const ed = new ScoreEditor(box, score, { width: 900, clock, ...opts });
  const events = [];
  ed.on('change', (e) => events.push(['change', e]));
  const rootEl = box.children[0];
  const live = rootEl.children[1];
  /** Press keys (specs), let the live region settle, return its text. */
  const say = (...specs) => { specs.forEach((s) => ed.handleKey(typeof s === 'string' ? K(s) : s)); clock.advance(150); return live.textContent.replace(/ $/, ''); };
  return { ed, box, clock, events, live, say };
}
const beats = (ed, ti = 0, mi = 0) => { const m = ed.getScore().tracks[ti].measures[mi]; return m.voices ? m.voices[0].beats : m.beats; };
const score = () => ({ title: 'Fx', tracks: [
  { name: 'Gtr', showTablature: true, measures: [
    { beats: [nt('quarter', 1, 5), nt('quarter', 2, 3), rest('quarter'), nt('quarter', 1, 7)] },
    { beats: [nt('half', 1, 0)] },
  ] },
  { name: 'Std', measures: [{ beats: [{ type: 'note', duration: 'whole', notes: [{ pitch: 'C4' }] }] }, { beats: [] }] },
  { name: 'Bass', showStandardNotation: false, showTablature: true, tuning: ['E1', 'A1', 'D2', 'G2'], measures: [{ beats: [nt('whole', 4, 3)] }, { beats: [] }] },
] });

// ---------- AC3: undo / redo by reference ----------
test('AC3: undo after every effect key restores the earlier model by reference and redo the later one; one key = one step; labels as listed', () => {
  EFFECT_KEYS.forEach((spec, i) => {
    const { ed, say, events } = mk(score());
    const before = ed._model;
    const cursor = ed.getCursor();
    eq(ed.handleKey(K(spec)), true, spec);
    const after = ed._model;
    ok(after !== before && events.length === 1 && events[0][1].source === 'edit', `${spec}: one change event`);
    eq(ed.getCursor(), cursor, `${spec}: cursor kept`);
    eq(say(key('z', { ctrlKey: true })), `Undo: ${LABELS[i]}`);
    ok(ed._model === before && !ed.canUndo(), `${spec}: undo restores the model object; one step`);
    eq(say(key('y', { ctrlKey: true })), `Redo: ${LABELS[i]}`);
    ok(ed._model === after, `${spec}: redo restores the later object`);
    ok(sanitizeScore(after) === after, `${spec}: sanitize-stable`);
    ed.destroy();
  });
});

// ---------- AC4: refusals ----------
test('AC4: refused effect keys are consumed, say why, and change nothing (no change event, no history entry)', () => {
  const { ed, say, events } = mk(score());
  const refused = (where, spec, text) => {
    ed.setCursor(where);
    const before = ed._model;
    events.length = 0;
    eq(say(spec), text, `${spec} at ${JSON.stringify(where)}`);
    ok(ed._model === before && events.length === 0 && !ed.canUndo(), `${spec}: nothing changed`);
  };
  for (const spec of ['h', 's', 'Shift+s', 'b', 'Shift+b', 'x', 'g', 'n']) refused({ track: 1, measure: 0, beat: 0 }, spec, 'Needs a TAB staff');
  for (const spec of ['h', 's', 'Shift+s', 'b', 'Shift+b', 'g', 'n']) refused({ track: 0, measure: 0, beat: 2, string: 1 }, spec, 'No note on this string');
  for (const spec of ['h', 'b', 'g']) refused({ track: 0, measure: 0, beat: 0, string: 4 }, spec, 'No note on this string');
  for (const spec of ['h', 'v', 'p', 'd', 'a']) refused({ track: 0, measure: 1, beat: 1, string: 1 }, spec, 'No beat here');
  for (const spec of ['v', 'Shift+l', 'a', 'Shift+a']) refused({ track: 0, measure: 0, beat: 2, string: 1 }, spec, 'Needs a note');
  ed.destroy();
});
test('AC4: read-only refuses every effect key with "Read-only" (not consumed, no change, no history)', () => {
  const { ed, say, events } = mk(score(), { readOnly: true });
  const before = ed._model;
  for (const spec of EFFECT_KEYS) {
    eq(ed.handleKey(K(spec)), false, spec);
    eq(say(), 'Read-only');
  }
  ok(ed._model === before && events.length === 0, 'nothing changed');
  ed.setReadOnly(false);
  ok(!ed.canUndo(), 'no history');
  eq(ed.handleKey(K('h')), true);
  ed.destroy();
});

test('F1: handleKey with event keys named like Object.prototype members is not consumed and never throws', () => {
  const { ed, events } = mk(score());
  const before = ed._model;
  for (const k of ['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty']) {
    for (const mods of [{}, { shiftKey: true }, { ctrlKey: true }]) eq(ed.handleKey(key(k, mods)), false, `${k} ${JSON.stringify(mods)}`);
  }
  ok(ed._model === before && events.length === 0);
  ed.destroy();
});

// ---------- AC12 / AC15: spoken text, cursor info, moves ----------
test('AC12: spoken effect messages and suffixes, as listed', () => {
  const { ed, say } = mk(score());
  const at = (c) => ed.setCursor({ track: 0, measure: 0, beat: 0, string: 1, ...c });
  at({});
  eq(say('h'), 'Hammer-on/pull-off on');
  eq(say('h'), 'Hammer-on/pull-off off');
  at({ beat: 3 });
  eq(say('h'), 'Hammer-on/pull-off on');
  at({ beat: 1, string: 2 });
  eq(say('h'), 'Hammer-on/pull-off on, no next note on this string');
  eq(say('s'), 'Slide, no next note on this string');
  eq(say('s'), 'Legato slide, no next note on this string');
  eq(say('s'), 'Slide off');
  eq([say('Shift+s'), say('Shift+s'), say('Shift+s'), say('Shift+s'), say('Shift+s')], ['Slide in from below', 'Slide in from above', 'Slide out down', 'Slide out up', 'Slide in/out off']);
  eq([1, 2, 3, 4, 5, 6].map(() => say('b')), ['Bend full', 'Bend half', 'Bend full and release', 'Pre-bend full', 'Release', 'Bend off']);
  eq([say('Shift+b'), say('Shift+b')], ['Release', 'Pre-bend full']);
  eq([say('v'), say('v'), say('v')], ['Vibrato', 'Wide vibrato', 'Vibrato off']);
  eq([say('p'), say('p')], ['Palm mute on', 'Palm mute off']);
  eq([say('x'), say('n'), say('n'), say('x'), say('x')], ['Dead note on', 'Natural harmonic', 'Pinch harmonic', 'Dead note on', 'Dead note off']);
  eq([say('g'), say('g')], ['Ghost note on', 'Ghost note off']);
  eq([say('Shift+l'), say('Shift+l')], ['Let ring on', 'Let ring off']);
  eq([say('d'), say('d'), say('Shift+d'), say('Shift+d')], ['Dynamic mf', 'Dynamic f', 'Dynamic mf', 'Dynamic mp']);
  eq([say('a'), say('a'), say('a'), say('Shift+a'), say('Shift+a'), say('Shift+a')], ['Accent', 'Marcato', 'Accent off', 'Staccato', 'Staccatissimo', 'Staccato off']);
  at({ beat: 0, string: 6 });
  eq(say('x'), 'Dead note added');
  ed.setCursor({ track: 0, measure: 1, beat: 1, string: 3 });
  eq(say('x'), 'Dead note added');
  eq(beats(ed, 0, 1)[1].notes, [{ string: 3, fret: 0, mute: true }]);
  ed.setCursor({ track: 2, measure: 0, beat: 0, string: 4 });
  eq([say('d'), say('a'), say('Shift+a')], ['Dynamic mf, not shown on TAB only', 'Accent, not shown on TAB only', 'Staccato, not shown on TAB only']);
  eq(say('h'), 'Hammer-on/pull-off on, no next note on this string');
  ed.setCursor({ track: 1, measure: 0, beat: 0 });
  eq([say('d'), say('a'), say('v')], ['Dynamic mf', 'Accent', 'Vibrato']);
  ed.destroy();
});
test('AC15: getCursorInfo().effects / noteEffects, and move announcements speak the effects after the duration (Up / Down: note effects only)', () => {
  const s = score();
  s.tracks[0].measures[0].beats = [
    tn('quarter', 1, 5, { hammerPull: true, tieStart: true }, { palmMute: true, dynamic: 'p' }),
    { type: 'note', duration: 'quarter', palmMute: true, notes: [{ string: 1, fret: 5, tieEnd: true }, { string: 2, fret: 3, bend: 'full', ghost: true }] },
    rest('quarter', { letRing: true }),
    nt('quarter', 1, 7),
  ];
  s.tracks[1].measures[0].beats[0].vibrato = 'wide';
  const { ed, say } = mk(s);
  const info = () => { const i = ed.getCursorInfo(); return [i.effects, i.noteEffects]; };
  eq(info(), [['hammer/pull', 'palm mute', 'p'], ['hammer/pull']]);
  eq(say('ArrowRight'), 'Beat 2, string 1, fret 5, quarter, palm mute, tied');
  eq(say('ArrowDown'), 'String 2, fret 3, bend full, ghost');
  eq(info(), [['bend full', 'ghost', 'palm mute'], ['bend full', 'ghost']]);
  eq(say('ArrowDown'), 'String 3, empty');
  eq(info(), [['palm mute'], []]);
  eq(say('ArrowRight'), 'Beat 3, rest, quarter, let ring');
  eq(say('ArrowRight'), 'Beat 4, string 3, empty, quarter');
  ed.setCursor({ track: 0, measure: 1, beat: 1 });
  eq(info(), [[], []]);
  eq(say('PageDown'), 'Track 2 Std, measure 2, empty measure');
  ed.setCursor({ track: 1, measure: 0, beat: 0 });
  eq(say(), 'Measure 1, beat 1, note, whole, wide vibrato');
  eq(info(), [['wide vibrato'], []]);
  ed.setCursor({ track: 0, measure: 0, beat: 0, string: 1 });
  say();
  eq(say('Shift+s', 'b'), 'Bend full');
  eq(say('ArrowRight', 'ArrowLeft'), 'Beat 1, string 1, fret 5, quarter, hammer/pull, slide in, bend full, palm mute, p, tied');
  ed.destroy();
});

// ---------- AC18: what the editor writes renders as expected ----------
/** Class attributes of the render of `score` (the editor's getScore output). */
const classesOf = (s, width = 900) => {
  const box = makeContainer();
  new MusicScoreRenderer(box, s, { width }).render();
  const out = serialize(box.children[0]);
  return { out, classes: new Set([...out.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(' '))) };
};
test('AC18: every value the editor writes renders: hammer-pull, slide, legato-slide, slide-in-below, slide-out-down, bend, bend-prebend, bend-release, tab-vibrato-wide, palm-mute, let-ring, harmonic-pinch, dynamic, articulations', () => {
  const base = () => ({ title: 'R', tracks: [{ name: 'Gtr', showTablature: true, measures: [{ beats: [nt('quarter', 1, 5), nt('quarter', 1, 7), nt('half', 2, 3)] }] }] });
  const cases = [
    [['h'], 'hammer-pull'], [['s', 's'], 'legato-slide'], [['Shift+s'], 'slide-in-below'], [['Shift+s', 'Shift+s', 'Shift+s'], 'slide-out-down'],
    [['b'], 'bend'], [['b', 'b', 'b', 'b'], 'bend-prebend'], [['Shift+b'], 'bend-release'], [['v', 'v'], 'tab-vibrato-wide'],
    [['p'], 'palm-mute'], [['Shift+l'], 'let-ring'], [['n', 'n'], 'harmonic-pinch'], [['d'], 'dynamic'], [['a'], 'articulations'], [['Shift+a'], 'articulations'],
  ];
  const plain = classesOf(base());
  for (const [specs, cls] of cases) {
    const { ed, say } = mk(base());
    say(...specs);
    const r = classesOf(ed.getScore());
    ok(r.classes.has(cls) && !plain.classes.has(cls), `${specs.join(' ')} → .${cls}`);
    ed.destroy();
  }
  // a plain slide is drawn without a class of its own: the render must differ from the one without it, by a new diagonal
  const { ed, say } = mk(base());
  say('s');
  const slide = classesOf(ed.getScore());
  const count = (o, re) => (o.match(re) || []).length;
  ok(slide.out !== plain.out && count(slide.out, /<rect /g) > count(plain.out, /<rect /g), 'slide drawn');
  ed.destroy();
});

// ---------- AC19: demo Effects group ----------
const OFF = {
  hammerPull: { pressed: false }, slide: { label: 'Slide: off' }, bend: { label: 'Bend: off' }, vibrato: { label: 'Vibrato: off' },
  palmMute: { pressed: false }, deadNote: { pressed: false }, ghostNote: { pressed: false }, harmonic: { label: 'Harmonic: off' },
  letRing: { pressed: false }, louder: { label: 'Dynamic +' }, softer: { label: 'Dynamic −' }, accent: { label: 'Accent: off' }, staccato: { label: 'Staccato: off' },
};
test('AC19: effectButtonState reads getCursorInfo().effectSteps — toggles pressed, cycle labels name the state, custom values say custom; no steps is all off', () => {
  eq(effectButtonState({ effects: [], noteEffects: [], effectSteps: {} }), OFF);
  eq(effectButtonState(null), OFF);
  eq(effectButtonState({ effects: ['bend full', 'palm mute'], noteEffects: ['bend full'] }), OFF, 'words alone are not parsed');
  const at = (flags, beatFields = {}) => {
    const { ed } = mk({ tracks: [{ showTablature: true, measures: [{ beats: [tn('quarter', 1, 5, flags, beatFields)] }] }] });
    const st = effectButtonState(ed.getCursorInfo());
    ed.destroy();
    return st;
  };
  eq(at({ hammerPull: 'p', slide: 'legato', bend: 'pb full', mute: true, ghost: true, harmonic: 'pinch' },
    { vibrato: 'WIDE', palmMute: true, letRing: true, dynamic: 'ff', articulations: ['tenuto', 'heavyAccent', 'staccatissimo'] }), {
    hammerPull: { pressed: true }, slide: { label: 'Slide: legato' }, bend: { label: 'Bend: pre-bend full' }, vibrato: { label: 'Vibrato: wide' },
    palmMute: { pressed: true }, deadNote: { pressed: true }, ghostNote: { pressed: true }, harmonic: { label: 'Harmonic: pinch' },
    letRing: { pressed: true }, louder: { label: 'Dynamic + (ff)' }, softer: { label: 'Dynamic − (ff)' }, accent: { label: 'Accent: marcato' }, staccato: { label: 'Staccato: staccatissimo' },
  });
  eq([at({ slide: true }).slide, at({ slide: 'up' }).slide, at({ bend: 'half' }).bend, at({ bend: '1/2' }).bend, at({ bend: 'full release' }).bend, at({ harmonic: true }).harmonic, at({ harmonic: 'artificial' }).harmonic, at({ hammerPull: true }).hammerPull],
    [{ label: 'Slide: on' }, { label: 'Slide: custom' }, { label: 'Bend: custom' }, { label: 'Bend: half' }, { label: 'Bend: full and release' }, { label: 'Harmonic: natural' }, { label: 'Harmonic: custom' }, { pressed: true }]);
  eq([at({}, { vibrato: true }).vibrato, at({}, { articulations: ['accent', 'staccato'] }).accent, at({}, { articulations: ['accent', 'staccato'] }).staccato, at({}, { articulations: ['accent'] }).staccato, at({}, { dynamic: 'sfz' }).louder, at({}, { articulations: ['tenuto'] }).accent],
    [{ label: 'Vibrato: on' }, { label: 'Accent: on' }, { label: 'Staccato: on' }, { label: 'Staccato: off' }, { label: 'Dynamic +' }, { label: 'Accent: off' }]);
});
/** A stub button: dataset, attributes, a click listener and the `disabled` / `textContent` properties the demo sets. */
const stubButton = (effect, k, shift = false) => {
  const attrs = {};
  const listeners = [];
  return {
    dataset: { effect, key: k, ...(shift ? { shift: 'true' } : {}) }, textContent: '', disabled: false,
    setAttribute: (n, v) => { attrs[n] = String(v); }, getAttribute: (n) => attrs[n] ?? null,
    addEventListener: (type, fn) => { if (type === 'click') listeners.push(fn); },
    click: (detail = 1) => listeners.forEach((fn) => fn({ detail })),
  };
};
test('AC19: wireEffects drives the editor through handleKey, refreshes the buttons, calls back(event), and disables every button in read-only mode', () => {
  const { ed } = mk(score());
  const buttons = [stubButton('hammerPull', 'h'), stubButton('bend', 'b'), stubButton('softer', 'd', true), stubButton('letRing', 'l', true)];
  const backs = [];
  const refresh = wireEffects(buttons, ed, (e) => backs.push(e.detail));
  const [hp, bend, softer, ring] = buttons;
  refresh(ed.getCursorInfo(), ed.isReadOnly());
  eq([hp.getAttribute('aria-pressed'), bend.textContent, softer.textContent, ring.getAttribute('aria-pressed'), bend.disabled], ['false', 'Bend: off', 'Dynamic −', 'false', false]);
  hp.click(); bend.click(); bend.click(); softer.click(2); ring.click(0);
  eq(beats(ed)[0], { type: 'note', duration: 'quarter', notes: [{ string: 1, fret: 5, hammerPull: true, bend: '1/2' }], dynamic: 'mp', letRing: true });
  eq([hp.getAttribute('aria-pressed'), bend.textContent, softer.textContent, ring.getAttribute('aria-pressed')], ['true', 'Bend: half', 'Dynamic − (mp)', 'true']);
  eq(backs, [1, 1, 1, 2, 0], 'back gets every click event (the demo refocuses on detail > 0)');
  ed.setReadOnly(true);
  refresh(ed.getCursorInfo(), ed.isReadOnly());
  ok(buttons.every((b) => b.disabled), 'disabled read-only');
  ed.setReadOnly(false);
  ed.setCursor({ track: 0, measure: 0, beat: 2 });
  refresh(ed.getCursorInfo(), ed.isReadOnly());
  eq([hp.getAttribute('aria-pressed'), bend.textContent, buttons.some((b) => b.disabled)], ['false', 'Bend: off', false], 'state follows the cursor');
  ed.destroy();
});
test('AC19: editor.html has the Effects group (role=group, a button per demo effect whose data-key / data-shift run its data-effect command), the Effects status item and a <dt> for every key', () => {
  const html = fs.readFileSync(path.join(root, 'editor.html'), 'utf8');
  ok(/<div class="group effects" role="group" aria-label="Effects">/.test(html), 'group');
  const buttons = [...html.matchAll(/<button type="button" data-effect="(\w+)" data-key="(\w)"( data-shift="true")?[^>]*>/g)];
  eq(buttons.map((m) => m[1]), BUTTONS, 'one button per BUTTONS entry, in order');
  ok(BUTTONS.length >= 13 && BUTTONS.every((n) => Object.hasOwn(EFFECT_BY_NAME, n)), 'every button is an effect row');
  eq(Object.keys(effectButtonState(null)), BUTTONS, 'effectButtonState covers exactly the buttons');
  for (const [tag, name, k, shift] of buttons) {
    eq(keyToCommand({ key: k, shiftKey: !!shift })?.name, name, name);
    eq(/aria-pressed="false"/.test(tag), ['hammerPull', 'palmMute', 'deadNote', 'ghostNote', 'letRing'].includes(name), `${name}: aria-pressed only on toggles`);
  }
  ok(/<span id="st-effects">/.test(html), 'status item');
  const dts = new Set([...html.matchAll(/<dt>([^<]+)<\/dt>/g)].map((m) => m[1]));
  for (const k of ['H', 'S', 'Shift+S', 'B', 'Shift+B', 'V', 'P', 'X', 'G', 'N', 'Shift+L', 'D', 'Shift+D', 'A', 'Shift+A']) ok(dts.has(k), `<dt>${k}</dt>`);
  ok(/<h3>Effects<\/h3>/.test(html), 'Effects section');
});

export async function summary() {
  let fail = 0;
  for (const t of tests) {
    try { await t.fn(); console.log(`PASS editor-effects-dom: ${t.name}`); } catch (e) { fail++; console.log(`FAIL editor-effects-dom: ${t.name}\n  ${e.stack || e.message}`); }
  }
  return fail;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const f = await summary();
  console.log(f ? `\n${f} FAILED` : '\nALL PASSED');
  process.exit(f ? 1 : 0);
}
