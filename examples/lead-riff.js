/**
 * lead-riff.js — an original 11-measure lead-guitar line in A minor,
 * written for this project (not a transcription of any recording or tab).
 * Standard tuning, ♩ = 96, a single notation + TAB "E.Gt." track.
 *
 * Progression: (pickup) | Am | F | G | Am C | Dm | F G | E7 | Am | E7 | Am
 *
 * It is mostly A minor pentatonic, with a D# passing note in the pickup,
 * the E7 tones G# and F# in measures 8 and 10, and the 8th-position box in
 * measures 5-6. Each measure shows a few of the features: 8th and 16th
 * beaming, triplets, a 16th quintuplet, a quarter-note triplet over two
 * beats, a grace-note hammer-on, hammer-ons and pull-offs, slides,
 * "1/2" and "full" bends (one with a release), vibrato, a dyad, a tie,
 * and a final barline.
 */
export const leadRiff = {
  title: 'Lead Riff in A Minor',
  tuningLabel: 'Standard tuning',
  tempoText: '♩ = 96',
  tracks: [
    {
      name: 'Lead Guitar',
      label: 'E.Gt.',
      clef: 'treble',
      showStandardNotation: true,
      showTablature: true,
      tuning: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'],
      timeSignature: { beats: 4, beatType: 4 },
      keySignature: 0,
      measures: [
        { // 1 — pickup: half rest, then a low 16th-note run (D# passing note, then D natural)
          beats: [
            { type: 'rest', duration: 'half' },
            { type: 'note', duration: '16th', dynamic: 'mf', notes: [{ string: 6, fret: 5 }] },
            { type: 'note', duration: '16th', notes: [{ string: 6, fret: 8 }] },
            { type: 'note', duration: '16th', notes: [{ string: 5, fret: 5 }] },
            { type: 'note', duration: '16th', notes: [{ string: 5, fret: 6 }] },

            { type: 'note', duration: '16th', notes: [{ string: 5, fret: 7 }] },
            { type: 'note', duration: '16th', notes: [{ string: 5, fret: 5 }] },
            { type: 'note', duration: '16th', notes: [{ string: 6, fret: 8 }] },
            { type: 'note', duration: '16th', notes: [{ string: 6, fret: 7 }] },
          ],
        },
        { // 2 — Am. Hammer-on, a 16th group with a hammer-on, a "1/2" bend.
          beats: [
            { type: 'note', duration: '8th', chord: 'Am', notes: [{ string: 4, fret: 5, hammerPull: true }] },
            { type: 'note', duration: '8th', notes: [{ string: 4, fret: 7 }] },

            { type: 'note', duration: '16th', notes: [{ string: 3, fret: 5, hammerPull: true }] },
            { type: 'note', duration: '16th', notes: [{ string: 3, fret: 7 }] },
            { type: 'note', duration: '16th', notes: [{ string: 3, fret: 5 }] },
            { type: 'note', duration: '16th', notes: [{ string: 4, fret: 7 }] },

            { type: 'note', duration: '8th', notes: [{ string: 3, fret: 7, bend: '1/2' }] },
            { type: 'note', duration: '8th', notes: [{ string: 3, fret: 5 }] },

            { type: 'note', duration: 'quarter', notes: [{ string: 2, fret: 5 }] },
          ],
        },
        { // 3 — F. Two 8th-note triplets (hammer-on and pull-off), then a slide up.
          beats: [
            { type: 'note', duration: '8th', tuplet: 3, chord: 'F', notes: [{ string: 2, fret: 5, hammerPull: true }] },
            { type: 'note', duration: '8th', tuplet: 3, notes: [{ string: 2, fret: 8, hammerPull: true }] },
            { type: 'note', duration: '8th', tuplet: 3, notes: [{ string: 2, fret: 5 }] },

            { type: 'note', duration: '8th', tuplet: 3, notes: [{ string: 3, fret: 7 }] },
            { type: 'note', duration: '8th', tuplet: 3, notes: [{ string: 3, fret: 5 }] },
            { type: 'note', duration: '8th', tuplet: 3, notes: [{ string: 4, fret: 7 }] },

            { type: 'note', duration: 'quarter', notes: [{ string: 3, fret: 5 }] },

            { type: 'note', duration: '8th', notes: [{ string: 3, fret: 5, slide: true }] },
            { type: 'note', duration: '8th', notes: [{ string: 3, fret: 7 }] },
          ],
        },
        { // 4 — G. Grace-note hammer-on, a pull-off in a 16th group, a "full" bend.
          beats: [
            { type: 'grace', notes: [{ string: 2, fret: 5, hammerPull: true }] },
            { type: 'note', duration: '8th', chord: 'G', notes: [{ string: 2, fret: 8 }] },
            { type: 'note', duration: '8th', notes: [{ string: 2, fret: 5 }] },

            { type: 'note', duration: '16th', notes: [{ string: 1, fret: 8, hammerPull: true }] },
            { type: 'note', duration: '16th', notes: [{ string: 1, fret: 5 }] },
            { type: 'note', duration: '16th', notes: [{ string: 2, fret: 8 }] },
            { type: 'note', duration: '16th', notes: [{ string: 2, fret: 5 }] },

            { type: 'note', duration: 'quarter', notes: [{ string: 3, fret: 7, bend: 'full' }] },

            { type: 'note', duration: '8th', notes: [{ string: 3, fret: 5 }] },
            { type: 'note', duration: '8th', notes: [{ string: 4, fret: 7 }] },
          ],
        },
        { // 5 — Am, then C. Slide up into the 8th-position box; a "full release" bend.
          beats: [
            { type: 'note', duration: '8th', chord: 'Am', notes: [{ string: 3, fret: 7, slide: true }] },
            { type: 'note', duration: '8th', notes: [{ string: 3, fret: 9 }] },

            { type: 'note', duration: '16th', notes: [{ string: 2, fret: 8 }] },
            { type: 'note', duration: '16th', notes: [{ string: 2, fret: 10 }] },
            { type: 'note', duration: '16th', notes: [{ string: 1, fret: 8 }] },
            { type: 'note', duration: '16th', notes: [{ string: 2, fret: 10 }] },

            { type: 'note', duration: 'quarter', chord: 'C', notes: [{ string: 1, fret: 10, bend: 'full release' }] },

            { type: 'note', duration: '8th', notes: [{ string: 1, fret: 8 }] },
            { type: 'note', duration: '8th', notes: [{ string: 2, fret: 10 }] },
          ],
        },
        { // 6 — Dm. A descending 16th quintuplet, a pull-off, and a held F with vibrato.
          beats: [
            { type: 'note', duration: '16th', tuplet: { count: 5, of: 4 }, chord: 'Dm', notes: [{ string: 1, fret: 10 }] },
            { type: 'note', duration: '16th', tuplet: { count: 5, of: 4 }, notes: [{ string: 1, fret: 8 }] },
            { type: 'note', duration: '16th', tuplet: { count: 5, of: 4 }, notes: [{ string: 2, fret: 10 }] },
            { type: 'note', duration: '16th', tuplet: { count: 5, of: 4 }, notes: [{ string: 2, fret: 8 }] },
            { type: 'note', duration: '16th', tuplet: { count: 5, of: 4 }, notes: [{ string: 3, fret: 10 }] },

            { type: 'note', duration: '8th', notes: [{ string: 3, fret: 9, hammerPull: true }] },
            { type: 'note', duration: '8th', notes: [{ string: 3, fret: 7 }] },

            { type: 'note', duration: '8th', notes: [{ string: 4, fret: 7 }] },
            { type: 'note', duration: '8th', notes: [{ string: 3, fret: 7 }] },

            { type: 'note', duration: 'quarter', vibrato: true, notes: [{ string: 2, fret: 6 }] },
          ],
        },
        { // 7 — F, then G. A quarter-note triplet across two beats, then a 16th run down to B.
          beats: [
            { type: 'note', duration: 'quarter', tuplet: 3, chord: 'F', notes: [{ string: 3, fret: 5 }] },
            { type: 'note', duration: 'quarter', tuplet: 3, notes: [{ string: 3, fret: 7 }] },
            { type: 'note', duration: 'quarter', tuplet: 3, notes: [{ string: 2, fret: 6 }] },

            { type: 'note', duration: '16th', chord: 'G', notes: [{ string: 2, fret: 8 }] },
            { type: 'note', duration: '16th', notes: [{ string: 2, fret: 6 }] },
            { type: 'note', duration: '16th', notes: [{ string: 2, fret: 5 }] },
            { type: 'note', duration: '16th', notes: [{ string: 3, fret: 7 }] },

            { type: 'note', duration: '8th', notes: [{ string: 3, fret: 5 }] },
            { type: 'note', duration: '8th', notes: [{ string: 3, fret: 4 }] },
          ],
        },
        { // 8 — E7. G# and F# accidentals, a pull-off, a "1/2" bend on the G#.
          beats: [
            { type: 'note', duration: '8th', chord: 'E7', notes: [{ string: 1, fret: 7 }] },
            { type: 'note', duration: '8th', notes: [{ string: 2, fret: 9 }] },

            { type: 'note', duration: '16th', notes: [{ string: 2, fret: 10, hammerPull: true }] },
            { type: 'note', duration: '16th', notes: [{ string: 2, fret: 9 }] },
            { type: 'note', duration: '16th', notes: [{ string: 3, fret: 9 }] },
            { type: 'note', duration: '16th', notes: [{ string: 3, fret: 7 }] },

            { type: 'note', duration: 'quarter', notes: [{ string: 2, fret: 9, bend: '1/2' }] },

            { type: 'note', duration: '8th', notes: [{ string: 2, fret: 7 }] },
            { type: 'note', duration: '8th', notes: [{ string: 3, fret: 9 }] },
          ],
        },
        { // 9 — Am. An A/C dyad, a triplet, a 16th run with a pull-off, down to the low A.
          beats: [
            { type: 'note', duration: 'quarter', chord: 'Am', notes: [{ string: 2, fret: 10 }, { string: 1, fret: 8 }] },

            { type: 'note', duration: '8th', tuplet: 3, notes: [{ string: 1, fret: 8 }] },
            { type: 'note', duration: '8th', tuplet: 3, notes: [{ string: 2, fret: 10 }] },
            { type: 'note', duration: '8th', tuplet: 3, notes: [{ string: 2, fret: 8 }] },

            { type: 'note', duration: '16th', notes: [{ string: 3, fret: 9, hammerPull: true }] },
            { type: 'note', duration: '16th', notes: [{ string: 3, fret: 7 }] },
            { type: 'note', duration: '16th', notes: [{ string: 4, fret: 10 }] },
            { type: 'note', duration: '16th', notes: [{ string: 4, fret: 7 }] },

            { type: 'note', duration: '8th', notes: [{ string: 5, fret: 7 }] },
            { type: 'note', duration: '8th', notes: [{ string: 5, fret: 5 }] },
          ],
        },
        { // 10 — E7. A low-register turnaround: G# on beat 1, a triplet, back to G#.
          beats: [
            { type: 'note', duration: '8th', chord: 'E7', notes: [{ string: 5, fret: 7 }] },
            { type: 'note', duration: '8th', notes: [{ string: 4, fret: 6 }] },

            { type: 'note', duration: '8th', notes: [{ string: 4, fret: 9 }] },
            { type: 'note', duration: '8th', notes: [{ string: 3, fret: 7 }] },

            { type: 'note', duration: '8th', tuplet: 3, notes: [{ string: 3, fret: 9 }] },
            { type: 'note', duration: '8th', tuplet: 3, notes: [{ string: 3, fret: 7 }] },
            { type: 'note', duration: '8th', tuplet: 3, notes: [{ string: 4, fret: 9 }] },

            { type: 'note', duration: '8th', notes: [{ string: 4, fret: 6 }] },
            { type: 'note', duration: '8th', notes: [{ string: 4, fret: 9 }] },
          ],
        },
        { // 11 — Am, final: a hammer-on onto A, tied into a dotted half with vibrato.
          barline: 'final',
          beats: [
            { type: 'note', duration: '8th', chord: 'Am', notes: [{ string: 4, fret: 5, hammerPull: true }] },
            { type: 'note', duration: '8th', notes: [{ string: 4, fret: 7, tieStart: true }] },
            { type: 'note', duration: 'half', dots: 1, vibrato: true, notes: [{ string: 4, fret: 7, tieEnd: true }] },
          ],
        },
      ],
    },
  ],
};
