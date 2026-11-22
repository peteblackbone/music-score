// 2.0.0 editor checks that need the DOM shim: the renderer hit map (getHitMap / hitTest) and the
// ScoreEditor controller (tests/editor-shim.mjs adds events, focus and friends to tests/dom-shim.mjs).
// Run via `node tests/run.js` (awaits summary()), or directly: `node tests/editor-dom.mjs`.
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

register('./hooks.mjs', import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const { makeContainer, serialize } = await import('./dom-shim.mjs');
const { MusicScoreRenderer } = await imp('src/MusicScoreRenderer.js');
const { resolveTheme } = await imp('src/theme.js');
const { computeLayout } = await imp('src/layout/index.js');
const { normalizeScore } = await imp('src/normalize.js');
const { hitTestMap } = await imp('src/hitMap.js');
const { cases } = await import('./cases.mjs');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const eq = (a, b, m = '') => {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${m} expected ${y}, got ${x}`);
};
const ok = (c, m = 'assertion failed') => { if (!c) throw new Error(m); };
const clone = (o) => JSON.parse(JSON.stringify(o));
const theme = resolveTheme();
const nt = (duration, string = 1, fret = 0, extra = {}) => ({ type: 'note', duration, notes: [{ string, fret }], ...extra });
const graceB = (string = 2, fret = 3) => ({ type: 'grace', duration: '16th', notes: [{ string, fret }] });
const hiddenRest = (duration = 'quarter') => ({ type: 'rest', duration, hidden: true });

// ---------- hit map (A1–A6) ----------
const richScore = () => ({
  title: 'rich',
  tracks: [
    { name: 'Guitar', showTablature: true, measures: [
      { beats: [nt('quarter'), graceB(), nt('quarter', 2, 2), hiddenRest(), nt('quarter')] },
      { beats: [nt('8th', 1, 1, { tuplet: 3 }), nt('8th', 1, 2, { tuplet: 3 }), nt('8th', 1, 3, { tuplet: 3 }), nt('quarter'), nt('half')] },
      { voices: [
        { beats: [graceB(), nt('half'), hiddenRest(), nt('quarter')] },
        { beats: [hiddenRest(), nt('quarter', 3, 0), nt('half', 4, 0)] },
      ] },
      { beats: [] },
    ] },
    { name: 'Bass', showStandardNotation: false, showTablature: true, tuning: ['E1', 'A1', 'D2', 'G2'], measures: [{ beats: [nt('whole', 4, 3)] }] },
    { name: 'Hidden', showStandardNotation: false, showTablature: false, measures: [{ beats: [nt('whole')] }] },
  ],
});
const rendered = (score, width = 1100, opts = {}) => {
  const box = makeContainer();
  const r = new MusicScoreRenderer(box, score, { width, ...opts });
  r.render();
  return { box, r, svg: box.children[0] };
};
const walk = (n, f, out = []) => { if (f(n)) out.push(n); n.children.forEach((c) => walk(c, f, out)); return out; };
const cls = (n) => n.getAttribute('class') || '';
const staffGroups = (svg) => walk(svg, (n) => n.tag === 'g' && /(^| )staff( |$)/.test(cls(n)));
const translateY = (g) => Number(/translate\(0,(-?[\d.]+)\)/.exec(g.getAttribute('transform'))[1]);

test('getSvg: null before the first render, then the mounted svg of the latest render', () => {
  const box = makeContainer();
  const r = new MusicScoreRenderer(box, richScore(), { width: 700 });
  eq(r.getSvg(), null);
  r.render();
  ok(r.getSvg() === box.children[0]);
  r.render();
  ok(r.getSvg() === box.children[0]);
});
test('hit map: null before the first render; getHitMap and hitTest return null', () => {
  const r = new MusicScoreRenderer(makeContainer(), richScore(), { width: 700 });
  eq(r.getHitMap(), null);
  eq(r.hitTest(10, 10), null);
});
test('hit map: getHitMap() leaves the serialized SVG unchanged and returns a fresh object each call (every snapshot case)', () => {
  for (const c of cases) {
    const box = makeContainer();
    const r = new MusicScoreRenderer(box, clone(c.score), { width: c.width, ...(c.options || {}) });
    r.render();
    const before = serialize(box.children[0]);
    const a = r.getHitMap();
    const b = r.getHitMap();
    ok(a !== b && a.staves !== b.staves, `${c.id}: fresh object`);
    eq(a, b, `${c.id}: same data`);
    if (serialize(box.children[0]) !== before) throw new Error(`${c.id}: SVG changed`);
    eq(box.children.length, 1, c.id);
  }
});
test('hit map: no data-* attribute or overlay group appears in plain renderer output', () => {
  const { svg } = rendered(richScore());
  const out = serialize(svg);
  ok(!/editor-overlay/.test(out), 'no overlay');
  ok(!/data-(beat|measure|hit|string)/.test(out), 'no addressing attributes');
});
test('hit map: staves per system top to bottom, with kind, y = drawn translate, lineBottom, x1/x2; hidden tracks skipped', () => {
  const { r, svg } = rendered(richScore());
  const map = r.getHitMap();
  const gs = staffGroups(svg);
  eq(map.staves.map((s) => [s.ti, s.kind]), [[0, 'notation'], [0, 'tab'], [1, 'tab']]);
  eq(map.staves.map((s) => s.y), gs.map(translateY));
  eq(map.staves.map((s) => s.lineBottom), [40, 75, 45]);
  eq(map.staves.map((s) => [s.stringSpacing, s.stringCount]), [[undefined, undefined], [15, 6], [15, 4]].map(([a, b]) => [a, b]));
  ok(map.staves.every((s) => s.sysIdx === 0 && s.x1 < s.x2));
  eq(map.width, Number(svg.getAttribute('width')));
  eq(map.height, Number(svg.getAttribute('height')));
  ok(!map.measures.some((m) => m.ti === 2) && !map.elements.some((e) => e.ti === 2), 'hidden track has no records');
});
test('hit map: TAB string n lies on the drawn line (translate + local y1) within 0.01', () => {
  const { r, svg } = rendered(richScore());
  const map = r.getHitMap();
  const tabs = staffGroups(svg).filter((g) => /staff-tab/.test(cls(g)));
  map.staves.filter((s) => s.kind === 'tab').forEach((s, i) => {
    const g = tabs[i];
    const ly = g.children[0].children.map((l) => Number(l.getAttribute('y1')));
    for (let n = 1; n <= s.stringCount; n++) {
      const drawn = translateY(g) + ly[s.stringCount - n];
      ok(Math.abs(s.y + (n - 1) * s.stringSpacing - drawn) < 0.01, `string ${n}`);
    }
  });
});
test('hit map: measures and elements mirror the layout (x unrounded); beatIndex keeps graces, hidden rests and voice 2', () => {
  const sc = richScore();
  const { r } = rendered(sc);
  const map = r.getHitMap();
  const L = computeLayout(normalizeScore(sc), theme, 1100);
  const lm = L.systems[0].tracks[0].measures;
  eq(map.measures.filter((m) => m.ti === 0).map((m) => [m.measureIndex, m.x, m.contentX, m.endX]), lm.map((m) => [m.measureIndex, m.x, m.contentX, m.endX]));
  const el = (mi, v) => map.elements.filter((e) => e.ti === 0 && e.measureIndex === mi && e.voice === v);
  eq(el(0, 1).map((e) => [e.beatIndex, e.isGrace, e.isRest]), [[0, false, false], [1, true, false], [2, false, false], [3, false, true], [4, false, false]]);
  eq(el(0, 1).map((e) => e.x), lm[0].elements.map((e) => e.x));
  eq(el(2, 1).map((e) => [e.beatIndex, e.isGrace, e.isRest]), [[0, true, false], [1, false, false], [2, false, true], [3, false, false]]);
  eq(el(2, 2).map((e) => [e.beatIndex, e.isRest]), [[0, true], [1, false], [2, false]]);
  eq(el(3, 1), []);
  eq(map.elements.filter((e) => e.ti === 1).map((e) => [e.measureIndex, e.beatIndex]), [[0, 0]]);
});
test('hit map: multiMeasureRests runs are one measure record with lastMeasureIndex', () => {
  const sc = { multiMeasureRests: true, tracks: [{ showTablature: true, measures: [{ beats: [nt('whole')] }, { beats: [{ type: 'rest', duration: 'whole' }] }, { beats: [{ type: 'rest', duration: 'whole' }] }, { beats: [nt('whole')] }] }] };
  const map = rendered(sc).r.getHitMap();
  eq(map.measures.map((m) => [m.measureIndex, m.lastMeasureIndex]), [[0, undefined], [1, 2], [3, undefined]]);
});
test('hit map: staff y follows several systems', () => {
  const many = { tracks: [{ showTablature: true, measures: Array.from({ length: 8 }, () => ({ beats: [nt('quarter'), nt('quarter'), nt('quarter'), nt('quarter')] })) }] };
  const { r, svg } = rendered(many, 300);
  const map = r.getHitMap();
  ok(new Set(map.staves.map((s) => s.sysIdx)).size >= 2, 'several systems');
  eq(map.staves.map((s) => s.y), staffGroups(svg).map(translateY));
  eq(new Set(map.measures.map((m) => m.measureIndex)).size, 8);
});
test('hitTest: beat by nearest x, string by nearest line, notation without string, null outside staves', () => {
  const sc = richScore();
  const { r } = rendered(sc);
  const map = r.getHitMap();
  const tab = map.staves.find((s) => s.ti === 0 && s.kind === 'tab');
  const nota = map.staves.find((s) => s.ti === 0 && s.kind === 'notation');
  const e2 = map.elements.find((e) => e.ti === 0 && e.measureIndex === 0 && e.beatIndex === 2);
  eq(r.hitTest(e2.x + 1, tab.y + 2 * 15 + 3), { ti: 0, measureIndex: 0, beatIndex: 2, string: 3 });
  eq(r.hitTest(e2.x - 1, tab.y - 12), { ti: 0, measureIndex: 0, beatIndex: 2, string: 1 }, 'above the top line clamps to string 1');
  eq(r.hitTest(e2.x, nota.y + 20), { ti: 0, measureIndex: 0, beatIndex: 2 });
  eq(r.hitTest(e2.x, nota.y - 100), null);
  eq(r.hitTest(e2.x, tab.y + 75 + 16), null, 'more than one string gap below the bottom line');
  const m3 = map.measures.find((m) => m.ti === 0 && m.measureIndex === 3);
  eq(r.hitTest((m3.contentX + m3.endX) / 2, tab.y), { ti: 0, measureIndex: 3, beatIndex: 0, string: 1 }, 'empty measure');
  const bass = map.staves.find((s) => s.ti === 1);
  eq(r.hitTest(m3.endX + 5, bass.y + 45).string, 4, 'x just past the end clamps to the last measure, string clamps to 4');
  eq(r.hitTest(m3.endX + 5, bass.y + 45).measureIndex, 3);
});
test('hitTest: graces are never hit; a hidden rest at the same x loses to the lower index', () => {
  const { r } = rendered(richScore());
  const map = r.getHitMap();
  const tab = map.staves.find((s) => s.ti === 0 && s.kind === 'tab');
  const g = map.elements.find((e) => e.ti === 0 && e.measureIndex === 0 && e.isGrace);
  ok([0, 2].includes(r.hitTest(g.x, tab.y).beatIndex), 'grace click goes to a main beat');
  const h = map.elements.find((e) => e.ti === 0 && e.measureIndex === 0 && e.beatIndex === 3);
  eq(r.hitTest(h.x, tab.y).beatIndex, 2);
  const m2g = map.elements.find((e) => e.ti === 0 && e.measureIndex === 2 && e.voice === 1 && e.isGrace);
  eq(r.hitTest(m2g.x - 2, tab.y).beatIndex, 1, 'voice-1 index in a two-voice measure');
});
test('hitTestMap: guards (null map, NaN coordinates)', () => {
  eq(hitTestMap(null, 1, 1), null);
  const { r } = rendered(richScore());
  eq(hitTestMap(r.getHitMap(), NaN, 10), null);
});

// ---------- ScoreEditor controller (B, F, G, I) ----------
const { makeClock, scrollLog } = await import('./editor-shim.mjs');
const barrel = await imp('index.js');
const { ScoreEditor } = await imp('src/editor/ScoreEditor.js');
const { EFFECTS } = await imp('src/editor/model/effectTable.js');
const { sanitizeScore } = await imp('src/sanitize.js');
const { leadRiff } = await imp('examples/lead-riff.js');
const tn = (duration, string, fret, flags = {}) => ({ type: 'note', duration, notes: [{ string, fret, ...flags }] });
const key = (k, mods = {}) => ({ key: k, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods });
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
const lastChild = (n) => n.children[n.children.length - 1];
const findAll = (n, f, out = []) => { if (f(n)) out.push(n); n.children.forEach((c) => findAll(c, f, out)); return out; };
const byClass = (n, c) => findAll(n, (x) => (x.getAttribute?.('class') || '').split(' ').includes(c));
const attrs = (n) => Object.fromEntries(n.attrs);
const twoBar = () => ({ title: 'Two bars', tracks: [{ name: 'Gtr', showTablature: true, measures: [
  { beats: [nt('quarter', 1, 3), nt('quarter', 2, 5), nt('half', 3, 7)] },
  { beats: [nt('half', 1, 0), nt('quarter', 6, 3)] },
] }] });

test('B1: index.js exports ScoreEditor (and the renderer unchanged)', () => {
  ok(barrel.ScoreEditor === ScoreEditor && barrel.MusicScoreRenderer === MusicScoreRenderer);
});
test('B2 / I1: builds root, render host and live region inside the container only; default score; synchronous first render', () => {
  const { box, root, host, live, svg, ed } = mk(undefined);
  eq(box.children.length, 1);
  eq(attrs(root), { class: 'music-score-editor', tabindex: '0', role: 'application', 'aria-roledescription': 'tablature editor', style: 'position:relative', 'aria-label': 'Untitled' });
  eq(attrs(host), { class: 'music-score-editor-host' });
  eq([live.getAttribute('class'), live.getAttribute('aria-live'), live.getAttribute('aria-atomic')], ['music-score-editor-live', 'polite', 'true']);
  ok(/clip-path:inset\(50%\)/.test(live.getAttribute('style')) && !/outline/.test(root.getAttribute('style')), 'visually hidden live region; no outline:none');
  eq(svg().tag, 'svg');
  eq(ed.getScore().tracks[0].measures, [{ beats: [] }]);
  eq(ed.getScore().title, 'Untitled');
  eq(mk({ tracks: [] }).root.getAttribute('aria-label'), 'Untitled score');
});
test('B2: a bad score throws before anything is written to the container; options are validated', () => {
  const box = makeContainer();
  let threw = 0;
  for (const bad of ['{nope', '[1]', { schemaVersion: 2, tracks: [] }]) { try { new ScoreEditor(box, bad); } catch { threw++; } }
  eq([threw, box.children.length], [3, 0]);
  try { new ScoreEditor(null); } catch (e) { threw++; ok(e instanceof TypeError); }
  eq(threw, 4);
  const { ed } = mk(twoBar(), { maxFret: 200, historyLimit: -3, twoDigitDelayMs: -1 });
  ed.setCursor({ beat: 0, string: 1 });
  ok(ed.handleKey(key('9')));
  eq(beats(ed)[0].notes[0].fret, 9, 'maxFret clamped to 99 still allows 9');
  eq(ed.canUndo(), false, 'historyLimit clamped to 0');
});
test('B3: loadScore resets cursor and history, emits change {source:"load"} after its render, then cursor; bad input changes nothing', () => {
  const { ed, events, svg } = mk(twoBar());
  press(ed, 'ArrowRight', '5');
  eq(ed.canUndo(), true);
  events.length = 0;
  const before = svg();
  ed.loadScore(JSON.stringify({ schemaVersion: 1, title: 'New', tracks: [{ showTablature: true, measures: [{ beats: [nt('whole', 2, 2)] }] }] }));
  ok(svg() !== before, 'rendered');
  eq(events, [['change', { source: 'load' }], ['cursor', { track: 0, measure: 0, beat: 0, string: 1, voice: 1 }]]);
  eq([ed.getCursor(), ed.canUndo(), ed.canRedo()], [{ track: 0, measure: 0, beat: 0, string: 1 }, false, false]);
  const snap = JSON.stringify(ed.getScore());
  for (const bad of [{ schemaVersion: 2 }, '{x', 'null']) {
    let threw = false; try { ed.loadScore(bad); } catch { threw = true; }
    ok(threw, JSON.stringify(bad));
  }
  eq(JSON.stringify(ed.getScore()), snap);
  let msg = ''; try { ed.loadScore({ schemaVersion: 2, tracks: [] }); } catch (e) { msg = e.message; }
  eq(msg, 'Unsupported schemaVersion');
});
test('B3 (atomic): a load that throws leaves model, cursor, history, events and DOM unchanged', () => {
  const { ed, events, svg, box } = mk(twoBar());
  ed.setCursor({ measure: 1, beat: 1, string: 6 });
  press(ed, '4');
  events.length = 0;
  const before = { score: JSON.stringify(ed.getScore()), cursor: ed.getCursor(), undo: ed.canUndo(), svg: svg(), dom: serialize(box) };
  for (const bad of ['{x', '[]', { schemaVersion: 3 }, 42]) {
    let threw = false; try { ed.loadScore(bad); } catch { threw = true; }
    ok(threw, JSON.stringify(bad));
  }
  eq([JSON.stringify(ed.getScore()), ed.getCursor(), ed.canUndo()], [before.score, before.cursor, before.undo]);
  ok(svg() === before.svg && serialize(box) === before.dom, 'DOM untouched');
  eq(events, []);
  ok(ed.undo(), 'history still usable');
});
test('limits: ScoreEditor.LIMITS is public; the constructor and loadScore reject a score past them with nothing changed', () => {
  eq(ScoreEditor.LIMITS.tracks, 32);
  ok(Object.isFrozen(ScoreEditor.LIMITS));
  const big = { tracks: Array.from({ length: 33 }, () => ({ showTablature: true, measures: [] })) };
  const box = makeContainer();
  let msg = ''; try { new ScoreEditor(box, big); } catch (e) { msg = e.message; }
  eq([msg, box.children.length], ['Score too large: 33 tracks (limit 32)', 0]);
  const { ed } = mk(twoBar());
  const snap = JSON.stringify(ed.getScore());
  msg = ''; try { ed.loadScore(big); } catch (e) { msg = e.message; }
  eq([msg.startsWith('Score too large'), JSON.stringify(ed.getScore())], [true, snap]);
});
test('B4: getScore / toJSON give a deep clone with schemaVersion 1; loadScore(x); getScore() == {schemaVersion:1, ...sanitizeScore(x)} for every snapshot case', () => {
  const { ed } = mk(twoBar());
  const a = ed.getScore();
  a.tracks[0].measures[0].beats.length = 0;
  eq(beats(ed).length, 3, 'clone');
  eq(Object.keys(ed.toJSON())[0], 'schemaVersion');
  eq(ed.toJSON(), ed.getScore());
  for (const c of cases.filter((x, i) => i % 3 === 0)) {
    ed.loadScore(clone(c.score));
    eq(ed.getScore(), { schemaVersion: 1, ...clone(sanitizeScore(clone(c.score))) }, c.id);
  }
});
test('B5: on returns an unsubscribe, off works, listener errors go to console.error; change once per model change, cursor on every move', () => {
  const { ed, events } = mk(twoBar());
  const seen = [];
  const un = ed.on('cursor', (e) => seen.push(e.beat));
  const bad = () => { throw new Error('boom'); };
  ed.on('cursor', bad);
  const orig = console.error; const errs = []; console.error = (e) => errs.push(e.message);
  try { press(ed, 'ArrowRight'); } finally { console.error = orig; }
  eq([seen, errs], [[1], ['boom']]);
  un(); ed.off('cursor', bad);
  press(ed, 'ArrowRight', '7', 'ArrowUp', 'ArrowDown');
  eq(seen, [1]);
  eq(events.map((e) => e[0]), ['cursor', 'cursor', 'change', 'cursor']);
  eq(events[2][1], { source: 'edit', command: 'digit' });
  eq(events[3][1], { track: 0, measure: 0, beat: 2, string: 2, voice: 1 });
});
test('B6: setCursor clamps and returns the cursor; getMeasureFill; RangeError out of range; setWidth re-renders; focus', () => {
  const { ed, svg, root } = mk(twoBar());
  eq(ed.setCursor({ measure: 1, beat: 99, string: 9 }), { track: 0, measure: 1, beat: 2, string: 6 });
  eq(ed.setCursor({ beat: 'x' }), { track: 0, measure: 1, beat: 2, string: 6 });
  eq([ed.getMeasureFill(0, 0), ed.getMeasureFill(0, 1)], ['full', 'under']);
  let n = 0;
  for (const [t, m] of [[1, 0], [0, 2], [-1, 0], [0, 0.5]]) { try { ed.getMeasureFill(t, m); } catch (e) { if (e instanceof RangeError) n++; } }
  eq(n, 4);
  ed.setWidth(600);
  eq(svg().getAttribute('width'), '600');
  let threw = false; try { ed.setWidth(0); } catch (e) { threw = e instanceof RangeError; }
  ok(threw);
  ed.focus();
  ok(document.activeElement === root);
  root.blur();
});
test('B7: handleKey returns true for consumed keys only; the keydown listener prevents default only then and ignores other targets', () => {
  const { ed, root } = mk(twoBar());
  eq(press(ed, 'ArrowRight', 'Tab', key('w', { ctrlKey: true }), key('R', { shiftKey: true }), 'Escape', 'ArrowUp'), [true, false, false, false, false, true]);
  const e1 = root.dispatch('keydown', key('ArrowRight'));
  const e2 = root.dispatch('keydown', key('Tab'));
  const e3 = root.dispatch('keydown', { ...key('ArrowRight'), target: {} });
  const e4 = root.dispatch('keydown', { ...key('ArrowRight'), defaultPrevented: true });
  eq([e1.defaultPrevented, e2.defaultPrevented, e3.defaultPrevented], [true, false, false]);
  eq(ed.getCursor().beat, 2, 'only e1 moved');
  ok(e4.defaultPrevented);
  ed.setCursor({ beat: 0 });
  press(ed, '5');
  eq(ed.handleKey(key('Escape')), true, 'Escape consumed while the buffer is active');
  eq(ed.handleKey(key('Escape')), false);
});
test('G2: with animation frames paused (hidden tab) a pending render still runs after 250 ms and emits change', () => {
  const { ed, clock, events } = mk(twoBar(), {}, { raf: true });
  const v = ed._view;
  const r0 = v.renders;
  press(ed, '5');
  clock.advance(249);
  eq([v.renders, events.filter((e) => e[0] === 'change').length], [r0, 0], 'not yet');
  clock.advance(1);
  eq([v.renders, events.filter((e) => e[0] === 'change').length, clock.pendingFrames()], [r0 + 1, 1, 0], 'rendered once by the fallback; the frame is cancelled');
  press(ed, '7');
  clock.frame();
  eq([v.renders, clock.pendingTimers() >= 0], [r0 + 2, true]);
  clock.advance(300);
  eq(v.renders, r0 + 2, 'a frame that ran cancels its fallback');
});
test('B8: destroy removes DOM, listeners and timers; idempotent; other methods throw "ScoreEditor destroyed"', () => {
  const { ed, box, root, host, clock } = mk(twoBar(), {}, { raf: true });
  press(ed, '7');
  ok(clock.pendingFrames() === 1 && clock.pendingTimers() === 2, 'a frame, its fallback timer and the live timer are pending');
  ed.destroy();
  ed.destroy();
  eq([box.children.length, clock.pendingFrames(), clock.pendingTimers(), root.listenerCount(), host.listenerCount()], [0, 0, 0, 0, 0]);
  let msgs = [];
  for (const f of [() => ed.getScore(), () => ed.handleKey(key('ArrowRight')), () => ed.loadScore({}), () => ed.on('change', () => {}), () => ed.undo(), () => ed.setCursor({})]) {
    try { f(); } catch (e) { msgs.push(e.message); }
  }
  eq(new Set(msgs).size === 1 && msgs.length, 6);
  eq(msgs[0], 'ScoreEditor destroyed');
});
test('B9: read-only allows navigation, clicks and getScore; edits, undo and Right-append return false with no change event', () => {
  const { ed, events, root } = mk(twoBar(), { readOnly: true });
  eq([ed.isReadOnly(), root.getAttribute('aria-readonly'), root.getAttribute('class'), root.getAttribute('aria-label')], [true, 'true', 'music-score-editor music-score-editor--readonly', 'Two bars, read-only']);
  const before = JSON.stringify(ed.getScore());
  eq(press(ed, '5', 'r', '+', '.', '/', 'Delete', key('z', { ctrlKey: true }), 'm'), [false, false, false, false, false, false, false, false]);
  eq(ed.setDuration('half'), false);
  ed.setCursor({ measure: 0, beat: 2 });
  ed.setCursor({ measure: 1 });
  ed.setCursor({ measure: 1, beat: 1 });
  ed.setReadOnly(false); press(ed, 'ArrowRight'); ed.setReadOnly(true);
  eq(ed.getCursor().beat, 2, 'append slot reachable');
  ed.setCursor({ measure: 0, beat: 2 });
  ok(ed.handleKey(key('ArrowRight')) && ed.handleKey(key('End', { ctrlKey: true })));
  eq(JSON.stringify(ed.getScore()), before);
  eq(events.filter((e) => e[0] === 'change'), []);
  eq([ed.canUndo(), ed.undo()], [false, false]);
  ed.setReadOnly(false);
  eq([root.getAttribute('aria-readonly'), root.getAttribute('aria-label')], [null, 'Two bars']);
  ok(ed.handleKey(key('5')));
});
test('C4 / F1: Right from the last beat of a full last measure appends a measure as one undo step; not in read-only', () => {
  const sc = { tracks: [{ showTablature: true, measures: [{ beats: [nt('whole')] }] }] };
  const { ed, events } = mk(sc);
  ok(ed.handleKey(key('ArrowRight')));
  eq([ed.getScore().tracks[0].measures.length, ed.getCursor().measure], [2, 1]);
  eq(events.filter((e) => e[0] === 'change').map((e) => e[1]), [{ source: 'edit', command: 'moveRight' }]);
  ed.undo();
  eq([ed.getScore().tracks[0].measures.length, ed.getCursor().measure], [1, 0]);
  const ro = mk(sc, { readOnly: true });
  ok(ro.ed.handleKey(key('ArrowRight')));
  eq(ro.ed.getScore().tracks[0].measures.length, 1);
});
test('F2-F5: undo restores the exact model and cursor, redo the state after; a new command clears redo; events carry undo / redo; empty stacks', () => {
  const { ed, events } = mk(twoBar());
  const s0 = ed.getScore();
  ed.setCursor({ beat: 1, string: 2 });
  press(ed, 'ArrowRight', '9');
  const s1 = ed.getScore();
  const c1 = ed.getCursor();
  events.length = 0;
  eq(ed.undo(), true);
  eq([ed.getScore(), ed.getCursor()], [s0, { track: 0, measure: 0, beat: 2, string: 2 }]);
  eq(ed.redo(), true);
  eq([ed.getScore(), ed.getCursor()], [s1, c1]);
  eq(events.filter((e) => e[0] === 'change').map((e) => e[1].source), ['undo', 'redo']);
  ed.undo(); press(ed, '4');
  eq(ed.canRedo(), false);
  ed.undo();
  eq([ed.undo(), ed.canUndo()], [false, false]);
  ok(ed.handleKey(key('z', { ctrlKey: true })), 'Ctrl+Z is consumed on an empty stack');
  eq(ed.redo(), true);
  eq(ed.redo(), false);
});
test('E2 / F1: two digits typed within the delay are one fret and one undo step; after the delay they replace', () => {
  const { ed, clock } = mk(twoBar());
  press(ed, '1');
  clock.advance(300);
  press(ed, '2');
  eq(beats(ed)[0].notes[0].fret, 12);
  ed.undo();
  eq(beats(ed)[0].notes[0].fret, 3, 'one undo step back to the original');
  press(ed, '1');
  clock.advance(900);
  press(ed, '2');
  eq(beats(ed)[0].notes[0].fret, 2);
  ed.undo();
  eq(beats(ed)[0].notes[0].fret, 1);
  press(ed, '1');
  eq(ed.handleKey(key('Backspace')), true);
  eq(beats(ed)[0], { type: 'rest', duration: 'quarter' }, 'Backspace right after a digit deletes the note (the last note leaves a rest)');
  press(ed, '2');
  eq(beats(ed)[0].notes[0].fret, 2, 'the buffer was cleared: 2 is not combined with the deleted 1');
  ed.undo(); ed.undo();
  eq(beats(ed)[0].notes[0].fret, 1, 'delete and re-fret are separate undo steps');
});
test('F4: history is capped at historyLimit', () => {
  const { ed } = mk(twoBar(), { historyLimit: 3 });
  for (const d of ['1', '2', '3', '4', '5']) { press(ed, d); press(ed, 'ArrowRight', 'ArrowLeft'); }
  let n = 0; while (ed.undo()) n++;
  eq(n, 3);
});
test('A6: the editor renders multiMeasureRests off while the JSON keeps the author value', () => {
  const sc = { multiMeasureRests: true, tracks: [{ showTablature: true, measures: [{ beats: [nt('whole')] }, { beats: [{ type: 'rest', duration: 'whole' }] }, { beats: [{ type: 'rest', duration: 'whole' }] }] }] };
  const { ed, svg } = mk(sc);
  eq(ed.getScore().multiMeasureRests, true);
  ok(!/multi-rest|multirest/i.test(serialize(svg())), 'no multi-rest drawn');
  ed.setCursor({ measure: 2 });
  eq(ed.getCursor().measure, 2);
});
test('G1: overlay is the svg last child with fill and cursor groups; column + string box on TAB, notation column too', () => {
  const { svg, ed } = mk(twoBar());
  const ov = lastChild(svg());
  eq([ov.getAttribute('class'), ov.getAttribute('pointer-events'), ov.children.map((c) => c.getAttribute('class'))], ['editor-overlay', 'none', ['editor-fill', 'editor-selection', 'editor-cursor']]); // 2.3 adds the selection group
  eq(ov.children[2].children.map((c) => c.getAttribute('class')), ['editor-col editor-col-notation', 'editor-col editor-col-tab', 'editor-string']);
  ed.setCursor({ measure: 1, beat: 2 });
  eq(byClass(svg(), 'editor-slot').length, 2, 'append slot on both staves');
  eq(byClass(svg(), 'editor-band-under').length, 1, 'underfull band on measure 2');
  ed.loadScore({ tracks: [{ showTablature: true, measures: [{ beats: [nt('whole'), nt('whole')] }, { beats: [] }] }] });
  eq([byClass(svg(), 'editor-band-over').length, byClass(svg(), 'editor-band-under').length], [2, 0], 'overfull tint + bar; empty measure has no band');
  const plain = rendered(twoBar(), 900).svg;
  eq(byClass(plain, 'editor-overlay').length, 0);
});
test('G2: three edits in one frame render once and emit three change events; cursor moves do not render', () => {
  const { ed, clock, events, svg } = mk(twoBar(), {}, { raf: true });
  const v = ed._view;
  const r0 = v.renders;
  press(ed, '5', 'ArrowRight', '7', 'r');
  eq([v.renders, clock.pendingFrames()], [r0, 1]);
  eq(events.filter((e) => e[0] === 'change').length, 0, 'change waits for the render');
  clock.frame();
  eq(v.renders, r0 + 1);
  eq(events.filter((e) => e[0] === 'change').map((e) => e[1].command), ['digit', 'digit', 'toggleRest']);
  const s = svg();
  press(ed, 'ArrowRight', 'ArrowDown', 'Home');
  eq([v.renders, clock.pendingFrames(), svg() === s], [r0 + 1, 0, true]);
  eq(lastChild(svg()).children[2].children.length, 3, 'cursor redrawn in place'); // 2.3: the cursor group is third
});
test('G3 / G6: focus toggles the --focused class and the cursor opacity; re-renders keep focus on the root', () => {
  const { ed, root, svg } = mk(twoBar());
  const col = () => byClass(svg(), 'editor-col-tab')[0];
  eq(col().getAttribute('stroke-opacity'), '0.35');
  root.focus();
  eq([root.getAttribute('class'), col().getAttribute('stroke-opacity'), col().getAttribute('fill-opacity')], ['music-score-editor music-score-editor--focused', '1', '0.1']);
  press(ed, '5', 'ArrowRight', '3');
  ok(document.activeElement === root, 'root keeps focus through renders');
  root.blur();
  eq([root.getAttribute('class'), col().getAttribute('stroke-opacity')], ['music-score-editor', '0.35']);
  root.focus(); press(ed, 'm');
  ok(document.activeElement === root);
  eq(byClass(svg(), 'editor-slot')[0].getAttribute('stroke-opacity'), '1');
  root.blur();
  eq(byClass(svg(), 'editor-slot')[0].getAttribute('stroke-opacity'), '0.35');
});
test('G7: cursorColor, overfullColor and underfullColor options colour the overlay', () => {
  const sc = { tracks: [{ showTablature: true, measures: [{ beats: [nt('whole'), nt('whole')] }, { beats: [nt('half')] }] }] };
  const { svg } = mk(sc, { cursorColor: '#123456', overfullColor: 'orange', underfullColor: 'rgb(1,2,3)' });
  eq(byClass(svg(), 'editor-col-tab')[0].getAttribute('stroke'), '#123456');
  eq(byClass(svg(), 'editor-band-over').map((n) => n.getAttribute('fill')), ['orange', 'orange']);
  eq(byClass(svg(), 'editor-band-under')[0].getAttribute('stroke'), 'rgb(1,2,3)');
  const dflt = mk(sc).svg();
  eq([byClass(dflt, 'editor-col-tab')[0].getAttribute('stroke'), byClass(dflt, 'editor-band-over')[0].getAttribute('fill')], ['#3b5bdb', '#d92d20']);
});
test('G5: the cursor scrolls into view (nearest, instant) after moves and edits, not on focus', () => {
  const { ed, root } = mk(twoBar());
  scrollLog.length = 0;
  root.focus(); root.blur();
  eq(scrollLog.length, 0);
  press(ed, 'ArrowRight');
  press(ed, '5');
  eq(scrollLog.length, 2);
  eq(scrollLog[0].opts, { block: 'nearest', inline: 'nearest', behavior: 'auto' });
  eq(scrollLog[1].node.getAttribute('class'), 'editor-cursor');
});
test('I2: announcements are debounced to 150 ms, only the last is spoken; a repeat gets a trailing no-break space', () => {
  const { ed, live, clock } = mk(twoBar());
  press(ed, 'ArrowRight', 'ArrowRight');
  eq(live.textContent, '');
  clock.advance(149);
  eq(live.textContent, '');
  clock.advance(1);
  eq(live.textContent, 'Beat 3, string 1, empty, half');
  press(ed, 'ArrowDown', 'ArrowDown', 'ArrowDown');
  clock.advance(150);
  eq(live.textContent, 'String 4, empty');
  press(ed, 'ArrowDown', 'ArrowUp');
  clock.advance(150);
  eq(live.textContent, 'String 4, empty ');
  press(ed, '7'); clock.advance(150);
  eq(live.textContent, 'Fret 7 added, chord of 2');
  ed.setReadOnly(true); press(ed, '5'); clock.advance(150);
  eq(live.textContent, 'Read-only');
  ed.setReadOnly(false);
  ed.setCursor({ track: 0, measure: 1, beat: 0, string: 1 }); clock.advance(150);
  eq(live.textContent, 'Measure 2, beat 1, string 1, fret 0, half, underfull');
  ed._view.root.focus(); clock.advance(150);
  eq(live.textContent, 'Track 1 Gtr, measure 2, beat 1, string 1, fret 0, half, underfull');
  press(ed, 'ArrowRight', 'ArrowRight', '+'); clock.advance(150);
  eq(live.textContent, 'Next: eighth');
  ed._view.root.blur();
});
test('click: mousedown (button 0) focuses the root, flushes a pending render, hit-tests and moves the cursor; other buttons ignored', () => {
  const { ed, host, root, clock } = mk(twoBar(), {}, { raf: true });
  press(ed, '9');
  // fret 9 on string 1 is a high note: the staves move down, so only the post-edit layout hits the target
  const map = rendered(clone(ed.getScore()), 900).r.getHitMap();
  ok(map.staves[1].y !== ed._view.renderer.getHitMap().staves[1].y, 'the pending render changes the layout');
  const tab = map.staves.find((s) => s.kind === 'tab');
  const target = map.elements.find((e) => e.measureIndex === 1 && e.beatIndex === 1);
  const e = host.dispatch('mousedown', { button: 0, clientX: target.x + 1, clientY: tab.y + 5 * 15 - 2 });
  ok(e.defaultPrevented && document.activeElement === root);
  eq(clock.pendingFrames(), 0, 'pending render flushed first');
  eq(ed.getCursor(), { track: 0, measure: 1, beat: 1, string: 6 });
  const r = host.dispatch('mousedown', { button: 2, clientX: 10, clientY: 10 });
  ok(!r.defaultPrevented);
  host.dispatch('mousedown', { button: 0, clientX: 5, clientY: 1 });
  eq(ed.getCursor(), { track: 0, measure: 1, beat: 1, string: 6 }, 'outside every staff: no move');
  root.blur();
});
test('E12: editing a 1.x-rich score keeps every untouched field and object', () => {
  const { ed } = mk(leadRiff);
  const start = ed.getScore();
  ed.setCursor({ measure: 3, beat: 0, string: 2 });
  press(ed, '9', 'ArrowRight', 'r', 'm');
  const end = ed.getScore();
  const strip = (s) => { const c = clone(s); c.tracks[0].measures.splice(3, 2); return c; };
  eq(strip(end).tracks[0].measures, (() => { const c = clone(start); c.tracks[0].measures.splice(3, 1); return c.tracks[0].measures; })());
  eq({ ...end, tracks: null }, { ...start, tracks: null });
  const m = ed._model;
  ok(m.tracks[0].measures[0] === ed._history.top().before.score.tracks[0].measures[0], 'untouched measures shared by reference');
});

// ---------- B10 at editor level, J4 guard ----------
/** Synthetic score: `measures` x `tracks`, 8th-note density (eight 8ths per 4/4 measure). */
export function syntheticScore(measures, tracks = 2) {
  return { title: `Synthetic ${measures}`, tracks: Array.from({ length: tracks }, (_, ti) => ({
    name: `Guitar ${ti + 1}`, showStandardNotation: true, showTablature: true, timeSignature: { beats: 4, beatType: 4 },
    measures: Array.from({ length: measures }, (_, mi) => ({ beats: Array.from({ length: 8 }, (_, k) => nt('8th', 1 + ((mi + k + ti) % 6), (mi * 3 + k) % 13)) })),
  })) };
}
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const KEYS = [
  ...'0123456789'.split('').map((k) => key(k)), ...Array(6).fill(key('ArrowRight')), ...Array(4).fill(key('ArrowLeft')),
  key('ArrowUp'), key('ArrowDown'), key('ArrowRight', { ctrlKey: true }), key('ArrowLeft', { ctrlKey: true }), key('Home'), key('End'),
  key('End', { ctrlKey: true }), key('Home', { ctrlKey: true }), key('PageUp'), key('PageDown'),
  key('+'), key('-'), key('.'), key('/'), key('r'), key('l'), key('Delete'), key('Delete', { ctrlKey: true }), key('i'), key('Insert'),
  key('m'), key('M', { shiftKey: true }), key('Delete', { shiftKey: true }), key('z', { ctrlKey: true }), key('y', { ctrlKey: true }), key('Escape'),
  // 2.1 effects
  ...EFFECTS.map((d) => key(d.shift ? d.key.toUpperCase() : d.key, { shiftKey: d.shift })),
];
test('B10 (editor): 300 random keys, frames flushed every 25; the model stays sanitize-stable and the hit map voice-1 beats match the model (index, grace, rest)', () => {
  const rnd = mulberry32(7);
  for (const start of [twoBar(), clone(leadRiff), { tracks: [
    { name: 'A', showTablature: true, measures: [{ beats: [nt('quarter'), graceB(), nt('quarter', 2, 2), hiddenRest(), nt('quarter')] }, { voices: [{ beats: [graceB(), nt('half'), nt('half')] }, { beats: [nt('whole', 4, 0)] }] }] },
    { name: 'N', measures: [{ beats: [nt('whole')] }] },
  ] }]) {
    const { ed, clock } = mk(start, {}, { raf: true });
    for (let i = 1; i <= 300; i++) {
      ed.handleKey(KEYS[Math.floor(rnd() * KEYS.length)]);
      clock.advance(rnd() < 0.5 ? 100 : 1000);
      if (sanitizeScore(ed._model) !== ed._model) throw new Error(`step ${i}: sanitize changed the model`);
      if (i % 25) continue;
      clock.frame();
      const map = ed._view.renderer.getHitMap();
      const model = ed._model;
      map.measures.forEach((m) => {
        const raw = model.tracks[m.ti].measures?.[m.measureIndex];
        const want = (raw ? (raw.voices?.length ? raw.voices[0]?.beats || [] : raw.beats || []) : []).map((b, k) => [k, b.type === 'grace', b.type === 'rest']);
        const got = map.elements.filter((e) => e.ti === m.ti && e.measureIndex === m.measureIndex && e.voice === 1).map((e) => [e.beatIndex, e.isGrace, e.isRest]);
        eq(got, want, `step ${i} t${m.ti} m${m.measureIndex}`);
      });
    }
    ed.destroy();
  }
});
test('J4 guard: constructing an editor for 200 measures x 2 tracks renders in under 3000 ms (Node)', () => {
  const t0 = performance.now();
  const { ed } = mk(syntheticScore(200, 2));
  const ms = performance.now() - t0;
  ok(ms < 3000, `${Math.round(ms)} ms`);
  eq(ed.getScore().tracks[0].measures.length, 200);
  ed.destroy();
});

export async function summary() {
  let fail = 0;
  for (const t of tests) {
    try { await t.fn(); console.log(`PASS editor-dom: ${t.name}`); } catch (e) { fail++; console.log(`FAIL editor-dom: ${t.name}\n  ${e.stack || e.message}`); }
  }
  return fail;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const f = await summary();
  console.log(f ? `\n${f} FAILED` : '\nALL PASSED');
  process.exit(f ? 1 : 0);
}
