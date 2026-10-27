/**
 * articulations-demo.js — a short single-track demo (C major, 4/4,
 * notation only) of beat-level `articulations` (staccato, tenuto,
 * accent) and `fermata`: marks below stem-up notes and above stem-down
 * notes, stacking order, chords, beamed groups whose shared stem
 * direction overrides a note's own, whole notes, fermatas on notes,
 * rests, under a chord symbol, over a slur and over a tuplet, and the
 * interaction with dynamics and ties.
 */
export const articulationsScore = {
  title: 'Articulations and fermata',
  tracks: [
    {
      name: 'Melody',
      clef: 'treble',
      showStandardNotation: true,
      showTablature: false,
      timeSignature: { beats: 4, beatType: 4 },
      keySignature: 0,
      measures: [
        { // 1 — stem-up notes: marks go below
          beats: [
            { type: 'note', duration: 'quarter', articulations: ['staccato'], notes: [{ pitch: 'E4' }] },
            { type: 'note', duration: 'quarter', articulations: ['tenuto'], notes: [{ pitch: 'F4' }] },
            { type: 'note', duration: 'quarter', articulations: ['accent'], notes: [{ pitch: 'G4' }] },
            { type: 'note', duration: 'quarter', articulations: ['staccato', 'accent'], notes: [{ pitch: 'A4' }] },
          ],
        },
        { // 2 — stem-down notes: marks go above, plus a three-mark stack
          beats: [
            { type: 'note', duration: 'quarter', articulations: ['staccato'], notes: [{ pitch: 'B4' }] },
            { type: 'note', duration: 'quarter', articulations: ['tenuto'], notes: [{ pitch: 'C5' }] },
            { type: 'note', duration: 'quarter', articulations: ['accent'], notes: [{ pitch: 'D5' }] },
            { type: 'note', duration: 'quarter', articulations: ['staccato', 'tenuto', 'accent'], notes: [{ pitch: 'E5' }] },
          ],
        },
        { // 3 — stacking order is fixed (array order ignored), chords, duplicates/unknown names ignored
          beats: [
            { type: 'note', duration: 'quarter', articulations: ['accent', 'staccato', 'tenuto'], notes: [{ pitch: 'G4' }] },
            { type: 'note', duration: 'quarter', articulations: ['accent'], notes: [{ pitch: 'C5' }, { pitch: 'E5' }, { pitch: 'G5' }] },
            { type: 'note', duration: 'quarter', articulations: ['tenuto', 'staccato'], notes: [{ pitch: 'E4' }, { pitch: 'G4' }, { pitch: 'C5' }] },
            { type: 'note', duration: 'quarter', articulations: ['staccato', 'staccato', 'marcato'], notes: [{ pitch: 'B4' }] },
          ],
        },
        { // 4 — beamed pairs: the group's stem direction decides the side (C5 and D4 are overridden)
          beats: [
            { type: 'note', duration: '8th', articulations: ['staccato'], notes: [{ pitch: 'E4' }] },
            { type: 'note', duration: '8th', articulations: ['staccato'], notes: [{ pitch: 'C5' }] },
            { type: 'note', duration: '8th', articulations: ['tenuto'], notes: [{ pitch: 'D4' }] },
            { type: 'note', duration: '8th', articulations: ['tenuto'], notes: [{ pitch: 'A5' }] },
            { type: 'note', duration: 'half', articulations: ['accent'], notes: [{ pitch: 'F4' }, { pitch: 'A4' }, { pitch: 'C5' }] },
          ],
        },
        { // 5 — whole note, marks below, fermata
          beats: [
            { type: 'note', duration: 'whole', articulations: ['tenuto'], fermata: true, notes: [{ pitch: 'G4' }] },
          ],
        },
        { // 6 — whole note, marks above, fermata above them
          beats: [
            { type: 'note', duration: 'whole', articulations: ['accent'], fermata: true, notes: [{ pitch: 'D5' }] },
          ],
        },
        { // 7 — fermata on a note, a rest, under a chord symbol, and over a slur
          beats: [
            { type: 'note', duration: 'quarter', fermata: true, notes: [{ pitch: 'A4' }] },
            { type: 'rest', duration: 'quarter', fermata: true },
            { type: 'note', duration: 'quarter', chord: 'C', fermata: true, notes: [{ pitch: 'G4' }] },
            { type: 'note', duration: '8th', slurStart: true, articulations: ['staccato'], notes: [{ pitch: 'B4' }] },
            { type: 'note', duration: '8th', slurEnd: true, fermata: true, notes: [{ pitch: 'D5' }] },
          ],
        },
        { // 8 — triplet staccatos (fermata over the bracket), dynamic pushed below a staccato, tied pair
          barline: 'final',
          beats: [
            { type: 'note', duration: '8th', tuplet: 3, articulations: ['staccato'], notes: [{ pitch: 'C5' }] },
            { type: 'note', duration: '8th', tuplet: 3, articulations: ['staccato'], notes: [{ pitch: 'D5' }] },
            { type: 'note', duration: '8th', tuplet: 3, articulations: ['staccato'], fermata: true, notes: [{ pitch: 'E5' }] },
            { type: 'note', duration: 'quarter', dynamic: 'mf', articulations: ['staccato'], notes: [{ pitch: 'F4' }] },
            { type: 'note', duration: 'quarter', articulations: ['staccato'], notes: [{ pitch: 'G4', tieStart: true }] },
            { type: 'note', duration: 'quarter', notes: [{ pitch: 'G4', tieEnd: true }] },
          ],
        },
      ],
    },
  ],
};
