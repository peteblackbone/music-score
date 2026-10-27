// Verification tests for beat-level `articulations` and `fermata` (notation staff only).
// Run via `node tests/run.js` (which imports this and exits non-zero on failure),
// or directly: `node tests/articulations.mjs`.
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

register('./hooks.mjs', import.meta.url);
const root0 = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(root0, p)).href);
const { makeContainer, serialize } = await import('./dom-shim.mjs');
const { MusicScoreRenderer } = await imp('src/MusicScoreRenderer.js');
const { normalizeArticulations } = await imp('src/draw/notation.js');
const { Glyph } = await imp('src/glyphs.js');
const { articulationsScore } = await imp('examples/articulations-demo.js');
const { exampleScore } = await imp('examples/example-score.js');
const { leadRiff } = await imp('examples/lead-riff.js');

const SP = 10; // default theme.staffLineSpacing
const EPS = 1e-6;
const clone = (o) => JSON.parse(JSON.stringify(o));

// ---------- helpers ----------
function renderTree(score, width = 900) {
  const box = makeContainer();
  new MusicScoreRenderer(box, clone(score), { width }).render();
  return box.children[0];
}
const render = (score, width = 900) => serialize(renderTree(score, width));
function* walk(n, cls = []) {
  yield { n, cls };
  const own = n.getAttribute ? n.getAttribute('class') : null;
  const next = own ? [...cls, own] : cls;
  for (const c of n.children) yield* walk(c, next);
}
const all = (tree) => [...walk(tree)];
const groups = (tree, cls) => all(tree).filter((x) => x.n.tag === 'g' && x.n.getAttribute('class') === cls).map((x) => x.n);
const cp = (t) => t._text.codePointAt(0).toString(16).toUpperCase();
const num = (t, a) => Number(t.getAttribute(a));
// notation staff baseline = bottom line of the first system's staff
const baselineOf = (tree) => Math.max(...groups(tree, 'staff-lines')[0].children.map((l) => num(l, 'y1')));
const staffTopOf = (tree) => baselineOf(tree) - 4 * SP;
// y of a staff position (E4 = 0 is the bottom line; +1 per half space)
const posY = (tree, pos) => baselineOf(tree) - pos * (SP / 2);

const HALF = { E4A2: 0.17, E4A3: 0.17, E4A4: 0.08, E4A5: 0.08, E4A0: 0.37, E4A1: 0.37 }; // design half-heights (sp)
const NAME = { E4A2: 'staccato', E4A3: 'staccato', E4A4: 'tenuto', E4A5: 'tenuto', E4A0: 'accent', E4A1: 'accent' };
const BELOW = new Set(['E4A3', 'E4A5', 'E4A1']);
// Mark descriptors for one `articulations` group: centre y is the glyph origin
// shifted back by half its height (the renderer shifts origin toward the far edge).
function marksOf(g) {
  return g.children.map((t) => {
    const code = cp(t);
    const below = BELOW.has(code);
    const y = num(t, 'y');
    return { name: NAME[code], code, below, center: below ? y + HALF[code] * SP : y - HALF[code] * SP, x: num(t, 'x') };
  });
}
function oneTrack(beats) {
  return { tracks: [{ name: 'T', clef: 'treble', showStandardNotation: true, showTablature: false,
    timeSignature: { beats: 4, beatType: 4 }, keySignature: 0, measures: [{ beats }] }] };
}
const q = (pitch, extra = {}) => ({ type: 'note', duration: 'quarter', notes: [{ pitch }], ...extra });
const whole = (pitches, extra = {}) => ({ type: 'note', duration: 'whole', notes: pitches.map((pitch) => ({ pitch })), ...extra });
const near = (a, b) => Math.abs(a - b) < EPS;

// ---------- tiny test runner ----------
const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, msg: e.message }); }
}
function eq(a, b, what = '') {
  if (a !== b && !(typeof a === 'number' && typeof b === 'number' && near(a, b))) {
    throw new Error(`${what} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}
function ok(cond, what) { if (!cond) throw new Error(what); }
function deepEq(a, b, what = '') { eq(JSON.stringify(a), JSON.stringify(b), what); }

// ---------- AC6/AC7: inert inputs ----------
const mapBeats = (score, f) => { const s = clone(score); s.tracks.forEach((t) => t.measures.forEach((m) => { m.beats = m.beats.map(f); })); return s; };
const INERT = [
  { articulations: [] }, { articulations: 'staccato' }, { articulations: ['bogus', 1, null, 'marcato'] },
  { articulations: null }, { articulations: { 0: 'staccato' } },
  { fermata: false }, { fermata: 'true' }, { fermata: 1 }, { fermata: null },
  { articulations: [], fermata: false },
];
for (const [nm, sc] of [['example-score', exampleScore], ['lead-riff', leadRiff]]) {
  test(`[AC6,AC7] inert values on every beat of ${nm} serialize identically`, () => {
    const base = render(sc);
    INERT.forEach((extra) => ok(render(mapBeats(sc, (b) => ({ ...b, ...extra }))) === base, `differs for ${JSON.stringify(extra)}`));
  });
}
test('[AC6] unknown-only articulations leave a dynamic beat byte-identical (same node order)', () => {
  const a = oneTrack([q('E4', { dynamic: 'mf' }), q('G4')]);
  const b = oneTrack([q('E4', { dynamic: 'mf', articulations: ['marcato', 'bogus'] }), q('G4')]);
  ok(render(b) === render(a), 'differs');
});

// ---------- AC2/AC6: normalization ----------
test('[AC2,AC6] normalizeArticulations: fixed order, dedupe, drop unknown/non-array', () => {
  deepEq(normalizeArticulations(['accent', 'staccato', 'tenuto']), ['staccato', 'tenuto', 'accent']);
  deepEq(normalizeArticulations(['accent', 'accent', 'staccato', 'staccato']), ['staccato', 'accent']);
  deepEq(normalizeArticulations(['marcato', 'bogus', 1, null, 'tenuto']), ['tenuto']);
  deepEq(normalizeArticulations('staccato'), []);
  deepEq(normalizeArticulations(undefined), []);
  deepEq(normalizeArticulations(null), []);
  deepEq(normalizeArticulations({}), []);
  deepEq(normalizeArticulations([]), []);
});
test('[AC2] rendered output identical for any input order / duplicates / unknown names', () => {
  const r1 = render(oneTrack([q('E4', { articulations: ['accent', 'staccato', 'tenuto'] })]));
  const r2 = render(oneTrack([q('E4', { articulations: ['staccato', 'tenuto', 'accent', 'accent', 'staccato', 'zzz'] })]));
  ok(r1 === r2, 'differs');
});

// ---------- AC1: sides ----------
test('[AC1] stem-up note: marks below, Below glyph, below the staff, x-centred', () => {
  const tree = renderTree(oneTrack([q('E4', { articulations: ['staccato'] })]));
  const [g] = groups(tree, 'articulations');
  const [m] = marksOf(g);
  eq(m.code, 'E4A3');
  ok(m.center > baselineOf(tree), 'below the staff bottom line');
  eq(g.children[0].getAttribute('text-anchor'), 'middle');
  // same x as the notehead glyph (first centred text outside the articulations group)
  const nh = all(tree).find((x) => x.n.tag === 'text' && x.n.getAttribute('text-anchor') === 'middle' && !x.cls.includes('articulations')).n;
  eq(m.x, num(nh, 'x'));
});
test('[AC1] stem-down note: marks above, Above glyph, above the staff', () => {
  const tree = renderTree(oneTrack([q('D5', { articulations: ['tenuto'] })]));
  const [m] = marksOf(groups(tree, 'articulations')[0]);
  eq(m.code, 'E4A4');
  ok(m.center < staffTopOf(tree), 'above the staff top line');
});
test('[AC1] each mark uses the right glyph on both sides', () => {
  const up = marksOf(groups(renderTree(oneTrack([q('E4', { articulations: ['staccato', 'tenuto', 'accent'] })])), 'articulations')[0]);
  deepEq(up.map((m) => m.code), ['E4A3', 'E4A5', 'E4A1']);
  const dn = marksOf(groups(renderTree(oneTrack([q('E5', { articulations: ['staccato', 'tenuto', 'accent'] })])), 'articulations')[0]);
  deepEq(dn.map((m) => m.code), ['E4A2', 'E4A4', 'E4A0']);
});

// ---------- AC1/AC2: stacking and staff-space placement ----------
test('[AC1,AC2] stem-up stack, even note position: centres at pos -3,-5,-7, 10 px apart, fixed order', () => {
  const tree = renderTree(oneTrack([q('E4', { articulations: ['accent', 'tenuto', 'staccato'] })]));
  const ms = marksOf(groups(tree, 'articulations')[0]);
  deepEq(ms.map((m) => m.name), ['staccato', 'tenuto', 'accent']);
  [-3, -5, -7].forEach((p, i) => eq(ms[i].center, posY(tree, p), `mark ${i}`));
  eq(ms[1].center - ms[0].center, SP); eq(ms[2].center - ms[1].center, SP);
});
test('[AC1,AC2] stem-down stack, odd note position: centres at pos 9,11,13, 10 px apart', () => {
  const tree = renderTree(oneTrack([q('E5', { articulations: ['staccato', 'tenuto', 'accent'] })]));
  const ms = marksOf(groups(tree, 'articulations')[0]);
  [9, 11, 13].forEach((p, i) => eq(ms[i].center, posY(tree, p), `mark ${i}`));
  eq(ms[0].center - ms[1].center, SP); eq(ms[1].center - ms[2].center, SP);
});
test('[AC1] first mark: even note position -> 3 steps out, odd -> 2 steps out', () => {
  const g4 = renderTree(oneTrack([q('G4', { articulations: ['staccato'] })])); // pos 2, stem up
  eq(marksOf(groups(g4, 'articulations')[0])[0].center, posY(g4, -1));
  const a4 = renderTree(oneTrack([q('A4', { articulations: ['staccato'] })])); // pos 3, stem up
  eq(marksOf(groups(a4, 'articulations')[0])[0].center, posY(a4, 1));
});
test('[AC1] every mark centre is in a staff space (odd position), never on a line, for a range of pitches', () => {
  ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'D5', 'E5', 'F5', 'G5', 'A5', 'C6'].forEach((p) => {
    const tree = renderTree(oneTrack([q(p, { articulations: ['staccato', 'tenuto', 'accent'] })]));
    marksOf(groups(tree, 'articulations')[0]).forEach((m) => {
      const pos = (baselineOf(tree) - m.center) / (SP / 2);
      ok(near(pos, Math.round(pos)), `${p} ${m.name} position ${pos} not integral`);
      eq(Math.abs(Math.round(pos)) % 2, 1, `${p} ${m.name} position ${pos}`);
    });
  });
});

// ---------- AC5: chords ----------
test('[AC5] stem-up chord: stack starts at the lowest notehead, one group for the chord', () => {
  const tree = renderTree(oneTrack([{ type: 'note', duration: 'quarter', articulations: ['staccato', 'accent'], notes: [{ pitch: 'C4' }, { pitch: 'E4' }, { pitch: 'G4' }] }]));
  eq(groups(tree, 'articulations').length, 1);
  const ms = marksOf(groups(tree, 'articulations')[0]);
  ok(ms.every((m) => m.below), 'below');
  eq(ms[0].center, posY(tree, -5)); // C4 = pos -2 (even) -> -2-3
  eq(ms[1].center, posY(tree, -7));
});
test('[AC5] stem-down chord: stack starts at the highest notehead', () => {
  const tree = renderTree(oneTrack([{ type: 'note', duration: 'quarter', articulations: ['accent'], notes: [{ pitch: 'C5' }, { pitch: 'E5' }, { pitch: 'G5' }] }]));
  const ms = marksOf(groups(tree, 'articulations')[0]);
  eq(ms.length, 1);
  ok(!ms[0].below, 'above');
  eq(ms[0].center, posY(tree, 11)); // G5 = pos 9 (odd) -> 9+2
});

// ---------- AC4: beamed groups ----------
test('[AC4] beamed pairs: the group stem direction decides the side for every note in it', () => {
  const beats = ['E4', 'C5', 'D4', 'A5'].map((p, i) => ({ type: 'note', duration: '8th', articulations: [i < 2 ? 'staccato' : 'tenuto'], notes: [{ pitch: p }] }));
  beats.push({ type: 'rest', duration: 'half' });
  const tree = renderTree(oneTrack(beats));
  const ms = groups(tree, 'articulations').map((g) => marksOf(g)[0]);
  eq(ms.length, 4);
  // pair 1 (E4 + C5): group stems up -> both below, though C5 alone is stem-down
  ok(ms[0].below && ms[1].below, 'pair 1 below');
  eq(ms[0].center, posY(tree, -3)); // E4 pos 0 -> -3
  eq(ms[1].center, posY(tree, 3));  // C5 pos 5 (odd) -> 5-2
  // pair 2 (D4 + A5): group stems down -> both above, though D4 alone is stem-up
  ok(!ms[2].below && !ms[3].below, 'pair 2 above');
  eq(ms[2].center, posY(tree, 1));  // D4 pos -1 (odd) -> -1+2
  eq(ms[3].center, posY(tree, 13)); // A5 pos 10 (even) -> 10+3
});
test('[AC4] control: the same overridden notes unbeamed take their own side', () => {
  const c5 = renderTree(oneTrack([q('C5', { articulations: ['staccato'] })]));
  ok(!marksOf(groups(c5, 'articulations')[0])[0].below, 'lone C5 above');
  const d4 = renderTree(oneTrack([q('D4', { articulations: ['staccato'] })]));
  ok(marksOf(groups(d4, 'articulations')[0])[0].below, 'lone D4 below');
});

// ---------- whole notes ----------
test('[AC1] whole note: middle-line rule on mean position (below when mean < 4)', () => {
  const g4 = renderTree(oneTrack([whole(['G4'], { articulations: ['tenuto'] })]));
  const m1 = marksOf(groups(g4, 'articulations')[0])[0];
  ok(m1.below, 'G4 below'); eq(m1.center, posY(g4, -1));
  const d5 = renderTree(oneTrack([whole(['D5'], { articulations: ['accent'] })]));
  const m2 = marksOf(groups(d5, 'articulations')[0])[0];
  ok(!m2.below, 'D5 above'); eq(m2.center, posY(d5, 9));
  // boundary: B4 (pos 4, exactly the middle line) goes above
  const b4 = renderTree(oneTrack([whole(['B4'], { articulations: ['staccato'] })]));
  const m3 = marksOf(groups(b4, 'articulations')[0])[0];
  ok(!m3.below, 'B4 above'); eq(m3.center, posY(b4, 7));
  // whole chord E4 + C5: mean 2.5 < 4 -> below, anchored on the lowest notehead
  const ch = renderTree(oneTrack([whole(['E4', 'C5'], { articulations: ['staccato'] })]));
  const m4 = marksOf(groups(ch, 'articulations')[0])[0];
  ok(m4.below, 'chord below'); eq(m4.center, posY(ch, -3));
});

// ---------- rests and grace notes ----------
test('[AC3,AC6] rest: fermata drawn, articulations ignored', () => {
  const tree = renderTree(oneTrack([{ type: 'rest', duration: 'quarter', articulations: ['staccato', 'accent'], fermata: true }, q('E4')]));
  eq(groups(tree, 'articulations').length, 0);
  eq(groups(tree, 'fermata').length, 1);
});
test('[AC6] grace note: neither articulations nor fermata drawn (output equals unmarked)', () => {
  const plain = oneTrack([{ type: 'grace', notes: [{ pitch: 'E4' }] }, q('B4')]);
  const marked = oneTrack([{ type: 'grace', articulations: ['staccato', 'accent'], fermata: true, notes: [{ pitch: 'E4' }] }, q('B4')]);
  ok(render(marked) === render(plain), 'differs');
});

// ---------- AC8: tab-only ----------
const TUNING = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'];
test('[AC8] tab-only track: articulations/fermata draw nothing (output identical)', () => {
  const mk = (extra) => ({ tracks: [{ name: 'Tab', clef: 'treble', showStandardNotation: false, showTablature: true,
    tuning: TUNING, timeSignature: { beats: 4, beatType: 4 }, keySignature: 0,
    measures: [{ beats: [
      { type: 'note', duration: 'quarter', ...extra, notes: [{ string: 2, fret: 3 }] },
      { type: 'note', duration: 'quarter', ...extra, notes: [{ string: 1, fret: 5 }, { string: 2, fret: 5 }] },
      { type: 'rest', duration: 'half', ...extra },
    ] }] }] });
  const a = render(mk({}));
  const b = render(mk({ articulations: ['staccato', 'tenuto', 'accent'], fermata: true }));
  ok(b === a, 'differs');
  ok(!b.includes('class="fermata"') && !b.includes('class="articulations"'), 'no mark groups');
});
test('[AC8] notation+tab track: only the notation staff gets marks', () => {
  const sc = { tracks: [{ name: 'G', clef: 'treble', showStandardNotation: true, showTablature: true,
    tuning: TUNING, timeSignature: { beats: 4, beatType: 4 }, keySignature: 0,
    measures: [{ beats: [{ type: 'note', duration: 'whole', articulations: ['staccato'], fermata: true, notes: [{ string: 2, fret: 3 }] }] }] }] };
  const tree = renderTree(sc);
  eq(groups(tree, 'articulations').length, 1);
  eq(groups(tree, 'fermata').length, 1);
});

// ---------- AC3: fermata clearance ----------
const fermataY = (tree) => num(groups(tree, 'fermata')[0].children[0], 'y');
const minStemY = (tree) => Math.min(...all(tree)
  .filter((x) => x.n.tag === 'line' && num(x.n, 'x1') === num(x.n, 'x2') && num(x.n, 'stroke-width') > 1.2)
  .flatMap((x) => [num(x.n, 'y1'), num(x.n, 'y2')]));
test('[AC3] fermata glyph is Glyph.fermataAbove, centred on the beat', () => {
  const tree = renderTree(oneTrack([q('E4', { fermata: true })]));
  const t = groups(tree, 'fermata')[0].children[0];
  eq(t._text, Glyph.fermataAbove);
  eq(t.getAttribute('text-anchor'), 'middle');
});
test('[AC3] plain note: fermata bottom clears staff top / noteheads / stem tip by one space', () => {
  const low = renderTree(oneTrack([q('E4', { fermata: true })])); // staff top binds
  eq(fermataY(low), staffTopOf(low) - SP);
  const high = renderTree(oneTrack([q('C6', { fermata: true })])); // high notehead binds
  ok(fermataY(high) <= posY(high, 12) - SP + EPS, 'above C6 notehead');
  const stemUp = renderTree(oneTrack([q('A4', { fermata: true })]));
  ok(fermataY(stemUp) <= minStemY(stemUp) - SP + EPS, 'above stem tip');
});
test('[AC3] fermata sits above its own articulation stack', () => {
  const tree = renderTree(oneTrack([whole(['D5'], { articulations: ['staccato', 'tenuto', 'accent'], fermata: true })]));
  const ms = marksOf(groups(tree, 'articulations')[0]);
  const topEdge = Math.min(...ms.map((m) => m.center - HALF[m.code] * SP));
  ok(fermataY(tree) <= topEdge - SP + EPS, `fermata ${fermataY(tree)} vs stack top ${topEdge}`);
});
test('[AC3] fermata over a chord symbol rises clear of it', () => {
  const tree = renderTree(oneTrack([q('E4', { fermata: true, chord: 'C' })]));
  const chordText = all(tree).find((x) => x.n.tag === 'text' && x.n._text === 'C' && x.n.getAttribute('font-weight') === 'bold').n;
  ok(fermataY(tree) <= num(chordText, 'y') - SP + EPS, 'fermata bottom at least a space above the chord text baseline');
  // Stacking order: chord-symbol line, then the fermata 0.5 sp above the chord text's estimated top (0.8 em ascent).
  eq(fermataY(tree), num(chordText, 'y') - 0.8 * num(chordText, 'font-size') - 0.5 * SP);
  ok(fermataY(renderTree(oneTrack([q('E4', { fermata: true })]))) > fermataY(tree), 'chord symbol raises it');
});
test('[AC3] fermata over a tuplet bracket clears it; bracket itself unchanged', () => {
  const t = (extra = {}) => ({ type: 'note', duration: '8th', tuplet: 3, notes: [{ pitch: 'C5' }], ...extra });
  const tree = renderTree(oneTrack([t(), t(), t({ fermata: true }), q('F4'), q('G4')]));
  const d = groups(tree, 'tuplet')[0].children[0].getAttribute('d'); // M x1 y+5 L x1 y L ...
  const bracketY = d.match(/-?[\d.]+/g).map(Number)[3];
  ok(fermataY(tree) <= bracketY - 0.6 * SP + EPS, `fermata ${fermataY(tree)} vs bracket ${bracketY}`);
  const noFerm = renderTree(oneTrack([t(), t(), t(), q('F4'), q('G4')]));
  eq(groups(noFerm, 'tuplet')[0].children[0].getAttribute('d'), d);
});
test('[AC3] fermata under a slur clears the slur apex', () => {
  const tree = renderTree(oneTrack([q('E4', { slurStart: true }), q('B4', { fermata: true }), q('B4', { slurEnd: true }), q('E4')]));
  // Phase B: slurs are drawn inside their staff group (no longer direct children of the
  // root svg) and carry class="slur", so select by class instead of by nesting depth.
  const d = all(tree).filter((x) => x.n.tag === 'path' && x.n.getAttribute('class') === 'slur').map((x) => x.n.getAttribute('d'))[0];
  const v = d.match(/-?[\d.]+/g).map(Number); // M x y C c1x c1y c2x c2y ex ey ...
  const y0 = v[1], c1y = v[3], c2y = v[5], y3 = v[7];
  let apex = Infinity;
  for (let i = 0; i <= 100; i++) {
    const s = i / 100, u = 1 - s;
    apex = Math.min(apex, u * u * u * y0 + 3 * u * u * s * c1y + 3 * u * s * s * c2y + s * s * s * y3);
  }
  ok(fermataY(tree) <= apex - EPS, `fermata ${fermataY(tree)} vs slur apex ${apex}`);
});
test('[AC3,AC7] a fermata only adds its own group: removing it yields the unmarked rendering', () => {
  const a = oneTrack([q('E4'), q('G4'), q('B4'), q('D5')]);
  const b = oneTrack([q('E4'), q('G4', { fermata: true }), q('B4'), q('D5')]);
  // Phase B: the fermata group sits inside its staff group (any depth), and since vertical
  // spacing is content-aware its extra height may move the staff (transform) and change the
  // SVG height; those are normalized away so the check still proves nothing else changed.
  // Phase B part 2: instrument names are drawn in absolute coordinates centred on their staff,
  // so a moved staff moves its name's y too; normalized away like the staff transform.
  const norm = (svg) => svg
    .replace(/ transform="translate\(0,[^"]*\)"/g, '')
    .replace(/ height="[^"]*" viewBox="[^"]*"/, '')
    .replace(/(<text x="[^"]*") y="[^"]*"( class="instrument-name")/g, '$1$2');
  const stripped = render(b).replace(/ *<g class="fermata">\n[\s\S]*?\n *<\/g>\n/, '');
  ok(norm(stripped) === norm(render(a)), 'differs');
});

// ---------- dynamics ----------
const dynY = (tree) => num(all(tree).find((x) => x.n.tag === 'text' && x.n.getAttribute('font-style') === 'italic' && x.n.getAttribute('font-family').startsWith('Bravura')).n, 'y');
test('[AC2] dynamic is pushed down clear of a stem-up note\'s below-staff marks', () => {
  const plain = renderTree(oneTrack([q('F4', { dynamic: 'mf' })]));
  const marked = renderTree(oneTrack([q('F4', { dynamic: 'mf', articulations: ['staccato'] })]));
  eq(dynY(plain), baselineOf(plain) + 2 * SP);
  ok(dynY(marked) > dynY(plain), 'pushed down');
  const edge = Math.max(...marksOf(groups(marked, 'articulations')[0]).map((m) => m.center + HALF[m.code] * SP));
  ok(dynY(marked) >= edge + 1.7 * SP - EPS, 'clears the lowest mark by 1.7 spaces');
});
test('[AC2] dynamic is not moved when marks are above (stem-down note)', () => {
  const plain = renderTree(oneTrack([q('D5', { dynamic: 'f' })]));
  const marked = renderTree(oneTrack([q('D5', { dynamic: 'f', articulations: ['staccato', 'accent'] })]));
  eq(dynY(marked), dynY(plain));
});
// Changed with the per-system dynamics baseline (acceptance fix C1): dynamics of a
// system share one baseline clear of the staff's lowest ink, so a neighbour's
// below-staff marks now lower it too (previously: "not moved by a marked neighbour").
test('[AC2] dynamic on an unmarked beat aligns below a marked neighbour (common baseline)', () => {
  const tree = renderTree(oneTrack([q('E4', { articulations: ['accent'] }), q('F4', { dynamic: 'p' })]));
  const edge = Math.max(...marksOf(groups(tree, 'articulations')[0]).map((m) => m.center + HALF[m.code] * SP));
  ok(dynY(tree) > edge, 'below the neighbour accent');
  const plain = renderTree(oneTrack([q('E4'), q('F4', { dynamic: 'p' })]));
  eq(dynY(plain), baselineOf(plain) + 2 * SP);
});

// ---------- glyph ----------
test('[AC1] Glyph.articTenutoBelow is U+E4A5 (sibling glyphs intact)', () => {
  eq(Glyph.articTenutoBelow, '');
  eq(Glyph.articTenutoAbove, '');
  eq(Glyph.articStaccatoAbove, ''); eq(Glyph.articStaccatoBelow, '');
  eq(Glyph.articAccentAbove, ''); eq(Glyph.articAccentBelow, '');
  eq(Glyph.fermataAbove, '');
});

// ---------- demo / determinism ----------
test('[AC9] demo renders 25 articulation groups and 7 fermatas at several widths, no bad numbers', () => {
  [900, 860, 600].forEach((w) => {
    const tree = renderTree(articulationsScore, w);
    eq(groups(tree, 'articulations').length, 25, `articulations @${w}`);
    eq(groups(tree, 'fermata').length, 7, `fermata @${w}`);
    ok(!/NaN|Infinity|undefined/.test(serialize(tree)), `bad numbers @${w}`);
  });
});
test('[AC9] demo exercises each of the three marks and a fermata', () => {
  const names = new Set();
  articulationsScore.tracks[0].measures.forEach((m) => m.beats.forEach((b) => (b.articulations || []).forEach((n) => names.add(n))));
  ['staccato', 'tenuto', 'accent'].forEach((n) => ok(names.has(n), n));
  ok(articulationsScore.tracks[0].measures.some((m) => m.beats.some((b) => b.fermata === true)), 'fermata');
});
test('determinism: demo renders identically twice, re-render is stable, input not mutated', () => {
  const before = JSON.stringify(articulationsScore);
  const a = render(articulationsScore), b = render(articulationsScore);
  ok(a === b, 'two fresh renders differ');
  const box = makeContainer();
  const r = new MusicScoreRenderer(box, articulationsScore, { width: 900 });
  r.render(); r.render();
  eq(box.children.length, 1);
  ok(serialize(box.children[0]) === a, 're-render differs');
  eq(JSON.stringify(articulationsScore), before);
});

// ---------- report ----------
export function summary() {
  let fail = 0;
  for (const r of results) {
    if (r.ok) console.log(`PASS articulations: ${r.name}`);
    else { fail++; console.log(`FAIL articulations: ${r.name}\n  ${r.msg}`); }
  }
  return fail;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const f = summary();
  console.log(f ? `\n${f} FAILED` : '\nALL PASSED');
  process.exit(f ? 1 : 0);
}
