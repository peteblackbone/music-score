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
test('pitchFromFret: without a key signature always spells with sharps, never flats', () => {
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
// Black keys on strings G3 (+3 A#), B3 (+2 C#, +11 A#4), D3 (+1 D#, +4 F#), E4 (+4 G#).
const blackKeys = (k) => [pitchFromFret('G3', 3, k), pitchFromFret('B3', 2, k), pitchFromFret('D3', 1, k), pitchFromFret('D3', 4, k), pitchFromFret('E4', 4, k)];
test('pitchFromFret: key -1 spells A# as Bb; C#, D#, F#, G# stay sharps', () => {
  eq(blackKeys(-1), ['Bb3', 'C#4', 'D#3', 'F#3', 'G#4']);
  eq(pitchFromFret('B3', 11, -1), 'Bb4');
});
test('pitchFromFret: key -2 -> Bb, Eb; key -3 -> Bb, Eb, Ab', () => {
  eq(blackKeys(-2), ['Bb3', 'C#4', 'Eb3', 'F#3', 'G#4']);
  eq(blackKeys(-3), ['Bb3', 'C#4', 'Eb3', 'F#3', 'Ab4']);
});
test('pitchFromFret: key -7 -> all five flats; B and E stay naturals (no Cb / Fb)', () => {
  eq(blackKeys(-7), ['Bb3', 'Db4', 'Eb3', 'Gb3', 'Ab4']);
  eq([pitchFromFret('B3', 0, -7), pitchFromFret('E4', 0, -7), pitchFromFret('A3', 2, -7), pitchFromFret('E4', 1, -7)], ['B3', 'E4', 'B3', 'F4']);
});
test('pitchFromFret: keys 0 and 2 unchanged (sharps); octave never changes', () => {
  eq(blackKeys(0), ['A#3', 'C#4', 'D#3', 'F#3', 'G#4']);
  eq(blackKeys(2), ['A#3', 'C#4', 'D#3', 'F#3', 'G#4']);
  eq(blackKeys(0), blackKeys(undefined));
  eq(pitchFromFret('A3', 2, -7), 'B3');
  eq(pitchFromFret('A3', 3, -7), 'C4');
  eq(pitchFromFret('B2', 0, -7), 'B2');
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
{
  // s3 f3 = A#3/Bb3, s4 f1 = D#3/Eb3, s1 f4 = G#4/Ab4 (sounding); pitch is written an octave up.
  const fb = (notes) => ({ type: 'note', duration: 'quarter', notes });
  const sp = (t) => t.measures.map((m) => m.beats.map((b) => b.notes.map((x) => x.soundingPitch)));
  test('normalizeScore: fret-derived spelling follows the effective key (track, score, mid-piece change)', () => {
    const beats = [fb([{ string: 3, fret: 3 }]), fb([{ string: 4, fret: 1 }]), fb([{ string: 1, fret: 4 }])];
    const s = normalizeScore({ keySignature: -2, tracks: [
      { keySignature: -1, measures: [{ beats }, { keySignature: -3, beats }, { beats }, { keySignature: 2, beats }] },
      { measures: [{ beats }, { keySignature: 0, beats }, { beats }, { keySignature: -7, beats }] },
    ] });
    eq(sp(s.tracks[0]), [
      [['Bb3'], ['D#3'], ['G#4']], [['Bb3'], ['Eb3'], ['Ab4']], [['Bb3'], ['Eb3'], ['Ab4']], [['A#3'], ['D#3'], ['G#4']],
    ]);
    eq(sp(s.tracks[1]), [
      [['Bb3'], ['Eb3'], ['G#4']], [['A#3'], ['D#3'], ['G#4']], [['A#3'], ['D#3'], ['G#4']], [['Bb3'], ['Eb3'], ['Ab4']],
    ]);
    eq(s.tracks[0].measures[0].beats[0].notes[0].pitch, 'Bb4');
    eq(s.tracks[0].measures[0].beats[0].notes[0].fromFret, true);
  });
  test('normalizeScore: an explicit pitch is never respelled; chords are spelled per note', () => {
    const s = normalizeScore({ tracks: [{ keySignature: -1, measures: [{ beats: [
      fb([{ string: 2, fret: 11, pitch: 'A#4' }]),
      fb([{ string: 3, fret: 3 }, { string: 2, fret: 2 }, { string: 1, fret: 6, pitch: 'A#4' }]),
    ] }] }] });
    eq(sp(s.tracks[0]), [[['A#4'], ['Bb3', 'C#4', 'A#4']]]);
    eq(s.tracks[0].measures[0].beats[1].notes.map((x) => x.pitch), ['Bb4', 'C#5', 'A#4']);
  });
}

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

// ---------- examples/lead-solo-f.js data invariants (independent arithmetic) ----------
{
  const { leadSoloF } = await imp('examples/lead-solo-f.js');
  const measures = leadSoloF.tracks[0].measures;
  const DEN = { whole: 1, half: 2, quarter: 4, '8th': 8, '16th': 16, '32nd': 32 };
  const LCM = 32 * 3 * 2; // common denominator, in units of 1/192 whole
  const units = (b) => {
    if (b.type === 'grace') return 0;
    const base = LCM / DEN[b.duration];
    let u = base, add = base;
    for (let i = 0; i < (b.dots || 0); i++) { add /= 2; u += add; }
    return b.tuplet === 3 ? (u * 2) / 3 : u;
  };
  test('lead-solo-f: JSON round-trip identical', () => {
    eq(JSON.parse(JSON.stringify(leadSoloF)), leadSoloF);
  });
  test('lead-solo-f: 12 measures, each sums to exactly one whole', () => {
    eq(measures.length, 12);
    measures.forEach((m, i) => eq(m.beats.reduce((s, b) => s + units(b), 0), LCM, `m${i + 1}`));
  });
  const notes = measures.flatMap((m) => m.beats.flatMap((b) => b.notes || []));
  test('lead-solo-f: strings 1-6 and frets 0-24', () => {
    eq(notes.length > 0, true);
    for (const n of notes) {
      eq(Number.isInteger(n.string) && n.string >= 1 && n.string <= 6, true, `string ${n.string}`);
      eq(Number.isInteger(n.fret) && n.fret >= 0 && n.fret <= 24, true, `fret ${n.fret}`);
    }
  });
  test('lead-solo-f: chord symbol order', () => {
    eq(measures.flatMap((m) => m.beats.filter((b) => b.chord).map((b) => b.chord)),
      ['F', 'F', 'G', 'Bb', 'F', 'C/E', 'Dm', 'Bb', 'Gm', 'C', 'F']);
  });
  test('lead-solo-f: tieStart/tieEnd pair on same string and fret', () => {
    const beats = measures.flatMap((m) => m.beats).filter((b) => b.notes);
    let starts = 0, ends = 0;
    beats.forEach((b, i) => b.notes.forEach((n) => {
      if (n.tieEnd) ends++;
      if (!n.tieStart) return;
      starts++;
      const next = beats.slice(i + 1).find((c) => c.notes.some((x) => x.string === n.string));
      const t = next && next.notes.find((x) => x.string === n.string);
      eq(!!t && t.fret === n.fret && t.tieEnd === true, true, `tie s${n.string} f${n.fret}`);
    }));
    eq(starts > 0 && starts === ends, true, `starts ${starts} ends ${ends}`);
  });
}

// ---------- legato and slides (1.3.0) ----------
{
  const { linkTarget } = await imp('src/directions.js');
  test('linkTarget: next item on the same string, -1 when none or no string', () => {
    const items = [{ string: 1 }, { string: 2 }, { string: 1 }, { string: null }, { string: 2 }, {}];
    eq([0, 1, 2, 3, 4, 5].map((i) => linkTarget(items, i)), [2, 4, -1, -1, -1, -1]);
  });
}

{
  const { findSlurs } = await imp('src/draw/passes/notationBeats.js');
  // Fake collectBeats items: notes [string, hammerPull], stems up unless `down`.
  const fb = (notes, { grace = false, rest = false, down = false, slurStart, slurEnd, sys = 0, tupletAbove = Infinity } = {}) => ({
    sysIdx: sys, x: 0, anchorAbove: 10, anchorBelow: 90, tupletAbove,
    el: { type: rest ? 'rest' : grace ? 'grace' : 'note', slurStart, slurEnd, notes: rest ? undefined : notes.map(([string, hammerPull]) => ({ string, hammerPull })) },
    info: { isRest: rest, isGrace: grace, stemUp: !down, noteheads: rest ? [] : [{}] },
  });
  const spans = (beats, auto = true) => findSlurs(beats, { auto }).map(({ i, j, above }) => [i, j, above]);
  test('findSlurs auto: hammerPull chain on one string merges into one span; off by default', () => {
    const beats = [fb([[1, true]]), fb([[1, 'p']]), fb([[1, true]]), fb([[1]]), fb([[1]])];
    eq(spans(beats), [[0, 3, false]]);
    eq(spans(beats, false), []);
    eq(findSlurs(beats), []);
  });
  test('findSlurs auto: chord links on two strings to the same beat merge; side from stems', () => {
    eq(spans([fb([[2, true], [3, true]], { down: true }), fb([[2], [3]], { down: true })]), [[0, 1, true]]);
    eq(spans([fb([[2, true]]), fb([[2]], { down: true })]), [[0, 1, true]]);
  });
  test('findSlurs auto: links to the next note on the same string, skipping other strings', () => {
    eq(spans([fb([[1, true]]), fb([[2]]), fb([[1]])]), [[0, 2, false]]);
    eq(spans([fb([[1, true]]), fb([[2]])]), []);
    eq(spans([fb([[null, true]]), fb([[null]])]), []);
  });
  test('findSlurs auto: grace ends drop the link; rest beats are never targets', () => {
    eq(spans([fb([[1, true]], { grace: true }), fb([[1]])]), []);
    eq(spans([fb([[1, true]]), fb([[1]], { grace: true }), fb([[1]])]), []);
    eq(spans([fb([[1, true]]), fb([], { rest: true }), fb([[1]])]), [[0, 2, false]]);
  });
  test('findSlurs auto: spans sharing a beat with an explicit slur are dropped', () => {
    const beats = [fb([[1]], { slurStart: true }), fb([[1, true]], { slurEnd: true }), fb([[1]]), fb([[2, true]]), fb([[2]])];
    eq(spans(beats), [[0, 1, false], [3, 4, false]]);
  });
  test('findSlurs: ends at anchors; an auto slur above clears tuplet brackets, explicit ones keep 1.2.0 ends', () => {
    const beats = [fb([[1, true]], { down: true, slurStart: true, tupletAbove: 4 }), fb([[1]], { down: true, slurEnd: true, tupletAbove: 4 })];
    eq(findSlurs(beats, { auto: true }).map(({ y1, y2 }) => [y1, y2]), [[10, 10]]);
    beats.forEach((b) => { b.el.slurStart = b.el.slurEnd = undefined; });
    eq(findSlurs(beats, { auto: true }).map(({ y1, y2 }) => [y1, y2]), [[4, 4]]);
    eq(findSlurs([fb([[1, true]]), fb([[1]])], { auto: true }).map(({ y1, y2 }) => [y1, y2]), [[90, 90]]);
  });
}

{
  const { slideInOf, slideOutOf, withNoteSlides, slideMarks } = await imp('src/directions.js');
  test('slideInOf / slideOutOf: canonical forms, trimmed and any case; garbage -> null; idempotent', () => {
    const ins = [true, 'up', 'below', ' Below ', 'DOWN', 'above', 'sideways', '', false, 1, null, undefined, {}];
    eq(ins.map(slideInOf), ['below', 'below', 'below', 'below', 'above', 'above', null, null, null, null, null, null, null]);
    const outs = [true, 'down', ' UP ', 'up', 'below', 'above', '', false, 0, null, {}];
    eq(outs.map(slideOutOf), ['down', 'down', 'up', 'up', null, null, null, null, null, null, null]);
    ins.forEach((v) => eq(slideInOf(slideInOf(v)), slideInOf(v), `in ${String(v)}`));
    outs.forEach((v) => eq(slideOutOf(slideOutOf(v)), slideOutOf(v), `out ${String(v)}`));
  });
  test('withNoteSlides: same object without the fields, else a canonical copy; input not mutated', () => {
    const plain = { string: 1, fret: 5 };
    eq(withNoteSlides(plain) === plain, true);
    const raw = { string: 1, fret: 5, slideIn: 'Down', slideOut: 'nope' };
    eq(withNoteSlides(raw), { string: 1, fret: 5, slideIn: 'above', slideOut: null });
    eq(raw.slideIn, 'Down');
    eq(withNoteSlides({ slideOut: true }), { slideOut: 'down' });
    eq(withNoteSlides(withNoteSlides(raw)), withNoteSlides(raw));
  });
  test('normalizeScore canonicalizes note slideIn / slideOut', () => {
    const s = normalizeScore({ tracks: [{ showTablature: true, measures: [{ beats: [
      { type: 'note', duration: 'quarter', notes: [{ string: 1, fret: 5, slideIn: 'UP', slideOut: 'x' }] }] }] }] });
    const n = s.tracks[0].measures[0].beats[0].notes[0];
    eq([n.slideIn, n.slideOut], ['below', null]);
  });
  test('slideMarks: conflicts with slides, H/P, bends and graces', () => {
    const it = (o) => ({ string: 1, ...o });
    eq(slideMarks([it({ slideIn: true, slideOut: true })]), [{ slideIn: 'below', slideOut: 'down' }]);
    // own slide with a target drops the slide-out; its target drops the slide-in
    eq(slideMarks([it({ slide: true, slideOut: 'up' }), it({ slideIn: 'down' })]), [{ slideIn: null, slideOut: null }, { slideIn: null, slideOut: null }]);
    // a slide with no target keeps the slide-out
    eq(slideMarks([it({ slide: true, slideOut: 'up' }), { string: 2, slideIn: true }]), [{ slideIn: null, slideOut: 'up' }, { slideIn: 'below', slideOut: null }]);
    eq(slideMarks([it({ hammerPull: true }), it({ slideIn: true })]), [{ slideIn: null, slideOut: null }, { slideIn: null, slideOut: null }]);
    eq(slideMarks([it({ bend: 'full', slideOut: true })]), [{ slideIn: null, slideOut: null }]);
    eq(slideMarks([it({ grace: true, slideIn: true, slideOut: true })]), [{ slideIn: null, slideOut: null }]);
    // notes without a string are never targets
    eq(slideMarks([{ string: null, slide: true }, { string: null, slideIn: true }]), [{ slideIn: null, slideOut: null }, { slideIn: 'below', slideOut: null }]);
  });
}

{
  const { bendOf } = await imp('src/directions.js');
  const { normalizeBend, bendSemitones, amountSemitones } = await imp('src/draw/tab.js');
  const { fretLabel } = await imp('src/textMetrics.js');
  const b = (type, amount, release = false, hold = false) => ({ type, amount, release, hold });
  test('bendOf: plain bends parse as before (amount, " release", " hold"), with type "bend"', () => {
    eq(bendOf(true), b('bend', 'full'));
    eq(bendOf('1/2'), b('bend', '1/2'));
    eq(bendOf(' full release '), b('bend', 'full', true));
    eq(bendOf('1 1/2 hold'), b('bend', '1 1/2', false, true));
    eq(bendOf('hold'), b('bend', 'hold'));
    eq(bendOf(''), null);
    eq(bendOf(undefined), null);
    eq(bendOf(5), b('bend', 'full'));
  });
  test('bendOf: pre-bend strings', () => {
    eq(bendOf('prebend full'), b('prebend', 'full'));
    eq(bendOf('Pre-Bend 1/2'), b('prebend', '1/2'));
    eq(bendOf('pb 1/2 release'), b('prebend', '1/2', true));
    eq(bendOf('pb'), b('prebend', 'full'));
    eq(bendOf('pb release'), b('prebend', 'full', true));
    eq(bendOf('pb full hold'), b('prebend', 'full'));
    eq(bendOf('pbx').type, 'bend');
  });
  test('bendOf: release strings (amount null when not given)', () => {
    eq(bendOf('release'), b('release', null, true));
    eq(bendOf('Release 1/2'), b('release', '1/2', true));
    eq(bendOf('releases').type, 'bend');
  });
  test('bendOf: objects (type aliases, amount as a string, release / hold flags)', () => {
    eq(bendOf({ amount: 'full', release: true }), b('bend', 'full', true));
    eq(bendOf({ amount: '1/2', hold: true }), b('bend', '1/2', false, true));
    eq(bendOf({ release: true, hold: true }), b('bend', 'full', true));
    eq(bendOf({ type: ' PB ', amount: '1/2' }), b('prebend', '1/2'));
    eq(bendOf({ type: 'pre-bend', release: true }), b('prebend', 'full', true));
    eq(bendOf({ type: 'prebend', hold: true }), b('prebend', 'full'));
    eq(bendOf({ type: 'release' }), b('release', null, true));
    eq(bendOf({ type: 'release', amount: 'full' }), b('release', 'full', true));
    eq(bendOf({ type: 'nope', amount: 1 }), b('bend', '1'));
    eq(bendOf({ amount: 1 }).amount, '1');
  });
  test('bendOf suffix scan: release / hold in any case, any whitespace; only a whole trailing word counts', () => {
    eq(bendOf('Full RELEASE'), b('bend', 'Full', true));
    eq(bendOf('1/2 hold'), b('bend', '1/2', false, true));
    eq(bendOf('full	release'), b('bend', 'full', true));
    eq(bendOf('1 1/2   HOLD  '), b('bend', '1 1/2', false, true));
    eq(bendOf('fullrelease'), b('bend', 'fullrelease'));
    eq(bendOf('full releases'), b('bend', 'full releases'));
    eq(bendOf('release hold'), b('release', 'hold', true));
    eq(bendOf('pre-bend 1 hold'), b('prebend', '1'));
    eq(bendOf('PB 1 RELEASE'), b('prebend', '1', true));
    eq(bendOf('pb hold'), b('prebend', 'full'));
    eq(bendOf('prebend release'), b('prebend', 'full', true));
    eq(bendOf('   '), b('bend', 'full'));
  });
  test('bendOf suffix scan: very long whitespace runs parse fast and correctly (no quadratic backtracking)', () => {
    const ok = (c, m) => { if (!c) throw new Error(m); };
    const gap = ' '.repeat(100000);
    const t0 = Date.now();
    eq(bendOf(`full${gap}release`), b('bend', 'full', true));
    eq(bendOf(`pb${gap}1/2${gap}hold`), b('prebend', '1/2'));
    eq(bendOf(`full${gap}x`), b('bend', `full${gap}x`));
    eq(bendOf(`${gap}hold${gap}`), b('bend', 'hold'));
    eq(bendOf(gap + 'a'.repeat(1000) + gap + '!'), b('bend', 'a'.repeat(1000) + gap + '!'));
    ok(Date.now() - t0 < 1000, `took ${Date.now() - t0} ms`);
  });
  test('bendOf: deterministic and leaves object / string input untouched', () => {
    const o = { type: ' PB ', amount: 1, release: true, hold: true };
    const copy = JSON.stringify(o);
    eq(bendOf(o), bendOf(o));
    eq(JSON.stringify(o), copy);
    eq(bendOf(o) === bendOf(o), false);
  });
  test('normalizeBend delegates to bendOf', () => {
    ['full', 'pb 1/2 release', 'release', { type: 'release', amount: 'full' }, true].forEach((v) => eq(normalizeBend(v), bendOf(v)));
  });
  test('bendSemitones: as before for readable amounts; infinite / NaN -> 2 (amountSemitones keeps the raw parse)', () => {
    eq(['full', '1/2', '1 1/2', '2', '1/4', 'what'].map(bendSemitones), [2, 1, 3, 4, 0.5, 2]);
    eq(bendSemitones('1/0'), 2);
    eq(Number.isFinite(bendSemitones('0/0')), true);
    eq(Number.isFinite(bendSemitones('0 0/0')), true);
    eq(bendSemitones(null), 2);
    eq(amountSemitones('1/0'), Infinity);
  });
  test('fretLabel: a release note is in parentheses (once with ghost); mute stays x', () => {
    eq(fretLabel({ fret: 7, bend: 'release' }), '(7)');
    eq(fretLabel({ fret: 7, bend: { type: 'release' } }), '(7)');
    eq(fretLabel({ fret: 7, bend: 'release', ghost: true }), '(7)');
    eq(fretLabel({ fret: 7, bend: 'full release' }), '7');
    eq(fretLabel({ fret: 7, bend: 'pb full' }), '7');
    eq(fretLabel({ fret: 7, mute: true, bend: 'release' }), 'x');
  });
}

// ---------- 1.3.1 characterization (C0): grace accidentals, release geometry, lead-solo-f spelling ----------
{
  const { computeLayout } = await imp('src/layout/index.js');
  const { resolveMeasureAccidentals } = await imp('src/layout/accidentals.js');
  const { graceAccidentalRoom } = await imp('src/layout/chord.js');
  const { glyphBox } = await imp('src/glyphMetrics.js');
  const { accidentalGlyph } = await imp('src/glyphs.js');
  const { bendGeometry, normalizeBend } = await imp('src/draw/tab.js');
  const { resolveTheme } = await imp('src/theme.js');
  const thm = resolveTheme({});
  const gr = (p) => ({ type: 'grace', duration: '16th', notes: [{ pitch: p }] });
  const nt = (p) => ({ type: 'note', duration: 'quarter', notes: [{ pitch: p }] });

  // (a)(b) 1.3.1: grace notes take part in the measure's accidental memory, in score order (were ignored before).
  const accOf = (beats, key = 0) => resolveMeasureAccidentals(normalizeScore({ tracks: [{ keySignature: key, measures: [{ beats }] }] }).tracks[0], 0);
  test('grace accidentals: resolveMeasureAccidentals carries graces into the main notes after them', () => {
    eq(accOf([gr('C#5'), nt('C#5'), gr('D#5'), nt('D5')]), [
      { names: ['sharp'], restate: ['sharp'] },
      { names: [null], restate: [null] },
      { names: ['sharp'], restate: ['sharp'] },
      { names: ['natural'], restate: ['natural'] },
    ]);
  });
  test('grace accidentals: a rendered grace C#5 draws a sharp glyph', () => {
    const svg = serialize(renderTree({ tracks: [{ measures: [{ beats: [gr('C#5'), nt('D5'), nt('D5'), nt('D5'), nt('D5')] }] }] }));
    eq((svg.match(/\uE262/g) || []).length, 1);
  });
  test('grace accidentals: main -> grace carry and a cancelling natural on a grace', () => {
    eq(accOf([nt('F#4'), gr('F#4'), gr('F4'), nt('F4')]).map((a) => a.names), [['sharp'], [null], ['natural'], [null]]);
    eq(accOf([nt('F#4'), gr('F4'), nt('F#4'), nt('F#4')]).map((a) => a.names), [['sharp'], ['natural'], ['sharp'], [null]]);
  });
  test('grace accidentals: an explicit accidental is drawn; a key-signature flat on a grace draws nothing', () => {
    eq(accOf([gr('F4'), { ...gr('F4'), notes: [{ pitch: 'F4', accidental: 'natural' }] }, nt('F4'), nt('F4')]).map((a) => a.names),
      [[null], ['natural'], [null], [null]]);
    eq(accOf([gr('Bb4'), nt('Bb4'), gr('B4'), nt('B4')], -1).map((a) => a.names), [[null], [null], ['natural'], [null]]);
    eq(accOf([{ type: 'grace', duration: '16th', notes: [{ pitch: 'E4' }, { pitch: 'G#4' }] }, nt('G#4')]).map((a) => a.names), [[null, 'sharp'], [null]]);
    const svg = serialize(renderTree({ tracks: [{ keySignature: -1, measures: [{ beats: [gr('Bb4'), nt('A4'), nt('A4'), nt('A4'), nt('A4')] }] }] }));
    eq((svg.match(/\uE260/g) || []).length, 1, 'only the key signature flat');
  });
  test('graceAccidentalRoom: 0 without accidentals; else one column (0.25 sp + widest glyph, grace scale) + stem-up flag clearance; stem down clears the slash', () => {
    eq([graceAccidentalRoom(null, thm), graceAccidentalRoom([], thm), graceAccidentalRoom([null, null], thm)], [0, 0, 0]);
    const sc = thm.graceNoteScale; const sp = thm.staffLineSpacing;
    const headW = glyphBox(Glyph.noteheadBlack).width;
    // a stem-up grace one slot left: its flag reaches 0.4 sp (stem) + the flag's width; keep 0.25 sp (scaled) clear of it
    const flagClear = Math.max(0, 0.4 + glyphBox(Glyph.flag8thUp).right * sc + 0.25 * sc - (thm.graceNoteWidthSp - (headW / 2) * sc));
    const sharp = graceAccidentalRoom(['sharp'], thm);
    eq(Math.abs(sharp - ((0.25 + glyphBox(accidentalGlyph('sharp')).width) * sc + flagClear) * sp) < 1e-9, true);
    eq(graceAccidentalRoom(['flat', null, 'sharp'], thm), Math.max(graceAccidentalRoom(['flat'], thm), sharp));
    // stem down: the accidental's right edge is 0.25 sp (scaled) left of the slash end, 0.4 + 0.5 sp left of the head centre
    const down = graceAccidentalRoom(['sharp'], thm, false);
    eq(Math.abs(down - ((0.9 + 0.25 * sc + glyphBox(accidentalGlyph('sharp')).width * sc - (headW / 2) * sc) + flagClear) * sp) < 1e-9, true);
  });

  // (c) neutrality: graces without accidentals keep their layout x (must stay true after 1.3.1).
  const graceBeats = () => [gr('E4'), gr('F4'), nt('G4'), nt('A4'), gr('B4'), nt('C5'), nt('D5')];
  const elementXs = (score) => {
    const m = computeLayout(normalizeScore(score), thm, 900).systems[0].tracks[0].measures[0];
    return m.elements.map((e) => [e.index, e.x, e.width, e.t]);
  };
  test('grace layout neutrality: notation track, two graces before a note and one trailing grace', () => {
    eq(elementXs({ tracks: [{ measures: [{ beats: graceBeats() }] }] }), [
      [0, 113.852, 12, null], [1, 125.852, 12, null], [2, 143.752, 35, { n: 0, d: 1 }], [3, 178.752, 35, { n: 1, d: 4 }],
      [4, 195.852, 12, null], [5, 213.752, 35, { n: 1, d: 2 }], [6, 248.752, 30, { n: 3, d: 4 }],
    ]);
  });
  test('grace layout neutrality: tab-only track, two graces before a note and one trailing grace', () => {
    eq(elementXs({ tracks: [{ showStandardNotation: false, showTablature: true, measures: [{ beats: graceBeats() }] }] }), [
      [0, 102.70430769230768, 12, null], [1, 114.70430769230768, 12, null], [2, 126.70430769230768, 35, { n: 0, d: 1 }],
      [3, 161.70430769230768, 35, { n: 1, d: 4 }], [4, 184.70430769230768, 12, null], [5, 196.70430769230768, 35, { n: 1, d: 2 }],
      [6, 231.70430769230768, 30, { n: 3, d: 4 }],
    ]);
  });
  test('grace layout: a grace accidental moves only the graces farther from the note, and the onset', () => {
    const plain = elementXs({ tracks: [{ measures: [{ beats: [gr('E4'), gr('F4'), nt('G4'), nt('A4'), nt('B4'), nt('C5')] }] }] });
    const acc = elementXs({ tracks: [{ measures: [{ beats: [gr('E4'), gr('F#4'), nt('G4'), nt('A4'), nt('B4'), nt('C5')] }] }] });
    const room = graceAccidentalRoom(['sharp'], thm);
    const d = acc.map((e, i) => e[1] - plain[i][1]);
    // the onset moves right by the room; grace k=0 (F#4) stays at the same distance from it; grace k=1 moves left by the room
    eq(Math.abs(d[2] - room) < 1e-9, true, 'onset');
    eq(Math.abs(d[1] - room) < 1e-9, true, 'nearest grace');
    eq(Math.abs(d[0]) < 1e-9, true, 'farther grace');
  });

  // bendGeometry pins for release arrows (as tabLinks feeds it: a missing release amount becomes 'full').
  const relGeom = (raw, nextX) => {
    const b = normalizeBend(raw);
    if (b.amount == null) b.amount = 'full';
    b.heightFrac = 1;
    const g = bendGeometry(100, 50, b, thm, nextX);
    return { endX: g.endX, releaseCtrl: g.releaseCtrl, boxes: g.boxes };
  };
  const lbl = (x1, x2) => ({ x1, x2, top: 0, bottom: 13, text: true });
  const fall = (x1, x2) => ({ x1, x2, top: 14, bottom: 41.55, text: false });
  const ctrl = (x, y = 16.7) => ({ x, y });
  test('bendGeometry pin: {type:"release"} at nextX = x+25, x+40, undefined', () => {
    eq(relGeom({ type: 'release' }, 125), { endX: 125, releaseCtrl: ctrl(110), boxes: [fall(100, 129), lbl(86.6, 114.39999999999999)] });
    eq(relGeom({ type: 'release' }, 140), { endX: 137, releaseCtrl: ctrl(114.8), boxes: [fall(100, 141), lbl(86.6, 114.39999999999999)] });
    eq(relGeom({ type: 'release' }, undefined), { endX: 131, releaseCtrl: ctrl(112.4), boxes: [fall(100, 135), lbl(86.6, 114.39999999999999)] });
  });
  test('bendGeometry pin: "full release" at nextX = x+25, x+40, undefined', () => {
    const rise = (x2) => ({ x1: 102.45, x2, top: 14, bottom: 41.55, text: false });
    eq(relGeom('full release', 125), { endX: 125, releaseCtrl: ctrl(118.4), boxes: [rise(116.4), fall(114, 129), lbl(100.6, 128.4)] });
    eq(relGeom('full release', 140), { endX: 137, releaseCtrl: ctrl(126.2), boxes: [rise(121.4), fall(119, 141), lbl(105.6, 133.4)] });
    eq(relGeom('full release', undefined), { endX: 131, releaseCtrl: ctrl(122.6), boxes: [rise(119.4), fall(117, 135), lbl(103.6, 131.4)] });
  });

  // 1.3.1 release-arrow cap: obstacles = fret knock-outs of later notes (bendGeometry's 7th argument).
  const { RELEASE_CLEAR_SP, RELEASE_MIN_FALL_SP } = await imp('src/draw/tab.js');
  const { tabFretKnockoutHalf } = await imp('src/layout/tabRhythm.js');
  const { fretLabelWidth: flw } = await imp('src/textMetrics.js');
  const SP = thm.staffLineSpacing;
  // knock-out of fret label `label` at x, `strings` strings above (negative = below) the bent note at y = 50
  const knock = (x, strings = 1, label = '8') => {
    const w = flw(label, thm); const y = 50 - strings * thm.tabStaffLineSpacing; const kh = tabFretKnockoutHalf(thm);
    return { x1: x - w / 2, x2: x + w / 2, top: y - kh, bottom: y + kh };
  };
  const geomObs = (raw, nextX, obstacles) => {
    const b = normalizeBend(raw);
    if (b.amount == null) b.amount = 'full';
    b.heightFrac = 1;
    const g = bendGeometry(100, 50, b, thm, nextX, null, obstacles);
    return { endX: g.endX, releaseCtrl: g.releaseCtrl, boxes: g.boxes, arrow: g.arrow, peakX: g.peakX, peakY: g.peakY, riseH: g.riseH };
  };
  test('release cap: a knock-out on the string above caps the arrow RELEASE_CLEAR_SP before it; releaseCtrl and the fall box follow', () => {
    eq([RELEASE_CLEAR_SP, RELEASE_MIN_FALL_SP], [0.2, 0.6]);
    ['full release', { type: 'release' }].forEach((raw) => {
      const free = geomObs(raw, 140);
      const o = knock(140);
      const g = geomObs(raw, 140, [o]);
      eq(g.endX < free.endX, true, 'capped');
      eq(g.endX + g.arrow <= o.x1 - RELEASE_CLEAR_SP * SP + 1e-9, true, 'clear of the knock-out');
      eq(Math.abs(g.endX + g.arrow - (o.x1 - RELEASE_CLEAR_SP * SP)) < 1e-9, true, 'exactly at the clearance');
      eq(g.releaseCtrl, { x: g.peakX + (g.endX - g.peakX) * 0.4, y: g.peakY + g.riseH * 0.1 });
      const fallBox = g.boxes.find((b) => !b.text && b.x1 === g.peakX);
      eq(fallBox.x2, g.endX + g.arrow);
      eq(g.boxes.filter((b) => b.text), free.boxes.filter((b) => b.text), 'labels unchanged');
    });
  });
  test('release cap: never closer than RELEASE_MIN_FALL_SP to the peak; never right of the uncapped end', () => {
    ['full release', { type: 'release' }].forEach((raw) => {
      const g = geomObs(raw, 140, [knock(geomObs(raw, 140).peakX + 2)]);
      eq(Math.abs(g.endX - (g.peakX + RELEASE_MIN_FALL_SP * SP)) < 1e-9, true, 'floor');
      [125, 140, undefined].forEach((nx) => {
        const free = geomObs(raw, nx);
        [100, 120, 130, 140, 150, 200].forEach((ox) => eq(geomObs(raw, nx, [knock(ox)]).endX <= free.endX, true, `nextX ${nx}, obstacle ${ox}`));
        eq(geomObs(raw, nx, [knock(400)]), free, 'far obstacle: unchanged');
      });
    });
  });
  test('release cap: same-string, lower-string and two-up obstacles leave the C0 pins unchanged', () => {
    const pick = (g) => ({ endX: g.endX, releaseCtrl: g.releaseCtrl, boxes: g.boxes });
    ['full release', { type: 'release' }].forEach((raw) => [125, 140, undefined].forEach((nx) => {
      const pin = relGeom(raw, nx);
      [0, -1, 2].forEach((strings) => [110, 125, 140].forEach((ox) => {
        eq(pick(geomObs(raw, nx, [knock(ox, strings), knock(ox, strings, '(12)')])), pin, `strings ${strings} x ${ox}`);
      }));
    }));
  });
  test('release cap: plain bends, pre-bends and holds ignore obstacles', () => {
    ['full', '1/2', 'full hold', 'pb full'].forEach((raw) => [125, 140, undefined].forEach((nx) => {
      eq(geomObs(raw, nx, [knock(nx ?? 130), knock(115)]), geomObs(raw, nx), `${raw} nextX ${nx}`);
    }));
  });
  test('release cap: a note on the string above in the same beat is not an obstacle (rendered)', () => {
    // [s2 full release + s1 f8] vs [s2 full release + s3 f8]: same layout, same release path.
    const sc = (other) => ({ tracks: [{ showStandardNotation: false, showTablature: true, measures: [{ beats: [
      { type: 'note', duration: 'quarter', notes: [{ string: 2, fret: 7, bend: 'full release' }, { string: other, fret: 8 }] },
      { type: 'note', duration: 'quarter', notes: [{ string: 3, fret: 7 }] },
      { type: 'rest', duration: 'quarter' }, { type: 'rest', duration: 'quarter' },
    ] }] }] });
    const fallOf = (svg) => /<g class="bend">[\s\S]*?<\/g>/.exec(svg)[0];
    eq(fallOf(serialize(renderTree(sc(1)))), fallOf(serialize(renderTree(sc(3)))));
  });

  // lead-solo-f spelling neutrality: [pitch, soundingPitch] per note in score order.
  const { leadSoloF } = await imp('examples/lead-solo-f.js');
  const { createHash } = await import('node:crypto');
  test('lead-solo-f neutrality: normalizeScore [pitch, soundingPitch] per note in score order (90 notes)', () => {
    const pairs = [];
    normalizeScore(leadSoloF).tracks.forEach((t) => t.measures.forEach((m) => m.beats.forEach((b) => (b.notes || []).forEach((x) => pairs.push([x.pitch ?? null, x.soundingPitch ?? null])))));
    eq(pairs.length, 90);
    eq(pairs.slice(0, 3), [['F4', 'F3'], ['G4', 'G3'], ['A4', 'A3']]);
    eq(createHash('sha256').update(JSON.stringify(pairs)).digest('hex'), 'c5b61162084a82775017c502f66bf655794b14dc9ff67eb97989c9a91e3434ac');
  });
  test('lead-solo-f: its 10 s2 f11 notes render byte-identical with an explicit pitch "Bb4" (key-aware spelling)', () => {
    const copy = JSON.parse(JSON.stringify(leadSoloF));
    let n = 0;
    copy.tracks[0].measures.forEach((m) => m.beats.forEach((b) => (b.notes || []).forEach((x) => {
      eq(x.pitch, undefined);
      if (x.string === 2 && x.fret === 11) { x.pitch = 'Bb4'; n++; }
    })));
    eq(n, 10);
    eq(serialize(renderTree(copy)), serialize(renderTree(leadSoloF)));
  });
}

// ---------- pre-1.4 characterization (C0): pins taken from the code before two-voice measures ----------
{
  const { createHash } = await import('node:crypto');
  // the 52 pre-1.4 cases (the 1.4.0 two-voice fixtures char-voices-*, the 1.5.0 char-note-effects-*, the 1.6.0
  // char-score-text-* and the 1.7.0 char-ornaments-* came later)
  const isVoices = (id) => id.startsWith('char-voices-');
  const isPost14 = (id) => /^char-(voices|note-effects|score-text|ornaments)-/.test(id);
  const cases = (await import('./cases.mjs')).cases.filter((c) => !isPost14(c.id));
  const { computeLayout } = await imp('src/layout/index.js');
  const { resolveMeasureAccidentals } = await imp('src/layout/accidentals.js');
  const { flattenRuns } = await imp('src/draw/passes/common.js');
  const theme = resolveTheme();
  const sha = (s) => createHash('sha256').update(s).digest('hex');

  // Model guard: normalizeScore and computeLayout output of every snapshot case, recorded once from
  // the pre-1.4 code (tests/fixtures/pre-1.4-model-hashes.json). Never re-record.
  const model = JSON.parse(fs.readFileSync(path.join(root0, 'tests/fixtures/pre-1.4-model-hashes.json'), 'utf8'));
  test('pre-1.4 model hashes: fixture covers exactly the 52 snapshot cases', () => {
    eq(cases.length, 52);
    eq(Object.keys(model), cases.map((c) => c.id));
  });
  test('pre-1.4 model hashes: normalizeScore and computeLayout JSON are unchanged for every snapshot case', () => {
    const bad = [];
    for (const c of cases) {
      const norm = normalizeScore(JSON.parse(JSON.stringify(c.score)));
      const nh = sha(JSON.stringify(norm));
      const lh = sha(JSON.stringify(computeLayout(norm, resolveTheme(c.options?.theme), c.width)));
      if (nh !== model[c.id].model) bad.push(`${c.id} normalize`);
      if (lh !== model[c.id].layout) bad.push(`${c.id} layout`);
    }
    eq(bad, []);
  });
  test('no pre-1.4 snapshot SVG contains "voice-2"; every two-voice fixture snapshot does', () => {
    const dir = path.join(root0, 'tests/snapshots');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.svg'));
    const old = files.filter((f) => !isPost14(f));
    eq(old.length, 52);
    eq(old.filter((f) => fs.readFileSync(path.join(dir, f), 'utf8').includes('voice-2')), []);
    eq(files.filter((f) => isVoices(f) && !fs.readFileSync(path.join(dir, f), 'utf8').includes('voice-2')), []);
  });

  // resolveMeasureAccidentals
  const pn = (pitch, x = {}) => ({ pitch, ...x });
  const nb = (pitches, duration = 'quarter') => ({ type: 'note', duration, notes: pitches.map((p) => (typeof p === 'string' ? pn(p) : p)) });
  const accOf = (key, beats) => resolveMeasureAccidentals({ measures: [{ keySignature: key, beats }] }, 0);
  const names = (key, beats) => accOf(key, beats).map((r) => r.names.join('|'));
  const restate = (key, beats) => accOf(key, beats).map((r) => r.restate.join('|'));
  test('resolveMeasureAccidentals: accidental carries, cancelling natural on the same step+octave, other octave is fresh', () => {
    eq(accOf(0, [nb(['F#4']), nb(['F4']), nb(['F4']), nb(['F#5'])]), [
      { names: ['sharp'], restate: ['sharp'] }, { names: ['natural'], restate: ['natural'] },
      { names: [null], restate: [null] }, { names: ['sharp'], restate: ['sharp'] }]);
  });
  test('resolveMeasureAccidentals: tieEnd draws nothing, changes nothing, restates its key-relative accidental', () => {
    eq(accOf(0, [nb(['F#4']), nb([pn('F#4', { tieEnd: true })]), nb([pn('Bb4', { tieEnd: true })]), nb(['Bb4'])]), [
      { names: ['sharp'], restate: ['sharp'] }, { names: [null], restate: ['sharp'] },
      { names: [null], restate: ['flat'] }, { names: ['flat'], restate: ['flat'] }]);
  });
  test('resolveMeasureAccidentals: explicit accidental is always drawn and becomes the active alteration', () => {
    eq(names(0, [nb([pn('C4', { accidental: 'natural' })]), nb([pn('C4', { accidental: 'natural' })]), nb(['C4'])]), ['natural', 'natural', '']);
  });
  test('resolveMeasureAccidentals: grace and main notes carry into each other in score order', () => {
    eq(names(0, [{ type: 'grace', duration: '16th', notes: [pn('G#4')] }, nb(['G#4']), nb(['G4']), { type: 'grace', duration: '16th', notes: [pn('G4')] }, nb(['G4'])]),
      ['sharp', '', 'natural', '', '']);
  });
  test('resolveMeasureAccidentals: key -2 versus +3 and rests / chords', () => {
    eq(names(-2, [nb(['Bb4']), nb(['B4']), nb(['Eb4']), nb(['E4']), nb(['A4']), nb(['Ab4'])]), ['', 'natural', '', 'natural', '', 'flat']);
    eq(names(3, [nb(['F#4']), nb(['F4']), nb(['C#5']), nb(['G#4']), nb(['D4']), nb(['G4'])]), ['', 'natural', '', '', '', 'natural']);
    eq(restate(0, [{ type: 'rest', duration: 'quarter' }, nb(['C4', 'C#4'])]), ['', '|sharp']);
  });

  // layoutChord accidental dx (px at the default 10 px staff space)
  const cbase = { headGlyph: String.fromCodePoint(0xE0A4), duration: 'quarter' };
  const accDx = (c) => c.accidentals.map((a) => +a.dx.toFixed(3));
  test('layoutChord: accidental dx for a 5-accidental cluster (seconds) and a spread chord', () => {
    const cl = layoutChord([{}, {}, {}, {}, {}], [0, 1, 2, 3, 4], true, Array(5).fill('sharp'), cbase, theme);
    eq(accDx(cl), [-29.36, -51.36, -62.36, -40.36, -18.36]);
    eq(cl.heads.map((h) => +h.dx.toFixed(3)), [0, 11.8, 0, 11.8, 0]);
    eq([+cl.leftExt.toFixed(3), +cl.rightExt.toFixed(3)], [62.36, 17.7]);
    const sp = layoutChord([{}, {}, {}, {}, {}], [0, 2, 4, 6, 8], true, ['sharp', 'flat', 'natural', 'sharp', 'flat'], cbase, theme);
    eq(accDx(sp), [-18.36, -39.44, -48.12, -29.36, -17.44]);
  });
  test('layoutChord: stem-down chord with a second keeps its accidental left of the displaced head', () => {
    const c = layoutChord([{}, {}, {}], [3, 4, 8], false, [null, 'sharp', null], cbase, theme);
    eq(accDx(c), [-30.16]);
    eq(c.heads.map((h) => +h.dx.toFixed(3)), [-11.8, 0, 0]);
    eq(+c.stemDx.toFixed(3), -5.9);
  });
  test('layoutChord: a ghost note pushes accidentals left of its parenthesis', () => {
    const c = layoutChord([{ ghost: true }, {}], [2, 5], true, ['flat', 'sharp'], cbase, theme);
    eq(accDx(c), [-35.74, -25.66]);
    eq([+c.leftExt.toFixed(3), +c.rightExt.toFixed(3)], [35.74, 13.2]);
  });

  // stems, element index and x per onset, via computeLayout
  const lay = (measures) => computeLayout(normalizeScore({ tracks: [{ name: 'T', showStandardNotation: true, measures }] }), theme, 900);
  const rows = (m) => m.elements.map((e) => [e.index, +e.x.toFixed(2), e.t ? `${e.t.n}/${e.t.d}` : null, e.chord ? e.chord.stemUp : null]);
  test('computeLayout stems: beam groups, single notes above / below the middle line, whole note', () => {
    const l = lay([
      { beats: [nb(['A4'], '8th'), nb(['C5'], '8th'), nb(['E5'], '8th'), nb(['G5'], '8th'), nb(['C4'], '8th'), nb(['E4'], '8th'), nb(['F4'], '8th'), nb(['F5'], '8th')] },
      { beats: [nb(['C4']), nb(['B4']), nb(['C6']), nb(['D4', 'F5'])] },
      { beats: [nb(['G4'], 'whole')] },
      { beats: [nb(['C5'], 'half'), nb(['C4'], 'half')] },
    ]);
    eq(l.systems.length, 1);
    const ms = l.systems[0].tracks[0].measures;
    eq(ms[0].beamGroups, [[0, 1], [2, 3], [4, 5], [6, 7]]);
    eq(ms[0].elements.map((e) => e.chord.stemUp), [false, false, false, false, true, true, false, false]);
    eq(ms[1].elements.map((e) => e.chord.stemUp), [true, false, false, true]);
    eq(ms[2].elements.map((e) => e.chord.stemUp), [true]);
    eq(ms[3].elements.map((e) => e.chord.stemUp), [false, true]);
  });
  test('computeLayout: element index equals beat index and x follows onsets (rests, graces, chords, second measure)', () => {
    const l = lay([
      { beats: [nb(['C4']), { type: 'rest', duration: 'quarter' }, { type: 'grace', duration: '16th', notes: [pn('D5')] }, nb(['E4', 'G4']), nb(['C5'])] },
      { beats: [nb(['G4'], 'whole')] },
    ]);
    const ms = l.systems[0].tracks[0].measures;
    eq(rows(ms[0]), [[0, 133.9, '0/1', true], [1, 168.9, '1/4', null], [2, 186, null, null], [3, 203.9, '1/2', true], [4, 238.9, '3/4', false]]);
    eq(rows(ms[1]), [[0, 289.84, '0/1', true]]);
    eq(ms.map((m) => [m.x, m.contentX, m.endX]), [[115.5, 115.5, 268.9], [268.9, 268.9, 354.84]]);
  });

  // flattenRuns order on a 2-system fake
  test("flattenRuns: visits only the track's runs, system by system, measure by measure, element by element", () => {
    const els = (p, n) => Array.from({ length: n }, (_, i) => ({ id: `${p}${i}` }));
    const runs = [
      { track: 'A', measures: [{ elements: els('s1m1e', 2) }, { elements: els('s1m2e', 1) }] },
      { track: 'B', measures: [{ elements: els('bs1m1e', 1) }] },
      { track: 'A', measures: [{ elements: [{ id: 'grace' }, { id: 'main' }] }, { elements: [] }, { elements: els('s2m3e', 1) }] },
    ];
    const seen = [];
    flattenRuns(runs, 'A', (le, run) => seen.push([le.id, runs.indexOf(run)]));
    eq(seen, [['s1m1e0', 0], ['s1m1e1', 0], ['s1m2e0', 0], ['grace', 2], ['main', 2], ['s2m3e0', 2]]);
  });

  // groupBeams / tupletGroups: leading rest and grace before a beamed pair
  test('groupBeams / tupletGroups: a leading 8th rest and a grace before 8ths pair', () => {
    const r8 = { type: 'rest', duration: '8th' };
    const g16 = { type: 'grace', duration: '16th', notes: [pn('D4')] };
    const e8 = nb(['E4'], '8th');
    const qn = nb(['E4']);
    const bs = [r8, g16, e8, e8, qn, qn, qn];
    eq(groupBeams(bs, T44), [[2], [3]]);
    eq(tupletGroups(bs, T44), []);
    const t3 = { ...e8, tuplet: { actual: 3, normal: 2 } };
    const bt = [r8, g16, t3, t3, t3, qn, qn, qn];
    eq(groupBeams(bt, T44), [[2, 3], [4]]);
    eq(tupletGroups(bt, T44), [{ indices: [2, 3, 4], count: 3 }]);
  });
}

// ---------- two-voice measures (1.4.0): normalize ----------
{
  const { deepStrictEqual } = await import('node:assert');
  const { isHiddenRest } = await imp('src/duration.js');
  const q = (pitch) => ({ type: 'note', duration: 'quarter', notes: [{ pitch }] });
  const hid = (duration = 'half') => ({ type: 'rest', duration, hidden: true });
  const norm1 = (m, track = {}) => normalizeScore({ tracks: [{ ...track, measures: [m] }] }).tracks[0];
  const m0 = (m, track) => norm1(m, track).measures[0];
  const v1 = [q('C5'), q('D5'), q('E5'), q('F5')];
  const v2 = [{ type: 'note', duration: 'whole', notes: [{ pitch: 'C4' }] }];

  test('isHiddenRest: only rests with a truthy hidden flag', () => {
    eq([hid(), { type: 'rest', duration: 'half' }, { type: 'note', duration: 'half', hidden: true, notes: [] }, { type: 'rest', hidden: 1 }].map(isHiddenRest),
      [true, false, false, true]);
  });
  test('normalize voices: one entry is the same measure as `beats` (deep-equal, same SVG)', () => {
    deepStrictEqual(m0({ voices: [{ beats: v1 }] }), m0({ beats: v1 }));
    eq(serialize(renderTree({ tracks: [{ measures: [{ voices: [{ beats: v1 }] }] }] })), serialize(renderTree({ tracks: [{ measures: [{ beats: v1 }] }] })));
  });
  test('normalize voices: non-array or empty `voices` falls back to `beats` (key kept, no voice2Beats)', () => {
    [{}, [], 'x', null].forEach((voices) => {
      const m = m0({ voices, beats: v1 });
      eq(m.beats.map((b) => b.notes[0].pitch), ['C5', 'D5', 'E5', 'F5']);
      eq('voice2Beats' in m, false);
      eq(m.voices, voices);
    });
  });
  test('normalize voices: two entries -> beats + voice2Beats, raw voices dropped; entries after the second ignored', () => {
    const m = m0({ voices: [{ beats: v1 }, { beats: v2 }, { beats: [q('A4')] }], beats: [q('G4')] });
    eq(m.beats.map((b) => b.notes[0].pitch), ['C5', 'D5', 'E5', 'F5']);
    eq(m.voice2Beats.map((b) => b.notes[0].pitch), ['C4']);
    eq('voices' in m, false);
    eq(Object.keys(m).at(-1), 'voice2Beats');
    eq(Object.keys(m0({ voices: [{ beats: v1 }, { beats: v2 }] })).slice(-2), ['beats', 'voice2Beats']);
  });
  test('normalize voices: voice 2 missing, empty or only hidden rests -> single-voice measure', () => {
    [[{ beats: v1 }, {}], [{ beats: v1 }, { beats: [] }], [{ beats: v1 }, { beats: [hid(), hid()] }], [{ beats: v1 }, null]].forEach((voices) => {
      eq('voice2Beats' in m0({ voices }), false);
    });
    eq(m0({ voices: [{ beats: v1 }, { beats: [hid(), q('C4')] }] }).voice2Beats.length, 2);
  });
  test('normalize voices: voice 2 is normalized like voice 1 (fret -> written pitch in the key, octave clef, dots clamped)', () => {
    const t = norm1({ keySignature: -1, voices: [{ beats: [q('C5')] }, { beats: [{ type: 'note', duration: 'quarter', dots: '9', notes: [{ string: 3, fret: 3 }] }] }] });
    const b = t.measures[0].voice2Beats[0];
    eq([b.dots, b.notes[0].pitch, b.notes[0].soundingPitch, b.notes[0].fromFret], [4, 'Bb4', 'Bb3', true]);
    eq(t.octaveClef, true);
    eq(m0({ voices: [{ beats: [q('C5')] }, { beats: [{ type: 'rest', duration: 'quarter', dots: -2 }] }] }).voice2Beats[0].dots, 0);
  });
  test('normalize voices: input is not mutated', () => {
    const input = { tracks: [{ measures: [{ voices: [{ beats: v1 }, { beats: [{ type: 'note', duration: 'whole', notes: [{ string: 5, fret: 3 }] }] }] }] }] };
    const before = JSON.stringify(input);
    normalizeScore(input);
    eq(JSON.stringify(input), before);
  });

  // accidentals shared across voices, in onset order
  const { resolveVoiceAccidentals, resolveMeasureAccidentals } = await imp('src/layout/accidentals.js');
  const { placeAccidentalColumns, accidentalRightSp } = await imp('src/layout/chord.js');
  const { glyphBox } = await imp('src/glyphMetrics.js');
  const { accidentalGlyph: accidentalGlyphFor } = await imp('src/glyphs.js');
  const nt = (pitch, duration = 'quarter') => ({ type: 'note', duration, notes: [{ pitch }] });
  const gr = (pitch) => ({ type: 'grace', duration: '16th', notes: [{ pitch }] });
  const vAcc = (key, b1, b2) => resolveVoiceAccidentals({ measures: [{ keySignature: key, beats: b1, voice2Beats: b2 }] }, 0)
    .map((per) => per.map((r) => r.names.join('|')));
  test('resolveVoiceAccidentals: carry runs across voices by onset, voice 1 first at the same onset', () => {
    // v1: F#4 at 0, F4 at 1/2; v2: F4 at 0 (after v1's F#4 -> natural), F#4 at 1/4 (after it -> sharp), F4 at 3/4 (after v1's natural -> none)
    eq(vAcc(0, [nt('F#4', 'half'), nt('F4', 'half')], [nt('F4'), nt('F#4'), nt('C4'), nt('F4')]), [['sharp', 'natural'], ['natural', 'sharp', '', '']]);
  });
  test('resolveVoiceAccidentals: graces take their note\'s onset; voice-1 graces and note before voice 2 at that onset', () => {
    eq(vAcc(0, [nt('C4'), gr('G#4'), nt('G#4')], [nt('E4'), nt('G4')]), [['', 'sharp', ''], ['', 'natural']]);
    eq(vAcc(0, [nt('C5', 'whole')], [nt('B3', 'half'), gr('Bb3')]), [[''], ['', 'flat']]);
  });
  test('resolveVoiceAccidentals: without voice 2 equals resolveMeasureAccidentals', () => {
    const tr = { measures: [{ keySignature: 2, beats: [nt('F4'), gr('C4'), nt('C#4'), nt('Bb4'), { type: 'rest', duration: 'quarter' }] }] };
    eq(resolveVoiceAccidentals(tr, 0), [resolveMeasureAccidentals(tr, 0), []]);
  });
  test('placeAccidentalColumns: same columns as layoutChord for a cluster; keys kept in input order', () => {
    const w = glyphBox(accidentalGlyphFor('sharp')).width;
    const hw = glyphBox(String.fromCodePoint(0xE0A4)).width;
    const hdx = [0, hw, 0, hw, 0];
    const items = [0, 1, 2, 3, 4].map((i) => ({ key: `k${i}`, name: 'sharp', pos: i, w }));
    const out = placeAccidentalColumns(items, accidentalRightSp([{}, {}, {}, {}, {}], hdx, Array(5).fill(hw)));
    eq(out.map((a) => a.key), ['k0', 'k1', 'k2', 'k3', 'k4']);
    eq(out.map((a) => +(a.dx * 10).toFixed(3)), [-29.36, -51.36, -62.36, -40.36, -18.36]);
  });

  // two-voice layout (computeLayout)
  const { computeLayout } = await imp('src/layout/index.js');
  const { buildColumn } = await imp('src/layout/timeline.js');
  const { stemDxSp } = await imp('src/layout/chord.js');
  const th = resolveTheme();
  const S = th.staffLineSpacing;
  const NH = String.fromCodePoint(0xE0A4);
  const nb = (ps, duration = 'quarter', x = {}) => ({ type: 'note', duration, notes: ps.map((p) => (typeof p === 'string' ? { pitch: p } : p)), ...x });
  const rs = (duration = 'quarter', x = {}) => ({ type: 'rest', duration, ...x });
  const vm = (b1, b2, x = {}) => ({ ...x, voices: [{ beats: b1 }, { beats: b2 }] });
  const lay2 = (measures, track = {}) => computeLayout(normalizeScore({ tracks: [{ showStandardNotation: true, ...track, measures }] }), th, 900).systems[0].tracks[0].measures;
  const col = (b1, b2) => lay2([vm(b1, b2)])[0];
  const quarters = (p) => [p, p, p, p].map((x) => nb([x]));
  const near = (a, b) => Math.abs(a - b) < 1e-9;

  test('two-voice layout: voice 1 stems up and voice 2 down, beam groups and whole notes included; tags and groups', () => {
    const m = col([nb(['C6']), nb(['A5'], '8th'), nb(['B5'], '8th'), nb(['C6'], 'half')], [nb(['C4'], '8th'), nb(['D4'], '8th'), nb(['E4']), nb(['C4'], 'half')]);
    eq(m.elements.map((e) => e.chord.stemUp), [true, true, true, true]);
    eq(m.elements2.map((e) => e.chord.stemUp), [false, false, false, false]);
    eq([m.beamGroups, m.beamGroups2], [[[1, 2]], [[0, 1]]]);
    eq([m.elements.map((e) => e.voice), m.elements2.map((e) => e.voice), m.wholeRest, m.tupletGroups2], [[1, 1, 1, 1], [2, 2, 2, 2], null, []]);
    const w = col([nb(['G4'], 'whole')], [nb(['C4'], 'whole')]);
    eq([w.elements[0].chord.stemUp, w.elements2[0].chord.stemUp], [true, false]);
  });
  test('two-voice layout: equal onsets share x; voice-2 onsets between voice-1 onsets get their own', () => {
    const m = col([nb(['C5'], 'half'), nb(['C5'], 'half')], quarters('E4'));
    eq(m.elements2.map((e) => e.x === m.elements[0].x || e.x === m.elements[1].x), [true, false, true, false]);
    const sc = normalizeScore({ tracks: [{ measures: [vm([nb(['C5'], 'half'), nb(['C5'], 'half')], quarters('E4'))] }] });
    eq(buildColumn(0, sc, th).onsets.length, 4);
  });
  test('two-voice layout: clash shift for a second, a unison and crossed voices; none for a third or a rest', () => {
    const plain = (stemDxSp(NH, true) - stemDxSp(NH, false)) * S;
    const dx = (p1, p2) => col(quarters(p1), quarters(p2)).elements2[0].dx;
    // 1.8: an eligible unison (same pitch, head, dots) shares one head (dx 0); a unison that differs (here the accidental) still shifts
    eq([near(dx('A4', 'G4'), plain), dx('G4', 'G4'), near(dx('G#4', 'G4'), plain), near(dx('E4', 'G4'), plain), dx('B4', 'G4'), dx('C5', 'E4')], [true, 0, true, true, 0, 0]);
    const m = col([nb(['A4']), rs(), rs('half')], [nb(['G4']), nb(['G4']), rs('half')]);
    eq([near(m.elements2[0].x - m.elements[0].x, plain), m.elements2[1].dx, m.elements2[1].x === m.elements[1].x], [true, 0, true]);
    const w = col([nb(['A4'], 'whole')], [nb(['G4'], 'whole')]);
    eq(near(w.elements2[0].dx, w.elements[0].chord.headWidth), true, 'whole heads touch');
    // a voice-1 second displaced right of the stem adds a head width
    const d = col([nb(['G4', 'A4']), rs(), rs('half')], [nb(['F4']), rs(), rs('half')]);
    eq(near(d.elements2[0].dx, plain + d.elements[0].chord.headWidth), true, 'displaced head');
  });
  test('two-voice layout: one accidental stack for both voices, left of every head, columns not overlapping', () => {
    const m = col([nb(['F#4', 'C#5']), rs(), rs('half')], [nb(['Eb4', 'Bb3']), rs(), rs('half')]);
    const v1 = m.elements[0]; const v2 = m.elements2[0];
    const accs = [...v1.chord.accidentals.map((a) => ({ pos: v1.chord.heads[a.noteIndex].pos, x1: a.dx, name: a.name })),
      ...v2.chord.accidentals.map((a) => ({ pos: v2.chord.heads[a.noteIndex].pos, x1: a.dx + v2.dx, name: a.name }))];
    eq(accs.length, 4);
    const heads = [...v1.chord.heads.map((h) => h.dx - h.width / 2), ...v2.chord.heads.map((h) => v2.dx + h.dx - h.width / 2)];
    accs.forEach((a) => { a.x2 = a.x1 + glyphBox(accidentalGlyphFor(a.name)).width * S; eq(a.x2 <= Math.min(...heads) + 1e-9, true, 'left of heads'); });
    accs.forEach((a, i) => accs.slice(i + 1).forEach((b) => eq(Math.abs(a.pos - b.pos) >= 6 || a.x2 <= b.x1 + 1e-9 || b.x2 <= a.x1 + 1e-9, true, 'overlap')));
    eq(v1.chord.leftExt >= Math.max(...accs.map((a) => -a.x1)) - 1e-9, true, 'left extent');
  });
  test('two-voice layout: voice-2 dots below a line note; one dot column on a clash, a shared dot position moves down a space', () => {
    const lone = col([nb(['C5'], 'half'), rs('half')], [nb(['G4'], 'half', { dots: 1 }), rs()]);
    eq(lone.elements2[0].chord.dots.positions, [1]);
    const m = col([nb(['B4'], 'half', { dots: 1 }), rs()], [nb(['C5'], 'half', { dots: 1 }), rs()]);
    const c1 = m.elements[0].chord; const c2 = m.elements2[0].chord;
    eq([c1.dots.positions, c2.dots.positions], [[5], [3]]);
    eq(near(c1.dots.dx, c2.dots.dx + m.elements2[0].dx), true, 'one column');
    eq(c1.dots.dx >= Math.max(...c1.heads.map((h) => h.dx + h.width / 2), ...c2.heads.map((h) => m.elements2[0].dx + h.dx + h.width / 2)) + 0.5 * S - 1e-9, true);
  });
  test('two-voice layout: rest positions 8 / 0, whole-measure rests 8 / 2', () => {
    const m = col([rs(), nb(['C5']), rs('half')], [nb(['E4']), rs(), rs('half')]);
    // 1.8: the two half rests at beat 3 merge (one rest at the single-voice position, no restPos)
    eq([m.elements[0].restPos, m.elements2[1].restPos, m.elements[2].restPos, m.elements2[2].restPos], [8, 0, undefined, undefined]);
    eq([m.elements[2].restMerged, m.elements2[2].restMerged, m.elements[0].restMerged], [true, true, undefined]);
    const w = lay2([vm([rs('whole')], quarters('E4')), vm(quarters('C5'), [rs('whole')])]);
    eq([w[0].elements[0].restPos, w[0].elements[0].wholeMeasureRest, w[1].elements2[0].restPos, w[1].elements2[0].wholeMeasureRest], [8, true, 2, true]);
    eq('restPos' in w[0].elements2[0], false);
  });
  test('two-voice layout: a rest moves a whole space at a time clear of the other voice\'s heads; ledger outside the staff', () => {
    const m = col([rs(), rs('half'), rs()], [nb(['D5']), nb(['D5'], 'half'), nb(['B4'])]);
    eq([m.elements[0].restPos, m.elements[1].restPos, m.elements[2].restPos], [12, 10, 10]);
    eq([m.elements[0].restLedger, m.elements[1].restLedger], [undefined, 10]);
    const v2 = col([nb(['E4'], 'half'), nb(['E4'], 'half')], [rs('half'), rs('half')]);
    eq([v2.elements2[0].restPos, v2.elements2[0].restLedger], [-4, -4]);
  });
  test('two-voice layout: hidden rests take time but no onset, in either kind of measure', () => {
    const sc = normalizeScore({ tracks: [{ measures: [
      vm(quarters('C5'), [rs('half', { hidden: true }), nb(['E4'], 'half')]),
      { beats: [rs('quarter', { hidden: true }), nb(['C5']), nb(['C5']), nb(['C5'])] },
    ] }] });
    eq([buildColumn(0, sc, th).onsets.length, buildColumn(1, sc, th).onsets.length], [4, 3]);
    const ms = computeLayout(sc, th, 900).systems[0].tracks[0].measures;
    eq([ms[0].elements2[0].x === ms[0].elements[0].x, ms[0].elements2[1].x === ms[0].elements[2].x], [true, true]);
    eq([ms[1].elements[0].x === ms[1].elements[1].x, ms[1].elements[0].width], [true, 0]);
    // a measure whose voice 2 has only hidden rests lays out like the single-voice measure
    const one = lay2([vm(quarters('C5'), [rs('whole', { hidden: true })])])[0];
    eq([one.elements2, one.elements[0].voice, one.elements[0].chord.stemUp], [undefined, undefined, false]);
  });
  test('two-voice layout: voice-2 TAB beat drops notes on strings voice 1 frets at the same onset, and beat marks', () => {
    const m = lay2([vm([nb([{ string: 2, fret: 5 }], 'half'), nb([{ string: 1, fret: 3 }], 'half')],
      [nb([{ string: 2, fret: 7 }, { string: 4, fret: 5 }], 'half', { tremolo: true }), nb([{ string: 2, fret: 3 }], 'half')])],
    { showTablature: true })[0];
    eq(m.elements2.map((e) => e.tabEl.notes.map((n) => n.string)), [[4], [2]]);
    eq('tremolo' in m.elements2[0].tabEl, false);
  });

  // two-voice drawing (drawSystem: staff groups in local coordinates, top line y = 0, bottom line y = 4 sp)
  const { drawSystem } = await imp('src/draw/system.js');
  const { restForDuration } = await imp('src/glyphs.js');
  const draw2 = (measures, track = {}) => {
    const sc = normalizeScore({ tracks: [{ showStandardNotation: true, ...track, measures }] });
    const sys = computeLayout(sc, th, 900).systems[0];
    const d = drawSystem(makeContainer(), sys, 0, sc, th);
    const staff = (kind) => d.staves.find((st) => st.kind === kind)?.g;
    return { ms: sys.tracks[0].measures, staff, svg: serialize(d.systemG) };
  };
  const nodes = (g, pred) => [...walk(g)].filter(({ nd, cls }) => pred(nd, cls)).map(({ nd }) => nd);
  const v2g = (g) => nodes(g, (nd) => nd.tag === 'g' && nd.getAttribute('class') === 'voice-2');
  const nums = (d) => d.match(/-?\d+(\.\d+)?(e-?\d+)?/g).map(Number);
  const BL = 4 * S;

  test('two-voice drawing: <g class="voice-2"> only in two-voice measures (not for one entry or hidden-only voice 2)', () => {
    eq(v2g(draw2([vm(quarters('C5'), [nb(['C4'], 'whole')])]).staff('notation')).length, 1);
    eq(draw2([{ voices: [{ beats: quarters('C5') }] }, vm(quarters('C5'), [rs('whole', { hidden: true })])]).svg.includes('voice-2'), false);
  });
  test('two-voice drawing: stems follow the voice, beamed groups included; beams never span voices', () => {
    const { ms, staff } = draw2([vm([nb(['C6'], '8th'), nb(['A5'], '8th'), nb(['E5'], 'half'), nb(['C6'])], [nb(['D4'], '8th'), nb(['C4'], '8th'), nb(['F4'], 'half'), nb(['E4'])])]);
    eq(ms[0].elements.map((e) => e.rendered.stemUp), [true, true, true, true]);
    eq(ms[0].elements2.map((e) => e.rendered.stemUp), [false, false, false, false]);
    const beams = (g, inV2) => nodes(g, (nd, cls) => nd.tag === 'path' && nd.getAttribute('stroke') === 'none' && cls.includes('voice-2') === inV2 && !nd.getAttribute('class'));
    const g = staff('notation');
    const span = (els) => [Math.min(...els.map((e) => e.rendered.stemAttachX)) - S, Math.max(...els.map((e) => e.rendered.stemAttachX)) + S];
    [[beams(g, false), ms[0].elements], [beams(g, true), ms[0].elements2]].forEach(([ps, els]) => {
      eq(ps.length, 1);
      const xs = nums(ps[0].getAttribute('d')).filter((_, i) => i % 2 === 0);
      const [lo, hi] = span(els.slice(0, 2));
      eq(xs.every((x) => x >= lo && x <= hi), true, 'beam within its own voice\'s stems');
    });
    eq(ms[0].elements[0].rendered.stemTopY < ms[0].elements[0].rendered.stemBottomY, true);
  });
  test('two-voice drawing: voice-2 tuplet bracket below its lowest ink (>= bottom line + 1 sp), ticks up; voice-1 stays above', () => {
    const t3 = (p) => nb([p], '8th', { tuplet: 3 });
    const { ms, staff } = draw2([vm([t3('C5'), t3('D5'), t3('E5'), nb(['C5'], 'quarter'), nb(['C5'], 'half')], [t3('C4'), t3('D4'), t3('E4'), nb(['C4']), nb(['C4'], 'half')])]);
    const [v2] = v2g(staff('notation'));
    const tp = nodes(v2, (nd) => nd.tag === 'g' && nd.getAttribute('class') === 'tuplet');
    eq(tp.length, 1);
    const [x1, yTick, , y] = nums(tp[0].children[0].getAttribute('d'));
    const lowest = Math.max(...ms[0].elements2.slice(0, 3).map((e) => e.rendered.stemBottomY));
    eq([y >= BL + S - 1e-9, near(y, Math.max(lowest + 1.6 * S, BL + S)), yTick < y, x1 < ms[0].elements2[0].x], [true, true, true, true]);
    const tp1 = nodes(staff('notation'), (nd, cls) => nd.tag === 'g' && nd.getAttribute('class') === 'tuplet' && !cls.includes('voice-2'));
    eq([tp1.length, nums(tp1[0].children[0].getAttribute('d'))[3] < 0], [1, true]);
    eq([ms[0].elements[0].rendered.tupletY < 0, ms[0].elements2[0].rendered.tupletY], [true, undefined]);
  });
  test('two-voice drawing: rest glyphs at their voice position, a ledger line for a half rest above the staff', () => {
    const { staff } = draw2([vm([rs(), nb(['C5']), rs('half')], [nb(['E4']), rs(), nb(['D5'], 'half')])]);
    const y = (glyph, inV2) => nodes(staff('notation'), (nd, cls) => nd.tag === 'text' && nd.textContent === glyph && cls.includes('voice-2') === inV2)
      .map((nd) => +nd.getAttribute('y'));
    eq([y(restForDuration('quarter'), false), y(restForDuration('quarter'), true), y(restForDuration('half'), false)], [[BL - 8 * S / 2], [BL], [BL - 10 * S / 2]]);
    const ledgers = nodes(staff('notation'), (nd) => nd.tag === 'line' && near(+nd.getAttribute('y1'), BL - 10 * S / 2) && nd.getAttribute('y1') === nd.getAttribute('y2'));
    eq(ledgers.length, 1);
  });
  test('two-voice drawing: articulations on the stem side, at least 1 sp beyond the stem tip; whole-note tremolo below voice 2', () => {
    const { ms } = draw2([vm([nb(['G4'], 'quarter', { articulations: ['staccato', 'accent'] }), nb(['G4'], 'quarter'), nb(['B4'], 'half')],
      [nb(['D4'], 'quarter', { articulations: ['staccato'] }), nb(['D4']), nb(['D4'], 'half', { articulations: ['tenuto'] })])]);
    const r1 = ms[0].elements[0].rendered; const r2 = ms[0].elements2[0].rendered; const r3 = ms[0].elements2[2].rendered;
    eq([r1.articTopY <= r1.stemTopY - S, r1.articBottomY, r2.articBottomY >= r2.stemBottomY + S, r2.articTopY, r3.articBottomY >= r3.stemBottomY + S], [true, undefined, true, undefined, true]);
    const w = draw2([vm([nb(['G4'], 'whole')], [nb(['C4'], 'whole', { tremolo: true })])]);
    const [v2] = v2g(w.staff('notation'));
    const tr = nodes(v2, (nd) => nd.tag === 'line' && nd.getAttribute('stroke-linecap') === 'round');
    const headY = w.ms[0].elements2[0].rendered.noteheads[0].y;
    eq([tr.length, tr.every((l) => +l.getAttribute('y1') > headY + S / 2 && +l.getAttribute('y2') > headY + S / 2)], [3, true]);
  });
  test('two-voice drawing: TAB shows voice 2\'s frets at the column x, voice 1 wins a shared string; rhythm band one row per voice (1.8)', () => {
    const fr = (string, fret, duration = 'quarter') => ({ type: 'note', duration, notes: [{ string, fret }] });
    const m = vm([fr(2, 5, 'half'), fr(1, 3, 'half')], [fr(2, 7), fr(4, 9), fr(5, 2), fr(5, 4)]);
    const { ms, staff } = draw2([m], { showTablature: true });
    const labels = nodes(staff('tab'), (nd) => nd.tag === 'text').map((nd) => [nd.textContent, +(+nd.getAttribute('x')).toFixed(2)]);
    const xs = ms[0].elements2.map((e) => +(e.x - e.dx).toFixed(2));
    eq(labels.filter(([t]) => /^\d+$/.test(t)).sort(), [['2', xs[2]], ['3', +ms[0].elements[1].x.toFixed(2)], ['4', xs[3]], ['5', +ms[0].elements[0].x.toFixed(2)], ['9', xs[1]]].sort());
    const tab = draw2([m], { showStandardNotation: false, showTablature: true });
    const band = nodes(tab.staff('tab'), (nd, cls) => nd.tag === 'line' && cls.includes('tab-rhythm'));
    eq(band.map((l) => +(+l.getAttribute('x1')).toFixed(2)), tab.ms[0].elements.map((e) => +e.x.toFixed(2)));
    // 1.8: voice 2's row follows in <g class="tab-rhythm voice-2">, stems at the column x (x - dx)
    const band2 = nodes(tab.staff('tab'), (nd, cls) => nd.tag === 'line' && cls.includes('tab-rhythm voice-2'));
    eq(band2.map((l) => +(+l.getAttribute('x1')).toFixed(2)), tab.ms[0].elements2.map((e) => +(e.x - e.dx).toFixed(2)));
  });

  // two-voice passes (full render): ties, slurs, grace slurs, TAB links per voice
  const full = (measures, track = {}, width = 900) => renderTree({ tracks: [{ showStandardNotation: true, ...track, measures }] }, width);
  const curves = (root, cls) => nodes(root, (nd) => nd.tag === 'path' && nd.getAttribute('class') === cls).map((nd) => {
    const n = nums(nd.getAttribute('d'));
    return { x1: n[0], y1: n[1], x2: n[6], y2: n[7], above: n[3] < n[1] };
  });
  const tied = (p, d = 'half') => [nb([{ pitch: p, tieStart: true }], d), nb([{ pitch: p, tieEnd: true }], d)];
  test('two-voice passes: voice 1 ties and slurs above, voice 2 below, each within its voice', () => {
    const svg = full([
      vm(tied('C5'), tied('E4')),
      vm([nb(['D5'], 'quarter', { slurStart: true }), nb(['E5']), nb(['F5'], 'quarter', { slurEnd: true }), rs()],
        [nb(['G4'], 'quarter', { slurStart: true }), nb(['F4']), nb(['E4'], 'quarter', { slurEnd: true }), rs()]),
    ]);
    const ties = curves(svg, 'tie').sort((a, b) => a.y1 - b.y1);
    eq(ties.map((t) => t.above), [true, false]);
    const slurs = curves(svg, 'slur').sort((a, b) => a.y1 - b.y1);
    eq(slurs.map((t) => t.above), [true, false]);
    eq(slurs[0].x1 === slurs[1].x1 && slurs[0].x2 === slurs[1].x2, true, 'same onsets');
  });
  test('two-voice passes: ties split across a system break per voice, sides kept', () => {
    const busy = (p) => [p, p, p, p, p, p, p, p].map((x) => nb([x], '8th'));
    const svg = full([
      vm([...busy('B4').slice(0, 6), nb([{ pitch: 'C5', tieStart: true }])], [...busy('E4').slice(0, 6), nb([{ pitch: 'G4', tieStart: true }])]),
      vm([nb([{ pitch: 'C5', tieEnd: true }], 'whole')], [nb([{ pitch: 'G4', tieEnd: true }], 'whole')]),
    ], {}, 300);
    eq(serialize(svg).includes('system-1'), true, 'broken');
    const ties = curves(svg, 'tie');
    eq(ties.length, 4);
    eq(ties.filter((t) => t.above).length, 2);
  });
  test('two-voice passes: a slur into a single-voice measure keeps its start voice\'s side', () => {
    const svg = full([
      vm(quarters('C5'), [rs('half'), nb(['E4'], 'half', { slurStart: true })]),
      { beats: [nb(['G4'], 'quarter', { slurEnd: true }), nb(['G4']), nb(['G4'], 'half')] },
    ]);
    eq(curves(svg, 'slur').map((c) => c.above), [false]);
  });
  test('two-voice passes: H/P links within a voice even when the other voice is nearer on that string (TAB and notation)', () => {
    const fr = (string, fret, x = {}) => ({ type: 'note', duration: 'quarter', notes: [{ string, fret, ...x }] });
    const svg = full([vm([fr(2, 5, { hammerPull: true }), rs(), fr(2, 7), rs()], [fr(4, 2), fr(2, 6), fr(4, 2), fr(4, 4)])], { showTablature: true });
    const sc = normalizeScore({ tracks: [{ showStandardNotation: true, showTablature: true, measures: [vm([fr(2, 5), rs(), fr(2, 7), rs()], [fr(4, 2), fr(2, 6), fr(4, 2), fr(4, 4)])] }] });
    const els = computeLayout(sc, th, 900).systems[0].tracks[0].measures[0].elements;
    const hp = nodes(svg, (nd) => nd.tag === 'g' && /^hammer-pull /.test(nd.getAttribute('class') || ''));
    eq(hp.length, 1);
    const xs = nums(nodes(hp[0], (nd) => nd.tag === 'path')[0].getAttribute('d')).filter((_, i) => i % 2 === 0);
    eq([Math.min(...xs) > els[0].x, Math.max(...xs) < els[2].x, Math.max(...xs) > els[1].x], [true, true, true], 'spans to voice 1\'s next note');
    const sl = curves(svg, 'slur');
    eq([sl.length, sl[0].above, Math.abs(sl[0].x1 - els[0].x) < 0.01, Math.abs(sl[0].x2 - els[2].x) < 0.01], [1, true, true, true]);
  });
  test('two-voice passes: graces stem and slur per voice into their own voice\'s next note', () => {
    const g = (p) => ({ type: 'grace', duration: '16th', notes: [{ pitch: p }] });
    const ms = draw2([vm([nb(['C5'], 'half'), g('D5'), nb(['C5'], 'half')], [g('F4'), nb(['E4']), nb(['E4']), nb(['E4'], 'half')])]).ms;
    eq([ms[0].elements[1].rendered.stemUp, ms[0].elements2[0].rendered.stemUp], [true, false]);
    eq(ms[0].elements2[0].x < ms[0].elements2[1].x && ms[0].elements[1].x < ms[0].elements[2].x, true, 'anchored to own note');
    const svg = full([vm([nb(['C5'], 'half'), g('D5'), nb(['C5'], 'half')], [g('F4'), nb(['E4']), nb(['E4']), nb(['E4'], 'half')])]);
    const sl = curves(svg, 'slur').sort((a, b) => a.x1 - b.x1);
    eq(sl.length, 2);
    eq([Math.abs(sl[0].x2 - ms[0].elements2[1].x) < 0.01, Math.abs(sl[1].x2 - ms[0].elements[2].x) < 0.01], [true, true]);
  });
  test('two-voice passes: dynamics and chord symbols on a voice-2 beat are not drawn (voice-1 only)', () => {
    const s2 = serialize(full([vm(quarters('C5'), [nb(['E4'], 'whole', { dynamic: 'f', chord: 'C' })])]));
    eq([s2.includes('class="dynamic"'), s2.includes('chord-symbol')], [false, false]);
    const s1 = serialize(full([vm([nb(['C5'], 'quarter', { dynamic: 'f', chord: 'C' }), ...quarters('C5').slice(1)], [nb(['E4'], 'whole')])]));
    eq([s1.includes('class="dynamic"'), s1.includes('chord-symbol')], [true, true]);
  });

  // ---- verification gaps (AC audit) ----
  test('voices[0].beats not an array is treated as empty voice 1, never throws (voice 2 kept)', () => {
    [{ beats: 'x' }, { beats: {} }, {}, null].forEach((first) => {
      const m = m0({ voices: [first, { beats: v2 }] });
      eq([m.beats, m.voice2Beats.length], [[], 1]);
      m0({ voices: [first] });
      eq(m0({ voices: [first] }).beats, []);
    });
    full([{ voices: [{ beats: 'x' }, { beats: v2 }] }, { voices: [{ beats: 5 }] }]);
  });
  test('voices: every single-voice spelling renders byte-identical to `beats` (non-array, empty, 1 entry, hidden-only/empty/missing voice 2)', () => {
    const ref = serialize(full([{ beats: v1 }, { beats: v1 }]));
    const hw = [rs('whole', { hidden: true })];
    [{}, [], 'x', null, 7].forEach((voices) => eq(serialize(full([{ voices, beats: v1 }, { beats: v1 }])) === ref, true, `voices=${JSON.stringify(voices)}`));
    [[{ beats: v1 }], [{ beats: v1 }, {}], [{ beats: v1 }, { beats: [] }], [{ beats: v1 }, { beats: hw }], [{ beats: v1 }, { beats: [rs('half', { hidden: true }), rs('half', { hidden: true })] }]]
      .forEach((voices, i) => eq(serialize(full([{ voices }, { voices }])) === ref, true, `case ${i}`));
    // hidden-only voice 2 on a TAB track too
    const fr = [{ type: 'note', duration: 'whole', notes: [{ string: 2, fret: 3 }] }];
    eq(serialize(full([{ voices: [{ beats: fr }, { beats: hw }] }], { showTablature: true })) === serialize(full([{ beats: fr }], { showTablature: true })), true, 'TAB');
  });
  test('voices: entries after the second change nothing (byte-identical to two entries)', () => {
    const two = [{ beats: v1 }, { beats: v2 }];
    eq(serialize(full([{ voices: [...two, { beats: [q('A4'), q('B4')] }, 'junk'] }])) === serialize(full([{ voices: two }])), true);
  });
  test('voices: rendering is deterministic and leaves the input untouched', () => {
    const score = { tracks: [{ showStandardNotation: true, showTablature: true, measures: [vm([nb([{ string: 2, fret: 5, hammerPull: true }], 'half'), rs('half'), nb(['C5'])], [rs('half', { hidden: true }), nb([{ string: 4, fret: 2 }], 'half', { tuplet: 3 })])] }] };
    const before = JSON.stringify(score);
    const a = serialize(renderTree(score, 600)); const b = serialize(renderTree(score, 600));
    eq([a === b, JSON.stringify(score) === before], [true, true]);
  });
  test('voice-1-only beat marks on a voice-2 beat draw nothing: output is byte-identical to the same beat without them (1.8 split)', () => {
    const marks = { strum: 'up', arpeggio: true, letRing: true, palmMute: true, rake: 'down', whammy: true, dynamic: 'ff', chord: 'Am' };
    const mk = (extra, track) => serialize(full([vm([nb([{ string: 3, fret: 2 }, { string: 4, fret: 2 }]), nb([{ string: 3, fret: 3 }]), nb([{ string: 3, fret: 4 }], 'half')],
      [nb([{ string: 5, fret: 2 }, { string: 6, fret: 2 }], 'quarter', extra), rs(), nb([{ string: 5, fret: 3 }], 'half', extra)])], track));
    [{ showTablature: true }, { showStandardNotation: false, showTablature: true }, {}].forEach((track, i) => eq(mk(marks, track) === mk({}, track), true, `track ${i}`));
    // 1.8 (R1): pick stroke, vibrato, fermata, tap / slap / pop and trill on voice 2 now draw on every kind of track
    for (const extra of [{ pickStroke: 'down' }, { vibrato: true }, { tap: true }, { trill: true }]) {
      const n = extra;
      const withNote = (track) => serialize(full([vm([nb([{ string: 3, fret: 2 }, { string: 4, fret: 2 }]), nb([{ string: 3, fret: 3 }]), nb([{ string: 3, fret: 4 }], 'half')],
        [nb([{ string: 5, fret: 2, ...(n.tap ? { tap: true } : {}), ...(n.trill ? { trill: true } : {}) }], 'quarter', n.tap || n.trill ? {} : n), rs(), nb([{ string: 5, fret: 3 }], 'half')])], track));
      const plain = (track) => serialize(full([vm([nb([{ string: 3, fret: 2 }, { string: 4, fret: 2 }]), nb([{ string: 3, fret: 3 }]), nb([{ string: 3, fret: 4 }], 'half')],
        [nb([{ string: 5, fret: 2 }]), rs(), nb([{ string: 5, fret: 3 }], 'half')])], track));
      [{ showTablature: true }, { showStandardNotation: false, showTablature: true }, {}].forEach((track, i) => eq(withNote(track) === plain(track), false, `${Object.keys(extra)[0]} track ${i}`));
    }
    eq(mk({ fermata: true }, {}) === mk({}, {}), false, 'fermata');
    // a mark that is honoured on voice 1 would differ, so the comparison is not vacuous
    const one = serialize(full([vm([nb([{ string: 3, fret: 2 }], 'quarter', { pickStroke: 'down' }), rs('half'), rs()], [nb([{ string: 5, fret: 2 }], 'whole')])], { showTablature: true }));
    const none = serialize(full([vm([nb([{ string: 3, fret: 2 }]), rs('half'), rs()], [nb([{ string: 5, fret: 2 }], 'whole')])], { showTablature: true }));
    eq(one === none, false);
  });
  test('ties and links do not cross voices', () => {
    // voice 1 tie-start with its match only in voice 2 of the next measure: no tie
    const svg = full([vm([nb([{ pitch: 'C5', tieStart: true }], 'whole')], [nb(['E4'], 'whole')]), vm([nb(['G4'], 'whole')], [nb([{ pitch: 'C5', tieEnd: true }], 'whole')])]);
    eq(curves(svg, 'tie').length, 0);
    // voice 2 slur-start, slur-end only on voice 1: no slur
    const sv = full([vm([nb(['C5'], 'half'), nb(['D5'], 'half', { slurEnd: true })], [nb(['E4'], 'half', { slurStart: true }), nb(['F4'], 'half')])]);
    eq(curves(sv, 'slur').length, 0);
    // hammer-on in voice 1 with only voice 2 fretting later on that string: no H/P arc
    const fr = (string, fret, x = {}) => ({ type: 'note', duration: 'quarter', notes: [{ string, fret, ...x }] });
    const hp = full([vm([fr(2, 5, { hammerPull: true }), rs(), rs('half')], [rs(), fr(2, 7), rs('half')])], { showTablature: true });
    eq(nodes(hp, (nd) => nd.tag === 'g' && /^hammer-pull /.test(nd.getAttribute('class') || '')).length, 0);
  });
  test('two-voice layout: tracks share onset columns; a voice-2 onset in one track opens a column for the others', () => {
    const sc = normalizeScore({ tracks: [
      { showStandardNotation: true, measures: [vm([nb(['C5'], 'half'), nb(['C5'], 'half')], [nb(['E4']), nb(['E4']), nb(['E4']), nb(['E4'])])] },
      { showStandardNotation: true, measures: [{ beats: [nb(['C4'], 'half'), nb(['C4'], 'half')] }] },
    ] });
    const [a, b] = computeLayout(sc, th, 900).systems[0].tracks.map((t) => t.measures[0]);
    eq([b.elements[0].x === a.elements[0].x, b.elements[1].x === a.elements[1].x], [true, true]);
    eq(a.elements[1].x - a.elements[0].x > a.elements2[1].x - a.elements2[0].x, true, 'half note spans two voice-2 gaps');
    eq(buildColumn(0, sc, th).onsets.length, 4);
  });
  test('hand-computed: a second clash moves voice 2 right by exactly stem-right minus stem-left of one notehead', () => {
    const m = col([nb(['A4']), rs(), rs('half')], [nb(['G4']), rs(), rs('half')]);
    const hw = m.elements[0].chord.headWidth;
    // voice 1 stems up (stem on the head's right edge), voice 2 down (left edge): the heads sit one head width apart
    eq(near(m.elements2[0].x - m.elements[0].x, (stemDxSp(NH, true) - stemDxSp(NH, false)) * S), true);
    eq(near(m.elements2[0].x - m.elements[0].x, hw), true, 'one head width');
    eq(near(hw, glyphBox(NH).width * S), true);
  });
}

// ---------- 1.5 note effects: canonicalizers (src/noteEffects.js) and new glyphs ----------
{
  const { vibratoOf, tremoloOf, tremoloStrokes, fermataOf } = await imp('src/noteEffects.js');
  const { glyphBox, hasGlyphBox } = await imp('src/glyphMetrics.js');
  const ODD = [undefined, null, false, 0, '', true, 1, 2, 8, 16, 32, -1, 'x', 'true', 'wide', ' Wide ', 'WIDE', 'wid e',
    '8th', ' 16TH ', '32nd', '32ND\t', '64th', 'normal', ' Short', 'LONG ', 'constructor', 'toString', '__proto__',
    [], ['wide'], {}, { kind: 'wide' }];
  test('[W2] vibratoOf: table', () => {
    eq([undefined, null, false, 0, ''].map(vibratoOf), [null, null, null, null, null]);
    eq([true, 1, 2, 'x', 'true', 'normal', 'wid e', [], ['wide'], {}].map(vibratoOf), Array(10).fill(true));
    eq(['wide', ' Wide ', 'WIDE', '\twide\n'].map(vibratoOf), Array(4).fill('wide'));
  });
  test('[T2] tremoloOf: table', () => {
    eq([undefined, null, false, 0, ''].map(tremoloOf), [null, null, null, null, null]);
    eq(['8th', ' 16TH ', '32nd', '32ND\t'].map(tremoloOf), ['8th', '16th', '32nd', '32nd']);
    eq([true, 1, 2, 8, 16, 32, 'x', '8', '64th', 'constructor', 'toString', '__proto__', [], {}].map(tremoloOf), Array(14).fill(true));
  });
  test('[T1,T2] tremoloStrokes: 1 / 2 / 3 for 8th / 16th / 32nd, 3 for anything else', () => {
    eq(['8th', '16th', '32nd'].map(tremoloStrokes), [1, 2, 3]);
    eq([true, null, undefined, 2, '8TH', 'constructor', 'toString'].map(tremoloStrokes), Array(7).fill(3));
  });
  test('[F2] fermataOf: table', () => {
    eq([true, 'normal', ' Normal ', 'short', 'SHORT', 'long', '\tLong'].map(fermataOf), ['normal', 'normal', 'normal', 'short', 'short', 'long', 'long']);
    eq(['true', 1, 0, false, null, undefined, '', 'x', 'wide', 'constructor', [], {}].map(fermataOf), Array(12).fill(null));
  });
  test('[G2] canonicalizers are idempotent and truthiness-preserving for vibrato/tremolo', () => {
    for (const f of [vibratoOf, tremoloOf, fermataOf]) ODD.forEach((v) => eq(f(f(v)), f(v), `${f.name}(${JSON.stringify(v)})`));
    ODD.forEach((v) => {
      eq(vibratoOf(v) != null, !!v, `vibratoOf(${JSON.stringify(v)})`);
      eq(tremoloOf(v) != null, !!v, `tremoloOf(${JSON.stringify(v)})`);
    });
  });
  test('[G1] new glyph codepoints and boxes', () => {
    const cps = { articStaccatissimoAbove: 'e4a6', articStaccatissimoBelow: 'e4a7', articMarcatoAbove: 'e4ac',
      articMarcatoBelow: 'e4ad', fermataShortAbove: 'e4c4', fermataLongAbove: 'e4c6' };
    for (const [n, cp] of Object.entries(cps)) {
      eq(Glyph[n].codePointAt(0).toString(16), cp, n);
      eq(Glyph[n].length, 1, `${n} is one UTF-16 unit`);
      eq(hasGlyphBox(n) && hasGlyphBox(Glyph[n]), true, `${n} box`);
    }
    // Above marks sit on their origin and rise; Below marks hang from it (same height).
    for (const k of ['Staccatissimo', 'Marcato']) {
      const a = glyphBox(`artic${k}Above`), b = glyphBox(`artic${k}Below`);
      eq([a.bottom, b.top, a.top, a.width], [0, 0, -b.bottom, b.width], k);
    }
    eq(glyphBox('fermataShortAbove').top > 1 && glyphBox('fermataLongAbove').top > 1, true);
  });
}

// ---------- pre-1.6 characterization: pins taken from the code before score text & structure ----------
{
  const { resolveTheme } = await imp('src/theme.js');
  const { computeLayout } = await imp('src/layout/index.js');
  const { renderNavigation } = await imp('src/draw/navigation.js');
  const { drawScoreHeader } = await imp('src/draw/header.js');
  const { group: svgGroup } = await imp('src/draw/svgUtil.js');
  // the 57 pre-1.6 cases (the 1.6.0 char-score-text-* fixtures use the new fields on purpose; the 1.7.0
  // char-ornaments-* came later)
  const allCases = (await import('./cases.mjs')).cases.filter((c) => !/^char-(score-text|ornaments|voices-marks|voices-tab-rhythm|voices-tied-frets)-/.test(c.id));
  const thm = resolveTheme({});
  const s = thm.staffLineSpacing;
  const ok = (c, m) => { if (!c) throw new Error(m); };
  const bar = (extra = {}) => ({ beats: [nq, nq, nq, nq], ...extra });
  const lay = (measures, width) => computeLayout(normalizeScore({ tracks: [{ measures }] }), thm, width);

  test('pre-1.6: renderNavigation returns null and appends nothing for every system of a multi-system plain layout', () => {
    const L = lay(Array.from({ length: 12 }, () => bar()), 400);
    ok(L.systems.length > 1, 'multi-system');
    L.systems.forEach((sys, i) => {
      const g = svgGroup({});
      eq(renderNavigation(g, sys, thm), null, `system ${i}`);
      eq(g.children.length, 0, `system ${i} appended nothing`);
    });
  });
  test('pre-1.6: only system 1 has a segno -> system 0 returns null and appends nothing; system 1 draws', () => {
    const plain = lay(Array.from({ length: 12 }, () => bar()), 400);
    const startMi = plain.systems[1].measureIndices[0];
    const L = lay(Array.from({ length: 12 }, (_, i) => bar(i === startMi ? { segno: true } : {})), 400);
    const g0 = svgGroup({});
    eq(renderNavigation(g0, L.systems[0], thm), null);
    eq(g0.children.length, 0);
    eq(L.systems[0].marks, []);
    eq(L.systems[1].marks.map((m) => m.kind), ['segno']);
    const g1 = svgGroup({});
    ok(renderNavigation(g1, L.systems[1], thm) != null, 'system 1 draws a navigation group');
    eq(g1.children.length, 1);
  });
  test('pre-1.6: all 57 cases keep navigation columns at exactly [ending, segno, coda, jump]; mark kinds within segno/coda/jump', () => {
    eq(allCases.length, 57);
    for (const c of allCases) {
      const score = normalizeScore(JSON.parse(JSON.stringify(c.score)));
      score.navigation.forEach((col, mi) => eq(Object.keys(col), ['ending', 'segno', 'coda', 'jump'], `${c.id} measure ${mi}`));
      const L = computeLayout(score, resolveTheme(c.options?.theme ?? {}), c.width);
      for (const sys of L.systems) for (const m of sys.marks) ok(['segno', 'coda', 'jump'].includes(m.kind), `${c.id} mark kind ${m.kind}`);
    }
  });

  const FONT = '&quot;Times New Roman&quot;, Georgia, serif';
  const hdr = (sc) => { const svg = svgGroup({}); const r = drawScoreHeader(svg, sc, thm, 10, 900); return { r, out: svg.children.map(serialize) }; };
  const titleXml = `<text x="450" y="28" class="title" font-family="${FONT}" font-size="24" text-anchor="middle" fill="#1a1a1a">T</text>`;
  const tuningXml = (y) => `<text x="30" y="${y}" class="tuning" font-family="${FONT}" font-size="13" font-style="italic" fill="#1a1a1a">Drop D</text>`;
  const composerXml = (y) => `<text x="870" y="${y}" class="composer" font-family="${FONT}" font-size="13" text-anchor="end" fill="#1a1a1a">C</text>`;
  const wrap = (...rows) => [`<g class="score-header">\n${rows.map((r) => `  ${r}\n`).join('')}</g>\n`];
  test('pre-1.6: drawScoreHeader title only -> returns top + 0.75 * 2.4 s, exact group', () => {
    const h = hdr({ title: 'T' });
    eq(h.r, 10 + 0.75 * 2.4 * s);
    eq(h.r, 28);
    eq(h.out, wrap(titleXml));
  });
  test('pre-1.6: drawScoreHeader title + composer + tuningLabel -> + 2.5 s, exact group (tuning, then composer)', () => {
    const h = hdr({ title: 'T', composer: 'C', tuningLabel: 'Drop D' });
    eq(h.r, 28 + 2.5 * s);
    eq(h.out, wrap(titleXml, tuningXml(53), composerXml(53)));
  });
  test('pre-1.6: drawScoreHeader tuningLabel only -> top + 0.75 * 1.3 s, exact group', () => {
    const h = hdr({ tuningLabel: 'Drop D' });
    eq(h.r, 10 + 0.75 * 1.3 * s);
    eq(h.r, 19.75);
    eq(h.out, wrap(tuningXml(19.75)));
  });
  test('pre-1.6: drawScoreHeader composer only -> top + 0.75 * 1.3 s, exact group', () => {
    const h = hdr({ composer: 'C' });
    eq(h.r, 19.75);
    eq(h.out, wrap(composerXml(19.75)));
  });
  test('pre-1.6: drawScoreHeader with no title/composer/tuningLabel returns null and appends nothing', () => {
    const h = hdr({});
    eq(h.r, null);
    eq(h.out, []);
  });

  test('pre-1.6: MusicScoreRenderer.js source order renderFermatas( < renderNavigation( < drawTempo(', () => {
    const src = fs.readFileSync(path.join(root0, 'src/MusicScoreRenderer.js'), 'utf8');
    const a = src.indexOf('renderFermatas('), b = src.indexOf('renderNavigation('), c = src.indexOf('drawTempo(');
    ok(a >= 0 && b > a && c > b, `order ${a} ${b} ${c}`);
  });
}

// ---------- 1.6 score text: canonicalizers and tuning helpers (src/scoreText.js) ----------
{
  const ST = await imp('src/scoreText.js');
  const GARBAGE = [undefined, null, false, true, 0, 1, '', '  ', '\n\t', [], ['x'], {}];
  test('scoreText: canonicalText trims and collapses whitespace; garbage -> null; idempotent', () => {
    eq(['  a  b ', 'a\n\tb', 'Verse', ' x '].map(ST.canonicalText), ['a b', 'a b', 'Verse', 'x']);
    GARBAGE.forEach((g) => eq(ST.canonicalText(g), null, JSON.stringify(g)));
    ['  a  b ', 'a\n\tb', '<b>&'].forEach((v) => eq(ST.canonicalText(ST.canonicalText(v)), ST.canonicalText(v)));
  });
  test('scoreText: canonicalSection string / object forms, letter 1-3 code points', () => {
    eq(ST.canonicalSection(' Verse  1 '), { letter: null, text: 'Verse 1' });
    eq(ST.canonicalSection({ letter: ' A ', text: ' Intro ' }), { letter: 'A', text: 'Intro' });
    eq(ST.canonicalSection({ letter: 'B' }), { letter: 'B', text: null });
    eq(ST.canonicalSection({ letter: 'A12' }), { letter: 'A12', text: null });
    eq(ST.canonicalSection({ letter: 'ABCD', text: 'Solo' }), { letter: null, text: 'Solo' });
    eq(ST.canonicalSection({ letter: '\u{1D11E}\u{1D11E}\u{1D11E}' }), { letter: '\u{1D11E}\u{1D11E}\u{1D11E}', text: null }, 'code points, not UTF-16 units');
    eq(ST.canonicalSection({ letter: 7, text: 'x' }), { letter: null, text: 'x' });
    [...GARBAGE, { letter: 'ABCD' }, { letter: ' ', text: ' ' }, { text: 5 }].forEach((g) => eq(ST.canonicalSection(g), null, JSON.stringify(g)));
    [' Verse ', { letter: ' A ', text: ' Intro ' }, { letter: 'B' }, { letter: 'ABCD', text: 'Solo' }]
      .forEach((v) => { const c = ST.canonicalSection(v); eq(ST.canonicalSection(c), c, JSON.stringify(v)); });
  });
  test('scoreText: canonicalRepeatCount 2-99, numeric strings; garbage -> null; idempotent', () => {
    eq([2, 3, 99, '3', ' 12 ', '007'].map(ST.canonicalRepeatCount), [2, 3, 99, 3, 12, 7]);
    [...GARBAGE, 100, -3, 2.5, NaN, Infinity, '1', '100', '3x', 'x3', '-3', '2.0'].forEach((g) => eq(ST.canonicalRepeatCount(g), null, String(g)));
    [2, '3', 99].forEach((v) => eq(ST.canonicalRepeatCount(ST.canonicalRepeatCount(v)), ST.canonicalRepeatCount(v)));
  });
  test('scoreText: canonicalBeatText string / object, below only when true; idempotent', () => {
    eq(ST.canonicalBeatText(' rit. '), { text: 'rit.', below: false });
    eq(ST.canonicalBeatText({ text: 'let ring', below: true }), { text: 'let ring', below: true });
    eq(ST.canonicalBeatText({ text: 'x', below: 'yes' }), { text: 'x', below: false });
    [...GARBAGE, { below: true }, { text: '  ', below: true }].forEach((g) => eq(ST.canonicalBeatText(g), null, JSON.stringify(g)));
    [' rit. ', { text: 'a  b', below: true }].forEach((v) => { const c = ST.canonicalBeatText(v); eq(ST.canonicalBeatText(c), c); });
  });
  test('scoreText: canonicalCapo 1-30, numeric strings; garbage -> null', () => {
    eq([1, 2, 30, '2', ' 5 '].map(ST.canonicalCapo), [1, 2, 30, 2, 5]);
    [...GARBAGE.filter((g) => g !== 1), 31, -1, 1.5, '0', '31', 'II'].forEach((g) => eq(ST.canonicalCapo(g), null, String(g)));
  });
  test('scoreText: canonicalLines splits, trims, drops empty, at most 8; idempotent through join', () => {
    eq(ST.canonicalLines(' a \r\n\n  b  c \n'), ['a', 'b c']);
    eq(ST.canonicalLines(Array.from({ length: 12 }, (_, i) => `L${i}`).join('\n')), Array.from({ length: 8 }, (_, i) => `L${i}`));
    eq(ST.canonicalLines('a\nb\nc', 2), ['a', 'b']);
    [...GARBAGE, '\n \n'].forEach((g) => eq(ST.canonicalLines(g), null, JSON.stringify(g)));
    [' a \r\n\n  b  c \n', 'x', Array(20).fill('y').join('\n')].forEach((v) => { const r = ST.canonicalLines(v); eq(ST.canonicalLines(r.join('\n')), r); });
  });
  test('scoreText: circledDigit 1-10 -> U+2460-U+2469, above -> (n)', () => {
    eq(ST.circledDigit(1), '①'); eq(ST.circledDigit(6), '⑥'); eq(ST.circledDigit(10), '⑩');
    eq(ST.circledDigit(11), '(11)'); eq(ST.circledDigit(12), '(12)');
  });
  test('scoreText: referenceTuning matrix (4, 5, 6, 6 bass clef, 7, 8; none for 3 and 9)', () => {
    eq(ST.referenceTuning(4), ['E1', 'A1', 'D2', 'G2']);
    eq(ST.referenceTuning(5), ['B0', 'E1', 'A1', 'D2', 'G2']);
    eq(ST.referenceTuning(6, 'treble'), ['E2', 'A2', 'D3', 'G3', 'B3', 'E4']);
    eq(ST.referenceTuning(6, 'bass'), ['B0', 'E1', 'A1', 'D2', 'G2', 'C3']);
    eq(ST.referenceTuning(7), ['B1', 'E2', 'A2', 'D3', 'G3', 'B3', 'E4']);
    eq(ST.referenceTuning(8), ['F#1', 'B1', 'E2', 'A2', 'D3', 'G3', 'B3', 'E4']);
    eq(ST.referenceTuning(3), null); eq(ST.referenceTuning(9), null); eq(ST.referenceTuning(4, 'bass'), ['E1', 'A1', 'D2', 'G2']);
  });
  test('scoreText: tuningChartEntries lists differing strings, highest number first, as written without octave', () => {
    eq(ST.tuningChartEntries({ tuning: ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'] }), ['⑥ = D']);
    eq(ST.tuningChartEntries({ tuning: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'] }), []);
    eq(ST.tuningChartEntries({ tuning: ['Eb2', 'Ab2', 'Db3', 'Gb3', 'Bb3', 'Eb4'] }).join(' '), '⑥ = Eb ⑤ = Ab ④ = Db ③ = Gb ② = Bb ① = Eb');
    eq(ST.tuningChartEntries({ tuning: ['Fb2', 'A2', 'D3', 'G3', 'B3', 'E4'] }), [], 'enharmonic equal -> no entry');
    eq(ST.tuningChartEntries({ tuning: ['d1', 'A1', 'D2', 'G2'] }), ['④ = D']);
    eq(ST.tuningChartEntries({ tuning: ['B0', 'E1', 'A1', 'D2', 'G2', 'C3'], clef: 'bass' }), []);
    eq(ST.tuningChartEntries({ tuning: ['A1', 'E2', 'A2', 'D3', 'G3', 'B3', 'E4'] }), ['⑦ = A']);
    eq(ST.tuningChartEntries({ tuning: ['F#1', 'B1', 'E2', 'A2', 'D3', 'G3', 'B3', 'D4'] }), ['① = D']);
    eq(ST.tuningChartEntries({ tuning: ['C1', 'F1', 'B1', 'E2', 'A2', 'D3', 'G3', 'B3', 'E4'] }).length, 9, '9 strings: every string listed');
    eq(ST.tuningChartEntries({ tuning: ['C1', 'F1', 'B1', 'E2', 'A2', 'D3', 'G3', 'B3', 'E4', 'A4', 'D5'] })[0], '(11) = C');
    eq(ST.tuningChartEntries({ tuning: ['X2', null, 7, 'A2x', {}, 'Cb4'] }), ['① = Cb'], 'unparsable skipped, never throws');
    [undefined, null, {}, { tuning: 'E2' }, { tuning: null }].forEach((t) => eq(ST.tuningChartEntries(t), []));
  });
  test('scoreText: capoTuningRows (capo strings, opt-in chart, names only with > 1 visible track, staff-less skipped)', () => {
    const g = (x) => ({ showStandardNotation: true, showTablature: false, tuning: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], ...x });
    eq(ST.capoTuningRows({ tracks: [g({ capo: '2' })] }), [{ name: null, capo: 'Capo fret 2', entries: [] }]);
    eq(ST.capoTuningRows({ tracks: [g({ capo: 2, tuning: ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'] })] }), [{ name: null, capo: 'Capo fret 2', entries: [] }], 'chart is opt-in');
    eq(ST.capoTuningRows({ showTuningChart: 'yes', tracks: [g({ tuning: ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'] })] }), []);
    eq(ST.capoTuningRows({ showTuningChart: true, tracks: [g({ tuning: ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'] })] }), [{ name: null, capo: null, entries: ['⑥ = D'] }]);
    const two = { showTuningChart: true, tracks: [
      g({ name: ' Gt. ', capo: 3 }),
      g({ label: 'B', showStandardNotation: false, showTablature: true, tuning: ['D1', 'A1', 'D2', 'G2'] }),
      g({ showStandardNotation: false, capo: 5 }),
      g({ capo: 4 }),
    ] };
    eq(ST.capoTuningRows(two), [
      { name: 'Gt.', capo: 'Capo fret 3', entries: [] },
      { name: 'B', capo: null, entries: ['④ = D'] },
      { name: 'Track 4', capo: 'Capo fret 4', entries: [] },
    ]);
    eq(ST.capoTuningRows({ tracks: [g({ capo: 0 }), g({ capo: 31 })] }), []);
    eq(ST.capoTuningRows({}), []);
  });
  test('scoreText: [C3] every reference tuning is "standard" (no entries); one raised string gives exactly that string', () => {
    const refs = [
      [['E1', 'A1', 'D2', 'G2'], undefined], [['B0', 'E1', 'A1', 'D2', 'G2'], undefined],
      [['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], undefined], [['B0', 'E1', 'A1', 'D2', 'G2', 'C3'], 'bass'],
      [['B1', 'E2', 'A2', 'D3', 'G3', 'B3', 'E4'], undefined], [['F#1', 'B1', 'E2', 'A2', 'D3', 'G3', 'B3', 'E4'], undefined],
    ];
    for (const [ref, clef] of refs) {
      const n = ref.length;
      eq(ST.tuningChartEntries({ tuning: ref, clef }), [], `${n} strings${clef ? ' ' + clef : ''}: standard`);
      for (let i = 0; i < n; i++) {
        const t = ref.slice();
        t[i] = 'C#5'; // never equal to any reference string
        eq(ST.tuningChartEntries({ tuning: t, clef }), [`${ST.circledDigit(n - i)} = C#`], `${n} strings, index ${i}`);
      }
    }
    // the bass-clef reference is only used for 6 strings with a bass clef; otherwise the guitar 6 applies
    eq(ST.tuningChartEntries({ tuning: ['B0', 'E1', 'A1', 'D2', 'G2', 'C3'] }).length, 6, '6-string bass tuning without a bass clef differs from the guitar reference');
    eq(ST.tuningChartEntries({ tuning: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], clef: 'bass' }).length, 6, 'guitar tuning under a bass clef differs from the bass reference');
    eq(ST.tuningChartEntries({ tuning: ['E1', 'A1', 'D2', 'G2'], clef: 'bass' }), [], '4-string bass is the same with or without a clef');
    eq(ST.tuningChartEntries({ tuning: ['C1', 'F1', 'B1', 'E2', 'A2', 'D3', 'G3', 'B3', 'E4'] }),
      ['⑨ = C', '⑧ = F', '⑦ = B', '⑥ = E', '⑤ = A', '④ = D', '③ = G', '② = B', '① = E'], '9 strings: all, highest number first');
  });
  test('scoreText: [C2] unparsable entries are skipped without throwing, parsable neighbours keep their string numbers', () => {
    const ok = (c, m) => { if (!c) throw new Error(m); };
    const bad = [undefined, null, 5, {}, [], '', 'H2', 'E', '2', 'E#', 'Ex', 'x2'];
    bad.forEach((b) => {
      let r;
      try { r = ST.tuningChartEntries({ tuning: ['D2', b, 'D3', 'G3', 'B3', 'E4'] }); } catch (e) { throw new Error(`threw for ${JSON.stringify(b)}: ${e.message}`); }
      ok(Array.isArray(r) && r[0] === '⑥ = D', `${JSON.stringify(b)}: ${r}`);
      ok(!r.some((x) => x.startsWith('⑤')), `${JSON.stringify(b)}: string 5 skipped`);
    });
  });
  test('scoreText: [C5] tuningLabel is independent of the chart and capo', () => {
    const rows = ST.capoTuningRows({ tuningLabel: 'Drop D', showTuningChart: true, tracks: [{ showStandardNotation: true, tuning: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'] }] });
    eq(rows, []);
  });
}

// ---------- 1.6 score text: sections and repeat counts (navigation merge, layout, drawing) ----------
{
  const { mergeNavigation } = await imp('src/navigation.js');
  const { computeLayout } = await imp('src/layout/index.js');
  const LN = await imp('src/layout/navigation.js');
  const { renderNavigation } = await imp('src/draw/navigation.js');
  const { inkBounds, TEXT_DESCENT_EM } = await imp('src/layout/ink.js');
  const { estimateTextWidth } = await imp('src/textMetrics.js');
  const { group: svgGroup } = await imp('src/draw/svgUtil.js');
  const thm = resolveTheme({});
  const s = thm.staffLineSpacing;
  const ok = (c, m) => { if (!c) throw new Error(m); };
  const near = (a, b, m) => { if (Math.abs(a - b) > 1e-9) throw new Error(`${m}: expected ${b}, got ${a}`); };
  const bar = (extra = {}) => ({ beats: [nq, nq, nq, nq], ...extra });
  const lay = (measures, width = 900, more = []) => computeLayout(normalizeScore({ tracks: [{ measures }, ...more] }), thm, width);
  const kids = (n) => n.children || [];
  const find = (n, pred, out = []) => { if (pred(n)) out.push(n); kids(n).forEach((c) => find(c, pred, out)); return out; };
  const cls = (n) => (n.getAttribute ? n.getAttribute('class') : null) || '';
  const attr = (n, a) => Number(n.getAttribute(a));

  test('[S2,R2] mergeNavigation: section / repeatCount keys only when present; lowest track index wins', () => {
    eq(Object.keys(mergeNavigation([{ measures: [{ section: '  ', repeatCount: 1, barline: 'repeatEnd' }] }], 1)[0]), ['ending', 'segno', 'coda', 'jump']);
    const nav = mergeNavigation([
      { measures: [{}, { section: { letter: 'ABCD' } }, { repeatCount: 'x' }] },
      { measures: [{ section: 'Verse' }, { section: { letter: 'B', text: ' Solo ' } }, { repeatCount: '4', barline: 'repeatEnd' }] },
      { measures: [{ section: 'Chorus' }, null, { repeatCount: 5 }] },
    ], 3);
    eq(nav[0], { ending: null, segno: false, coda: false, jump: null, section: { letter: null, text: 'Verse' } });
    eq(nav[1].section, { letter: 'B', text: 'Solo' });
    eq(nav[2].repeatCount, 4);
  });
  test('[R2] mergeNavigation: repeatCount needs a repeatEnd barline on some track of that measure', () => {
    eq(Object.keys(mergeNavigation([{ measures: [{ repeatCount: 3 }] }], 1)[0]), ['ending', 'segno', 'coda', 'jump']);
    eq(mergeNavigation([{ measures: [{ repeatCount: 3 }] }, { measures: [{ barline: 'repeatEnd' }] }], 1)[0].repeatCount, 3);
    eq(normalizeScore({ tracks: [{ measures: [bar({ repeatCount: 3, barline: 'repeatStart' })] }] }).navigation[0].repeatCount, undefined);
    eq(normalizeScore({ tracks: [{ measures: [bar({ repeatCount: 3, barline: 'repeatEnd' })] }] }).navigation[0].repeatCount, 3);
  });
  test('[S3] section x = segno x (system start and later measures); push right 0.5 s after the previous section', () => {
    const L = lay([bar({ section: { letter: 'A', text: 'Intro' }, segno: true }), bar({ section: 'Verse', segno: true }), bar({ section: 'A very long section name that runs on' }), bar({ section: 'B' })], 900);
    const marks = L.systems[0].marks;
    const segnos = marks.filter((m) => m.kind === 'segno');
    const secs = marks.filter((m) => m.kind === 'section');
    eq(secs.map((m) => [m.mi, m.letter, m.text]), [[0, 'A', 'Intro'], [1, null, 'Verse'], [2, null, 'A very long section name that runs on'], [3, null, 'B']]);
    near(secs[0].x, segnos[0].x, 'system start'); near(secs[1].x, segnos[1].x, 'measure 2');
    near(secs[0].x, LN.measureStartX(L.systems[0], 0, thm), 'measureStartX');
    const m3 = L.systems[0].tracks[0].measures[3];
    const right2 = secs[2].x + LN.sectionParts(secs[2], thm).width;
    ok(right2 + 0.5 * s > m3.x + 0.3 * s, 'fixture: the long section reaches into measure 4');
    near(secs[3].x, right2 + 0.5 * s, 'pushed right');
  });
  test('[S4] sectionParts: boxed letter + tail, or boxed text', () => {
    const p = LN.sectionParts({ letter: 'A', text: 'Intro' }, thm);
    const size = 1.3 * s;
    eq([p.boxed, p.tail], ['A', 'Intro']);
    near(p.boxW, estimateTextWidth('A', size, { bold: true }) + 0.6 * s, 'boxW');
    near(p.tailDx, p.boxW + 0.5 * s, 'tailDx');
    near(p.width, p.tailDx + estimateTextWidth('Intro', size, { bold: true }), 'width');
    const q = LN.sectionParts({ letter: null, text: 'Verse' }, thm);
    eq([q.boxed, q.tail], ['Verse', null]); near(q.width, q.boxW, 'no tail');
  });
  test('[R3] repeatCount mark: x{N} at endX; a jump in the same measure ends 0.5 s before the x3', () => {
    const L = lay([bar(), bar({ repeatCount: '3', barline: 'repeatEnd', jump: 'D.S. al Coda' }), bar({ jump: 'Fine' })], 900);
    const ms = L.systems[0].tracks[0].measures;
    const marks = L.systems[0].marks;
    const rc = marks.find((m) => m.kind === 'repeatCount');
    const jumps = marks.filter((m) => m.kind === 'jump');
    eq([rc.mi, rc.text], [1, 'x3']);
    near(rc.xEnd, ms[1].endX, 'x3 right edge');
    near(jumps[0].xEnd, ms[1].endX - estimateTextWidth('x3', 1.1 * s) - 0.5 * s, 'jump shifted');
    near(jumps[1].xEnd, ms[2].endX, 'other jump unchanged');
  });
  test('[S6,R4] section on a system-start measure and x3 on a system-end measure stay on their systems', () => {
    const plain = lay(Array.from({ length: 12 }, () => bar()), 400);
    const startMi = plain.systems[1].measureIndices[0];
    const endMi = startMi - 1;
    const L = lay(Array.from({ length: 12 }, (_, i) => bar(i === startMi ? { section: 'B' } : i === endMi ? { repeatCount: 2, barline: 'repeatEnd' } : {})), 400);
    eq(L.systems[0].marks.map((m) => [m.kind, m.mi]), [['repeatCount', endMi]]);
    eq(L.systems[1].marks.map((m) => [m.kind, m.mi]), [['section', startMi]]);
    near(L.systems[0].marks[0].xEnd, L.systems[0].tracks[0].measures.at(-1).endX, 'x3 at the system end');
    near(L.systems[1].marks[0].x, LN.measureStartX(L.systems[1], 0, thm), 'section at the system start');
  });
  test('[S4,S5,R3] drawing: classes, x3 on the marks baseline, section tier above voltas and marks, rect counted as ink', () => {
    const L = lay([bar({ section: { letter: 'A', text: 'Intro' }, segno: true, ending: 1, repeatCount: 3, barline: 'repeatEnd', jump: 'D.S.' }), bar({ section: 'Verse' })], 900);
    const g = svgGroup({});
    const navG = renderNavigation(g, L.systems[0], thm);
    const secG = find(navG, (n) => cls(n) === 'section');
    eq(secG.length, 2);
    eq(kids(secG[0]).map((n) => `${n.tag || n.tagName}.${cls(n)}`), ['rect.', 'text.section-letter', 'text.section-text']);
    eq(kids(secG[1]).map((n) => `${n.tag || n.tagName}.${cls(n)}`), ['rect.', 'text.section-text']);
    eq(kids(secG[0])[1].textContent, 'A'); eq(kids(secG[0])[2].textContent, 'Intro');
    const r = kids(secG[0])[0];
    eq([r.getAttribute('fill'), attr(r, 'stroke-width')], ['none', 0.12 * s]);
    const segno = find(navG, (n) => cls(n) === 'segno')[0];
    const x3 = find(navG, (n) => cls(n) === 'repeat-count')[0];
    eq([x3.textContent, x3.getAttribute('text-anchor'), attr(x3, 'font-size')], ['x3', 'end', 1.1 * s]);
    eq(x3.getAttribute('y'), segno.getAttribute('y'), 'same baseline as the segno');
    const jumpText = find(navG, (n) => cls(n) === 'jump')[0];
    eq(kids(jumpText)[0].getAttribute('y'), segno.getAttribute('y'), 'jump on the same baseline');
    const secBase = attr(kids(secG[0])[1], 'y');
    ok(secBase <= -2.5 * s, `section baseline ${secBase}`);
    eq(attr(kids(secG[1])[1], 'y'), secBase, 'one baseline per system');
    const boxBottom = attr(r, 'y') + attr(r, 'height');
    const voltaG = find(navG, (n) => cls(n).startsWith('volta '))[0];
    ok(boxBottom + 0.06 * s <= inkBounds(voltaG, thm).top - 0.75 * s + 1e-9, 'box clears the volta by 0.75 s');
    ok(boxBottom + 0.06 * s <= inkBounds(segno, thm).top - 0.75 * s + 1e-9, 'box clears the segno by 0.75 s');
    near(inkBounds(secG[0], thm).top, attr(r, 'y'), 'rect counted by inkBounds');
  });
  test('[S5] a section alone sits at the 2.5 s minimum; tempo still clears it (drawn after, outermost)', () => {
    const L = lay([bar({ section: 'Verse' }), bar()], 900);
    const g = svgGroup({});
    const navG = renderNavigation(g, L.systems[0], thm);
    const t = find(navG, (n) => cls(n) === 'section-text')[0];
    near(attr(t, 'y'), -2.5 * s, 'minimum baseline');
    const box = makeContainer();
    new MusicScoreRenderer(box, { tempoText: 'q = 120', tracks: [{ measures: [bar({ section: 'Verse' }), bar()] }] }, { width: 900 }).render();
    const svg = box.children[0];
    const tempo = find(svg, (n) => cls(n) === 'tempo')[0];
    const sec = find(svg, (n) => cls(n) === 'section')[0];
    ok(tempo && sec, 'tempo and section drawn');
    ok(inkBounds(tempo, thm).bottom <= inkBounds(sec, thm).top + 1e-9, 'tempo above the section');
  });
  test('[S5] text after the box uses the same baseline; descent = pad + half stroke', () => {
    const L = lay([bar({ section: { letter: 'A', text: 'Intro' } })], 900);
    const navG = renderNavigation(svgGroup({}), L.systems[0], thm);
    const [r, a, b] = kids(find(navG, (n) => cls(n) === 'section')[0]);
    eq(a.getAttribute('y'), b.getAttribute('y'));
    near(attr(r, 'y') + attr(r, 'height'), attr(a, 'y') + 0.3 * s, 'box bottom = baseline + pad');
    near(attr(b, 'x') - attr(r, 'x'), attr(r, 'width') + 0.5 * s, 'tail 0.5 s after the box');
  });
  test('[R1,R2] repeatCount outside 2-99 (1, 100, 0, 2.5) is dropped even on a repeatEnd; 2 and 99 kept; layout has no mark', () => {
    [1, 100, 0, 2.5, -2, 'x', null].forEach((v) => {
      const col = mergeNavigation([{ measures: [{ repeatCount: v, barline: 'repeatEnd' }] }], 1)[0];
      eq(Object.keys(col), ['ending', 'segno', 'coda', 'jump'], String(v));
      eq(lay([bar({ repeatCount: v, barline: 'repeatEnd' })]).systems[0].marks.length, 0, `${v}: no mark`);
    });
    [2, 99].forEach((v) => eq(mergeNavigation([{ measures: [{ repeatCount: v, barline: 'repeatEnd' }] }], 1)[0].repeatCount, v));
  });
  test('[S2,R2] several tracks: section and x3 drawn once per system on the top track only; lowest track wins', () => {
    const t2 = { measures: [bar({ section: 'Other', repeatCount: 5, barline: 'repeatEnd' })] };
    const box = makeContainer();
    new MusicScoreRenderer(box, { tracks: [{ measures: [bar({ section: 'Verse', repeatCount: 3 })] }, t2] }, { width: 900 }).render();
    const svg = box.children[0];
    const staves = find(svg, (n) => cls(n).startsWith('staff staff-'));
    eq(staves.length, 2);
    eq(find(svg, (n) => cls(n) === 'section').length, 1, 'one section');
    eq(find(svg, (n) => cls(n) === 'repeat-count').length, 1, 'one x3');
    eq(find(staves[0], (n) => cls(n) === 'section-text').map((n) => n.textContent), ['Verse'], 'lowest track text, top staff');
    eq(find(staves[0], (n) => cls(n) === 'repeat-count').map((n) => n.textContent), ['x3'], 'lowest track count, top staff');
    eq(find(staves[1], (n) => cls(n) === 'section' || cls(n) === 'repeat-count').length, 0, 'nothing on the lower staff');
  });
}

// ---------- 1.6 score text: beat text (src/draw/beatText.js) ----------
{
  const { inkBounds, TEXT_ASCENT_EM, TEXT_DESCENT_EM } = await imp('src/layout/ink.js');
  const { estimateTextWidth } = await imp('src/textMetrics.js');
  const thm = resolveTheme({});
  const s = thm.staffLineSpacing;
  const ok = (c, m) => { if (!c) throw new Error(m); };
  const near = (a, b, m) => { if (Math.abs(a - b) > 1e-9) throw new Error(`${m}: expected ${b}, got ${a}`); };
  const kids = (n) => n.children || [];
  const find = (n, pred, out = []) => { if (pred(n)) out.push(n); kids(n).forEach((c) => find(c, pred, out)); return out; };
  const cls = (n) => (n.getAttribute ? n.getAttribute('class') : null) || '';
  const num = (n, a) => Number(n.getAttribute(a));
  const render = (score, width = 900) => { const box = makeContainer(); new MusicScoreRenderer(box, score, { width }).render(); return box.children[0]; };
  const staves = (svg) => find(svg, (n) => cls(n).startsWith('staff staff-'));
  const beatTexts = (n) => find(n, (x) => cls(x).startsWith('beat-text'));
  // Ink of `g` under a text's width, without the text itself and anything drawn after it.
  const inkBefore = (g, node, below) => {
    const all = kids(g);
    const clone = { tag: 'g', children: all.slice(0, all.indexOf(node)) };
    const w = estimateTextWidth(node.textContent, num(node, 'font-size'));
    return inkBounds(clone, thm, { xMin: num(node, 'x'), xMax: num(node, 'x') + w, overlap: true })[below ? 'bottom' : 'top'];
  };
  const tabTrack = (measures, x = {}) => ({ showStandardNotation: false, showTablature: true, measures, ...x });
  const tq = (string, fret, extra = {}) => ({ type: 'note', duration: 'quarter', notes: [{ string, fret }], ...extra });

  test('[B1,B3] above: italic 1.2 s, class beat-text, at the beat x, >= 1.5 s above the top line and 0.5 s clear of ink under it', () => {
    const svg = render({ tracks: [{ measures: [{ beats: [{ ...nq, text: ' rit. ' }, { ...nq, notes: [{ pitch: 'A5' }], text: 'molto' }, nq, nq] }] }] });
    const [g] = staves(svg);
    const t = beatTexts(svg);
    eq(t.map((n) => [n.textContent, cls(n), n.getAttribute('font-style'), num(n, 'font-size')]),
      [['rit.', 'beat-text', 'italic', 1.2 * s], ['molto', 'beat-text', 'italic', 1.2 * s]]);
    ok(t.every((n) => kids(g).includes(n)), 'appended to the notation staff group');
    near(num(t[0], 'y'), -1.5 * s, 'low note: minimum height');
    const top = inkBefore(g, t[1], false);
    ok(num(t[1], 'y') < -1.5 * s, 'high note pushes the text up');
    near(num(t[1], 'y'), top - 0.5 * s - TEXT_DESCENT_EM * 1.2 * s, 'clears the ink by 0.5 s');
  });
  test('[B2] grace notes and voice 2 are ignored', () => {
    const svg = render({ tracks: [{ measures: [{ voices: [
      { beats: [{ ...grace, text: 'grace' }, { ...nq, text: 'v1' }, nq, nq, nq] },
      { beats: [{ type: 'note', duration: 'whole', notes: [{ pitch: 'C4' }], text: 'v2' }] },
    ] }] }] });
    eq(beatTexts(svg).map((n) => n.textContent), ['v1']);
  });
  test('[B3] a later text clears an earlier overlapping one (left to right)', () => {
    const e8 = { type: 'note', duration: '8th', notes: [{ pitch: 'E4' }] };
    const svg = render({ tracks: [{ measures: [{ beats: [{ ...e8, text: 'first long text' }, { ...e8, text: 'second' }, nq, nq, nq] }] }] });
    const [a, b] = beatTexts(svg);
    ok(num(b, 'x') < num(a, 'x') + estimateTextWidth(a.textContent, 1.2 * s), 'fixture: the texts overlap horizontally');
    near(num(b, 'y'), num(a, 'y') - TEXT_ASCENT_EM * 1.2 * s - 0.5 * s - TEXT_DESCENT_EM * 1.2 * s, 'stacked 0.5 s above');
  });
  test('[B4] below: on the bottom staff (TAB of notation + TAB), 0.5 s below its ink, class beat-text beat-text-below', () => {
    const svg = render({ tracks: [{ showTablature: true, measures: [{ beats: [tq(6, 0, { text: { text: 'let go', below: true } }), tq(1, 0, { text: 'up' }), tq(3, 2), tq(3, 2)] }] }] });
    const [notationG, tabG] = staves(svg);
    const [up] = beatTexts(notationG);
    const [down] = beatTexts(tabG);
    eq([up.textContent, cls(up), down.textContent, cls(down)], ['up', 'beat-text', 'let go', 'beat-text beat-text-below']);
    near(num(down, 'y'), inkBefore(tabG, down, true) + 0.5 * s + TEXT_ASCENT_EM * 1.2 * s, 'below the TAB ink');
    eq(beatTexts(tabG).length, 1);
  });
  test('[B3] TAB-only: above the TAB top line (>= 1.5 s), below under the bottom line', () => {
    const svg = render({ tracks: [tabTrack([{ beats: [tq(3, 0, { text: 'hi' }), tq(3, 0, { text: { text: 'lo', below: true } }), tq(3, 0), tq(3, 0)] }])] });
    const [tabG] = staves(svg);
    const [hi, lo] = beatTexts(tabG);
    const lines = find(tabG, (n) => (n.tag || n.tagName) === 'line' && num(n, 'y1') === num(n, 'y2') && num(n, 'x2') - num(n, 'x1') > 100);
    const topLine = Math.min(...lines.map((n) => num(n, 'y1')));
    const bottomLine = Math.max(...lines.map((n) => num(n, 'y1')));
    ok(num(hi, 'y') <= topLine - 1.5 * s + 1e-9, `above ${num(hi, 'y')} vs top line ${topLine}`);
    ok(num(lo, 'y') - TEXT_ASCENT_EM * 1.2 * s >= bottomLine + 0.5 * s - 1e-9, 'below clears the bottom line');
  });
  test('[B5] order outward: fermata < beat text < voltas / navigation marks; hidden-rest text at its x', () => {
    const svg = render({ tracks: [{ measures: [{ ending: 1, segno: true, beats: [{ ...nq, fermata: true, chord: 'Am', text: 'hold' }, nq, nq, { type: 'rest', duration: 'quarter', hidden: true, text: 'cue' }] }] }] });
    const [g] = staves(svg);
    const hold = beatTexts(g)[0];
    const ferm = find(g, (n) => cls(n) === 'fermata')[0];
    const chord = find(g, (n) => cls(n).includes('chord-symbol'))[0];
    ok(inkBounds(ferm, thm).top >= num(hold, 'y') + TEXT_DESCENT_EM * 1.2 * s + 0.5 * s - 1e-9, 'beat text above the fermata');
    if (chord) ok(inkBounds(chord, thm).top > num(hold, 'y'), 'beat text above the chord symbol');
    const ch = kids(g);
    const nav = find(g, (n) => cls(n) === 'navigation')[0];
    ok(ch.indexOf(ferm) >= 0 && ch.indexOf(ferm) < ch.indexOf(hold), 'fermata drawn before');
    ok(ch.indexOf(hold) < ch.indexOf(nav), 'navigation drawn after');
    const volta = find(nav, (n) => cls(n).startsWith('volta '))[0];
    ok(inkBounds(volta, thm).bottom <= num(hold, 'y') - TEXT_ASCENT_EM * 1.2 * s - 0.5 * s + 1e-9, 'volta hooks clear the beat text');
    eq(beatTexts(g).map((n) => n.textContent), ['hold', 'cue']);
  });
  test('[B2,B4] notation-only track: below text sits under the notation staff; rests and text on non-first measures are drawn; invalid text ignored', () => {
    const svg = render({ tracks: [{ measures: [
      { beats: [{ ...nq, text: { text: 'down', below: true } }, { type: 'rest', duration: 'quarter', text: 'r' }, { ...nq, text: { text: 'no', below: 'true' } }, { ...nq, text: { below: true } }] },
      { beats: [{ ...nq, text: 7 }, { ...nq, text: '  ' }, { ...nq, text: ' later ' }, nq] },
    ] }] });
    const [g] = staves(svg);
    const t = beatTexts(g);
    eq(t.map((n) => [n.textContent, cls(n)]), [['down', 'beat-text beat-text-below'], ['r', 'beat-text'], ['no', 'beat-text'], ['later', 'beat-text']]);
    const down = t[0];
    near(num(down, 'y'), inkBefore(g, down, true) + 0.5 * s + TEXT_ASCENT_EM * 1.2 * s, 'below clears the notation ink by 0.5 s');
  });
  test('[B5] MusicScoreRenderer.js source order renderFermatas( < renderBeatText( < renderNavigation( < drawTempo(', () => {
    const src = fs.readFileSync(path.join(root0, 'src/MusicScoreRenderer.js'), 'utf8');
    const a = src.indexOf('renderFermatas('), b = src.indexOf('renderBeatText('), c = src.indexOf('renderNavigation('), d = src.indexOf('drawTempo(');
    ok(a >= 0 && b > a && c > b && d > c, `order ${a} ${b} ${c} ${d}`);
  });
}

// ---------- 1.6 score text: header rows and capo / tuning chart (src/draw/header.js) ----------
{
  const { drawScoreHeader } = await imp('src/draw/header.js');
  const { estimateTextWidth } = await imp('src/textMetrics.js');
  const { group: svgGroup } = await imp('src/draw/svgUtil.js');
  const thm = resolveTheme({});
  const s = thm.staffLineSpacing;
  const near = (a, b, m) => { if (Math.abs(a - b) > 1e-9) throw new Error(`${m}: expected ${b}, got ${a}`); };
  const kids = (n) => n.children || [];
  const cls = (n) => (n.getAttribute ? n.getAttribute('class') : null) || '';
  const num = (n, a) => Number(n.getAttribute(a));
  const hdr = (sc) => { const svg = svgGroup({}); const r = drawScoreHeader(svg, sc, thm, 10, 900); return { r, g: kids(svg)[0], svg }; };
  const rowsOf = (g) => kids(g).map((n) => [cls(n), n.textContent, num(n, 'y')]);
  const g6 = (x) => ({ showStandardNotation: true, showTablature: false, tuning: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], ...x });

  test('[H1] row order and gaps: 2.5 s after the title, 2.0 s otherwise, 1.6 s within instructions', () => {
    const h = hdr({
      title: 'T', subtitle: ' Sub ', artist: 'Art', album: 'Alb', composer: 'C', tuningLabel: 'Drop D',
      words: 'W', music: 'M', instructions: 'one\n\n two ', tracks: [g6({ capo: 2 })],
    });
    const t0 = 10 + 0.75 * 2.4 * s;
    const y = [t0, t0 + 2.5 * s];
    for (let i = 0; i < 6; i++) y.push(y[y.length - 1] + 2.0 * s);
    eq(kids(h.g).map(cls), ['title', 'subtitle', 'artist', 'album', 'tuning', 'composer', 'words', 'music', 'instructions', 'instructions', 'tuning-chart']);
    const ys = kids(h.g).map((n) => (cls(n) === 'tuning-chart' ? num(kids(n)[0], 'y') : num(n, 'y')));
    [y[0], y[1], y[2], y[3], y[4], y[4], y[5], y[5], y[6]].forEach((v, i) => near(ys[i], v, `row ${i}`));
    near(ys[9], y[6] + 1.6 * s, 'second instructions line');
    near(ys[10], y[6] + 1.6 * s + 2.0 * s, 'tuning chart after instructions');
    near(h.r, ys[10], 'returns the last baseline');
    eq(kids(h.g).slice(1, 4).map((n) => [n.textContent, n.getAttribute('text-anchor'), num(n, 'font-size')]),
      [['Sub', 'middle', 1.6 * s], ['Art', 'middle', 1.4 * s], ['Alb', 'middle', 1.3 * s]]);
    const [w, m] = kids(h.g).slice(6, 8);
    eq([w.textContent, num(w, 'x'), w.getAttribute('font-style'), m.textContent, m.getAttribute('text-anchor'), num(m, 'x')],
      ['Words by W', thm.marginLeftSp * s, null, 'Music by M', 'end', 900 - thm.marginRightSp * s]);
    const ins = kids(h.g)[8];
    eq([ins.textContent, ins.getAttribute('font-style'), num(ins, 'font-size'), num(ins, 'x')], ['one', 'italic', 1.2 * s, thm.marginLeftSp * s]);
  });
  test('[H1] empty rows take no space; a non-title first row starts at its cap height', () => {
    const h = hdr({ subtitle: '  ', artist: 'A', words: '', music: null, instructions: '\n' });
    eq(rowsOf(h.g), [['artist', 'A', 10 + 0.75 * 1.4 * s]]);
    const k = hdr({ title: 'T', album: 'X' });
    eq(rowsOf(k.g), [['title', 'T', 28], ['album', 'X', 28 + 2.5 * s]]);
    eq(hdr({ subtitle: 7, artist: {}, words: [], instructions: 5, tracks: [g6({ capo: 0 })] }).r, null);
  });
  test('[H1] Words & Music when words equals music after canonicalization', () => {
    const h = hdr({ words: ' Jane  Doe', music: 'Jane Doe ' });
    eq(kids(h.g).map((n) => [cls(n), n.textContent, n.getAttribute('text-anchor')]), [['words-music', 'Words & Music by Jane Doe', 'end']]);
    eq(rowsOf(hdr({ music: 'M' }).g).map((r) => r.slice(0, 2)), [['music', 'Music by M']]);
    eq(rowsOf(hdr({ words: 'W' }).g).map((r) => r.slice(0, 2)), [['words', 'Words by W']]);
  });
  test('[H3] instructions: at most 8 lines, empty dropped, 1.6 s apart', () => {
    const h = hdr({ instructions: ['a', '', ...Array.from({ length: 10 }, (_, i) => ` l${i} `)].join('\r\n') });
    const lines = kids(h.g);
    eq(lines.map((n) => n.textContent), ['a', 'l0', 'l1', 'l2', 'l3', 'l4', 'l5', 'l6']);
    lines.forEach((n, i) => near(num(n, 'y'), 10 + 0.75 * 1.2 * s + i * 1.6 * s, `line ${i}`));
  });
  test('[G3] header text is escaped text content (no child elements)', () => {
    const h = hdr({ subtitle: '<b>&', instructions: '<i>x</i>' });
    kids(h.g).forEach((n) => eq(kids(n).length, 0));
    eq(kids(h.g).map((n) => n.textContent), ['<b>&', '<i>x</i>']);
    const out = serialize(h.g);
    eq(out.includes('&lt;b&gt;&amp;') && !out.includes('<b>'), true, out);
  });
  test('[C1,C4] capo / tuning chart line: pieces, gaps, name prefix only with > 1 visible track, tuningLabel independent', () => {
    const h = hdr({ showTuningChart: true, tuningLabel: 'Drop D', tracks: [g6({ capo: '2', tuning: ['D2', 'A2', 'D3', 'G3', 'B3', 'D4'] })] });
    const [tuning, chart] = kids(h.g);
    eq([cls(tuning), tuning.textContent], ['tuning', 'Drop D']);
    eq(cls(chart), 'tuning-chart');
    const p = kids(chart);
    eq(p.map((n) => n.textContent), ['Capo fret 2', '⑥ = D', '① = D']);
    const size = 1.2 * s;
    near(num(p[0], 'x'), thm.marginLeftSp * s, 'left margin');
    near(num(p[1], 'x'), num(p[0], 'x') + estimateTextWidth('Capo fret 2', size) + 1.5 * s, 'capo gap');
    near(num(p[2], 'x'), num(p[1], 'x') + estimateTextWidth('⑥ = D', size) + 1.0 * s, 'entry gap');
    p.forEach((n) => eq([num(n, 'font-size'), n.getAttribute('y')], [size, p[0].getAttribute('y')]));
    const two = hdr({ showTuningChart: true, tracks: [
      g6({ name: 'Gt.', tuning: ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'] }),
      g6({ showStandardNotation: false, showTablature: true, tuning: ['D1', 'A1', 'D2', 'G2'] }),
      g6({ showStandardNotation: false, capo: 4 }),
    ] });
    const charts = kids(two.g);
    eq(charts.map((c) => kids(c).map((n) => n.textContent)), [['Gt.: ⑥ = D'], ['Track 2: ④ = D']]);
    near(num(kids(charts[1])[0], 'y') - num(kids(charts[0])[0], 'y'), 1.6 * s, 'lines 1.6 s apart');
  });
  test('[C4] capo line shows without showTuningChart; nothing to show -> no line', () => {
    eq(kids(hdr({ tracks: [g6({ capo: 5, tuning: ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'] })] }).g).map((c) => kids(c).map((n) => n.textContent)), [['Capo fret 5']]);
    eq(hdr({ showTuningChart: true, tracks: [g6({})] }).r, null);
  });
  test('[C2] tuning chart through the renderer: notation-only track contributes; standard tuning adds nothing', () => {
    const box = makeContainer();
    new MusicScoreRenderer(box, { showTuningChart: true, tracks: [{ tuning: ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'], measures: [{ beats: [nq] }] }] }, { width: 900 }).render();
    const out = serialize(box.children[0]);
    eq(out.includes('class="tuning-chart"') && out.includes('⑥ = D'), true);
    const box2 = makeContainer();
    new MusicScoreRenderer(box2, { showTuningChart: true, tracks: [{ measures: [{ beats: [nq] }] }] }, { width: 900 }).render();
    eq(serialize(box2.children[0]).includes('score-header'), false);
  });
}

// ---------- 1.6 score text: copyright footer (drawScoreFooter, placeStaves.contentBottom) ----------
{
  const { drawScoreFooter } = await imp('src/draw/header.js');
  const { placeStaves, BOTTOM_MARGIN_SP } = await imp('src/layout/vertical.js');
  const { group: svgGroup } = await imp('src/draw/svgUtil.js');
  const thm = resolveTheme({});
  const s = thm.staffLineSpacing;
  const near = (a, b, m) => { if (Math.abs(a - b) > 1e-9) throw new Error(`${m}: expected ${b}, got ${a}`); };
  const close = (a, b, m) => { if (Math.abs(a - b) > 0.011) throw new Error(`${m}: expected ${b}, got ${a}`); }; // 2-dp output
  const kids = (n) => n.children || [];
  const cls = (n) => (n.getAttribute ? n.getAttribute('class') : null) || '';
  const num = (n, a) => Number(n.getAttribute(a));
  const render = (score) => { const box = makeContainer(); new MusicScoreRenderer(box, score, { width: 600 }).render(); return box.children[0]; };
  const base = (x = {}) => ({ title: 'T', ...x, tracks: [{ showTablature: true, measures: Array.from({ length: 10 }, () => ({ beats: [nq, nq, nq, { ...nq, notes: [{ pitch: 'E3' }] }] })) }] });
  const staffYs = (svg) => serialize(svg).match(/translate\(0,[^)]*\)/g);

  test('[H4] placeStaves: contentBottom = last staff bottom ink; height = contentBottom + BOTTOM_MARGIN_SP', () => {
    eq(BOTTOM_MARGIN_SP, 3);
    const p = placeStaves([[{ ti: 0, kind: 'notation', lineBottom: 40, ink: { top: -5, bottom: 52 } }]], thm, 100, false);
    near(p.contentBottom, 105 + 52, 'contentBottom');
    near(p.height, p.contentBottom + 3 * s, 'height');
  });
  test('[H4] drawScoreFooter: centred 1.0 s lines 1.4 s apart from contentBottom + 2 s; null and nothing appended without copyright', () => {
    const svg = svgGroup({});
    const r = drawScoreFooter(svg, { copyright: ' (c) 2026  Someone \n\n All rights reserved ' }, thm, 500, 900);
    const [g] = kids(svg);
    eq(cls(g), 'score-footer');
    eq(kids(g).map((n) => [cls(n), n.textContent, num(n, 'x'), num(n, 'font-size'), n.getAttribute('text-anchor')]),
      [['copyright', '(c) 2026 Someone', 450, 1.0 * s, 'middle'], ['copyright', 'All rights reserved', 450, 1.0 * s, 'middle']]);
    near(num(kids(g)[0], 'y'), 500 + 2 * s, 'first baseline'); near(num(kids(g)[1], 'y'), 500 + 2 * s + 1.4 * s, 'second');
    near(r, 500 + 3.4 * s, 'returns the last baseline');
    [undefined, null, '', ' \n ', 5, {}, ['x']].forEach((c) => {
      const e = svgGroup({});
      eq(drawScoreFooter(e, { copyright: c }, thm, 500, 900), null);
      eq(kids(e).length, 0);
    });
    const many = svgGroup({});
    drawScoreFooter(many, { copyright: Array.from({ length: 12 }, (_, i) => `c${i}`).join('\n') }, thm, 0, 900);
    eq(kids(kids(many)[0]).length, 8, 'at most 8 lines');
  });
  test('[H4] renderer: copyright 2 s below the last ink, height = last baseline + 3 s, viewBox matches, staves unmoved', () => {
    const plain = render(base());
    const withC = render(base({ copyright: 'Line one\nLine two' }));
    const h0 = num(plain, 'height');
    const lastInk = h0 - 3 * s;
    const lines = serialize(withC).match(/<text [^>]*class="copyright"[^>]*>/g);
    eq(lines.length, 2);
    const ys = lines.map((l) => Number(/ y="([^"]+)"/.exec(l)[1]));
    close(ys[0], lastInk + 2 * s, 'first baseline');
    close(ys[1] - ys[0], 1.4 * s, 'step');
    close(num(withC, 'height'), ys[1] + 3 * s, 'height');
    eq(withC.getAttribute('viewBox'), `0 0 600 ${withC.getAttribute('height')}`);
    eq(staffYs(withC), staffYs(plain));
    eq(serialize(render(base({ copyright: '  ' }))), serialize(plain), 'empty copyright: byte-identical');
  });
}

// ---------- pre-1.7 characterization: pins taken from the code before ornaments, hand marks and barre ----------
// Exact x / y numbers (theme.staffLineSpacing 10, width 900 unless stated) of the playing-direction stack
// (draw/passes/playingDirections.js) that 1.7.0 reorganises: slur clearance, beam-group sharing, trill and
// strum runs, and the tab-only pick stroke. Small inline scores; the 1.7.0 rework must leave every number alone.
{
  const { characterizationCases } = await imp('tests/fixtures/characterization.js');
  const render = (score, width = 900) => {
    const box = makeContainer();
    new MusicScoreRenderer(box, JSON.parse(JSON.stringify(score)), { width }).render();
    return box.children[0];
  };
  const walk = (n, out = []) => { out.push(n); n.children.forEach((c) => walk(c, out)); return out; };
  const byClass = (root, cls) => walk(root).filter((n) => (n.getAttribute('class') || '').split(' ').includes(cls));
  const xy = (g) => [g.children[0].getAttribute('x'), g.children[0].getAttribute('y')];
  const pickOf = (svg) => [...byClass(svg, 'pick-stroke-down'), ...byClass(svg, 'pick-stroke-up')].map(xy);
  const nq = (pitch, extra = {}) => ({ type: 'note', duration: 'quarter', notes: [{ pitch }], ...extra });
  const n8 = (pitch, extra = {}) => ({ type: 'note', duration: '8th', notes: [{ pitch }], ...extra });
  const one = (beats) => ({ tracks: [{ measures: [{ beats }] }] });
  const nums = (d) => d.match(/-?\d+(\.\d+)?/g).map(Number);

  test('pre-1.7 (a): pick stroke under the second segment of a split slur sits at y -22.48; the same beat without the slur at -10', () => {
    const mk = (slur) => ({ tracks: [{ measures: [
      { beats: [nq('E4'), nq('G4'), nq('B4'), nq('D5', slur ? { slurStart: true } : {})] },
      { beats: [nq('F4', { slurEnd: slur, pickStroke: 'down' }), nq('G4'), nq('A4'), nq('B4')] },
    ] }] });
    const split = render(mk(true), 300);
    eq(byClass(split, 'staff').length, 2, 'two systems');
    eq(byClass(split, 'slur').length, 2, 'the slur is split into two segments');
    eq(pickOf(split), [['87.74', '-22.48']]);
    const plain = render(mk(false), 300);
    eq(byClass(plain, 'slur').length, 0);
    eq(pickOf(plain), [['87.74', '-10']]);
  });

  test('pre-1.7 (b): picks of a beam group with a high and a low note share one y; a T on either note stays under the shared line', () => {
    const rest = [n8('E4'), n8('E4'), nq('E4'), nq('E4')];
    const lowPick = (extra = {}) => n8('C4', { pickStroke: 'down', ...extra });
    const highPick = (extra = {}) => n8('A5', { pickStroke: 'up', ...extra });
    const tapped = (b) => ({ ...b, notes: [{ ...b.notes[0], tap: true }] });
    eq(pickOf(render(one([lowPick(), highPick(), ...rest]))), [['115.74', '-20'], ['140.49', '-20']], 'shared by the high note');
    eq(pickOf(render(one([lowPick(), n8('C4', { pickStroke: 'up' }), ...rest]))), [['115.74', '-10'], ['140.49', '-10']], 'two low picks alone');
    const lowT = render(one([tapped(lowPick()), highPick(), ...rest]));
    eq(pickOf(lowT), [['115.74', '-25.55'], ['140.49', '-25.55']], 'both lifted above the low note\'s T');
    eq(byClass(lowT, 'tap').map((g) => [...xy(g), g.children[0].textContent]), [['115.74', '-12.75', 'T']]);
    const highT = render(one([lowPick(), tapped(highPick()), ...rest]));
    eq(pickOf(highT), [['115.74', '-35.55'], ['140.49', '-35.55']]);
    eq(byClass(highT, 'tap').map(xy), [['140.49', '-22.75']]);
  });

  test('pre-1.7 (c): two trills with a grace between share one line y (-50.63); the first wave ends at 139.34, before the second "tr" at 165.24', () => {
    const half = (pitch, extra = {}) => ({ type: 'note', duration: 'half', notes: [{ pitch, ...extra }] });
    const svg = render(one([half('E4', { trill: true }), { type: 'grace', duration: '16th', notes: [{ pitch: 'D4' }] }, half('G6', { trill: true })]));
    const trills = byClass(svg, 'trill');
    eq(trills.map(xy), [['115.74', '-50.63'], ['165.24', '-50.63']]);
    const wave = trills.map((g) => nums(g.children.find((c) => c.tag === 'path').getAttribute('d')));
    eq([wave[0][0], wave[0].slice(-2)], [128.87, [139.34, -55.63]]);
    eq([wave[1][0], wave[1].slice(-2)], [178.36, [204.73, -55.63]]);
    eq(wave[0].slice(-2)[0] < 165.24, true, 'first wave ends before the second "tr"');
    const lone = render(one([{ type: 'note', duration: 'quarter', notes: [{ pitch: 'E4', trill: true }] }, nq('E4'), nq('E4'), nq('E4')]));
    eq(byClass(lone, 'trill').map((g) => g.children[0].getAttribute('y')), ['-10.63'], 'the low trill alone');
  });

  test('pre-1.7 (d): a strum run on a notation-only track shares one bottom (-20) set by the high note; a low strum alone sits at -10', () => {
    const arrows = (svg) => byClass(svg, 'strum').map((g) => g.children.map((c) => c.getAttribute('d')));
    const svg = render(one([nq('E4', { strum: 'down' }), nq('A5', { strum: 'up' }), nq('E4', { strum: 'down' }), nq('E4')]));
    eq(arrows(svg), [
      ['M 115.74 -35 L 115.74 -24', 'M 115.74 -20 L 112.74 -25 L 118.74 -25 Z'],
      ['M 150.74 -20 L 150.74 -31', 'M 150.74 -35 L 153.74 -30 L 147.74 -30 Z'],
      ['M 185.74 -35 L 185.74 -24', 'M 185.74 -20 L 182.74 -25 L 188.74 -25 Z'],
    ]);
    const low = render(one([nq('E4', { strum: 'down' }), nq('E4'), nq('E4'), nq('E4')]));
    eq(arrows(low), [['M 115.74 -25 L 115.74 -14', 'M 115.74 -10 L 112.74 -15 L 118.74 -15 Z']]);
  });

  test('pre-1.7 (e): tab-only pick stroke clears an H letter (-31, letter -17) and a P.M. label (-18.8, label -6); bare -11', () => {
    const t = (fret, extra = {}, note = {}) => ({ type: 'note', duration: '16th', notes: [{ string: 1, fret, ...note }], ...extra });
    const texts = (svg, s) => walk(svg).filter((n) => n.tag === 'text' && n.textContent === s).map((n) => n.getAttribute('y'));
    const score = (beats) => ({ tracks: [{ showStandardNotation: false, showTablature: true, measures: [{ beats }] }] });
    eq(pickOf(render(score([t(2), t(4, { pickStroke: 'down' }), t(2, { pickStroke: 'up' }), t(4)]))), [['121.19', '-11'], ['139.19', '-11']]);
    const hp = render(score([t(2, {}, { hammerPull: true }), t(4, { pickStroke: 'down' }), t(2, { pickStroke: 'up' }), t(4)]));
    eq(pickOf(hp), [['121.19', '-31'], ['139.19', '-11']]);
    eq(texts(hp, 'H'), ['-17']);
    const pmBeats = (note) => [t(2, { palmMute: true }, note), t(4, { pickStroke: 'down', palmMute: true }), t(2, { pickStroke: 'up', palmMute: true }), t(4)];
    const pm = render(score(pmBeats({})));
    eq(pickOf(pm), [['121.19', '-18.8'], ['139.19', '-16.27']]);
    eq(texts(pm, 'P.M.'), ['-6']);
    const both = render(score(pmBeats({ hammerPull: true })));
    eq(pickOf(both), [['121.19', '-31'], ['139.19', '-16.27']]);
    eq([texts(both, 'H'), texts(both, 'P.M.')], [['-17'], ['-6']]);
  });

  test('pre-1.7 audit: char-directions-break, char-techniques-11-break and char-strum-arpeggio-break still hit the stack paths, with these counts', () => {
    const audit = (name) => {
      const f = characterizationCases.find((c) => c.name === name);
      const svg = render(f.score, f.width);
      const trills = byClass(svg, 'trill');
      return {
        picks: pickOf(svg), taps: byClass(svg, 'tap').length,
        trills: trills.length, trillWaves: trills.filter((g) => g.children.some((c) => c.tag === 'path')).length,
        strums: byClass(svg, 'strum').length, slurs: byClass(svg, 'slur').length, staves: byClass(svg, 'staff').length,
      };
    };
    eq(audit('directions-break'), { picks: [['202.48', '-40.55']], taps: 2, trills: 0, trillWaves: 0, strums: 0, slurs: 1, staves: 4 },
      'one pick stroke stacked above its T (notation + TAB tap); no beam group, trill or strum');
    eq(audit('techniques-11-break'), { picks: [], taps: 0, trills: 4, trillWaves: 3, strums: 0, slurs: 3, staves: 8 },
      'four trills, three with a wave (one too short for it); no pick strokes');
    eq(audit('strum-arpeggio-break'), { picks: [], taps: 0, trills: 0, trillWaves: 0, strums: 10, slurs: 0, staves: 6 },
      'ten strum arrows; no pick strokes, no slurs');
  });
}

/// ---------- 1.7.0 hand marks: canonicalizers and beat readers (hands.js) ----------
{
  const hands = await imp('src/hands.js');
  const { beatTapMark } = await imp('src/directions.js');
  const { ornamentOf, fingerOf, rightFingerOf, golpeOf, pickScrapeOf, barreOf, romanNumeral, barreLabel } = hands;
  const GARBAGE = [undefined, null, 0, '', {}, [], 'trill', 5, -1, 1.5, 'pi', 25, 'II', { half: true }, false, NaN, '  '];
  // Each canonicalizer: [raw, canonical] pairs, garbage -> null (unless listed), idempotent, never throws.
  const table = (name, fn, pairs) => test(`hands: ${name} canonicalizes, rejects garbage, is idempotent`, () => {
    pairs.forEach(([raw, want]) => {
      eq(fn(raw), want, `${name}(${JSON.stringify(raw)})`);
      eq(fn(fn(raw)), want, `${name} idempotent on ${JSON.stringify(raw)}`);
    });
    GARBAGE.filter((g) => !pairs.some(([raw]) => Object.is(raw, g))).forEach((g) => eq(fn(g), null, `${name}(${JSON.stringify(g)})`));
    ['toString', 'constructor', '__proto__', Symbol('x'), () => 1].forEach((g) => eq(fn(g), null, `${name}(${String(g)})`));
  });
  table('ornamentOf', ornamentOf, [
    ['turn', 'turn'], [' TURN ', 'turn'], ['Inverted-Turn', 'invertedTurn'], ['turn_inverted', 'invertedTurn'], ['invertedTurn', 'invertedTurn'],
    [' short trill ', 'upperMordent'], ['upper mordent', 'upperMordent'], ['invertedMordent', 'upperMordent'], ['upperMordent', 'upperMordent'],
    ['mordent', 'lowerMordent'], ['Lower-Mordent', 'lowerMordent'], ['lowerMordent', 'lowerMordent'],
  ]);
  table('fingerOf', fingerOf, [[0, 0], [1, 1], [4, 4], [' 3 ', 3], ['0', 0], ['T', 'T'], [' t ', 'T']]);
  test('hands: fingerOf rejects 5, -1, 1.5, "12", "TT", true', () => [5, -1, 1.5, '12', 'TT', true, '1.0'].forEach((g) => eq(fingerOf(g), null, String(g))));
  table('rightFingerOf', rightFingerOf, [['p', 'p'], [' I ', 'i'], ['M', 'm'], ['a', 'a'], ['C', 'c']]);
  test('hands: rightFingerOf rejects "x", "pi", true', () => ['x', 'pi', true, 'pp'].forEach((g) => eq(rightFingerOf(g), null, String(g))));
  table('golpeOf', golpeOf, [[true, true], ['thumb', 'thumb'], [' Finger ', 'finger']]);
  table('pickScrapeOf', pickScrapeOf, [[true, true], ['down', 'down'], [' UP ', 'up']]);
  table('barreOf', barreOf, [
    [1, { fret: 1, half: false }], [5, { fret: 5, half: false }], [24, { fret: 24, half: false }], [' 7 ', { fret: 7, half: false }],
    [{ fret: 2 }, { fret: 2, half: false }], [{ fret: '5', half: true }, { fret: 5, half: true }], [{ fret: 5, half: 'yes' }, { fret: 5, half: false }],
  ]);
  test('hands: barreOf rejects out-of-range and non-integer frets', () => [0, 25, 1.5, '1.5', { fret: 0 }, { fret: 25 }, { fret: 'II' }, true, 'C II']
    .forEach((g) => eq(barreOf(g), null, JSON.stringify(g))));
  test('hands: romanNumeral 1-24 and barreLabel', () => {
    eq(Array.from({ length: 24 }, (_, i) => romanNumeral(i + 1)).join(' '),
      'I II III IV V VI VII VIII IX X XI XII XIII XIV XV XVI XVII XVIII XIX XX XXI XXII XXIII XXIV');
    eq([barreLabel({ fret: 2, half: false }), barreLabel({ fret: 5, half: true }), barreLabel(barreOf(24))], ['C II', '½C V', 'C XXIV']);
  });
  const beat = (notes, extra = {}) => ({ type: 'note', duration: 'quarter', notes, ...extra });
  test('hands: beatOrnament - first valid ornament; a trill wins; graces and rests carry none', () => {
    eq(hands.beatOrnament(beat([{ pitch: 'E4', ornament: 'bogus' }, { pitch: 'G4', ornament: 'mordent' }])), 'lowerMordent');
    eq(hands.beatOrnament(beat([{ pitch: 'E4', ornament: 'turn' }, { pitch: 'G4', trill: true }])), null);
    eq(hands.beatOrnament({ type: 'grace', duration: '16th', notes: [{ pitch: 'E4', ornament: 'turn' }] }), null);
    eq(hands.beatOrnament({ type: 'rest', duration: 'quarter', ornament: 'turn' }), null);
    eq(hands.beatOrnament(beat([{ pitch: 'E4' }])), null);
  });
  test('hands: beat readers for golpe, pick scrape and barre skip rests and graces', () => {
    eq([hands.beatGolpe(beat([{ pitch: 'E4' }], { golpe: 'thumb' })), hands.beatGolpe({ type: 'rest', duration: 'quarter', golpe: true })], ['thumb', null]);
    eq([hands.beatPickScrape(beat([{ pitch: 'E4' }], { pickScrape: 'up' })), hands.beatPickScrape({ type: 'grace', notes: [{ pitch: 'E4' }], pickScrape: true })], ['up', null]);
    eq([hands.beatBarre(beat([{ pitch: 'E4' }], { barre: { fret: 5, half: true } })), hands.beatBarre({ type: 'rest', duration: 'quarter', barre: 2 })],
      [{ fret: 5, half: true }, null]);
  });
  test('hands: beatTapMark priority tap > leftHandTap > slap > pop; a tapped harmonic gets no LH mark', () => {
    eq(beatTapMark(beat([{ pitch: 'E4', leftHandTap: true }, { pitch: 'G4', tap: true }])), 'tap');
    eq(beatTapMark(beat([{ pitch: 'E4', slap: true }, { pitch: 'G4', leftHandTap: 1 }])), 'leftHandTap');
    eq(beatTapMark(beat([{ pitch: 'E4', leftHandTap: true, harmonic: 'tapped' }])), null);
    eq(beatTapMark(beat([{ pitch: 'E4', leftHandTap: true, harmonic: 'tapped' }, { pitch: 'G4', pop: true }])), 'pop');
    eq(beatTapMark({ type: 'rest', duration: 'quarter', notes: [{ pitch: 'E4', leftHandTap: true }] }), null);
  });
  test('hands: rightFingerStack - lowest note first by pitch, else by string (higher number lower); null when none', () => {
    eq(hands.rightFingerStack(beat([{ pitch: 'E5', rightFinger: 'a' }, { pitch: 'E3', rightFinger: 'P' }, { pitch: 'B4', rightFinger: 'm' }, { pitch: 'G4' }])), ['p', 'm', 'a']);
    eq(hands.rightFingerStack(beat([{ string: 1, fret: 0, rightFinger: 'i' }, { string: 5, fret: 0, rightFinger: 'p' }])), ['p', 'i']);
    eq(hands.rightFingerStack(beat([{ pitch: 'E4', rightFinger: 'x' }])), null);
    eq(hands.rightFingerStack({ type: 'grace', notes: [{ pitch: 'E4', rightFinger: 'p' }] }), null);
  });
  test('hands: normalizeScore keeps beat / note keys when no hand field is present; withHand* return their input', () => {
    const raw = { tracks: [{ measures: [{ beats: [beat([{ pitch: 'E4', leftHandTap: true }], { letRing: true })] }] }] };
    const b = normalizeScore(raw).tracks[0].measures[0].beats[0];
    eq(Object.keys(b), ['dots', 'type', 'duration', 'notes', 'letRing']);
    eq(Object.keys(b.notes[0]), ['pitch', 'leftHandTap', 'soundingPitch']);
    const n = { pitch: 'E4', leftHandTap: true };
    eq(hands.withHandNote(n) === n, true);
    const bb = { type: 'note', letRing: true };
    eq(hands.withHandBeat(bb) === bb, true);
  });
  test('hands: normalizeScore canonicalizes present hand fields (null when not understood)', () => {
    const raw = { tracks: [{ measures: [{ beats: [
      beat([{ pitch: 'E4', ornament: ' Short-Trill ', finger: '2', rightFinger: 'I' }], { golpe: 'THUMB', pickScrape: 'Down', barre: '5' }),
      beat([{ pitch: 'E4', ornament: 'trill', finger: 9, rightFinger: 'q' }], { golpe: 'x', pickScrape: 1, barre: { half: true } }),
    ] }] }] };
    const [a, b] = normalizeScore(raw).tracks[0].measures[0].beats;
    eq([a.golpe, a.pickScrape, a.barre, a.notes[0].ornament, a.notes[0].finger, a.notes[0].rightFinger],
      ['thumb', 'down', { fret: 5, half: false }, 'upperMordent', 2, 'i']);
    eq([b.golpe, b.pickScrape, b.barre, b.notes[0].ornament, b.notes[0].finger, b.notes[0].rightFinger], [null, null, null, null, null, null]);
  });
}

// ---------- 1.7.0 left-hand fingering (layout/chord.js fingeringLayout, draw/handMarks.js) ----------
{
  const { layoutChord, fingeringLayout, notationInnerLeft, arpeggioInnerLeft } = await imp('src/layout/chord.js');
  const { staffPosition } = await imp('src/pitch.js');
  const { noteheadForDuration } = await imp('src/glyphs.js');
  const { resolveTheme } = await imp('src/theme.js');
  const theme = resolveTheme({ staffLineSpacing: 10 });
  const chordOf = (notes, accs = notes.map(() => null)) => layoutChord(notes, notes.map((n) => staffPosition(n.pitch)), true, accs,
    { headGlyph: noteheadForDuration('quarter'), duration: 'quarter' }, theme);
  const render = (score, width = 900) => {
    const box = makeContainer();
    new MusicScoreRenderer(box, JSON.parse(JSON.stringify(score)), { width }).render();
    return box.children[0];
  };
  const walk = (n, out = []) => { out.push(n); n.children.forEach((c) => walk(c, out)); return out; };
  const byClass = (root, cls) => walk(root).filter((n) => (n.getAttribute('class') || '').split(' ').includes(cls));

  test('fingering: fingeringLayout is null without a chord or a fingered note; notationInnerLeft is then arpeggioInnerLeft', () => {
    const notes = [{ pitch: 'E4' }, { pitch: 'G4', finger: 'x' }];
    const chord = chordOf(notes);
    eq(fingeringLayout(notes, null, theme), null);
    eq(fingeringLayout(notes, chord, theme), null);
    eq(notationInnerLeft(notes, chord, theme), arpeggioInnerLeft(chord));
    eq(notationInnerLeft(notes, null, theme), 0);
  });
  test('fingering: a second takes two columns 9 px apart, the first 3 px left of the accidentals; left reaches past the digits', () => {
    const notes = [{ pitch: 'G#4', finger: 4 }, { pitch: 'A4', finger: '3' }, { pitch: 'C5', finger: 't' }];
    const chord = chordOf(notes, ['sharp', null, null]);
    const fl = fingeringLayout(notes, chord, theme);
    const right = -arpeggioInnerLeft(chord) - 3;
    eq(fl.items.map((it) => [it.noteIndex, it.label, Math.round((it.dx - right) * 100) / 100]), [[2, 'T', 0], [1, '3', 0], [0, '4', -9]]);
    eq(fl.left > arpeggioInnerLeft(chord) + 9 + 3, true, 'left covers the second column');
    eq(notationInnerLeft(notes, chord, theme), fl.left);
  });
  test('fingering: digits drawn at note height in voice 1 only, left of the accidental; the onset moves only with fingers', () => {
    const mk = (finger) => ({ tracks: [{ showTablature: true, measures: [{ beats: [
      { type: 'note', duration: 'quarter', notes: [{ pitch: 'E4' }] },
      { type: 'note', duration: 'quarter', notes: [{ pitch: 'F#4', string: 4, fret: 4, ...finger }] },
      { type: 'note', duration: 'half', notes: [{ pitch: 'A4' }] },
    ] }, { voices: [{ beats: [{ type: 'note', duration: 'whole', notes: [{ pitch: 'D5', finger: 1 }] }] },
      { beats: [{ type: 'note', duration: 'whole', notes: [{ pitch: 'G4', finger: 2 }] }] }] }] }] });
    const svg = render(mk({ finger: 2 }));
    const groups = byClass(svg, 'fingering-left');
    eq(groups.map((g) => g.children.map((t) => t.textContent)), [['2'], ['1']], 'one digit per fingered voice-1 note; voice 2 none');
    eq(byClass(svg, 'staff-tab').some((s) => byClass(s, 'fingering-left').length), false, 'none on TAB');
    const plain = render(mk({}));
    eq(byClass(plain, 'fingering-left').length, 1);
    const glyphXs = (svg, ch) => walk(byClass(svg, 'staff-notation')[0]).filter((n) => n.tag === 'text' && n.textContent === ch).map((n) => Number(n.getAttribute('x')));
    const sharpX = glyphXs(svg, Glyph.accidentalSharp)[0];
    const digit = groups[0].children[0];
    eq(Number(digit.getAttribute('x')) <= sharpX - 3, true, 'digit right edge at least 0.3 sp left of the sharp');
    const headY = walk(byClass(svg, 'staff-notation')[0]).filter((n) => n.tag === 'text' && n.textContent === Glyph.noteheadBlack)
      .map((n) => [Number(n.getAttribute('x')), Number(n.getAttribute('y'))]);
    eq(Math.abs(Number(digit.getAttribute('y')) - 11 * 0.35 - headY[1][1]) < 1e-9, true, 'centred on the F#4 head');
    const heads = (s2) => glyphXs(s2, Glyph.noteheadBlack);
    eq(heads(svg)[1] > heads(plain)[1], true, 'the fingered onset moves right');
    eq(heads(svg)[0], heads(plain)[0], 'the first onset stays');
    eq(digit.getAttribute('text-anchor'), 'end');
    eq(digit.getAttribute('font-size'), '11');
  });
}

// ---------- 1.7.0 notation stack: ornament, right-hand letters, left-hand tap, golpe (playingDirections.js) ----------
{
  const { tapMarkHalf, techniqueLabelSize } = await imp('src/draw/tab.js');
  const { estimateTextWidth } = await imp('src/textMetrics.js');
  const { resolveTheme } = await imp('src/theme.js');
  const render = (score, width = 900) => {
    const box = makeContainer();
    new MusicScoreRenderer(box, JSON.parse(JSON.stringify(score)), { width }).render();
    return box.children[0];
  };
  const walk = (n, out = []) => { out.push(n); n.children.forEach((c) => walk(c, out)); return out; };
  const byClass = (root, cls) => walk(root).filter((n) => (n.getAttribute('class') || '').split(' ').includes(cls));
  const nq = (notes, extra = {}) => ({ type: 'note', duration: 'quarter', notes, ...extra });
  const y = (n) => Number(n.getAttribute('y'));

  test('stack: tapMarkHalf keeps the estimated letter half for T / S / P and uses the glyph box for the left-hand tap', () => {
    const theme = resolveTheme({});
    ['tap', 'slap', 'pop'].forEach((k) => eq(tapMarkHalf(k, theme), estimateTextWidth({ tap: 'T', slap: 'S', pop: 'P' }[k], techniqueLabelSize(theme), { bold: true }) / 2));
    eq(tapMarkHalf('leftHandTap', theme), (1.63 / 2) * theme.staffLineSpacing);
  });

  test('stack: one beat with turn, p i m, T, golpe and a down pick stacks them bottom up, each at least 0.4 sp above the last', () => {
    const svg = render({ tracks: [{ measures: [{ beats: [
      nq([{ pitch: 'E3', rightFinger: 'p' }, { pitch: 'E4', rightFinger: 'm', ornament: 'turn', tap: true }, { pitch: 'B3', rightFinger: 'I' }], { golpe: 'thumb', pickStroke: 'down' }),
      nq([{ pitch: 'E4' }]), nq([{ pitch: 'E4' }]), nq([{ pitch: 'E4' }]),
    ] }] }] });
    const orn = byClass(svg, 'ornament-turn')[0].children[0];
    eq(byClass(svg, 'ornament')[0] === byClass(svg, 'ornament-turn')[0], true);
    const rh = byClass(svg, 'fingering-right')[0].children;
    eq(rh.map((t) => t.textContent), ['p', 'i', 'm'], 'lowest note first (drawn bottom up)');
    eq(rh.map((t) => t.getAttribute('font-style')), ['italic', 'italic', 'italic']);
    eq(y(rh[0]) > y(rh[1]) && y(rh[1]) > y(rh[2]), true);
    const tap = byClass(svg, 'tap')[0].children[0];
    const golpe = byClass(svg, 'golpe-thumb')[0].children[0];
    const pick = byClass(svg, 'pick-stroke-down')[0].children[0];
    // Each mark's bottom vs the previous mark's top (estimated boxes, px; sp = 10).
    const ornTop = y(orn) - 0.89 * 10;
    eq(y(rh[0]) + 0.25 * 11 <= ornTop - 4 + 1e-9, true, 'letters 0.4 sp above the turn');
    const rhTop = y(rh[2]) - 0.8 * 11;
    eq(y(tap) + 0.25 * techniqueLabelSize(resolveTheme({})) <= rhTop - 4 + 1e-9, true, 'T 0.4 sp above the letters');
    const tapTop = y(tap) - 0.8 * techniqueLabelSize(resolveTheme({}));
    eq(y(golpe) - 0.02 * 10 <= tapTop - 4 + 1e-9, true, 'golpe 0.4 sp above the T');
    eq(y(pick) <= y(golpe) - 1.14 * 10 - 4 + 1e-9, true, 'pick 0.4 sp above the golpe');
  });

  test('stack: the left-hand tap glyph takes the T slot (tap > LH > slap > pop) on notation and TAB; trill beats an ornament', () => {
    const svg = render({ tracks: [{ showTablature: true, measures: [{ beats: [
      nq([{ pitch: 'E4', string: 4, fret: 2, leftHandTap: true }]),
      nq([{ pitch: 'E4', string: 4, fret: 2, leftHandTap: true, slap: true }]),
      nq([{ pitch: 'E4', string: 4, fret: 2, leftHandTap: true, tap: true }]),
      nq([{ pitch: 'E4', string: 4, fret: 2, trill: true, ornament: 'turn' }]),
    ] }] }] });
    eq(byClass(svg, 'left-hand-tap').length, 4, 'two beats x notation + TAB');
    eq(byClass(svg, 'left-hand-tap').map((g) => g.children[0].textContent.codePointAt(0).toString(16)), ['e840', 'e840', 'e840', 'e840']);
    eq(byClass(svg, 'slap').length, 0);
    eq(byClass(svg, 'tap').length, 2);
    eq(byClass(svg, 'ornament').length, 0);
    eq(byClass(svg, 'trill').length, 2);
  });

  test('stack: right-hand letters - notation only on a notation + TAB track; on a tab-only track under the pick stroke', () => {
    const both = render({ tracks: [{ showTablature: true, measures: [{ beats: [nq([{ pitch: 'E4', string: 4, fret: 2, rightFinger: 'a' }], { pickStroke: 'up' })] }] }] });
    eq(byClass(both, 'fingering-right').length, 1);
    eq(byClass(byClass(both, 'staff-tab')[0], 'fingering-right').length, 0);
    const tabOnly = render({ tracks: [{ showStandardNotation: false, showTablature: true, measures: [{ beats: [
      nq([{ string: 4, fret: 2, rightFinger: 'a' }, { string: 6, fret: 0, rightFinger: 'p' }], { pickStroke: 'up' }),
      nq([{ string: 1, fret: 2, rightFinger: 'c' }]),
    ] }] }] });
    const rh = byClass(tabOnly, 'fingering-right');
    eq(rh.map((g) => g.children.map((t) => t.textContent)), [['p', 'a'], ['c']]);
    const pick = byClass(tabOnly, 'pick-stroke-up')[0].children[0];
    eq(y(pick) <= y(rh[0].children[1]) - 0.8 * 11 - 4 + 1e-9, true, 'pick 0.4 sp above the letters');
    eq(y(rh[1].children[0]) + 0.25 * 11 <= -10 + 1e-9, true, 'letters at least 1 sp above the TAB top line');
  });

  test('stack: ornaments, letters and golpe are not drawn on graces or rests; on voice 2 they go below the staff (1.8); directionTopY reaches the golpe', () => {
    const svg = render({ tracks: [{ measures: [
      { beats: [
        { type: 'grace', duration: '16th', notes: [{ pitch: 'D4', ornament: 'turn', rightFinger: 'p' }], golpe: true },
        { type: 'rest', duration: 'quarter', golpe: true, notes: [{ pitch: 'E4', ornament: 'turn' }] },
        nq([{ pitch: 'E4' }], { golpe: true, fermata: true }), nq([{ pitch: 'E4' }]), nq([{ pitch: 'E4' }]),
      ] },
      { voices: [{ beats: [{ type: 'note', duration: 'whole', notes: [{ pitch: 'E5' }] }] },
        { beats: [{ type: 'note', duration: 'whole', notes: [{ pitch: 'G4', ornament: 'turn', rightFinger: 'p' }], golpe: true }] }] },
    ] }] });
    eq([byClass(svg, 'ornament').length, byClass(svg, 'fingering-right').length, byClass(svg, 'golpe').length], [1, 1, 2]);
    // 1.8: the voice-2 whole note's marks hang below the staff (bottom line at 40)
    eq([byClass(svg, 'ornament'), byClass(svg, 'fingering-right'), byClass(svg, 'golpe').slice(1)].map((gs) => y(gs[0].children[0]) > 40), [true, true, true]);
    const golpe = byClass(svg, 'golpe')[0].children[0];
    const fermata = byClass(svg, 'fermata')[0];
    eq(y(fermata.children[0]) < y(golpe) - 1.14 * 10, true, 'fermata above the golpe');
  });
}

// ---------- 1.7.0 golpe on the TAB staff (tabTechniques.js) ----------
{
  const render = (score, width = 900) => {
    const box = makeContainer();
    new MusicScoreRenderer(box, JSON.parse(JSON.stringify(score)), { width }).render();
    return box.children[0];
  };
  const walk = (n, out = []) => { out.push(n); n.children.forEach((c) => walk(c, out)); return out; };
  const byClass = (root, cls) => walk(root).filter((n) => (n.getAttribute('class') || '').split(' ').includes(cls));
  const t = (fret, extra = {}, note = {}) => ({ type: 'note', duration: 'quarter', notes: [{ string: 2, fret, ...note }], ...extra });
  const y = (n) => Number(n.getAttribute('y'));

  test('TAB golpe: above the beat\'s T (0.4 sp clear), else on the T baseline; classes per kind; none on rests', () => {
    const svg = render({ tracks: [{ showStandardNotation: false, showTablature: true, measures: [{ beats: [
      t(2, { golpe: 'thumb' }, { tap: true }), t(2, { golpe: 'finger' }), t(2), { type: 'rest', duration: 'quarter', golpe: true },
    ] }] }] });
    const g = byClass(svg, 'golpe');
    eq(g.map((n) => n.getAttribute('class')), ['golpe golpe-thumb', 'golpe golpe-finger']);
    const tap = byClass(svg, 'tap')[0].children[0];
    // golpe glyph origin = ink bottom + bBoxSW.y * sp (sp = 10, bBoxSW.y = -0.02)
    const bottom = (n) => y(n.children[0]) + 0.02 * 10;
    eq(Math.abs(bottom(g[0]) - (y(tap) - 0.8 * Number(tap.getAttribute('font-size')) - 4)) < 1e-6, true, 'first golpe 0.4 sp above the T top');
    eq(Math.abs(bottom(g[1]) - y(tap)) < 1e-6, true, 'a golpe alone sits on the T baseline of a T-less beat (same fret height)');
    eq(g.every((n) => n.children[0].textContent.codePointAt(0) === 0xE842), true);
  });

  test('TAB golpe: drawn in the TAB group of a notation + TAB track as well, and a whammy dip stacks above it', () => {
    const svg = render({ tracks: [{ showTablature: true, measures: [{ beats: [
      { type: 'note', duration: 'quarter', notes: [{ pitch: 'E4', string: 4, fret: 2 }], golpe: true, whammy: true },
      { type: 'note', duration: 'quarter', notes: [{ pitch: 'E4', string: 4, fret: 2 }] },
    ] }] }] });
    const tab = byClass(svg, 'staff-tab')[0];
    eq(byClass(tab, 'golpe').length, 1);
    eq(byClass(byClass(svg, 'staff-notation')[0], 'golpe').length, 1);
    const golpeTop = y(byClass(tab, 'golpe')[0].children[0]) - 1.14 * 10;
    const dipPath = byClass(tab, 'whammy').flatMap((n) => walk(n)).find((n) => n.tag === 'path');
    const dipYs = dipPath.getAttribute('d').match(/-?\d+(\.\d+)?/g).map(Number).filter((_, i) => i % 2 === 1);
    eq(Math.max(...dipYs) < golpeTop, true, 'dip above the golpe');
  });
}

// ---------- 1.7.0 pick-scrape and barre label runs (techniqueLabels.js) ----------
{
  const render = (score, width = 900) => {
    const box = makeContainer();
    new MusicScoreRenderer(box, JSON.parse(JSON.stringify(score)), { width }).render();
    return box.children[0];
  };
  const walk = (n, out = []) => { out.push(n); n.children.forEach((c) => walk(c, out)); return out; };
  const byClass = (root, cls) => walk(root).filter((n) => (n.getAttribute('class') || '').split(' ').includes(cls));
  const q = (extra = {}) => ({ type: 'note', duration: 'quarter', notes: [{ pitch: 'E4', string: 4, fret: 2 }], ...extra });
  const rest = (extra = {}) => ({ type: 'rest', duration: 'quarter', ...extra });
  const grace = { type: 'grace', duration: '16th', notes: [{ pitch: 'D4', string: 4, fret: 0 }] };
  const tabOnly = (measures) => ({ tracks: [{ showStandardNotation: false, showTablature: true, measures: measures.map((beats) => ({ beats })) }] });
  const labels = (svg, cls) => byClass(svg, cls).map((g) => [g.getAttribute('class'), g.children[0].textContent]);
  const labelY = (svg, cls) => byClass(svg, cls).map((g) => Number(g.children[0].getAttribute('y')));

  test('labels: let-ring bridging truth table is unchanged (rests bridge, graces and notes end, values must match both sides)', () => {
    const count = (beats) => byClass(render(tabOnly([beats])), 'let-ring').length;
    eq(count([q({ letRing: true }), rest(), q({ letRing: true }), q()]), 1, 'rest bridges');
    eq(count([q({ letRing: true }), grace, q({ letRing: true }), q()]), 2, 'grace ends');
    eq(count([q({ letRing: true }), q(), q({ letRing: true }), q()]), 2, 'note ends');
    eq(count([q({ letRing: true }), rest(), rest(), q()]), 1, 'trailing rests stay out');
    eq(count([rest(), rest({ letRing: true }), rest(), q({ letRing: true })]), 1, 'a marked rest is part of the run');
  });

  test('labels: P.S. runs merge both directions (class from the first beat), rests bridge; an unmarked note ends', () => {
    const svg = render(tabOnly([[q({ pickScrape: 'down' }), q({ pickScrape: ' UP ' }), rest(), q({ pickScrape: true })], [q(), q({ pickScrape: 'up' }), q(), q({ pickScrape: 'x' })]]));
    eq(labels(svg, 'pick-scrape'), [['pick-scrape pick-scrape-down', 'P.S.'], ['pick-scrape pick-scrape-up', 'P.S.']]);
  });

  test('labels: barre runs - same fret and half continue over rests and graces; a different barre or unmarked note ends; labels C II / ½C V', () => {
    const svg = render(tabOnly([[q({ barre: { fret: 2 } }), rest(), grace, q({ barre: '2' }), q({ barre: { fret: 5, half: true } })], [q({ barre: 5 }), q(), q({ barre: 'II' }), q({ barre: 12 })]]));
    eq(labels(svg, 'barre'), [['barre', 'C II'], ['barre barre-half', '½C V'], ['barre', 'C V'], ['barre', 'C XII']]);
  });

  test('labels: lanes outward P.M. < harmonic < let ring < P.S. < barre < rake; below a notation-only staff', () => {
    const all = { palmMute: true, letRing: true, pickScrape: true, barre: 3, notes: [{ pitch: 'E4', string: 4, fret: 2, harmonic: 'artificial' }] };
    const svg = render(tabOnly([[q(all), q({ ...all, rake: true })]]));
    const ys = ['palm-mute', 'harmonic', 'let-ring', 'pick-scrape', 'barre', 'rake'].map((c) => labelY(svg, c)[0]);
    eq(ys.every((v, i) => i === 0 || v < ys[i - 1]), true, `lanes upward above TAB: ${ys}`);
    const notation = render({ tracks: [{ measures: [{ beats: [q({ pickScrape: true, barre: 3 }), q({ pickScrape: true, barre: 3 }), q(), q()] }] }] });
    const [ps, barre] = [labelY(notation, 'pick-scrape')[0], labelY(notation, 'barre')[0]];
    eq(ps > 40 && barre > ps, true, `below the staff, barre outside P.S.: ${ps} ${barre}`);
  });

  test('labels: a barre run across a system break repeats its label on the next system', () => {
    const svg = render(tabOnly([[q({ barre: 7 }), q({ barre: 7 }), q({ barre: 7 }), q({ barre: 7 })], [q({ barre: 7 }), q({ barre: 7 }), q(), q()]]), 300);
    eq(byClass(svg, 'staff-tab').length, 2, 'two systems');
    eq(labels(svg, 'barre').map((l) => l[1]), ['C VII', 'C VII']);
  });
}

// ---------- 1.7.0 verification audit: gaps left by the developer's tests ----------
{
  const { beatTapMark } = await imp('src/directions.js');
  const { glyphBox } = await imp('src/glyphMetrics.js');
  const { computeLayout } = await imp('src/layout/index.js');
  const render = (score, width = 900) => {
    const box = makeContainer();
    new MusicScoreRenderer(box, JSON.parse(JSON.stringify(score)), { width }).render();
    return box.children[0];
  };
  const walk = (n, out = []) => { out.push(n); n.children.forEach((c) => walk(c, out)); return out; };
  const byClass = (root, cls) => walk(root).filter((n) => (n.getAttribute('class') || '').split(' ').includes(cls));
  const q = (notes, extra = {}) => ({ type: 'note', duration: 'quarter', notes, ...extra });
  const one = (beats) => ({ tracks: [{ showTablature: true, measures: [{ beats }] }] });
  const y = (n) => Number(n.getAttribute('y'));
  const fill = [q([{ pitch: 'E4' }]), q([{ pitch: 'E4' }]), q([{ pitch: 'E4' }])];

  test('audit: tap-letter priority ends slap > pop', () => {
    eq(beatTapMark(q([{ pitch: 'E4', pop: true }, { pitch: 'G4', slap: true }])), 'slap');
    eq(beatTapMark(q([{ pitch: 'E4', pop: true }])), 'pop');
  });

  test('audit: a leftHandTap on a tapped harmonic draws no left-hand-tap glyph (notation or TAB); on a plain note it does', () => {
    const svg = render(one([q([{ pitch: 'E4', string: 4, fret: 2, leftHandTap: true, harmonic: 'tapped' }]), q([{ pitch: 'E4', string: 4, fret: 2, leftHandTap: true }]), ...fill.slice(1)]));
    eq(byClass(svg, 'left-hand-tap').length, 2, 'only the second beat, once on notation and once on TAB');
  });

  test('audit: a chord with several ornaments draws only one glyph, from its first valid note (turn, not the later mordent)', () => {
    const svg = render(one([q([{ pitch: 'E4', string: 4, fret: 2, ornament: 'nope' }, { pitch: 'G4', string: 3, fret: 0, ornament: 'turn' }, { pitch: 'B4', string: 2, fret: 0, ornament: 'mordent' }]), ...fill]));
    eq(byClass(svg, 'ornament').map((g) => g.getAttribute('class')), ['ornament ornament-turn']);
  });

  test('audit: a grace note\'s finger is not drawn, a main note\'s finger is', () => {
    const svg = render(one([{ type: 'grace', duration: '16th', notes: [{ pitch: 'D4', string: 4, fret: 0, finger: 3 }] }, q([{ pitch: 'E4', string: 4, fret: 2, finger: 2 }]), ...fill.slice(1)]));
    eq(byClass(svg, 'fingering-left').map((g) => g.children.map((t) => t.textContent)), [['2']]);
  });

  test('audit: unusable finger values leave the layout identical to a score without the field (room only for drawn fingers)', () => {
    const beats = (extra) => [q([{ pitch: 'F#4', ...extra }]), q([{ pitch: 'E4', ...extra }]), ...fill.slice(1)];
    const lay = (score) => JSON.stringify(computeLayout(normalizeScore(score), resolveTheme({}), 900).systems.flatMap((sy) => sy.tracks.flatMap((t) => t.measures.flatMap((m) => [m.x, m.width, m.endX, ...m.elements.flatMap((e) => [e.x, e.width, e.chord.leftExt])]))));
    const mk = (extra) => ({ tracks: [{ measures: [{ beats: beats(extra) }] }] });
    eq(lay(mk({ finger: 9 })), lay(mk({})));
    eq(lay(mk({ finger: 'x', rightFinger: 'z', ornament: 'bogus' })), lay(mk({})));
    eq(lay(mk({ finger: 2 })) !== lay(mk({})), true, 'a drawn finger does change the spacing');
  });

  test('audit: the beat direction top (fermata) clears an ornament, right-hand letters and the left-hand tap glyph', () => {
    const fermataY = (note) => {
      const svg = render({ tracks: [{ measures: [{ beats: [q([{ pitch: 'E4', ...note }], { fermata: true }), ...fill] }] }] });
      return { svg, f: y(byClass(svg, 'fermata')[0].children[0]) };
    };
    const orn = fermataY({ ornament: 'turn' });
    const o = byClass(orn.svg, 'ornament')[0].children[0];
    eq(orn.f <= y(o) - glyphBox(String.fromCodePoint(o.textContent.codePointAt(0))).top * 10 - 4 + 1e-9, true, 'above the turn');
    const rh = fermataY({ rightFinger: 'm' });
    eq(rh.f <= y(byClass(rh.svg, 'fingering-right')[0].children[0]) - 0.8 * 11 - 4 + 1e-9, true, 'above the letter');
    const lh = fermataY({ leftHandTap: true });
    const l = byClass(lh.svg, 'left-hand-tap')[0].children[0];
    eq(lh.f <= y(l) - glyphBox(String.fromCodePoint(l.textContent.codePointAt(0))).top * 10 - 4 + 1e-9, true, 'above the left-hand tap glyph');
  });
}

// ---------- pre-1.8 characterization: voices & TAB rhythm (pins taken before the 1.8.0 change) ----------
{
  const { cases } = await import('./cases.mjs');
  const { computeLayout } = await imp('src/layout/index.js');
  const { durationR } = await imp('src/duration.js');
  const { add, ZERO, key } = await imp('src/rational.js');
  const th = resolveTheme();
  const walk = (n, out = []) => { out.push(n); n.children.forEach((c) => walk(c, out)); return out; };
  const render = (score, width = 900) => {
    const box = makeContainer();
    new MusicScoreRenderer(box, JSON.parse(JSON.stringify(score)), { width }).render();
    return box.children[0];
  };

  // Trigger scan over normalizeScore output. Per two-voice measure ("track.measure", 1-based measures):
  // R1 = voice-2 beats carrying vibrato / trill / ornament / rightFinger / tap-style letters / golpe / pickStroke /
  // fermata, or a tremolo on a TAB track; R4 = over-approximated unison (same pitch string in both voices at one
  // onset); R5 = merged-rest candidate (non-hidden rests of equal duration and dots at one onset).
  const scan = (c) => {
    const sc = normalizeScore(c.score);
    const r = { r1: [], r4: [], r5: [], band: [], two: [], rests: [], tiedFrets: [] };
    sc.tracks.forEach((t, ti) => {
      if (t.tiedFrets !== undefined) r.tiedFrets.push(ti);
      t.measures.forEach((m, mi) => {
        if (!m.voice2Beats) return;
        const id = `${ti}.${mi + 1}`;
        r.two.push(id);
        if (t.tabRhythm) r.band.push(id);
        const cats = new Set();
        for (const b of m.voice2Beats) {
          if (b.vibrato) cats.add('vibrato');
          if (b.golpe) cats.add('golpe');
          if (b.pickStroke) cats.add('pick');
          if (b.fermata) cats.add('fermata');
          if (b.tremolo && t.showTablature) cats.add('tabTremolo');
          for (const n of b.notes || []) {
            if (n.trill) cats.add('trill');
            if (n.ornament) cats.add('ornament');
            if (n.rightFinger) cats.add('rightFinger');
            if (n.tap || n.leftHandTap || n.slap || n.pop) cats.add('tap');
          }
        }
        if (cats.size) r.r1.push(`${id}:${[...cats].sort().join('+')}`);
        const onsets = (beats) => { let t0 = ZERO; return beats.map((b) => { const o = key(t0); if (b.type !== 'grace') t0 = add(t0, durationR(b)); return [o, b]; }); };
        const o1 = onsets(m.beats); const o2 = onsets(m.voice2Beats);
        o1.forEach(([k1, b1]) => {
          if (b1.type === 'rest' && !b1.hidden) r.rests.push(`${id}:v1@${k1}`);
        });
        o2.forEach(([k2, b2]) => {
          if (b2.type === 'rest' && !b2.hidden) r.rests.push(`${id}:v2@${k2}`);
          o1.forEach(([k1, b1]) => {
            if (k1 !== k2 || b1.type === 'grace' || b2.type === 'grace') return;
            if (b1.type === 'note' && b2.type === 'note' && b1.notes.some((n1) => b2.notes.some((n2) => n1.pitch != null && n1.pitch === n2.pitch))) r.r4.push(`${id}@${k1}`);
            if (b1.type === 'rest' && b2.type === 'rest' && !b1.hidden && !b2.hidden && key(durationR(b1)) === key(durationR(b2)) && (b1.dots || 0) === (b2.dots || 0)) r.r5.push(`${id}@${k1}`);
          });
        });
      });
    });
    return r;
  };
  // The pins describe the 63 pre-1.8 cases (the 1.8 fixtures exercise these triggers on purpose).
  const pre18 = cases.filter((c) => !/^char-(voices-marks|voices-tab-rhythm|voices-tied-frets)-/.test(c.id));
  const scans = new Map(pre18.map((c) => [c.id, scan(c)]));
  const twoVoiceIds = [...scans].filter(([, r]) => r.two.length).map(([id]) => id);

  test('pre-1.8 scan: the two-voice cases are exactly the six known fixtures', () => {
    eq(pre18.length, 63);
    eq(twoVoiceIds, ['char-voices-w900', 'char-voices-break-w600', 'char-voices-tab-w900', 'char-note-effects-w900', 'char-score-text-w900', 'char-ornaments-w900']);
  });
  test('pre-1.8 scan: voices-break, score-text, ornaments and voices-tab have no R1 / R4 / R5 triggers; their other variants are single-voice', () => {
    for (const id of ['char-voices-break-w600', 'char-score-text-w900', 'char-ornaments-w900', 'char-voices-tab-w900']) {
      const r = scans.get(id);
      eq([id, r.r1, r.r4, r.r5], [id, [], [], []]);
    }
    for (const id of cases.map((c) => c.id).filter((i) => /^char-(score-text|ornaments)-/.test(i) && !twoVoiceIds.includes(i))) eq([id, scans.get(id).two], [id, []]);
  });
  test('pre-1.8 scan: voices has exactly the R4 candidate at m3 and TAB tremolo at m6 / m8', () => {
    const r = scans.get('char-voices-w900');
    eq([r.r1, r.r4, r.r5, r.band, r.two.length], [['0.6:tabTremolo', '0.8:tabTremolo'], ['0.3@1/4'], [], [], 8]);
  });
  test('pre-1.8 scan: voices-tab has the rhythm band on the TAB track only, a voice-1 rest in m4 and a voice-2 rest in m3', () => {
    const r = scans.get('char-voices-tab-w900');
    eq(r.band, ['1.1', '1.2', '1.3', '1.4']);
    eq(r.two, ['0.1', '0.2', '0.3', '0.4', '1.1', '1.2', '1.3', '1.4']);
    eq(r.rests.filter((s) => s.startsWith('1.')), ['1.3:v2@3/4', '1.4:v1@0/1']);
  });
  test('pre-1.8 scan: note-effects has R1 at m13 only (fermata, TAB tremolo and vibrato on voice 2)', () => {
    const r = scans.get('char-note-effects-w900');
    eq([r.r1, r.r4, r.r5, r.two], [['0.13:fermata+tabTremolo+vibrato'], [], [], ['0.13']]);
  });
  test('pre-1.8 scan: no case has an R5 candidate or a tiedFrets key; the only band with two voices is voices-tab', () => {
    for (const [id, r] of scans) eq([id, r.r5, r.tiedFrets], [id, [], []]);
    eq([...scans].filter(([, r]) => r.band.length).map(([id, r]) => [id, r.band]), [['char-voices-tab-w900', ['1.1', '1.2', '1.3', '1.4']]]);
  });
  test('pre-1.8 scan: normalizeScore adds no tiedFrets key; 1.8 canonicalizes a present one', () => {
    const t = (extra) => normalizeScore({ tracks: [{ showTablature: true, ...extra, measures: [{ beats: [{ type: 'note', duration: 'whole', notes: [{ string: 1, fret: 3 }] }] }] }] }).tracks[0];
    eq('tiedFrets' in t({}), false);
    eq([t({ tiedFrets: ' Parens ' }).tiedFrets, t({ tiedFrets: 'x' }).tiedFrets], ['parens', null]);
  });

  // combineVoices JSON for unisons the 1.8 shared head must NOT merge: voice 2 keeps its clash shift of one head width.
  const nb = (ps, duration = 'quarter', x = {}) => ({ type: 'note', duration, notes: ps.map((p) => (typeof p === 'string' ? { pitch: p } : p)), ...x });
  const rs = (duration = 'quarter', x = {}) => ({ type: 'rest', duration, ...x });
  const vm = (b1, b2) => ({ voices: [{ beats: b1 }, { beats: b2 }] });
  const col = (b1, b2) => computeLayout(normalizeScore({ tracks: [{ showStandardNotation: true, measures: [vm(b1, b2)] }] }), th, 900).systems[0].tracks[0].measures[0];
  const sl = (c) => ({ heads: c.heads, accidentals: c.accidentals, dots: c.dots, leftExt: c.leftExt, rightExt: c.rightExt, stemUp: c.stemUp });
  const pinOf = (m) => ({ dx: m.elements2[0].dx, x: [m.elements[0].x, m.elements2[0].x], v1: sl(m.elements[0].chord), v2: sl(m.elements2[0].chord) });
  const R = [rs(), rs('half')];
  const unisons = {
    accidental: [[nb(['G#4']), ...R], [nb(['G4']), ...R]],
    dots: [[nb(['G4'], 'half', { dots: 1 }), rs()], [nb(['G4'], 'half'), rs('half')]],
    mute: [[nb(['G4']), ...R], [nb([{ pitch: 'G4', mute: true }]), ...R]],
    second: [[nb(['G4', 'A4']), ...R], [nb(['G4']), ...R]],
    headGlyph: [[nb(['G4'], 'half'), rs('half')], [nb(['G4']), ...R]],
  };
  const PINS = {
    accidental: {"dx":11.799999999999999,"x":[135.96,147.76000000000002],"v1":{"heads":[{"noteIndex":0,"pos":2,"dx":0,"glyph":"\ue0a4","width":11.799999999999999}],"accidentals":[{"noteIndex":0,"name":"sharp","dx":-18.36}],"dots":{"dx":10.899999999999999,"step":5,"radius":1.7000000000000002,"positions":[3]},"leftExt":26.12,"rightExt":5.8999999999999995,"stemUp":true},"v2":{"heads":[{"noteIndex":0,"pos":2,"dx":0,"glyph":"\ue0a4","width":11.799999999999999}],"accidentals":[{"noteIndex":0,"name":"natural","dx":-37.92}],"dots":{"dx":10.899999999999999,"step":5,"radius":1.7000000000000002,"positions":[1]},"leftExt":37.92,"rightExt":5.8999999999999995,"stemUp":false}},
    dots: {"dx":11.799999999999999,"x":[115.74000000000001,127.54],"v1":{"heads":[{"noteIndex":0,"pos":2,"dx":0,"glyph":"\ue0a3","width":11.799999999999999}],"accidentals":[],"dots":{"dx":22.7,"step":5,"radius":1.7000000000000002,"positions":[3]},"leftExt":5.8999999999999995,"rightExt":24.4,"stemUp":true},"v2":{"heads":[{"noteIndex":0,"pos":2,"dx":0,"glyph":"\ue0a3","width":11.799999999999999}],"accidentals":[],"dots":{"dx":10.9,"step":5,"radius":1.7000000000000002,"positions":[1]},"leftExt":5.8999999999999995,"rightExt":5.8999999999999995,"stemUp":false}},
    mute: {"dx":11.799999999999999,"x":[115.74000000000001,127.54],"v1":{"heads":[{"noteIndex":0,"pos":2,"dx":0,"glyph":"\ue0a4","width":11.799999999999999}],"accidentals":[],"dots":{"dx":10.899999999999999,"step":5,"radius":1.7000000000000002,"positions":[3]},"leftExt":5.8999999999999995,"rightExt":5.8999999999999995,"stemUp":true},"v2":{"heads":[{"noteIndex":0,"pos":2,"dx":0,"glyph":"\ue0a4","width":11.799999999999999}],"accidentals":[],"dots":{"dx":10.899999999999999,"step":5,"radius":1.7000000000000002,"positions":[1]},"leftExt":5.8999999999999995,"rightExt":5.8999999999999995,"stemUp":false}},
    second: {"dx":23.599999999999998,"x":[115.74000000000001,139.34],"v1":{"heads":[{"noteIndex":0,"pos":2,"dx":0,"glyph":"\ue0a4","width":11.799999999999999},{"noteIndex":1,"pos":3,"dx":11.799999999999999,"glyph":"\ue0a4","width":11.799999999999999}],"accidentals":[],"dots":{"dx":22.7,"step":5,"radius":1.7000000000000002,"positions":[3]},"leftExt":5.8999999999999995,"rightExt":17.7,"stemUp":true},"v2":{"heads":[{"noteIndex":0,"pos":2,"dx":0,"glyph":"\ue0a4","width":11.799999999999999}],"accidentals":[],"dots":{"dx":10.899999999999999,"step":5,"radius":1.7000000000000002,"positions":[1]},"leftExt":5.8999999999999995,"rightExt":5.8999999999999995,"stemUp":false}},
    headGlyph: {"dx":11.799999999999999,"x":[115.74000000000001,127.54],"v1":{"heads":[{"noteIndex":0,"pos":2,"dx":0,"glyph":"\ue0a3","width":11.799999999999999}],"accidentals":[],"dots":{"dx":10.899999999999999,"step":5,"radius":1.7000000000000002,"positions":[3]},"leftExt":5.8999999999999995,"rightExt":5.8999999999999995,"stemUp":true},"v2":{"heads":[{"noteIndex":0,"pos":2,"dx":0,"glyph":"\ue0a4","width":11.799999999999999}],"accidentals":[],"dots":{"dx":10.899999999999999,"step":5,"radius":1.7000000000000002,"positions":[1]},"leftExt":5.8999999999999995,"rightExt":5.8999999999999995,"stemUp":false}},
  };
  for (const [name, [a, b]] of Object.entries(unisons)) {
    test(`pre-1.8 combineVoices: non-eligible unison (${name}) keeps two heads, voice 2 shifted by a head width`, () => {
      eq(pinOf(col(a, b)), PINS[name]);
    });
  }

  // Serialized TAB rhythm groups on a tab-only track (notation off -> band on).
  const e8 = (p) => nb([p], '8th');
  const single = { beats: [e8('C5'), e8('D5'), nb(['E5'], 'quarter', { dots: 1 }), e8('F5'), rs('quarter')] };
  const two = vm([e8('C5'), e8('D5'), nb(['E5'], 'half'), nb(['G5'])], [nb(['C4'], 'half'), nb(['E4']), nb(['G4'])]);
  const tabOnly = (ms) => ({ tracks: [{ showStandardNotation: false, showTablature: true, measures: ms }] });
  const groups = (svg) => walk(svg).filter((n) => (n.getAttribute('class') || '').split(' ').includes('tab-rhythm'));
  const SINGLE_ON_TWO_VOICE_TRACK = "<g class=\"tab-rhythm\">\n  <line x1=\"98.69\" y1=\"85\" x2=\"98.69\" y2=\"110\" stroke=\"#1a1a1a\" stroke-width=\"1.3\"/>\n  <line x1=\"123.44\" y1=\"85\" x2=\"123.44\" y2=\"110\" stroke=\"#1a1a1a\" stroke-width=\"1.3\"/>\n  <line x1=\"148.19\" y1=\"85\" x2=\"148.19\" y2=\"110\" stroke=\"#1a1a1a\" stroke-width=\"1.3\"/>\n  <circle cx=\"153.19\" cy=\"94\" r=\"1.7\" fill=\"#1a1a1a\"/>\n  <line x1=\"191.06\" y1=\"85\" x2=\"191.06\" y2=\"110\" stroke=\"#1a1a1a\" stroke-width=\"1.3\"/>\n  <text x=\"191.06\" y=\"110\" font-family=\"Bravura, BravuraFallback, serif\" font-size=\"30\" fill=\"#1a1a1a\">\ue241</text>\n  <g class=\"tab-rest\">\n    <rect x=\"208.4\" y=\"20.54\" width=\"14.8\" height=\"33.92\" fill=\"#ffffff\"/>\n    <text x=\"215.8\" y=\"37.46\" font-family=\"Bravura, BravuraFallback, serif\" font-size=\"40\" fill=\"#1a1a1a\" text-anchor=\"middle\">\ue4e5</text>\n  </g>\n  <path d=\"M 97.64 110 L 124.49 110 L 124.49 105 L 97.64 105 Z\" fill=\"#1a1a1a\" stroke=\"none\"/>\n</g>\n";
  const ROW1_NO_RESTS = "<g class=\"tab-rhythm\">\n  <line x1=\"98.69\" y1=\"85\" x2=\"98.69\" y2=\"110\" stroke=\"#1a1a1a\" stroke-width=\"1.3\"/>\n  <line x1=\"123.44\" y1=\"85\" x2=\"123.44\" y2=\"110\" stroke=\"#1a1a1a\" stroke-width=\"1.3\"/>\n  <line x1=\"148.19\" y1=\"85\" x2=\"148.19\" y2=\"97.5\" stroke=\"#1a1a1a\" stroke-width=\"1.3\"/>\n  <line x1=\"218.19\" y1=\"85\" x2=\"218.19\" y2=\"110\" stroke=\"#1a1a1a\" stroke-width=\"1.3\"/>\n  <path d=\"M 97.64 110 L 124.49 110 L 124.49 105 L 97.64 105 Z\" fill=\"#1a1a1a\" stroke=\"none\"/>\n</g>\n";
  test('pre-1.8 tab rhythm: a single-voice measure on a track that also has a two-voice measure serializes exactly', () => {
    eq(serialize(groups(render(tabOnly([single, two])))[0]), SINGLE_ON_TWO_VOICE_TRACK);
  });
  test('pre-1.8 tab rhythm: row 1 of a two-voice measure without rests serializes exactly (1.8 adds voice 2\'s row as a second group)', () => {
    const gs = groups(render(tabOnly([two])));
    eq(gs.length, 2);
    eq(serialize(gs[0]), ROW1_NO_RESTS);
  });
}

// ---------- 1.8.0: the shared two-voice predicate (src/twoVoice.js) ----------
{
  const tv = await imp('src/twoVoice.js');
  const { computeLayout } = await imp('src/layout/index.js');
  const th = resolveTheme();
  const hr = { type: 'rest', duration: 'half', hidden: true };
  const q = (p) => ({ type: 'note', duration: 'quarter', notes: [{ pitch: p }] });
  test('twoVoice: isTwoVoiceBeats truth table (only a non-hidden beat counts)', () => {
    eq([undefined, null, 'x', {}, [], [hr], [hr, hr], [hr, q('C4')], [{ type: 'rest', duration: 'whole' }], [{ type: 'grace', notes: [] }]].map(tv.isTwoVoiceBeats),
      [false, false, false, false, false, false, false, true, true, true]);
  });
  test('twoVoice: isTwoVoiceMeasure / voiceOf / tabMarkBeat truth tables', () => {
    eq([undefined, null, {}, { beats: [] }, { voice2Beats: [] }, { elements2: [] }, { elements: [], elements2: null }].map(tv.isTwoVoiceMeasure),
      [false, false, false, false, true, true, false]);
    eq([{}, { voice: undefined }, { voice: 1 }, { voice: 2 }].map(tv.voiceOf), [0, 0, 1, 2]);
    const el = { id: 'own' }; const other = { id: 'v2' };
    eq([tv.tabMarkBeat({ el }, 'pick'), tv.tabMarkBeat({ el, tabMarks: {} }, 'pick'), tv.tabMarkBeat({ el, tabMarks: { pick: other } }, 'pick'), tv.tabMarkBeat({ el, tabMarks: { pick: other } }, 'tap')],
      [el, el, other, el]);
  });
  test('twoVoice: normalize keeps voice2Beats exactly when isTwoVoiceBeats; layout adds elements2 exactly then; trackHasTwoVoices per track', () => {
    const variants = [[q('C4')], [hr], [hr, hr], [], [hr, q('D4')]];
    const sc = normalizeScore({ tracks: [
      { measures: variants.map((v2) => ({ voices: [{ beats: [q('C5'), q('C5'), q('C5'), q('C5')] }, { beats: v2 }] })) },
      { measures: variants.map(() => ({ beats: [q('E4')] })) },
    ] });
    eq(sc.tracks[0].measures.map(tv.isTwoVoiceMeasure), variants.map(tv.isTwoVoiceBeats));
    eq(sc.tracks[0].measures.map((m) => 'voice2Beats' in m), [true, false, false, false, true]);
    const lay = computeLayout(sc, th, 3000);
    const lm = lay.systems.flatMap((s) => s.tracks[0].measures);
    eq(lm.map(tv.isTwoVoiceMeasure), [true, false, false, false, true]);
    eq(lm.map((m) => 'elements2' in m), [true, false, false, false, true]);
    const runs = lay.systems.flatMap((s) => s.tracks.map((t, ti) => ({ track: sc.tracks[ti], measures: t.measures })));
    eq([tv.trackHasTwoVoices(runs, sc.tracks[0]), tv.trackHasTwoVoices(runs, sc.tracks[1])], [true, false]);
    eq(lm[0].elements.map(tv.voiceOf).concat(lm[0].elements2.map(tv.voiceOf), lm[1].elements.map(tv.voiceOf)), [1, 1, 1, 1, 2, 0, 0, 0, 0]);
  });
}

// ---------- 1.8.0: inverted short / long fermatas and leger-line rests (glyphs.js, glyphMetrics.js) ----------
{
  const { glyphBox } = await imp('src/glyphMetrics.js');
  const cpOf = (name) => Glyph[name].codePointAt(0).toString(16).toUpperCase();
  test('1.8 glyphs: codepoints E4C5 / E4C7 / E4F4 / E4F5 (verified in the bundled Bravura cmap)', () => {
    eq(['fermataShortBelow', 'fermataLongBelow', 'restWholeLegerLine', 'restHalfLegerLine'].map(cpOf), ['E4C5', 'E4C7', 'E4F4', 'E4F5']);
  });
  test('1.8 glyphs: measured ink boxes; inverted fermatas hang from the origin and mirror the upright ones', () => {
    const b = (n) => { const x = glyphBox(n); return [x.left, x.right, x.top, x.bottom]; };
    eq([b('fermataShortBelow'), b('fermataLongBelow')], [[0, 2.415, 0, -1.365], [0, 2.41, 0.005, -1.335]]);
    for (const [up, down] of [['fermataShortAbove', 'fermataShortBelow'], ['fermataLongAbove', 'fermataLongBelow']]) {
      const u = glyphBox(up); const d = glyphBox(down);
      eq([u.width === d.width, Math.abs(u.top + d.bottom) < 1e-9, Math.abs(u.bottom + d.top) < 1e-9], [true, true, true], down);
    }
  });
  test('1.8 glyphs: leger-line rests keep the height range of the plain rest, the leger reaching past both sides of its advance', () => {
    const b = (n) => { const x = glyphBox(n); return [x.left, x.right, x.top, x.bottom]; };
    eq([b('restWholeLegerLine'), b('restHalfLegerLine')], [[-0.47, 1.595, 0.08, -0.54], [-0.47, 1.595, 0.57, -0.055]]);
    for (const [plain, leger] of [['restWhole', 'restWholeLegerLine'], ['restHalf', 'restHalfLegerLine']]) {
      const p = glyphBox(plain); const l = glyphBox(leger);
      eq([l.left < p.left, l.right > p.right, Math.abs((l.left + l.right) / 2 - p.width / 2) < 0.01], [true, true, true], leger);
    }
  });
}

// ---------- 1.8.0: merged rests (R5, layout/voices.js mergedRestPairs) ----------
{
  const { mergedRestPairs } = await imp('src/layout/voices.js');
  const { computeLayout } = await imp('src/layout/index.js');
  const { drawSystem } = await imp('src/draw/system.js');
  const { restForDuration } = await imp('src/glyphs.js');
  const th = resolveTheme();
  const S = th.staffLineSpacing; const BL = 4 * S;
  const nb = (ps, duration = 'quarter', x = {}) => ({ type: 'note', duration, notes: ps.map((p) => (typeof p === 'string' ? { pitch: p } : p)), ...x });
  const rs = (duration = 'quarter', x = {}) => ({ type: 'rest', duration, ...x });
  const vm = (b1, b2, x = {}) => ({ ...x, voices: [{ beats: b1 }, { beats: b2 }] });
  const sets = (r) => [[...r.v1], [...r.v2]];
  const ts44 = { beats: 4, beatType: 4 };
  const nodes = (g, pred) => [...walk(g)].filter(({ nd, cls }) => pred(nd, cls)).map(({ nd }) => nd);
  const draw = (measures, track = {}) => {
    const sc = normalizeScore({ tracks: [{ showStandardNotation: true, ...track, measures }] });
    const sys = computeLayout(sc, th, 900).systems[0];
    const d = drawSystem(makeContainer(), sys, 0, sc, th);
    return { ms: sys.tracks[0].measures, staff: (kind) => d.staves.find((st) => st.kind === kind)?.g };
  };
  test('R5 mergedRestPairs: same onset, duration, dots and length merge; dots, tuplet ratio, hidden or onset differences do not', () => {
    eq(sets(mergedRestPairs([nb(['C5']), rs(), rs('half')], [nb(['E4']), rs(), rs('half')], ts44)), [[1, 2], [1, 2]]);
    eq(sets(mergedRestPairs([rs('half', { dots: 1 }), nb(['C5'])], [rs('half'), rs()], ts44)), [[], []]);
    eq(sets(mergedRestPairs([rs('8th', { tuplet: 3 }), nb(['C5'], '8th', { tuplet: 3 }), nb(['C5'], '8th', { tuplet: 3 })], [rs('8th'), nb(['E4'], '8th')], { beats: 1, beatType: 4 })), [[], []]);
    eq(sets(mergedRestPairs([rs('half', { hidden: true }), rs('half')], [rs('half'), rs('half')], ts44)), [[1], [1]], 'a hidden rest takes time but never merges');
    eq(sets(mergedRestPairs([{ type: 'grace', notes: [{ pitch: 'D5' }] }, rs(), nb(['C5'], 'half', { dots: 1 })], [rs(), nb(['E4'], 'half', { dots: 1 })], ts44)), [[1], [0]], 'graces take no time');
    eq(sets(mergedRestPairs([nb(['C5']), rs()], [rs(), nb(['E4'])], { beats: 2, beatType: 4 })), [[], []], 'different onsets');
  });
  test('R5 mergedRestPairs: a whole-measure rest merges only with a whole-measure rest', () => {
    eq(sets(mergedRestPairs([rs('whole')], [rs('whole')], ts44)), [[0], [0]]);
    const ts24 = { beats: 2, beatType: 4 };
    eq(sets(mergedRestPairs([rs('whole')], [rs('whole'), nb(['E4'])], ts24)), [[], []]);
  });
  test('R5 layout: merged rests carry restMerged and no restPos / restLedger; unmerged rests keep theirs', () => {
    const m = draw([vm([nb(['C5']), rs(), rs('half')], [rs(), rs(), nb(['E4'], 'half')])]).ms[0];
    eq([m.elements[1].restMerged, m.elements2[1].restMerged, 'restPos' in m.elements[1], 'restPos' in m.elements2[1]], [true, true, false, false]);
    eq([m.elements2[0].restMerged, m.elements2[0].restPos, m.elements[2].restMerged, m.elements[2].restPos], [undefined, 0, undefined, 8]);
  });
  test('R5 notation: one rest from voice 1 at the single-voice position (pos 4 / 4 / 6), no ledger, nothing in voice 2', () => {
    const { ms, staff } = draw([vm([nb(['C5']), rs(), rs('half')], [nb(['E4']), rs(), rs('half')]), vm([rs('whole')], [rs('whole')])]);
    const g = staff('notation');
    const restY = (glyph, inV2) => nodes(g, (nd, cls) => nd.tag === 'text' && nd.textContent === glyph && cls.includes('voice-2') === inV2).map((nd) => +nd.getAttribute('y'));
    eq([restY(restForDuration('quarter'), false), restY(restForDuration('half'), false), restY(restForDuration('whole'), false)], [[BL - 2 * S], [BL - 2 * S], [BL - 3 * S]]);
    eq(['quarter', 'half', 'whole'].map((d) => restY(restForDuration(d), true).length), [0, 0, 0]);
    eq(nodes(g, (nd) => nd.tag === 'line' && nd.getAttribute('y1') === nd.getAttribute('y2') && (+nd.getAttribute('y1') < 0 || +nd.getAttribute('y1') > BL)).length, 0, 'no ledger');
    eq([ms[0].elements2[1].rendered.hidden, ms[0].elements2[2].rendered.hidden, ms[1].elements2[0].rendered.hidden, ms[1].elements[0].wholeMeasureRest], [true, true, true, true]);
  });
  test('R5 TAB (rhythm band): the merged rest is drawn once inside the staff with its knock-out', () => {
    const fr = (string, fret, d = 'quarter') => ({ type: 'note', duration: d, notes: [{ string, fret }] });
    const { staff } = draw([vm([fr(2, 5), rs(), fr(1, 3, 'half')], [fr(5, 2), rs(), fr(5, 4, 'half')])], { showStandardNotation: false, showTablature: true });
    const restGs = nodes(staff('tab'), (nd) => nd.tag === 'g' && nd.getAttribute('class') === 'tab-rest');
    eq([restGs.length, restGs[0].children[0].tag, restGs[0].children[1].textContent], [1, 'rect', restForDuration('quarter')]);
  });
  test('R5 fermatas: on a merged rest only the voice-1 fermata is drawn', () => {
    const svg = renderTree({ tracks: [{ showStandardNotation: true, measures: [vm([nb(['C5'], 'half'), rs('half', { fermata: true })], [nb(['E4'], 'half'), rs('half', { fermata: 'long' })])] }] });
    const fs = nodes(svg, (nd) => nd.tag === 'g' && /^fermata( |$)/.test(nd.getAttribute('class') || ''));
    eq(fs.map((f) => f.getAttribute('class')), ['fermata']);
  });
}

// ---------- 1.8.0: shared unison noteheads (R4, layout/voices.js sharedHead) ----------
{
  const { computeLayout } = await imp('src/layout/index.js');
  const { drawSystem } = await imp('src/draw/system.js');
  const { stemDxSp } = await imp('src/layout/chord.js');
  const th = resolveTheme();
  const S = th.staffLineSpacing;
  const nb = (ps, duration = 'quarter', x = {}) => ({ type: 'note', duration, notes: ps.map((p) => (typeof p === 'string' ? { pitch: p } : p)), ...x });
  const rs = (duration = 'quarter', x = {}) => ({ type: 'rest', duration, ...x });
  const vm = (b1, b2, x = {}) => ({ ...x, voices: [{ beats: b1 }, { beats: b2 }] });
  const nodes = (g, pred) => [...walk(g)].filter(({ nd, cls }) => pred(nd, cls)).map(({ nd }) => nd);
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  const draw = (measures) => {
    const sc = normalizeScore({ tracks: [{ showStandardNotation: true, measures }] });
    const sys = computeLayout(sc, th, 900).systems[0];
    const d = drawSystem(makeContainer(), sys, 0, sc, th);
    return { ms: sys.tracks[0].measures, g: d.staves[0].g };
  };
  const heads = (g, x) => nodes(g, (nd) => nd.tag === 'text' && /[-]/u.test(nd.textContent) && Math.abs(+nd.getAttribute('x') - x) < 0.01);
  test('R4: an eligible unison draws one head; voice 2 at the column x (dx 0) with its head flagged shared', () => {
    const { ms, g } = draw([vm([nb(['G4']), nb(['C5']), rs('half')], [nb(['G4']), nb(['E4']), rs('half')])]);
    const [v1, v2] = [ms[0].elements[0], ms[0].elements2[0]];
    eq([v2.dx, v2.x === v1.x, v2.chord.heads[0].shared, v1.chord.heads[0].shared], [0, true, true, undefined]);
    eq(heads(g, v1.x).length, 1);
    eq([v2.rendered.noteheads.length, near(v2.rendered.noteheads[0].x, v1.x)], [1, true], 'voice 2 keeps its notehead record (ties)');
  });
  test('R4: two stems at the anchors of the shared head, voice 1 up on the right, voice 2 down on the left', () => {
    const { ms } = draw([vm([nb(['G4']), nb(['C5']), rs('half')], [nb(['G4']), nb(['E4']), rs('half')])]);
    const [r1, r2] = [ms[0].elements[0].rendered, ms[0].elements2[0].rendered];
    const NH = String.fromCodePoint(0xE0A4);
    eq([near(r1.stemAttachX, ms[0].elements[0].x + stemDxSp(NH, true) * S), near(r2.stemAttachX, ms[0].elements[0].x + stemDxSp(NH, false) * S), r1.stemUp, r2.stemUp], [true, true, true, false]);
  });
  test('R4: one accidental and one dot set for the shared head; voice 2 keeps the dots of its other heads', () => {
    const { ms, g } = draw([vm([nb(['F#4'], 'half', { dots: 1 }), nb(['C5'])], [nb(['F#4', 'C4'], 'half', { dots: 1 }), nb(['E4'])])]);
    const [v1, v2] = [ms[0].elements[0], ms[0].elements2[0]];
    eq([v1.chord.accidentals.length, v2.chord.accidentals.length, v2.dx], [1, 0, 0]);
    eq(nodes(g, (nd) => nd.tag === 'text' && nd.textContent === String.fromCodePoint(0xE262)).length, 1, 'one sharp');
    // F#4 = pos 1 (space): voice 1 dot at 1; voice 2's own dot on 1 dropped, C4 (pos -2, line) keeps its dot at -3
    eq([v1.chord.dots.positions, v2.chord.dots.positions], [[1], [-3]]);
  });
  test('R4: ties stay per voice on a shared head', () => {
    const svg = renderTree({ tracks: [{ showStandardNotation: true, measures: [
      vm([nb([{ pitch: 'G4', tieStart: true }], 'half'), nb(['C5'], 'half')], [nb([{ pitch: 'G4', tieStart: true }], 'half'), nb(['E4'], 'half')]),
      vm([nb([{ pitch: 'G4', tieEnd: true }], 'whole')], [nb([{ pitch: 'G4', tieEnd: true }], 'whole')])] }] });
    const ties = nodes(svg, (nd) => nd.tag === 'path' && nd.getAttribute('class') === 'tie');
    eq(ties.length, 2);
  });
  test('R4: whole notes share one head and draw no stem', () => {
    const { ms, g } = draw([vm([nb(['G4'], 'whole')], [nb(['G4'], 'whole')])]);
    eq([ms[0].elements2[0].dx, heads(g, ms[0].elements[0].x).length, nodes(g, (nd) => nd.tag === 'line' && nd.getAttribute('stroke-width') === String(th.stemWidth)).length], [0, 1, 0]);
  });
  test('R4: non-eligible unisons keep the 1.4 clash shift (other second, crossing, displaced head)', () => {
    const plain = (stemDxSp(String.fromCodePoint(0xE0A4), true) - stemDxSp(String.fromCodePoint(0xE0A4), false)) * S;
    const dx = (b1, b2) => draw([vm([b1, nb(['C5']), rs('half')], [b2, nb(['E4']), rs('half')])]).ms[0].elements2[0].dx;
    eq(dx(nb(['G4']), nb(['G4', 'F4'])) >= plain, true, 'voice-2 second below the unison');
    eq(dx(nb(['G4', 'A4']), nb(['G4'])) > plain, true, 'voice-1 second (displaced head)');
    eq(dx(nb(['G4']), nb(['G4', 'A4'])) > 0, true, 'crossing');
  });
}

// ---------- 1.8.0: two-voice TAB rhythm rows (R2) and band-row rests (R3) ----------
{
  const TR = await imp('src/layout/tabRhythm.js');
  const { tabRow2TopY } = await imp('src/draw/tabRhythm.js');
  const { inkBounds } = await imp('src/layout/ink.js');
  const { computeLayout } = await imp('src/layout/index.js');
  const { glyphBox } = await imp('src/glyphMetrics.js');
  const th = resolveTheme();
  const S = th.staffLineSpacing;
  const LB = 5 * th.tabStaffLineSpacing; const T1 = TR.tabStemTopY(LB, th);
  const fr = (string, fret, duration = 'quarter', x = {}) => ({ type: 'note', duration, notes: [{ string, fret }], ...x });
  const rs = (duration = 'quarter', x = {}) => ({ type: 'rest', duration, ...x });
  const vm = (b1, b2) => ({ voices: [{ beats: b1 }, { beats: b2 }] });
  const q4 = (st) => [fr(st, 1), fr(st, 2), fr(st, 3), fr(st, 4)];
  const tabScore = (measures) => ({ tracks: [{ showStandardNotation: false, showTablature: true, measures }] });
  const nodes = (g, pred) => [...walk(g)].filter(({ nd, cls }) => pred(nd, cls)).map(({ nd }) => nd);
  const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;
  const row = (svg, v2) => nodes(svg, (nd) => nd.tag === 'g' && nd.getAttribute('class') === (v2 ? 'tab-rhythm voice-2' : 'tab-rhythm'));
  const stemTops = (gs) => [...new Set(gs.flatMap((g) => nodes(g, (nd) => nd.tag === 'line').map((l) => +l.getAttribute('y1'))))];
  test('R2: voice 2\'s stems hang from T2 = T1 + (max(2.5, D1) + 1.5) sp; by default LB + 5 sp', () => {
    eq(T1, LB + S);
    const svg = renderTree(tabScore([vm(q4(1), q4(5))]));
    eq([stemTops(row(svg, false)), stemTops(row(svg, true))], [[T1], [LB + 5 * S]]);
  });
  test('R2: a deeper voice-1 band (beamed 64ths, 4 sp) pushes T2 down for its own system only', () => {
    const deep = vm([...Array(16)].map(() => fr(1, 1, '64th')).concat([fr(1, 2, 'half', { dots: 1 })]), q4(5));
    const svg = renderTree(tabScore([deep, vm(q4(1), q4(5))]), 330);
    const systems = nodes(svg, (nd) => nd.tag === 'g' && /^system /.test(nd.getAttribute('class') || ''));
    eq(systems.length, 2);
    eq(systems.map((sys) => stemTops(row(sys, true))), [[T1 + (4 + 1.5) * S], [LB + 5 * S]]);
  });
  test('R2: the probe depth is the ink voice 1\'s row actually draws (flag tails, tuplet brackets)', () => {
    const t3 = (f) => fr(1, f, '16th', { tuplet: 3 });
    for (const b1 of [[fr(1, 1, '32nd'), rs('32nd'), rs('16th'), rs('8th'), rs('half', { dots: 1 })], [t3(1), rs('16th', { tuplet: 3 }), t3(2), rs('8th'), rs('half', { dots: 1 })]]) {
      const sc = normalizeScore(tabScore([vm(b1, q4(5))]));
      const m = computeLayout(sc, th, 900).systems[0].tracks[0].measures[0];
      const svg = renderTree(tabScore([vm(b1, q4(5))]));
      const d1 = (inkBounds(row(svg, false)[0], th).bottom - T1) / S;
      eq(d1 > 2.5, true, 'deeper than the minimum');
      eq(near(tabRow2TopY([m], 6, LB, th), T1 + (d1 + 1.5) * S), true);
      eq(stemTops(row(svg, true)).map((y) => +y.toFixed(6)), [+(T1 + (d1 + 1.5) * S).toFixed(6)]);
    }
  });
  test('R3: band-row rest glyphs at tabFlagScale, heights 2.24 / 1.28 / 2.04 / 2.78 / 3.54 sp, centred 1.25 sp below T but top >= T', () => {
    const hs = ['quarter', '8th', '16th', '32nd', '64th'].map((d) => { const { box } = TR.tabBandRest(d, th); return box.top - box.bottom; });
    eq(hs.map((h, i) => near(h, [2.24, 1.28, 2.04, 2.78, 3.54][i], 0.006)), [true, true, true, true, true]);
    ['whole', 'half', 'quarter', '8th', '16th', '32nd', '64th'].forEach((d) => {
      const { box } = TR.tabBandRest(d, th);
      const y = TR.tabBandRestY(100, box, S);
      const top = y - box.top * S; const centre = y - ((box.top + box.bottom) / 2) * S;
      eq([top >= 100 - 1e-9, near(centre, 100 + 1.25 * S) || near(top, 100)], [true, true], d);
    });
  });
  test('R3: whole / half rests in a row use the leger-line glyphs E4F4 / E4F5', () => {
    eq([TR.tabBandRest('whole', th).glyph, TR.tabBandRest('half', th).glyph].map((g) => g.codePointAt(0).toString(16)), ['e4f4', 'e4f5']);
    const svg = renderTree(tabScore([vm([fr(1, 1, 'half'), fr(1, 2, 'half')], [rs('half'), fr(5, 2, 'half')])]));
    const rest = nodes(row(svg, true)[0], (nd) => nd.tag === 'text')[0];
    eq([rest.textContent.codePointAt(0).toString(16), +rest.getAttribute('font-size')], ['e4f5', 40 * th.tabFlagScale]);
  });
  test('R3: unmerged rests sit in their own row without a knock-out; dots on the row\'s dot line', () => {
    const svg = renderTree(tabScore([vm([rs('quarter', { dots: 1 }), fr(1, 1, '8th'), fr(1, 2, 'half')], [fr(5, 1), fr(5, 2), rs('half')])]));
    const r1 = nodes(row(svg, false)[0], (nd) => nd.tag === 'g' && nd.getAttribute('class') === 'tab-rest')[0];
    const r2 = nodes(row(svg, true)[0], (nd) => nd.tag === 'g' && nd.getAttribute('class') === 'tab-rest')[0];
    eq([r1.children.map((c) => c.tag), r2.children.map((c) => c.tag)], [['text', 'circle'], ['text']]);
    const { box } = TR.tabBandRest('quarter', th);
    eq([+r1.children[0].getAttribute('y'), +r1.children[1].getAttribute('cy')], [TR.tabBandRestY(T1, box, S), T1 + TR.TAB_DOT_ROW_SP * S]);
    eq(near(+r1.children[1].getAttribute('cx') - +r1.children[0].getAttribute('x'), (box.width / 2 + 0.5) * S), true, 'first dot');
  });
  test('R3: a whole-measure rest is centred in its row (unless merged); tabRhythmExtents rowRest uses the band box', () => {
    const sc = normalizeScore(tabScore([vm([rs('whole')], q4(5))]));
    const m = computeLayout(sc, th, 900).systems[0].tracks[0].measures[0];
    const svg = renderTree(tabScore([vm([rs('whole')], q4(5))]));
    const t = nodes(row(svg, false)[0], (nd) => nd.tag === 'text')[0];
    eq([+(+t.getAttribute('x')).toFixed(2), t.textContent.codePointAt(0).toString(16)], [+((m.contentX + m.endX) / 2).toFixed(2), 'e4f4']);
    const half = (d) => TR.tabRhythmExtents(rs(d), false, th, true).left;
    eq(near(half('quarter'), glyphBox('restQuarter').width * th.tabFlagScale / 2 * S), true);
    eq(near(half('whole'), glyphBox('restWholeLegerLine').width * th.tabFlagScale / 2 * S), true);
    eq(near(TR.tabRhythmExtents(rs('8th', { dots: 1 }), false, th, true).right, (glyphBox('rest8th').width * th.tabFlagScale / 2 + 0.5 + 0.17) * S), true);
    eq(TR.tabRhythmExtents(rs('8th'), false, th), TR.tabRhythmExtents(rs('8th'), false, th, false), 'default unchanged');
  });
}

// ---------- 1.8.0: voice-2 marks below the notation staff and per TAB column (R1) ----------
{
  const { computeLayout } = await imp('src/layout/index.js');
  const { drawSystem } = await imp('src/draw/system.js');
  const P = await imp('src/draw/passes.js');
  const { renderVoice2Directions } = await imp('src/draw/voice2Marks.js');
  const { elementBottom } = await imp('src/draw/notation.js');
  const { tapMarkBox } = await imp('src/draw/tab.js');
  const { glyphBox } = await imp('src/glyphMetrics.js');
  const th = resolveTheme();
  const S = th.staffLineSpacing; const BL = 4 * S;
  const nb = (ps, duration = 'quarter', x = {}) => ({ type: 'note', duration, notes: ps.map((p) => (typeof p === 'string' ? { pitch: p } : p)), ...x });
  const rs = (duration = 'quarter', x = {}) => ({ type: 'rest', duration, ...x });
  const vm = (b1, b2) => ({ voices: [{ beats: b1 }, { beats: b2 }] });
  const nodes = (g, pred) => [...walk(g)].filter(({ nd, cls }) => pred(nd, cls)).map(({ nd }) => nd);
  const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
  const ofClass = (g, c) => nodes(g, (nd) => nd.tag === 'g' && (nd.getAttribute('class') || '').split(' ').includes(c));
  // System 1 drawn, then passes 1-5 (enough for the marks below and their clearances), on a 900 px layout.
  const draw = (measures, track = {}) => {
    const sc = normalizeScore({ tracks: [{ showStandardNotation: true, ...track, measures }] });
    const { systems } = computeLayout(sc, th, 900);
    const d = drawSystem(makeContainer(), systems[0], 0, sc, th);
    P.renderTiesAndSlurs(sc, d.runs, th, systems); P.renderGraceSlurs(sc, d.runs, th);
    P.renderTabArticulations(sc, d.runs, th, systems); P.renderTechniqueLabelRuns(sc, d.runs, th, systems);
    P.renderPlayingDirections(sc, d.runs, th, systems);
    return { ms: systems[0].tracks[0].measures, staff: (kind) => d.staves.find((st) => st.kind === kind)?.g, runs: d.runs };
  };
  const glyphTop = (gEl, name) => +gEl.children[0].getAttribute('y') - glyphBox(name).top * S;
  const glyphBottom = (gEl, name) => +gEl.children[0].getAttribute('y') - glyphBox(name).bottom * S;
  const ornTop = (g) => glyphTop(ofClass(g, 'ornament')[0], 'ornamentTurn');

  test('R1 notation: voice 2 stacks ornament, letters, tap, golpe, pick stroke 0.4 sp apart below the staff, then the inverted fermata 0.5 sp below', () => {
    const all = nb([{ pitch: 'E4', ornament: 'turn', rightFinger: 'p', tap: true }], 'quarter', { golpe: true, pickStroke: 'down', fermata: true });
    const { staff } = draw([vm([nb(['C5'], 'whole')], [all, rs(), rs('half')])]);
    const g = staff('notation');
    const v2 = ofClass(g, 'voice-2').find((v) => ofClass(v, 'ornament').length);
    eq(!!v2 && ofClass(v2, 'fermata').length, 1, 'one voice-2 marks group holds them');
    const size = 1.1 * S;
    const orn = [ornTop(g), glyphBottom(ofClass(g, 'ornament')[0], 'ornamentTurn')];
    const ly = +ofClass(g, 'fingering-right')[0].children[0].getAttribute('y');
    const letters = [ly - 0.8 * size, ly + 0.25 * size];
    const tap = tapMarkBox(0, +ofClass(g, 'tap')[0].children[0].getAttribute('y'), th, 'tap');
    const golpe = [glyphTop(ofClass(g, 'golpe')[0], 'guitarGolpe'), glyphBottom(ofClass(g, 'golpe')[0], 'guitarGolpe')];
    const pick = [glyphTop(ofClass(g, 'pick-stroke')[0], 'stringsDownBow'), glyphBottom(ofClass(g, 'pick-stroke')[0], 'stringsDownBow')];
    const ferm = glyphTop(ofClass(g, 'fermata')[0], 'fermataBelow');
    const layers = [orn, letters, [tap.top, tap.bottom], golpe, pick];
    eq(orn[0] >= BL + S - 1e-9, true, 'below the staff');
    layers.slice(1).forEach((l, i) => eq(near(l[0] - layers[i][1], 0.4 * S), true, `gap ${i}`));
    eq([near(ferm - pick[1], 0.5 * S), ofClass(g, 'fermata')[0].getAttribute('class')], [true, 'fermata fermata-below']);
  });
  test('R1 notation: clearBottom terms - own ink, vibrato, stemless tremolo, tuplet, voice 1 in the column, slurs below, label runs, rest', () => {
    const turn = (p, d = 'quarter', x = {}) => nb([{ pitch: p, ornament: 'turn' }], d, x);
    const fill = [rs(), rs('half')];
    let r = draw([vm([nb(['C5'], 'whole')], [turn('E4'), ...fill])]);
    eq(near(ornTop(r.staff('notation')), elementBottom(r.ms[0].elements2[0].rendered) + S), true, 'own ink + 1');
    r = draw([vm([nb(['C5'], 'whole')], [turn('E4', 'quarter', { vibrato: true }), ...fill])]);
    eq(near(ornTop(r.staff('notation')), elementBottom(r.ms[0].elements2[0].rendered) + 2 * S), true, 'vibrato + 2');
    r = draw([vm([nb(['C5'], 'whole')], [turn('G4', 'whole', { tremolo: true })])]);
    eq(near(ornTop(r.staff('notation')), elementBottom(r.ms[0].elements2[0].rendered) + 2.8 * S), true, 'stemless tremolo + 2.8');
    r = draw([vm([nb(['C5'], 'whole')], [turn('E4', '8th', { tuplet: 3 }), nb(['E4'], '8th', { tuplet: 3 }), nb(['E4'], '8th', { tuplet: 3 }), rs(), rs('half')])]);
    eq(near(ornTop(r.staff('notation')), r.ms[0].elements2[0].rendered.tupletBottomY + 1.1 * S), true, 'tuplet + 1.1');
    r = draw([vm([nb(['C4'], 'whole')], [turn('G4', 'whole')])]);
    eq(near(ornTop(r.staff('notation')), elementBottom(r.ms[0].elements[0].rendered) + S), true, 'voice 1 in the column + 1');
    r = draw([vm([nb(['C5'], 'whole')], [nb(['E4'], 'quarter', { slurStart: true }), turn('F4'), nb(['E4'], 'half', { slurEnd: true })])]);
    eq(ornTop(r.staff('notation')) > elementBottom(r.ms[0].elements2[1].rendered) + S + 1e-6, true, 'slur below pushes it down');
    r = draw([vm([nb(['C5'], 'half', { letRing: true }), nb(['C5'], 'half', { letRing: true })], [turn('E4'), rs(), rs('half')])]);
    const label = (r.runs[0].labelBoxes || []).filter((b) => b.top >= BL);
    eq(label.length > 0 && ornTop(r.staff('notation')) >= Math.max(...label.map((b) => b.bottom)) + 0.4 * S - 1e-9, true, 'label run + 0.4');
    r = draw([vm([nb(['C5'], 'whole')], [nb(['E4']), rs('quarter', { fermata: true }), rs('half')])]);
    eq(near(glyphTop(ofClass(r.staff('notation'), 'fermata')[0], 'fermataBelow'), r.ms[0].elements2[1].rendered.restBottomY + S), true, 'rest + 1');
  });
  test('R1 notation: consecutive voice-2 trills share the lowest line; picks of a voice-2 beam group share the lowest top', () => {
    const tr = (p) => nb([{ pitch: p, trill: true }]);
    let r = draw([vm([nb(['C5'], 'whole')], [tr('C4'), tr('G4'), rs('half')])]);
    const ys = ofClass(r.staff('notation'), 'trill').map((t) => +t.children[0].getAttribute('y'));
    eq([ys.length, ys[0] === ys[1]], [2, true]);
    eq(ys[0] > glyphBox('ornamentTrill').top * S + elementBottom(r.ms[0].elements2[0].rendered) + S - 1e-6, true, 'lowest of the two');
    r = draw([vm([nb(['C5'], 'whole')], [nb(['C4'], '8th', { pickStroke: 'down' }), nb(['G4'], '8th', { pickStroke: 'up' }), rs(), rs('half')])]);
    const [pd, pu] = ofClass(r.staff('notation'), 'pick-stroke');
    eq(near(glyphTop(pd, 'stringsDownBow'), glyphTop(pu, 'stringsUpBow')), true, 'one top line');
  });
  test('R1 notation: dynamics in the system move down below voice-2 marks', () => {
    const svgOf = (x) => renderTree({ tracks: [{ showStandardNotation: true, measures: [vm([nb(['C5'], 'whole', { dynamic: 'ff' })], [nb(['E4'], 'quarter', x), rs(), rs('half')])] }] });
    const dy = (svg) => +nodes(svg, (nd) => nd.tag === 'text' && nd.getAttribute('class') === 'dynamic')[0].getAttribute('y');
    eq(dy(svgOf({ golpe: true, pickStroke: 'down' })) > dy(svgOf({})), true);
  });
  const fr = (string, fret, d = 'quarter', x = {}, n = {}) => ({ type: 'note', duration: d, notes: [{ string, fret, ...n }], ...x });
  test('R1 TAB: voice 1 wins each category it has; a category only voice 2 has is drawn in the voice-1 column', () => {
    const { ms, staff } = draw([vm([fr(2, 5, 'half', { tremolo: '8th' }, { tap: true }), fr(2, 7, 'half')],
      [fr(4, 2, 'half', { tremolo: '32nd', golpe: true }, { slap: true }), fr(4, 4, 'half', { vibrato: true })])], { showTablature: true });
    const g = staff('tab');
    eq([ofClass(g, 'tab-tremolo').map((t) => t.getAttribute('class')), ofClass(g, 'tap').length, ofClass(g, 'slap').length, ofClass(g, 'golpe').length, ofClass(g, 'tab-vibrato').length],
      [['tab-tremolo tab-tremolo-8th'], 1, 0, 1, 1]);
    eq([Object.keys(ms[0].elements[0].tabMarks), Object.keys(ms[0].elements[1].tabMarks)], [['golpe'], ['vibrato']]);
    eq(near(+ofClass(g, 'golpe')[0].children[0].getAttribute('x') + glyphBox('guitarGolpe').width * S / 2, ms[0].elements[0].x), true, 'golpe at the column x');
  });
  test('R1 TAB: a tremolo column sits above a higher voice-2 fret (topString); voice-2-only onsets carry their own marks', () => {
    const top = (string) => { const { staff } = draw([vm([fr(3, 5, 'whole', { tremolo: true })], [fr(string, 2, 'whole')])], { showTablature: true });
      return Math.min(...ofClass(staff('tab'), 'tab-tremolo')[0].children.map((l) => +l.getAttribute('y2'))); };
    eq(top(1) < top(5) - 1.4 * th.tabStaffLineSpacing, true);
    const { ms, staff } = draw([vm([fr(2, 5, 'half'), fr(2, 7, 'half')], [fr(4, 2), fr(4, 3, 'quarter', { tremolo: true }, { tap: true }), rs('half')])], { showTablature: true });
    const own = ms[0].elements2[1];
    eq([own.tabOwn, own.tabEl.tremolo, ms[0].elements2[0].tabOwn], [true, true, undefined]);
    eq([near(+ofClass(staff('tab'), 'tap')[0].children[0].getAttribute('x'), own.x - own.dx), ofClass(staff('tab'), 'tab-tremolo').length], [true, 1]);
  });
  test('R1 TAB: whammy and strum stay with voice 1, also at a voice-2-only onset', () => {
    const mk = (x) => serialize(renderTree({ tracks: [{ showStandardNotation: false, showTablature: true, measures: [vm([fr(2, 5, 'half'), fr(2, 7, 'half')], [fr(4, 2), fr(4, 3, 'quarter', x), rs('half')])] }] }));
    eq([mk({ whammy: true }) === mk({}), mk({ strum: 'down' }) === mk({})], [true, true]);
  });
  test('R1 tab-only: right-hand letters and pick stroke - voice 1 wins as a whole, else the voice-2 ones at the column', () => {
    const svgOf = (x1, n1, x2, n2) => renderTree({ tracks: [{ showStandardNotation: false, showTablature: true, measures: [vm([fr(2, 5, 'whole', x1, n1)], [fr(4, 2, 'whole', x2, n2)])] }] });
    const letters = (svg) => ofClass(svg, 'fingering-right').map((f) => f.children.map((t) => t.textContent));
    eq(letters(svgOf({}, { rightFinger: 'i' }, {}, { rightFinger: 'm' })), [['i']]);
    eq(letters(svgOf({}, {}, {}, { rightFinger: 'm' })), [['m']]);
    eq(ofClass(svgOf({ strum: 'down' }, {}, { pickStroke: 'up' }, {}), 'pick-stroke').length, 0, 'voice 1 strum takes the pick slot');
    eq(ofClass(svgOf({}, {}, { pickStroke: 'up' }, {}), 'pick-stroke').map((p) => p.getAttribute('class')), ['pick-stroke pick-stroke-up']);
  });
}

// ---------- 1.8.0: tied-to frets in parentheses on TAB (R6, track.tiedFrets: 'parens') ----------
{
  const TM = await imp('src/textMetrics.js');
  const { tabExtents } = await imp('src/layout/timeline.js');
  const th = resolveTheme();
  const S = th.staffLineSpacing;
  const P = { tiedParens: true };
  const fr = (string, fret, d = 'half', n = {}, x = {}) => ({ type: 'note', duration: d, notes: [{ string, fret, ...n }], ...x });
  const nodes = (g, pred) => [...walk(g)].filter(({ nd, cls }) => pred(nd, cls)).map(({ nd }) => nd);
  const labels = (svg) => nodes(svg, (nd, cls) => nd.tag === 'text' && cls.some((c) => /staff-tab/.test(c)) && +nd.getAttribute('font-size') === th.tabFontSize).map((nd) => nd.textContent);
  const tabScore = (measures, extra = {}) => ({ tracks: [{ showStandardNotation: false, showTablature: true, tabRhythm: false, tiedFrets: 'parens', ...extra, measures }] });
  test('R6 fretLabel: (5) ~1.57 sp, (12) ~2.17, (<12>) ~3.49, (5(17)); ghost / release not wrapped twice; mute stays x', () => {
    const w = (n) => +(TM.fretLabelWidth(TM.fretLabel({ tieEnd: true, ...n }, P), th) / S).toFixed(2);
    eq([TM.fretLabel({ fret: 5, tieEnd: true }, P), w({ fret: 5 }), TM.fretLabel({ fret: 12, tieEnd: true }, P), w({ fret: 12 })], ['(5)', 1.57, '(12)', 2.17]);
    eq([TM.fretLabel({ fret: 12, harmonic: 'natural', tieEnd: true }, P), w({ fret: 12, harmonic: 'natural' })], ['(<12>)', 3.49]);
    eq(TM.fretLabel({ fret: 5, harmonic: 'artificial', harmonicFret: 17, tieEnd: true }, P), '(5(17))');
    eq([{ fret: 5, ghost: true }, { fret: 5, bend: 'release' }, { fret: 5, mute: true }, { fret: 5, mute: true, ghost: true }].map((n) => TM.fretLabel({ ...n, tieEnd: true }, P)), ['(5)', '(5)', 'x', '(x)']);
    eq([TM.fretLabel({ fret: 5, tieEnd: true }), TM.fretLabel({ fret: 5, tieEnd: true }, undefined), TM.fretLabel({ fret: 5 }, P)], ['5', '5', '5']);
  });
  test('R6 normalize / options: tiedFretsMode trims any case; tiedFretOpts only for main beats of an opted-in track', () => {
    eq([' Parens ', 'PARENS', 'parens', 'paren', true, null, 1].map(TM.tiedFretsMode), ['parens', 'parens', 'parens', null, null, null, null]);
    const on = { tiedFrets: 'parens' };
    eq([TM.tiedFretOpts(on, { type: 'note' }), TM.tiedFretOpts(on, { type: 'grace' }), TM.tiedFretOpts({}, { type: 'note' }), TM.tiedFretOpts({ tiedFrets: null }, { type: 'note' })], [P, undefined, undefined, undefined]);
    eq(Object.isFrozen(TM.tiedFretOpts(on, { type: 'note' })), true);
  });
  test('R6 drawing: both voices, across a system break, graces unchanged, a control track without the option', () => {
    const tie = (s, f) => [fr(s, f, 'half', { tieStart: true }), fr(s, f, 'half', { tieEnd: true })];
    eq(labels(renderTree(tabScore([{ beats: tie(2, 5) }]))), ['5', '(5)']);
    eq(labels(renderTree(tabScore([{ voices: [{ beats: tie(1, 3) }, { beats: tie(4, 7) }] }]))).sort(), ['(3)', '(7)', '3', '7']);
    const brk = renderTree(tabScore([{ beats: [fr(1, 1, 'half'), fr(2, 5, 'half', { tieStart: true })] }, { beats: [fr(2, 5, 'whole', { tieEnd: true })] }]), 140);
    eq(labels(brk), ['1', '5', '(5)']);
    eq(labels(renderTree(tabScore([{ beats: [{ type: 'grace', notes: [{ string: 2, fret: 5, tieEnd: true }] }, fr(2, 7, 'whole')] }]))), ['5', '7']);
    eq(labels(renderTree(tabScore([{ beats: tie(2, 5) }], { tiedFrets: undefined }))), ['5', '5']);
  });
  test('R6 room: knock-out, tabExtents, slide inset use the same label', () => {
    const svg = renderTree(tabScore([{ beats: tie2() }]));
    function tie2() { return [fr(2, 5, 'half', { tieStart: true }), fr(2, 5, 'half', { tieEnd: true })]; }
    const rects = nodes(svg, (nd, cls) => nd.tag === 'rect' && cls.some((c) => /staff-tab/.test(c))).map((r) => +(+r.getAttribute('width')).toFixed(2));
    eq(rects.includes(+TM.fretLabelWidth('(5)', th).toFixed(2)), true, 'knock-out');
    const el = { type: 'note', notes: [{ string: 2, fret: 5, tieEnd: true }] };
    eq([tabExtents(el, th, P).left, tabExtents(el, th).left], [TM.fretLabelWidth('(5)', th) / 2, TM.fretLabelWidth('5', th) / 2]);
    const slid = (extra) => renderTree(tabScore([{ beats: [fr(2, 3, 'half', { slide: true }), fr(2, 5, 'half', { tieEnd: true })] }], extra));
    const endX = (s) => Math.max(...nodes(s, (nd, cls) => nd.tag === 'line' && cls.some((c) => /staff-tab/.test(c)) && nd.getAttribute('stroke-linecap') === 'round' && nd.getAttribute('y1') !== nd.getAttribute('y2')).map((l) => +l.getAttribute('x2')));
    eq(endX(slid({})) < endX(slid({ tiedFrets: undefined })), true, 'slide stops before the wider label');
  });
  test('R6 opt-in: an absent or unknown tiedFrets renders byte-identical to no key (C0 unaffected)', () => {
    const base = (extra) => serialize(renderTree(tabScore([{ beats: [fr(2, 5, 'half', { tieStart: true }), fr(2, 5, 'half', { tieEnd: true })] }], extra)));
    eq([base({ tiedFrets: undefined }) === base({ tiedFrets: 'x' }), base({ tiedFrets: undefined }) === base({ tiedFrets: null })], [true, true]);
  });
}

// ---------- 1.8.0 verification gap-fill: R1 / R2 / R4 / R5 / R6 edge cases (independent oracles) ----------
{
  const { computeLayout } = await imp('src/layout/index.js');
  const { drawSystem } = await imp('src/draw/system.js');
  const P = await imp('src/draw/passes.js');
  const { elementBottom } = await imp('src/draw/notation.js');
  const { glyphBox } = await imp('src/glyphMetrics.js');
  const { mergedRestPairs } = await imp('src/layout/voices.js');
  const { stemDxSp } = await imp('src/layout/chord.js');
  const TR = await imp('src/layout/tabRhythm.js');
  const th = resolveTheme();
  const S = th.staffLineSpacing; const BL = 4 * S;
  const LB = 5 * th.tabStaffLineSpacing; const T1 = TR.tabStemTopY(LB, th);
  const nb = (ps, duration = 'quarter', x = {}) => ({ type: 'note', duration, notes: ps.map((p) => (typeof p === 'string' ? { pitch: p } : p)), ...x });
  const rs = (duration = 'quarter', x = {}) => ({ type: 'rest', duration, ...x });
  const fr = (string, fret, d = 'quarter', x = {}, n = {}) => ({ type: 'note', duration: d, notes: [{ string, fret, ...n }], ...x });
  const vm = (b1, b2) => ({ voices: [{ beats: b1 }, { beats: b2 }] });
  const nodes = (g, pred) => [...walk(g)].filter(({ nd, cls }) => pred(nd, cls)).map(({ nd }) => nd);
  const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
  const ofClass = (g, c) => nodes(g, (nd) => nd.tag === 'g' && (nd.getAttribute('class') || '').split(' ').includes(c));
  const draw = (measures, track = {}) => {
    const sc = normalizeScore({ tracks: [{ showStandardNotation: true, ...track, measures }] });
    const { systems } = computeLayout(sc, th, 900);
    const d = drawSystem(makeContainer(), systems[0], 0, sc, th);
    P.renderTiesAndSlurs(sc, d.runs, th, systems); P.renderGraceSlurs(sc, d.runs, th);
    P.renderTabArticulations(sc, d.runs, th, systems); P.renderTechniqueLabelRuns(sc, d.runs, th, systems);
    P.renderPlayingDirections(sc, d.runs, th, systems);
    return { ms: systems[0].tracks[0].measures, staff: (kind) => d.staves.find((st) => st.kind === kind)?.g };
  };
  const glyphTop = (gEl, name) => +gEl.children[0].getAttribute('y') - glyphBox(name).top * S;
  const ornTop = (g) => glyphTop(ofClass(g, 'ornament')[0], 'ornamentTurn');
  const code = (t) => t.textContent.codePointAt(0).toString(16);

  test('gap R1 notation: inverted fermata classes and glyphs per kind (E4C1 / E4C5 / E4C7); voice 1 keeps the upright ones', () => {
    const of = (v1f, v2f) => {
      const svg = renderTree({ tracks: [{ showStandardNotation: true, measures: [vm([nb(['C5'], 'half', v1f ? { fermata: v1f } : {}), rs('half')], [nb(['E4'], 'half', v2f ? { fermata: v2f } : {}), rs('half')])] }] });
      return ofClass(svg, 'fermata').map((g) => [g.getAttribute('class'), code(g.children[0])]).sort();
    };
    eq(of(null, true), [['fermata fermata-below', 'e4c1']]);
    eq(of(null, 'short'), [['fermata fermata-short fermata-below', 'e4c5']]);
    eq(of(null, 'long'), [['fermata fermata-long fermata-below', 'e4c7']]);
    eq(of('short', null), [['fermata fermata-short', 'e4c4']]);
    eq(of('long', 'long'), [['fermata fermata-long fermata-below', 'e4c7'], ['fermata fermata-long', 'e4c6']]);
  });
  test('gap R1 notation: clearBottom floor (staff bottom + 1 sp) and wide vibrato (+2.3 sp)', () => {
    const turn = (p, x = {}) => nb([{ pitch: p, ornament: 'turn' }], 'quarter', x);
    let r = draw([vm([nb(['C6'], 'whole')], [turn('G5'), rs(), rs('half')])]);
    eq(elementBottom(r.ms[0].elements2[0].rendered) + S < BL + S, true, 'own ink is above the staff bottom, so the floor binds');
    eq(near(ornTop(r.staff('notation')), BL + S), true, 'B + 1');
    r = draw([vm([nb(['C5'], 'whole')], [turn('E4', { vibrato: 'wide' }), rs(), rs('half')])]);
    eq(near(ornTop(r.staff('notation')), elementBottom(r.ms[0].elements2[0].rendered) + 2.3 * S), true, 'wide vibrato + 2.3');
  });
  test('gap R1 notation: an absent layer is skipped (pick stroke 0.4 sp under the letters, letters 1 sp under the own ink)', () => {
    const { staff, ms } = draw([vm([nb(['C5'], 'whole')], [nb([{ pitch: 'E4', rightFinger: 'm' }], 'quarter', { pickStroke: 'up' }), rs(), rs('half')])]);
    const g = staff('notation');
    const ly = +ofClass(g, 'fingering-right')[0].children[0].getAttribute('y');
    const size = 1.1 * S;
    eq(near(glyphTop(ofClass(g, 'pick-stroke')[0], 'stringsUpBow') - (ly + 0.25 * size), 0.4 * S), true, 'pick under the letters');
    eq(near(ly - 0.8 * size, elementBottom(ms[0].elements2[0].rendered) + S), true, 'letters under the own ink');
  });
  test('gap R1 TAB: trill and vibrato - voice 1 wins (same output as without the voice-2 mark); a voice-2-only trill is drawn; a v1 rest makes the voice-2 column its own', () => {
    const tab = (b1, b2) => serialize(draw([vm(b1, b2)], { showTablature: true }).staff('tab'));
    const t7 = fr(2, 5, 'half', {}, { trill: { fret: 7 } });
    eq(tab([t7, fr(2, 7, 'half')], [fr(4, 2, 'half', {}, { trill: { fret: 9 } }), fr(4, 3, 'half')]) === tab([t7, fr(2, 7, 'half')], [fr(4, 2, 'half'), fr(4, 3, 'half')]), true, 'trill');
    const vib = fr(2, 5, 'half', { vibrato: true });
    eq(tab([vib, fr(2, 7, 'half')], [fr(4, 2, 'half', { vibrato: true }), fr(4, 3, 'half')]) === tab([vib, fr(2, 7, 'half')], [fr(4, 2, 'half'), fr(4, 3, 'half')]), true, 'vibrato: one wave per column');
    eq(ofClass(draw([vm([fr(2, 5, 'half'), fr(2, 7, 'half')], [fr(4, 2, 'half', { vibrato: true }), fr(4, 3, 'half')])], { showTablature: true }).staff('tab'), 'tab-vibrato').length, 1, 'voice-2-only vibrato');
    const only = draw([vm([fr(2, 5, 'half'), fr(2, 7, 'half')], [fr(4, 2, 'half', {}, { trill: { fret: 9 } }), fr(4, 3, 'half')])], { showTablature: true }).staff('tab');
    eq(ofClass(only, 'trill').map((t) => t.children.filter((c) => c.tag === 'text')[1].textContent), ['(9)'], 'voice-2-only trill suffix');
    const own = draw([vm([rs('half'), fr(2, 7, 'half')], [fr(4, 2, 'half', { tremolo: '8th' }), fr(4, 3, 'half')])], { showTablature: true });
    eq([own.ms[0].elements2[0].tabOwn, ofClass(own.staff('tab'), 'tab-tremolo').map((t) => t.getAttribute('class'))], [true, ['tab-tremolo tab-tremolo-8th']], 'v1 rest at the onset');
  });
  test('gap R1: voice-1-only marks on a voice-2 beat (LH finger, barre, pick scrape) draw nothing', () => {
    const mk = (n, b) => serialize(draw([vm([nb(['C5'], 'whole')], [nb([{ pitch: 'E4', ...n }], 'quarter', b), rs(), rs('half')])]).staff('notation'));
    eq(mk({ finger: 2 }, { barre: 3, pickScrape: true }) === mk({}, {}), true);
    const v1 = (n, b) => serialize(draw([vm([nb([{ pitch: 'C5', ...n }], 'whole', b)], [nb(['E4'], 'whole')])]).staff('notation'));
    eq([v1({ finger: 2 }, {}) === v1({}, {}), v1({}, { barre: 3 }) === v1({}, {})], [false, false], 'voice 1 does draw them (not vacuous)');
  });

  const tabScore = (measures) => ({ tracks: [{ showStandardNotation: false, showTablature: true, measures }] });
  const row2 = (svg) => nodes(svg, (nd) => nd.tag === 'g' && nd.getAttribute('class') === 'tab-rhythm voice-2');
  const vlines = (gs) => gs.flatMap((g) => nodes(g, (nd) => nd.tag === 'line')).map((l) => [+l.getAttribute('y1'), +l.getAttribute('y2')]);
  const q4 = (st) => [fr(st, 1), fr(st, 2), fr(st, 3), fr(st, 4)];
  test('gap R2: row-2 stems hang down by tabStemLengthSp (half 1.25, quarter 2.5, 32nd 3.25, whole none); beams flush at the stem ends, levels beamWidth + 0.2 sp apart', () => {
    const svg = renderTree(tabScore([vm([fr(1, 1, 'half'), fr(1, 2, 'half')], [fr(5, 1, 'half'), fr(5, 2), ...Array(8).fill(0).map(() => fr(5, 3, '32nd'))]), vm([fr(1, 1, 'whole')], [fr(5, 1, 'whole')])]));
    const T2 = LB + 5 * S;
    const ls = vlines(row2(svg));
    eq(ls.length, 10, 'the whole note draws no stem');
    eq(ls.map(([a]) => a), Array(10).fill(T2));
    eq(ls.map(([, b]) => +((b - T2) / S).toFixed(4)), [1.25, 2.5, ...Array(8).fill(3.25)]);
    const beams = nodes(row2(svg)[0], (nd) => nd.tag === 'path').map((p) => p.getAttribute('d').match(/-?\d+(\.\d+)?/g).map(Number).filter((_, i) => i % 2 === 1));
    const end = T2 + 3.25 * S; const step = th.beamWidth + 0.2 * S;
    eq(beams.map((ys) => [+Math.max(...ys).toFixed(6), +Math.min(...ys).toFixed(6)]), [0, 1, 2].map((k) => [+(end - k * step).toFixed(6), +(end - k * step - th.beamWidth).toFixed(6)]));
  });
  test('gap R2: a deep voice-1 band in a single-voice measure of the same system does not push T2', () => {
    const deep = { beats: [...Array(16)].map(() => fr(1, 1, '64th')).concat([fr(1, 2, 'half', { dots: 1 })]) };
    const svg = renderTree(tabScore([deep, vm(q4(1), q4(5))]), 1600);
    eq(nodes(svg, (nd) => nd.tag === 'g' && /^system /.test(nd.getAttribute('class') || '')).length, 1, 'one system');
    eq([...new Set(vlines(row2(svg)).map(([a]) => a))], [LB + 5 * S]);
  });
  test('gap R3: a voice-1 rest over a voice-2 fret sits in row 1 and a voice-2 rest in row 2, neither knocked out; the fret under the rest is drawn', () => {
    const svg = renderTree(tabScore([vm([rs(), fr(1, 3), fr(1, 4, 'half')], [fr(5, 2), rs(), fr(5, 5, 'half')])]));
    const rests = nodes(svg, (nd) => nd.tag === 'g' && nd.getAttribute('class') === 'tab-rest');
    eq(rests.map((g) => g.children.map((c) => c.tag)), [['text'], ['text']]);
    const { box } = TR.tabBandRest('quarter', th);
    const ys = rests.map((g) => +g.children[0].getAttribute('y'));
    eq([near(ys[0], TR.tabBandRestY(T1, box, S)), near(ys[1], TR.tabBandRestY(LB + 5 * S, box, S))], [true, true]);
    const frets = nodes(svg, (nd) => nd.tag === 'text' && +nd.getAttribute('font-size') === th.tabFontSize).map((nd) => nd.textContent);
    eq([...frets].sort(), ['2', '3', '4', '5']);
  });

  test('gap R4: a unison with other heads a third away shares (both sides); a later onset and a second below do not', () => {
    const plain = (stemDxSp(String.fromCodePoint(0xE0A4), true) - stemDxSp(String.fromCodePoint(0xE0A4), false)) * S;
    const col = (b1, b2) => draw([vm([b1, nb(['C5']), rs('half')], [b2, nb(['E4']), rs('half')])]).ms[0];
    let m = col(nb(['G4', 'B4']), nb(['G4', 'E4']));
    eq([m.elements2[0].dx, m.elements2[0].chord.heads.find((h) => h.shared)?.noteIndex], [0, 0]);
    m = col(nb(['G4']), nb(['G4', 'F4']));
    eq([m.elements2[0].dx, m.elements2[0].chord.heads.some((h) => h.shared)], [plain + m.elements2[0].chord.headWidth, false], 'a displaced second head adds a head width');
    m = col(nb(['A4']), nb(['G4']));
    eq([m.elements2[0].dx, m.elements2[0].chord.heads.some((h) => h.shared)], [plain, false], 'a second apart is the plain clash shift');
    m = draw([vm([rs(), nb(['G4']), rs('half')], [nb(['G4']), rs(), rs('half')])]).ms[0];
    eq([m.elements2[0].dx, m.elements2[0].chord.heads.some((h) => h.shared)], [0, false], 'different onsets');
  });
  test('gap R4: whole notes with different accidentals clash by a head width; a voice-2 note without an accidental of its own still shares (one carry)', () => {
    const w = draw([vm([nb(['G#4'], 'whole')], [nb(['G4'], 'whole')])]).ms[0];
    eq(near(w.elements2[0].dx, w.elements[0].chord.headWidth), true);
    // voice 1 F#4 then F4 shows a natural at beat 2; voice 2's F4 there shows none and still shares the head
    const r = draw([vm([nb(['F#4']), nb(['F4']), rs('half')], [rs(), nb(['F4']), rs('half')])]);
    const [e1, e2] = [r.ms[0].elements[1], r.ms[0].elements2[1]];
    eq([e2.dx, e2.chord.heads[0].shared, e2.chord.accidentals.length, e1.chord.accidentals.map((a) => a.name)], [0, true, 0, ['natural']]);
    eq(nodes(r.staff('notation'), (nd) => nd.tag === 'text' && nd.textContent === String.fromCodePoint(0xE261)).length, 1, 'one natural sign');
  });

  test('gap R5: merge conditions - duration, hidden on either voice, equal tuplet ratio merges, a different one does not, equal dots merge', () => {
    const ts44 = { beats: 4, beatType: 4 }; const ts14 = { beats: 1, beatType: 4 };
    const sets = (r) => [[...r.v1], [...r.v2]];
    eq(sets(mergedRestPairs([rs('half'), rs('half')], [rs('quarter'), rs('quarter'), rs('half')], ts44)), [[1], [2]], 'only the onset at 1/2 has equal durations');
    eq(sets(mergedRestPairs([rs('half'), rs('half')], [rs('half'), rs('half', { hidden: true })], ts44)), [[0], [0]], 'hidden voice-2 rest');
    const t3 = (d = '8th') => rs(d, { tuplet: 3 });
    eq(sets(mergedRestPairs([t3(), t3(), t3()], [t3(), t3(), t3()], ts14)), [[0, 1, 2], [0, 1, 2]], 'equal ratio');
    eq(sets(mergedRestPairs([t3(), t3(), t3()], [rs('8th', { tuplet: 5 }), rs('8th', { tuplet: 5 })], ts14)), [[], []], 'ratio 3 vs 5');
    eq(sets(mergedRestPairs([rs('half', { dots: 1 })], [rs('half', { dots: 1 }), rs()], ts44)), [[0], [0]], 'equal dots merge');
  });

  const tiedScore = (measures, extra = {}) => ({ tracks: [{ showStandardNotation: true, showTablature: true, tabRhythm: false, tiedFrets: 'parens', ...extra, measures }] });
  const labels = (svg) => nodes(svg, (nd, cls) => nd.tag === 'text' && cls.some((c) => /staff-tab/.test(c)) && +nd.getAttribute('font-size') === th.tabFontSize).map((nd) => nd.textContent);
  test('gap R6: the notation staff is byte-identical with and without tiedFrets', () => {
    const measures = [{ beats: [nb([{ pitch: 'E4', string: 2, fret: 5, tieStart: true }], 'half'), nb([{ pitch: 'E4', string: 2, fret: 5, tieEnd: true }], 'half')] }];
    const notation = (extra) => nodes(renderTree(tiedScore(measures, extra)), (nd) => nd.tag === 'g' && nd.getAttribute('class') === 'staff staff-notation').map(serialize).join('');
    eq(notation({}) === notation({ tiedFrets: undefined }), true);
    eq(notation({}).length > 100, true);
    eq(labels(renderTree(tiedScore(measures))), ['5', '(5)'], 'the TAB does change');
  });
  test('gap R6: a voice-2 note dropped from TAB (voice 1 frets the string at the onset) shows no label', () => {
    const n = (n) => ({ type: 'note', duration: 'half', notes: [n] });
    const svg = renderTree(tiedScore([vm([n({ string: 2, fret: 3, tieEnd: true }), n({ string: 3, fret: 1 })], [n({ string: 2, fret: 5, tieEnd: true }), n({ string: 4, fret: 2 })])]));
    eq(labels(svg), ['(3)', '1', '2']);
  });
}

// ---------- pre-1.9 characterization: bends, slides, harmonics, whammy, trill ties (pins taken before the 1.9.0 change) ----------
// Pins marked FLIPS describe inputs whose behavior the named 1.9 feature commit changes on purpose.
{
  const { cases } = await import('./cases.mjs');
  const D = await imp('src/directions.js');
  const { harmonicKind } = await imp('src/harmonics.js');
  const walk = (n, out = []) => { out.push(n); n.children.forEach((c) => walk(c, out)); return out; };
  const render = (score, width = 900) => {
    const box = makeContainer();
    new MusicScoreRenderer(box, JSON.parse(JSON.stringify(score)), { width }).render();
    return box.children[0];
  };
  const byClass = (svg, c) => walk(svg).filter((n) => (n.getAttribute('class') || '').split(/\s+/).includes(c));
  const numsOf = (d) => d.match(/-?\d+(\.\d+)?/g).map(Number);

  // Inline copy of the 1.9 isLegatoSlide predicate (the exported one does not exist yet).
  const legatoSlide = (raw) => typeof raw === 'string' && raw.trim().toLowerCase() === 'legato';
  // Compound bend: a string with a 'release' token strictly inside (after an optional pb prefix), or an object rebend.
  const compoundBend = (raw) => {
    if (raw && typeof raw === 'object') return !!raw.rebend;
    if (typeof raw !== 'string') return false;
    const toks = raw.trim().replace(/^(prebend|pre-bend|pb)\b/i, '').trim().split(/\s+/).map((t) => t.toLowerCase());
    const i = toks.indexOf('release');
    return i > 0 && i < toks.length - 1;
  };
  const deepKeys = (v, keys, hits = []) => {
    if (Array.isArray(v)) v.forEach((x) => deepKeys(x, keys, hits));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (keys.includes(k)) hits.push(k); deepKeys(x, keys, hits); }
    return hits;
  };
  // Beat streams (one per track voice, measures concatenated) of a raw or normalized score.
  const streams = (sc) => (sc.tracks || []).flatMap((t) => {
    const out = [[], []];
    for (const m of t.measures || []) {
      if (m.voices) m.voices.forEach((v, i) => out[Math.min(i, 1)].push(...(v.beats || [])));
      else { out[0].push(...(m.beats || [])); out[1].push(...(m.voice2Beats || [])); }
    }
    return out;
  });
  const scan = (sc) => {
    const r = { compound: 0, legato: 0, feedback: 0, trillTie: 0, whammyKeys: 0 };
    r.whammyKeys = deepKeys(sc, ['whammyScoop', 'whammyBar']).length;
    for (const beats of streams(sc)) {
      beats.forEach((b, i) => {
        for (const n of b.notes || []) {
          if (compoundBend(n.bend)) r.compound++;
          if (legatoSlide(n.slide)) r.legato++;
          if (typeof n.harmonic === 'string' && n.harmonic.trim().toLowerCase() === 'feedback') r.feedback++;
          if (n.trill) {
            const next = beats.slice(i + 1).find((x) => x.type !== 'grace');
            if (next && (next.notes || []).some((m) => m.tieEnd)) r.trillTie++;
          }
        }
      });
    }
    return r;
  };

  test('pre-1.9 scan: none of the 67 cases (raw or normalized) uses a compound bend, legato slide, feedback harmonic, trill tied forward, whammyScoop / whammyBar key', () => {
    eq(cases.length, 67);
    const zero = { compound: 0, legato: 0, feedback: 0, trillTie: 0, whammyKeys: 0 };
    for (const c of cases) {
      eq([c.id, 'raw', scan(c.score)], [c.id, 'raw', zero]);
      eq([c.id, 'normalized', scan(normalizeScore(c.score))], [c.id, 'normalized', zero]);
    }
  });
  test('pre-1.9 scan: the predicates fire on constructed inputs (the scan is not vacuous)', () => {
    const sc = { tracks: [{ measures: [{ beats: [
      { type: 'note', duration: 'half', whammyBar: true, notes: [{ pitch: 'E4', trill: true, bend: 'full release full', slide: ' Legato ', harmonic: 'FeedBack' }] },
      { type: 'note', duration: 'half', notes: [{ pitch: 'E4', tieEnd: true, bend: { type: 'bend', rebend: 'full' } }] },
    ] }] }] };
    eq(scan(sc), { compound: 2, legato: 1, feedback: 1, trillTie: 1, whammyKeys: 1 });
    eq([compoundBend('pb full release 1/2'), compoundBend('full release'), compoundBend('release full'), compoundBend('full')], [true, false, false, false]);
  });

  // ---- value pins ----
  test('pre-1.9 pin (FLIPS in the compound-bends commit): bendOf("full release full") is one plain bend whose amount is the whole string', () => {
    eq(D.bendOf('full release full'), { type: 'bend', amount: 'full release full', release: false, hold: false });
  });
  test('pre-1.9 pin (FLIPS in the compound-bends commit): bendOf("pb full release 1/2") is a prebend with the whole tail as its amount', () => {
    eq(D.bendOf('pb full release 1/2'), { type: 'prebend', amount: 'full release 1/2', release: false, hold: false });
  });
  test('pre-1.9 pin (FLIPS in the compound-bends commit): an object bend with rebend has no rebend key and is a plain full bend', () => {
    const b = D.bendOf({ type: 'bend', rebend: 'full' });
    eq(b, { type: 'bend', amount: 'full', release: false, hold: false });
    eq('rebend' in b, false);
  });
  test('pre-1.9 pin (stays): single-suffix bend grammar is unchanged', () => {
    eq(D.bendOf('full release'), { type: 'bend', amount: 'full', release: true, hold: false });
    eq(D.bendOf('1/2 hold'), { type: 'bend', amount: '1/2', release: false, hold: true });
    eq(D.bendOf('release full'), { type: 'release', amount: 'full', release: true, hold: false });
    eq(D.bendOf('pb full release'), { type: 'prebend', amount: 'full', release: true, hold: false });
  });
  test('pre-1.9 pin (FLIPS in the feedback commit): harmonicKind("feedback") is "natural"; unknown strings too', () => {
    eq(harmonicKind('feedback'), 'natural');
    eq(harmonicKind('Feedback'), 'natural');
    eq([harmonicKind('pinch'), harmonicKind('nonsense'), harmonicKind(null)], ['pinch', 'natural', null]);
  });
  test('pre-1.9 pin (stays, even after the scoop commit): whammyOf({ type: "scoop" }) is null', () => {
    eq(D.whammyOf({ type: 'scoop' }), null);
    eq(D.whammyOf({ type: 'dive' }), { type: 'dive', amount: '1/2' });
  });

  const tabOnly = (slide) => ({ tracks: [{ showStandardNotation: false, showTablature: true, measures: [{ beats: [3, 5, 5, 5].map((fret, i) => ({
    type: 'note', duration: 'quarter', notes: [{ string: 2, fret, ...(i === 0 ? { slide } : {}) }],
  })) }] }] });
  test('pre-1.9 pin (FLIPS in the legato-slide commit): TAB slide "up" and "legato" both draw only the single diagonal <line>, no arc, no hammer-pull group', () => {
    const stroke = '<line x1="110.19" y1="17.4" x2="131.19" y2="12.6" stroke="#1a1a1a" stroke-width="1.3" stroke-linecap="round"/>';
    const [up, legato] = ['up', 'legato'].map((s) => serialize(render(tabOnly(s))));
    eq(up, legato);
    eq(up.split(stroke).length - 1, 1);
    eq([up.includes('<path'), up.includes('hammer-pull'), up.includes('legato-slide')], [false, false, false]);
    eq((up.match(/<line/g) || []).length, 13);
    eq(serialize(render(tabOnly(undefined))).includes(stroke), false);
  });

  const trillScore = (tied) => ({ tracks: [{ measures: [{ beats: [
    { type: 'note', duration: 'half', notes: [{ pitch: 'E4', trill: true, ...(tied ? { tieStart: true } : {}) }] },
    { type: 'note', duration: 'half', notes: [{ pitch: 'E4', ...(tied ? { tieEnd: true } : {}) }] },
  ] }] }] });
  test('pre-1.9 pin (FLIPS in the trill-continuation commit): a trill tied forward equals an untied one; its wave ends at 156.87, before the next beat at 165.24', () => {
    for (const tied of [true, false]) {
      const svg = render(trillScore(tied));
      const tr = byClass(svg, 'trill');
      eq(tr.length, 1);
      const wave = numsOf(tr[0].children.find((c) => c.tag === 'path').getAttribute('d'));
      eq([wave[0], wave.slice(-2)], [128.87, [156.87, -15.63]]);
      eq(tr[0].children[0].getAttribute('x'), '115.74');
      const heads = walk(svg).filter((n) => n.tag === 'text' && n.getAttribute('text-anchor') === 'middle' && n.getAttribute('y') === '40').map((n) => n.getAttribute('x'));
      eq(heads, ['115.74', '165.24']);
    }
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
