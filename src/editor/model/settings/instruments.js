/**
 * model/settings/instruments.js — the instrument presets (addTrack, the
 * demo's New dialog) and the tuning presets per instrument. Deep-frozen;
 * public as ScoreEditor.INSTRUMENTS and ScoreEditor.TUNINGS.
 *
 * INSTRUMENTS[id] = { name, label, clef, tuning, staves }: `name` is the
 * new track's name, `label` picker text only (never written to
 * track.label), `staves` the two staff flags (both on). Tunings run low to
 * high in canonical form. TUNINGS[id] = [{ name, tuning }], Standard first.
 */
const deepFreeze = (o) => {
  Object.values(o).forEach((v) => { if (v && typeof v === 'object') deepFreeze(v); });
  return Object.freeze(o);
};
const t = (s) => s.split(' ');
const STAVES = { showStandardNotation: true, showTablature: true };
const inst = (name, label, clef, tuning) => ({ name, label, clef, tuning: t(tuning), staves: { ...STAVES } });

export const INSTRUMENTS = deepFreeze({
  guitar6: inst('Guitar', '6-string guitar', 'treble', 'E2 A2 D3 G3 B3 E4'),
  guitar7: inst('7-string guitar', '7-string guitar', 'treble', 'B1 E2 A2 D3 G3 B3 E4'),
  guitar8: inst('8-string guitar', '8-string guitar', 'treble', 'F#1 B1 E2 A2 D3 G3 B3 E4'),
  bass4: inst('Bass', '4-string bass', 'bass', 'E1 A1 D2 G2'),
  bass5: inst('5-string bass', '5-string bass', 'bass', 'B0 E1 A1 D2 G2'),
  bass6: inst('6-string bass', '6-string bass', 'bass', 'B0 E1 A1 D2 G2 C3'),
  ukulele: inst('Ukulele', 'Ukulele', 'treble', 'G4 C4 E4 A4'),
});

const p = (name, tuning) => ({ name, tuning: t(tuning) });
export const TUNINGS = deepFreeze({
  guitar6: [
    p('Standard', 'E2 A2 D3 G3 B3 E4'),
    p('Drop D', 'D2 A2 D3 G3 B3 E4'),
    p('Half-step down', 'Eb2 Ab2 Db3 Gb3 Bb3 Eb4'),
    p('Whole-step down', 'D2 G2 C3 F3 A3 D4'),
    p('Drop C', 'C2 G2 C3 F3 A3 D4'),
    p('DADGAD', 'D2 A2 D3 G3 A3 D4'),
    p('Open G', 'D2 G2 D3 G3 B3 D4'),
    p('Open D', 'D2 A2 D3 F#3 A3 D4'),
    p('Open E', 'E2 B2 E3 G#3 B3 E4'),
  ],
  guitar7: [p('Standard', 'B1 E2 A2 D3 G3 B3 E4'), p('Drop A', 'A1 E2 A2 D3 G3 B3 E4')],
  guitar8: [p('Standard', 'F#1 B1 E2 A2 D3 G3 B3 E4')],
  bass4: [p('Standard', 'E1 A1 D2 G2'), p('Drop D', 'D1 A1 D2 G2')],
  bass5: [p('Standard', 'B0 E1 A1 D2 G2')],
  bass6: [p('Standard', 'B0 E1 A1 D2 G2 C3')],
  ukulele: [p('Standard', 'G4 C4 E4 A4')],
});
