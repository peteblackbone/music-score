# Architecture decisions

This document captures the module boundary decisions for `music-score`, made
before building the editor/playback layer, so the module grows into the
right shape instead of needing a rewrite once the web app exists.

## The module is a library, not an app

This mirrors how every serious embeddable editor works (Monaco, CodeMirror,
ProseMirror/TipTap): the editor library owns the content model and the UI
for manipulating it; the *host application* owns auth, persistence, and any
backend. Applied here:

1. The module never talks to a database, directly or indirectly.
2. The module (renderer + editor + playback) only ever interprets the
   module's own internal score format — never a foreign format directly.
3. The module exposes an `exportScore()` that returns plain,
   JSON-serializable data. (In 2.0.0 the editor's method is `ScoreEditor#getScore()`, with `toJSON()` as an alias. The name `exportScore` is internal to `src/editor/model/io.js`.) What the caller does with it (POST to an API,
   write to disk, IndexedDB, `localStorage`) is entirely the host's concern.
4. The module exposes import functions that convert a foreign format
   (Guitar Pro `.gp3/.gp4/.gp5/.gpx`, later MusicXML) into the internal
   format. Once imported, everything downstream only ever sees the internal
   format — the editor/renderer/playback never special-case "this note came
   from a .gp5 file."
5. Where the module genuinely needs an external service (see below), it
   never hardcodes an endpoint. The host injects a converter
   function/endpoint via config; the module stays runnable standalone
   (tests, demo page, offline) with zero network calls by default.

## Internal format: JSON, versioned from day one

The internal score schema (already sketched in `examples/*.js`) becomes a
formal JSON Schema, validated on load. Two additions matter before any real
user data exists:

- A top-level `schemaVersion` field, starting at `1`. Free to add now,
  expensive to retrofit after scores are sitting in someone's database.
  *Status: built in 2.0.0 for the editor's JSON. See "Editor (2.0.0)".
  The JSON Schema and the migration seam below are not built.*
- `core/migrate.js` as the seam for future format changes — old saved
  scores keep loading correctly even after the schema evolves. Essential
  for anything that will eventually look like Google Docs (long-lived
  documents, revision history).

## Proposed module layout

```
src/
  core/            # the format itself — no rendering, no DOM, no network
    schema.js      # JSON Schema for the score format
    validate.js    # validateScore(data) -> {valid, errors}
    migrate.js     # migrateScore(data) -> current-version data
  io/              # format conversion — pure functions in, data out
    json.js        # toJSON()/fromJSON() (mostly validate + passthrough)
    guitarpro/     # .gp3/.gp4/.gp5/.gpx importer(s)
  render/          # existing SVG renderer (MusicScoreRenderer, layout, draw/, theme, glyphs)
  editor/          # NEW: selection, insert/delete/edit note, undo/redo
  playback/        # NEW: Web Audio interpreter of the internal format
  index.js         # the only public surface — re-exports what the host needs
```

`render/` is already built. `editor/` and `playback/` are new, and both are
built strictly on top of `core`'s data model — neither one is allowed to
understand `.gp*` or any other foreign format directly.

**Status after 2.0.0.** The layout above is a plan, and only part of it is
built:

| Proposed | Status |
|---|---|
| `src/core/schema.js` (JSON Schema) | Not built. Validation is done in code (`sanitize.js`, `src/editor/model/io.js`). |
| `src/core/validate.js` (`validateScore`) | Not built. |
| `src/core/migrate.js` (`migrateScore`) | Not built. The editor only checks that `schemaVersion` is 1. |
| `src/io/json.js` (`toJSON` / `fromJSON`) | Partly built, inside the editor: `src/editor/model/io.js` parses and exports. The renderer has no JSON API. |
| `src/io/guitarpro/` | Not built. |
| `src/render/` | Not created. The renderer stays at the top of `src/`. |
| `src/editor/` | Built. The model lives in `src/editor/model/`, not in a separate `core/` folder. See "Editor (2.0.0)". |
| `src/playback/` | Not built. |
| `index.js` | Built. It exports `MusicScoreRenderer`, `ScoreEditor` and `defaultTheme`. |

## `.gp*` import strategy

Guitar Pro's binary formats are notoriously undocumented outside of
existing parser implementations. Rather than reverse-engineer them from
scratch, [alphaTab](https://github.com/CoderLine/alphaTab) (MPL-2.0) is the
most complete open-source implementation — it parses `.gp3`/`.gp4`/`.gp5`
and the newer zipped `.gpx`/`.gp` (v6/7) formats natively in TypeScript,
and its [format docs](https://alphatab.net/docs/formats/guitar-pro-3-5) are
a solid reference even if we write our own parser rather than depending on
alphaTab directly. MPL-2.0 is file-level copyleft (any file copied from it
must stay MPL, but it can otherwise sit alongside proprietary code in the
same project) — worth a real license check before deciding to depend on it
vs. write an independent parser from its documented format knowledge.
Smaller single-format parsers exist too (e.g. `parse-gp5`) but are far less
complete/maintained.

Recommendation: parse `.gp*` entirely client-side. It's binary parsing, not
heavy computation — there's no real reason to route it through an external
service. Reserve the "external service" injection point (point 5 above)
for things that are genuinely infeasible in-browser: e.g. rendering
playback to an exportable compressed audio file, or a future
scanned-tab/audio-to-notation feature.

## How the future web app plugs in

The host app (accounts, DB, sharing) is responsible for everything outside
the module:

- Fetch a score's JSON from its own DB, call the module's load/import with
  it.
- On save, call the module's `exportScore()` and persist the result itself
  (a `scores` table/collection with the JSON blob in one column plus a few
  indexed metadata fields — title, owner, updated_at — for listing/search
  is the natural shape; a JSON document store works just as well).
- Own auth, sharing, and (later) the Google-Docs-style collaborative
  editing feature — none of that needs to leak into the module.

This keeps the module testable and reusable on its own (a plain demo page,
unit tests, or even a completely different host app later) without ever
being coupled to one backend's schema or API shape.

## Drawing order of the score-wide marks (1.10.0, with the 1.11.0 and 1.12.0 calls)

`MusicScoreRenderer.render()` draws every system first, then runs the
score-wide marks. The seven numbered passes live in the `draw/passes.js`
barrel and must keep their order. The other calls sit between them: they are
not passes, so they stay out of `passes/`, which keeps each pass small.
`tests/structure.mjs` checks the order and that the barrel exports stay as
they are.

1. Passes 1 and 2 (ties and slurs, grace slurs). Then `renderTabOnlyArticulations`
   (`draw/tabOnlyMarks.js`, 1.11.0): articulations above the TAB staff of
   tab-only tracks. It is not a pass, and it seeds pass 3 through
   `run.tabOnlyBoxes`. Then passes 3 to 5 (TAB articulations, technique
   labels, playing directions).
2. `renderFadeWah` (`draw/expressionMarks.js`): fade and wah marks above the
   top staff. Their boxes go into `run.aboveBoxes`.
3. `ottavaSegments` (`draw/ottava.js`, layout only), then `renderOttavaAlta`:
   the 8va and 15ma brackets above the notation staff. Their boxes also go
   into `run.aboveBoxes`.
   Then `renderLyrics` (`draw/lyrics.js`, 1.12.0): the lyrics under the staff.
   It is a non-pass call and writes no boxes. It runs after passes 1 to 5 and
   before pass 6, so the staff ink it measures holds every mark above it.
4. Pass 6 (`renderChordSymbolsAndDynamics`): chord symbols and diagrams, then
   the dynamics line from `draw/dynamicsLine.js` (voice 1 and voice 2
   dynamics, and hairpins). Pass 6 measures the staff's ink first, so chord
   symbols rise above the marks of step 2 and 3. The staff's ink now includes
   the lyrics (1.12.0), so the dynamics line moves down only on systems that
   have lyrics.
5. `renderOttavaBassa`: the 8vb and 15mb brackets, below the dynamics line and
   below the lyrics band of their system (`lyricsBottom`, `draw/lyrics.js`), so a
   bracket never sits in a verse row with no syllable under its span.
6. Pass 7 (`renderFermatas`): fermatas clear the chord boxes and
   `run.aboveBoxes`. The boxes reach pass 7 through `collectBeats` in
   `passes/notationBeats.js`.
   `renderTabOnlyFermatas` (`draw/tabOnlyMarks.js`, 1.11.0) follows pass 7 and
   clears the ink of each column in the TAB group. It is not a pass.
7. Beat text (`draw/beatText.js`; text below also clears the lyrics band), then the navigation marks per system
   (`draw/navigation.js`). Then the tempo: `tempoChanges` and the score's
   `tempoText` in `MusicScoreRenderer.js` (the `drawTempo` in `draw/decor.js`
   takes an optional shared baseline), then `renderTempoChanges`
   (`draw/tempoMarks.js`), so the metronome marks are the outermost marks
   above each system's top staff.

The expression fields are read in two places, and both use `src/expression.js`
(pure canonical forms, null for anything unknown):

- Drawing: each draw module canonicalizes its own fields.
- Layout: `normalize.js` adds `ottavaShift` (-7, -14, +7 or +14 staff
  positions) to the pitched notes inside an ottava run, and only in tracks
  that have a valid `beat.ottava`. `src/pitch.js` (`notePosition`,
  `displayPitch`) adds the shift to the staff position and to the octave of
  the accidental state. The written pitch, the TAB frets and the chord
  diagrams never see the shift. Tracks without an ottava get the same track
  object back, so their output is unchanged.

## Notation structure (1.11.0)

1.11.0 adds clefs and clef changes, multi-measure rests, rhythm slashes and
tab-only articulations and fermatas. Each feature is opt-in or reads a field
that was ignored before. Each one adds to the layout model only when the
feature is present, so scores without it keep the same layout output.

Modules:

- `src/clef.js` (no DOM): the accepted clef names (`clefOf`, trimmed and lower
  case), the clef in force on each track at each measure (`clefAt`,
  `clefChangeAt`, `notationClefChange`), the staff positions and key signatures
  of the C clefs (`clefNotePosition`, `clefKeySignatureLayout`), and the clef
  glyph and anchor line (`clefGlyphFor`, `clefAnchorPos`). It calls
  `src/pitch.js` only with `'treble'` or `'bass'`, so `pitch.js` is unchanged.
- `src/slash.js`: the rhythm slash (`isSlashBeat`, `withSlash`,
  `slashHeadGlyph`, the slash head on the middle line and the TAB half-width).
- `src/layout/multiRest.js`: finds the runs of rest measures
  (`multiRestRuns`, null unless `score.multiMeasureRests === true`) and builds
  the column of a run (`multiRestColumn`) and its bar (`multiRestBar`).
- `src/draw/multiRest.js`: the bar and the count, on notation and on TAB.
- `src/draw/tabOnlyMarks.js`: the tab-only articulations and fermatas (see
  the render order above).

### Clef in force

Every read of `track.clef` for drawing or layout goes through
`clefAt(track, mi)`. It is cached per track object in a `WeakMap`, and the
table is built from the track's clef and each measure's `clef` in measure
order. Normalization does not change the clef names, so the canonical form is
computed when it is read. Callers: `layout/timeline.js` (note positions and
the clef passed to `voiceEvents`), `layout/systems.js` (the clef width in the
opening and the header), `draw/notation.js` (positions and grace notes),
`draw/system.js` (the header clef and the key and clef changes), and
`scoreText.js` (the tuning chart, which reads measure 0 and passes the clef's
base to `referenceTuning`).

The clef change of a measure (`clefChangeAt`) is drawn only on notation tracks
(`notationClefChange`). The header clef has no class, so a clef at the start
of a system adds no class to existing markup.

### Multi-measure rest columns and `lastOf`

`computeLayout` (`layout/index.js`) replaces the first column of each run with
the column from `multiRestColumn`. That column has no onsets, a fixed gap, and
two extra keys: `lastMi` (the run's last measure) and `multiRest` (the bar
count). Its measure has no elements, so the passes need no special case for
it. The normalized model is not changed.

`lastOf(columns, mi)` (`layout/systems.js`) returns the last measure that the
column at `mi` stands for: the run's last measure when `mi` is a run's first
measure, otherwise `mi`. `breakSystems`, `justifySystem`, the
courtesy widths and `closingBarline` step over a run through it, so a run is
never split across a system break. Without `lastMi` every call returns its
input, so scores without the feature take the same paths. Navigation
(`layout/navigation.js`) maps each measure of a run onto the run's column, and
a segno or a section stays at the run's first measure, while a jump or a
repeat count stays at its last.

### Run seed for pass 3

`renderTabOnlyArticulations` runs after pass 2 and records each stack's box in
`run.tabOnlyBoxes`. `passes/tabTechniques.js` (pass 3) starts
`run.tabInkBoxes` from a copy of those boxes, because pass 3 resets the ink
boxes it measured itself. This is why tap letters, technique labels and pick
strokes stay out of the articulation stack, while bends are drawn over it.
The two calls are named `renderTabOnlyArticulations` and
`renderTabOnlyFermatas` so that they do not match the pass-name pattern that
`tests/structure.mjs` checks. Both are called from `MusicScoreRenderer.js`,
outside `passes/`.

## Lyrics, on-beat graces and nested tuplets (1.12.0)

1.12.0 adds lyrics under the staff, grace notes drawn without a slash on the
beat, and tuplets nested two levels deep. Each one reads a field that scores
did not set before, so a score without these fields keeps the same layout and
drawing output. The 77 snapshots from before 1.12.0 are unchanged.

Modules:

- `src/lyrics.js` (no DOM): the canonical `beat.lyric` (`canonicalLyrics`,
  `lyricsOf`) and the horizontal room a syllable needs (`lyricExtents`).
  `layout/timeline.js` widens the left and right extents of voice 1 note beats
  with it. `normalize.js` keeps the raw field, so the normalized model is
  unchanged.
- `src/draw/lyrics.js`: `renderLyrics`, the non-pass call before pass 6 (see
  the order above), and `lyricsBottom`, the lowest ink of a staff's lyric band.
  The 8vb and 15mb brackets (`draw/ottava.js`) and the below-staff beat text
  (`draw/beatText.js`) also clear it.
- `src/layout/tuplets.js` (no DOM): `hasNestedTuplets` and `nestedTupletGroups`.
  `layout/beams.js` hands a voice to `nestedTupletGroups` only when one of its
  non-grace beats has a valid two-entry `tuplets`. Every other voice runs the
  existing `tupletGroups` loop unchanged.
- `src/duration.js`: `validTuplets` (the strict `tuplets` check) and
  `tupletChain` (a beat's ratios, outer first: `tuplets` when valid, else
  `tuplet`). `durationR` multiplies by every ratio of the chain, so a one-entry
  chain gives the same product as before.
- `src/layout/beams.js`: `outerOf` reads `tupletChain(b)[0]`, which equals
  `normalizeTuplet(b.tuplet)` when no `tuplets` is set. The `normalizeTuplet`
  import is gone from this file.
- `src/layout/voices.js`: `tabEl.tuplets` is copied only when the beat has a
  `tuplets` field, so the key order of existing `tabEl` objects is unchanged.
- `src/layout/multiRest.js`: `lyric` is in `REST_KEYS`, so a lyric on a rest
  does not stop a multi-measure rest from forming.
- `src/draw/notation.js` (`renderGraceNote`): the grace note's parts go into a
  `grace-on-beat` group when `el.onBeat === true`, and the slash is not drawn.
  Otherwise the path is the same as before.
- `src/draw/system.js` (`drawTupletBrackets`) and `src/draw/tabRhythm.js`
  (`drawTuplets`): groups with a `depth` key are drawn in their own loops. Inner
  groups (`depth: 1`) are drawn first, in today's order. Outer groups
  (`depth: 0`) are placed outside their inner groups.

Design notes:

- Lyric clearance is ink-based. `renderLyrics` measures the lowest ink of the
  staff group it draws into (notation, else TAB) after passes 1 to 5, and puts
  verse 1 0.8 sp below it. Later marks below the staff measure ink too, so they
  move down only where lyrics exist. `placeStaves` runs after the passes, so a
  TAB staff under notation, and the next system, make room.
- Nothing may draw into a staff group between `renderLyrics` and pass 6,
  because pass 6 measures that ink. `tests/structure.mjs` checks the order of
  the seven passes and ignores the non-pass calls.
- Only the left and right extents of a syllable's beat widen. `ownLeft`, which
  grace notes anchor to, is not changed.
- Grace notes take no time, `onBeat` included. Their `duration` is still
  ignored. `durationR` is not applied to graces.
- Nested grouping is gated, so a score with no two-entry `tuplets` takes the
  old path. Inner groups are timed in the outer frame: each beat's outer-frame
  unit is its written value times its inner ratios, and the inner cells are
  taken in that frame.
- Beam grouping is not changed for nested tuplets (a documented limitation).
- The `tuplets` bounds (integer count 2 to 64, `of` 1 to 64) are enforced in
  `validTuplets`. `splitRun` always advances its index, so a non-finite time
  cannot loop forever.

## Editor (2.0.0)

2.0.0 adds `ScoreEditor`, a keyboard editor for guitar and bass tablature. It
also adds the renderer methods it needs: `getHitMap()`, `hitTest(x, y)` and
`getSvg()`. The user-facing description is in the README, under "Editing scores
(ScoreEditor)". This section records the structure and the decisions behind it.
The design sources are `.12sp/requirements-2.0.md`, `.12sp/design.md` and
`.12sp/ui.md`.

### Layers

1. **Renderer side.** `src/hitMap.js`, plus the private summary that `render()`
   keeps (`this._hitSource`). `getHitMap()` builds plain data from that summary
   when it is called. The SVG, normalize and layout do not change.
2. **Pure model.** `src/editor/model/*`, `keymap.js`, `announce.js`,
   `geometry.js`, `style.js`, `options.js` and `emitter.js`. A command takes
   `(score, cursor, state, ctx)` and returns the next state. None of these
   files touch the DOM.
3. **Controller.** `ScoreEditor.js` (the public class), `view.js` (the wrapper
   DOM, rendering, listeners and the live region) and `overlay.js` (the overlay
   groups).

### Module map

| File | Role |
|---|---|
| `src/editor/ScoreEditor.js` | Public class: the API, command dispatch, history, events, read-only mode and `destroy()`. Adds `setDuration`, `getCursorInfo` and `refresh`. |
| `src/editor/view.js` | The wrapper elements inside the container, the renderer it owns, DOM listeners, the render scheduler (per animation frame), the overlay, scrolling, the 150 ms live-region debounce and click coordinates. |
| `src/editor/overlay.js` | Creates the overlay groups, and draws shape lists as SVG elements. |
| `src/editor/emitter.js` | The listener map, and the queue of events that fire after the next render. |
| `src/editor/keymap.js` | `keyToCommand(e)`: a keyboard event to a command name, or `null`. |
| `src/editor/announce.js` | The live-region messages. Cursor moves speak only what changed. |
| `src/editor/geometry.js` | `indexHitMap` (lookups by track and measure), `cursorShapes` and `fillShapes`. |
| `src/editor/style.js` | Every visual value from the UI spec, and `resolveStyle(options)`. |
| `src/editor/options.js` | Option defaults and validation. |
| `src/editor/model/io.js` | `parseInput` (JSON or object to model), `exportScore` (model to JSON with `schemaVersion`) and `sanitizeFixed`. |
| `src/editor/model/limits.js` | The input limits (`ScoreEditor.LIMITS`) and their checks. |
| `src/editor/model/defaultScore.js` | The score a new editor starts with. |
| `src/editor/model/durations.js` | Duration names, spoken words and fill words. The one copy of that vocabulary. |
| `src/editor/model/access.js` | Reading and copy-on-write updating of beats, notes and measures. Voice 1 access that mirrors normalize. |
| `src/editor/model/fill.js` | Measure fill (`under`, `full`, `over`) and beat onsets. |
| `src/editor/model/cursor.js` | Positions, cursor clamping, the moves and `cursorInfo`. |
| `src/editor/model/ties.js` | Repairing ties across the seams that edits create. Finding the previous and next main beat. |
| `src/editor/model/notes.js` | Fret entry (with the two-digit buffer), delete note and toggle tie. |
| `src/editor/model/effectTable.js` | The effect rows (`EFFECTS`, 2.1.0), `EFFECT_KEYS`, `EFFECT_BY_NAME`, `SUFFIXES` and the bend, dynamic and articulation classifiers. |
| `src/editor/model/effects.js` | `effectCommand(def)`, the step logic, the dead-note add and `effectState` (the effect words and steps at a position). |
| `src/editor/model/beats.js` | Durations, dots, triplets, the rest and note toggle, delete beat and insert beat. |
| `src/editor/model/measures.js` | Insert, delete and append measures. |
| `src/editor/model/commands.js` | The command registry and `run()`, which clamps the cursor and syncs the duration. |
| `src/editor/model/history.js` | The undo and redo stacks. |
| `src/hitMap.js` (renderer side) | `buildHitMap` and `hitTestMap`. |

Each file in `src/editor/` is 300 lines or fewer (a structure check).

### Import rules

`tests/structure.mjs` enforces these. Rules 1 to 5 each have a mutation test in
the same file: it breaks the rule on purpose and checks that the check fails.

1. Nothing in `src/` outside `src/editor/` imports from `src/editor/`. The root
   `index.js` may.
2. The pure files (`model/*`, `keymap.js`, `announce.js`, `geometry.js`,
   `style.js`, `options.js` and `emitter.js`) contain no `document`, `window`,
   `requestAnimationFrame` or `addEventListener` tokens.
3. Files under `model/` import from outside `src/editor/` only
   `src/sanitize.js`, `src/duration.js` and `src/rational.js`. From 2.1.0 they
   may also import `src/directions.js`, `src/harmonics.js` and
   `src/noteEffects.js` (see "Editor effects (2.1.0)"). From 2.2.0 they may
   also import `src/clef.js`, `src/navigation.js`, `src/scoreText.js` and
   `src/expression.js` (see "Editor settings (2.2.0)").
4. Renderer modules outside `src/editor/` may be imported only by the editor
   files on an allowlist: `MusicScoreRenderer.js` by `view.js` and
   `ScoreEditor.js` only; `hitMap.js` by `view.js` and `geometry.js`;
   `draw/svgUtil.js` by `overlay.js`; `textMetrics.js` by `geometry.js`.
5. Files in `src/editor/` are 300 lines or fewer.
6. The import graph under `src/` is acyclic. That check was already in place,
   and it covers `src/editor/`.
7. `index.js` exports exactly `MusicScoreRenderer`, `ScoreEditor` and
   `defaultTheme`. This pin is a test in `tests/units.mjs`, not in
   `tests/structure.mjs`. It was changed on purpose in 2.0.0.

### Hit map: lazy lookup, not SVG attributes

Addressing data could have gone into the SVG, as `data-*` attributes or ids on
every beat. That would change the markup of every render. The snapshots and the
C0 hash tests would then fail, and every page would carry editor data it does
not use. The hit map is built on demand instead:

- `render()` keeps a private summary of what it has already computed: the
  layout, the width and height, and each staff's `y`, `lineBottom` and string
  count. It holds references and numbers only, and writes nothing to the DOM,
  the layout or the score.
- `getHitMap()` builds plain objects from that summary on each call.
- `hitTest(x, y)` picks the staff whose vertical extent is nearest, within a pad
  (half a notation staff, or one string gap on TAB). It takes the measure whose
  `[x, endX)` holds `x`, the nearest voice 1 non-grace element by `x` (ties go
  to the lower index), and on TAB the nearest string, clamped to the string
  count. An empty measure gives its element count. The append slot is not an
  element, so a click never targets it.

The check: for every snapshot case, serializing the SVG, calling `getHitMap()`
and serializing again gives the same string (`tests/editor-dom.mjs`).

The editor renders a view copy with `multiMeasureRests` off, while the model
keeps the author's value. The hit map follows that view.

### Model, copy-on-write and history

- The model is the sanitized score without `schemaVersion`. It is never
  mutated. A command returns a new model that shares every unchanged object
  with the old one.
- `updateBeat`, `updateBeats` and `updateNote` copy only the path to the edited
  object: the score, its tracks array, the track, its measures array, the
  measure and, in a two-voice measure, the voices array and `voices[0]`.
  `voices[1]` and `measure.beats` are never touched. Test E12 checks, on a
  fixture rich in 1.x effects, that untouched objects keep their identity.
- A history entry is `{ before, after, label }`, where each side is
  `{ score, cursor }`. Both sides are shared references, so an entry costs two
  references, not a copy of the score. `push` clears redo and drops the oldest
  entry past `historyLimit` (default 200; the integer is clamped to 0–10000).
- The second digit of a two-digit fret replaces the top entry's `after`
  (`coalesce`), so both digits make one step.
- `run()` in `model/commands.js` clamps the resulting cursor. It clears the
  digit buffer after any command other than `digit`, and re-syncs the current
  duration when the position or the model changes.
- Undo and redo restore the stored snapshot, clamp its cursor, clear the buffer
  and re-sync the duration.

### The invariant: `sanitizeScore(model) === model`

After every command, `sanitizeScore(model)` returns the model itself. Commands
keep this true by writing only shapes that sanitize accepts unchanged:

- durations come only from `DURATIONS`;
- `tuplet` is `3`, or absent;
- frets are integers from 0 to `maxFret` (at most 99);
- strings are clamped to the track's string count;
- `pitch` is removed only from fretted notes, and the editor never writes it;
- grace notes are never altered;
- new measures are `{ beats: [] }`.

`parseInput` turns the input into a model by repairing it until sanitize returns
its input unchanged (`sanitizeFixed`, at most three passes). Two tests check the
invariant. The B10 property test in `tests/editor-model.mjs` runs six start
scores with 2000 seeded random commands each, and checks the invariant and a
valid cursor after every command. It then undoes everything and redoes
everything. An editor-level test in `tests/editor-dom.mjs` sends 300 keys, with
frames flushed every 25 keys, and checks that the hit map agrees with the model.

Known gap: `sanitizeFixed` stops after three passes. An input that needs more
passes to settle would leave the model different from its sanitized form, and
the invariant would not hold for it. The test fixtures settle within three passes.
Input of that kind is not tested.

### Saved format and `schemaVersion`

- From 2.0.0, the editor's JSON carries `"schemaVersion": 1`. `getScore()`
  writes it first.
- On read, a missing value or `null` is accepted, and so is `1`. Any other
  value throws `Error('Unsupported schemaVersion')` and changes nothing. A string
  `"1"` is refused, because the check is strict. A value that is not a JSON
  object throws `Error('Score must be a JSON object')`.
- The key is removed from the model on read, and written again on export.
- The renderer does not check `schemaVersion`. It ignores the key, so editor
  JSON renders as before, and a file with another version value still renders.
- Policy for a future format change: bump the version, and add a migration step
  in `core/migrate.js` (not built). Until then, readers refuse newer values.

### Input limits

`src/editor/model/limits.js` holds `ScoreEditor.LIMITS`. The JSON length is
checked first, then the parsed data, both before repair or drawing:

| Limit | Value |
|---|---|
| JSON text | 5 MB (5,242,880 characters) |
| Tracks | 32 |
| Measures per track | 2000 |
| Voices per measure | 4 |
| Beats per voice per measure | 256 |
| Notes per beat | 16 |
| Tuning strings | 12 |

The limits were added after the security review of 2.0.0. They keep a large or
hostile file from stalling the page or filling storage. The renderer does not
apply them. From 2.2.0 the same file holds the caps for the settings API (text
lengths, beats, capo, tempo, endings, repeat counts), which only the settings
calls check (see "Editor settings (2.2.0)").

### Rendering and events

- Edits re-render once per animation frame. Several edits in one frame give one
  render. Without `requestAnimationFrame` (Node), the render is synchronous.
- Hidden or background tabs pause animation frames, so a pending render also
  runs after a 250 ms timeout (`RENDER_FALLBACK_MS`); `change` and the host's
  autosave still happen.
- A cursor move redraws only the overlay group, and emits `cursor` at once.
- `change` is queued and fires after the render that it caused. The
  `afterRender` hook drains the queue. A click flushes a pending render first,
  so the hit map is current when it is used.
- The overlay is rebuilt on each render. Cursor redraws clear their group with
  `textContent`.
- The editor re-renders once after `document.fonts.ready`. `refresh()` schedules
  a render.
- Full re-render per edit is the only cost model in 2.0. Incremental rendering is
  not built. It is the next step if the speed targets are missed.

## Editor effects (2.1.0)

2.1.0 adds the effect keys (H, S, B, V, P, X, G, N, D, A and their Shift
variants). The user-facing description is in the README, under "Editing rules",
"Effects". The design sources are `.12sp/requirements-2.1.md` and
`.12sp/design-2.1.md`. The effects are data: one table row per command. The
commands, keys, announcements and cursor info are built from that table, so a
new effect is mostly a new row.

### The table

`src/editor/model/effectTable.js` exports `EFFECTS`, a frozen array with one
row per command (15 rows: hammerPull, slide, slideInOut, bend, bendBack, vibrato,
palmMute, deadNote, ghostNote, harmonic, letRing, louder, softer, accent,
staccato). A row has these fields:

- `name`, `key`, `shift`: the command name and its key. `EFFECT_KEYS` maps a key
  such as `'h'` or `'Shift+s'` to the name.
- `level`: `'note'` (the voice-1 note on the cursor string) or `'beat'` (the
  cursor beat).
- `fields`: the JSON keys the row owns. Turning the effect off deletes them.
- `steps`: the patches written in cycle order. `dir` (1 forward, -1 backward)
  and `start` (the step written from nothing) set how the cycle moves.
- `classify(target)`: the current step index, or -1 for nothing or a value the
  row doesn't write.
- `exclusive`, `onRest`, `creates`: the keys removed when the effect turns on,
  whether a beat row also works on rests, and whether X adds a dead note.
- `write(target, step, def)`: an optional replacement for the default write.
  Accent and staccato use it, because their steps are articulation names.
- `suffix`: a key of `SUFFIXES`, the spoken text added after an "on" result.
- `say`, `off`, `added`, `label`, `info`: the spoken words, the undo label and
  the words that `getCursorInfo()` lists.
- `custom`: whether a value the row doesn't write still counts as present. It is
  false for the articulation rows, because their words list every articulation.
- `reverseOf`: set on the backward rows (`reverse()` builds them from the
  forward row). They share its classification and words.

`SUFFIXES` holds the three spoken suffixes (`link`, `tabArtic`, `noNotation`).
Each has its text and an `applies(score, loc, track)` test.

### Command factory

`src/editor/model/effects.js` turns a row into a 2.0-style command with
`effectCommand(def)`. The command has the form `(score, loc, state)` and returns
`{ score?, announce }`. It checks, in order:

1. A note row on a track without TAB: `needsTab`.
2. X where there is no note: `addDeadNote`, which reuses the digit path (fret 0),
   so the seam and tie repair and the current duration come from fret entry.
3. The end-of-measure position: `noBeat`.
4. A note row with no note on the string: `noNoteHere`. A beat row on a rest
   that doesn't set `onRest`: `needsNote`.

Then `nextStep` picks the step, `writeStep` writes it through `updateNote` or
`updateBeat`, and the command announces `{ id: 'effect', name, step, suffix }`.
Writes never use `false`, and an empty `articulations` array is deleted.
`effectState(score, loc)` gives the words and the steps at a position. It skips
the backward rows.

### Wiring

- `model/commands.js` registers `EFFECTS.map(...)` in a loop. Each undo label is
  the row's `label`.
- `keymap.js` looks up a letter, with the Shift prefix, in `EFFECT_KEYS`. It
  uses own-property lookups, as the rest of the keymap does.
- `announce.js` finds the words through `EFFECT_BY_NAME`. The move announcement
  puts the effect words after the duration.
- `model/cursor.js` (`cursorInfo`) adds `effects`, `noteEffects`, `beatEffects`
  and `effectSteps` from `effectState`. The slot gives empty values.
- `model/notes.js` (`fretIntoNote`) clears `mute` when a digit is typed on a
  dead note, including at the same fret.

### Renderer canonicalizers

The classifiers use the renderer's own pure functions, not copies of them:
`bendOf`, `isLegatoSlide`, `linkTarget`, `slideInOf` and `slideOutOf` from
`src/directions.js`, `harmonicKind` from `src/harmonics.js`, and `vibratoOf`
from `src/noteEffects.js`. A value therefore counts as the same step the renderer
draws. The spoken "no next note on this string" suffix also uses `linkTarget`,
over the cursor note and the later voice-1 notes. On unusual input this can differ
from the renderer's run flattening, which affects only the suffix (an accepted
risk in `design-2.1.md`).

These three modules are in `EDITOR_SHARED` in `tests/structure.mjs`, with
`sanitize.js`, `duration.js` and `rational.js`. `draw/*` is still forbidden to the
model. A mutation case checks that a model file importing `draw/tab.js` fails.
Renderer code is never changed for the editor's sake.

### `effectSteps` for user interfaces

Interfaces should read `getCursorInfo().effectSteps` and never parse the spoken
words. It maps each effect name to its cycle position (0 for the first value, -1
for a custom value). For `louder`, the position is on the dynamic scale, so
`ppp` is 0 and `fff` is 7. The demo's `effectButtonState` in
`examples/editor-demo-effects.js` works this way. The button labels live in that
demo file, not in the table.

## Editor settings (2.2.0)

2.2.0 adds the settings API to `ScoreEditor`: the header, tracks, tuning and capo,
measure settings and tempo. The user-facing description is in the README, under
"Editing scores (ScoreEditor)", "Score and track settings". The design sources are
`.12sp/requirements-2.2.md`, `.12sp/design-2.2.md` and `.12sp/ui-2.2.md`. Where a
design document and the code differ, the code is the reference. The orchestrator's
reconciliation (R1 to R9) is in `design-2.2.md`, section 0.

### Install pattern

`src/editor/settings.js` exports `installSettings(ScoreEditor)`, which
`ScoreEditor.js` calls once after the class. It defines these on the prototype with
`Object.defineProperty`, all non-enumerable: the seven mutators and
`getMeasureSettings`, each a thin wrapper, and the `lastMessage` getter. It also
defines the private helpers `_settings`, `_settingsRefused`, `_sayKept` and
`_applyModel`. The statics `INSTRUMENTS` and `TUNINGS` are defined there too, frozen.
`SETTINGS_API` lists the public names for the surface pin test.

Keeping the methods out of the class body holds `ScoreEditor.js` at about 285 lines,
under the 300-line cap. The class itself gains four small edits: the import, the
`installSettings` call, `_syncRoot()` in `_step` (undo and redo update the
accessible name), and `_say` also setting `_lastMessage`.

### Operations, the registry and the controller

Settings do not go through `COMMANDS` or `run()`. Each operation is a pure function
`(score, cursor, ...args)` that returns `{ score, cursor?, announce }`, or
`{ refused: { id } }`. Operations live in `model/settings/`, and `ops.js` holds the
registry `SETTINGS`: the seven mutators, each with its undo label. The labels are
not in `COMMANDS`.

The controller `_settings(name, args)` checks things in this order:

1. `_alive()`.
2. The operation. It validates its arguments and throws before it builds anything.
   Bad arguments therefore throw even in read-only mode, and before the digit buffer
   is cancelled.
3. `_cancelBuffer()`. Any two-digit fret entry ends.
4. Read-only: refused with `readOnly`.
5. A refusal returned by the operation (`onlyTrack`, `lastVisible`, `tooManyTracks`,
   `noBeat`).
6. No change: when the operation returns the same score object, it is `noChange`.
7. Size: `exportedLength(score) > LIMITS.jsonChars` is `tooLarge`.
8. `_applyModel`: the cursor is clamped, the history entry is pushed with the label,
   `_syncRoot()` runs, the spoken text is set, the `cursor` event fires if the cursor
   moved, and the `change` event is queued with `{ source: 'edit', command, message }`.

A refusal or a no-op speaks its text and returns `false`, with no history entry and
no event. The settings path skips the hidden-track check that `run()` makes.

### Pure model: `model/settings/`

| File | Contents |
|---|---|
| `validate.js` | The argument checks: `object` (a copy of a plain object, each value read once), `checkKeys` (an allowlist with `Object.hasOwn`, so `__proto__`, `constructor`, `tracks` and `measures` are rejected), `index`, `intIn`, `text`, `flag`, `bool`, `same` and `withField`. `withField` returns the same object when nothing changes, so a no-op keeps every reference. |
| `instruments.js` | `INSTRUMENTS` and `TUNINGS`, deep-frozen. |
| `score.js` | `updateScore`, `setTempo`, `tempoAt`, `SCORE_FIELDS` and `TEMPO_UNITS`. |
| `tuning.js` | `canonicalTuning` and `retuneTrack` (see "Retuning" below). |
| `track.js` | `TRACK_FIELDS`, `checkTrackPatch`, `applyTrackPatch`, `updateTrack`, `uniqueName`. |
| `column.js` | The column helpers: `columnValue`, `writeFields`, `setColumn`, `setTrackField`, `newTrackMeasures`, `migrateRemoved`. |
| `tracks.js` | `addTrack`, `removeTrack`, `moveTrack`. |
| `measureSettings.js` | `updateMeasure` and `getMeasureSettings`. |
| `ops.js` | The `SETTINGS` registry. |

`model/fill.js` gains `keySignatureAt`, and `model/cursor.js` adds `timeSignature`,
`keySignature` and `tempo` to `cursorInfo`. `tempo` comes from `tempoAt` in
`settings/score.js`. There is no import cycle: `score.js` imports only `access.js`,
`validate.js`, `limits.js` and the shared `expression.js`.

`model/limits.js` gains the caps for the settings: `textChars` (200),
`longTextChars` (2000), `timeSignatureBeats` (32), `beatTypes` (1, 2, 4, 8, 16, 32),
`capo` (30), `bpm` (1000), `endingNumber` (99), `endingNumbers` (32),
`repeatCount` (99) and `sectionLetter` (3). `loadScore` does not enforce them.

### Shared renderer modules

`EDITOR_SHARED` in `tests/structure.mjs` gains `src/clef.js`, `src/navigation.js`,
`src/scoreText.js` and `src/expression.js`. The model uses the renderer's own
canonicalizers (`canonicalEnding`, `canonicalJump`, `mergeNavigation`,
`canonicalSection`, `canonicalRepeatCount`, `clefOf`, `clefAt`, `trackClef`,
`tempoOf`, `formatBpm`), not copies. A value the editor accepts is then one the
renderer draws in the same class, and the 82 snapshots stay byte-identical.

Two structure checks cover these modules. The first walks the relative imports of
every shared module and requires the whole closure to be DOM-free. The second is a
mutation case: a model file that imports `layout/navigation.js` (not the shared
`src/navigation.js`) must still fail the allowlist check. `isPureEditor` includes
`settings.js`. The import rule for `model/` (rule 3 above) lists the four modules.

Accepted risk: `clef.js` caches the clef table per track object in a `WeakMap`. That
is correct only because the model is never mutated.

### Column-wide writes and migration

A column field is one whose value spans every track at a measure index:
`barline`, `ending`, `jump`, `section`, `repeatCount`, `segno`, `coda`,
`timeSignature` and `keySignature`. Clef is per track.

- **Reading.** `VALID` mirrors the renderer's canonicalizers, so a field counts
  only when its value is valid there. `columnValue` returns the value from the
  lowest track index that sets one validly. The same rule drives `getMeasureSettings`.
- **Writing.** `writeFields(track, [[mi, field, value], …])` copies the measures
  array once and each measure at most once. A write whose value is already stored is
  skipped. A delete never creates a measure. A write past the end of a short track
  pads it with `{ beats: [] }`.
- **Scope.** `setColumn` writes on every track, hidden tracks included.
  `setTrackField` writes on one track.
- **Equality.** A time or key signature is compared with the value in force on that
  track just before the measure (`timeBefore`, `keyBefore`). Equal means delete.
  At measure 1 the baseline is the track's value, then the score's, then 4/4 or 0.
- **New track.** `newTrackMeasures` follows track 0's time and key signatures with as
  few writes as possible. At measure 1 it writes only when the value differs from the
  score's baseline. After that it writes only where track 0's value changes. The
  navigation fields come from `columnValue`, and clefs are never copied.
- **Removal.** `migrateRemoved(score, ti)` runs before a track is spliced out. For
  each measure and each of the nine column fields, when the removed track sets the
  field and no remaining track sets it validly at that measure, the raw value is
  written to every remaining track in one pass. The removed track's notes go with it.

Padded measures are authored, so a track with `tabRhythm` draws a whole rest in each
padded measure. This is a known effect of the padding (design risk).

### Retuning

`retuneTrack(track, tuning)` in `model/settings/tuning.js` works like this:

1. `canonicalTuning` checks that the value is an array of 1 to 12 strings. Each
   string must match `^\s*([A-Ga-g])([#b]?)(\d)\s*$` and is rewritten as letter,
   accidental and octave.
2. If the new tuning equals the old one, the track is returned unchanged. A track
   without its own tuning counts as standard 6-string guitar.
3. Two sets of string numbers are computed, counted from the highest string:
   - the changed strings C, where s ≤ min(old, new) and the open pitch differs;
   - the removed strings R, where new < s ≤ old.
4. Every beat array that sanitize visits is processed: `measure.beats` (even when
   `voices` exists) and each `voices[i].beats`, including grace notes. For a note:
   - on a string in R, it is counted in `removed`. A note with a valid `pitch` keeps
     it and loses `string`, `fret`, `tieStart` and `tieEnd`. Any other note is deleted;
   - on a string in C with both `fret` and `pitch`, `pitch` is removed.
5. A beat left with no notes becomes a rest that keeps its other fields. A voice-1
   beat with `slash: true` keeps `notes: []`. An emptied grace is dropped, and its
   index is recorded per measure so the cursor's beat can be corrected.
6. The new `tuning` is written. Everything is copy-on-write.

Ties need no separate step. A tie joins two notes on the same string, so its partner
is on the same removed string and is either deleted or has its tie flags cleared.

Two details matter for the count. `removed` includes notes that keep a `pitch`,
because the count is taken before the pitch check. That is the count the message and
the demo's confirm report. The editor never writes `pitch`.

### Size check on the exported form

`exportedLength(model)` in `model/io.js` returns the length of the JSON text that
`getScore()` would give, `schemaVersion` included. A settings call past
`LIMITS.jsonChars` is refused before it changes anything. The editor's own output
therefore always loads again: `parseInput` checks the same limit.

### Live region

`EditorView.announce(text, keep)` in `view.js` handles the joined speech. A kept
text (a settings result or refusal, passed as `keep`) stays in the window. A later
text is appended after it with `. `. A later non-kept text replaces the last
non-kept text. A repeat of the text just before is spoken once. The 2.0 rule (only
the last message in the window is spoken) still holds for key messages. Test I2 in
`tests/editor-dom.mjs` checks that rule.

### Demo boundary

The settings demo lives in `examples/editor-demo-settings.js` (the Score… dialog,
the status items and the read-only state of the three buttons),
`editor-demo-measure.js` (Measure…), `editor-demo-tracks.js` (Tracks… and the tuning
editor) and `editor-demo-forms.js` (the form helpers). They keep `editor-demo.js`
from growing.

- The demo modules use the public API only. The one exception is
  `src/editor/model/durations.js`, for the duration words, as in 2.1. A test
  (`tests/editor-settings-dom.mjs`) greps the demo's imports and allows nothing else
  from `src/`.
- Where the demo needs the library's vocabulary (`SCORE_TEXT`, `SCORE_FLAGS`,
  `BARLINES`), it keeps its own copy. Parity tests compare each copy with the
  library's list.
- The demo's `notesOnRemovedStrings` counts notes with the same rule the library uses
  for `removed`. A test checks that the two agree. The library exposes no
  `countNotes`.

### Tests

- `tests/editor-settings.mjs`: the model (validation for every operation, retuning,
  column writes, migration, cursor remapping, `getMeasureSettings`, the INSTRUMENTS
  and TUNINGS tables, a property test mixing commands and settings calls, and
  undo-all and redo-all).
- `tests/editor-settings-dom.mjs`: the controller (the public surface and its
  non-enumerable pin, event order, undo labels, refusals and no-ops, read-only,
  the aria-label after undo, joined announcements, each written value rendering its
  class, the demo helpers and the boundary grep).
- `tests/editor-settings-edge.mjs` and `tests/editor-settings-edge-dom.mjs`: the edge
  cases, the prototype-key rejections, property checks on randomized scores (add,
  remove, move and retune stay sanitize-stable, and `getMeasureSettings` matches the
  normalized score), and the render checks.

### Costs

`tempoAt` scans backwards from the cursor beat on every `cursorInfo` call, which
runs on each cursor redraw. Without a tempo mark it scans the whole track before the
cursor. The design flagged this for a 2000-measure benchmark. Re-check it with
`tests/bench-editor.mjs` before a release that changes the cursor path.

### Adding an effect (the 2.6 extension point)

A new effect on the existing note and beat targets takes:

- one row in `EFFECTS`, which gives the command, the key and the undo label;
- the unbound-letter counts in `tests/editor-model.mjs` (the random-key fuzzers,
  the E12 effect walk and the demo-button check are built from `EFFECTS`, so the
  invariant `sanitizeScore(model) === model` is checked for the new writes
  automatically);
- the README Keyboard table and Effects table, the demo's Effects buttons
  (`editor.html`, `examples/editor-demo-effects.js`) and the shortcuts panel.
  These are not generated from the table. The header of `effectTable.js` says so.

Voice-2 and grace targets are the planned extension point, not built. Note rows
act on `cursorNote` and beat rows on `beatAt`, and the cursor is always voice 1
and skips grace notes (`model/cursor.js`). Supporting voice 2 or grace notes
would need the cursor and a target chooser for each row. The row would say which
notes it reads and writes, and `effectCommand` and `effectState` would take that
target in place of `cursorNote` and `beatAt`. The effect files must stay at or
under 300 lines, as the other `src/editor/` files do.
