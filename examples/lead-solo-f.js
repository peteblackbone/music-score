/**
 * lead-solo-f.js — an original 12-measure lead-guitar solo in F major,
 * written for this project (not a transcription of any recording or tab).
 * Standard tuning, ♩ = 120, a single notation + TAB "E.Gt." track.
 *
 * Progression: (pickup) | F | F | G | Bb | F C/E | Dm | Bb | Gm C | F | (F) | (end)
 *
 * It stays around the 8th-15th position. Each measure shows a few of the
 * features: a 16th-note pickup run, 32nd- and 8th-note triplets, a
 * hammer-on and pull-off, dotted rhythms, grace-note slides up and down,
 * ties across a beat and across a barline, 3rds and 6ths as dyads, "full"
 * and "full release" bends, a chromatic neighbour note, vibrato, and a
 * final measure rest.
 *
 * Pitches worked out from string and fret are spelled with sharps, so the
 * B-flat notes also give their `pitch` (as sounding pitch, which is why the
 * track sets `writtenOctaveUp: true`).
 */
export const leadSoloF = {
  title: 'Lead Solo in F',
  tuningLabel: 'Standard tuning',
  tempoText: '♩ = 120',
  tracks: [
    {
      name: 'Lead Guitar',
      label: 'E.Gt.',
      clef: 'treble',
      showStandardNotation: true,
      showTablature: true,
      writtenOctaveUp: true,
      tuning: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'],
      timeSignature: { beats: 4, beatType: 4 },
      keySignature: -1,
      measures: [
        { // 1 — pickup: half rest, then a low 16th-note run up from F, a turn on D, ending on E
          beats: [
            { type: 'rest', duration: 'half' },
            { type: 'note', duration: '16th', dynamic: 'mf', notes: [{ string: 5, fret: 8 }] },
            { type: 'note', duration: '16th', notes: [{ string: 5, fret: 10 }] },
            { type: 'note', duration: '16th', notes: [{ string: 5, fret: 12 }] },
            { type: 'note', duration: '16th', notes: [{ string: 4, fret: 10 }] },

            { type: 'note', duration: '16th', notes: [{ string: 4, fret: 12 }] },
            { type: 'note', duration: '16th', notes: [{ string: 4, fret: 10 }] },
            { type: 'note', duration: '16th', notes: [{ string: 4, fret: 12 }] },
            { type: 'note', duration: '16th', notes: [{ string: 3, fret: 9 }] },
          ],
        },
        { // 2 — F. A quick 32nd-note triplet with hammer-on and pull-off, a dotted 8th.
          beats: [
            { type: 'note', duration: '8th', chord: 'F', notes: [{ string: 3, fret: 10 }] },
            { type: 'note', duration: '16th', notes: [{ string: 3, fret: 12 }] },
            { type: 'note', duration: '32nd', tuplet: 3, notes: [{ string: 2, fret: 10, hammerPull: true }] },
            { type: 'note', duration: '32nd', tuplet: 3, notes: [{ string: 2, fret: 11, pitch: 'Bb4', hammerPull: true }] },
            { type: 'note', duration: '32nd', tuplet: 3, notes: [{ string: 2, fret: 10 }] },

            { type: 'note', duration: '8th', dots: 1, notes: [{ string: 3, fret: 12 }] },
            { type: 'note', duration: '16th', notes: [{ string: 3, fret: 10 }] },

            { type: 'note', duration: 'quarter', notes: [{ string: 2, fret: 13 }] },

            { type: 'note', duration: '8th', notes: [{ string: 2, fret: 10 }] },
            { type: 'note', duration: '8th', notes: [{ string: 1, fret: 8 }] },
          ],
        },
        { // 3 — F. Grace-note slide up into A, a D tied across the beat, a "full" bend on G.
          beats: [
            { type: 'grace', notes: [{ string: 2, fret: 8, slide: true }] },
            { type: 'note', duration: 'quarter', chord: 'F', notes: [{ string: 2, fret: 10 }] },

            { type: 'note', duration: '8th', notes: [{ string: 1, fret: 8 }] },
            { type: 'note', duration: '8th', notes: [{ string: 1, fret: 10, tieStart: true }] },

            { type: 'note', duration: '8th', notes: [{ string: 1, fret: 10, tieEnd: true }] },
            { type: 'note', duration: '8th', notes: [{ string: 1, fret: 8 }] },

            { type: 'note', duration: 'quarter', notes: [{ string: 3, fret: 12, bend: 'full' }] },
          ],
        },
        { // 4 — G. 3rds as dyads (G/B, F/A, G/B), an 8th-note triplet down the G triad.
          beats: [
            { type: 'note', duration: 'quarter', chord: 'G', notes: [{ string: 3, fret: 12 }, { string: 2, fret: 12 }] },

            { type: 'note', duration: '8th', notes: [{ string: 3, fret: 10 }, { string: 2, fret: 10 }] },
            { type: 'note', duration: '8th', notes: [{ string: 3, fret: 12 }, { string: 2, fret: 12 }] },

            { type: 'note', duration: '8th', tuplet: 3, notes: [{ string: 1, fret: 10 }] },
            { type: 'note', duration: '8th', tuplet: 3, notes: [{ string: 2, fret: 12 }] },
            { type: 'note', duration: '8th', tuplet: 3, notes: [{ string: 3, fret: 12 }] },

            { type: 'note', duration: 'quarter', notes: [{ string: 3, fret: 10 }] },
          ],
        },
        { // 5 — Bb. A "full release" bend on C, hammer-on and pull-off, a grace-note slide down to F.
          beats: [
            { type: 'note', duration: 'quarter', chord: 'Bb', notes: [{ string: 2, fret: 13, bend: 'full release' }] },

            { type: 'note', duration: '16th', notes: [{ string: 1, fret: 10, hammerPull: true }] },
            { type: 'note', duration: '16th', notes: [{ string: 1, fret: 13, hammerPull: true }] },
            { type: 'note', duration: '16th', notes: [{ string: 1, fret: 10 }] },
            { type: 'note', duration: '16th', notes: [{ string: 2, fret: 11, pitch: 'Bb4' }] },

            { type: 'grace', notes: [{ string: 1, fret: 15, slide: true }] },
            { type: 'note', duration: 'quarter', notes: [{ string: 1, fret: 13 }] },

            { type: 'note', duration: '8th', notes: [{ string: 1, fret: 10 }] },
            { type: 'note', duration: '8th', notes: [{ string: 2, fret: 11, pitch: 'Bb4' }] },
          ],
        },
        { // 6 — F, then C/E. Two 8th-note triplets, then a dotted quarter on the E.
          beats: [
            { type: 'note', duration: '8th', tuplet: 3, chord: 'F', notes: [{ string: 2, fret: 10 }] },
            { type: 'note', duration: '8th', tuplet: 3, notes: [{ string: 1, fret: 8 }] },
            { type: 'note', duration: '8th', tuplet: 3, notes: [{ string: 2, fret: 10 }] },

            { type: 'note', duration: '8th', tuplet: 3, notes: [{ string: 3, fret: 12 }] },
            { type: 'note', duration: '8th', tuplet: 3, notes: [{ string: 3, fret: 10 }] },
            { type: 'note', duration: '8th', tuplet: 3, notes: [{ string: 3, fret: 12 }] },

            { type: 'note', duration: 'quarter', dots: 1, chord: 'C/E', notes: [{ string: 3, fret: 9 }] },
            { type: 'note', duration: '8th', notes: [{ string: 3, fret: 12 }] },
          ],
        },
        { // 7 — Dm. 6ths on strings 4 and 2, stepping down from F/D to C/A.
          beats: [
            { type: 'note', duration: 'quarter', chord: 'Dm', notes: [{ string: 4, fret: 15 }, { string: 2, fret: 15 }] },

            { type: 'note', duration: '8th', notes: [{ string: 4, fret: 14 }, { string: 2, fret: 13 }] },
            { type: 'note', duration: '8th', notes: [{ string: 4, fret: 12 }, { string: 2, fret: 11, pitch: 'Bb4' }] },

            { type: 'note', duration: 'quarter', notes: [{ string: 4, fret: 10 }, { string: 2, fret: 10 }] },

            { type: 'note', duration: '8th', notes: [{ string: 4, fret: 12 }] },
            { type: 'note', duration: '8th', notes: [{ string: 3, fret: 10 }] },
          ],
        },
        { // 8 — Bb. A 16th-note arpeggio of Bb, a hammer-on from Bb to C.
          beats: [
            { type: 'note', duration: '16th', chord: 'Bb', notes: [{ string: 3, fret: 10 }] },
            { type: 'note', duration: '16th', notes: [{ string: 2, fret: 11, pitch: 'Bb4' }] },
            { type: 'note', duration: '16th', notes: [{ string: 1, fret: 10 }] },
            { type: 'note', duration: '16th', notes: [{ string: 2, fret: 11, pitch: 'Bb4' }] },

            { type: 'note', duration: 'quarter', notes: [{ string: 3, fret: 10 }] },

            { type: 'note', duration: '8th', notes: [{ string: 2, fret: 11, pitch: 'Bb4', hammerPull: true }] },
            { type: 'note', duration: '8th', notes: [{ string: 2, fret: 13 }] },

            { type: 'note', duration: 'quarter', notes: [{ string: 1, fret: 10 }] },
          ],
        },
        { // 9 — Gm, then C. A "full" bend on F, a 16th-note run down to E over C.
          beats: [
            { type: 'note', duration: 'quarter', chord: 'Gm', notes: [{ string: 1, fret: 13, bend: 'full' }] },

            { type: 'note', duration: '8th', notes: [{ string: 1, fret: 10 }] },
            { type: 'note', duration: '8th', notes: [{ string: 2, fret: 11, pitch: 'Bb4' }] },

            { type: 'note', duration: '16th', chord: 'C', notes: [{ string: 2, fret: 13 }] },
            { type: 'note', duration: '16th', notes: [{ string: 2, fret: 11, pitch: 'Bb4' }] },
            { type: 'note', duration: '16th', notes: [{ string: 3, fret: 12 }] },
            { type: 'note', duration: '16th', notes: [{ string: 3, fret: 9 }] },

            { type: 'note', duration: '8th', notes: [{ string: 3, fret: 12 }] },
            { type: 'note', duration: '8th', notes: [{ string: 2, fret: 11, pitch: 'Bb4' }] },
          ],
        },
        { // 10 — F. A chromatic neighbour (A, G#, A), then F tied over the barline.
          beats: [
            { type: 'note', duration: '8th', chord: 'F', notes: [{ string: 2, fret: 10 }] },
            { type: 'note', duration: '8th', notes: [{ string: 1, fret: 8 }] },

            { type: 'note', duration: '16th', notes: [{ string: 2, fret: 10 }] },
            { type: 'note', duration: '16th', notes: [{ string: 2, fret: 9 }] },
            { type: 'note', duration: '16th', notes: [{ string: 2, fret: 10 }] },
            { type: 'note', duration: '16th', notes: [{ string: 1, fret: 8 }] },

            { type: 'note', duration: 'quarter', notes: [{ string: 3, fret: 12 }] },

            { type: 'note', duration: 'quarter', notes: [{ string: 3, fret: 10, tieStart: true }] },
          ],
        },
        { // 11 — the tied F, then up to C and a high F with vibrato.
          beats: [
            { type: 'note', duration: 'half', notes: [{ string: 3, fret: 10, tieEnd: true }] },
            { type: 'note', duration: 'quarter', notes: [{ string: 1, fret: 8 }] },
            { type: 'note', duration: 'quarter', vibrato: true, notes: [{ string: 1, fret: 13 }] },
          ],
        },
        { // 12 — final: a whole-measure rest.
          barline: 'final',
          beats: [
            { type: 'rest', duration: 'whole' },
          ],
        },
      ],
    },
  ],
};
