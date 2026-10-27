/**
 * normalize.js — fills in score defaults so layout and drawing can rely on
 * every field being present: track defaults, "sticky" time/key signatures
 * carried forward measure to measure, last-measure barline, and `pitch`
 * derived from string+fret for tab-only notes. Pure function, no DOM.
 *
 * Every track gets the same number of measures (the longest track's);
 * shorter tracks are padded with empty measures that inherit the current
 * time/key signature. Each measure also records whether its key or time
 * signature changed from the previous measure (`keyChanged`,
 * `timeChanged`, `prevKey`) and whether it opens with a repeat
 * (`repeatStart`, from `barline: 'repeatStart'`; its own closing barline is
 * then `single`, or `final` if it is the last measure).
 *
 * Octaves (ui.md §3): guitar music is written an octave above sounding
 * pitch. A note's `pitch` here is the WRITTEN pitch (what the notation
 * staff shows) and `soundingPitch` the sounding one:
 * - pitches derived from string+fret (`fromFret: true`) are always written
 *   an octave up;
 * - explicit `pitch`es are sounding and written an octave up only when the
 *   track sets `writtenOctaveUp: true`; otherwise they are taken as written.
 * The track gets `octaveClef: true` (8vb treble/bass clef) when it opts in
 * or any of its pitches is fret-derived.
 *
 * A note's `harmonic` is canonicalized to its kind ('natural' | 'artificial'
 * | 'pinch' | 'tapped' | 'semi'; see harmonics.js); falsy values are left as
 * they are.
 *
 * A beat's `pickStroke` and `whammy` are canonicalized when present (see
 * directions.js: 'down' | 'up' | null, `{ type: 'dip', amount }` | null);
 * `letRing` and a note's `tap` pass through as given (read as truthy).
 *
 * Rhythm on TAB staves: `track.tabRhythm` (true | false | 'auto', absent =
 * 'auto') is resolved to a boolean — true only for tracks with a TAB staff
 * that either opt in (`true`) or, for 'auto' / any other value, show no
 * notation staff. Each measure records `padded: true` when it was added
 * to pad a shorter track (missing, null or a hole in `measures`), so an
 * authored empty measure (`beats: []`) can be told apart from padding.
 *
 * Navigation (see navigation.js): `score.navigation[mi]` = `{ ending, segno,
 * coda, jump }` merged over all tracks per measure column (canonical forms;
 * an author field named `navigation` is overwritten). Track measures keep
 * their raw fields.
 *
 * Chord diagrams (see chordShapes.js): `track.showChordDiagrams` defaults
 * to whether the track shows TAB (`showTablature`), else is read as a
 * boolean; `score.chordShapes` and `beat.chordDiagram` pass through.
 */
import { pitchFromFret, transposeOctaves } from './pitch.js';
import { harmonicKind } from './harmonics.js';
import { withDirections, trillOf } from './directions.js';
import { mergeNavigation } from './navigation.js';

const sameTime = (a, b) => a.beats === b.beats && a.beatType === b.beatType;

const MAX_DOTS = 4;
/**
 * Augmentation dot count as an integer 0..MAX_DOTS, so dot loops stay bounded.
 * Numeric strings count as their number ('1' -> 1, as before); other non-numbers and negatives -> 0.
 */
const clampDots = (d) => {
  const n = typeof d === 'string' && d.trim() !== '' ? Number(d) : d;
  return typeof n === 'number' && n > 0 ? Math.min(MAX_DOTS, Math.floor(n)) : 0;
};

/** Resolve `track.tabRhythm` (raw author value) against the merged track `t`. */
function resolveTabRhythm(raw, t) {
  if (!t.showTablature) return false;
  if (raw === true) return true;
  if (raw === false) return false;
  return !t.showStandardNotation; // 'auto' / absent / any other value
}

/** Fill in defaults and propagate "sticky" fields (time/key signature) forward. */
export function normalizeScore(score) {
  const rawTracks = score.tracks || [];
  const measureCount = rawTracks.reduce((m, t) => Math.max(m, (t.measures || []).length), 0);
  const tracks = rawTracks.map((track) => {
    const tuning = track.tuning || ['E2', 'A2', 'D3', 'G3', 'B3', 'E4']; // low->high (standard 6-string guitar)
    const stringCount = tuning.length;
    let curTime = track.timeSignature || score.timeSignature || { beats: 4, beatType: 4 };
    let curKey = track.keySignature ?? score.keySignature ?? 0;
    const source = track.measures || [];
    const measures = [];
    let fromFret = false;
    for (let mi = 0; mi < measureCount; mi++) {
      const padded = !source[mi];
      const measure = source[mi] || { beats: [] };
      const prevTime = curTime;
      const prevKey = curKey;
      if (measure.timeSignature) curTime = measure.timeSignature;
      if (measure.keySignature != null) curKey = measure.keySignature;
      const isLast = mi === measureCount - 1;
      const endDefault = isLast ? 'final' : 'single';
      const repeatStart = measure.barline === 'repeatStart';
      measures.push({
        ...measure,
        padded,
        timeSignature: curTime,
        keySignature: curKey,
        prevKey: mi > 0 ? prevKey : curKey,
        keyChanged: mi > 0 && curKey !== prevKey,
        timeChanged: mi > 0 && !sameTime(curTime, prevTime),
        repeatStart,
        barline: repeatStart ? endDefault : (measure.barline || endDefault),
        beats: (measure.beats || []).map((b) => withDirections({
          dots: 0, // keeps `dots` the first key
          ...b,
          dots: clampDots(b.dots),
          notes: (b.notes || []).map((n) => {
            let out;
            // Fill in `pitch` from string+fret when the author only supplied tab data.
            if (n.pitch == null && n.string != null && n.fret != null) {
              const openPitch = tuning[stringCount - n.string];
              if (!openPitch) {
                out = n;
              } else {
                const sounding = pitchFromFret(openPitch, n.fret);
                fromFret = true;
                out = { ...n, pitch: transposeOctaves(sounding, 1), soundingPitch: sounding, fromFret: true };
              }
            } else if (n.pitch != null && track.writtenOctaveUp) {
              out = { ...n, pitch: transposeOctaves(n.pitch, 1), soundingPitch: n.pitch };
            } else {
              out = n.pitch != null ? { ...n, soundingPitch: n.pitch } : n;
            }
            // Canonical harmonic kind (`harmonicFret` passes through untouched).
            const x = n.harmonic ? { ...out, harmonic: harmonicKind(n.harmonic) } : out;
            return n.trill !== undefined ? { ...x, trill: trillOf(n.trill) } : x;
          }),
        })),
      });
    }
    const out = {
      clef: 'treble',
      showStandardNotation: true,
      showTablature: false,
      ...track,
      writtenOctaveUp: !!track.writtenOctaveUp,
      octaveClef: !!track.writtenOctaveUp || fromFret,
      tuning,
      measures,
    };
    out.tabRhythm = resolveTabRhythm(track.tabRhythm, out);
    out.showChordDiagrams = track.showChordDiagrams === undefined ? out.showTablature : !!track.showChordDiagrams;
    return out;
  });
  return { ...score, measureCount, tracks, navigation: mergeNavigation(rawTracks, measureCount) };
}
