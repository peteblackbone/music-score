// Characterization fixtures: small scores pinning CURRENT renderer output (pre-refactor).
// Each entry: { name, width, score, options? }. Snapshots: tests/snapshots/char-<name>-w<width>.svg
// Known inputs that CRASH today (deliberately NOT included): a tracks[1] with fewer measures
// than tracks[0] (reads perTrackNatural[1][mi] of undefined).

const n = (pitch, extra = {}) => ({ pitch, ...extra });
const q = (pitch, extra = {}) => ({ type: 'note', duration: 'quarter', notes: [n(pitch)], ...extra });
const e = (pitch, extra = {}) => ({ type: 'note', duration: '8th', notes: [n(pitch)], ...extra });
const qr = () => ({ type: 'rest', duration: 'quarter' });
const bar4 = (extra = {}) => ({ beats: [q('E4'), q('G4'), q('B4'), q('D5')], ...extra });
const tabq = (string, fret, extra = {}) => ({ type: 'note', duration: 'quarter', notes: [{ string, fret }], ...extra });
const tabh = (string, fret, note = {}, extra = {}) => ({ type: 'note', duration: 'quarter', notes: [{ string, fret, ...note }], ...extra });
const tabd = (duration, string, fret, note = {}, extra = {}) => ({ type: 'note', duration, notes: [{ string, fret, ...note }], ...extra });
const AH19 = { harmonic: 'artificial', harmonicFret: 19 };
const PH = { harmonic: 'pinch' };
const PM = { palmMute: true };
const tabe = (string, fret, extra = {}) => ({ type: 'note', duration: '8th', notes: [{ string, fret }], ...extra });
const tabg = (string, fret, extra = {}) => ({ type: 'grace', duration: '16th', notes: [{ string, fret, mute: true }], ...extra });
const tabgr = (notes) => ({ type: 'grace', duration: '16th', notes: notes.map(([string, fret, note = {}]) => ({ string, fret, ...note })) });
const tabc = (frets, extra = {}, duration = 'quarter') => ({ type: 'note', duration, notes: frets.map(([string, fret, note = {}]) => ({ string, fret, ...note })), ...extra });
const pc = (pitches, extra = {}, duration = 'quarter') => ({ type: 'note', duration, notes: pitches.map((p) => (typeof p === 'string' ? n(p) : p)), ...extra });
const C_CHORD = [[5, 3], [4, 2], [3, 0], [2, 1]];
const E_TOP = [[3, 1], [2, 0], [1, 0]];
const vm = (beats1, beats2) => ({ voices: [{ beats: beats1 }, { beats: beats2 }] });
const ras = (k) => tabc(E_TOP, { strum: k % 2 ? 'up' : 'down' }, '16th');

// 1.11.0 fixtures (clefs, multi-measure rests, rhythm slashes, tab-only articulations)
const T34 = { beats: 3, beatType: 4 };
const sl = (duration, extra = {}) => ({ type: 'note', duration, slash: true, ...extra });
const WR = { type: 'rest', duration: 'whole' };
// multirest: per measure 'n' = notes, 'r' = a rest measure in every track; extras by measure index
const MR = 'nrrrrrrrrnrrnrnrnrrrn'.split('');
const MR_EXTRA = { 1: { segno: true }, 5: { keySignature: 2 }, 7: { barline: 'repeatStart' }, 8: { barline: 'repeatEnd' }, 11: { jump: 'D.S.' }, 15: { ending: 1 } };
function mrMeasure(kind, i, track) {
  const extra = MR_EXTRA[i] || {};
  if (kind === 'n') {
    if (track === 'bass') return { ...extra, beats: [tabd('half', 4, 0), tabd('half', 3, 2)] };
    if (track === 'keys') return { ...extra, beats: [q('C5'), q('E5'), q('G5'), q('C6')] };
    return { ...extra, beats: [tabq(3, 2), tabq(2, 3), tabq(1, 0), tabq(2, 1)] };
  }
  // the fermata rest (m18) only on the guitar; the bass leaves its rest measures empty (beats: [])
  if (i === 17 && track === 'gtr') return { ...extra, beats: [{ ...WR, fermata: true }] };
  return { ...extra, beats: track === 'bass' ? [] : [WR] };
}
const tf = (string, fret, extra = {}, note = {}) => ({ type: 'note', duration: 'quarter', notes: [{ string, fret, ...note }], ...extra });
const TA = [
  { beats: [tf(3, 2, { articulations: ['accent', 'tenuto', 'staccato'] }), tf(2, 3, { articulations: ['marcato'] }),
    tf(1, 12, { articulations: ['accent'], tremolo: true }), tf(1, 5, { articulations: ['staccatissimo'], vibrato: true })] },
  { beats: [tf(4, 2, { articulations: ['accent'], palmMute: true }), tf(4, 2, { articulations: ['staccato'], palmMute: true }),
    tf(3, 2, { articulations: ['accent'], letRing: true, pickStroke: 'down' }), tf(3, 4, { articulations: ['tenuto'] }, { bend: 'full' })] },
  { beats: [tf(2, 5, { articulations: ['accent'] }, { tap: true }), tf(3, 7, { fermata: true }), { type: 'rest', duration: 'quarter', fermata: 'short' },
    tf(1, 0, { fermata: 'long', text: 'rit.', chord: 'E' })] },
  vm([tf(3, 2, { articulations: ['accent'] }), tf(3, 2), { type: 'rest', duration: 'half' }],
    [tf(5, 3, { articulations: ['staccato'] }), tf(5, 3, { articulations: ['staccato'], fermata: true }),
      { type: 'note', duration: 'half', notes: [{ string: 6, fret: 3 }], articulations: ['tenuto'], fermata: true }]),
];

export const characterizationCases = [
  {
    name: 'tab-only', width: 900,
    score: {
      tracks: [{
        showStandardNotation: false, showTablature: true,
        measures: [
          { beats: [tabq(6, 0), tabq(5, 2), tabq(4, 2), tabq(3, 1)] },
          { beats: [{ type: 'note', duration: '8th', notes: [{ string: 1, fret: 5, hammerPull: true }] },
                    { type: 'note', duration: '8th', notes: [{ string: 1, fret: 7 }] },
                    { type: 'note', duration: 'quarter', notes: [{ string: 2, fret: 3, slide: 'up' }] },
                    { type: 'note', duration: 'half', notes: [{ string: 2, fret: 5 }, { string: 3, fret: 4 }] }] },
        ],
      }],
    },
  },
  {
    name: 'barlines', width: 900,
    score: {
      tracks: [{
        measures: [
          bar4({ barline: 'single' }),
          bar4({ barline: 'double' }),
          bar4({ barline: 'repeatStart' }),
          bar4({ barline: 'repeatEnd' }),
          bar4({ barline: 'final' }),
          bar4(), // default barline on last measure -> final
        ],
      }],
    },
  },
  {
    name: 'key-time-changes', width: 900,
    score: {
      keySignature: 0,
      tracks: [{
        showTablature: true,
        measures: [
          bar4(),
          bar4({ keySignature: 2 }),
          { timeSignature: { beats: 3, beatType: 4 }, beats: [q('E4'), q('F#4'), q('G4')] },
          { keySignature: -3, timeSignature: { beats: 2, beatType: 4 }, beats: [q('Eb4'), q('G4')] },
          { keySignature: 0, timeSignature: { beats: 4, beatType: 4 }, beats: [q('C4'), q('D4'), q('E4'), q('F4')] },
        ],
      }],
    },
  },
  {
    name: 'six-eight', width: 900,
    score: {
      timeSignature: { beats: 6, beatType: 8 },
      tracks: [{
        showTablature: true,
        measures: [
          { beats: ['E4', 'G4', 'B4', 'D5', 'B4', 'G4'].map((p) => e(p)) },
          { beats: [{ type: 'note', duration: 'quarter', dots: 1, notes: [n('E4')] },
                    { type: 'note', duration: 'quarter', dots: 1, notes: [n('G4')] }] },
          { beats: [e('E4'), e('F4'), e('G4'), qr(), e('A4')] },
        ],
      }],
    },
  },
  {
    name: 'grace-ghost-mute', width: 900,
    score: {
      tracks: [{
        showTablature: true,
        measures: [
          { beats: [
            { type: 'grace', duration: '16th', notes: [{ pitch: 'D4', string: 2, fret: 3 }] },
            { type: 'note', duration: 'quarter', notes: [{ pitch: 'E4', string: 1, fret: 0 }] },
            { type: 'note', duration: 'quarter', notes: [{ pitch: 'G4', string: 1, fret: 3, ghost: true }] },
            { type: 'note', duration: 'quarter', notes: [{ pitch: 'B3', string: 2, fret: 0, mute: true }] },
            { type: 'note', duration: 'quarter', notes: [{ pitch: 'D4', string: 2, fret: 3, mute: true, ghost: true }] },
          ] },
        ],
      }],
    },
  },
  {
    // Tie and slur both cross a system break (README: not drawn across breaks). Narrow width forces wrapping.
    name: 'tie-slur-break', width: 600,
    score: {
      tracks: [{
        measures: [
          bar4(),
          { beats: [q('E4'), q('G4'), q('B4'), q('D5', { slurStart: true })] },
          { beats: [q('F4', { slurEnd: true }), q('G4'), q('A4'), { type: 'note', duration: 'quarter', notes: [n('B4', { tieStart: true })] }] },
          { beats: [{ type: 'note', duration: 'quarter', notes: [n('B4', { tieEnd: true })] }, q('C5'), q('D5'), q('E5')] },
          bar4(),
          bar4(),
        ],
      }],
    },
  },
  {
    name: 'three-tracks', width: 900,
    score: {
      tempoText: 'Allegro', tuningLabel: 'Standard',
      tracks: [
        { label: 'Gt.1', showTablature: true, measures: [bar4(), bar4()] },
        { label: 'Pno.', measures: [bar4(), bar4()] },
        { clef: 'bass', label: 'Bs.', measures: [
          { beats: [q('G2'), q('A2'), q('B2'), q('C3')] },
          { beats: [q('D3'), q('E3'), q('F3'), q('G3')] },
        ] },
      ],
    },
  },
  {
    name: 'theme-spacing12', width: 900, options: { theme: { staffLineSpacing: 12, background: '#fafafa' } },
    score: {
      tracks: [{
        showTablature: true,
        measures: [
          { beats: [q('E4'), q('G4'), q('B4', { dynamic: 'mf' }), q('D5')] },
          { beats: [{ type: 'note', duration: 'quarter', notes: [{ pitch: 'E4', string: 1, fret: 0, bend: 'full' }] }, qr(), qr(), qr()] },
        ],
      }],
    },
  },
  {
    name: 'dynamic-rfz', width: 900,
    score: {
      tracks: [{ measures: [
        { beats: [q('E4', { dynamic: 'rfz' }), q('G4', { dynamic: 'sfz' }), q('B4', { dynamic: 'n' }), q('D5', { dynamic: 'pp' })] },
      ] }],
    },
  },
  {
    name: 'narrow-300', width: 300,
    score: {
      tracks: [{ showTablature: true, measures: [bar4(), bar4(), bar4()] }],
    },
  },
  {
    // 4-string bass tab: tuning E1 A1 D2 G2 (low->high), string 1 = G2.
    name: 'bass-tab-4string', width: 900,
    score: {
      tracks: [{
        clef: 'bass', tuning: ['E1', 'A1', 'D2', 'G2'], showTablature: true,
        measures: [
          { beats: [tabq(4, 0), tabq(4, 3), tabq(3, 2), tabq(1, 5)] },
          { beats: [tabq(2, 7, { palmMute: true }), tabq(2, 5, { palmMute: true }), tabq(3, 0), tabq(4, 1)] },
        ],
      }],
    },
  },
  {
    // Bend label variants rendered in tab.
    name: 'bends', width: 900,
    score: {
      tracks: [{
        showTablature: true,
        measures: [
          { beats: [
            { type: 'note', duration: 'quarter', notes: [{ string: 2, fret: 7, bend: true }] },
            { type: 'note', duration: 'quarter', notes: [{ string: 2, fret: 7, bend: '1/2' }] },
            { type: 'note', duration: 'quarter', notes: [{ string: 2, fret: 7, bend: 'full release' }] },
            { type: 'note', duration: 'quarter', notes: [{ string: 2, fret: 7, bend: { amount: '1 1/2', hold: true } }] },
          ] },
        ],
      }],
    },
  },
  {
    // Technique lane (harmonics characterization): palm-mute runs (one crossing a system break, one starting
    // on a bend), a slide crossing a break, two-digit slides, ghost chord with seconds + dots, bends with
    // landing frets, H/P. Narrow width forces system breaks.
    name: 'technique-lane', width: 600,
    score: {
      tracks: [{
        showTablature: true,
        measures: [
          { beats: [tabq(6, 0, { palmMute: true }), tabq(6, 0, { palmMute: true }), tabq(5, 2), tabq(5, 2)] },
          { beats: [{ type: 'note', duration: 'quarter', notes: [{ string: 3, fret: 7, bend: 'full' }], palmMute: true },
                    tabq(3, 7, { palmMute: true }), tabq(3, 5, { palmMute: true }), tabq(3, 5, { palmMute: true })] },
          { beats: [tabq(6, 3, { palmMute: true }), tabq(6, 3, { palmMute: true }), tabq(4, 2, { palmMute: true }),
                    { type: 'note', duration: 'quarter', notes: [{ string: 2, fret: 5, slide: 'up' }], palmMute: true }] },
          { beats: [tabq(2, 12, { palmMute: true }), tabq(2, 12, { palmMute: true }),
                    { type: 'note', duration: 'quarter', notes: [{ string: 1, fret: 10, slide: 'up' }] }, tabq(1, 12)] },
          { beats: [{ type: 'note', duration: 'quarter', notes: [{ string: 1, fret: 12, slide: 'down' }] },
                    { type: 'note', duration: 'quarter', notes: [{ string: 1, fret: 15, slide: 'down' }] },
                    { type: 'note', duration: 'quarter', notes: [{ string: 1, fret: 12 }] },
                    { type: 'note', duration: 'quarter', notes: [{ string: 2, fret: 14 }] }] },
          { beats: [{ type: 'note', duration: 'quarter', dots: 1, notes: [{ string: 3, fret: 10, ghost: true }, { string: 4, fret: 11, ghost: true }, { string: 5, fret: 12, ghost: true }] },
                    { type: 'note', duration: '8th', notes: [{ string: 1, fret: 5, hammerPull: 'h' }] },
                    { type: 'note', duration: '8th', notes: [{ string: 1, fret: 7, hammerPull: 'p' }] },
                    { type: 'note', duration: 'quarter', notes: [{ string: 1, fret: 5 }] },
                    { type: 'note', duration: 'quarter', notes: [{ string: 2, fret: 8, bend: '1/2' }] }] },
          { beats: [{ type: 'note', duration: 'quarter', notes: [{ string: 2, fret: 7, bend: 'full' }] },
                    { type: 'note', duration: 'quarter', notes: [{ string: 2, fret: 10, bend: '1 1/2' }] },
                    { type: 'note', duration: 'quarter', notes: [{ string: 1, fret: 12, bend: { amount: 'full', hold: true } }] },
                    { type: 'note', duration: 'quarter', notes: [{ string: 1, fret: 12, bend: 'full release' }] }] },
        ],
      }],
    },
  },
  {
    // Guitar harmonics: natural diamonds (quarter/half/whole/beamed, accidental, ledger, dotted, grace),
    // mixed chords with seconds (stem up/down), artificial with/without touch fret, tapped, pinch run, semi,
    // ghost natural/artificial, mute+natural, bends on natural/artificial, slides in/out of <12>, H/P,
    // P.M. overlapping and not overlapping A.H., A.H.+P.H. beat; a notation-only track (P.M. + P.H.)
    // and a TAB-only track.
    name: 'harmonics', width: 900,
    score: {
      tracks: [
        {
          name: 'Guitar', showTablature: true,
          measures: [
            { beats: [tabq(3, 12, { notes: [{ string: 3, fret: 12, harmonic: true }] }),
                      tabq(2, 12, { notes: [{ string: 2, fret: 12, harmonic: 'natural' }] }),
                      { type: 'note', duration: 'half', notes: [{ string: 1, fret: 7, harmonic: true }] }] },
            { beats: [{ type: 'note', duration: '8th', notes: [{ string: 1, fret: 12, harmonic: true }] },
                      { type: 'note', duration: '8th', notes: [{ string: 2, fret: 12, harmonic: true }] },
                      { type: 'note', duration: '8th', notes: [{ string: 3, fret: 12, harmonic: true }] },
                      { type: 'note', duration: '8th', notes: [{ string: 4, fret: 12, harmonic: true }] },
                      { type: 'note', duration: 'quarter', notes: [{ string: 5, fret: 7 }, { string: 4, fret: 3, harmonic: true }] },
                      { type: 'note', duration: 'quarter', notes: [{ string: 5, fret: 7, harmonic: true }, { string: 4, fret: 3 }] }] },
            { beats: [{ type: 'note', duration: 'quarter', notes: [{ string: 3, fret: 4, harmonic: true }, { string: 2, fret: 1 }] },
                      { type: 'note', duration: 'quarter', notes: [{ string: 3, fret: 4 }, { string: 2, fret: 1, harmonic: true }] },
                      { type: 'note', duration: 'quarter', dots: 1, notes: [{ string: 2, fret: 4, harmonic: true }] },
                      { type: 'note', duration: '8th', notes: [{ string: 1, fret: 12, harmonic: true }] }] },
            { beats: [{ type: 'note', duration: 'whole', notes: [{ string: 2, fret: 12, harmonic: true }, { string: 1, fret: 12, harmonic: true }] }] },
            { beats: [{ type: 'note', duration: 'quarter', notes: [{ string: 3, fret: 5, harmonic: 'artificial', harmonicFret: 17 }] },
                      { type: 'note', duration: 'quarter', notes: [{ string: 3, fret: 5, harmonic: 'artificial' }] },
                      { type: 'note', duration: 'quarter', notes: [{ string: 2, fret: 2, harmonic: 'tapped', harmonicFret: 14 }] },
                      { type: 'note', duration: 'quarter', notes: [{ string: 2, fret: 5, harmonic: 'semi' }] }] },
            { beats: [{ type: 'note', duration: 'quarter', notes: [{ string: 3, fret: 7, harmonic: 'pinch' }] },
                      { type: 'note', duration: 'quarter', notes: [{ string: 3, fret: 9, harmonic: 'pinch' }] },
                      { type: 'note', duration: 'quarter', notes: [{ string: 1, fret: 12, harmonic: true, ghost: true }] },
                      { type: 'note', duration: 'quarter', notes: [{ string: 2, fret: 5, harmonic: 'artificial', harmonicFret: 17, ghost: true }] }] },
            { beats: [{ type: 'note', duration: 'quarter', notes: [{ string: 1, fret: 12, harmonic: true, mute: true }] },
                      { type: 'note', duration: 'quarter', notes: [{ string: 3, fret: 12, harmonic: true, bend: 'full' }] },
                      { type: 'note', duration: 'half', notes: [{ string: 3, fret: 7, harmonic: 'artificial', harmonicFret: 19, bend: 'full' }] }] },
            { beats: [{ type: 'note', duration: 'quarter', notes: [{ string: 1, fret: 10, slide: 'up' }] },
                      { type: 'note', duration: 'quarter', notes: [{ string: 1, fret: 12, harmonic: true, slide: 'down' }] },
                      tabq(1, 10),
                      { type: 'note', duration: '8th', notes: [{ string: 1, fret: 5, harmonic: true, hammerPull: true }] },
                      { type: 'note', duration: '8th', notes: [{ string: 1, fret: 7, harmonic: true }] }] },
            { beats: [{ type: 'grace', notes: [{ string: 2, fret: 12, harmonic: true }] },
                      tabq(2, 12, { notes: [{ string: 2, fret: 12, harmonic: true }] }),
                      tabq(3, 5, { notes: [{ string: 3, fret: 5, harmonic: 'artificial', harmonicFret: 17 }], palmMute: true }),
                      tabq(3, 5, { notes: [{ string: 3, fret: 5, harmonic: 'artificial', harmonicFret: 17 }], palmMute: true }),
                      tabq(3, 5, { notes: [{ string: 3, fret: 5, harmonic: 'artificial', harmonicFret: 17 }] })] },
            { beats: [tabq(6, 0, { palmMute: true }), tabq(6, 0, { palmMute: true }), qr(),
                      tabq(3, 5, { notes: [{ string: 3, fret: 5, harmonic: 'artificial', harmonicFret: 17 }, { string: 2, fret: 5, harmonic: 'pinch' }] })] },
          ],
        },
        {
          name: 'Notation', showTablature: false,
          measures: [
            { beats: [q('E4', { palmMute: true, notes: [n('E4', { harmonic: 'pinch' })] }), q('G4', { palmMute: true, notes: [n('G4', { harmonic: 'pinch' })] }),
                      q('B4', { notes: [n('B4', { harmonic: 'pinch' })] }), q('E5', { notes: [n('E5', { harmonic: true })] })] },
            { beats: [q('E4', { palmMute: true }), q('E4', { palmMute: true }), qr(), q('A4', { notes: [n('A4', { harmonic: 'semi' })] })] },
          ],
        },
        {
          name: 'TAB', showStandardNotation: false, showTablature: true,
          measures: [
            { beats: [tabq(1, 12, { notes: [{ string: 1, fret: 12, harmonic: true }] }), tabq(2, 7, { notes: [{ string: 2, fret: 7, harmonic: true }] }),
                      tabq(4, 5, { notes: [{ string: 4, fret: 5, harmonic: 'artificial', harmonicFret: 17 }], palmMute: true }),
                      tabq(4, 5, { notes: [{ string: 4, fret: 5, harmonic: 'artificial', harmonicFret: 17 }], palmMute: true })] },
            { beats: [tabq(5, 7, { notes: [{ string: 5, fret: 7, harmonic: 'pinch' }] }), tabq(5, 9, { notes: [{ string: 5, fret: 9, harmonic: 'pinch' }] }),
                      tabq(6, 0), tabq(6, 0)] },
          ],
        },
      ],
    },
  },
  {
    // Harmonic runs and harmonic slides across system breaks (narrow width): an A.H. run crossing a break,
    // a P.H. run stacked over a P.M. run crossing a break, a slide out of <12> across a break, a natural
    // bend before a barline, mixed chords, T.H./S.H./A.H. runs and a slide out of 5(17).
    name: 'harmonics-break', width: 600,
    score: {
      tracks: [{
        showTablature: true,
        measures: [
          { beats: [tabh(3, 7, AH19), tabh(3, 7, AH19), tabh(3, 7, AH19), tabh(3, 7, AH19)] },
          { beats: [{ type: 'note', duration: 'quarter', notes: [{ string: 2, fret: 12, harmonic: true }, { string: 1, fret: 12 }] },
                    tabh(3, 12, { harmonic: true, bend: '1/2' }), tabh(3, 7, AH19), tabh(3, 7, AH19)] },
          { beats: [tabh(3, 7, AH19), tabh(3, 7, AH19), tabh(5, 5, PH, PM), tabh(5, 5, PH, PM)] },
          { beats: [tabh(5, 7, PH, PM), tabh(5, 7, PH, PM), tabh(5, 7, PH, PM), tabh(5, 7, PH, PM)] },
          { beats: [tabh(5, 5, PH, PM), tabh(5, 5, PH, PM), tabh(5, 7, PH, PM), tabh(5, 7, PH, PM)] },
          { beats: [tabh(5, 7, PH, PM), tabq(2, 5), tabq(1, 10), tabh(1, 12, { harmonic: true, slide: 'down' })] },
          { beats: [tabq(1, 10), { type: 'note', duration: 'quarter', notes: [{ string: 4, fret: 3, harmonic: true }, { string: 3, fret: 2 }] },
                    { type: 'note', duration: 'half', notes: [{ string: 3, fret: 4 }, { string: 2, fret: 1, harmonic: true }] }] },
          { beats: [tabh(3, 5, { harmonic: 'tapped', harmonicFret: 17 }), tabh(3, 5, { harmonic: 'tapped', harmonicFret: 17 }),
                    tabh(2, 7, { harmonic: 'semi' }), tabh(1, 5, { harmonic: 'artificial', harmonicFret: 17, slide: 'up' })] },
          { beats: [tabh(1, 7, AH19), tabq(1, 7, { notes: [{ string: 1, fret: 7, harmonic: true, mute: true }] }), qr(), qr()] },
        ],
      }],
    },
  },
  {
    // Tab-marks lane (picking/playing directions characterization). Track 1: tab tremolo + vibrato on one
    // beat, H/P letters, a full bend, a P.M. run starting on a hammer-on. Track 2 (tab only): P.M. run, bend,
    // vibrato. Track 3: notation+tab beat with a fermata under a slur (above), inside a tuplet, with a chord
    // symbol; an accent above a stem-down note that also has a fermata.
    name: 'tab-marks', width: 900,
    score: {
      tracks: [
        {
          name: 'Gt.1', showTablature: true,
          measures: [
            { beats: [tabh(1, 5, {}, { tremolo: true, vibrato: true }),
                      { type: 'note', duration: '8th', notes: [{ string: 1, fret: 5, hammerPull: 'h' }] },
                      { type: 'note', duration: '8th', notes: [{ string: 1, fret: 7, hammerPull: 'p' }] },
                      tabh(1, 5, { bend: 'full' }),
                      tabq(1, 3)] },
            { beats: [{ type: 'note', duration: '8th', notes: [{ string: 1, fret: 5, hammerPull: true }], palmMute: true },
                      { type: 'note', duration: '8th', notes: [{ string: 1, fret: 7 }], palmMute: true },
                      tabq(1, 5, { palmMute: true }), tabq(1, 5, { palmMute: true }), tabq(1, 3)] },
          ],
        },
        {
          name: 'TAB', showStandardNotation: false, showTablature: true,
          measures: [
            { beats: [tabq(3, 5, { palmMute: true }), tabq(3, 5, { palmMute: true }), tabh(2, 8, { bend: '1/2' }), tabq(2, 7, { vibrato: true })] },
            { beats: [tabq(3, 5, { palmMute: true }), tabh(2, 7, { bend: 'full' }, { palmMute: true }), tabq(2, 7, { vibrato: true }), qr()] },
          ],
        },
        {
          name: 'Notation', showTablature: true,
          measures: [
            { beats: [
              q('B4', { slurStart: true }),
              { type: 'note', duration: '8th', tuplet: 3, fermata: true, chord: 'Am7', notes: [{ pitch: 'C5', string: 1, fret: 8 }] },
              { type: 'note', duration: '8th', tuplet: 3, notes: [{ pitch: 'D5', string: 1, fret: 10 }] },
              { type: 'note', duration: '8th', tuplet: 3, slurEnd: true, notes: [{ pitch: 'B4', string: 1, fret: 7 }] },
              q('E4'),
            ] },
            { beats: [q('B4', { articulations: ['accent'], fermata: true }), q('A4'), q('G4', { articulations: ['accent'] }), qr()] },
          ],
        },
      ],
    },
  },
  {
    // Picking and playing directions (no harmonics: engraving's harmonics AC1 scans every other fixture).
    // Track 1 (notation + TAB): a let-ring run bridging a rest, pick strokes, P.M. + let ring stacked,
    // tap + pull-off, whammy dips (alone, over a bend, over a T; garbage values ignored), pick stroke + fermata + chord symbol + slur + tuplet + accent,
    // pick stroke / tap / whammy on a rest and a grace note (ignored). Track 2 (notation only): pick strokes,
    // T, let ring below the staff, whammy (no TAB: ignored). Track 3 (tab only): pick strokes above P.M.,
    // bend, H/P letters, T and dip; let ring.
    name: 'directions', width: 900,
    score: {
      tracks: [
        {
          name: 'Gt.', showTablature: true,
          measures: [
            { beats: [
              { type: 'note', duration: 'quarter', notes: [{ string: 3, fret: 2 }, { string: 2, fret: 3 }], letRing: true, pickStroke: 'down' },
              tabh(2, 1, {}, { letRing: true, pickStroke: 'up' }),
              { type: 'rest', duration: 'quarter', pickStroke: 'down', whammy: true },
              tabh(1, 0, {}, { letRing: true, pickStroke: 'DOWN ' }),
            ] },
            { beats: [
              tabh(5, 5, {}, { palmMute: true, letRing: true, pickStroke: 'down' }),
              tabh(5, 5, {}, { palmMute: true, letRing: true, pickStroke: 'down' }),
              tabh(1, 12, { tap: true, hammerPull: 'p' }, { pickStroke: 'up' }),
              tabh(1, 5),
            ] },
            { beats: [
              tabh(2, 7, {}, { whammy: true }),
              tabh(2, 7, { bend: 'full' }, { whammy: '-1' }),
              tabh(1, 9, { tap: true }, { whammy: { type: 'dip', amount: '1 1/2' } }),
              tabh(3, 5, {}, { whammy: { type: 'scoop' }, pickStroke: 'sideways' }),
            ] },
            { beats: [
              tabh(2, 5, {}, { pickStroke: 'up', fermata: true, chord: 'Em', slurStart: true }),
              { type: 'note', duration: '8th', tuplet: 3, pickStroke: 'down', notes: [{ string: 1, fret: 7, tap: true }] },
              { type: 'note', duration: '8th', tuplet: 3, pickStroke: 'up', fermata: true, notes: [{ string: 1, fret: 8 }] },
              { type: 'note', duration: '8th', tuplet: 3, slurEnd: true, notes: [{ string: 1, fret: 10 }] },
              { type: 'grace', duration: '16th', pickStroke: 'down', whammy: true, notes: [{ string: 3, fret: 4, tap: true }] },
              tabh(3, 5, {}, { pickStroke: 'down', articulations: ['accent', 'staccato'], fermata: true }),
            ] },
          ],
        },
        {
          name: 'Notation', showTablature: false,
          measures: [
            { beats: [q('G4', { pickStroke: 'down', letRing: true }), q('A5', { pickStroke: 'up', letRing: true }), qr(), q('C5', { letRing: true, whammy: true })] },
            { beats: [{ type: 'note', duration: 'quarter', notes: [n('E4', { tap: true })], pickStroke: 'up', fermata: true },
                      q('F5', { pickStroke: 'down', vibrato: true }), { type: 'note', duration: 'whole', notes: [n('D4')], pickStroke: 'up', tremolo: true }] },
          ],
        },
        {
          name: 'TAB', showStandardNotation: false, showTablature: true,
          measures: [
            { beats: [tabq(3, 5, { palmMute: true, pickStroke: 'down' }), tabq(3, 5, { palmMute: true, pickStroke: 'down' }),
                      tabh(2, 8, { bend: '1/2' }, { pickStroke: 'up' }), tabq(2, 7, { vibrato: true, pickStroke: 'up' })] },
            { beats: [{ type: 'note', duration: '8th', notes: [{ string: 1, fret: 5, hammerPull: 'h' }], pickStroke: 'down' },
                      { type: 'note', duration: '8th', notes: [{ string: 1, fret: 7, tap: true }], pickStroke: 'up' },
                      tabq(1, 3, { whammy: true, pickStroke: 'down' }),
                      tabq(2, 3, { letRing: true }), tabq(3, 2, { letRing: true })] },
          ],
        },
      ],
    },
  },
  {
    // Directions across system breaks (narrow): a let-ring run cut at a break (dip on the system's last beat,
    // width limited by the barline), a rest opening the next system (does not bridge across the break), a
    // grace note ending a let-ring run, P.M. + let ring stacked, rests bridging inside a system, tap + pick.
    name: 'directions-break', width: 600,
    score: {
      tracks: [{
        name: 'Gt.', showTablature: true,
        measures: [
          { beats: [tabq(3, 2), tabq(3, 2, { letRing: true }), tabq(2, 3, { letRing: true }), tabq(1, 0, { letRing: true })] },
          { beats: [tabq(3, 2, { letRing: true }), tabq(2, 3, { letRing: true }),
                    { type: 'grace', duration: '16th', notes: [{ string: 2, fret: 2 }] }, tabq(2, 3, { letRing: true }),
                    tabq(1, 5, { letRing: true, whammy: true })] },
          { beats: [qr(), tabq(5, 3, { palmMute: true, letRing: true }),
                    tabq(5, 3, { palmMute: true, letRing: true }), tabh(1, 7, { tap: true }, { letRing: true, pickStroke: 'down' })] },
          { beats: [tabq(3, 2, { letRing: true }), qr(), qr(), tabq(2, 1, { letRing: true, whammy: '1/4' })] },
          { beats: [tabq(1, 3, { letRing: true }), tabq(1, 3, { whammy: true }), tabq(1, 3), tabq(1, 3, { whammy: true })] },
        ],
      }],
    },
  },
  {
    // Rhythm on TAB staves (default 'auto' on tab-only tracks): every duration; beams, a stub, flags, dots,
    // tuplet number vs bracket, rests with knock-outs, a whole-measure rest, an authored empty measure,
    // pitch-only / "x" / "(5)" / tied / grace beats. Notation + TAB with tabRhythm: true and fewer measures
    // (padded TAB measures stay blank), notation + TAB 'auto' (no band), a 4-string bass with rests, and a
    // tab-only track with tabRhythm: false. No beam groups with 3+ levels (32nds/64ths): their
    // stacks drift past the fixed-strokes scaling tolerance; they are covered by engraving-only tests.
    name: 'tab-rhythm', width: 900,
    score: (() => {
      const t = (d, string, fret, extra = {}, note = {}) => ({ type: 'note', duration: d, notes: [{ string, fret, ...note }], ...extra });
      const r = (d, extra = {}) => ({ type: 'rest', duration: d, ...extra });
      const t3 = { tuplet: 3 };
      return {
        tracks: [
          { name: 'Gtr', showStandardNotation: false, showTablature: true, measures: [
            { beats: [t('quarter', 6, 0), t('8th', 5, 2), t('8th', 5, 3), t('16th', 4, 2), t('16th', 4, 4), t('16th', 4, 5), t('16th', 4, 4),
              t('8th', 3, 2, { dots: 1 }), t('16th', 3, 4)] },
            { beats: [t('8th', 3, 2), r('8th'), t('16th', 2, 3), r('16th'), r('8th'), t('16th', 2, 5), t('16th', 2, 3), t('8th', 1, 0),
              t('64th', 1, 3), r('64th'), r('32nd'), r('16th'), r('8th')] },
            { beats: [t('8th', 1, 3, t3), t('8th', 1, 5, t3), t('8th', 1, 7, t3), t('8th', 2, 3, t3), r('8th', t3), t('8th', 2, 5, t3),
              t('quarter', 3, 2, { dots: 1 }), t('8th', 3, 4)] },
            { beats: [r('whole')] },
            { beats: [] },
            { beats: [{ type: 'note', duration: 'quarter', notes: [{ pitch: 'E4' }] }, t('quarter', 5, 3, {}, { mute: true }),
              t('quarter', 4, 5, {}, { ghost: true, tieStart: true }), { type: 'grace', duration: '16th', notes: [{ string: 3, fret: 2 }] },
              t('quarter', 4, 5, {}, { tieEnd: true })] },
            { beats: [r('half'), r('quarter', { dots: 1 }), t('8th', 2, 1)] },
            { beats: [{ type: 'note', duration: 'half', dots: 1, notes: [{ string: 3, fret: 2 }, { string: 2, fret: 3 }] }, t('quarter', 1, 0)] },
            { beats: [{ type: 'note', duration: 'whole', notes: [{ string: 6, fret: 0 }, { string: 5, fret: 2 }, { string: 4, fret: 2 }] }] },
          ] },
          { name: 'Gtr2', showTablature: true, tabRhythm: true, measures: [
            { beats: [t('quarter', 6, 0), t('8th', 5, 2), t('8th', 5, 3), t('half', 4, 2)] },
            { beats: [r('quarter'), t('quarter', 3, 2, { dots: 1 }), t('8th', 3, 4), t('quarter', 2, 3)] },
            { beats: [t('16th', 1, 0), t('16th', 1, 2), t('16th', 1, 3), t('16th', 1, 5), t('quarter', 2, 5), t('half', 3, 4)] },
          ] },
          { name: 'Gtr3', showTablature: true, measures: [
            { beats: [t('quarter', 3, 2), t('quarter', 3, 4), t('8th', 2, 3), t('8th', 2, 5), r('quarter')] },
            { beats: [t('half', 2, 3), r('half')] },
          ] },
          { name: 'Bass', showStandardNotation: false, showTablature: true, tuning: ['E1', 'A1', 'D2', 'G2'], measures: [
            { beats: [t('quarter', 4, 0), r('quarter'), r('8th'), t('8th', 3, 2), r('quarter')] },
            { beats: [r('16th'), t('16th', 2, 5), r('8th'), r('quarter'), t('half', 1, 0)] },
            { beats: [r('32nd'), t('32nd', 1, 2), r('16th'), r('8th'), r('quarter', { dots: 1 }), t('8th', 1, 5, { dots: 1 }), r('16th'), r('8th')] },
          ] },
          { name: 'Off', showStandardNotation: false, showTablature: true, tabRhythm: false, measures: [
            { beats: [t('quarter', 3, 2), t('8th', 3, 4), t('8th', 3, 5), r('half')] },
            { beats: [r('whole')] },
          ] },
        ],
      };
    })(),
  },
  {
    // Rhythm on TAB staves across system breaks (narrow): 5- and 7-string tab-only tracks in 6/8, 12/8 and
    // 3/8 (compound beaming, a duplet, dotted quarters), dense flags and dots, a slide and an H/P across a
    // rest, P.M. and bends above the band, beamed tuplets (number) and tuplets sharing a beam group or
    // holding a rest (bracket) near a system end.
    name: 'tab-rhythm-break', width: 600,
    score: (() => {
      const t = (d, string, fret, extra = {}, note = {}) => ({ type: 'note', duration: d, notes: [{ string, fret, ...note }], ...extra });
      const r = (d, extra = {}) => ({ type: 'rest', duration: d, ...extra });
      const six = { beats: 6, beatType: 8 }; const twelve = { beats: 12, beatType: 8 }; const three = { beats: 3, beatType: 8 };
      const duo = { tuplet: { count: 2, of: 3 } }; const quad = { tuplet: { count: 4, of: 3 } }; const t3 = { tuplet: 3 };
      const PM = { palmMute: true };
      return {
        timeSignature: six,
        tracks: [
          { name: '5-str', showStandardNotation: false, showTablature: true, tuning: ['B0', 'E1', 'A1', 'D2', 'G2'], measures: [
            { beats: [t('8th', 5, 0, PM), t('8th', 5, 0, PM), t('8th', 5, 2, PM), t('8th', 4, 2), t('8th', 4, 3), t('8th', 4, 5)] },
            { beats: [t('quarter', 3, 2, { dots: 1 }), t('quarter', 3, 4, { dots: 1 })] },
            { beats: [t('8th', 2, 2, duo), t('8th', 2, 4, duo), r('quarter', { dots: 1 })] },
            { timeSignature: twelve, beats: [t('8th', 1, 0), t('8th', 1, 2), t('8th', 1, 4), t('quarter', 2, 2, { dots: 1 }),
              t('8th', 2, 4), r('8th'), t('8th', 2, 5), t('quarter', 3, 2), t('8th', 3, 4)] },
            { timeSignature: three, beats: [t('16th', 1, 0), t('16th', 1, 2), t('16th', 1, 4), t('16th', 1, 5), t('16th', 1, 4), t('16th', 1, 2)] },
            { beats: [t('8th', 2, 3, { dots: 1 }), t('16th', 2, 5), t('8th', 2, 7)] },
          ] },
          { name: '7-str', showStandardNotation: false, showTablature: true, tuning: ['B1', 'E2', 'A2', 'D3', 'G3', 'B3', 'E4'], measures: [
            { beats: [t('8th', 2, 5, {}, { slide: 'up' }), r('8th'), t('8th', 2, 7), t('8th', 1, 5, {}, { hammerPull: true }), r('8th'), t('8th', 1, 7)] },
            { beats: [t('quarter', 3, 7, { dots: 1 }, { bend: 'full' }), t('8th', 3, 9, { dots: 1 }), t('16th', 4, 5, PM), t('8th', 4, 5, PM)] },
            { beats: [t('16th', 7, 0), r('16th'), t('16th', 7, 2), r('16th'), t('16th', 6, 3), r('16th'),
              t('8th', 5, 2, { dots: 1 }), r('16th'), t('8th', 5, 4)] },
            { timeSignature: twelve, beats: [t('8th', 1, 5, quad), t('8th', 1, 7, quad), t('8th', 1, 8, quad), t('8th', 1, 7, quad),
              t('8th', 2, 5), t('8th', 2, 7), t('8th', 2, 8), t('8th', 3, 5, duo), t('8th', 3, 7, duo),
              t('8th', 4, 5, quad), r('8th', quad), t('8th', 4, 7, quad), t('8th', 4, 5, quad)] },
            { timeSignature: three, beats: [t('16th', 2, 5, t3), t('16th', 2, 7, t3), t('16th', 2, 8, t3), t('8th', 3, 5), t('8th', 3, 7)] },
            { beats: [t('quarter', 3, 7, { dots: 1 })] },
          ] },
        ],
      };
    })(),
  },
  {
    // Tuplets longer than a beat get one bracket (notation and TAB): quarter-note triplets over two beats,
    // mixed values inside 8th triplets ([q, 8], [8, q], [8, 16, 16, 8]), a 16th sextuplet next to an 8th
    // quintuplet over two beats, half-note triplets with a rest in the middle, an off-beat quarter triplet
    // in 3/4, a quarter duplet in 6/8, and a grace inside a quarter triplet next to a dotted 8th triplet.
    // Notation + TAB with tabRhythm: true, and a tab-only track.
    name: 'tuplet-spans', width: 900,
    score: (() => {
      const t = (d, string, fret, extra = {}) => ({ type: 'note', duration: d, notes: [{ string, fret }], ...extra });
      const r = (d, extra = {}) => ({ type: 'rest', duration: d, ...extra });
      const t3 = { tuplet: 3 }; const sext = { tuplet: { count: 6, of: 4 } }; const quint = { tuplet: { count: 5, of: 4 } };
      const duo = { tuplet: { count: 2, of: 3 } };
      const bars = (s) => [
        { beats: [t('quarter', s, 0, t3), t('quarter', s, 2, t3), t('quarter', s, 3, t3), t('half', s + 1, 2)] },
        { beats: [t('quarter', s, 0, t3), t('8th', s, 2, t3), t('8th', s, 3, t3), t('quarter', s, 5, t3),
          t('8th', s, 3, t3), t('16th', s, 2, t3), t('16th', s, 0, t3), t('8th', s, 2, t3), t('quarter', s + 1, 2)] },
        { beats: [t('16th', s, 0, sext), t('16th', s, 2, sext), t('16th', s, 3, sext), t('16th', s, 5, sext), t('16th', s, 3, sext), t('16th', s, 2, sext),
          t('8th', s, 0, quint), t('8th', s, 2, quint), t('8th', s, 3, quint), t('8th', s, 5, quint), t('8th', s, 7, quint), t('quarter', s + 1, 2)] },
        { beats: [t('half', s, 0, t3), r('half', t3), t('half', s, 3, t3)] },
        { timeSignature: { beats: 3, beatType: 4 }, beats: [t('quarter', s + 1, 2), t('quarter', s, 0, t3), t('quarter', s, 2, t3), t('quarter', s, 3, t3)] },
        { timeSignature: { beats: 6, beatType: 8 }, beats: [t('quarter', s, 0, duo), t('quarter', s, 3, duo)] },
        { timeSignature: { beats: 4, beatType: 4 }, beats: [t('quarter', s, 0, t3), { type: 'grace', duration: '16th', notes: [{ string: s, fret: 4 }] },
          t('quarter', s, 5, t3), t('quarter', s, 3, t3), t('8th', s, 2, { tuplet: 3, dots: 1 }), t('16th', s, 3, t3), t('8th', s, 5, t3),
          t('quarter', s + 1, 2)] },
      ];
      return {
        tracks: [
          { name: 'Gtr', showStandardNotation: true, showTablature: true, tabRhythm: true, measures: bars(2) },
          { name: 'Tab', showStandardNotation: false, showTablature: true, measures: bars(3) },
        ],
      };
    })(),
  },
  {
    // Volta brackets and navigation marks: guitar notation + TAB over a tab-only 4-string bass, a long tempo.
    // m1 segno + repeat start; m3-m4 first ending (the bass repeats it on m4) with a chord symbol and a fermata
    // on a high note in m3, closed by m4's repeat end; m5 second ending (open) + To Coda (the bass's ending 3
    // loses to the guitar's); m6 "Last time" (number 3, open) + D.S. al Coda; m7 coda; m8 Fine.
    name: 'navigation', width: 900,
    score: {
      tempoText: 'Moderately, with a steady swing feel (q = 112)',
      tracks: [
        {
          name: 'Guitar', showTablature: true,
          measures: [
            { segno: true, barline: 'repeatStart', beats: [tabq(3, 2), tabq(2, 3), tabq(1, 2), tabq(2, 3)] },
            { beats: [tabq(4, 2), tabq(3, 2), tabq(2, 3), tabq(1, 2)] },
            { ending: 1, beats: [tabq(1, 15, { chord: 'Am7(b5)', fermata: true }), tabq(1, 12), tabq(2, 13), tabq(1, 12)] },
            { ending: 1, barline: 'repeatEnd', beats: [tabq(3, 2), tabq(3, 4), tabq(2, 3), tabq(3, 2)] },
            { ending: [2], jump: 'To Coda', beats: [tabq(4, 2), tabq(3, 2), tabq(2, 3, { chord: 'G' }), tabq(2, 1)] },
            { ending: { numbers: [3], text: 'Last time', open: true }, jump: 'D.S. al Coda', beats: [tabq(3, 0), tabq(3, 2), tabq(2, 1), tabq(2, 0)] },
            { coda: true, beats: [tabq(5, 3, { chord: 'C' }), tabq(4, 2), tabq(3, 0), tabq(2, 1)] },
            { jump: 'Fine', beats: [{ type: 'note', duration: 'whole', notes: [{ string: 5, fret: 3 }, { string: 4, fret: 2 }, { string: 2, fret: 1 }] }] },
          ],
        },
        {
          name: 'Bass', showStandardNotation: false, showTablature: true, tuning: ['E1', 'A1', 'D2', 'G2'],
          measures: [
            { beats: [tabq(3, 0), tabq(3, 0), tabq(2, 3), tabq(2, 3)] },
            { beats: [tabq(4, 3), tabq(4, 3), tabq(3, 2), tabq(3, 2)] },
            { beats: [tabq(3, 0), tabq(3, 0), tabq(3, 3), tabq(3, 3)] },
            { ending: 1, beats: [tabq(4, 0), tabq(4, 0), tabq(4, 3), tabq(4, 3)] },
            { ending: 3, beats: [tabq(4, 3), tabq(4, 3), tabq(4, 3), tabq(4, 3)] },
            { beats: [tabq(3, 0), tabq(3, 0), tabq(3, 0), tabq(3, 0)] },
            { beats: [tabq(3, 3), tabq(3, 3), tabq(4, 3), tabq(4, 3)] },
            { beats: [{ type: 'note', duration: 'whole', notes: [{ string: 3, fret: 3 }] }] },
          ],
        },
      ],
    },
  },
  {
    // Navigation across system breaks (narrow): a "1., 2." bracket starting at a repeat start and split over a
    // break (continuation without number / left hook, right hook at its repeat end), a first ending on a
    // system's first measure that is also a repeat start, a segno on a system's first measure, and measure
    // numbers next to brackets.
    name: 'navigation-break', width: 600,
    score: {
      tracks: [{
        name: 'Gt.', showTablature: true,
        measures: [
          { beats: [q('E4'), q('G4'), q('B4'), q('D5')] },
          { barline: 'repeatStart', ending: [1, 2], beats: [q('A4', { chord: 'Am' }), q('C5'), q('E5'), q('C5')] },
          { ending: [2, 1], beats: [q('G4', { chord: 'G' }), q('B4'), q('D5'), q('G5', { fermata: true })] },
          { ending: ['1', 2], barline: 'repeatEnd', beats: [q('F4'), q('A4'), q('C5'), q('F5')] },
          { ending: 3, beats: [q('E4'), q('G4'), q('B4'), q('E5')] },
          { barline: 'repeatStart', ending: 1, beats: [q('D4'), q('F4'), q('A4'), q('D5')] },
          { ending: 1, barline: 'repeatEnd', beats: [q('C4'), q('E4'), q('G4'), q('C5')] },
          { ending: 2, beats: [q('E4'), q('G4'), q('B4'), q('D5')] },
          { segno: true, beats: [q('F4'), q('A4'), q('C5'), q('F5')] },
          { jump: 'D.S. al Fine', beats: [q('G4'), q('B4'), q('D5'), q('G5')] },
        ],
      }],
    },
  },
  {
    // Navigation over a tab-only top staff: P.M. and let-ring runs, a bend and pick strokes under a first
    // ending and a segno; a notation track below.
    name: 'navigation-tab-only', width: 900,
    score: {
      tracks: [
        {
          name: 'TAB', showStandardNotation: false, showTablature: true,
          measures: [
            { segno: true, beats: [tabq(6, 0, { palmMute: true, pickStroke: 'down' }), tabq(6, 0, { palmMute: true, pickStroke: 'down' }),
                                   tabq(5, 2, { palmMute: true, pickStroke: 'up' }), tabq(5, 2, { palmMute: true, pickStroke: 'up' })] },
            { ending: 1, barline: 'repeatEnd', beats: [tabh(2, 7, { bend: 'full' }, { pickStroke: 'down' }), tabq(1, 5, { letRing: true, pickStroke: 'up' }),
                                                       tabq(2, 5, { letRing: true }), tabq(3, 4, { letRing: true, pickStroke: 'down' })] },
            { ending: 2, jump: 'D.S.', beats: [tabq(4, 2, { letRing: true, palmMute: true }), tabq(4, 2, { letRing: true, palmMute: true }),
                                               tabh(3, 7, { bend: '1/2' }, { pickStroke: 'up' }), tabq(3, 5)] },
            { coda: true, beats: [tabq(5, 3, { pickStroke: 'down' }), tabq(4, 2), tabq(3, 0), tabq(2, 1)] },
          ],
        },
        {
          name: 'Notation', showTablature: false,
          measures: [
            { beats: [q('E4'), q('E4'), q('B4'), q('B4')] },
            { beats: [q('F#5', { chord: 'D' }), q('A5'), q('A5'), q('G5')] },
            { beats: [q('E5'), q('E5'), q('D5'), q('C5')] },
            { beats: [q('C5'), q('E5'), q('G4'), q('C5')] },
          ],
        },
      ],
    },
  },
  {
    // Chord diagrams: a notation-only lead sheet that opts in (showChordDiagrams: true) over a guitar with notation +
    // TAB (diagrams default on). Dictionary shapes, a beat override (F as a small triad), chordDiagram: false (G in
    // m2), an invalid override (Em in m3: plain symbol, no dictionary fallback) and a chord without a shape (Dm: plain).
    name: 'chord-diagrams', width: 900,
    score: {
      chordShapes: {
        C: { frets: ['x', 3, 2, 0, 1, 0], fingers: [0, 3, 2, 0, 1, 0] },
        Am: { frets: ['x', 0, 2, 2, 1, 0], fingers: [0, 0, 2, 3, 1, 0] },
        F: { frets: [1, 3, 3, 2, 1, 1], fingers: [1, 3, 4, 2, 1, 1], barre: { fret: 1 } },
        G: { frets: [3, 2, 0, 0, 0, 3], fingers: [2, 1, 0, 0, 0, 3] },
        Em: { frets: [0, 2, 2, 0, 0, 0] },
        G7: { frets: [3, 2, 0, 0, 0, 1] },
      },
      tracks: [
        {
          name: 'Lead', showChordDiagrams: true,
          measures: [
            { beats: [q('E5', { chord: 'C' }), q('G5'), q('A5', { chord: 'Am' }), q('E5')] },
            { beats: [q('F5', { chord: 'F' }), q('A5'), q('G5', { chord: 'G' }), q('D5')] },
            { beats: [q('E5', { chord: 'Em' }), q('B4'), q('D5', { chord: 'Dm' }), q('F5')] },
            { beats: [{ type: 'note', duration: 'half', notes: [n('G5')], chord: 'G7' }, { type: 'note', duration: 'half', notes: [n('C5')], chord: 'C' }] },
          ],
        },
        {
          name: 'Guitar', showTablature: true,
          measures: [
            { beats: [tabq(5, 3, { chord: 'C' }), tabq(4, 2), tabq(5, 0, { chord: 'Am' }), tabq(3, 2)] },
            { beats: [tabq(4, 3, { chord: 'F', chordDiagram: { frets: ['x', 'x', 3, 2, 1, 1], fingers: [0, 0, 3, 2, 1, 1] } }), tabq(3, 2),
                      tabq(6, 3, { chord: 'G', chordDiagram: false }), tabq(5, 2)] },
            { beats: [tabq(6, 0, { chord: 'Em', chordDiagram: { frets: [0, 2, 2] } }), tabq(5, 2), tabq(4, 0, { chord: 'Dm' }), tabq(3, 2)] },
            { beats: [tabq(6, 3, { chord: 'G7' }), tabq(1, 1), tabq(5, 3, { chord: 'C' }), tabq(2, 1)] },
          ],
        },
      ],
    },
  },
  {
    // Chord diagrams over a tab-only guitar: a barre F with fingers at the nut, a "5fr" D (A-shape partial barre) and a C,
    // under pick strokes, a P.M. run and a bend; a tab-only 4-string bass with the same chord names gets nothing
    // (6-string shapes don't fit 4 strings).
    name: 'chord-diagrams-tab', width: 900,
    score: {
      chordShapes: {
        F: { frets: [1, 3, 3, 2, 1, 1], fingers: [1, 3, 4, 2, 1, 1], barre: { fret: 1 } },
        D: { frets: ['x', 5, 7, 7, 7, 5], fingers: [0, 1, 3, 3, 3, 1], barre: { fret: 5, from: 5 } },
        C: { frets: ['x', 3, 2, 0, 1, 0], fingers: [0, 3, 2, 0, 1, 0] },
      },
      tracks: [
        {
          name: 'Gtr', showStandardNotation: false, showTablature: true,
          measures: [
            { beats: [tabq(6, 1, { chord: 'F', pickStroke: 'down', palmMute: true }), tabq(6, 1, { pickStroke: 'down', palmMute: true }),
                      tabq(4, 3, { pickStroke: 'up', palmMute: true }), tabq(3, 2, { pickStroke: 'down' })] },
            { beats: [tabq(5, 5, { chord: 'D' }), tabh(3, 7, { bend: 'full' }), tabq(2, 5), tabq(1, 5)] },
            { beats: [tabq(5, 3, { chord: 'C', pickStroke: 'down' }), tabq(4, 2, { pickStroke: 'up' }), tabq(2, 1, { chord: 'F' }), tabq(1, 1)] },
          ],
        },
        {
          name: 'Bass', showStandardNotation: false, showTablature: true, tuning: ['E1', 'A1', 'D2', 'G2'],
          measures: [
            { beats: [tabq(4, 1, { chord: 'F' }), tabq(4, 1), tabq(4, 1), tabq(4, 1)] },
            { beats: [tabq(4, 5, { chord: 'D' }), tabq(4, 5), tabq(3, 0), tabq(3, 0)] },
            { beats: [tabq(3, 3, { chord: 'C' }), tabq(3, 3), tabq(4, 1, { chord: 'F' }), tabq(4, 1)] },
          ],
        },
      ],
    },
  },
  {
    // Chord diagrams across system breaks (narrow) with navigation: a segno, a repeated first ending and a second
    // ending, To Coda / coda, a fermata on a diagram beat, chord changes on the last beat of the measures that end
    // systems 1 and 2 (clamped at the right edge) and a tempo mark.
    name: 'chord-diagrams-break', width: 600,
    score: {
      tempoText: 'Moderato (q = 96)',
      chordShapes: {
        C: { frets: ['x', 3, 2, 0, 1, 0] },
        Am: { frets: ['x', 0, 2, 2, 1, 0] },
        Dm: { frets: ['x', 'x', 0, 2, 3, 1] },
        G: { frets: [3, 2, 0, 0, 0, 3] },
        E7: { frets: [0, 2, 0, 1, 0, 0] },
        Bb: { frets: ['x', 1, 3, 3, 3, 1], barre: { fret: 1, from: 5 } },
      },
      tracks: [{
        name: 'Gt.', showTablature: true,
        measures: [
          { segno: true, beats: [tabq(5, 3, { chord: 'C' }), tabq(4, 2), tabq(3, 0), tabq(2, 1, { chord: 'Am' })] },
          { beats: [tabq(4, 0, { chord: 'Dm' }), tabq(3, 2), tabq(2, 3), tabq(6, 3, { chord: 'G' })] },
          { ending: 1, barline: 'repeatEnd', beats: [tabq(6, 0, { chord: 'E7' }), tabq(4, 0), tabq(3, 1, { fermata: true, chord: 'Am' }), tabq(2, 1)] },
          { ending: 2, jump: 'To Coda', beats: [tabq(5, 1, { chord: 'Bb' }), tabq(4, 3), tabq(3, 3), tabq(2, 3)] },
          { beats: [tabq(5, 0, { chord: 'Am' }), tabq(4, 2), tabq(3, 2), tabq(2, 1, { chord: 'Dm' })] },
          { jump: 'D.S. al Coda', beats: [tabq(6, 3, { chord: 'G' }), tabq(5, 2), tabq(4, 0), tabq(3, 0)] },
          { coda: true, beats: [tabq(5, 3, { chord: 'C' }), tabq(4, 2), tabq(3, 0, { chord: 'G' }), tabq(2, 0)] },
          { beats: [{ type: 'note', duration: 'whole', notes: [{ string: 5, fret: 3 }, { string: 4, fret: 2 }, { string: 2, fret: 1 }], chord: 'C', fermata: true }] },
        ],
      }],
    },
  },
  {
    // Techniques 1.1: whammy dive (held, returned, pre-dive), bass slap / pop, rake and trill. Guitar with notation +
    // TAB (dive held over a vibrato beat and a rest under P.M., trills with vibrato / tremolo / tap, a pre-dive after a
    // close beat, a rake with three muted graces inside P.M. + let ring runs), a tab-only guitar (dive under pick
    // strokes with an H letter beneath, a pitch-target trill, a lone rake and two rakes in a row), a 4-string bass
    // (slap / pop / tap letters, a pull-off next to a pop, a dive) and a notation-only staff (trills on a whole note
    // with tremolo, under a slur, in a beam group with tap and pick; a rake label below the staff). No harmonics.
    name: 'techniques-11', width: 900,
    score: {
      tracks: [
        {
          name: 'Gt.', showTablature: true,
          measures: [
            { beats: [
              tabh(3, 5, {}, { whammy: { type: 'dive', amount: '1' }, ...PM }), tabh(3, 7, {}, { vibrato: true, ...PM }),
              { type: 'rest', duration: 'quarter', ...PM }, tabh(3, 5, {}, { whammy: { type: 'return' } }),
            ] },
            { beats: [
              tabh(2, 5, { trill: { fret: 7 } }, { vibrato: true, tremolo: 2 }), tabh(2, 7, { trill: true, tap: true }),
              tabh(2, 5, { trill: 'F#4' }), tabq(2, 3),
            ] },
            { beats: [
              tabe(3, 5), tabe(3, 7, { whammy: { type: 'predive', amount: '1' } }), tabe(3, 5), tabe(3, 7),
              tabe(3, 5), tabe(3, 7), tabe(3, 5, { whammy: { type: 'dive', amount: '1/2' } }), tabe(3, 7, { whammy: { type: 'return' } }),
            ] },
            { beats: [
              tabg(3, 7, { palmMute: true, letRing: true }), tabg(3, 7, { palmMute: true, letRing: true }), tabg(3, 7, { palmMute: true, letRing: true }),
              tabh(3, 7, {}, { rake: 'down', palmMute: true, letRing: true }), tabh(3, 9, {}, { palmMute: true, letRing: true }), tabq(3, 5), tabq(3, 5),
            ] },
          ],
        },
        {
          name: 'Gt. 2', showStandardNotation: false, showTablature: true,
          measures: [
            { beats: [
              tabh(3, 5, {}, { whammy: { type: 'dive', amount: '1 1/2' }, pickStroke: 'down' }),
              tabh(3, 7, { hammerPull: 'h' }, { pickStroke: 'up' }), tabh(3, 9, {}, { pickStroke: 'down' }), tabq(3, 5, { pickStroke: 'up' }),
            ] },
            { beats: [
              tabh(2, 5, {}, { pickStroke: 'down' }), tabh(2, 5, {}, { whammy: { type: 'return' } }), tabh(2, 3, { trill: 'F4' }), tabq(2, 3),
            ] },
            { beats: [tabh(3, 5, {}, { rake: true }), tabq(3, 5), tabh(3, 5, {}, { rake: 'up' }), tabh(3, 5, {}, { rake: 'down' })] },
            { beats: [tabq(3, 5), tabq(3, 7), tabh(3, 5, { trill: 2 }), tabq(3, 5)] },
          ],
        },
        {
          name: 'Bass', clef: 'bass', tuning: ['E1', 'A1', 'D2', 'G2'], showTablature: true,
          measures: [
            { beats: [
              tabh(4, 3, { slap: true }), tabh(3, 2, { pop: true }),
              { type: 'note', duration: 'quarter', notes: [{ string: 4, fret: 3, slap: true }, { string: 2, fret: 5, pop: true }] },
              tabh(3, 2, { pop: true }),
            ] },
            { beats: [
              tabh(2, 7, { tap: true, slap: true }), tabh(3, 5, { pop: true, hammerPull: 'p' }), tabq(3, 3), tabq(4, 3),
            ] },
            { beats: [tabq(4, 3), tabh(3, 2, {}, { whammy: { type: 'dive', amount: '1' } }), tabq(3, 2), tabq(3, 2)] },
            { beats: [tabq(4, 3), tabh(3, 2, {}, { whammy: { type: 'return' } }), tabh(4, 3, { slap: true }), tabq(4, 3)] },
          ],
        },
        {
          name: 'Ens.',
          measures: [
            { beats: [{ type: 'note', duration: 'whole', notes: [{ pitch: 'C5', trill: true }], tremolo: 2 }] },
            { beats: [
              { type: 'note', duration: 'quarter', notes: [{ pitch: 'E5', trill: true }], slurStart: true }, q('G5'),
              { type: 'note', duration: 'quarter', notes: [{ pitch: 'E5', trill: 'F5' }], slurEnd: true }, q('C5'),
            ] },
            { beats: [
              { type: 'note', duration: '8th', notes: [{ pitch: 'G4', trill: true, tap: true }], pickStroke: 'down' },
              { type: 'note', duration: '8th', notes: [{ pitch: 'A4' }], pickStroke: 'up' }, e('B4'), e('C5'), q('D5'), q('E5'),
            ] },
            { beats: [
              { type: 'grace', duration: '16th', notes: [{ pitch: 'E4', mute: true }] }, { type: 'grace', duration: '16th', notes: [{ pitch: 'E4', mute: true }] },
              { type: 'note', duration: 'quarter', notes: [{ pitch: 'E4', mute: true }], rake: 'down' }, q('G4'), q('B4'), q('E4'),
            ] },
          ],
        },
      ],
    },
  },
  {
    // Techniques 1.1 across system breaks at 600: 10 measures, systems of measures 1-2, 3-5, 6-8, 9-10 (notation +
    // TAB). A pre-dive on the very first beat; a dive on the last beat of system 1 returned on beat 2 of system 2,
    // whose first beat is a rake with its three graces; trills on the last beat of a measure inside a system and on
    // the last beat of system 2; a dive in system 2 held across two breaks to the end of the track.
    name: 'techniques-11-break', width: 600,
    score: {
      tracks: [{
        name: 'Gt.', showTablature: true,
        measures: [
          { beats: [tabh(3, 5, {}, { whammy: { type: 'predive', amount: '1' } }), tabq(3, 7), tabq(3, 5), tabq(3, 7)] },
          { beats: [tabq(3, 5), tabq(3, 7), tabq(3, 5), tabh(3, 7, {}, { whammy: { type: 'dive', amount: '1' } })] },
          { beats: [
            tabg(3, 7), tabg(3, 7), tabg(3, 7), tabh(3, 7, {}, { rake: 'down' }), tabh(3, 5, {}, { whammy: { type: 'return' } }),
            tabq(3, 7), tabh(3, 5, { trill: 7 }),
          ] },
          { beats: [tabq(3, 5), tabq(3, 7), tabh(3, 5, {}, { whammy: { type: 'dive', amount: '1 1/2' } }), tabq(3, 7)] },
          { beats: [tabq(3, 5), tabq(3, 7), tabq(3, 5), tabh(3, 7, { trill: 9 })] },
          { beats: [tabq(3, 5), tabq(3, 7), tabq(3, 5), tabq(3, 7)] },
          { beats: [tabq(3, 5), tabq(3, 7), tabq(3, 5), tabq(3, 7)] },
          { beats: [tabq(3, 5), tabq(3, 7), tabq(3, 5), tabq(3, 7)] },
          { beats: [tabq(3, 5), tabq(3, 7), tabq(3, 5), tabq(3, 7)] },
          { beats: [tabq(3, 5), tabq(3, 7), tabq(3, 5), tabq(3, 7)] },
        ],
      }],
    },
  },
  {
    // Strum / arpeggio marks (1.2.0). Guitar with notation + TAB: arpeggio true / up / down on chords with accidentals,
    // a ledger-line chord, a ghost note and a grace before the chord, ignored on a single note and a rest; a 16th
    // rasgueado run alternating down / up; strum + pickStroke (strum wins), strums with a tap, a trill (grace inside
    // the run), a rest breaking the run and a rake. A tab-only guitar: strums over a bend, an H, a dip and P.M.,
    // arpeggios on TAB. A notation-only staff: strums under a slur, over T / S / trill, under a fermata, with a
    // pick stroke (strum wins), arpeggios and a whole-note chord with both marks.
    name: 'strum-arpeggio', width: 900,
    score: {
      tracks: [
        {
          name: 'Gt.', showTablature: true,
          measures: [
            { beats: [
              tabc(C_CHORD, { arpeggio: true }), tabc([[4, 4], [3, 3], [2, 2]], { arpeggio: 'up' }),
              { type: 'grace', duration: '16th', notes: [{ string: 3, fret: 0 }] }, tabc([[4, 0], [3, 2], [2, 3], [1, 2, { ghost: true }]], { arpeggio: 'down' }),
              tabq(2, 1, { arpeggio: true }),
            ] },
            { beats: [
              { type: 'rest', duration: 'quarter', arpeggio: true }, tabc([[6, 0], [5, 2], [4, 2]], { arpeggio: 'up' }, 'half'),
              tabc([[6, 3], [5, 2], [4, 0], [3, 0], [2, 0], [1, 3]], { arpeggio: 'down' }),
            ] },
            { beats: [
              ras(0), ras(1), ras(2), ras(3), ras(4), ras(5), ras(6), ras(7),
              tabc(E_TOP, { strum: 'down', pickStroke: 'up' }), qr(),
            ] },
            { beats: [
              tabc([[3, 2], [2, 3, { tap: true }]], { strum: 'down' }), { type: 'grace', duration: '16th', notes: [{ string: 2, fret: 1 }] },
              tabc([[3, 2], [2, 3, { trill: 5 }]], { strum: 'up' }), qr(),
              tabc(E_TOP, { strum: 'down', rake: 'down' }, '8th'), tabc(E_TOP, { strum: 'up' }, '8th'),
            ] },
          ],
        },
        {
          name: 'Gt. 2', showStandardNotation: false, showTablature: true,
          measures: [
            { beats: [
              tabh(3, 7, { bend: 'full' }, { strum: 'down' }), tabh(3, 7, { hammerPull: 'h' }, { strum: 'up' }),
              tabh(3, 9, {}, { strum: 'down' }), tabh(3, 7, {}, { strum: 'up', whammy: '1/2' }),
            ] },
            { beats: [
              tabc([[4, 7], [3, 7], [2, 8]], { arpeggio: 'down', strum: 'down', ...PM }), tabc([[4, 7], [3, 7], [2, 8]], { strum: 'up', ...PM }),
              tabc([[4, 9], [3, 9], [2, 10]], { arpeggio: 'up', strum: 'up' }), tabc([[4, 9], [3, 9], [2, 10]], { arpeggio: true }),
            ] },
            { beats: [tabq(3, 5), tabq(3, 7), tabq(3, 5), tabq(3, 7)] },
            { beats: [tabq(3, 5, { strum: 'down' }), tabq(3, 7, { strum: 'up' }), tabq(3, 5, { strum: 'down' }), tabq(3, 7, { strum: 'up' })] },
          ],
        },
        {
          name: 'Ens.',
          measures: [
            { beats: [
              q('C6', { strum: 'down', slurStart: true }), pc([n('G4', { tap: true }), 'B4'], { strum: 'up' }),
              pc([n('A4', { trill: true }), 'C5'], { strum: 'down' }), q('C6', { slurEnd: true }),
            ] },
            { beats: [
              pc([n('E4', { slap: true }), 'G4'], { strum: 'up', fermata: true }), q('E4', { strum: 'down', pickStroke: 'up' }), qr(),
              pc(['C4', 'E4', 'G4', 'C5'], { arpeggio: 'up' }),
            ] },
            { beats: [
              e('E4', { strum: 'down' }), e('E4', { strum: 'up' }), e('E4', { strum: 'down' }), e('E4', { strum: 'up' }),
              pc(['F4', 'A4', 'C5'], { arpeggio: true }, 'half'),
            ] },
            { beats: [pc(['Bb3', 'D4', 'F4', 'Bb4'], { arpeggio: 'down', strum: 'down' }, 'whole')] },
          ],
        },
      ],
    },
  },
  {
    // Strum / arpeggio across system breaks at 600: systems of measures 1-2, 3-5, 6. A strum run through system 1
    // ending on an arpeggio chord (last beat before the break) whose tied F# is restated, with its arpeggio, on the
    // first beat of system 2, where the strum run starts again; an arpeggio inside system 2.
    name: 'strum-arpeggio-break', width: 600,
    score: {
      tracks: [{
        name: 'Gt.', showTablature: true,
        measures: [
          { beats: [tabc(E_TOP, { strum: 'down' }), tabc(E_TOP, { strum: 'up' }), tabc(E_TOP, { strum: 'down' }), tabc(E_TOP, { strum: 'up' })] },
          { beats: [tabc(E_TOP, { strum: 'down' }), tabc(E_TOP, { strum: 'up' }), tabc(E_TOP, { strum: 'down' }),
            pc([n('F#4', { string: 1, fret: 2, tieStart: true }), n('A3', { string: 3, fret: 2 })], { arpeggio: 'up', strum: 'up' })] },
          { beats: [pc([n('F#4', { string: 1, fret: 2, tieEnd: true }), n('C#4', { string: 2, fret: 2 }), n('A3', { string: 3, fret: 2 })], { arpeggio: true, strum: 'down' }),
            tabc(E_TOP, { strum: 'up' }), tabc(E_TOP), tabc(E_TOP)] },
          { beats: [tabq(3, 5), tabq(3, 7), tabq(3, 5), tabc([[4, 2], [3, 2], [2, 3]], { arpeggio: 'down' })] },
          { beats: [tabq(3, 5), tabq(3, 7), tabq(3, 5), tabq(3, 7)] },
          { beats: [tabq(3, 5), tabq(3, 7), tabq(3, 5), tabq(3, 7)] },
        ],
      }],
    },
  },
  {
    // Legato and slides (1.3.0). Guitar with notation + TAB: m1 a 5h7p5h7 eighth run on string 1 (one merged slur) and a
    // two-string chord hammering on strings 2 and 3 (one slur); m2 an explicit slur over a hammer-on beat (auto slur
    // suppressed), a grace hammering on (no auto slur) and a hammer-on whose next note is on another string (links to
    // the later string-3 note, past a string-4 note); m3 slide-ins true / 'down' / 'above' (on the downbeat after the barline, on a note with an
    // accidental), slide-outs true (dotted note) / 'up' (last 8th, before the barline); m4 conflicts: slide-out + slide,
    // slide-in on the slide's target, slide-in on a grace, slide-out + bend, slide-in 'sideways' (all skipped); m5-m7
    // pre-bend, pre-bend-and-release, release notes (own amount, default from the string's last bend, 'Full' with no
    // earlier bend, ghost), 'full release' unchanged. A tab-only guitar: H / P, slide in / out, a pre-bend under a whammy
    // dip and its release. A notation-only staff: slide in / out drawn; a hammerPull without string adds no slur.
    name: 'legato-slides', width: 900,
    score: {
      tracks: [
        {
          name: 'Gt.', showTablature: true,
          measures: [
            { beats: [
              tabd('8th', 1, 5, { hammerPull: true }), tabd('8th', 1, 7, { hammerPull: 'p' }), tabd('8th', 1, 5, { hammerPull: true }), tabd('8th', 1, 7),
              tabc([[2, 5, { hammerPull: true }], [3, 5, { hammerPull: true }]]), tabc([[2, 7], [3, 7]]),
            ] },
            { beats: [
              tabd('8th', 2, 5, {}, { slurStart: true }), tabd('8th', 2, 7, { hammerPull: true }, { slurEnd: true }), tabq(2, 8),
              { type: 'grace', duration: '16th', notes: [{ string: 3, fret: 4, hammerPull: true }] }, tabh(3, 5, { hammerPull: true }),
              tabd('8th', 4, 5), tabd('8th', 3, 7),
            ] },
            { beats: [
              tabh(2, 5, { slideIn: true }), tabd('8th', 2, 7, { slideIn: 'down' }), tabd('8th', 3, 9, { slideIn: 'above' }),
              tabh(3, 7, { slideOut: true }, { dots: 1 }), tabd('8th', 1, 5, { slideOut: 'up' }),
            ] },
            { beats: [
              tabh(3, 5, { slide: true, slideOut: true }), tabh(3, 7, { slideIn: true }),
              { type: 'grace', duration: '16th', notes: [{ string: 2, fret: 5, slideIn: true }] }, tabh(2, 7, { bend: 'full', slideOut: true }),
              tabh(1, 5, { slideIn: 'sideways' }),
            ] },
            { beats: [
              tabh(2, 8, { bend: 'prebend full' }), tabh(2, 8, { bend: { type: 'release', amount: 'full' } }),
              tabq(4, 5), tabh(3, 7, { bend: 'pb 1/2 release' }),
            ] },
            { beats: [tabh(1, 10, { bend: 'release' }), tabq(5, 3), tabh(3, 7, { bend: 'release' }), tabq(5, 3)] },
            { beats: [tabh(2, 10, { bend: 'full release' }), tabq(5, 3), tabh(4, 7, { bend: 'release', ghost: true }), tabq(5, 3)] },
          ],
        },
        {
          name: 'TAB', showStandardNotation: false, showTablature: true,
          measures: [
            { beats: [
              tabd('8th', 3, 5, { hammerPull: true }), tabd('8th', 3, 7, { hammerPull: true }), tabd('8th', 3, 5), tabd('8th', 3, 7),
              tabh(2, 5, { slideIn: true }), tabh(2, 7, { slideOut: 'down' }),
            ] },
            { beats: [tabq(3, 5), tabq(3, 7), tabh(3, 5, { slideIn: 'above' }), tabh(3, 7, { slideOut: 'up' })] },
            { beats: [tabq(3, 5), tabq(3, 7), tabq(3, 5), tabq(3, 7)] },
            { beats: [tabq(3, 5), tabq(3, 7), tabq(3, 5), tabq(3, 7)] },
            { beats: [tabh(2, 8, { bend: 'prebend full' }, { whammy: true }), tabh(2, 8, { bend: 'release' }), tabq(3, 5), tabq(3, 7)] },
            { beats: [tabq(3, 5), tabq(3, 7), tabq(3, 5), tabq(3, 7)] },
            { beats: [tabq(3, 5), tabq(3, 7), tabq(3, 5), tabq(3, 7)] },
          ],
        },
        {
          name: 'Notation',
          measures: [
            { beats: [pc([n('G4', { slideIn: true })]), pc([n('B4', { slideOut: 'up' })]), pc([n('C5', { hammerPull: true })]), q('D5')] },
            { beats: [pc([n('E5', { slideIn: 'above' })]), pc([n('F#5', { slideIn: true })]), qr(), pc([n('A4', { slideOut: 'down' })])] },
            bar4(), bar4(), bar4(), bar4(), bar4(),
          ],
        },
      ],
    },
  },
  {
    // Legato and slides across system breaks at 600 (notation + TAB; systems of measures 1-2, 3-4, 5-7, 8-10, 11-12):
    // an H / P chain from the last beat of system 1 into system 2 (slur and TAB arcs split); a slide-out on the last
    // 16th of system 2 (clamped at the break end) and a slide-in on the first beat of system 3 (clamped at the break
    // start); a pre-bend on the last beat of system 3 and a release note opening system 4 (its default amount, 1/2,
    // carried across the break); an explicit slur across the break into system 5 over a hammer-on (auto slur suppressed).
    name: 'legato-slides-break', width: 600,
    score: {
      tracks: [{
        name: 'Gt.', showTablature: true,
        measures: [
          { beats: [tabq(3, 5), tabq(3, 7), tabq(3, 5), tabq(3, 7)] },
          { beats: [tabq(3, 5), tabq(3, 7), tabq(3, 5), tabh(2, 5, { hammerPull: true })] },
          { beats: [tabh(2, 7, { hammerPull: 'p' }), tabq(2, 5), tabq(3, 7), tabq(3, 5)] },
          { beats: [tabq(3, 5), tabq(3, 7), tabq(3, 5), tabd('8th', 3, 7), tabd('16th', 3, 5), tabd('16th', 2, 5, { slideOut: true })] },
          { beats: [tabh(2, 5, { slideIn: 'above' }), tabq(3, 7), tabq(3, 5), tabq(3, 7)] },
          { beats: [tabq(3, 5), tabq(3, 7), tabq(3, 5), tabq(3, 7)] },
          { beats: [tabq(3, 5), tabq(3, 7), tabq(3, 5), tabh(2, 8, { bend: 'pb 1/2' })] },
          { beats: [tabh(2, 8, { bend: 'release' }), tabq(3, 7), tabq(3, 5), tabq(3, 7)] },
          { beats: [tabq(3, 5), tabq(3, 7), tabq(3, 5), tabq(3, 7)] },
          { beats: [tabq(3, 5), tabq(3, 7), tabq(3, 5), tabh(3, 7, {}, { slurStart: true })] },
          { beats: [tabh(3, 5, { hammerPull: true }), tabh(3, 7, {}, { slurEnd: true }), tabq(3, 5), tabq(3, 7)] },
          { beats: [tabq(3, 5), tabq(3, 7), tabq(3, 5), tabq(3, 7)] },
        ],
      }],
    },
  },
  {
    // Key-aware spelling of fret-derived pitches (notation + TAB): a black key is a flat only when that flat is in
    // the measure's key signature. m1 F major: s3f3 Bb, s2f2 C#, s4f1 D#, a Bb4 + C#5 dyad, a second Bb (no
    // accidental), an explicit pitch 'A#4' that stays A#; m2 Bb major: Bb, Eb, G#; m3 Eb major: Ab, C#;
    // m4 D major: A#, F#; m5 C major: all sharps; m6 Cb major: all five flats, B and E stay naturals.
    name: 'spelling-keys', width: 900,
    score: {
      tracks: [{
        name: 'Gt.', showTablature: true, writtenOctaveUp: true, keySignature: -1,
        measures: [
          { beats: [tabe(3, 3), tabe(2, 2), tabe(4, 1), tabc([[2, 11], [1, 9]], {}, '8th'), tabe(3, 3),
            tabd('8th', 2, 11, { pitch: 'A#4' }), tabe(2, 1), tabe(1, 1)] },
          { keySignature: -2, beats: [tabq(3, 3), tabq(4, 1), tabq(1, 4), tabq(2, 1)] },
          { keySignature: -3, beats: [tabq(1, 4), tabq(2, 2), tabq(3, 3), tabq(4, 1)] },
          { keySignature: 2, beats: [tabq(3, 3), tabq(4, 4), tabq(1, 4), tabq(2, 2)] },
          { keySignature: 0, beats: [tabq(3, 3), tabq(4, 1), tabq(1, 4), tabq(2, 2)] },
          { keySignature: -7, beats: [tabe(2, 2), tabe(4, 1), tabe(4, 4), tabe(1, 4), tabe(3, 3), tabe(2, 0), tabe(1, 0), tabe(1, 1)] },
        ],
      }],
    },
  },
  {
    // Grace-note accidentals (notation + TAB, fret-derived and explicit pitches; sounding pitches below, written an
    // octave up): m1 grace F#4 -> F#4 (none) -> F4 (natural); m2 F#4 -> grace F4 (natural) -> F4 (none); m3 two graces
    // with accidentals (C#4, D#4) before a note, and a trailing grace Bb4 (explicit pitch); m4 a grace with an explicit
    // 'natural'; m5 F major: grace Bb4 (none) and grace B4 (natural); m6 C major: a grace dyad E4 / G#4.
    name: 'grace-accidentals', width: 900,
    score: {
      tracks: [{
        name: 'Gt.', showTablature: true, writtenOctaveUp: true,
        measures: [
          { beats: [tabgr([[1, 2]]), tabq(1, 2), tabq(1, 1), tabq(1, 3), tabq(1, 5)] },
          { beats: [tabh(1, 2, { pitch: 'F#4' }), tabgr([[1, 1, { pitch: 'F4' }]]), tabq(1, 1), tabq(1, 3), tabq(1, 5)] },
          { beats: [tabgr([[2, 2]]), tabgr([[2, 4]]), tabq(2, 5), tabq(2, 3), tabq(2, 1), tabq(2, 0), tabgr([[2, 11, { pitch: 'Bb4' }]])] },
          { beats: [tabgr([[1, 1, { accidental: 'natural' }]]), tabq(1, 1), tabq(1, 3), tabq(1, 1), tabq(1, 0)] },
          { keySignature: -1, beats: [tabgr([[2, 11]]), tabq(2, 10), tabgr([[2, 12]]), tabq(2, 12), tabq(2, 10), tabq(2, 8)] },
          { keySignature: 0, beats: [tabgr([[2, 5], [1, 4]]), tabq(1, 5), tabq(1, 4), tabq(1, 5), tabq(1, 0)] },
        ],
      }],
    },
  },
  {
    // Release arrows next to a fret number on the string above (TAB only, so the notation staff can't widen the
    // beats): m1 s2 'full release' -> s1 (capped); m2 a release note on s3 -> an 8th on s2 (capped); m3 'full release'
    // -> the same string, then -> the string below (unchanged); m4 s3 'full release' -> s1, two strings up (unchanged);
    // m5 16ths: s2 'full release' -> s1 (capped at the 0.6 sp minimum fall); m6 -> a ghost "(12)" on the string above
    // (wide label); m7-m9 each end on an s2 'full release' and open on s1, so at 600 one of them crosses a system
    // break (the next system's note is not an obstacle).
    name: 'release-adjacent', width: 900,
    score: {
      tracks: [{
        name: 'Gt.', showStandardNotation: false, showTablature: true,
        measures: [
          { beats: [tabh(2, 7, { bend: 'full release' }), tabq(1, 8), tabq(1, 5), tabq(1, 7)] },
          { beats: [tabh(3, 7, { bend: 'pb full' }), tabd('8th', 3, 7, { bend: 'release' }), tabd('8th', 2, 8), tabq(2, 5), tabq(2, 7)] },
          { beats: [tabh(2, 7, { bend: 'full release' }), tabq(2, 8), tabh(2, 7, { bend: 'full release' }), tabq(3, 8)] },
          { beats: [tabh(3, 7, { bend: 'full release' }), tabq(1, 8), tabq(1, 5), tabq(1, 7)] },
          { beats: [tabd('16th', 2, 10, { bend: 'full release' }), tabd('16th', 1, 12), tabd('16th', 1, 10), tabd('16th', 2, 10), tabq(1, 12), tabq(1, 10), tabq(2, 10)] },
          { beats: [tabh(2, 7, { bend: 'full release' }), tabh(1, 12, { ghost: true }), tabq(1, 10), tabq(1, 8)] },
          { beats: [tabq(1, 8), tabq(1, 5), tabq(1, 7), tabh(2, 7, { bend: 'full release' })] },
          { beats: [tabq(1, 8), tabq(1, 5), tabq(1, 7), tabh(2, 7, { bend: 'full release' })] },
          { beats: [tabq(1, 8), tabq(1, 5), tabq(1, 7), tabh(2, 7, { bend: 'full release' })] },
          { beats: [tabq(1, 8), tabq(1, 5), tabq(1, 7), tabq(1, 8)] },
        ],
      }],
    },
  },
  {
    // 1.4.0 two-voice measures (voice 1 stems up, voice 2 down), key 1#: m1 quarter melody over a whole-note bass;
    // m2 beamed 8ths in both voices, a voice-2 8th triplet, a voice-1 dotted quarter; m3 clash columns (a second, a
    // dotted unison, a second with accidentals in both voices -> one stack); m4 a voice-2 whole-measure rest; m5 a
    // voice-1 half rest raised clear of voice 2's D5 (ledger line); m6 a leading hidden half rest in voice 2, a stemmed
    // voice-2 tremolo, a voice-1 rest; m7 slurs per voice, graces in both voices, articulations on both stem sides,
    // voice 1's C#5 carrying into voice 2's C5 (natural); m7-m8 a tie per voice, a voice-2 whole-note tremolo below;
    // m9 voice 2 only hidden rests (single-voice: automatic stems); m10 a one-entry `voices` (= beats).
    name: 'voices', width: 900,
    score: {
      keySignature: 1,
      tracks: [{
        name: 'Gt.', showTablature: true,
        measures: [
          vm([tabq(2, 0), tabq(1, 0), tabq(1, 2), tabq(1, 3)], [tabd('whole', 6, 3)]),
          vm([tabe(2, 1), tabe(2, 3), tabe(1, 0), tabe(2, 3), tabd('quarter', 2, 1, {}, { dots: 1 }), tabe(2, 0)],
            [tabe(4, 0, { tuplet: 3 }), tabe(4, 2, { tuplet: 3 }), tabe(4, 4, { tuplet: 3 }), tabq(5, 2), tabd('half', 4, 0)]),
          vm([tabq(3, 2), tabd('quarter', 3, 0, {}, { dots: 1 }), tabe(3, 1), tabq(2, 1)],
            [tabq(3, 0), tabd('quarter', 4, 5, {}, { dots: 1 }), tabe(4, 3), tabq(4, 2)]),
          vm([tabq(1, 0), tabq(1, 2), tabq(1, 3), tabq(1, 5)], [{ type: 'rest', duration: 'whole' }]),
          vm([{ type: 'rest', duration: 'half' }, tabd('half', 1, 3)], [tabd('half', 2, 3), { type: 'rest', duration: 'half' }]),
          vm([tabq(2, 0), tabq(2, 1), tabq(2, 3), qr()], [{ type: 'rest', duration: 'half', hidden: true }, tabd('half', 5, 2, {}, { tremolo: true })]),
          vm([tabgr([[1, 1]]), tabq(2, 2, { slurStart: true, articulations: ['staccato'] }), tabq(1, 2), tabq(1, 3, { slurEnd: true }), tabh(1, 0, { tieStart: true }, { articulations: ['accent'] })],
            [tabgr([[5, 0]]), tabq(4, 2, { slurStart: true, articulations: ['tenuto'] }), tabq(3, 5), tabq(4, 0, { slurEnd: true }), tabh(4, 2, { tieStart: true })]),
          vm([tabd('half', 1, 0, { tieEnd: true }), tabd('half', 2, 3)], [tabd('whole', 4, 2, { tieEnd: true }, { tremolo: true })]),
          vm([tabq(2, 0), tabq(2, 1), tabq(2, 3), tabq(1, 0)], [{ type: 'rest', duration: 'whole', hidden: true }]),
          { voices: [{ beats: [tabq(2, 0), tabq(2, 1), tabq(2, 3), tabq(1, 0)] }] },
        ],
      }],
    },
  },
  {
    // Two voices across system breaks (600): a tie and a slur per voice from m2 into m3 split per voice (voice 1
    // above, voice 2 below); voice 2's tied D#4 restates its sharp at the system start; m4 closes both.
    name: 'voices-break', width: 600,
    score: {
      tracks: [{
        name: 'Gt.', showTablature: true,
        measures: [
          vm([tabe(2, 1), tabe(2, 3), tabe(1, 0), tabe(2, 3), tabe(2, 1), tabe(2, 3), tabe(1, 0), tabe(1, 1)],
            [tabe(4, 2), tabe(4, 3), tabe(4, 2), tabe(4, 0), tabe(5, 2), tabe(5, 3), tabe(5, 2), tabe(5, 0)]),
          vm([tabe(2, 1), tabe(2, 3), tabe(1, 0), tabe(2, 3), tabe(2, 1), tabe(2, 3, { slurStart: true }), tabh(1, 0, { tieStart: true })],
            [tabe(4, 2), tabe(4, 3), tabe(4, 2), tabe(4, 0), tabe(5, 2), tabe(5, 3, { slurStart: true }), tabh(5, 6, { tieStart: true })]),
          vm([tabd('half', 1, 0, { tieEnd: true }), tabq(1, 1), tabq(1, 3, { slurEnd: true })],
            [tabd('half', 5, 6, { tieEnd: true }), tabq(4, 0), tabq(4, 2, { slurEnd: true })]),
          vm([tabe(2, 1), tabe(2, 3), tabe(1, 0), tabe(2, 3), tabd('half', 2, 1)], [tabd('whole', 5, 3)]),
        ],
      }],
    },
  },
  {
    // Two voices on TAB (both tracks the same): m1 a voice-2 hammer-on and slide on string 3 while voice 1 plays
    // string 3 in between (links stay within the voice); m2 a voice-2 bend and release, same-string conflict at beat 1
    // (voice 1's fret wins); m3 slide-in / slide-out in both voices; m4 voice-2-only onsets (TAB-only track's rhythm
    // band, voice 1 only: frets without stems), a voice-1 rest over voice-2 frets (its knock-out wins, accepted).
    name: 'voices-tab', width: 900,
    score: {
      tracks: [{
        name: 'Gt.', showTablature: true,
        measures: [
          vm([tabq(1, 3), tabq(3, 5), tabq(1, 5), tabq(1, 3)], [tabd('half', 3, 4, { hammerPull: true }), tabh(3, 6, { slide: true }), tabq(3, 9)]),
          vm([tabd('half', 2, 5), tabd('half', 1, 3)], [tabh(2, 7), tabh(3, 7, { bend: 'full release' }), tabq(3, 5), tabq(4, 7)]),
          vm([tabh(1, 5, { slideIn: 'below' }), tabq(1, 7), tabd('half', 1, 8, { slideOut: 'down' })],
            [tabd('half', 4, 5, { slideIn: 'above' }), tabh(4, 7, { slideOut: 'up' }), qr()]),
          vm([qr(), tabd('half', 1, 5), tabq(1, 3)], [tabe(4, 2), tabe(4, 4), tabe(4, 5), tabe(4, 7), tabd('half', 3, 4)]),
        ],
      }, {
        name: 'TAB', showStandardNotation: false, showTablature: true,
        measures: [
          vm([tabq(1, 3), tabq(3, 5), tabq(1, 5), tabq(1, 3)], [tabd('half', 3, 4, { hammerPull: true }), tabh(3, 6, { slide: true }), tabq(3, 9)]),
          vm([tabd('half', 2, 5), tabd('half', 1, 3)], [tabh(2, 7), tabh(3, 7, { bend: 'full release' }), tabq(3, 5), tabq(4, 7)]),
          vm([tabh(1, 5, { slideIn: 'below' }), tabq(1, 7), tabd('half', 1, 8, { slideOut: 'down' })],
            [tabd('half', 4, 5, { slideIn: 'above' }), tabh(4, 7, { slideOut: 'up' }), qr()]),
          vm([qr(), tabd('half', 1, 5), tabq(1, 3)], [tabe(4, 2), tabe(4, 4), tabe(4, 5), tabe(4, 7), tabd('half', 3, 4)]),
        ],
      }],
    },
  },
  {
    // 1.5.0 note-effect variants (notation + TAB, and a TAB-only track whose marks draw nothing but its own
    // vibrato / tremolo): m1 vibrato true vs 'wide', stem up and down; m2 'wide' over tremolo '16th' and true, a half;
    // m3 'wide' on a whole note; m4-m5 'wide' under a pick stroke, tap "T", trill, fermata 'long', a strum chord and a
    // pick stroke + fermata; m6-m7 marcato below a ledger-line E and above, heavyAccent, staccatissimo, full stacks both sides, a marcato
    // chord, a marcato rest and grace (ignored); m8-m10 tremolo '8th', '16th' beamed 8ths, '32nd' half, true, '8th'
    // stem down, '16th' half and whole (TAB tremolos inside the staff: their fixed-px strokes would otherwise set the
    // TAB staff's distance and break exact x2 scaling); m11-m12 fermata true, 'normal', 'short' under "Am", 'long' under a slur,
    // 'short' on a rest, 'long' on a grace (ignored); m13 two voices: voice 1 marcato + fermata 'short', voice 2
    // 'wide', tremolo '8th', staccatissimo and fermata 'long' (vibrato and fermata ignored on voice 2).
    name: 'note-effects', width: 900,
    score: {
      tracks: [{
        name: 'Gt.', showTablature: true,
        measures: [
          { beats: [tabq(3, 0, { vibrato: true }), tabq(3, 0, { vibrato: 'wide' }), tabq(1, 5, { vibrato: true }), tabq(1, 5, { vibrato: 'wide' })] },
          { beats: [tabq(2, 1, { vibrato: 'wide', tremolo: '16th' }), tabq(2, 3, { vibrato: 'wide', tremolo: true }), tabd('half', 2, 1, {}, { vibrato: 'wide' })] },
          { beats: [tabd('whole', 3, 2, {}, { vibrato: 'wide' })] },
          { beats: [tabq(2, 1, { vibrato: 'wide', pickStroke: 'down' }), tabh(1, 5, { tap: true }, { vibrato: 'wide' }),
            tabh(2, 5, { trill: 7 }, { vibrato: 'wide' }), tabq(2, 3, { vibrato: 'wide', fermata: 'long' })] },
          { beats: [tabc(E_TOP, { strum: 'down', vibrato: 'wide' }, 'half'), tabd('half', 1, 3, {}, { vibrato: 'wide', pickStroke: 'up', fermata: 'long' })] },
          { beats: [tabq(6, 0, { articulations: ['marcato'] }), tabq(1, 5, { articulations: ['marcato'] }),
            tabq(2, 1, { articulations: ['heavyAccent'] }), tabq(1, 3, { articulations: ['staccatissimo'] })] },
          { beats: [tabq(3, 0, { articulations: ['marcato', 'tenuto', 'staccatissimo'] }), tabq(1, 3, { articulations: ['staccatissimo', 'tenuto', 'heavyAccent'] }),
            { type: 'grace', duration: '16th', articulations: ['marcato', 'staccatissimo'], notes: [{ string: 2, fret: 0 }] },
            tabc(E_TOP, { articulations: ['marcato', 'accent'] }), { type: 'rest', duration: 'quarter', articulations: ['marcato', 'staccatissimo'] }] },
          { beats: [tabq(3, 2, { tremolo: '8th' }), tabe(3, 2, { tremolo: '16th' }), tabe(3, 4, { tremolo: '16th' }), tabd('half', 4, 2, {}, { tremolo: '32nd' })] },
          { beats: [tabq(3, 2, { tremolo: true }), tabq(2, 10, { tremolo: '8th' }), tabd('half', 3, 0, {}, { tremolo: '16th' })] },
          { beats: [tabd('whole', 4, 2, {}, { tremolo: '16th' })] },
          { beats: [tabq(2, 1, { fermata: true }), tabq(2, 3, { fermata: 'normal' }), tabq(3, 2, { fermata: 'short', chord: 'Am' }), tabq(2, 1, { slurStart: true })] },
          { beats: [tabq(1, 0, { fermata: 'long' }), tabq(2, 3, { slurEnd: true }), { type: 'rest', duration: 'quarter', fermata: 'short' },
            { type: 'grace', duration: '16th', fermata: 'long', notes: [{ string: 2, fret: 0 }] }, tabq(2, 1)] },
          vm([tabq(1, 0, { articulations: ['marcato'], fermata: 'short' }), tabq(1, 1), tabd('half', 1, 3)],
            [tabq(4, 2, { vibrato: 'wide', tremolo: '8th', articulations: ['staccatissimo'], fermata: 'long' }), tabq(4, 0), tabd('half', 5, 2, {}, { tremolo: '8th' })]),
        ],
      }, {
        name: 'TAB', showStandardNotation: false, showTablature: true,
        measures: [
          { beats: [tabd('whole', 2, 5, {}, { vibrato: 'wide' })] },
          { beats: [tabd('whole', 2, 5, {}, { vibrato: 'wide', tremolo: '8th' })] },
          { beats: [tabd('whole', 2, 5, {}, { tremolo: '16th' })] },
          { beats: [tabd('whole', 2, 5, {}, { articulations: ['marcato', 'staccatissimo', 'heavyAccent'], fermata: 'long' })] },
          { beats: [tabd('whole', 2, 5, {}, { fermata: 'short' })] },
          { beats: [tabd('whole', 2, 5)] },
          { beats: [tabd('whole', 2, 5)] },
          { beats: [tabd('whole', 2, 5)] },
          { beats: [tabd('whole', 2, 5)] },
          { beats: [tabd('whole', 2, 5)] },
          { beats: [tabd('whole', 2, 5)] },
          { beats: [tabd('whole', 2, 5)] },
          { beats: [tabd('whole', 2, 5)] },
        ],
      }],
    },
  },
  {
    // The 1.5.0 marks at system ends and starts (600): a wide vibrato and a 'long' fermata on the last beat of
    // m1-m3, slurs from each of those beats into the next measure with a 'long' fermata under them (one crosses each
    // break), marcato / staccatissimo / tremolo speeds on the first beats.
    name: 'note-effects-break', width: 600,
    score: {
      tracks: [{
        name: 'Gt.', showTablature: true,
        measures: [
          { beats: [tabq(2, 1, { articulations: ['marcato'] }), tabq(2, 3, { tremolo: '16th' }), tabq(1, 0, { articulations: ['staccatissimo'] }),
            tabq(1, 3, { vibrato: 'wide', fermata: 'long', slurStart: true })] },
          { beats: [tabq(1, 5, { fermata: 'long' }), tabq(1, 3, { slurEnd: true, fermata: 'short' }), tabq(2, 3, { tremolo: '8th' }),
            tabq(2, 1, { vibrato: 'wide', fermata: 'long', slurStart: true })] },
          { beats: [tabq(1, 0, { fermata: 'long', articulations: ['heavyAccent'] }), tabq(2, 3, { slurEnd: true }),
            tabd('half', 2, 1, {}, { vibrato: 'wide', tremolo: '32nd', fermata: 'long', slurStart: true })] },
          { beats: [tabq(1, 3, { fermata: 'long' }), tabq(1, 1, { slurEnd: true, articulations: ['staccatissimo', 'marcato'] }),
            tabd('half', 1, 0, {}, { vibrato: 'wide', fermata: 'long' })] },
          { beats: [tabd('whole', 2, 1, {}, { vibrato: 'wide', tremolo: '8th', fermata: 'short' })] },
        ],
      }],
    },
  },
  {
    // 1.6.0 score text: every header field (words != music, 2-line instructions and copyright, tuning chart),
    // drop-D guitar with capo 2 (notation + TAB) over a TAB-only 4-string bass in D; sections (letter + text, text,
    // letter only), x3 on a repeat end, beat text above and below (one beat with a chord symbol and a fermata);
    // the grace note's and the voice-2 beat's texts are ignored.
    name: 'score-text', width: 900,
    score: {
      title: 'Score Text', subtitle: 'Live at the Hall', artist: 'The Example Band', album: 'First Album',
      composer: 'J. Composer', tuningLabel: 'Drop D', words: 'A. Lyricist', music: 'B. Composer',
      instructions: 'Play with a light touch\nLet the open strings ring into each other',
      copyright: '(c) 2026 Example Music\nAll rights reserved', showTuningChart: true, tempoText: 'Moderato (q = 96)',
      tracks: [{
        name: 'Gt.', showTablature: true, capo: 2, tuning: ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'],
        measures: [
          { section: { letter: 'A', text: 'Intro' }, barline: 'repeatStart',
            beats: [tabq(6, 0, { text: 'dolce' }), tabq(4, 2), tabq(3, 2, { text: { text: 'softly', below: true } }), tabq(2, 3)] },
          { repeatCount: 3, barline: 'repeatEnd',
            beats: [tabq(1, 2), tabq(2, 3), tabq(3, 2), tabq(1, 5, { chord: 'D', fermata: true, text: 'hold' })] },
          { section: 'Verse',
            ...vm([{ ...tabgr([[2, 1]]), text: 'grace' }, tabq(2, 3), tabq(3, 2), tabd('half', 4, 0, {}, { text: { text: 'let go', below: true } })],
              [tabd('whole', 6, 0, {}, { text: 'voice 2' })]) },
          { section: { letter: 'B' }, beats: [tabd('whole', 6, 0, {}, { text: 'rit.' })] },
        ],
      }, {
        name: 'Bass', showStandardNotation: false, showTablature: true, tuning: ['D1', 'A1', 'D2', 'G2'],
        measures: [
          { barline: 'repeatStart', beats: [tabd('half', 4, 0), tabd('half', 4, 0)] },
          { barline: 'repeatEnd', beats: [tabd('half', 3, 0), tabd('half', 4, 0, {}, { text: { text: 'mute', below: true } })] },
          { beats: [tabd('whole', 4, 0)] },
          { beats: [tabd('whole', 4, 0)] },
        ],
      }],
    },
  },
  {
    // 1.6.0 score text at system breaks (600): a section, a volta and a segno on a system's first measure; x3 and
    // "D.S. al Coda" on a system's last (repeat-end) measure; words = music.
    name: 'score-text-break', width: 600,
    score: {
      title: 'Score Text Breaks', words: 'Jane Doe', music: ' Jane  Doe ', tempoText: 'Allegro',
      tracks: [{
        name: 'Gt.', showTablature: true,
        measures: [
          { section: { letter: 'A', text: 'Verse' }, beats: [3, 0, 2, 0, 3, 2, 2, 1].map((f, i) => tabe(i % 2 ? 2 : 3, f)) },
          { repeatCount: '3', barline: 'repeatEnd', jump: 'D.S. al Coda', beats: [2, 0, 3, 1, 0, 1].map((f, i) => tabe(i % 2 ? 2 : 3, f)).concat([tabq(3, 0)]) },
          { section: 'Chorus', ending: 1, segno: true, beats: [tabq(3, 0), tabq(3, 2), tabq(2, 0), tabq(2, 1)] },
          { ending: 1, beats: [tabq(2, 3), tabq(1, 0), tabq(1, 2), tabq(1, 3)] },
          { beats: [tabq(1, 5), tabq(1, 3), tabq(2, 5), tabq(2, 3)] },
          { beats: [tabq(2, 3), tabq(1, 0), tabq(1, 2), tabq(1, 3)] },
          { beats: [tabq(1, 5), tabq(1, 3), tabq(2, 5), tabq(2, 3)] },
          { section: { letter: 'C' }, beats: [tabd('whole', 3, 0)] },
        ],
      }],
    },
  },
  {
    // 1.6.0 score text on a TAB-only 7-string (low A instead of B) with capo and tuning chart: a section and beat
    // text above and below the TAB staff.
    name: 'score-text-tab-only', width: 900,
    score: {
      title: 'Seven Strings', showTuningChart: true,
      tracks: [{
        showStandardNotation: false, showTablature: true, capo: '1', tuning: ['A1', 'E2', 'A2', 'D3', 'G3', 'B3', 'E4'],
        measures: [
          { section: 'Riff', beats: [tabq(7, 0, { text: 'heavy' }), tabq(7, 3), tabq(6, 2, { text: { text: 'chug', below: true } }), tabq(6, 0)] },
          { beats: [tabq(5, 2), tabq(4, 2, { text: 'accent' }), tabd('half', 7, 0, {}, { text: { text: 'ring', below: true } })] },
        ],
      }],
    },
  },
  {
    // 1.7.0 ornaments and hand marks (900). Gt. (notation + TAB): m1 turn, 'Inverted-Turn', ' short trill ', 'mordent',
    // trill + turn on one beat (the trill wins), a turn on a grace and on a rest (not drawn); m2 two voices: left-hand
    // fingers on a chord with a second (two columns) and a sharp, on an arpeggio 'up' chord with 'T' and 0, a finger
    // on voice 2 (not drawn); m3 one beat with turn + p i m + T + golpe + down pick under a slur, left-hand tap,
    // left-hand tap + slap (LH wins), tap + left-hand tap (T wins), golpe 'thumb' / 'finger' in a beamed picked pair;
    // m4 a P.S. run (down then up, a rest bridging), barre 2 across a rest and a grace, then ½ barre 5, then an
    // unmarked note, with let ring and P.M. overlapping. Vox (notation only): strum + golpe + p i, then P.S. and barre
    // below the staff.
    name: 'ornaments', width: 900,
    score: {
      tracks: [{
        name: 'Gt.', showTablature: true,
        measures: [
          { beats: [tabgr([[3, 2, { ornament: 'turn' }]]), tabd('8th', 3, 0, { ornament: 'turn' }), tabd('8th', 2, 0, { ornament: 'Inverted-Turn' }),
            tabd('8th', 2, 1, { ornament: ' short trill ' }), tabd('8th', 1, 0, { ornament: 'mordent' }), tabh(2, 3, { trill: true, ornament: 'turn' }),
            { type: 'rest', duration: 'quarter', notes: [{ string: 2, fret: 1, ornament: 'turn' }] }] },
          vm([tabc([[4, 4, { finger: 3 }], [3, 0, { finger: 0 }], [2, 1, { finger: '1' }]], {}, 'half'),
            tabc([[5, 2, { finger: 2 }], [4, 3, { finger: 't' }], [3, 1, { finger: 1 }]], { arpeggio: 'up' }, 'half')],
          [tabd('whole', 6, 0, { finger: 2 })]),
          { beats: [tabc([[3, 4, { rightFinger: 'p' }], [2, 3, { rightFinger: 'i', ornament: 'turn', tap: true }], [1, 3, { rightFinger: 'm' }]],
            { golpe: true, pickStroke: 'down', slurStart: true }),
          tabd('8th', 2, 3, { leftHandTap: true }, { slurEnd: true }), tabd('8th', 2, 5, { leftHandTap: true, slap: true }),
          tabh(1, 5, { leftHandTap: true, tap: true }), tabd('8th', 3, 2, {}, { golpe: 'thumb', pickStroke: 'down' }),
          tabd('8th', 1, 5, {}, { golpe: 'finger', pickStroke: 'up' })] },
          { beats: [tabd('8th', 4, 2, {}, { pickScrape: 'down', palmMute: true, letRing: true }), { type: 'rest', duration: '8th' },
            tabd('8th', 4, 2, {}, { pickScrape: 'up', barre: 2, palmMute: true, letRing: true }), { type: 'rest', duration: '8th' },
            tabgr([[3, 1]]), tabd('8th', 4, 4, {}, { barre: { fret: 2 }, letRing: true }), tabd('8th', 3, 5, {}, { barre: { fret: 5, half: true } }),
            tabd('8th', 3, 2), tabd('8th', 3, 2)] },
        ],
      }, {
        name: 'Vox',
        measures: [
          { beats: [pc([{ pitch: 'E4', rightFinger: 'p' }, { pitch: 'B4', rightFinger: 'i' }], { strum: 'down', golpe: true }),
            q('C5', { pickScrape: true, barre: 3 }), q('D5', { pickScrape: true, barre: 3 }), q('E5')] },
          { beats: [{ type: 'rest', duration: 'whole' }] },
          { beats: [{ type: 'rest', duration: 'whole' }] },
          { beats: [{ type: 'rest', duration: 'whole' }] },
        ],
      }],
    },
  },
  {
    // 1.7.0 hand marks at system breaks (600): barre 5 and P.S. runs across the m2 / m3 break (labels repeated), a
    // turn on m2's last beat, m3's first beat fingered and tied from a sharp (accidental restated), a rake next to the
    // barre run in m4.
    name: 'ornaments-break', width: 600,
    score: {
      tracks: [{
        name: 'Gt.', showTablature: true,
        measures: [
          { beats: [tabq(3, 2, { barre: 5 }), tabq(3, 2, { barre: 5 }), tabq(2, 3, { barre: 5 }), tabq(2, 3, { barre: 5, pickScrape: true })] },
          { beats: [tabe(3, 2, { barre: 5, pickScrape: true }), tabe(3, 4, { barre: 5, pickScrape: 'down' }), tabe(2, 3, { barre: 5, pickScrape: true }),
            tabe(2, 5, { barre: 5, pickScrape: true }), tabq(2, 3, { barre: 5, pickScrape: 'up' }), tabh(4, 4, { ornament: 'turn', tieStart: true }, { barre: 5, pickScrape: true })] },
          { beats: [tabh(4, 4, { finger: 2, tieEnd: true }, { barre: 5, pickScrape: true }), tabq(3, 2, { barre: 5, pickScrape: true }), tabq(3, 4), tabq(2, 3)] },
          { beats: [tabq(3, 2, { barre: 7 }), tabg(4, 0), tabg(4, 0), tabq(3, 4, { barre: 7, rake: 'down' }), tabq(2, 5, { barre: 7 }), tabq(2, 3)] },
          { beats: [tabd('whole', 3, 0, {}, { barre: { fret: 9, half: true } })] },
        ],
      }],
    },
  },
  {
    // 1.7.0 hand marks on a TAB-only track (900): p i m a / c with and without pick strokes (one beside an H arc);
    // golpe and left-hand tap with a trill and a hammer-on nearby; P.S. and barre lanes with P.M., let ring and a
    // rake; ornament and finger fields present but not drawn.
    name: 'ornaments-tab-only', width: 900,
    score: {
      tracks: [{
        name: 'TAB', showStandardNotation: false, showTablature: true,
        measures: [
          { beats: [tabc([[6, 0, { rightFinger: 'p' }], [3, 2, { rightFinger: 'i' }], [2, 3, { rightFinger: 'm' }], [1, 0, { rightFinger: 'a' }]], { pickStroke: 'down' }),
            tabh(1, 2, { rightFinger: 'c' }), tabh(1, 3, { rightFinger: 'a', hammerPull: true }, { pickStroke: 'up' }), tabh(1, 5, { rightFinger: 'i' })] },
          { beats: [tabh(2, 5, { trill: 7 }), tabh(2, 5, { leftHandTap: true }, { golpe: true }), tabh(2, 3, { hammerPull: true }), tabh(2, 5, {}, { golpe: 'finger' })] },
          { beats: [tabq(3, 2, { palmMute: true, letRing: true, pickScrape: 'up', barre: 2 }), tabq(3, 2, { palmMute: true, letRing: true, pickScrape: 'up', barre: 2 }),
            tabg(3, 2), tabq(3, 4, { barre: 2, rake: 'down', letRing: true }), tabq(3, 4, { barre: { fret: 4, half: true } })] },
          { beats: [tabh(2, 5, { ornament: 'turn', finger: 2 }), tabh(2, 7, { ornament: 'mordent', finger: 'T' }), tabd('half', 1, 0)] },
        ],
      }],
    },
  },
  {
    // 1.8.0 voice-2 marks (R1). Gt. (notation + TAB): m1 voice 2 stacks an ornament, a right-hand letter, a golpe and
    // a pick stroke, then a tap, then a wide vibrato with an inverted long fermata, under voice 1's mf; m2 two trills
    // in a row, then a left-hand tap, slap and pop under a voice-2 slur; m3 a beamed pick-stroke pair (one line), a
    // 16th tremolo and a merged half rest carrying two fermatas (voice 1's drawn); m4 a voice-2-only onset with a tap
    // and a tremolo (its own TAB column) and a vibrato. TAB (tab-only): voice 2's right-hand letters and pick strokes
    // where voice 1 has none, voice 1's winning where both have them, a golpe, trill and tap from voice 2.
    name: 'voices-marks', width: 900,
    score: {
      tracks: [{
        name: 'Gt.', showTablature: true,
        measures: [
          vm([tabd('quarter', 2, 1, {}, { dynamic: 'mf' }), tabq(2, 3), tabd('half', 1, 0)],
            [tabd('quarter', 4, 2, { ornament: 'turn', rightFinger: 'p' }, { golpe: true, pickStroke: 'down' }), tabd('quarter', 4, 3, { tap: true }),
              tabd('half', 5, 3, {}, { vibrato: 'wide', fermata: 'long' })]),
          vm([tabq(2, 1), tabq(2, 1), tabq(2, 1), tabq(2, 1)],
            [tabd('8th', 4, 0, { trill: true }), tabd('8th', 4, 2, { trill: true }), tabd('quarter', 4, 3, { leftHandTap: true }, { slurStart: true }),
              tabd('quarter', 4, 2, { slap: true }), tabd('quarter', 4, 0, { pop: true }, { slurEnd: true })]),
          vm([tabq(2, 1), tabq(2, 3), { type: 'rest', duration: 'half', fermata: true }],
            [tabd('8th', 4, 2, {}, { pickStroke: 'down' }), tabd('8th', 4, 3, {}, { pickStroke: 'up' }), tabd('quarter', 5, 3, {}, { tremolo: '16th' }),
              { type: 'rest', duration: 'half', fermata: 'short' }]),
          vm([tabd('half', 2, 1), tabd('half', 1, 0)],
            [qr(), tabd('quarter', 4, 2, { tap: true }, { tremolo: true }), tabd('half', 4, 0, {}, { vibrato: true })]),
        ],
      }, {
        name: 'TAB', showStandardNotation: false, showTablature: true,
        measures: [
          vm([tabq(2, 1), tabd('quarter', 2, 3, { rightFinger: 'i' }, { pickStroke: 'down' }), tabd('half', 1, 0)],
            [tabd('quarter', 4, 2, { rightFinger: 'p' }, { pickStroke: 'up' }), tabd('quarter', 4, 3, { rightFinger: 'm' }, { pickStroke: 'up' }), tabd('half', 5, 3)]),
          vm([tabd('half', 2, 1), tabd('half', 2, 3)],
            [tabd('quarter', 4, 0, { trill: true }), tabd('quarter', 4, 2), tabd('quarter', 4, 3, { tap: true }, { golpe: true }), tabd('quarter', 4, 0, { slap: true })]),
          { beats: [tabq(2, 1), tabq(2, 3), tabd('half', 1, 0)] },
          { beats: [tabd('whole', 2, 1)] },
        ],
      }],
    },
  },
  {
    // 1.8.0 two-voice TAB rhythm rows (R2, R3), TAB only (rhythm on) plus a notation + TAB track opting in. m1 a whole
    // note over a dotted half and a quarter; m2 beamed 8th / 16ths with stubs, a dotted 8th, voice-2 quarter, 8th and
    // half rests in row 2; m3 voice 1's beamed 32nds and 64ths (a deep row 1), voice 2's 16th / 32nd / 64th rests and
    // flags; m4 both tuplet forms in both rows; m5 / m6 a whole-measure rest per voice (centred in its row); m7 merged
    // whole-measure rests; m8 a merged quarter rest, a voice-1 half rest and a dotted voice-2 rest in the rows; m9 a
    // single-voice measure. Gt. m1: a second between the voices (clash shift), row 2 at the column x.
    name: 'voices-tab-rhythm', width: 900,
    score: {
      tracks: [{
        name: 'TAB', showStandardNotation: false, showTablature: true,
        measures: [
          vm([tabd('whole', 2, 1)], [tabd('half', 4, 2, {}, { dots: 1 }), tabq(5, 3)]),
          vm([tabe(2, 1), tabd('16th', 2, 3), tabd('16th', 2, 1), tabd('8th', 1, 0, {}, { dots: 1 }), tabd('16th', 2, 3), tabq(2, 1), tabq(1, 0)],
            [qr(), { type: 'rest', duration: '8th' }, tabe(4, 2), { type: 'rest', duration: 'half' }]),
          vm([...[0, 1, 3, 1, 0, 1, 3, 1].map((f) => tabd('32nd', 2, f)), ...[0, 1, 3, 1, 0, 1, 3, 1, 0, 1, 3, 1, 0, 1, 3, 1].map((f) => tabd('64th', 1, f)), tabd('half', 2, 1)],
            [{ type: 'rest', duration: '16th' }, tabd('16th', 4, 2), { type: 'rest', duration: '8th' },
              { type: 'rest', duration: '32nd' }, tabd('32nd', 4, 3), { type: 'rest', duration: '16th' }, tabe(4, 2),
              { type: 'rest', duration: '64th' }, tabd('64th', 4, 0), { type: 'rest', duration: '32nd' }, tabd('16th', 4, 2),
              tabe(5, 3), qr()]),
          vm([tabe(2, 1, { tuplet: 3 }), tabe(2, 3, { tuplet: 3 }), tabe(2, 1, { tuplet: 3 }), tabq(1, 0, { tuplet: 3 }), tabq(1, 1, { tuplet: 3 }), tabq(1, 0, { tuplet: 3 }), tabq(2, 1)],
            [tabe(4, 2, { tuplet: 3 }), { type: 'rest', duration: '8th', tuplet: 3 }, tabe(4, 3, { tuplet: 3 }), tabd('half', 5, 3, {}, { dots: 1 })]),
          vm([{ type: 'rest', duration: 'whole' }], [tabq(4, 2), tabq(4, 3), tabd('half', 5, 3)]),
          vm([tabq(2, 1), tabq(2, 3), tabd('half', 1, 0)], [{ type: 'rest', duration: 'whole' }]),
          vm([{ type: 'rest', duration: 'whole' }], [{ type: 'rest', duration: 'whole' }]),
          vm([qr(), tabq(2, 1), { type: 'rest', duration: 'half' }],
            [qr(), { type: 'rest', duration: 'quarter', dots: 1 }, tabe(4, 2), tabq(4, 3)]),
          { beats: [tabq(2, 1), tabq(2, 3), tabe(1, 0), tabe(1, 1), tabq(1, 3)] },
        ],
      }, {
        name: 'Gt.', showTablature: true, tabRhythm: true,
        measures: [vm([tabq(3, 2), tabq(2, 1), tabd('half', 2, 3)], [tabq(4, 5), tabq(4, 2), tabd('half', 5, 3)])],
      }],
    },
  },
  {
    // 1.8.0 TAB rhythm rows across system breaks (600): system 1's deep voice-1 band (64ths) pushes its row 2 lower
    // than system 2's; a merged quarter rest opens system 2 (drawn once, in the staff).
    name: 'voices-tab-rhythm-break', width: 600,
    score: {
      tracks: [{
        name: 'TAB', showStandardNotation: false, showTablature: true,
        measures: [
          vm([...[0, 1, 3, 1, 0, 1, 3, 1, 0, 1, 3, 1, 0, 1, 3, 1].map((f) => tabd('64th', 1, f)), tabq(2, 1), tabd('half', 2, 3)], [tabd('half', 4, 2), tabd('half', 5, 3)]),
          vm([qr(), tabq(2, 1), tabd('half', 2, 3)], [qr(), tabq(4, 2), tabd('half', 5, 3)]),
          vm([tabq(2, 1), tabq(2, 3), tabq(1, 0), tabq(1, 1)], [tabd('half', 4, 2), tabd('half', 5, 3)]),
          vm([tabq(2, 1), tabq(2, 3), tabd('half', 1, 0)], [tabd('half', 4, 2), tabq(4, 3), tabq(4, 0)]),
          vm([tabq(2, 1), tabq(2, 3), tabd('half', 1, 0)], [tabd('half', 4, 2), tabd('half', 5, 3)]),
        ],
      }],
    },
  },
  {
    // 1.8.0 tied-to frets "(n)" on TAB (R6), opted in with ' Parens ' on Gt.; TAB is the control (no option). m1 a tie
    // per voice, voice 2's on fret 12; m2 ghost, mute and release tied-to notes; m3 a tied chord, a slide from a tied
    // note; m4-m5 ties across the barline in both voices, and a voice-2 tied-to note dropped from TAB by voice 1's string.
    name: 'voices-tied-frets', width: 900,
    score: {
      tracks: ['Gt.', 'TAB'].map((name) => ({
        name, showTablature: true, ...(name === 'Gt.' ? { tiedFrets: ' Parens ' } : { showStandardNotation: false, tabRhythm: false }),
        measures: [
          vm([tabd('half', 2, 5, { tieStart: true }), tabd('half', 2, 5, { tieEnd: true })],
            [tabd('half', 4, 12, { tieStart: true }), tabd('half', 4, 12, { tieEnd: true })]),
          vm([tabd('quarter', 1, 3, { ghost: true, tieStart: true }), tabd('quarter', 1, 3, { ghost: true, tieEnd: true }),
            tabd('quarter', 2, 5, { tieStart: true }), tabd('quarter', 2, 5, { mute: true, tieEnd: true })],
          [tabd('half', 4, 7, { tieStart: true }), tabd('half', 4, 7, { bend: 'release', tieEnd: true })]),
          vm([{ type: 'note', duration: 'half', notes: [{ string: 2, fret: 5, tieStart: true }, { string: 3, fret: 5, tieStart: true }] },
            { type: 'note', duration: 'quarter', notes: [{ string: 2, fret: 5, tieEnd: true, slide: true }, { string: 3, fret: 5, tieEnd: true }] }, tabq(2, 7)],
          [tabd('half', 5, 3, { tieStart: true }), tabd('half', 5, 3, { tieEnd: true })]),
          vm([tabd('half', 2, 3), tabd('half', 2, 10, { tieStart: true })], [tabd('whole', 5, 2, { tieStart: true })]),
          vm([tabd('half', 2, 10, { tieEnd: true }), tabd('half', 2, 3)],
            [tabd('quarter', 5, 2, { tieEnd: true }), tabq(5, 2), tabd('half', 2, 3, { tieEnd: true })]),
        ],
      })),
    },
  },
  {
    // 1.9.0 bends, whammy, slides, feedback, trill ties on notation + TAB. m1-m3 compound bends: bend-release-bend,
    // pre-bend-release-bend, the object form and a 'Pb … Release …' spelling, a release note after one (defaults to the
    // rebend), a narrow one with staggered labels (every note of these measures on string 2: no fret on the string above
    // a release fall); m4-m5 scoops alone, with a dip, with a pre-dive (pre-dive wins), on a rest and a grace (nothing),
    // and one ending a held dive (its return ignored); m6 w/bar with let ring and P.S., a rest bridging; m7-m8 legato
    // slides up / down, with a hammer-on, into a grace; m9 feedback alone and with pinch; m10 a trill over a 3-note tie
    // chain with T and pick on a tied beat; m11 a chain stopped by a trilled tie; m12 a voice-2 tied trill.
    name: 'bends-slides', width: 900,
    score: {
      tracks: [{
        name: 'Gt.', showTablature: true,
        measures: [
          { beats: [tabd('half', 2, 8, { bend: 'full release full' }), tabd('half', 2, 8, { bend: 'pb 1/2 release 1/2' })] },
          { beats: [tabd('whole', 2, 8, { bend: { amount: '1/2', rebend: 'full' } })] },
          { beats: [tabd('quarter', 2, 8, { bend: 'release' }), tabd('quarter', 2, 7, { bend: 'Pb Full Release 1 1/2' }), tabd('8th', 2, 9, { bend: 'full release full' }),
            tabd('8th', 2, 9), tabd('quarter', 2, 7)] },
          { beats: [tabd('quarter', 3, 5, {}, { whammyScoop: true }), tabd('quarter', 3, 7, {}, { whammyScoop: true, whammy: true }),
            tabd('quarter', 3, 5, {}, { whammyScoop: true, whammy: { type: 'predive', amount: '1/2' } }), { type: 'rest', duration: 'quarter', whammyScoop: true }] },
          { beats: [tabd('quarter', 3, 5, {}, { whammy: { type: 'dive', amount: 'full' } }), tabd('quarter', 3, 7),
            { type: 'grace', duration: '16th', whammyScoop: true, notes: [{ string: 3, fret: 9 }] },
            tabd('quarter', 3, 7, {}, { whammyScoop: true, whammy: { type: 'return' } }), tabd('quarter', 3, 5)] },
          { beats: [tabd('quarter', 2, 5, {}, { letRing: true, whammyBar: true, pickScrape: 'down' }), { type: 'rest', duration: 'quarter' },
            tabd('quarter', 2, 7, {}, { letRing: true, whammyBar: true, pickScrape: 'down' }), tabd('quarter', 2, 8, {}, { whammyBar: true })] },
          { beats: [tabd('quarter', 3, 5, { slide: 'legato' }), tabd('quarter', 3, 7, { slide: ' Legato ' }), tabd('quarter', 3, 5, { slide: 'legato', hammerPull: true }), tabd('quarter', 3, 7)] },
          { beats: [tabd('quarter', 3, 7, { slide: 'legato' }), { type: 'grace', duration: '16th', notes: [{ string: 3, fret: 9 }] }, tabd('quarter', 3, 7),
            tabd('half', 3, 5)] },
          { beats: [tabd('quarter', 2, 5, { harmonic: 'feedback' }), tabd('quarter', 2, 5, { harmonic: 'Feedback' }),
            tabc([[2, 5, { harmonic: 'feedback' }], [3, 5, PH]]), tabd('quarter', 2, 7)] },
          { beats: [tabd('quarter', 3, 5, { trill: 7, tieStart: true }), tabd('quarter', 3, 5, { tieStart: true, tieEnd: true, tap: true }, { pickStroke: 'down' }),
            tabd('quarter', 3, 5, { tieEnd: true }), tabd('quarter', 3, 7)] },
          { beats: [tabd('quarter', 3, 5, { trill: true, tieStart: true }), tabd('quarter', 3, 5, { tieEnd: true, trill: true }), tabd('half', 3, 7)] },
          vm([tabq(1, 5), tabq(1, 5), tabq(1, 5), tabq(1, 5)],
            [tabd('quarter', 4, 2, { trill: true, tieStart: true }), tabd('quarter', 4, 2, { tieEnd: true }, { pickStroke: 'up' }), { type: 'rest', duration: 'half' }]),
        ],
      }],
    },
  },
  {
    // 1.9.0 across system breaks at 600: a notation + TAB trill tied over three systems (two breaks), then on the next
    // system's last beat a compound bend and a legato slide into the following system, w/bar running over that break and
    // a scoop on its first note; a voice-2 trill tied across one break (two-voice measures on both sides).
    name: 'bends-slides-break', width: 600,
    score: {
      tracks: [{
        name: 'Gt.', showTablature: true,
        measures: [
          { beats: [tabd('half', 2, 5), tabd('half', 3, 5, { trill: true, tieStart: true })] },
          ...[0, 1, 2, 3, 4, 5, 6, 7, 8].map(() => ({ beats: [tabd('whole', 3, 5, { tieStart: true, tieEnd: true })] })),
          { beats: [tabd('half', 3, 5, { tieEnd: true }), tabd('half', 3, 9, {}, { whammyBar: true })] },
          { beats: [tabd('half', 3, 9), tabd('half', 3, 7)] },
          { beats: [tabd('half', 3, 9, {}, { whammyBar: true }), tabc([[2, 8, { bend: 'full release full' }], [3, 7, { slide: 'legato' }]], { whammyBar: true }, 'half')] },
          { beats: [tabd('half', 3, 9, {}, { whammyScoop: true, whammyBar: true }), tabd('half', 3, 7)] },
          vm([tabd('whole', 1, 5)], [tabd('whole', 4, 2, { trill: true, tieStart: true })]),
          ...[0, 1, 2].map(() => vm([tabd('whole', 1, 5)], [tabd('whole', 4, 2, { tieStart: true, tieEnd: true })])),
          vm([tabd('half', 1, 5), tabd('half', 1, 5)], [tabd('half', 4, 2, { tieEnd: true }), tabd('half', 4, 4)]),
        ],
      }],
    },
  },
  {
    // 1.9.0 on a tab-only track: a trill tied over pitchless string + fret notes, compound bends, a scoop, w/bar, a legato
    // slide's arc and feedback harmonics.
    name: 'bends-slides-tab-only', width: 900,
    score: {
      tracks: [{
        name: 'TAB', showStandardNotation: false, showTablature: true,
        measures: [
          { beats: [tabd('quarter', 3, 5, { trill: true, tieStart: true }), tabd('quarter', 3, 5, { tieStart: true, tieEnd: true }, { pickStroke: 'down' }),
            tabd('quarter', 3, 5, { tieEnd: true }), tabd('quarter', 3, 7)] },
          { beats: [tabd('half', 2, 8, { bend: 'full release 1/2' }), tabd('half', 2, 8)] },
          { beats: [tabd('quarter', 3, 5, {}, { whammyScoop: true, whammyBar: true }), tabd('quarter', 3, 7, { slide: 'legato' }, { whammyBar: true }),
            tabd('quarter', 3, 9, {}, { whammyBar: true }), tabd('quarter', 3, 7)] },
          { beats: [tabd('quarter', 2, 5, { harmonic: 'feedback' }), tabd('quarter', 2, 5, { harmonic: 'feedback' }), tabd('half', 2, 7)] },
          { beats: [tabd('whole', 2, 8, { bend: 'pb full release full' })] },
        ],
      }],
    },
  },
  {
    // 1.10.0 expression on notation + TAB (tempoText + a tempo change at the first onset): m1 a cresc from p to f;
    // m2 a dim split by a mid-run mf; m3 fade in / out / swell, a wah on a fade beat, a fermata over a fade and a wah;
    // m4 8va with a fermata, its last beat tied into a beat past the run (inherits the bracket); m5 15mb; m6 a tempo
    // change with text and a dot; m7 two voices: voice 1's mp wins the first onset, voice 2's ff is drawn.
    name: 'expression', width: 900,
    score: {
      tempoText: 'Moderato',
      tracks: [{
        name: 'Gt.', showTablature: true,
        measures: [
          { beats: [tabq(1, 0, { tempo: 96, dynamic: 'p', hairpin: 'cresc' }), tabq(1, 2, { hairpin: 'cresc' }), tabq(1, 3, { hairpin: '<' }), tabq(1, 5, { dynamic: 'f' })] },
          { beats: [tabq(2, 5, { hairpin: 'dim' }), tabq(2, 3, { hairpin: 'dim', dynamic: 'mf' }), tabq(2, 1, { hairpin: 'decresc' }), tabq(2, 0)] },
          { beats: [tabq(3, 2, { fade: 'in' }), tabq(3, 4, { fade: 'out', wah: 'open' }), tabq(3, 5, { fade: 'swell' }), tabq(3, 7, { fade: 'in', wah: '+', fermata: true })] },
          { beats: [tabq(1, 15, { ottava: '8va' }), tabq(1, 17, { ottava: '8va', fermata: true }), tabd('quarter', 1, 17, { tieStart: true }, { ottava: '8va' }),
            tabd('quarter', 1, 17, { tieEnd: true })] },
          { beats: [tabq(6, 0, { ottava: '15mb' }), tabq(6, 3, { ottava: '15mb' }), tabq(5, 0), tabq(5, 2)] },
          { beats: [tabq(3, 2), tabq(3, 4), tabq(3, 5, { tempo: { bpm: 72, dots: 1, text: 'Slower' } }), tabq(3, 7)] },
          vm([tabq(1, 0, { dynamic: 'mp' }), tabq(1, 1), tabd('half', 1, 3)], [tabd('half', 4, 2, {}, { dynamic: 'pp' }), tabd('half', 4, 4, {}, { dynamic: 'ff' })]),
        ],
      }],
    },
  },
  {
    // 1.10.0 across a system break at 600: a cresc and an 8va running over the break (continuation "(8)", 0.3 sp
    // opening), then a tempo change on a later system.
    name: 'expression-break', width: 600,
    score: {
      tracks: [{
        name: 'Gt.', showTablature: true,
        measures: [
          { beats: [tabq(1, 0), tabq(1, 2), tabq(1, 3, { hairpin: 'cresc', dynamic: 'pp' }), tabq(1, 5, { hairpin: 'cresc' })] },
          ...[0, 1].map(() => ({ beats: [tabq(1, 12, { hairpin: 'cresc', ottava: '8va' }), tabq(1, 14, { hairpin: 'cresc', ottava: '8va' }),
            tabq(1, 15, { hairpin: 'cresc', ottava: '8va' }), tabq(1, 17, { hairpin: 'cresc', ottava: '8va' })] })),
          { beats: [tabq(1, 15, { ottava: '8va' }), tabq(1, 14, { ottava: '8va' }), tabq(1, 12), tabq(1, 10)] },
          { beats: [tabq(2, 5), tabq(2, 3), tabq(2, 1), tabq(2, 0)] },
          { beats: [tabq(3, 2, { tempo: { bpm: 140, unit: 'half' } }), tabq(3, 4), tabd('half', 3, 5)] },
        ],
      }],
    },
  },
  {
    // 1.10.0 on a tab-only track: fade, wah and a tempo change above the TAB staff; a hairpin and an 8va are present
    // but not drawn (notation-only marks).
    name: 'expression-tab-only', width: 900,
    score: {
      tracks: [{
        name: 'TAB', showStandardNotation: false, showTablature: true,
        measures: [
          { beats: [tabq(3, 2, { fade: 'in', tempo: 110 }), tabq(3, 4, { wah: 'open' }), tabq(3, 5, { fade: 'swell', wah: 'closed' }), tabq(3, 7, { hairpin: 'cresc' })] },
          { beats: [tabq(1, 15, { ottava: '8va', hairpin: 'dim' }), tabq(1, 17, { ottava: '8va', hairpin: 'dim' }), tabd('half', 1, 12, {}, { tempo: { bpm: 90, unit: '8th', text: 'Swing' } })] },
        ],
      }],
    },
  },
  {
    // 1.11.0 clefs: an alto viola (key A, two voices, an 8va note); m3 tenor + 2 flats + 3/4 on every track (clef,
    // key, time); m4 'tenor' again (no change); m5 'BASS ' after a repeat-start; m7 alto after a repeat-end; a
    // guitar written an octave up (auto 8vb) with measure clefs treble15ma (explicit wins), alto (cClef8vb), opening
    // system 2 (courtesy clef at the end of system 1), and treble again; a notation + TAB bass in bass8va, tenor in m7.
    name: 'clefs', width: 900,
    score: {
      tracks: [
        {
          name: 'Viola', label: 'Va.', clef: 'alto',
          measures: [
            { keySignature: 3, beats: [q('C4'), q('E4'), q('G4'), q('A5', { ottava: '8va' })] },
            vm([q('A4'), q('B4'), pc(['C#5'], {}, 'half')], [pc(['F#3'], {}, 'half'), pc(['A3'], {}, 'half')]),
            { clef: 'tenor', keySignature: -2, timeSignature: T34, beats: [q('D4'), q('F4'), q('Bb3')] },
            { clef: 'tenor', beats: [q('C4'), q('Eb4'), q('G4')] },
            { clef: 'BASS ', barline: 'repeatStart', beats: [q('G2'), q('Bb2'), q('D3')] },
            { barline: 'repeatEnd', beats: [q('F3'), q('E3'), q('D3')] },
            { clef: 'alto', beats: [q('C4'), q('D4'), q('E4')] },
            { beats: [pc(['F4'], {}, 'half'), q('G4')] },
          ],
        },
        {
          name: 'Guitar', label: 'Gtr.', writtenOctaveUp: true,
          measures: [
            { keySignature: 3, beats: [q('E3'), q('A3'), q('C#4'), q('E4')] },
            { clef: 'treble15ma', beats: [q('E3'), q('A3'), q('C#4'), q('E4')] },
            { keySignature: -2, timeSignature: T34, beats: [q('D3'), q('F3'), q('Bb3')] },
            { clef: 'alto', beats: [q('C3'), q('Eb3'), q('G3')] },
            { beats: [q('G2'), q('Bb2'), q('D3')] },
            { beats: [q('F3'), q('E3'), q('D3')] },
            { clef: 'treble', beats: [q('C4'), q('D4'), q('E4')] },
            { beats: [pc(['F4'], {}, 'half'), q('G4')] },
          ],
        },
        {
          name: 'Bass', label: 'Bs.', clef: 'bass8va', showTablature: true, tuning: ['E1', 'A1', 'D2', 'G2'],
          measures: [
            { keySignature: 3, beats: [tabq(4, 0), tabq(3, 0), tabq(2, 2), tabq(1, 2)] },
            { beats: [tabd('half', 3, 0), tabd('half', 2, 2)] },
            { keySignature: -2, timeSignature: T34, beats: [tabq(3, 5), tabq(2, 3), tabq(1, 1)] },
            { beats: [tabq(3, 3), tabq(2, 1), tabq(1, 0)] },
            { beats: [tabq(4, 3), tabq(3, 1), tabq(2, 0)] },
            { beats: [tabq(3, 8), tabq(3, 7), tabq(2, 0)] },
            { clef: 'tenor', beats: [tabq(2, 5), tabq(2, 7), tabq(1, 4)] },
            { beats: [tabd('half', 1, 5), tabq(1, 7)] },
          ],
        },
      ],
    },
  },
  {
    // 1.11.0 multi-measure rests (multiMeasureRests: true): a notation + TAB guitar with TAB rhythm, a tab-only bass
    // (empty rest measures) and a notation + TAB track without TAB rhythm (blank TAB). Runs: m2-5 (segno on m2),
    // m6-7 (key change on m6), m8-9 (repeat-start .. repeat-end), m11-12 (D.S. on m12), m19-20; not collapsed: the
    // lone rest m14, the ending m16, the guitar's fermata rest m18.
    name: 'multirest', width: 900,
    score: {
      multiMeasureRests: true,
      tracks: [
        { name: 'Guitar', label: 'Gtr.', showTablature: true, tabRhythm: true, measures: MR.map((m, i) => mrMeasure(m, i, 'gtr')) },
        { name: 'Bass', label: 'Bs.', showStandardNotation: false, showTablature: true, tuning: ['E1', 'A1', 'D2', 'G2'], measures: MR.map((m, i) => mrMeasure(m, i, 'bass')) },
        { name: 'Keys', label: 'Ks.', showTablature: true, tabRhythm: false, measures: MR.map((m, i) => mrMeasure(m, i, 'keys')) },
      ],
    },
  },
  {
    // 1.11.0 rhythm slashes on notation + TAB (TAB rhythm on): quarters with a chord symbol, an accent and a pick
    // stroke, beamed 8ths, half, dotted quarter, whole, an 8th triplet, 16ths; a slash with pitches (dropped); slash
    // on a rest and on a grace (ignored); a two-voice measure: voice-1 slashes over voice-2 notes, one voice-2 beat
    // with slash (ignored); a tab-only track with slashes in its rhythm band.
    name: 'slashes', width: 900,
    score: {
      tracks: [
        {
          name: 'Guitar', label: 'Gtr.', showTablature: true, tabRhythm: true,
          measures: [
            { beats: [sl('quarter', { chord: 'Am' }), sl('quarter', { articulations: ['accent'] }), sl('8th'), sl('8th'), sl('8th', { pickStroke: 'down' }), sl('8th')] },
            { beats: [sl('half', { chord: 'F' }), sl('quarter', { dots: 1 }), sl('8th')] },
            { beats: [sl('whole', { chord: 'C' })] },
            { beats: [sl('8th', { tuplet: 3 }), sl('8th', { tuplet: 3 }), sl('8th', { tuplet: 3 }), sl('quarter', { notes: [n('C6')] }),
              { type: 'rest', duration: 'quarter', slash: true }, { type: 'grace', duration: '16th', slash: true, notes: [{ pitch: 'E4', string: 2, fret: 5 }] },
              sl('16th'), sl('16th'), sl('8th')] },
            vm([sl('quarter'), sl('quarter'), sl('half')],
              [pc([{ pitch: 'E4', string: 2, fret: 5 }], {}, 'half'), pc([{ pitch: 'D4', string: 2, fret: 3 }], { slash: true }), pc([{ pitch: 'C4', string: 2, fret: 1 }])]),
          ],
        },
        {
          name: 'Rhythm', label: 'Rhy.', showStandardNotation: false, showTablature: true,
          measures: [
            { beats: [sl('quarter'), sl('quarter'), sl('8th'), sl('8th'), sl('quarter')] },
            { beats: [sl('half'), sl('half')] },
            { beats: [sl('whole')] },
            { beats: [sl('quarter'), sl('quarter'), sl('quarter'), sl('quarter')] },
            { beats: [sl('whole')] },
          ],
        },
      ],
    },
  },
  {
    // 1.11.0 articulations and fermatas on a tab-only TAB staff (tabArticulations: true): a staccato + tenuto + accent
    // stack, marcato, marks over a string-1 tremolo / vibrato, P.M. and let-ring runs, a pick stroke, a bend, a tap,
    // fermatas (normal / short / long) on notes and a rest, beat text, a chord symbol, a two-voice measure (voice 1
    // wins; voice-2-only marks in its place). Controls: the same on a tab-only track without the flag and on a
    // notation + TAB track with it (ignored).
    name: 'tab-articulations', width: 900,
    score: {
      tracks: [
        { name: 'TAB', showStandardNotation: false, showTablature: true, showChordDiagrams: false, tabArticulations: true, measures: TA },
        { name: 'No flag', showStandardNotation: false, showTablature: true, showChordDiagrams: false, measures: TA },
        { name: 'Notation', showTablature: true, showChordDiagrams: false, tabArticulations: true, measures: TA },
      ],
    },
  },
];

// Copy of a score with tabRhythm: false on every track (source untouched). Today the field is ignored, so
// these guard entries must stay byte-identical to the entries they copy, before and after the feature.
export function rhythmOff(score) {
  return { ...score, tracks: score.tracks.map((t) => ({ ...t, tabRhythm: false })) };
}
const rhythmOffCase = (name) => {
  const base = characterizationCases.find((c) => c.name === name);
  return { name: `${name}-rhythm-off`, width: base.width, score: rhythmOff(base.score), ...(base.options ? { options: base.options } : {}) };
};
{
  const ra = characterizationCases.find((c) => c.name === 'release-adjacent');
  characterizationCases.push({ name: 'release-adjacent', width: 600, score: ra.score });
}
characterizationCases.push(...['tab-only', 'harmonics', 'tab-marks', 'directions'].map(rhythmOffCase));

// ---------- 1.12.0 fixtures (appended so the earlier cases keep their order) ----------
{
  // 1.12.0 nested tuplets (beat.tuplets, outer first) on notation + TAB with TAB rhythm: m1 a quarter triplet
  // holding an 8th triplet; m2 5:4 eighths holding a triplet; m3 two voices, voice 2 nested (mirrored below);
  // m4 tuplets: [3] overrides tuplet: 5; m5 invalid tuplets ([3,3,3], [{count:1}], ['3']) fall back to tuplet;
  // m6 a fermata and an H/P slur over a nested group.
  const t = (d, string, fret, extra = {}, note = {}) => ({ type: 'note', duration: d, notes: [{ string, fret, ...note }], ...extra });
  const N = { tuplets: [3, 3] }; const T3 = { tuplet: 3 }; const O54 = { count: 5, of: 4 };
  characterizationCases.push({
    name: 'tuplets-nested', width: 900,
    score: {
      tracks: [{
        name: 'Gtr', showStandardNotation: true, showTablature: true, tabRhythm: true,
        measures: [
          { beats: [t('quarter', 2, 0, T3), t('8th', 2, 1, N), t('8th', 2, 3, N), t('8th', 1, 0, N), t('quarter', 1, 2, T3), t('half', 3, 2)] },
          { beats: [t('8th', 3, 0, { tuplets: [O54] }), t('8th', 3, 2, { tuplets: [O54] }), t('8th', 2, 0, { tuplets: [O54, 3] }),
            t('8th', 2, 1, { tuplets: [O54, 3] }), t('8th', 2, 3, { tuplets: [O54, 3] }), t('8th', 1, 0, { tuplets: [O54] }), t('half', 3, 2)] },
          vm([t('quarter', 1, 0, T3), t('quarter', 1, 1, T3), t('quarter', 1, 3, T3), t('half', 2, 3)],
            [t('quarter', 5, 3, T3), t('8th', 4, 0, N), t('8th', 4, 2, N), t('8th', 4, 3, N), t('quarter', 5, 2, T3), t('half', 5, 0)]),
          { beats: [t('8th', 3, 0, { tuplets: [3], tuplet: 5 }), t('8th', 3, 2, { tuplets: [3], tuplet: 5 }), t('8th', 3, 4, { tuplets: [3], tuplet: 5 }),
            t('quarter', 2, 0), t('half', 2, 1)] },
          { beats: [t('8th', 3, 0, { tuplets: [3, 3, 3], tuplet: 3 }), t('8th', 3, 2, { tuplets: [{ count: 1 }], tuplet: 3 }), t('8th', 3, 4, { tuplets: ['3'], tuplet: 3 }),
            t('quarter', 2, 0), t('half', 2, 1)] },
          { beats: [t('quarter', 1, 3, T3), t('8th', 1, 5, { ...N, fermata: true }, { hammerPull: true }), t('8th', 1, 7, N, { hammerPull: true }), t('8th', 1, 8, N),
            t('quarter', 1, 7, { ...T3, fermata: true }), t('half', 2, 5)] },
        ],
      }],
    },
  });
}
{
  // 1.12.0 on-beat grace notes (grace.onBeat === true: no slash, same place and no time) on notation + TAB:
  // m1 a single on-beat grace, then a before-beat one for comparison; m2 a mixed run (before-beat then on-beat);
  // m3 an on-beat grace with an accidental and one into a chord; m4 two voices with a voice-2 on-beat grace;
  // m5 onBeat: 'yes' (not true -> before-beat, slashed).
  const gr = (frets, extra = {}) => ({ type: 'grace', duration: '16th', notes: frets.map(([string, fret]) => ({ string, fret })), ...extra });
  const ob = { onBeat: true };
  const t = (d, frets, extra = {}) => ({ type: 'note', duration: d, notes: frets.map(([string, fret]) => ({ string, fret })), ...extra });
  characterizationCases.push({
    name: 'graces-onbeat', width: 900,
    score: {
      tracks: [{
        name: 'Gtr', showStandardNotation: true, showTablature: true,
        measures: [
          { beats: [gr([[2, 3]], ob), t('quarter', [[2, 5]]), t('quarter', [[2, 3]]), gr([[2, 3]]), t('quarter', [[2, 5]]), t('quarter', [[1, 0]])] },
          { beats: [t('quarter', [[3, 2]]), gr([[3, 0]]), gr([[3, 2]], ob), t('quarter', [[3, 4]]), t('half', [[2, 3]])] },
          { beats: [gr([[1, 2]], ob), t('quarter', [[1, 3]]), t('quarter', [[2, 1]]), gr([[3, 0]], ob), t('half', [[4, 2], [3, 2], [2, 3]])] },
          vm([t('quarter', [[1, 0]]), t('quarter', [[1, 2]]), t('half', [[1, 3]])],
            [t('quarter', [[5, 3]]), gr([[4, 0]], ob), t('quarter', [[4, 2]]), t('half', [[5, 2]])]),
          { beats: [gr([[2, 3]], { onBeat: 'yes' }), t('quarter', [[2, 5]]), gr([[2, 3]], ob), t('quarter', [[2, 5]]), t('half', [[3, 2]])] },
        ],
      }],
    },
  });
}
