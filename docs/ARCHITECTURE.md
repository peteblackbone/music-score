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
   JSON-serializable data. What the caller does with it (POST to an API,
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
