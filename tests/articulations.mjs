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
const { normalizeArticulations, renderArticulations } = await imp('src/draw/notation.js');
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

const HALF = { E4A2: 0.17, E4A3: 0.17, E4A4: 0.08, E4A5: 0.08, E4A0: 0.37, E4A1: 0.37, // design half-heights (sp)
  E4A6: 0.59, E4A7: 0.59, E4AC: 0.5, E4AD: 0.5 };
const NAME = { E4A2: 'staccato', E4A3: 'staccato', E4A4: 'tenuto', E4A5: 'tenuto', E4A0: 'accent', E4A1: 'accent',
  E4A6: 'staccatissimo', E4A7: 'staccatissimo', E4AC: 'marcato', E4AD: 'marcato' };
const BELOW = new Set(['E4A3', 'E4A5', 'E4A1', 'E4A7', 'E4AD']);
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
  { articulations: [] }, { articulations: 'staccato' }, { articulations: ['bogus', 1, null, 'zzz'] },
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
  const b = oneTrack([q('E4', { dynamic: 'mf', articulations: ['zzz', 'bogus'] }), q('G4')]);
  ok(render(b) === render(a), 'differs');
});

// ---------- AC2/AC6: normalization ----------
test('[AC2,AC6] normalizeArticulations: fixed order, dedupe, drop unknown/non-array', () => {
  deepEq(normalizeArticulations(['accent', 'staccato', 'tenuto']), ['staccato', 'tenuto', 'accent']);
  deepEq(normalizeArticulations(['accent', 'accent', 'staccato', 'staccato']), ['staccato', 'accent']);
  deepEq(normalizeArticulations(['marcato', 'bogus', 1, null, 'tenuto']), ['tenuto', 'marcato']);
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

// ---------- [PIN-1.5] characterization of today's tremolo / vibrato / fermata / articulation handling ----------
// Written before the note-effects 1.5 work. "Permanent" pins must survive it; "flip-later" pins
// record behavior a named commit will deliberately change (A, T, W, F) and are updated by that commit.
const pinBoth = (beats) => ({ tracks: [{ name: 'G', clef: 'treble', showStandardNotation: true, showTablature: true,
  tuning: TUNING, timeSignature: { beats: 4, beatType: 4 }, keySignature: 0, measures: [{ beats }] }] });
const pinNote = (duration, extra = {}) => ({ type: 'note', duration, ...extra, notes: [{ string: 2, fret: 3 }] });
const strokes = (tree, cls) => groups(tree, cls).map((g) => g.children.map((c) => c.tag));
const THREE = ['line', 'line', 'line'];

// permanent: tremolo 2 -> three strokes in g.tremolo (stemmed and whole) and g.tab-tremolo
for (const [nm, dur] of [['stemmed quarter', 'quarter'], ['whole note', 'whole']]) {
  test(`[PIN-1.5] tremolo: 2 on a ${nm}: one g.tremolo with 3 lines and one g.tab-tremolo with 3 lines`, () => {
    const tree = renderTree(pinBoth([pinNote(dur, { tremolo: 2 })]));
    deepEq(strokes(tree, 'tremolo'), [THREE], 'tremolo');
    deepEq(strokes(tree, 'tab-tremolo'), [THREE], 'tab-tremolo');
  });
}
test('[PIN-1.5] tremolo group class is exactly "tremolo" (not tremolo-N / tremolo-2)', () => {
  const sc = pinBoth([pinNote('quarter', { tremolo: 2 })]);
  const classes = all(renderTree(sc)).filter((x) => x.n.tag === 'g' && /tremolo/.test(x.n.getAttribute('class') || '')).map((x) => x.n.getAttribute('class'));
  deepEq(classes, ['tremolo', 'tab-tremolo']);
  ok(!render(sc).includes('tremolo-'), 'suffixed class');
});
test('[PIN-1.5] tremolo 8 / 16 / 32 each draw 3 strokes (same as 2)', () => {
  [8, 16, 32].forEach((v) => {
    const tree = renderTree(pinBoth([pinNote('quarter', { tremolo: v })]));
    deepEq(strokes(tree, 'tremolo'), [THREE], `tremolo ${v}`);
    deepEq(strokes(tree, 'tab-tremolo'), [THREE], `tab-tremolo ${v}`);
  });
});
test('[PIN-1.5] vibrato 1 and "x" render byte-equal to vibrato true', () => {
  const base = render(pinBoth([pinNote('quarter', { vibrato: true })]));
  ok(base.includes('class="vibrato"'), 'baseline has vibrato');
  [1, 'x'].forEach((v) => ok(render(pinBoth([pinNote('quarter', { vibrato: v })])) === base, `vibrato ${JSON.stringify(v)}`));
});
test('[PIN-1.5] fermata "true" and 1 draw no fermata (output equals no fermata)', () => {
  const base = render(oneTrack([q('E4'), q('G4')]));
  ['true', 1].forEach((v) => {
    const s = render(oneTrack([q('E4', { fermata: v }), q('G4')]));
    ok(!s.includes('class="fermata"'), `fermata ${JSON.stringify(v)} drew one`);
    ok(s === base, `fermata ${JSON.stringify(v)} differs`);
  });
});

// flipped by commit A (was: articulations [marcato] / [heavyAccent] / [staccatissimo] byte-equal to none)
test('[PIN-1.5][flipped A] articulations [marcato] / [heavyAccent] / [staccatissimo] now draw one mark', () => {
  const base = render(oneTrack([q('E4'), q('G4')]));
  [['marcato', 'E4AD'], ['heavyAccent', 'E4AD'], ['staccatissimo', 'E4A7']].forEach(([n, code]) => {
    const tree = renderTree(oneTrack([q('E4', { articulations: [n] }), q('G4')]));
    ok(serialize(tree) !== base, n);
    deepEq(marksOf(groups(tree, 'articulations')[0]).map((m) => m.code), [code], n);
  });
});
// flipped by commit T (was: tremolo "8th" and "16th" draw 3 strokes with class "tremolo")
test('[PIN-1.5][flipped T] tremolo "8th" / "16th" draw 1 / 2 strokes with a speed class', () => {
  [['8th', 1], ['16th', 2]].forEach(([v, n]) => {
    const tree = renderTree(oneTrack([q('E4', { tremolo: v })]));
    deepEq(strokes(tree, `tremolo tremolo-${v}`), [Array(n).fill('line')], `tremolo ${v}`);
    eq(groups(tree, 'tremolo').length, 0, `no plain tremolo group for ${v}`);
  });
});
// flipped by commit W (was: vibrato "wide" renders byte-equal to vibrato true)
test('[PIN-1.5][flipped W] vibrato "wide" draws the wide wave on notation and TAB', () => {
  const base = render(pinBoth([pinNote('quarter', { vibrato: true })]));
  const wide = render(pinBoth([pinNote('quarter', { vibrato: 'wide' })]));
  ok(wide !== base, 'wide equals normal');
  ok(wide.includes('class="vibrato vibrato-wide"') && wide.includes('class="tab-vibrato tab-vibrato-wide"'), 'wide classes');
});
// flipped by commit F (was: fermata "short" / "long" / "normal" draw no g.fermata)
test('[PIN-1.5][flipped F] fermata "short" / "long" / "normal" each draw one fermata', () => {
  [['short', 'fermata fermata-short'], ['long', 'fermata fermata-long'], ['normal', 'fermata']].forEach(([v, cls]) =>
    eq(groups(renderTree(oneTrack([q('E4', { fermata: v })])), cls).length, 1, `fermata ${v}`));
});

// ---------- 1.5 marcato / staccatissimo (A1-A3) ----------
// Proof for the re-recorded articulations-demo snapshots: the demo's only new mark is one 'marcato'; renamed to an
// unknown name it must still hash to the opt-out baselines recorded before 1.5.0 (tests/fixtures/pre-1.3-hashes.json
// at 588220a), so nothing but that mark changed.
{
  const { createHash } = await import('node:crypto');
  const OLD = {
    600: '9afeb20459b9de681ade0b5ac41b81cb67283f350c60964a837eb69f22d1be7e',
    900: '467bf13ef094295d2b3dcafceadec44e114a6c6a649c7ec430d8fda3292c6a45',
  };
  const swapped = mapBeats(articulationsScore, (b) => (b.articulations
    ? { ...b, articulations: b.articulations.map((n) => (n === 'marcato' ? 'zzz' : n)) } : b));
  for (const w of [900, 600]) {
    test(`[A1] articulations demo with 'marcato' renamed to 'zzz' hashes to its pre-1.5 opt-out baseline @${w}`, () => {
      const box = makeContainer();
      new MusicScoreRenderer(box, clone(swapped), { width: w, theme: { hammerPullSlurs: false } }).render();
      eq(createHash('sha256').update(serialize(box.children[0])).digest('hex'), OLD[w]);
    });
  }
  test('[A1] the demo uses exactly one marcato (its only 1.5 mark)', () => {
    const names = articulationsScore.tracks.flatMap((t) => t.measures.flatMap((m) => m.beats.flatMap((b) => b.articulations || [])));
    eq(names.filter((n) => n === 'marcato').length, 1);
    ok(!names.some((n) => ['heavyAccent', 'staccatissimo'].includes(n)), 'no other 1.5 names');
  });
}
const codesOf = (tree) => groups(tree, 'articulations').map((g) => marksOf(g).map((m) => m.code));
test('[A1] stem up -> Below glyphs, stem down -> Above glyphs', () => {
  deepEq(codesOf(renderTree(oneTrack([q('E4', { articulations: ['staccatissimo', 'marcato'] })]))), [['E4A7', 'E4AD']]);
  deepEq(codesOf(renderTree(oneTrack([q('D5', { articulations: ['staccatissimo', 'marcato'] })]))), [['E4A6', 'E4AC']]);
  deepEq(codesOf(renderTree(oneTrack([whole(['D5'], { articulations: ['heavyAccent'] })]))), [['E4AC']]);
  deepEq(codesOf(renderTree(oneTrack([whole(['G4'], { articulations: ['heavyAccent'] })]))), [['E4AD']]);
});
test('[A1] two voices: voice 1 marks above, voice 2 marks below', () => {
  const rests = [{ type: 'rest', duration: 'quarter' }, { type: 'rest', duration: 'half' }];
  const sc = oneTrack([]);
  sc.tracks[0].measures = [{ voices: [
    { beats: [q('E5', { articulations: ['marcato', 'tenuto', 'staccatissimo'] }), ...rests] },
    { beats: [q('E4', { articulations: ['marcato', 'tenuto', 'staccatissimo'] }), ...rests] },
  ] }];
  const [g1, g2] = groups(renderTree(sc), 'articulations').map(marksOf);
  deepEq(g1.map((m) => m.code), ['E4A6', 'E4A4', 'E4AC']);
  deepEq(g2.map((m) => m.code), ['E4A7', 'E4A5', 'E4AD']);
  [0, 1].forEach((i) => {
    eq(g1[i].center - g1[i + 1].center, SP, `voice 1 stacks upward ${i}`);
    eq(g2[i + 1].center - g2[i].center, SP, `voice 2 stacks downward ${i}`);
  });
});
test('[A2] normalizeArticulations: precedence, order, alias, exact names', () => {
  deepEq(normalizeArticulations(['accent', 'marcato', 'staccato', 'staccatissimo', 'tenuto']), ['staccatissimo', 'tenuto', 'marcato']);
  deepEq(normalizeArticulations(['heavyAccent', 'accent']), ['marcato']);
  deepEq(normalizeArticulations(['marcato', 'heavyAccent', 'marcato']), ['marcato']);
  deepEq(normalizeArticulations(['staccato', 'staccatissimo']), ['staccatissimo']);
  deepEq(normalizeArticulations(['accent', 'staccatissimo']), ['staccatissimo', 'accent']);
  deepEq(normalizeArticulations(['Marcato', ' marcato', 'STACCATISSIMO', 'heavyaccent', 'marcato ']), []);
  deepEq(normalizeArticulations(['tenuto', 'staccato', 'accent']), ['staccato', 'tenuto', 'accent']);
  const once = normalizeArticulations(['accent', 'heavyAccent', 'staccato', 'staccatissimo', 'tenuto']);
  deepEq(normalizeArticulations(once), once, 'idempotent');
});
test('[A2] stacked centres step 1 sp from the first staff space out, both sides', () => {
  const up = renderTree(oneTrack([q('E4', { articulations: ['marcato', 'tenuto', 'staccatissimo'] })]));
  const ms = marksOf(groups(up, 'articulations')[0]);
  deepEq(ms.map((m) => m.name), ['staccatissimo', 'tenuto', 'marcato']);
  [-3, -5, -7].forEach((p, i) => eq(ms[i].center, posY(up, p), `up ${i}`));
  const dn = renderTree(oneTrack([q('D5', { articulations: ['heavyAccent', 'tenuto', 'staccatissimo'] })]));
  const md = marksOf(groups(dn, 'articulations')[0]);
  [9, 11, 13].forEach((p, i) => eq(md[i].center, posY(dn, p), `down ${i}`));
});
// Marcato (1.0 sp) and staccatissimo (1.18 sp) are too tall to sit in the space next to a notehead or right
// outside a staccatissimo: they move out one more space; the older marks keep their places.
test('[A2] tall marks move out a space instead of touching the notehead or the mark inside them', () => {
  const at = (pitch, arts) => {
    const tree = renderTree(oneTrack([q(pitch, { articulations: arts })]));
    return marksOf(groups(tree, 'articulations')[0]).map((m) => Math.round((baselineOf(tree) - m.center) / (SP / 2)));
  };
  deepEq(at('E5', ['staccatissimo']), [11]); // E5 pos 7: the space next to it (9) is too small
  deepEq(at('E5', ['marcato']), [11]);
  deepEq(at('E5', ['accent']), [9]);
  deepEq(at('E5', ['staccato', 'marcato']), [9, 11]);
  deepEq(at('F4', ['staccatissimo', 'tenuto']), [-3, -5]); // F4 pos 1 stem up
  deepEq(at('E4', ['staccatissimo']), [-3]);
  deepEq(at('E4', ['marcato']), [-3]);
  deepEq(at('E4', ['staccatissimo', 'marcato']), [-3, -7]);
  deepEq(at('E4', ['staccatissimo', 'accent']), [-3, -7]);
  deepEq(at('E4', ['staccato', 'tenuto', 'accent']), [-3, -5, -7]);
});
test('[A2] every mark keeps >= 0.1 sp from the notehead and the mark inside it, centred in a space', () => {
  const combos = [['staccatissimo'], ['marcato'], ['staccatissimo', 'marcato'], ['staccatissimo', 'accent'],
    ['staccato', 'marcato'], ['staccatissimo', 'tenuto', 'marcato'], ['staccato', 'tenuto', 'accent']];
  ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'D5', 'E5', 'F5', 'G5', 'A5', 'C6'].forEach((p) => combos.forEach((arts) => {
    const tree = renderTree(oneTrack([q(p, { articulations: arts })]));
    const ms = marksOf(groups(tree, 'articulations')[0]);
    const head = all(tree).find((x) => x.n.tag === 'text' && x.n.getAttribute('text-anchor') === 'middle' && !x.cls.includes('articulations')).n;
    const below = ms[0].below;
    const d = below ? 1 : -1; // y direction away from the notehead
    let edge = num(head, 'y') + d * 0.5 * SP;
    ms.forEach((m) => {
      const h = HALF[m.code] * SP;
      ok(d * (m.center - d * h - edge) >= 0.1 * SP - EPS, `${p} ${arts} ${m.name}: gap ${d * (m.center - d * h - edge)}`);
      const pos = (baselineOf(tree) - m.center) / (SP / 2);
      ok(near(pos, Math.round(pos)) && Math.abs(Math.round(pos)) % 2 === 1, `${p} ${arts} ${m.name} at ${pos}`);
      edge = m.center + d * h;
    });
  }));
});
test('[A2] articTopY / articBottomY use the new half heights', () => {
  const theme = { staffLineSpacing: SP, fontFamily: 'Bravura', noteColor: '#000', fontSize: 40 };
  const g = makeContainer();
  // baseline y 0: staff position p sits at y = -p * SP / 2
  const below = { x: 0, noteheads: [{ y: 0 }], stemUp: true, minPos: 0, maxPos: 0, duration: 'quarter' };
  renderArticulations(g, below, ['staccatissimo', 'marcato'], 0, theme);
  eq(below.articBottomY, 7 * (SP / 2) + 0.5 * SP, 'marcato outer edge below (pos -7: moved out past the staccatissimo)');
  const above = { x: 0, noteheads: [{ y: 0 }], stemUp: false, minPos: 8, maxPos: 8, duration: 'quarter' };
  renderArticulations(g, above, ['staccatissimo'], 0, theme);
  eq(above.articTopY, -11 * (SP / 2) - 0.59 * SP, 'staccatissimo outer edge above (pos 11)');
});
test('[A3] marcato / staccatissimo ignored on rests, graces and a tab-only track', () => {
  const r = renderTree(oneTrack([{ type: 'rest', duration: 'quarter', articulations: ['marcato', 'staccatissimo'] }, q('E4')]));
  eq(groups(r, 'articulations').length, 0);
  const plain = oneTrack([{ type: 'grace', notes: [{ pitch: 'E4' }] }, q('B4')]);
  const marked = oneTrack([{ type: 'grace', articulations: ['marcato', 'heavyAccent', 'staccatissimo'], notes: [{ pitch: 'E4' }] }, q('B4')]);
  ok(render(marked) === render(plain), 'grace differs');
  const mk = (extra) => ({ tracks: [{ name: 'Tab', clef: 'treble', showStandardNotation: false, showTablature: true,
    tuning: TUNING, timeSignature: { beats: 4, beatType: 4 }, keySignature: 0,
    measures: [{ beats: [{ type: 'note', duration: 'whole', ...extra, notes: [{ string: 2, fret: 3 }] }] }] }] });
  ok(render(mk({ articulations: ['marcato', 'staccatissimo', 'heavyAccent'] })) === render(mk({})), 'tab-only differs');
});

// ---------- 1.5 tremolo speeds (T1-T2) ----------
// All tremolo groups of a tree, in document order: { cls, centres: stroke centre y's }.
const tremolos = (tree) => all(tree).filter((x) => x.n.tag === 'g' && /(^| )(tab-)?tremolo( |$)/.test(x.n.getAttribute('class') || ''))
  .map((x) => ({ cls: x.n.getAttribute('class'), x: (num(x.n.children[0], 'x1') + num(x.n.children[0], 'x2')) / 2,
    centres: x.n.children.map((l) => (num(l, 'y1') + num(l, 'y2')) / 2) }));
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const nearly = (a, b, what) => ok(Math.abs(a - b) < 1e-9, `${what}: ${a} vs ${b}`);
const SPEEDS = [['8th', 1], ['16th', 2], ['32nd', 3]];
test('[T1] notation + TAB: 1 / 2 / 3 strokes per speed, centred where the plain three are, speed classes', () => {
  for (const dur of ['quarter', 'whole']) {
    const plain = tremolos(renderTree(pinBoth([pinNote(dur, { tremolo: true })])));
    deepEq(plain.map((t) => t.cls), ['tremolo', 'tab-tremolo'], dur);
    for (const [v, n] of SPEEDS) {
      const ts = tremolos(renderTree(pinBoth([pinNote(dur, { tremolo: v })])));
      deepEq(ts.map((t) => t.cls), [`tremolo tremolo-${v}`, `tab-tremolo tab-tremolo-${v}`], `${dur} ${v}`);
      ts.forEach((t, i) => {
        eq(t.centres.length, n, `${dur} ${v} ${t.cls} strokes`);
        nearly(mean(t.centres), mean(plain[i].centres), `${dur} ${v} ${t.cls} centre`);
        nearly(t.x, plain[i].x, `${dur} ${v} ${t.cls} x`);
      });
    }
  }
});
test('[T1] stemmed and beamed: mean stroke centre is the stem midpoint', () => {
  const stemMid = (tree, x) => {
    const st = all(tree).filter((e) => e.n.tag === 'line' && near(num(e.n, 'x1'), x) && near(num(e.n, 'x2'), x)
      && !e.cls.some((c) => /tremolo/.test(c)));
    ok(st.length === 1, `one stem at x ${x}, got ${st.length}`);
    return (num(st[0].n, 'y1') + num(st[0].n, 'y2')) / 2;
  };
  const e8 = (p, extra) => ({ type: 'note', duration: '8th', notes: [{ pitch: p }], ...extra });
  for (const [v, n] of SPEEDS) {
    const tree = renderTree(oneTrack([q('E4', { tremolo: v }), q('D5', { tremolo: v }),
      e8('G4', { tremolo: v }), e8('B4', { tremolo: v }), { type: 'rest', duration: 'quarter' }]));
    const ts = tremolos(tree);
    eq(ts.length, 4, v);
    ts.forEach((t, i) => {
      eq(t.centres.length, n, `${v} #${i}`);
      nearly(mean(t.centres), stemMid(tree, t.x), `${v} #${i}`);
    });
  }
});
test('[T1] voice-2 whole note: strokes hang below and keep their count', () => {
  const sc = (v) => {
    const s = oneTrack([]);
    s.tracks[0].measures = [{ voices: [{ beats: [whole(['D5'])] }, { beats: [whole(['E4'], { tremolo: v })] }] }];
    return s;
  };
  const plain = tremolos(renderTree(sc(true)))[0];
  ok(mean(plain.centres) > posY(renderTree(sc(true)), 0), 'below the E4 notehead');
  for (const [v, n] of SPEEDS) {
    const [t] = tremolos(renderTree(sc(v)));
    eq(t.cls, `tremolo tremolo-${v}`);
    eq(t.centres.length, n, v);
    nearly(mean(t.centres), mean(plain.centres), v);
  }
});
test('[T2] true, numbers and other values draw 3 strokes with no speed class', () => {
  [true, 1, 2, 8, 16, 32, 'x', '64th', 'eighth', [], {}, ' 8th '].forEach((v) => {
    const ts = tremolos(renderTree(pinBoth([pinNote('quarter', { tremolo: v })])));
    const want = v === ' 8th ' ? ['tremolo tremolo-8th', 'tab-tremolo tab-tremolo-8th'] : ['tremolo', 'tab-tremolo'];
    deepEq(ts.map((t) => t.cls), want, JSON.stringify(v));
    if (v !== ' 8th ') ts.forEach((t) => eq(t.centres.length, 3, JSON.stringify(v)));
  });
  [false, 0, '', null].forEach((v) => eq(tremolos(renderTree(pinBoth([pinNote('quarter', { tremolo: v })]))).length, 0, JSON.stringify(v)));
});

// ---------- 1.5 wide vibrato (W1-W4) ----------
const glyphBoxTrillBottom = -0.063; // glyphMetrics ornamentTrill bBoxSW y
// Each vibrato group's wave: { cls, x1, y (centre line), top / bottom (control points), amp, step (Q segment), width }.
const waves = (tree) => all(tree).filter((x) => x.n.tag === 'g' && /(^| )(tab-)?vibrato( |$)/.test(x.n.getAttribute('class') || ''))
  .map((x) => {
    const p = x.n.children[0];
    const v = p.getAttribute('d').match(/-?[\d.]+(e-?\d+)?/g).map(Number);
    const ys = v.filter((_, i) => i % 2 === 1);
    const y = v[1];
    return { cls: x.n.getAttribute('class'), x1: v[0], y, top: Math.min(...ys), bottom: Math.max(...ys),
      amp: Math.max(...ys) - y, step: v[4] - v[0], width: num(p, 'stroke-width') };
  });
test('[W1] wide wave: amplitude, wavelength, stroke and lift on notation and TAB; classes', () => {
  const [n, tn] = waves(renderTree(pinBoth([pinNote('quarter', { vibrato: true })])));
  const [w, tw] = waves(renderTree(pinBoth([pinNote('quarter', { vibrato: ' WIDE ' })])));
  deepEq([n.cls, tn.cls, w.cls, tw.cls], ['vibrato', 'tab-vibrato', 'vibrato vibrato-wide', 'tab-vibrato tab-vibrato-wide']);
  eq(n.width, 1.2); eq(n.amp, 0.2 * SP); eq(n.step, 0.35 * SP);
  eq(w.width, 1.6); eq(w.amp, 0.35 * SP); eq(w.step, 0.5 * SP);
  eq(near(w.y - w.top, 0.35 * SP), true, 'control point above');
  eq(w.y, n.y - 0.15 * SP, 'notation lift'); eq(w.x1, n.x1, 'same start');
  eq(tn.width, 1.1); eq(tn.amp, 0.18 * SP); eq(tn.step, 0.3 * SP);
  eq(tw.width, 1.5); eq(tw.amp, 0.32 * SP); eq(tw.step, 0.43 * SP);
  eq(tw.y, tn.y - 0.14 * SP, 'TAB lift'); eq(tw.x1, tn.x1, 'same TAB start');
});
test('[W3] notation: pick stroke, T, trill, strum and fermata stay >= 0.7 sp above a wide wave', () => {
  const nq = (pitch, extra = {}, noteExtra = {}) => ({ type: 'note', duration: 'quarter', notes: [{ pitch, ...noteExtra }], ...extra });
  const chordQ = (extra) => ({ type: 'note', duration: 'quarter', notes: [{ pitch: 'E4' }, { pitch: 'G4' }, { pitch: 'B4' }], ...extra });
  const sc = (kind) => oneTrack([nq('E4', { vibrato: kind, pickStroke: 'down' }), nq('D5', { vibrato: kind }, { tap: true }),
    nq('G4', { vibrato: kind }, { trill: true }), chordQ({ vibrato: kind, strum: 'down' }),
    nq('A4', { vibrato: kind, fermata: true }), nq('C5', { vibrato: kind, pickStroke: 'up' }, { slap: true })]);
  const bottoms = (tree) => all(tree).filter((x) => x.n.tag === 'g').flatMap((x) => {
    const cls = x.n.getAttribute('class') || '';
    const t = x.n.children[0];
    if (/^(pick-stroke|fermata)/.test(cls)) return [{ cls, x: num(t, 'x'), bottom: num(t, 'y') }];
    if (cls === 'tap' || cls === 'slap') return [{ cls, x: num(t, 'x'), bottom: num(t, 'y') + 0.25 * num(t, 'font-size') }];
    if (cls === 'trill') return [{ cls, x: num(t, 'x'), bottom: num(t, 'y') - glyphBoxTrillBottom * SP }];
    if (/^strum/.test(cls)) {
      const ys = x.n.children.flatMap((c) => (c.getAttribute('d') || c.getAttribute('points') || '').match(/-?[\d.]+/g).map(Number).filter((_, i) => i % 2 === 1));
      return [{ cls, x: Number(x.n.children[0].getAttribute('d').match(/-?[\d.]+/g)[0]), bottom: Math.max(...ys) }];
    }
    return [];
  });
  for (const kind of [true, 'wide']) {
    const tree = renderTree(sc(kind));
    const ws = waves(tree);
    eq(ws.length, 6, `${kind} waves`);
    const bs = bottoms(tree);
    deepEq(bs.map((b) => b.cls).sort(), ['fermata', 'pick-stroke pick-stroke-down', 'pick-stroke pick-stroke-up', 'slap', 'strum strum-down', 'tap', 'trill'].sort(), `${kind} marks`);
    bs.forEach((b) => {
      const w = ws.find((v) => near(v.x1 - 0.5 * SP, b.x));
      ok(w, `${kind} ${b.cls}: wave at x ${b.x}`);
      ok(b.bottom <= w.top - 0.7 * SP + EPS, `${kind} ${b.cls}: bottom ${b.bottom} vs wave top ${w.top}`);
    });
  }
});
test('[W3] TAB: tap T, trill and strum clear a wide wave; with a tremolo the wave stays above it', () => {
  const tb = (extra, noteExtra = {}) => ({ type: 'note', duration: 'quarter', ...extra, notes: [{ string: 2, fret: 3, ...noteExtra }] });
  const tree = renderTree(pinBoth([tb({ vibrato: 'wide' }, { tap: true }), tb({ vibrato: 'wide' }, { trill: 5 }),
    { type: 'note', duration: 'quarter', vibrato: 'wide', strum: 'up', notes: [{ string: 1, fret: 0 }, { string: 2, fret: 1 }] },
    tb({ vibrato: 'wide', tremolo: '16th' })]));
  const tabWaves = waves(tree).filter((w) => w.cls.startsWith('tab-'));
  eq(tabWaves.length, 4);
  const tabG = all(tree).find((x) => x.n.tag === 'g' && /staff-tab/.test(x.n.getAttribute('class') || '')).n;
  const inTab = all(tabG);
  const tap = inTab.find((x) => x.n.tag === 'g' && x.n.getAttribute('class') === 'tap').n.children[0];
  ok(num(tap, 'y') + 0.25 * num(tap, 'font-size') <= tabWaves[0].top + EPS, 'T above the wave');
  const tr = inTab.find((x) => x.n.tag === 'g' && x.n.getAttribute('class') === 'trill').n.children[0];
  ok(num(tr, 'y') - glyphBoxTrillBottom * SP <= tabWaves[1].top + EPS, 'trill above the wave');
  const strum = inTab.find((x) => x.n.tag === 'g' && /^strum/.test(x.n.getAttribute('class') || '')).n;
  const sys = strum.children.flatMap((c) => (c.getAttribute('d') || c.getAttribute('points') || '').match(/-?[\d.]+/g).map(Number).filter((_, i) => i % 2 === 1));
  ok(Math.max(...sys) <= tabWaves[2].top + EPS, 'strum above the wave');
  const trem = inTab.find((x) => x.n.tag === 'g' && /tab-tremolo/.test(x.n.getAttribute('class') || '')).n;
  const tremTop = Math.min(...trem.children.flatMap((l) => [num(l, 'y1'), num(l, 'y2')]));
  ok(tabWaves[3].bottom < tremTop, `wave bottom ${tabWaves[3].bottom} above tremolo top ${tremTop}`);
});
test('[W4] voice 2: vibrato "wide" draws nothing on notation or TAB', () => {
  const mk = (v2) => {
    const s = pinBoth([]);
    s.tracks[0].measures = [{ voices: [{ beats: [pinNote('whole')] },
      { beats: [{ type: 'note', duration: 'whole', ...v2, notes: [{ string: 4, fret: 2 }] }] }] }];
    return s;
  };
  const a = render(mk({}));
  const b = render(mk({ vibrato: 'wide' }));
  ok(!/vibrato/.test(b), 'no vibrato group');
  ok(a === b, 'differs from unmarked');
});

// ---------- 1.5 fermata kinds (F1-F2) ----------
const fermatas = (tree) => all(tree).filter((x) => x.n.tag === 'g' && /^fermata( |$)/.test(x.n.getAttribute('class') || ''))
  .map((x) => ({ cls: x.n.getAttribute('class'), code: cp(x.n.children[0]), x: num(x.n.children[0], 'x'), y: num(x.n.children[0], 'y') }));
test('[F1] codepoint and class per kind; explicit "normal" is byte-equal to true', () => {
  [[true, 'fermata', 'E4C0'], [' Normal', 'fermata', 'E4C0'], ['short', 'fermata fermata-short', 'E4C4'],
    ['LONG', 'fermata fermata-long', 'E4C6']].forEach(([v, cls, code]) => {
    const fs = fermatas(renderTree(oneTrack([q('E4', { fermata: v }), q('G4')])));
    deepEq(fs.map((f) => [f.cls, f.code]), [[cls, code]], JSON.stringify(v));
  });
  ok(render(oneTrack([q('E4', { fermata: 'normal' })])) === render(oneTrack([q('E4', { fermata: true })])), 'normal differs from true');
});
test('[F1] short / long sit where the normal one does: over a chord symbol, under a slur, on a rest', () => {
  const scores = [
    (v) => oneTrack([q('E4', { fermata: v, chord: 'Am' }), q('G4')]),
    (v) => oneTrack([q('E4', { slurStart: true }), q('B4', { fermata: v }), q('B4', { slurEnd: true }), q('E4')]),
    (v) => oneTrack([{ type: 'rest', duration: 'quarter', fermata: v }, q('E4')]),
    (v) => oneTrack([q('C6', { fermata: v, articulations: ['marcato'] })]),
  ];
  scores.forEach((mk, i) => {
    const [n] = fermatas(renderTree(mk(true)));
    for (const v of ['short', 'long']) {
      const [f] = fermatas(renderTree(mk(v)));
      ok(f, `score ${i} ${v}: drawn`);
      eq(f.y, n.y, `score ${i} ${v}: bottom`); eq(f.x, n.x, `score ${i} ${v}: x`);
    }
  });
});
test('[F2] "true", 1, false, null, garbage draw nothing; graces and voice 2 draw nothing', () => {
  const base = render(oneTrack([q('E4'), q('G4')]));
  ['true', 1, false, null, 'x', 'wide', 0, [], {}].forEach((v) =>
    ok(render(oneTrack([q('E4', { fermata: v }), q('G4')])) === base, `fermata ${JSON.stringify(v)}`));
  const plain = oneTrack([{ type: 'grace', notes: [{ pitch: 'E4' }] }, q('B4')]);
  ['short', 'long', 'normal'].forEach((v) => ok(render(oneTrack([{ type: 'grace', fermata: v, notes: [{ pitch: 'E4' }] }, q('B4')])) === render(plain), `grace ${v}`));
  const two = (extra) => {
    const s = oneTrack([]);
    s.tracks[0].measures = [{ voices: [{ beats: [whole(['D5'])] }, { beats: [whole(['E4'], extra)] }] }];
    return s;
  };
  ['short', 'long', 'normal', true].forEach((v) => ok(render(two({ fermata: v })) === render(two({})), `voice 2 ${v}`));
});

// ---------- 1.5 regressions: step-out cap and vibrato clearance ----------
const { spawnSync } = await import('node:child_process');
const { vibratoClearSp } = await imp('src/draw/noteMarks.js');
test('[A2] a nonsensical theme (staffLineSpacing -10) still renders staccato + marcato on a whole note (no hang)', () => {
  const code = `
    import { register } from 'node:module';
    register(${JSON.stringify(pathToFileURL(path.join(root0, 'tests/hooks.mjs')).href)});
    const { makeContainer, serialize } = await import(${JSON.stringify(pathToFileURL(path.join(root0, 'tests/dom-shim.mjs')).href)});
    const { MusicScoreRenderer } = await import(${JSON.stringify(pathToFileURL(path.join(root0, 'src/MusicScoreRenderer.js')).href)});
    const score = ${JSON.stringify(oneTrack([whole(['E4'], { articulations: ['staccato', 'marcato'] })]))};
    const box = makeContainer();
    new MusicScoreRenderer(box, score, { width: 900, theme: { staffLineSpacing: -10 } }).render();
    console.log('DONE ' + serialize(box.children[0]).length);`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 20000 });
  ok(!r.error, `did not finish: ${r.error && r.error.message}`);
  ok(r.status === 0 && /^DONE \d+/m.test(r.stdout), `status ${r.status}: ${r.stderr}`);
});
test('[W3] vibratoClearSp: exactly 2 sp for a normal wave, 2.3 sp for a wide one', () => {
  ok(vibratoClearSp(true) === 2, `normal ${vibratoClearSp(true)}`);
  ok(vibratoClearSp('wide') === 2.3, `wide ${vibratoClearSp('wide')}`);
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
