/**
 * theme.js — visual constants for the renderer. Override via
 * `new MusicScoreRenderer(el, score, { theme: { ...overrides } })`; the
 * overrides are resolved once, in the constructor, by `resolveTheme`.
 *
 * Distances whose key ends in `Sp` are in staff spaces (1 sp =
 * `staffLineSpacing` px), so they scale with the staff size.
 */
export const defaultTheme = {
  fontFamily: 'Bravura, BravuraFallback, serif',
  textFontFamily: '"Times New Roman", Georgia, serif',

  background: '#ffffff',   // page colour: SVG background and the backing behind tab fret numbers/labels

  staffLineSpacing: 10,   // px between two adjacent staff lines (= 1 sp)
  staffLineColor: '#1a1a1a',
  staffLineWidth: 1,

  noteColor: '#1a1a1a',
  stemWidth: 1.3,
  beamWidth: 5,

  tieColor: '#1a1a1a',
  slurColor: '#1a1a1a',

  dynamicColor: '#1a1a1a',
  dynamicFontSize: 15,

  tabFontSize: 12,
  tabFretColor: '#1a1a1a',
  tabStaffLineSpacing: 15,

  // Rhythm on TAB staves (ui.md §9; see draw/tabRhythm.js)
  tabStemGapSp: 1.0,          // bottom string -> stem top (never less than a fret knock-out's half height + 0.2 sp)
  tabStemLengthSp: 2.5,       // quarter-and-shorter stem length (+0.75 sp per beam level beyond 2)
  tabHalfStemLengthSp: 1.25,  // half-note stem length (whole notes get none)
  tabFlagScale: 0.75,         // flag size relative to the notation SMuFL size

  // Vertical spacing: minimum line-to-line gaps (content-aware; see layout/vertical.js).
  systemGapSp: 8,         // last staff of a system -> first staff of the next
  instrumentGapSp: 6,     // one track (instrument) -> the next, within a system
  notationTabGapSp: 3.5,  // a track's notation staff -> its tab staff

  marginLeftSp: 3,
  marginRightSp: 3,
  marginTopSp: 3,

  // Horizontal spacing (see layout/timeline.js).
  measurePaddingSp: 1.25,  // barline -> first note (plus the note's left extent)
  minNoteSpacingSp: 1.8,   // floor of the ideal gap between two onsets
  quarterSpacingSp: 3.5,   // ideal gap after a quarter note; other durations scale by sqrt(duration / quarter)
  graceNoteWidthSp: 1.2,   // horizontal slot per grace note, left of its main note
  graceNoteScale: 0.68,    // grace notehead/stem size relative to a normal note

  glyphSize: 40,           // deprecated, unused (SMuFL glyphs are sized from staffLineSpacing)

  hammerPullLabels: true, // show "H"/"P" text above hammer-on/pull-off slurs; false draws a plain slur (some tab styles omit the letters)
};

/**
 * Old px-based theme keys (before the sp keys), still honoured when passed
 * in `options.theme`: each is converted to its sp key unless that sp key is
 * passed too (the sp key wins). Deprecated.
 */
const LEGACY_KEYS = {
  systemGap: ['systemGapSp', (v, s) => v / s],
  trackGap: ['instrumentGapSp', (v, s) => v / s],
  notationTabGap: ['notationTabGapSp', (v, s) => v / s],
  leftMargin: ['marginLeftSp', (v, s) => v / s],
  rightMargin: ['marginRightSp', (v, s) => v / s],
  topMargin: ['marginTopSp', (v, s) => v / s],
  measurePadding: ['measurePaddingSp', (v, s) => v / s],
  minNoteSpacing: ['minNoteSpacingSp', (v, s) => v / s],
  spacingFactor: ['quarterSpacingSp', (v) => 3.5 * (v / 46)],
  graceNoteWidth: ['graceNoteWidthSp', (v, s) => v / s],
};

/**
 * Build the effective theme: defaults, then `overrides` (shallow: each key
 * replaces the default), with legacy px keys converted to sp keys.
 */
export function resolveTheme(overrides = {}) {
  const o = overrides || {};
  const theme = { ...defaultTheme };
  const spacing = o.staffLineSpacing ?? defaultTheme.staffLineSpacing;
  for (const [k, v] of Object.entries(o)) {
    const legacy = Object.hasOwn(LEGACY_KEYS, k) ? LEGACY_KEYS[k] : null;
    if (legacy) {
      const [newKey, convert] = legacy;
      if (o[newKey] == null && typeof v === 'number') theme[newKey] = convert(v, spacing);
      continue;
    }
    theme[k] = v;
  }
  return theme;
}

/** SMuFL fonts are designed so that 1 staff space = 0.25em when font-size == 4 * staffSpace. */
export function smuflFontSizePx(theme) {
  return theme.staffLineSpacing * 4;
}
