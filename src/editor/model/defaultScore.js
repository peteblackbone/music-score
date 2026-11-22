/**
 * model/defaultScore.js — the score a new editor starts with: one guitar
 * track in standard tuning, notation + TAB, 4/4, one empty measure.
 */
export const STANDARD_TUNING = Object.freeze(['E2', 'A2', 'D3', 'G3', 'B3', 'E4']);

export function defaultScore() {
  return {
    title: 'Untitled',
    tracks: [{
      name: 'Guitar',
      clef: 'treble',
      showStandardNotation: true,
      showTablature: true,
      tuning: [...STANDARD_TUNING],
      timeSignature: { beats: 4, beatType: 4 },
      measures: [{ beats: [] }],
    }],
  };
}
