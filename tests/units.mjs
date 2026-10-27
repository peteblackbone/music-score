// Characterization unit checks (pre-refactor): groupBeams, resolveAccidental, pitchFromFret,
// normalizeScore defaults, and bend labels via rendered SVG.
// Run via `node tests/run.js` (calls summary()), or directly: `node tests/units.mjs`.
//
// Module-path resilience: groupBeams and normalizeScore live in src/layout.js today; phase A moves
// them to src/layout/beams.js and src/normalize.js. loadFirst() tries the new path first, then the
// old one, so no edit is needed after the move (update the lists below only if paths change again).
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

register('./hooks.mjs', import.meta.url);
const root0 = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(root0, p)).href);
async function loadFirst(paths, name) {
  for (const p of paths) {
    if (!fs.existsSync(path.join(root0, p))) continue;
    const m = await imp(p);
    if (typeof m[name] === 'function') return m[name];
  }
  throw new Error(`${name} not found in ${paths.join(', ')}`);
}
const { makeContainer, serialize } = await import('./dom-shim.mjs');
const { MusicScoreRenderer } = await imp('src/MusicScoreRenderer.js');
const { resolveAccidental, pitchFromFret } = await imp('src/pitch.js');
const groupBeams = await loadFirst(['src/layout/beams.js', 'src/layout.js'], 'groupBeams');
const { tupletGroups } = await imp('src/layout/beams.js');
const normalizeScore = await loadFirst(['src/normalize.js', 'src/layout.js'], 'normalizeScore');
const { Glyph, dynamicGlyph } = await imp('src/glyphs.js');

const results = [];
const test = (name, fn) => {
  try { fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, msg: e.message }); }
};
const eq = (a, b, m = '') => {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${m} expected ${y}, got ${x}`);
};

const n8 = { type: 'note', duration: '8th', notes: [{ pitch: 'E4' }] };
const n16 = { type: 'note', duration: '16th', notes: [{ pitch: 'E4' }] };
const nq = { type: 'note', duration: 'quarter', notes: [{ pitch: 'E4' }] };
const rest8 = { type: 'rest', duration: '8th' };
const grace = { type: 'grace', duration: '16th', notes: [{ pitch: 'D4' }] };
const T44 = { beats: 4, beatType: 4 };

// ---------- dynamics ----------
// SMuFL dynamicSforzando / dynamicRinforzando are the single letters s / r (U+E524 / U+E523).
test('dynamicGlyph: sfz and rfz are composed from s/r + f + z', () => {
  eq(dynamicGlyph('sfz'), Glyph.dynamicSforzando + Glyph.dynamicForte + Glyph.dynamicZ);
  eq(dynamicGlyph('rfz'), Glyph.dynamicRinforzando + Glyph.dynamicForte + Glyph.dynamicZ);
  eq(Glyph.dynamicZ.codePointAt(0).toString(16), 'e525');
});

// ---------- groupBeams ----------
test('groupBeams: 4/4 eight 8ths -> pairs per quarter cell', () => {
  eq(groupBeams(Array(8).fill(n8), T44), [[0, 1], [2, 3], [4, 5], [6, 7]]);
});
test('groupBeams: quarters are never beamed', () => {
  eq(groupBeams([nq, nq, nq, nq], T44), []);
});
test('groupBeams: 16ths group four per quarter', () => {
  eq(groupBeams(Array(8).fill(n16), T44), [[0, 1, 2, 3], [4, 5, 6, 7]]);
});
test('groupBeams: a rest breaks a group', () => {
  eq(groupBeams([n8, rest8, n8, n8, nq, nq, nq], T44), [[0], [2, 3]]);
});
test('groupBeams: grace is not beamable and takes no time', () => {
  eq(groupBeams([grace, n8, n8, nq, nq, nq], T44), [[1, 2]]);
});
// Phase B (ui.md §7): compound meters beam in dotted-quarter cells (was: each 8th alone).
test('groupBeams: 6/8 cell is a dotted quarter, so six 8ths form two groups of three', () => {
  eq(groupBeams(Array(6).fill(n8), { beats: 6, beatType: 8 }), [[0, 1, 2], [3, 4, 5]]);
});
test('groupBeams: 3/8 is one cell for the whole bar; 12/8 four groups', () => {
  eq(groupBeams(Array(3).fill(n8), { beats: 3, beatType: 8 }), [[0, 1, 2]]);
  eq(groupBeams(Array(12).fill(n8), { beats: 12, beatType: 8 }), [[0, 1, 2], [3, 4, 5], [6, 7, 8], [9, 10, 11]]);
});
test('groupBeams: 2/2 cell is a half note, 8ths group four per half', () => {
  eq(groupBeams(Array(8).fill(n8), { beats: 2, beatType: 2 }), [[0, 1, 2, 3], [4, 5, 6, 7]]);
});
test('groupBeams: triplet 8ths use effective duration for cell position', () => {
  const t8 = { ...n8, tuplet: 3 };
  eq(groupBeams([t8, t8, t8, t8, t8, t8, nq, nq], T44), [[0, 1, 2], [3, 4, 5]]);
});
test('groupBeams: empty', () => { eq(groupBeams([], T44), []); });

// ---------- tupletGroups ----------
// A run of same-ratio tuplets closes once it forms a complete tuplet (written total / count is a
// plain power-of-two value, and at least count x the shortest value), preferring the beat-cell end.
const tg = (beats, ts = T44) => tupletGroups(beats, ts).map(({ indices, count }) => [indices, count]);
const tn = (duration, tuplet, extra = {}) => ({ type: 'note', duration, notes: [{ pitch: 'E4' }], tuplet, ...extra });
const nh = { type: 'note', duration: 'half', notes: [{ pitch: 'E4' }] };
test('tupletGroups: 8th triplets on every beat -> one group per beat', () => {
  const t = tn('8th', 3);
  eq(tg(Array(12).fill(t)), [[[0, 1, 2], 3], [[3, 4, 5], 3], [[6, 7, 8], 3], [[9, 10, 11], 3]]);
});
test('tupletGroups: three quarter-note triplets + half -> one group over two beats', () => {
  const t = tn('quarter', 3);
  eq(tg([t, t, t, nh]), [[[0, 1, 2], 3]]);
});
test('tupletGroups: 16th sextuplet {6 of 4} -> one group of six, not 3 + 3', () => {
  const t = tn('16th', { count: 6, of: 4 });
  eq(tg([...Array(6).fill(t), nq, nq, nq]), [[[0, 1, 2, 3, 4, 5], 6]]);
});
test('tupletGroups: mixed values [quarter, 8th] and [8th, quarter] as 8th triplets', () => {
  eq(tg([tn('quarter', 3), tn('8th', 3), tn('8th', 3), tn('quarter', 3), nq, nq]), [[[0, 1], 3], [[2, 3], 3]]);
});
test('tupletGroups: [8th, 16th, 16th, 8th] triplet closes on the beat end, not after the 16th', () => {
  eq(tg([tn('8th', 3), tn('16th', 3), tn('16th', 3), tn('8th', 3), nq, nq, nq]), [[[0, 1, 2, 3], 3]]);
});
test('tupletGroups: dotted values count written length [8th., 16th, 8th]', () => {
  eq(tg([tn('8th', 3, { dots: 1 }), tn('16th', 3), tn('8th', 3), nq, nq, nq]), [[[0, 1, 2], 3]]);
});
test('tupletGroups: half-note triplets with a rest in the middle -> one group', () => {
  const r = { type: 'rest', duration: 'half', tuplet: 3 };
  eq(tg([tn('half', 3), r, tn('half', 3)]), [[[0, 1, 2], 3]]);
});
test('tupletGroups: 8th quintuplet {5 of 4} over two beats -> one group of five', () => {
  const t = tn('8th', { count: 5, of: 4 });
  eq(tg([t, t, t, t, t, nh]), [[[0, 1, 2, 3, 4], 5]]);
});
test('tupletGroups: 6/8 quarter duplet {2 of 3} -> one group across both dotted beats', () => {
  const t = tn('quarter', { count: 2, of: 3 });
  eq(tg([t, t], { beats: 6, beatType: 8 }), [[[0, 1], 2]]);
});
test('tupletGroups: off-beat 8th triplet -> one group across the beat line', () => {
  const t = tn('8th', 3);
  eq(tg([n8, t, t, t, n8, nq, nq]), [[[1, 2, 3], 3]]);
});
test('tupletGroups: a ratio change splits (8th triplet then 16th quintuplet)', () => {
  const t3 = tn('8th', 3); const t5 = tn('16th', { count: 5, of: 4 });
  eq(tg([t3, t3, t3, t5, t5, t5, t5, t5, nh]), [[[0, 1, 2], 3], [[3, 4, 5, 6, 7], 5]]);
});
test('tupletGroups: a non-tuplet beat ends an incomplete run (per-cell fallback)', () => {
  const t = tn('8th', 3);
  eq(tg([t, t, t, t, nq, nq, nq]), [[[0, 1, 2], 3], [[3], 3]]);
  eq(tg([tn('quarter', 3), tn('quarter', 3), nh]), [[[0, 1], 3]]);
});
test('tupletGroups: the end of the measure ends an incomplete run', () => {
  const t = tn('quarter', 3);
  eq(tg([nh, nq, t, t]), [[[2, 3], 3]]);
});
test('tupletGroups: a grace inside a tuplet is skipped, not a split; a grace never starts a group', () => {
  const t = tn('8th', 3);
  eq(tg([t, grace, t, t, nq, nq, nq]), [[[0, 2, 3], 3]]);
  eq(tg([{ ...grace, tuplet: 3 }, t, t, t, nq, nq, nq]), [[[1, 2, 3], 3]]);
});
test('tupletGroups: six 16th triplets in one beat -> one group (cell end preferred)', () => {
  const t = tn('16th', 3);
  eq(tg([...Array(6).fill(t), nq, nq, nq]), [[[0, 1, 2, 3, 4, 5], 3]]);
});
test('tupletGroups: [quarter, 8th, 8th, quarter] triplets -> two 8th-triplet groups; empty -> none', () => {
  eq(tg([tn('quarter', 3), tn('8th', 3), tn('8th', 3), tn('quarter', 3), nh]), [[[0, 1], 3], [[2, 3], 3]]);
  eq(tg([]), []);
});

// ---------- resolveAccidental ----------
test('resolveAccidental: natural-in-key note -> null', () => {
  eq(resolveAccidental('E4', 0), null);
  eq(resolveAccidental('F#4', 1), null);
  eq(resolveAccidental('Bb3', -1), null);
});
test('resolveAccidental: outside key gives sharp/flat/natural/double', () => {
  eq(resolveAccidental('F#4', 0), 'sharp');
  eq(resolveAccidental('Bb3', 0), 'flat');
  eq(resolveAccidental('F4', 1), 'natural');
  eq(resolveAccidental('B4', -1), 'natural');
  eq(resolveAccidental('Fx4', 0), 'doubleSharp');
  eq(resolveAccidental('F##4', 0), 'doubleSharp');
  eq(resolveAccidental('Ebb4', 0), 'doubleFlat');
});
test('resolveAccidental: explicit accidental always wins, even when redundant', () => {
  eq(resolveAccidental('E4', 0, 'sharp'), 'sharp');
  eq(resolveAccidental('F#4', 1, 'natural'), 'natural');
});
test('resolveAccidental: no carry within a measure (stateless)', () => {
  eq(resolveAccidental('F#4', 0), 'sharp');
  eq(resolveAccidental('F#4', 0), 'sharp');
});
test('resolveAccidental: key order (sharps F C G D A E B; flats B E A D G C F)', () => {
  eq(resolveAccidental('C#5', 2), null);
  eq(resolveAccidental('C#5', 1), 'sharp');
  eq(resolveAccidental('A4', -3), 'natural');
  eq(resolveAccidental('Ab4', -3), null);
});
test('resolveAccidental: invalid pitch throws', () => {
  let threw = false;
  try { resolveAccidental('H4', 0); } catch { threw = true; }
  eq(threw, true);
});

// ---------- pitchFromFret ----------
test('pitchFromFret: standard guitar open strings and frets', () => {
  eq(pitchFromFret('E2', 0), 'E2');
  eq(pitchFromFret('E4', 0), 'E4');
  eq(pitchFromFret('E4', 5), 'A4');
  eq(pitchFromFret('E2', 12), 'E3');
  eq(pitchFromFret('B3', 1), 'C4');
});
test('pitchFromFret: always spells with sharps, never flats', () => {
  eq(pitchFromFret('A2', 1), 'A#2');
  eq(pitchFromFret('E4', 4), 'G#4');
  eq(pitchFromFret('D3', 1), 'D#3');
});
test('pitchFromFret: flat/sharp open strings re-spelled via MIDI', () => {
  eq(pitchFromFret('Bb2', 0), 'A#2');
  eq(pitchFromFret('C4', 1), 'C#4');
});
test('pitchFromFret: octave boundary and high frets', () => {
  eq(pitchFromFret('A3', 3), 'C4');
  eq(pitchFromFret('E4', 24), 'E6');
});
test('pitchFromFret: invalid open pitch throws', () => {
  let threw = false;
  try { pitchFromFret('nope', 3); } catch { threw = true; }
  eq(threw, true);
});

// ---------- normalizeScore (defaults and tab-derived pitch) ----------
test('normalizeScore: defaults, sticky signatures, last-measure barline, pitch from string+fret', () => {
  const s = normalizeScore({
    tracks: [{
      measures: [
        { beats: [{ type: 'note', duration: 'quarter', notes: [{ string: 1, fret: 5 }, { string: 6, fret: 0 }] }] },
        { keySignature: 2, timeSignature: { beats: 3, beatType: 4 }, beats: [] },
        { beats: [] },
      ],
    }],
  });
  const t = s.tracks[0];
  eq([t.clef, t.showStandardNotation, t.showTablature, t.tuning.length], ['treble', true, false, 6]);
  eq(t.measures.map((m) => m.keySignature), [0, 2, 2]);
  eq(t.measures.map((m) => m.timeSignature), [T44, { beats: 3, beatType: 4 }, { beats: 3, beatType: 4 }]);
  eq(t.measures.map((m) => m.barline), ['single', 'single', 'final']);
  eq(t.measures[0].beats[0].dots, 0);
  // Phase B (ui.md §3): fret-derived pitches are written an octave above sounding pitch
  // (was ['A4', 'E2'], the sounding pitches, which are now `soundingPitch`).
  eq(t.measures[0].beats[0].notes.map((x) => x.pitch), ['A5', 'E3']);
  eq(t.measures[0].beats[0].notes.map((x) => x.soundingPitch), ['A4', 'E2']);
});
test('normalizeScore: does not mutate input; explicit pitch kept; beat dots kept', () => {
  const input = { tracks: [{ measures: [{ beats: [{ type: 'note', duration: 'quarter', dots: 1, notes: [{ pitch: 'C4', string: 1, fret: 5 }] }] }] }] };
  const before = JSON.stringify(input);
  const s = normalizeScore(input);
  eq(JSON.stringify(input), before);
  eq(s.tracks[0].measures[0].beats[0].notes[0].pitch, 'C4');
  eq(s.tracks[0].measures[0].beats[0].dots, 1);
});
test('normalizeScore: beat dots clamped to an integer 0..4 (security F1)', () => {
  // Numeric strings keep their old meaning ('1' was one dot); non-numeric values count as 0.
  const vals = [-1, 'x', null, NaN, '2', ' 1 ', '', '1e9', 2.7, 4, 5, 1e9, Infinity];
  const s = normalizeScore({ tracks: [{ measures: [{ beats: vals.map((dots) => ({ type: 'rest', duration: 'quarter', dots })) }] }] });
  eq(s.tracks[0].measures[0].beats.map((b) => b.dots), [0, 0, 0, 0, 2, 1, 0, 4, 2, 4, 4, 4, 4]);
});
test('render: dots 1e9 draws quickly as 4 dots (notation + TAB rhythm)', () => {
  const score = (dots) => ({ tracks: [{ showStandardNotation: true, showTablature: true, tabRhythm: true, measures: [{ beats: [
    { type: 'note', duration: 'quarter', dots, notes: [{ string: 1, fret: 0 }] },
    { type: 'rest', duration: 'quarter', dots },
  ] }] }] });
  const t0 = Date.now();
  const big = serialize(renderTree(score(1e9)));
  if (Date.now() - t0 > 5000) throw new Error('render too slow');
  eq(big, serialize(renderTree(score(4))), 'same as dots: 4');
  eq(serialize(renderTree(score(-1))), serialize(renderTree(score(0))), 'dots -1 = 0');
  eq(serialize(renderTree(score('x'))), serialize(renderTree(score(0))), "dots 'x' = 0");
  eq(serialize(renderTree(score('1'))), serialize(renderTree(score(1))), "dots '1' = 1");
  const circles = (svg) => (svg.match(/<circle/g) || []).length;
  eq(circles(big) - circles(serialize(renderTree(score(0)))), 16, '4 dots on note + rest, notation + TAB');
});
test('normalizeScore: track-level then score-level time/key fallback', () => {
  const s = normalizeScore({
    timeSignature: { beats: 6, beatType: 8 }, keySignature: 1,
    tracks: [{ measures: [{ beats: [] }] }, { timeSignature: { beats: 2, beatType: 4 }, keySignature: -2, measures: [{ beats: [] }] }],
  });
  eq(s.tracks[0].measures[0].timeSignature, { beats: 6, beatType: 8 });
  eq(s.tracks[0].measures[0].keySignature, 1);
  eq(s.tracks[1].measures[0].timeSignature, { beats: 2, beatType: 4 });
  eq(s.tracks[1].measures[0].keySignature, -2);
});
test('normalizeScore: string beyond tuning leaves pitch undefined', () => {
  const s = normalizeScore({ tracks: [{ measures: [{ beats: [{ type: 'note', duration: 'quarter', notes: [{ string: 9, fret: 3 }] }] }] }] });
  eq(s.tracks[0].measures[0].beats[0].notes[0].pitch, undefined);
});

test('normalizeScore: showChordDiagrams defaults to showTablature; author value read as a boolean; chordShapes / chordDiagram pass through', () => {
  const shapes = { C: { frets: ['x', 3, 2, 0, 1, 0] } };
  const diag = { frets: [3, 2, 0, 0, 0, 3] };
  const s = normalizeScore({ chordShapes: shapes, tracks: [
    { measures: [{ beats: [{ type: 'note', duration: 'quarter', chord: 'C', chordDiagram: diag, notes: [{ pitch: 'C4' }] }] }] },
    { showTablature: true, measures: [] },
    { showStandardNotation: false, showTablature: true, measures: [] },
    { showTablature: true, showChordDiagrams: false, measures: [] },
    { showTablature: false, showChordDiagrams: true, measures: [] },
    { showChordDiagrams: 0, showTablature: true, measures: [] },
    { showChordDiagrams: 'yes', measures: [] },
  ] });
  eq(s.tracks.map((t) => t.showChordDiagrams), [false, true, true, false, true, false, true]);
  eq(s.chordShapes === shapes, true, 'score.chordShapes passes through');
  eq(s.tracks[0].measures[0].beats[0].chordDiagram === diag, true, 'beat.chordDiagram passes through');
});

// ---------- bend labels via rendered SVG ----------
function renderTree(score, width = 900) {
  const box = makeContainer();
  new MusicScoreRenderer(box, JSON.parse(JSON.stringify(score)), { width }).render();
  return box.children[0];
}
function* walk(nd, cls = []) {
  yield { nd, cls };
  const own = nd.getAttribute ? nd.getAttribute('class') : null;
  for (const c of nd.children) yield* walk(c, own ? [...cls, own] : cls);
}
/** Texts inside <g class="bend"> groups, in document order, split into labels (italic) and landing frets "(n)". */
function bendTexts(score) {
  const out = { labels: [], targets: [], groups: 0 };
  for (const { nd, cls } of walk(renderTree(score))) {
    if (nd.tag === 'g' && nd.getAttribute('class') === 'bend') out.groups++;
    if (nd.tag !== 'text' || !cls.includes('bend')) continue;
    if (nd.getAttribute('font-style') === 'italic') out.labels.push(nd.textContent);
    else out.targets.push(nd.textContent);
  }
  return out;
}
const bendScore = (fret, bend, string = 2) => ({
  tracks: [{ showStandardNotation: false, showTablature: true,
    measures: [{ beats: [{ type: 'note', duration: 'quarter', notes: [{ string, fret, bend }] },
      { type: 'rest', duration: 'quarter' }, { type: 'rest', duration: 'quarter' }, { type: 'rest', duration: 'quarter' }] }] }],
});
test('bend labels: true -> "Full", landing fret +2', () => {
  eq(bendTexts(bendScore(7, true)), { labels: ['Full'], targets: ['(9)'], groups: 1 });
});
test('bend labels: "1/2" -> landing +1; "1 1/2" -> +3; "2" -> +4', () => {
  eq(bendTexts(bendScore(7, '1/2')).targets, ['(8)']);
  eq(bendTexts(bendScore(7, '1 1/2')).targets, ['(10)']);
  eq(bendTexts(bendScore(7, '2')).targets, ['(11)']);
  eq(bendTexts(bendScore(7, '1/2')).labels, ['1/2']);
  eq(bendTexts(bendScore(7, '1 1/2')).labels, ['1 1/2']);
  eq(bendTexts(bendScore(7, '2')).labels, ['2']);
});
test('bend labels: release and hold have a label but no landing fret', () => {
  const r = bendTexts(bendScore(7, 'full release'));
  eq([r.labels, r.targets], [['Full'], []]);
  const h = bendTexts(bendScore(7, { amount: '1 1/2', hold: true }));
  eq([h.labels, h.targets], [['1 1/2'], []]);
  const h2 = bendTexts(bendScore(7, '1/2 hold'));
  eq([h2.labels, h2.targets], [['1/2'], []]);
});
test('bend labels: unrecognized amount assumes full step for landing, label printed as given', () => {
  const r = bendTexts(bendScore(7, 'wobble'));
  eq(r.targets, ['(9)']);
  eq(r.labels.length, 1);
});
test('bend labels: object form {amount:"1/4"} -> landing fret rounds from 0.5 semitone', () => {
  const r = bendTexts(bendScore(7, { amount: '1/4' }));
  eq(r.labels, ['1/4']);
  eq(r.targets, ['(8)']); // Math.round(7 + 0.5)
});

// ---------- layoutChord / fretLabel pins (guitar-harmonics characterization) ----------
// Exact current numbers (theme.staffLineSpacing 10). Only picked fields are compared so added
// return fields (glyph/width/stemGlyph) do not break these. Numbers rounded to 6 dp.
const { layoutChord } = await imp('src/layout/chord.js');
const { resolveTheme } = await imp('src/theme.js');
const { fretLabel, fretLabelWidth } = await imp('src/textMetrics.js');
const r6 = (v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : Array.isArray(v) ? v.map(r6) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, r6(x)])) : v);
const pickChord = (c) => r6({
  stemUp: c.stemUp, headWidth: c.headWidth,
  heads: c.heads.map((h) => ({ noteIndex: h.noteIndex, pos: h.pos, dx: h.dx })),
  accidentals: c.accidentals.map((a) => ({ noteIndex: a.noteIndex, name: a.name, dx: a.dx })),
  dots: c.dots, ledgerSpan: c.ledgerSpan, stemDx: c.stemDx, leftExt: c.leftExt, rightExt: c.rightExt,
});
const chTheme = resolveTheme();
const O = (headGlyph, duration, dots = 0, flagged = false) => ({ headGlyph, dots, duration, flagged });
const nN = (k, f = {}) => Array.from({ length: k }, () => ({ ...f }));
const BLACK = Glyph.noteheadBlack;
const chord = (notes, pos, up, acc, opts) => pickChord(layoutChord(notes, pos, up, acc, opts, chTheme));

test('layoutChord pin: seconds, stem up (upper note of the second goes right)', () => {
  eq(chord(nN(3), [0, 1, 5], true, [null, null, null], O(BLACK, 'quarter')), r6({
    stemUp: true, headWidth: 11.8,
    heads: [{ noteIndex: 0, pos: 0, dx: 0 }, { noteIndex: 1, pos: 1, dx: 11.8 }, { noteIndex: 2, pos: 5, dx: 0 }],
    accidentals: [], dots: { dx: 22.7, step: 5, radius: 1.7, positions: [1, 5] },
    ledgerSpan: { left: -8.9, right: 20.7 }, stemDx: 5.9, leftExt: 5.9, rightExt: 17.7 }));
});
test('layoutChord pin: seconds, stem down (lower note of the second goes left)', () => {
  eq(chord(nN(3), [0, 1, 5], false, [null, null, null], O(BLACK, 'quarter')), r6({
    stemUp: false, headWidth: 11.8,
    heads: [{ noteIndex: 0, pos: 0, dx: -11.8 }, { noteIndex: 1, pos: 1, dx: 0 }, { noteIndex: 2, pos: 5, dx: 0 }],
    accidentals: [], dots: { dx: 10.9, step: 5, radius: 1.7, positions: [1, 5] },
    ledgerSpan: { left: -20.7, right: 8.9 }, stemDx: -5.9, leftExt: 17.7, rightExt: 5.9 }));
});
test('layoutChord pin: several accidentals share/split columns', () => {
  eq(chord(nN(4), [0, 2, 3, 9], true, ['sharp', 'flat', 'natural', 'sharp'], O(BLACK, 'quarter')), r6({
    stemUp: true, headWidth: 11.8,
    heads: [{ noteIndex: 0, pos: 0, dx: 0 }, { noteIndex: 1, pos: 2, dx: 0 }, { noteIndex: 2, pos: 3, dx: 11.8 }, { noteIndex: 3, pos: 9, dx: 0 }],
    accidentals: [{ noteIndex: 0, name: 'sharp', dx: -18.36 }, { noteIndex: 1, name: 'flat', dx: -39.44 },
      { noteIndex: 2, name: 'natural', dx: -26.12 }, { noteIndex: 3, name: 'sharp', dx: -18.36 }],
    dots: { dx: 22.7, step: 5, radius: 1.7, positions: [1, 3, 9] },
    ledgerSpan: { left: -8.9, right: 20.7 }, stemDx: 5.9, leftExt: 39.44, rightExt: 17.7 }));
});
test('layoutChord pin: ghost chord with displaced head, accidental, dot and flag', () => {
  eq(chord(nN(2, { ghost: true }), [4, 5], true, [null, 'sharp'], O(BLACK, '8th', 1, true)), r6({
    stemUp: true, headWidth: 11.8,
    heads: [{ noteIndex: 0, pos: 4, dx: 0 }, { noteIndex: 1, pos: 5, dx: 11.8 }],
    accidentals: [{ noteIndex: 1, name: 'sharp', dx: -25.66 }],
    dots: { dx: 22.7, step: 5, radius: 1.7, positions: [5] },
    ledgerSpan: { left: -8.9, right: 20.7 }, stemDx: 5.9, leftExt: 25.66, rightExt: 25 }));
});
test('layoutChord pin: double-dotted chord', () => {
  eq(chord(nN(2), [4, 6], true, [null, null], O(BLACK, 'quarter', 2)), r6({
    stemUp: true, headWidth: 11.8,
    heads: [{ noteIndex: 0, pos: 4, dx: 0 }, { noteIndex: 1, pos: 6, dx: 0 }],
    accidentals: [], dots: { dx: 10.9, step: 5, radius: 1.7, positions: [5, 7] },
    ledgerSpan: { left: -8.9, right: 8.9 }, stemDx: 5.9, leftExt: 5.9, rightExt: 17.6 }));
});
test('layoutChord pin: whole-note chord (stemless, stem-up second rule)', () => {
  eq(chord(nN(3), [2, 3, 4], true, [null, null, null], O(Glyph.noteheadWhole, 'whole')), r6({
    stemUp: true, headWidth: 16.88,
    heads: [{ noteIndex: 0, pos: 2, dx: 0 }, { noteIndex: 1, pos: 3, dx: 16.88 }, { noteIndex: 2, pos: 4, dx: 0 }],
    accidentals: [], dots: { dx: 30.32, step: 5, radius: 1.7, positions: [3, 5] },
    ledgerSpan: { left: -11.44, right: 28.32 }, stemDx: 0, leftExt: 8.44, rightExt: 25.32 }));
});
test('layoutChord pin: half-note chord with ledger positions, stem down', () => {
  eq(chord(nN(3), [-2, -1, 10], false, [null, null, null], O(Glyph.noteheadHalf, 'half')), r6({
    stemUp: false, headWidth: 11.8,
    heads: [{ noteIndex: 0, pos: -2, dx: -11.8 }, { noteIndex: 1, pos: -1, dx: 0 }, { noteIndex: 2, pos: 10, dx: 0 }],
    accidentals: [], dots: { dx: 10.9, step: 5, radius: 1.7, positions: [-1, 11] },
    ledgerSpan: { left: -20.7, right: 8.9 }, stemDx: -5.9, leftExt: 17.7, rightExt: 5.9 }));
});

test('fretLabel pin: plain, two-digit, ghost, mute, mute+ghost', () => {
  eq([{ fret: 5 }, { fret: 12 }, { fret: 5, ghost: true }, { fret: 5, mute: true }, { fret: 5, mute: true, ghost: true }].map(fretLabel),
    ['5', '12', '(5)', 'x', '(x)']);
});
test('fretLabelWidth pin (tabFontSize 12, spacing 10): estimate + 0.3 sp', () => {
  eq(['5', '12', '(5)', 'x', '(x)'].map((l) => r6(fretLabelWidth(l, chTheme))), [9, 15, 15.72, 8.76, 15.48]);
});

// ---------- guitar harmonics ----------
const H = await imp('src/harmonics.js');
const { diamondNoteheadForDuration } = await imp('src/glyphs.js');
const { glyphBox } = await imp('src/glyphMetrics.js');
test('harmonicKind: falsy -> null; known kinds (trim/case); true/unknown/other -> natural; idempotent', () => {
  const raw = [undefined, null, false, 0, '', true, 'natural', 'artificial', 'pinch', 'tapped', 'semi',
    ' Pinch ', 'ARTIFICIAL', 'bogus', 1, {}];
  const want = [null, null, null, null, null, 'natural', 'natural', 'artificial', 'pinch', 'tapped', 'semi',
    'pinch', 'artificial', 'natural', 'natural', 'natural'];
  eq(raw.map(H.harmonicKind), want);
  eq(want.map(H.harmonicKind), want);
});
test('harmonicOf: mute wins; touchFret only for integer harmonicFret on artificial/tapped', () => {
  eq([{ harmonic: true }, { harmonic: 'pinch', mute: true }, {}].map(H.harmonicOf), ['natural', null, null]);
  eq([
    { harmonic: 'artificial', harmonicFret: 17 }, { harmonic: 'tapped', harmonicFret: 0 },
    { harmonic: 'artificial', harmonicFret: 17.5 }, { harmonic: 'artificial', harmonicFret: '17' },
    { harmonic: 'artificial' }, { harmonic: 'pinch', harmonicFret: 17 }, { harmonic: 'natural', harmonicFret: 17 },
    { harmonic: 'artificial', harmonicFret: 17, mute: true },
  ].map(H.touchFret), [17, 0, null, null, null, null, null, null]);
});
test('decoratesFretLabel / layoutHeadGlyph / beatHarmonicLabelKind', () => {
  eq([{ harmonic: true }, { harmonic: 'artificial', harmonicFret: 17 }, { harmonic: 'artificial' }, { harmonic: 'pinch' },
    { harmonic: true, mute: true }, {}].map(H.decoratesFretLabel), [true, true, false, false, false, false]);
  eq(['whole', 'half', 'quarter', '8th'].map((d) => H.layoutHeadGlyph({ harmonic: true }, d).codePointAt(0).toString(16)),
    ['e0d8', 'e0d9', 'e0db', 'e0db']);
  eq(H.layoutHeadGlyph({ harmonic: true, mute: true }, 'quarter'), Glyph.noteheadBlack);
  eq(H.layoutHeadGlyph({ harmonic: 'pinch' }, 'half'), Glyph.noteheadHalf);
  eq([
    [{ harmonic: 'pinch' }, { harmonic: 'artificial' }], [{ harmonic: 'semi' }, { harmonic: 'tapped' }],
    [{ harmonic: 'semi' }, { harmonic: 'pinch' }], [{ harmonic: true }, {}], [{ harmonic: 'artificial', mute: true }], [],
  ].map(H.beatHarmonicLabelKind), ['artificial', 'tapped', 'pinch', null, null, null]);
  eq(H.HARMONIC_LABELS, { artificial: 'A.H.', tapped: 'T.H.', pinch: 'P.H.', semi: 'S.H.' });
});
test('diamond glyphs: code points E0D8/E0D9/E0DB with metrics (widths 1.08 / 1.004 / 1.0 sp)', () => {
  eq([Glyph.noteheadDiamondWhole, Glyph.noteheadDiamondHalf, Glyph.noteheadDiamondBlack].map((c) => c.codePointAt(0).toString(16)),
    ['e0d8', 'e0d9', 'e0db']);
  eq(['whole', 'half', 'quarter'].map(diamondNoteheadForDuration), [Glyph.noteheadDiamondWhole, Glyph.noteheadDiamondHalf, Glyph.noteheadDiamondBlack]);
  eq([Glyph.noteheadDiamondWhole, Glyph.noteheadDiamondHalf, Glyph.noteheadDiamondBlack].map((c) => r6(glyphBox(c).width)), [1.08, 1.004, 1]);
});

test('normalize: harmonic canonicalized on every note branch; harmonicFret passed through; no harmonic -> no key', () => {
  const sc = normalizeScore({ tracks: [
    { showTablature: true, measures: [{ beats: [{ type: 'note', duration: 'quarter', notes: [
      { string: 1, fret: 12, harmonic: true }, { string: 2, fret: 5, harmonic: ' Artificial ', harmonicFret: 17 },
      { pitch: 'E4', harmonic: 'PINCH' }, { pitch: 'G4', harmonic: 'wobble' }, { string: 3, fret: 2 }, { string: 9, fret: 2, harmonic: 'semi' },
      { string: 4, fret: 2, harmonic: false } ] }] }] },
    { writtenOctaveUp: true, measures: [{ beats: [{ type: 'note', duration: 'quarter', notes: [{ pitch: 'E3', harmonic: 'tapped' }] }] }] },
  ] });
  const ns = sc.tracks[0].measures[0].beats[0].notes;
  eq(ns.map((n) => n.harmonic), ['natural', 'artificial', 'pinch', 'natural', undefined, 'semi', false]);
  eq(ns.map((n) => 'harmonic' in n), [true, true, true, true, false, true, true]);
  eq(ns[1].harmonicFret, 17);
  eq([ns[0].pitch, ns[0].soundingPitch, ns[0].fromFret], ['E6', 'E5', true]);
  const t2 = sc.tracks[1].measures[0].beats[0].notes[0];
  eq([t2.pitch, t2.soundingPitch, t2.harmonic], ['E4', 'E3', 'tapped']);
  eq(normalizeScore(sc).tracks[0].measures[0].beats[0].notes.map((n) => n.harmonic), ['natural', 'artificial', 'pinch', 'natural', undefined, 'semi', false]);
});

test('fretLabel harmonics: <12>, 5(17), plain for pinch/semi/no touch fret, ghost wraps, mute wins', () => {
  eq([
    { fret: 12, harmonic: 'natural' }, { fret: 7, harmonic: true }, { fret: 5, harmonic: 'artificial', harmonicFret: 17 },
    { fret: 2, harmonic: 'tapped', harmonicFret: 14 }, { fret: 5, harmonic: 'artificial' }, { fret: 5, harmonic: 'artificial', harmonicFret: 17.5 },
    { fret: 5, harmonic: 'pinch', harmonicFret: 17 }, { fret: 5, harmonic: 'semi' }, { fret: 12, harmonic: true, ghost: true },
    { fret: 5, harmonic: 'artificial', harmonicFret: 17, ghost: true }, { fret: 12, harmonic: true, mute: true },
    { fret: 12, harmonic: true, mute: true, ghost: true }, { fret: 12, harmonic: true, harmonicFret: 24 },
  ].map(fretLabel), ['<12>', '<7>', '5(17)', '2(14)', '5', '5', '5', '5', '(<12>)', '(5(17))', 'x', '(x)', '<12>']);
});

const DIA = Glyph.noteheadDiamondBlack;
const near = (a, b, m) => { if (Math.abs(a - b) > 1e-9) throw new Error(`${m}: expected ${b}, got ${a}`); };
test('layoutChord: uniform headGlyphs gives exactly the same result as headGlyph alone (all fields)', () => {
  const cases = [
    [nN(3), [0, 1, 5], true, [null, null, null], O(BLACK, 'quarter')],
    [nN(3), [0, 1, 5], false, ['sharp', null, 'flat'], O(Glyph.noteheadHalf, 'half', 1)],
    [nN(2, { ghost: true }), [4, 5], true, [null, 'sharp'], O(BLACK, '8th', 1, true)],
    [nN(3), [2, 3, 4], true, [null, null, null], O(Glyph.noteheadWhole, 'whole')],
    [nN(2), [3, 4], false, [null, null], O(DIA, 'quarter')],
  ];
  cases.forEach(([n, p, up, acc, o]) => {
    const a = layoutChord(n, p, up, acc, o, chTheme);
    const b = layoutChord(n, p, up, acc, { ...o, headGlyphs: p.map(() => o.headGlyph) }, chTheme);
    eq(b, a);
    eq(a.stemGlyph, o.headGlyph);
    a.heads.forEach((h) => { eq(h.glyph, o.headGlyph); near(h.width, a.headWidth, 'width'); });
  });
});
test('layoutChord mixed chord: widest head is the stem reference; diamond stem-side edge touches the stem', () => {
  const s = chTheme.staffLineSpacing;
  // [diamond, black] (no second), stem up and down
  [true, false].forEach((up) => {
    const c = layoutChord(nN(2), [2, 6], up, [null, null], { ...O(BLACK, 'quarter'), headGlyphs: [DIA, BLACK] }, chTheme);
    eq(c.stemGlyph, BLACK);
    near(c.stemDx, (up ? 0.59 : -0.59) * s, 'stemDx = black anchor');
    near(c.heads[1].dx, 0, 'black head unshifted');
    const d = c.heads[0];
    eq([d.glyph, r6(d.width)], [DIA, 10]);
    near(up ? d.dx + d.width / 2 : d.dx - d.width / 2, c.stemDx, `diamond stem-side edge (${up ? 'up' : 'down'})`);
  });
  // seconds: the displaced diamond sits across the stem, its stem-side edge on the stem
  [true, false].forEach((up) => {
    const c = layoutChord(nN(2), [4, 5], up, [null, null], { ...O(BLACK, 'quarter'), headGlyphs: up ? [BLACK, DIA] : [DIA, BLACK] }, chTheme);
    const d = c.heads[up ? 1 : 0];
    near(d.dx, (up ? 11.8 - 0.9 : -11.8 + 0.9), 'displaced diamond dx');
    near(up ? d.dx - d.width / 2 : d.dx + d.width / 2, c.stemDx, `displaced diamond edge (${up ? 'up' : 'down'})`);
    near(c.ledgerSpan.left, up ? -8.9 : -18.9, 'ledger left');
    near(c.ledgerSpan.right, up ? 18.9 : 8.9, 'ledger right');
  });
  // all diamonds: diamond anchor (vertex, 0.5 sp from centre); whole chord: no shift
  const all = layoutChord(nN(2), [2, 6], true, [null, null], { ...O(BLACK, 'quarter'), headGlyphs: [DIA, DIA] }, chTheme);
  eq([all.stemGlyph, r6(all.stemDx), r6(all.headWidth)], [DIA, 5, 10]);
  const w = layoutChord(nN(2), [2, 6], true, [null, null], { ...O(Glyph.noteheadWhole, 'whole'), headGlyphs: [Glyph.noteheadDiamondWhole, Glyph.noteheadWhole] }, chTheme);
  eq([w.heads.map((h) => h.dx), w.stemDx, w.stemGlyph], [[0, 0], 0, Glyph.noteheadWhole]);
});

// ---------- techniqueLabelDash (called with 4 args; a future optional 5th `label` must not change these) ----------
{
  const { techniqueLabelDash, techniqueLabelSize } = await imp('src/draw/tab.js');
  const { resolveTheme } = await imp('src/theme.js');
  const near = (a, b, m) => { if (Math.abs(a - b) > 1e-9) throw new Error(`${m} expected ${b}, got ${a}`); };
  for (const [tn, theme, size] of [['default theme', resolveTheme(), 11], ['staffLineSpacing 12', resolveTheme({ staffLineSpacing: 12 }), 10.8]]) {
    test(`techniqueLabelDash: ${tn} label size and dash fields`, () => {
      near(techniqueLabelSize(theme), size, 'size');
      const d = techniqueLabelDash(100, 300, 50, theme);
      eq(Object.keys(d).sort(), ['dashStartX', 'dashY', 'hasDash', 'tick']);
      near(d.dashStartX, 100 + size * 2.6, 'dashStartX');
      near(d.dashY, 50 - size * 0.32, 'dashY');
      near(d.tick, size * 0.5, 'tick');
      eq(d.hasDash, true);
    });
    test(`techniqueLabelDash: ${tn} hasDash threshold`, () => {
      const start = 100 + size * 2.6, gap = 0.4 * theme.staffLineSpacing;
      eq(techniqueLabelDash(100, 110, 50, theme).hasDash, false);
      eq(techniqueLabelDash(100, start + gap - 0.01, 50, theme).hasDash, false);
      eq(techniqueLabelDash(100, start + gap, 50, theme).hasDash, false); // strict >
      eq(techniqueLabelDash(100, start + gap + 0.01, 50, theme).hasDash, true);
      near(techniqueLabelDash(0, 0, 0, theme).dashStartX, size * 2.6, 'x1=0');
    });
  }
  test('techniqueLabelDash: dashStartX is independent of x2 and labelY', () => {
    const t = resolveTheme();
    near(techniqueLabelDash(10, 20, 0, t).dashStartX, techniqueLabelDash(10, 999, 77, t).dashStartX, 'dashStartX');
  });
}

// ---------- picking and playing directions (src/directions.js) ----------
{
  const D = await imp('src/directions.js');
  const { pickStrokeGlyph } = await imp('src/glyphs.js');
  const { glyphBox } = await imp('src/glyphMetrics.js');
  test('directions: pickStrokeKind canonical table, idempotent, garbage -> null', () => {
    const raws = ['down', 'up', ' Down ', 'UP', 'downstroke', '', 'd', true, 1, null, undefined, {}, ['down']];
    const out = raws.map(D.pickStrokeKind);
    eq(out, ['down', 'up', 'down', 'up', null, null, null, null, null, null, null, null, null]);
    eq(out.map(D.pickStrokeKind), out);
  });
  test('directions: whammyDip canonical table', () => {
    const dip = (amount) => ({ type: 'dip', amount });
    const cases = [
      [true, dip('1/2')], ['1/2', dip('1/2')], [' -1/2 ', dip('1/2')], ['−1', dip('1')], ['- 1 1/2', dip('1 1/2')],
      ['1', dip('1')], [1, dip('1')], [-0.5, dip('0.5')], [2.5, dip('2.5')], ['', null], ['  ', null], ['-', null],
      [NaN, null], [Infinity, null], [false, null], [null, null], [undefined, null], [0, dip('0')], [[1], null],
      [{}, dip('1/2')], [{ type: 'dip' }, dip('1/2')], [{ type: ' DIP ', amount: '-1' }, dip('1')], [{ amount: '' }, dip('1/2')],
      [{ amount: 1.5 }, dip('1.5')], [{ type: 'scoop' }, null], [{ type: 3 }, null], [{ amount: {} }, null], [{ amount: '-' }, null],
    ];
    cases.forEach(([raw, want]) => eq(D.whammyDip(raw), want, `whammyDip(${String(raw)})`));
  });
  test('directions: whammyDip is idempotent and whammyLabel has one leading "-"', () => {
    ['1/2', '-1', true, { amount: '- 3/4' }, 2].forEach((raw) => {
      const once = D.whammyDip(raw);
      eq(D.whammyDip(once), once);
      eq(D.whammyLabel(once).startsWith('-') && !D.whammyLabel(once).startsWith('--'), true);
    });
    eq(D.whammyLabel(D.whammyDip(true)), '-1/2');
  });
  test('directions: whammyDip strips every leading sign, so canonicalization is idempotent', () => {
    const once = D.whammyDip(' -−1 ');
    eq(once, { type: 'dip', amount: '1' });
    eq(D.whammyDip(once), once);
  });
  test('directions: per-beat questions ignore rests, graces and empty beats', () => {
    const note = (extra = {}, notes = [{ pitch: 'E4', tap: true }]) => ({ type: 'note', duration: 'quarter', notes, ...extra });
    const marks = { pickStroke: 'down', whammy: true };
    eq(D.isMainNoteBeat(note()), true);
    eq([{ type: 'rest' }, { type: 'grace', notes: [{ pitch: 'E4' }] }, note({}, []), { type: 'note' }].map(D.isMainNoteBeat), [false, false, false, false]);
    eq(D.beatPickStroke(note(marks)), 'down');
    eq(D.beatWhammy(note(marks)), { type: 'dip', amount: '1/2' });
    eq(D.beatTaps(note()), true);
    for (const el of [{ type: 'rest', duration: 'quarter', ...marks }, { type: 'grace', duration: '16th', notes: [{ pitch: 'E4', tap: true }], ...marks }]) {
      eq([D.beatPickStroke(el), D.beatWhammy(el), D.beatTaps(el)], [null, null, false]);
    }
    eq(D.beatPickStroke(note({ pickStroke: 'sideways' })), null);
    eq(D.beatTaps(note({}, [{ pitch: 'E4' }])), false);
    eq(D.beatTaps(note({}, [{ pitch: 'E4', tap: true, harmonic: 'tapped' }])), false, 'tapped harmonic says T.H.');
    eq(D.beatTaps(note({}, [{ pitch: 'E4', tap: true, harmonic: 'tapped', mute: true }])), true, 'muted: not a harmonic');
    eq(D.beatTaps(note({}, [{ pitch: 'E4', tap: true, harmonic: 'tapped' }, { pitch: 'G4', tap: true }])), true);
  });
  test('directions: withDirections returns the same object when the fields are absent', () => {
    const b = { type: 'note', duration: 'quarter', notes: [{ pitch: 'E4', tap: true }], letRing: true };
    eq(D.withDirections(b) === b, true);
    const r = { type: 'rest', duration: 'quarter' };
    eq(D.withDirections(r) === r, true);
  });
  test('directions: withDirections canonicalizes present fields only, in a copy', () => {
    const b = { type: 'note', duration: 'quarter', notes: [], pickStroke: ' UP ' };
    const out = D.withDirections(b);
    eq(out !== b && b.pickStroke === ' UP ', true);
    eq(out, { type: 'note', duration: 'quarter', notes: [], pickStroke: 'up' });
    eq('whammy' in out, false);
    eq(D.withDirections({ whammy: '-1', pickStroke: 7 }), { whammy: { type: 'dip', amount: '1' }, pickStroke: null });
    const again = D.withDirections(out);
    eq(again, out);
  });
  test('directions: whammyOf canonical table (dip forms unchanged, dive / return / predive objects)', () => {
    const w = (type, amount) => ({ type, amount });
    const cases = [
      [true, w('dip', '1/2')], ['-1', w('dip', '1')], [2, w('dip', '2')], [{ type: 'dive' }, w('dive', '1/2')],
      [{ type: ' DIVE ', amount: '-1' }, w('dive', '1')], [{ type: 'return' }, w('return', '1/2')],
      [{ type: 'predive', amount: 'full' }, w('predive', 'full')], [{ type: 'dive', amount: '1 1/2' }, w('dive', '1 1/2')],
      [{ type: 'dive', amount: '' }, w('dive', '1/2')], [{ type: 'dive', amount: '-' }, null], [{ type: 'pre-dive' }, null],
      [{ type: 'scoop' }, null], [{ type: 7 }, null], [{}, w('dip', '1/2')], [false, null], [null, null], [undefined, null],
      [[1], null], ['', null], [NaN, null],
    ];
    cases.forEach(([raw, want]) => eq(D.whammyOf(raw), want, `whammyOf(${JSON.stringify(raw)})`));
    cases.forEach(([raw]) => { const once = D.whammyOf(raw); eq(D.whammyOf(once), once, 'idempotent'); });
    eq(D.whammyDip({ type: 'dive' }), null);
    eq(D.whammyDip({ type: 'dip', amount: '1' }), w('dip', '1'));
    const dive = { type: 'note', duration: 'quarter', notes: [{ pitch: 'E4' }], whammy: { type: 'dive' } };
    eq([D.beatWhammy(dive), D.beatWhammyAny(dive)], [null, w('dive', '1/2')]);
    eq(D.beatWhammyAny({ type: 'rest', whammy: true }), null);
    eq(D.beatWhammyAny({ type: 'grace', notes: [{ pitch: 'E4' }], whammy: true }), null);
  });
  const { whammyDepthSp } = await imp('src/draw/whammy.js');
  test('whammyDepthSp: 1.2 sp per whole step clamped to 0.8..2.4 (half .8, full / whole / unknown 1.2, 1 1/2 1.8, 2 and up 2.4)', () => {
    const cases = [['1/2', 0.8], ['1/4', 0.8], ['1', 1.2], ['full', 1.2], [' FULL ', 1.2], ['3/4', 0.9], ['1 1/2', 1.8], ['2', 2.4], ['2 1/2', 2.4], ['3', 2.4], ['0', 0.8], ['weird', 1.2], ['', 1.2]];
    cases.forEach(([amount, want]) => eq(Math.round(whammyDepthSp(amount) * 1e6) / 1e6, want, `whammyDepthSp(${JSON.stringify(amount)})`));
  });
  test('whammyDepthSp: a NaN amount (0/0, 0 0/0) falls back to the default 1.2 sp; a division by zero (1/0) clamps to 2.4', () => {
    [['0/0', 1.2], ['0 0/0', 1.2], ['1/0', 2.4]].forEach(([amount, want]) => {
      const d = whammyDepthSp(amount);
      eq(Number.isFinite(d), true, `whammyDepthSp(${JSON.stringify(amount)}) finite`);
      eq(Math.round(d * 1e6) / 1e6, want, `whammyDepthSp(${JSON.stringify(amount)})`);
    });
  });
  test('directions: rakeOf canonical table and beatRake', () => {
    const cases = [['down', 'down'], [' UP ', 'up'], [true, true], ['rake', true], [1, true], [{}, true], ['', null],
      [false, null], [null, null], [undefined, null], [0, null]];
    cases.forEach(([raw, want]) => { eq(D.rakeOf(raw), want, `rakeOf(${JSON.stringify(raw)})`); eq(D.rakeOf(D.rakeOf(raw)), want); });
    const note = (extra = {}) => ({ type: 'note', duration: 'quarter', notes: [{ pitch: 'E4' }], ...extra });
    eq([D.beatRake(note({ rake: true })), D.beatRake(note({ rake: 'up' })), D.beatRake(note()), D.beatRake(note({ rake: false }))], [true, true, false, false]);
    eq([D.beatRake({ type: 'rest', rake: true }), D.beatRake({ type: 'grace', notes: [{ pitch: 'E4' }], rake: true })], [false, false]);
    eq(D.RAKE_LABEL, 'rake');
  });
  test('directions: beatTapMark priority tap > slap > pop, main beats only', () => {
    const beat = (notes, extra = {}) => ({ type: 'note', duration: 'quarter', notes, ...extra });
    eq(D.beatTapMark(beat([{ pitch: 'E2', slap: true }])), 'slap');
    eq(D.beatTapMark(beat([{ pitch: 'E2', pop: true }])), 'pop');
    eq(D.beatTapMark(beat([{ pitch: 'E2', pop: true }, { pitch: 'G2', slap: true }])), 'slap');
    eq(D.beatTapMark(beat([{ pitch: 'E2', slap: true, pop: true, tap: true }])), 'tap');
    eq(D.beatTapMark(beat([{ pitch: 'E2', tap: true }, { pitch: 'G2', pop: true }])), 'tap');
    eq(D.beatTapMark(beat([{ pitch: 'E2', tap: true, harmonic: 'tapped', slap: true }])), 'slap', 'tapped harmonic gives way');
    eq(D.beatTapMark(beat([{ pitch: 'E2' }])), null);
    eq(D.beatTapMark({ type: 'rest', duration: 'quarter' }), null);
    eq(D.beatTapMark({ type: 'grace', duration: '16th', notes: [{ pitch: 'E2', slap: true }] }), null);
    eq(D.beatTapMark(beat([])), null);
    eq(D.TAP_MARK_LETTERS, { tap: 'T', slap: 'S', pop: 'P' });
  });
  test('directions: trillOf canonical table, idempotent, garbage -> null', () => {
    const t = (fret, pitch) => ({ fret, pitch });
    const cases = [
      [true, t(null, null)], [7, t(7, null)], [1, t(1, null)], ['7', t(7, null)], [' 12 ', t(12, null)], [0, null], ['0', null],
      ['B3', t(null, 'B3')], [' b3 ', t(null, 'B3')], ['F#4', t(null, 'F#4')], ['bb2', t(null, 'Bb2')],
      [{ fret: 0 }, t(0, null)], [{ fret: 7 }, t(7, null)], [{ pitch: 'c4' }, t(null, 'C4')], [{ fret: 3, pitch: 'D4' }, t(3, 'D4')],
      [{}, t(null, null)], [{ fret: -1 }, t(null, null)], [{ fret: 2.5, pitch: 'H9' }, t(null, null)],
      [false, null], ['', null], ['H9', null], [-1, null], [2.5, null], [NaN, null], [Infinity, null], [[7], null],
      [() => 1, null], [null, null], [undefined, null], ['  ', null], ['7x', null],
    ];
    cases.forEach(([raw, want]) => eq(D.trillOf(raw), want, `trillOf(${String(raw)})`));
    cases.forEach(([raw]) => { const once = D.trillOf(raw); eq(D.trillOf(once), once, 'idempotent'); });
    const note = (notes, extra = {}) => ({ type: 'note', duration: 'quarter', notes, ...extra });
    eq(D.beatTrill(note([{ pitch: 'E4' }])), null);
    eq(D.beatTrill(note([{ pitch: 'E4', trill: false }, { pitch: 'G4', trill: 7 }, { pitch: 'B4', trill: true }])).note.pitch, 'G4');
    eq(D.beatTrill(note([{ pitch: 'E4', trill: 7 }])).trill, t(7, null));
    eq(D.beatTrill({ type: 'rest', notes: [{ pitch: 'E4', trill: true }] }), null);
    eq(D.beatTrill({ type: 'grace', duration: '16th', notes: [{ pitch: 'E4', trill: true }] }), null);
  });
  test('directions: trillTabFret nearest interval from the note', () => {
    const n = { string: 3, fret: 5, pitch: 'A3' };
    const f = (note, pitch) => D.trillTabFret(note, D.trillOf(pitch));
    eq(f(n, 'B3'), 7);
    eq(f(n, 'B4'), 7);
    eq(f(n, 'B2'), 7);
    eq(f(n, 'Ab3'), 4);
    eq(f(n, 'A3'), 5);
    eq(f(n, 'E4'), 0, 'a fifth up is -5 (nearest)');
    eq(f({ ...n, soundingPitch: 'A3', pitch: 'A4' }, 'B3'), 7, 'soundingPitch first');
    eq(f({ ...n, fret: undefined }, 'B3'), null);
    eq(f({ ...n, fret: 1 }, 'F3'), null, 'negative');
    eq(f({ string: 3, fret: 5 }, 'B3'), null, 'no pitch');
    eq(f({ ...n, pitch: 'x' }, 'B3'), null, 'unparseable pitch');
    eq(f(n, true), null);
    eq(D.trillTabFret(n, D.trillOf(9)), 9);
    eq(D.trillTabFret({}, D.trillOf({ fret: 0 })), 0);
  });
  test('directions: withDirections canonicalizes rake and every whammy type; fast path needs all three absent', () => {
    const b = { type: 'note', duration: 'quarter', notes: [{ pitch: 'E4' }] };
    eq(D.withDirections(b) === b, true);
    eq(D.withDirections({ ...b, rake: 'Down' }).rake, 'down');
    eq(D.withDirections({ ...b, rake: 0 }).rake, null);
    eq(D.withDirections({ ...b, whammy: { type: 'dive', amount: '-1' } }).whammy, { type: 'dive', amount: '1' });
    eq(D.withDirections({ ...b, whammy: { type: 'return' } }).whammy, { type: 'return', amount: '1/2' });
    const raw = { ...b, rake: true };
    eq(D.withDirections(raw) !== raw && !('whammy' in D.withDirections(raw)), true);
  });
  test('normalizeScore: note.trill canonicalized in place, slap / pop untouched, absent trill keeps the note shape', () => {
    const notes = [{ pitch: 'E4', trill: ' 7 ', slap: true }, { pitch: 'G4', trill: 'zz' }, { pitch: 'B4', pop: true }, { string: 2, fret: 3, trill: true }];
    const out = normalizeScore({ tracks: [{ measures: [{ beats: [{ type: 'note', duration: 'quarter', notes }] }] }] }).tracks[0].measures[0].beats[0].notes;
    eq([out[0].trill, out[0].slap, out[1].trill, out[2].pop, out[3].trill], [{ fret: 7, pitch: null }, true, null, true, { fret: null, pitch: null }]);
    eq('trill' in out[2], false);
    eq(notes[0].trill, ' 7 ', 'input untouched');
  });
  test('directions: normalizeScore keeps beats without the fields in the same shape; canonicalizes present ones', () => {
    const beats = [
      { type: 'note', duration: 'quarter', notes: [{ string: 1, fret: 5, tap: true }], letRing: true },
      { type: 'rest', duration: 'quarter', letRing: 1 },
      { type: 'note', duration: 'quarter', notes: [{ pitch: 'E4' }], pickStroke: 'Down', whammy: '-1/2' },
      { type: 'note', duration: 'quarter', notes: [{ pitch: 'E4' }], pickStroke: 'bogus', whammy: { type: 'scoop' } },
    ];
    const out = normalizeScore({ tracks: [{ measures: [{ beats }] }] }).tracks[0].measures[0].beats;
    eq(Object.keys(out[0]), ['dots', 'type', 'duration', 'notes', 'letRing']);
    eq([out[0].letRing, out[0].notes[0].tap, out[1].letRing], [true, true, 1]);
    eq(Object.keys(out[1]), ['dots', 'type', 'duration', 'letRing', 'notes']);
    eq([out[2].pickStroke, out[2].whammy], ['down', { type: 'dip', amount: '1/2' }]);
    eq(Object.keys(out[2]), ['dots', 'type', 'duration', 'notes', 'pickStroke', 'whammy']);
    eq([out[3].pickStroke, out[3].whammy], [null, null]);
    eq(beats[2].pickStroke, 'Down', 'input untouched');
  });
  const { techniqueLabelDash, techniqueLabelSize, LABEL_DASH_GAP_EM } = await imp('src/draw/tab.js');
  const { resolveTheme } = await imp('src/theme.js');
  const { estimateTextWidth } = await imp('src/textMetrics.js');
  const themes = [['default theme', resolveTheme()], ['staffLineSpacing 12', resolveTheme({ staffLineSpacing: 12 })]];
  for (const [tn, theme] of themes) {
    test(`techniqueLabelDash: ${tn}: every existing label gives exactly the dashStartX / hasDash of no label`, () => {
      ['P.M.', 'A.H.', 'T.H.', 'P.H.', 'S.H.'].forEach((label) => {
        [[100, 300, 50], [0, 0, 0], [12.34, 45.6, -7]].forEach(([x1, x2, y]) => {
          eq(techniqueLabelDash(x1, x2, y, theme, label), techniqueLabelDash(x1, x2, y, theme), `${label} at ${x1}`);
        });
      });
    });
    test(`techniqueLabelDash: ${tn}: "let ring" dash starts at least its text width + 0.3 label size after x1`, () => {
      const size = techniqueLabelSize(theme);
      const d = techniqueLabelDash(100, 400, 50, theme, D.LET_RING_LABEL);
      const textW = estimateTextWidth(D.LET_RING_LABEL, size, { bold: true });
      eq(LABEL_DASH_GAP_EM, 0.3);
      eq(d.dashStartX - 100 >= textW + 0.3 * size - 1e-9, true, 'dash after text');
      eq(d.dashStartX - 100 > size * 2.6, true, 'wider than the 2.6 default');
      eq(techniqueLabelDash(100, d.dashStartX + 0.4 * theme.staffLineSpacing, 50, theme, D.LET_RING_LABEL).hasDash, false, 'threshold follows the start');
    });
  }

  // Inline render helpers (tree walk over the DOM shim).
  const render = (score, width = 900) => {
    const box = makeContainer();
    new MusicScoreRenderer(box, JSON.parse(JSON.stringify(score)), { width }).render();
    return box.children[0];
  };
  const walk = (n, out = []) => { out.push(n); n.children.forEach((c) => walk(c, out)); return out; };
  const byClass = (root, cls) => walk(root).filter((n) => (n.getAttribute('class') || '').split(' ').includes(cls));
  const labelY = (g) => Number(g.children[0].getAttribute('y'));
  test('directions: let ring stacks outside overlapping P.M. and harmonic runs (TAB: further up)', () => {
    const b = (extra) => ({ type: 'note', duration: 'quarter', notes: [{ string: 3, fret: 7, harmonic: 'artificial', harmonicFret: 19 }], palmMute: true, letRing: true, ...extra });
    const svg = render({ tracks: [{ showTablature: true, measures: [{ beats: [b(), b(), b(), b()] }] }] });
    const [pm] = byClass(svg, 'palm-mute'); const [ah] = byClass(svg, 'harmonic'); const lr = byClass(svg, 'let-ring');
    eq(lr.length, 1);
    eq(lr[0].children[0].textContent, 'let ring');
    eq(labelY(pm) > labelY(ah) && labelY(ah) > labelY(lr[0]), true, 'P.M. -> harmonic -> let ring, outward');
  });
  test('directions: let ring on a notation-only track goes below the staff; rest bridges; grace and system ends break', () => {
    const q = (pitch, extra = {}) => ({ type: 'note', duration: 'quarter', notes: [{ pitch }], ...extra });
    const svg = render({ tracks: [{ measures: [
      { beats: [q('E4', { letRing: true }), { type: 'rest', duration: 'quarter' }, q('G4', { letRing: true }), q('A4')] },
      { beats: [q('E4', { letRing: true }), { type: 'grace', duration: '16th', notes: [{ pitch: 'D4' }] }, q('G4', { letRing: true }), q('A4'), q('B4')] },
      { beats: [q('E4'), { type: 'rest', duration: 'quarter' }, q('G4', { letRing: true }), { type: 'rest', duration: 'half' }] },
    ] }] });
    const lr = byClass(svg, 'let-ring');
    eq(lr.length, 4, 'm1 bridged run, m2 split by the grace note, m3 trailing rest not bridged');
    lr.forEach((g) => eq(labelY(g) > 40, true, 'below the notation staff'));
  });
  test('directions: nothing is drawn for rests / grace notes / garbage values; no empty groups', () => {
    const svg = render({ tracks: [{ showTablature: true, measures: [{ beats: [
      { type: 'rest', duration: 'quarter', pickStroke: 'down', whammy: true },
      { type: 'grace', duration: '16th', pickStroke: 'up', whammy: true, notes: [{ string: 1, fret: 3, tap: true }] },
      { type: 'note', duration: 'quarter', pickStroke: 'sideways', whammy: { type: 'scoop' }, notes: [{ string: 1, fret: 5 }] },
      { type: 'note', duration: 'quarter', pickStroke: 42, whammy: '', notes: [{ string: 1, fret: 5, tap: 0 }] },
      { type: 'note', duration: 'half', pickStroke: null, whammy: NaN, letRing: 0, notes: [{ string: 2, fret: 1 }] },
    ] }] }] });
    ['pick-stroke', 'tap', 'whammy', 'let-ring'].forEach((c) => eq(byClass(svg, c).length, 0, c));
    eq(walk(svg).filter((n) => n.tag === 'g' && !n.children.length).length, 0, 'empty <g>');
  });
  test('directions: dip text has one leading "-", T and pick-stroke code points, determinism', () => {
    const score = { tracks: [{ showTablature: true, measures: [{ beats: [
      { type: 'note', duration: 'quarter', whammy: true, pickStroke: 'down', notes: [{ string: 2, fret: 5, tap: true }] },
      { type: 'note', duration: 'quarter', whammy: '-1', pickStroke: 'up', notes: [{ string: 2, fret: 5 }] },
      { type: 'note', duration: 'half', whammy: { amount: 1.5 }, notes: [{ string: 2, fret: 5 }] },
    ] }] }] };
    const svg = render(score);
    eq(byClass(svg, 'whammy-dip').map((g) => g.children[1].textContent), ['-1/2', '-1', '-1.5']);
    eq(byClass(svg, 'tap').map((g) => g.children[0].textContent), ['T', 'T'], 'notation + TAB');
    eq(byClass(svg, 'pick-stroke-down').map((g) => g.children[0].textContent.codePointAt(0)), [0xE610]);
    eq(byClass(svg, 'pick-stroke-up').map((g) => g.children[0].textContent.codePointAt(0)), [0xE612]);
    eq(serialize(render(score)), serialize(svg), 'deterministic');
  });
  test('directions: pick-stroke glyphs U+E610 / U+E612 with bottom-origin metrics', () => {
    eq(pickStrokeGlyph('down').codePointAt(0).toString(16), 'e610');
    eq(pickStrokeGlyph('up').codePointAt(0).toString(16), 'e612');
    eq(pickStrokeGlyph('sideways'), null);
    eq(glyphBox(pickStrokeGlyph('down')), { left: 0, right: 1.248, top: 1.3, bottom: 0, width: 1.248 });
    eq(glyphBox(pickStrokeGlyph('up')), { left: 0, right: 1, top: 2, bottom: 0, width: 1 });
  });
  test('arpeggio: out-of-range or infinite TAB string numbers are skipped, the wave stays short', () => {
    const notes = [{ string: 1, fret: 0 }, { string: 2, fret: 1 }, { string: Infinity, fret: 0 }, { string: 1e9, fret: 0 }, { string: 99, fret: 0 }, { string: 1.5, fret: 0 }];
    const score = { tracks: [{ showStandardNotation: false, showTablature: true, measures: [{ beats: [
      { type: 'note', duration: 'whole', arpeggio: 'up', notes },
    ] }] }] };
    const started = Date.now();
    const svg = render(score);
    eq(Date.now() - started < 5000, true, 'renders promptly');
    const arps = byClass(svg, 'arpeggio');
    eq(arps.length, 1);
    const d = arps[0].children[0].getAttribute('d');
    eq(!/NaN|Infinity/.test(d) && d.length < 400, true, `short finite wave: ${d.length} chars`);
  });
  test('directions: arpeggioOf canonical table, idempotent, garbage -> null', () => {
    const raws = [true, 'up', 'down', ' Up ', 'DOWN', 'upward', '', 'u', false, 1, 0, null, undefined, {}, ['up'], NaN];
    const out = raws.map(D.arpeggioOf);
    eq(out, [true, 'up', 'down', 'up', 'down', null, null, null, null, null, null, null, null, null, null, null]);
    eq(out.map(D.arpeggioOf), out);
  });
  test('directions: strumOf canonical table (true -> null), idempotent', () => {
    const raws = ['down', 'up', ' Down ', 'UP', true, 'strum', '', false, 1, null, undefined, {}, ['up']];
    const out = raws.map(D.strumOf);
    eq(out, ['down', 'up', 'down', 'up', null, null, null, null, null, null, null, null, null]);
    eq(out.map(D.strumOf), out);
  });
  test('directions: beatArpeggio needs a main beat of two or more notes; beatStrum a main note beat', () => {
    const two = [{ pitch: 'E4' }, { pitch: 'G4' }];
    const note = (extra, notes = two) => ({ type: 'note', duration: 'quarter', notes, ...extra });
    eq([D.beatArpeggio(note({ arpeggio: true })), D.beatArpeggio(note({ arpeggio: ' UP ' })), D.beatArpeggio(note({ arpeggio: 'down' }))], [true, 'up', 'down']);
    eq(D.beatArpeggio(note({ arpeggio: 'sideways' })), null);
    eq(D.beatArpeggio(note({ arpeggio: true }, [{ pitch: 'E4' }])), null, 'single note');
    eq(D.beatArpeggio(note({ arpeggio: true }, [])), null, 'no notes');
    eq(D.beatArpeggio({ type: 'rest', duration: 'quarter', arpeggio: true }), null);
    eq(D.beatArpeggio({ type: 'grace', duration: '16th', notes: two, arpeggio: true }), null);
    eq(D.beatArpeggio(note({ arpeggio: true }, undefined)), true);
    eq([D.beatStrum(note({ strum: 'Down' })), D.beatStrum(note({ strum: 'up' }, [{ pitch: 'E4' }])), D.beatStrum(note({ strum: true }))], ['down', 'up', null]);
    eq(D.beatStrum({ type: 'rest', duration: 'quarter', strum: 'down' }), null);
    eq(D.beatStrum({ type: 'grace', duration: '16th', notes: two, strum: 'down' }), null);
    eq(D.beatStrum(note({ strum: 'down' }, [])), null);
  });
  test('directions: beatPickStroke is suppressed by a strum, unchanged otherwise', () => {
    const note = (extra) => ({ type: 'note', duration: 'quarter', notes: [{ pitch: 'E4' }], ...extra });
    eq(D.beatPickStroke(note({ pickStroke: 'down', strum: 'up' })), null);
    eq(D.beatPickStroke(note({ pickStroke: 'up', strum: ' DOWN ' })), null);
    eq(D.beatPickStroke(note({ pickStroke: 'down', strum: true })), 'down', 'garbage strum keeps the pick stroke');
    eq(D.beatPickStroke(note({ pickStroke: 'down', strum: null })), 'down');
    eq(D.beatPickStroke(note({ pickStroke: 'up' })), 'up');
  });
  test('directions: withDirections handles arpeggio / strum; fast path needs all five absent; idempotent', () => {
    const b = { type: 'note', duration: 'quarter', notes: [{ pitch: 'E4' }, { pitch: 'G4' }] };
    eq(D.withDirections(b) === b, true);
    const raw = { ...b, arpeggio: ' Down ', strum: 'UP' };
    const out = D.withDirections(raw);
    eq(out !== raw && raw.arpeggio === ' Down ' && raw.strum === 'UP', true, 'copy, input untouched');
    eq([out.arpeggio, out.strum], ['down', 'up']);
    eq(D.withDirections(out), out);
    eq(D.withDirections({ ...b, arpeggio: true }), { ...b, arpeggio: true });
    eq(D.withDirections({ ...b, strum: true }), { ...b, strum: null });
    eq(D.withDirections({ ...b, arpeggio: 'x' }), { ...b, arpeggio: null });
    eq('arpeggio' in D.withDirections({ ...b, strum: 'down' }), false);
    eq('strum' in D.withDirections({ ...b, arpeggio: 'up' }), false);
  });
}

// ---------- arpeggio room (layout/timeline.js buildColumn) ----------
{
  const { buildColumn, tabExtents } = await imp('src/layout/timeline.js');
  const { arpeggioInnerLeft, ARPEGGIO_ROOM_SP } = await imp('src/layout/chord.js');
  const { resolveTheme } = await imp('src/theme.js');
  const theme = resolveTheme();
  const sp = theme.staffLineSpacing;
  const close = (a, b, m) => { if (Math.abs(a - b) > 1e-9) throw new Error(`${m}: expected ${b}, got ${a}`); };
  const column = (beats, extra = {}) => {
    const score = normalizeScore({ tracks: [{ showTablature: true, ...extra, measures: [{ beats }] }] });
    return buildColumn(0, score, theme).tracks[0].events;
  };
  const chordNotes = [{ string: 4, fret: 4 }, { string: 3, fret: 3 }, { string: 2, fret: 2 }];
  const q = (extra, notes = chordNotes) => ({ type: 'note', duration: 'quarter', notes, ...extra });
  test('arpeggio room: ownLeft / ownLeftFirst = max(arpeggioInnerLeft, TAB left) + 1.0 sp on an arpeggio chord', () => {
    const plain = column([q({}), q({}), q({}), q({})]);
    const marked = column([q({ arpeggio: true }), q({ arpeggio: 'up' }), q({ arpeggio: 'down' }), q({})]);
    const tabIn = tabExtents(q({}), theme).left;
    eq(tabIn > 0, true);
    for (let i = 0; i < 3; i++) {
      const ev = marked[i];
      const want = Math.max(arpeggioInnerLeft(ev.chord), tabIn) + ARPEGGIO_ROOM_SP * sp;
      close(ev.ownLeft, Math.max(plain[i].ownLeft, want), `ownLeft ${i}`);
      close(ev.ownLeftFirst, Math.max(plain[i].ownLeftFirst, Math.max(arpeggioInnerLeft(ev.chordFirst), tabIn) + ARPEGGIO_ROOM_SP * sp), `ownLeftFirst ${i}`);
      eq(ev.ownLeft > plain[i].ownLeft, true, 'room added');
    }
    close(marked[3].ownLeft, plain[3].ownLeft, 'unmarked beat');
  });
  test('arpeggio room: restated tied accidental widens ownLeftFirst only; single notes, rests and graces reserve nothing', () => {
    const tied = [{ type: 'note', duration: 'quarter', arpeggio: true, notes: [{ pitch: 'F#4', tieEnd: true }, { pitch: 'A4' }, { pitch: 'C5' }] }];
    const [ev] = column(tied, { showTablature: false });
    close(ev.ownLeft, arpeggioInnerLeft(ev.chord) + ARPEGGIO_ROOM_SP * sp, 'ownLeft');
    close(ev.ownLeftFirst, arpeggioInnerLeft(ev.chordFirst) + ARPEGGIO_ROOM_SP * sp, 'ownLeftFirst');
    eq(ev.ownLeftFirst > ev.ownLeft, true, 'restated sharp is further left');
    const beats = [
      { type: 'grace', duration: '16th', arpeggio: true, notes: chordNotes },
      q({ arpeggio: true }, [{ string: 2, fret: 1 }]),
      { type: 'rest', duration: 'quarter', arpeggio: true },
      q({ arpeggio: 'bogus' }), q({ arpeggio: false }),
    ];
    const stripped = beats.map(({ arpeggio, ...b }) => b);
    const a = column(beats); const b = column(stripped);
    a.forEach((ev2, i) => { close(ev2.ownLeft, b[i].ownLeft, `ownLeft ${i}`); close(ev2.left, b[i].left, `left ${i}`); close(ev2.ownLeftFirst ?? 0, b[i].ownLeftFirst ?? 0, `first ${i}`); });
  });
}

// ---------- rest glyphs ----------
{
  const { restForDuration } = await imp('src/glyphs.js');
  test('restForDuration: every duration has its own rest glyph (64th fixed: was the quarter rest)', () => {
    eq(['whole', 'half', 'quarter', '8th', '16th', '32nd', '64th'].map((d) => restForDuration(d)),
      [Glyph.restWhole, Glyph.restHalf, Glyph.restQuarter, Glyph.rest8th, Glyph.rest16th, Glyph.rest32nd, Glyph.rest64th]);
  });
}

// ---------- rhythm on TAB staves ----------
{
  test('normalizeScore: padded marks only measures added for a shorter track (null/hole = padding)', () => {
    const s = normalizeScore({ tracks: [
      { measures: [{ beats: [] }, { beats: [], padded: true }, { beats: [] }, { beats: [] }] },
      // eslint-disable-next-line no-sparse-arrays
      { measures: [{ beats: [], padded: true }, null, , { beats: [] }] },
      { measures: [{ beats: [] }] },
    ] });
    eq(s.tracks.map((t) => t.measures.map((m) => m.padded)), [
      [false, false, false, false],
      [false, true, true, false],
      [false, true, true, true],
    ]);
  });

  test("normalizeScore: tabRhythm resolves to a boolean ('auto' / absent / other = on only without notation; needs a TAB staff)", () => {
    const cases = [];
    for (const showStandardNotation of [true, false]) for (const showTablature of [true, false, undefined]) {
      for (const tabRhythm of [undefined, 'auto', true, false, 'yes', 1, null]) cases.push({ showStandardNotation, showTablature, tabRhythm });
    }
    const s = normalizeScore({ tracks: cases.map((c) => {
      const t = { measures: [{ beats: [] }], showStandardNotation: c.showStandardNotation };
      if (c.showTablature !== undefined) t.showTablature = c.showTablature;
      if (c.tabRhythm !== undefined) t.tabRhythm = c.tabRhythm;
      return t;
    }) });
    s.tracks.forEach((t, i) => {
      const c = cases[i];
      const want = !c.showTablature ? false : c.tabRhythm === true ? true : c.tabRhythm === false ? false : !c.showStandardNotation;
      eq(t.tabRhythm, want, JSON.stringify(c));
    });
  });

  const TR = await imp('src/layout/tabRhythm.js');
  const { resolveTheme } = await imp('src/theme.js');
  const th = resolveTheme({});
  const near = (a, b, m) => { if (Math.abs(a - b) > 0.01) throw new Error(`${m} expected ${b}, got ${a}`); };
  test('tabRhythm geometry: stem top gap 1.0 sp, floored under a bottom-string knock-out', () => {
    near(TR.tabStemTopY(75, th), 85, 'default');
    near(TR.tabStemTopY(75, resolveTheme({ tabFontSize: 20 })), 88, 'tabFontSize 20 -> (10 + 1) / 10 + 0.2 = 1.3 sp');
    near(TR.tabStemTopY(75, resolveTheme({ tabStemGapSp: 2 })), 95, 'tabStemGapSp 2');
  });
  test('tabRhythm geometry: stem lengths (sp) per duration and beam levels', () => {
    eq(['quarter', '8th', '16th', '32nd', '64th', 'half', 'whole'].map((d) => TR.tabStemLengthSp(d, ({ '8th': 1, '16th': 2, '32nd': 3, '64th': 4 })[d] || 0, th)),
      [2.5, 2.5, 2.5, 3.25, 4, 1.25, 0]);
    eq(TR.tabStemLengthSp('8th', 3, th), 3.25, 'an 8th in a group with 32nds');
  });
  test('tabRhythm geometry: flags only when unbeamed 8th-64th, stem down', () => {
    eq(['quarter', '8th', '16th', '32nd', '64th'].map((d) => TR.tabFlagGlyph(d, false)),
      [null, Glyph.flag8thDown, Glyph.flag16thDown, Glyph.flag32ndDown, Glyph.flag64thDown]);
    eq(TR.tabFlagGlyph('16th', true), null);
  });
  test('tabRhythm extents (ui.md §8): flag right edges, rest halves, dots', () => {
    const note = (duration, dots = 0) => ({ type: 'note', duration, dots, notes: [{ string: 1, fret: 0 }] });
    const rest = (duration, dots = 0) => ({ type: 'rest', duration, dots });
    [['8th', 9.18], ['16th', 8.73], ['32nd', 8.19], ['64th', 8.25]].forEach(([d, r]) => {
      const x = TR.tabRhythmExtents(note(d), false, th);
      near(x.left, 0, `${d} left`); near(x.right, r, `${d} flag right`);
    });
    eq(TR.tabRhythmExtents(note('8th'), true, th), { left: 0, right: 0 }, 'beamed 8th');
    eq(TR.tabRhythmExtents(note('quarter'), false, th), { left: 0, right: 0 }, 'quarter');
    near(TR.tabRhythmExtents(note('quarter', 1), false, th).right, 6.7, 'dotted quarter: 0.5 + 0.17');
    near(TR.tabRhythmExtents(note('8th', 1), false, th).right, 14.38, 'dotted unbeamed 8th: 1.224 * 0.75 + 0.35 + 0.17');
    near(TR.tabRhythmExtents(note('8th', 2), true, th).right, 11.7, 'double-dotted beamed 8th: 0.5 + 0.5 + 0.17');
    [['quarter', 5.4], ['8th', 4.94], ['16th', 6.4], ['32nd', 7.26], ['64th', 8.46]].forEach(([d, l]) => {
      const x = TR.tabRhythmExtents(rest(d), false, th);
      near(x.left, l, `${d} rest left`); near(x.right, l, `${d} rest right`);
    });
    near(TR.tabRhythmExtents(rest('quarter', 1), false, th).right, 5.4 + 6.7, 'dotted quarter rest');
  });
}

// ---------- navigation fields (src/navigation.js) ----------
{
  const NV = await imp('src/navigation.js');
  test('navigation: endingNumbers single / string / array rules; garbage -> []', () => {
    eq(NV.endingNumbers(1), [1]); eq(NV.endingNumbers(' 2 '), [2]); eq(NV.endingNumbers('007'), [7]);
    eq(NV.endingNumbers([3, '1', 2, 1, 'x', 0, -1, 1.5]), [1, 2, 3], 'array: invalid dropped, deduped, sorted');
    [0, -1, 1.5, NaN, Infinity, 2 ** 53, '0', '1.5', '-1', '', ' ', 'a1', '1a', null, undefined, true, {}, [], [[1]], ['', null]]
      .forEach((g) => eq(NV.endingNumbers(g), [], `garbage ${String(g)}`));
  });
  test('navigation: endingNumbers keeps at most MAX_ENDING_NUMBERS (the lowest)', () => {
    eq(NV.MAX_ENDING_NUMBERS, 32);
    const big = Array.from({ length: 1000 }, (_, i) => 1000 - i);
    eq(NV.endingNumbers(big), Array.from({ length: 32 }, (_, i) => i + 1), '1000 items -> lowest 32');
    const dup = [5, 5, '5', 3, 40, ...Array.from({ length: 50 }, (_, i) => 100 + i)];
    eq(NV.endingNumbers(dup), [3, 5, 40, ...Array.from({ length: 29 }, (_, i) => 100 + i)], 'dedupe before cap');
    const huge = new Array(1e6).fill(7); huge[999999] = 2;
    eq(NV.endingNumbers(huge), [2, 7], '1e6 items');
  });
  test('navigation: canonicalEnding forms, validity and idempotence', () => {
    eq(NV.canonicalEnding(1), { numbers: [1], text: null, open: null });
    eq(NV.canonicalEnding([2, '1']), { numbers: [1, 2], text: null, open: null });
    eq(NV.canonicalEnding({ numbers: 3, text: '  Last time ', open: true }), { numbers: [3], text: 'Last time', open: true });
    eq(NV.canonicalEnding({ text: 'Coda ending' }), { numbers: [], text: 'Coda ending', open: null });
    eq(NV.canonicalEnding({ numbers: [1], text: '  ', open: 'yes' }), { numbers: [1], text: null, open: null });
    eq(NV.canonicalEnding({ numbers: [2], open: false }), { numbers: [2], text: null, open: false });
    [null, undefined, 0, '', 'x', [], [0, 'a'], {}, { numbers: [] }, { text: '' }, { open: true }, true, false]
      .forEach((g) => eq(NV.canonicalEnding(g), null, `garbage ${JSON.stringify(g)}`));
    [1, '2', [3, 1], { numbers: ['2', 2], text: 'x', open: false }, { text: 'Last' }].forEach((raw) => {
      const c = NV.canonicalEnding(raw);
      eq(NV.canonicalEnding(c), c, `idempotent ${JSON.stringify(raw)}`);
    });
  });
  test('navigation: endingKey ignores open; endingLabel', () => {
    eq(NV.endingKey(NV.canonicalEnding([1, 2])), '1,2|');
    eq(NV.endingKey(NV.canonicalEnding({ numbers: [1, 2], open: true })), '1,2|');
    eq(NV.endingKey(NV.canonicalEnding({ numbers: [3], text: 'Last time' })), '3|Last time');
    eq(NV.endingLabel(NV.canonicalEnding(1)), '1.');
    eq(NV.endingLabel(NV.canonicalEnding([2, 1])), '1., 2.');
    eq(NV.endingLabel(NV.canonicalEnding({ numbers: [3], text: 'Last time' })), 'Last time');
  });
  test('navigation: canonicalJump spelling, whitespace, other text, garbage; jumpKind', () => {
    eq(NV.canonicalJump('d.s.  AL   coda'), 'D.S. al Coda');
    eq(NV.canonicalJump(' to coda '), 'To Coda');
    eq(NV.canonicalJump('FINE'), 'Fine');
    eq(NV.canonicalJump('  Dal  Segno senza replica '), 'Dal Segno senza replica');
    [null, undefined, '', '   ', 1, true, {}, ['D.C.']].forEach((g) => eq(NV.canonicalJump(g), null, `garbage ${JSON.stringify(g)}`));
    NV.JUMP_TEXTS.forEach((j) => eq(NV.canonicalJump(NV.canonicalJump(j)), j, `idempotent ${j}`));
    eq(NV.JUMP_TEXTS.map(NV.jumpKind), ['dc', 'dc', 'dc', 'ds', 'ds', 'ds', 'toCoda', 'fine']);
    eq(NV.jumpKind('Dal Segno senza replica'), 'text');
  });
  test('navigation: mergeNavigation — lowest track wins ending/jump, segno/coda from any track, holes add nothing', () => {
    const tracks = [
      { measures: [{ ending: 'x' }, null, { ending: 2, jump: 'fine' }, undefined, { segno: 'yes', coda: 1 }] },
      { measures: [{ ending: 1, segno: true }, { coda: true, jump: '' }, { ending: 3, jump: 'D.C.' }] },
      null,
      { measures: [] },
      {},
    ];
    eq(NV.mergeNavigation(tracks, 6), [
      { ending: { numbers: [1], text: null, open: null }, segno: true, coda: false, jump: null },
      { ending: null, segno: false, coda: true, jump: null },
      { ending: { numbers: [2], text: null, open: null }, segno: false, coda: false, jump: 'Fine' },
      { ending: null, segno: false, coda: false, jump: null },
      { ending: null, segno: false, coda: false, jump: null },
      { ending: null, segno: false, coda: false, jump: null },
    ]);
    eq(NV.mergeNavigation(undefined, 0), []);
  });
  test('navigation: normalizeScore sets score.navigation per column (padded tracks, overwrite, raw fields kept)', () => {
    const s = normalizeScore({ navigation: 'author', tracks: [
      { measures: [{ beats: [], ending: [2, 1] }] },
      { measures: [{ beats: [], ending: 3, jump: 'to coda' }, { beats: [], segno: true }, null, { beats: [], coda: true, ending: { text: 'Last' } }] },
    ] });
    eq(s.navigation, [
      { ending: { numbers: [1, 2], text: null, open: null }, segno: false, coda: false, jump: 'To Coda' },
      { ending: null, segno: true, coda: false, jump: null },
      { ending: null, segno: false, coda: false, jump: null },
      { ending: { numbers: [], text: 'Last', open: null }, segno: false, coda: true, jump: null },
    ]);
    eq(s.tracks[0].measures[0].ending, [2, 1], 'raw field kept on the track measure');
    eq(s.tracks[0].measures[3].padded, true);
    eq(normalizeScore({ tracks: [] }).navigation, []);
    eq(normalizeScore({}).navigation, []);
  });
  const { inkBounds } = await imp('src/layout/ink.js');
  const { resolveTheme: rt } = await imp('src/theme.js');
  const { estimateTextWidth } = await imp('src/textMetrics.js');
  const thm = rt({});
  const ok2 = (c, m) => { if (!c) throw new Error(m); };
  const node = (tag, attrs, children = [], text = '') => ({ tag, getAttribute: (a) => (a in attrs ? String(attrs[a]) : null), textContent: text, children });
  const G = (...children) => node('g', {}, children);
  test('ink overlap: a path / line starting left of the range counts in overlap mode, not by anchor', () => {
    const slur = node('path', { d: 'M 10 -5 C 60 -30 140 -30 190 -5' });
    const lineL = node('line', { x1: 0, y1: -40, x2: 300, y2: -40, 'stroke-width': 2 });
    const g = G(slur, lineL);
    eq(inkBounds(g, thm, { xMin: 100, xMax: 150 }).top, Infinity, 'default (anchor) mode skips both');
    eq(inkBounds(g, thm, { xMin: 100, xMax: 150, overlap: true }).top, -41, 'overlap: long line (y -40, half stroke 1)');
    eq(inkBounds(G(slur), thm, { xMin: 100, xMax: 150, overlap: true }).top, -30, 'overlap: path control points');
    eq(inkBounds(G(slur), thm, { xMin: 191, xMax: 250, overlap: true }).top, Infinity, 'path wholly left of the range');
    eq(inkBounds(G(slur), thm, { xMin: 190, xMax: 250, overlap: true }).top, -30, 'touching end counts');
  });
  test('ink overlap: text extents follow text-anchor and bold; music text uses its glyph box', () => {
    const w = estimateTextWidth('Am7', 20, { bold: true });
    const t = (anchor) => node('text', { x: 100, y: 0, 'font-size': 20, 'font-weight': 'bold', ...(anchor ? { 'text-anchor': anchor } : {}) }, [], 'Am7');
    const hit = (n, xMin, xMax) => Number.isFinite(inkBounds(G(n), thm, { xMin, xMax, overlap: true }).top);
    eq([hit(t(), 100 + w - 0.5, 400), hit(t(), 100 + w + 0.5, 400)], [true, false], 'start anchor: right edge at x + bold width');
    eq([hit(t('end'), 0, 100 - w + 0.5), hit(t('end'), 0, 100 - w - 0.5)], [true, false], 'end anchor');
    eq([hit(t('middle'), 100 + w / 2 - 0.5, 400), hit(t('middle'), 100 + w / 2 + 0.5, 400)], [true, false], 'middle anchor');
    const fermata = node('text', { x: 50, y: -20, 'font-family': thm.fontFamily, 'font-size': 40 }, [], Glyph.fermataAbove);
    eq([hit(fermata, 50 + 2.42 * 10 - 0.5, 400), hit(fermata, 50 + 2.42 * 10 + 0.5, 400)], [true, false], 'glyph box width 2.42 sp');
  });
  test('ink overlap: default mode unchanged (anchor / first point), groups always visited', () => {
    const a = node('path', { d: 'M 10 -5 L 300 -50' });
    const b = node('text', { x: 200, y: -10, 'font-size': 10, 'text-anchor': 'end' }, [], 'long text here');
    const g = G(G(a), b);
    eq(inkBounds(g, thm, { xMax: 50 }), { top: -50, bottom: -5 }, 'xMax: path judged by its first point');
    eq(inkBounds(g, thm, { xMin: 50 }), { top: -18, bottom: -7.5 }, 'xMin: text judged by its anchor x');
    eq(inkBounds(g, thm), { top: -50, bottom: -5 }, 'no range');
    eq(inkBounds(g, thm, { xMin: 150, xMax: 160, overlap: true }), { top: -50, bottom: -5 }, 'overlap: both span 150..160');
  });
  const { computeLayout } = await imp('src/layout/index.js');
  const NL = await imp('src/layout/navigation.js');
  const sp = thm.staffLineSpacing;
  const bar = (extra = {}) => ({ beats: [nq, nq, nq, nq], ...extra });
  const lay = (tracks, width = 900) => computeLayout(normalizeScore({ tracks }), thm, width);
  const near2 = (a, b, m) => { if (Math.abs(a - b) > 0.01) throw new Error(`${m} expected ${b}, got ${a}`); };
  test('navigation layout: grouping — same set extends; different set, gap or repeatStart starts a new bracket', () => {
    const L = lay([{ measures: [bar({ ending: 1 }), bar({ ending: '1' }), bar({ ending: 2 }), bar(), bar({ ending: [1, 2] }),
      bar({ ending: [2, 1], barline: 'repeatStart' }), bar({ ending: { numbers: [3], text: 'x' } }), bar({ ending: { numbers: [3] } })] }], 1400);
    eq(L.systems.length, 1);
    eq(L.systems[0].voltas.map((v) => [v.startMi, v.endMi, v.label]), [[0, 1, '1.'], [2, 2, '2.'], [4, 4, '1., 2.'], [5, 5, '1., 2.'], [6, 6, 'x'], [7, 7, '3.']]);
    eq(NL.voltaBrackets(normalizeScore({ tracks: [] })), []);
    eq(lay([{ measures: [bar(), bar()] }]).systems[0].voltas, [], 'no navigation -> empty');
    eq(lay([{ measures: [bar(), bar()] }]).systems[0].marks, []);
  });
  test('navigation layout: closed iff any track ends the bracket with repeatEnd; open override (last non-null wins)', () => {
    const L = lay([
      { measures: [bar({ ending: 1 }), bar({ ending: 1 }), bar({ ending: 2 }), bar({ ending: 3, barline: 'repeatEnd' }), bar({ ending: { numbers: [4], open: true } }), bar({ ending: { numbers: [4], open: false } }), bar({ ending: 5 })] },
      { measures: [bar(), bar({ barline: 'repeatEnd' }), bar(), bar(), bar(), bar(), bar({ barline: 'repeatEnd' })] },
    ], 1400);
    const v = L.systems[0].voltas;
    eq(v.map((p) => [p.startMi, p.closed, p.rightHook]), [[0, true, true], [2, false, false], [3, true, true], [4, true, true], [6, true, true]]);
    const L2 = lay([{ measures: [bar({ ending: { numbers: [1], open: true }, barline: 'repeatEnd' })] }]);
    eq([L2.systems[0].voltas[0].closed, L2.systems[0].voltas[0].rightHook], [false, false], 'open: true beats repeatEnd');
  });
  test('navigation layout: x positions — start barline, system start after the header / repeat sign, end inset, min length', () => {
    const L = lay([{ measures: [bar({ ending: 1 }), bar({ ending: 2 }), bar({ beats: [], ending: 3 })] }], 900);
    const sys = L.systems[0]; const ms = sys.tracks[0].measures;
    const [a, b] = sys.voltas;
    near2(a.x1, sys.contentStartX + 0.5 * sp, 'first measure: contentStartX + 0.5 sp');
    near2(a.x2, ms[0].endX - 0.5 * sp, 'end inset 0.5 sp');
    near2(b.x1, ms[1].x, 'li > 0: the opening barline');
    const R = lay([{ measures: [bar({ ending: 1, barline: 'repeatStart' }), bar()] }]).systems[0];
    near2(R.voltas[0].x1, R.tracks[0].measures[0].startBarline.x, 'repeatStart on the first measure: the repeat sign');
    near2(NL.measureStartX(R, 0, thm), R.tracks[0].measures[0].startBarline.x, 'measureStartX li 0');
    near2(NL.measureStartX(R, 1, thm), R.tracks[0].measures[1].x, 'measureStartX li 1');
    sys.voltas.forEach((v) => ok2(v.x2 >= v.x1 + 1.5 * sp - 0.01, 'min length 1.5 sp'));
  });
  test('navigation layout: splitting across system breaks — label and left hook first, right hook last, continuation after the header', () => {
    const measures = Array.from({ length: 10 }, (_, i) => bar({ ending: [1, 2], ...(i === 9 ? { barline: 'repeatEnd' } : {}) }));
    const L = lay([{ measures }], 400);
    ok2(L.systems.length >= 3, `${L.systems.length} systems`);
    const parts = L.systems.flatMap((s) => s.voltas);
    eq(parts.length, L.systems.length, 'one part per system');
    parts.forEach((p, i) => {
      const sys = L.systems[i];
      const first = i === 0; const last = i === parts.length - 1;
      eq([p.sysIdx, p.startMi, p.endMi], [i, sys.measureIndices[0], sys.measureIndices.at(-1)], `part ${i} span`);
      eq([p.label, p.leftHook, p.rightHook, p.closed], [first ? '1., 2.' : null, first, last, true], `part ${i} flags`);
      near2(p.x1, sys.contentStartX + 0.5 * sp, `part ${i} x1`);
      near2(p.x2, last ? sys.tracks[0].measures.at(-1).endX - 0.5 * sp : sys.lastBarlineX, `part ${i} x2`);
    });
  });
  test('navigation layout: marks — segno/coda x, coda shifted after a segno, jump right edge at the closing barline', () => {
    const L = lay([
      { measures: [bar({ segno: true }), bar({ coda: true, jump: 'd.s. al coda' }), bar({ segno: true }), bar()] },
      { measures: [bar(), bar(), bar({ coda: true, jump: 'Fine' }), bar({ jump: 'Hello' })] },
    ], 1400);
    const sys = L.systems[0]; const ms = sys.tracks[0].measures;
    const segnoW = 2.2 * sp * 0.75;
    eq(sys.marks.map((m) => [m.kind, m.mi, m.text ?? null, m.jumpKind ?? null]),
      [['segno', 0, null, null], ['coda', 1, null, null], ['jump', 1, 'D.S. al Coda', 'ds'], ['segno', 2, null, null], ['coda', 2, null, null], ['jump', 2, 'Fine', 'fine'], ['jump', 3, 'Hello', 'text']]);
    near2(sys.marks[0].x, sys.contentStartX + 0.5 * sp, 'segno on the first measure');
    near2(sys.marks[1].x, ms[1].x + 0.3 * sp, 'coda 0.3 sp after the barline');
    near2(sys.marks[2].xEnd, ms[1].endX, 'jump right edge');
    near2(sys.marks[4].x, ms[2].x + 0.3 * sp + segnoW + 0.5 * sp, 'coda after the segno');
  });
  test('navigation layout: measure x positions identical with and without navigation fields', () => {
    const plain = Array.from({ length: 9 }, () => bar());
    const nav = plain.map((m, i) => ({ ...m, ending: i % 3 === 2 ? null : [1 + (i % 2)], segno: i === 0, coda: i === 4, jump: i === 5 ? 'D.S. al Coda' : undefined }));
    for (const w of [400, 600, 900]) {
      const strip = (L) => JSON.stringify(L, (k, v) => (k === 'voltas' || k === 'marks' ? undefined : k === 'el' ? undefined : v));
      eq(strip(lay([{ measures: nav }], w)), strip(lay([{ measures: plain }], w)), `w${w}`);
    }
  });
  const { renderNavigation } = await imp('src/draw/navigation.js');
  const { tempoTextWidth } = await imp('src/draw/decor.js');
  const { group: svgGroup } = await imp('src/draw/svgUtil.js');
  test('navigation draw: renderNavigation appends nothing without content; tempoTextWidth = bold estimate at 1.3 sp', () => {
    const g = svgGroup({});
    eq(renderNavigation(g, { voltas: [], marks: [] }, thm), null);
    eq(renderNavigation(g, {}, thm), null);
    eq(renderNavigation(null, { voltas: [{ x1: 0, x2: 50, label: '1.', leftHook: true, rightHook: true, closed: true }], marks: [] }, thm), null);
    eq(g.children.length, 0, 'nothing appended');
    eq(tempoTextWidth('Moderato', thm), estimateTextWidth('Moderato', 13, { bold: true }));
  });
  test('navigation draw: bracket path, hooks and label; one bracket height, marks above it', () => {
    const g = svgGroup({});
    const sys = { voltas: [
      { x1: 100, x2: 200, label: '1.', leftHook: true, rightHook: true, closed: true },
      { x1: 200, x2: 300, label: null, leftHook: false, rightHook: false, closed: false },
    ], marks: [{ kind: 'segno', mi: 0, x: 120 }, { kind: 'jump', mi: 1, text: 'Fine', jumpKind: 'fine', xEnd: 300 }] };
    const nav = renderNavigation(g, sys, thm);
    eq(g.children.length, 1, 'one navigation group appended');
    eq(nav.getAttribute('class'), 'navigation');
    const [v1, v2, segno, fine] = nav.children;
    eq([v1.getAttribute('class'), v2.getAttribute('class')], ['volta volta-closed', 'volta volta-open']);
    eq(v1.children[0].getAttribute('d'), 'M 100.6 -15 L 100.6 -30 L 199.4 -30 L 199.4 -15', 'closed: both hooks, -3 sp minimum');
    eq(v2.children[0].getAttribute('d'), 'M 200 -30 L 300 -30', 'open continuation: no hooks');
    eq(v2.children.length, 1, 'no label on a continuation part');
    eq([v1.children[1].getAttribute('class'), v1.children[1].getAttribute('x'), v1.children[1].getAttribute('y'), v1.children[1].textContent], ['volta-number', '104', '-18', '1.']);
    eq(segno.getAttribute('class'), 'segno');
    eq(fine.getAttribute('class'), 'jump fine');
    eq(segno.getAttribute('y'), fine.children[0].getAttribute('y'), 'one baseline for all marks');
    ok2(Number(segno.getAttribute('y')) < -30.6 - 7.5 + 0.01, 'marks >= 0.75 sp above the bracket line');
  });
}

/// ---------- chord-diagram shapes (src/chordShapes.js) ----------
{
  const CS = await imp('src/chordShapes.js');
  const V = (raw, n = 6) => CS.validateShape(raw, n);
  const ok1 = (c, m) => { if (!c) throw new Error(m); };
  test('chordShapes: validateShape accepts valid frets (low -> high, muted forms) and returns columns low -> high', () => {
    eq(V({ frets: ['x', 3, 2, 0, 1, 0] }), { frets: [null, 3, 2, 0, 1, 0], fingers: null, barre: null, baseFret: 1, rows: 4, showNut: true, hasMarkers: true, hasFingers: false });
    eq(V({ frets: ['X', null, -1, 0, 0, 0] }).frets, [null, null, null, 0, 0, 0]);
    eq(V({ frets: [1, 3, 3, 2, 1, 1] }).hasMarkers, false);
    eq(V({ frets: [0, 2, 2, 0], fingers: null }, 4).frets, [0, 2, 2, 0], '4 strings');
    eq(V({ frets: [0, 0, 0] }, 3).frets.length, 3, '3 strings');
    eq(V({ frets: Array(10).fill(0) }, 10).frets.length, 10, '10 strings');
  });
  test('chordShapes: validateShape rejects garbage (null for every case)', () => {
    const bad = [null, undefined, 0, 'C', [], [0, 0, 0, 0, 0, 0], true, { frets: null }, { frets: 'x32010' }, { frets: [0, 0, 0, 0, 0] },
      { frets: [0, 0, 0, 0, 0, 0, 0] }, { frets: ['3', 0, 0, 0, 0, 0] }, { frets: [2.5, 0, 0, 0, 0, 0] }, { frets: [25, 0, 0, 0, 0, 0] },
      { frets: [NaN, 0, 0, 0, 0, 0] }, { frets: [-2, 0, 0, 0, 0, 0] }, { frets: [undefined, 0, 0, 0, 0, 0] }, { frets: [{}, 0, 0, 0, 0, 0] },
      { frets: [Infinity, 0, 0, 0, 0, 0] }, { frets: ['o', 0, 0, 0, 0, 0] }, { frets: [1, 6, 0, 0, 0, 0] }, { frets: [3, 0, 0, 0, 0, 12] },
      Object.create({ frets: [0, 0, 0, 0, 0, 0] }), new Date(0), { frets: new Array(6) }];
    bad.forEach((b, i) => eq(V(b), null, `case ${i}`));
    eq(V({ frets: [0, 0] }, 2), null, '2 strings');
    eq(V({ frets: Array(11).fill(0) }, 11), null, '11 strings');
    eq(V({ frets: [0, 0, 0, 0, 0, 0] }, 6.5), null, 'non-integer string count');
    eq(CS.validateShape({ frets: [0, 0, 0, 0, 0, 0] }), null, 'no string count');
    eq(V({ frets: [1, 5, 0, 0, 0, 0] }).rows, 5, 'span 5 is fine');
    eq(V({ frets: [24, 20, 0, 0, 0, 0] }).baseFret, 20, 'fret 24 is fine');
  });
  test('chordShapes: all muted is valid (baseFret 1, nut, 4 rows, markers)', () => {
    eq(V({ frets: ['x', 'x', 'x', 'x', 'x', 'x'] }), { frets: [null, null, null, null, null, null], fingers: null, barre: null, baseFret: 1, rows: 4, showNut: true, hasMarkers: true, hasFingers: false });
  });
  test('chordShapes: baseFret default / author value / recompute; rows', () => {
    eq(CS.resolveBaseFret([null, 3, 2, 0, 1, 0]), 1);
    eq(CS.resolveBaseFret([1, 3, 3, 2, 1, 1]), 1, 'max 3');
    eq(CS.resolveBaseFret([4, 4, 4, 4, 4, 4]), 1, 'max 4 still at the nut');
    eq(CS.resolveBaseFret([null, 5, 7, 7, 7, 5]), 5);
    eq(CS.resolveBaseFret([null, null, null]), 1);
    const b5 = V({ frets: [null, 5, 7, 7, 7, 5] });
    eq([b5.baseFret, b5.rows, b5.showNut], [5, 4, false]);
    const r5 = V({ frets: [1, 3, 3, 2, 5, 1] });
    eq([r5.baseFret, r5.rows], [1, 5], 'max 5 from fret 1: 5 rows');
    eq(V({ frets: [null, 5, 7, 7, 7, 5], baseFret: 4 }).baseFret, 4, 'author value kept (<= lowest, span fits)');
    const b3 = V({ frets: [null, 5, 7, 7, 7, 5], baseFret: 3 });
    eq([b3.baseFret, b3.rows], [3, 5], 'author value 3: 5 rows');
    eq(V({ frets: [0, 2, 2, 1, 0, 0], baseFret: 1 }).baseFret, 1);
    eq(V({ frets: [null, 5, 7, 7, 7, 5], baseFret: 1 }).baseFret, 5, 'span from 1 > 5 -> recomputed');
    eq(V({ frets: [null, 5, 7, 7, 7, 5], baseFret: 6 }).baseFret, 5, 'above lowest -> recomputed');
    [0, -1, 2.5, '4', null, NaN].forEach((b) => eq(V({ frets: [null, 5, 7, 7, 7, 5], baseFret: b }).baseFret, 5, `bad ${String(b)}`));
    eq(V({ frets: [0, 0, 0, 0, 0, 0], baseFret: 5 }).baseFret, 1, 'no fretted note -> 1');
  });
  test('chordShapes: fingers (wrong length dropped, bad entries / open / muted -> null, t -> T, 0 none)', () => {
    eq(V({ frets: ['x', 3, 2, 0, 1, 0], fingers: [0, 3, 2, 0, 1, 0] }).fingers, [null, 3, 2, null, 1, null]);
    eq(V({ frets: ['x', 3, 2, 0, 1, 0], fingers: [1, 3, 2, 4, 1, 4] }).fingers, [null, 3, 2, null, 1, null], 'fingers on open / muted dropped');
    eq(V({ frets: [1, 3, 3, 2, 1, 1], fingers: ['t', 5, '3', 2.5, 'T', null] }).fingers, ['T', null, null, null, 'T', null]);
    eq(V({ frets: ['x', 3, 2, 0, 1, 0], fingers: [0, 3, 2, 0, 1] }).fingers, null, 'wrong length');
    eq(V({ frets: ['x', 3, 2, 0, 1, 0], fingers: '032010' }).fingers, null, 'not an array');
    eq(V({ frets: ['x', 3, 2, 0, 1, 0], fingers: [0, 0, 0, 0, 0, 0] }).hasFingers, false, 'no finger -> none');
    eq(V({ frets: ['x', 3, 2, 0, 1, 0], fingers: [0, 3, 0, 0, 0, 0] }).hasFingers, true);
  });
  test('chordShapes: barre (string numbering 1 = highest, default lowest..1, either order, inside the window, >= 2 strings)', () => {
    const F = (barre, frets = [1, 3, 3, 2, 1, 1]) => V({ frets, barre }).barre;
    eq(F({ fret: 1 }), { fret: 1, cLo: 0, cHi: 5 });
    eq(F({ fret: 1, from: 3, to: 1 }), { fret: 1, cLo: 3, cHi: 5 });
    eq(F({ fret: 1, from: 1, to: 3 }), { fret: 1, cLo: 3, cHi: 5 }, 'either order');
    eq(F({ fret: 3, from: 5, to: 2 }), { fret: 3, cLo: 1, cHi: 4 });
    eq(F({ fret: 1, from: 2, to: 2 }), null, 'one string');
    eq(F({ fret: 1, from: 7 }), null, 'string out of range');
    eq(F({ fret: 1, to: 0 }), null);
    eq(F({ fret: 1, from: '6' }), null);
    eq(F({ fret: 5 }), null, 'below the window');
    eq(F({ fret: 0 }), null);
    eq(F({ fret: 2.5 }), null);
    eq(F({ fret: 4 }), { fret: 4, cLo: 0, cHi: 5 }, 'last row of a 4-row window');
    eq(F({ fret: 4 }, [null, 5, 7, 7, 7, 5]), null, 'above a 5fr window');
    eq(F({ fret: 5, from: 5 }, [null, 5, 7, 7, 7, 5]), { fret: 5, cLo: 1, cHi: 5 });
    eq(F([1]), null); eq(F('1'), null); eq(F(null), null); eq(F(true), null);
    eq(V({ frets: [0, 2, 2, 1], barre: { fret: 2 } }, 4).barre, { fret: 2, cLo: 0, cHi: 3 }, '4 strings: default from 4');
  });
  test('chordShapes: validateShape does not mutate input and is repeatable', () => {
    const raw = { frets: ['x', 3, 2, 0, 1, 0], fingers: [0, 3, 2, 0, 1, 0], barre: { fret: 1, from: 2 }, baseFret: 1 };
    const before = JSON.stringify(raw);
    const a = V(raw); const b = V(raw);
    eq(JSON.stringify(raw), before, 'input untouched');
    eq(a, b, 'same result');
    ok1(a !== b && a.frets !== raw.frets, 'fresh objects');
  });
  test('chordShapes: resolveShape order (track gate, false, override, dictionary, plain)', () => {
    const shapeC = { frets: ['x', 3, 2, 0, 1, 0] };
    const shapeG = { frets: [3, 2, 0, 0, 0, 3] };
    const score = { chordShapes: { C: shapeC, G: shapeG } };
    const on = { showChordDiagrams: true, tuning: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'] };
    const off = { ...on, showChordDiagrams: false };
    const R = (beat, s = score, t = on) => CS.resolveShape(beat, s, t);
    eq(R({ chord: 'C' }), V(shapeC), 'dictionary');
    eq(R({ chord: '  C ' }), V(shapeC), 'trimmed');
    eq(R({ chord: 'c' }), null, 'case-sensitive');
    eq(R({ chord: 'Dm' }), null, 'no shape -> plain symbol');
    eq(R({ chord: 'C', chordDiagram: shapeG }), V(shapeG), 'beat override wins');
    eq(R({ chordDiagram: shapeG }), V(shapeG), 'override without a chord');
    eq(R({ chord: 'C', chordDiagram: false }), null, 'false hides');
    eq(R({ chord: 'C', chordDiagram: { frets: [0] } }), null, 'invalid override -> no dictionary fallback');
    [true, 'G', 1, null, undefined, [0, 0, 0, 0, 0, 0]].forEach((v) => eq(R({ chord: 'C', chordDiagram: v }), V(shapeC), `ignored override ${String(v)}`));
    eq(R({ chord: 'C' }, score, off), null, 'track off');
    eq(R({ chord: 'C', chordDiagram: shapeG }, score, off), null, 'track off beats a beat override');
    eq(R({ chord: 'C' }, score, { tuning: on.tuning }), null, 'track flag missing');
    eq(R({ chord: 'C' }, {}), null, 'no dictionary');
    [null, [], 'C', 5, true].forEach((d) => eq(R({ chord: 'C' }, { chordShapes: d }), null, `dictionary ${JSON.stringify(d)}`));
    eq(R({ chord: '' }, { chordShapes: { '': shapeC } }), null, 'empty name');
    eq(R({ chord: 'C' }, score, { ...on, tuning: ['E1', 'A1', 'D2', 'G2'] }), null, '6-string shape on a 4-string track');
    eq(R({ chord: 'C' }, { chordShapes: { C: 'x32010' } }), null, 'garbage dictionary entry');
    eq(R({ chord: 7 }, { chordShapes: { 7: shapeC } }), V(shapeC), 'numeric chord name');
    eq(R(null, score), null); eq(R({ chord: 'C' }, null), null); eq(R({ chord: 'C' }, score, null), null);
  });
  test('chordShapes: resolveShape only reads own dictionary keys (__proto__, constructor, toString)', () => {
    const on = { showChordDiagrams: true, tuning: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'] };
    const shape = { frets: [0, 2, 2, 1, 0, 0] };
    ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf'].forEach((k) => eq(CS.resolveShape({ chord: k }, { chordShapes: {} }, on), null, k));
    const parsed = JSON.parse(`{"chordShapes":{"__proto__":${JSON.stringify(shape)},"constructor":${JSON.stringify(shape)}}}`);
    eq(CS.resolveShape({ chord: '__proto__' }, parsed, on), V(shape), 'own __proto__ key from JSON');
    eq(CS.resolveShape({ chord: 'constructor' }, parsed, on), V(shape), 'own constructor key');
    eq(CS.resolveShape({ chord: 'E' }, { chordShapes: Object.create({ E: shape }) }, on), null, 'inherited key / non-plain dictionary');
    eq(CS.resolveShape({ chord: 'E' }, { chordShapes: Object.assign(Object.create(null), { E: shape }) }, on), V(shape), 'null-prototype dictionary');
  });
  test('chordShapes: resolveShape is idempotent and leaves its inputs untouched', () => {
    const score = { chordShapes: { Am: { frets: ['x', 0, 2, 2, 1, 0], fingers: [0, 0, 2, 3, 1, 0] } } };
    const track = { showChordDiagrams: true, tuning: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'] };
    const beat = { chord: 'Am' };
    const before = JSON.stringify([score, track, beat]);
    const a = CS.resolveShape(beat, score, track);
    eq(CS.resolveShape(beat, score, track), a);
    eq(CS.validateShape({ frets: a.frets, fingers: a.fingers, baseFret: a.baseFret }, 6), a, 'validating a validated shape is a no-op');
    eq(JSON.stringify([score, track, beat]), before);
  });
}

// ---------- chord diagram drawing (src/draw/chordDiagram.js) ----------
{
  const CS = await imp('src/chordShapes.js');
  const CD = await imp('src/draw/chordDiagram.js');
  const { group: svgGroup } = await imp('src/draw/svgUtil.js');
  const { resolveTheme } = await imp('src/theme.js');
  const { inkBounds } = await imp('src/layout/ink.js');
  const { estimateTextWidth } = await imp('src/textMetrics.js');
  const leaves4 = (g) => { const out = []; const v = (nd) => { if (nd.tag !== 'g') out.push(nd); nd.children.forEach(v); }; v(g); return out; };
  const of = (g, c) => leaves4(g).filter((nd) => nd.getAttribute('class') === c);
  const N = (nd, a) => Number(nd.getAttribute(a));
  const draw = (raw, opts = {}, theme = resolveTheme(), n = 6) => {
    const shape = CS.validateShape(raw, n);
    const g = svgGroup({});
    const box = CD.renderChordDiagram(g, { cx: 100, gridBottom: -20, rows: opts.rows || shape.rows, shape, name: opts.name, nameY: -80 }, theme);
    return { g, d: g.children[0], box, shape, theme };
  };
  // Default theme: 1 sp = 10 px; columns at 100 + (c - 2.5) * 10 = 75..125; grid top -20 - 4 * 12 = -68.
  test('chordDiagram: C (x32010) at the nut: grid, nut, dots, open / muted markers, fingers, centred name; box and ink', () => {
    const { g, d, box } = draw({ frets: ['x', 3, 2, 0, 1, 0], fingers: [0, 3, 2, 0, 1, 0] }, { name: 'C' });
    eq(g.children.length, 1); eq(d.getAttribute('class'), 'chord-diagram');
    const grid = d.children[0];
    eq(grid.getAttribute('class'), 'chord-diagram-grid');
    eq(grid.children.length, 6 + 4 + 1, '6 strings, 4 fret lines below the nut, the nut');
    eq(grid.children.slice(0, 6).map((l) => [N(l, 'x1'), N(l, 'y1'), N(l, 'x2'), N(l, 'y2')]), [75, 85, 95, 105, 115, 125].map((x) => [x, -68, x, -20]));
    eq(grid.children.slice(6, 10).map((l) => [N(l, 'x1'), N(l, 'y1'), N(l, 'x2')]), [-56, -44, -32, -20].map((y) => [74.5, y, 125.5]));
    eq(grid.children.slice(0, 10).map((l) => [l.getAttribute('stroke-width'), l.getAttribute('stroke-linecap')]), Array(10).fill(['1', 'butt']));
    const nut = of(d, 'chord-diagram-nut')[0];
    eq([N(nut, 'y1'), N(nut, 'y2'), N(nut, 'stroke-width'), N(nut, 'x1'), N(nut, 'x2')], [-70, -70, 4, 74.5, 125.5], 'nut bottom edge on the grid top');
    eq(of(d, 'chord-diagram-fret').map((c) => [N(c, 'cx'), N(c, 'cy'), N(c, 'r')]), [[85, -38, 4], [95, -50, 4], [115, -62, 4]]);
    eq(of(d, 'chord-diagram-open').map((c) => [N(c, 'cx'), N(c, 'cy'), N(c, 'r'), c.getAttribute('fill')]), [[105, -78, 3, 'none'], [125, -78, 3, 'none']]);
    eq(of(d, 'chord-diagram-muted').map((p) => p.getAttribute('d')), ['M 72 -81 L 78 -75 M 72 -75 L 78 -81']);
    eq(of(d, 'chord-diagram-finger').map((t) => [N(t, 'x'), N(t, 'y'), t.textContent, t.getAttribute('text-anchor'), N(t, 'font-size')]),
      [[85, -9, '3', 'middle', 10], [95, -9, '2', 'middle', 10], [115, -9, '1', 'middle', 10]]);
    const name = of(d, 'chord-symbol')[0];
    eq([N(name, 'x'), N(name, 'y'), name.getAttribute('text-anchor'), name.textContent, name.getAttribute('font-weight')], [100, -80, 'middle', 'C', 'bold']);
    eq(of(d, 'chord-diagram-barre').length + of(d, 'chord-diagram-base-fret').length, 0);
    eq(box, { x1: 71, x2: 129, top: -92 }, 'box: dots at the outer strings, name top');
    const ink = inkBounds(d, resolveTheme());
    eq([ink.top, ink.bottom], [-92, -6.5], 'ink: name top, finger text bottom (1.35 sp below the grid)');
    const m = CD.chordDiagramMetrics(CS.validateShape({ frets: ['x', 3, 2, 0, 1, 0], fingers: [0, 3, 2, 0, 1, 0] }, 6), 4, resolveTheme());
    eq([m.left, m.right, m.aboveGrid, m.gridH, m.belowGrid], [29, 29, 13.5, 48, 13.5]);
  });
  test('chordDiagram: barre F replaces covered dots; no markers; nut ink is the top', () => {
    const { d, box } = draw({ frets: [1, 3, 3, 2, 1, 1], fingers: [1, 3, 4, 2, 1, 1], barre: { fret: 1 } });
    const b = of(d, 'chord-diagram-barre');
    eq(b.map((r) => [N(r, 'x'), N(r, 'y'), N(r, 'width'), N(r, 'height'), N(r, 'rx')]), [[71, -66, 58, 8, 4]]);
    eq(of(d, 'chord-diagram-fret').map((c) => [N(c, 'cx'), N(c, 'cy')]), [[85, -38], [95, -38], [105, -50]], 'fret-1 dots under the barre skipped');
    eq(of(d, 'chord-diagram-open').length + of(d, 'chord-diagram-muted').length, 0);
    eq(of(d, 'chord-diagram-finger').map((t) => t.textContent), ['1', '3', '4', '2', '1', '1']);
    eq(box.top, -72, 'nut top');
    eq(inkBounds(d, resolveTheme()).top, -72);
  });
  test('chordDiagram: 5fr window: no nut, top fret line, "5fr" right of the first row, partial barre (strings 5..1)', () => {
    const { d, box } = draw({ frets: ['x', 5, 7, 7, 7, 5], barre: { fret: 5, from: 5 } });
    const grid = d.children[0];
    eq(of(d, 'chord-diagram-nut').length, 0);
    eq(grid.children.length, 6 + 5);
    eq(grid.children.slice(6).map((l) => N(l, 'y1')), [-68, -56, -44, -32, -20]);
    const fr = of(d, 'chord-diagram-base-fret')[0];
    eq([N(fr, 'x'), N(fr, 'y'), fr.textContent, fr.getAttribute('text-anchor'), N(fr, 'font-size')], [132, -59, '5fr', 'start', 10]);
    eq(of(d, 'chord-diagram-barre').map((r) => [N(r, 'x'), N(r, 'width'), N(r, 'y')]), [[81, 48, -66]]);
    eq(of(d, 'chord-diagram-fret').map((c) => [N(c, 'cx'), N(c, 'cy')]), [[95, -38], [105, -38], [115, -38]]);
    eq(box.x2, 100 + 29 + 3 + estimateTextWidth('5fr', 10), 'box includes "5fr"');
  });
  test('chordDiagram: rows from the caller (uniform row height), all-muted shape, 4 strings', () => {
    const { d } = draw({ frets: ['x', 3, 2, 0, 1, 0] }, { rows: 5 });
    eq(d.children[0].children.slice(6, 11).map((l) => N(l, 'y1')), [-68, -56, -44, -32, -20], '5 rows: grid top -80');
    eq(N(of(d, 'chord-diagram-nut')[0], 'y1'), -82);
    const mute = draw({ frets: ['x', 'x', 'x', 'x', 'x', 'x'] }).d;
    eq([of(mute, 'chord-diagram-muted').length, of(mute, 'chord-diagram-fret').length, of(mute, 'chord-diagram-nut').length], [6, 0, 1]);
    const bass = draw({ frets: [0, 2, 2, 1] }, {}, resolveTheme(), 4).d;
    eq(bass.children[0].children.slice(0, 4).map((l) => N(l, 'x1')), [85, 95, 105, 115]);
  });
  test('chordDiagram: scales with staffLineSpacing (20 px: every offset from the centre doubles)', () => {
    const raw = { frets: ['x', 5, 7, 7, 7, 5], fingers: [0, 1, 3, 3, 3, 1], barre: { fret: 5, from: 5 } };
    const a = draw(raw).d; const b = draw(raw, {}, resolveTheme({ staffLineSpacing: 20 })).d;
    const geo = (d, k) => leaves4(d).filter((nd) => nd.getAttribute('class') !== 'chord-symbol')
      .map((nd) => ['x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'width', 'height', 'stroke-width', 'font-size']
        .filter((at) => nd.getAttribute(at) != null).map((at) => {
          const v = N(nd, at);
          if (/^(x|x1|x2|cx)$/.test(at)) return (v - 100) * k;
          if (/^(y|y1|y2|cy)$/.test(at)) return (v + 20) * k;
          return v * k;
        }));
    const ga = geo(a, 2); const gb = geo(b, 1);
    eq(ga.length, gb.length);
    ga.forEach((row, i) => row.forEach((v, j) => { if (Math.abs(v - gb[i][j]) > 0.03) throw new Error(`leaf ${i} attr ${j}: ${v} vs ${gb[i][j]}`); }));
  });
  // chordDiagramMetrics (used by pass 6 for placement) must describe what renderChordDiagram draws:
  // every side of the metrics box contains the drawn ink (unnamed diagram) with at most 0.1 sp slack
  // (the dot radius reserved at an outer string without a dot; the ○ stroke inkBounds ignores).
  test('chordDiagram: chordDiagramMetrics box matches the drawn ink (markers / nut / Nfr / fingers / barre; 4, 6, 7 strings)', () => {
    const xExtent = (d) => {
      let x1 = Infinity; let x2 = -Infinity;
      const add = (a, b) => { x1 = Math.min(x1, a, b); x2 = Math.max(x2, a, b); };
      leaves4(d).forEach((nd) => {
        if (nd.tag === 'line') add(N(nd, 'x1'), N(nd, 'x2'));
        else if (nd.tag === 'rect') add(N(nd, 'x'), N(nd, 'x') + N(nd, 'width'));
        else if (nd.tag === 'circle') add(N(nd, 'cx') - N(nd, 'r'), N(nd, 'cx') + N(nd, 'r'));
        else if (nd.tag === 'path') { const xs = nd.getAttribute('d').match(/-?[\d.]+/g).map(Number).filter((_, i) => i % 2 === 0); add(Math.min(...xs), Math.max(...xs)); }
        else if (nd.tag === 'text') {
          const w = estimateTextWidth(nd.textContent, N(nd, 'font-size'));
          const a = nd.getAttribute('text-anchor');
          const l = N(nd, 'x') - (a === 'middle' ? w / 2 : a === 'end' ? w : 0);
          add(l, l + w);
        }
      });
      return { x1, x2 };
    };
    const cases = [
      [{ frets: ['x', 3, 2, 0, 1, 0], fingers: [0, 3, 2, 0, 1, 0] }, 6, 'C: markers, nut, fingers'],
      [{ frets: [1, 3, 3, 2, 1, 1], fingers: [1, 3, 4, 2, 1, 1], barre: { fret: 1 } }, 6, 'F: nut, barre, fingers, no markers'],
      [{ frets: [5, 7, 7, 6, 5, 5], fingers: [1, 3, 4, 2, 1, 1], barre: { fret: 5 } }, 6, 'A 5fr: Nfr, barre, fingers, no markers'],
      [{ frets: ['x', 5, 7, 7, 7, 5], barre: { fret: 5, from: 5 } }, 6, 'D 5fr: Nfr, markers, partial barre'],
      [{ frets: [3, 2, 0, 0, 0, 3] }, 6, 'G: nut, markers, no fingers'],
      [{ frets: ['x', 'x', 'x', 'x', 'x', 'x'] }, 6, 'all muted'],
      [{ frets: [0, 2, 2, 1] }, 4, '4 strings at the nut'],
      [{ frets: [7, 7, 7, 9], fingers: [1, 1, 1, 3] }, 4, '4 strings 7fr, fingers'],
      [{ frets: [0, 2, 2, 1, 0, 0, 0], fingers: [0, 2, 3, 1, 0, 0, 0] }, 7, '7 strings, markers, fingers'],
      [{ frets: [3, 5, 5, 4, 3, 3, 3], barre: { fret: 3 } }, 7, '7 strings 3fr, barre'],
    ];
    [resolveTheme(), resolveTheme({ staffLineSpacing: 20 })].forEach((theme) => {
      const s = theme.staffLineSpacing; const slack = 0.1 * s + 1e-9;
      cases.forEach(([raw, n, label]) => [0, 1].forEach((extraRows) => {
        const shape = CS.validateShape(raw, n);
        if (!shape) throw new Error(`${label}: invalid shape`);
        const rows = shape.rows + extraRows;
        const { d } = draw(raw, { rows }, theme, n);
        const m = CD.chordDiagramMetrics(shape, rows, theme);
        const ink = inkBounds(d, theme); const xe = xExtent(d);
        const gridBottom = -20; const gridTop = gridBottom - m.gridH;
        const sides = {
          left: [100 - m.left, xe.x1, -1], right: [100 + m.right, xe.x2, 1],
          top: [gridTop - m.aboveGrid, ink.top, -1], bottom: [gridBottom + m.belowGrid, ink.bottom, 1],
        };
        Object.entries(sides).forEach(([side, [box, drawn, dir]]) => {
          const over = (box - drawn) * dir; // >= 0: the box contains the ink
          if (over < -1e-9 || over > slack) throw new Error(`${label} @${s}px rows ${rows} ${side}: metrics ${box} vs ink ${drawn}`);
        });
      }));
    });
  });
}

// ---------- report ----------
export function summary() {
  let fail = 0;
  for (const r of results) {
    if (r.ok) console.log(`PASS units: ${r.name}`);
    else { fail++; console.log(`FAIL units: ${r.name}\n  ${r.msg}`); }
  }
  return fail;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const f = summary();
  console.log(f ? `\n${f} FAILED` : '\nALL PASSED');
  process.exit(f ? 1 : 0);
}
