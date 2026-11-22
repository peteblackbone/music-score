# music-score

Version 2.2.0 · MIT licence

A small vanilla JavaScript library that draws music notation and guitar tablature as SVG in the browser. You describe a score as plain JSON, and the library renders it with the Bravura music font (SMuFL). From 2.0.0 it also includes a keyboard editor for tablature (`ScoreEditor`), and from 2.1.0 that editor can add playing techniques such as hammer-ons, slides, bends and accents from the keyboard. From 2.2.0 it can also change the score's header, its tracks, tuning and capo, time and key signatures, clef changes, repeats, endings, navigation marks, sections and tempo. See [Editing scores](#editing-scores-scoreeditor).

- No build step and no dependencies. Plain ES modules.
- Standard notation staves, tab staves, or both, stacked per track.
- Browser only. There is no playback, and no import or export of other file formats. The editor reads and writes its own JSON, and your page decides where it is stored.

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

Open http://127.0.0.1:8765/editor.html for the keyboard editor demo. See [Try the editor](#try-the-editor).

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
- `getSvg()`: the SVG element drawn by the last `render()`, or `null` before the first one.
- `getHitMap()`: where each staff, measure and beat was drawn, as plain data. `null` before the first `render()`. See [Hit map](#hit-map-and-svg-access).
- `hitTest(x, y)`: the beat at an SVG point, or `null` when the point is outside the staves. See [Hit map](#hit-map-and-svg-access).

### Hit map and SVG access

`getHitMap()` and `hitTest()` let a page find what is under a point, for example after a mouse click. Both use the last `render()`. They do not change the SVG, so the drawn output is the same with or without them.

`getHitMap()` returns this shape. All positions are in SVG units, the same units as the SVG's `viewBox`:

```
{ width, height,
  staves:   [{ sysIdx, ti, kind: 'notation' | 'tab', y, lineBottom, x1, x2, stringSpacing?, stringCount? }],
  measures: [{ sysIdx, ti, measureIndex, x, contentX, endX, lastMeasureIndex? }],
  elements: [{ sysIdx, ti, measureIndex, voice: 1 | 2, beatIndex, x, width, isGrace, isRest }] }
```

- `sysIdx` is the system (the line of music) and `ti` the track index. Both count from 0.
- A staff's `y` is its top line. On a notation staff the bottom line is at `y + lineBottom`. On a tab staff, string `n` (1 is the top string) is at `y + (n − 1) × stringSpacing`, and `stringCount` gives the number of strings.
- A measure runs from `x` to `endX`. `contentX` is where its first beat can start, after the clef and signatures. `lastMeasureIndex` is set on the first measure of a multi-measure rest, and gives the last measure it covers.
- An element's `x` is the centre of the note or rest, and `width` is its width. `beatIndex` is the beat's index in `beats`, or in `voices[0].beats` or `voices[1].beats` for a two-voice measure. Grace notes and hidden rests keep their own index.
- `hitTest(x, y)` returns `{ ti, measureIndex, beatIndex }`, plus `string` on a tab staff (1 is the top string). It returns the nearest voice 1 note or rest by `x`, and the nearest string by `y`. It returns `null` outside the staves.

To turn a mouse event into SVG units:

```js
const svg = renderer.getSvg();
const pt = svg.createSVGPoint();
pt.x = event.clientX;
pt.y = event.clientY;
const p = pt.matrixTransform(svg.getScreenCTM().inverse());
const hit = renderer.hitTest(p.x, p.y); // { ti, measureIndex, beatIndex, string? } or null
```

The map describes the last `render()`. After you change the score, call `render()` again before you use it.

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
- `tabFontSize`, `dynamicFontSize`, `lyricFontSize`: text sizes in px. `lyricFontSize` (default 13) sizes the lyrics under the staff (see [Lyrics](#lyrics)).
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

## Editing scores (ScoreEditor)

From 2.0.0, `ScoreEditor` lets a person type and edit tablature from the keyboard. It draws the score with the same renderer as above. Users can type frets, change rhythms, and add or delete measures, with undo and redo. The editor keeps the score in memory and gives you the score as JSON. It stores nothing itself, so saving is up to your page.

Editing notes is keyboard-only. A mouse click places the cursor, but there is no mouse pitch entry, no range selection and no copy and paste yet. The settings from 2.2.0 are methods on the editor, and the demo's Score…, Tracks… and Measure… dialogs are mouse-friendly forms for them. See [Limitations in 2.2](#limitations-in-22).

### Try the editor

Start the demo server as in [Running the demo](#running-the-demo), then open http://127.0.0.1:8765/editor.html.

- **New…** starts an empty score. Choose a title, a time signature (1 to 32 beats over 1, 2, 4, 8, 16 or 32), an instrument (6-, 7- or 8-string guitar, 4-, 5- or 6-string bass, or ukulele), and the staves (notation and TAB, or TAB only).
- **Example** loads `lead-riff`, `lead-solo-f` or `example-score`.
- **Open JSON…** and **Download JSON** read and write a score file. Files over 5 MB are refused. A downloaded file is named after the title. Only letters, digits, spaces, hyphens and underscores are kept, and the name falls back to `score.json`.
- **Undo** and **Redo**, a duration palette (whole to 64th, dots and triplet), and a **Read-only** checkbox.
- An **Effects** group of buttons, one for each effect key except Shift+S and Shift+B (see [Effects](#effects)). Each button presses its key, so the same refusals apply. A button shows the cursor's current state, such as "Slide: legato" or "Dynamic + (mf)", and the group is disabled in read-only mode.
- **Score…**, **Tracks…** and **Measure…** open the settings dialogs, described under [Demo dialogs](#demo-dialogs). Apply makes the changes, and Cancel or Esc closes the dialog without changing anything. The three buttons are disabled in read-only mode (list actions in Tracks… apply at once).
- A status bar that shows the track, measure, beat, string, fret, duration, fill and effects of the cursor, and from 2.2.0 the time signature, key and tempo.
- **Autosave.** After each edit, undo or redo, the score is saved in this browser (localStorage key `music-score-editor:autosave`), 500 ms after the last change. Loading an example or a file is not saved until you edit. The next visit restores the saved score. If the saved data can't be read, the lead-riff example loads with a notice. If a restore never finishes drawing, the next visit in the same tab skips it.
- **First visit.** With nothing saved, the lead-riff example loads.
- **Unsaved changes.** New, Example and Open JSON ask first when the score has changed since the last load, New or Download, and always after a restored session (it was never downloaded). The autosave doesn't count as a save.

The demo's Keyboard shortcuts panel lists the main keys from the table below (not the numpad variants).

### Quick start

```js
import { ScoreEditor } from './music-score/index.js';

const editor = new ScoreEditor(document.getElementById('editor'), savedScore, { width: 900 });

editor.on('change', () => {
  localStorage.setItem('my-score', JSON.stringify(editor.getScore()));
});

// when you no longer need the editor:
editor.destroy();
```

- `new ScoreEditor(container, score, options)`: `score` is optional. Pass a score object or a JSON string. Without one, the editor starts with a new empty guitar score.
- The editor adds its own elements inside `container` and never writes outside it.
- Users start typing after they click the score or press Tab to reach it.

### Options

| Option | Default | Meaning |
|---|---|---|
| `width` | The container's width, or 900 px when that is 0 | Render width in px. Change it later with `setWidth()`. |
| `theme` | `defaultTheme` | Same as the renderer's `theme` option. See [Theme](#theme). |
| `readOnly` | `false` | Start in read-only mode. See [Editing rules](#editing-rules). |
| `maxFret` | `24` | The highest fret that can be entered. A whole number from 0 to 99. |
| `historyLimit` | `200` | The number of undo steps kept. A whole number from 0 to 10000. `0` turns undo off. |
| `twoDigitDelayMs` | `800` | How long after the first digit a second digit still makes a two-digit fret, in milliseconds. |
| `cursorColor` | `#3b5bdb` | Colour of the cursor. |
| `overfullColor` | `#d92d20` | Colour of the band on an overfull measure. |
| `underfullColor` | `#62636a` | Colour of the line on an underfull measure. |

A value that isn't a number falls back to the default. `maxFret` and `historyLimit` are rounded down to whole numbers and kept within their ranges. A negative `twoDigitDelayMs` falls back to the default.

### Methods

| Method | Returns | Notes |
|---|---|---|
| `loadScore(scoreOrJson)` | nothing | Replaces the score, clears undo and redo, and puts the cursor on the first beat, string 1. Throws on bad input and changes nothing. See [Saving and loading](#saving-and-loading). |
| `getScore()` / `toJSON()` | object | A copy of the score with `schemaVersion: 1`. Changing the copy does not change the editor. |
| `getCursor()` | `{ track, measure, beat, string }` | Positions count from 0. |
| `setCursor({ track?, measure?, beat?, string? })` | the cursor | Missing fields keep their values. The result is moved to the nearest valid position. |
| `getCursorInfo()` | object | What a status bar needs: fret, duration, dots, triplet, rest, fill, track name, string count, tuning note, effects, time signature, key signature, tempo and more. The effect and settings fields are described below the table. |
| `getMeasureFill(track, measure)` | `'under'`, `'full'` or `'over'` | An empty measure is `'under'`. Throws `RangeError` for an index out of range. |
| `handleKey(event)` | `true` if the key was used | Runs the command for a keyboard event (`key`, `code`, `ctrlKey`, `shiftKey`, `altKey`, `metaKey`). The editor calls this for you. Use it to drive the editor from your own buttons, for example `handleKey({ key: '.' })` for the dots button. |
| `setDuration(name)` | `true` or `false` | Sets the cursor beat's duration, or the duration of the next note on the end-of-measure position. Names: `whole`, `half`, `quarter`, `8th`, `16th`, `32nd`, `64th`. Returns `false` for an unknown name or in read-only mode. |
| `undo()` / `redo()` | `true` or `false` | `false` when there is nothing to undo or redo. |
| `canUndo()` / `canRedo()` | boolean | Always `false` in read-only mode. |
| `setReadOnly(flag)` / `isReadOnly()` | nothing / boolean | Read-only mode is described under [Editing rules](#editing-rules). |
| `setWidth(px)` | nothing | Redraws at the new width. Throws `RangeError` for zero or a negative number. |
| `refresh()` | nothing | Schedules a redraw. Call it if your page loads a font after the editor starts. |
| `focus()` | nothing | Moves keyboard focus to the editor. |
| `on(type, fn)` / `off(type, fn)` | `on` returns an unsubscribe function | Listen for `change` and `cursor`. See [Events](#events). |
| `updateScore(patch)` | `true` or `false` | Header text and the two score flags. See [Score header](#score-header). |
| `updateTrack(ti, patch)` | `true` or `false` | A track's names, clef, staves, TAB options, tuning and capo. See [Tracks](#tracks). |
| `addTrack(presetOrSpec?, at?)` | `true` or `false` | Adds a track, by default at the end. |
| `removeTrack(ti)` | `true` or `false` | Removes a track and the notes on it. |
| `moveTrack(from, to)` | `true` or `false` | Moves a track to a new position. |
| `updateMeasure(mi, patch, { track }?)` | `true` or `false` | Time and key signatures, clef, barline, repeats, endings, navigation marks and sections. See [Measure settings](#measure-settings). |
| `setTempo(tempo)` | `true` or `false` | A tempo mark on the cursor beat, or `null` to remove it. See [Tempo mark](#tempo-mark). |
| `getMeasureSettings(mi, ti?)` | object | What is set and in force at a measure. Changes nothing. See [Reading the settings](#reading-the-settings). |
| `lastMessage` | string | The text the editor last spoke, or `''` before anything is spoken. A read-only getter. |
| `ScoreEditor.INSTRUMENTS`, `ScoreEditor.TUNINGS` | frozen objects | The instrument and tuning presets (see [Tuning and capo](#tuning-and-capo)). |
| `destroy()` | nothing | Removes the editor's elements and listeners. Safe to call twice. Other methods then throw `Error('ScoreEditor destroyed')`. |

The effect fields of `getCursorInfo()` (2.1.0) describe the effects at the cursor. Use them to build your own effect controls:

- `effects`: the effect words at the cursor, as strings, in a fixed order: note words first (for example `hammer/pull`, `bend full`, `dead`), then beat words (`vibrato`, `palm mute`, `let ring`, the dynamic such as `mf`, then the articulations). `[]` on the end-of-measure position.
- `noteEffects` and `beatEffects`: the note words and the beat words on their own. Note words come only on a TAB track with a note on the cursor string.
- `effectSteps`: an object keyed by effect name (`hammerPull`, `slide`, `slideInOut`, `bend`, `deadNote`, `ghostNote`, `harmonic`, `vibrato`, `palmMute`, `letRing`, `louder`, `accent`, `staccato`). Each value is the position of the current value in that effect's cycle, counting from 0, or `-1` for a value the editor doesn't write. For `louder`, the value is the position on the dynamic scale, so `ppp` is 0 and `fff` is 7. Shift+B and Shift+D have no entry of their own, because the forward key covers them. `{}` on the end-of-measure position.

The settings fields of `getCursorInfo()` (2.2.0) describe the measure and beat at the cursor:

- `timeSignature`: `{ beats, beatType }`, the time signature in force. It is a new object each call.
- `keySignature`: the key signature in force, a whole number from −7 (seven flats) to 7 (seven sharps).
- `tempo`: `{ bpm, unit, dots, text, here }`, or `null`. It is the nearest tempo mark at or before the cursor beat on this track. `here` is `true` when the mark is on the cursor beat.

`ScoreEditor.LIMITS` is a static property with the input size limits. See [Saving and loading](#saving-and-loading).

### Events

| Event | When it fires | Payload |
|---|---|---|
| `change` | After each change to the score, once the editor has redrawn. Cursor moves don't fire it. | `{ source, command?, message? }`. `source` is `'edit'`, `'undo'`, `'redo'` or `'load'`. For an edit, `command` names it, for example `'digit'`, `'deleteNote'` or `'moveRight'` (when Right added a measure). For a settings call, `command` is the method name, such as `'updateMeasure'`, and `message` is the text spoken for it. |
| `cursor` | Straight away, on every cursor move. | `{ track, measure, beat, string, voice: 1 }`, counting from 0. |

For a key that edits the score and moves the cursor, `cursor` fires first, and `change` fires after the redraw. Read the score inside a `change` listener to get the new score.

### Keyboard

The editor acts only while it has focus. Tab and Shift+Tab are never taken, so keyboard users can always leave the editor.

| Key | Action |
|---|---|
| ← / → | Previous / next beat. Moves into the next measure. |
| ↑ / ↓ | Previous / next string. Stops at the top and bottom strings. |
| Ctrl+← / Ctrl+→ | First beat of the previous / next measure. |
| Home / End | First / last beat of the measure. End can reach the end-of-measure position. |
| Ctrl+Home / Ctrl+End | First beat of the score / last beat of the last measure. |
| PageUp / PageDown | Previous / next visible track. |
| 0 to 9 (also on the keypad) | Fret on the cursor string. Two quick digits make a two-digit fret, such as 12. |
| + or = | Shorter duration: halved, down to 64th. |
| - | Longer duration: doubled, up to whole. |
| . | Dots: 0, then 1, then 2, then 0. |
| / | Triplet on or off. |
| R | Note to rest, or rest to note. |
| L | Tie to the previous note on this string. On a tied note, removes the tie. |
| Delete or Backspace | Delete the note on the cursor string. |
| Ctrl+Delete or Ctrl+Backspace | Delete the beat, with the grace notes just before it. |
| Insert or I | Insert a rest with the current duration before the beat. |
| M | Insert an empty measure after the current one, in every track. |
| Shift+M | Insert an empty measure before the current one, in every track. |
| Shift+Delete or Shift+Backspace | Delete the current measure, in every track. |
| H | Hammer-on or pull-off on / off. |
| S | Slide → legato slide → off. |
| Shift+S | Slide in from below → slide in from above → slide out down → slide out up → off. |
| B | Bend: full → half → full and release → pre-bend full → release → off. |
| Shift+B | Bend, the same values backwards. |
| V | Vibrato → wide vibrato → off. |
| P | Palm mute on / off. Works on rests too. |
| X | Dead note on / off. On an empty string, a rest or the end of a measure, adds a dead note. |
| G | Ghost note on / off. |
| N | Harmonic: natural → pinch → off. |
| Shift+L | Let ring on / off. |
| D | Dynamic louder: mf, then f, ff, fff, then off. Works on rests too. |
| Shift+D | Dynamic softer: mp, then p, pp, ppp, then off. Works on rests too. |
| A | Accent → marcato → off. |
| Shift+A | Staccato → staccatissimo → off. |
| Ctrl+Z | Undo. |
| Ctrl+Y or Ctrl+Shift+Z | Redo. |
| Esc | Cancel a two-digit fret in progress. Otherwise not used. |

Notes:

- On a Mac, Cmd works in place of Ctrl.
- Keys are matched by the character they type, so they follow your keyboard layout.
- 2.2.0 adds no keys. The settings dialogs open from their toolbar buttons, which Tab reaches.
- Browser shortcuts are not taken: Ctrl+W, Ctrl+T, Ctrl+N, Ctrl+1 to 9 and the others. Alt combinations and the F-keys are not taken either.
- Shift+R, Shift+I, Shift+H, Shift+V, Shift+P, Shift+X, Shift+G and Shift+N do nothing, and so does Shift with an arrow key. The effect keys are listed in [Effects](#effects).

### Editing rules

**Cursor.** The cursor is one beat on one string, in one track and one measure. The cursor skips grace notes. Rests can be reached. When a measure is not full, its end is a position of its own, drawn as a dashed slot after the last beat. Hidden rests can be reached with the keys. A mouse click on a hidden rest usually selects the note beside it instead.

**Frets.**
- A digit sets the fret on the cursor string. On a note, it changes that string's fret. On a string with no note, it adds a note, which makes a chord. A string holds at most one note.
- On a rest, the rest becomes a note. At the end of a measure, or in an empty measure, a new note is added with the current duration.
- A fret above `maxFret` is refused, with the message "Frets go up to 24" (or your own limit).
- **Two-digit frets.** Type the second digit within `twoDigitDelayMs` (800 ms by default) of the first, on the same beat and string. Each digit shows at once. The first digit `1` followed by `2` gives fret 12, when 12 is at most `maxFret`. Otherwise the second digit replaces the first. The two digits make one undo step. Moving the cursor, or pressing any other key, ends the entry. Esc also ends it.
- Typing a fret on a slashed beat removes the slash.
- Fret entry needs a TAB staff. On a track with notation only, a digit is refused with "Fret entry needs a TAB staff".

**Pitch.** The editor writes `string` and `fret` only. It never writes `pitch`. When it changes the fret of a note that has a `pitch`, it removes that `pitch`, so the note is then drawn from its string, fret and tuning. Notes given by string and fret are written an octave above their sounding pitch, and their staff gets an 8vb clef. That means a treble staff with notes entered in the editor shows an 8vb clef. See [Pitch and octaves](#pitch-and-octaves).

**Rests.** R turns a note into a rest with the same duration. On a rest, R makes a note with fret 0 on the cursor string (TAB tracks only). On the end-of-measure position, R adds a rest with the current duration and keeps the cursor on it.

**Deleting.**
- Delete removes the note on the cursor string. If it was the last note, the beat becomes a rest of the same duration.
- On a rest, or on a string with no note, Delete does nothing and says "No note to delete".
- Ctrl+Delete removes the whole beat, with the grace notes just before it. The cursor moves to where the beat was. A measure can end up with no beats.
- Insert adds a rest before the beat, and before its grace notes, and moves the cursor onto it.

**Ties.** L ties the cursor note to the note on the same string in the previous beat. That beat can be the last beat of the previous measure. The tied note takes that note's fret. Press L on the tied note again to remove the tie. With no note to tie to, the editor says "Nothing to tie to". Changing the fret of a tied note, or deleting it, removes its tie.

**Durations, dots and triplets.** These change the beat under the cursor only. Nothing else in the measure moves, so a measure can end up too full or too empty. The status bar shows the fill of the measure as Under, Full or Over. The score draws an underfull measure with a dashed line below the staff, and an overfull measure with a red band. An empty measure has no mark. Moving onto a beat picks up its duration and dots, so the next note you type uses them. On the end-of-measure position, the duration and dots change the next note instead. Triplet does nothing on the end-of-measure position, and nothing on a beat with nested tuplets.

**Measures.**
- M and Shift+M add an empty measure in every track. Short tracks are padded with empty measures when needed. Shift+M on the first measure moves its time signature, key signature and clef to the new first measure, so the score still starts with them.
- Shift+Delete deletes the measure in every track. Its voice 2, endings, jumps, sections, segno and coda go with it.
- If the deleted measure sets a time signature, key signature or clef, and the next measure sets none, the next measure takes them. Deleting the only measure empties it, and keeps those settings.
- When the last measure is full or overfull, Right on its last beat adds an empty measure and moves into it. When it is underfull, Right first moves to the end-of-measure position, and Right again ends at the end of the score. Adding a measure this way is one undo step.
- An inserted measure (M or Shift+M) is empty, with no ending, jump, section or repeat. Inserting one inside a run of measures that share an ending therefore splits that ending into two brackets.
- An explicit `final` barline stays on the measure it is on. Measures added after it do not move it, so a final barline can end up in the middle of the score.

**Tracks.**
- A track with notation only shows the cursor as a column on the notation staff. Durations, dots, triplets, rests, insert, delete and measure commands work. Frets, Delete for a note, and ties are refused with a message. Up and Down do nothing.
- A track with TAB only works fully.
- Tracks that show neither staff are skipped by PageUp and PageDown. If no track is visible, commands do nothing and the editor says "No visible track".

**Voices.** In a measure with two voices, the editor edits voice 1 only. Voice 2 stays exactly as it was.

**Grace notes.** The cursor skips them. They stay in front of the beat they lead into, so Insert puts a new rest before them, and Ctrl+Delete removes them with their beat. They can't be typed or edited in 2.0.

**Multi-measure rests.** The editor shows every rest measure on its own. A score with `multiMeasureRests: true` therefore looks different in the editor from how the renderer draws it. The setting stays in the JSON.

**Undo and redo.** Each command is one step, and so is each settings call (see [Score and track settings](#score-and-track-settings)). Ctrl+Z undoes the last step, and Ctrl+Y or Ctrl+Shift+Z redoes it. Undo and redo also put the cursor back where it was. Up to 200 steps are kept by default (`historyLimit`). Loading a score clears the history.

**Read-only mode.** Read-only mode lets people move the cursor and read the score, and refuses every edit with the message "Read-only". Undo and redo are off. Settings calls are refused with the same message, though bad arguments still throw. `loadScore()` still replaces the score.

#### Effects

Effect keys add a playing technique to a note or a beat. Each key steps through a short cycle of values. Pressing it again moves to the next value, and after the last value the effect turns off.

- **Note effects** (H, S, Shift+S, B, Shift+B, X, G and N) apply to the note on the cursor string, in voice 1. Other notes in a chord are not changed.
- **Beat effects** (V, P, Shift+L, D, Shift+D, A and Shift+A) apply to the whole cursor beat.
- Turning an effect off removes its field from the JSON. The editor never writes `false`.
- Each press is one undo step. Effects don't move the cursor or change the current duration.
- Effects can go on any note, including a tied one.

The table shows what each key writes, in the score format described under [Score format](#score-format).

| Key | Writes | Cycle |
|---|---|---|
| H | `"hammerPull": true` | on → off |
| S | `"slide": true`, then `"slide": "legato"` | slide → legato slide → off |
| Shift+S | `"slideIn": "below"`, `"slideIn": "above"`, `"slideOut": "down"`, `"slideOut": "up"` | slide in from below → slide in from above → slide out down → slide out up → off |
| B | `"bend"`: `"full"`, `"1/2"`, `"full release"`, `"prebend full"`, `"release"` | full → half → full and release → pre-bend full → release → off |
| Shift+B | the same bend values | the same cycle backwards |
| V | `"vibrato": true`, then `"vibrato": "wide"` | vibrato → wide vibrato → off |
| P | `"palmMute": true` | on → off |
| X | `"mute": true` | dead note on → off |
| G | `"ghost": true` | on → off |
| N | `"harmonic": "natural"`, then `"harmonic": "pinch"` | natural → pinch → off |
| Shift+L | `"letRing": true` | on → off |
| D | `"dynamic"`: `"mf"`, `"f"`, `"ff"`, `"fff"` | mf → f → ff → fff → off |
| Shift+D | `"dynamic"`: `"mp"`, `"p"`, `"pp"`, `"ppp"` | mp → p → pp → ppp → off |
| A | `"articulations"` gets `"accent"`, then `"marcato"` | accent → marcato → off |
| Shift+A | `"articulations"` gets `"staccato"`, then `"staccatissimo"` | staccato → staccatissimo → off |

**Where effects can't be entered.** Each refused key changes nothing and adds no undo step.

- A note effect on a rest, or on an empty string: "No note on this string". X is the exception.
- A note or beat effect on the end-of-measure position: "No beat here". X is the exception.
- V, Shift+L, A and Shift+A on a rest: "Needs a note". P, D and Shift+D work on rests.
- On a track with notation only: H, S, Shift+S, B, Shift+B, X, G and N say "Needs a TAB staff". V, P, Shift+L, D, Shift+D, A and Shift+A work.
- In read-only mode, every effect key says "Read-only".

**Exclusions.** Turning on H removes `slide`. Turning on S removes `hammerPull`. Turning on X removes `harmonic`. Turning on N removes `mute`. Shift+S doesn't touch `slide`.

**Dead notes.** X on a note turns its dead note on or off. X on an empty string, on a rest or at the end of a measure adds a dead note at fret 0, as typing 0 would. At the end of a measure, the new note takes the current duration.

**Typing a fret on a dead note.** A digit clears the dead note, even when the fret stays the same. The note's other effects stay.

**Values the editor doesn't list.** A value the cycle doesn't include, such as `"slide": "up"` or a dynamic of `"sfz"`, counts as "nothing yet". The next press writes the first step, and undo puts the old value back. From nothing, B writes `full`, Shift+B writes `release`, D writes `mf`, and Shift+D writes `mp`. Dynamics such as `sfz`, `rfz` and `n` are replaced in the same way.

**Spoken text.** Each press speaks the new state, such as "Slide" or "Bend half". Three cases add more text. The value is still written.

- Turning on H, or S, when no later note on that string follows in the track: ", no next note on this string". The track is searched across measures.
- Turning on A or Shift+A on a TAB-only track without `tabArticulations`: ", not shown on TAB only".
- Turning on D or Shift+D on a track with no notation staff: ", not shown on TAB only".

Moving the cursor speaks the effects at the new position, after the duration. Up and Down speak only the note effects. The status bar's Effects item lists the same words.

**What the score draws.** The editor writes the JSON, and the renderer draws it as it does for any score. These cases don't show the effect the way you might expect:

- H or S with no later note on the string draws nothing.
- A slide out is not drawn on a note with a bend, or on an S slide that links to a later note on the string.
- A slide in is not drawn on a note that an earlier hammer-on, pull-off or slide leads to.
- A dead note is drawn as an x (as `(x)` when it is also a ghost note). It is never drawn as a harmonic, even if it has one in the JSON.
- Dynamics and hairpins are never drawn on a TAB-only track.
- Articulations on a TAB-only track are drawn above the TAB staff only when the track has `"tabArticulations": true`. The editor doesn't set this, so set it in the JSON.

### Score and track settings

From 2.2.0 the editor can change the score itself: its header and options, its tracks, tuning and capo, time and key signatures, clef changes, barlines, repeats, endings, navigation marks, sections and tempo. Each one is a method, so your page can build its own controls. The library ships no forms. The demo page has three dialogs for these settings (see [Demo dialogs](#demo-dialogs)).

Each call that changes the score is one undo step, and it speaks a short result, such as "Time signature 3/4 from measure 5". The calls work when the cursor's track is hidden. Indexes count from 0.

#### What a call returns

| Result | Returns | What happens |
|---|---|---|
| The score changed | `true` | One undo step. A `cursor` event if the cursor moved, then one `change` event. The result is spoken. |
| Nothing would change | `false` | Speaks "No change". No undo step and no event. |
| Refused | `false` | Nothing changes. The reason is spoken (see [Refusals](#refusals)). No undo step and no event. |
| Bad arguments | throws | A `TypeError` for a wrong type or an unknown field, or a `RangeError` for a value out of range or a rule the value breaks. Nothing changes, and a two-digit fret being typed stays as it is. |

Bad arguments throw even in read-only mode.

#### Refusals

| Reason | Spoken text |
|---|---|
| Read-only mode | Read-only |
| Removing the only track | A score needs at least one track |
| Adding a 33rd track | A score has at most 32 tracks |
| Removing or hiding the last visible track | At least one track must be visible |
| `setTempo` on the end-of-measure position, or in an empty measure | No beat here |
| The result would take `getScore()` past the 5 MB limit | The score would be too large |

Undo and redo restore the score and the cursor, including the track index after a track has been added, removed or moved. The undo labels are "score settings", "track settings", "add track", "remove track", "move track", "measure settings" and "tempo".

A `change` event from a settings call has `command` set to the method name and `message` set to the spoken text. `lastMessage` returns the last text the editor spoke, from a settings call, a refusal or a key command.

#### Score header

`updateScore(patch)` takes any of these fields. An unknown field throws a `TypeError`.

| Field | Kind | Limit |
|---|---|---|
| `title`, `subtitle`, `artist`, `album`, `composer`, `words`, `music`, `tempoText`, `tuningLabel` | Text, one line | 200 characters |
| `instructions`, `copyright` | Text, line breaks allowed | 2,000 characters |
| `showTuningChart`, `multiMeasureRests` | Flag | none |

- Text is trimmed. `null`, or text that is only spaces, removes the field. A value that isn't a string throws a `TypeError`. A line break in a one-line field, or a value past its limit, throws a `RangeError`. The limit counts characters after trimming.
- A flag: `true` writes `true`. `false` or `null` removes the field.
- Turning on `multiMeasureRests` is announced with ", shown when rendered, not in the editor". The editor draws each rest measure on its own.
- Changing the title updates the editor's accessible name at once.

#### Tracks

`updateTrack(ti, patch)` changes a track's fields:

| Field | Value |
|---|---|
| `name`, `label` | Text, one line, 200 characters. `label` is the short name shown before each system after the first. `null` removes the field. |
| `clef` | A clef name: `treble`, `bass`, `alto`, `tenor`, or an octave form such as `treble8vb` or `bass15ma`. Any letter case, stored in lower case. It sets the opening clef, and it removes any clef on measure 1. `null` removes it. |
| `showStandardNotation`, `showTablature` | `true` or `false`. Both off hides the track. |
| `tabRhythm` | `'auto'` or `null` removes it. `true` and `false` are written. |
| `tabArticulations` | `true` writes it. `false` or `null` removes it. |
| `tiedFrets` | `'parens'` writes it. `false` or `null` removes it. |
| `capo` | 1 to 30 writes it. `0` or `null` removes it. Display only (see [Tuning and capo](#tuning-and-capo)). |
| `tuning` | 1 to 12 pitches, low to high. See [Tuning and capo](#tuning-and-capo). |

A change that would leave no visible track is refused.

`addTrack(presetOrSpec?, at?)` adds a track:

- With no argument it adds a 6-string guitar. The argument is an instrument id from `ScoreEditor.INSTRUMENTS` (see [Tuning and capo](#tuning-and-capo)), or an object with any of `preset`, `name`, `label`, `clef`, `tuning`, `showStandardNotation`, `showTablature` and `capo`. Each field in the object replaces the preset's value.
- `at` is the position, from 0 to the number of tracks. It defaults to the end.
- The new track has one empty measure for each column. It takes the score's column settings from the other tracks: time and key signature changes, barlines, endings, jumps, sections, repeat counts, segno and coda. Clefs are not copied, so the track starts with its preset clef.
- A name that is already used (in any letter case) gets the next free number, such as "Guitar 2".
- The cursor moves to the new track, to the first beat of the same measure, on the same string.

`removeTrack(ti)` removes a track and every note on it: voice 1, voice 2 and grace notes. Before the removal, the column settings that only this track sets (barlines, endings, jumps, sections, repeat counts, segno, coda, time and key signature changes) are copied to the remaining tracks, so the score keeps them. The cursor moves to the nearest visible track.

`moveTrack(from, to)` moves a track to a new position. The cursor stays on the same track.

#### Tuning and capo

`ScoreEditor.INSTRUMENTS` lists the instruments that `addTrack` accepts. Each entry has a track name, a picker label, a clef, a standard tuning and the staves (both on). The label is for pickers only and is never written to the track:

| Id | Track name | Picker label | Clef |
|---|---|---|---|
| `guitar6` | Guitar | 6-string guitar | treble |
| `guitar7` | 7-string guitar | 7-string guitar | treble |
| `guitar8` | 8-string guitar | 8-string guitar | treble |
| `bass4` | Bass | 4-string bass | bass |
| `bass5` | 5-string bass | 5-string bass | bass |
| `bass6` | 6-string bass | 6-string bass | bass |
| `ukulele` | Ukulele | Ukulele | treble |

The standard tuning of each is the first entry of its `TUNINGS` list below:

`ScoreEditor.TUNINGS[id]` lists the presets for an instrument, as `{ name, tuning }`, with Standard first:

- 6-string guitar: Standard, Drop D, Half-step down, Whole-step down, Drop C, DADGAD, Open G, Open D, Open E.
- 7-string guitar: Standard, Drop A. 8-string guitar: Standard.
- 4-string bass: Standard, Drop D. 5-string and 6-string bass: Standard.
- Ukulele: Standard.

A pitch is a note letter, an optional `#` or `b`, and an octave from 0 to 9, such as `E2` or `F#3`. Lower-case letters are accepted and written in capitals (`eb2` becomes `Eb2`). A tuning has 1 to 12 pitches.

Changing the tuning keeps every note's string and fret, so the pitch of each fret changes. Changing the number of strings adds or removes them at the low end, because string 1 is always the highest string.

- A note given by string and fret loses its `pitch` when its string's open pitch changes, so it sounds from the new tuning. A note given only by `pitch` is not changed.
- When strings are removed, the notes on them are deleted from voice 1, voice 2 and grace notes. This is the exception to "voice 2 is left alone". A note with a valid `pitch` keeps that pitch and loses only its string and fret.
- A beat left with no notes becomes a rest of the same length. A grace note left with no notes is removed. Ties on the removed strings are cleared.
- The whole change is one undo step. Its message gives a count of notes removed, such as "Track 2 Bass updated, 3 notes removed". The count includes notes that kept their pitch, so it can be higher than the number of notes actually deleted.

The editor never writes `pitch`. Changing the tuning or the capo never transposes the music. The capo is shown in the header only, and frets do not move for it.

#### Measure settings

`updateMeasure(mi, patch, { track }?)` changes one measure column. `track` is used only for `clef`, and defaults to the cursor's track.

| Field | Value | Applies to |
|---|---|---|
| `timeSignature` | `{ beats, beatType }`: beats 1 to 32, beatType 1, 2, 4, 8, 16 or 32. Or `null`. | Every track in the column |
| `keySignature` | A whole number from −7 (seven flats) to 7 (seven sharps). Or `null`. | Every track in the column |
| `clef` | A clef name, as in `updateTrack`. Or `null`. | That track only |
| `barline` | `'single'`, `'double'`, `'final'`, `'repeatStart'`, `'repeatEnd'`, or `null`. | Every track in the column |
| `repeatCount` | A whole number from 2 to 99, or `null`. | Every track in the column |
| `ending` | `null`; a number from 1 to 99; an array of 1 to 32 different numbers; or `{ numbers, text?, open? }`. | Every track in the column |
| `segno`, `coda` | `true`. `false` or `null` removes it. | Every track in the column |
| `jump` | One of `D.C.`, `D.C. al Fine`, `D.C. al Coda`, `D.S.`, `D.S. al Fine`, `D.S. al Coda`, `To Coda`, `Fine`, or `null`. | Every track in the column |
| `section` | A string (the text), or `{ letter, text? }` with a letter of 1 to 3 characters. Or `null`. | Every track in the column |

Ending and section text are trimmed and limited to 200 characters. A section letter is 1 to 3 characters. The numbers in an ending are stored sorted, and a repeated number throws a `RangeError`.

Rules that apply to measure settings:

- A time or key signature equal to the one already in force on a track removes the change on that track instead of writing a duplicate. Setting `3/4` where `3/4` already continues removes the change.
- At measure 1, `timeSignature` and `keySignature` can't be `null`, and `clef` throws a `RangeError`. Set the opening clef with `updateTrack`. A time or key signature at measure 1 sets the opening value on every track, where it differs from the track's or the score's opening value.
- A `repeatCount` needs a `repeatEnd` barline in the same column, either in the same patch or already set. Otherwise it throws a `RangeError`. Setting any other barline removes the repeat count in the same step.
- A measure has one barline, so it can't have both a repeat start and a repeat end. The file format doesn't allow it yet.
- A time or key signature change doesn't move notes. Measures can end up overfull or underfull.
- A column write on a track that has fewer measures adds empty measures up to that column. Removing a setting never adds measures.
- A patch with one field is announced by that field, such as "Repeat end barline at measure 5" or "Ending 1., 2. at measure 5". A patch with several fields is announced as "Measure 5 settings updated".

Jump texts are limited to the eight standard texts. A custom jump already in the file is kept and reported as custom (see [Reading the settings](#reading-the-settings)).

#### Tempo mark

`setTempo(tempo)` sets a tempo mark on the beat under the cursor, in voice 1, on a note or a rest. `null` removes the mark.

- A number is a tempo in beats per minute for a quarter-note beat. An object `{ bpm, unit?, dots?, text? }` gives a different beat: `unit` is `whole`, `half`, `quarter` (the default), `8th`, `16th` or `32nd`; `dots` is 0, 1 or 2; `text` is a label of up to 200 characters, such as "Allegro".
- `bpm` must be above 0, at most 1,000, with at most 2 decimals. Otherwise it throws a `RangeError`.
- On the end-of-measure position, or in an empty measure, the call is refused with "No beat here".
- The spoken result gives the tempo and its beat, such as "Tempo 120 at measure 3, beat 2". Grace notes are not counted in the beat number. The text is not spoken, but the demo's status bar shows it.
- The tempo in force at a beat is the nearest mark at or before it on the same track (see [Reading the settings](#reading-the-settings)).

#### Reading the settings

`getMeasureSettings(mi, ti?)` returns what is set and in force at a measure. It changes nothing, and `ti` defaults to the cursor's track.

```
{
  measure, track,
  timeSignature: { beats, beatType, here, inherited: { beats, beatType } },
  keySignature:  { value, here, inherited },
  clef:          { value, here, inherited },
  barline, repeatCount, ending, segno, coda, jump, jumpCustom, section
}
```

- `here` is `true` when this track sets the field at this measure.
- `inherited` is the value in force just before this measure. At measure 1 it is the opening value of the track, or of the score when the track has none.
- `barline`, `repeatCount`, `ending`, `segno`, `coda`, `jump` and `section` are the column's values, as the renderer reads them. The lowest track that sets a field wins. A missing field is `null`, and `segno` and `coda` are `false`.
- `ending` is `{ numbers, text, open }`, where `text` and `open` may be `null`. `section` is `{ letter, text }`, where either may be `null`. `jumpCustom` is `true` for a jump text that isn't one of the eight standard texts.

#### Demo dialogs

The demo page (`editor.html`) has three dialogs. Each one uses the calls above, and each Apply makes one call per scope. Cancel, or Esc, closes a dialog without changes to its fields. A refused or invalid change keeps the dialog open and shows the reason. In the Tracks dialog, the list buttons (Move up, Move down, Add track and Remove…) apply at once, one undo step each, so Cancel doesn't undo them.

- **Score…** edits the header (title, subtitle, artist, album, composer, words, music, tempo text and tuning label), the instructions and copyright, and the two flags: show tuning chart and multi-measure rests. The Score… dialog checks only the fields you changed, so an over-long field in an older file doesn't block other edits.
- **Tracks…** lists the tracks. Move up and Move down reorder them, Remove… asks first and then deletes the track, and Add a track adds one of the instruments. For the selected track, the edit panel changes the name, short name, opening clef, notation and TAB staves, the TAB options, the tuning and the capo. Apply saves the panel's changes. Changing the tuning to fewer strings asks first when notes would be deleted (notes that also have a written pitch stay in notation).
- **Measure…** edits the cursor's measure. The first group applies to every track: time signature, key signature, barline and repeat count, ending, segno, coda, jump and section. The second group applies to the cursor's track only: the clef and the tempo mark on the cursor beat.

The status bar shows the time signature, the key (for example "2 sharps" or "none") and the tempo at the cursor ("120 bpm", "dotted quarter = 80", or "Allegro, 120 bpm"). The New dialog offers the seven instruments, and time signatures from 1 to 32 beats over 1, 2, 4, 8, 16 or 32.

### Saving and loading

The editor's JSON is the score format described in [Score format](#score-format), with one addition: `"schemaVersion": 1`. `getScore()` always writes it. `loadScore()` and the constructor accept scores with or without it. Any other `schemaVersion` is refused.

| Problem | Result |
|---|---|
| Text that isn't valid JSON | `SyntaxError` from `JSON.parse` |
| JSON that isn't an object, such as an array | `Error('Score must be a JSON object')` |
| `schemaVersion` other than 1 | `Error('Unsupported schemaVersion')` |
| A score past a limit (see below) | `Error('Score too large: …')` |

A failed `loadScore()` changes nothing: the score, the cursor, the undo history and the display stay as they were. A failed constructor leaves the container unchanged.

On load, the editor repairs the score the same way the renderer does (see [Malformed input](#malformed-input)). So the JSON from `getScore()` can differ from the file you loaded.

Input limits are checked before the score is repaired or drawn. They keep a hostile or broken file from freezing the page.

| Limit | `ScoreEditor.LIMITS` key | Value |
|---|---|---|
| JSON text | `jsonChars` | 5 MB (5,242,880 characters) |
| Tracks | `tracks` | 32 |
| Measures per track | `measuresPerTrack` | 2,000 |
| Voices per measure | `voicesPerMeasure` | 4 |
| Beats per voice in a measure | `beatsPerVoice` | 256 |
| Notes per beat | `notesPerBeat` | 16 |
| Tuning strings | `tuningStrings` | 12 |
| Score and track text, one line (settings) | `textChars` | 200 characters |
| Instructions and copyright (settings) | `longTextChars` | 2,000 characters |
| Beats in a time signature (settings) | `timeSignatureBeats` | 32 |
| Beat types (settings) | `beatTypes` | 1, 2, 4, 8, 16 and 32 |
| Capo fret (settings) | `capo` | 1 to 30 |
| Tempo mark, bpm (settings) | `bpm` | above 0, up to 1,000 |
| Ending number (settings) | `endingNumber` | 1 to 99 |
| Numbers in one ending (settings) | `endingNumbers` | 32 |
| Repeat count (settings) | `repeatCount` | 2 to 99 |
| Section letter (settings) | `sectionLetter` | 1 to 3 characters |

The 2.2.0 keys, marked "(settings)", are checked only by the settings calls. `loadScore()` and the constructor don't enforce them, so a file with longer text still loads. A settings call that would take `getScore()` past `jsonChars` is refused with "The score would be too large".

The editor stores nothing. To keep a score, save the result of `getScore()` yourself. See [Host responsibilities](#host-responsibilities).

### Styling

The editor adds these classes. The renderer never uses them.

| Class | Element |
|---|---|
| `music-score-editor` | The root. It is the focusable element. |
| `music-score-editor--focused` | Added to the root while the editor has focus. |
| `music-score-editor--readonly` | Added to the root in read-only mode. |
| `music-score-editor-host` | The wrapper around the drawn SVG. |
| `music-score-editor-live` | The hidden live region for announcements. |
| `editor-overlay` | Group added as the SVG's last child. Its `pointer-events` is `none`. |
| `editor-fill` | Group with the fill bands. |
| `editor-band-over`, `editor-band-under` | The band of an overfull measure, or the line of an underfull one. |
| `editor-cursor` | Group with the cursor. |
| `editor-col`, with `editor-col-notation` or `editor-col-tab` | The cursor column on a staff. |
| `editor-string` | The box around the cursor string on a TAB staff. |
| `editor-slot` | The dashed end-of-measure position, or an empty measure. |

The overlay is rebuilt on each redraw, so style it with class selectors. Colours and opacities are set as SVG attributes. The options above are the simplest way to change the colours.

The editor never removes the browser's focus outline, and it draws no focus ring of its own. Add this CSS to keep a visible focus ring:

```css
.music-score-editor:focus { outline: 2px solid #3b5bdb; outline-offset: 2px; }
```

When the editor loses focus, the cursor is drawn dimmer.

### Accessibility

- The root has `role="application"`, `aria-roledescription="tablature editor"`, and an `aria-label` made from the title (or "Untitled score"). In read-only mode the label ends in ", read-only" and the root has `aria-readonly="true"`. The label follows the title as it changes, including after undo and redo.
- A polite live region speaks each move and each result. A move is spoken like this: "Track 1 Guitar, measure 3, beat 2, string 1, fret 5, quarter". Messages are spoken 150 ms after the last one in a burst. A key message replaces the one before it in that time, so when keys come quickly, only the last is spoken.
- Settings messages are kept instead. A settings result (or a settings refusal) stays, and a second settings message within the same 150 ms is joined to it with ". ", so both are spoken. A key message after a settings message is spoken after it.
- Everything works from the keyboard. Tab leaves the editor, and the editor never traps focus.
- Escape is taken only while a two-digit fret is in progress.

### Host responsibilities

- **Resizing.** The editor does not watch its container. Call `setWidth(px)` when the width changes. The demo uses a `ResizeObserver` for this.
- **Saving.** Listen for `change`, and save `getScore()`. To reopen a saved score, pass it to `loadScore()` or to the constructor.
- **Errors.** Catch the errors from `loadScore()` and the constructor, and show them. A failed load leaves the editor as it was.
- **Clean up.** Call `destroy()` when the editor is removed. It removes its own elements from the container.
- **Fonts.** The editor redraws once the page's fonts are ready. If your page loads a font later, call `refresh()`.
- **Focus ring.** Keep a visible focus ring, as shown under [Styling](#styling).
- **Touch.** The editor needs a hardware keyboard. Tapping can place the cursor, but there is no on-screen keypad. The demo's hint says so on touch devices.

### Limitations in 2.2

- **Tempo marks are read per track in the editor.** The drawing shows a tempo mark from any track (the first track wins at a beat), but the status bar, `getCursorInfo().tempo` and the Measure… dialog only see marks on the cursor's track, and removing a track deletes its tempo marks. Put tempo marks on the first track.
- **Only the effects in [Effects](#effects) can be entered.** These can't be entered from the keyboard yet: tremolo picking, tap, slap and pop, trill, artificial and tapped harmonics, fermata, tenuto, hairpins, whammy bar, fade and wah, ornaments and fingering. Explicit `h` and `p` hammer values and up and down slide values can't be written either, and neither can custom bend amounts. Existing values in the JSON are kept as they are.
- **No effects on a range.** Effects go on one note or one beat at a time.
- **No mouse pitch entry or dragging.** Clicks only place the cursor.
- **No selection, copy or paste.** Each edit works on one beat, one string or one measure.
- **No voice 2 or grace note editing.** These stay as they are in the file, and no effect can be set on them.
- **No tuplets other than the triplet toggle.**
- **No playback and no import.** Guitar Pro and other formats are not read.
- **Measures are not reflowed.** Underfull and overfull measures are shown, not fixed.
- **Speed.** Each edit redraws the whole score. A score with 100 measures on two tracks took about 30 ms per keystroke in Node, and about 90 ms in headless Chrome. Very long scores may feel slow.
- **Touch input.** Editing needs a hardware keyboard.
- **Settings have no keys and no forms in the library.** The settings are methods. The demo's dialogs are the only forms, and the library has no settings UI of its own.
- **Transposing is not done.** Changing the tuning or the capo never transposes the music, and frets don't adjust for the capo. Changing the tuning changes the pitches of the notes that keep their frets.
- **Time and key signatures apply to every track.** A signature change is written for the whole column. A track can't have its own time or key signature changes inside a measure, and the score-level and track-level time and key signatures can't be edited directly. Measures are not reflowed when a time signature changes.
- **Clefs change only at the start of a measure.** The opening clef is set with `updateTrack`. Mid-measure clefs are not supported.
- **One barline per measure.** A measure can't have both a repeat start and a repeat end.
- **Only standard jump texts can be set.** A custom jump already in the file is kept and reported as custom. Measure-repeat signs are not set.
- **No writtenOctaveUp or instrument field.** The editor doesn't set them.
- **Planned for later releases, not in 2.2.** Range selection, copy and paste, transposing a selection, playback, mouse pitch entry on notation, voice 2 and grace-note entry, editing chord symbols and lyrics in the editor, and file import.

## Score format

A score is nested: score, then tracks, then measures, then beats, then notes. Field names are case-sensitive. There is no schema validation: unknown fields are ignored. Since 1.12.1, malformed values never make `render()` throw: they are repaired or dropped (see [Malformed input](#malformed-input)). Other wrong values may render oddly.

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
| `multiMeasureRests` | `true` | Optional, off by default. `true` collapses each run of two or more rest measures (rests in every track) into one multi-measure rest with a bar count. See [Multi-measure rests](#multi-measure-rests). |

### Track

| Field | Type | Notes |
|---|---|---|
| `measures` | array | Required. |
| `clef` | `'treble'`, `'bass'`, `'alto'`, `'tenor'`, `'treble8vb'`, `'treble8va'`, `'treble15mb'`, `'treble15ma'`, `'bass8vb'`, `'bass8va'`, `'bass15mb'` or `'bass15ma'` | Default `'treble'`. Trimmed and any case, so `' Alto '` works. An unknown name is drawn as treble. An octave name changes only the clef sign: notes stay where the base clef puts them. With `writtenOctaveUp` or a note given by string and fret, a plain treble, bass, alto or tenor clef is drawn as its 8vb form (see [Pitch and octaves](#pitch-and-octaves) and [Clefs and clef changes](#clefs-and-clef-changes)). |
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
| `tabArticulations` | `true` | Optional, off by default. On a tab-only track (`showStandardNotation: false`, `showTablature: true`), draws articulations and fermatas above the TAB staff. Other values, such as `'true'`, draw nothing. A track that also shows notation keeps its marks on the notation staff. See [Articulations and fermatas on tab-only tracks](#articulations-and-fermatas-on-tab-only-tracks). |

The examples also set `instrument`. The renderer does not draw it.

Measure columns line up across tracks. The number of measures is the longest track's. A shorter track is padded with empty measures, so every track ends at the same place.

### Measure

| Field | Type | Notes |
|---|---|---|
| `beats` | array | Required unless `voices` is given. An empty array (`[]`) draws a whole-measure rest. |
| `voices` | array of `{ beats }` | Optional. Two rhythms on one staff: the first entry is voice 1 (stems up), the second is voice 2 (stems down). When it is set, `beats` is ignored. See [Voices](#voices). |
| `timeSignature` | `{ beats, beatType }` | Optional. Applies from this measure until it changes. |
| `keySignature` | integer | Optional. Applies from this measure until it changes. |
| `clef` | Same names as the track's [`clef`](#track) | Optional. Changes this track's notation clef from this measure until its next change. An unknown name is ignored. On the first measure it replaces the track's clef. See [Clefs and clef changes](#clefs-and-clef-changes). |
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
- **Placement.** Everything is drawn above the top staff of each system only, whether it is a notation or a TAB staff. All brackets of a system share one height, and all marks of a system share one baseline. From the staff outward the order is: the music, pick strokes and TAB labels and bends, fade and wah marks, 8va and 15ma brackets, chord diagrams and chord symbols, fermatas, beat text (see [Beat text](#beat-text)), volta brackets, segno, coda, jump texts and repeat counts, section markers, then the tempo, including metronome marks from `tempo` (see [Expression lines, ottava and tempo](#expression-lines-ottava-and-tempo)). The score gets taller to make room, but the horizontal spacing does not change.
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
| `duration` | `'whole'`, `'half'`, `'quarter'`, `'8th'`, `'16th'`, `'32nd'`, `'64th'` | Required, except for grace notes. An unknown name draws as a quarter (before 1.12.1 it threw an error). |
| `dots` | integer, 0 to 4 | Augmentation dots. Default 0. Values above 4 are capped at 4, fractions are rounded down, and numeric strings count as their number (`'1'` is one dot). Anything else that isn't a number counts as 0. |
| `tuplet` | number or `{ count, of }` | `3` means a triplet (3 notes in the time of 2). `of` defaults to 2. Consecutive beats with the same ratio form one bracket once they add up to a complete tuplet. |
| `tuplets` | array of 1 or 2 entries, outer ratio first | Nested tuplets, such as a triplet inside a triplet. An entry is a whole number `n` (n notes in the time of 2) or `{ count, of }`, with `count` from 2 to 64 and `of` from 1 to 64 (`of` defaults to 2). A valid `tuplets` overrides `tuplet` on the same beat. If the array has more than two entries, or any entry is invalid, the whole field is ignored and `tuplet` applies. See [Nested tuplets](#nested-tuplets). |
| `hidden` | boolean | Rests only (`{ type: 'rest', hidden: true }`). The rest takes its time but draws nothing and takes no room. Works in any measure. See [Voices](#voices). |
| `slash` | `true` | Rhythm slash on a voice 1 note beat: one slash head on the middle line of the notation staff, and a slash on the TAB staff, instead of the notes. The beat's `notes` are not drawn and may be left out. Other values, and rests, grace notes and voice 2 beats, are drawn as usual. See [Rhythm slashes](#rhythm-slashes). |
| `notes` | array of notes | Required for `note` and `grace`. Several entries make a chord. Rests have no notes. |
| `onBeat` | `true` | Grace beats only. Draws the grace note without its slash, in the same place as an ordinary grace note. It still takes no time. Other values draw the usual slashed grace note. See [Grace notes on the beat](#grace-notes-on-the-beat). |
| `dynamic` | string | `'p'`, `'pp'`, `'ppp'`, `'mp'`, `'mf'`, `'f'`, `'ff'`, `'fff'`, `'sfz'`, `'rfz'`, `'n'`. Other values print as plain text. Drawn below the notation staff. A dynamic on a voice 2 beat is drawn too, at voice 2's position; if voice 1 has a dynamic at the same time, voice 2's is not drawn. See [Voices](#voices). |
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
| `lyric` | string, or array of strings and `{ text, hyphen, extend }` objects | Syllables under a voice 1 note beat. A string is verse 1. In an array, entry 1 is verse 1, entry 2 is verse 2, up to 8 verses. A trailing `-` makes a hyphen and a trailing `_` an extender line (the marker is removed). Rests, grace notes and voice 2 ignore it. See [Lyrics](#lyrics). |
| `hairpin` | `'cresc'` or `'dim'` | Crescendo or diminuendo hairpin on the dynamics line below the notation staff. Consecutive beats with the same value form one hairpin. Aliases: `'<'` and `'crescendo'` for `'cresc'`; `'>'`, `'diminuendo'`, `'decresc'` and `'decrescendo'` for `'dim'`. Any case. Other values draw nothing. See [Expression lines, ottava and tempo](#expression-lines-ottava-and-tempo). |
| `fade` | `'in'`, `'out'` or `'swell'` | Fade-in, fade-out or volume-swell sign above the top staff. Any case. Other values draw nothing. See [Expression lines, ottava and tempo](#expression-lines-ottava-and-tempo). |
| `wah` | `'open'` (or `'o'`) or `'closed'` (or `'close'`, `'+'`) | Wah-pedal sign above the top staff, above a fade on the same beat. Any case. Other values draw nothing. See [Expression lines, ottava and tempo](#expression-lines-ottava-and-tempo). |
| `ottava` | `'8va'`, `'8vb'`, `'15ma'` or `'15mb'` | Octave bracket over consecutive beats that each set it. Notes inside the bracket are drawn an octave or two further away on the notation staff (see [Expression lines, ottava and tempo](#expression-lines-ottava-and-tempo)). Any case. Other values, such as `'22ma'`, draw nothing. |
| `tempo` | number, or `{ bpm, unit, dots, text }` | Tempo change with a metronome note and `= N` above the top staff. `bpm` must be above 0 and at most 1000. `unit` is `'whole'`, `'half'`, `'quarter'` (default), `'8th'`, `'16th'` or `'32nd'`. `dots` is 0 to 2 (more is capped at 2). `text` is bold text before the note. See [Expression lines, ottava and tempo](#expression-lines-ottava-and-tempo). |

Notes: eighth notes and shorter are beamed automatically within each beat (the beat unit set by the time signature). A `grace` beat is a small ornament with no duration. It is drawn just before the next beat and automatically slurred to it.

### Note

Each entry in a beat's `notes` array.

| Field | Type | Notes |
|---|---|---|
| `pitch` | string | Pitch: a letter A to G, an optional accidental (`#`, `b`, `x`, `##`, `bb`), then the octave. Examples: `'E4'`, `'F#3'`, `'Bb2'`. Middle C is `C4`. Required for notation unless `string` and `fret` are given. See [Pitch and octaves](#pitch-and-octaves). |
| `accidental` | `'sharp'`, `'flat'`, `'natural'`, `'doubleSharp'`, `'doubleFlat'` | Explicit accidental. Always drawn, on a grace note too, and overrides the key signature for this note. |
| `tieStart`, `tieEnd` | boolean | Tie to the next note of the same pitch. Enharmonic spellings count as the same pitch (C#4 ties to Db4). A tie that crosses a line break is split into two parts. |
| `string` | integer | Tab only. String 1 is the highest-pitched (top line). |
| `fret` | integer | Tab only. 0 is an open string; 0 to 99. If `pitch` is missing, it is worked out from `string`, `fret`, and the track's `tuning`. |
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
- Ottava brackets add to the rules above. Inside an `8va`, `8vb`, `15ma` or `15mb` run the drawn position moves a further octave or two on top of them (for example, on a guitar track the written octave-up still applies first), as the bracket means. Keep entering `pitch` the same way as outside the bracket. See [Expression lines, ottava and tempo](#expression-lines-ottava-and-tempo).

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

### Malformed input

Since 1.12.1, `render()` does not throw on a malformed score, such as a half-built score in an editor. Before drawing, bad values are repaired or dropped as below. The input object is never changed, and a valid score draws exactly as before.

| Input | What happens |
|---|---|
| The score is not an object, or `tracks` is not an array | Treated as an empty score or no tracks. |
| A track, beat or note that is not an object (for example `null`) | Dropped. A measure that is not an object becomes an empty measure, so measures stay aligned across tracks. |
| `measures`, `beats` or `notes` that is not an array | Treated as empty. |
| `tuning` that is not a non-empty array of pitches | The default guitar tuning. |
| `timeSignature` without whole-number `beats` and `beatType` from 1 to 64 | Ignored: the previous time signature carries on. |
| `keySignature` that is not a whole number from -7 to 7 | Ignored: the previous key carries on. |
| `duration` that is not one of the listed names | A quarter. Grace notes keep their own default. |
| `tuplet` that is a number, `count` or `of` outside the whole numbers 1 to 64 (for example `0` or `NaN`) | Ignored. |
| `dynamic` that is not a string | Ignored. |
| `pitch` that is not a valid pitch with an octave from -1 to 10 | Ignored; `string` and `fret` are used if present. |
| `fret` that is not a whole number from 0 to 99 | Ignored. |
| `string` that is not a whole number from 1 to the number of strings | Ignored: a note with a `pitch` is drawn in notation only. |
| A note left with no valid `pitch`, and no valid `string` and `fret` | Dropped. |
| A note beat left with no notes (except a voice 1 rhythm slash) | Drawn as a rest of the same duration, keeping its other marks. |
| A grace beat left with no notes | Dropped. |

A track that shows neither notation nor TAB draws nothing, and no longer throws when it has technique labels such as palm mute.

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
- **Chord symbols and dynamics** each sit on one line per system: chord symbols above the staff, dynamics and hairpins below it. Both are kept clear of the notes. Chord diagrams sit in one row per system staff, between the music and the chord-symbol line (see [Chord diagrams](#chord-diagrams)).
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

Optional beat fields for articulation and fermata marks. Articulations and fermatas draw on the notation staff. On a tab-only track with `tabArticulations: true` they are also drawn above the TAB staff (see [Articulations and fermatas on tab-only tracks](#articulations-and-fermatas-on-tab-only-tracks)). Vibrato and tremolo are also drawn on the TAB staff (see [Vibrato and tremolo](#vibrato-and-tremolo)).

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
- Ignored on rests and grace notes. Not drawn on TAB staves, except on a tab-only track with `tabArticulations: true`.

### `fermata`

`fermata` on a `note` or `rest` beat draws a fermata above the beat.

- `true` and `'normal'` draw the usual fermata. `'short'` and `'long'` draw the short and long forms. These values are trimmed and case-insensitive, so `' Long '` works.
- Other values draw nothing: the string `'true'`, the number `1`, and `false`.
- The fermata sits above everything else on that beat: the staff, stem, noteheads, articulation marks, slurs, tuplet brackets, vibrato or tremolo marks, and any chord symbol or chord diagram. In a two-voice measure, a voice 2 fermata is drawn below the staff instead, under the other voice 2 marks of its beat (see [Voices](#voices)).
- Ignored on grace notes. Not drawn on TAB staves, except on a tab-only track with `tabArticulations: true`, where a note or rest beat's fermata is drawn above the TAB staff.

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
- **Voice 1 beat marks.** These are read from voice 1 only, and are not drawn on a voice 2 beat: chord symbols and chord diagrams, left-hand fingering, strum arrows, arpeggios, let ring, P.M., rakes, whammy, harmonic labels (A.H., T.H., P.H., S.H.), pick scrape, barre, beat text, hairpins, fades, wah marks, ottava brackets and tempo changes. Put them on a voice 1 beat.
- **Dynamics on voice 2.** A dynamic on a voice 2 beat is drawn on the dynamics line, at voice 2's position. If voice 1 has a dynamic at the same time, voice 2's is not drawn.
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

## Expression lines, ottava and tempo

Beat fields for the marks along and above the staff: hairpins, fades, wah marks, octave brackets and tempo changes. None of them change the rhythm, and none change the pitch data, the TAB or the chord diagrams. Scores that use none of them draw as before.

- **Hairpins** (`hairpin`): `'cresc'` or `'dim'`, with the aliases listed in the [Beat](#beat) table. Consecutive beats with the same value form one hairpin on the dynamics line below the notation staff.
  - A hairpin starts just after a dynamic on its first beat, and ends just before the next dynamic. A dynamic on a beat inside the run starts a new hairpin on that beat.
  - Grace notes do not end a hairpin. A rest in the run needs the same `hairpin` value, or it ends the hairpin. An empty measure ends it.
  - A hairpin that crosses a system break continues on the next system, with a narrow opening at the break.
  - Notation only. A tab-only track draws no hairpins.
- **Fades** (`fade`): `'in'` (fade in), `'out'` (fade out) or `'swell'` (volume swell). They sit above the track's top staff: the notation, or the TAB when the track shows no notation. Consecutive fades on one system share one height.
- **Wah** (`wah`): `'open'` or `'closed'`. It sits above the top staff, like a fade, and above a fade on the same beat.
- **Ottava brackets** (`ottava`): `'8va'`, `'8vb'`, `'15ma'` or `'15mb'`. Set the field on each beat of the run. Consecutive voice 1 beats with the same value share one bracket. A tied note that continues the run inherits the value and needs no field of its own. A rest in the run needs the field too, or it ends the bracket. An empty measure ends it.
  - `8va` and `15ma` sit above the notation staff. `8vb` and `15mb` sit below it, under the dynamics.
  - **Display only.** Inside the bracket the notes are drawn one octave (`8va`, `8vb`) or two octaves (`15ma`, `15mb`) away from their pitch, as the bracket means. `8va` and `15ma` draw the notes lower, and `8vb` and `15mb` draw them higher. Enter the sounding pitch for every note in the bracket, and the library draws it where it is written. The stems, ledger lines and accidentals follow the drawn position. The `pitch` values, the TAB frets and the chord diagrams do not change.
  - A run that crosses a system break continues on the next system with `(8)` or `(15)` after the bracket's start.
  - Notation only. A tab-only track draws no brackets.
- **Tempo changes** (`tempo`): a number, or an object `{ bpm, unit, dots, text }`.
  - `bpm` is the tempo, above 0 and at most 1000. It is shown with at most two decimals, so `92.5` shows as `= 92.5`.
  - `unit` is the note the tempo counts: `'whole'`, `'half'`, `'quarter'` (the default), `'8th'`, `'16th'` or `'32nd'`. `dots` adds 0 to 2 augmentation dots.
  - `text` is bold text before the metronome note, such as `'Faster'`. Empty text is ignored.
  - A tempo change sits above the top staff of its system, outside the other marks above it. Only voice 1 beats carry it. Where two tracks have a tempo change at the same time, the first track's is drawn.
  - The score's `tempoText` is unchanged. A tempo change on the first beat of the score sits after `tempoText` on the same line, or at the time signature when there is no `tempoText`.
  - A tempo change changes the drawing only. Nothing is played at that tempo.
- **Voice 2 dynamics** are drawn on the dynamics line, at voice 2's position. Voice 1's dynamic wins at the same time (see [Voices](#voices)).
- Hairpins, fades, wah marks, brackets and tempo changes take no horizontal room, so a dense beat can crowd them. A system with a hairpin draws its dynamics line a little lower to clear it. Fermatas move up to clear fades, wah marks and brackets, and chord symbols rise above them.

```json
{ "type": "note", "duration": "quarter", "dynamic": "p", "hairpin": "cresc", "notes": [{ "pitch": "C4" }] }
```

```json
{ "type": "note", "duration": "half", "tempo": { "bpm": 92.5, "unit": "quarter", "dots": 1, "text": "Slower" }, "notes": [{ "pitch": "G4" }] }
```

SVG classes: `hairpin` with `hairpin-cresc` or `hairpin-dim` (one path per segment), plus `hairpin-cont` on a segment after a system break; `fade` with `fade-in`, `fade-out` or `fade-swell`; `wah` with `wah-open` or `wah-closed`; `ottava` with `ottava-8va`, `ottava-8vb`, `ottava-15ma` or `ottava-15mb` (one group per bracket segment), plus `ottava-cont` on a continuation after a system break; and `tempo-change` (one group per tempo change) with `tempo-change-text`, `tempo-change-note`, `tempo-change-dot` and `tempo-change-bpm` inside it.

## Clefs and clef changes

`track.clef` sets the clef of a track's notation staff, and `measure.clef` changes it from that measure on. Both take the same names.

- **Names.** `treble`, `bass`, `alto`, `tenor`, and the octave forms `treble8vb`, `treble8va`, `treble15mb`, `treble15ma`, `bass8vb`, `bass8va`, `bass15mb` and `bass15ma`. Names are trimmed and not case-sensitive. An unknown name on a track is drawn as treble, and on a measure it is ignored.
- **Alto and tenor.** The alto clef puts middle C on the middle line, with the bottom line at F3. The tenor clef puts middle C on the fourth line, with the bottom line at D3. Key signatures are placed for the clef, so the sharps and flats sit where that clef needs them.
- **Octave clefs.** The 8, 8 below, 15 and 15 below forms add the figure to the clef sign. They change the sign only. Notes are placed as the base clef places them, and the sounding pitch still follows `writtenOctaveUp`.
- **Automatic 8vb clef.** A plain treble, bass, alto or tenor clef becomes its 8vb form when `writtenOctaveUp: true`, or when a note is given by string and fret. A named octave clef always wins over this.
- **Clef changes.** A `measure.clef` applies from that measure until the next change on the same track. Naming the clef already in force does nothing. On the first measure it replaces the track's `clef`.
- **Where a change is drawn.** At the start of its measure, after the barline or repeat sign, at about three-quarters size. The key and time signatures of that measure follow it, in that order. When two tracks change clef in the same measure, the opening space is as wide as the wider change.
- **At a line break.** A system's first clef shows the clef in force, at full size, with no change sign. When the next system opens with a change, the previous system ends with a smaller courtesy clef, before any courtesy key and time signature.
- **Notation only.** A change is drawn on notation staves. A tab-only track shows no clef, and TAB frets and pitches are not affected.
- **Tuning chart.** A six-string track's tuning chart compares with the bass tuning when the track's first clef is a bass clef, including the octave forms. See [Capo and tuning chart](#capo-and-tuning-chart).

```json
{ "clef": "alto", "measures": [{ "keySignature": 2, "beats": [] }, { "clef": "tenor", "beats": [] }] }
```

SVG classes: `clef` with `clef-change` for a clef change inside a system, and `clef` with `courtesy-clef` for the smaller clef at the end of a system. A clef at the start of a system has no class.

## Multi-measure rests

Set `multiMeasureRests: true` on the score to collapse rest measures into one multi-measure rest. Off by default, so existing scores draw each rest measure as before. The score data is not changed; only the drawing is.

- **Rest measure.** In every track, the measure is empty (`beats: []`) or has one visible rest that lasts at least a whole bar, and nothing else. A grace note, a second voice, an ending, or any mark on the rest (a fermata, text, dynamic, chord symbol, tempo, hairpin, fade, wah or ottava) keeps the measure out.
- **Runs.** Two or more consecutive rest measures become one column, drawn as a thick horizontal bar between two short end strokes, with the number of bars above the staff in time-signature digits. A single rest measure is drawn as before.
- **What starts a run.** A key, time or clef change on a track with notation, a repeat start, a segno, a coda or a section stays at the start of the run, so such a measure begins a new run.
- **What ends a run.** A measure with a double, final or repeat barline ends the run, and so does a measure with a jump text or a repeat count. Those marks and barlines stay at the end of the run.
- **Endings.** A measure under a volta ending never joins a run.
- **Systems.** A run stays on one system, so the bar and its count are never split across a line break.
- **Notation and TAB.** The bar is drawn on the notation staff. The TAB staff shows it only when rhythm is shown on TAB (see [Rhythm on TAB staves](#rhythm-on-tab-staves)): tab-only tracks do by default, and a track with notation needs `tabRhythm: true`. Otherwise the TAB staff is blank for the run.
- **Width.** The run takes a fixed width, about 8 staff spaces, and is wider only when the count needs more room. It does not grow with the number of bars.

```json
{ "multiMeasureRests": true, "tracks": [{ "showStandardNotation": true, "showTablature": true, "tabRhythm": true, "measures": [] }] }
```

SVG classes: `multi-rest` (the bar, one group per run) and `multi-rest-count` (the count).

## Rhythm slashes

A rhythm slash shows the rhythm of a beat without its pitches, as in guitar books that give only the strum pattern. Set `slash: true` on a voice 1 note beat.

- **Notation.** One slash head on the middle line: a white slash for whole and half notes, and a filled slash for shorter values. Stems point up, unless the measure has two voices. Flags, beams, dots and tuplets work as usual. A slash has no accidentals, ledger lines, chords, arpeggio, ties or ottava.
- **TAB.** A slash over a small backing, centred on the TAB staff in place of frets. The rhythm band shows the stem, beams and flags when rhythm is shown on TAB. On TAB, a slash beat gets no tremolo or vibrato.
- **Beat marks still draw.** Beat-level marks, such as a chord symbol, a dynamic, an articulation, a fermata or text, are drawn on a slash beat. Note-level marks, such as a bend, a harmonic or a tap, are not, because the notes are gone.
- **Notes.** The `notes` of a slash beat are not drawn. They may be left out or left empty.
- **Only voice 1 note beats.** `slash` on a rest, a grace note or a voice 2 beat is ignored. Only the boolean `true` counts.
- **Note beats still need notes.** A note beat without `slash: true` still needs at least one note, as before.

```json
{ "type": "note", "duration": "8th", "slash": true }
```

SVG classes: `slash` (the slash head on the notation staff) and `tab-slash` (the slash and its backing on the TAB staff).

## Articulations and fermatas on tab-only tracks

On a tab-only track (`showStandardNotation: false`, `showTablature: true`), set `tabArticulations: true` to draw articulations and fermatas above the TAB staff. Off by default. A track that also shows notation keeps its marks on the notation staff, and its TAB staff gets none.

- **Articulations.** The beat's `articulations` (the same values as on notation) are stacked above the TAB staff, nearest first, in the same order as on notation. They sit above the frets, and above TAB vibrato and tremolo. They sit below P.M., harmonic and let-ring labels, and below pick strokes. Rests and grace notes get none.
- **Fermatas.** A `fermata` on a note or rest beat is drawn above the beat's TAB marks, with the same values as on notation. Grace notes get none. Beat text and navigation marks sit above it.
- **Two voices.** In a column with voice 1 and voice 2, voice 1's mark wins for each kind. A mark that only voice 2 has at that column is drawn in voice 1's place.
- **Bends.** Bends do not move to avoid articulations. See [Known limitations](#known-limitations).

```json
{ "type": "note", "duration": "quarter", "articulations": ["staccato", "accent"], "fermata": true, "notes": [{ "string": 3, "fret": 5 }] }
```

SVG classes: `tab-articulations` (one group per beat column) and `tab-fermata` (the group around a fermata drawn above the TAB, with the usual `fermata` and `fermata-short` or `fermata-long` classes inside).

## Lyrics

Syllables under the notes, one line per verse, as in a song sheet. Set `lyric` on a voice 1 note beat.

```json
{ "type": "note", "duration": "quarter", "lyric": ["Hap-", "Hel-"], "notes": [{ "pitch": "E4" }] }
```

- **Verses.** A string is verse 1. An array gives one entry per verse: entry 1 is verse 1, entry 2 is verse 2, and so on. Up to 8 verses are drawn, and later entries are ignored. An empty entry leaves that verse blank under the beat. Each verse sits on its own line, 1.3 times `lyricFontSize` below the one above, and every verse of a track uses the same lines across a system.
- **Markers.** A trailing `-` in a string makes a hyphen: `'Hap-'` is the syllable "Hap" followed by a hyphen. A trailing `_` makes an extender: `'sing_'` is "sing" followed by a line. Only that one marker is removed. Spaces at the ends are trimmed and inner spaces are collapsed. A string that is only a marker is not a syllable.
- **Objects.** An array entry may be `{ text, hyphen, extend }`, with `hyphen: true` or `extend: true`. If both are true, the hyphen wins. A single object as the whole `lyric` is ignored: use a string or an array.
- **Hyphens.** The hyphen is one "-" centred between the syllable and the next syllable of the same verse, wherever that syllable is in the track. Rests in between are skipped. If the next syllable is on a later system, the hyphen runs from the syllable to the end of this system's last barline, and nothing is drawn at the start of the next system. A hyphen with no later syllable in its verse is not drawn.
- **Extenders.** The line starts just after the syllable and runs along the verse's line to the right edge of the last note before the next syllable of that verse. It ends at a rest (hidden rests too), at a multi-measure rest or an empty measure, or at the end of the score. Notes without a syllable do not end it, so one line can cover a melisma. Ties do not extend a syllable by themselves: put `_` on the syllable. A line that crosses a system break stops at the last barline and continues from the start of the next system's music.
- **Placement.** Lyrics sit under the notation staff, or under the TAB staff on a track without notation (below its rhythm band, if shown). On a track with both, the TAB staff moves down to make room. From the staff outward, the order is: the notes and their marks, the technique labels on a notation-only track, the lyrics, then the dynamics line, the 8vb and 15mb brackets, and beat text marked `below`. The top of verse 1 sits 0.8 staff spaces below the lowest mark of the staff. Only systems with lyrics move the dynamics line, the octave brackets and the text below the staff down.
- **Room.** A syllable takes horizontal room for half its width, so a long word can push its neighbours apart, and a hyphen adds room after its syllable. Systems without lyrics are spaced as before. Widths are estimated.
- **Which beats.** Voice 1 note beats, including slash beats (`slash: true`). `lyric` on a rest, a grace note or a voice 2 beat is ignored, and a lyric on a rest does not stop a multi-measure rest from forming.
- **Text.** Lyrics use `textFontFamily` at `lyricFontSize` (13 px by default), in `noteColor`.
- **Not included.** Words are not split into syllables, and there are no elisions, no lyric import and no lyrics on voice 2. Write each syllable on its own beat.

SVG classes: `lyrics` (one group per track in each system, inside the notation or TAB group), `lyric` (one text per syllable), `lyric-hyphen` (one per hyphen) and `lyric-extender` (one line per segment). `lyric`, `lyric-hyphen` and `lyric-extender` carry `data-verse`, the verse number from 1.

## Grace notes on the beat

A grace note is normally drawn with a slash through its stem, just before the next beat. Set `onBeat: true` on a `grace` beat to draw it without the slash.

```json
{ "type": "grace", "onBeat": true, "notes": [{ "pitch": "F#4" }] }
```

- **What changes.** Only the drawing. The grace note has no slash, and its parts are wrapped in a `grace-on-beat` group.
- **What stays.** Its place is the same as an ordinary grace note: just before the next beat, and slurred to it. Accidentals, chords and mixing with ordinary grace notes in one run work as before. TAB is unchanged.
- **Timing.** An on-beat grace takes no time, exactly like an ordinary grace note, and its `duration` is still ignored. The next note keeps its place. The time a grace note takes from the note after it is not shown.
- Only `true` counts. Other values draw the usual slashed grace note.

## Nested tuplets

A tuplet inside another tuplet, such as eighth notes in a triplet of triplets. Set `tuplets` on the beat to an array of one or two ratios, outer ratio first.

```json
{ "type": "note", "duration": "8th", "tuplets": [3, 3], "notes": [{ "string": 3, "fret": 5 }] }
```

Each of these eighths lasts 1/18 of a whole note, so nine of them fill a half note.

- **Entries.** Each entry is a whole number `n`, meaning `n` notes in the time of 2, or `{ count, of }`, meaning `count` notes in the time of `of`. `count` is a whole number from 2 to 64, and `of` a whole number from 1 to 64 (default 2). `[3]` is one triplet, the same as `tuplet: 3`.
- **Duration.** A beat lasts its written value multiplied by every ratio. An eighth in `[3, 3]` lasts 1/8 × 2/3 × 2/3.
- **Fallback.** An array with more than two entries, or with any invalid entry, is ignored as a whole, and the beat uses `tuplet` as before. For example, `[3, 3, 3]` and `[{ count: 1 }]` are both ignored. The 2 to 64 limit applies to `tuplets` only: `tuplet` is read as it was before.
- **Override.** A valid `tuplets` replaces `tuplet` on the same beat.
- **Brackets.** Consecutive beats with the same outer ratio form one outer bracket once they make a complete outer tuplet, as a single tuplet does. Inside it, consecutive beats with the same inner ratio form an inner bracket. Beats with only the outer ratio share the outer bracket.
- **Notation.** The inner bracket is drawn as a normal tuplet bracket. The outer bracket sits 1.2 staff spaces further from the staff: above the stems in voice 1, and below them in voice 2. Both show their count only.
- **TAB.** The inner tuplet is drawn as usual. The outer bracket is always drawn as a bracket, below the rhythm under its span and below the inner bracket.
- **Depth.** Two levels only.
- SVG classes: an outer bracket has `tuplet-outer` on notation and `tab-tuplet-outer` on TAB, in addition to the usual `tuplet` or `tab-tuplet` class. Inner brackets keep the usual classes.

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
- **Rhythm on TAB staves.** Ties are not shown in the rhythm band. Tied-fret parentheses are drawn only with `tiedFrets: 'parens'` (see [Tied fret numbers](#tied-fret-numbers)). Tremolo picking stays above the fret number and is not drawn on the stem. On staves with four strings or fewer, 32nd and 64th rests can reach a little past the outer string lines; the gap to the staff above grows to fit them.
- **Measure count.** Shorter tracks are padded with empty measures (whole-measure rests in notation, blank tab, no rest on a TAB rhythm staff). Their `measures` array is not extended in the input.
- **Malformed input is repaired without warning.** A bad value is fixed or dropped silently (see [Malformed input](#malformed-input)); nothing reports what was changed.
- **Dynamics.** Only the names listed under `dynamic` are drawn as symbols. Other names print as plain text.
- **Dynamics line: no horizontal avoidance.** Dynamics, from either voice, take no horizontal room. Two dynamics at nearby but different times can overlap. Voice 2 grace notes do not draw a dynamic.
- **Expression lines: tab-only tracks.** Hairpins and ottava brackets are not drawn on a track without notation. Fades, wah marks and tempo changes are drawn above the TAB.
- **Ottava: one-beat bracket at a system end.** A bracket that covers only the last beat of a system can put its hook about 1.3 staff spaces past the barline.
- **Ottava: the stored pitch.** Inside a bracket the note is drawn at a different place from its `pitch` (see [Expression lines, ottava and tempo](#expression-lines-ottava-and-tempo)). Notes outside a bracket are drawn as written.
- **Tempo changes.** A tempo change shows its tempo but plays nothing. Long text is not wrapped.
- **No validation.** A malformed score does not throw, but may render oddly. The renderer ignores `schemaVersion`. The editor checks it (see [Saving and loading](#saving-and-loading)).
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
- **Voices: beat marks on voice 2.** Chord symbols and diagrams, left-hand fingering, strums, arpeggios, let ring, P.M., rakes, whammy, harmonic labels, pick scrape, barre, beat text, hairpins, fades, wah marks, ottava brackets and tempo changes are drawn for voice 1 only. Dynamics on voice 2 are drawn (see [Voices](#voices)), except on a voice 2 grace note. Voice 2 still draws its notes, articulations, tremolo, vibrato, ties, slurs and slides, and the marks listed under [Voices](#voices).
- **Voices: shared heads and merged rests need a close match.** A shared unison head and a merged rest only apply when the two notes or rests match exactly enough (see [Voices](#voices)). Any other unison moves voice 2 to the right, and any other pair of rests stays separate.
- **Voices: release arrows on voice 2.** A voice 2 bend release arrow can still cross a fret number on the TAB staff.
- **Voices: whole-measure rests.** A whole-measure rest is centred in the bar and does not move to clear the other voice's notes.
- **Voices: links from a single-voice measure.** A tie, slur, hammer-on, pull-off or slide that starts in a single-voice measure and ends in voice 2 of the next measure is not drawn.
- **Voices: grace notes.** Graces of both voices that lead into notes at the same time can collide.
- **Voices: TAB.** A voice 2 fret on the same string as a voice 1 fret at the same time is left off the TAB staff.
- **Voices: dots.** Where the voices do not clash, a dot can sit close to the other voice's noteheads.
- **Tremolo room.** A stemless (whole) note keeps the room for three strokes even with `'8th'` or `'16th'`, so a mark above it can sit a little higher than it needs to.
- **Articulations and fermatas on tab.** A track that shows notation draws them on the notation staff only. A tab-only track draws them above the TAB staff only with `tabArticulations: true` (see [Articulations and fermatas on tab-only tracks](#articulations-and-fermatas-on-tab-only-tracks)).
- **Articulations and fermatas on tab: bends.** Bends do not move to avoid them, so a bend's amount label can sit beside an articulation on the same beat, such as a tenuto next to a "Full" label.
- **Articulations and fermatas on tab: chord symbols.** Chord symbols on a tab-only track are still drawn only above a chord diagram, with or without `tabArticulations`.
- **Clefs: mid-measure changes.** A clef change takes effect only at the start of a measure.
- **Clefs: other clefs.** Soprano, mezzo-soprano, baritone, percussion and other clefs are not supported. An unknown name is drawn as treble.
- **Clefs: octave clefs.** An octave clef such as `treble8vb` changes the sign only. The notes are placed as the base clef places them.
- **Clefs: TAB.** Clef changes are drawn on notation staves only. A tab-only track shows no clef, and TAB frets are not affected by any clef.
- **Multi-measure rests: every track.** A run needs a rest measure in every track. Multi-measure rests are set for the whole score, not for one track.
- **Rhythm slashes: measure repeats.** Slash measures and repeat-measure signs (a bar of slashes standing for the previous measure) are not drawn. Use slash beats instead.
- **Rhythm slashes: voice 2.** A slash in voice 2 is ignored, and that beat draws its notes.
- **Rhythm slashes: octave clef.** The notes of a slash beat are not drawn, but a `string` and `fret` on one still make the track's clef an 8vb clef.
- **Score text: no wrapping.** Each text is drawn on one line; only `instructions` and `copyright` start a new line at each line break (other fields turn a line break into a space). A long line runs past the margin, so shorten it or split instructions and copyright yourself. Instructions and copyright beyond 8 lines are not drawn, and nothing warns you.
- **Score text: no sideways placement.** Beat text takes no horizontal room and never moves sideways; overlapping beat texts stack upward instead. Section markers move right only to keep a gap from the previous marker on the same system. Widths are estimated, so spacing is approximate.
- **Capo is display only.** The capo line does not transpose the music, change the pitches, or move the fret numbers. Transposition is not supported.
- **Tuning chart compares with usual tunings.** A bass-clef 6-string track that keeps the default guitar tuning lists every string, because that tuning is not its usual one. Any string count other than 4 to 8 lists every string.
- **Header words are English.** "Words by", "Music by", "Capo fret" and "Track N" are fixed text.
- **Lyrics: voice 1 only.** Lyrics on voice 2 are ignored.
- **Lyrics: estimated widths.** Syllable widths are estimated, so the spacing and the ends of hyphens and extenders are approximate.
- **Lyrics: one hyphen.** A hyphen is one centred "-", whatever the gap between the syllables. A hyphen that crosses a system break ends at the barline, and nothing is drawn on the next system.
- **Lyrics: no word splitting, elision or import.** Each syllable is written on its own beat.
- **Lyrics: taller systems.** On a system with lyrics, the dynamics line, the 8vb and 15mb brackets and the text below the staff move down, so the system takes more height.
- **On-beat grace notes: no time.** An `onBeat` grace takes no time, and its `duration` is still ignored (see [Grace notes on the beat](#grace-notes-on-the-beat)).
- **Nested tuplets: two levels.** A third level is not supported. A `tuplets` array with three entries is ignored.
- **Nested tuplets: beams.** Beams are grouped as they were before 1.12.0. The brackets follow the nested structure, but beams are not regrouped to match it.
- **Not included:** playback, and import or export of formats other than the editor's JSON. For what the editor can't edit yet, see [Limitations in 2.2](#limitations-in-22).

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
- Editor checks (2.0.0): `tests/editor-model.mjs` covers the editing commands, keys, undo and the JSON format, and `tests/editor-dom.mjs` covers the `ScoreEditor` API, the hit map and the overlay. `tests/editor-edge.mjs` and `tests/editor-edge-dom.mjs` cover edge cases against the 2.0.0 acceptance criteria.

Settings checks (2.2.0): `tests/editor-settings.mjs` covers the settings model, `tests/editor-settings-dom.mjs` covers the settings API, events, undo and the demo's helpers, and `tests/editor-settings-edge.mjs` and `tests/editor-settings-edge-dom.mjs` cover their edge cases.

A speed check for the editor, `node tests/bench-editor.mjs`, runs outside the test run. It times renders and keystrokes on synthetic scores of 32, 100 and 200 measures.

It prints `ALL PASSED` and exits with code 0 on success.

- Use `node tests/run.js --update` only when a rendering change is intentional. It rewrites the existing snapshots.
- To run one group on its own: `node tests/units.mjs`, `node tests/engraving.mjs`, or `node tests/articulations.mjs`. The editor groups run only through `node tests/run.js`.

## Changelog

### 2.2.0 — 2026-11-22

Score and track settings. The editor can now change the score's header and options, its tracks (names, clef, staves, TAB options, tuning and capo), its time and key signatures, clef changes, barlines, repeats, endings, navigation marks, sections and tempo. Each change is one undo step and is announced. The demo page has three dialogs for them: Score…, Tracks… and Measure…. See [Score and track settings](#score-and-track-settings).

Rendering is unchanged. The renderer and the score format are the same as in 2.1.0, and every existing snapshot is byte-identical. Existing scores need no changes.

New:

- `ScoreEditor` methods: `updateScore`, `updateTrack`, `addTrack`, `removeTrack`, `moveTrack`, `updateMeasure`, `setTempo` and `getMeasureSettings`. Also the `lastMessage` getter, and the static `INSTRUMENTS` and `TUNINGS` presets.
- `getCursorInfo()` adds `timeSignature`, `keySignature` and `tempo`.
- `ScoreEditor.LIMITS` gains the caps for the new settings (listed under [Saving and loading](#saving-and-loading)).
- The demo page: the Score…, Tracks… and Measure… dialogs, a Time, Key and Tempo item in the status bar, and a Settings section in the shortcuts panel.

Behaviour changes from 2.1.0:

- The New dialog accepts 1 to 32 beats (it was 1 to 16) and beat types 1, 2, 4, 8, 16 and 32 (it was 2 to 16). It also offers 8-string guitar, 5-string bass, 6-string bass and ukulele.
- The live region joins settings messages. Two settings results spoken within 150 ms are both read out, joined with ". ". Key messages still replace each other, as before.
- The editor's accessible name follows the title after undo and redo, and after a title change. Before 2.2.0 it changed only on load.
- A settings call that would take the score past the 5 MB limit is refused.

See [Limitations in 2.2](#limitations-in-22) for what the editor still can't enter.

### 2.1.0 — 2026-11-22

Effects from the keyboard. The editor can now add hammer-ons and pull-offs, slides, bends, vibrato, palm mute, dead and ghost notes, harmonics, let ring, dynamics, accents and staccato. Each effect has its own key, and pressing it steps through the values. See [Effects](#effects).

Rendering is unchanged. The renderer and the score format are the same as in 2.0.0, and every existing snapshot is byte-identical. Existing scores need no changes.

New:

- The effect keys, listed under [Keyboard](#keyboard): H, S, Shift+S, B, Shift+B, V, P, X, G, N, Shift+L, D, Shift+D, A and Shift+A.
- An Effects group of buttons on the demo page, `editor.html`, and an Effects item in its status bar.
- Move announcements speak the effects at the cursor, after the duration.
- `getCursorInfo()` adds `effects`, `noteEffects`, `beatEffects` and `effectSteps`.

Behaviour changes from 2.0:

- The letters H, S, B, V, P, X, G, N, D and A, and Shift+S, Shift+B, Shift+L, Shift+D and Shift+A, are now used by the editor. In 2.0 they did nothing. Plain L still ties to the previous note.
- Typing a digit on a dead note clears its dead note (`mute`), even when the fret stays the same. In 2.0 the dead note stayed.
- `handleKey` no longer throws on keys such as `"toString"`. Those keys are not used by the editor, and `handleKey` returns `false`.

See [Limitations in 2.2](#limitations-in-22) for what the editor still can't enter.

### 2.0.0 — 2026-11-22

Edit mode. The new `ScoreEditor` class lets people type and edit guitar and bass tablature from the keyboard, with undo and redo. It reads and writes the score as JSON. See [Editing scores](#editing-scores-scoreeditor).

Rendering is unchanged. `MusicScoreRenderer` draws the same SVG as 1.12.1, and every existing snapshot is byte-identical. Existing scores need no changes.

New:

- `ScoreEditor`, exported from `index.js`: keyboard editing with fret entry (including two-digit frets), chords, rests, notes and beats deleted, ties, durations, dots and triplets, measures, and undo and redo. Scores are read and written as JSON with `"schemaVersion": 1`.
- `ScoreEditor.LIMITS`: the size limits for scores the editor accepts.
- Renderer methods `getSvg()`, `getHitMap()` and `hitTest(x, y)`, for finding the staff, measure and beat under a point. See [Hit map](#hit-map-and-svg-access).
- A demo page, `editor.html`, with the editor, examples, New, Open and Download JSON, autosave in the browser, and a keyboard shortcuts panel.

Behaviour notes:

- The editor draws each multi-measure rest as separate measures, and keeps the setting in the JSON.
- The editor's JSON loads only with `schemaVersion` missing or 1. Other values are refused with `Unsupported schemaVersion`. The renderer still accepts them, because it ignores the key.
- Not in 2.0: effects, mouse pitch entry, selection and clipboard, editing of voice 2 and grace notes, track and score settings, playback and import. Effects were added in 2.1.0. For the current list, see [Limitations in 2.2](#limitations-in-22).

### 1.12.1 — 2026-11-22

Hardening for malformed input, ahead of edit mode. `render()` no longer throws on bad data: bad values are repaired or dropped as listed under [Malformed input](#malformed-input). Valid scores draw exactly as before.

Changes to existing inputs (each used to throw an error or exhaust memory, unless noted):

- An unknown `duration` draws as a quarter.
- A note beat with no notes (`notes: []`, missing or all invalid) draws as a rest.
- `tuplet: 0`, `NaN` or `Infinity`, and a time signature with `beatType: 0`, are ignored.
- A `keySignature` outside the whole numbers -7 to 7 is ignored. Values such as `'D'` or `Infinity` used to put `NaN` coordinates in the SVG.
- An invalid `pitch` or `fret` is ignored, and the note is dropped if nothing usable is left. A huge `fret` (for example `1e9`) or octave used to exhaust memory.
- `null` entries in `tracks`, `beats` or `notes` are skipped.
- A note on a string beyond the tuning, without a `pitch`, is dropped. It used to be kept with no pitch, and threw when the track showed notation. With a `pitch`, the note stays in notation and leaves the TAB, where it used to get `NaN` coordinates.
- A negative `fret` is ignored. It used to draw below the open string.
- A track showing neither notation nor TAB no longer throws when it has palm mute, let ring or other technique labels.

### 1.12.0 — 2026-11-22

Lyrics, grace notes on the beat and nested tuplets. This completes the 1.x roadmap. Scores that use none of the inputs listed below draw as before, and no input that worked before 1.12.0 draws differently.

The three beat fields below were ignored before 1.12.0, so a score that already sets `lyric`, `onBeat` or `tuplets` will now draw them. One side effect: with `multiMeasureRests: true`, a whole-rest measure that carries a `lyric` used to stay out of a multi-measure rest and now joins one, because lyrics on rests are ignored. Check any score that uses them.

New:

- `beat.lyric` on a voice 1 note beat: syllables under the notes, with up to 8 verses, hyphens and extenders. See [Lyrics](#lyrics).
- `onBeat: true` on a grace beat: the grace note is drawn without its slash. It still takes no time. See [Grace notes on the beat](#grace-notes-on-the-beat).
- `beat.tuplets`: nested tuplets, outer ratio first. An invalid `tuplets` is ignored and `tuplet` applies. See [Nested tuplets](#nested-tuplets).
- `theme.lyricFontSize` (default 13 px): the size of the lyric text.
- New SVG classes: `lyrics`, `lyric`, `lyric-hyphen`, `lyric-extender`, `grace-on-beat`, `tuplet-outer` and `tab-tuplet-outer`.

### 1.11.0 — 2026-11-22

Notation structure. Scores that use none of the inputs listed below are unchanged. Four existing inputs now draw differently, so check any score that uses them. Those changes are listed first.

Changes to existing inputs:

- Clef names that were not recognised were drawn as a treble clef. Now `'alto'`, `'tenor'`, the octave clef names (`'treble8vb'`, `'bass15ma'` and so on), and names with other capitals or spaces (`'Bass'`, `' treble8vb '`) draw their own clef. Names that are still not recognised draw as treble, as before. See [Clefs and clef changes](#clefs-and-clef-changes).
- The tuning chart (`showTuningChart`) picks its reference tuning from the clef. A six-string track whose clef is a bass name other than plain `'bass'`, such as `'Bass'` or `'bass8vb'`, is now compared with the bass tuning, as `'bass'` already was. Before, these names were read as treble.
- `beat.slash: true` was ignored before 1.11.0. Now a visible voice 1 note beat with `slash: true` draws as a rhythm slash, and its `notes` are not drawn. A slash beat with `string` and `fret` notes still makes the track's clef an 8vb clef. See [Rhythm slashes](#rhythm-slashes).
- `measure.clef` was ignored before 1.11.0. Now it changes the clef on a track's notation staff from that measure until the next change. The key and time signatures of that measure follow it, and a system that opens with a change gets a smaller courtesy clef at the end of the previous system.

New:

- `track.clef` accepts `'alto'`, `'tenor'`, `'treble8vb'`, `'treble8va'`, `'treble15mb'`, `'treble15ma'`, `'bass8vb'`, `'bass8va'`, `'bass15mb'` and `'bass15ma'`. See [Clefs and clef changes](#clefs-and-clef-changes).
- `score.multiMeasureRests: true`: each run of two or more rest measures becomes one multi-measure rest with a bar count. Off by default. See [Multi-measure rests](#multi-measure-rests).
- `beat.slash: true` on a voice 1 note beat: a rhythm slash on notation and TAB. See [Rhythm slashes](#rhythm-slashes).
- `track.tabArticulations: true` on a tab-only track: articulations and fermatas above the TAB staff. See [Articulations and fermatas on tab-only tracks](#articulations-and-fermatas-on-tab-only-tracks).
- New SVG classes: `clef`, `clef-change`, `courtesy-clef`, `multi-rest`, `multi-rest-count`, `slash`, `tab-slash`, `tab-articulations` and `tab-fermata`.

### 1.10.0 — 2026-11-21

Expression lines and tempo. Scores that use none of the inputs listed below are unchanged, with one exception: a `dynamic` on a voice 2 beat is now drawn. Five beat fields that were ignored before 1.10.0 now draw (`hairpin`, `fade`, `wah`, `ottava` and `tempo`), so check any score that already sets them. Those changes are listed first.

Changes to existing inputs:

- A `dynamic` on a voice 2 beat is now drawn on the dynamics line below the notation staff, at voice 2's position. Before 1.10.0 it was not drawn. If voice 1 has a dynamic at the same time, voice 2's is not drawn. Voice 2 chord symbols are still not drawn, and neither are dynamics on voice 2 grace notes. See [Voices](#voices).
- `beat.hairpin`, `beat.fade`, `beat.wah`, `beat.ottava` and `beat.tempo` were ignored before 1.10.0. Now each one draws its mark. See [Expression lines, ottava and tempo](#expression-lines-ottava-and-tempo).
- `tempoText` is unchanged. A tempo change on the first beat of the score shares a baseline with `tempoText`, which can then sit a little higher.

New:

- `hairpin` on a beat: crescendo and diminuendo hairpins on the dynamics line, split across a system break.
- `fade` on a beat: fade-in, fade-out and volume-swell signs above the staff.
- `wah` on a beat: open and closed wah signs above the staff.
- `ottava` on a beat: 8va, 8vb, 15ma and 15mb brackets. Notes inside a bracket are drawn an octave or two away from their pitch, on the notation staff only. The score's pitch data and the TAB are not changed.
- `tempo` on a beat: a tempo change with a metronome note, optional dots and bold text, shown above the staff.
- Fermatas clear the fade, wah and bracket marks, and chord symbols rise above them. A system with a hairpin lowers its dynamics line to clear it.
- New SVG classes: `hairpin`, `hairpin-cresc`, `hairpin-dim`, `hairpin-cont`, `fade`, `fade-in`, `fade-out`, `fade-swell`, `wah`, `wah-open`, `wah-closed`, `ottava`, `ottava-8va`, `ottava-8vb`, `ottava-15ma`, `ottava-15mb`, `ottava-cont`, `tempo-change`, `tempo-change-text`, `tempo-change-note`, `tempo-change-dot` and `tempo-change-bpm`.

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

- `index.js`: public exports (`MusicScoreRenderer`, `ScoreEditor`, `defaultTheme`).
- `package.json`: package metadata and the `npm test` and `npm run demo` scripts.
- `LICENSE`: the MIT licence for the code.
- `.gitignore`: keeps local tooling folders and logs out of the repository.
- `src/`: the renderer. Rendering runs normalize, then layout, then draw.
  - `MusicScoreRenderer.js`: the entry point (the `MusicScoreRenderer` class). It runs the pipeline and mounts the SVG.
  - `hitMap.js`: the hit map behind `getHitMap()` and `hitTest()`. It builds plain data from the last render.
  - `editor/`: the `ScoreEditor` keyboard editor (2.0.0), with its effect keys (2.1.0) and its settings API (2.2.0). Its files and their roles are listed in `docs/ARCHITECTURE.md`, under "Editor (2.0.0)", "Editor effects (2.1.0)" and "Editor settings (2.2.0)".
  - `normalize.js`: fills in score defaults (sticky time and key signatures, barlines, measure count, pitch from string and fret, written and sounding pitch, `tabRhythm`, padded measures).
  - `harmonics.js`: guitar harmonic kinds and the helpers that layout, drawing and labels share.
  - `directions.js`: the playing direction fields (let ring, pick strokes, strum, arpeggio, tap, slap, pop, whammy, rake, trill, slide in and out, the bend grammar) and their canonical values.
  - `hands.js`: the hand-mark fields (ornament, left- and right-hand fingering, golpe, pick scrape, barre), their canonical values and the barre label.
  - `chordShapes.js`: chord-diagram shapes. Validates an author's shape against the track and picks the shape a beat shows.
  - `navigation.js`: the navigation fields (`ending`, `segno`, `coda`, `jump`, `section`, `repeatCount`), their canonical values and the merge across tracks.
  - `scoreText.js`: canonical forms of the score text fields (header lines, sections, repeat counts, beat text, capo) and the capo and tuning chart rows.
  - `noteEffects.js`: the canonical values of the `vibrato`, `tremolo` and `fermata` fields (for example `'wide'`, `'16th'` or `'short'`), used when drawing.
  - `expression.js`: the canonical values of the `hairpin`, `fade`, `wah`, `ottava` and `tempo` fields, and the ottava display shift that normalize adds to the notes inside a bracket.
  - `clef.js`: the clef names, the clef in force on each track at each measure, the clef's staff positions and key signatures, and its glyphs.
  - `slash.js`: rhythm slashes (the `slash` flag, the slash notehead on the staff and the slash on TAB).
  - `lyrics.js`: the `lyric` field (canonical verses and syllables) and the horizontal room a syllable needs.
  - `twoVoice.js`: the one shared rule for two voices (a voice 2 counts only when it has a beat that is not a hidden rest), which voice a layout element belongs to, and which beat supplies each TAB mark of a column.
  - `layout/`: positioning, no drawing.
    - `index.js`: `computeLayout`. Ties the layout steps together and sets element positions.
    - `timeline.js`: the shared note timeline across tracks and the horizontal spacing.
    - `chord.js`: chord geometry (seconds, accidental columns, dots, ledger lines), the room an arpeggio line needs and the columns of left-hand fingering digits.
    - `accidentals.js`: accidentals carried through a measure.
    - `voices.js`: the shared columns of a two-voice measure (clash shift, shared accidentals, dots, rest positions), shared unison noteheads, merged rests and the TAB marks of each column.
    - `systems.js`: system breaking, justification, headers, courtesy signatures, instrument-name indents.
    - `beams.js`: beams and tuplet groups, including compound meters. A voice with nested tuplets is grouped by `tuplets.js`.
    - `tuplets.js`: nested tuplet groups (outer and inner brackets) for a voice with a two-entry `tuplets` beat.
    - `vertical.js`: places each staff vertically from its content.
    - `ink.js`: measures the drawn extent of each staff. An opt-in overlap mode counts every mark whose width reaches into an x range.
    - `navigation.js`: groups endings into volta brackets, splits them at line breaks and places the segno, coda, jump and repeat-count marks and the section markers horizontally.
    - `tabRhythm.js`: geometry of the rhythm on TAB staves (stem positions and lengths, flags, dots, horizontal room).
    - `multiRest.js`: multi-measure rests: finds the runs of rest measures and lays each run out as one column.
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
    - `multiRest.js`: the bar and count of a multi-measure rest, on notation and TAB.
    - `lyrics.js`: lyrics under the staff (`renderLyrics`, drawn between passes 5 and 6) and `lyricsBottom`, which lets the marks below the staff clear them.
    - `tabOnlyMarks.js`: articulations and fermatas above the TAB staff of tab-only tracks. Articulations are drawn between passes 2 and 3, and fermatas after pass 7.
    - `chordDiagram.js`: one chord diagram (the fretboard box with its dots, barres, fingers and name).
    - `passes.js`: the score-wide passes, drawn after all systems; re-exports them from `passes/` and documents their order.
      - `passes/common.js`: helpers shared by the passes.
      - `passes/notationBeats.js`: notation beats, slurs, beam groups and the space above a beat, shared by several passes.
      - `passes/curves.js`: ties, slurs (including hammer-on and pull-off slurs), grace-note slurs and notation slide-ins and slide-outs.
      - `passes/tabTechniques.js`: tab techniques (tap / left-hand tap / slap / pop letters, golpe, trills, whammy dips and lines). Hands the per-note links to `tabLinks.js`.
      - `passes/techniqueLabels.js`: technique labels (P.M., harmonics, let ring, pick scrape, barre, rake).
      - `passes/playingDirections.js`: pick strokes, strum arrows, ornaments, right-hand letters, notation tap / left-hand tap / slap / pop letters, golpe and trills.
      - `passes/chordsFermatas.js`: chord symbols and diagrams, the dynamics line (drawn by `dynamicsLine.js`), and fermatas.
    - `header.js`: the page header rows (title, subtitle, credits, instructions, capo and tuning chart) and the copyright footer.
    - `navigation.js`: volta brackets, segno, coda, jump texts and repeat counts, and section markers above each system's top staff, drawn after the fermatas and beat text and before the tempo.
    - `beatText.js`: beat text (`beat.text`) above or below a track's staves, drawn after the fermatas and outside the `passes/` barrel.
    - `decor.js`: tempo, measure numbers, joining line, bracket and instrument names.
    - `dynamicsLine.js`: the dynamics line below a notation staff (voice 1 and voice 2 dynamics, and hairpins), drawn by pass 6.
    - `expressionMarks.js`: fade and wah marks above the top staff, drawn after pass 5.
    - `ottava.js`: 8va and 15ma brackets above the notation staff (drawn before pass 6), and 8vb and 15mb brackets below it (drawn after pass 6).
    - `tempoMarks.js`: tempo changes (the metronome note and `= N`), drawn after navigation, above each system's top staff.
    - `svgUtil.js`: small SVG helpers.
  - `theme.js`: theme defaults and the pixel-key conversion.
  - `glyphs.js`: Bravura glyph names. `glyphMetrics.js`: approximate glyph bounding boxes. `textMetrics.js`: estimated text widths.
  - `font.js`: font loading. `pitch.js`, `duration.js`: pitch and duration helpers, including a beat's tuplet chain. `rational.js`: exact fractions for note timing.
- `examples/`: sample scores, and the logic of the editor demo page: `editor-demo.js`, with the settings dialogs in `editor-demo-settings.js` (Score…), `editor-demo-tracks.js` (Tracks…), `editor-demo-measure.js` (Measure…) and `editor-demo-forms.js` (their shared form helpers).
- `fonts/`: the Bravura font (SIL Open Font License; see `fonts/BRAVURA-LICENSE.txt`).
- `tests/`: snapshot tests, unit checks, engraving checks, assertions and structural guards (`run.js`, `units.mjs`, `engraving.mjs`, `articulations.mjs`, `structure.mjs`), the test hooks and DOM shim the runner uses (`hooks.mjs`, `dom-shim.mjs`), the characterization fixtures (`fixtures/characterization.js`), and the saved snapshots (`snapshots/`).
- `index.html`: the demo page. `lead-riff.html` and `lead-solo-f.html`: demo pages for the lead-riff and lead-solo examples. `editor.html`: the keyboard editor demo.
- `docs/features.html`: feature summary page with live examples (serve over http, like the demo).
- `docs/ARCHITECTURE.md`: design notes for the module boundaries. The editor (2.0.0, with its effects in 2.1.0 and its settings in 2.2.0) is described there. Import, playback and the other proposed layers are not built yet.

## License

- The code is licensed under the MIT License. See `LICENSE`.
- The Bravura font in `fonts/` is licensed under the SIL Open Font License, Version 1.1. See `fonts/BRAVURA-LICENSE.txt`.
