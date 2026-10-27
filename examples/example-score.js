/**
 * example-score.js — a short two-track demo score (D major, 4/4) that
 * exercises: standard notation + tab, chords, ties, a slur, dynamics,
 * accidentals, auto-beamed 8th/16th groups, hammer-on/pull-off/slide tab
 * articulations, and a second staff (bass clef, no tab) to show
 * multi-track stacking.
 */
export const exampleScore = {
  title: 'Demo Riff in D',
  composer: 'music-score example',
  tracks: [
    {
      name: 'Guitar',
      instrument: 'acoustic-guitar',
      clef: 'treble',
      showStandardNotation: true,
      showTablature: true,
      tuning: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'],
      timeSignature: { beats: 4, beatType: 4 },
      keySignature: 2, // D major (F#, C#)
      measures: [
        {
          beats: [
            { type: 'note', duration: 'quarter', dynamic: 'mf', palmMute: true, notes: [{ string: 2, fret: 3 }] },
            { type: 'note', duration: '8th', palmMute: true, notes: [{ string: 1, fret: 2 }] },
            { type: 'note', duration: '8th', palmMute: true, notes: [{ string: 1, fret: 3 }] },
            {
              type: 'note',
              duration: 'half',
              notes: [
                { string: 3, fret: 2 },
                { string: 2, fret: 3, tieStart: true },
                { string: 1, fret: 2 },
              ],
            },
          ],
        },
        {
          beats: [
            { type: 'note', duration: 'quarter', notes: [{ string: 2, fret: 3, tieEnd: true }] },
            { type: 'note', duration: '8th', slurStart: true, notes: [{ string: 1, fret: 5, hammerPull: true }] },
            { type: 'note', duration: '8th', notes: [{ string: 1, fret: 7 }] },
            { type: 'note', duration: '8th', notes: [{ string: 1, fret: 9 }] },
            { type: 'note', duration: '8th', slurEnd: true, notes: [{ string: 1, fret: 10, hammerPull: true }] },
            { type: 'note', duration: '8th', vibrato: true, notes: [{ string: 1, fret: 7 }] },
            {
              type: 'note',
              duration: '8th',
              notes: [
                { string: 3, fret: 0, mute: true },
                { string: 2, fret: 0, mute: true },
                { string: 1, fret: 0, mute: true },
              ],
            },
          ],
        },
        {
          beats: [
            { type: 'note', duration: '16th', dynamic: 'f', notes: [{ string: 1, fret: 0, hammerPull: true }] },
            { type: 'note', duration: '16th', notes: [{ string: 1, fret: 2 }] },
            { type: 'note', duration: '16th', notes: [{ string: 1, fret: 3, slide: true }] },
            { type: 'note', duration: '16th', notes: [{ string: 1, fret: 5 }] },
            { type: 'note', duration: '16th', notes: [{ string: 1, fret: 7, bend: 'full' }] },
            { type: 'note', duration: '16th', notes: [{ string: 1, fret: 8, accidental: 'natural' }] },
            { type: 'note', duration: '16th', notes: [{ string: 1, fret: 9, ghost: true }] },
            { type: 'note', duration: '16th', notes: [{ string: 1, fret: 10, bend: '1/2 release' }] },
            { type: 'note', duration: 'quarter', notes: [{ string: 1, fret: 12, bend: 'full release' }] },
            { type: 'rest', duration: 'quarter' },
          ],
        },
        {
          beats: [
            { type: 'note', duration: 'quarter', notes: [{ string: 1, fret: 10, bend: 'full hold' }] },
            { type: 'note', duration: 'quarter', notes: [{ string: 1, fret: 10, bend: 'full' }] },
            { type: 'note', duration: 'quarter', tremolo: true, notes: [{ string: 1, fret: 7 }] },
            { type: 'rest', duration: 'quarter' },
          ],
        },
        {
          barline: 'final',
          beats: [
            {
              type: 'note',
              duration: 'whole',
              dynamic: 'p',
              tremolo: true,
              notes: [
                { string: 3, fret: 2 },
                { string: 2, fret: 3 },
                { string: 1, fret: 2 },
              ],
            },
          ],
        },
      ],
    },
    {
      name: 'Bass',
      instrument: 'bass',
      clef: 'bass',
      writtenOctaveUp: true, // bass is written an octave above sounding pitch (8vb bass clef)
      showStandardNotation: true,
      showTablature: false,
      timeSignature: { beats: 4, beatType: 4 },
      keySignature: 2,
      measures: [
        { beats: [{ type: 'note', duration: 'whole', notes: [{ pitch: 'D2' }] }] },
        { beats: [{ type: 'note', duration: 'whole', notes: [{ pitch: 'D2' }] }] },
        { beats: [{ type: 'note', duration: 'whole', notes: [{ pitch: 'A1' }] }] },
        { beats: [{ type: 'note', duration: 'whole', notes: [{ pitch: 'A1' }] }] },
        { barline: 'final', beats: [{ type: 'note', duration: 'whole', notes: [{ pitch: 'D2' }] }] },
      ],
    },
  ],
};
