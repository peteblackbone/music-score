// Verification tests for the engraving / layout rework (design.md section 8, "After B").
// Run via `node tests/run.js` (which imports this and adds its failures), or directly:
// `node tests/engraving.mjs`.
//
// Areas (assertion counts are printed per area at the end):
//   align, justify, signatures, measure-numbers, barlines, repeats, vertical, numbers,
//   scaling, octave, beaming, accidentals, ties, tab-clef, a11y, theme, robustness, header, collisions, harmonics, directions, tab-rhythm, navigation, chordDiagrams
//
// Most geometric checks read the rendered SVG tree (class names + transforms); a few read the
// layout model (computeLayout) for facts that are not observable in the SVG (onset times,
// justified flag). inkBounds (src/layout/ink.js) is reused for the vertical-ink checks, so those
// are only as independent as ink.js; they are backed by ink-free checks (line gaps, primitive y's).
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

register('./hooks.mjs', import.meta.url);
const root0 = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(root0, p)).href);
const { makeContainer, serialize } = await import('./dom-shim.mjs');
const { MusicScoreRenderer } = await imp('src/MusicScoreRenderer.js');
const { normalizeScore } = await imp('src/normalize.js');
const { computeLayout } = await imp('src/layout/index.js');
const { resolveTheme, defaultTheme } = await imp('src/theme.js');
const { inkBounds } = await imp('src/layout/ink.js');
const { groupBeams } = await imp('src/layout/beams.js');
const { estimateTextWidth } = await imp('src/textMetrics.js');
const { resolveMeasureAccidentals } = await imp('src/layout/accidentals.js');
const { layoutChord } = await imp('src/layout/chord.js');
const { repeatDotSpaces } = await imp('src/draw/staff.js');
const { exampleScore } = await imp('examples/example-score.js');
const { leadRiff } = await imp('examples/lead-riff.js');
const { articulationsScore } = await imp('examples/articulations-demo.js');
const { characterizationCases } = await imp('tests/fixtures/characterization.js');

const EPS = 0.011;          // positions are rounded to 2 decimals
const clone = (o) => JSON.parse(JSON.stringify(o));

// ---------- tiny harness (same shape as articulations.mjs) ----------
const results = [];
const areaCounts = new Map();
let curArea = 'misc';
let curCount = 0;
function ok(cond, what) { curCount++; areaCounts.set(curArea, (areaCounts.get(curArea) || 0) + 1); if (!cond) throw new Error(what); }
function near(a, b, tol, what) { ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b} (tol ${tol})`); }
function test(area, name, fn) {
  curArea = area; curCount = 0;
  try { fn(); results.push({ ok: true, name: `[${area}] ${name}`, n: curCount }); }
  catch (e) { results.push({ ok: false, name: `[${area}] ${name}`, msg: e.message, n: curCount }); }
}

// ---------- helpers ----------
function* walk(n, parents = []) { yield { n, parents }; for (const c of n.children) yield* walk(c, [...parents, n]); }
const cls = (n) => (n.getAttribute && n.getAttribute('class')) || '';
const num = (n, a) => Number(n.getAttribute(a));
const cpOf = (t) => (t._text ? t._text.codePointAt(0) : 0);
const translateY = (n) => { const m = /translate\(0,(-?[\d.]+)\)/.exec(n.getAttribute('transform') || ''); return m ? Number(m[1]) : 0; };
function renderTree(score, width = 900, options = {}) {
  const box = makeContainer();
  new MusicScoreRenderer(box, clone(score), { width, ...options }).render();
  return box.children[0];
}
const all = (tree) => [...walk(tree)];
const byClass = (root, c, tag) => all(root).filter(({ n }) => (!tag || n.tag === tag) && cls(n) === c);
const systemsOf = (svg) => svg.children.filter((c) => /^system system-/.test(cls(c)));
const staffGroups = (sysG) => sysG.children.filter((c) => /^staff staff-/.test(cls(c)));
const glyphs = (root, code) => all(root).filter(({ n }) => n.tag === 'text' && cpOf(n) === code).map(({ n }) => n);
const layoutOf = (score, width, options = {}) => computeLayout(normalizeScore(clone(score)), resolveTheme(options.theme), width);

const q = (pitch, extra = {}) => ({ type: 'note', duration: 'quarter', notes: [{ pitch, ...(extra.note || {}) }], ...(extra.beat || {}) });
const e8 = (pitch) => ({ type: 'note', duration: '8th', notes: [{ pitch }] });
const bar4 = () => ({ beats: [q('E4'), q('G4'), q('B4'), q('D5')] });
const oneTrack = (measures, extra = {}) => ({ tracks: [{ name: 'T', clef: 'treble', measures, ...extra }] });
const tabNote = (string, fret, extra = {}) => ({ type: 'note', duration: 'quarter', notes: [{ string, fret, ...extra }] });

// Staff geometry read back from the SVG: absolute y of the top and bottom line.
function staffInfo(g) {
  const linesG = g.children.find((c) => /staff-lines|tab-lines/.test(cls(c)));
  const ys = linesG.children.map((l) => num(l, 'y1'));
  const y = translateY(g);
  return { g, y, top: y + Math.min(...ys), bottom: y + Math.max(...ys), localTop: Math.min(...ys), localBottom: Math.max(...ys),
    endX: num(linesG.children[0], 'x2'), startX: num(linesG.children[0], 'x1'), track: Number(g.getAttribute('data-track')), kind: cls(g).includes('tab') ? 'tab' : 'notation' };
}

const SCORES = [
  ['example-score', exampleScore, {}], ['lead-riff', leadRiff, {}], ['articulations', articulationsScore, {}],
  ...characterizationCases.map((c) => [`char-${c.name}`, c.score, c.options || {}]),
];
const WIDTHS = [600, 860, 900, 1400];

// ======================= alignment =======================
test('align', 'equal onset time => equal x across all tracks/staves; x increases with time (all scores x widths)', () => {
  for (const [name, score, options] of SCORES) for (const width of WIDTHS) {
    const layout = layoutOf(score, width, options);
    layout.systems.forEach((sys, si) => sys.measureIndices.forEach((mi, li) => {
      const byTime = new Map();
      sys.tracks.forEach((tr, ti) => tr.measures[li].elements.forEach((el) => {
        if (el.el.type === 'grace' || el.wholeMeasureRest || el.t == null) return;
        const k = `${el.t.n}/${el.t.d}`;
        if (!byTime.has(k)) byTime.set(k, { t: el.t.n / el.t.d, xs: [] });
        byTime.get(k).xs.push(el.x);
      }));
      for (const [k, v] of byTime) ok(Math.max(...v.xs) - Math.min(...v.xs) < 1e-6, `${name}@${width} sys${si} m${mi + 1} onset ${k}: x differ ${v.xs}`);
      const sorted = [...byTime.values()].sort((a, b) => a.t - b.t);
      for (let i = 1; i < sorted.length; i++) ok(sorted[i].xs[0] > sorted[i - 1].xs[0], `${name}@${width} sys${si} m${mi + 1}: x not increasing with time`);
    }));
  }
});

test('align', 'rendered noteheads of a quarter-note track and an eighth-note track line up (SVG level)', () => {
  const score = { tracks: [
    { name: 'A', measures: [{ beats: [q('E4'), q('E4'), q('E4'), q('E4')] }] },
    { name: 'B', measures: [{ beats: Array(8).fill(0).map(() => e8('E4')) }] },
  ] };
  const svg = renderTree(score, 900);
  const staves = staffGroups(systemsOf(svg)[0]).map(staffInfo);
  const headsOf = (st) => glyphs(st.g, 0xE0A4).map((t) => num(t, 'x'));
  const a = headsOf(staves[0]); const b = headsOf(staves[1]);
  ok(a.length === 4 && b.length === 8, `head counts ${a.length}/${b.length}`);
  for (let i = 0; i < 4; i++) near(a[i], b[2 * i], EPS, `quarter ${i} vs eighth ${2 * i}`);
  for (let i = 1; i < 8; i++) ok(b[i] > b[i - 1], 'eighth heads increase');
});

test('align', 'all staves of a system share the same header end (first-onset x) and measure barline x', () => {
  for (const [name, score, options] of SCORES) {
    const layout = layoutOf(score, 900, options);
    layout.systems.forEach((sys, si) => {
      const first = new Set(); const ends = new Set();
      sys.tracks.forEach((tr) => {
        const m0 = tr.measures[0];
        const nonGrace = m0.elements.filter((e) => e.el.type !== 'grace' && !e.wholeMeasureRest && e.t && e.t.n === 0);
        if (nonGrace.length) first.add(nonGrace[0].x);
        tr.measures.forEach((m, li) => { ends.add(`${li}:${m.endX}`); });
      });
      ok(first.size <= 1, `${name} sys${si}: first-onset x differ ${[...first]}`);
      ok(ends.size === sys.measureIndices.length, `${name} sys${si}: measure end x differ between tracks`);
    });
  }
});

// ======================= justification =======================
test('justify', 'non-last systems end at width - 3 sp (staff lines in SVG), all scores x widths', () => {
  for (const [name, score, options] of SCORES) for (const width of WIDTHS) {
    const svg = renderTree(score, width, options);
    const overflow = svg.getAttribute('data-overflow') === 'true';
    const w = num(svg, 'width');
    const sp = resolveTheme(options.theme).staffLineSpacing;
    const sys = systemsOf(svg);
    sys.forEach((sg, i) => {
      const ends = staffGroups(sg).map((g) => staffInfo(g).endX);
      ok(new Set(ends).size === 1, `${name}@${width} sys${i}: staves end at different x ${ends}`);
      ok(ends[0] <= w - 3 * sp + EPS, `${name}@${width} sys${i}: staff end ${ends[0]} beyond right margin`);
      if (i < sys.length - 1 && !overflow) near(ends[0], w - 3 * sp, EPS, `${name}@${width} sys${i} justified end`);
    });
  }
});

test('justify', 'last system: ragged when < 75% full, justified otherwise (sweep over widths)', () => {
  const measures = Array(7).fill(0).map(bar4);
  let sawRagged = false; let sawJustified = false;
  for (let width = 420; width <= 1500; width += 20) {
    const layout = layoutOf(oneTrack(measures), width);
    const svg = renderTree(oneTrack(measures), width);
    const last = layout.systems[layout.systems.length - 1];
    const svgSys = systemsOf(svg); const lastEnd = staffInfo(staffGroups(svgSys[svgSys.length - 1])[0]).endX;
    const target = width - 30;
    if (layout.systems.length === 1) continue;
    // natural (unjustified) fill of the last system, estimated by laying its measures out alone at a huge width
    const slice = layoutOf(oneTrack(measures.slice(last.measureIndices[0])), 5000).systems[0];
    const natural = (last.contentStartX - last.startX) + (slice.staffEndX - slice.contentStartX);
    const naturalFill = natural / (target - last.startX);
    if (last.justified) {
      sawJustified = true; near(lastEnd, target, EPS, `w${width} justified last system`);
      ok(naturalFill >= 0.75 - 0.03, `w${width}: last system justified although only ${(naturalFill * 100).toFixed(0)}% full`);
    }
    else {
      sawRagged = true;
      ok(lastEnd < target - 1, `w${width}: ragged last system reaches the margin`);
      const fill = (last.staffEndX - last.startX) / (target - last.startX);
      ok(fill < 0.75 + 0.02, `w${width}: ragged last system is ${(fill * 100).toFixed(0)}% full (>= 75% should justify)`);
    }
  }
  ok(sawRagged && sawJustified, `sweep must hit both cases (ragged ${sawRagged}, justified ${sawJustified})`);
});

test('justify', 'a single short measure at a wide width is not stretched (ragged)', () => {
  const short = layoutOf(oneTrack([bar4()]), 1400);
  ok(short.systems.length === 1 && !short.systems[0].justified, 'one short measure at w1400 should be ragged');
});

// ======================= signatures =======================
const sigScore = () => ({
  keySignature: 2,
  tracks: [{ name: 'G', showTablature: true, measures: [
    bar4(), bar4(), bar4(), bar4(),
    { timeSignature: { beats: 3, beatType: 4 }, beats: [q('E4'), q('G4'), q('B4')] },
    { beats: [q('E4'), q('G4'), q('B4')] },
    { beats: [q('E4'), q('G4'), q('B4')] },
    { beats: [q('E4'), q('G4'), q('B4')] },
    { timeSignature: { beats: 2, beatType: 4 }, beats: [q('E4'), q('G4')] },
    { beats: [q('E4'), q('G4')] },
  ] }],
});
const KEY_ACC = new Set([0xE262, 0xE260, 0xE261]);

test('signatures', 'time signature: once on system 1 + once per change + courtesy; none repeated at later system starts', () => {
  for (const width of [400, 520, 700, 900, 1400]) {
    const score = sigScore();
    const svg = renderTree(score, width);
    const norm = normalizeScore(clone(score)).tracks[0];
    const changes = norm.measures.filter((m) => m.timeChanged).length;
    const layout = layoutOf(score, width);
    let courtesyTime = 0;
    layout.systems.forEach((s) => { if (s.tracks[0].courtesy && s.tracks[0].courtesy.time) courtesyTime++; });
    const notation = all(svg).filter(({ n }) => cls(n) === 'staff staff-notation' && n.getAttribute('data-track') === '0').map(({ n }) => n);
    const tsCount = notation.reduce((a, g) => a + byClass(g, 'time-signature', 'g').length, 0);
    // Notation staff: every time signature drawn is a header (system 1 or a changed first measure), mid-system change or courtesy.
    ok(changes === 2, 'fixture has 2 time changes');
    ok(tsCount === 1 + changes + courtesyTime, `w${width}: ${tsCount} time signatures, expected 1 + ${changes} + ${courtesyTime} courtesy`);
    // Header time signature only on system 1 or when its first measure changed time.
    layout.systems.forEach((s, si) => {
      const firstChanged = norm.measures[s.measureIndices[0]].timeChanged;
      ok(s.header.showTime === (si === 0 || firstChanged), `w${width} sys${si}: showTime=${s.header.showTime}`);
    });
    // Every time signature group holds exactly two digit glyphs (numerator, denominator).
    byClass(svg, 'time-signature', 'g').forEach(({ n }) => ok(n.children.length === 2, 'time signature has 2 glyphs'));
  }
});

test('signatures', 'courtesy signature appears at the end of the system before a change, with class "courtesy"', () => {
  const score = oneTrack([bar4(), bar4(), bar4(), { timeSignature: { beats: 3, beatType: 4 }, beats: [q('E4'), q('G4'), q('B4')] }, { beats: [q('E4'), q('G4'), q('B4')] }]);
  let found = false;
  for (let width = 300; width <= 700; width += 10) {
    const layout = layoutOf(score, width);
    const idx = layout.systems.findIndex((s) => s.measureIndices[0] === 3);
    if (idx > 0) {
      found = true;
      ok(layout.systems[idx - 1].courtesy, `w${width}: no courtesy before the system starting at the change`);
      const svg = renderTree(score, width);
      ok(byClass(systemsOf(svg)[idx - 1], 'courtesy', 'g').length >= 1, `w${width}: courtesy group not drawn`);
      ok(layout.systems[idx].header.showTime, `w${width}: changed time not shown at next system start`);
      ok(byClass(systemsOf(svg)[0], 'courtesy', 'g').length === (idx === 1 ? 1 : 0), 'courtesy only at the break before the change');
    }
  }
  ok(found, 'sweep never broke before the changed measure');
});

test('signatures', 'clef + key signature on every system; accidental count = |key|; 8vb clef when fret-derived', () => {
  const plain = new Set([0xE050, 0xE062, 0xE052, 0xE064]);
  for (const [name, score, options] of SCORES) for (const width of [600, 900]) {
    const svg = renderTree(score, width, options);
    const norm = normalizeScore(clone(score));
    const layout = layoutOf(score, width, options);
    systemsOf(svg).forEach((sg, si) => staffGroups(sg).forEach((g) => {
      const info = staffInfo(g);
      if (info.kind === 'tab') { ok(byClass(g, 'tab-clef', 'g').length === 1, `${name}@${width} sys${si}: tab clef missing`); return; }
      const clefs = g.children.filter((c) => c.tag === 'text' && plain.has(cpOf(c)));
      ok(clefs.length === 1, `${name}@${width} sys${si} t${info.track}: ${clefs.length} clefs`);
      const key = norm.tracks[info.track].measures[layout.systems[si].measureIndices[0]].keySignature;
      // header key signature = the group at the system's header keyX (mid-system changes/courtesy are separate groups)
      const kg = g.children.filter((c) => cls(c) === 'key-signature' && Math.abs(num(c.children[0], 'x') - layout.systems[si].header.keyX) < EPS);
      if (key) {
        ok(kg.length === 1 && kg[0].children.length === Math.abs(key), `${name}@${width} sys${si}: key ${key} drawn as ${kg[0] ? kg[0].children.length : 0} accidentals`);
        ok(kg[0].children.every((t) => cpOf(t) === (key > 0 ? 0xE262 : 0xE260)), 'key accidental glyph kind');
      } else ok(kg.length === 0, `${name}@${width} sys${si}: key signature drawn for C major`);
    }));
  }
});

// ======================= measure numbers =======================
test('measure-numbers', 'systems 2+ show the number of their first measure; system 1 none; exactly one per system', () => {
  for (const [name, score, options] of SCORES) for (const width of WIDTHS) {
    const svg = renderTree(score, width, options);
    const layout = layoutOf(score, width, options);
    systemsOf(svg).forEach((sg, si) => {
      const nums = byClass(sg, 'measure-number', 'text');
      if (si === 0) { ok(nums.length === 0, `${name}@${width}: measure number on system 1`); return; }
      ok(nums.length === 1, `${name}@${width} sys${si}: ${nums.length} measure numbers`);
      ok(nums[0].n._text === String(layout.systems[si].measureIndices[0] + 1), `${name}@${width} sys${si}: "${nums[0].n._text}" != ${layout.systems[si].measureIndices[0] + 1}`);
    });
  }
});

test('measure-numbers', 'numbers increase strictly along systems and equal 1 + measures before (10 measures, w400)', () => {
  const svg = renderTree(sigScore(), 400);
  const nums = byClass(svg, 'measure-number', 'text').map(({ n }) => Number(n._text));
  ok(nums.length >= 2, 'expected several systems');
  for (let i = 1; i < nums.length; i++) ok(nums[i] > nums[i - 1], `numbers not increasing ${nums}`);
  ok(nums[0] > 1, 'first number > 1');
});

// ======================= barlines =======================
test('barlines', 'every barline line lies within its own staff (y) and not beyond the staff end (x); none in the notation-TAB gap', () => {
  for (const [name, score, options] of SCORES) for (const width of WIDTHS) {
    const svg = renderTree(score, width, options);
    systemsOf(svg).forEach((sg, si) => {
      const staves = staffGroups(sg).map(staffInfo);
      staves.forEach((st) => {
        byClass(st.g, 'barline', 'g').forEach(({ n: b }) => b.children.filter((l) => l.tag === 'line').forEach((l) => {
          const y1 = num(l, 'y1'); const y2 = num(l, 'y2');
          ok(Math.min(y1, y2) >= st.localTop - EPS && Math.max(y1, y2) <= st.localBottom + EPS, `${name}@${width} sys${si}: barline ${y1}..${y2} outside staff ${st.localTop}..${st.localBottom}`);
          ok(num(l, 'x1') <= st.endX + EPS, `${name}@${width} sys${si}: barline x beyond staff end`);
          // absolute: not inside any gap between two staves of the system
          const a1 = st.y + Math.min(y1, y2); const a2 = st.y + Math.max(y1, y2);
          staves.forEach((o) => { if (o !== st) ok(a2 < o.top || a1 > o.bottom, 'barline intersects another staff'); });
          for (let i = 1; i < staves.length; i++) {
            const gapTop = staves[i - 1].bottom; const gapBottom = staves[i].top;
            ok(!(a1 < gapBottom - EPS && a2 > gapTop + EPS && (a1 < gapTop - EPS || a2 > gapBottom + EPS)), `${name}@${width} sys${si}: barline crosses the gap between staves ${i - 1}/${i}`);
          }
        }));
      });
    });
  }
});

test('barlines', 'system join line spans first top line to last bottom line (2+ staves only)', () => {
  for (const [name, score, options] of SCORES) {
    const svg = renderTree(score, 900, options);
    systemsOf(svg).forEach((sg, si) => {
      const staves = staffGroups(sg).map(staffInfo);
      const joins = sg.children.filter((c) => cls(c) === 'system-join');
      if (staves.length < 2) { ok(joins.length === 0, `${name} sys${si}: join line on a single staff`); return; }
      ok(joins.length === 1, `${name} sys${si}: ${joins.length} join lines`);
      near(num(joins[0], 'y1'), staves[0].top, EPS, `${name} sys${si} join top`);
      near(num(joins[0], 'y2'), staves[staves.length - 1].bottom, EPS, `${name} sys${si} join bottom`);
      ok(num(joins[0], 'x1') >= staves[0].startX - EPS && num(joins[0], 'x1') <= staves[0].startX + 1 + EPS, `${name} sys${si}: join not at staff start`);
    });
  }
});

test('barlines', 'final barline: thick outer edge is flush with the staff end; thin line to its left', () => {
  const finals = [['example', exampleScore], ['two-bars', oneTrack([bar4(), bar4()])], ['tab', { tracks: [{ showStandardNotation: false, showTablature: true, measures: [{ beats: [tabNote(6, 0), tabNote(5, 2)] }] }] }]];
  for (const [name, score] of finals) for (const width of [600, 900]) {
    const svg = renderTree(score, width);
    const sg = systemsOf(svg)[systemsOf(svg).length - 1];
    staffGroups(sg).forEach((g) => {
      const st = staffInfo(g);
      const bars = byClass(g, 'barline', 'g').map(({ n }) => n);
      const lastBar = bars[bars.length - 1];
      const lines = lastBar.children.filter((l) => l.tag === 'line');
      ok(lines.length === 2, `${name}@${width}: final barline has ${lines.length} lines`);
      const thick = lines.find((l) => num(l, 'stroke-width') > 1.5); const thin = lines.find((l) => num(l, 'stroke-width') <= 1.5);
      ok(thick && thin, 'thick+thin');
      near(num(thick, 'x1') + num(thick, 'stroke-width') / 2, st.endX, EPS, `${name}@${width}: thick edge vs staff end`);
      ok(num(thin, 'x1') < num(thick, 'x1'), 'thin line left of thick');
    });
  }
});

test('barlines', 'single and double barlines: right edge flush with the measure end; double = two thin lines', () => {
  const score = oneTrack([{ ...bar4(), barline: 'double' }, bar4(), { ...bar4(), barline: 'single' }, bar4()]);
  const svg = renderTree(score, 900);
  const g = staffGroups(systemsOf(svg)[0])[0];
  const bars = byClass(g, 'barline', 'g').map(({ n }) => n);
  ok(bars[0].children.length === 2 && bars[1].children.length === 1, `double ${bars[0].children.length} single ${bars[1].children.length}`);
  ok(bars[0].children.every((l) => num(l, 'stroke-width') <= 1.5), 'double barline lines are thin');
  ok(num(bars[0].children[0], 'x1') > num(bars[0].children[1], 'x1'), 'double barline order');
});

// ======================= repeats =======================
const repeatScore = (tuning) => ({ tracks: [{ showStandardNotation: true, showTablature: true, ...(tuning ? { tuning } : {}), measures: [
  { beats: [tabNote(1, 0), tabNote(1, 1), tabNote(1, 2), tabNote(1, 3)] },
  { barline: 'repeatStart', beats: [tabNote(1, 0), tabNote(1, 1), tabNote(1, 2), tabNote(1, 3)] },
  { barline: 'repeatEnd', beats: [tabNote(1, 0), tabNote(1, 1), tabNote(1, 2), tabNote(1, 3)] },
  { beats: [tabNote(1, 0), tabNote(1, 1), tabNote(1, 2), tabNote(1, 3)] },
] }] });

test('repeats', 'repeat dot positions: notation spaces 2 and 3; TAB centred pair (4/5/6/7 strings)', () => {
  ok(JSON.stringify(repeatDotSpaces({ kind: 'notation' })) === '[2,3]', 'notation spaces');
  ok(JSON.stringify(repeatDotSpaces({ kind: 'tab', lines: 6 })) === '[2,4]', '6 strings');
  ok(JSON.stringify(repeatDotSpaces({ kind: 'tab', lines: 4 })) === '[1,3]', '4 strings');
  ok(JSON.stringify(repeatDotSpaces({ kind: 'tab', lines: 5 })) === '[2,3]', '5 strings');
  ok(JSON.stringify(repeatDotSpaces({ kind: 'tab', lines: 7 })) === '[3,4]', '7 strings');
  const tunings = { 4: ['E1', 'A1', 'D2', 'G2'], 5: ['B0', 'E1', 'A1', 'D2', 'G2'], 6: undefined, 7: ['B1', 'E2', 'A2', 'D3', 'G3', 'B3', 'E4'] };
  const expectTab = { 4: [7.5, 37.5], 5: [22.5, 37.5], 6: [22.5, 52.5], 7: [37.5, 52.5] };
  for (const n of [4, 5, 6, 7]) {
    const svg = renderTree(repeatScore(tunings[n]), 900);
    const g = staffGroups(systemsOf(svg)[0]);
    const nota = staffInfo(g[0]); const tab = staffInfo(g[1]);
    const dotsOf = (st) => byClass(st.g, 'barline', 'g').flatMap(({ n: b }) => b.children.filter((c) => c.tag === 'circle'));
    const nd = dotsOf(nota); const td = dotsOf(tab);
    ok(nd.length === 4 && td.length === 4, `${n}: dot counts ${nd.length}/${td.length} (repeatStart + repeatEnd, 2 each)`);
    near(Math.min(...nd.map((c) => num(c, 'cy'))) - nota.localTop, 15, EPS, 'notation dot 1 (space 2)');
    near(Math.max(...nd.map((c) => num(c, 'cy'))) - nota.localTop, 25, EPS, 'notation dot 2 (space 3)');
    const ys = [...new Set(td.map((c) => num(c, 'cy')))].sort((a, b) => a - b);
    ok(ys.length === 2 && Math.abs(ys[0] - expectTab[n][0]) < EPS && Math.abs(ys[1] - expectTab[n][1]) < EPS, `${n}-string TAB dots at ${ys}, expected ${expectTab[n]}`);
    // symmetric about the staff centre
    near((ys[0] + ys[1]) / 2, (tab.localBottom - tab.localTop) / 2, EPS, `${n}-string TAB dots symmetric`);
  }
});

test('repeats', 'repeatStart is drawn at the START of its measure (left of its notes), repeatEnd at the end; dots face the music', () => {
  const score = repeatScore();
  const svg = renderTree(score, 900);
  const layout = layoutOf(score, 900);
  const sys = layout.systems[0];
  const g = staffGroups(systemsOf(svg)[0])[0];
  const bars = byClass(g, 'barline', 'g').map(({ n }) => n);
  const withDots = bars.filter((b) => b.children.some((c) => c.tag === 'circle'));
  ok(withDots.length === 2, `${withDots.length} barlines with dots`);
  const [rs, re] = withDots;
  const m1 = sys.tracks[0].measures[1];
  const thickRs = rs.children.find((l) => l.tag === 'line' && num(l, 'stroke-width') > 1.5);
  near(num(thickRs, 'x1') - num(thickRs, 'stroke-width') / 2, m1.startBarline.x, EPS, 'repeatStart thick line left edge = measure start');
  const dotsRs = rs.children.filter((c) => c.tag === 'circle');
  ok(dotsRs.every((c) => num(c, 'cx') > num(thickRs, 'x1')), 'start dots to the right of the thick line');
  ok(dotsRs.every((c) => num(c, 'cx') < Math.min(...m1.elements.map((el) => el.x))), 'start dots left of the first note');
  const thickRe = re.children.find((l) => l.tag === 'line' && num(l, 'stroke-width') > 1.5);
  ok(re.children.filter((c) => c.tag === 'circle').every((c) => num(c, 'cx') < num(thickRe, 'x1')), 'end dots left of the thick line');
  near(num(thickRe, 'x1') + num(thickRe, 'stroke-width') / 2, sys.tracks[0].measures[2].endX, EPS, 'repeatEnd flush with measure end');
  // measure 1 (before the repeat) closes with a plain single barline; the repeatStart measure itself too
  const norm = normalizeScore(clone(score)).tracks[0].measures;
  ok(norm[1].repeatStart === true && norm[1].barline === 'single', 'normalized repeatStart measure closes with single');
  ok(norm[0].barline === 'single', 'measure before has a single barline');
  // old behaviour (repeatStart drawn at the END of the measure) is gone: the barline after measure 1 has no dots
  const afterM1 = bars.find((b) => b.children.length && Math.abs(num(b.children.find((c) => c.tag === 'line'), 'x1') - sys.tracks[0].measures[1].endX) <= 1);
  ok(!afterM1 || !afterM1.children.some((c) => c.tag === 'circle'), 'no repeat dots at the end of the repeatStart measure');
});

test('repeats', 'repeatStart as the first measure of the score is drawn at the system start after the header', () => {
  const score = oneTrack([{ barline: 'repeatStart', ...bar4() }, bar4()]);
  const layout = layoutOf(score, 900);
  const sys = layout.systems[0];
  const svg = renderTree(score, 900);
  const g = staffGroups(systemsOf(svg)[0])[0];
  const first = byClass(g, 'barline', 'g')[0].n;
  ok(first.children.some((c) => c.tag === 'circle'), 'dots at the very start');
  const thick = first.children.find((l) => l.tag === 'line' && num(l, 'stroke-width') > 1.5);
  ok(num(thick, 'x1') >= sys.startX + sys.headerWidth - 1, 'repeatStart is after the clef/key/time header');
});

// ======================= vertical =======================
test('vertical', 'gaps between staves >= minimums; staves never overlap (ink-free and ink-based); height = last ink + 3 sp', () => {
  for (const [name, score, options] of SCORES) for (const width of WIDTHS) {
    const theme = resolveTheme(options.theme);
    const s = theme.staffLineSpacing;
    const svg = renderTree(score, width, options);
    const systems = systemsOf(svg);
    const flat = [];
    systems.forEach((sg, si) => staffGroups(sg).forEach((g) => flat.push({ ...staffInfo(g), si })));
    ok(flat.length > 0, `${name}@${width}: no staves`);
    for (let i = 1; i < flat.length; i++) {
      const a = flat[i - 1]; const b = flat[i];
      const gap = b.top - a.bottom;
      const min = a.si !== b.si ? theme.systemGapSp : a.track === b.track ? theme.notationTabGapSp : theme.instrumentGapSp;
      ok(gap >= min * s - EPS, `${name}@${width}: gap ${gap} < ${min * s} between staves ${i - 1}/${i}`);
      // ink-free: no line/rect/circle/path coordinate of A lies at or below B's top line; none of B above A's bottom line
      const ys = (st) => all(st.g).filter(({ n }) => ['line', 'circle', 'rect'].includes(n.tag)).flatMap(({ n }) => n.tag === 'line' ? [num(n, 'y1'), num(n, 'y2')] : n.tag === 'circle' ? [num(n, 'cy')] : [num(n, 'y'), num(n, 'y') + num(n, 'height')]).filter(Number.isFinite).map((y) => y + st.y);
      ok(Math.max(...ys(a)) < b.top, `${name}@${width}: staff ${i - 1} has geometry below the next staff's top line`);
      ok(Math.min(...ys(b)) > a.bottom, `${name}@${width}: staff ${i} has geometry above the previous staff's bottom line`);
      // ink-based
      const ia = inkBounds(a.g, theme); const ib = inkBounds(b.g, theme);
      ok(a.y + Math.max(ia.bottom, a.localBottom) < b.y + Math.min(ib.top, 0), `${name}@${width}: ink overlap between staves ${i - 1}/${i}`);
    }
    const last = flat[flat.length - 1];
    const il = inkBounds(last.g, theme);
    near(num(svg, 'height'), last.y + Math.max(il.bottom, last.localBottom) + 3 * s, 0.02, `${name}@${width}: height = last ink + 3 sp`);
    ok(num(svg, 'height') >= last.bottom + 3 * s - EPS, `${name}@${width}: height below last staff + 3 sp`);
    ok(svg.getAttribute('viewBox') === `0 0 ${svg.getAttribute('width')} ${svg.getAttribute('height')}`, 'viewBox matches size');
  }
});

test('vertical', 'ink pushes staves apart: a very high note raises the gap above the minimum', () => {
  const low = oneTrack([{ beats: [q('E4'), q('E4'), q('E4'), q('E4')] }], { showTablature: true });
  const high = oneTrack([{ beats: [q('E4'), q('E4'), q('E4'), q('C7')] }], { showTablature: true });
  const gapBelow = (score) => { const g = staffGroups(systemsOf(renderTree(score, 900))[0]).map(staffInfo); return g[1].top - g[0].bottom; };
  ok(gapBelow(low) >= 35 - EPS, 'minimum notation-TAB gap 3.5 sp');
  const g = (score) => num(renderTree(score, 900), 'height');
  ok(g(high) > g(low), 'ledger-line-heavy score is taller');
});

// ======================= numbers =======================
test('numbers', 'no NaN/Infinity/undefined and <= 2 decimals in any output (all scores x widths x two spacings)', () => {
  for (const [name, score, options] of SCORES) for (const width of WIDTHS) {
    for (const theme of [options.theme, { ...(options.theme || {}), staffLineSpacing: 13 }]) {
      const out = serialize(renderTree(score, width, { ...options, theme }));
      ok(!/NaN|Infinity|undefined/.test(out), `${name}@${width}: bad number`);
      const longDec = out.match(/\d+\.\d{3,}/g);
      ok(!longDec, `${name}@${width}: more than 2 decimals ${longDec && longDec.slice(0, 3)}`);
    }
  }
});

// ======================= scaling =======================
function collectNumbers(root) {
  const out = [];
  for (const { n } of walk(root)) {
    for (const [k, v] of n.attrs) {
      if (['x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'width', 'height'].includes(k) && n.tag !== 'text' || (n.tag === 'text' && (k === 'x' || k === 'y'))) {
        if (n.tag === 'svg' && (k === 'width' || k === 'height')) { out.push({ k, v: Number(v), tag: 'svg' }); continue; }
        out.push({ k, v: Number(v), tag: n.tag });
      } else if (k === 'd') (v.match(/-?\d+(\.\d+)?/g) || []).forEach((m, i) => out.push({ k: `d${i % 2 ? 'y' : 'x'}`, v: Number(m), tag: 'path', isCoord: true }));
      else if (k === 'transform') { const m = /translate\((-?[\d.]+),(-?[\d.]+)\)/.exec(v); if (m) { out.push({ k: 'x', v: Number(m[1]), tag: 'g' }); out.push({ k: 'y', v: Number(m[2]), tag: 'g' }); } }
    }
  }
  return out;
}
const SCALED = { staffLineSpacing: 20, tabStaffLineSpacing: 30, tabFontSize: 24, dynamicFontSize: 30 };
const SCALED_STROKES = { ...SCALED, stemWidth: 2.6, beamWidth: 10, staffLineWidth: 2 };

function scaleDrift(theme, label) {
  const mx = { x: 0, y: 0, pathX: 0, pathY: 0 };
  for (const [name, score, options] of SCORES) {
    if (options.theme) continue; // fixtures with their own spacing are not doubled
    const na = collectNumbers(renderTree(score, 900)); const nb = collectNumbers(renderTree(score, 1800, { theme }));
    ok(na.length === nb.length, `${label} ${name}: tree shape differs when scaled (${na.length} vs ${nb.length})`);
    for (let i = 0; i < na.length; i++) {
      ok(na[i].k === nb[i].k && na[i].tag === nb[i].tag, `${label} ${name}: attribute order differs at ${i}`);
      const key = (na[i].tag === 'path' ? 'path' : '') + (/^(y|y1|y2|cy|height)$/.test(na[i].k) || na[i].k === 'dy' ? (na[i].tag === 'path' ? 'Y' : 'y') : (na[i].tag === 'path' ? 'X' : 'x'));
      const d = Math.abs(nb[i].v - 2 * na[i].v);
      if (d > mx[key]) mx[key] = d;
    }
  }
  return mx;
}

test('scaling', 'x2 scaling with every stroke width doubled too: all coordinates double exactly (drift <= 0.02)', () => {
  const mx = scaleDrift(SCALED_STROKES, 'strokes-scaled');
  for (const [k, v] of Object.entries(mx)) ok(v <= 0.02, `strokes-scaled max drift ${k} = ${v.toFixed(3)} > 0.02`);
  results.push({ ok: true, name: `[scaling] info: strokes scaled, max drift x ${mx.x.toFixed(3)} y ${mx.y.toFixed(3)} path x ${mx.pathX.toFixed(3)} y ${mx.pathY.toFixed(3)} (tolerance 0.02)`, n: 0, info: true });
});

test('scaling', 'x2 scaling with fixed stroke widths (default staffLineWidth/stemWidth/beamWidth): bounded drift', () => {
  // Stroke widths (staffLineWidth 1, stemWidth 1.3, beamWidth 5) are theme px values that do not follow staffLineSpacing, so
  // anything anchored on them (stem x, beam polygon corners, thick barline centres, glyph text offsets) drifts. Measured:
  // x 1.5 px, y 1.3 px, path x 0.66 px, path y 10 px (stacked 16th/32nd beams, 2 x beamWidth difference). Tolerances below
  // are the measured maxima plus ~10-20% headroom; a layout that stopped scaling would drift by tens or hundreds of px.
  // y raised 1.6 -> 2.4 with the ink-based chord-symbol/dynamic baselines (acceptance fix C1): they follow fixed-width
  // stem/beam ink, and the per-system drift accumulates into the SVG height (measured 2.01 px on an earlier, 6-system lead-riff example; the current corpus measures 1.50 px).
  const TOL = { x: 2, y: 2.4, pathX: 0.8, pathY: 11 };
  const mx = scaleDrift(SCALED, 'fixed-strokes');
  for (const [k, v] of Object.entries(mx)) ok(v <= TOL[k], `fixed-strokes max drift ${k} = ${v.toFixed(3)} > ${TOL[k]}`);
  results.push({ ok: true, name: `[scaling] info: fixed strokes, max drift x ${mx.x.toFixed(2)} y ${mx.y.toFixed(2)} path x ${mx.pathX.toFixed(2)} y ${mx.pathY.toFixed(2)} (tolerances ${JSON.stringify(TOL)})`, n: 0, info: true });
});

// ======================= octave =======================
test('octave', 'string 1 fret 0 is written E5 and the clef is gClef8vb (U+E052); explicit-pitch track stays plain', () => {
  const fret = { tracks: [{ showTablature: true, measures: [{ beats: [{ type: 'note', duration: 'whole', notes: [{ string: 1, fret: 0 }] }] }] }] };
  const n = normalizeScore(clone(fret)).tracks[0];
  ok(n.measures[0].beats[0].notes[0].pitch === 'E5', 'written E5');
  ok(n.measures[0].beats[0].notes[0].soundingPitch === 'E4', 'sounding E4');
  ok(n.octaveClef === true, 'octaveClef');
  const svg = renderTree(fret, 900);
  ok(glyphs(svg, 0xE052).length === 1 && glyphs(svg, 0xE050).length === 0, '8vb clef drawn instead of the plain G clef');
  const plain = renderTree({ tracks: [{ measures: [{ beats: [q('E4')] }] }] }, 900);
  ok(glyphs(plain, 0xE050).length === 1 && glyphs(plain, 0xE052).length === 0, 'explicit pitch track keeps the plain clef');
  const ex = normalizeScore({ tracks: [{ measures: [{ beats: [q('E4')] }] }] }).tracks[0];
  ok(!ex.octaveClef && ex.measures[0].beats[0].notes[0].pitch === 'E4', 'explicit pitch unchanged');
});

test('octave', 'writtenOctaveUp: explicit pitches +1 octave (7 staff positions = 35 px up), 8vb clef; bass uses fClef8vb', () => {
  const mk = (extra) => oneTrack([{ beats: [q('E4'), q('E4'), q('E4'), q('E4')] }], extra);
  const headY = (svg) => num(glyphs(svg, 0xE0A4)[0], 'y');
  const plain = renderTree(mk({}), 900); const up = renderTree(mk({ writtenOctaveUp: true }), 900);
  near(headY(plain) - headY(up), 35, EPS, 'notehead moves up 7 positions');
  const norm = normalizeScore(mk({ writtenOctaveUp: true })).tracks[0];
  ok(norm.octaveClef && norm.measures[0].beats[0].notes[0].pitch === 'E5' && norm.measures[0].beats[0].notes[0].soundingPitch === 'E4', 'normalized');
  ok(glyphs(up, 0xE052).length === 1, 'gClef8vb drawn');
  const bass = renderTree(oneTrack([{ beats: [q('E2')] }], { clef: 'bass', writtenOctaveUp: true }), 900);
  ok(glyphs(bass, 0xE064).length === 1 && glyphs(bass, 0xE062).length === 0, 'fClef8vb drawn');
});

test('octave', 'fret-derived pitches across strings: written = sounding + 12 semitones; mixed track still gets 8vb', () => {
  const sc = { tracks: [{ showTablature: true, measures: [{ beats: [tabNote(6, 0), tabNote(5, 0), tabNote(1, 12), q('C4')] }] }] };
  const b = normalizeScore(clone(sc)).tracks[0].measures[0].beats;
  ok(b[0].notes[0].pitch === 'E3' && b[1].notes[0].pitch === 'A3' && b[2].notes[0].pitch === 'E6', `pitches ${b.map((x) => x.notes[0].pitch)}`);
  ok(b[3].notes[0].pitch === 'C4', 'explicit pitch in the same track untouched');
});

// ======================= beaming =======================
test('beaming', 'groupBeams: 6/8 -> 2 groups, 3/8 -> 1, 12/8 -> 4; 4/4 eighths -> 4 pairs-of-two groups unchanged', () => {
  const e = { type: 'note', duration: '8th', notes: [{ pitch: 'E4' }] };
  ok(groupBeams(Array(6).fill(e), { beats: 6, beatType: 8 }).length === 2, '6/8');
  ok(groupBeams(Array(3).fill(e), { beats: 3, beatType: 8 }).length === 1, '3/8');
  ok(groupBeams(Array(12).fill(e), { beats: 12, beatType: 8 }).length === 4, '12/8');
  ok(groupBeams(Array(8).fill(e), { beats: 4, beatType: 4 }).length === 4, '4/4 eighths: 4 groups');
});

test('beaming', 'rendered primary beams: 6/8 -> 2, 3/8 -> 1, 12/8 -> 4', () => {
  const beamCount = (n, ts) => {
    const svg = renderTree(oneTrack([{ beats: Array(n).fill(0).map(() => e8('E4')) }], { timeSignature: ts }), 900);
    return all(svg).filter(({ n: x }) => x.tag === 'path' && !cls(x) && / Z$/.test(x.getAttribute('d') || '')).length;
  };
  ok(beamCount(6, { beats: 6, beatType: 8 }) === 2, '6/8 beams');
  ok(beamCount(3, { beats: 3, beatType: 8 }) === 1, '3/8 beams');
  ok(beamCount(12, { beats: 12, beatType: 8 }) === 4, '12/8 beams');
  ok(beamCount(8, { beats: 4, beatType: 4 }) === 4, '4/4 beams');
});

// ======================= accidentals =======================
const nq = (pitch, note) => q(pitch, { note });
test('accidentals', 'carry-through within a measure, cancelling natural, restatement after tie; reset at the barline', () => {
  const tr = normalizeScore(oneTrack([
    { beats: [nq('F#4'), nq('F#4'), nq('F4'), nq('F#5')] },
    { beats: [nq('F#4', { tieEnd: true }), nq('F#4'), nq('B4'), nq('B4')] },
  ])).tracks[0];
  const a0 = resolveMeasureAccidentals(tr, 0).map((b) => b.names[0]);
  ok(JSON.stringify(a0) === JSON.stringify(['sharp', null, 'natural', 'sharp']), `carry ${JSON.stringify(a0)}`);
  const a1 = resolveMeasureAccidentals(tr, 1);
  ok(a1[0].names[0] === null && a1[0].restate[0] === 'sharp', 'tied continuation: no accidental, restatement available');
  ok(a1[1].names[0] === 'sharp', 'barline resets: F# in the next measure shows a sharp again');
});

test('accidentals', 'rendered: F#4 F#4 F4 F#5 draws 2 sharps and 1 natural; key signature suppresses redundant sharps', () => {
  const svg = renderTree(oneTrack([{ beats: [nq('F#4'), nq('F#4'), nq('F4'), nq('F#5')] }]), 900);
  const staff = staffGroups(systemsOf(svg)[0])[0];
  ok(glyphs(staff, 0xE262).length === 2 && glyphs(staff, 0xE261).length === 1, `sharps ${glyphs(staff, 0xE262).length} naturals ${glyphs(staff, 0xE261).length}`);
  const inD = renderTree({ keySignature: 2, ...oneTrack([{ beats: [nq('F#4'), nq('F#4'), nq('F4'), nq('F#5')] }]) }, 900);
  const staffD = staffGroups(systemsOf(inD)[0])[0];
  const kg = staffD.children.find((c) => cls(c) === 'key-signature');
  const nonKeySharps = glyphs(staffD, 0xE262).length - kg.children.length;
  ok(nonKeySharps === 0 && glyphs(staffD, 0xE261).length === 1, `in D: extra sharps ${nonKeySharps}, naturals ${glyphs(staffD, 0xE261).length} (only the F natural)`);
});

test('accidentals', 'tied note restates its accidental at the start of a new system, not mid-system', () => {
  const brk = oneTrack([
    { beats: [q('E4'), q('E4'), q('E4'), q('E4')] },
    { beats: [q('E4'), q('E4'), q('E4'), nq('F#5', { tieStart: true })] },
    { beats: [nq('F#5', { tieEnd: true }), q('E4'), q('E4'), q('E4')] },
    { beats: [q('E4'), q('E4'), q('E4'), q('E4')] },
  ]);
  let sawStart = false; let sawMid = false;
  for (let width = 330; width <= 800; width += 10) {
    const lay = layoutOf(brk, width);
    const sys = lay.systems.find((sy) => sy.measureIndices.includes(2));
    const li = sys.measureIndices.indexOf(2);
    const acc = sys.tracks[0].measures[li].elements[0].accidentals[0];
    ok((li === 0) === (acc === 'sharp'), `w${width}: restatement li=${li} acc=${acc}`);
    if (li === 0) sawStart = true; else sawMid = true;
  }
  ok(sawStart && sawMid, `sweep must cover both cases (start ${sawStart}, mid ${sawMid})`);
});

test('accidentals', 'chord layout: seconds displaced by stem direction; accidental columns ordered', () => {
  const theme = resolveTheme();
  const base = { headGlyph: String.fromCodePoint(0xE0A4), duration: 'quarter' };
  const up = layoutChord([{}, {}, {}], [0, 1, 2], true, [null, null, null], base, theme);
  ok(up.heads[0].dx === 0 && up.heads[1].dx > 0 && up.heads[2].dx === 0, 'stem-up second: upper note right');
  const down = layoutChord([{}, {}], [5, 6], false, [null, null], base, theme);
  ok(down.heads[1].dx === 0 && down.heads[0].dx < 0, 'stem-down second: lower note left');
  const acc = layoutChord([{}, {}, {}], [0, 2, 4], true, ['sharp', 'sharp', 'sharp'], base, theme);
  const dx = (i) => acc.accidentals.find((a) => a.noteIndex === i).dx;
  ok(dx(2) > dx(0) && dx(0) > dx(1), `accidental columns ${dx(0)},${dx(1)},${dx(2)}`);
  const wide = layoutChord([{}, {}], [0, 6], true, ['flat', 'flat'], base, theme);
  ok(wide.accidentals[0].dx === wide.accidentals[1].dx, 'accidentals >= 6 positions apart share column 1');
});

// ======================= ties / slurs / H-P =======================
const tiePaths = (svg) => byClass(svg, 'tie', 'path');
const nums = (d) => d.match(/-?[\d.]+/g).map(Number);
test('ties', 'tie sits opposite the stem: stem-up notes -> tie below; stem-down -> above', () => {
  for (const [pitch, below] of [['E4', true], ['G4', true], ['D5', false], ['A5', false]]) {
    const svg = renderTree(oneTrack([{ beats: [nq(pitch, { tieStart: true }), nq(pitch, { tieEnd: true }), q('B4'), q('B4')] }]), 900);
    const t = tiePaths(svg);
    ok(t.length === 1, `${pitch}: ${t.length} tie paths`);
    const v = nums(t[0].n.getAttribute('d'));
    ok((v[3] > v[1]) === below, `${pitch}: tie ${v[3] > v[1] ? 'below' : 'above'}, expected ${below ? 'below' : 'above'}`);
  }
});

// Build a score via mk(k) whose first system ends exactly at measure index k (fixed point search).
function breakScore(mk, width) {
  for (let k = 0; k < 7; k++) {
    const score = mk(k);
    const sys0 = layoutOf(score, width).systems[0].measureIndices;
    if (sys0[sys0.length - 1] === k) return { score, k };
  }
  throw new Error('no break fixed point found');
}
test('ties', 'tie across a system break -> 2 tie paths in 2 different systems', () => {
  const { score, k } = breakScore((k) => oneTrack(Array(8).fill(0).map((_, i) => ({ beats: [
    i === k + 1 ? nq('B4', { tieEnd: true }) : q('E4'), q('G4'), q('B4'), i === k ? nq('B4', { tieStart: true }) : q('D5')] }))), 600);
  ok(k >= 0, 'break fixed point found');
  const svg = renderTree(score, 600);
  const t = tiePaths(svg);
  const sysOf = new Set(t.map(({ parents }) => cls(parents.find((p) => /^system system-/.test(cls(p))))));
  ok(t.length === 2 && sysOf.size === 2, `${t.length} paths in ${sysOf.size} systems`);
  const fixture = characterizationCases.find((f) => f.name === 'tie-slur-break');
  const fsvg = renderTree(fixture.score, fixture.width, fixture.options || {});
  const ft = tiePaths(fsvg);
  ok(ft.length === 2 && new Set(ft.map(({ parents }) => cls(parents.find((p) => /^system system-/.test(cls(p)))))).size === 2, 'tie-slur-break fixture');
  // a tie inside one system is a single path
  const inside = renderTree(oneTrack([{ beats: [nq('B4', { tieStart: true }), nq('B4', { tieEnd: true }), q('B4'), q('B4')] }]), 900);
  ok(tiePaths(inside).length === 1, 'unbroken tie is one path');
});

test('ties', 'slur across a system break is split in two (slur paths in 2 systems)', () => {
  const fixture = characterizationCases.find((f) => f.name === 'tie-slur-break');
  const layout = layoutOf(fixture.score, fixture.width);
  const split = layout.systems.length > 1 && layout.systems[0].measureIndices.includes(1) && !layout.systems[0].measureIndices.includes(2);
  const svg = renderTree(fixture.score, fixture.width);
  const slurs = byClass(svg, 'slur', 'path');
  if (split) ok(slurs.length === 2, `${slurs.length} slur paths where the slur crosses a break`);
  else ok(slurs.length >= 1, 'slur drawn');
  const inside = renderTree(oneTrack([{ beats: [q('E4', { beat: { slurStart: true } }), q('G4'), q('B4', { beat: { slurEnd: true } }), q('D5')] }]), 900);
  ok(byClass(inside, 'slur', 'path').length === 1, 'unbroken slur is one path');
});

test('ties', 'hammer-on across a system break: "H" letter drawn once (first segment only), two arcs', () => {
  const hp = (k, w) => ({ tracks: [{ showStandardNotation: false, showTablature: true, measures: Array(8).fill(0).map((_, i) => ({ beats: [
    tabNote(1, 5), tabNote(1, 5), tabNote(1, 5), i === k ? tabNote(1, 5, { hammerPull: true }) : tabNote(1, 5)] })) }] });
  const probe = layoutOf(hp(-1), 500);
  const k = probe.systems[0].measureIndices[probe.systems[0].measureIndices.length - 1];
  ok(probe.systems.length > 1 && k < 7, 'probe broke');
  const sc = hp(k);
  sc.tracks[0].measures[k + 1].beats[0] = tabNote(1, 7);
  const svg = renderTree(sc, 500);
  const arcs = byClass(svg, 'hammer-pull hammer-pull-h', 'g');
  ok(arcs.length === 2, `${arcs.length} hammer-pull arcs`);
  const letters = arcs.flatMap(({ n }) => n.children.filter((c) => c.tag === 'text' && c._text === 'H'));
  ok(letters.length === 1, `${letters.length} H letters across the break`);
  ok(arcs[0].n.children.some((c) => c.tag === 'text') && !arcs[1].n.children.some((c) => c.tag === 'text'), 'letter on the first segment only');
  const sysIdx = arcs.map(({ parents }) => cls(parents.find((p) => /^system system-/.test(cls(p)))));
  ok(new Set(sysIdx).size === 2, 'arcs in two systems');
});

// ======================= TAB clef =======================
test('tab-clef', 'TAB clef glyph by string count: 6 -> U+E06D, 4 -> U+E06E, 5 and 7 -> stacked letters T/A/B', () => {
  const tunings = { 6: undefined, 4: ['E1', 'A1', 'D2', 'G2'], 5: ['B0', 'E1', 'A1', 'D2', 'G2'], 7: ['B1', 'E2', 'A2', 'D3', 'G3', 'B3', 'E4'] };
  for (const n of [6, 4, 5, 7]) {
    const sc = { tracks: [{ showStandardNotation: false, showTablature: true, ...(tunings[n] ? { tuning: tunings[n] } : {}), measures: [{ beats: [tabNote(1, 0)] }] }] };
    const svg = renderTree(sc, 900);
    const clefs = byClass(svg, 'tab-clef', 'g');
    ok(clefs.length === 1, `${n}: ${clefs.length} tab clefs`);
    const texts = clefs[0].n.children.map((t) => t._text);
    if (n === 6) ok(texts.length === 1 && texts[0].codePointAt(0) === 0xE06D, '6 strings');
    else if (n === 4) ok(texts.length === 1 && texts[0].codePointAt(0) === 0xE06E, '4 strings');
    else ok(texts.join('') === 'TAB', `${n} strings: ${texts}`);
  }
});

// ======================= accessibility / header =======================
test('a11y', 'root has role="img" and a non-empty <title> as first child (all scores)', () => {
  for (const [name, score, options] of SCORES) {
    const svg = renderTree(score, 900, options);
    ok(svg.getAttribute('role') === 'img', `${name}: role`);
    ok(svg.children[0].tag === 'title' && svg.children[0]._text.length > 0, `${name}: title first child`);
  }
  const titled = renderTree({ title: 'My <b>Song</b> & co', ...oneTrack([bar4()]) }, 900);
  ok(titled.children[0]._text === 'My <b>Song</b> & co', 'title text is taken verbatim as text content');
  ok(/&lt;b&gt;/.test(serialize(titled)), 'markup in the title is escaped on serialization');
});

test('header', 'title centred, composer right-aligned at the right margin, instrument names clear of the staff start', () => {
  const svg = renderTree(exampleScore, 900);
  const title = byClass(svg, 'title', 'text')[0].n; const comp = byClass(svg, 'composer', 'text')[0].n;
  near(num(title, 'x'), 450, EPS, 'title centred'); ok(title.getAttribute('text-anchor') === 'middle', 'title anchor');
  near(num(comp, 'x'), 900 - 30, EPS, 'composer at right margin'); ok(comp.getAttribute('text-anchor') === 'end', 'composer anchor');
  for (const [name, score, options] of SCORES) for (const width of [600, 900]) {
    const sv = renderTree(score, width, options);
    const layout = layoutOf(score, width, options);
    const sp = resolveTheme(options.theme).staffLineSpacing;
    all(sv).forEach(({ n, parents }) => {
      if (cls(n) !== 'instrument-name') return;
      const si = Number(cls(parents.find((p) => /^system system-/.test(cls(p)))).split('system-')[1]);
      const right = num(n, 'x'); const left = right - estimateTextWidth(n._text, num(n, 'font-size'));
      ok(right <= layout.systems[si].startX - sp + EPS, `${name}@${width}: name "${n._text}" overlaps the staff`);
      ok(left >= -EPS, `${name}@${width}: name "${n._text}" off page`);
    });
  }
});

test('header', 'bracket only with 2+ instruments; names: full name on system 1, abbreviation after', () => {
  const one = renderTree(oneTrack([bar4()], { showTablature: true, name: 'Guitar' }), 900);
  ok(byClass(one, 'bracket', 'g').length === 0, 'no bracket for a single instrument');
  ok(byClass(one, 'system-join', 'line').length === 1, 'notation+TAB still joined');
  const two = renderTree(exampleScore, 900);
  ok(byClass(two, 'bracket', 'g').length === systemsOf(two).length, 'one bracket per system with 2 instruments (guitar notation+TAB)');
  const names = byClass(two, 'instrument-name', 'text').map(({ n }) => n._text);
  ok(names[0] === 'Guitar' && names.length >= 2, `names ${names}`);
});

// ======================= theme =======================
test('theme', 'legacy px keys are equivalent to the new sp keys: {systemGap:120} == {systemGapSp:12}, and the others', () => {
  const pairs = [[{ systemGap: 120 }, { systemGapSp: 12 }], [{ trackGap: 80 }, { instrumentGapSp: 8 }], [{ notationTabGap: 100 }, { notationTabGapSp: 10 }],
    [{ leftMargin: 60 }, { marginLeftSp: 6 }], [{ topMargin: 40 }, { marginTopSp: 4 }], [{ measurePadding: 20 }, { measurePaddingSp: 2 }], [{ spacingFactor: 69 }, { quarterSpacingSp: 5.25 }]];
  for (const [legacy, modern] of pairs) {
    const a = serialize(renderTree(exampleScore, 900, { theme: legacy })); const b = serialize(renderTree(exampleScore, 900, { theme: modern }));
    ok(a === b, `${JSON.stringify(legacy)} != ${JSON.stringify(modern)}`);
    ok(a !== serialize(renderTree(exampleScore, 900)), `${JSON.stringify(legacy)} had no effect`);
  }
  // sp conversion uses the overridden staffLineSpacing
  const t = resolveTheme({ staffLineSpacing: 20, systemGap: 240 });
  ok(t.systemGapSp === 12, 'px converted with the overridden spacing');
  ok(resolveTheme({ systemGap: 120, systemGapSp: 9 }).systemGapSp === 9, 'new key wins over the legacy one');
  ok(!('systemGap' in resolveTheme({ systemGap: 120 })), 'legacy key not copied into the theme');
  ok(resolveTheme({ systemGap: 'abc' }).systemGapSp === defaultTheme.systemGapSp, 'non-numeric legacy value ignored');
});

test('theme', 'resolveTheme ignores inherited keys (constructor, toString, __proto__) without throwing and without pollution', () => {
  const evil = JSON.parse('{"constructor": 5, "toString": 7, "__proto__": {"polluted": true}, "hasOwnProperty": 1}');
  let t;
  try { t = resolveTheme(evil); } catch (e) { ok(false, `threw ${e.message}`); }
  ok(t.systemGapSp === defaultTheme.systemGapSp && t.staffLineSpacing === 10, 'defaults intact');
  ok(({}).polluted === undefined && Object.prototype.polluted === undefined, 'Object.prototype not polluted');
  for (const k of ['constructor', 'toString', '__proto__']) {
    let threw = false; try { resolveTheme(JSON.parse(`{"${k}": 3}`)); } catch { threw = true; }
    ok(!threw, `${k} must not throw`);
  }
  ok(resolveTheme(null).staffLineSpacing === 10 && resolveTheme(undefined).staffLineSpacing === 10, 'null/undefined overrides');
  ok(serialize(renderTree(exampleScore, 900, { theme: evil })).length > 0, 'renders with hostile theme keys');
});

// ======================= robustness =======================
test('robustness', 'a shorter tracks[1] no longer crashes; it is padded to the longest track', () => {
  const score = { tracks: [
    { name: 'A', measures: [bar4(), bar4(), bar4()] },
    { name: 'B', clef: 'bass', measures: [{ beats: [q('E3'), q('E3'), q('E3'), q('E3')] }] },
  ] };
  let svg; try { svg = renderTree(score, 900); } catch (e) { ok(false, `threw ${e.stack}`); }
  const n = normalizeScore(clone(score));
  ok(n.measureCount === 3 && n.tracks[1].measures.length === 3, 'padded to 3 measures');
  const layout = layoutOf(score, 900);
  ok(layout.systems.every((s) => s.tracks[0].measures.length === s.tracks[1].measures.length), 'tracks have equal measure counts per system');
  ok(glyphs(svg, 0xE4E3).length >= 2, 'padded measures show whole-measure rests');
  ok(!/NaN|undefined/.test(serialize(svg)), 'no bad numbers');
  // longer second track works as well
  const rev = { tracks: [score.tracks[1], score.tracks[0]] };
  ok(renderTree(rev, 900) !== undefined, 'longer track second/first both fine');
  // empty / degenerate input
  ok(renderTree({ tracks: [{ measures: [] }] }, 900) !== undefined, 'empty track renders');
});

test('robustness', 'overflow: a single unfittable measure widens the SVG and sets data-overflow="true"; normal scores have no attribute', () => {
  const dense = oneTrack([{ beats: Array(32).fill(0).map((_, i) => ({ type: 'note', duration: '32nd', notes: [{ pitch: i % 2 ? 'F#4' : 'Bb4' }] })) }], { timeSignature: { beats: 4, beatType: 4 } });
  const svg = renderTree(dense, 300);
  ok(svg.getAttribute('data-overflow') === 'true', 'data-overflow set');
  ok(num(svg, 'width') > 300, `width ${num(svg, 'width')} should exceed 300`);
  const layout = layoutOf(dense, 300);
  ok(layout.overflow === true, 'layout.overflow');
  const staves = staffGroups(systemsOf(svg)[0]).map(staffInfo);
  ok(staves[0].endX <= num(svg, 'width') - 30 + EPS, 'staff still ends inside the (widened) right margin');
  const normal = renderTree(exampleScore, 900);
  ok(normal.getAttribute('data-overflow') === null, 'no data-overflow on a normal score');
  ok(num(normal, 'width') === 900, 'width honoured');
  // a narrow width that still fits (compressed) does not overflow
  const narrow = renderTree(oneTrack([bar4(), bar4()]), 300);
  ok(narrow.getAttribute('data-overflow') === null && num(narrow, 'width') === 300, 'narrow but fits: no overflow');
});

test('robustness', 'rendering is idempotent and does not mutate the input score; re-render is stable', () => {
  const before = JSON.stringify(exampleScore);
  const box = makeContainer();
  const r = new MusicScoreRenderer(box, exampleScore, { width: 900 });
  r.render(); const a = serialize(box.children[0]); r.render();
  ok(box.children.length === 1 && serialize(box.children[0]) === a, 're-render differs');
  ok(JSON.stringify(exampleScore) === before, 'input score mutated');
});

// ======================= collisions (acceptance fixes C1, C2, C4) =======================
// Per-node ink box in a staff group's local coordinates: y from inkBounds on the node alone,
// x from its own attributes (music glyphs: their glyph-box width; other text: estimated width).
const { glyphStringBox } = await imp('src/glyphMetrics.js');
const { TEXT_ASCENT_EM, TEXT_DESCENT_EM } = await imp('src/layout/ink.js');
const DEF = resolveTheme();
function nodeBox(n, theme = DEF) {
  const { top, bottom } = inkBounds({ tag: n.tag, getAttribute: (a) => n.getAttribute(a), textContent: n._text, children: [] }, theme);
  let x1; let x2;
  if (n.tag === 'line') { x1 = Math.min(num(n, 'x1'), num(n, 'x2')); x2 = Math.max(num(n, 'x1'), num(n, 'x2')); }
  else if (n.tag === 'circle') { x1 = num(n, 'cx') - num(n, 'r'); x2 = num(n, 'cx') + num(n, 'r'); }
  else if (n.tag === 'rect') { x1 = num(n, 'x'); x2 = x1 + num(n, 'width'); }
  else if (n.tag === 'path') {
    const xs = (String(n.getAttribute('d')).match(/-?\d*\.?\d+/g) || []).map(Number).filter((_, i) => i % 2 === 0);
    x1 = Math.min(...xs); x2 = Math.max(...xs);
  } else if (n.tag === 'text') {
    const size = num(n, 'font-size');
    const music = (n.getAttribute('font-family') || '') === theme.fontFamily;
    const w = music ? glyphStringBox(n._text || '').width * size / 4 : estimateTextWidth(n._text, size);
    const anchor = n.getAttribute('text-anchor');
    x1 = num(n, 'x') - (anchor === 'middle' ? w / 2 : anchor === 'end' ? w : 0); x2 = x1 + w;
  } else return null;
  return { x1, x2, top, bottom };
}
const overlaps = (a, b) => a.x1 < b.x2 && b.x1 < a.x2 && a.top < b.bottom && b.top < a.bottom;
// Leaf nodes of a staff group that belong to the music (not the decorations placed around it).
const SKIP = new Set(['chord-symbol', 'dynamic', 'fermata', 'tempo', 'measure-number', 'staff-lines', 'barline', 'key-signature', 'time-signature', 'courtesy']);
function musicLeaves(g, xMin) {
  const out = [];
  const visit = (n) => {
    if (SKIP.has(cls(n))) return;
    if (n.tag === 'g') { n.children.forEach(visit); return; }
    const b = nodeBox(n);
    if (b && Number.isFinite(b.top) && b.x2 >= xMin) out.push({ n, b });
  };
  g.children.forEach(visit);
  return out;
}
const notationStaves = (svg) => systemsOf(svg).flatMap((sg, si) => staffGroups(sg).filter((g) => cls(g).includes('notation')).map((g) => ({ g, si })));
const textsOf = (g, c) => g.children.filter((n) => n.tag === 'text' && cls(n) === c);

test('collisions', 'chord symbols: one baseline per system staff, >= 2.5 sp above the top line, estimated boxes clear of all note/stem/beam/tuplet/slur ink (all scores x widths)', () => {
  let seen = 0;
  for (const [name, score, options] of SCORES) for (const width of WIDTHS) {
    const svg = renderTree(score, width, options);
    const s = resolveTheme(options.theme).staffLineSpacing;
    const layout = layoutOf(score, width, options);
    notationStaves(svg).forEach(({ g, si }) => {
      const chords = textsOf(g, 'chord-symbol');
      if (!chords.length) return;
      seen += chords.length;
      const ys = new Set(chords.map((t) => num(t, 'y')));
      ok(ys.size === 1, `${name}@${width} sys${si}: chord symbols on ${ys.size} baselines`);
      ok(num(chords[0], 'y') <= -2.5 * s + EPS, `${name}@${width} sys${si}: chord baseline ${num(chords[0], 'y')} lower than 2.5 sp above the top line`);
      const leaves = musicLeaves(g, layout.systems[si].contentStartX);
      chords.forEach((t) => {
        const size = num(t, 'font-size');
        const box = { x1: num(t, 'x'), x2: num(t, 'x') + estimateTextWidth(t._text, size, { bold: true }),
          top: num(t, 'y') - TEXT_ASCENT_EM * size, bottom: num(t, 'y') + TEXT_DESCENT_EM * size };
        leaves.forEach(({ n, b }) => ok(!overlaps(box, b), `${name}@${width} sys${si}: chord "${t._text}" overlaps a ${n.tag} (${cls(n) || 'no class'}) at ${b.x1.toFixed(1)},${b.top.toFixed(1)}`));
      });
    });
  }
  ok(seen > 0, 'no chord symbols found in the corpus');
});

test('collisions', 'dynamics: one baseline per system staff, wholly below the lowest note/stem/ledger/articulation ink of the system (all scores x widths)', () => {
  let seen = 0;
  for (const [name, score, options] of SCORES) for (const width of WIDTHS) {
    const svg = renderTree(score, width, options);
    const layout = layoutOf(score, width, options);
    notationStaves(svg).forEach(({ g, si }) => {
      const dyns = textsOf(g, 'dynamic');
      if (!dyns.length) return;
      seen += dyns.length;
      ok(new Set(dyns.map((t) => num(t, 'y'))).size === 1, `${name}@${width} sys${si}: dynamics on more than one baseline`);
      const lowest = Math.max(...musicLeaves(g, layout.systems[si].contentStartX).map(({ b }) => b.bottom));
      dyns.forEach((t) => ok(nodeBox(t).top > lowest, `${name}@${width} sys${si}: dynamic top ${nodeBox(t).top} not below the lowest ink ${lowest}`));
    });
  }
  ok(seen > 0, 'no dynamics found in the corpus');
});

test('collisions', 'lead-riff m1 "mf" clears the low ledger notes; fermata stays above the chord-symbol line', () => {
  const svg = renderTree(leadRiff, 900);
  const g = notationStaves(svg)[0].g;
  const mf = textsOf(g, 'dynamic')[0];
  const column = { ...nodeBox(mf), top: -1e9, bottom: 1e9 };
  const above = musicLeaves(g, 0).filter(({ b }) => overlaps(column, b));
  ok(above.length > 0 && above.every(({ b }) => b.bottom < nodeBox(mf).top), 'mf below every note ink in its column');
  const ferm = renderTree(oneTrack([{ beats: [q('C6', { beat: { chord: 'Cmaj7', fermata: true } }), q('E4'), q('E4'), q('E4')] }]), 900);
  const fg = notationStaves(ferm)[0].g;
  const chord = textsOf(fg, 'chord-symbol')[0];
  const fermata = byClass(fg, 'fermata', 'g')[0].n.children[0];
  ok(nodeBox(fermata).bottom <= num(chord, 'y') - TEXT_ASCENT_EM * num(chord, 'font-size') + EPS, 'fermata bottom above the chord text top');
});

test('collisions', 'slide across a system break is a short stub (<= 2.5 sp) after the fret number, before the last barline', () => {
  const m = () => ({ beats: [tabNote(3, 5), tabNote(3, 7), tabNote(3, 5), tabNote(3, 7, { slide: true })] });
  const score = { tracks: [{ showStandardNotation: false, showTablature: true, measures: Array.from({ length: 8 }, m) }] };
  const s = DEF.staffLineSpacing;
  let stubs = 0;
  for (const width of [400, 600, 900]) {
    const svg = renderTree(score, width);
    const layout = layoutOf(score, width);
    systemsOf(svg).forEach((sg, si) => {
      const sys = layout.systems[si];
      const ms = sys.tracks[0].measures;
      const lastX = ms[ms.length - 1].elements.at(-1).x;
      const tabG = staffGroups(sg)[0];
      const diag = tabG.children.filter((n) => n.tag === 'line' && num(n, 'y1') !== num(n, 'y2') && num(n, 'x1') !== num(n, 'x2'));
      const out = diag.filter((l) => num(l, 'x1') > lastX && num(l, 'x1') < lastX + s);
      if (si === layout.systems.length - 1) { ok(out.length === 0, `${width}: slide stub after the score's last note`); return; }
      ok(out.length === 1, `${width} sys${si}: ${out.length} outgoing stubs`);
      out.forEach((l) => {
        stubs++;
        const len = Math.hypot(num(l, 'x2') - num(l, 'x1'), num(l, 'y2') - num(l, 'y1'));
        ok(len <= 2.5 * s + EPS, `${width} sys${si}: stub length ${len.toFixed(2)} > 2.5 sp`);
        ok(num(l, 'x2') <= sys.lastBarlineX - 0.5 * s + EPS, `${width} sys${si}: stub reaches the last barline`);
        ok(num(l, 'y2') > num(l, 'y1'), `${width} sys${si}: fret 7 -> 5 slides down (stroke descends)`);
      });
    });
  }
  ok(stubs > 0, 'no system break with an outgoing slide');
});

test('collisions', 'barline before a repeatStart: single/double merge into the repeat-start sign; repeatEnd merges into one end-start sign', () => {
  const lineCount = (b) => b.children.filter((c) => c.tag === 'line').length;
  const dotCount = (b) => b.children.filter((c) => c.tag === 'circle').length;
  const s = DEF.staffLineSpacing;
  for (const prev of ['single', 'double']) {
    const score = { tracks: [{ showTablature: true, measures: [bar4(), { ...bar4(), barline: prev }, { ...bar4(), barline: 'repeatStart' }, bar4()] }] };
    const svg = renderTree(score, 900);
    const boundary = layoutOf(score, 900).systems[0].tracks[0].measures[1].endX;
    staffGroups(systemsOf(svg)[0]).forEach((g) => {
      const at = byClass(g, 'barline', 'g').map(({ n }) => n).filter((b) => b.children.some((c) => c.tag === 'line' && Math.abs(num(c, 'x1') - boundary) < 2.5 * s));
      ok(at.length === 1, `${prev}: ${at.length} barline signs at the m2/m3 boundary`);
      ok(lineCount(at[0]) === 2 && dotCount(at[0]) === 2, `${prev}: sign is thick+thin+dots (lines ${lineCount(at[0])}, dots ${dotCount(at[0])})`);
      ok(at[0].children.some((c) => c.tag === 'line' && num(c, 'stroke-width') > 1.5), `${prev}: has the thick line`);
    });
  }
  const score = { tracks: [{ showTablature: true, measures: [{ ...bar4(), barline: 'repeatStart' }, { ...bar4(), barline: 'repeatEnd' }, { ...bar4(), barline: 'repeatStart' }, { ...bar4(), barline: 'repeatEnd' }] }] };
  const svg = renderTree(score, 900);
  const boundary = layoutOf(score, 900).systems[0].tracks[0].measures[1].endX;
  staffGroups(systemsOf(svg)[0]).forEach((g) => {
    const at = byClass(g, 'barline', 'g').map(({ n }) => n).filter((b) => b.children.some((c) => c.tag === 'line' && Math.abs(num(c, 'x1') - boundary) < 4 * s));
    ok(at.length === 1, `end-start: ${at.length} signs at the boundary`);
    ok(lineCount(at[0]) === 3 && dotCount(at[0]) === 4, `end-start: dots-thin-thick-thin-dots (lines ${lineCount(at[0])}, dots ${dotCount(at[0])})`);
    const xs = at[0].children.filter((c) => c.tag === 'line').map((c) => [num(c, 'x1'), num(c, 'stroke-width')]).sort((a, b) => a[0] - b[0]);
    ok(xs[0][1] <= 1.5 && xs[1][1] > 1.5 && xs[2][1] <= 1.5, 'thin, thick, thin');
    const cx = at[0].children.filter((c) => c.tag === 'circle').map((c) => num(c, 'cx'));
    ok(cx.filter((x) => x < xs[0][0]).length === 2 && cx.filter((x) => x > xs[2][0]).length === 2, 'dots outside the lines, two each side');
  });
});

// ======================= harmonics =======================
// SVG-level verification of guitar harmonics (design.md section 6; status.md AC1-AC12 + Q-A..Q-D). The unit-level
// pieces (harmonicKind, normalize, fretLabel strings, layoutChord mixed-chord alignment) live in units.mjs; the
// fixtures `harmonics` (w900) and `harmonics-break` (w600) are in tests/fixtures/characterization.js. Oracles below
// are written from the spec (not by calling src/harmonics.js) so they are independent of the implementation.
const { Glyph } = await imp('src/glyphs.js');
const { fretLabelWidth } = await imp('src/textMetrics.js');
const H900 = characterizationCases.find((c) => c.name === 'harmonics');
const HBRK = characterizationCases.find((c) => c.name === 'harmonics-break');
const HFIX = [[H900, 900], [HBRK, 600]];
const DIAMOND_CPS = new Set([0xE0D8, 0xE0D9, 0xE0DB]);
const PLAIN_CPS = new Set([0xE0A2, 0xE0A3, 0xE0A4]);
const cpg = (g) => g.codePointAt(0);
const XHEAD = cpg(Glyph.noteheadXBlack);
const HK = ['natural', 'artificial', 'pinch', 'tapped', 'semi'];
const HPRIORITY = ['artificial', 'tapped', 'pinch', 'semi'];
const HLABEL = { artificial: 'A.H.', tapped: 'T.H.', pinch: 'P.H.', semi: 'S.H.' };
const hkind = (raw) => (!raw ? null : typeof raw === 'string' ? (HK.includes(raw.trim().toLowerCase()) ? raw.trim().toLowerCase() : 'natural') : 'natural');
// Expected TAB text of a raw note (spec: x / <12> / 5(17) / plain; ghost wraps in parentheses).
function expLabel(n) {
  if (n.mute) return n.ghost ? '(x)' : 'x';
  const k = hkind(n.harmonic);
  const core = k === 'natural' ? `<${n.fret}>` : ((k === 'artificial' || k === 'tapped') && Number.isInteger(n.harmonicFret) ? `${n.fret}(${n.harmonicFret})` : String(n.fret));
  return n.ghost ? `(${core})` : core;
}
const rawNotes = (track) => track.measures.flatMap((m) => m.beats.flatMap((b) => b.notes || []));
const staffOfTrack = (svg, si, ti, tab) => staffGroups(systemsOf(svg)[si]).find((g) => Number(g.getAttribute('data-track')) === ti && cls(g).includes(tab ? 'tab' : 'notation'));
const harmGroups = (root) => all(root).filter(({ n }) => n.tag === 'g' && /^harmonic harmonic-/.test(cls(n))).map(({ n }) => n);
const pmGroups = (root) => all(root).filter(({ n }) => n.tag === 'g' && cls(n) === 'palm-mute').map(({ n }) => n);
const tabLabelTexts = (stg) => stg.children.filter((n, i) => n.tag === 'text' && i > 0 && stg.children[i - 1].tag === 'rect');
const headCps = (stg) => stg.children.filter((n) => n.tag === 'text' && (DIAMOND_CPS.has(cpOf(n)) || PLAIN_CPS.has(cpOf(n)) || cpOf(n) === XHEAD));
const dashEnd = (g) => { const p = g.children.find((c) => c.tag === 'path'); return p ? Number(/L ([\d.-]+)/.exec(p.getAttribute('d'))[1]) : null; };
const mkTab = (beats, extra = {}) => ({ tracks: [{ name: 'T', showTablature: true, ...extra, measures: [{ beats }] }] });
const hq = (notes, extra = {}) => ({ type: 'note', duration: 'quarter', notes, ...extra });
const rest4 = () => ({ type: 'rest', duration: 'quarter' });

// Run oracle (Q-A, Q-B, Q-C): per track, one label kind per beat = first of A.H. > T.H. > P.H. > S.H. among non-muted
// harmonics; grace/rest/other beats end a run; runs never cross a system. Returns [{ si, ti, kind, x, bendStart, continued }].
// The label starts at the run's first beat; when that beat has a bend (TAB tracks) it may instead start further right,
// clear of the bend's ink (it used to be pinned at x + 2 sp, which collided with the amount text; placement against bend
// ink is checked by the 'technique labels clear bend ink' test), so `bendStart` runs only pin x >= the beat's x.
function labelOracle(score, width, options = {}) {
  const norm = normalizeScore(clone(score));
  const layout = layoutOf(score, width, options);
  const out = [];
  norm.tracks.forEach((track, ti) => {
    let prev = null;
    layout.systems.forEach((sys, si) => sys.tracks[ti].measures.forEach((m) => m.elements.forEach((le) => {
      const notes = le.el.type === 'grace' ? [] : (le.el.notes || []);
      const kinds = notes.filter((n) => !n.mute).map((n) => hkind(n.harmonic));
      const kind = HPRIORITY.find((k) => kinds.includes(k)) ?? null;
      if (kind && prev && prev.kind === kind && prev.si === si) return;
      const continued = !!(kind && prev && prev.kind === kind && prev.si !== si);
      prev = null;
      if (kind) {
        prev = { si, ti, kind, x: le.x, bendStart: !!track.showTablature && notes.some((n) => n.bend), continued };
        out.push(prev);
      }
    })));
  });
  return out;
}
function renderedLabels(svg, score) {
  const out = [];
  const norm = normalizeScore(clone(score));
  systemsOf(svg).forEach((sg, si) => norm.tracks.forEach((track, ti) => {
    const stg = staffOfTrack(svg, si, ti, track.showTablature);
    if (!stg) return;
    harmGroups(stg).forEach((g) => out.push({ si, ti, kind: cls(g).split('harmonic-')[1], text: g.children[0]._text, x: num(g.children[0], 'x'), y: num(g.children[0], 'y') }));
  }));
  return out;
}

test('harmonics', 'AC1: rendering every pre-existing fixture/example emits no diamond glyph, no harmonic group, no <n> TAB label, no A.H./T.H./P.H./S.H. text', () => {
  let checked = 0;
  for (const [name, score, options] of SCORES) {
    if (name.startsWith('char-harmonics')) continue;
    for (const width of [600, 900]) {
      const svg = renderTree(score, width, options);
      all(svg).forEach(({ n }) => {
        if (n.tag === 'text') {
          ok(!DIAMOND_CPS.has(cpOf(n)), `${name}@${width}: diamond glyph U+${cpOf(n).toString(16)}`);
          ok(!/[<>]/.test(n._text), `${name}@${width}: "<n>" style TAB label "${n._text}"`);
          ok(!/^[ATPS]\.H\.$/.test(n._text), `${name}@${width}: harmonic label text "${n._text}"`);
        }
        ok(!/^harmonic/.test(cls(n)), `${name}@${width}: harmonic class group "${cls(n)}"`);
      });
      checked++;
    }
  }
  ok(checked >= 10, `only ${checked} renders checked`);
  ok(pmGroups(renderTree(characterizationCases.find((c) => c.name === 'technique-lane').score, 600)).length >= 3, 'palm-mute groups keep the class "palm-mute"');
});

test('harmonics', 'AC2: diamond code point per duration (whole E0D8, half E0D9, quarter/8th/16th E0DB); same notes without harmonic keep E0A2/E0A3/E0A4', () => {
  const cases = [['whole', Glyph.noteheadDiamondWhole, Glyph.noteheadWhole, 0xE0D8, 0xE0A2], ['half', Glyph.noteheadDiamondHalf, Glyph.noteheadHalf, 0xE0D9, 0xE0A3],
    ['quarter', Glyph.noteheadDiamondBlack, Glyph.noteheadBlack, 0xE0DB, 0xE0A4], ['8th', Glyph.noteheadDiamondBlack, Glyph.noteheadBlack, 0xE0DB, 0xE0A4], ['16th', Glyph.noteheadDiamondBlack, Glyph.noteheadBlack, 0xE0DB, 0xE0A4]];
  for (const [dur, dia, plain, diaCp, plainCp] of cases) {
    ok(cpg(dia) === diaCp && cpg(plain) === plainCp, `${dur}: Glyph constants`);
    const mk = (harmonic) => mkTab([{ type: 'note', duration: dur, notes: [{ string: 3, fret: 12, ...(harmonic ? { harmonic: true } : {}) }] }]);
    const hs = headCps(staffOfTrack(renderTree(mk(true), 900), 0, 0, false));
    ok(hs.length === 1 && cpOf(hs[0]) === diaCp, `${dur}: harmonic head ${hs.map(cpOf)}`);
    const ps = headCps(staffOfTrack(renderTree(mk(false), 900), 0, 0, false));
    ok(ps.length === 1 && cpOf(ps[0]) === plainCp, `${dur}: plain head ${ps.map(cpOf)}`);
  }
  // every harmonic kind other than natural keeps the normal head
  for (const h of [{ harmonic: 'artificial', harmonicFret: 17 }, { harmonic: 'pinch' }, { harmonic: 'tapped', harmonicFret: 17 }, { harmonic: 'semi' }]) {
    const hs = headCps(staffOfTrack(renderTree(mkTab([hq([{ string: 3, fret: 5, ...h }])]), 900), 0, 0, false));
    ok(hs.length === 1 && cpOf(hs[0]) === 0xE0A4, `${h.harmonic}: keeps the normal head`);
  }
});

test('harmonics', 'AC2: diamond count = natural, non-muted notes (incl. grace, ghost, bend, slide) per notation track; TAB <n> label count equals the same', () => {
  for (const [fx, width] of HFIX) {
    const svg = renderTree(fx.score, width, fx.options || {});
    fx.score.tracks.forEach((track, ti) => {
      const want = rawNotes(track).filter((n) => hkind(n.harmonic) === 'natural' && !n.mute).length;
      const mutes = rawNotes(track).filter((n) => n.mute).length;
      let dia = 0; let xs = 0; let tabNat = 0;
      systemsOf(svg).forEach((_, si) => {
        const nst = staffOfTrack(svg, si, ti, false);
        if (nst) { dia += headCps(nst).filter((t) => DIAMOND_CPS.has(cpOf(t))).length; xs += headCps(nst).filter((t) => cpOf(t) === XHEAD).length; }
        const tst = staffOfTrack(svg, si, ti, true);
        if (tst) tabNat += all(tst).filter(({ n }) => n.tag === 'text' && /<\d+>/.test(n._text)).length;
      });
      if (track.showStandardNotation !== false) { ok(dia === want, `${fx.name} track ${ti}: ${dia} diamonds, expected ${want}`); ok(xs === mutes, `${fx.name} track ${ti}: ${xs} x heads, expected ${mutes}`); }
      else ok(dia === 0, `${fx.name} track ${ti}: TAB-only track has diamonds`);
      if (track.showTablature) ok(tabNat === want, `${fx.name} track ${ti}: ${tabNat} <n> labels, expected ${want}`);
      ok(want > 0, `${fx.name} track ${ti}: fixture has no natural harmonics`);
    });
  }
  const t0 = rawNotes(H900.score.tracks[0]);
  ok(t0.some((n) => n.mute && n.harmonic) && t0.some((n) => n.ghost && hkind(n.harmonic) === 'natural') && H900.score.tracks[0].measures.some((m) => m.beats.some((b) => b.type === 'grace')), 'fixture covers mute+harmonic, ghost natural and a grace natural');
});

// stems of a notation staff group: vertical lines of stem width that are direct children of the staff
const stemsOf = (stg) => stg.children.filter((c) => c.tag === 'line' && c.getAttribute('x1') === c.getAttribute('x2') && num(c, 'stroke-width') === DEF.stemWidth);
function stemFor(stg, head) {
  const hx = num(head, 'x'); const hy = num(head, 'y');
  const c = stemsOf(stg).filter((l) => Math.abs(num(l, 'x1') - hx) < 8 && (Math.abs(num(l, 'y1') - hy) < EPS || Math.abs(num(l, 'y2') - hy) < EPS));
  ok(c.length === 1, `head at (${hx},${hy}): ${c.length} stems with the base on the head`);
  const l = c[0]; const baseIsY1 = Math.abs(num(l, 'y1') - hy) < EPS;
  return { x: num(l, 'x1'), baseY: baseIsY1 ? num(l, 'y1') : num(l, 'y2'), farY: baseIsY1 ? num(l, 'y2') : num(l, 'y1') };
}

test('harmonics', 'AC2/AC3: single diamond quarter: stem x = head x +0.5 sp (stem up) / -0.5 sp (stem down), stem base y = head y', () => {
  const sp = DEF.staffLineSpacing;
  const beats = [6, 5, 4, 3, 2, 1, 6, 1].map((s) => hq([{ string: s, fret: 12, harmonic: true }]));
  const svg = renderTree({ tracks: [{ showTablature: true, measures: [{ beats: beats.slice(0, 4) }, { beats: beats.slice(4) }] }] }, 1400);
  let up = 0; let down = 0;
  systemsOf(svg).forEach((_, si) => {
    const stg = staffOfTrack(svg, si, 0, false);
    headCps(stg).forEach((h) => {
      ok(cpOf(h) === 0xE0DB, 'quarter diamond');
      const st = stemFor(stg, h);
      const isUp = st.farY < st.baseY;
      near(st.x - num(h, 'x'), (isUp ? 1 : -1) * 0.5 * sp, 0.06, `stem ${isUp ? 'up' : 'down'} offset from the head x`);
      near(st.baseY, num(h, 'y'), EPS, 'stem base y = head y');
      if (isUp) up++; else down++;
    });
  });
  ok(up > 0 && down > 0, `need both stem directions (up ${up}, down ${down})`);
});

test('harmonics', 'AC2/AC3: beamed diamond groups: every stem sits on the head (base y) and ends on a beam vertex (stem x within the beam x-span)', () => {
  const sp = DEF.staffLineSpacing;
  const e8h = (s) => ({ type: 'note', duration: '8th', notes: [{ string: s, fret: 12, harmonic: true }] });
  const m = (a) => ({ beats: a.map(e8h) });
  const svg = renderTree({ tracks: [{ showTablature: true, measures: [m([1, 2, 3, 4, 2, 3, 1, 2]), m([6, 5, 4, 3, 5, 6, 2, 1])] }] }, 1400);
  let stems = 0; let sloped = 0;
  systemsOf(svg).forEach((_, si) => {
    const stg = staffOfTrack(svg, si, 0, false);
    const beams = stg.children.filter((x) => x.tag === 'path' && !cls(x) && / Z$/.test(x.getAttribute('d') || '')).map((x) => x.getAttribute('d').match(/-?[\d.]+/g).map(Number));
    ok(beams.length > 0, `${beams.length} beams`);
    headCps(stg).forEach((h) => {
      ok(cpOf(h) === 0xE0DB, 'beamed diamond');
      const st = stemFor(stg, h);
      near(Math.abs(st.x - num(h, 'x')), 0.5 * sp, 0.06, 'beamed stem offset');
      const b = beams.find((p) => st.x >= p[0] - EPS && st.x <= p[2] + EPS);
      ok(!!b, `stem x ${st.x} is under no beam`);
      // the stem ends on the beam's outer-edge vertex at its own end of the beam (left stem -> first vertex, right stem -> second)
      const left = Math.abs(st.x - b[0]) < Math.abs(st.x - b[2]);
      near(st.farY, left ? b[1] : b[3], EPS, `stem far end on the beam vertex (${left ? 'left' : 'right'}); beam ${b.slice(0, 4)}`);
      if (b[1] !== b[3]) sloped++;
      stems++;
    });
  });
  ok(stems === 16, `${stems} beamed stems`);
  ok(sloped > 0, 'at least one sloped beam in the sample');
});

test('harmonics', 'AC3: TAB knock-out rect behind every fret label is fretLabelWidth(label) wide and centred on the label (harmonics fixtures)', () => {
  let checked = 0; let wide = 0;
  for (const [fx, width] of HFIX) {
    const svg = renderTree(fx.score, width, fx.options || {});
    all(svg).forEach(({ n, parents }) => {
      if (n.tag !== 'text' || !/^\(?(<\d+>|\d+\(\d+\)|\d+|x)\)?$/.test(n._text)) return;
      const par = parents[parents.length - 1];
      if (!cls(par).includes('staff-tab')) return;
      const prev = par.children[par.children.indexOf(n) - 1];
      if (!prev || prev.tag !== 'rect') return;
      near(num(prev, 'width'), fretLabelWidth(n._text, DEF), EPS, `${fx.name} "${n._text}" knock-out width`);
      near(num(prev, 'x') + num(prev, 'width') / 2, num(n, 'x'), EPS, `${fx.name} "${n._text}" knock-out centre`);
      checked++; if (/[<(]/.test(n._text)) wide++;
    });
  }
  ok(checked > 60 && wide > 20, `only ${checked} labels (${wide} decorated) checked`);
  ok(fretLabelWidth('<12>', DEF) > fretLabelWidth('12', DEF) && fretLabelWidth('5(17)', DEF) > fretLabelWidth('5', DEF), 'decorated labels are wider than plain ones');
});

test('harmonics', 'AC4/AC5: TAB label texts match the spec table per track (<12>, 5(17), plain 5, (<12>), (5(17)), x); natural has no text label; no g.harmonic-natural', () => {
  for (const [fx, width] of HFIX) {
    const svg = renderTree(fx.score, width, fx.options || {});
    fx.score.tracks.forEach((track, ti) => {
      if (!track.showTablature) return;
      const got = []; const want = rawNotes(track).filter((n) => n.string != null).map(expLabel);
      systemsOf(svg).forEach((_, si) => got.push(...tabLabelTexts(staffOfTrack(svg, si, ti, true)).map((t) => t._text)));
      ok(JSON.stringify([...got].sort()) === JSON.stringify([...want].sort()), `${fx.name} track ${ti}: TAB labels differ\n got  ${[...got].sort()}\n want ${[...want].sort()}`);
    });
    ok(harmGroups(svg).every((g) => !cls(g).endsWith('natural')), 'no natural label group');
    all(svg).forEach(({ n }) => { if (n.tag === 'text') ok(!/^(N\.H\.|Harm\.?)$/i.test(n._text), 'natural harmonic text label'); });
  }
  const labels = new Set(rawNotes(H900.score.tracks[0]).map(expLabel));
  ['<12>', '5(17)', '5', '2(14)', '(<12>)', '(5(17))', 'x'].forEach((l) => ok(labels.has(l), `fixture lacks label ${l}`));
  // artificial / tapped without harmonicFret or with a non-integer one, pinch / semi even with one: plain fret
  const svg = renderTree(mkTab([hq([{ string: 3, fret: 5, harmonic: 'artificial' }]), hq([{ string: 3, fret: 5, harmonic: 'tapped', harmonicFret: 17.5 }]), hq([{ string: 3, fret: 5, harmonic: 'pinch', harmonicFret: 17 }]), hq([{ string: 3, fret: 5, harmonic: 'semi', harmonicFret: 17 }])]), 1400);
  ok(JSON.stringify(tabLabelTexts(staffOfTrack(svg, 0, 0, true)).map((t) => t._text)) === '["5","5","5","5"]', 'plain fret for artificial without / non-integer harmonicFret and for pinch/semi');
});

test('harmonics', 'AC4/AC6: g.harmonic.harmonic-<kind> counts (pinned) and every label matches the run oracle (kind, system, start x) in both fixtures', () => {
  const want = { artificial: 6, pinch: 3, tapped: 1, semi: 2 };
  const kinds = {};
  harmGroups(renderTree(H900.score, 900)).forEach((g) => { const k = cls(g).split('harmonic-')[1]; kinds[k] = (kinds[k] || 0) + 1; ok(g.children[0]._text === HLABEL[k], `label text ${g.children[0]._text} for ${k}`); });
  ok(Object.keys(kinds).length === 4 && Object.keys(want).every((k) => kinds[k] === want[k]), `kind counts ${JSON.stringify(kinds)} vs ${JSON.stringify(want)}`);
  let continuedRuns = 0;
  for (const [fx, width] of HFIX) {
    const svg = renderTree(fx.score, width, fx.options || {});
    const exp = labelOracle(fx.score, width, fx.options || {}).sort((a, b) => a.si - b.si || a.ti - b.ti || a.x - b.x);
    const got = renderedLabels(svg, fx.score).sort((a, b) => a.si - b.si || a.ti - b.ti || a.x - b.x);
    ok(exp.length === got.length && exp.length > 0, `${fx.name}: ${got.length} label groups, oracle ${exp.length}\n got ${got.map((g) => `${g.si}/${g.ti}/${g.kind}@${g.x}`)}\n exp ${exp.map((g) => `${g.si}/${g.ti}/${g.kind}@${g.x}`)}`);
    exp.forEach((e, i) => {
      ok(e.si === got[i].si && e.ti === got[i].ti && e.kind === got[i].kind, `${fx.name} label ${i}: ${got[i].si}/${got[i].ti}/${got[i].kind} vs ${e.si}/${e.ti}/${e.kind}`);
      if (e.bendStart) ok(got[i].x >= e.x - EPS, `${fx.name} label ${i} start x ${got[i].x} before its bent first beat ${e.x}`);
      else near(got[i].x, e.x, EPS, `${fx.name} label ${i} start x`);
      if (e.continued) continuedRuns++;
    });
  }
  ok(continuedRuns >= 2, `${continuedRuns} runs continue across a system break (expected >= 2: the label restarts in the next system)`);
});

test('harmonics', 'AC6: every label run (harmonic and P.M.) ends at or before the last barline - 0.5 sp of its system', () => {
  let checked = 0;
  for (const [fx, width] of HFIX) {
    const svg = renderTree(fx.score, width, fx.options || {});
    const layout = layoutOf(fx.score, width, fx.options || {});
    const sp = DEF.staffLineSpacing;
    systemsOf(svg).forEach((_, si) => fx.score.tracks.forEach((track, ti) => {
      const stg = staffOfTrack(svg, si, ti, !!track.showTablature);
      if (!stg) return;
      [...harmGroups(stg), ...pmGroups(stg)].forEach((g) => {
        const e = dashEnd(g);
        if (e == null) return;
        ok(e <= layout.systems[si].lastBarlineX - 0.5 * sp + EPS, `${fx.name} sys${si} ${cls(g)}: dash end ${e} beyond last barline ${layout.systems[si].lastBarlineX} - 0.5 sp`);
        checked++;
      });
    }));
  }
  ok(checked > 10, `only ${checked} runs checked`);
});

// Ink boxes of every bend drawn in staff group `stg` (local coordinates): one per primitive — <rect> knock-outs behind the
// amount text / landing fret (`text: true`), and the control-point hull of each <path> (rise, release, hold dash, arrowheads).
function bendInk(stg) {
  const out = [];
  all(stg).filter(({ n }) => n.tag === 'g' && cls(n) === 'bend').forEach(({ n: g }) => g.children.forEach((c) => {
    if (c.tag === 'rect') out.push({ x1: num(c, 'x'), x2: num(c, 'x') + num(c, 'width'), top: num(c, 'y'), bottom: num(c, 'y') + num(c, 'height'), text: true });
    else if (c.tag === 'path') {
      const v = (c.getAttribute('d').match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
      const xs = v.filter((_, i) => i % 2 === 0); const ys = v.filter((_, i) => i % 2 === 1);
      out.push({ x1: Math.min(...xs), x2: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys), text: false });
    }
  }));
  return out;
}
// Label text box (estimated width, ink.js ascent/descent 0.8 / 0.25 em) and dash+tick box of a technique-label group.
function labelInk(g) {
  const t = g.children[0]; const fs = num(t, 'font-size'); const x = num(t, 'x'); const y = num(t, 'y');
  const text = { x1: x, x2: x + estimateTextWidth(t._text, fs, { bold: true }), top: y - 0.8 * fs, bottom: y + 0.25 * fs };
  const p = g.children.find((c) => c.tag === 'path'); const tick = g.children.find((c) => c.tag === 'line');
  let dash = null;
  if (p) {
    const [x1, y1, x2] = p.getAttribute('d').match(/-?\d+(?:\.\d+)?/g).map(Number);
    dash = { x1, x2, top: Math.min(y1, num(tick, 'y1')), bottom: Math.max(y1, num(tick, 'y2')) };
  }
  return { text, dash };
}
const boxesHit = (a, b) => a.x1 < b.x2 && b.x1 < a.x2 && a.top < b.bottom && b.top < a.bottom;

test('harmonics', 'AC6/AC7: label lanes: P.M. at TAB top - 0.6 sp (notation-only: bottom line + 3.3 sp); harmonic same lane, or one lane step further out (-1.5 sp / +1.5 sp) iff it overlaps a P.M. run', () => {
  const sp = DEF.staffLineSpacing;
  const size = Math.max(0.9 * sp, DEF.tabFontSize - 0.1 * sp);
  const step = size + 0.4 * sp;
  ok(Math.abs(step - 1.5 * sp) < EPS, 'default lane step is 1.5 sp');
  const stats = new Map();
  for (const [fx, width] of HFIX) {
    const svg = renderTree(fx.score, width, fx.options || {});
    systemsOf(svg).forEach((_, si) => fx.score.tracks.forEach((track, ti) => {
      const tab = !!track.showTablature;
      const stg = staffOfTrack(svg, si, ti, tab);
      if (!stg) return;
      const info = staffInfo(stg);
      const pmY = tab ? info.localTop - 0.6 * sp : info.localBottom + 3.3 * sp;
      const outward = tab ? -1 : 1;
      const ext = (g) => { const t = g.children[0]; const e = dashEnd(g); return { x1: num(t, 'x'), x2: Math.max(e ?? -Infinity, num(t, 'x') + estimateTextWidth(t._text, num(t, 'font-size'), { bold: true })) }; };
      // Lane index of a label group (integer >= 0). A run is only moved out past its nearest allowed lane when bend ink lies
      // over its extent (see the 'technique labels clear bend ink' test); without one it keeps the lane rule exactly.
      const laneOf = (g) => (num(g.children[0], 'y') - pmY) / (outward * step);
      const bends = bendInk(stg);
      const nearBend = (e) => bends.some((b) => e.x1 < b.x2 + sp && b.x1 < e.x2 + sp);
      const pms = pmGroups(stg);
      const pmE = pms.map((g) => ({ ...ext(g), lane: laneOf(g) }));
      pmE.forEach((p) => {
        ok(Math.abs(p.lane - Math.round(p.lane)) < EPS / step && p.lane > -EPS, `${fx.name} sys${si} t${ti} P.M. lane ${p.lane}`);
        if (!nearBend(p)) near(p.lane * step, 0, EPS, `${fx.name} sys${si} t${ti} P.M. baseline`);
      });
      harmGroups(stg).forEach((g) => {
        const e = ext(g);
        const over = pmE.filter((p) => e.x1 < p.x2 + 0.5 * sp && p.x1 < e.x2 + 0.5 * sp);
        const overlap = over.length > 0;
        const minLane = overlap ? Math.max(...over.map((p) => Math.round(p.lane))) + 1 : 0;
        const lane = laneOf(g);
        ok(Math.abs(lane - Math.round(lane)) < EPS / step && lane >= minLane - EPS / step, `${fx.name} sys${si} t${ti} ${cls(g)} lane ${lane} (min ${minLane}, overlap ${overlap})`);
        if (!nearBend(e)) near(num(g.children[0], 'y'), pmY + outward * minLane * step, EPS, `${fx.name} sys${si} t${ti} ${cls(g)} baseline (overlap ${overlap})`);
        const key = `${fx.name}:${ti}:${overlap}`; stats.set(key, (stats.get(key) || 0) + 1);
      });
    }));
  }
  // the fixtures exercise stacked and unstacked labels on a TAB+notation track, the notation-only track and the TAB-only track
  ['harmonics:0:true', 'harmonics:0:false', 'harmonics:1:true', 'harmonics:1:false', 'harmonics:2:true', 'harmonics:2:false', 'harmonics-break:0:true', 'harmonics-break:0:false']
    .forEach((k) => ok(stats.get(k) > 0, `lane case ${k} not exercised (${[...stats]})`));
  // literal pins on the notation-only track (bottom line y = 40): P.M. 73, stacked P.H. 88, unstacked S.H. 73
  const svg = renderTree(H900.score, 900);
  const nst = staffOfTrack(svg, 0, 1, false);
  near(staffInfo(nst).localBottom, 40, EPS, 'notation bottom line');
  ok(harmGroups(nst).map((g) => `${g.children[0]._text}@${num(g.children[0], 'y')}`).join() === 'P.H.@88,S.H.@73', 'notation-only lanes');
  ok(pmGroups(nst).every((g) => num(g.children[0], 'y') === 73), 'notation-only P.M. lane');
});

test('harmonics', 'AC7: harmonic labels are inside their staff ink and staves never overlap (ink checks on the harmonics fixtures)', () => {
  for (const [fx, width] of HFIX) {
    const svg = renderTree(fx.score, width, fx.options || {});
    const flat = [];
    systemsOf(svg).forEach((sg) => staffGroups(sg).forEach((g) => flat.push(staffInfo(g))));
    for (let i = 0; i < flat.length; i++) {
      const st = flat[i]; const ink = inkBounds(st.g, DEF);
      harmGroups(st.g).forEach((g) => {
        const t = g.children[0]; const size = num(t, 'font-size'); const y = num(t, 'y');
        if (st.kind === 'tab') ok(ink.top <= y - TEXT_ASCENT_EM * size + EPS, `${fx.name}: label above the TAB staff is not in its ink (${ink.top} vs ${y})`);
        else ok(ink.bottom >= y - EPS, `${fx.name}: label below the notation staff is not in its ink`);
      });
      if (i > 0) { const a = flat[i - 1]; ok(a.y + Math.max(inkBounds(a.g, DEF).bottom, a.localBottom) < st.y + Math.min(ink.top, 0), `${fx.name}: ink overlap between staves ${i - 1}/${i}`); }
    }
  }
});

test('harmonics', 'AC8: mixed chords: only the harmonic notes get diamonds (whole/quarter), plain notes keep normal heads; all-harmonic and all-plain chords are uniform', () => {
  const headsOf = (beat) => headCps(staffOfTrack(renderTree(mkTab([beat]), 1400), 0, 0, false)).map(cpOf).sort();
  const N = (s, f, h) => ({ string: s, fret: f, ...(h ? { harmonic: true } : {}) });
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  ok(eq(headsOf(hq([N(5, 7), N(4, 3, true)])), [0xE0A4, 0xE0DB]), 'quarter: plain + natural');
  ok(eq(headsOf(hq([N(5, 7, true), N(4, 3)])), [0xE0A4, 0xE0DB]), 'quarter: natural + plain (other order)');
  ok(eq(headsOf(hq([N(3, 4, true), N(2, 1)])), [0xE0A4, 0xE0DB]), 'quarter chord with a second');
  ok(eq(headsOf({ type: 'note', duration: 'whole', notes: [N(3, 4), N(2, 1, true)] }), [0xE0A2, 0xE0D8]), 'whole: plain + natural');
  ok(eq(headsOf(hq([N(5, 7, true), N(4, 3, true), N(3, 2, true)])), [0xE0DB, 0xE0DB, 0xE0DB]), 'all natural');
  ok(eq(headsOf(hq([N(5, 7), N(4, 3), N(3, 2)])), [0xE0A4, 0xE0A4, 0xE0A4]), 'all plain');
  ok(eq(headsOf(hq([{ string: 5, fret: 7, harmonic: 'artificial', harmonicFret: 19 }, N(4, 3, true)])), [0xE0A4, 0xE0DB]), 'artificial + natural in a chord');
  const svg = renderTree(mkTab([hq([N(5, 7), N(4, 3, true)])]), 1400);
  ok(stemsOf(staffOfTrack(svg, 0, 0, false)).length === 1, 'one stem for a mixed chord');
});

test('harmonics', 'AC8: label priority per beat A.H. > T.H. > P.H. > S.H.; natural carries no label; muted harmonics do not count', () => {
  const A = { harmonic: 'artificial', harmonicFret: 17 }; const T = { harmonic: 'tapped', harmonicFret: 17 }; const P = { harmonic: 'pinch' }; const S = { harmonic: 'semi' };
  const Nn = { harmonic: true }; const M = { mute: true };
  const mk = (...ns) => hq(ns.map((x, i) => ({ string: 6 - i, fret: 5, ...x })));
  const beats = [
    mk(A, P), mk(T, P), mk(P, S), mk(T, A),                                   // measure 1: A.H., T.H., P.H., A.H.
    mk(Nn, S), mk(A, S), mk({ ...P, ...M }), mk({ ...A, ...M }, P),            // measure 2: S.H., A.H., (none), P.H.
  ];
  const svg = renderTree({ tracks: [{ showTablature: true, measures: [{ beats: beats.slice(0, 4) }, { beats: beats.slice(4) }] }] }, 1600);
  ok(systemsOf(svg).length === 1, 'single system');
  const got = harmGroups(svg).map((g) => g.children[0]._text);
  ok(JSON.stringify(got) === JSON.stringify(['A.H.', 'T.H.', 'P.H.', 'A.H.', 'S.H.', 'A.H.', 'P.H.']), `labels ${got}`);
  ok(harmGroups(renderTree(mkTab([mk(Nn), mk({ ...Nn, ...M }), mk({ ...P, ...M })]), 1600)).length === 0, 'natural / muted harmonics add no label run');
  // a muted harmonic after an A.H. beat does not extend its run (it ends 0.6 sp before the next beat = the muted one)
  const beats2 = [hq([{ string: 3, fret: 5, ...A }]), hq([{ string: 3, fret: 5, ...A }]), hq([{ string: 3, fret: 5, ...A, ...M }]), rest4()];
  const svg2 = renderTree(mkTab(beats2), 1400);
  const xs = layoutOf(mkTab(beats2), 1400).systems[0].tracks[0].measures[0].elements.map((e) => e.x);
  const gs = harmGroups(svg2);
  ok(gs.length === 1, `${gs.length} A.H. groups with a muted A.H. neighbour`);
  near(dashEnd(gs[0]), xs[2] - 0.6 * DEF.staffLineSpacing, EPS, 'A.H. run (2 beats) stops before the muted beat');
});

test('harmonics', 'AC10: mute+harmonic: x head and "x" label (also "(x)" with ghost); no diamond, no label run', () => {
  const svg = renderTree(H900.score, 900);
  const texts = systemsOf(svg).flatMap((_, si) => tabLabelTexts(staffOfTrack(svg, si, 0, true)).map((t) => t._text));
  ok(texts.includes('x'), 'x label drawn for the muted natural in the fixture');
  const m = renderTree(mkTab([hq([{ string: 3, fret: 12, harmonic: true, mute: true }]), hq([{ string: 3, fret: 12, harmonic: true, mute: true, ghost: true }]), hq([{ string: 3, fret: 7, harmonic: 'artificial', harmonicFret: 19, mute: true }])]), 1400);
  ok(JSON.stringify(headCps(staffOfTrack(m, 0, 0, false)).map(cpOf)) === JSON.stringify([XHEAD, XHEAD, XHEAD]), 'all x heads');
  ok(JSON.stringify(tabLabelTexts(staffOfTrack(m, 0, 0, true)).map((t) => t._text)) === '["x","(x)","x"]', 'x labels');
  ok(harmGroups(m).length === 0, 'muted harmonics draw no label run');
});

test('harmonics', 'AC10: ghost harmonics: "(<12>)" and "(5(17))", diamond only for the natural one', () => {
  const m = renderTree(mkTab([hq([{ string: 1, fret: 12, harmonic: true, ghost: true }]), hq([{ string: 2, fret: 5, harmonic: 'artificial', harmonicFret: 17, ghost: true }])]), 1400);
  ok(JSON.stringify(tabLabelTexts(staffOfTrack(m, 0, 0, true)).map((t) => t._text)) === '["(<12>)","(5(17))"]', 'ghost labels');
  ok(JSON.stringify(headCps(staffOfTrack(m, 0, 0, false)).map(cpOf)) === JSON.stringify([0xE0DB, 0xE0A4]), 'ghost natural has a diamond, ghost artificial a normal head');
  ok(harmGroups(m).length === 1 && harmGroups(m)[0].children[0]._text === 'A.H.', 'A.H. label for the ghost artificial');
});

test('harmonics', 'AC10: bend landing fret "(n)": absent on a natural harmonic, present on artificial and plain notes', () => {
  const landingIn = (svg) => systemsOf(svg).flatMap((_, si) => all(staffOfTrack(svg, si, 0, true)).filter(({ n }) => n.tag === 'text' && /^\(\d+\)$/.test(n._text)).map(({ n }) => n._text));
  const bend = { bend: 'full' };
  const one = (note) => renderTree(mkTab([hq([{ string: 3, ...note, ...bend }]), rest4(), rest4(), rest4()]), 1400);
  ok(landingIn(one({ fret: 12, harmonic: true })).length === 0, `natural bend landing ${landingIn(one({ fret: 12, harmonic: true }))}`);
  ok(landingIn(one({ fret: 12 })).join() === '(14)', `plain landing ${landingIn(one({ fret: 12 }))}`);
  ok(landingIn(one({ fret: 7, harmonic: 'artificial', harmonicFret: 19 })).join() === '(9)', 'artificial landing');
  ok(landingIn(renderTree(H900.score, 900)).join() === '(9)', `fixture landing frets ${landingIn(renderTree(H900.score, 900))}`);
  ok(landingIn(renderTree(HBRK.score, 600)).length === 0, 'natural half bend before a barline: no landing fret');
});

test('harmonics', 'AC10: slide strokes clear a decorated label: start >= x + halfLabel + 0.2 sp, end <= x - halfLabel - 0.2 sp, across breaks too', () => {
  const sp = DEF.staffLineSpacing;
  let outs = 0; let ins = 0; let stubs = 0;
  for (const [fx, width] of HFIX) {
    const svg = renderTree(fx.score, width, fx.options || {});
    const layout = layoutOf(fx.score, width, fx.options || {});
    fx.score.tracks.forEach((track, ti) => {
      if (!track.showTablature) return;
      const seq = [];
      layout.systems.forEach((sys, si) => sys.tracks[ti].measures.forEach((m) => m.elements.forEach((le) => (le.el.notes || []).forEach((n) => { if (n.string != null) seq.push({ si, x: le.x, n }); }))));
      seq.forEach((it, i) => {
        if (!it.n.slide) return;
        const tgt = seq.slice(i + 1).find((c) => c.n.string === it.n.string);
        const stg = staffOfTrack(svg, it.si, ti, true);
        const ys = stg.children.find((c) => /tab-lines/.test(cls(c))).children.map((l) => num(l, 'y1')).sort((a, b) => a - b); // string 1 = top line
        const sy = ys[it.n.string - 1];
        const diag = stg.children.filter((l) => l.tag === 'line' && num(l, 'y1') !== num(l, 'y2') && num(l, 'x1') !== num(l, 'x2') && Math.abs((num(l, 'y1') + num(l, 'y2')) / 2 - sy) < 0.05);
        const half = (note) => fretLabelWidth(expLabel(note), DEF) / 2;
        const out = diag.filter((l) => num(l, 'x1') >= it.x - EPS && num(l, 'x1') < it.x + 10 * sp).sort((a, b) => num(a, 'x1') - num(b, 'x1'))[0];
        ok(!!out, `${fx.name} sys${it.si}: no slide stroke leaves x=${it.x}`);
        const dec = /[<(]/.test(expLabel(it.n));
        ok(num(out, 'x1') >= it.x + (dec ? half(it.n) + 0.2 * sp : 0.7 * sp) - EPS, `${fx.name} sys${it.si} "${expLabel(it.n)}": slide starts ${num(out, 'x1') - it.x} from the note, label half ${half(it.n)}`);
        if (dec) outs++;
        if (!tgt) return;
        if (tgt.si !== it.si) { stubs++; ok(num(out, 'x2') <= layout.systems[it.si].lastBarlineX - 0.5 * sp + EPS, `${fx.name}: stub reaches the last barline`); return; }
        const inc = diag.filter((l) => num(l, 'x2') <= tgt.x + EPS && num(l, 'x2') > tgt.x - 10 * sp && num(l, 'x1') >= it.x - EPS).sort((a, b) => num(b, 'x2') - num(a, 'x2'))[0];
        ok(!!inc, `${fx.name}: no slide stroke arrives at x=${tgt.x}`);
        const decT = /[<(]/.test(expLabel(tgt.n));
        ok(num(inc, 'x2') <= tgt.x - (decT ? half(tgt.n) + 0.2 * sp : 0.7 * sp) + EPS, `${fx.name} sys${it.si} target "${expLabel(tgt.n)}": slide ends ${tgt.x - num(inc, 'x2')} before the note, label half ${half(tgt.n)}`);
        if (decT) ins++;
      });
    });
  }
  ok(outs >= 2 && ins >= 1 && stubs >= 1, `slide cases not exercised: out ${outs}, in ${ins}, break stubs ${stubs}`);
});

// Regression (acceptance fix): a label run starting on, or running over, a bent note used to start its label at x + 2 sp
// regardless of the bend, so the label text sat on the bend's arrow / amount text ("A.H." over "Full").
const BEND_LABEL_CASES = (() => {
  const pm = (string, fret, extra = {}, beat = {}) => hq([{ string, fret, ...extra }], { palmMute: true, ...beat });
  const ah = { harmonic: 'artificial', harmonicFret: 19 };
  return [
    ['bend mid-run', mkTab([pm(2, 5), pm(2, 5), pm(1, 7, { bend: 'full' }), pm(2, 5)])],
    ['bend on a one-beat run', mkTab([pm(1, 7, { bend: 'full' }), q('E4'), rest4(), rest4()])],
    ['bend first, long run', mkTab([pm(2, 7, { bend: '1/2' }), pm(2, 7), pm(2, 5), pm(2, 5)])],
    ['release / hold', mkTab([pm(1, 7, { bend: 'full release' }), pm(1, 7, { bend: 'full hold' }), pm(1, 7, { bend: 'full' }), rest4()])],
    ['low-string bend', mkTab([pm(6, 3, { bend: '1/4' }), pm(6, 3), pm(5, 5), pm(5, 5)])],
    ['P.M. + A.H. on a bend', mkTab([pm(1, 7, { ...ah, bend: 'full' }), pm(1, 7, ah), rest4(), rest4()])],
    ['A.H. on a bend, short', mkTab([hq([{ string: 2, fret: 7, ...ah, bend: 'full' }]), hq([{ string: 2, fret: 10 }]), rest4(), rest4()])],
  ];
})();

test('harmonics', 'technique labels clear bend ink: every P.M./harmonic label text misses every bend piece and its dash misses every bend amount text / landing fret (all scores x widths + bend cases)', () => {
  let nearBends = 0; let runs = 0;
  const renders = [];
  for (const [name, score, options] of SCORES) for (const width of WIDTHS) renders.push([`${name}@${width}`, () => renderTree(score, width, options)]);
  for (const [name, score] of BEND_LABEL_CASES) for (const width of [600, 900]) renders.push([`${name}@${width}`, () => renderTree(score, width)]);
  for (const [name, render] of renders) {
    const svg = render();
    systemsOf(svg).forEach((sg, si) => staffGroups(sg).forEach((stg) => {
      const bends = bendInk(stg);
      [...pmGroups(stg), ...harmGroups(stg)].forEach((g) => {
        runs++;
        const { text, dash } = labelInk(g);
        const ext = { x1: text.x1, x2: Math.max(text.x2, dash ? dash.x2 : -Infinity) };
        if (bends.some((b) => ext.x1 < b.x2 && b.x1 < ext.x2)) nearBends++;
        bends.forEach((b) => {
          ok(!boxesHit(text, b), `${name} sys${si} "${g.children[0]._text}" text ${JSON.stringify(text)} hits bend ${JSON.stringify(b)}`);
          if (dash && b.text) ok(!boxesHit(dash, b), `${name} sys${si} "${g.children[0]._text}" dash ${JSON.stringify(dash)} crosses bend text ${JSON.stringify(b)}`);
        });
      });
    }));
  }
  ok(runs > 50 && nearBends >= 15, `exercised ${runs} label runs, ${nearBends} with bend ink in their x-range`);
  // stacking order is kept: on a shared bent beat the harmonic label is further out (higher) than the P.M. label
  const stg = staffOfTrack(renderTree(BEND_LABEL_CASES[5][1], 900), 0, 0, true);
  const yPm = num(pmGroups(stg)[0].children[0], 'y'); const yAh = num(harmGroups(stg)[0].children[0], 'y');
  ok(yAh < yPm, `A.H. baseline ${yAh} not above P.M. ${yPm}`);
  // a run with no bend keeps its label on its first beat in the nearest lane (unchanged rule)
  const plain = staffOfTrack(renderTree(mkTab([hq([{ string: 2, fret: 5 }], { palmMute: true }), hq([{ string: 2, fret: 5 }], { palmMute: true })]), 900), 0, 0, true);
  near(num(pmGroups(plain)[0].children[0], 'y'), staffInfo(plain).localTop - 0.6 * DEF.staffLineSpacing, EPS, 'plain P.M. lane');
});

test('harmonics', 'determinism: harmonics fixtures render byte-identically twice; the input score is not mutated; no NaN at widths 600/900/1400', () => {
  for (const [fx, width] of HFIX) {
    const a = serialize(renderTree(fx.score, width, fx.options || {}));
    const b = serialize(renderTree(fx.score, width, fx.options || {}));
    ok(a === b, `${fx.name}: two renders differ`);
    const before = JSON.stringify(fx.score);
    const box = makeContainer(); new MusicScoreRenderer(box, fx.score, { width }).render();
    ok(JSON.stringify(fx.score) === before, `${fx.name}: input score mutated by render`);
    ok(serialize(box.children[0]) === a, `${fx.name}: direct render differs from the cloned one`);
    for (const w of [600, 900, 1400]) { const out = serialize(renderTree(fx.score, w)); ok(!/NaN|Infinity|undefined/.test(out), `${fx.name}@${w}: bad number`); }
  }
});

// ======================= directions =======================
// SVG-level verification of picking and playing directions (let ring, pick strokes, tap "T", whammy dips; design.md
// section 7 + status.md AC1-AC12 and the user decisions). Unit-level pieces (directions.js tables, withDirections,
// techniqueLabelDash per label) live in units.mjs; fixtures `directions` (w900) and `directions-break` (w600) are in
// tests/fixtures/characterization.js. Oracles below are written from the spec on the RAW score (not via src/directions.js);
// all geometry is recomputed from the rendered SVG tree (local staff coordinates, like the layout x).
const DFX = characterizationCases.find((c) => c.name === 'directions');
const DBRK = characterizationCases.find((c) => c.name === 'directions-break');
const DIRFIX = [[DFX, 900], [DBRK, 600]];
const PICK_W = { down: 1.248, up: 1.0 };   // glyph bbox width / height in sp (font coverage check, status.md)
const PICK_H = { down: 1.3, up: 2.0 };
const dcls = (n, c) => cls(n).split(' ').includes(c);
const dgroups = (root, c) => all(root).filter(({ n }) => n.tag === 'g' && dcls(n, c)).map(({ n }) => n);
const SPD = DEF.staffLineSpacing;

// --- spec oracles on raw values ---
const rawMain = (b) => b.type !== 'rest' && b.type !== 'grace' && Array.isArray(b.notes) && b.notes.length > 0;
const rawPick = (b) => (rawMain(b) && typeof b.pickStroke === 'string' && ['down', 'up'].includes(b.pickStroke.trim().toLowerCase()) ? b.pickStroke.trim().toLowerCase() : null);
const rawTap = (b) => rawMain(b) && b.notes.some((n) => n.tap && hkind(n.harmonic) !== 'tapped');
const amountOf = (v) => {
  const s = typeof v === 'string' ? v : (typeof v === 'number' && Number.isFinite(v) ? String(v) : null);
  return s == null ? null : (s.replace(/^[-−\s]+/, '').trim() || null);
};
function rawDip(b) {
  if (!rawMain(b)) return null;
  const w = b.whammy;
  if (w === true) return '1/2';
  if (typeof w === 'string' || typeof w === 'number') return amountOf(w);
  if (w && typeof w === 'object' && !Array.isArray(w)) { if ((w.type ?? 'dip') !== 'dip') return null; return amountOf(w.amount) ?? '1/2'; }
  return null;
}

// Per track: raw beats paired (in order) with their layout x and system index.
function dirModel(fx, width) {
  const options = fx.options || {};
  const svg = renderTree(fx.score, width, options);
  const layout = layoutOf(fx.score, width, options);
  const tracks = fx.score.tracks.map((track, ti) => {
    const raws = track.measures.flatMap((m) => m.beats);
    const els = layout.systems.flatMap((sys, si) => sys.tracks[ti].measures.flatMap((m) => m.elements.map((le) => ({ si, x: le.x }))));
    ok(raws.length === els.length, `${fx.name} track ${ti}: ${raws.length} raw beats vs ${els.length} layout elements`);
    return { track, ti, notation: track.showStandardNotation !== false, tab: !!track.showTablature, beats: raws.map((raw, i) => ({ raw, ...els[i] })) };
  });
  return { svg, layout, tracks };
}
const staffOf = (m, si, tr, tab) => staffOfTrack(m.svg, si, tr.ti, tab);
const eachStaff = (m, fn) => m.tracks.forEach((tr) => m.layout.systems.forEach((_, si) => fn(tr, si)));

// Boxes (local coordinates) of the ink in a TAB staff group, by kind.
const pathNums = (d) => (d.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
const hullOf = (d) => {
  const v = pathNums(d); const xs = v.filter((_, i) => i % 2 === 0); const ys = v.filter((_, i) => i % 2 === 1);
  return { x1: Math.min(...xs), x2: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
};
const rectBox = (b) => ({ x1: num(b, 'x'), x2: num(b, 'x') + num(b, 'width'), top: num(b, 'y'), bottom: num(b, 'y') + num(b, 'height') });
const tbox = (t, opts = {}) => {
  const fs = num(t, 'font-size'); const w = estimateTextWidth(t._text, fs, opts);
  const x1 = num(t, 'x') - (t.getAttribute('text-anchor') === 'middle' ? w / 2 : 0);
  return { x1, x2: x1 + w, top: num(t, 'y') - TEXT_ASCENT_EM * fs, bottom: num(t, 'y') + TEXT_DESCENT_EM * fs };
};
const pickBox = (g) => {
  const t = g.children[0]; const kind = dcls(g, 'pick-stroke-down') ? 'down' : 'up'; const x = num(t, 'x'); const y = num(t, 'y');
  return { kind, x, x1: x - PICK_W[kind] * SPD / 2, x2: x + PICK_W[kind] * SPD / 2, top: y - PICK_H[kind] * SPD, bottom: y };
};
const tapBox = (g) => ({ ...tbox(g.children[0], { bold: true }), x: num(g.children[0], 'x') });
function dipBox(g) {
  const p = g.children.find((c) => c.tag === 'path'); const t = g.children.find((c) => c.tag === 'text');
  const v = pathNums(p.getAttribute('d'));
  return { v: { x1: v[0], y1: v[1], xm: v[2], ym: v[3], x2: v[4], y2: v[5], n: v.length }, vBox: hullOf(p.getAttribute('d')), tBox: tbox(t), label: t._text, tx: num(t, 'x') };
}
function tabInk(stg) {
  const out = [];
  stg.children.forEach((c) => {
    const k = cls(c);
    if (c.tag === 'rect') out.push({ kind: 'fret', ...rectBox(c) });
    else if (c.tag === 'text' && !k) out.push({ kind: 'fret', ...tbox(c) });
    else if (c.tag === 'g') {
      if (/tab-lines|tab-clef|barline/.test(k)) return;
      if (dcls(c, 'bend')) c.children.forEach((b) => { if (b.tag === 'rect') out.push({ kind: 'bend', ...rectBox(b), text: true }); else if (b.tag === 'path') out.push({ kind: 'bend', ...hullOf(b.getAttribute('d')), text: false }); });
      else if (dcls(c, 'tap')) out.push({ kind: 'tap', ...tapBox(c), text: true });
      else if (dcls(c, 'whammy')) { const d = dipBox(c); out.push({ kind: 'dip', ...d.vBox, text: true }, { kind: 'dip', ...d.tBox, text: true }); }
      else if (dcls(c, 'hammer-pull')) c.children.forEach((b) => { if (b.tag === 'path') out.push({ kind: 'hp', ...hullOf(b.getAttribute('d')) }); else if (b.tag === 'rect') out.push({ kind: 'hp', ...rectBox(b) }); });
      else if (dcls(c, 'let-ring') || dcls(c, 'palm-mute') || dcls(c, 'harmonic')) { const li = labelInk(c); out.push({ kind: 'label', ...li.text, text: true }); if (li.dash) out.push({ kind: 'label', ...li.dash, text: true }); }
      else if (dcls(c, 'pick-stroke')) out.push({ ...pickBox(c), kind: 'pick' });
      else {
        all(c).forEach(({ n }) => {
          const b = n.tag === 'path' ? hullOf(n.getAttribute('d')) : n.tag === 'text' ? tbox(n) : n.tag === 'line'
            ? { x1: Math.min(num(n, 'x1'), num(n, 'x2')), x2: Math.max(num(n, 'x1'), num(n, 'x2')), top: Math.min(num(n, 'y1'), num(n, 'y2')), bottom: Math.max(num(n, 'y1'), num(n, 'y2')) } : null;
          if (b) out.push({ kind: 'mark', ...b });
        });
      }
    }
  });
  return out;
}
const xover = (a, b) => a.x1 < b.x2 && b.x1 < a.x2;

// Notation-staff ink excluding the decorations placed around the music (and the new direction marks).
const SKIPN = new Set([...SKIP, 'pick-stroke', 'tap', 'let-ring', 'palm-mute', 'harmonic']);
function notationLeaves(g) {
  const out = [];
  const visit = (n) => {
    if (SKIPN.has(cls(n).split(' ')[0])) return;
    if (n.tag === 'g') { n.children.forEach(visit); return; }
    const b = nodeBox(n);
    if (b && Number.isFinite(b.top)) out.push({ n, b });
  };
  g.children.forEach(visit);
  return out;
}

// Let-ring run oracle (spec: marked beats; unmarked rests bridge between two marked beats of one system; unmarked notes /
// graces and system breaks end a run). Returns [{ si, startX, lastX }].
function ringRuns(tr) {
  const bs = tr.beats; const n = bs.length;
  const marked = bs.map((b) => !!b.raw.letRing);
  const isGap = (k) => k >= 0 && k < n && !marked[k] && bs[k].raw.type === 'rest';
  const ringsAt = (k, si) => k >= 0 && k < n && bs[k].si === si && marked[k];
  const ring = bs.map((b, i) => {
    if (marked[i] || b.raw.type !== 'rest') return marked[i];
    let a = i - 1; while (isGap(a) && bs[a].si === b.si) a--;
    let c = i + 1; while (isGap(c) && bs[c].si === b.si) c++;
    return ringsAt(a, b.si) && ringsAt(c, b.si);
  });
  const runs = [];
  bs.forEach((b, i) => {
    if (!ring[i]) return;
    if (i > 0 && ring[i - 1] && bs[i - 1].si === b.si) { runs.at(-1).lastX = b.x; return; }
    runs.push({ si: b.si, startX: b.x, lastX: b.x });
  });
  return runs;
}
const dirLabelStaff = (m, si, tr) => staffOf(m, si, tr, tr.tab);

// ---------- AC1 ----------
test('directions', 'AC1: every pre-existing fixture/example emits no let-ring / pick-stroke / tap / whammy group and no U+E610 / U+E612 glyph', () => {
  let checked = 0;
  for (const [name, score, options] of SCORES) {
    if (name.startsWith('char-directions') || name === 'char-navigation-tab-only' || name.startsWith('char-chord-diagrams')) continue; // newer fixtures using directions on purpose
    for (const width of [600, 900]) {
      all(renderTree(score, width, options)).forEach(({ n }) => {
        const c = cls(n).split(' ');
        ok(!c.some((x) => ['let-ring', 'pick-stroke', 'tap', 'whammy'].includes(x) || /^(pick-stroke|whammy)-/.test(x)), `${name}@${width}: class "${cls(n)}"`);
        if (n.tag === 'text') ok(cpOf(n) !== 0xE610 && cpOf(n) !== 0xE612, `${name}@${width}: bowing glyph`);
      });
      checked++;
    }
  }
  ok(checked >= 10, `only ${checked} renders checked`);
});

// ---------- AC2 / AC3 let ring ----------
test('directions', 'AC2: one "let ring" label per run (rests bridge inside a system; unmarked notes, graces and system breaks end runs), label x >= run start', () => {
  let runsSeen = 0;
  for (const [fx, width] of DIRFIX) {
    const m = dirModel(fx, width);
    m.tracks.forEach((tr) => {
      const runs = ringRuns(tr);
      m.layout.systems.forEach((sys, si) => {
        const stg = dirLabelStaff(m, si, tr);
        const want = runs.filter((r) => r.si === si).sort((a, b) => a.startX - b.startX);
        const got = stg ? dgroups(stg, 'let-ring').sort((a, b) => num(a.children[0], 'x') - num(b.children[0], 'x')) : [];
        ok(got.length === want.length, `${fx.name} t${tr.ti} sys${si}: ${got.length} let-ring labels, ${want.length} runs`);
        got.forEach((g, i) => {
          ok(g.children[0]._text === 'let ring', `${fx.name}: label text "${g.children[0]._text}"`);
          const x = num(g.children[0], 'x');
          ok(x >= want[i].startX - EPS, `${fx.name} t${tr.ti} sys${si} run${i}: label x ${x} left of run start ${want[i].startX}`);
          if (i + 1 < want.length) ok(x < want[i + 1].startX, `${fx.name} t${tr.ti} sys${si} run${i}: label x ${x} reaches the next run`);
          runsSeen++;
        });
      });
    });
  }
  ok(runsSeen >= 6, `only ${runsSeen} let-ring runs seen`);
});

test('directions', 'AC2: dash starts >= label x + text width + 0.3 x size, ends <= last barline - 0.5 sp and reaches the last ringing beat; bold italic label text', () => {
  let dashes = 0;
  for (const [fx, width] of DIRFIX) {
    const m = dirModel(fx, width);
    m.tracks.forEach((tr) => {
      const runs = ringRuns(tr);
      m.layout.systems.forEach((sys, si) => {
        const stg = dirLabelStaff(m, si, tr);
        if (!stg) return;
        const want = runs.filter((r) => r.si === si).sort((a, b) => a.startX - b.startX);
        dgroups(stg, 'let-ring').sort((a, b) => num(a.children[0], 'x') - num(b.children[0], 'x')).forEach((g, i) => {
          const t = g.children[0]; const size = num(t, 'font-size');
          ok(t.getAttribute('font-style') === 'italic' && t.getAttribute('font-weight') === 'bold', 'label style like P.M.');
          const { text, dash } = labelInk(g);
          if (!dash) return;
          dashes++;
          const textW = estimateTextWidth('let ring', size, { bold: true });
          ok(dash.x1 >= num(t, 'x') + textW + 0.3 * size - EPS, `${fx.name} t${tr.ti} sys${si}: dash starts ${dash.x1} < text end ${num(t, 'x') + textW} + 0.3 size`);
          ok(dash.x2 <= sys.lastBarlineX - 0.5 * SPD + EPS, `${fx.name} t${tr.ti} sys${si}: dash end ${dash.x2} beyond last barline ${sys.lastBarlineX} - 0.5 sp`);
          ok(dash.x2 >= want[i].lastX - EPS, `${fx.name} t${tr.ti} sys${si}: dash end ${dash.x2} short of last ringing beat ${want[i].lastX}`);
          ok(dash.x1 >= text.x2 - EPS, 'dash never overlaps its own text');
        });
      });
    });
  }
  ok(dashes >= 6, `only ${dashes} dashes checked`);
});

test('directions', 'AC2: rest bridging / run ending in small scores (rest bridges, trailing rest does not, grace and unmarked note end the run, leading rest ignored)', () => {
  const lr = (s, f) => tabq(s, f, { letRing: true });
  const tabq = (string, fret, extra = {}) => ({ type: 'note', duration: 'quarter', notes: [{ string, fret }], ...extra });
  const grace = () => ({ type: 'grace', duration: '16th', notes: [{ string: 2, fret: 2 }] });
  const labels = (beats) => {
    const svg = renderTree(mkTab(beats, { showStandardNotation: false }), 1600);
    const stg = staffGroups(systemsOf(svg)[0])[0];
    return dgroups(stg, 'let-ring').map((g) => ({ x: num(g.children[0], 'x'), end: dashEnd(g) }));
  };
  const xs = (beats) => layoutOf(mkTab(beats, { showStandardNotation: false }), 1600).systems[0].tracks[0].measures[0].elements.map((le) => le.x);
  const cases = [
    ['lr rest lr', [lr(3, 2), rest4(), lr(3, 2), tabq(1, 0)], 1],
    ['lr rest rest lr', [lr(3, 2), rest4(), rest4(), lr(3, 2)], 1],
    ['lr rest note', [lr(3, 2), rest4(), tabq(3, 2), tabq(1, 0)], 1],
    ['lr note lr', [lr(3, 2), tabq(3, 2), lr(3, 2), tabq(1, 0)], 2],
    ['lr grace lr', [lr(3, 2), grace(), lr(3, 2), tabq(1, 0)], 2],
    ['rest lr lr', [rest4(), lr(3, 2), lr(3, 2), tabq(1, 0)], 1],
    ['lr lr rest (trailing)', [lr(3, 2), lr(3, 2), rest4(), tabq(1, 0)], 1],
    ['lr note rest lr', [lr(3, 2), tabq(3, 2), rest4(), lr(3, 2)], 2],
  ];
  cases.forEach(([name, beats, count]) => ok(labels(beats).length === count, `${name}: ${labels(beats).length} labels, expected ${count}`));
  // the bridged run's label starts at its first beat and the dash spans the rest up to the last ringing beat
  const b = cases[0][1]; const L = labels(b)[0]; const X = xs(b);
  near(L.x, X[0], EPS, 'lr rest lr: label at first beat');
  ok(L.end >= X[2] - EPS, `lr rest lr: dash end ${L.end} does not reach the beat after the rest ${X[2]}`);
  const t = cases[4][1]; const T = labels(t); const XT = xs(t);
  ok(T[0].end <= XT[1] + EPS, 'lr grace lr: first run does not extend past the grace');
  near(T[1].x, XT[2], 3 * SPD, 'lr grace lr: second run starts at the beat after the grace');
  const lead = labels(cases[5][1])[0]; near(lead.x, xs(cases[5][1])[1], EPS, 'leading rest: label starts at the first ringing beat');
  // trailing rest: run ends at the last ringing beat (no bridge)
  const tr2 = labels(cases[6][1])[0]; ok(tr2.end < xs(cases[6][1])[2] + 2.5 * SPD, 'trailing rest does not extend the run far');
});

test('directions', 'AC3: let-ring lane is strictly outside every overlapping P.M. / harmonic label (tab: higher, notation-only: lower), by >= one lane step, and no label boxes overlap', () => {
  const size = Math.max(0.9 * SPD, DEF.tabFontSize - 0.1 * SPD);
  const step = size + 0.4 * SPD;
  let stacked = 0;
  for (const [fx, width] of DIRFIX) {
    const m = dirModel(fx, width);
    eachStaff(m, (tr, si) => {
      const stg = dirLabelStaff(m, si, tr);
      if (!stg) return;
      const outward = tr.tab ? -1 : 1;
      const lets = dgroups(stg, 'let-ring');
      const others = [...dgroups(stg, 'palm-mute'), ...dgroups(stg, 'harmonic')];
      const ext = (g) => { const li = labelInk(g); return { x1: li.text.x1, x2: Math.max(li.text.x2, li.dash ? li.dash.x2 : -Infinity) }; };
      lets.forEach((g) => {
        const e = ext(g);
        others.filter((o) => xover(e, ext(o))).forEach((o) => {
          stacked++;
          const gap = outward * (num(g.children[0], 'y') - num(o.children[0], 'y'));
          ok(gap >= step - EPS, `${fx.name} t${tr.ti} sys${si}: let ring only ${gap} outside ${cls(o)} (lane step ${step})`);
        });
      });
      const labs = [...lets, ...others].map((g) => labelInk(g));
      for (let i = 0; i < labs.length; i++) for (let j = i + 1; j < labs.length; j++) {
        const pa = [labs[i].text, labs[i].dash].filter(Boolean); const pb = [labs[j].text, labs[j].dash].filter(Boolean);
        pa.forEach((a) => pb.forEach((b) => ok(!boxesHit(a, b), `${fx.name} t${tr.ti} sys${si}: label ink boxes overlap`)));
      }
    });
  }
  ok(stacked >= 2, `only ${stacked} stacked let-ring/P.M. pairs exercised`);
});

test('directions', 'AC3: unstacked let-ring lanes: tab at TAB top - 0.6 sp (or an outer lane step), notation-only at bottom line + 3.3 sp; never inside the staff', () => {
  const size = Math.max(0.9 * SPD, DEF.tabFontSize - 0.1 * SPD);
  const step = size + 0.4 * SPD;
  const m = dirModel(DFX, 900);
  const seen = { tab: 0, nota: 0 };
  eachStaff(m, (tr, si) => {
    const stg = dirLabelStaff(m, si, tr);
    if (!stg) return;
    const info = staffInfo(stg);
    const base = tr.tab ? info.localTop - 0.6 * SPD : info.localBottom + 3.3 * SPD;
    dgroups(stg, 'let-ring').forEach((g) => {
      const lane = (num(g.children[0], 'y') - base) / ((tr.tab ? -1 : 1) * step);
      ok(lane > -EPS && Math.abs(lane - Math.round(lane)) < EPS / step, `t${tr.ti}: let-ring lane index ${lane}`);
      seen[tr.tab ? 'tab' : 'nota']++;
    });
  });
  ok(seen.tab > 0 && seen.nota > 0, `lane cases not exercised ${JSON.stringify(seen)}`);
  // literal pins: notation-only track (bottom line y = 40): let ring at 73; TAB-only track-0 first run at TAB top - 0.6 sp - 1 lane (above P.M.? no overlap -> lane 0)
  const nst = staffOfTrack(m.svg, 0, 1, false);
  near(staffInfo(nst).localBottom, 40, EPS, 'notation bottom line');
  ok(dgroups(nst, 'let-ring').every((g) => num(g.children[0], 'y') === 73), 'notation-only let ring at +3.3 sp (y 73)');
  const tst = staffOfTrack(m.svg, 0, 0, true);
  ok(dgroups(tst, 'let-ring').some((g) => num(g.children[0], 'y') === -21), 'track 0 first let ring pinned at y -21 (TAB top - 0.6 sp - 1 lane step... lane 1 above the P.M.-free beat ink)');
});

test('directions', 'AC3: let-ring label text and dash never hit bend / tap "T" / whammy-dip ink recomputed from the SVG (dash may cross bend strokes, not text-bearing ink)', () => {
  let checked = 0;
  for (const [fx, width] of DIRFIX) {
    const m = dirModel(fx, width);
    eachStaff(m, (tr, si) => {
      if (!tr.tab) return;
      const stg = staffOf(m, si, tr, true);
      if (!stg) return;
      const ink = tabInk(stg).filter((b) => ['bend', 'tap', 'dip'].includes(b.kind));
      dgroups(stg, 'let-ring').forEach((g) => {
        const li = labelInk(g);
        ink.forEach((b) => {
          ok(!boxesHit(li.text, b), `${fx.name} t${tr.ti} sys${si}: let-ring text hits ${b.kind} ink`);
          if (li.dash && b.text) ok(!boxesHit(li.dash, b), `${fx.name} t${tr.ti} sys${si}: let-ring dash hits ${b.kind} text-bearing ink`);
        });
        checked++;
      });
    });
  }
  ok(checked >= 5, `only ${checked} let-ring runs checked`);
});


// ---------- AC4 / AC5 notation pick strokes ----------
// Rendered (kind, x) of every pick stroke in staff `stg`, sorted by x.
const picksIn = (stg) => dgroups(stg, 'pick-stroke').map((g) => pickBox(g)).sort((a, b) => a.x - b.x);
const picks_all = (stg) => picksIn(stg);
const tapsIn = (stg) => dgroups(stg, 'tap').map((g) => tapBox(g)).sort((a, b) => a.x - b.x);

test('directions', 'AC4: notation staff has one pick stroke per main-note beat with a valid pickStroke: glyph E610 (down) / E612 (up), classes pick-stroke pick-stroke-<kind>, centred on the beat x', () => {
  let seen = { down: 0, up: 0 };
  for (const [fx, width] of DIRFIX) {
    const m = dirModel(fx, width);
    eachStaff(m, (tr, si) => {
      const stg = staffOf(m, si, tr, false);
      const want = tr.notation ? tr.beats.filter((b) => b.si === si && rawPick(b.raw)).map((b) => ({ kind: rawPick(b.raw), x: b.x })).sort((a, b) => a.x - b.x) : [];
      const gs = stg ? dgroups(stg, 'pick-stroke') : [];
      ok(gs.length === want.length, `${fx.name} t${tr.ti} sys${si}: ${gs.length} pick strokes, expected ${want.length}`);
      gs.sort((a, b) => num(a.children[0], 'x') - num(b.children[0], 'x')).forEach((g, i) => {
        const t = g.children[0];
        ok(cls(g) === `pick-stroke pick-stroke-${want[i].kind}`, `${fx.name}: class "${cls(g)}" for ${want[i].kind}`);
        ok(cpOf(t) === (want[i].kind === 'down' ? 0xE610 : 0xE612), `${fx.name}: code point U+${cpOf(t).toString(16)} for ${want[i].kind}`);
        near(num(t, 'x'), want[i].x, EPS, `${fx.name} t${tr.ti}: pick stroke x vs beat x`);
        ok(t.getAttribute('text-anchor') === 'middle', 'pick stroke centred (text-anchor middle)');
        seen[want[i].kind]++;
      });
    });
  }
  ok(seen.down >= 4 && seen.up >= 4, `kinds exercised ${JSON.stringify(seen)}`);
});

test('directions', 'AC4: every notation pick stroke sits above the staff and above all music ink under it (noteheads, stems, beams, articulations, slurs, tuplets, ledger lines, vibrato/tremolo)', () => {
  let checked = 0;
  for (const [fx, width] of DIRFIX) {
    const m = dirModel(fx, width);
    eachStaff(m, (tr, si) => {
      const stg = staffOf(m, si, tr, false);
      if (!stg) return;
      const info = staffInfo(stg);
      const leaves = notationLeaves(stg);
      picksIn(stg).forEach((p) => {
        ok(p.bottom <= info.localTop - EPS, `${fx.name} t${tr.ti} sys${si}: pick stroke bottom ${p.bottom} not above the top staff line ${info.localTop}`);
        // The glyph box is wider than its ink: an up-bow is a V whose bottom is its apex, so a neighbouring beat's vibrato tail (ends 3 px before the next notehead, status.md crowding note) may touch the box edge. Inset 0.4 sp (up) / 0.1 sp (down).
        const inset = (p.kind === 'up' ? 0.4 : 0.1) * SPD;
        const core = { ...p, x1: p.x1 + inset, x2: p.x2 - inset };
        // Slurs are checked against their curve, not their bounding box (C2: picks sit at the slur's local height under its
        // apex) — see "C2: ... clear the slur's outer edge where it crosses them" below.
        leaves.filter(({ n, b }) => cls(n) !== 'slur' && xover(core, b)).forEach(({ n, b }) => ok(p.bottom <= b.top + EPS, `${fx.name} t${tr.ti} sys${si}: pick stroke at x=${p.x} (bottom ${p.bottom}) overlaps ${n.tag} ${cls(n) || ''} top ${b.top}`));
        checked++;
      });
    });
  }
  ok(checked >= 10, `only ${checked} pick strokes checked`);
});

test('directions', 'AC4/AC5: notation tap "T" and pick stroke stack: T above the ink, pick stroke >= 0.4 sp above the T; chord-symbol baseline above every pick/T top; fermata bottom >= 0.5 sp above its beat\'s pick/T top', () => {
  let both = 0; let chords = 0; let fermatas = 0;
  for (const [fx, width] of DIRFIX) {
    const m = dirModel(fx, width);
    eachStaff(m, (tr, si) => {
      const stg = staffOf(m, si, tr, false);
      if (!stg) return;
      const info = staffInfo(stg);
      const leaves = notationLeaves(stg);
      const taps = tapsIn(stg); const picks = picksIn(stg);
      taps.forEach((t) => {
        ok(t.bottom <= info.localTop + EPS, `${fx.name}: notation T bottom ${t.bottom} not above the staff`);
        // Slurs: curve check in the C2 tests below (the T sits at the slur's local height, inside its bounding box).
        leaves.filter(({ n, b }) => cls(n) !== 'slur' && xover(t, b)).forEach(({ n, b }) => ok(t.bottom <= b.top + EPS, `${fx.name}: T at x=${t.x} overlaps ${n.tag} ${cls(n)}`));
        const pk = picks.find((p) => Math.abs(p.x - t.x) < 1);
        if (pk) { both++; ok(pk.bottom <= t.top - 0.4 * SPD + EPS, `${fx.name} t${tr.ti}: pick stroke bottom ${pk.bottom} < 0.4 sp above T top ${t.top}`); }
      });
      const topOfMarks = Math.min(Infinity, ...taps.map((t) => t.top), ...picks.map((p) => p.top));
      textsOf(stg, 'chord-symbol').forEach((c) => {
        if (!Number.isFinite(topOfMarks)) return;
        chords++;
        ok(num(c, 'y') <= topOfMarks - EPS, `${fx.name} t${tr.ti} sys${si}: chord baseline ${num(c, 'y')} not above pick/T top ${topOfMarks}`);
      });
      byClass(stg, 'fermata', 'g').forEach(({ n: fg }) => {
        const b = nodeBox(fg.children[0]);
        if (!b || b.bottom > info.localTop) return; // fermata below the staff (stem-down note) is not in the stack
        const x = (b.x1 + b.x2) / 2;
        const originY = num(fg.children[0], 'y'); // the gap is measured from the glyph origin (its bbox hangs 0.02 sp lower)
        const tops = [...taps, ...picks].filter((d) => Math.abs(d.x - x) < 3).map((d) => d.top);
        if (!tops.length) return;
        fermatas++;
        ok(originY <= Math.min(...tops) - 0.5 * SPD + EPS, `${fx.name} t${tr.ti} sys${si}: fermata bottom ${originY} less than 0.5 sp above direction top ${Math.min(...tops)}`);
      });
    });
  }
  ok(both >= 2, `only ${both} T+pick beats`);
  ok(chords >= 1, `only ${chords} chord symbols checked`);
  ok(fermatas >= 2, `only ${fermatas} fermatas checked`);
});

test('directions', 'AC4: pick strokes ignore stems/slurs/tuplets: pick stroke over a beam group and over a note under a slur + tuplet bracket clears them (fixture bar 4) and a stem-up high note clears its stem', () => {
  const m = dirModel(DFX, 900);
  const stg = staffOf(m, 0, m.tracks[0], false);
  const info = staffInfo(stg);
  const leaves = notationLeaves(stg);
  // the tuplet bracket of m4 and the slur are leaves; pick strokes of m4 (x > 719) sit above every leaf under them
  const m4 = picksIn(stg).filter((p) => p.x > 719);
  ok(m4.length >= 4, `${m4.length} pick strokes in m4`);
  const tup = byClass(stg, 'tuplet', 'g');
  ok(tup.length >= 1, 'tuplet bracket present');
  tup.forEach(({ n }) => { const bs = all(n).map((a) => a.n).filter((a) => a.tag === 'path' || a.tag === 'line').map(nodeBox).filter(Boolean); const top = Math.min(...bs.map((b) => b.top)); const x1 = Math.min(...bs.map((b) => b.x1)); const x2 = Math.max(...bs.map((b) => b.x2));
    picksIn(stg).filter((p) => p.x > x1 && p.x < x2).forEach((p) => ok(p.bottom <= top + EPS, `pick stroke at ${p.x} vs tuplet bracket top ${top}`)); });
  ok(leaves.some(({ n }) => n.tag === 'path'), 'slur/beam paths exist');
  ok(picks_all(stg).every((p) => p.bottom <= info.localTop), 'all pick strokes above the staff');
});

// ---------- C2 (acceptance fix): slur-local height, beam-group baselines, TAB T vs H/P letters ----------
const SLUR_DIR_CLEAR = 0.5 * SPD;  // pick / notation T bottom -> slur outer edge where it crosses the mark
const TAP_HP_CLEAR = 0.5 * SPD;    // TAB T box -> H/P letter knock-out
const C2_TOL = 0.05 * SPD;
// Outer edges of the above-the-notes slurs of a notation staff, from the path ("M x1 y1 C c1 o1, c2 o2, x2 y2 C ...").
function slursAbove(stg) {
  return all(stg).map(({ n }) => n).filter((n) => n.tag === 'path' && cls(n) === 'slur').map((n) => {
    const v = pathNums(n.getAttribute('d'));
    return [[v[0], v[1]], [v[2], v[3]], [v[4], v[5]], [v[6], v[7]]];
  }).filter((p) => p[1][1] < p[0][1] && p[2][1] < p[3][1]);
}
// Min y of a cubic over the x span (xa, xb) by dense sampling; Infinity when the curve doesn't reach the span.
function curveTop(pts, xa, xb) {
  let top = Infinity;
  for (let k = 0; k <= 4000; k++) {
    const t = k / 4000; const u = 1 - t; const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
    const x = w.reduce((a, wk, i) => a + wk * pts[i][0], 0);
    if (x < xa || x > xb) continue;
    top = Math.min(top, w.reduce((a, wk, i) => a + wk * pts[i][1], 0));
  }
  return top;
}
const slurBound = (slurs, m) => Math.min(Infinity, ...slurs.map((p) => curveTop(p, m.x1, m.x2) - SLUR_DIR_CLEAR));
// A slur high over low beamed eighths (C6 ... C6, mixed stems -> above), so the slur — not the notes or a tuplet — binds
// the T and pick strokes under it; two beam groups of picks, a T in the first.
const e8d = (pitch, beat = {}, note = {}) => ({ type: 'note', duration: '8th', notes: [{ pitch, ...note }], ...beat });
const C2FX = { name: 'c2-slur', score: oneTrack([{ beats: [
  q('C6', { beat: { slurStart: true, pickStroke: 'down' } }),
  e8d('G4', { pickStroke: 'up' }, { tap: true }), e8d('A4', { pickStroke: 'down' }),
  e8d('B4', { pickStroke: 'up' }), e8d('A4', { pickStroke: 'down' }),
  q('C6', { beat: { slurEnd: true } }),
] }]) };
const C2FIX = [...DIRFIX, [C2FX, 900]];

test('directions', 'C2: notation pick strokes and T clear the slur\'s outer edge where it crosses them by >= 0.5 sp (slur-local height, not the apex)', () => {
  let checked = 0;
  for (const [fx, width] of C2FIX) {
    const m = dirModel(fx, width);
    eachStaff(m, (tr, si) => {
      const stg = staffOf(m, si, tr, false);
      if (!stg) return;
      const slurs = slursAbove(stg);
      [...picksIn(stg), ...tapsIn(stg)].forEach((d) => {
        const bound = slurBound(slurs, d);
        if (!Number.isFinite(bound)) return;
        checked++;
        ok(d.bottom <= bound + EPS, `${fx.name} t${tr.ti} sys${si}: mark at x=${d.x} bottom ${d.bottom} less than 0.5 sp above the slur's edge (limit ${bound})`);
      });
    });
  }
  ok(checked >= 5, `only ${checked} slurred pick / T marks checked`);
});

test('directions', 'C2: pick strokes on the beats of one beam group share one baseline; each T in the group stays >= 0.4 sp below it', () => {
  let groups = 0;
  for (const [fx, width] of C2FIX) {
    const m = dirModel(fx, width);
    m.tracks.forEach((tr) => {
      if (!tr.notation) return;
      m.layout.systems.forEach((sys, si) => {
        const stg = staffOf(m, si, tr, false);
        const picks = picksIn(stg); const taps = tapsIn(stg);
        sys.tracks[tr.ti].measures.forEach((meas) => meas.beamGroups.filter((g) => g.length >= 2).forEach((grp) => {
          const xs = grp.map((i) => meas.elements.find((e) => e.index === i)).filter(Boolean).map((e) => e.x);
          const gp = picks.filter((p) => xs.some((x) => Math.abs(p.x - x) < EPS));
          if (gp.length < 2) return;
          groups++;
          gp.forEach((p) => near(p.bottom, gp[0].bottom, EPS, `${fx.name} t${tr.ti} sys${si}: beam-group pick baselines differ (x ${p.x} vs ${gp[0].x})`));
          taps.filter((t) => xs.some((x) => Math.abs(t.x - x) < EPS))
            .forEach((t) => ok(t.top >= gp[0].bottom + 0.4 * SPD - EPS, `${fx.name}: T at x=${t.x} (top ${t.top}) within 0.4 sp of the group's pick baseline ${gp[0].bottom}`));
        }));
      });
    });
  }
  ok(groups >= 3, `only ${groups} beam groups with 2+ pick strokes`);
});

test('directions', 'C2: where the slur is the binding constraint, a T sits at slur edge - 0.5 sp and a pick stroke (or its beam group\'s line) at the highest of its members\' slur / T limits - no higher', () => {
  let taps = 0; let picks = 0;
  for (const [fx, width] of C2FIX) {
    const m = dirModel(fx, width);
    m.tracks.forEach((tr) => {
      if (!tr.notation) return;
      m.layout.systems.forEach((sys, si) => {
        const stg = staffOf(m, si, tr, false);
        const info = staffInfo(stg);
        const slurs = slursAbove(stg);
        const leaves = notationLeaves(stg).filter(({ n }) => cls(n) !== 'slur');
        const beats = tr.beats.filter((b) => b.si === si);
        // Lower bound (min y) of every non-slur limit on a mark at beat `b`: 1 sp above the staff and above any ink within
        // 1.5 sp of the beat (own top - 1 sp, tuplet bracket - 0.6 sp). Beats with vibrato / tremolo (2 / 2.8 sp) are skipped.
        const otherLow = (b) => Math.min(info.localTop - SPD,
          ...leaves.filter(({ b: lb }) => lb.x1 < b.x + 1.5 * SPD && lb.x2 > b.x - 1.5 * SPD).map(({ b: lb }) => lb.top - SPD));
        const plain = (raw) => !raw.vibrato && !raw.tremolo;
        const tapAt = (x) => tapsIn(stg).find((t) => Math.abs(t.x - x) < EPS);
        tapsIn(stg).forEach((t) => {
          const b = beats.find((bb) => Math.abs(bb.x - t.x) < EPS);
          const bound = slurBound(slurs, t);
          if (!b || !plain(b.raw) || !Number.isFinite(bound) || bound > otherLow(b)) return;
          taps++;
          ok(t.bottom >= bound - C2_TOL, `${fx.name}: T at x=${t.x} bottom ${t.bottom} higher than needed (slur limit ${bound})`);
        });
        // A pick's own limit when known: min(slur limit, T top - 0.4 sp), provided it is stricter than every other limit.
        const ownLimit = (p) => {
          const b = beats.find((bb) => Math.abs(bb.x - p.x) < EPS);
          if (!b || !plain(b.raw)) return null;
          const t = tapAt(p.x);
          const lim = Math.min(slurBound(slurs, p), t ? t.top - 0.4 * SPD : Infinity);
          return Number.isFinite(lim) && lim <= otherLow(b) ? lim : null;
        };
        const groupOf = (x) => {
          for (const meas of sys.tracks[tr.ti].measures) {
            for (const grp of meas.beamGroups.filter((g) => g.length >= 2)) {
              const xs = grp.map((i) => meas.elements.find((e) => e.index === i)).filter(Boolean).map((e) => e.x);
              if (xs.some((gx) => Math.abs(gx - x) < EPS)) return xs;
            }
          }
          return null;
        };
        picksIn(stg).forEach((p) => {
          const xs = groupOf(p.x);
          const members = xs ? picksIn(stg).filter((q) => xs.some((x) => Math.abs(q.x - x) < EPS)) : [p];
          const lims = members.map(ownLimit);
          if (lims.some((l) => l == null)) return;
          picks++;
          near(p.bottom, Math.min(...lims), C2_TOL, `${fx.name}: pick at x=${p.x} bottom ${p.bottom} vs its (group) limit ${Math.min(...lims)}`);
        });
      });
    });
  }
  ok(taps >= 1 && picks >= 6, `slur-bound marks checked: ${taps} T, ${picks} picks`);
});

test('directions', 'C2: a TAB "T" never comes within 0.5 sp of a hammer-on / pull-off letter knock-out (it is raised above the letter instead)', () => {
  let near_ = 0;
  for (const [fx, width] of DIRFIX) {
    const m = dirModel(fx, width);
    eachStaff(m, (tr, si) => {
      if (!tr.tab) return;
      const stg = staffOf(m, si, tr, true);
      const letters = dgroups(stg, 'hammer-pull').map((g) => g.children.find((c) => c.tag === 'rect')).filter(Boolean).map(rectBox);
      tapsIn(stg).forEach((t) => letters.forEach((l) => {
        const pad = { x1: l.x1 - TAP_HP_CLEAR + EPS, x2: l.x2 + TAP_HP_CLEAR - EPS, top: l.top - TAP_HP_CLEAR + EPS, bottom: l.bottom + TAP_HP_CLEAR - EPS };
        if (t.x1 < l.x2 + TAP_HP_CLEAR && l.x1 - TAP_HP_CLEAR < t.x2) near_++;
        ok(!boxesHit(pad, t), `${fx.name} t${tr.ti} sys${si}: TAB T at x=${t.x} within 0.5 sp of an H/P letter at x ${l.x1}..${l.x2}`);
      }));
    });
  }
  ok(near_ >= 1, 'no T next to an H/P letter exercised');
});

test('directions', 'AC4/AC10: pick strokes are absent from the TAB staff of tracks that show notation (T is present on both)', () => {
  let tabTaps = 0; let notTaps = 0;
  for (const [fx, width] of DIRFIX) {
    const m = dirModel(fx, width);
    eachStaff(m, (tr, si) => {
      if (!(tr.notation && tr.tab)) return;
      const tstg = staffOf(m, si, tr, true);
      ok(dgroups(tstg, 'pick-stroke').length === 0, `${fx.name} t${tr.ti} sys${si}: pick stroke on the TAB staff beside notation`);
      const want = tr.beats.filter((b) => b.si === si && rawTap(b.raw)).length;
      ok(tapsIn(tstg).length === want, `${fx.name}: ${tapsIn(tstg).length} TAB T, expected ${want}`);
      ok(tapsIn(staffOf(m, si, tr, false)).length === want, `${fx.name}: notation T count`);
      tabTaps += want; notTaps += want;
    });
  }
  ok(tabTaps >= 4 && notTaps >= 4, 'T on both staves exercised');
});

// ---------- tab-only pick strokes ----------
test('directions', 'AC10: tab-only track: pick strokes drawn above the TAB (>= 1 sp above the top line), centred on the beat, glyph per kind, >= 0.4 sp clear of frets, labels, H/P arcs, bends, T and dips', () => {
  let checked = 0;
  for (const [fx, width] of DIRFIX) {
    const m = dirModel(fx, width);
    eachStaff(m, (tr, si) => {
      if (tr.notation || !tr.tab) return;
      const stg = staffOf(m, si, tr, true);
      ok(!staffOf(m, si, tr, false), 'tab-only track has no notation staff');
      const want = tr.beats.filter((b) => b.si === si && rawPick(b.raw)).map((b) => ({ kind: rawPick(b.raw), x: b.x })).sort((a, b) => a.x - b.x);
      const gs = dgroups(stg, 'pick-stroke').sort((a, b) => num(a.children[0], 'x') - num(b.children[0], 'x'));
      ok(gs.length === want.length, `${fx.name} t${tr.ti} sys${si}: ${gs.length} tab picks, expected ${want.length}`);
      const info = staffInfo(stg);
      const ink = tabInk(stg).filter((b) => b.kind !== 'pick');
      gs.forEach((g, i) => {
        const p = pickBox(g);
        ok(cpOf(g.children[0]) === (want[i].kind === 'down' ? 0xE610 : 0xE612), 'glyph per kind');
        near(p.x, want[i].x, EPS, 'tab pick centred on beat');
        ok(p.bottom <= info.localTop - 1 * SPD + EPS, `${fx.name}: tab pick bottom ${p.bottom} < 1 sp above the top line ${info.localTop}`);
        ink.filter((b) => xover(p, b)).forEach((b) => ok(p.bottom <= b.top - 0.4 * SPD + EPS, `${fx.name} t${tr.ti} sys${si}: tab pick at x=${p.x} (bottom ${p.bottom}) within 0.4 sp of ${b.kind} ink (top ${b.top})`));
        checked++;
      });
    });
  }
  ok(checked >= 7, `only ${checked} tab-only picks checked`);
});

// ---------- AC6 tap ----------
test('directions', 'AC6: TAB "T": one bold upright T per tapped beat centred on the beat, baseline >= 0.4 sp above the TAB top line and above the beat\'s fret knock-outs', () => {
  let seen = 0;
  for (const [fx, width] of DIRFIX) {
    const m = dirModel(fx, width);
    eachStaff(m, (tr, si) => {
      if (!tr.tab) return;
      const stg = staffOf(m, si, tr, true);
      const want = tr.beats.filter((b) => b.si === si && rawTap(b.raw)).map((b) => b.x).sort((a, b) => a - b);
      const gs = dgroups(stg, 'tap').sort((a, b) => num(a.children[0], 'x') - num(b.children[0], 'x'));
      ok(gs.length === want.length, `${fx.name} t${tr.ti} sys${si}: ${gs.length} T, expected ${want.length}`);
      const info = staffInfo(stg);
      const frets = tabInk(stg).filter((b) => b.kind === 'fret');
      gs.forEach((g, i) => {
        const t = g.children[0];
        ok(t._text === 'T' && t.getAttribute('font-weight') === 'bold' && t.getAttribute('text-anchor') === 'middle' && !t.getAttribute('font-style'), 'bold upright centred T');
        near(num(t, 'x'), want[i], EPS, 'T x vs beat x');
        ok(num(t, 'y') <= info.localTop - 0.4 * SPD + EPS, `${fx.name}: T baseline ${num(t, 'y')} within 0.4 sp of the top line ${info.localTop}`);
        const b = tapBox(g);
        frets.filter((f) => xover(b, f)).forEach((f) => ok(num(t, 'y') <= f.top - 0.4 * SPD + EPS, `${fx.name}: T baseline ${num(t, 'y')} within 0.4 sp of fret ink top ${f.top}`));
        seen++;
      });
    });
  }
  ok(seen >= 5, `only ${seen} TAB T checked`);
});

test('directions', 'AC6: tap + pull-off shows the T and then a P arc starting to its right (P label clear of the T); the H/P letter is kept', () => {
  const m = dirModel(DFX, 900);
  const stg = staffOf(m, 0, m.tracks[0], true);
  const ts = tapsIn(stg); const hp = dgroups(stg, 'hammer-pull-p');
  const t = ts.find((b) => Math.abs(b.x - 434) < 1);
  ok(!!t, 'T at the tap+pull beat (x 434)');
  ok(hp.length === 1, `${hp.length} pull-off arcs`);
  const arc = hullOf(hp[0].children.find((c) => c.tag === 'path').getAttribute('d'));
  ok(arc.x1 >= t.x, `arc starts ${arc.x1} left of the T centre ${t.x}`);
  const rect = rectBox(hp[0].children.find((c) => c.tag === 'rect'));
  ok(rect.x1 > t.x2 - EPS, `P label box ${rect.x1} overlaps the T (right edge ${t.x2})`);
  ok(hp[0].children.some((c) => c.tag === 'text' && c._text === 'P'), 'P letter drawn');
  ok(!boxesHit(rect, t), 'P label does not hit the T');
});

test('directions', 'AC6: tap + harmonic "tapped" shows only T.H. (no T, TAB or notation); tap with other harmonic kinds keeps its T; one T per chord beat', () => {
  const tapped = { string: 3, fret: 5, harmonic: 'tapped', harmonicFret: 17, tap: true };
  const pinch = { string: 3, fret: 5, harmonic: 'pinch', tap: true };
  const m1 = renderTree(mkTab([hq([tapped]), hq([{ string: 3, fret: 5, harmonic: 'tapped', tap: true }]), hq([{ string: 2, fret: 3 }])]), 1200);
  ok(dgroups(m1, 'tap').length === 0, 'no T for a tapped harmonic');
  ok(dgroups(m1, 'harmonic-tapped').length === 1, 'T.H. label run still drawn');
  ok(dgroups(m1, 'harmonic-tapped')[0].children[0]._text === 'T.H.', 'T.H. text');
  const m2 = renderTree(mkTab([hq([pinch])]), 1200);
  ok(dgroups(m2, 'tap').length === 2, 'T on TAB and on notation for a tapped pinch harmonic');
  const m3 = renderTree(mkTab([hq([{ string: 3, fret: 5, tap: true }, { string: 2, fret: 5, tap: true }, { string: 1, fret: 7 }])]), 1200);
  ok(dgroups(m3, 'tap').length === 2, `chord with 2 tapped notes: ${dgroups(m3, 'tap').length} T groups (one per staff)`);
  // a tapped harmonic note next to a plain tapped note in one chord: the chord still has a tap
  const m4 = renderTree(mkTab([hq([tapped, { string: 1, fret: 7, tap: true }])]), 1200);
  ok(dgroups(m4, 'tap').length === 2, 'plain tapped note in a chord with a tapped harmonic keeps the T');
});

// ---------- AC7 whammy dip ----------
test('directions', 'AC7: dip shape: path "M L L" with 3 points, middle lowest, symmetric; width in [1.6, 2.8] sp starting 0.3 sp right of the beat; limited by the next beat / last barline', () => {
  let dips = 0;
  for (const [fx, width] of DIRFIX) {
    const m = dirModel(fx, width);
    eachStaff(m, (tr, si) => {
      if (!tr.tab) return;
      const stg = staffOf(m, si, tr, true);
      const want = tr.beats.filter((b) => b.si === si && rawDip(b.raw) != null).sort((a, b) => a.x - b.x);
      const gs = dgroups(stg, 'whammy').sort((a, b) => num(a.children.find((c) => c.tag === 'text'), 'x') - num(b.children.find((c) => c.tag === 'text'), 'x'));
      ok(gs.length === want.length, `${fx.name} t${tr.ti} sys${si}: ${gs.length} dips, expected ${want.length}`);
      const sysBeats = tr.beats.filter((b) => b.si === si).map((b) => b.x);
      gs.forEach((g, i) => {
        ok(cls(g) === 'whammy whammy-dip', `class "${cls(g)}"`);
        const d = dipBox(g);
        ok(d.v.n === 6, `${fx.name}: dip path has ${d.v.n / 2} points`);
        ok(d.v.ym > d.v.y1 && d.v.y1 === d.v.y2, `${fx.name}: middle point must be lowest (y ${d.v.y1}, ${d.v.ym}, ${d.v.y2})`);
        near(d.v.xm, (d.v.x1 + d.v.x2) / 2, EPS, 'V symmetric');
        near(d.v.x1, want[i].x + 0.3 * SPD, EPS, `${fx.name}: dip start vs beat x`);
        const w = d.v.x2 - d.v.x1;
        ok(w >= 1.6 * SPD - EPS && w <= 2.8 * SPD + EPS, `${fx.name} t${tr.ti}: dip width ${w} outside [1.6, 2.8] sp`);
        const next = sysBeats.find((x) => x > want[i].x + EPS);
        const limit = Math.min(next ?? Infinity, m.layout.systems[si].lastBarlineX);
        ok(w <= Math.max(1.6 * SPD, limit - want[i].x - 0.9 * SPD) + EPS, `${fx.name} t${tr.ti}: dip width ${w} exceeds the room to ${limit}`);
        ok(d.v.x2 <= m.layout.systems[si].lastBarlineX + EPS, `${fx.name}: dip ends ${d.v.x2} past the last barline ${m.layout.systems[si].lastBarlineX}`);
        near(d.tx, d.v.xm, EPS, 'amount text centred over the V');
        ok(d.tBox.bottom <= d.v.y1 + EPS, 'amount text above the V');
        dips++;
      });
    });
  }
  ok(dips >= 8, `only ${dips} dips checked`);
});

test('directions', 'AC7: dip text is "-" + amount with exactly one leading "-" (true -> -1/2, "-1" -> -1, "1 1/2" -> -1 1/2, number, unicode minus, repeated signs, whitespace)', () => {
  const text = (w) => { const svg = renderTree(mkTab([hq([{ string: 3, fret: 5 }], { whammy: w }), hq([{ string: 3, fret: 5 }])], { showStandardNotation: false }), 1200); return dgroups(svg, 'whammy').map((g) => g.children.find((c) => c.tag === 'text')._text); };
  const cases = [[true, '-1/2'], ['-1', '-1'], ['1', '-1'], ['1 1/2', '-1 1/2'], [2, '-2'], [0.5, '-0.5'], ['−1', '-1'], ['--1', '-1'], ['-−1/4', '-1/4'], ['  1/4 ', '-1/4'],
    [{ type: 'dip', amount: '-3/4' }, '-3/4'], [{ type: 'dip' }, '-1/2'], [{ amount: '1' }, '-1'], [{ type: 'dip', amount: '' }, '-1/2'], ['full', '-full']];
  cases.forEach(([w, want]) => { const got = text(w); ok(got.length === 1 && got[0] === want, `whammy ${JSON.stringify(w)} -> ${JSON.stringify(got)}, expected "${want}"`); ok(!/^-[-−]/.test(got[0]), 'no double sign'); });
  // fixture texts equal the oracle, in x order
  const m = dirModel(DFX, 900);
  const got = []; const want = [];
  eachStaff(m, (tr, si) => {
    if (!tr.tab) return;
    got.push(...dgroups(staffOf(m, si, tr, true), 'whammy').map((g) => dipBox(g)).sort((a, b) => a.tx - b.tx).map((d) => d.label));
    want.push(...tr.beats.filter((b) => b.si === si && rawDip(b.raw) != null).sort((a, b) => a.x - b.x).map((b) => `-${rawDip(b.raw)}`));
  });
  ok(got.join('|') === want.join('|'), `fixture dip texts ${got.join('|')} vs oracle ${want.join('|')}`);
  ok(got.length >= 4, `only ${got.length} fixture dips`);
});

test('directions', 'AC7: dip bottom is >= 0.5 sp above the TAB top line and >= 0.4 sp above any bend / T / frets / earlier dip ink under it; label runs never hit the dip', () => {
  let overBend = 0; let overT = 0; let checked = 0;
  for (const [fx, width] of DIRFIX) {
    const m = dirModel(fx, width);
    eachStaff(m, (tr, si) => {
      if (!tr.tab) return;
      const stg = staffOf(m, si, tr, true);
      const info = staffInfo(stg);
      const ink = tabInk(stg);
      dgroups(stg, 'whammy').forEach((g) => {
        const d = dipBox(g);
        const span = { x1: d.vBox.x1, x2: d.vBox.x2 };
        ok(d.v.ym <= info.localTop - 0.5 * SPD + EPS, `${fx.name} t${tr.ti}: dip tip ${d.v.ym} within 0.5 sp of the TAB top line ${info.localTop}`);
        ink.filter((b) => ['bend', 'tap', 'fret'].includes(b.kind) && xover(span, b)).forEach((b) => {
          ok(d.v.ym <= b.top - 0.4 * SPD + EPS, `${fx.name} t${tr.ti}: dip tip ${d.v.ym} within 0.4 sp of ${b.kind} ink top ${b.top}`);
          if (b.kind === 'bend') overBend++; if (b.kind === 'tap') overT++;
        });
        ink.filter((b) => b.kind === 'label').forEach((b) => ok(!boxesHit(b, d.vBox) && !boxesHit(b, d.tBox), `${fx.name}: label ink hits a dip`));
        checked++;
      });
    });
  }
  ok(overBend >= 1, 'a dip over a bend is exercised');
  ok(overT >= 1, 'a dip over a T is exercised');
  ok(checked >= 8, `only ${checked} dips checked`);
});

// ---------- AC8 / AC9 rests, graces, garbage ----------
test('directions', 'AC8: nothing is drawn for pick strokes / tap / whammy on rests and grace notes (and a grace does not take the next beat\'s marks)', () => {
  const grace = (extra) => ({ type: 'grace', duration: '16th', notes: [{ string: 2, fret: 2, tap: true }], pickStroke: 'down', whammy: true, ...extra });
  const rest = { type: 'rest', duration: 'quarter', pickStroke: 'up', whammy: true, tap: true };
  for (const extra of [{ showStandardNotation: true }, { showStandardNotation: false }]) {
    const svg = renderTree(mkTab([rest, grace(), hq([{ string: 1, fret: 3 }]), rest], extra), 1200);
    ['pick-stroke', 'tap', 'whammy'].forEach((c) => ok(dgroups(svg, c).length === 0, `${c} drawn for a rest/grace (${JSON.stringify(extra)})`));
  }
  const nsvg = renderTree({ tracks: [{ name: 'N', showTablature: false, measures: [{ beats: [{ type: 'rest', duration: 'quarter', pickStroke: 'down' }, { type: 'grace', duration: '16th', pickStroke: 'up', notes: [{ pitch: 'C5', tap: true }] }, q('E4'), q('G4'), q('B4')] }] }] }, 1200);
  ['pick-stroke', 'tap'].forEach((c) => ok(dgroups(nsvg, c).length === 0, `${c} drawn on a notation rest/grace`));
  // fixture: the rest at m1 b3 / the grace in m4 add nothing; counts equal the oracle (AC4 test above); plus no direction x at a rest x
  const m = dirModel(DFX, 900);
  eachStaff(m, (tr, si) => {
    ['pick-stroke', 'tap', 'whammy'].forEach((c) => [true, false].forEach((tab) => {
      const stg = staffOf(m, si, tr, tab); if (!stg) return;
      const bad = tr.beats.filter((b) => b.si === si && !rawMain(b.raw));
      dgroups(stg, c).forEach((g) => { const x = num(g.children.find((k) => k.tag === 'text'), 'x'); bad.forEach((b) => ok(Math.abs(x - b.x) > 0.3 * SPD + 1, `${c} at x=${x} on a rest/grace beat x=${b.x}`)); });
    }));
  });
});

test('directions', 'AC9: garbage pickStroke / whammy / tap / letRing values draw nothing (or only valid parts), never throw, no NaN; whammy text goes in as text only', () => {
  const garbage = ['sideways', 5, 0, null, undefined, {}, [], true, false, '', ' ', NaN, () => 1, Symbol.iterator.toString()];
  garbage.forEach((v) => {
    const svg = renderTree(mkTab([hq([{ string: 3, fret: 5 }], { pickStroke: v }), hq([{ string: 3, fret: 5 }])]), 1200);
    ok(dgroups(svg, 'pick-stroke').length === 0, `pickStroke ${String(v)} drew ${dgroups(svg, 'pick-stroke').length} strokes`);
    ok(!/NaN|undefined/.test(serialize(svg)), `pickStroke ${String(v)}: bad number in output`);
  });
  const badWhammy = [false, null, undefined, '', ' ', '-', '--', '−', NaN, Infinity, -Infinity, [], ['1'], { type: 'scoop' }, { type: 'scoop', amount: '1' }, { type: 5 }, () => 1];
  badWhammy.forEach((v) => {
    let svg; try { svg = renderTree(mkTab([hq([{ string: 3, fret: 5 }], { whammy: v }), hq([{ string: 3, fret: 5 }])]), 1200); } catch (e) { ok(false, `whammy ${String(v)} threw ${e.message}`); }
    ok(dgroups(svg, 'whammy').length === 0, `whammy ${String(v)} drew a dip`);
    ok(!/NaN|undefined/.test(serialize(svg)), `whammy ${String(v)}: bad number in output`);
  });
  [{ type: 'dip', amount: { toString() { throw new Error('boom'); } } }].forEach((v) => {
    try { renderTree(mkTab([hq([{ string: 3, fret: 5 }], { whammy: v }), hq([{ string: 3, fret: 5 }])]), 1200); } catch (e) { ok(false, `throwing amount toString threw ${e.message}`); }
  });
  const evil = '<b onload="x">&"\'';
  const svg = renderTree(mkTab([hq([{ string: 3, fret: 5 }], { whammy: evil }), hq([{ string: 3, fret: 5 }])]), 1200);
  const w = dgroups(svg, 'whammy');
  ok(w.length === 1 && w[0].children.length === 2 && w[0].children[1]._text === `-${evil}`, 'amount reaches the SVG as textContent only (no extra child elements)');
  const bad = renderTree(mkTab([hq([{ string: 3, fret: 5, tap: 'no-such' }], {})]), 1200); // truthy tap is a tap
  ok(dgroups(bad, 'tap').length === 2, 'truthy tap values are taps');
  const falsy = renderTree(mkTab([hq([{ string: 3, fret: 5, tap: 0 }, { string: 2, fret: 5, tap: null }, { string: 1, fret: 5, tap: false }])]), 1200);
  ok(dgroups(falsy, 'tap').length === 0, 'falsy tap values draw nothing');
  const pick = renderTree(mkTab([hq([{ string: 3, fret: 5 }], { pickStroke: ' UP ' })]), 1200);
  ok(dgroups(pick, 'pick-stroke-up').length === 1, 'pickStroke is trimmed and case-insensitive');
  const lr = renderTree(mkTab([hq([{ string: 3, fret: 5 }], { letRing: 0 }), hq([{ string: 3, fret: 5 }], { letRing: '' }), hq([{ string: 3, fret: 5 }], { letRing: null })]), 1200);
  ok(dgroups(lr, 'let-ring').length === 0, 'falsy letRing draws nothing');
  const lr2 = renderTree(mkTab([hq([{ string: 3, fret: 5 }], { letRing: 'yes' }), hq([{ string: 3, fret: 5 }], { letRing: 1 })]), 1200);
  ok(dgroups(lr2, 'let-ring').length === 2 || dgroups(lr2, 'let-ring').length === 1, 'truthy letRing draws a run');
});

// ---------- AC10 placements per track kind ----------
test('directions', 'AC10: notation-only track: let ring below the staff (bottom line + 3.3 sp), pick strokes / T above the staff, no whammy, no TAB staff', () => {
  const m = dirModel(DFX, 900);
  const tr = m.tracks[1];
  const stg = staffOf(m, 0, tr, false);
  ok(!staffOf(m, 0, tr, true), 'no TAB staff for the notation-only track');
  const info = staffInfo(stg);
  const lets = dgroups(stg, 'let-ring');
  ok(lets.length === 1, `${lets.length} let-ring runs on the notation-only track`);
  lets.forEach((g) => ok(num(g.children[0], 'y') >= info.localBottom + 3.3 * SPD - EPS, 'let ring below the staff'));
  ok(dgroups(stg, 'whammy').length === 0, 'whammy is TAB-only: nothing on the notation-only track');
  const picks = picksIn(stg);
  ok(picks.length === 5, `${picks.length} pick strokes, expected 5 (G4 down, A5 up, E4 up, F5 down, whole D4 up)`);
  picks.forEach((p) => ok(p.bottom <= info.localTop, 'pick above the staff'));
  const taps = tapsIn(stg);
  ok(taps.length === 1 && taps[0].bottom <= info.localTop && picks.some((p) => Math.abs(p.x - taps[0].x) < 1 && p.bottom <= taps[0].top - 0.4 * SPD + EPS), 'T above the staff with the pick stroke above it');
  ok(all(m.svg).filter(({ n }) => n.tag === 'g' && dcls(n, 'whammy')).every(({ parents }) => parents.some((p) => dcls(p, 'staff-tab'))), 'every dip lives in a TAB staff');
});

test('directions', 'AC10: TAB-only track: picks above TAB, let ring in the TAB lane family, T and dips on the TAB, nothing drawn below', () => {
  const m = dirModel(DFX, 900);
  const tr = m.tracks[2];
  const stg = staffOf(m, 0, tr, true);
  const info = staffInfo(stg);
  const ink = tabInk(stg);
  ok(ink.filter((b) => b.kind === 'pick').length === 7, 'seven tab-only picks');
  ink.filter((b) => b.kind === 'pick' || b.kind === 'tap' || b.kind === 'dip' || b.kind === 'label').forEach((b) => ok(b.bottom <= info.localTop, `${b.kind} below the top TAB line`));
  ok(dgroups(stg, 'let-ring').length === 1, 'let-ring run on the TAB-only track');
  ok(dgroups(stg, 'whammy').length === 1 && dgroups(stg, 'tap').length === 1, 'one dip and one T on the TAB-only track');
});

// ---------- AC11 spacing, determinism ----------
test('directions', 'AC11: staves never overlap (ink bounds) and direction marks lie inside their staff ink on both direction fixtures, at several widths', () => {
  for (const [fx, w0] of DIRFIX) for (const width of [w0, 700, 1000, 1400]) {
    const svg = renderTree(fx.score, width, fx.options || {});
    const flat = [];
    systemsOf(svg).forEach((sg) => staffGroups(sg).forEach((g) => flat.push(staffInfo(g))));
    for (let i = 0; i < flat.length; i++) {
      const st = flat[i]; const ink = inkBounds(st.g, DEF);
      dgroups(st.g, 'pick-stroke').forEach((g) => { const p = pickBox(g); ok(ink.top <= p.top + EPS, `${fx.name}@${width}: pick stroke top ${p.top} above staff ink ${ink.top}`); });
      dgroups(st.g, 'whammy').forEach((g) => ok(ink.top <= dipBox(g).tBox.top + EPS, `${fx.name}@${width}: dip text above the staff ink`));
      dgroups(st.g, 'tap').forEach((g) => ok(ink.top <= tapBox(g).top + EPS, `${fx.name}@${width}: T above the staff ink`));
      if (i > 0) { const a = flat[i - 1]; ok(a.y + Math.max(inkBounds(a.g, DEF).bottom, a.localBottom) < st.y + Math.min(ink.top, 0), `${fx.name}@${width}: ink overlap between staves ${i - 1}/${i}`); }
    }
  }
});

test('directions', 'AC11: lane rules hold at other widths (let ring outside overlapping P.M., dash end inside the barline) and no NaN/undefined/Infinity anywhere', () => {
  for (const [fx] of DIRFIX) for (const width of [400, 500, 700, 1000, 1400, 1800]) {
    const svg = renderTree(fx.score, width, fx.options || {});
    const out = serialize(svg);
    ok(!/NaN|Infinity|undefined/.test(out), `${fx.name}@${width}: bad number`);
    const layout = layoutOf(fx.score, width, fx.options || {});
    systemsOf(svg).forEach((sg, si) => staffGroups(sg).forEach((stg) => {
      dgroups(stg, 'let-ring').forEach((g) => { const e = dashEnd(g); if (e != null) ok(e <= layout.systems[si].lastBarlineX - 0.5 * SPD + EPS, `${fx.name}@${width} sys${si}: let-ring dash past the barline`); });
      dgroups(stg, 'whammy').forEach((g) => ok(dipBox(g).v.x2 <= layout.systems[si].lastBarlineX + EPS, `${fx.name}@${width} sys${si}: dip past the last barline`));
    }));
  }
});

test('directions', 'determinism: direction fixtures render byte-identically twice; the input score is not mutated; direct render equals the cloned one', () => {
  for (const [fx, width] of DIRFIX) {
    const a = serialize(renderTree(fx.score, width, fx.options || {}));
    const b = serialize(renderTree(fx.score, width, fx.options || {}));
    ok(a === b, `${fx.name}: two renders differ`);
    const before = JSON.stringify(fx.score);
    const box = makeContainer(); new MusicScoreRenderer(box, fx.score, { width }).render();
    ok(JSON.stringify(fx.score) === before, `${fx.name}: input score mutated by render`);
    ok(serialize(box.children[0]) === a, `${fx.name}: direct render differs from the cloned one`);
  }
});

// ======================= rhythm on TAB staves =======================
// Local TAB staff geometry at the defaults (6 strings): bottom string y 75, stem tops 85 (gap 1.0 sp),
// quarter/8th/16th stem ends 110, 32nd 117.5, 64th 125, half 97.5; dot row 94.
{
const tn = (d, string, fret, extra = {}) => ({ type: 'note', duration: d, notes: [{ string, fret }], ...extra });
const tr = (d, extra = {}) => ({ type: 'rest', duration: d, ...extra });
const tabTrack = (measures, extra = {}) => ({ tracks: [{ name: 'G', showStandardNotation: false, showTablature: true, tabRhythm: true, measures, ...extra }] });
const tabStaves = (svg) => systemsOf(svg).flatMap(staffGroups).filter((g) => cls(g) === 'staff staff-tab');
const bands = (root) => byClass(root, 'tab-rhythm', 'g').map(({ n }) => n);
const kids = (gs, tag) => gs.flatMap((g) => g.children.filter((c) => c.tag === tag));
const pathNums = (p) => (p.getAttribute('d').match(/-?\d*\.?\d+/g) || []).map(Number);
const elementXs = (score, width = 900) => layoutOf(score, width).systems.flatMap((s) => s.tracks[0].measures)
  .map((m) => m.elements.filter((le) => le.el.type !== 'grace').map((le) => le.x));

test('tab-rhythm', 'stems: one per non-grace note beat at its x, from 1 sp below the bottom string; half short, whole none; pitch-only beats too', () => {
  const score = tabTrack([
    { beats: [tn('quarter', 6, 0), { type: 'grace', duration: '16th', notes: [{ string: 2, fret: 3 }] },
      { type: 'note', duration: 'half', notes: [{ string: 2, fret: 5 }, { string: 3, fret: 4 }] },
      { type: 'note', duration: 'quarter', notes: [{ pitch: 'E4' }] }] },
    { beats: [tn('whole', 3, 2)] },
  ]);
  const svg = renderTree(score);
  const stems = kids(bands(svg), 'line');
  const xs = elementXs(score)[0];
  ok(stems.length === 3, `3 stems, got ${stems.length}`);
  stems.forEach((l, i) => {
    near(num(l, 'x1'), xs[i], EPS, `stem ${i} x`); near(num(l, 'x2'), xs[i], EPS, `stem ${i} vertical`);
    near(num(l, 'y1'), 85, EPS, `stem ${i} top`);
    ok(l.getAttribute('stroke-width') === '1.3', 'stemWidth');
  });
  [110, 97.5, 110].forEach((y, i) => near(num(stems[i], 'y2'), y, EPS, `stem ${i} end`));
  ok(glyphs(svg, 0xE241).length === 0, 'no flags');
});

test('tab-rhythm', 'beams flat at the stem ends (levels stack toward the staff), stubs, group-max stem length; unbeamed flags at 0.75 size', () => {
  const score = tabTrack([
    { beats: [tn('8th', 1, 0), tn('8th', 1, 1), tn('8th', 1, 2, { dots: 1 }), tn('16th', 1, 3),
      tn('8th', 2, 0), tr('8th'), tn('32nd', 2, 1), tn('32nd', 2, 2), tn('32nd', 2, 3), tn('32nd', 2, 4), tn('8th', 2, 5)] },
    { beats: [tn('16th', 3, 0), tr('16th'), tr('8th'), tn('32nd', 3, 1), tr('32nd'), tr('16th'), tr('8th'),
      tn('64th', 3, 2), tr('64th'), tr('32nd'), tr('16th'), tr('8th'), tr('quarter')] },
  ]);
  const svg = renderTree(score);
  const [b1, b2] = bands(svg);
  const beams = kids([b1], 'path');
  // beat 1: one level; beat 2 (dotted 8th + 16th): primary + stub on the 16th; beat 4 (four 32nds + 8th): 3 levels
  ok(beams.length === 1 + 2 + 3, `beam paths ${beams.length}`);
  beams.forEach((p) => { const v = pathNums(p); ok(v[1] === v[3] && v[5] === v[7], `flat beam ${p.getAttribute('d')}`); });
  const ys = beams.map((p) => { const v = pathNums(p); return [v[1], v[5]]; });
  [[110, 105], [110, 105], [103, 98], [117.5, 112.5], [110.5, 105.5], [103.5, 98.5]].forEach((e, i) => {
    near(ys[i][0], e[0], EPS, `beam ${i} outer edge`); near(ys[i][1], e[1], EPS, `beam ${i} inner edge`);
  });
  const stub = pathNums(beams[2]);
  near(stub[0] - stub[2], 9, EPS, 'stub 0.9 sp, toward the previous note');
  const stems1 = kids([b1], 'line');
  ok(stems1.length === 10, `10 stems in m1, got ${stems1.length}`);
  stems1.slice(5).forEach((l) => near(num(l, 'y2'), 117.5, EPS, 'every stem of the 32nd group is 3.25 sp'));
  const f8 = glyphs(b1, 0xE241);
  ok(f8.length === 1 && num(f8[0], 'y') === 110 && f8[0].getAttribute('font-size') === '30', 'one 8th flag (before the rest), size 30, at the stem end');
  [[0xE243, 110], [0xE245, 117.5], [0xE247, 125]].forEach(([cp, y]) => {
    const f = glyphs(b2, cp);
    ok(f.length === 1, `flag U+${cp.toString(16)}`);
    near(num(f[0], 'y'), y, EPS, `flag U+${cp.toString(16)} at its stem end`);
    ok(f[0].getAttribute('font-size') === '30', 'flag size 0.75 x 40');
  });
});

test('tab-rhythm', 'beamed 64ths: 4.0 sp stems, four flat levels clear of the stem tops', () => {
  const svg = renderTree(tabTrack([{ beats: [...[1, 2, 3, 4].map((f) => tn('64th', 1, f)), tr('16th', { dots: 1 }), tr('quarter', { dots: 1 }), tr('quarter'), tr('8th')] }]));
  const b = bands(svg);
  kids(b, 'line').forEach((l) => near(num(l, 'y2'), 125, EPS, '64th stem end'));
  const beams = kids(b, 'path');
  ok(beams.length === 4, `4 levels, got ${beams.length}`);
  near(Math.min(...beams.map((p) => Math.min(...pathNums(p).filter((_, i) => i % 2)))), 99, EPS, 'innermost level top 1.4 sp below the stem tops');
});

test('tab-rhythm', 'augmentation dots on one row (stem top + 0.9 sp): past the stem, past a scaled flag, after a whole note', () => {
  const score = tabTrack([
    { beats: [tn('quarter', 1, 0, { dots: 1 }), tn('8th', 1, 1), tn('8th', 1, 2, { dots: 1 }), tr('16th'), tn('quarter', 1, 3)] },
    { beats: [tn('quarter', 1, 3, { dots: 2 }), tr('16th'), tn('half', 1, 0)] },
    { timeSignature: { beats: 6, beatType: 4 }, beats: [tn('whole', 1, 0, { dots: 1 })] },
  ]);
  const svg = renderTree(score);
  const xs = elementXs(score);
  const dots = kids(bands(svg), 'circle');
  ok(dots.length === 5, `5 dots, got ${dots.length}`);
  dots.forEach((c) => { near(num(c, 'cy'), 94, EPS, 'dot row'); near(num(c, 'r'), 1.7, EPS, 'dot radius'); });
  near(num(dots[0], 'cx'), xs[0][0] + 5, EPS, 'dotted quarter: stem + 0.5 sp');
  near(num(dots[1], 'cx'), xs[0][2] + 12.68, EPS, 'dotted unbeamed 8th: flag width x 0.75 + 0.35 sp');
  near(num(dots[3], 'cx') - num(dots[2], 'cx'), 5, EPS, 'double dot step 0.5 sp');
  near(num(dots[2], 'cx'), xs[1][0] + 5, EPS, 'double-dotted quarter');
  near(num(dots[4], 'cx'), xs[2][0] + 5, EPS, 'whole note: x + 0.5 sp');
});

test('tab-rhythm', 'tuplets: number under a beam group that is exactly the tuplet; bracket with up-ticks otherwise; class tab-tuplet', () => {
  const t3 = { tuplet: 3 };
  const score = tabTrack([{ beats: [tn('8th', 1, 0, t3), tn('8th', 1, 1, t3), tn('8th', 1, 2, t3),
    tn('8th', 1, 3, t3), tr('8th', t3), tn('8th', 1, 4, t3), tn('half', 2, 0)] }]);
  const svg = renderTree(score);
  const xs = elementXs(score)[0];
  const tup = byClass(svg, 'tab-tuplet', 'g').map(({ n }) => n);
  ok(tup.length === 2, `2 tab-tuplet groups, got ${tup.length}`);
  ok(byClass(svg, 'tuplet').length === 0, 'no notation "tuplet" class on the TAB staff');
  const [num1, br] = tup;
  ok(num1.children.length === 1 && num1.children[0].tag === 'text' && num1.children[0].textContent === '3', 'number only');
  near(num(num1.children[0], 'x'), (xs[0] + xs[2]) / 2, EPS, 'number centred between the stems');
  near(num(num1.children[0], 'y'), 110 + 3 + 0.8 * 11, EPS, 'number top 0.3 sp under the beam');
  const paths = br.children.filter((c) => c.tag === 'path');
  ok(paths.length === 2 && br.children.some((c) => c.tag === 'text' && c.textContent === '3'), 'bracket: two halves and a number');
  const [p1, p2] = paths.map(pathNums);
  const y = p1[3];
  ok(p1[1] === y - 5 && p2[5] === y - 5, 'ticks point up 0.5 sp');
  ok(y >= 110.3 + 6 - EPS, `bracket below the flags: ${y}`);
  near(p1[0], xs[3] - 5, EPS, 'bracket starts 0.5 sp before the first beat');
  near(p2[4], xs[5] + 5, EPS, 'bracket ends 0.5 sp after the last beat');
});

test('tab-rhythm', 'rests: whole hangs from string floor(c), half sits on string ceil(c), shorter centred; knock-outs only for quarter and shorter (4/5/6/7 strings)', () => {
  const tunings = { 4: ['E1', 'A1', 'D2', 'G2'], 5: ['B0', 'E1', 'A1', 'D2', 'G2'], 6: undefined, 7: ['B1', 'E2', 'A2', 'D3', 'G3', 'B3', 'E4'] };
  for (const [nStr, tuning] of Object.entries(tunings)) {
    const n = Number(nStr);
    const svg = renderTree(tabTrack([{ beats: [tr('half'), tr('quarter'), tr('8th'), tr('8th')] }, { beats: [tr('whole')] }, { beats: [] }], tuning ? { tuning } : {}));
    const L = (n - 1) * 15;
    const c = (n + 1) / 2;
    const stringY = (k) => L - (n - k) * 15;
    const rests = byClass(svg, 'tab-rest', 'g').map(({ n: g }) => g);
    ok(rests.length === 6, `${n} strings: 6 rests, got ${rests.length}`);
    const glyphOf = (g) => g.children.find((k) => k.tag === 'text');
    const rectOf = (g) => g.children.find((k) => k.tag === 'rect');
    near(num(glyphOf(rests[0]), 'y'), stringY(Math.ceil(c)), EPS, `${n}: half rest on string ${Math.ceil(c)}`);
    ok(!rectOf(rests[0]), `${n}: no knock-out for a half rest`);
    near(num(glyphOf(rests[1]), 'y'), L / 2 - 0.04, EPS, `${n}: quarter rest centred`);
    ok(rectOf(rests[1]) && rectOf(rests[1]).getAttribute('fill') === '#ffffff', `${n}: quarter rest knock-out`);
    near(num(rectOf(rests[1]), 'y'), L / 2 - 0.04 - 14.92 - 2, EPS, `${n}: knock-out = box + 0.2 sp`);
    ok(rests[1].children.indexOf(rectOf(rests[1])) < rests[1].children.indexOf(glyphOf(rests[1])), 'knock-out under the glyph');
    [rests[4], rests[5]].forEach((g, i) => {
      near(num(glyphOf(g), 'y'), stringY(Math.floor(c)), EPS, `${n}: whole-measure rest ${i} hangs from string ${Math.floor(c)}`);
      ok(cpOf(glyphOf(g)) === 0xE4E3 && !rectOf(g), `${n}: whole rest glyph, no knock-out`);
    });
  }
});

test('tab-rhythm', 'empty measures: authored beats: [] gets a whole-measure rest, normalize padding (missing / null) stays blank; no empty groups', () => {
  const score = { tracks: [
    { name: 'A', showTablature: false, measures: [bar4(), bar4(), bar4(), bar4()] },
    { name: 'B', showStandardNotation: false, showTablature: true, tabRhythm: true, measures: [{ beats: [] }, null, { beats: [tr('whole')] }] },
  ] };
  const svg = renderTree(score);
  ok(bands(svg).length === 2, `2 tab-rhythm groups, got ${bands(svg).length}`);
  ok(byClass(svg, 'tab-rest', 'g').length === 2, 'rests in m1 and m3 only');
  const lay = layoutOf(score, 900).systems.flatMap((s) => s.tracks[1].measures);
  ok(JSON.stringify(lay.map((m) => m.padded)) === '[false,true,false,true]', `padded ${lay.map((m) => m.padded)}`);
  ok(all(svg).filter(({ n }) => n.tag === 'g' && !n.children.length).length === 0, 'no empty <g>');
});

test('tab-rhythm', 'grace notes get no stem, flag, dot or beam; rest dots sit in a space', () => {
  const svg = renderTree(tabTrack([{ beats: [{ type: 'grace', duration: '16th', notes: [{ string: 3, fret: 2 }] }, tn('quarter', 3, 4),
    tr('quarter', { dots: 1 }), tn('8th', 1, 0), tn('half', 1, 0)] }]));
  ok(kids(bands(svg), 'line').length === 3, 'stems for the three main notes only');
  const rd = byClass(svg, 'tab-rest', 'g')[0].n.children.filter((c) => c.tag === 'circle');
  ok(rd.length === 1, 'one rest dot');
  near(num(rd[0], 'cy'), 37.5, EPS, '6 strings: rest dot in the middle space');
  const five = renderTree(tabTrack([{ beats: [tr('half', { dots: 1 }), tr('quarter')] }], { tuning: ['B0', 'E1', 'A1', 'D2', 'G2'] }));
  near(num(byClass(five, 'tab-rest', 'g')[0].n.children.find((c) => c.tag === 'circle'), 'cy'), 22.5, EPS, '5 strings: space above the centre line');
});

test('tab-rhythm', 'AC10: nothing above or on the TAB staff moves; notation staff unchanged; band adds 3.5 sp of bottom ink (~5 sp with a tuplet number)', () => {
  const marks = { measures: [
    { beats: [tn('quarter', 3, 5, { palmMute: true }), { type: 'note', duration: 'quarter', notes: [{ string: 2, fret: 7, bend: 'full' }] },
      { type: 'note', duration: '8th', notes: [{ string: 1, fret: 5 }] }, { type: 'note', duration: '8th', notes: [{ string: 1, fret: 7, hammerPull: true }] },
      tn('quarter', 2, 5, { vibrato: true })] },
    { beats: [{ type: 'note', duration: 'quarter', notes: [{ string: 2, fret: 3, slide: 'up' }] }, tn('quarter', 2, 5), tn('half', 3, 4)] },
  ] };
  for (const notation of [false, true]) {
    const mk = (on) => ({ tracks: [{ name: 'G', showStandardNotation: notation, showTablature: true, tabRhythm: on, ...marks }] });
    const on = renderTree(mk(true)); const off = renderTree(mk(false));
    const strip = (g) => g.children.filter((c) => cls(c) !== 'tab-rhythm').map(serialize).join('');
    const [tOn, tOff] = [tabStaves(on)[0], tabStaves(off)[0]];
    ok(strip(tOn) === strip(tOff), `notation ${notation}: TAB staff content identical apart from the band`);
    ok(translateY(tOn) === translateY(tOff), 'TAB staff not moved');
    if (notation) {
      const n = (svg) => serialize(staffGroups(systemsOf(svg)[0]).find((g) => cls(g) === 'staff staff-notation'));
      ok(n(on) === n(off), 'notation staff identical');
    }
    const t = resolveTheme();
    near(inkBounds(tOn, t).top, inkBounds(tOff, t).top, EPS, 'TAB top ink unchanged');
    near(inkBounds(tOn, t).bottom - 75, 35, EPS, 'bottom ink 3.5 sp below the bottom string');
  }
  const t3 = { tuplet: 3 };
  const tup = renderTree(tabTrack([{ beats: [tn('8th', 1, 0, t3), tn('8th', 1, 1, t3), tn('8th', 1, 2, t3), tn('half', 2, 0, { dots: 1 })] }]));
  near(inkBounds(tabStaves(tup)[0], resolveTheme()).bottom - 75, 49.55, EPS, 'beamed tuplet number: ~5 sp');
});

test('tab-rhythm', 'theme: tabFretColor on all band ink, background knock-outs, tabStemGapSp / tabStemLengthSp / tabHalfStemLengthSp / tabFlagScale', () => {
  const theme = { tabFretColor: '#c00000', background: '#fafafa', tabStemGapSp: 2, tabStemLengthSp: 3, tabHalfStemLengthSp: 2, tabFlagScale: 0.5 };
  const t3 = { tuplet: 3 };
  const svg = renderTree(tabTrack([
    { beats: [tn('quarter', 1, 0, { dots: 1 }), tn('8th', 1, 1), tn('8th', 1, 2), tn('8th', 1, 3), tr('quarter', { dots: 1 }), tn('8th', 1, 4)] },
    { beats: [tn('8th', 1, 0, t3), tr('8th', t3), tn('8th', 1, 2, t3), tn('half', 2, 0), tr('quarter')] },
  ]), 900, { theme });
  const ink = bands(svg).flatMap((g) => [...walk(g)].map(({ n }) => n)).filter((n) => n.tag !== 'g');
  ink.forEach((n) => {
    const stroke = n.getAttribute('stroke');
    const c = n.tag === 'rect' ? n.getAttribute('fill') : (stroke && stroke !== 'none' ? stroke : n.getAttribute('fill'));
    ok(c === (n.tag === 'rect' ? '#fafafa' : '#c00000'), `${n.tag} colour ${c}`);
  });
  const stems = kids(bands(svg), 'line');
  stems.forEach((l) => near(num(l, 'y1'), 95, EPS, 'gap 2 sp'));
  near(num(stems[0], 'y2'), 125, EPS, 'quarter stem 3 sp');
  near(num(stems[stems.length - 1], 'y2'), 115, EPS, 'half stem 2 sp');
  ok(glyphs(svg, 0xE241).every((f) => f.getAttribute('font-size') === '20'), 'flags at 0.5 x 40');
});

test('tab-rhythm', "off with notation by default ('auto' / absent), off with tabRhythm: false or no TAB staff; unknown durations still throw; deterministic", () => {
  const nt = (on) => ({ tracks: [{ showTablature: true, ...(on === undefined ? {} : { tabRhythm: on }), measures: [{ beats: [tn('quarter', 1, 0), tn('half', 1, 2), tr('quarter')] }] }] });
  ok(bands(renderTree(nt(undefined))).length === 0, 'notation + TAB, absent');
  ok(bands(renderTree(nt('auto'))).length === 0, "notation + TAB, 'auto'");
  ok(bands(renderTree(nt(false))).length === 0, 'notation + TAB, false');
  ok(bands(renderTree(nt(true))).length === 1, 'notation + TAB, true');
  ok(bands(renderTree({ tracks: [{ showTablature: false, tabRhythm: true, measures: [{ beats: [q('E4')] }] }] })).length === 0, 'no TAB staff');
  let threw = null;
  try { renderTree(tabTrack([{ beats: [tn('bogus', 1, 0)] }])); } catch (e) { threw = e.message; }
  ok(/Unknown duration/.test(threw || ''), `unknown duration throws (${threw})`);
  const s = tabTrack([{ beats: [tn('8th', 1, 0), tn('8th', 1, 1), tr('quarter', { dots: 1 }), tn('8th', 1, 0, { dots: 1 }), tn('32nd', 1, 0), tr('32nd')] }]);
  ok(serialize(renderTree(s)) === serialize(renderTree(s)), 'deterministic');
});

// ---- verification (test-writer): oracles are ui.md numbers + the raw score + layout x's, not src geometry helpers ----
const { renderTabElement } = await imp('src/draw/tab.js');
const LV = { whole: 0, half: 0, quarter: 0, '8th': 1, '16th': 2, '32nd': 3, '64th': 4 };
const FLAG_CP = { '8th': 0xE241, '16th': 0xE243, '32nd': 0xE245, '64th': 0xE247 };
const REST_CP = { whole: 0xE4E3, half: 0xE4E4, quarter: 0xE4E5, '8th': 0xE4E6, '16th': 0xE4E7, '32nd': 0xE4E8, '64th': 0xE4E9 };
// ui.md section 8: rest half-widths (sp); whole / half are Bravura's 1.128 sp wide boxes (not quoted in ui.md)
const REST_HALF_W = { whole: 0.564, half: 0.564, quarter: 0.54, '8th': 0.49, '16th': 0.64, '32nd': 0.73, '64th': 0.85 };
// ui.md sections 3 / 8: unbeamed flag right edge at the default 0.75 scale (sp) and its tail below the stem end
const FLAG_RIGHT = { '8th': 0.918, '16th': 0.87, '32nd': 0.82, '64th': 0.83 };
// ui.md quotes only 32nd / 64th; the 8th / 16th flag boxes also hang 0.04 x 0.75 = 0.03 sp below the stem end (Bravura)
const FLAG_TAIL = { '8th': 0.03, '16th': 0.03, '32nd': 0.52, '64th': 0.98 };
const TOL_UI = 0.06;      // ui.md quotes 2-decimal sp values: 0.005 sp = 0.05 px at the default staff size
const WIDTHS_TR = [600, 900];

function tabModel(score, width = 900, options = {}) {
  const theme = resolveTheme(options.theme);
  const ns = normalizeScore(clone(score));
  const layout = computeLayout(ns, theme, width);
  const svg = renderTree(score, width, options);
  const staves = [];
  systemsOf(svg).forEach((sg, si) => staffGroups(sg).forEach((g) => {
    if (cls(g) !== 'staff staff-tab') return;
    const ti = Number(g.getAttribute('data-track'));
    const st = staffInfo(g);
    staves.push({ si, ti, g, st, sys: sg, n: Math.round((st.localBottom - st.localTop) / theme.tabStaffLineSpacing) + 1,
      rhythm: !!ns.tracks[ti].tabRhythm, measures: layout.systems[si].tracks[ti].measures,
      bands: g.children.filter((c) => cls(c) === 'tab-rhythm') });
  }));
  return { svg, theme, ns, layout, staves };
}
/** Non-grace beats of a rhythm staff with the independently derived stem geometry. */
function beatsOf(stv, theme) {
  const sp = theme.staffLineSpacing;
  const lb = stv.st.localBottom;
  const knockSp = (theme.tabFontSize / 2 + 0.1 * sp) / sp;
  const top = lb + Math.max(theme.tabStemGapSp, knockSp + 0.2) * sp;
  const beats = [];
  stv.measures.forEach((m, mi) => {
    const byIndex = new Map(m.elements.map((le) => [le.index, le]));
    const grpOf = new Map();
    m.beamGroups.forEach((grp) => {
      if (grp.length < 2) return;
      const lv = Math.max(...grp.map((i) => LV[byIndex.get(i).el.duration]));
      grp.forEach((i) => grpOf.set(i, { grp, lv }));
    });
    m.elements.forEach((le) => {
      if (le.el.type === 'grace') return;
      const d = le.el.duration;
      const g = grpOf.get(le.index);
      const levels = g ? g.lv : LV[d];
      const len = d === 'whole' ? 0 : d === 'half' ? theme.tabHalfStemLengthSp : theme.tabStemLengthSp + 0.75 * Math.max(0, levels - 2);
      beats.push({ mi, m, le, x: le.x, el: le.el, d, g, levels, end: top + len * sp, isRest: le.el.type === 'rest', isNote: le.el.type !== 'rest' });
    });
  });
  return { beats, top, lb, sp };
}
const bandKids = (stv, tag) => stv.bands.flatMap((b) => b.children.filter((c) => c.tag === tag));
const bandGroups = (stv, c) => stv.bands.flatMap((b) => b.children.filter((k) => k.tag === 'g' && cls(k) === c));
const fretRects = (stv, bg) => stv.g.children.filter((c) => c.tag === 'rect' && c.getAttribute('fill') === bg);
const rhythmStaves = (m) => m.staves.filter((s) => s.rhythm);
function expectedRests(stv) {
  const out = [];
  stv.measures.forEach((m) => {
    if (m.wholeRest && !m.elements.length) { if (!m.padded) out.push({ x: m.wholeRest.x, d: 'whole', dots: 0, wm: true }); return; }
    m.elements.forEach((le) => {
      if (le.el.type !== 'rest') return;
      out.push({ x: le.x, d: le.wholeMeasureRest ? 'whole' : le.el.duration, dots: le.wholeMeasureRest ? 0 : le.el.dots || 0, wm: !!le.wholeMeasureRest });
    });
  });
  return out;
}
const TUNINGS = { 4: ['E1', 'A1', 'D2', 'G2'], 5: ['B0', 'E1', 'A1', 'D2', 'G2'], 6: undefined, 7: ['B1', 'E2', 'A2', 'D3', 'G3', 'B3', 'E4'] };
const rep = (n, f) => Array.from({ length: n }, f);

test('tab-rhythm', 'AC1: no tab-rhythm / tab-rest / tab-tuplet node unless the track resolves tabRhythm; none in the 4 rhythm-off guard fixtures or the examples', () => {
  const isBand = (n) => /^tab-(rhythm|rest|tuplet)$/.test(cls(n));
  let without = 0; let withR = 0;
  for (const [name, score, options] of SCORES) for (const width of [600, 900, 1400]) {
    const m = tabModel(score, width, options);
    const total = all(m.svg).filter(({ n }) => isBand(n)).length;
    const inside = m.staves.filter((s) => s.rhythm).reduce((a, s) => a + all(s.g).filter(({ n }) => isBand(n)).length, 0);
    ok(total === inside, `${name}@${width}: band nodes outside rhythm TAB staves (${total} vs ${inside})`);
    m.staves.filter((s) => !s.rhythm).forEach((s) => ok(all(s.g).filter(({ n }) => isBand(n)).length === 0, `${name}@${width}: band in a TAB staff without rhythm`));
    if (!m.ns.tracks.some((t) => t.tabRhythm)) { without++; ok(total === 0, `${name}@${width}: ${total} band nodes without any rhythm track`); } else withR++;
  }
  ok(without >= 20 && withR >= 4, `both kinds covered (${without}/${withR})`);
  const guards = characterizationCases.filter((c) => /-rhythm-off$/.test(c.name));
  ok(guards.length === 4, `4 guard fixtures, got ${guards.length}`);
  guards.forEach((c) => {
    ok(c.score.tracks.some((t) => t.showTablature !== false), `${c.name}: has a TAB track`);
    ok(!/tab-(rhythm|rest|tuplet)/.test(serialize(renderTree(c.score, c.width, c.options || {}))), `${c.name}: has band nodes`);
  });
  ['example-score', 'lead-riff', 'articulations'].forEach((nm) => {
    const [, score, options] = SCORES.find(([n]) => n === nm);
    ok(!/tab-(rhythm|rest|tuplet)/.test(serialize(renderTree(score, 900, options))), `${nm}: has band nodes`);
  });
  const base = [{ beats: [tn('quarter', 1, 0), tn('8th', 1, 1), tn('8th', 1, 2), tr('half')] }];
  ok(bands(renderTree(tabTrack(base, { tabRhythm: false }))).length === 0, 'tabRhythm false: nothing');
  ok(bands(renderTree(tabTrack(base, { tabRhythm: 'auto' }))).length === 1, "tab-only 'auto': drawn");
  ok(bands(renderTree({ tracks: [{ showStandardNotation: false, showTablature: true, measures: base }] })).length === 1, 'tab-only, field absent: drawn');
});

test('tab-rhythm', 'AC3/AC4: every non-grace note beat of a rhythm TAB staff has one stem at its x (all SCORES x 600/900); top, length per duration / beam levels; whole none; pitch-only too', () => {
  let stemsChecked = 0; let pitchOnly = 0;
  for (const [name, score, options] of SCORES) for (const width of WIDTHS_TR) {
    const m = tabModel(score, width, options);
    for (const stv of rhythmStaves(m)) {
      const { beats, top } = beatsOf(stv, m.theme);
      const want = beats.filter((b) => b.isNote && b.d !== 'whole');
      const got = bandKids(stv, 'line');
      const tag = `${name}@${width} sys${stv.si}`;
      ok(got.length === want.length, `${tag}: ${got.length} stems for ${want.length} stem-bearing beats`);
      const rects = fretRects(stv, m.theme.background);
      want.forEach((b, i) => {
        const l = got[i];
        near(num(l, 'x1'), b.x, EPS, `${tag} stem ${i} x`); near(num(l, 'x2'), b.x, EPS, `${tag} stem ${i} vertical`);
        near(num(l, 'y1'), top, EPS, `${tag} stem ${i} top`); near(num(l, 'y2'), b.end, EPS, `${tag} stem ${i} end (${b.d}, ${b.levels} levels)`);
        ok(num(l, 'y1') > stv.st.localBottom, `${tag}: stem starts below the bottom string`);
        ok(l.getAttribute('stroke') === m.theme.tabFretColor && num(l, 'stroke-width') === m.theme.stemWidth, `${tag}: stem stroke`);
        const fretted = (b.el.notes || []).some((n) => n.string != null && n.fret != null);
        if (fretted) ok(rects.some((r) => Math.abs(num(r, 'x') + num(r, 'width') / 2 - num(l, 'x1')) < 0.02), `${tag}: stem ${i} is not on the fret label centre`);
        else pitchOnly++;
        stemsChecked++;
      });
    }
  }
  ok(stemsChecked >= 150 && pitchOnly >= 1, `coverage: ${stemsChecked} stems, ${pitchOnly} pitch-only`);
});

test('tab-rhythm', 'AC3/AC4: stem top = bottom string + max(tabStemGapSp, fret knock-out half height + 0.2 sp); a chord has one stem; wide labels (x), (12), <12> keep the stem on the beat x; whole chord none', () => {
  const lbl = (extra) => ({ type: 'note', duration: 'quarter', notes: [{ string: 6, fret: 12, ...extra }] });
  const score = tabTrack([{ beats: [lbl({ mute: true }), lbl({ ghost: true }), lbl({ harmonic: true }),
    { type: 'note', duration: 'quarter', notes: [{ string: 6, fret: 3 }, { string: 5, fret: 2 }, { string: 4, fret: 0 }] }] },
  { beats: [{ type: 'note', duration: 'whole', notes: [{ string: 6, fret: 3 }, { string: 4, fret: 0 }] }] }]);
  const run = (theme) => {
    const m = tabModel(score, 900, { theme });
    const stv = m.staves[0];
    const stems = bandKids(stv, 'line');
    ok(stems.length === 4, `4 stems (one per chord, none for the whole chord), got ${stems.length}`);
    const xs = layoutOf(score, 900, { theme }).systems[0].tracks[0].measures[0].elements.map((le) => le.x);
    stems.forEach((l, i) => near(num(l, 'x1'), xs[i], EPS, `stem ${i} on the beat x`));
    return stems.map((l) => num(l, 'y1') - stv.st.localBottom);
  };
  run().forEach((d) => near(d, 10, EPS, 'default gap 1.0 sp'));
  run({ tabStemGapSp: 0.5 }).forEach((d) => near(d, 9, EPS, 'gap 0.5 sp is floored at 0.7 + 0.2 sp'));
  run({ tabStemGapSp: 3 }).forEach((d) => near(d, 30, EPS, 'gap 3 sp'));
  run({ tabFontSize: 30 }).forEach((d) => near(d, 18, EPS, 'tabFontSize 30: knock-out half 1.6 sp + 0.2'));
  run({ staffLineSpacing: 12 }).forEach((d) => near(d, 12, EPS, 'sp 12: gap 1.0 sp = 12 px (knock-out floor 0.8 sp)'));
});

// expected beam rectangles of every beam group (ui.md section 2) for a rhythm staff
function expectedBeams(beats, theme) {
  const sp = theme.staffLineSpacing; const cap = theme.stemWidth / 2 + 0.04 * sp;
  const out = []; const seen = new Set();
  beats.forEach((b) => {
    if (!b.g || seen.has(b.g.grp)) return; seen.add(b.g.grp);
    const bs = b.g.grp.map((i) => beats.find((t) => t.m === b.m && t.le.index === i));
    const counts = bs.map((t) => LV[t.d]); const xs = bs.map((t) => t.x); const last = bs.length - 1;
    for (let lvl = 0; lvl < b.g.lv; lvl++) {
      const outer = b.end - lvl * (theme.beamWidth + 0.2 * sp);
      let s = null;
      for (let i = 0; i <= bs.length; i++) {
        const has = i < bs.length && counts[i] >= lvl + 1;
        if (has && s === null) s = i;
        if (!has && s !== null) {
          const e = i - 1;
          if (s === e) out.push({ outer, stub: true, a: s === last ? xs[s] - 0.9 * sp : xs[s] - (s === 0 ? cap : 0), b: s === last ? xs[s] : xs[s] + 0.9 * sp });
          else out.push({ outer, stub: false, a: xs[s] - (s === 0 ? cap : 0), b: xs[e] + (e === last ? cap : 0) });
          s = null;
        }
      }
    }
  });
  return out;
}

test('tab-rhythm', 'AC5: beams (all SCORES x 600/900): flat, primary outer edge at the stem ends, levels stack toward the staff, stubs 0.9 sp, caps; flags only on unbeamed 8th+ at 0.75 size, origin at the stem end', () => {
  let nBeams = 0; let nFlags = 0; let nStubs = 0;
  for (const [name, score, options] of SCORES) for (const width of WIDTHS_TR) {
    const m = tabModel(score, width, options);
    for (const stv of rhythmStaves(m)) {
      const { beats, top, sp } = beatsOf(stv, m.theme);
      const tag = `${name}@${width} sys${stv.si}`;
      const want = expectedBeams(beats, m.theme);
      const got = bandKids(stv, 'path').map((p) => { const v = pathNums(p); return { v, outer: v[1], inner: v[5], a: Math.min(v[0], v[2]), b: Math.max(v[0], v[2]), p }; });
      ok(got.length === want.length, `${tag}: ${got.length} beam paths, expected ${want.length}`);
      const sorter = (p, q) => Math.round((p.outer - q.outer) * 100) || Math.round((p.a - q.a) * 100);
      got.sort(sorter); want.sort(sorter);
      got.forEach((g, i) => {
        const w = want[i];
        ok(g.v[1] === g.v[3] && g.v[5] === g.v[7], `${tag}: beam ${i} is flat`);
        near(g.outer, w.outer, EPS, `${tag} beam ${i} outer edge`);
        near(g.outer - g.inner, m.theme.beamWidth, EPS, `${tag} beam ${i} thickness`);
        near(g.a, w.a, EPS, `${tag} beam ${i} left end${w.stub ? ' (stub)' : ''}`); near(g.b, w.b, EPS, `${tag} beam ${i} right end${w.stub ? ' (stub)' : ''}`);
        ok(g.p.getAttribute('fill') === m.theme.tabFretColor, `${tag}: beam colour`);
        if (w.stub) nStubs++;
        nBeams++;
      });
      // the innermost level keeps >= 1.3 sp of bare stem below the stem top (ui.md section 10; default sizes)
      if (m.theme.staffLineSpacing === 10 && m.theme.beamWidth === 5) got.forEach((g) => ok(g.inner >= top + 13 - EPS, `${tag}: beam too close to the stem top`));
      const flagWant = beats.filter((b) => b.isNote && FLAG_CP[b.d] && !b.g);
      const flagGot = bandKids(stv, 'text');
      ok(flagGot.length === flagWant.length, `${tag}: ${flagGot.length} flags, expected ${flagWant.length}`);
      flagGot.forEach((f, i) => {
        const b = flagWant[i];
        ok(cpOf(f) === FLAG_CP[b.d], `${tag}: flag ${i} glyph for ${b.d}`);
        near(num(f, 'x'), b.x, EPS, `${tag} flag ${i} x = stem x`); near(num(f, 'y'), b.end, EPS, `${tag} flag ${i} y = stem end`);
        near(num(f, 'font-size'), 4 * sp * m.theme.tabFlagScale, EPS, `${tag} flag ${i} size`);
        ok(f.getAttribute('fill') === m.theme.tabFretColor, `${tag}: flag colour`);
        nFlags++;
      });
    }
  }
  ok(nBeams >= 40 && nFlags >= 20 && nStubs >= 2, `coverage: ${nBeams} beams, ${nFlags} flags, ${nStubs} stubs`);
});

test('tab-rhythm', 'AC5: beam-group cases: group-max stem length (8th + 16th + 32nd + 32nd), rests break groups, quarter / half never flagged or beamed, 6/8 = two beams of three', () => {
  const score = tabTrack([
    { beats: [tn('8th', 1, 0), tn('16th', 1, 1), tn('32nd', 1, 2), tn('32nd', 1, 3), tn('8th', 1, 4), tn('8th', 1, 5), tn('quarter', 1, 6), tn('quarter', 1, 7)] },
    { timeSignature: { beats: 6, beatType: 8 }, beats: rep(6, (_, i) => tn('8th', 1, i)) },
    { timeSignature: { beats: 4, beatType: 4 }, beats: [tn('8th', 1, 0), tr('8th'), tn('8th', 1, 1), tn('8th', 1, 2), tn('half', 1, 3), tn('half', 1, 3)].slice(0, 5).concat([tr('quarter')]) },
  ]);
  const b = bands(renderTree(score));
  const lens = kids([b[0]], 'line').map((l) => num(l, 'y2'));
  ok(lens.length === 8, `8 stems, got ${lens.length}`);
  [0, 1, 2, 3].forEach((i) => near(lens[i], 117.5, EPS, `group stem ${i} is 3.25 sp (32nd level)`));
  [4, 5, 6, 7].forEach((i) => near(lens[i], 110, EPS, `stem ${i} is 2.5 sp`));
  ok(glyphs(b[0], 0xE241).length === 0 && glyphs(b[0], 0xE243).length === 0, 'no flags in m1');
  ok(kids([b[0]], 'path').length === 3 + 1, `m1: group 1 has 3 levels (primary + 2nd + 3rd), group 2 one: ${kids([b[0]], 'path').length}`);
  ok(kids([b[1]], 'path').length === 2 && glyphs(b[1], 0xE241).length === 0, '6/8: two beams, no flags');
  // m3: 8th, rest, 8th, 8th, half, rest -> first 8th unbeamed (flag), the next two a beam group
  ok(glyphs(b[2], 0xE241).length === 1 && kids([b[2]], 'path').length === 1, 'a rest breaks the group: one flag, one beam');
});

test('tab-rhythm', 'AC6: dot row y = stem top + 0.9 sp, radius 0.17 sp, tabFretColor; x per rule (all SCORES x 600/900), also scaled flag widths for 8th..64th', () => {
  let nDots = 0; let flagged = 0;
  for (const [name, score, options] of SCORES) for (const width of WIDTHS_TR) {
    const m = tabModel(score, width, options);
    for (const stv of rhythmStaves(m)) {
      const { beats, top, sp } = beatsOf(stv, m.theme);
      const want = [];
      beats.filter((b) => b.isNote && (b.el.dots || 0) > 0).forEach((b) => {
        const unbeamedFlag = FLAG_RIGHT[b.d] && !b.g;
        const dx = unbeamedFlag ? FLAG_RIGHT[b.d] * (m.theme.tabFlagScale / 0.75) + 0.35 : 0.5;
        if (unbeamedFlag) flagged++;
        for (let i = 0; i < b.el.dots; i++) want.push({ x: b.x + (dx + 0.5 * i) * sp, tol: unbeamedFlag ? TOL_UI * sp / 10 : EPS });
      });
      const got = bandKids(stv, 'circle');
      const tag = `${name}@${width} sys${stv.si}`;
      ok(got.length === want.length, `${tag}: ${got.length} dots, expected ${want.length}`);
      got.forEach((c, i) => {
        near(num(c, 'cx'), want[i].x, want[i].tol, `${tag} dot ${i} x`);
        near(num(c, 'cy'), top + 0.9 * sp, EPS, `${tag} dot ${i} row`);
        near(num(c, 'r'), 0.17 * sp, EPS, `${tag} dot ${i} radius`);
        ok(c.getAttribute('fill') === m.theme.tabFretColor, `${tag}: dot colour`);
        nDots++;
      });
    }
  }
  ok(nDots >= 6 && flagged >= 1, `coverage: ${nDots} dots, ${flagged} flagged dotted notes`);
  const durs = ['8th', '16th', '32nd', '64th'];
  const score = tabTrack(durs.map((d) => ({ beats: [tn(d, 1, 0, { dots: 1 }), tr('quarter', { dots: 1 })] })));
  const m = tabModel(score); const xs = elementXs(score);
  const dots = bandKids(m.staves[0], 'circle');
  ok(dots.length === 4, `4 dots, got ${dots.length}`);
  durs.forEach((d, i) => near(num(dots[i], 'cx'), xs[i][0] + FLAG_RIGHT[d] * 10 + 3.5, TOL_UI, `${d} dotted flag: dot x = flag right edge + 0.35 sp`));
});

test('tab-rhythm', 'AC6: rest dots (4/5/6/7 strings): first dot at the rest box right edge + 0.5 sp, 0.5 sp steps, y in the space at or above the staff centre; the knock-out is the glyph\'s own', () => {
  for (const [nStr, tuning] of Object.entries(TUNINGS)) {
    const n = Number(nStr);
    const score = tabTrack([{ beats: [tr('half', { dots: 1 }), tr('8th'), tr('8th')] }, { beats: [tr('quarter', { dots: 2 }), tr('8th', { dots: 1 }), tr('16th', { dots: 1 }), tr('32nd', { dots: 1 }), tr('64th', { dots: 1 }), tr('quarter'), tr('quarter')] }], tuning ? { tuning } : {});
    const m = tabModel(score); const stv = m.staves[0]; const xs = elementXs(score);
    const rests = bandGroups(stv, 'tab-rest');
    ok(rests.length === 10, `${n}: 10 rests, got ${rests.length}`);
    const lb = stv.st.localBottom;
    const expectY = n % 2 ? lb / 2 - 7.5 : lb / 2;
    const flat = [['half', 1, xs[0][0]], ['quarter', 2, xs[1][0]], ['8th', 1, xs[1][1]], ['16th', 1, xs[1][2]], ['32nd', 1, xs[1][3]], ['64th', 1, xs[1][4]]];
    const idx = [0, 3, 4, 5, 6, 7];
    flat.forEach(([d, nd, x], k) => {
      const g = rests[idx[k]];
      const dots = g.children.filter((c) => c.tag === 'circle');
      ok(dots.length === nd, `${n} ${d}: ${nd} dots`);
      dots.forEach((c, j) => {
        near(num(c, 'cx'), x + REST_HALF_W[d] * 10 + 5 + 5 * j, 0.12, `${n} ${d} dot ${j} x`);
        near(num(c, 'cy'), expectY, EPS, `${n} ${d} dot ${j} y`); near(num(c, 'r'), 1.7, EPS, 'rest dot radius');
      });
      ok(g.children.filter((c) => c.tag === 'rect').length === (d === 'half' ? 0 : 1), `${n} ${d}: only the glyph's own knock-out`);
    });
  }
});

test('tab-rhythm', 'AC7: number vs bracket (all SCORES x 600/900): number iff one beam group is exactly the tuplet; bracket y, x span, up-ticks, gap; class tab-tuplet; no "tuplet" class on a TAB staff', () => {
  let nums = 0; let brackets = 0;
  for (const [name, score, options] of SCORES) for (const width of WIDTHS_TR) {
    const m = tabModel(score, width, options);
    for (const stv of m.staves) all(stv.g).forEach(({ n }) => ok(cls(n) !== 'tuplet', `${name}@${width}: notation "tuplet" class on a TAB staff`));
    for (const stv of rhythmStaves(m)) {
      const { beats, top, sp } = beatsOf(stv, m.theme);
      const tag = `${name}@${width} sys${stv.si}`;
      const want = [];
      stv.measures.forEach((mm, mi) => mm.tupletGroups.forEach(({ indices, count }) => {
        const bs = indices.map((i) => beats.find((b) => b.mi === mi && b.le.index === i)).filter(Boolean);
        if (!bs.length) return;
        const exact = mm.beamGroups.some((grp) => grp.length >= 2 && grp.length === indices.length && grp.every((i, k) => i === indices[k]));
        want.push({ bs, count, exact });
      }));
      const got = bandGroups(stv, 'tab-tuplet');
      ok(got.length === want.length, `${tag}: ${got.length} tab-tuplet groups, expected ${want.length}`);
      got.forEach((g, i) => {
        const w = want[i]; const first = w.bs[0]; const last = w.bs[w.bs.length - 1];
        const label = g.children.find((c) => c.tag === 'text');
        ok(label && label.textContent === String(w.count), `${tag}: tuplet ${i} label`);
        ok(label.getAttribute('font-style') === 'italic' && Math.abs(num(label, 'font-size') - 1.1 * sp) < EPS && label.getAttribute('fill') === m.theme.tabFretColor, `${tag}: label font`);
        near(num(label, 'x'), (first.x + last.x) / 2, EPS, `${tag} tuplet ${i} label x`);
        if (w.exact) {
          nums++;
          ok(g.children.length === 1, `${tag}: number-only group`);
          near(num(label, 'y'), first.end + 0.3 * sp + 0.8 * 1.1 * sp, EPS, `${tag} number top 0.3 sp under the beam`);
        } else {
          brackets++;
          const paths = g.children.filter((c) => c.tag === 'path');
          ok(paths.length === 2 && g.children.length === 3, `${tag}: bracket = two halves + number`);
          const [p1, p2] = paths.map(pathNums);
          const y = p1[3];
          near(p1[1], y - 0.5 * sp, EPS, 'left tick up'); near(p2[5], y - 0.5 * sp, EPS, 'right tick up');
          ok(p1[2] === p1[0] && p2[4] === p2[2], 'ticks vertical');
          const edge = (b, side) => (b.isRest ? b.x + side * REST_HALF_W[b.d] * sp : b.x + side * 0.5 * sp);
          if (!w.bs.some((b) => b.isRest && (b.d === 'half' || b.d === 'whole'))) {
            near(p1[0], edge(first, -1), TOL_UI * sp / 10 + 0.02, `${tag} bracket start`); near(p2[4], edge(last, 1), TOL_UI * sp / 10 + 0.02, `${tag} bracket end`);
          }
          const gap = 0.62 * 1.1 * sp * String(w.count).length + 0.4 * sp;
          near(p2[0] - p1[4], gap, 0.03, `${tag} gap`);
          near((p1[4] + p2[0]) / 2, (p1[0] + p2[4]) / 2, 0.03, `${tag} number centred`);
          ok(paths.every((p) => p.getAttribute('stroke-width') === '1' && p.getAttribute('stroke') === m.theme.tabFretColor && p.getAttribute('fill') === 'none'), `${tag}: 1 px stroke`);
          let lowest = top + m.theme.tabStemLengthSp * sp;
          w.bs.filter((b) => b.isNote).forEach((b) => { lowest = Math.max(lowest, b.end + (!b.g && b.d !== 'whole' ? FLAG_TAIL[b.d] || 0 : 0) * sp * (m.theme.tabFlagScale / 0.75)); });
          near(y, lowest + 0.6 * sp, 0.12, `${tag} bracket 0.6 sp under the lowest ink`);
        }
      });
    }
  }
  ok(nums >= 1 && brackets >= 1, `coverage: ${nums} numbers, ${brackets} brackets`);
});

test('tab-rhythm', 'AC7: classification cases: beamed triplet = number; unbeamed (quarter) triplet = bracket; two triplets in one bar each get a label; duplet in 6/8 shows "2"', () => {
  const t3 = { tuplet: 3 };
  const cases = [
    ['beamed', [tn('8th', 1, 0, t3), tn('8th', 1, 1, t3), tn('8th', 1, 2, t3), tn('half', 1, 0), tn('quarter', 1, 0)], '3', 1, 0],
    ['rest triplet', [tn('8th', 1, 0, t3), tr('8th', t3), tn('8th', 1, 2, t3), tn('half', 1, 0), tn('quarter', 1, 0)], '3', 0, 1],
    ['two triplets', [tn('8th', 1, 0, t3), tn('8th', 1, 1, t3), tn('8th', 1, 2, t3), tn('8th', 2, 0, t3), tn('8th', 2, 1, t3), tn('8th', 2, 2, t3), tn('half', 1, 0)], '3', 2, 0],
  ];
  cases.forEach(([nm, beats, label, nNum, nBr]) => {
    const svg = renderTree(tabTrack([{ beats }]));
    const g = byClass(svg, 'tab-tuplet', 'g').map(({ n }) => n);
    ok(g.length === nNum + nBr, `${nm}: ${g.length} tuplet groups`);
    ok(g.filter((x) => x.children.length === 1).length === nNum && g.filter((x) => x.children.length === 3).length === nBr, `${nm}: number/bracket split`);
    ok(g.every((x) => x.children.some((c) => c.tag === 'text' && c.textContent === label)), `${nm}: label ${label}`);
  });
  const duplet = renderTree(tabTrack([{ timeSignature: { beats: 6, beatType: 8 }, beats: [tn('8th', 1, 0, { tuplet: 2 }), tn('8th', 1, 1, { tuplet: 2 }), tn('quarter', 1, 2, { dots: 1 })] }]));
  const dg = byClass(duplet, 'tab-tuplet', 'g').map(({ n }) => n);
  ok(dg.length === 1 && dg[0].children.some((c) => c.textContent === '2'), 'duplet shows 2');
});

test('tab-rhythm', 'tuplet spanning two beats: three quarter-note triplets + half = one notation bracket over notes 1-3 and one TAB bracket from xs[0] - 0.5 sp to xs[2] + 0.5 sp (notation + TAB and tab-only)', () => {
  const t3 = { tuplet: 3 };
  const measures = [{ beats: [tn('quarter', 1, 0, t3), tn('quarter', 1, 1, t3), tn('quarter', 1, 2, t3), tn('half', 2, 0)] }];
  for (const both of [true, false]) {
    const score = tabTrack(clone(measures), { showStandardNotation: both });
    const svg = renderTree(score);
    const xs = elementXs(score)[0];
    const label = both ? 'notation+TAB' : 'tab-only';
    const nt = byClass(svg, 'tuplet', 'g').map(({ n }) => n);
    ok(nt.length === (both ? 1 : 0), `${label}: ${nt.length} notation tuplet brackets`);
    if (both) {
      const [p1, p2] = nt[0].children.filter((c) => c.tag === 'path').map(pathNums);
      ok(nt[0].children.some((c) => c.tag === 'text' && c.textContent === '3'), `${label}: notation number 3`);
      const left = xs[0] - p1[0]; const right = p2[4] - xs[2];
      ok(left > 0 && left < SPD && Math.abs(left - right) <= EPS, `${label}: notation bracket spans notes 1-3 (${p1[0]}..${p2[4]} vs ${xs[0]}..${xs[2]})`);
    }
    const tt = byClass(svg, 'tab-tuplet', 'g').map(({ n }) => n);
    ok(tt.length === 1, `${label}: ${tt.length} tab-tuplet groups`);
    const paths = tt[0].children.filter((c) => c.tag === 'path');
    ok(paths.length === 2 && tt[0].children.some((c) => c.tag === 'text' && c.textContent === '3'), `${label}: TAB bracket with number 3`);
    const [b1, b2] = paths.map(pathNums);
    near(b1[0], xs[0] - 5, EPS, `${label}: TAB bracket starts 0.5 sp before the first triplet`);
    near(b2[4], xs[2] + 5, EPS, `${label}: TAB bracket ends 0.5 sp after the third triplet`);
  }
});

test('tab-rhythm', 'notation tuplet brackets stay outside the staff: bracket line at least 1 sp and ticks at least 0.5 sp above the top line (all scores, 600/900)', () => {
  for (const [name, score, options] of SCORES) for (const width of [600, 900]) {
    const sp = (options.theme && options.theme.staffLineSpacing) || 10;
    const svg = renderTree(score, width, options);
    byClass(svg, 'tuplet', 'g').forEach(({ n }) => {
      // Staff groups put the top line at local y = 0; the tuplet group lives inside one.
      const ys = n.children.filter((c) => c.tag === 'path').flatMap((p) => pathNums(p).filter((_, i) => i % 2 === 1));
      ok(Math.max(...ys) <= -0.5 * sp + EPS, `${name}@${width}: tuplet bracket reaches y ${Math.max(...ys)} (top line 0)`);
      const line = Math.min(...ys);
      ok(line <= -1 * sp + EPS, `${name}@${width}: tuplet bracket line at ${line}, want <= ${-sp}`);
    });
  }
});

test('tab-rhythm', 'AC8: rest glyphs and y for 4/5/6/7 strings and every duration; knock-out = glyph box + 0.2 sp, first in the group, none for whole / half; the 64th rest is the 64th glyph', () => {
  for (const [nStr, tuning] of Object.entries(TUNINGS)) {
    const n = Number(nStr);
    const score = tabTrack([{ beats: [tr('half'), tr('quarter'), tr('8th'), tr('8th')] },
      { beats: [tr('16th'), tr('16th'), ...rep(4, () => tr('32nd')), ...rep(8, () => tr('64th'))] },
      { beats: [tr('whole')] }], tuning ? { tuning } : {});
    const m = tabModel(score); const stv = m.staves[0]; const lb = stv.st.localBottom; const c = (n + 1) / 2;
    const stringY = (k) => lb - (n - k) * 15;
    const rests = bandGroups(stv, 'tab-rest'); const want = expectedRests(stv);
    ok(rests.length === want.length && want.length === 4 + 14 + 1, `${n}: ${rests.length} rests`);
    const sizes = {};
    rests.forEach((g, i) => {
      const w = want[i]; const glyph = g.children.find((k) => k.tag === 'text'); const rect = g.children.find((k) => k.tag === 'rect');
      ok(cpOf(glyph) === REST_CP[w.d], `${n} rest ${i} (${w.d}): glyph U+${cpOf(glyph).toString(16)}`);
      near(num(glyph, 'x'), w.x, EPS, `${n} rest ${i} x`);
      ok(glyph.getAttribute('text-anchor') === 'middle' && num(glyph, 'font-size') === 40 && glyph.getAttribute('fill') === '#1a1a1a', 'rest glyph full size, centred, tabFretColor');
      if (w.d === 'whole') { near(num(glyph, 'y'), stringY(Math.floor(c)), EPS, `${n} whole rest hangs from string ${Math.floor(c)}`); ok(!rect, 'whole: no knock-out'); }
      else if (w.d === 'half') { near(num(glyph, 'y'), stringY(Math.ceil(c)), EPS, `${n} half rest sits on string ${Math.ceil(c)}`); ok(!rect, 'half: no knock-out'); }
      else {
        ok(rect && g.children.indexOf(rect) < g.children.indexOf(glyph), `${n} ${w.d}: knock-out before (under) the glyph`);
        ok(rect.getAttribute('fill') === '#ffffff', 'knock-out colour = background');
        near(num(rect, 'y') + num(rect, 'height') / 2, lb / 2, 0.03, `${n} ${w.d}: glyph box centred on the staff centre`);
        near(num(rect, 'x') + num(rect, 'width') / 2, w.x, 0.03, `${n} ${w.d}: knock-out centred on the beat x`);
        near(num(rect, 'width'), 2 * REST_HALF_W[w.d] * 10 + 4, 0.12, `${n} ${w.d}: knock-out width = box + 0.2 sp each side`);
        sizes[w.d] = num(rect, 'height');
      }
    });
    ok(sizes['8th'] < sizes['16th'] && sizes['16th'] < sizes['32nd'] && sizes['32nd'] < sizes['64th'], `${n}: knock-out heights grow with the flag count`);
    near(sizes['64th'], 47 + 4, 1.5, `${n}: 64th box ~4.7 sp (ui.md section 6) + 0.2 sp margins`);
  }
});

test('tab-rhythm', 'AC8: generic over all SCORES: every authored rest and whole-measure rest is drawn as expected (glyph, x, dots); one group per measure with something to draw; padded measures none', () => {
  let nRests = 0; let wm = 0; let padded = 0;
  for (const [name, score, options] of SCORES) for (const width of WIDTHS_TR) {
    const m = tabModel(score, width, options);
    for (const stv of rhythmStaves(m)) {
      const rests = bandGroups(stv, 'tab-rest'); const want = expectedRests(stv);
      const tag = `${name}@${width} sys${stv.si}`;
      ok(rests.length === want.length, `${tag}: ${rests.length} rests, expected ${want.length}`);
      rests.forEach((g, i) => {
        const glyph = g.children.find((k) => k.tag === 'text');
        ok(cpOf(glyph) === REST_CP[want[i].d], `${tag}: rest ${i} glyph`);
        near(num(glyph, 'x'), want[i].x, EPS, `${tag}: rest ${i} x`);
        ok(g.children.filter((k) => k.tag === 'circle').length === want[i].dots, `${tag}: rest ${i} dots`);
        nRests++; if (want[i].wm) wm++;
      });
      const drawable = stv.measures.filter((mm) => {
        if (mm.wholeRest && !mm.elements.length) return !mm.padded;
        return mm.elements.some((le) => le.el.type === 'rest' || (le.el.type !== 'grace' && (le.el.duration !== 'whole' || (le.el.dots || 0) > 0)));
      }).length;
      ok(stv.bands.length === drawable, `${tag}: ${stv.bands.length} tab-rhythm groups, expected ${drawable}`);
      stv.measures.forEach((mm) => { if (mm.padded) { padded++; ok(!mm.elements.length, 'padded measures are empty'); } });
    }
  }
  ok(nRests >= 20 && wm >= 2 && padded >= 1, `coverage: ${nRests} rests, ${wm} whole-measure, ${padded} padded`);
});

test('tab-rhythm', 'AC8: whole-measure rests: a sole rest >= the bar (2/4 half, 3/4 dotted half, 6/8 dotted half, 3/8 dotted quarter, 4/4 whole) is a whole rest at the bar x without dots; authored [] sits where notation puts it; padded stays blank', () => {
  const cases = [[{ beats: 2, beatType: 4 }, tr('half')], [{ beats: 3, beatType: 4 }, tr('half', { dots: 1 })], [{ beats: 6, beatType: 8 }, tr('half', { dots: 1 })], [{ beats: 4, beatType: 4 }, tr('whole')], [{ beats: 3, beatType: 8 }, tr('quarter', { dots: 1 })]];
  cases.forEach(([ts, rest]) => {
    const score = tabTrack([{ timeSignature: ts, beats: [rest] }]);
    const m = tabModel(score); const stv = m.staves[0];
    const g = bandGroups(stv, 'tab-rest'); ok(g.length === 1, `${ts.beats}/${ts.beatType}: one rest`);
    const glyph = g[0].children.find((k) => k.tag === 'text');
    ok(cpOf(glyph) === 0xE4E3 && !g[0].children.some((k) => k.tag === 'rect' || k.tag === 'circle'), `${ts.beats}/${ts.beatType}: whole glyph, no knock-out, no dots`);
    near(num(glyph, 'x'), stv.measures[0].elements[0].x, EPS, 'at the layout x');
    near(num(glyph, 'y'), stv.st.localBottom - 3 * 15, EPS, 'hangs from string 3');
  });
  const score = { tracks: [
    { name: 'N', showTablature: false, measures: [{ beats: [] }, bar4()] },
    { name: 'T', showStandardNotation: false, showTablature: true, tabRhythm: true, measures: [{ beats: [] }, { beats: [tn('quarter', 1, 0)] }] },
  ] };
  const svg = renderTree(score);
  const notationRest = glyphs(staffGroups(systemsOf(svg)[0]).find((g) => cls(g) === 'staff staff-notation'), 0xE4E3);
  const tabRest = glyphs(bandGroups(tabModel(score).staves[0], 'tab-rest')[0], 0xE4E3);
  ok(notationRest.length === 1 && tabRest.length === 1, 'one whole rest on each staff');
  near(num(tabRest[0], 'x'), num(notationRest[0], 'x'), EPS, 'TAB whole-measure rest x = notation whole-measure rest x');
  const lm = layoutOf(score, 900).systems[0].tracks[1].measures[0];
  ok(num(tabRest[0], 'x') > lm.x && num(tabRest[0], 'x') < lm.endX, 'inside the barlines');
  const padded = { tracks: [{ name: 'A', showTablature: false, measures: [bar4(), bar4(), bar4()] },
    { name: 'T', showStandardNotation: false, showTablature: true, tabRhythm: true, measures: [{ beats: [tn('quarter', 1, 0)] }] }] };
  const pm = tabModel(padded);
  ok(bandGroups(pm.staves[0], 'tab-rest').length === 0 && pm.staves[0].bands.length === 1, 'only the real measure has a group');
});

const yProfile = (n) => {
  const parts = [n.tag, n._text];
  n.attrs.forEach(([k, v]) => {
    if (['x', 'x1', 'x2', 'cx', 'width'].includes(k)) return;
    if (k === 'd') {
      const nums = v.match(/-?\d*\.?\d+/g) || []; const letters = v.replace(/[^A-Za-z]/g, '');
      parts.push(/^[MLQCZ]*$/.test(letters) ? `d:${letters}:${nums.filter((_, i) => i % 2).join(',')}` : `d:${v}`);
    } else parts.push(`${k}=${v}`);
  });
  return parts.join('|');
};
const yTree = (n) => `${yProfile(n)}[${n.children.map(yTree).join(';')}]`;
const forceTab = (score, on) => { const c = clone(score); c.tracks.forEach((t) => { if (t.showTablature !== false) t.tabRhythm = on; }); return c; };

test('tab-rhythm', 'AC8: renderTabElement still returns undefined for rests and draws nothing; slide / H-P / let ring / P.M. / pick across rests leave the TAB staff identical apart from the band', () => {
  const g = makeContainer();
  const th = resolveTheme();
  ok(renderTabElement(g, { el: { type: 'rest', duration: 'quarter' }, x: 50, tabBaselineY: 75 }, 6, th) === undefined, 'rest: undefined');
  ok(renderTabElement(g, { el: { type: 'rest', duration: 'quarter', dots: 1 }, x: 50, tabBaselineY: 75 }, 6, th) === undefined, 'dotted rest: undefined');
  ok(g.children.length === 0, 'nothing drawn for a rest');
  const r = renderTabElement(g, { el: { type: 'note', duration: 'quarter', notes: [{ string: 1, fret: 3 }] }, x: 50, tabBaselineY: 75 }, 6, th);
  ok(r && Number.isFinite(r.fretTopY), 'notes still return fret tops');
  const marks = (on, notation) => ({ tracks: [{ name: 'G', showStandardNotation: notation, showTablature: true, tabRhythm: on, measures: [
    { beats: [{ type: 'note', duration: 'quarter', notes: [{ string: 2, fret: 3, slide: 'up' }], letRing: true }, tr('quarter'),
      { type: 'note', duration: 'quarter', notes: [{ string: 2, fret: 5 }], letRing: true }, { type: 'note', duration: 'quarter', notes: [{ string: 2, fret: 7, hammerPull: true }] }] },
    { beats: [tr('quarter'), { type: 'note', duration: 'quarter', notes: [{ string: 1, fret: 5 }], palmMute: true, pickStroke: 'down' }, tr('half')] },
  ] }] });
  for (const notation of [false, true]) {
    const a = tabStaves(renderTree(marks(true, notation)))[0]; const b = tabStaves(renderTree(marks(false, notation)))[0];
    const strip = (x) => x.children.filter((c) => cls(c) !== 'tab-rhythm').map(yTree).join('');
    ok(strip(a) === strip(b), `notation ${notation}: score-wide passes treat rests the same way with the band on`);
  }
});

test('tab-rhythm', 'AC10: tabRhythm forced true vs false on every TAB staff of every SCORE (600/900): TAB-group nodes outside tab-rhythm keep their local coordinates (all of them where the timeline x is unchanged, else every y)', () => {
  let strict = 0; let yOnly = 0; let staffTotal = 0; let moved = 0;
  for (const [name, score, options] of SCORES) for (const width of WIDTHS_TR) {
    const on = tabModel(forceTab(score, true), width, options); const off = tabModel(forceTab(score, false), width, options);
    const sameSys = JSON.stringify(on.layout.systems.map((s) => s.measureIndices)) === JSON.stringify(off.layout.systems.map((s) => s.measureIndices));
    ok(sameSys, `${name}@${width}: system breaks unchanged`);
    ok(on.staves.length === off.staves.length, `${name}@${width}: same TAB staves`);
    const sameX = on.layout.systems.every((s, si) => s.tracks.every((t, ti) => t.measures.every((mm, mi) => {
      const o = off.layout.systems[si].tracks[ti].measures[mi];
      return mm.x === o.x && mm.endX === o.endX && mm.elements.every((e, k) => e.x === o.elements[k].x);
    })));
    on.staves.forEach((s, i) => {
      const o = off.staves[i]; staffTotal++;
      ok(s.n === o.n, 'string count');
      ok(translateY(s.g) >= translateY(o.g) - EPS, `${name}@${width}: a TAB staff never moves up when rhythm is added`);
      if (translateY(s.g) !== translateY(o.g)) moved++;
      const strip = (stv) => stv.g.children.filter((c) => cls(c) !== 'tab-rhythm');
      const a = strip(s); const b = strip(o);
      ok(a.length === b.length, `${name}@${width} sys${s.si}: child count`);
      if (sameX) { ok(a.map(serialize).join('') === b.map(serialize).join(''), `${name}@${width} sys${s.si}: TAB group differs outside the band`); strict++; }
      else { const ya = a.map(yTree); const yb = b.map(yTree); const bad = ya.findIndex((v, k) => v !== yb[k]); ok(bad < 0, `${name}@${width} sys${s.si}: TAB group y-coordinates differ outside the band: child ${bad} ${bad < 0 ? '' : (ya[bad].split(/[[];]/).find((v, k) => v !== yb[bad].split(/[[];]/)[k]) + ' <> ' + yb[bad].split(/[[];]/).find((v, k) => v !== ya[bad].split(/[[];]/)[k]))}`); yOnly++; }
      near(inkBounds(s.g, on.theme).top, inkBounds(o.g, off.theme).top, EPS, `${name}@${width}: TAB top ink`);
    });
  }
  ok(staffTotal >= 60 && strict >= 40 && yOnly >= 4 && moved >= 2, `coverage: ${staffTotal} staves, ${strict} strict, ${yOnly} y-only, ${moved} moved lower`);
});

// lowest ink of a rhythm band from SVG primitives (no ink.js): stems, beams, flags (+ tails), dots, tuplet brackets / numbers
function bandBottom(stv, theme) {
  const sp = theme.staffLineSpacing; let low = -Infinity;
  stv.bands.forEach((b) => b.children.forEach((c) => {
    if (c.tag === 'line') low = Math.max(low, num(c, 'y2'));
    else if (c.tag === 'path') low = Math.max(low, ...pathNums(c).filter((_, i) => i % 2));
    else if (c.tag === 'circle') low = Math.max(low, num(c, 'cy') + num(c, 'r'));
    else if (c.tag === 'text') { const d = Object.keys(FLAG_CP).find((k) => FLAG_CP[k] === cpOf(c)); low = Math.max(low, num(c, 'y') + (FLAG_TAIL[d] || 0) * sp * theme.tabFlagScale / 0.75); }
    else if (cls(c) === 'tab-tuplet') c.children.forEach((t) => { low = Math.max(low, t.tag === 'path' ? Math.max(...pathNums(t).filter((_, i) => i % 2)) : num(t, 'y')); });
  }));
  return low;
}

test('tab-rhythm', 'AC11: bottom extent 3.5 sp typical, 4.25 sp beamed 32nds, 5.0 sp beamed 64ths, flag tails count, half 2.25 sp; staff ink, SVG height and the staff below clear the band (all SCORES x 600/900)', () => {
  const bottomOf = (beats) => { const m = tabModel(tabTrack([{ beats }])); return bandBottom(m.staves[0], m.theme) - m.staves[0].st.localBottom; };
  near(bottomOf([tn('quarter', 1, 0), tn('quarter', 1, 1), tn('quarter', 1, 2), tn('quarter', 1, 3)]), 35, EPS, 'quarters 3.5 sp');
  near(bottomOf([tn('8th', 1, 0), tn('8th', 1, 1), tr('half'), tr('quarter')]), 35, EPS, 'beamed 8ths 3.5 sp');
  near(bottomOf([...rep(4, (_, i) => tn('32nd', 1, i)), tr('quarter', { dots: 1 }), tr('half')]), 42.5, EPS, 'beamed 32nds 4.25 sp');
  near(bottomOf([...rep(4, (_, i) => tn('64th', 1, i)), tr('quarter', { dots: 1 }), tr('half')]), 50, EPS, 'beamed 64ths 5.0 sp');
  near(bottomOf([tn('32nd', 1, 0), tr('32nd'), tr('16th'), tr('8th'), tr('quarter'), tr('half')]), 42.5 + 5.2, TOL_UI, 'unbeamed 32nd: flag tail 0.52 sp below the stem end');
  near(bottomOf([tn('64th', 1, 0), tr('64th'), tr('32nd'), tr('16th'), tr('8th'), tr('quarter')]), 50 + 9.8, TOL_UI, 'unbeamed 64th: flag tail 0.98 sp');
  near(bottomOf([tn('half', 1, 0), tn('half', 1, 1)]), 22.5, EPS, 'half notes 2.25 sp');
  let nStaves = 0; let touching = 0;
  for (const [name, score, options] of SCORES) for (const width of WIDTHS_TR) {
    const m = tabModel(score, width, options);
    const svgH = num(m.svg, 'height');
    for (const stv of rhythmStaves(m)) {
      const bb = bandBottom(stv, m.theme); if (bb === -Infinity) continue;
      nStaves++;
      const tag = `${name}@${width} sys${stv.si}`;
      ok(inkBounds(stv.g, m.theme).bottom >= bb - TOL_UI, `${tag}: staff ink ${inkBounds(stv.g, m.theme).bottom} misses band ink ${bb}`);
      ok(svgH >= stv.st.y + bb - EPS, `${tag}: SVG height ${svgH} cuts the band (${stv.st.y + bb})`);
      const staves = staffGroups(stv.sys).map(staffInfo); const i = staves.findIndex((s) => s.g === stv.g);
      if (i >= 0 && i + 1 < staves.length) {
        const next = staves[i + 1]; touching++;
        ok(stv.st.y + bb < next.y + inkBounds(next.g, m.theme).top - EPS, `${tag}: band ink ${stv.st.y + bb} reaches the next staff ink ${next.y + inkBounds(next.g, m.theme).top}`);
      }
    }
  }
  ok(nStaves >= 15 && touching >= 3, `coverage: ${nStaves} staves, ${touching} with a staff below`);
});

// AC12: horizontal clearance between consecutive onsets of one rhythm staff
function clearancePairs(m, stv, tag) {
  const { beats, sp } = beatsOf(stv, m.theme);
  const sw = m.theme.stemWidth;
  const rects = fretRects(stv, m.theme.background).map((r) => ({ x0: num(r, 'x'), x1: num(r, 'x') + num(r, 'width'), c: num(r, 'x') + num(r, 'width') / 2 }));
  const restG = bandGroups(stv, 'tab-rest');
  const info = beats.map((b) => {
    const o = { b, belowR: -Infinity, inR: -Infinity, belowL: Infinity, inL: Infinity };
    if (b.isRest) {
      const g = restG.find((rg) => Math.abs(num(rg.children.find((k) => k.tag === 'text'), 'x') - b.x) < EPS);
      const circ = g.children.filter((c) => c.tag === 'circle'); const r = g.children.find((c) => c.tag === 'rect');
      const w = REST_HALF_W[b.d] * sp;
      o.inL = r ? num(r, 'x') : b.x - w; o.inR = Math.max(b.x + w, ...circ.map((c) => num(c, 'cx') + num(c, 'r'))); o.knockR = r ? num(r, 'x') + num(r, 'width') : -Infinity;
    } else {
      rects.filter((r) => Math.abs(r.c - b.x) < 0.6).forEach((r) => { o.inL = Math.min(o.inL, r.x0); o.inR = Math.max(o.inR, r.x1); });
      if (b.d !== 'whole') { o.belowL = b.x - sw / 2; o.belowR = b.x + sw / 2; }
      if (FLAG_RIGHT[b.d] && !b.g) o.belowR = Math.max(o.belowR, b.x + FLAG_RIGHT[b.d] * sp * (m.theme.tabFlagScale / 0.75));
    }
    return o;
  });
  const dots = bandKids(stv, 'circle'); let di = 0;
  beats.forEach((b, i) => { if (!b.isNote) return; for (let k = 0; k < (b.el.dots || 0); k++) { const c = dots[di++]; info[i].belowR = Math.max(info[i].belowR, num(c, 'cx') + num(c, 'r')); } });
  let pairs = 0;
  for (let i = 0; i + 1 < info.length; i++) {
    const a = info[i]; const nx = info[i + 1]; pairs++;
    ok(a.b.x < nx.b.x, `${tag}: onsets increase`);
    if (a.belowR > -Infinity && nx.belowL < Infinity) ok(a.belowR <= nx.belowL + EPS, `${tag} beat ${i}->${i + 1}: ink right ${a.belowR} past the next stem ${nx.belowL}`);
    if (a.knockR > -Infinity && nx.inL < Infinity) ok(a.knockR <= nx.inL + 0.1 * sp + EPS, `${tag} beat ${i}->${i + 1}: knock-outs overlap by more than 0.1 sp (${a.knockR - nx.inL})`);
    if (a.inR > -Infinity && nx.inL < Infinity && (a.b.isRest || nx.b.isRest)) ok(a.inR <= nx.inL + EPS, `${tag} beat ${i}->${i + 1}: in-staff right ${a.inR} past the next left ${nx.inL}`);
  }
  return pairs;
}

test('tab-rhythm', 'AC12: at 300 / 600 / 900 px no flag, dot or rest box overlaps the next onset\'s stem, rest knock-out or fret label (all SCORES), incl. a dense dotted 64th..8th + rests bar', () => {
  let pairs = 0;
  for (const [name, score, options] of SCORES) for (const width of [300, 600, 900]) {
    const m = tabModel(score, width, options);
    for (const stv of rhythmStaves(m)) pairs += clearancePairs(m, stv, `${name}@${width} sys${stv.si}`);
  }
  ok(pairs >= 100, `coverage: ${pairs} neighbouring beat pairs`);
  const dense = tabTrack([{ beats: [tn('64th', 1, 12, { dots: 2 }), tr('64th', { dots: 1 }), tn('32nd', 1, 11, { dots: 1 }), tr('32nd', { dots: 1 }), tn('16th', 1, 10, { dots: 1 }), tr('16th', { dots: 1 }), tn('8th', 1, 9, { dots: 1 }), tr('8th', { dots: 1 }), tn('quarter', 1, 8), tr('quarter', { dots: 1 })] }]);
  for (const width of [300, 600, 900]) {
    const m = tabModel(dense, width);
    ok(clearancePairs(m, m.staves[0], `dense@${width}`) === 9, 'dense bar: 9 pairs');
  }
});

test('tab-rhythm', 'AC13: theme keys one at a time: tabStemGapSp / tabStemLengthSp / tabHalfStemLengthSp / tabFlagScale move or scale as specified; staffLineSpacing scales; tabStaffLineSpacing moves the band; beamWidth / stemWidth stay px', () => {
  const score = tabTrack([
    { beats: [tn('8th', 1, 0, { dots: 1 }), tr('16th'), tn('half', 1, 2), tr('quarter')] },
    { beats: [...rep(4, (_, i) => tn('32nd', 1, i)), tr('8th'), tn('quarter', 1, 4, { dots: 1 }), tr('quarter'), tr('8th')] },
  ]);
  const probe = (theme) => {
    const m = tabModel(score, 900, { theme }); const stv = m.staves[0];
    const { beats, top, sp } = beatsOf(stv, m.theme);
    return { m, stv, lb: stv.st.localBottom, sp, lines: bandKids(stv, 'line'), circles: bandKids(stv, 'circle'), flags: bandKids(stv, 'text'), paths: bandKids(stv, 'path').map(pathNums), beats, top };
  };
  const len = (l) => num(l, 'y2') - num(l, 'y1');
  const d = probe();
  ok(d.lines.length === 7 && d.flags.length === 1 && d.circles.length === 2 && d.paths.length === 3, `fixture shape ${d.lines.length}/${d.flags.length}/${d.circles.length}/${d.paths.length}`);
  near(d.lb, 75, EPS, 'default bottom string');
  let p = probe({ tabStemGapSp: 2 });
  p.lines.forEach((l) => near(num(l, 'y1'), 95, EPS, 'gap 2 sp')); near(len(p.lines[0]), 25, EPS, 'length unchanged by the gap');
  p = probe({ tabStemLengthSp: 4 });
  near(len(p.lines[0]), 40, EPS, '8th 4 sp'); near(len(p.lines[1]), 12.5, EPS, 'half unaffected'); near(len(p.lines[2]), 47.5, EPS, '32nd = tabStemLengthSp + 0.75 sp');
  p = probe({ tabHalfStemLengthSp: 3 });
  near(len(p.lines[1]), 30, EPS, 'half 3 sp'); near(len(p.lines[0]), 25, EPS, '8th unaffected');
  for (const scale of [0.5, 1, 1.5]) {
    p = probe({ tabFlagScale: scale });
    near(num(p.flags[0], 'font-size'), 40 * scale, EPS, `flag size at ${scale}`);
    near(num(p.circles[0], 'cx') - p.beats[0].x, 12.24 * scale + 3.5, TOL_UI, `dotted 8th dot x at flag scale ${scale}`);
    near(num(p.circles[1], 'cx') - p.beats[9].x, 5, EPS, 'dot of a flagless quarter unaffected');
  }
  p = probe({ staffLineSpacing: 12 });
  near(num(p.lines[0], 'y1'), p.lb + 12, EPS, 'sp 12: gap'); near(len(p.lines[0]), 30, EPS, 'sp 12: 2.5 sp stem');
  ok(p.lines.every((l) => num(l, 'stroke-width') === 1.3), 'stem width stays 1.3 px');
  p.circles.forEach((c) => { near(num(c, 'cy'), p.top + 0.9 * 12, EPS, 'sp 12: dot row'); near(num(c, 'r'), 0.17 * 12, EPS, 'sp 12: dot radius'); });
  near(num(p.flags[0], 'font-size'), 4 * 12 * 0.75, EPS, 'sp 12: flag size');
  p.paths.forEach((v) => near(v[1] - v[5], 5, EPS, 'beam thickness stays 5 px'));
  p = probe({ tabStaffLineSpacing: 20 });
  near(p.lb, 100, EPS, 'bottom string at 100'); near(num(p.lines[0], 'y1'), 110, EPS, 'stem top follows the bottom string'); near(len(p.lines[0]), 25, EPS, 'length unchanged');
  const r16 = bandGroups(p.stv, 'tab-rest')[0]; const box = r16.children.find((k) => k.tag === 'rect');
  near(num(box, 'y') + num(box, 'height') / 2, 50, 0.03, '16th rest centred at lb / 2 = 50');
  const hs = tabModel(tabTrack([{ beats: [tr('half'), tr('half')] }]), 900, { theme: { tabStaffLineSpacing: 20 } }).staves[0];
  near(num(bandGroups(hs, 'tab-rest')[0].children.find((k) => k.tag === 'text'), 'y'), 100 - 2 * 20, EPS, 'half rest on string 4 at 20 px spacing');
  p = probe({ beamWidth: 8, stemWidth: 2 });
  p.lines.forEach((l) => ok(num(l, 'stroke-width') === 2, 'stemWidth 2'));
  p.paths.forEach((v) => near(v[1] - v[5], 8, EPS, 'beamWidth 8'));
  const lvls = p.paths.map((v) => v[1]).sort((a, b) => b - a);
  near(lvls[0] - lvls[1], 10, EPS, 'level step = beamWidth + 0.2 sp'); near(lvls[1] - lvls[2], 10, EPS, 'level step');
  near(Math.min(...p.paths.map((v) => Math.min(v[0], v[2]))), p.beats[4].x - 1.4, EPS, 'cap = stemWidth / 2 + 0.04 sp');
});

test('tab-rhythm', 'AC13: tabFretColor on every stroke / fill of the band (fixtures tab-rhythm and tab-rhythm-break), knock-outs theme.background; no default colour left', () => {
  const theme = { tabFretColor: '#c00000', background: '#fafafa' };
  const kinds = new Set(); let n = 0;
  for (const c of characterizationCases.filter((c) => /^tab-rhythm/.test(c.name))) {
    const svg = renderTree(c.score, c.width, { ...(c.options || {}), theme: { ...(c.options?.theme || {}), ...theme } });
    const ink = bands(svg).flatMap((g) => [...walk(g)].map(({ n: nn }) => nn)).filter((nn) => nn.tag !== 'g');
    ink.forEach((nn) => {
      const stroke = nn.getAttribute('stroke'); const fill = nn.getAttribute('fill');
      const col = nn.tag === 'rect' ? fill : (stroke && stroke !== 'none' ? stroke : fill);
      ok(col === (nn.tag === 'rect' ? '#fafafa' : '#c00000'), `${c.name}: ${nn.tag} colour ${col}`);
      if (nn.tag === 'path' || nn.tag === 'line') ok(!fill || fill === 'none' || fill === '#c00000', 'fill');
      kinds.add(nn.tag + (nn.tag === 'text' ? (cpOf(nn) > 0xE000 ? 'G' : 'T') : '')); n++;
    });
    ok(bands(svg).every((g) => !/#1a1a1a/.test(serialize(g))), `${c.name}: default colour left in a band`);
  }
  ['line', 'path', 'circle', 'rect', 'textG', 'textT'].forEach((k) => ok(kinds.has(k), `colour covered for ${k}`));
  ok(n > 100, `${n} nodes checked`);
});

test('tab-rhythm', 'AC16: determinism over all SCORES (two renders equal, input untouched); unknown durations throw with tabRhythm on and off (note, rest, inside a beam group)', () => {
  for (const [name, score, options] of SCORES) {
    const before = JSON.stringify(score);
    const a = serialize(renderTree(score, 700, options)); const b = serialize(renderTree(score, 700, options));
    ok(a === b, `${name}: two renders differ`);
    const box = makeContainer(); new MusicScoreRenderer(box, score, { width: 700, ...options }).render();
    ok(serialize(box.children[0]) === a && JSON.stringify(score) === before, `${name}: direct render differs or the input was mutated`);
  }
  const thrown = (fn) => { try { fn(); } catch (e) { return e.message; } return ''; };
  for (const on of [true, false]) {
    const mk = (beats) => ({ tracks: [{ showStandardNotation: false, showTablature: true, tabRhythm: on, measures: [{ beats }] }] });
    ok(/Unknown duration/.test(thrown(() => renderTree(mk([tn('bogus', 1, 0)])))), `note, tabRhythm ${on}`);
    ok(/Unknown duration/.test(thrown(() => renderTree(mk([tn('quarter', 1, 0), tr('bogus')])))), `rest, tabRhythm ${on}`);
    ok(/Unknown duration/.test(thrown(() => renderTree(mk([tn('8th', 1, 0), tn('8th', 1, 1), tn('sixty', 1, 2)])))), `in a beam group, tabRhythm ${on}`);
  }
});
}

// ======================= navigation =======================
// Volta brackets, segno / coda signs and jump texts (status.md AC2-AC13). Fixtures `navigation` (w900),
// `navigation-break` (w600) and `navigation-tab-only` (w900) in tests/fixtures/characterization.js; small
// edge-case scores below. Geometry oracles are written from the design's numbers (sp), layout x from computeLayout.
{
const NAV_FIX = characterizationCases.filter((c) => /^navigation/.test(c.name));
const NSP = DEF.staffLineSpacing;
const topStaff = (svg, si) => staffGroups(systemsOf(svg)[si])[0];
const navGroup = (svg, si) => topStaff(svg, si).children.find((n) => cls(n) === 'navigation') || null;
const voltaGs = (nav) => (nav ? nav.children.filter((n) => /^volta /.test(cls(n))) : []);
const markNodes = (nav) => (nav ? nav.children.filter((n) => !/^volta /.test(cls(n))) : []);
const pts = (d) => { const v = nums(d); const out = []; for (let i = 0; i < v.length; i += 2) out.push([v[i], v[i + 1]]); return out; };
const lineYOf = (vg) => Math.min(...pts(vg.children[0].getAttribute('d')).map((p) => p[1]));
// Pseudo group of a staff group's children minus some (inkBounds only reads tag / getAttribute / children).
const without = (g, skip) => ({ tag: 'g', getAttribute: () => null, children: g.children.filter((n) => !skip(n)) });
const leaves = (n) => (n.tag === 'g' ? n.children.flatMap(leaves) : [n]);
const stripNav = (score) => ({ ...score, tracks: score.tracks.map((t) => ({ ...t, measures: t.measures.map((m) => {
  if (!m) return m;
  const { ending, segno, coda, jump, ...rest } = m; // eslint-disable-line no-unused-vars
  return rest;
}) })) });
const nbar = (extra = {}) => ({ ...bar4(), ...extra });
const EDGE = [
  ['ending on the last measure, no repeatEnd', oneTrack([nbar(), nbar({ ending: 2 })])],
  ['one measure: ending + segno + coda + D.C.', oneTrack([nbar({ ending: 1, segno: true, coda: true, jump: 'D.C.' })])],
  ['adjacent endings 1 / 2 / 3', oneTrack([nbar({ ending: 1, barline: 'repeatEnd' }), nbar({ ending: 2, barline: 'repeatEnd' }), nbar({ ending: 3 })])],
  ['padded measures under an ending', { tracks: [{ measures: [nbar(), nbar({ ending: 1 }), nbar({ ending: 1, jump: 'Fine' })] }, { showTablature: true, measures: [nbar()] }] }],
  ['ending only on a shorter track', { tracks: [{ measures: [nbar(), nbar(), nbar()] }, { measures: [nbar({ ending: [1, 2], segno: true })] }] }],
  ['segno + jump in one measure, unknown jump text', oneTrack([nbar({ segno: true, jump: 'D.S. senza replica' }), nbar({ jump: '  d.c.  al  fine ' })])],
  ['garbage fields', oneTrack([nbar({ ending: 'x', segno: 'yes', coda: 1, jump: 42 }), nbar({ ending: [0, -1], jump: '   ' })])],
];
const ALL_NAV = () => [...NAV_FIX.map((c) => [c.name, c.score, c.options || {}]), ...EDGE.map(([k, s]) => [k, s, {}])];

test('navigation', 'AC2/AC3: brackets group by column and ending set; labels "1." / "2." / "Last time" inside the left hook, below the line', () => {
  const svg = renderTree(NAV_FIX[0].score, 900);
  const labels = systemsOf(svg).map((_, si) => voltaGs(navGroup(svg, si)).map((vg) => vg.children.find((n) => cls(n) === 'volta-number')?._text ?? null));
  ok(JSON.stringify(labels) === JSON.stringify([['1.'], ['2.', 'Last time']]), `labels ${JSON.stringify(labels)}`);
  let n = 0;
  for (const c of NAV_FIX) {
    const s = renderTree(c.score, c.width, c.options || {});
    systemsOf(s).forEach((_, si) => voltaGs(navGroup(s, si)).forEach((vg) => {
      const t = vg.children.find((k) => cls(k) === 'volta-number');
      if (!t) return;
      n++;
      const p = pts(vg.children[0].getAttribute('d'));
      const y = lineYOf(vg);
      near(num(t, 'x'), p[0][0] - 0.06 * NSP + 0.4 * NSP, EPS, `${c.name}: label 0.4 sp right of the bracket start`);
      near(num(t, 'y'), y + 1.2 * NSP, EPS, `${c.name}: label baseline 1.2 sp below the line`);
      near(num(t, 'font-size'), 1.1 * NSP, EPS, 'label size 1.1 sp');
      ok(p.length >= 3 && p[0][1] > y, `${c.name}: labelled part has a left hook`);
    }));
  }
  ok(n >= 8, `${n} labels`);
});

test('navigation', 'AC4/AC5: hooks, closed / open, end inset and system-break splitting match the layout (all fixtures, 400/600/900)', () => {
  let parts = 0; let conts = 0;
  for (const c of NAV_FIX) for (const width of [400, 600, 900]) {
    const svg = renderTree(c.score, width, c.options || {});
    const layout = layoutOf(c.score, width, c.options || {});
    layout.systems.forEach((sys, si) => {
      const vgs = voltaGs(navGroup(svg, si));
      ok(vgs.length === sys.voltas.length, `${c.name}@${width} sys${si}: ${vgs.length} brackets vs ${sys.voltas.length}`);
      const next = layout.systems[si + 1];
      sys.voltas.forEach((v, i) => {
        parts++;
        const vg = vgs[i]; const p = pts(vg.children[0].getAttribute('d')); const y = lineYOf(vg);
        ok(cls(vg) === `volta ${v.closed ? 'volta-closed' : 'volta-open'}`, `class ${cls(vg)}`);
        ok((p[0][1] > y) === v.leftHook && (p.at(-1)[1] > y) === v.rightHook, `${c.name}@${width}: hooks`);
        near(p[0][0], v.leftHook ? v.x1 + 0.06 * NSP : v.x1, EPS, 'start x');
        near(p.at(-1)[0], v.rightHook ? v.x2 - 0.06 * NSP : v.x2, EPS, 'end x');
        if (v.leftHook) near(p[0][1] - y, 1.5 * NSP, EPS, 'left hook 1.5 sp');
        if (v.rightHook) near(p.at(-1)[1] - y, 1.5 * NSP, EPS, 'right hook 1.5 sp');
        const ms = sys.tracks[0].measures;
        const li = sys.measureIndices.indexOf(v.startMi);
        near(v.x1, li > 0 ? ms[li].x : (ms[0].startBarline ? ms[0].startBarline.x : sys.contentStartX + 0.5 * NSP), EPS, 'bracket starts at the opening barline / after the header');
        const continued = !!next && next.voltas[0]?.startMi === v.endMi + 1 && !next.voltas[0].leftHook;
        near(v.x2, continued ? sys.lastBarlineX : Math.max(ms[sys.measureIndices.indexOf(v.endMi)].endX - 0.5 * NSP, v.x1 + 1.5 * NSP), EPS, 'end inset 0.5 sp / runs to the last barline when continued');
        if (continued) ok(!v.rightHook, 'no right hook before a break');
        if (!v.leftHook) { conts++; ok(v.label === null && !vg.children.some((k) => cls(k) === 'volta-number') && li === 0, 'continuation: no number, starts the system'); }
        ok(vg.children[0].getAttribute('stroke-width') === String(0.12 * NSP) && vg.children[0].getAttribute('fill') === 'none', 'line 0.12 sp, no fill');
      });
    });
  }
  ok(parts > 20 && conts >= 2, `${parts} parts, ${conts} continuations`);
  const brk = layoutOf(NAV_FIX[1].score, 600).systems;
  ok(brk[0].voltas[0].rightHook === false && brk[1].voltas[0].leftHook === false && brk[1].voltas[0].rightHook === true, 'navigation-break: "1., 2." split, closed on its second part');
  ok(brk[2].voltas[0].x1 === brk[2].tracks[0].measures[0].startBarline.x, 'navigation-break: ending on a repeat-start system start begins at the repeat sign');
});

test('navigation', 'AC6/AC9: brackets only in the top staff, one height per system, >= 3 sp up, hooks 0.5 sp clear of all other top-staff ink in range (chord symbols, fermatas, P.M./let ring, bends, picks); tempo outermost', () => {
  let n = 0;
  for (const c of NAV_FIX) for (const width of [400, 600, 900]) {
    const svg = renderTree(c.score, width, c.options || {});
    systemsOf(svg).forEach((sg, si) => {
      staffGroups(sg).slice(1).forEach((g) => ok(!all(g).some(({ n: k }) => /navigation|volta|segno|coda|jump/.test(cls(k))), `${c.name}@${width}: navigation below the top staff`));
      const top = topStaff(svg, si);
      const vgs = voltaGs(navGroup(svg, si));
      if (!vgs.length) return;
      const ys = new Set(vgs.map(lineYOf));
      ok(ys.size === 1, `${c.name}@${width} sys${si}: ${ys.size} bracket heights`);
      const y = lineYOf(vgs[0]);
      ok(y <= -3 * NSP + EPS, `${c.name}@${width} sys${si}: bracket at ${y}`);
      const other = without(top, (k) => cls(k) === 'navigation' || cls(k) === 'tempo');
      vgs.forEach((vg) => {
        const p = pts(vg.children[0].getAttribute('d')); n++;
        const ink = inkBounds(other, DEF, { xMin: p[0][0], xMax: p.at(-1)[0], overlap: true }).top;
        ok(y + 1.5 * NSP <= ink - 0.5 * NSP + EPS, `${c.name}@${width} sys${si}: hook bottom ${y + 1.5 * NSP} vs ink ${ink}`);
      });
    });
  }
  ok(n > 10, `${n} brackets`);
  // Tab-only top staff: the first ending sits above the P.M. / let ring / bend / pick-stroke ink of m2.
  const tsvg = renderTree(NAV_FIX[2].score, 900);
  const ttop = topStaff(tsvg, 0);
  const ty = lineYOf(voltaGs(navGroup(tsvg, 0))[0]);
  const techs = leaves(without(ttop, (k) => cls(k) === 'navigation')).filter((k) => /pick-stroke|let-ring|palm-mute|bend/.test(cls(k)) || k.tag === 'path');
  ok(techs.length > 0 && techs.every((k) => nodeBox(k).top > ty), 'tab-only: technique ink below the bracket line');
  // Stacking in the main fixture: chord symbol and fermata of m3 below the bracket, tempo above everything under it.
  const svg = renderTree(NAV_FIX[0].score, 900);
  const top = topStaff(svg, 0);
  const y = lineYOf(voltaGs(navGroup(svg, 0))[0]);
  const chord = textsOf(top, 'chord-symbol').find((t) => t._text === 'Am7(b5)');
  const ferm = byClass(top, 'fermata', 'g')[0].n.children[0];
  ok(nodeBox(chord).top > y + 1.5 * NSP && nodeBox(ferm).top > y + 1.5 * NSP, 'chord symbol and fermata below the bracket hooks');
  ok(nodeBox(ferm).bottom <= nodeBox(chord).top + EPS, 'fermata above the chord symbol');
  const tb = nodeBox(textsOf(top, 'tempo')[0]);
  const under = leaves(navGroup(svg, 0)).map((k) => nodeBox(k)).filter((b) => b.x1 < tb.x2 && b.x2 > tb.x1);
  ok(under.length > 0 && under.every((b) => tb.bottom <= b.top + EPS), 'tempo above the navigation under it');
});

test('navigation', 'AC7/AC8: segno / coda at the measure start, jump texts bold italic right-aligned at the closing barline, To Coda glyph; one mark baseline per system above brackets and ink', () => {
  const kinds = new Set();
  for (const c of NAV_FIX) for (const width of [400, 600, 900]) {
    const svg = renderTree(c.score, width, c.options || {});
    const layout = layoutOf(c.score, width, c.options || {});
    layout.systems.forEach((sys, si) => {
      const nav = navGroup(svg, si);
      const marks = markNodes(nav);
      ok(marks.length === sys.marks.length, `${c.name}@${width} sys${si}: ${marks.length} marks vs ${sys.marks.length}`);
      if (!marks.length) return;
      const base = new Set();
      const other = without(topStaff(svg, si), (k) => k === nav || cls(k) === 'tempo');
      const vgs = voltaGs(nav);
      sys.marks.forEach((m, i) => {
        const node = marks[i]; kinds.add(m.kind);
        const ms = sys.tracks[0].measures; const li = sys.measureIndices.indexOf(m.mi);
        if (m.kind !== 'jump') {
          ok(cls(node) === m.kind && cpOf(node) === (m.kind === 'segno' ? 0xE047 : 0xE048), `${m.kind} glyph`);
          near(num(node, 'font-size'), 0.75 * 4 * NSP, EPS, 'mark glyph 0.75 x');
          const startX = li > 0 ? ms[li].x + 0.3 * NSP : (ms[0].startBarline ? ms[0].startBarline.x : sys.contentStartX + 0.5 * NSP);
          const segnoToo = m.kind === 'coda' && sys.marks.some((o) => o.kind === 'segno' && o.mi === m.mi);
          near(num(node, 'x'), segnoToo ? startX + 2.2 * 0.75 * NSP + 0.5 * NSP : startX, EPS, `${m.kind} x`);
          base.add(num(node, 'y'));
        } else {
          const t = node.children.find((k) => k.tag === 'text' && k.getAttribute('font-style') === 'italic');
          ok(t && t.getAttribute('font-weight') === 'bold' && t.getAttribute('text-anchor') === 'end' && t._text === m.text, 'bold italic, end-anchored');
          near(num(t, 'font-size'), 1.2 * NSP, EPS, 'jump size 1.2 sp');
          ok(cls(node) === `jump${m.jumpKind === 'toCoda' ? ' to-coda' : m.jumpKind === 'fine' ? ' fine' : ''}`, `class ${cls(node)}`);
          const endX = ms[li].endX;
          if (m.jumpKind === 'toCoda') {
            const gl = node.children.find((k) => cpOf(k) === 0xE048);
            near(num(gl, 'x') + 3.8 * 0.5 * NSP, endX, EPS, 'To Coda glyph right edge at the barline');
            near(num(t, 'x'), num(gl, 'x') - 0.3 * NSP, EPS, 'text 0.3 sp before the glyph');
            base.add(num(gl, 'y')); kinds.add('to-coda');
          } else near(num(t, 'x'), endX, EPS, 'right edge at the closing barline');
          base.add(num(t, 'y'));
        }
        leaves(node).forEach((k) => {
          const b = nodeBox(k);
          const ink = inkBounds(other, DEF, { xMin: b.x1, xMax: b.x2, overlap: true }).top;
          ok(b.bottom <= ink - 0.75 * NSP + EPS, `${c.name}@${width} sys${si}: mark bottom ${b.bottom} vs ink ${ink}`);
          vgs.forEach((vg) => { const p = pts(vg.children[0].getAttribute('d')); if (b.x1 < p.at(-1)[0] && b.x2 > p[0][0]) ok(b.bottom < lineYOf(vg), 'mark above an overlapping bracket'); });
        });
      });
      ok(base.size === 1, `${c.name}@${width} sys${si}: ${base.size} mark baselines`);
      ok([...base][0] <= -2.5 * NSP + EPS, 'mark baseline >= 2.5 sp up');
    });
  }
  ['segno', 'coda', 'jump', 'to-coda'].forEach((k) => ok(kinds.has(k), `covered ${k}`));
});

test('navigation', 'AC10: measure numbers never collide with navigation (fixtures and edge cases, 400/600/900)', () => {
  let n = 0;
  for (const [, score, options] of ALL_NAV()) for (const width of [400, 600, 900]) {
    const svg = renderTree(score, width, options);
    systemsOf(svg).forEach((_, si) => {
      const mn = textsOf(topStaff(svg, si), 'measure-number')[0];
      const nav = navGroup(svg, si);
      if (!mn || !nav) return;
      n++;
      leaves(nav).forEach((k) => ok(!overlaps(nodeBox(mn), nodeBox(k)), `measure number overlaps ${cls(k) || k.tag}`));
    });
  }
  ok(n >= 4, `${n} systems with a measure number and navigation`);
});

test('navigation', 'AC11: measure layout identical with the navigation fields stripped (fixtures and edge cases, 400/600/900)', () => {
  const strip = (L) => JSON.stringify(L, (k, v) => (k === 'voltas' || k === 'marks' || k === 'el' ? undefined : v));
  for (const [name, score, options] of ALL_NAV()) for (const width of [400, 600, 900]) {
    ok(strip(layoutOf(score, width, options)) === strip(layoutOf(stripNav(score), width, options)), `${name}@${width}: layout differs`);
  }
});

test('navigation', 'AC12: classes navigation, volta, volta-number, volta-open, volta-closed, segno, coda, jump, to-coda, fine; nothing without navigation fields', () => {
  const seen = new Set();
  NAV_FIX.forEach((c) => all(renderTree(c.score, c.width, c.options || {})).forEach(({ n }) => cls(n).split(' ').forEach((k) => seen.add(k))));
  ['navigation', 'volta', 'volta-number', 'volta-open', 'volta-closed', 'segno', 'coda', 'jump', 'to-coda', 'fine'].forEach((k) => ok(seen.has(k), `class ${k}`));
  for (const [name, score, options] of SCORES) {
    if (/^char-(navigation|chord-diagrams)/.test(name)) continue; // newer fixtures using navigation on purpose
    ok(!all(renderTree(score, 900, options)).some(({ n }) => /navigation|volta|segno|coda|jump/.test(cls(n))), `${name}: navigation output without navigation fields`);
  }
});

test('navigation', 'AC13: edge cases render at 400/600/900 with the expected brackets and marks; determinism; input untouched', () => {
  const expect = {
    'ending on the last measure, no repeatEnd': [1, 0, ['volta volta-open']],
    'one measure: ending + segno + coda + D.C.': [1, 3, ['volta volta-open']],
    'adjacent endings 1 / 2 / 3': [3, 0, ['volta volta-closed', 'volta volta-closed', 'volta volta-open']],
    'padded measures under an ending': [1, 1, ['volta volta-open']],
    'ending only on a shorter track': [1, 1, ['volta volta-open']],
    'segno + jump in one measure, unknown jump text': [0, 3, []],
    'garbage fields': [0, 0, []],
  };
  for (const [name, score] of EDGE) for (const width of [400, 600, 900]) {
    const before = JSON.stringify(score);
    const svg = renderTree(score, width);
    const navs = systemsOf(svg).map((_, si) => navGroup(svg, si)).filter(Boolean);
    const vg = navs.flatMap(voltaGs); const mk = navs.flatMap(markNodes);
    const [nv, nm, classes] = expect[name];
    const brackets = vg.filter((g) => g.children.some((k) => cls(k) === 'volta-number')).length; // parts split at a break count once
    ok(brackets === nv && mk.length === nm, `${name}@${width}: ${brackets} brackets, ${mk.length} marks`);
    if (width === 900) ok(JSON.stringify(vg.map(cls)) === JSON.stringify(classes), `${name}: ${JSON.stringify(vg.map(cls))}`);
    ok(serialize(renderTree(score, width)) === serialize(svg) && JSON.stringify(score) === before, `${name}@${width}: not deterministic or input mutated`);
  }
  const t = all(renderTree(EDGE[5][1], 900)).filter(({ n }) => /^jump/.test(cls(n))).map(({ n }) => [cls(n), n.children[0]._text]);
  ok(JSON.stringify(t) === JSON.stringify([['jump', 'D.S. senza replica'], ['jump', 'D.C. al Fine']]), `jump texts ${JSON.stringify(t)}`);
  for (const c of NAV_FIX) ok(serialize(renderTree(c.score, c.width, c.options || {})) === serialize(renderTree(c.score, c.width, c.options || {})), `${c.name}: determinism`);
});
}

// ======================= chord diagrams =======================
{
const CD_SHAPES = {
  C: { frets: ['x', 3, 2, 0, 1, 0], fingers: [0, 3, 2, 0, 1, 0] },
  G: { frets: [3, 2, 0, 0, 0, 3] },
  F: { frets: [1, 3, 3, 2, 1, 1], fingers: [1, 3, 4, 2, 1, 1], barre: { fret: 1 } },
  Bm: { frets: ['x', 2, 4, 4, 3, 2], barre: { fret: 2, from: 5 } },
  A7: { frets: ['x', 0, 2, 0, 2, 0] },
  E5: { frets: [0, 7, 9, 'x', 'x', 'x'] },
};
const SPC = 10; // default staffLineSpacing
const diagramGs = (g) => all(g).filter(({ n }) => n.tag === 'g' && cls(n) === 'chord-diagram').map(({ n }) => n);
const diagLeaves = (d) => all(d).filter(({ n }) => n.tag !== 'g').map(({ n }) => n);
const leafOf = (d, c) => diagLeaves(d).filter((n) => cls(n) === c);
// Grid geometry read back from the SVG: string x's, fret-line y's (nut excluded), grid top / bottom.
const gridOf = (d) => {
  const grid = d.children.find((k) => cls(k) === 'chord-diagram-grid');
  const strings = grid.children.filter((l) => num(l, 'x1') === num(l, 'x2'));
  const frets = grid.children.filter((l) => num(l, 'y1') === num(l, 'y2') && cls(l) !== 'chord-diagram-nut');
  return { strings: strings.map((l) => num(l, 'x1')), top: Math.min(...strings.map((l) => num(l, 'y1'))), bottom: Math.max(...strings.map((l) => num(l, 'y2'))),
    fretYs: frets.map((l) => num(l, 'y1')), nut: grid.children.some((l) => cls(l) === 'chord-diagram-nut') };
};
const nameOf = (d) => leafOf(d, 'chord-symbol')[0] || null;
const cdScore = (measures, extra = {}, track = {}) => ({ chordShapes: CD_SHAPES, ...extra, tracks: [{ name: 'Lead', showChordDiagrams: true, measures, ...track }] });
const qc = (pitch, chord, beat = {}) => q(pitch, { beat: { chord, ...beat } });
// Ink of a staff group without its chord diagrams / chord symbols / fermatas (the music the row must clear).
const inkWithout = (g, skip, opts = {}) => {
  const strip = (n) => ({ tag: n.tag, getAttribute: (a) => n.getAttribute(a), textContent: n._text, children: n.children.filter((k) => !skip.includes(cls(k).split(' ')[0])).map(strip) });
  return inkBounds(strip(g), resolveTheme(), opts);
};
const musicInk = (g, xMin) => inkWithout(g, ['chord-diagram', 'chord-symbol', 'fermata', 'dynamic'], { xMin });

test('chordDiagrams', 'notation path: diagrams above the staff, one grid bottom and row count per system staff, names centred on one baseline with plain symbols', () => {
  const score = cdScore([
    { beats: [qc('C5', 'C'), q('E5'), qc('G4', 'G'), q('D5')] },
    { beats: [qc('F4', 'F'), q('A5'), qc('D5', 'Dm'), q('F5')] },
    { beats: [qc('B4', 'Bm'), q('D5'), qc('A4', 'A7'), q('C#5')] },
  ]);
  const svg = renderTree(score, 900);
  const g = staffGroups(systemsOf(svg)[0])[0];
  const ds = diagramGs(g);
  ok(ds.length === 5, `${ds.length} diagrams`);
  const grids = ds.map(gridOf);
  ok(new Set(grids.map((x) => x.bottom)).size === 1, 'one grid bottom');
  ok(new Set(grids.map((x) => x.fretYs.length + (x.nut ? 1 : 0))).size === 1, 'one row count (Bm needs 4 rows like the others)');
  const plain = textsOf(g, 'chord-symbol');
  ok(plain.length === 1 && plain[0]._text === 'Dm' && plain[0].getAttribute('text-anchor') === 'start', 'Dm plain, start-anchored, outside the diagrams');
  const names = ds.map(nameOf);
  ok(JSON.stringify(names.map((t) => t._text)) === JSON.stringify(['C', 'G', 'F', 'Bm', 'A7']), 'names');
  ok(new Set([...names, ...plain].map((t) => num(t, 'y'))).size === 1, 'one name baseline incl. the plain symbol');
  names.forEach((t, i) => {
    ok(t.getAttribute('text-anchor') === 'middle', 'centred');
    near(num(t, 'x'), (grids[i].strings[0] + grids[i].strings[5]) / 2, EPS, 'name over the grid centre');
    ok(num(t, 'y') + 0.25 * num(t, 'font-size') <= Math.min(...diagLeaves(ds[i]).filter((n) => n !== t).map((n) => inkBounds(n, resolveTheme()).top)) - 0.3 * SPC + EPS, 'name >= 0.3 sp above the diagram');
  });
  const layout = layoutOf(score, 900);
  const els = layout.systems[0].tracks[0].measures.flatMap((m) => m.elements).filter((e) => e.el.chord && e.el.chord !== 'Dm');
  const sys0 = layout.systems[0];
  const half = 2.5 * SPC + 0.4 * SPC; // half the strings + a dot radius (no "Nfr" in this row)
  els.forEach((e, i) => near((grids[i].strings[0] + grids[i].strings[5]) / 2, Math.max(sys0.contentStartX + half, Math.min(e.x, sys0.staffEndX - half)), EPS, `${e.el.chord} centred on its beat (clamped)`));
  ok(els.some((e, i) => Math.abs((grids[i].strings[0] + grids[i].strings[5]) / 2 - e.x) < EPS), 'unclamped diagrams sit exactly on their beat');
  const info = staffInfo(g);
  const music = musicInk(g, layout.systems[0].contentStartX);
  const diagBottom = Math.max(...ds.map((d) => inkWithout(d, ['chord-symbol']).bottom));
  ok(diagBottom <= info.localTop - 1.5 * SPC + EPS, `diagram ink ${diagBottom} >= 1.5 sp above the top line`);
  ok(diagBottom <= music.top - 0.75 * SPC + EPS, `diagram ink ${diagBottom} >= 0.75 sp above the music (${music.top})`);
});

test('chordDiagrams', 'notation path: chordDiagram false / invalid override -> plain symbol; override without a chord -> diagram without a name; whole-measure rest keeps a plain symbol', () => {
  const score = cdScore([
    { beats: [qc('C5', 'C', { chordDiagram: false }), qc('E5', 'C', { chordDiagram: { frets: [0, 0] } }), q('G4', { beat: { chordDiagram: CD_SHAPES.G } }), qc('D5', 'G', { chordDiagram: CD_SHAPES.A7 })] },
    { beats: [{ type: 'rest', duration: 'whole', chord: 'F' }] },
  ]);
  const g = staffGroups(systemsOf(renderTree(score, 900))[0])[0];
  const ds = diagramGs(g);
  ok(ds.length === 2, `${ds.length} diagrams`);
  ok(nameOf(ds[0]) === null, 'no name without a chord');
  ok(nameOf(ds[1])._text === 'G' && leafOf(ds[1], 'chord-diagram-open').length === 3, 'override shape (A7) under the beat\'s name');
  ok(JSON.stringify(textsOf(g, 'chord-symbol').map((t) => t._text)) === JSON.stringify(['C', 'C', 'F']), 'plain symbols');
});

test('chordDiagrams', 'notation path: a fermata on a diagram beat sits >= 0.5 sp above the diagram name', () => {
  const g = staffGroups(systemsOf(renderTree(cdScore([{ beats: [qc('C5', 'C', { fermata: true }), q('E5'), q('G4'), q('D5')] }]), 900))[0])[0];
  const name = nameOf(diagramGs(g)[0]);
  const ferm = byClass(g, 'fermata').flatMap(({ n }) => n.children.filter((k) => k.tag === 'text'))[0];
  // The fermata's placement line is its glyph baseline (renderFermata; the glyph box dips 0.02 sp below it, as with plain symbols).
  ok(num(ferm, 'y') <= num(name, 'y') - 0.8 * num(name, 'font-size') - 0.5 * SPC + EPS, `fermata baseline ${num(ferm, 'y')} vs name top`);
});

test('chordDiagrams', 'tab-only path: diagrams + names above the TAB staff clear of its ink (picks, labels, bends); no plain symbols; nothing on a 4-string bass with 6-string shapes', () => {
  const tb = (string, fret, beat = {}, note = {}) => ({ type: 'note', duration: 'quarter', notes: [{ string, fret, ...note }], ...beat });
  const score = { chordShapes: CD_SHAPES, tracks: [
    { name: 'Gtr', showStandardNotation: false, showTablature: true, measures: [
      { beats: [tb(6, 1, { chord: 'F', pickStroke: 'down', palmMute: true }), tb(4, 3, { pickStroke: 'up', palmMute: true }), tb(3, 2, { chord: 'Dm' }), tb(2, 1, { chord: 'C' })] },
      { beats: [tb(5, 2, { chord: 'Bm' }), tb(3, 7, {}, { bend: 'full' }), tb(2, 5), tb(1, 5, { chord: 'G' })] },
    ] },
    { name: 'Bass', showStandardNotation: false, showTablature: true, tuning: ['E1', 'A1', 'D2', 'G2'], measures: [
      { beats: [tb(4, 1, { chord: 'F' }), tb(4, 1), tb(3, 3, { chord: 'C' }), tb(3, 3)] },
      { beats: [tb(3, 2, { chord: 'Bm' }), tb(3, 0), tb(3, 0), tb(3, 3, { chord: 'G' })] },
    ] },
  ] };
  const layout = layoutOf(score, 900);
  for (const width of [600, 900]) {
    const svg = renderTree(score, width);
    let gtr = 0;
    systemsOf(svg).forEach((sysG, si) => staffGroups(sysG).map(staffInfo).forEach((info) => {
      const ds = diagramGs(info.g);
      ok(textsOf(info.g, 'chord-symbol').length === 0, 'no plain symbols on a tab-only staff');
      if (info.track === 1) { ok(ds.length === 0, 'bass: no diagrams'); return; }
      gtr += ds.length;
      if (!ds.length) return;
      const xMin = layoutOf(score, width).systems[si].contentStartX;
      const music = inkWithout(info.g, ['chord-diagram'], { xMin });
      ds.forEach((d) => {
        const b = inkWithout(d, ['chord-symbol']).bottom;
        ok(b <= info.localTop - 1.5 * SPC + EPS && b <= music.top - 0.75 * SPC + EPS, `@${width} diagram bottom ${b} vs TAB top ${info.localTop} / ink ${music.top}`);
      });
      ok(JSON.stringify(ds.map((d) => nameOf(d)._text)).length > 2, 'names drawn');
    }));
    ok(gtr === 4, `@${width}: ${gtr} guitar diagrams (F, C, Bm, G; Dm has no shape)`);
  }
  ok(layout.systems.length >= 1);
});

test('chordDiagrams', 'tab-only path: chords without shapes (or with showChordDiagrams false) draw nothing, as before', () => {
  const tb = (string, fret, chord) => ({ type: 'note', duration: 'quarter', notes: [{ string, fret }], chord });
  const base = { tracks: [{ name: 'T', showStandardNotation: false, showTablature: true, measures: [{ beats: [tb(3, 2, 'Am'), tb(2, 1, 'C'), tb(1, 0, 'G'), tb(1, 3)] }] }] };
  const plain = serialize(renderTree(base, 900));
  ok(!/chord-symbol|chord-diagram/.test(plain), 'no chord ink without shapes');
  ok(serialize(renderTree({ ...base, chordShapes: { Dm: CD_SHAPES.C } }, 900)) === plain, 'unused dictionary: identical');
  const off = { chordShapes: CD_SHAPES, tracks: [{ ...base.tracks[0], showChordDiagrams: false }] };
  ok(serialize(renderTree(off, 900)) === plain, 'showChordDiagrams false: identical');
  ok(/chord-diagram/.test(serialize(renderTree({ ...base, chordShapes: CD_SHAPES }, 900))), 'with shapes: diagrams');
});

const { resolveShape } = await imp('src/chordShapes.js');
const CHORD_FIX = characterizationCases.filter((c) => /^chord-diagrams/.test(c.name));
const CD_WIDTHS = [400, 600, 900];
// Leaf extent (x1, x2) of a diagram's primitives, as layout/ink.js reads them (text widths estimated).
const leafX = (n) => {
  switch (n.tag) {
    case 'line': return [Math.min(num(n, 'x1'), num(n, 'x2')), Math.max(num(n, 'x1'), num(n, 'x2'))];
    case 'rect': return [num(n, 'x'), num(n, 'x') + num(n, 'width')];
    case 'circle': return [num(n, 'cx') - num(n, 'r'), num(n, 'cx') + num(n, 'r')];
    case 'path': { const xs = (n.getAttribute('d').match(/-?[\d.]+/g) || []).map(Number).filter((_, i) => i % 2 === 0); return [Math.min(...xs), Math.max(...xs)]; }
    case 'text': {
      const w = estimateTextWidth(n._text, num(n, 'font-size'), { bold: n.getAttribute('font-weight') === 'bold' });
      const a = n.getAttribute('text-anchor'); const x = num(n, 'x');
      return a === 'middle' ? [x - w / 2, x + w / 2] : a === 'end' ? [x - w, x] : [x, x + w];
    }
    default: return null;
  }
};
// Every diagram of a rendered score: { d, si, staff (staffInfo), grid, box: { x1, x2, top, bottom }, gridBox (no name) }.
const diagramsOf = (svg) => systemsOf(svg).flatMap((sysG, si) => staffGroups(sysG).map(staffInfo).flatMap((info) => diagramGs(info.g).map((d) => {
  const ls = diagLeaves(d); const xs = ls.map(leafX).filter(Boolean);
  const ink = inkBounds(d, resolveTheme()); const noName = inkWithout(d, ['chord-symbol']);
  return { d, si, staff: info, grid: gridOf(d), box: { x1: Math.min(...xs.map((e) => e[0])), x2: Math.max(...xs.map((e) => e[1])), top: ink.top, bottom: ink.bottom }, noName };
})));
// Expected diagram count per (system, track) from the layout + chordShapes.resolveShape (whole-measure rests excluded).
const expectedDiagrams = (score, width, options = {}) => {
  const norm = normalizeScore(clone(score));
  const L = computeLayout(norm, resolveTheme(options.theme), width);
  const out = new Map();
  L.systems.forEach((sys, si) => sys.tracks.forEach((tr, ti) => {
    const k = `${si}:${ti}`;
    tr.measures.forEach((m) => m.elements.forEach((le) => {
      if (!le.wholeMeasureRest && resolveShape(le.el, norm, norm.tracks[ti])) out.set(k, (out.get(k) || 0) + 1);
    }));
  }));
  return { out, L, norm };
};

test('chordDiagrams', 'AC1: an unused or notation-only chordShapes dictionary changes nothing (every existing score); showChordDiagrams false on every track changes nothing', () => {
  const names = new Set();
  for (const [, score] of SCORES) score.tracks.forEach((t) => (t.measures || []).forEach((m) => (m?.beats || []).forEach((b) => { if (b.chord) names.add(String(b.chord).trim()); })));
  const all6 = Object.fromEntries([...names].map((k) => [k, CD_SHAPES.C]));
  for (const [name, score, options] of SCORES) {
    if (/^char-chord-diagrams/.test(name)) continue;
    const base = serialize(renderTree(score, 900, options));
    ok(serialize(renderTree({ ...score, chordShapes: { 'No such chord': CD_SHAPES.C } }, 900, options)) === base, `${name}: unused dictionary`);
    const tabby = score.tracks.some((t) => t.showTablature);
    if (!tabby) ok(serialize(renderTree({ ...score, chordShapes: all6 }, 900, options)) === base, `${name}: notation-only score with matching names`);
    ok(serialize(renderTree({ ...score, chordShapes: all6, tracks: score.tracks.map((t) => ({ ...t, showChordDiagrams: false })) }, 900, options)) === base, `${name}: showChordDiagrams false`);
  }
});

test('chordDiagrams', 'AC2/AC9: every beat with a resolved shape gets exactly one diagram, on the right staff (fixtures x widths); none on whole-measure rests', () => {
  for (const c of CHORD_FIX) for (const width of CD_WIDTHS) {
    const { out, norm } = expectedDiagrams(c.score, width, c.options);
    const svg = renderTree(c.score, width, c.options || {});
    systemsOf(svg).forEach((sysG, si) => {
      const staves = staffGroups(sysG).map(staffInfo);
      norm.tracks.forEach((t, ti) => {
        const mine = staves.filter((st) => st.track === ti);
        const host = mine.find((st) => st.kind === 'notation') || mine.find((st) => st.kind === 'tab');
        const got = mine.map((st) => diagramGs(st.g).length);
        const want = out.get(`${si}:${ti}`) || 0;
        ok(got.reduce((a, b) => a + b, 0) === want, `${c.name}@${width} sys${si} t${ti}: ${got} diagrams, expected ${want}`);
        if (host) ok(diagramGs(host.g).length === want, `${c.name}@${width} sys${si} t${ti}: diagrams on the ${host.kind} staff`);
      });
    });
  }
  const g = staffGroups(systemsOf(renderTree(cdScore([{ beats: [{ type: 'rest', duration: 'whole', chord: 'C' }] }]), 900))[0])[0];
  ok(diagramGs(g).length === 0 && textsOf(g, 'chord-symbol').length === 1, 'whole-measure rest: plain symbol only');
});

test('chordDiagrams', 'AC3/AC4/AC12: grid lines, nut or "Nfr", dots on string x / row centres, markers above, fingers below, barre over its strings (fixtures x widths)', () => {
  let n = 0;
  for (const c of CHORD_FIX) for (const width of CD_WIDTHS) {
    diagramsOf(renderTree(c.score, width, c.options || {})).forEach(({ d, grid }) => {
      n++;
      const gaps = grid.strings.slice(1).map((x, i) => x - grid.strings[i]);
      ok(grid.strings.length >= 3 && gaps.every((v) => Math.abs(v - SPC) < EPS), `${c.name}: string gap 1 sp`);
      const rows = Math.round((grid.bottom - grid.top) / (1.2 * SPC));
      near(grid.bottom - grid.top, rows * 1.2 * SPC, EPS, 'grid height = rows x 1.2 sp');
      ok(rows >= 4 && rows <= 5, `rows ${rows}`);
      const fr = leafOf(d, 'chord-diagram-base-fret');
      ok(grid.nut !== (fr.length === 1), 'nut xor "Nfr"');
      ok(grid.fretYs.length === rows + (grid.nut ? 0 : 1), 'fret lines');
      if (fr.length) ok(/^\d+fr$/.test(fr[0]._text) && num(fr[0], 'x') > grid.strings.at(-1) && num(fr[0], 'y') > grid.top && num(fr[0], 'y') < grid.top + 1.2 * SPC + 0.3 * SPC + EPS, '"Nfr" right of the first row');
      const rowYs = Array.from({ length: rows }, (_, k) => grid.top + (k + 0.5) * 1.2 * SPC);
      leafOf(d, 'chord-diagram-fret').forEach((dot) => {
        ok(grid.strings.some((x) => Math.abs(x - num(dot, 'cx')) < EPS) && rowYs.some((y) => Math.abs(y - num(dot, 'cy')) < EPS), 'dot on a string, row centre');
        near(num(dot, 'r'), 0.4 * SPC, EPS, 'dot radius');
      });
      [...leafOf(d, 'chord-diagram-open'), ...leafOf(d, 'chord-diagram-muted')].forEach((mk) => {
        const b = inkBounds(mk, resolveTheme());
        ok(b.bottom < grid.top - (grid.nut ? 0.4 * SPC : 0), 'marker above the grid / nut');
      });
      leafOf(d, 'chord-diagram-finger').forEach((f) => ok(num(f, 'y') - 0.8 * num(f, 'font-size') > grid.bottom && /^[1-4T]$/.test(f._text), 'finger below the grid'));
      leafOf(d, 'chord-diagram-barre').forEach((b) => {
        const cy = num(b, 'y') + num(b, 'height') / 2;
        ok(rowYs.some((y) => Math.abs(y - cy) < EPS), 'barre centred on a row');
        near(num(b, 'rx'), num(b, 'height') / 2, EPS, 'rounded ends');
        ok(!leafOf(d, 'chord-diagram-fret').some((dot) => Math.abs(num(dot, 'cy') - cy) < EPS && num(dot, 'cx') > num(b, 'x') && num(dot, 'cx') < num(b, 'x') + num(b, 'width')), 'no dot under the barre');
      });
    });
  }
  ok(n > 30, `${n} diagrams checked`);
  // AC12: 3..10 strings from tuning.length.
  for (const k of [3, 4, 5, 7, 8, 10]) {
    const tuning = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4', 'A4', 'D5', 'G5', 'C6'].slice(0, k);
    const score = { chordShapes: { X: { frets: Array.from({ length: k }, (_, i) => (i % 3 === 0 ? 0 : 2)) } },
      tracks: [{ name: 'T', showStandardNotation: false, showTablature: true, tuning, measures: [{ beats: [{ type: 'note', duration: 'whole', notes: [{ string: 1, fret: 2 }], chord: 'X' }] }] }] };
    const ds = diagramsOf(renderTree(score, 600));
    ok(ds.length === 1 && ds[0].grid.strings.length === k, `${k} strings: ${ds.map((x) => x.grid.strings.length)}`);
  }
});

test('chordDiagrams', 'AC5/AC6: one grid bottom and one name baseline per staff per system, names centred, diagrams inside [content start, staff end], clear of the staff and its music (fixtures x widths)', () => {
  for (const c of CHORD_FIX) for (const width of CD_WIDTHS) {
    const svg = renderTree(c.score, width, c.options || {});
    const L = layoutOf(c.score, width, c.options || {});
    systemsOf(svg).forEach((sysG, si) => staffGroups(sysG).map(staffInfo).forEach((info) => {
      const ds = diagramGs(info.g);
      if (!ds.length) return;
      const sys = L.systems[si];
      const grids = ds.map(gridOf);
      ok(new Set(grids.map((x) => x.bottom)).size === 1 && new Set(grids.map((x) => x.bottom - x.top)).size === 1, `${c.name}@${width} sys${si}: one row`);
      const names = [...ds.map(nameOf).filter(Boolean), ...textsOf(info.g, 'chord-symbol')];
      ok(new Set(names.map((t) => num(t, 'y'))).size <= 1, `${c.name}@${width} sys${si}: one name baseline`);
      ds.forEach((d, i) => {
        const nm = nameOf(d); const cx = (grids[i].strings[0] + grids[i].strings.at(-1)) / 2;
        if (nm) near(num(nm, 'x'), cx, EPS, 'name centred over the grid');
        const xs = diagLeaves(d).filter((k) => cls(k) !== 'chord-symbol').map(leafX);
        ok(Math.min(...xs.map((e) => e[0])) >= sys.contentStartX - EPS || Math.max(...xs.map((e) => e[1])) > sys.staffEndX, `${c.name}@${width}: diagram left of the content start`);
        ok(Math.max(...xs.map((e) => e[1])) <= sys.staffEndX + EPS, `${c.name}@${width} sys${si}: diagram right ${Math.max(...xs.map((e) => e[1]))} past the staff end ${sys.staffEndX}`);
        const b = inkWithout(d, ['chord-symbol']).bottom;
        ok(b <= info.localTop - 1.5 * SPC + EPS, 'grid ink >= 1.5 sp above the top line');
      });
      const music = inkWithout(info.g, ['chord-diagram', 'chord-symbol', 'fermata', 'dynamic', 'navigation', 'tempo'], { xMin: sys.contentStartX });
      const bottom = Math.max(...ds.map((d) => inkWithout(d, ['chord-symbol']).bottom));
      ok(bottom <= music.top - 0.75 * SPC + EPS, `${c.name}@${width} sys${si}: row bottom ${bottom} vs music top ${music.top}`);
    }));
  }
});

test('chordDiagrams', 'AC6: centred on the beat unless clamped at the content start / staff end; horizontal spacing unchanged by chord fields', () => {
  for (const c of CHORD_FIX) for (const width of CD_WIDTHS) {
    const { L, norm } = expectedDiagrams(c.score, width, c.options);
    const svg = renderTree(c.score, width, c.options || {});
    let clamped = 0;
    L.systems.forEach((sys, si) => sys.tracks.forEach((tr, ti) => {
      const els = tr.measures.flatMap((m) => m.elements).filter((le) => !le.wholeMeasureRest && resolveShape(le.el, norm, norm.tracks[ti]));
      if (!els.length) return;
      const st = staffGroups(systemsOf(svg)[si]).map(staffInfo).filter((x) => x.track === ti);
      const ds = diagramGs((st.find((x) => x.kind === 'notation') || st[0]).g);
      els.forEach((le, i) => {
        const g = gridOf(ds[i]); const cx = (g.strings[0] + g.strings.at(-1)) / 2;
        const half = (g.strings.at(-1) - g.strings[0]) / 2 + 0.4 * SPC;
        const fr = leafOf(ds[i], 'chord-diagram-base-fret')[0];
        const right = fr ? leafX(fr)[1] - cx : half;
        const want = Math.max(sys.contentStartX + half, Math.min(le.x, sys.staffEndX - right));
        near(cx, want, EPS, `${c.name}@${width} sys${si} t${ti} #${i}`);
        if (Math.abs(cx - le.x) > EPS) clamped++;
      });
    }));
    if (width === 600 && c.name === 'chord-diagrams-break') ok(clamped >= 2, `break fixture: ${clamped} clamped diagrams`);
    const strip = (s) => ({ ...s, chordShapes: undefined, tracks: s.tracks.map((t) => ({ ...t, showChordDiagrams: undefined, measures: t.measures.map((m) => ({ ...m, beats: m.beats.map((b) => ({ ...b, chord: undefined, chordDiagram: undefined })) })) })) });
    const xs = (s) => JSON.stringify(layoutOf(s, width).systems.map((sys) => sys.tracks.map((tr) => tr.measures.map((m) => [m.x, m.endX, m.elements.map((e) => e.x)]))));
    ok(xs(c.score) === xs(strip(c.score)), `${c.name}@${width}: horizontal layout changed`);
  }
});

test('chordDiagrams', 'AC7/AC8: notation+TAB tracks draw on the notation staff only; tab-only diagrams clear picks / labels / bends; fermatas above diagrams; voltas, marks and tempo above the diagrams under them', () => {
  for (const c of CHORD_FIX) for (const width of CD_WIDTHS) {
    const svg = renderTree(c.score, width, c.options || {});
    const L = layoutOf(c.score, width, c.options || {});
    systemsOf(svg).forEach((sysG, si) => {
      const staves = staffGroups(sysG).map(staffInfo);
      staves.forEach((info) => {
        const ds = diagramGs(info.g);
        if (info.kind === 'tab' && staves.some((x) => x.track === info.track && x.kind === 'notation')) ok(ds.length === 0, 'no diagrams on the TAB of a notation+TAB track');
        if (!ds.length) return;
        const top = Math.min(...ds.map((d) => inkBounds(d, resolveTheme()).top));
        const others = all(info.g).filter(({ n, parents }) => n.tag !== 'g' && !parents.some((p) => /^(chord-diagram|navigation|fermata)$/.test(cls(p))) && !['tempo', 'chord-symbol'].includes(cls(n)));
        // Technique ink (picks, P.M., bends, tap) sits below the row.
        others.filter(({ n, parents }) => /pick-stroke|palm-mute|let-ring|bend|tap/.test([cls(n), ...parents.map(cls)].join(' ')) && n.tag !== 'g')
          .forEach(({ n }) => ok(inkBounds(n, resolveTheme()).top >= Math.max(...ds.map((d) => inkWithout(d, ['chord-symbol']).bottom)) + 0.75 * SPC - EPS, `${c.name}@${width}: technique ink above the diagram row`));
        // Fermatas: baseline >= 0.5 sp above every diagram they overlap.
        byClass(info.g, 'fermata', 'g').flatMap(({ n }) => n.children).forEach((f) => {
          const fx = [num(f, 'x') - SPC, num(f, 'x') + SPC]; // fermata glyph ~2 sp wide, centred
          ds.forEach((d) => {
            const xs = diagLeaves(d).map(leafX); const x1 = Math.min(...xs.map((e) => e[0])); const x2 = Math.max(...xs.map((e) => e[1]));
            if (x1 < fx[1] && x2 > fx[0]) ok(num(f, 'y') <= inkBounds(d, resolveTheme()).top - 0.5 * SPC + EPS, `${c.name}@${width}: fermata vs diagram`);
          });
        });
        // Navigation and tempo (top staff only): each leaf's bottom above every diagram leaf it overlaps horizontally.
        const nav = info.g.children.find((k) => cls(k) === 'navigation');
        const marks = [...(nav ? all(nav).filter(({ n }) => n.tag !== 'g').map(({ n }) => n) : []), ...info.g.children.filter((k) => cls(k) === 'tempo')];
        const dl = ds.flatMap(diagLeaves);
        marks.forEach((m) => {
          const mx = leafX(m);
          const mb = inkBounds(m, resolveTheme()).bottom;
          dl.filter((k) => { const e = leafX(k); return e[0] < mx[1] && e[1] > mx[0]; })
            .forEach((k) => ok(mb <= inkBounds(k, resolveTheme()).top + EPS, `${c.name}@${width} sys${si}: ${cls(m) || m.tag} bottom ${mb} vs diagram ${cls(k)} top ${inkBounds(k, resolveTheme()).top}`));
        });
        ok(top < info.localTop, 'row above the staff');
      });
      ok(L.systems[si] != null, 'layout system');
    });
  }
});

test('chordDiagrams', 'AC10/AC11: invalid shapes fall back to plain symbols; all-muted grid; every class is used; primitives only', () => {
  const score = cdScore([{ beats: [
    qc('C5', 'C', { chordDiagram: { frets: [1, 9, 0, 0, 0, 0] } }), qc('E5', 'X', { chordDiagram: { frets: ['x', 'x', 'x', 'x', 'x', 'x'] } }),
    qc('G4', 'Q', { chordDiagram: 'C' }), qc('D5', 'F'),
  ] }], { chordShapes: { ...CD_SHAPES, Q: { frets: 'garbage' } } });
  const g = staffGroups(systemsOf(renderTree(score, 900))[0])[0];
  ok(JSON.stringify(textsOf(g, 'chord-symbol').map((t) => t._text)) === JSON.stringify(['C', 'Q']), 'span > 5 and a garbage dictionary entry -> plain');
  const ds = diagramGs(g);
  ok(ds.length === 2 && leafOf(ds[0], 'chord-diagram-muted').length === 6 && leafOf(ds[0], 'chord-diagram-fret').length === 0, 'all-muted grid');
  const seen = new Set();
  for (const c of CHORD_FIX) all(renderTree(c.score, c.width, c.options || {})).forEach(({ n, parents }) => {
    if (parents.some((p) => cls(p) === 'chord-diagram') || cls(n) === 'chord-diagram') {
      seen.add(cls(n));
      ok(['g', 'line', 'rect', 'circle', 'path', 'text'].includes(n.tag), `primitive ${n.tag}`);
      if (n.tag === 'text') ok(n.getAttribute('font-family') === resolveTheme().textFontFamily, 'diagram text uses the text font');
    }
  });
  ['chord-diagram', 'chord-diagram-grid', 'chord-diagram-nut', 'chord-diagram-base-fret', 'chord-diagram-barre', 'chord-diagram-fret', 'chord-diagram-finger', 'chord-diagram-open', 'chord-diagram-muted', 'chord-symbol']
    .forEach((k) => ok(seen.has(k), `class ${k}`));
});

test('chordDiagrams', 'scaling: at staffLineSpacing 20 every diagram dimension doubles (string / fret gap, dot, nut, barre, labels)', () => {
  const c = CHORD_FIX[0];
  const geo = (theme) => diagramsOf(renderTree(c.score, 1800, { theme })).map(({ d, grid }) => ({
    gap: grid.strings[1] - grid.strings[0], h: grid.bottom - grid.top,
    r: leafOf(d, 'chord-diagram-fret').map((x) => num(x, 'r')), nut: leafOf(d, 'chord-diagram-nut').map((x) => num(x, 'stroke-width')),
    barre: leafOf(d, 'chord-diagram-barre').map((x) => num(x, 'height')), fs: leafOf(d, 'chord-diagram-finger').map((x) => num(x, 'font-size')),
    lw: num(d.children[0].children[0], 'stroke-width'),
  }));
  const a = geo({}); const b = geo({ staffLineSpacing: 20 });
  ok(a.length === b.length && a.length > 0, `${a.length} / ${b.length} diagrams`);
  a.forEach((x, i) => {
    near(b[i].gap, 2 * x.gap, EPS, 'string gap'); near(b[i].h, 2 * x.h, EPS, 'grid height'); near(b[i].lw, 2 * x.lw, EPS, 'line width');
    x.r.forEach((v, j) => near(b[i].r[j], 2 * v, EPS, 'dot r')); x.nut.forEach((v, j) => near(b[i].nut[j], 2 * v, EPS, 'nut'));
    x.barre.forEach((v, j) => near(b[i].barre[j], 2 * v, EPS, 'barre')); x.fs.forEach((v, j) => near(b[i].fs[j], 2 * v, EPS, 'finger size'));
  });
  near(b[0].gap, 20, EPS, '1 sp = 20 px');
});

test('chordDiagrams', 'robustness: garbage chordShapes / chordDiagram / showChordDiagrams values render without throwing or NaN', () => {
  const garbage = [null, 0, 1, -1, NaN, 'x', '', [], [[]], {}, { frets: null }, { frets: [] }, { frets: Array(6).fill('?') }, { frets: Array(6).fill(0), fingers: 'abc', barre: 'yes', baseFret: 'z' },
    { frets: Array(6).fill(0), barre: { fret: NaN, from: {}, to: [] } }, { frets: [24, 24, 24, 24, 24, 24], baseFret: 99 }, true, false];
  for (const gv of garbage) {
    const score = { chordShapes: { C: gv, G: CD_SHAPES.G }, tracks: [
      { name: 'A', showChordDiagrams: gv, showTablature: true, measures: [{ beats: [qc('C5', 'C', { chordDiagram: gv }), qc('E5', 'G'), q('G4', { beat: { chordDiagram: gv } }), qc('D5', gv)] }] },
      { name: 'B', showStandardNotation: false, showTablature: true, measures: [{ beats: [tabNote(1, 0, {}), tabNote(2, 1), tabNote(3, 0), tabNote(4, 2)].map((b) => ({ ...b, chord: 'C', chordDiagram: gv })) }] },
    ] };
    for (const width of [300, 900]) {
      let out;
      try { out = serialize(renderTree(score, width)); } catch (e) { ok(false, `${JSON.stringify(gv)}@${width}: threw ${e.message}`); continue; }
      ok(!/NaN|undefined|Infinity/.test(out), `${JSON.stringify(gv)}@${width}: bad number in the SVG`);
    }
  }
  const odd = { chordShapes: { C: CD_SHAPES.C }, tracks: [{ name: 'T', showTablature: true, tuning: ['E2', 'A2'], measures: [{ beats: [qc('C4', 'C')] }] }] };
  ok(!/chord-diagram/.test(serialize(renderTree(odd, 600))), '2-string tuning: no diagram');
});

test('chordDiagrams', 'determinism: fixtures render identically twice; inputs untouched', () => {
  for (const c of CHORD_FIX) for (const width of CD_WIDTHS) {
    const before = JSON.stringify(c.score);
    const a = serialize(renderTree(c.score, width, c.options || {}));
    const b0 = makeContainer();
    new MusicScoreRenderer(b0, c.score, { width, ...(c.options || {}) }).render(); // uncloned
    ok(serialize(b0.children[0]) === a && serialize(renderTree(c.score, width, c.options || {})) === a, `${c.name}@${width}: not deterministic`);
    ok(JSON.stringify(c.score) === before, `${c.name}: input mutated`);
  }
});
}

// ======================= techniques 1.1 (slap / pop, rake, trill, whammy dive / return / pre-dive) =======================
// Raw-score oracles, geometry recomputed from the rendered SVG (local staff coordinates). Fixtures `techniques-11`
// (w900) and `techniques-11-break` (w600) are in tests/fixtures/characterization.js; unit tables live in units.mjs.
{
const { techniqueLabelSize } = await imp('src/draw/tab.js');
const SP = DEF.staffLineSpacing;
const tg = (root, c) => all(root).filter(({ n }) => n.tag === 'g' && cls(n).split(' ').includes(c)).map(({ n }) => n);
const tAny = (...beats) => ({ tracks: [{ name: 'G', showTablature: true, measures: [{ beats }] }] });
const tOnly = (beats, extra = {}) => ({ tracks: [{ name: 'G', showStandardNotation: false, showTablature: true, measures: [{ beats }], ...extra }] });
const nOnly = (beats, extra = {}) => ({ tracks: [{ name: 'N', measures: [{ beats }], ...extra }] });
const bt = (string, fret, extra = {}, note = {}) => ({ type: 'note', duration: 'quarter', notes: [{ string, fret, ...note }], ...extra });
const nt = (pitch, extra = {}, note = {}) => ({ type: 'note', duration: 'quarter', notes: [{ pitch, ...note }], ...extra });
const rst = () => ({ type: 'rest', duration: 'quarter' });
// x of every layout element (graces included) of track `ti`, in score order, with its system index.
const elXs = (score, width, ti = 0) => layoutOf(score, width).systems.flatMap((sys, si) => sys.tracks[ti].measures.flatMap((m) => m.elements.map((le) => ({ si, x: le.x, type: le.el.type }))));
const tabStg = (svg, si = 0, ti = 0) => staffOfTrack(svg, si, ti, true);
const notStg = (svg, si = 0, ti = 0) => staffOfTrack(svg, si, ti, false);
const letterBox = (g) => ({ ...tbox(g.children[0], { bold: true }), x: num(g.children[0], 'x'), letter: g.children[0]._text });
const hpLetters = (stg) => tg(stg, 'hammer-pull').map((g) => g.children.find((c) => c.tag === 'rect')).filter(Boolean).map(rectBox);

// ---------- slap / pop ----------
test('techniques11', 'slap / pop: one bold letter per beat by priority tap > slap > pop, class slap / pop, centred on the beat, TAB and notation both; none on rests, graces or tapped harmonics', () => {
  const score = tAny(
    bt(3, 5, {}, { slap: true }),
    bt(3, 5, {}, { pop: true }),
    hq([{ string: 3, fret: 5, pop: true }, { string: 2, fret: 3, slap: true }]),
    bt(3, 5, {}, { tap: true, slap: true, pop: true }),
    { ...rst(), slap: true },
    { type: 'grace', duration: '16th', notes: [{ string: 3, fret: 5, slap: true }] },
    bt(3, 5, {}, { slap: true, tap: true, harmonic: 'tapped', harmonicFret: 17 }),
    bt(3, 5),
  );
  const svg = renderTree(score, 1200);
  const xs = elXs(score, 1200).filter((e) => e.type !== 'grace' || true);
  const want = [['slap', 'S', xs[0].x], ['pop', 'P', xs[1].x], ['slap', 'S', xs[2].x], ['tap', 'T', xs[3].x]];
  const slapTH = xs[6].x;
  [tabStg(svg), notStg(svg)].forEach((stg, k) => {
    const got = ['slap', 'pop', 'tap'].flatMap((c) => tg(stg, c).map((g) => ({ c, ...letterBox(g) }))).sort((a, b) => a.x - b.x);
    // the tapped harmonic + slap beat shows S (T.H. already says tapped); beats 4 shows T
    const exp = [...want, ['slap', 'S', slapTH]];
    ok(got.length === exp.length, `${k ? 'notation' : 'TAB'}: ${got.length} letters, expected ${exp.length}`);
    got.forEach((g, i) => {
      ok(g.c === exp[i][0] && g.letter === exp[i][1], `letter ${i}: ${g.c} "${g.letter}" vs ${exp[i][0]} "${exp[i][1]}"`);
      near(g.x, exp[i][2], EPS, `letter ${i} x`);
      const t = tg(stg, g.c).find((q_) => Math.abs(num(q_.children[0], 'x') - g.x) < EPS).children[0];
      ok(t.getAttribute('font-weight') === 'bold' && t.getAttribute('text-anchor') === 'middle' && !t.getAttribute('font-style'), 'bold upright centred');
    });
  });
});

test('techniques11', 'slap / pop on TAB: baseline >= 0.4 sp above the top line and every fret ink under it, >= 0.5 sp clear of a hammer-on/pull-off letter; notation pick stroke >= 0.4 sp above the letter', () => {
  const score = tAny(
    bt(3, 5, { pickStroke: 'down' }, { slap: true }),
    bt(2, 12, { pickStroke: 'up' }, { pop: true }),
    bt(1, 15, { pickStroke: 'down', hammerPull: true }, { pop: true, hammerPull: 'p' }),
    bt(1, 12, {}, {}),
  );
  const svg = renderTree(score, 1200);
  const stg = tabStg(svg);
  const info = staffInfo(stg);
  const frets = tabInk(stg).filter((b) => b.kind === 'fret');
  const letters = hpLetters(stg);
  const marks = ['slap', 'pop'].flatMap((c) => tg(stg, c).map(letterBox));
  ok(marks.length === 3 && letters.length >= 1, `${marks.length} TAB letters, ${letters.length} H/P letters`);
  marks.forEach((m) => {
    const t = tg(stg, m.letter === 'S' ? 'slap' : 'pop').find((g) => Math.abs(num(g.children[0], 'x') - m.x) < EPS).children[0];
    ok(num(t, 'y') <= info.localTop - 0.4 * SP + EPS, `TAB letter at ${m.x}: baseline ${num(t, 'y')} vs top line ${info.localTop}`);
    frets.filter((f) => xover(m, f)).forEach((f) => ok(num(t, 'y') <= f.top - 0.4 * SP + EPS, `fret ink ${f.top} under letter at ${m.x}`));
    letters.forEach((l) => {
      const pad = { x1: l.x1 - 0.5 * SP + EPS, x2: l.x2 + 0.5 * SP - EPS, top: l.top - 0.5 * SP + EPS, bottom: l.bottom + 0.5 * SP - EPS };
      ok(!boxesHit(pad, m), `letter at ${m.x} within 0.5 sp of an H/P letter`);
    });
  });
  const ns = notStg(svg);
  const picks = dgroups(ns, 'pick-stroke').map(pickBox);
  const nmarks = ['slap', 'pop'].flatMap((c) => tg(ns, c).map(letterBox));
  ok(nmarks.length === 3 && picks.length === 3, `${nmarks.length} notation letters, ${picks.length} picks`);
  nmarks.forEach((m) => {
    const p = picks.find((q_) => Math.abs(q_.x - m.x) < EPS);
    ok(p && p.bottom <= m.top - 0.4 * SP + EPS, `pick bottom ${p && p.bottom} not 0.4 sp above letter top ${m.top}`);
  });
});

test('techniques11', 'slap / pop on a 4-string bass track (E1 A1 D2 G2): letters drawn on TAB and notation, nothing below the staff, no NaN', () => {
  const bass = { tuning: ['E1', 'A1', 'D2', 'G2'], clef: 'bass' };
  const score = { tracks: [{ name: 'B', ...bass, showTablature: true, measures: [{ beats: [bt(4, 3, {}, { slap: true }), bt(3, 2, {}, { pop: true }), bt(2, 0, {}, { tap: true }), bt(1, 5)] }] }] };
  const svg = renderTree(score, 900);
  ok(tg(tabStg(svg), 'slap').length === 1 && tg(tabStg(svg), 'pop').length === 1 && tg(tabStg(svg), 'tap').length === 1, 'TAB S P T');
  ok(tg(notStg(svg), 'slap').length === 1 && tg(notStg(svg), 'pop').length === 1 && tg(notStg(svg), 'tap').length === 1, 'notation S P T');
  const s = serialize(svg);
  ok(!/NaN|undefined|Infinity/.test(s), 'no NaN/undefined/Infinity');
  const info = staffInfo(tabStg(svg));
  tg(tabStg(svg), 'slap').forEach((g) => ok(num(g.children[0], 'y') < info.localTop, 'above the staff'));
});

// ---------- rake ----------
const gr = (string = 3, fret = 5) => ({ type: 'grace', duration: '16th', notes: [{ string, fret, mute: true }] });
// Raw beats of track `ti` paired with their layout x / system (like dirModel, but for any in-test score).
function seqOf(score, width, ti = 0, options = {}) {
  const raws = score.tracks[ti].measures.flatMap((m) => m.beats);
  const els = layoutOf(score, width, options).systems.flatMap((sys, si) => sys.tracks[ti].measures.flatMap((m) => m.elements.map((le) => ({ si, x: le.x }))));
  ok(raws.length === els.length, `${raws.length} raw beats vs ${els.length} layout elements`);
  return raws.map((raw, i) => ({ raw, ...els[i] }));
}
const rawRake = (b) => rawMain(b) && !!b.rake;
// Oracle: the run of rake beat i = the graces directly before it on the same system, then the beat.
const rakeRunsOf = (seq) => seq.flatMap((b, i) => {
  if (!rawRake(b.raw)) return [];
  let k = i;
  while (k > 0 && seq[k - 1].raw.type === 'grace' && seq[k - 1].si === b.si) k--;
  return [{ si: b.si, startX: seq[k].x, beatX: b.x, nextX: seq[i + 1] && seq[i + 1].si === b.si ? seq[i + 1].x : null }];
});

test('techniques11', 'rake: one "rake" run per rake beat, label x = first directly preceding grace on the system else the beat, dash end <= next beat - 0.6 sp and last barline - 0.5 sp (tab, tab+notation, notation-only)', () => {
  const beats = [
    gr(), gr(), gr(), bt(3, 7, { rake: 'down' }), bt(3, 5), bt(3, 7, { rake: true }), gr(), bt(3, 9, { rake: 'UP' }),
    rst(), { ...rst(), rake: true }, gr(), { ...gr(), rake: true }, bt(2, 3),
  ];
  const mk = (kind) => (kind === 'tab' ? tOnly(beats) : kind === 'both' ? tAny(...beats) : nOnly(beats.map((b) => (b.notes && b.notes[0].string ? { ...b, notes: [{ pitch: 'E4', mute: true }] } : b))));
  let runs = 0;
  ['tab', 'both', 'notation'].forEach((kind) => {
    const score = mk(kind);
    const seq = seqOf(score, 1200);
    const want = rakeRunsOf(seq).sort((a, b) => a.startX - b.startX);
    ok(want.length === 3, `oracle: ${want.length} rake runs`);
    const layout = layoutOf(score, 1200);
    const stg = kind === 'notation' ? notStg(renderTree(score, 1200)) : tabStg(renderTree(score, 1200));
    const got = tg(stg, 'rake').sort((a, b) => num(a.children[0], 'x') - num(b.children[0], 'x'));
    ok(got.length === want.length, `${kind}: ${got.length} rake groups, expected ${want.length}`);
    got.forEach((g, i) => {
      const t = g.children[0];
      ok(t._text === 'rake' && t.getAttribute('font-style') === 'italic' && t.getAttribute('font-weight') === 'bold', 'italic bold "rake"');
      near(num(t, 'x'), want[i].startX, EPS, `${kind} run ${i} label x`);
      const dash = g.children.find((c) => c.tag === 'path');
      if (dash) {
        const end = dashEnd(g);
        if (want[i].nextX != null) ok(end <= want[i].nextX - 0.6 * SP + EPS, `${kind} run ${i}: dash end ${end} past next beat ${want[i].nextX}`);
        ok(end <= layout.systems[want[i].si].lastBarlineX - 0.5 * SP + EPS, `${kind} run ${i}: dash end ${end} past the barline`);
        ok(end >= want[i].beatX - EPS, `${kind} run ${i}: dash end ${end} short of the beat ${want[i].beatX}`);
      }
      runs++;
    });
  });
  ok(runs === 9, `${runs} runs checked`);
});

test('techniques11', 'rake: "down" / "up" / true draw identically; a falsy rake draws nothing; rests and graces carry no rake', () => {
  const mk = (r) => tOnly([gr(), bt(3, 7, { rake: r }), bt(3, 5)]);
  const a = serialize(renderTree(mk('down'), 900));
  ok(a === serialize(renderTree(mk('up'), 900)) && a === serialize(renderTree(mk(true), 900)) && a === serialize(renderTree(mk(' Down '), 900)), 'forms differ');
  ok(tg(renderTree(mk(true), 900), 'rake').length === 1, 'one rake group');
  [false, 0, '', null, undefined].forEach((r) => ok(tg(renderTree(mk(r), 900), 'rake').length === 0, `rake ${String(r)} drew a run`));
  const nothing = tOnly([{ ...rst(), rake: true }, { ...gr(), rake: true }, bt(3, 5)]);
  ok(tg(renderTree(nothing, 900), 'rake').length === 0, 'rest / grace rake drew a run');
});

test('techniques11', 'rake: stacks outside every overlapping P.M. / harmonic / let-ring run (TAB higher, notation-only lower); adjacent rakes never merge and do not overlap', () => {
  const pm = (b) => ({ ...b, palmMute: true });
  const lr = (b) => ({ ...b, letRing: true });
  const beats = [
    pm(lr(gr())), pm(lr(gr())), pm(lr(bt(3, 7, { rake: 'down' }))), pm(lr(bt(3, 5))),
    gr(), bt(3, 7, { rake: true }), bt(3, 7, { rake: true }),
    bt(2, 5, {}, { harmonic: 'artificial', harmonicFret: 17 }), bt(2, 5, { rake: true }, { harmonic: 'artificial', harmonicFret: 17 }),
  ];
  const svg = renderTree(tOnly(beats), 1200);
  const stg = tabStg(svg);
  const label = (c) => tg(stg, c).map((g) => ({ g, y: num(g.children[0], 'y'), x1: num(g.children[0], 'x'), x2: dashEnd(g) ?? num(g.children[0], 'x') + 30 }));
  const rakes = label('rake');
  ok(rakes.length === 4, `${rakes.length} rake runs (adjacent rakes never merge)`);
  const others = [...label('palm-mute'), ...label('let-ring'), ...tg(stg, 'harmonic').map((g) => ({ y: num(g.children[0], 'y'), x1: num(g.children[0], 'x'), x2: dashEnd(g) ?? num(g.children[0], 'x') + 30 }))];
  const sizeL = techniqueLabelSize(DEF);
  let stacked = 0;
  rakes.forEach((r) => others.filter((o) => o.x1 < r.x2 && r.x1 < o.x2).forEach((o) => {
    ok(r.y <= o.y - sizeL + EPS, `rake at y ${r.y} not a lane above run at y ${o.y}`); // TAB labels stack upward
    stacked++;
  }));
  ok(stacked >= 3, `${stacked} overlaps exercised`);
  rakes.forEach((a, i) => rakes.slice(i + 1).forEach((b) => {
    const ta = { x1: a.x1, x2: a.x1 + estimateTextWidth('rake', sizeL, { bold: true }), top: a.y - 1, bottom: a.y + 1 };
    const tb = { x1: b.x1, x2: b.x1 + estimateTextWidth('rake', sizeL, { bold: true }), top: b.y - 1, bottom: b.y + 1 };
    ok(!boxesHit(ta, tb), 'two rake labels overlap');
  }));
  const nSvg = renderTree(nOnly([{ ...nt('E4', {}, { mute: true }), letRing: true }, { ...nt('E4', { rake: true }, { mute: true }), letRing: true }]), 900);
  const nStg = notStg(nSvg);
  const ring = tg(nStg, 'let-ring')[0]; const rk = tg(nStg, 'rake')[0];
  ok(num(rk.children[0], 'y') >= num(ring.children[0], 'y') + sizeL - EPS, 'notation-only: rake a lane below let ring');
});

test('techniques11', 'rake: graces never join P.M. / harmonic / let-ring runs - those groups are byte-identical with and without the rake marks', () => {
  const base = [
    { ...gr(), palmMute: true }, { ...bt(3, 7), palmMute: true }, { ...gr(), palmMute: true }, bt(3, 5),
    { ...gr(), letRing: true }, { ...bt(3, 7), letRing: true }, gr(), { ...bt(3, 7), letRing: true },
    gr(), bt(2, 5, {}, { harmonic: 'artificial', harmonicFret: 17 }), gr(), bt(2, 5, {}, { harmonic: 'artificial', harmonicFret: 17 }), bt(3, 5),
  ];
  const withRake = base.map((b, i) => (i === 1 || i === 5 || i === 11 ? { ...b, rake: 'down' } : b));
  [tOnly, (b) => tAny(...b)].forEach((mk) => {
    const a = renderTree(mk(base), 1200); const b = renderTree(mk(withRake), 1200);
    ['palm-mute', 'let-ring', 'harmonic'].forEach((c) => {
      const ga = tg(tabStg(a), c).map(serialize); const gb = tg(tabStg(b), c).map(serialize);
      ok(ga.length >= 1, `${c}: no runs exercised`);
      ok(JSON.stringify(ga) === JSON.stringify(gb), `${c} groups changed by the rake marks`);
    });
    ok(tg(tabStg(a), 'rake').length === 0 && tg(tabStg(b), 'rake').length === 3, 'rake groups only with the marks');
  });
});

test('techniques11', 'rake: a run never crosses a system break - a rake beat opening a system takes no graces from the system before', () => {
  const measures = Array.from({ length: 6 }, (_, i) => ({ beats: [bt(3, 5, { rake: true }), bt(3, 7), bt(3, 5), bt(3, 7), ...(i < 5 ? [gr()] : [])] }));
  const score = { tracks: [{ name: 'G', showStandardNotation: false, showTablature: true, measures }] };
  const width = 420;
  const seq = seqOf(score, width);
  const want = rakeRunsOf(seq);
  ok(new Set(seq.map((b) => b.si)).size >= 2, 'the score breaks into several systems');
  const svg = renderTree(score, width);
  let opens = 0; let withGrace = 0;
  want.forEach((w) => {
    const stg = tabStg(svg, w.si);
    const g = tg(stg, 'rake').find((q_) => Math.abs(num(q_.children[0], 'x') - w.startX) < EPS);
    ok(!!g, `rake label at x ${w.startX} on system ${w.si}`);
    if (w.startX === w.beatX) opens++; else withGrace++;
  });
  ok(opens >= 2 && withGrace >= 1, `${opens} runs without graces, ${withGrace} with graces`);
  ok(tg(svg, 'rake').length === want.length, `${tg(svg, 'rake').length} rake groups for ${want.length} rake beats`);
});

// ---------- trill ----------
const { glyphBox: gbox } = await imp('src/glyphMetrics.js');
const TRILL_HALF = (gbox('').width / 2) * SP;
// A drawn trill: glyph (centre x, ink box), optional suffix text, wave extent (null when too short).
const trillInfo = (g) => {
  const gl = g.children.find((c) => c.tag === 'text' && cpOf(c) === 0xE566);
  const suf = g.children.find((c) => c.tag === 'text' && cpOf(c) !== 0xE566);
  const p = g.children.find((c) => c.tag === 'path');
  const v = p ? pathNums(p.getAttribute('d')) : null;
  const ink = [nodeBox(gl), ...(suf ? [tbox(suf)] : [])];
  const waveBox = p ? hullOf(p.getAttribute('d')) : null;
  return {
    x: num(gl, 'x'), glyph: nodeBox(gl), anchor: gl.getAttribute('text-anchor'), suffix: suf ? suf._text : null, sufBox: suf ? tbox(suf) : null,
    waveX1: v ? v[0] : null, waveX2: v ? v[v.length - 2] : null, waveY: v ? v[1] : null, wave: p, waveBox,
    top: Math.min(...ink.map((b) => b.top), ...(waveBox ? [waveBox.top] : [])), bottom: nodeBox(gl).bottom,
  };
};
const trillsOf = (stg) => tg(stg, 'trill').map(trillInfo).sort((a, b) => a.x - b.x);
const trillBeat = (extra = {}, note = {}, pitch = 'E4') => ({ type: 'note', duration: 'quarter', notes: [{ pitch, trill: true, ...note }], ...extra });

test('techniques11', 'trill: one trill per trilled main beat on notation and TAB (glyph U+E566 centred on the beat, class trill), none on rests / graces / garbage values, one per chord', () => {
  const score = tAny(
    bt(3, 5, {}, { trill: 7 }),
    hq([{ string: 3, fret: 5, trill: true }, { string: 2, fret: 3, trill: 4 }]),
    { ...rst(), notes: [{ string: 3, fret: 5, trill: true }] },
    { type: 'grace', duration: '16th', notes: [{ string: 3, fret: 5, trill: true }] },
    bt(3, 5, {}, { trill: false }), bt(3, 5, {}, { trill: 0 }), bt(3, 5, {}, { trill: 'H9' }), bt(3, 5, {}, { trill: -1 }), bt(3, 5, {}, { trill: '' }),
    bt(3, 5, {}, { trill: { fret: 0 } }),
    bt(3, 5, {}, { trill: [7] }), bt(3, 5),
  );
  const width = 1500;
  const svg = renderTree(score, width);
  const xs = elXs(score, width);
  [tabStg(svg), notStg(svg)].forEach((stg, k) => {
    const got = trillsOf(stg);
    const want = [xs[0].x, xs[1].x, xs[9].x];
    ok(got.length === 3, `${k ? 'notation' : 'TAB'}: ${got.length} trills`);
    got.forEach((t, i) => { near(t.x, want[i], EPS, 'glyph x'); ok(t.anchor === 'middle', 'centred'); });
  });
  const tabs = trillsOf(tabStg(svg));
  ok(tabs[0].suffix === '(7)' && tabs[1].suffix === null && tabs[2].suffix === '(0)', `suffixes ${tabs.map((t) => t.suffix)} (a chord uses its first trilled note: a plain trill)`);
  ok(trillsOf(notStg(svg)).every((t) => t.suffix === null), 'no suffix on the notation staff');
  const out = serialize(svg);
  ok(!/NaN|undefined|Infinity/.test(out), 'no NaN');
});

test('techniques11', 'trill on TAB: "(n)" is the given fret, or the trill pitch\'s nearest interval from the note\'s fret (A3 = string 4 fret 7 -> B3 / B4 / B2 = 9, Ab3 = 6, E4 = 2); none for a plain trill or a negative result', () => {
  const t = (note) => bt(4, 7, {}, note);
  const score = tOnly([t({ trill: 'B3' }), t({ trill: 'B4' }), t({ trill: 'Ab3' }), t({ trill: true }), t({ trill: ' b2 ' }),
    bt(4, 1, {}, { trill: 'B2' }), t({ trill: 3 }), t({ trill: 'E4' })]);
  const got = trillsOf(tabStg(renderTree(score, 1600))).map((x) => x.suffix);
  ok(JSON.stringify(got) === JSON.stringify(['(9)', '(9)', '(6)', null, '(9)', null, '(3)', '(2)']), `suffixes ${JSON.stringify(got)}`);
});

test('techniques11', 'trill wave: after the glyph (and suffix) + 0.25 sp, Q segments, ends <= next beat - 0.8 sp and last barline - 0.5 sp; left out when shorter than 0.7 sp; never continues on the next system', () => {
  const width = 420;
  const measures = Array.from({ length: 5 }, (_, i) => ({ beats: [bt(3, 5), bt(3, 7, {}, { trill: i % 2 ? 7 : true }), bt(3, 5), bt(3, 7, {}, { trill: 5 })] }));
  const score = { tracks: [{ name: 'G', showTablature: true, measures }] };
  const seq = seqOf(score, width);
  const layout = layoutOf(score, width);
  const svg = renderTree(score, width);
  const want = seq.filter((b) => b.raw.notes && b.raw.notes[0].trill);
  ok(new Set(seq.map((b) => b.si)).size >= 2, 'several systems');
  let waves = 0; let lastOnSystem = 0;
  [tabStg, notStg].forEach((stgOf) => {
    ok(tg(svg, 'trill').length === 2 * want.length, `${tg(svg, 'trill').length} trill groups for ${want.length} beats`);
    layout.systems.forEach((sys, si) => {
      const stg = stgOf(svg, si);
      const mine = want.filter((b) => b.si === si);
      const got = trillsOf(stg);
      ok(got.length === mine.length, `system ${si}: ${got.length} trills for ${mine.length} trilled beats`);
      got.forEach((tr, i) => {
        const idx = seq.indexOf(mine[i]);
        const next = seq[idx + 1] && seq[idx + 1].si === si ? seq[idx + 1].x : Infinity;
        const right = tr.sufBox ? tr.sufBox.x2 : mine[i].x + TRILL_HALF;
        if (tr.wave) {
          ok(tr.wave.getAttribute('d').includes(' Q '), 'Q segments');
          ok(tr.waveX1 >= right + 0.25 * SP - EPS, `wave starts ${tr.waveX1}, glyph/suffix right ${right}`);
          ok(tr.waveX2 <= next - 0.8 * SP + EPS, `wave end ${tr.waveX2} vs next ${next}`);
          ok(tr.waveX2 <= sys.lastBarlineX - 0.5 * SP + EPS, 'wave inside the last barline');
          waves++;
        } else {
          ok(Math.min(next - 0.8 * SP, sys.lastBarlineX - 0.5 * SP) - (right + 0.25 * SP) < 0.7 * SP + EPS, 'wave dropped only when too short');
        }
      });
      if (mine.length && mine.at(-1).x === Math.max(...seq.filter((b) => b.si === si).map((b) => b.x))) lastOnSystem++;
    });
  });
  ok(waves >= 4, `${waves} waves checked`);
  ok(lastOnSystem >= 2, `${lastOnSystem} trills on the last beat of a system`);
});

test('techniques11', 'trill on TAB: bottom >= 0.4 sp above the top line, the beat\'s frets and its vibrato / tremolo; T / S / P letter >= 0.4 sp above the trill; whammy dip above it', () => {
  const score = tOnly([
    bt(3, 5, {}, { trill: 7 }),
    bt(1, 12, { vibrato: true }, { trill: 'B5' }),
    bt(2, 8, { tremolo: 2 }, { trill: true, tap: true }),
    bt(6, 3, { whammy: '1' }, { trill: 7, slap: true }),
    bt(3, 5, { pickStroke: 'down' }, { trill: 7, pop: true }),
  ]);
  const svg = renderTree(score, 1400);
  const stg = tabStg(svg);
  const info = staffInfo(stg);
  const ink = tabInk(stg);
  const trs = trillsOf(stg);
  ok(trs.length === 5, `${trs.length} trills`);
  const frets = ink.filter((b) => b.kind === 'fret');
  const marks = [...tg(stg, 'tab-vibrato'), ...tg(stg, 'tab-tremolo')].map((g) => {
    const bs = all(g).map(({ n }) => nodeBox(n)).filter(Boolean);
    return { x1: Math.min(...bs.map((q_) => q_.x1)), x2: Math.max(...bs.map((q_) => q_.x2)), top: Math.min(...bs.map((q_) => q_.top)) };
  });
  ok(marks.length === 2, `${marks.length} vibrato / tremolo groups`);
  trs.forEach((t, i) => {
    const span = { x1: t.glyph.x1, x2: t.waveBox ? t.waveBox.x2 : t.glyph.x2 };
    ok(t.bottom <= info.localTop - 0.4 * SP + EPS, `trill ${i}: bottom ${t.bottom} vs top line ${info.localTop}`);
    frets.filter((f) => xover(span, f)).forEach((f) => ok(t.bottom <= f.top - 0.4 * SP + EPS, `trill ${i}: fret ink ${f.top}`));
    marks.filter((m) => xover(span, m)).forEach((m) => ok(t.bottom <= m.top - 0.4 * SP + EPS, `trill ${i}: vibrato / tremolo ${m.top}`));
  });
  [['tap', 2], ['slap', 3], ['pop', 4]].forEach(([c, i]) => {
    const l = tg(stg, c).map(letterBox)[0];
    ok(!!l && l.bottom <= trs[i].top - 0.4 * SP + EPS, `${c}: letter bottom ${l && l.bottom} vs trill top ${trs[i].top}`);
  });
  const dip = tg(stg, 'whammy').map(dipBox)[0];
  ok(dip.vBox.bottom <= trs[3].top - 0.4 * SP + EPS, `dip bottom ${dip.vBox.bottom} vs trill top ${trs[3].top}`);
});

test('techniques11', 'trill on the notation staff: above vibrato / tremolo, T above the trill, pick stroke above both, fermata >= 0.5 sp above the stack, above the next tall note by 1 sp', () => {
  const score = nOnly([
    { ...nt('E4', { vibrato: true }, { trill: true }) },
    { ...nt('G4', { tremolo: 2, duration: 'half' }, { trill: 7 }) },
    { ...nt('E4', { pickStroke: 'down' }, { trill: true, tap: true }) },
    { ...nt('E4', { fermata: true }, { trill: true }) },
    nt('E4', {}, { trill: true }), nt('A6'),
  ]);
  const svg = renderTree(score, 1400);
  const stg = notStg(svg);
  const trs = trillsOf(stg);
  ok(trs.length === 5, `${trs.length} trills`);
  const vib = tg(stg, 'vibrato').map((g) => hullOf(g.children[0].getAttribute('d')))[0];
  ok(trs[0].bottom <= vib.top - 0.5 * SP + EPS, `trill bottom ${trs[0].bottom} vs vibrato top ${vib.top}`);
  const tapB = tg(stg, 'tap').map(letterBox)[0];
  ok(tapB.bottom <= trs[2].top - 0.4 * SP + EPS, 'T above trill');
  const pk = dgroups(stg, 'pick-stroke').map(pickBox)[0];
  ok(pk.bottom <= trs[2].top - 0.4 * SP + EPS && pk.bottom <= tapB.top - 0.4 * SP + EPS, 'pick above the trill and the T');
  const fer = num(tg(stg, 'fermata')[0].children[0], 'y'); // the gap is measured from the glyph origin
  ok(fer <= trs[3].top - 0.5 * SP + EPS, `fermata origin ${fer} vs trill top ${trs[3].top}`);
  const heads = glyphs(stg, 0xE0A4).concat(glyphs(stg, 0xE0A3)).map((n) => ({ x: num(n, 'x'), y: num(n, 'y') }));
  const tall = heads.reduce((a, b) => (b.y < a.y ? b : a));
  ok(trs[4].bottom <= tall.y - 1 * SP + EPS, `trill bottom ${trs[4].bottom} vs tall note head ${tall.y}`);
});

test('techniques11', 'trill: deterministic, input untouched, garbage trill / slap / pop / rake / whammy values never throw', () => {
  const garbage = [null, undefined, NaN, Infinity, -1, 2.5, '', 'zz', [], [1], {}, { fret: 'x', pitch: 7 }, () => 1, false, 0];
  garbage.forEach((v) => {
    const score = tAny(bt(3, 5, { rake: v, whammy: v }, { trill: v, slap: v, pop: v }), gr(), bt(3, 7, { whammy: { type: 'return', amount: v } }));
    const before = JSON.stringify(score);
    const a = serialize(renderTree(score, 900));
    ok(a === serialize(renderTree(score, 900)), 'deterministic');
    ok(!/NaN|undefined|Infinity/.test(a), `NaN for garbage ${String(v)}`);
    ok(JSON.stringify(score) === before, 'input untouched');
  });
});

// @@T11-END
}

// ---------- report ----------
export function summary() {
  let fail = 0;
  for (const r of results) {
    if (r.ok) console.log(`PASS engraving: ${r.name}${r.info ? '' : ` (${r.n} assertions)`}`);
    else { fail++; console.log(`FAIL engraving: ${r.name}\n  ${r.msg}`); }
  }
  const total = [...areaCounts.values()].reduce((a, b) => a + b, 0);
  console.log(`engraving assertions: ${total} (${[...areaCounts].map(([k, v]) => `${k} ${v}`).join(', ')})`);
  return fail;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const f = summary();
  console.log(f ? `\n${f} FAILED` : '\nALL PASSED');
  process.exit(f ? 1 : 0);
}
