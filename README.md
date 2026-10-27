# music-score

Version 1.0.0 · MIT licence

A small vanilla JavaScript library that draws music notation and guitar tablature as SVG in the browser. You describe a score as plain JSON, and the library renders it with the Bravura music font (SMuFL).

- No build step and no dependencies. Plain ES modules.
- Standard notation staves, tab staves, or both, stacked per track.
- Browser rendering only. There is no playback, editor, or import/export.

## Install

The package is not published to npm yet. Get the code in either of these ways:

- Copy the project folder into your project.
- Or clone the repository with `git clone <repository-url>` and copy the folder.

Keep the folder structure unchanged. The library loads its font from `fonts/`, which must stay beside `src/`.

Then import from `index.js`:

```js
import { MusicScoreRenderer, defaultTheme } from './music-score/index.js';
```

Node.js 20 or later is needed only to run the tests. The browser code has no requirements beyond ES module support.

## Running the demo

The page loads ES modules and a font file, so it must be served over http. Opening `index.html` directly from disk (`file://`) will not work.

From the project folder, start a local server:

```
python -m http.server 8765 --bind 127.0.0.1
```

Then open http://127.0.0.1:8765/index.html

The page shows two scores, each with its title drawn at the top:

- "Demo Riff in D" (`examples/example-score.js`): notation and tab for a guitar track, plus a bass staff.
- "Articulations and fermata" (`examples/articulations-demo.js`): the `articulations` and `fermata` fields.

Open http://127.0.0.1:8765/lead-riff.html for "Lead Riff in A Minor" (`examples/lead-riff.js`): a single notation and tab lead-guitar track.

Any static file server works in place of Python.

For a tour of every feature with live rendered examples and their score JSON, open http://127.0.0.1:8765/docs/features.html (`docs/features.html`).

## Using the library

```js
import { MusicScoreRenderer, defaultTheme } from './index.js';

const renderer = new MusicScoreRenderer(document.getElementById('score'), scoreData, { width: 860 });
renderer.render();
```

### Constructor

`new MusicScoreRenderer(container, score, options)`

- `container`: the HTML element to draw into. Its contents are replaced on every render.
- `score`: a score object (see [Score format](#score-format)).
- `options.width`: render width in px. Defaults to the container's width, or 900 px if that is 0. A score can be drawn wider than this only when one measure cannot fit (see [Layout](#layout)).
- `options.theme`: visual overrides. These are merged over `defaultTheme` one top-level key at a time. Each key you pass replaces that single value, so you can override one key without copying the others. Pixel-based keys are also accepted (see [Theme](#theme)).

### Methods

- `render()`: draws the score. Rebuilds the whole SVG each time. Returns the renderer.
- `setScore(score)`: replaces the score. It does not redraw, so call `render()` afterwards.

### Theme

`defaultTheme` is exported, so you can see every key and its default value. Keys often changed:

- `noteColor`, `staffLineColor`, `tabFretColor`: colours.
- `staffLineSpacing`: scales the whole score (default 10 px). Keys whose name ends in `Sp` are measured in staff spaces (1 sp = `staffLineSpacing` px), so they scale with it.
- `background`: page colour used by the SVG and the backing behind tab fret numbers (default `#ffffff`).

Spacing and margin keys (all in staff spaces, `Sp`):

| Key | Default | Meaning |
|---|---|---|
| `systemGapSp` | 8 | Minimum gap from the last staff of a system to the first staff of the next. |
| `instrumentGapSp` | 6 | Minimum gap from one track to the next, within a system. |
| `notationTabGapSp` | 3.5 | Minimum gap from a track's notation staff to its tab staff. |
| `marginLeftSp`, `marginRightSp`, `marginTopSp` | 3 | Page margins. |
| `measurePaddingSp` | 1.25 | Space from a barline to the first note of the measure. |
| `minNoteSpacingSp` | 1.8 | Smallest gap between two note positions. |
| `quarterSpacingSp` | 3.5 | Ideal gap after a quarter note. Other durations scale by the square root of their length. |
| `graceNoteWidthSp` | 1.2 | Horizontal room for each grace note. |
| `graceNoteScale` | 0.68 | Grace note size relative to a normal note. |

Other keys:

- `staffLineWidth`, `stemWidth`, `beamWidth`: line thickness in px.
- `tabFontSize`, `dynamicFontSize`: text sizes in px.
- `tabStaffLineSpacing`: distance between tab strings in px (default 15). This is a plain px value and does not scale with `staffLineSpacing`.
- Rhythm on TAB staves (see [Rhythm on TAB staves](#rhythm-on-tab-staves)), in staff spaces:

  | Key | Default | Meaning |
  |---|---|---|
  | `tabStemGapSp` | 1.0 | Gap from the bottom string to the top of the stems. The gap never drops below half the height of a fret number's backing plus 0.2 sp, so stems clear the fret numbers on the bottom string. |
  | `tabStemLengthSp` | 2.5 | Stem length for quarter notes and shorter. Each beam level beyond the second adds 0.75 sp, so 32nds are 3.25 sp and 64ths 4 sp. All stems in one beam group have the same length. |
  | `tabHalfStemLengthSp` | 1.25 | Stem length for half notes. Whole notes have no stem. |
  | `tabFlagScale` | 0.75 | Flag size relative to the notation flags (1 = the same size as on the notation staff). |

  The band is drawn in `tabFretColor`. Rest backings use `background`.
- `hammerPullLabels`: `true` (default) shows "H" and "P" above hammer-on and pull-off slurs. `false` draws a plain slur.
- `fontFamily`, `textFontFamily`: font families for the music font and text.
- `glyphSize`: accepted but unused. It has no effect.

#### Older pixel keys (also accepted)

These pixel-based keys are also accepted in `options.theme`. Each one is converted to its `Sp` key (px divided by `staffLineSpacing`). The `Sp` keys are preferred for new code. If you pass both, the `Sp` key wins.

| Pixel key | Sp key |
|---|---|
| `systemGap` | `systemGapSp` |
| `trackGap` | `instrumentGapSp` |
| `notationTabGap` | `notationTabGapSp` |
| `leftMargin` | `marginLeftSp` |
| `rightMargin` | `marginRightSp` |
| `topMargin` | `marginTopSp` |
| `measurePadding` | `measurePaddingSp` |
| `minNoteSpacing` | `minNoteSpacingSp` |
| `spacingFactor` | `quarterSpacingSp` (3.5 × value / 46) |
| `graceNoteWidth` | `graceNoteWidthSp` |

The pixel keys are not in `defaultTheme`. Reading or changing `renderer.theme.systemGap` (or any other pixel key) after construction has no effect. Pass the `Sp` key in `options.theme` instead. The pixel keys may be removed in a future release.

## Score format

A score is nested: score, then tracks, then measures, then beats, then notes. Field names are case-sensitive. There is no schema validation: unknown fields are ignored, and wrong values may throw an error or render oddly.

### Score

| Field | Type | Notes |
|---|---|---|
| `tracks` | array | Required. One entry per track. Tracks stack vertically. |
| `timeSignature` | `{ beats, beatType }` | Default 4/4. Used by tracks that do not set their own. |
| `keySignature` | integer, -7 to 7 | Default 0. Negative values are flats, positive values are sharps. |
| `title` | string | Centred at the top of the page, in the largest text. |
| `composer` | string | Right-aligned at the top of the page, on the line under the title. |
| `tempoText` | string | Bold text above the first system, starting at the time signature. |
| `tuningLabel` | string | Italic text at the left of the line under the title (for example "Standard tuning"). |
| `chordShapes` | object | Optional. Chord-diagram shapes by chord name, e.g. `{ "C": { "frets": ["x", 3, 2, 0, 1, 0] } }`. A beat whose `chord` matches a name gets a diagram. See [Chord diagrams](#chord-diagrams). |

### Track

| Field | Type | Notes |
|---|---|---|
| `measures` | array | Required. |
| `clef` | `'treble'` or `'bass'` | Default `'treble'`. With `writtenOctaveUp` or a note given by string and fret, the clef is drawn as an 8vb clef (see [Pitch and octaves](#pitch-and-octaves)). |
| `showStandardNotation` | boolean | Default `true`. |
| `showTablature` | boolean | Default `false`. When true, the tab staff sits below the notation staff. |
| `tabRhythm` | `'auto'`, `true` or `false` | Default `'auto'`. Draws stems, beams, flags, dots, tuplets and rests on the tab staff. `'auto'` draws them only when the track has no notation staff (`showStandardNotation: false`). `true` also draws them when notation is shown. `false` never draws them, and neither does any track without a TAB staff (`showTablature: false`). Any other value counts as `'auto'`. See [Rhythm on TAB staves](#rhythm-on-tab-staves). |
| `showChordDiagrams` | boolean | Default: the value of `showTablature`. When true, beats with a chord shape get a chord diagram. When false, the track draws no diagrams, even for a beat's own `chordDiagram`. See [Chord diagrams](#chord-diagrams). |
| `tuning` | array of pitches, low to high | Default is standard guitar: `['E2','A2','D3','G3','B3','E4']`. The number of entries sets the number of strings. |
| `timeSignature`, `keySignature` | as above | Override the score's values for this track. |
| `name` | string | Full instrument name, drawn to the left of the first system. |
| `label` | string | Short name (abbreviation), drawn to the left of the systems after the first. See [Instrument names](#instrument-names). |
| `writtenOctaveUp` | boolean | Default `false`. Set to `true` when the `pitch` values you give are sounding pitches and the part is written an octave higher (typical for bass and guitar). |

The examples also set `instrument`. The renderer does not draw it.

Measure columns line up across tracks. The number of measures is the longest track's. A shorter track is padded with empty measures, so every track ends at the same place.

### Measure

| Field | Type | Notes |
|---|---|---|
| `beats` | array | Required. An empty array (`[]`) draws a whole-measure rest. |
| `timeSignature` | `{ beats, beatType }` | Optional. Applies from this measure until it changes. |
| `keySignature` | integer | Optional. Applies from this measure until it changes. |
| `barline` | string | `'single'` (default), `'double'`, `'final'`, `'repeatStart'`, or `'repeatEnd'`. The last measure of the score defaults to `'final'`. |
| `ending` | integer, array or object | Optional. Volta bracket (1st/2nd ending): `1`, `[1, 2]`, or `{ numbers, text, open }`. At most 32 numbers are kept (the lowest). See [Repeats and navigation](#repeats-and-navigation). |
| `segno` | `true` | Optional. Draws a segno sign at the start of the measure. |
| `coda` | `true` | Optional. Draws a coda sign at the start of the measure. |
| `jump` | string | Optional. Jump text at the end of the measure: `'D.C.'`, `'D.C. al Fine'`, `'D.C. al Coda'`, `'D.S.'`, `'D.S. al Fine'`, `'D.S. al Coda'`, `'To Coda'` or `'Fine'`. Other text is drawn as written. |

Barline notes:

- `'repeatStart'` is drawn at the start of its measure, not at the end of the previous one. A single or double barline just before it merges into the repeat sign.
- `'repeatEnd'` on a measure followed by a `'repeatStart'` draws one combined repeat sign.
- Barlines are drawn on each staff separately, so a barline never runs through the gap between a notation staff and its tab staff.

### Repeats and navigation

Four optional measure fields draw volta brackets and navigation marks. They apply to the whole measure column: set them on any track. If two tracks set a different `ending` or `jump` for the same measure, the lowest track index wins. `segno` and `coda` are drawn when any track sets them.

- **Endings** (`ending`): a number (`1`), a list (`[1, 2]`), or an object `{ numbers, text, open }`. Numbers are whole numbers from 1 up. Numeric strings such as `'2'` count, invalid entries are dropped, and at most 32 numbers (the lowest) are kept. The label is "1." or "1., 2.", or `text` when it is set (for example `{ numbers: [3], text: 'Last time' }`).
- **Merging.** Consecutive measures with the same numbers and text share one bracket. A different ending, a measure without one, or a `'repeatStart'` measure starts a new bracket.
- **Closed or open.** The bracket starts with a hook at its opening barline and ends a little before its closing barline. It gets a closing hook when its last measure ends with `'repeatEnd'`. Set `open: true` or `open: false` to override this.
- **Line breaks.** A bracket that crosses a line break is split. The part on the next system starts after the clef and key, with no number and no opening hook. Only the last part can have the closing hook.
- **Segno and coda** (`segno: true`, `coda: true`) are drawn at the start of the measure, after the clef and key on a system's first measure. Only the boolean `true` counts.
- **Jump texts** (`jump`) are drawn in bold italics, ending at the measure's closing barline. The standard texts are matched without regard to case or extra spaces. `'To Coda'` is followed by a small coda sign.
- **Placement.** Everything is drawn above the top staff of each system only, whether it is a notation or a TAB staff. All brackets of a system share one height, and all marks of a system share one baseline. From the staff outward the order is: the music, pick strokes and TAB labels and bends, chord diagrams and chord symbols, fermatas, volta brackets, segno, coda and jump texts, then the tempo. The score gets taller to make room, but the horizontal spacing does not change.
- **Drawing only.** There is no playback, no unrolling of repeats and no check that the marks make musical sense.
- SVG classes: `navigation` (one group per system), `volta` with `volta-closed` or `volta-open`, `volta-number`, `segno`, `coda`, and `jump` with `to-coda` or `fine`. `volta-closed` and `volta-open` describe the whole bracket, so every part of a bracket split across systems carries the same one, even the parts without a closing hook.
- Segno, coda and jump texts in one system share one height, above all of that system's brackets, so a sign can sit higher than the bracket-free measure it belongs to would need.

```json
{ "ending": [1, 2], "barline": "repeatEnd", "jump": "D.S. al Coda", "beats": [] }
```

### Beat

Beats are the rhythmic events in a measure, in order. Each beat is one note, one chord, one rest, or one grace note.

| Field | Type | Notes |
|---|---|---|
| `type` | `'note'`, `'rest'`, or `'grace'` | Required. |
| `duration` | `'whole'`, `'half'`, `'quarter'`, `'8th'`, `'16th'`, `'32nd'`, `'64th'` | Required, except for grace notes. An unknown name throws an error. |
| `dots` | integer, 0 to 4 | Augmentation dots. Default 0. Values above 4 are capped at 4, fractions are rounded down, and numeric strings count as their number (`'1'` is one dot). Anything else that isn't a number counts as 0. |
| `tuplet` | number or `{ count, of }` | `3` means a triplet (3 notes in the time of 2). `of` defaults to 2. Consecutive beats with the same ratio form one bracket once they add up to a complete tuplet. |
| `notes` | array of notes | Required for `note` and `grace`. Several entries make a chord. Rests have no notes. |
| `dynamic` | string | `'p'`, `'pp'`, `'ppp'`, `'mp'`, `'mf'`, `'f'`, `'ff'`, `'fff'`, `'sfz'`, `'rfz'`, `'n'`. Other values print as plain text. Drawn below the notation staff. |
| `chord` | string | Chord symbol drawn above the staff, e.g. `'C'` or `'F/A'`. With a chord diagram, the name is centred above the diagram. |
| `chordDiagram` | shape object or `false` | Optional. A shape for this beat's chord diagram, used instead of the `chordShapes` entry. `false` hides the diagram and keeps the plain chord symbol. See [Chord diagrams](#chord-diagrams). |
| `tremolo` | boolean | Tremolo-picking marks. |
| `vibrato` | boolean | Wavy vibrato line. |
| `palmMute` | boolean | Marks the beat as part of a palm-muted run. Consecutive beats share one "P.M." dashed line, drawn above the tab staff (or below a notation-only staff). |
| `slurStart`, `slurEnd` | boolean | Mark the first and last beat of a slur. A slur that crosses a line break is split into two parts. |
| `articulations` | array of strings | See [Articulations and fermata](#articulations-and-fermata). |
| `fermata` | boolean | See [Articulations and fermata](#articulations-and-fermata). |
| `letRing` | truthy | Let-ring run: consecutive beats share one dashed "let ring" label. See [Picking and playing directions](#picking-and-playing-directions). |
| `pickStroke` | `'down'` or `'up'` | Down-bow ⊓ or up-bow ∨ above the beat. Case-insensitive. Other values are ignored. |
| `whammy` | `true`, a string or number, or `{ type: 'dip', amount }` | Whammy-bar dip on the TAB staff, shown as a V with `-amount` above it. `true` means `'1/2'`. Other `type` values are ignored. TAB only. |

Notes: eighth notes and shorter are beamed automatically within each beat (the beat unit set by the time signature). A `grace` beat is a small ornament with no duration. It is drawn just before the next beat and automatically slurred to it.

### Note

Each entry in a beat's `notes` array.

| Field | Type | Notes |
|---|---|---|
| `pitch` | string | Pitch: a letter A to G, an optional accidental (`#`, `b`, `x`, `##`, `bb`), then the octave. Examples: `'E4'`, `'F#3'`, `'Bb2'`. Middle C is `C4`. Required for notation unless `string` and `fret` are given. See [Pitch and octaves](#pitch-and-octaves). |
| `accidental` | `'sharp'`, `'flat'`, `'natural'`, `'doubleSharp'`, `'doubleFlat'` | Explicit accidental. Always drawn, and overrides the key signature for this note. |
| `tieStart`, `tieEnd` | boolean | Tie to the next note of the same pitch. Enharmonic spellings count as the same pitch (C#4 ties to Db4). A tie that crosses a line break is split into two parts. |
| `string` | integer | Tab only. String 1 is the highest-pitched (top line). |
| `fret` | integer | Tab only. 0 is an open string. If `pitch` is missing, it is worked out from `string`, `fret`, and the track's `tuning`. |
| `hammerPull` | `true`, `'h'`, or `'p'` | Tab only. Slur to the next note on the same string. `true` picks hammer-on or pull-off from the fret direction. |
| `slide` | `true`, `'up'`, or `'down'` | Tab only. Slide to the next note on the same string. A slide that crosses a line break ends in a short stub at the end of the line. |
| `bend` | `true`, a string, or `{ amount, release, hold }` | Tab only. Amount such as `'1/2'`, `'full'`, `'1 1/2'`, or `'2'`. Add `' release'` or `' hold'` to the string, e.g. `'full release'`, `'1/2 hold'`. `true` means `'full'`. |
| `mute` | boolean | Dead or muted note. Drawn as an x notehead (notation) or x (tab). |
| `ghost` | boolean | Ghost note. Drawn in parentheses. |
| `harmonic` | `true`, `'natural'`, `'artificial'`, `'pinch'`, `'tapped'`, or `'semi'` | Guitar harmonic (see [Harmonics](#harmonics)). Case-insensitive. `true` and unknown strings count as `'natural'`. `false` or omitted means no harmonic. A muted note is never a harmonic. |
| `harmonicFret` | integer | Touched fret of an `'artificial'` or `'tapped'` harmonic, shown on tab as `5(17)`. Ignored for other kinds, and when not an integer. |
| `tap` | truthy | Tap "T" above the beat, on notation and TAB (one per beat). A tapped harmonic shows only its `T.H.` label. See [Picking and playing directions](#picking-and-playing-directions). |

Example: a tab-only note needs no `pitch`.

```json
{ "type": "note", "duration": "8th", "notes": [{ "string": 1, "fret": 5, "hammerPull": true }] }
```

### Pitch and octaves

Guitar and bass music is written an octave higher than it sounds. The library follows that convention:

- A note given by `string` and `fret` is written an octave above its sounding pitch. Its staff is drawn with an 8vb clef.
- A note given by `pitch` is drawn exactly as written, unless its track sets `writtenOctaveUp: true`. In that case the `pitch` is treated as the sounding pitch and is drawn an octave higher, with an 8vb clef.

Tie matching uses the pitch, not the spelling, so enharmonic spellings tie together.

Pitches worked out from string and fret always use sharps (e.g. A#, never Bb).

### Harmonics

Set `harmonic` on a note to draw a guitar harmonic. Notation is drawn at the note's written pitch. For a note given by `string` and `fret`, that is the fretted position (the touch point).

| `harmonic` | Notation | Tab | Label above tab |
|---|---|---|---|
| `true` or `'natural'` | Diamond notehead, same duration rules as a normal notehead | `<12>` (fret in angle brackets) | none |
| `'artificial'` | Normal notehead | `5(17)` when `harmonicFret` is set, otherwise `5` | `A.H.` |
| `'tapped'` | Normal notehead | As for artificial | `T.H.` |
| `'pinch'` | Normal notehead | Plain fret | `P.H.` |
| `'semi'` | Normal notehead | Plain fret | `S.H.` |

- Labels are dashed runs like palm mute: consecutive beats with the same label share one label and one dashed line. The labels sit in the lane above the tab, or below a notation-only staff.
- A rest, a grace note, or a beat with a different label starts a new run.
- A beat with several harmonics shows one label, chosen by priority: A.H. over T.H. over P.H. over S.H.
- A P.M. label sits nearest the staff, and a harmonic label sits one lane further out where they overlap.
- A label moves clear of a bend. It starts just after the bend's text if it can, or moves out a lane.
- A muted note is drawn as an x, with no diamond and no label.
- Ghost notes wrap the tab text in parentheses: `(<12>)` and `(5(17))`.
- A natural harmonic on a bend shows no landing fret.
- In a chord, only the harmonic notes change shape. Their noteheads stay on the stem side of the chord.
- Grace notes get a diamond (natural) or the TAB text, but no A.H., T.H., P.H. or S.H. label. See [Known limitations](#known-limitations).

Example: the note is fretted at the 5th fret on string 5, and the harmonic is touched at the 17th fret. Tab shows `5(17)` with an `A.H.` label above it.

```json
{ "type": "note", "duration": "quarter", "notes": [{ "string": 5, "fret": 5, "harmonic": "artificial", "harmonicFret": 17 }] }
```

### Picking and playing directions

Four optional fields draw playing marks: `letRing` and `pickStroke` on a beat, `whammy` on a beat, and `tap` on a note. None of them change the rhythm or the note spacing.

- **Let ring** (`letRing`): consecutive beats with `letRing` share one dashed "let ring" label, drawn like the P.M. line. An unmarked rest between two let-ring beats of the same system continues the run. A note or grace note without `letRing` ends it, and so does a line break. On a track with TAB, the label sits in the outermost lane, outside any P.M. or harmonic label it overlaps. On a notation-only staff it sits below the staff.
- **Pick strokes** (`pickStroke`): `'down'` draws ⊓ and `'up'` draws ∨, one per beat. Values are case-insensitive, and other values are ignored. On a track with a notation staff, the stroke sits above the staff. It stacks above stems, articulations, slurs (just above the slur at that beat), tuplet brackets and any tap "T". Chord symbols and fermatas sit above it. Strokes on the beats of one beam group share one height. On a tab-only track, the stroke sits above the TAB staff. Pick strokes are not drawn on the TAB staff when the track also shows notation.
- **Tapping** (`tap` on a note): draws a bold "T" once per beat, above the note on notation and above the fret on TAB. On TAB it is raised above an H or P letter when they would touch. A tapped harmonic already shows `T.H.`, so it gets no extra "T".
- **Whammy dip** (`whammy`): a V with `-amount` above it, drawn on the TAB staff only. Notation-only tracks ignore it. The V starts just right of its note, as a bend does, and is shortened before the next beat or barline. A dip on a beat that also has a bend stacks above the bend. `true` means `'1/2'`. Leading minus signs are removed and one "-" is shown, so `'-1'` and `1` both show `-1`.
- Rests and grace notes ignore `pickStroke`, `tap` and `whammy`.

```json
{ "type": "note", "duration": "8th", "pickStroke": "down", "notes": [{ "string": 1, "fret": 5, "tap": true }] }
```

### Rhythm on TAB staves

A tab-only track (`showStandardNotation: false`, `showTablature: true`) shows its rhythm on the TAB staff by default, as in tab books and Guitar Pro. Set `tabRhythm: false` on the track to hide it. A track that also shows notation gets it only with `tabRhythm: true`.

- **Stems** hang down from a line just below the bottom string, one per note or chord, at the fret number's position. They never cross the staff. Half notes get a shorter stem and whole notes none. A beat with no string and fret still gets a stem.
- **Beams** follow the same groups as notation (per beat, dotted beats in compound meters). They are horizontal, at the stem ends, with extra beams stacked toward the staff. A short beam stub marks a lone shorter note in a group.
- **Flags** are drawn on unbeamed 8th to 64th notes, smaller than notation flags (`tabFlagScale`).
- **Augmentation dots** sit on one row just below the stem tops, right of the stem (or the flag).
- **Tuplets** show their number under the beam when one beam group covers exactly the tuplet. Otherwise a bracket with upward ticks is drawn below the stems.
- **Rests** are drawn inside the TAB staff. A whole rest hangs from a string near the middle of the staff and a half rest sits on one. Shorter rests are centred on the staff, over a backing that hides the string lines.
- **Empty measures.** A measure with `beats: []` shows a whole-measure rest. Measures added to pad a shorter track stay blank.
- Grace notes get no stem, flag or beam. Ties are not drawn. The tied fret number is shown as usual.
- Marks above the TAB staff (H/P, bends, P.M., vibrato and the others) do not move. The band adds about 3.5 staff spaces below the TAB staff, and more with tuplet numbers or 32nd/64th notes. Flags, dots and rests can also need extra horizontal room.
- On a track that shows notation and TAB with `tabRhythm: true`, the notation staff is unchanged. Only the TAB staff gets the band, which sits between the TAB staff and the next instrument or system.
- SVG classes: `tab-rhythm` (one group per measure), `tab-rest` (each rest) and `tab-tuplet` (each tuplet number or bracket).

```json
{ "name": "Gtr", "showStandardNotation": false, "showTablature": true, "tabRhythm": false, "measures": [] }
```

### Chord diagrams

A chord diagram is a small fretboard box drawn above the chord symbol, as in lead sheets and guitar books. Diagrams are drawn at each chord change: every beat whose chord has a shape gets one.

**Shape.** A shape is an object:

| Field | Type | Notes |
|---|---|---|
| `frets` | array, low string to high string | Required. One entry per string, in the same order as `tuning` (low to high). A whole number from 0 to 24 is the fret (0 = open). `'x'`, `'X'`, `null` or `-1` is a muted string. |
| `fingers` | array, low string to high string | Optional. One entry per string: 1 to 4, or `'T'` for the thumb. `0` or `null` means no finger. Drawn under the grid. |
| `barre` | `{ fret, from, to }` | Optional. A solid bar across the strings `from` to `to` at `fret`. `from` and `to` use the `string` numbering of notes: 1 is the highest string. The default is from the lowest string to string 1. |
| `baseFret` | whole number | Optional. The fret of the first row. By default the grid starts at fret 1 (drawn with a nut) when no fret is above 4. Otherwise it starts at the lowest fretted fret, shown as "5fr" right of the first row. |

`frets` and `fingers` run low to high (left to right in the diagram), but `barre` counts strings like notes do, from the highest (1). For a standard six-string guitar, `{ "fret": 1 }` covers all six strings and `{ "fret": 5, "from": 5 }` covers strings 5 to 1.

```json
{
  "chordShapes": {
    "C": { "frets": ["x", 3, 2, 0, 1, 0], "fingers": [0, 3, 2, 0, 1, 0] },
    "F": { "frets": [1, 3, 3, 2, 1, 1], "fingers": [1, 3, 4, 2, 1, 1], "barre": { "fret": 1 } },
    "D": { "frets": ["x", 5, 7, 7, 7, 5], "barre": { "fret": 5, "from": 5 } }
  }
}
```

**Which shape a beat gets.** In this order:

1. If the track's `showChordDiagrams` is false, no diagram. This also applies to a beat's own `chordDiagram`.
2. If the beat sets `chordDiagram: false`, no diagram. The chord symbol is drawn as plain text.
3. If the beat sets `chordDiagram` to a shape object, that shape. If the shape is invalid, the beat gets a plain chord symbol. The `chordShapes` entry is not used as a fallback.
4. Otherwise, the `chordShapes` entry whose name equals the beat's `chord`, with spaces trimmed from both ends. Names are case-sensitive. Only the object's own keys count, so `'constructor'` or `'toString'` never match by accident.
5. Otherwise, no diagram: the chord symbol is drawn as plain text.

Other `chordDiagram` values (`true`, strings, numbers) are ignored, so step 4 applies. A beat with a `chordDiagram` shape but no `chord` gets a diagram without a name. Whole-measure rests never get a diagram.

**Which tracks.** `showChordDiagrams` defaults to the track's `showTablature`, so tracks with TAB show diagrams as soon as the score has `chordShapes`. Notation-only tracks (lead sheets) need `showChordDiagrams: true`. On a track with a notation staff, diagrams go above the notation staff. On a tab-only track, they go above the TAB staff, outside pick strokes, P.M. and other labels, and bends. Their names go with them. A tab-only track still draws no plain chord symbols.

**Placement.**

- The diagram is centred on its beat. Near the start or end of a system it is moved inwards, so it starts after the clef and key and ends before the end of the staff.
- All diagrams of one staff in one system sit in one row, bottom-aligned, with the same number of rows (4, or 5 when a shape needs it). The row sits clear of the music.
- Diagram names and plain chord symbols of the staff share one baseline above the row. Plain symbols still start at their beat.
- Fermatas, volta brackets, segno, coda, jump texts and the tempo sit above the diagrams. The staff gets taller to make room, but the horizontal spacing does not change.

**Validation and fallback.**

- A shape is invalid, and the beat gets a plain chord symbol, when it is not an object, when `frets` does not have exactly one entry per string, when an entry is not a fret or a muted mark (for example `'3'`, `2.5` or `25`), or when the fretted notes span more than 5 frets. The track must have 3 to 10 strings.
- A shape with every string muted is valid. It draws an empty grid with × marks.
- A bad `fingers` array (wrong length) is dropped. A bad finger, or a finger on an open or muted string, is left out.
- A bad `barre` (fret outside the grid, a string outside the track, or fewer than 2 strings) is dropped.
- A bad `baseFret` (not a whole number, above the lowest fretted fret, or one that would need more than 5 rows) is replaced by the default.

**Drawing.** Strings are vertical lines, frets horizontal. The grid has a thick nut at the top when it starts at fret 1. Fretted notes are dots, a barre is a bar with rounded ends that replaces the dots under it, open strings get ○ and muted strings × above the grid, and fingers are numbers under the grid. All sizes are in staff spaces, so diagrams scale with `staffLineSpacing`. A six-string diagram is about 5 staff spaces wide.

SVG classes: `chord-diagram` (one group per diagram), `chord-diagram-grid`, `chord-diagram-nut`, `chord-diagram-base-fret` ("5fr"), `chord-diagram-fret` (dots), `chord-diagram-barre`, `chord-diagram-open`, `chord-diagram-muted` and `chord-diagram-finger`. The name above a diagram has the class `chord-symbol`, like a plain chord symbol.

```json
{ "type": "note", "duration": "quarter", "chord": "G", "chordDiagram": { "frets": [3, 2, 0, 0, 3, 3], "fingers": [2, 1, 0, 0, 3, 4] }, "notes": [{ "string": 6, "fret": 3 }] }
```

## Layout

The renderer spaces and breaks the score for you. A short list of what to expect:

- **Justified systems.** Each system except the last is stretched to the full width. The last system is stretched too if it is at least 75% full. Otherwise it keeps natural spacing and ends at its last barline.
- **Time signatures** are drawn at the start of the score and where they change, not at the start of every system. Clef and key signature repeat at the start of each system. Where a key or time change falls at the end of a system, a courtesy signature shows it.
- **Measure numbers** are shown at the start of systems 2 onward, in italics above the top staff. Measure 1 is not numbered.
- **Joining line and bracket.** Staves in a system are joined by a line at the left. A notation staff and its tab staff are bracketed when the system holds two or more instruments.
- **Instrument names** are drawn horizontally to the left of the system. See [Instrument names](#instrument-names).
- **Accidentals** last until the end of their measure. The next measure starts again from the key signature. A tied note that starts a new system repeats its accidental.
- **Ties and slurs** sit on the side opposite the stems. Ties, slurs, hammer-ons and pull-offs that cross a line break are split into two parts.
- **Beaming.** Eighth notes and shorter beam within each beat. Compound meters group by dotted beat, so 6/8 beams as two groups of three and 12/8 as four.
- **Chord symbols and dynamics** each sit on one line per system: chord symbols above the staff, dynamics below it. Both are kept clear of the notes. Chord diagrams sit in one row per system staff, between the music and the chord-symbol line (see [Chord diagrams](#chord-diagrams)).
- **Technique labels** (P.M. and harmonic labels) are placed clear of bend arrows and text, starting after a bend or moving out a lane when needed.
- **Vertical spacing depends on the content.** Staves with tall notes or chords get more room. Sparse staves get less.
- **TAB clef.** Six-string and four-string tabs use the standard TAB clef. Other string counts use the letters T, A and B.
- **Wide measures.** A measure that cannot fit at the requested width makes the SVG wider than `options.width`. The root `<svg>` then has `data-overflow="true"`.
- **Accessibility.** The SVG has `role="img"`, a `<title>` (the score title) and a `<desc>` (a short summary of the instruments, length and key).

### Instrument names

| Track has | System 1 shows | Later systems show |
|---|---|---|
| `name` and `label` | `name` | `label` |
| `name` only | `name` | nothing |
| `label` only | `label` | `label` |
| neither | nothing | nothing |

The left indent of each system is widened to fit its names, so the first system and later systems can have different indents.

## Articulations and fermata

Two optional beat fields. Both draw on the notation staff only.

### `articulations`

An array of strings on a `note` beat. Allowed values: `'staccato'`, `'accent'`, `'tenuto'`. Values are case-sensitive.

- Marks are drawn once per beat and apply to the whole chord. You do not choose a side.
- Marks go on the side opposite the stem. A note whose stem points up gets its marks below. A note whose stem points down gets its marks above.
- A beamed note takes its beam group's stem direction, so the group decides the side.
- A whole note has no stem. It gets marks below if its position is below the middle line, otherwise above.
- In a chord, the marks attach to the outermost notehead on that side.
- Marks stack outward from the notehead in a fixed order: staccato nearest, then tenuto, then accent. The order in your array does not matter.
- Duplicates are ignored. Unknown values (for example `'marcato'`) and non-array values are ignored without an error.
- Ignored on rests, grace notes, and tab staves.

### `fermata`

`fermata: true` on a `note` or `rest` beat draws a fermata above the beat.

- Only the boolean `true` counts. The string `'true'` or the number `1` draws nothing.
- The fermata sits above everything else on that beat: the staff, stem, noteheads, articulation marks, slurs, tuplet brackets, vibrato or tremolo marks, and any chord symbol or chord diagram.
- Ignored on grace notes and tab staves.

### Example

```json
{ "type": "note", "duration": "quarter", "articulations": ["staccato", "accent"], "fermata": true, "notes": [{ "pitch": "E4" }] }
```

E4 is below the middle line, so its stem goes up and the marks go below the notehead.

The demo score in `examples/articulations-demo.js` (exported as `articulationsScore`) shows each mark, the stacking order, chords, beamed groups, whole notes, fermatas on notes, rests, chord symbols, slurs and tuplets, and how dynamics and ties sit with the marks.

These fields do not change the API or the theme.

## Known limitations

- **Dots on chords with seconds.** Augmentation dots on a chord whose notes sit a second apart may not be placed cleanly.
- **Grace notes.** Accidentals on grace notes are not handled yet. A slur from a grace note that crosses a line break is not split.
- **Chord symbols.** Adjacent wide chord symbols can overlap each other horizontally. On tab-only tracks, chord symbols are drawn only above a chord diagram.
- **Chord diagrams: overlap.** Diagrams get no horizontal space, so chord changes on close beats can overlap each other or a neighbouring chord symbol.
- **Chord diagrams: names.** Only the diagram is moved inwards at the start or end of a system. A long name centred above it can still reach past the staff. A segno or coda at the start of a measure may sit beside a diagram name rather than above it.
- **Chord diagrams: no capo or left-handed diagrams**, no chord chart at the top of the score, and no chord library: every shape comes from the score. Shapes are not checked against the chord name or the tuning.
- **Chord diagrams: taller systems.** With diagrams, a staff reaches about 10 to 11 staff spaces above its top line, against about 4 for a plain chord symbol, so systems get taller and fewer fit on a page.
- **Time signatures across tracks.** Tracks cannot have different time signatures within the same measure column.
- **Estimated sizes.** Glyph and text widths are estimated, not measured from the font. Spacing may look slightly different with another font or at unusual sizes.
- **Rhythm on TAB staves.** One voice per track only. Ties are not shown in the rhythm band, and rhythm slashes and tied-fret display are not drawn. Tremolo picking stays above the fret number and is not drawn on the stem. On staves with four strings or fewer, 32nd and 64th rests can reach a little past the outer string lines; the gap to the staff above grows to fit them.
- **Measure count.** Shorter tracks are padded with empty measures (whole-measure rests in notation, blank tab, no rest on a TAB rhythm staff). Their `measures` array is not extended in the input.
- **Errors.** An unknown duration or an invalid pitch throws an error, and nothing is drawn for that score.
- **Dynamics.** Only the names listed under `dynamic` are drawn as symbols. Other names print as plain text.
- **No validation, no `schemaVersion`.** A malformed score may throw or render oddly.
- **Harmonics: sounding pitch.** A natural harmonic is drawn at the fretted (touch) pitch, written an octave above sounding pitch. Sounding-pitch notation and 8va markings for harmonics are not supported.
- **Harmonics: heads.** An A.H. or other artificial harmonic has a single notehead. Double noteheads (touch and sounding) are not drawn.
- **Harmonics: frets.** `harmonicFret` must be a whole number. Fractional frets are not supported.
- **Harmonics: grace notes.** A grace note with `harmonic` gets its diamond (natural) and its TAB text, but no A.H., T.H., P.H. or S.H. label. TAB labels on grace notes get no extra spacing, and grace diamonds sit slightly short of the stem.
- **Harmonics: tuplets.** Tuplet brackets use the oval notehead width, so around a diamond they sit slightly wide.
- **Harmonics and bends.** A palm-mute dashed line may cross a bend arrow in the middle of a run. It never crosses the bend's amount text.
- **Whammy dips only.** Dive, return, scoop, pre-dive and "w/bar" are not drawn. The dip depth is fixed.
- **Pick strokes and TAB.** Pick strokes are not drawn on the TAB staff when the track also shows notation.
- **Playing directions take no extra room.** Pick strokes, "T" marks and dips get no extra horizontal space, so a dense beat can crowd. Examples: a pick stroke next to a vibrato, or a dip close to the next note.
- **Let ring has no ties.** A let-ring run is a dashed label only. There are no per-note ring-out ties.
- **Navigation is drawn, not played.** Repeats, endings and jumps are not unrolled or checked for sense. There are no repeat counts ("x3") or rehearsal marks.
- **Coda layout.** A coda does not force a line break or leave a gap before it.
- **Navigation on the top staff only.** Brackets and marks are drawn once per system, above the top staff. There are no brackets per instrument group.
- **One bracket height per system.** All volta brackets of a system sit at the height of the tallest one.
- **Long navigation text.** A long jump text can reach left into the previous measures, and marks in adjacent narrow measures can crowd each other. A long ending label can run past the end of its bracket. Text widths are estimated, so the spacing around these marks is approximate.
- **Not included:** playback, an editor, import/export of other file formats, and multiple voices in one track.

## Running tests

From the project folder, run either command. They are the same:

```
npm test
node tests/run.js
```

This runs every test:

- Snapshot tests: renders the example scores and the characterization fixtures (`tests/fixtures/characterization.js`) and compares the SVG output with the saved snapshots in `tests/snapshots/`. Missing snapshots are created on the first run.
- Unit checks (`tests/units.mjs`): beaming, accidentals, pitch and fret helpers, and normalization.
- Engraving checks (`tests/engraving.mjs`): alignment, justification, signatures, barlines, vertical spacing, octaves, ties, and robustness at several widths.
- Articulation and fermata assertions (`tests/articulations.mjs`).
- Structural guards for the score-wide passes (`tests/structure.mjs`).
- A determinism check: the same score renders the same SVG twice.

It prints `ALL PASSED` and exits with code 0 on success.

- Use `node tests/run.js --update` only when a rendering change is intentional. It rewrites the existing snapshots.
- To run one group on its own: `node tests/units.mjs`, `node tests/engraving.mjs`, or `node tests/articulations.mjs`.

## Changelog

### 1.0.0 — 2026-10-27

Initial public release.

**Notation and layout**

- Standard notation, TAB, or both, stacked per track, with several tracks and systems.
- Justified systems with clefs, key and time signatures, measure numbers and instrument names.
- Ties, slurs and tuplets, compound-meter beaming (6/8, 12/8), and grace notes. Ties and slurs split across a line break.
- Title, composer, tempo text and tuning label.

**Guitar and TAB**

- Rhythm on TAB staves: stems, beams, flags, dots, tuplets and rests.
- Bends, slides, hammer-ons and pull-offs (H and P), palm mutes (P.M.), let ring, whammy-bar dips, and tapping (T).
- Harmonics: natural, artificial, tapped, pinch and semi, with labels and touched-fret notation such as `5(17)`.
- Pick strokes, down and up.

**Repeats and navigation**

- Volta brackets (1st and 2nd endings).
- Segno and coda signs, and jump texts such as D.C. al Fine and D.S. al Coda.

**Chords**

- Chord symbols above the staff.
- Chord diagrams from a `chordShapes` table, with barres, fingerings and a base fret shown as "5fr".

**Articulations, fermatas and dynamics**

- Staccato, accent and tenuto marks, fermatas, and dynamics from p to fff, plus sfz, rfz and n.

**Theme and accessibility**

- Theme sizes are in staff spaces, so a score scales with `staffLineSpacing`.
- The SVG has `role="img"`, a title and a description.

**Dependencies**

- None. Plain ES modules and no build step.

## Project layout

- `index.js`: public exports (`MusicScoreRenderer`, `defaultTheme`).
- `package.json`: package metadata and the `npm test` and `npm run demo` scripts.
- `LICENSE`: the MIT licence for the code.
- `.gitignore`: keeps local tooling folders and logs out of the repository.
- `src/`: the renderer. Rendering runs normalize, then layout, then draw.
  - `MusicScoreRenderer.js`: the entry point (the `MusicScoreRenderer` class). It runs the pipeline and mounts the SVG.
  - `normalize.js`: fills in score defaults (sticky time and key signatures, barlines, measure count, pitch from string and fret, written and sounding pitch, `tabRhythm`, padded measures).
  - `harmonics.js`: guitar harmonic kinds and the helpers that layout, drawing and labels share.
  - `directions.js`: the playing direction fields (let ring, pick strokes, tap, whammy dip) and their canonical values.
  - `chordShapes.js`: chord-diagram shapes. Validates an author's shape against the track and picks the shape a beat shows.
  - `navigation.js`: the navigation fields (`ending`, `segno`, `coda`, `jump`), their canonical values and the merge across tracks.
  - `layout/`: positioning, no drawing.
    - `index.js`: `computeLayout`. Ties the layout steps together and sets element positions.
    - `timeline.js`: the shared note timeline across tracks and the horizontal spacing.
    - `chord.js`: chord geometry (seconds, accidental columns, dots, ledger lines).
    - `accidentals.js`: accidentals carried through a measure.
    - `systems.js`: system breaking, justification, headers, courtesy signatures, instrument-name indents.
    - `beams.js`: beams and tuplet groups, including compound meters.
    - `vertical.js`: places each staff vertically from its content.
    - `ink.js`: measures the drawn extent of each staff. An opt-in overlap mode counts every mark whose width reaches into an x range.
    - `navigation.js`: groups endings into volta brackets, splits them at line breaks and places the segno, coda and jump marks horizontally.
    - `tabRhythm.js`: geometry of the rhythm on TAB staves (stem positions and lengths, flags, dots, horizontal room).
  - `draw/`: SVG drawing.
    - `system.js`: draws one system and its measures.
    - `staff.js`: staff lines, clefs, key and time signatures, barlines.
    - `notation.js`: notes, stems, beams, articulations, fermatas, tuplets, chord symbols, ties and slurs.
    - `tab.js`: tab staff, fret numbers, tab clef, hammer-ons, slides, bends and palm mutes.
    - `tabRhythm.js`: rhythm on TAB staves (stems, beams, flags, dots, tuplets and rests), drawn per measure.
    - `chordDiagram.js`: one chord diagram (the fretboard box with its dots, barres, fingers and name).
    - `passes.js`: the score-wide passes, drawn after all systems; re-exports them from `passes/` and documents their order.
      - `passes/common.js`: helpers shared by the passes.
      - `passes/notationBeats.js`: notation beats, slurs and the space above a beat, shared by several passes.
      - `passes/curves.js`: ties, slurs and grace-note slurs.
      - `passes/tabTechniques.js`: tab techniques (hammer-ons, slides, bends, tap "T", whammy dips).
      - `passes/techniqueLabels.js`: technique labels (P.M., harmonics, let ring).
      - `passes/playingDirections.js`: pick strokes and notation tap "T".
      - `passes/chordsFermatas.js`: chord symbols and dynamics, and fermatas.
    - `header.js`: title, composer and tuning rows.
    - `navigation.js`: volta brackets, segno, coda and jump texts above each system's top staff, drawn after the fermatas and before the tempo.
    - `decor.js`: tempo, measure numbers, joining line, bracket and instrument names.
    - `svgUtil.js`: small SVG helpers.
  - `theme.js`: theme defaults and the pixel-key conversion.
  - `glyphs.js`: Bravura glyph names. `glyphMetrics.js`: approximate glyph bounding boxes. `textMetrics.js`: estimated text widths.
  - `font.js`: font loading. `pitch.js`, `duration.js`: pitch and duration helpers. `rational.js`: exact fractions for note timing.
- `examples/`: sample scores.
- `fonts/`: the Bravura font (SIL Open Font License; see `fonts/BRAVURA-LICENSE.txt`).
- `tests/`: snapshot tests, unit checks, engraving checks, assertions and structural guards (`run.js`, `units.mjs`, `engraving.mjs`, `articulations.mjs`, `structure.mjs`), the test hooks and DOM shim the runner uses (`hooks.mjs`, `dom-shim.mjs`), the characterization fixtures (`fixtures/characterization.js`), and the saved snapshots (`snapshots/`).
- `index.html`: the demo page. `lead-riff.html`: a second demo page for the lead-riff example.
- `docs/features.html`: feature summary page with live examples (serve over http, like the demo).
- `docs/ARCHITECTURE.md`: design notes for a future editor, import and export layer (not built yet).

## License

- The code is licensed under the MIT License. See `LICENSE`.
- The Bravura font in `fonts/` is licensed under the SIL Open Font License, Version 1.1. See `fonts/BRAVURA-LICENSE.txt`.
