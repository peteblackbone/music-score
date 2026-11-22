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
