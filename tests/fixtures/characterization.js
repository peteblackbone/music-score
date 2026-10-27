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
const AH19 = { harmonic: 'artificial', harmonicFret: 19 };
const PH = { harmonic: 'pinch' };
const PM = { palmMute: true };
const tabe = (string, fret, extra = {}) => ({ type: 'note', duration: '8th', notes: [{ string, fret }], ...extra });
const tabg = (string, fret, extra = {}) => ({ type: 'grace', duration: '16th', notes: [{ string, fret, mute: true }], ...extra });
const tabc = (frets, extra = {}, duration = 'quarter') => ({ type: 'note', duration, notes: frets.map(([string, fret, note = {}]) => ({ string, fret, ...note })), ...extra });
const pc = (pitches, extra = {}, duration = 'quarter') => ({ type: 'note', duration, notes: pitches.map((p) => (typeof p === 'string' ? n(p) : p)), ...extra });
const C_CHORD = [[5, 3], [4, 2], [3, 0], [2, 1]];
const E_TOP = [[3, 1], [2, 0], [1, 0]];
const ras = (k) => tabc(E_TOP, { strum: k % 2 ? 'up' : 'down' }, '16th');

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
characterizationCases.push(...['tab-only', 'harmonics', 'tab-marks', 'directions'].map(rhythmOffCase));
