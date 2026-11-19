# music-score

Version 1.9.0 · MIT licence

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

Open http://127.0.0.1:8765/lead-solo-f.html for "Lead Solo in F" (`examples/lead-solo-f.js`): an original 12-measure lead solo at ♩ = 120 that combines triplets, hammer-ons and pull-offs, grace-note slides, ties, 3rds and 6ths, bends and chord symbols in one score.

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
- `hammerPullSlurs`: `true` (default) also draws a slur on the notation staff for each hammer-on and pull-off run. `false` leaves the notation without them, as in 1.2.0.
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
| `subtitle` | string | Centred under the title, in a smaller text. See [Page header](#page-header). |
| `artist` | string | Centred under the subtitle, smaller again. |
| `album` | string | Centred under the artist, smaller again. |
| `composer` | string | Right-aligned at the top of the page, on the line under the title. |
| `words` | string | "Words by" line at the left, under the composer line. See [Page header](#page-header). |
| `music` | string | "Music by" line at the right, beside `words`. When it equals `words`, one "Words & Music by" line is drawn instead. |
| `tempoText` | string | Bold text above the first system, starting at the time signature. |
| `tuningLabel` | string | Italic text at the left of the line under the title (for example "Standard tuning"). |
| `instructions` | string | Italic lines under the credits, one per line break (`\n`). Up to 8 lines are drawn. |
| `copyright` | string | Centred lines at the foot of the score, under the last system, one per line break. Up to 8 lines are drawn, and the score grows to fit them. |
| `showTuningChart` | `true` | Optional, off by default. `true` lists the strings tuned differently from the usual tuning in the header. See [Capo and tuning chart](#capo-and-tuning-chart). |
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
| `capo` | integer, 1 to 30 | Optional. Adds "Capo fret N" to this track's line in the header. Display only: the music is not transposed. A numeric string such as `'2'` counts. See [Capo and tuning chart](#capo-and-tuning-chart). |
| `tiedFrets` | `'parens'` | Optional. On the TAB staff, puts parentheses around the fret number of a note that is tied to the one before, such as `(5)`. Any case, spaces ignored. Other values do nothing. Off by default. See [Tied fret numbers](#tied-fret-numbers). |

The examples also set `instrument`. The renderer does not draw it.

Measure columns line up across tracks. The number of measures is the longest track's. A shorter track is padded with empty measures, so every track ends at the same place.

### Measure

| Field | Type | Notes |
|---|---|---|
| `beats` | array | Required unless `voices` is given. An empty array (`[]`) draws a whole-measure rest. |
| `voices` | array of `{ beats }` | Optional. Two rhythms on one staff: the first entry is voice 1 (stems up), the second is voice 2 (stems down). When it is set, `beats` is ignored. See [Voices](#voices). |
| `timeSignature` | `{ beats, beatType }` | Optional. Applies from this measure until it changes. |
| `keySignature` | integer | Optional. Applies from this measure until it changes. |
| `barline` | string | `'single'` (default), `'double'`, `'final'`, `'repeatStart'`, or `'repeatEnd'`. The last measure of the score defaults to `'final'`. |
| `ending` | integer, array or object | Optional. Volta bracket (1st/2nd ending): `1`, `[1, 2]`, or `{ numbers, text, open }`. At most 32 numbers are kept (the lowest). See [Repeats and navigation](#repeats-and-navigation). |
| `segno` | `true` | Optional. Draws a segno sign at the start of the measure. |
| `coda` | `true` | Optional. Draws a coda sign at the start of the measure. |
| `jump` | string | Optional. Jump text at the end of the measure: `'D.C.'`, `'D.C. al Fine'`, `'D.C. al Coda'`, `'D.S.'`, `'D.S. al Fine'`, `'D.S. al Coda'`, `'To Coda'` or `'Fine'`. Other text is drawn as written. |
| `section` | `'Verse'` or `{ letter, text }` | Optional. A section marker above the top staff: a boxed letter with the text after the box, or boxed text alone. A letter is 1 to 3 characters. See [Repeats and navigation](#repeats-and-navigation). |
| `repeatCount` | integer, 2 to 99 | Optional. Draws `x3` at the end of a measure with a `'repeatEnd'` barline. Without a repeat end, nothing is drawn. A numeric string such as `'3'` counts. |

Barline notes:

- `'repeatStart'` is drawn at the start of its measure, not at the end of the previous one. A single or double barline just before it merges into the repeat sign.
- `'repeatEnd'` on a measure followed by a `'repeatStart'` draws one combined repeat sign.
- Barlines are drawn on each staff separately, so a barline never runs through the gap between a notation staff and its tab staff.

### Repeats and navigation

Optional measure fields draw volta brackets, navigation marks, repeat counts and section markers. They apply to the whole measure column: set them on any track. If two tracks set a different `ending`, `jump`, `section` or `repeatCount` for the same measure, the lowest track index wins. `segno` and `coda` are drawn when any track sets them. A repeat count needs a `'repeatEnd'` barline in that measure on some track.

- **Endings** (`ending`): a number (`1`), a list (`[1, 2]`), or an object `{ numbers, text, open }`. Numbers are whole numbers from 1 up. Numeric strings such as `'2'` count, invalid entries are dropped, and at most 32 numbers (the lowest) are kept. The label is "1." or "1., 2.", or `text` when it is set (for example `{ numbers: [3], text: 'Last time' }`).
- **Merging.** Consecutive measures with the same numbers and text share one bracket. A different ending, a measure without one, or a `'repeatStart'` measure starts a new bracket.
- **Closed or open.** The bracket starts with a hook at its opening barline and ends a little before its closing barline. It gets a closing hook when its last measure ends with `'repeatEnd'`. Set `open: true` or `open: false` to override this.
- **Line breaks.** A bracket that crosses a line break is split. The part on the next system starts after the clef and key, with no number and no opening hook. Only the last part can have the closing hook.
- **Segno and coda** (`segno: true`, `coda: true`) are drawn at the start of the measure, after the clef and key on a system's first measure. Only the boolean `true` counts.
- **Jump texts** (`jump`) are drawn in bold italics, ending at the measure's closing barline. The standard texts are matched without regard to case or extra spaces. `'To Coda'` is followed by a small coda sign.
- **Section markers** (`section`): `'Verse'` draws the text in a box. `{ letter: 'A', text: 'Intro' }` boxes the letter and writes the text after the box, and `{ letter: 'B' }` draws the box alone. A letter is kept when it is 1 to 3 characters; a longer letter is dropped, so the text is boxed on its own. A marker sits above the top staff at the start of its measure, or where a segno would go. A section that starts a system is drawn on that system. A second section on the same system moves right to keep a gap after the first. Sections sit in a row of their own, above the other marks.
- **Repeat counts** (`repeatCount`): `x3` (a whole number from 2 to 99, written with a plain letter x) is drawn at the right end of a measure with a `'repeatEnd'` barline, in the same row as the segno, coda and jump texts. Without a repeat end, nothing is drawn. In the same measure, a jump text moves left to make room for it.
- **Placement.** Everything is drawn above the top staff of each system only, whether it is a notation or a TAB staff. All brackets of a system share one height, and all marks of a system share one baseline. From the staff outward the order is: the music, pick strokes and TAB labels and bends, chord diagrams and chord symbols, fermatas, beat text (see [Beat text](#beat-text)), volta brackets, segno, coda, jump texts and repeat counts, section markers, then the tempo. The score gets taller to make room, but the horizontal spacing does not change.
- **Drawing only.** There is no playback, no unrolling of repeats and no check that the marks make musical sense.
- SVG classes: `navigation` (one group per system), `volta` with `volta-closed` or `volta-open`, `volta-number`, `segno`, `coda`, and `jump` with `to-coda` or `fine`. `volta-closed` and `volta-open` describe the whole bracket, so every part of a bracket split across systems carries the same one, even the parts without a closing hook. New classes: `section` (one group per marker), `section-letter` (the boxed letter), `section-text` (boxed text, or the text after the box) and `repeat-count`.
- Segno, coda, jump texts and repeat counts in one system share one height, above all of that system's brackets, so a sign can sit higher than the bracket-free measure it belongs to would need. Section markers share one height above that row.

```json
{ "ending": [1, 2], "barline": "repeatEnd", "jump": "D.S. al Coda", "beats": [] }
```

```json
{ "section": { "letter": "A", "text": "Verse" }, "repeatCount": 3, "barline": "repeatEnd", "beats": [] }
```

### Beat

Beats are the rhythmic events in a measure, in order. Each beat is one note, one chord, one rest, or one grace note.

| Field | Type | Notes |
|---|---|---|
| `type` | `'note'`, `'rest'`, or `'grace'` | Required. |
| `duration` | `'whole'`, `'half'`, `'quarter'`, `'8th'`, `'16th'`, `'32nd'`, `'64th'` | Required, except for grace notes. An unknown name throws an error. |
| `dots` | integer, 0 to 4 | Augmentation dots. Default 0. Values above 4 are capped at 4, fractions are rounded down, and numeric strings count as their number (`'1'` is one dot). Anything else that isn't a number counts as 0. |
| `tuplet` | number or `{ count, of }` | `3` means a triplet (3 notes in the time of 2). `of` defaults to 2. Consecutive beats with the same ratio form one bracket once they add up to a complete tuplet. |
| `hidden` | boolean | Rests only (`{ type: 'rest', hidden: true }`). The rest takes its time but draws nothing and takes no room. Works in any measure. See [Voices](#voices). |
| `notes` | array of notes | Required for `note` and `grace`. Several entries make a chord. Rests have no notes. |
| `dynamic` | string | `'p'`, `'pp'`, `'ppp'`, `'mp'`, `'mf'`, `'f'`, `'ff'`, `'fff'`, `'sfz'`, `'rfz'`, `'n'`. Other values print as plain text. Drawn below the notation staff. |
| `chord` | string | Chord symbol drawn above the staff, e.g. `'C'` or `'F/A'`. With a chord diagram, the name is centred above the diagram. |
| `chordDiagram` | shape object or `false` | Optional. A shape for this beat's chord diagram, used instead of the `chordShapes` entry. `false` hides the diagram and keeps the plain chord symbol. See [Chord diagrams](#chord-diagrams). |
| `tremolo` | `true`, `'8th'`, `'16th'` or `'32nd'` | Tremolo-picking marks. `true` draws three strokes. `'8th'`, `'16th'` and `'32nd'` draw one, two or three strokes, in any case, with spaces around the word ignored. Numbers (`8`, `16`, `32`) and other values draw three strokes. See [Vibrato and tremolo](#vibrato-and-tremolo). |
| `vibrato` | `true` or `'wide'` | Wavy vibrato line. `'wide'` (in any case) draws a taller, heavier wave. Any other truthy value draws the normal wave. See [Vibrato and tremolo](#vibrato-and-tremolo). |
| `palmMute` | boolean | Marks the beat as part of a palm-muted run. Consecutive beats share one "P.M." dashed line, drawn above the tab staff (or below a notation-only staff). |
| `slurStart`, `slurEnd` | boolean | Mark the first and last beat of a slur. A slur that crosses a line break is split into two parts. |
| `articulations` | array of strings | `'staccato'`, `'staccatissimo'`, `'tenuto'`, `'accent'`, `'marcato'` (or its alias `'heavyAccent'`). See [Articulations and fermata](#articulations-and-fermata). |
| `fermata` | `true`, `'normal'`, `'short'` or `'long'` | Fermata above the beat. `true` and `'normal'` draw the usual fermata; `'short'` and `'long'` draw the short and long forms. Other values, such as the string `'true'` or the number `1`, draw nothing. See [Articulations and fermata](#articulations-and-fermata). |
| `letRing` | truthy | Let-ring run: consecutive beats share one dashed "let ring" label. See [Picking and playing directions](#picking-and-playing-directions). |
| `pickStroke` | `'down'` or `'up'` | Down-bow ⊓ or up-bow ∨ above the beat. Case-insensitive. Other values are ignored. A `strum` on the same beat replaces it. |
| `strum` | `'down'` or `'up'` | Strum arrow (↓ or ↑) above the beat: above the TAB staff when the track has one, else above the notation staff. Case-insensitive. Other values are ignored. See [Picking and playing directions](#picking-and-playing-directions). |
| `arpeggio` | `true`, `'up'` or `'down'` | Wavy arpeggio line left of a chord of two or more notes, on notation and TAB. `'up'` adds an arrowhead at the top, `'down'` at the bottom. Case-insensitive. Other values are ignored. Adds room left of the chord. See [Picking and playing directions](#picking-and-playing-directions). |
| `whammy` | `true`, a string or number, or `{ type, amount }` | Whammy-bar mark on the TAB staff. `type` is `'dip'` (the default), `'dive'`, `'return'` or `'predive'`, in any case. `true`, a string and a number are dips. `amount` such as `'1/2'`, `'1'`, `'1 1/2'`, `'2'` is shown as `-amount`; a missing amount means `'1/2'`. `'return'` takes no text. Other `type` values are ignored, so `{ type: 'scoop' }` is still ignored: use `whammyScoop` for a scoop. TAB only. See [Picking and playing directions](#picking-and-playing-directions). |
| `whammyScoop` | truthy | Whammy scoop on the TAB staff: a small V into the note, with no text. Main note beats only (not rests, grace notes or voice 2). A pre-dive on the same beat wins, so no scoop is drawn. See [Picking and playing directions](#picking-and-playing-directions). |
| `whammyBar` | truthy | "w/bar" label on the TAB staff, like let ring: consecutive beats with it share one label, and a rest between them keeps it going. Put it on note beats. TAB only. Never added automatically. See [Picking and playing directions](#picking-and-playing-directions). |
| `rake` | truthy, `'down'` or `'up'` | Rake: a dashed "rake" label over this beat and the grace notes right before it. Both directions draw the same. See [Picking and playing directions](#picking-and-playing-directions). |
| `golpe` | `true`, `'thumb'` or `'finger'` | Golpe sign above the tap "T" place, on notation and TAB, with or without a "T" on the beat. `'thumb'` and `'finger'` draw the same sign and add a class. Note beats only. See [Ornaments, fingering and hand marks](#ornaments-fingering-and-hand-marks). |
| `pickScrape` | `true`, `'down'` or `'up'` | "P.S." label run (pick scrape), like let ring. Consecutive scraped beats share one label whichever direction they use. The direction is accepted but not drawn. See [Ornaments, fingering and hand marks](#ornaments-fingering-and-hand-marks). |
| `barre` | a fret `1` to `24` (number or digit string), or `{ fret, half }` | Barre label run: `"C II"` for `barre: 2`, `"½C V"` for `{ fret: 5, half: true }`. Only `half: true` makes a half barre. Other values draw nothing. See [Ornaments, fingering and hand marks](#ornaments-fingering-and-hand-marks). |
| `text` | string or `{ text, below }` | Free italic text above the staff, or under it with `below: true`. Voice 1 note and rest beats only: grace notes and voice 2 ignore it. See [Beat text](#beat-text). |

Notes: eighth notes and shorter are beamed automatically within each beat (the beat unit set by the time signature). A `grace` beat is a small ornament with no duration. It is drawn just before the next beat and automatically slurred to it.

### Note

Each entry in a beat's `notes` array.

| Field | Type | Notes |
|---|---|---|
| `pitch` | string | Pitch: a letter A to G, an optional accidental (`#`, `b`, `x`, `##`, `bb`), then the octave. Examples: `'E4'`, `'F#3'`, `'Bb2'`. Middle C is `C4`. Required for notation unless `string` and `fret` are given. See [Pitch and octaves](#pitch-and-octaves). |
| `accidental` | `'sharp'`, `'flat'`, `'natural'`, `'doubleSharp'`, `'doubleFlat'` | Explicit accidental. Always drawn, on a grace note too, and overrides the key signature for this note. |
| `tieStart`, `tieEnd` | boolean | Tie to the next note of the same pitch. Enharmonic spellings count as the same pitch (C#4 ties to Db4). A tie that crosses a line break is split into two parts. |
| `string` | integer | Tab only. String 1 is the highest-pitched (top line). |
| `fret` | integer | Tab only. 0 is an open string. If `pitch` is missing, it is worked out from `string`, `fret`, and the track's `tuning`. |
| `hammerPull` | `true`, `'h'`, or `'p'` | Slur to the next note on the same string, with H or P on tab. The notation staff gets the same slur (see `hammerPullSlurs` in [Theme](#theme)). Both notes need `string`. `true` picks hammer-on or pull-off from the fret direction. |
| `slide` | `true`, `'up'`, `'down'`, or `'legato'` | Tab only. Slide to the next note on the same string. A slide that crosses a line break ends in a short stub at the end of the line. `'legato'` (any case) is a slide with a slur: it also draws a letterless arc on TAB and a slur on the notation staff, even with `hammerPullSlurs: false`. See [Hammer-ons, pull-offs, slides and bends](#hammer-ons-pull-offs-slides-and-bends). |
| `slideIn` | `true`, `'up'` / `'below'`, or `'down'` / `'above'` | Short slide into the note: from below for `true`, `'up'` or `'below'`, from above for `'down'` or `'above'`. Drawn on tab and notation. Not drawn on a grace note, or on a note that a slide or hammer-on already leads into. Other values are ignored. |
| `slideOut` | `true`, `'down'`, or `'up'` | Short slide off the note: downward for `true` or `'down'`, upward for `'up'`. Drawn on tab and notation. Not drawn on a grace note, on a note whose own `slide` reaches another note, or on a note with a `bend`. Other values are ignored. |
| `bend` | `true`, a string, or `{ type, amount, release, hold, rebend }` | Tab only. Amount such as `'1/2'`, `'full'`, `'1 1/2'`, or `'2'`. Add `' release'` or `' hold'` to the string, e.g. `'full release'`, `'1/2 hold'`. `true` means `'full'`. Pre-bend: `'prebend full'` (or `'pb'` / `'pre-bend'`, with an amount), bent before the note is picked. Release note: `'release'` alone, or `'release 1/2'`, a note of its own that falls back to the unbent pitch. Compound bend (bend, release, bend again): `'<a> release <b>'`, e.g. `'1/2 release full'`, or `'pb <a> release <b>'`, e.g. `'pb 1/2 release full'`. The object form takes a `rebend` amount: `{ type: 'bend', amount: '1/2', rebend: 'full' }`. Object `type`: `'bend'` (default), `'prebend'` or `'release'`; `rebend` is ignored on a release. See [Hammer-ons, pull-offs, slides and bends](#hammer-ons-pull-offs-slides-and-bends). |
| `mute` | boolean | Dead or muted note. Drawn as an x notehead (notation) or x (tab). |
| `ghost` | boolean | Ghost note. Drawn in parentheses. |
| `harmonic` | `true`, `'natural'`, `'artificial'`, `'pinch'`, `'tapped'`, `'semi'`, or `'feedback'` | Guitar harmonic (see [Harmonics](#harmonics)). Case-insensitive. `true` and unknown strings count as `'natural'`. `false` or omitted means no harmonic. A muted note is never a harmonic. |
| `harmonicFret` | integer | Touched fret of an `'artificial'` or `'tapped'` harmonic, shown on tab as `5(17)`. Ignored for other kinds, and when not an integer. |
| `tap` | truthy | Tap "T" above the beat, on notation and TAB (one per beat). A tapped harmonic shows only its `T.H.` label. See [Picking and playing directions](#picking-and-playing-directions). |
| `slap`, `pop` | truthy | Bass slap "S" or pop "P" above the beat, on notation and TAB, in the same place as the tap "T". One letter per beat: tap wins over slap, and slap over pop. See [Picking and playing directions](#picking-and-playing-directions). |
| `trill` | `true`, a fret, a pitch, or `{ fret, pitch }` | "tr" and a wavy line above the beat, on notation and TAB. A fret (whole number, 1 or more; `{ fret: 0 }` is the open string) or a pitch such as `'B3'` gives the other note; TAB then shows it as `(7)` after the "tr". `0`, `false` and invalid values draw nothing. See [Picking and playing directions](#picking-and-playing-directions). |
| `ornament` | `'turn'`, `'invertedTurn'`, `'upperMordent'` or `'lowerMordent'` | Ornament sign centred above the beat, on notation only. Case, spaces, hyphens and underscores are ignored, and aliases are accepted (`'turnInverted'`, `'invertedMordent'` and `'shortTrill'` for the upper mordent, `'mordent'` for the lower). One per beat, from its first note with a valid value. A trill on the same beat wins. Other values draw nothing. See [Ornaments, fingering and hand marks](#ornaments-fingering-and-hand-marks). |
| `finger` | `0` to `4`, or `'T'` (digit strings and `'t'` count) | Left-hand fingering, written left of the chord on the notation staff. `0` is drawn as a plain `0`: the open-string sign in left-hand fingering. This is not the `chordShapes` meaning, where `0` means no finger. Other values draw nothing. See [Ornaments, fingering and hand marks](#ornaments-fingering-and-hand-marks). |
| `rightFinger` | `'p'`, `'i'`, `'m'`, `'a'` or `'c'` | Right-hand finger letter in italics, above the beat. Any case. Other values draw nothing. See [Ornaments, fingering and hand marks](#ornaments-fingering-and-hand-marks). |
| `leftHandTap` | truthy | Left-hand tapping sign in the tap "T" place, on notation and TAB. A tapped harmonic ignores it. One letter per beat, in this order: tap, left-hand tap, slap, pop. See [Ornaments, fingering and hand marks](#ornaments-fingering-and-hand-marks). |

Example: a tab-only note needs no `pitch`.

```json
{ "type": "note", "duration": "8th", "notes": [{ "string": 1, "fret": 5, "hammerPull": true }] }
```

### Pitch and octaves

Guitar and bass music is written an octave higher than it sounds. The library follows that convention:

- A note given by `string` and `fret` is written an octave above its sounding pitch. Its staff is drawn with an 8vb clef.
- A note given by `pitch` is drawn exactly as written, unless its track sets `writtenOctaveUp: true`. In that case the `pitch` is treated as the sounding pitch and is drawn an octave higher, with an 8vb clef.

Tie matching uses the pitch, not the spelling, so enharmonic spellings tie together.

Pitches worked out from string and fret (notes given without a `pitch`) follow the key. A black key is spelled as a flat when the key signature has that flat, and as a sharp otherwise. Only black keys change, so you never get Cb, Fb, E# or B#, and the octave never changes.

- F major (one flat, Bb): with the default guitar tuning, fret 6 on the high E string is written Bb, and fret 4 stays G#.
- Bb major (Bb and Eb): A# is written Bb and D# is written Eb. C#, F# and G# stay sharp.
- Sharp keys and C major: no change. Their black keys are sharps, as before.

The key is the one in effect for the note's measure, so a key change mid-score applies from that measure on. An explicit `pitch` is written exactly as given and keeps its own spelling. To keep the old A# spelling in a flat key, give that note a `pitch` such as `'A#5'`.

### Harmonics

Set `harmonic` on a note to draw a guitar harmonic. Notation is drawn at the note's written pitch. For a note given by `string` and `fret`, that is the fretted position (the touch point).

| `harmonic` | Notation | Tab | Label above tab |
|---|---|---|---|
| `true` or `'natural'` | Diamond notehead, same duration rules as a normal notehead | `<12>` (fret in angle brackets) | none |
| `'artificial'` | Normal notehead | `5(17)` when `harmonicFret` is set, otherwise `5` | `A.H.` |
| `'tapped'` | Normal notehead | As for artificial | `T.H.` |
| `'pinch'` | Normal notehead | Plain fret | `P.H.` |
| `'semi'` | Normal notehead | Plain fret | `S.H.` |
| `'feedback'` | Normal notehead | Plain fret | `Fdbk.` |

`'feedback'` (any case) is a feedback harmonic. Before 1.9.0 it was not recognised and drew as a natural harmonic (see the 1.9.0 changelog).

- Labels are dashed runs like palm mute: consecutive beats with the same label share one label and one dashed line. The labels sit in the lane above the tab, or below a notation-only staff.
- A rest, a grace note, or a beat with a different label starts a new run.
- A beat with several harmonics shows one label, chosen by priority: A.H. over T.H. over P.H. over S.H. over Fdbk.
- A P.M. label sits nearest the staff, and a harmonic label sits one lane further out where they overlap.
- A label moves clear of a bend. It starts just after the bend's text if it can, or moves out a lane.
- A muted note is drawn as an x, with no diamond and no label.
- Ghost notes wrap the tab text in parentheses: `(<12>)` and `(5(17))`.
- A natural harmonic on a bend shows no landing fret.
- In a chord, only the harmonic notes change shape. Their noteheads stay on the stem side of the chord.
- Grace notes get a diamond (natural) or the TAB text, but no A.H., T.H., P.H., S.H. or Fdbk. label. See [Known limitations](#known-limitations).

Example: the note is fretted at the 5th fret on string 5, and the harmonic is touched at the 17th fret. Tab shows `5(17)` with an `A.H.` label above it.

```json
{ "type": "note", "duration": "quarter", "notes": [{ "string": 5, "fret": 5, "harmonic": "artificial", "harmonicFret": 17 }] }
```

### Picking and playing directions

Optional fields draw playing marks: `letRing`, `pickStroke`, `strum`, `arpeggio`, `whammy`, `whammyScoop`, `whammyBar` and `rake` on a beat, and `tap`, `slap`, `pop` and `trill` on a note. None of them change the rhythm; only `arpeggio` adds room left of its chord. The ornament, fingering, golpe, left-hand tap, pick scrape and barre fields are described in [Ornaments, fingering and hand marks](#ornaments-fingering-and-hand-marks).

- **Let ring** (`letRing`): consecutive beats with `letRing` share one dashed "let ring" label, drawn like the P.M. line. An unmarked rest between two let-ring beats of the same system continues the run. A note or grace note without `letRing` ends it, and so does a line break. On a track with TAB, the label sits in the outermost lane, outside any P.M. or harmonic label it overlaps. On a notation-only staff it sits below the staff.
- **Pick strokes** (`pickStroke`): `'down'` draws ⊓ and `'up'` draws ∨, one per beat. Values are case-insensitive, and other values are ignored. On a track with a notation staff, the stroke sits above the staff (in a two-voice measure, voice 2's sit below it, see [Voices](#voices)). It stacks above stems, articulations, slurs (just above the slur at that beat), tuplet brackets and any tap "T". Chord symbols and fermatas sit above it. Strokes on the beats of one beam group share one height. On a tab-only track, the stroke sits above the TAB staff. Pick strokes are not drawn on the TAB staff when the track also shows notation. A beat with a `strum` shows the strum arrow instead.
- **Strum** (`strum` on a beat): `'down'` draws a down arrow ↓ and `'up'` an up arrow ↑, 1.5 sp tall, one per beat, for strummed chords and rasgueado-style repeated strokes. On a track with TAB, the arrow sits above the TAB staff, in the pick stroke's place: at least 1 sp above the top line and 0.4 sp above the frets, bends, letters, trills, dips, whammy lines, technique labels and H / P under it. On a notation-only track it sits above the staff like a pick stroke, above any trill and tap / slap / pop letter. Consecutive strummed beats on a system (a rest or an unstrummed note ends the run, grace notes do not) share one height, the highest any of them needs. A strum takes no horizontal room. A `rake` on the same beat is drawn too.
- **Arpeggio** (`arpeggio` on a beat): a vertical wavy line just left of a chord of two or more notes. On notation it reaches from 0.5 sp above the highest notehead to 0.5 sp below the lowest, 0.4 sp clear of the chord's accidentals, parentheses, noteheads and ledger lines. On TAB it spans the strings of the fretted notes, 0.4 sp left of the fret numbers. `'up'` (low to high) adds an arrowhead at the top, `'down'` at the bottom, and `true` none. The chord keeps room for the line, 1 sp beyond its leftmost notation or TAB ink, so the note spacing changes for these chords only; grace notes before the chord sit left of the line.
- **Tapping** (`tap` on a note): draws a bold "T" once per beat, above the note on notation and above the fret on TAB. On TAB it is raised above an H or P letter when they would touch. A tapped harmonic already shows `T.H.`, so it gets no extra "T".
- **Whammy dip** (`whammy`): a V with `-amount` above it, drawn on the TAB staff only. Notation-only tracks ignore it. The V starts just right of its note, as a bend does, and is shortened before the next beat or barline. A dip on a beat that also has a bend stacks above the bend. `true` means `'1/2'`. Leading minus signs are removed and one "-" is shown, so `'-1'` and `1` both show `-1`.
- **Whammy dive, return and pre-dive** (`whammy: { type: 'dive' | 'return' | 'predive', amount }`): TAB staff only. A dive slopes down from just right of its note, as a dip starts, to a held level and is held until a `'return'` beat: the line runs level to the return beat and rises again. The depth follows the amount, 1.2 sp per whole step, from 0.8 sp (`'1/2'`) to 2.4 sp (`'2'` or more). A dip, another dive or a pre-dive ends the hold early, 0.9 sp before it, with no rise. A `'return'` with nothing held is ignored. A dive with no return is held to the end of the track. A held line crosses a line break: it stops 0.5 sp before the last barline and starts again 0.5 sp after the next system's header, without the text, on every system up to the return. A pre-dive is self-contained: a short level lead-in before the note (1.0 to 1.5 sp, kept 0.9 sp from the previous beat and clear of the header), then the rise. Each line sits at one height, 0.5 sp above the TAB top line and 0.4 sp above the frets, marks, letters, trills, bends and dips under it, so a tall bend lifts the whole line. Technique labels move out a lane if a line is in their way.
- **Whammy scoop** (`whammyScoop: true` on a beat): a small V into the note on the TAB staff, with no text. It starts with the same short lead-in as a pre-dive, dips 0.8 sp, and returns to the top 0.3 sp right of the note. It sits in the dip's place: if the same beat also has a dip, the two share one bottom level. A pre-dive on the same beat wins, and then no scoop is drawn. A scoop ends a held dive about 0.9 sp before it, with no rise, and a `'return'` on that same beat is then ignored. Scoops are drawn on TAB only, on note beats in voice 1 (not on rests, grace notes, voice 2, or a notation-only track).
- **w/bar** (`whammyBar: true` on a beat): a "w/bar" label run on the TAB staff, like let ring, with a dashed line. Consecutive beats with it share one label. A rest between them keeps the run going, and a grace note or a note without the field ends it. The label sits outside the P.M., harmonic and let-ring labels it overlaps, and before P.S., barre and rake. It is only drawn when you set the field: a w/bar is never added on its own. Put it on note beats.
- `whammy: { type: 'scoop' }` is still ignored. Scores that already contain it draw as before. Use `whammyScoop` for a scoop.
- **Slap and pop** (`slap`, `pop` on a note): a bold "S" or "P" once per beat, above the note on notation and above the fret on TAB, in the same place as the tap "T" and stacked the same way. One letter per beat: tap wins over slap, and slap over pop (a tapped harmonic shows `T.H.` and gives way to a slap). Rests and grace notes ignore them. Letters are drawn above the staff only.
- **Rake** (`rake` on a beat): a dashed "rake" label over the beat and the grace notes directly before it in the same system. Write the dead-note grace notes (`mute: true`) yourself; none are generated. The label sits in a lane outside any P.M., harmonic or let-ring label it overlaps, and in the lane next to the staff when nothing else is there. Two rakes in a row stay two labels, and a rake never reaches across a line break. `'down'` and `'up'` draw the same; the direction is not shown.
- **Trill** (`trill` on a note): the "tr" glyph and a wavy line, centred on the beat, above the notation and TAB staves (voice 2's sit below the notation staff in a two-voice measure). It sits above vibrato and tremolo and below a tap, slap or pop letter, a pick stroke, a dip and a fermata. On notation its bottom also stays 1 sp above the next note's top. On TAB, `(7)` after the "tr" shows the other fret. A fret is used as given. A pitch is placed at the nearest interval (up to a fourth down or a tritone up) from the note's fret: A3 at fret 5 with `trill: 'B3'` or `'B4'` shows `(7)`. A plain `true`, a pitch without a fret, or a result below fret 0 shows no `(n)`. The wave ends 0.8 sp before the next beat and never passes the last barline. Consecutive trilled beats on a system (a plain note or rest ends the run, grace notes do not) share one height, the highest any of them needs, and each wave then stops 0.25 sp before the next "tr". When a beat has several trilled notes, the first one decides.
- **Trill over tied notes.** A trill continues over the notes tied to it. The note that continues the tie needs `tieEnd: true` and the same pitch (enharmonic spellings count; without a pitch, the same string and fret). The trilled note's own `tieStart` is not needed. The wave runs on through each tied note, with no new "tr" and no `(n)` text. It continues across a line break onto the next system, and on that system it stops 0.8 sp before the first beat after the tie. The chain stops at a rest, at a note with its own trill, or at the first note that does not continue the tie. Grace notes between tied notes are skipped. Marks on a tied note (a tap, golpe, whammy dip, or the notation's marks) stack above the wave. A trill in voice 2 continues over voice 2's tied notes, and on the notation staff its wave sits below the staff.
- Rests and grace notes ignore `pickStroke`, `strum`, `arpeggio`, `tap`, `slap`, `pop`, `trill`, `whammy`, `whammyScoop`, `rake`, `ornament`, `finger`, `rightFinger`, `leftHandTap` and `golpe`. They draw no `pickScrape` or `barre` label either, though a rest can sit inside one of those runs (and a grace note can sit inside a `barre` run). A single note ignores `arpeggio`.

```json
{ "type": "note", "duration": "8th", "pickStroke": "down", "notes": [{ "string": 1, "fret": 5, "tap": true }] }
```

```json
{ "type": "note", "duration": "quarter", "whammy": { "type": "dive", "amount": "1" }, "notes": [{ "string": 3, "fret": 5, "trill": 7 }] }
```

```json
{ "type": "note", "duration": "quarter", "arpeggio": "up", "strum": "down", "notes": [{ "string": 3, "fret": 0 }, { "string": 2, "fret": 1 }, { "string": 1, "fret": 0 }] }
```

SVG classes: `tap`, `slap`, `pop` (one group per letter), `rake` (one group per run), `trill` (glyph, optional fret text and wave), `trill trill-continued` (a trill wave continued over tied notes on a later system, with no glyph) and `whammy` with one of `whammy-dip`, `whammy-dive`, `whammy-hold` (a continuation on a following system) or `whammy-predive`, plus `whammy-return` on a line that rises again. A scoop is `whammy whammy-scoop`, and a "w/bar" run is `whammy-bar` (one group per run). Also `arpeggio` (plus `arpeggio-up` or `arpeggio-down` when it has an arrowhead) and `strum` with `strum-down` or `strum-up`, one group per mark.

### Ornaments, fingering and hand marks

These fields add ornaments, left- and right-hand fingering, and the marks players write for the hands: golpe, left-hand tap, pick scrape and barre. None of them change the rhythm. Left-hand fingering adds room left of its chord, as an arpeggio does, and only where a note has a finger. Scores that use none of these fields draw as before.

- **Ornaments** (`ornament` on a note): one sign centred above the beat, on the notation staff. `'turn'`, `'invertedTurn'`, `'upperMordent'` and `'lowerMordent'` are the values. The aliases `'turnInverted'` (an inverted turn), `'invertedMordent'` and `'shortTrill'` (both upper mordents), and `'mordent'` (a lower mordent) also work. Case, spaces, hyphens and underscores are ignored, so `'Inverted-Turn'` is read as an inverted turn. A beat draws one ornament, from its first note with a valid value. A trill on the same beat wins.
- **Left-hand fingering** (`finger` on a note): `1`, `2`, `3` or `4`, or `'T'` for the thumb. It is written on the notation staff, left of the chord and level with its note. Digit strings (`'2'`) and `'t'` also count. When two fingered notes sit a staff position or less apart, the second digit goes in a column further left. `0` is drawn as a plain `0`, the open-string sign in left-hand fingering. In a `chordShapes` entry, by contrast, `0` means no finger and draws nothing.
- **Right-hand fingering** (`rightFinger` on a note): `'p'`, `'i'`, `'m'`, `'a'` or `'c'`, in italics, any case. Letters from the beat's notes stack above the beat, with the lowest note's letter nearest the staff. On a track with notation, they go on the notation staff. On a tab-only track, they go above the TAB staff, under any pick stroke.
- **Golpe** (`golpe` on a beat): a golpe sign above the tap "T" place, on notation and TAB. It sits there whether or not the beat has a "T". `true`, `'thumb'` and `'finger'` draw the same sign. The last two also add a `golpe-thumb` or `golpe-finger` class for styling.
- **Left-hand tap** (`leftHandTap` on a note): a left-hand tapping sign in the tap "T" place, on notation and TAB. A beat draws one of the tap marks, by priority: tap "T", then left-hand tap, then slap "S", then pop "P". A tapped harmonic ignores `leftHandTap`, as it ignores `tap`, and shows its `T.H.` label.
- **Pick scrape** (`pickScrape` on a beat): a "P.S." label over consecutive scraped beats, drawn as a dashed run like let ring. `'down'`, `'up'` and `true` share one run, whichever direction each beat uses. The direction is kept but not drawn. A rest inside the run keeps it going. A note or grace note without `pickScrape` ends it.
- **Barre** (`barre` on a beat): a label for the barre fret, in Roman numerals. `barre: 2` shows "C II". `barre: { fret: 5, half: true }` shows "½C V". The fret runs from 1 to 24, as a number or digit string. Consecutive beats with the same barre share one label. A rest or grace note between two beats with the same barre continues the run. A different barre or an unmarked note ends it. A system break also ends it, and the label is repeated at the start of the next system.

Placement:

- **Above the notation staff**, the marks stack outward from the staff, each about 0.4 sp above the one below. Below them are the existing clearances (stems, articulations, vibrato, tremolo, tuplet brackets and slurs). From the bottom up: the trill or ornament, the right-hand letters, the tap "T" (or left-hand tap, "S" or "P"), the golpe, and the pick stroke or strum.
- **Above the TAB staff**, golpe and left-hand tap sit in the tap "T" place: the golpe above it, and the left-hand tap glyph in the letter's place. The golpe clears a trill, "T" or H / P letter in its span. Ornaments are not drawn on TAB.
- **Technique labels** stack outward from the staff in this order: P.M., harmonic, let ring, P.S., barre, rake. Above the TAB staff they go over the TAB. On a notation-only staff they go below the staff, in the same order.
- **Voice 2** draws its ornaments, trills, right-hand letters, tap marks, golpe and pick strokes below the notation staff in a two-voice measure, not above it. Left-hand fingering, strums and the other marks stay voice 1 only. See [Voices](#voices).

```json
{ "type": "note", "duration": "quarter", "golpe": "thumb", "notes": [{ "string": 3, "fret": 5, "ornament": "turn", "finger": 1, "rightFinger": "p" }] }
```

```json
{ "type": "note", "duration": "quarter", "barre": { "fret": 5, "half": true }, "notes": [{ "string": 5, "fret": 5, "leftHandTap": true }] }
```

SVG classes: `ornament` with `ornament-turn`, `ornament-inverted-turn`, `ornament-upper-mordent` or `ornament-lower-mordent`; `fingering-left` (one group per beat, the left-hand digits); `fingering-right` (one group per beat, the right-hand letters); `golpe` with `golpe-thumb` or `golpe-finger`; `left-hand-tap` (the glyph, in the tap slot); `pick-scrape` with `pick-scrape-down` or `pick-scrape-up` (the direction of the run's first beat; plain `pick-scrape` for `true`), one group per run; and `barre` with `barre-half` for a half barre, one group per run.

### Hammer-ons, pull-offs, slides and bends

These note fields add legato, slides and bends. They are read from each note in `notes`, not from the beat. None of them change the rhythm.

- **Hammer-ons and pull-offs** (`hammerPull`): a slur to the next note on the same string, with H or P above it on tab. The notation staff gets the same slur. Consecutive hammer-ons and pull-offs on one string share one slur. Set `hammerPullSlurs: false` in the theme to leave the notation without them.
- **Slide in and slide out** (`slideIn`, `slideOut`): a short slide into the note, or off it, drawn on tab and notation. They take no horizontal room. A slide-in is left out when a slide or hammer-on already leads into the note. A slide-out is left out when the note has its own `slide` to another note, or a `bend`.
- **Pre-bends** (`bend: 'prebend full'`, `'pb 1/2'`, `'pre-bend full'`): the string is bent before the note is picked. Tab shows a rising shaft with the amount, and no landing fret. Add `release` (`'pb 1/2 release'`) to bend back down. A `hold` on a pre-bend is ignored.
- **Legato slide** (`slide: 'legato'`): a shift slide on TAB (its direction is read from the frets, as for `slide: true`) with a letterless arc joining the two notes, drawn like a hammer-on's arc but with no H or P. The notation staff gets a slur between them, as for a hammer-on or pull-off. That slur is drawn even when `hammerPullSlurs: false`. Both notes need `string`. A legato slide that crosses a line break is split in two, like a hammer-on's arc. `slide: 'up'` and `slide: 'down'` are shift slides with no arc and no slur, as before.
- **Releases** (`bend: 'release'`): a note of its own that returns to the unbent pitch. Tab shows a falling arrow, and the fret in parentheses. The amount defaults to the last bend on that string, or `'full'` when there is none. `'release 1/2'` sets it.
- **Compound bends** (`'1/2 release full'`, `'pb 1/2 release full'`, or `{ type: 'bend', amount: '1/2', rebend: 'full' }`): bend, release, then bend again, on one note. Tab shows a rise to the first amount, a fall back to the string's level, and a second rise to the second amount. Each amount is labelled above its peak. The "pb" form starts with a pre-bend's shaft over the note before the first rise. There is no landing fret and no hold. The second amount sets the default for a release note that follows on the same string: `'release'` with no amount then falls by that amount, not by the last single bend. If the room to the next note is short, the second label is raised above the first, so the two stay readable.
- Pre-bends, releases and compound bends are drawn on tab only. The notation shows the note as written.

```json
{ "type": "note", "duration": "quarter", "notes": [{ "string": 1, "fret": 7, "bend": "prebend full" }] }
```

```json
{ "type": "note", "duration": "quarter", "notes": [{ "string": 2, "fret": 7, "bend": "1/2 release full" }] }
```

SVG classes: `slur` (also on notation hammer-on and pull-off slurs, and on a legato slide's notation slur), `slide-in` with `slide-in-below` or `slide-in-above`, and `slide-out` with `slide-out-down` or `slide-out-up`, one group per mark on tab and notation. A bend is drawn in a `bend` group, with `bend-prebend` or `bend-release` added for a pre-bend or release note. A plain bend has `bend` alone. A compound bend is a `bend bend-rebend` group (with `bend-prebend` too for the pre-bend form). A legato slide's TAB arc has the class `legato-slide`, with no letter.

### Rhythm on TAB staves

A tab-only track (`showStandardNotation: false`, `showTablature: true`) shows its rhythm on the TAB staff by default, as in tab books and Guitar Pro. Set `tabRhythm: false` on the track to hide it. A track that also shows notation gets it only with `tabRhythm: true`.

- **Stems** hang down from a line just below the bottom string, one per note or chord, at the fret number's position. They never cross the staff. Half notes get a shorter stem and whole notes none. A beat with no string and fret still gets a stem.
- **Beams** follow the same groups as notation (per beat, dotted beats in compound meters). They are horizontal, at the stem ends, with extra beams stacked toward the staff. A short beam stub marks a lone shorter note in a group.
- **Flags** are drawn on unbeamed 8th to 64th notes, smaller than notation flags (`tabFlagScale`).
- **Augmentation dots** sit on one row just below the stem tops, right of the stem (or the flag).
- **Tuplets** show their number under the beam when one beam group covers exactly the tuplet. Otherwise a bracket with upward ticks is drawn below the stems.
- **Rests** are drawn inside the TAB staff, except that in a two-voice measure a rest that is not merged sits in its voice's row of the band. A whole rest hangs from a string near the middle of the staff and a half rest sits on one. Shorter rests are centred on the staff, over a backing that hides the string lines.
- **Empty measures.** A measure with `beats: []` shows a whole-measure rest. Measures added to pad a shorter track stay blank.
- Grace notes get no stem, flag or beam. Ties are not drawn. The tied fret number is shown as usual.
- Marks above the TAB staff (H/P, bends, P.M., vibrato and the others) do not move. The band adds about 3.5 staff spaces below the TAB staff, and more with tuplet numbers or 32nd/64th notes. Flags, dots and rests can also need extra horizontal room. In a two-voice measure the band has a second row for voice 2, below voice 1's, so it is taller (see [Voices](#voices)).
- On a track that shows notation and TAB with `tabRhythm: true`, the notation staff is unchanged. Only the TAB staff gets the band, which sits between the TAB staff and the next instrument or system.
- SVG classes: `tab-rhythm` (one group per measure), `tab-rest` (each rest) and `tab-tuplet` (each tuplet number or bracket).

```json
{ "name": "Gtr", "showStandardNotation": false, "showTablature": true, "tabRhythm": false, "measures": [] }
```

### Tied fret numbers

Set `tiedFrets: 'parens'` on a track that shows TAB to put parentheses around the fret number of each note that is tied to the note before it, such as `(5)` or `(12)`. The note that starts the tie is unchanged. This is off by default, so existing scores draw as before.

- The value is read without regard to case or surrounding spaces, so `'parens'` and `' Parens '` both work. Any other value does nothing.
- Both voices are affected, and so is a tied note that starts a system. Grace notes and the notation staff are not changed.
- The parentheses take up room on the TAB staff, so the spacing around the note grows to fit them.
- A note that already has parentheses keeps one pair. A ghost note or a release note is not wrapped twice. A muted tied-to note still shows `x`. A natural harmonic shows `(<12>)`, and a touched fret shows `(5(17))`.

```json
{ "name": "Gtr.", "showTablature": true, "tiedFrets": "parens", "measures": [] }
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

## Page header

The page header sits above the first system. It is made of rows, top to bottom. A row with no text takes no space, so a score that sets only some of these fields has a shorter header.

1. `title`, centred, in the largest text.
2. `subtitle`, centred.
3. `artist`, centred.
4. `album`, centred.
5. `tuningLabel` at the left, in italics, and `composer` at the right, on one line.
6. Credits: "Words by ..." at the left and "Music by ..." at the right. When `words` and `music` are the same name, one line reads "Words & Music by ..." at the right.
7. `instructions`, one line per line break, in italics at the left.
8. Capo and tuning chart, one line per track (see [Capo and tuning chart](#capo-and-tuning-chart)).

The new text fields are trimmed, and runs of spaces are collapsed to one space. Empty values are ignored. Lines do not wrap, so a long line runs past the margin.

`instructions` and `copyright` are split at each line break (`\n`), and empty lines are dropped. Only the first 8 lines are drawn.

`copyright` is drawn once, centred at the foot of the score, under the last system. The SVG grows to fit it. Without `copyright`, the height is the same as before.

### Capo and tuning chart

- **Capo** (`capo` on a track): an integer from 1 to 30. The track's line in the header reads "Capo fret 2". This is display only: the music is not transposed, and the notes and fret numbers stay as you wrote them.
- **Tuning chart** (`showTuningChart: true` on the score, off by default): lists the strings tuned differently from the usual tuning for that number of strings. Each entry is the string number in a circle, an equals sign and the note name as written, without an octave. `⑥ = D` means the lowest string is tuned to D. Strings are numbered as on tab (1 is the highest), and the highest-numbered string is listed first. Strings above 10 are written as `(11)`, `(12)` and so on.
- Entries that cannot be read, such as `'H2'`, are left out.
- Standard tuning lists nothing, so with the chart on, a track in standard tuning shows only its capo line, if it has one.
- The usual tuning for each number of strings, lowest string first:

  | Strings | Usual tuning |
  |---|---|
  | 4 | E1 A1 D2 G2 |
  | 5 | B0 E1 A1 D2 G2 |
  | 6 (guitar, treble clef) | E2 A2 D3 G3 B3 E4 |
  | 6 (bass, bass clef) | B0 E1 A1 D2 G2 C3 |
  | 7 | B1 E2 A2 D3 G3 B3 E4 |
  | 8 | F#1 B1 E2 A2 D3 G3 B3 E4 |

  A track with any other number of strings lists every string.
- One line per track that shows notation or tab. A track that shows neither is left out, and a track that shows only notation is included. When the score has more than one such track, each line starts with the track's name: `name`, else `label`, else "Track N" (its position in the score). For example: "Gt.: Capo fret 2   ⑥ = D".
- The chart appears only in the header. It adds nothing to the staves. The `tuningLabel` text (for example "Drop D") is separate and is not read for the chart.

## Layout

The renderer spaces and breaks the score for you. A short list of what to expect:

- **Justified systems.** Each system except the last is stretched to the full width. The last system is stretched too if it is at least 75% full. Otherwise it keeps natural spacing and ends at its last barline.
- **Time signatures** are drawn at the start of the score and where they change, not at the start of every system. Clef and key signature repeat at the start of each system. Where a key or time change falls at the end of a system, a courtesy signature shows it.
- **Measure numbers** are shown at the start of systems 2 onward, in italics above the top staff. Measure 1 is not numbered.
- **Joining line and bracket.** Staves in a system are joined by a line at the left. A notation staff and its tab staff are bracketed when the system holds two or more instruments.
- **Instrument names** are drawn horizontally to the left of the system. See [Instrument names](#instrument-names).
- **Accidentals** last until the end of their measure. In a two-voice measure they carry across both voices (see [Voices](#voices)). Grace notes take part too: an altered grace note carries into the notes after it in the measure, and an altered note carries into the grace notes after it. A grace note's accidental is drawn at grace size, left of its head, or left of the slash on a stem-down grace. The next measure starts again from the key signature. A tied note that starts a new system repeats its accidental.
- **Ties and slurs** sit on the side opposite the stems. In a two-voice measure, voice 1's sit above the notes and voice 2's below (see [Voices](#voices)). Ties, slurs, hammer-ons and pull-offs that cross a line break are split into two parts.
- **Beaming.** Eighth notes and shorter beam within each beat. Compound meters group by dotted beat, so 6/8 beams as two groups of three and 12/8 as four.
- **Chord symbols and dynamics** each sit on one line per system: chord symbols above the staff, dynamics below it. Both are kept clear of the notes. Chord diagrams sit in one row per system staff, between the music and the chord-symbol line (see [Chord diagrams](#chord-diagrams)).
- **Technique labels** (P.M., harmonic, pick scrape and barre labels) are placed clear of bend arrows and text, starting after a bend or moving out a lane when needed.
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

Optional beat fields for articulation and fermata marks. Articulations and fermatas draw on the notation staff only. Vibrato and tremolo are also drawn on the TAB staff (see [Vibrato and tremolo](#vibrato-and-tremolo)).

### `articulations`

An array of strings on a `note` beat. Allowed values: `'staccato'`, `'staccatissimo'`, `'tenuto'`, `'accent'`, and `'marcato'`, which may also be written `'heavyAccent'`. Values are case-sensitive and must match exactly, with no extra spaces.

- Marks are drawn once per beat and apply to the whole chord. You do not choose a side.
- Marks go on the side opposite the stem. A note whose stem points up gets its marks below. A note whose stem points down gets its marks above. In a two-voice measure they go on the stem side instead (see [Voices](#voices)).
- A beamed note takes its beam group's stem direction, so the group decides the side.
- A whole note has no stem. It gets marks below if its position is below the middle line, otherwise above.
- In a chord, the marks attach to the outermost notehead on that side.
- Marks stack outward from the notehead in a fixed order: staccatissimo or staccato nearest, then tenuto, then marcato or accent. The order in your array does not matter.
- Two marks in the same place compete. `staccatissimo` replaces `staccato`, and `marcato` (or `heavyAccent`) replaces `accent`. Only the stronger one is drawn. Tenuto is never replaced.
- A taller mark (marcato, staccatissimo) that would touch the notehead, or the mark inside it, moves out one more staff space. So it can sit a little higher than a plain accent or staccato on the same note.
- Duplicates are ignored. Unknown values (for example `'bogus'`) and non-array values are ignored without an error.
- Ignored on rests, grace notes, and tab staves.

### `fermata`

`fermata` on a `note` or `rest` beat draws a fermata above the beat.

- `true` and `'normal'` draw the usual fermata. `'short'` and `'long'` draw the short and long forms. These values are trimmed and case-insensitive, so `' Long '` works.
- Other values draw nothing: the string `'true'`, the number `1`, and `false`.
- The fermata sits above everything else on that beat: the staff, stem, noteheads, articulation marks, slurs, tuplet brackets, vibrato or tremolo marks, and any chord symbol or chord diagram. In a two-voice measure, a voice 2 fermata is drawn below the staff instead, under the other voice 2 marks of its beat (see [Voices](#voices)).
- Ignored on grace notes and tab staves.

### Example

```json
{ "type": "note", "duration": "quarter", "articulations": ["staccato", "accent"], "fermata": true, "notes": [{ "pitch": "E4" }] }
```

E4 is below the middle line, so its stem goes up and the marks go below the notehead.

The demo score in `examples/articulations-demo.js` (exported as `articulationsScore`) shows each mark, including marcato and staccatissimo, the stacking order, chords, beamed groups, whole notes, fermatas on notes, rests, chord symbols, slurs and tuplets, and how dynamics and ties sit with the marks.

### Vibrato and tremolo

- **Vibrato** (`vibrato`): `true` draws the normal wavy line. `'wide'` draws a taller, longer and heavier wave, on notation and TAB. Marks above a note with a wide vibrato sit a little higher to clear it.
- **Tremolo** (`tremolo`): `true` draws three strokes, as before. `'8th'`, `'16th'` and `'32nd'` draw one, two or three strokes, centred where the three would be. The speed is trimmed and case-insensitive. Numbers and other values draw three strokes.
- In a two-voice measure, vibrato and tremolo are drawn for both voices. Voice 2's sit below its notes (see [Voices](#voices)).
- SVG classes: on notation, `vibrato` with `vibrato-wide` for a wide wave, and `tremolo` with `tremolo-8th`, `tremolo-16th` or `tremolo-32nd` for a speed. On TAB, `tab-vibrato` with `tab-vibrato-wide`, and `tab-tremolo` with `tab-tremolo-8th`, `tab-tremolo-16th` or `tab-tremolo-32nd`. A plain `true` tremolo has the `tremolo` class alone. Fermatas use `fermata`, with `fermata-short` or `fermata-long` for those kinds.

These fields do not change the API or the theme.

## Voices

A measure can hold two rhythms on one staff, for example a melody over a held bass. Give the measure `voices` instead of `beats`. The first entry is voice 1 and the second is voice 2. Both voices are drawn on the notation staff and on the TAB staff.

```json
{
  "name": "Gtr.", "showStandardNotation": true, "showTablature": true,
  "measures": [
    {
      "voices": [
        { "beats": [
          { "type": "note", "duration": "quarter", "notes": [{ "string": 1, "fret": 5 }] },
          { "type": "note", "duration": "quarter", "notes": [{ "string": 1, "fret": 7 }] },
          { "type": "note", "duration": "quarter", "notes": [{ "string": 1, "fret": 8 }] },
          { "type": "note", "duration": "quarter", "notes": [{ "string": 1, "fret": 7 }] }
        ] },
        { "beats": [
          { "type": "note", "duration": "whole", "notes": [{ "string": 6, "fret": 0 }] }
        ] }
      ]
    }
  ]
}
```

- **Stems, beams and tuplets.** Voice 1's stems always point up and voice 2's always point down, even for a single note. Each voice beams and groups its own notes, so a beam never joins the two. Voice 2's tuplet brackets go below the staff.
- **Notes that sound together.** Where both voices have notes at the same time, they share one column.
  - **Shared unison.** When both voices play the same note at the same time, one notehead is drawn for both. This needs the same note value, the same pitch and accidental (voice 2 may show none, since voice 1's carries), the same mute and ghost marking, the same dots, and no other note in either voice's chord closer than a third to it. Neither chord may have a notehead moved sideways. Each voice keeps its own stem, on either side of the shared head. Whole notes can share a head too.
  - **Otherwise.** If voice 2's notes form a unison, second or crossed with voice 1's, voice 2 moves right. In the usual case its stem then lines up with voice 1's stem.
- **Accidentals.** An accidental carries to later notes in the measure in either voice, as it does within one voice. Accidentals in a shared column are drawn as one stack.
- **Dots.** A dot on a voice 2 note that sits on a line goes in the space below the line. A voice 1 dot on a line goes in the space above. A shared unison head has one set of dots.
- **Rests.** Each voice's rests are drawn separately, except a merged rest. When both voices rest at the same time, for the same length, with the same dots and tuplet ratio, and neither rest is hidden, one rest is drawn at the usual single-voice position and voice 2's rest draws nothing. A whole-measure rest merges only with another whole-measure rest. Otherwise voice 1's rests sit near the top line and voice 2's near the bottom line, and a rest moves in whole staff spaces to clear the other voice's noteheads. A whole or half rest outside the staff gets a ledger line.
- **Ties and slurs.** Voice 1's ties and slurs go above the notes and voice 2's go below, on the outside of the pair. Each stays within its own voice, including the hammer-on and pull-off slurs on the notation staff.
- **Grace notes.** Voice 1's grace notes have stems up and voice 2's have stems down. Each voice's grace notes lead into that voice's next note.
- **Articulations and tremolo.** Articulation marks go on the stem side: above voice 1 and below voice 2. A whole-note tremolo in voice 2 goes below the note.
- **TAB.** The frets of both voices show in the same columns. If both voices play the same string at the same time, voice 1's fret is drawn and voice 2's is left off the TAB staff. It still shows on the notation staff. Hammer-ons, pull-offs, slides, slide-ins, slide-outs and bends link within each voice.
- **TAB marks.** In a column where both voices have a note, voice 1's mark wins for each kind: tremolo, vibrato, trill, tap, golpe. Right-hand letters and pick strokes on a tab-only track are taken from voice 1 as a whole. A kind of mark that only voice 2 has is drawn above the TAB staff in voice 1's place. Strums and whammy are voice 1 only.
- **Rhythm on TAB.** Each voice has its own row of the rhythm band (stems, beams, flags, dots, tuplets and rests). Voice 1's row holds its stems, beams, flags and tuplets as before. Voice 2's row sits below it, with its stems hanging down, so a note that only voice 2 plays gets a stem in that row. An unmerged rest now sits in its voice's row below the staff, not in the staff, so a voice 1 rest never covers voice 2's frets. Those rests are drawn at a smaller size and without a background. A merged rest is drawn once, in the staff.
- **Voice 2 beat marks.** Voice 2 can carry vibrato, trills, ornaments, right-hand letters, tap, left-hand tap, slap, pop, golpe, pick strokes and fermatas. On the notation staff they go below the staff, not above it. Going outward from the staff they stack in this order: vibrato, trill or ornament, right-hand letters, tap letter, golpe, pick stroke, then the fermata. The fermata is drawn inverted. On TAB they are drawn above the TAB staff, as described under TAB marks.
- **Voice 1 beat marks.** These are read from voice 1 only, and are not drawn on a voice 2 beat: chord symbols and chord diagrams, dynamics, left-hand fingering, strum arrows, arpeggios, let ring, P.M., rakes, whammy, harmonic labels (A.H., T.H., P.H., S.H.), pick scrape, barre and beat text. Put them on a voice 1 beat.
- **Hidden rests.** `{ "type": "rest", "duration": "half", "hidden": true }` takes its time but draws nothing and takes no room. Use one to start a voice later. A hidden rest works in any measure.
- **When a measure has two voices.** A measure has two voices when voice 2 has at least one beat that is not a hidden rest. A voice 2 made only of hidden rests leaves the measure as a single-voice measure, with automatic stems.
- **Other cases.** A `voices` list with one entry is the same as `beats`. An empty `voices` array, or a value that is not an array, falls back to `beats`. Entries after the second are ignored, so a measure has at most two voices. If voice 1 is empty and voice 2 has notes, voice 1 draws nothing.
- **No bar-length check.** Voices are not compared with the time signature. Each voice is drawn with the beats it has, even if it is longer or shorter than the bar.
- **SVG.** In a two-voice measure, voice 2's marks on the notation staff are inside a `<g class="voice-2">` group: noteheads, accidentals, dots, ledger lines, stems, beams, grace notes, rests, articulations, tremolo, tuplets, vibrato, trills, ornaments, right-hand letters, tap letters, golpe, pick strokes and fermatas. A voice 2 fermata also has the class `fermata-below`. Single-voice measures have no such group. TAB frets, ties and slurs are not inside it. Voice 2's TAB rhythm row is a `<g class="tab-rhythm voice-2">`, after voice 1's `tab-rhythm` group.

## Beat text

Free text on a beat, such as "rit.", "mute" or "let go". It is italic and starts at the beat's left edge.

- **Above the staff:** `text: 'rit.'`. The text sits above the track's top staff: the notation, or the TAB when the track shows no notation.
- **Below the staff:** `text: { text: 'mute', below: true }`. The text sits under the track's lowest staff: the TAB, or the notation when the track shows no TAB.
- **Which beats.** Note and rest beats in voice 1 only. Grace notes and voice 2 ignore it, so put the text on the voice 1 beat instead (see [Voices](#voices)).
- **Clearance.** The text sits clear of what is already above or below its beat: notes, stems, chord symbols and diagrams, fermatas, pick strokes and TAB marks. Text above the staff sits at least 1.5 staff spaces above its top line. If texts on one staff overlap, the later one is placed above the earlier one.
- **Room.** Beat text takes no horizontal room and is not wrapped. A long text in a dense bar can run into the space of the next beat, and the widths are estimated, so keep it short.
- **Order.** Beat text is drawn after the fermatas, and volta brackets and navigation marks are drawn above it.
- SVG classes: `beat-text`, with `beat-text-below` added for text under the staff.

```json
{ "type": "note", "duration": "quarter", "text": "rit.", "notes": [{ "string": 1, "fret": 5 }] }
```

## Known limitations

- **Dots on chords with seconds.** Augmentation dots on a chord whose notes sit a second apart may not be placed cleanly.
- **Grace notes.** Accidentals on a grace chord share one column, so two that sit a second apart can touch. A grace-note slur clears only the noteheads, so it can cross an accidental on the note or grace it ends at. A slur from a grace note that crosses a line break is not split.
- **Chord symbols.** Adjacent wide chord symbols can overlap each other horizontally. On tab-only tracks, chord symbols are drawn only above a chord diagram.
- **Chord diagrams: overlap.** Diagrams get no horizontal space, so chord changes on close beats can overlap each other or a neighbouring chord symbol.
- **Chord diagrams: names.** Only the diagram is moved inwards at the start or end of a system. A long name centred above it can still reach past the staff. A segno or coda at the start of a measure may sit beside a diagram name rather than above it.
- **Chord diagrams: no capo or left-handed diagrams**, no chord chart at the top of the score, and no chord library: every shape comes from the score. Shapes are not checked against the chord name or the tuning.
- **Chord diagrams: taller systems.** With diagrams, a staff reaches about 10 to 11 staff spaces above its top line, against about 4 for a plain chord symbol, so systems get taller and fewer fit on a page.
- **Time signatures across tracks.** Tracks cannot have different time signatures within the same measure column.
- **Estimated sizes.** Glyph and text widths are estimated, not measured from the font. Spacing may look slightly different with another font or at unusual sizes.
- **Rhythm on TAB staves.** Ties are not shown in the rhythm band, and rhythm slashes are not drawn. Tied-fret parentheses are drawn only with `tiedFrets: 'parens'` (see [Tied fret numbers](#tied-fret-numbers)). Tremolo picking stays above the fret number and is not drawn on the stem. On staves with four strings or fewer, 32nd and 64th rests can reach a little past the outer string lines; the gap to the staff above grows to fit them.
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
- **Whammy.** Dip, dive, return, pre-dive, scoop and "w/bar" only. A dip and a scoop have a fixed depth, and a scoop has no text. `whammy: { type: 'scoop' }` is still ignored; use `whammyScoop`. A return with nothing held is ignored. A hold that another whammy mark ends gets no rise. A held line rises over the tallest mark under it as one level, not following each beat.
- **Rake.** The pick direction is not drawn, and the dead-note grace notes are not generated.
- **Slap and pop.** Drawn above the staff only.
- **Trill.** No speed, accidental or target notehead. A trill continues only over notes tied to it with `tieEnd` (see [Picking and playing directions](#picking-and-playing-directions)). The trill glyph's size is estimated from the font, like other glyphs.
- **Compound bends: room.** A compound bend needs about 1.6 sp after its first peak, up to the next note on the system less 0.6 sp. When the next note is closer than that, the second rise runs past the next note's fret number.
- **Bend labels.** Amount labels of bends on two notes that sit close together can overlap. A compound bend's second label is raised above the first only inside that one bend.
- **Pick strokes and TAB.** Pick strokes are not drawn on the TAB staff when the track also shows notation.
- **Ornaments.** Notation staff only. Not drawn on TAB, on tab-only tracks, on grace notes or on rests. No accidentals on ornaments, and no slashed or upward-turn forms.
- **Left-hand fingering.** Notation staff only, on main notes. Not drawn on TAB, on tab-only tracks, on grace notes or in voice 2. The digits are plain text, with no string-number circles. A tie arc at the start of a system can pass under a digit.
- **Right-hand letters.** Drawn for each beat's own notes only. There are no rasgueado letter sequences across beats.
- **Golpe and left-hand tap.** Not drawn on rests or grace notes. The golpe is one sign for all three values: `'thumb'` and `'finger'` differ only in their class.
- **Pick scrape.** Only the "P.S." label is drawn. The direction and scrape arrows are not.
- **Barre.** Only the label is drawn: no barre bar, string range or chord name.
- **Strum and arpeggio.** No arpeggio line across several staves or tracks, no partial strums (on some strings only) and no rasgueado finger letters. Ties, slurs, slides and H / P arcs that end at an arpeggiated chord can cross its line. On a track with notation and TAB the strum arrows sit between the two staves. Neighbouring pick strokes are not avoided.
- **Playing directions take no extra room.** Pick strokes, strum arrows, "T" / "S" / "P" letters, left-hand taps, golpes, ornaments, right-hand letters, trills, whammy lines and dips get no extra horizontal space, so a dense beat can crowd. Left-hand fingering digits are the exception: they take room left of their chord. Examples: a pick stroke next to a vibrato, or a dip close to the next note.
- **Slides take no room.** Slide-ins and slide-outs are shortened to fit beside their note, but add no horizontal space, so a dense beat can crowd them.
- **Pre-bends and releases on notation.** The notation staff shows the note as written. Pre-bends and releases appear on tab only.
- **Hammer-on slurs need `string`.** A `hammerPull` note without `string` gets no slur on the notation staff.
- **Auto slurs span rests.** A hammer-on or pull-off slur runs over any rest between its first and last notes.
- **Release arrow.** A release arrow stops 0.2 sp before the next fret number on the string above, but its fall is never shorter than 0.6 sp, so it can still meet that number in very tight spacing.
- **Let ring has no ties.** A let-ring run is a dashed label only. There are no per-note ring-out ties.
- **Navigation is drawn, not played.** Repeats, endings, jumps and repeat counts are not unrolled or checked for sense.
- **Coda layout.** A coda does not force a line break or leave a gap before it.
- **Navigation on the top staff only.** Brackets and marks are drawn once per system, above the top staff. There are no brackets per instrument group.
- **One bracket height per system.** All volta brackets of a system sit at the height of the tallest one.
- **Long navigation text.** A long jump text can reach left into the previous measures, and marks in adjacent narrow measures can crowd each other. A long ending label can run past the end of its bracket. Text widths are estimated, so the spacing around these marks is approximate.
- **Voices: two at most.** A measure cannot have a third voice.
- **Voices: beat marks on voice 2.** Chord symbols and diagrams, dynamics, left-hand fingering, strums, arpeggios, let ring, P.M., rakes, whammy, harmonic labels, pick scrape, barre and beat text are drawn for voice 1 only. Dynamics for voice 2 are not supported yet. Voice 2 still draws its notes, articulations, tremolo, vibrato, ties, slurs and slides, and the marks listed under [Voices](#voices).
- **Voices: shared heads and merged rests need a close match.** A shared unison head and a merged rest only apply when the two notes or rests match exactly enough (see [Voices](#voices)). Any other unison moves voice 2 to the right, and any other pair of rests stays separate.
- **Voices: release arrows on voice 2.** A voice 2 bend release arrow can still cross a fret number on the TAB staff.
- **Voices: whole-measure rests.** A whole-measure rest is centred in the bar and does not move to clear the other voice's notes.
- **Voices: links from a single-voice measure.** A tie, slur, hammer-on, pull-off or slide that starts in a single-voice measure and ends in voice 2 of the next measure is not drawn.
- **Voices: grace notes.** Graces of both voices that lead into notes at the same time can collide.
- **Voices: TAB.** A voice 2 fret on the same string as a voice 1 fret at the same time is left off the TAB staff.
- **Voices: dots.** Where the voices do not clash, a dot can sit close to the other voice's noteheads.
- **Tremolo room.** A stemless (whole) note keeps the room for three strokes even with `'8th'` or `'16th'`, so a mark above it can sit a little higher than it needs to.
- **Articulations and fermatas on tab.** They are not drawn on tab-only tracks.
- **Score text: no wrapping.** Each text is drawn on one line; only `instructions` and `copyright` start a new line at each line break (other fields turn a line break into a space). A long line runs past the margin, so shorten it or split instructions and copyright yourself. Instructions and copyright beyond 8 lines are not drawn, and nothing warns you.
- **Score text: no sideways placement.** Beat text takes no horizontal room and never moves sideways; overlapping beat texts stack upward instead. Section markers move right only to keep a gap from the previous marker on the same system. Widths are estimated, so spacing is approximate.
- **Capo is display only.** The capo line does not transpose the music, change the pitches, or move the fret numbers. Transposition is not supported.
- **Tuning chart compares with usual tunings.** A bass-clef 6-string track that keeps the default guitar tuning lists every string, because that tuning is not its usual one. Any string count other than 4 to 8 lists every string.
- **Header words are English.** "Words by", "Music by", "Capo fret" and "Track N" are fixed text.
- **Not included:** playback, an editor, and import/export of other file formats.

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

### 1.9.0 — 2026-11-20

Bends, whammy, slides. Scores that use none of the inputs listed below are unchanged. Four existing inputs were ignored or drawn differently before 1.9.0, and now draw what they name, so check any score that uses them. Those changes are listed first.

Changes to existing inputs:

- Bend strings with a second bend, such as `'full release full'` or `'pb 1/2 release 1/2'`, drew before as one bend labelled with the whole string. They now draw a compound bend: rise, release fall and second rise, with both amounts labelled. The object form with `rebend` (`{ type: 'bend', amount: '1/2', rebend: 'full' }`) drew only `amount` before, and now draws the compound bend. A release note after a compound bend with no amount now falls by the second amount. See [Hammer-ons, pull-offs, slides and bends](#hammer-ons-pull-offs-slides-and-bends).
- `harmonic: 'feedback'` was not recognised and drew as a natural harmonic (diamond and `<12>`). It now draws a normal notehead, the plain fret and an `Fdbk.` label.
- `slide: 'legato'` drew only the shift slide before. It now also draws a letterless arc on TAB and a slur on the notation staff. That notation slur is drawn even with `hammerPullSlurs: false`, so set `slide` to something else if you want no slur.
- Trills tied forward: a trill's wave ended before the next beat even when that beat was tied to the trilled note. Now the wave runs over the notes tied to it (when the next note has `tieEnd`), continues on the next system without a second "tr", and marks on the tied notes stack above it. Any existing score with a trilled note tied to a `tieEnd` note will draw a longer wave.

New:

- `whammyScoop` on a beat: a small whammy scoop into the note on TAB. `whammy: { type: 'scoop' }` is still ignored, so existing scores with it draw as before.
- `whammyBar` on a beat: a "w/bar" label run on TAB, like let ring. It is never added automatically.
- `harmonic: 'feedback'`: the "Fdbk." harmonic (see the change above).
- New SVG classes: `bend-rebend`, `whammy-scoop`, `whammy-bar`, `legato-slide`, `harmonic-feedback` and `trill-continued`.

### 1.8.0 — 2026-11-08

Voices and TAB rhythm. Scores with no `voices` are unchanged. Two-voice scores look different in several places, so check them after upgrading. Those changes are listed first.

Changes to existing two-voice scores:

- Voice 2's beat marks are drawn: vibrato, trills, ornaments, right-hand letters, tap marks, golpe, pick strokes and fermatas. On the notation staff they go below the staff, and the fermata is inverted. Before 1.8.0 voice 2 drew none of these.
- On TAB, voice 2's tremolo, vibrato, trill, tap and golpe (and, on tab-only tracks, right-hand letters and pick strokes) are drawn above the staff in their column when voice 1 has no such mark there. Voice 1's mark wins when both have one.
- TAB rhythm: voice 2 has its own row of stems, beams, flags, dots, tuplets and rests, below voice 1's row. The rhythm band is taller.
- Rests on TAB: a rest that is not merged moves out of the staff into its voice's row, so a voice 1 rest no longer covers voice 2's frets.
- Unisons: where both voices play the same note in the same way, they share one notehead. Other unisons move voice 2 right, as before.
- Rests on notation: a rest that both voices take at the same time, for the same length, is drawn once.

New:

- `tiedFrets: 'parens'` on a track: parentheses around a tied-to fret number on TAB, such as `(5)`. It is off by default, so no score changes unless it sets this field. See [Tied fret numbers](#tied-fret-numbers).
- New SVG classes: `tab-rhythm voice-2` (voice 2's TAB rhythm row) and `fermata-below` (a voice 2 fermata). Voice 2's notation marks sit inside the `voice-2` group.

### 1.7.0 — 2026-11-08

Ornaments and hand marks. Scores that do not use these fields are unchanged. The fields were ignored before 1.7.0, so a score that already sets one of them (for example `finger` on a note) will now draw the mark.

- `ornament` on a note: a turn, inverted turn, upper mordent or lower mordent above the beat, on notation. See [Ornaments, fingering and hand marks](#ornaments-fingering-and-hand-marks).
- `finger` on a note: a left-hand fingering digit (`1` to `4`, `'T'` or `0`) left of the chord, on notation. Room is added only for a chord that has one.
- `rightFinger` on a note: a right-hand letter (`p`, `i`, `m`, `a`, `c`) above the beat. On tab-only tracks it sits above the TAB.
- `golpe` on a beat: a golpe sign above the tap "T" place, on notation and TAB.
- `leftHandTap` on a note: a left-hand tapping sign in the tap "T" place, on notation and TAB. One letter per beat: tap, then left-hand tap, slap and pop.
- `pickScrape` on a beat: a dashed "P.S." label run, like let ring.
- `barre` on a beat: a "C II" or "½C V" label run. It repeats after a system break.
- Technique labels stack in the order P.M., harmonic, let ring, P.S., barre, rake.
- New SVG classes: `ornament`, `ornament-turn`, `ornament-inverted-turn`, `ornament-upper-mordent`, `ornament-lower-mordent`, `fingering-left`, `fingering-right`, `golpe`, `golpe-thumb`, `golpe-finger`, `left-hand-tap`, `pick-scrape`, `pick-scrape-down`, `pick-scrape-up`, `barre` and `barre-half`.

### 1.6.0 — 2026-11-08

Score text and structure. Scores that do not use these fields are unchanged, and a header with only a title, composer and tuning label looks as before.

- Header fields `subtitle`, `artist`, `album`, `words`, `music`, `instructions` and `copyright`. `words` and `music` share one "Words & Music by" line when they are the same name. See [Page header](#page-header).
- `copyright` is drawn at the foot of the score, and the SVG grows to fit it.
- `capo` on a track adds "Capo fret N" to the header. It is display only. See [Capo and tuning chart](#capo-and-tuning-chart).
- `showTuningChart: true` lists the strings tuned differently from the usual tuning in the header, such as "⑥ = D". It is off by default.
- `section` on a measure draws a boxed letter or text above the staff, with any text after the box. See [Repeats and navigation](#repeats-and-navigation).
- `repeatCount` on a measure draws "x3" at a repeat end, for counts from 2 to 99.
- `text` on a beat draws free italic text above the staff, or below it with `below: true`. Note and rest beats in voice 1 only. See [Beat text](#beat-text).
- New SVG classes: `subtitle`, `artist`, `album`, `words`, `music`, `words-music`, `instructions`, `tuning-chart`, `copyright`, `score-footer`, `section`, `section-letter`, `section-text`, `repeat-count`, `beat-text` and `beat-text-below`.

### 1.5.0 — 2026-11-08

Note-effect variants. Scores that do not use these values are unchanged. Some values that were ignored, or drawn as the default, now draw what they name. See the first four items below.

- `vibrato: 'wide'` draws a taller, longer, heavier wave on notation and TAB. Before 1.5.0 it drew the normal wave. Marks above a wide vibrato sit a little higher to clear it. See [Vibrato and tremolo](#vibrato-and-tremolo).
- `tremolo: '8th'` and `'16th'` draw one and two strokes. Before 1.5.0 they drew three. `'32nd'` draws three, as `true` does. Numbers such as `8` still draw three strokes.
- `fermata: 'short'` and `'long'` draw the short and long fermatas, and `'normal'` draws the usual one. Before 1.5.0 all three drew nothing. The string `'true'` and the number `1` still draw nothing.
- `articulations: ['marcato']` (or `'heavyAccent'`) and `['staccatissimo']` draw their marks. Before 1.5.0 they were ignored. `staccatissimo` replaces `staccato`, and `marcato` replaces `accent`, when both are listed.
- The articulations demo now shows a marcato.
- New SVG classes: `vibrato-wide`, `tab-vibrato-wide`, `tremolo-8th`, `tremolo-16th`, `tremolo-32nd`, `tab-tremolo-8th`, `tab-tremolo-16th`, `tab-tremolo-32nd`, `fermata-short` and `fermata-long`.

### 1.4.0 — 2026-11-08

Two voices on one staff. Nothing changes for scores that do not use them.

- `voices` on a measure: two rhythms on one staff, such as a melody over a held bass. Voice 1 stems up and voice 2 stems down, on notation and TAB. See [Voices](#voices).
- `hidden: true` on a rest: the rest keeps its time and draws nothing.
- Playing marks such as chord symbols, dynamics, fermatas, pick strokes and tap or trill letters are drawn for voice 1 only. Voice 2 draws its notes, articulations, tremolo, ties, slurs and slides.
- New SVG class: `voice-2`, on the notation of voice 2 in a two-voice measure.

### 1.3.1 — 2026-11-01

Three notation fixes. One change affects existing scores: pitches worked out from string and fret in a flat key now use that key's flats. Use an explicit `pitch` to keep the old spelling.

- Pitches from string and fret follow the key's flats. In F major, a fret-derived A# is now written Bb. In Bb major, A# and D# are written Bb and Eb. Other black keys, sharp keys and C major are unchanged, and before 1.3.1 these were always sharps.
- Accidentals on grace notes are drawn, at grace size, and carry through the measure like other accidentals. An explicit `accidental` on a grace note is always drawn. Grace notes with accidentals get a little more room.
- A release arrow stops 0.2 sp before the next fret number on the string above, instead of running into it. Very tight spacing can still bring it close (see [Known limitations](#known-limitations)).
- Renders change for scores with grace notes that have altered pitches, scores with fret-derived black keys in a flat key, and scores with a release arrow next to a note on the string above. There are no API or theme changes.

### 1.3.0 — 2026-10-27

Legato, slides and pre-bends. One change affects existing scores: hammer-ons and pull-offs now get a slur on the notation staff. Set `hammerPullSlurs: false` in the theme to keep the 1.2.0 notation.

- `hammerPull` on the notation staff: each run of hammer-ons and pull-offs on one string gets a slur. Slurs above a tuplet bracket stay clear of it. Notes need `string`. Theme key `hammerPullSlurs` (default `true`).
- `slideIn` and `slideOut` on a note: a short slide into the note from below or above, or off it downward or upward. Drawn on TAB and notation, with no change to the spacing.
- `bend` takes pre-bends: `'prebend full'`, `'pb 1/2'` or `'pre-bend'`, with an optional `release`, or `{ type: 'prebend' }`. Drawn on TAB.
- `bend: 'release'` is now a release note: its own note that falls back to the unbent pitch, with its fret in parentheses. Its amount defaults to the last bend on that string. Before 1.3.0 a bare `'release'` drew a bend labelled "release". `'full release'` still means a bend and release.
- New SVG classes: `slide-in`, `slide-in-below`, `slide-in-above`, `slide-out`, `slide-out-down`, `slide-out-up`, `bend-prebend` and `bend-release`. Notation hammer-on and pull-off slurs use the existing `slur` class.

### 1.2.0 — 2026-10-27

New playing marks. Nothing changes for scores that do not use them.

- `strum` on a beat: a strum arrow (↓ / ↑) above the TAB staff, or above the notation staff on a track without TAB. Consecutive strums on a system share one height, so rasgueado runs line up. A strum replaces the beat's pick stroke.
- `arpeggio` on a beat: a wavy line left of a chord on notation and TAB, with an optional arrowhead (`'up'` / `'down'`). The chord keeps room for the line, 1 sp beyond its leftmost ink.
- New SVG classes: `arpeggio`, `arpeggio-up`, `arpeggio-down`, `strum`, `strum-up`, `strum-down`.

### 1.1.0 — 2026-10-27

New playing marks. Nothing changes for scores that do not use them.

- Whammy bar: `dive` (held until a `return`, drawn across line breaks), `return` and `predive`, next to the existing dip. A beat with `whammy: { type: 'dive' }` was ignored before and now draws a dive.
- Bass `slap` ("S") and `pop` ("P") on a note, with `tap` ("T") winning over `slap` and `slap` over `pop`.
- `rake` on a beat: a dashed "rake" label over the beat and the grace notes before it.
- `trill` on a note: "tr" and a wavy line on notation and TAB, with `(n)` on TAB for a fret or pitch target.
- New SVG classes: `slap`, `pop`, `rake`, `trill`, `whammy-dive`, `whammy-hold`, `whammy-predive`, `whammy-return`.

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

- Staccato, staccatissimo, tenuto, accent and marcato marks, normal, short and long fermatas, normal and wide vibrato, tremolo picking at three speeds, and dynamics from p to fff, plus sfz, rfz and n.

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
  - `directions.js`: the playing direction fields (let ring, pick strokes, strum, arpeggio, tap, slap, pop, whammy, rake, trill, slide in and out, the bend grammar) and their canonical values.
  - `hands.js`: the hand-mark fields (ornament, left- and right-hand fingering, golpe, pick scrape, barre), their canonical values and the barre label.
  - `chordShapes.js`: chord-diagram shapes. Validates an author's shape against the track and picks the shape a beat shows.
  - `navigation.js`: the navigation fields (`ending`, `segno`, `coda`, `jump`, `section`, `repeatCount`), their canonical values and the merge across tracks.
  - `scoreText.js`: canonical forms of the score text fields (header lines, sections, repeat counts, beat text, capo) and the capo and tuning chart rows.
  - `noteEffects.js`: the canonical values of the `vibrato`, `tremolo` and `fermata` fields (for example `'wide'`, `'16th'` or `'short'`), used when drawing.
  - `twoVoice.js`: the one shared rule for two voices (a voice 2 counts only when it has a beat that is not a hidden rest), which voice a layout element belongs to, and which beat supplies each TAB mark of a column.
  - `layout/`: positioning, no drawing.
    - `index.js`: `computeLayout`. Ties the layout steps together and sets element positions.
    - `timeline.js`: the shared note timeline across tracks and the horizontal spacing.
    - `chord.js`: chord geometry (seconds, accidental columns, dots, ledger lines), the room an arpeggio line needs and the columns of left-hand fingering digits.
    - `accidentals.js`: accidentals carried through a measure.
    - `voices.js`: the shared columns of a two-voice measure (clash shift, shared accidentals, dots, rest positions), shared unison noteheads, merged rests and the TAB marks of each column.
    - `systems.js`: system breaking, justification, headers, courtesy signatures, instrument-name indents.
    - `beams.js`: beams and tuplet groups, including compound meters.
    - `vertical.js`: places each staff vertically from its content.
    - `ink.js`: measures the drawn extent of each staff. An opt-in overlap mode counts every mark whose width reaches into an x range.
    - `navigation.js`: groups endings into volta brackets, splits them at line breaks and places the segno, coda, jump and repeat-count marks and the section markers horizontally.
    - `tabRhythm.js`: geometry of the rhythm on TAB staves (stem positions and lengths, flags, dots, horizontal room).
  - `draw/`: SVG drawing.
    - `system.js`: draws one system and its measures.
    - `staff.js`: staff lines, clefs, key and time signatures, barlines.
    - `notation.js`: notes, stems, beams, fermatas, tuplets, chord symbols, ties and slurs. It re-exports the beat marks from `noteMarks.js`.
    - `noteMarks.js`: articulations, tremolo and vibrato marks on a beat, and the top and bottom edges of a beat's marks.
    - `tab.js`: tab staff, fret numbers, tab clef, hammer-ons, slides, bends, palm mutes, tap letters and the left-hand tap glyph, whammy dips, and TAB vibrato and tremolo.
    - `tabLinks.js`: the per-note TAB links (hammer-ons, pull-offs, slides, legato slides, slide-ins and slide-outs, bends, pre-bends, releases and compound bends), drawn for each track by `passes/tabTechniques.js`.
    - `bend.js`: a compound bend on TAB (rise, release fall and second rise, with both amount labels), called by `tabLinks.js`. Single bends stay in `tab.js`.
    - `whammy.js`: whammy dive, hold, return and pre-dive lines, and the whammy scoop (planning and drawing).
    - `trill.js`: the trill mark ("tr" and a wavy line), and a trill's wave continued over tied notes and on later systems.
    - `tabTrill.js`: TAB trill planning and drawing (including the continued waves), drawn by `passes/tabTechniques.js`.
    - `voice2Marks.js`: voice 2's marks and fermatas below the notation staff, drawn by `passes/playingDirections.js`.
    - `arpeggio.js`: the arpeggio line left of a chord, on notation and TAB, drawn with each chord.
    - `strum.js`: strum arrows, and their placement above the TAB staff.
    - `handMarks.js`: the shapes of ornaments, the golpe, right-hand letters and left-hand fingering digits. The passes and `system.js` place them.
    - `tabRhythm.js`: rhythm on TAB staves (stems, beams, flags, dots, tuplets and rests), drawn per measure, with a second row for voice 2 in two-voice measures.
    - `chordDiagram.js`: one chord diagram (the fretboard box with its dots, barres, fingers and name).
    - `passes.js`: the score-wide passes, drawn after all systems; re-exports them from `passes/` and documents their order.
      - `passes/common.js`: helpers shared by the passes.
      - `passes/notationBeats.js`: notation beats, slurs, beam groups and the space above a beat, shared by several passes.
      - `passes/curves.js`: ties, slurs (including hammer-on and pull-off slurs), grace-note slurs and notation slide-ins and slide-outs.
      - `passes/tabTechniques.js`: tab techniques (tap / left-hand tap / slap / pop letters, golpe, trills, whammy dips and lines). Hands the per-note links to `tabLinks.js`.
      - `passes/techniqueLabels.js`: technique labels (P.M., harmonics, let ring, pick scrape, barre, rake).
      - `passes/playingDirections.js`: pick strokes, strum arrows, ornaments, right-hand letters, notation tap / left-hand tap / slap / pop letters, golpe and trills.
      - `passes/chordsFermatas.js`: chord symbols and dynamics, and fermatas.
    - `header.js`: the page header rows (title, subtitle, credits, instructions, capo and tuning chart) and the copyright footer.
    - `navigation.js`: volta brackets, segno, coda, jump texts and repeat counts, and section markers above each system's top staff, drawn after the fermatas and beat text and before the tempo.
    - `beatText.js`: beat text (`beat.text`) above or below a track's staves, drawn after the fermatas and outside the `passes/` barrel.
    - `decor.js`: tempo, measure numbers, joining line, bracket and instrument names.
    - `svgUtil.js`: small SVG helpers.
  - `theme.js`: theme defaults and the pixel-key conversion.
  - `glyphs.js`: Bravura glyph names. `glyphMetrics.js`: approximate glyph bounding boxes. `textMetrics.js`: estimated text widths.
  - `font.js`: font loading. `pitch.js`, `duration.js`: pitch and duration helpers. `rational.js`: exact fractions for note timing.
- `examples/`: sample scores.
- `fonts/`: the Bravura font (SIL Open Font License; see `fonts/BRAVURA-LICENSE.txt`).
- `tests/`: snapshot tests, unit checks, engraving checks, assertions and structural guards (`run.js`, `units.mjs`, `engraving.mjs`, `articulations.mjs`, `structure.mjs`), the test hooks and DOM shim the runner uses (`hooks.mjs`, `dom-shim.mjs`), the characterization fixtures (`fixtures/characterization.js`), and the saved snapshots (`snapshots/`).
- `index.html`: the demo page. `lead-riff.html` and `lead-solo-f.html`: demo pages for the lead-riff and lead-solo examples.
- `docs/features.html`: feature summary page with live examples (serve over http, like the demo).
- `docs/ARCHITECTURE.md`: design notes for a future editor, import and export layer (not built yet).

## License

- The code is licensed under the MIT License. See `LICENSE`.
- The Bravura font in `fonts/` is licensed under the SIL Open Font License, Version 1.1. See `fonts/BRAVURA-LICENSE.txt`.
