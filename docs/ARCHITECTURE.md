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

## Drawing order of the score-wide marks (1.10.0)

`MusicScoreRenderer.render()` draws every system first, then runs the
score-wide marks. The seven numbered passes live in the `draw/passes.js`
barrel and must keep their order. The other calls sit between them: they are
not passes, so they stay out of `passes/`, which keeps each pass small.
`tests/structure.mjs` checks the order and that the barrel exports stay as
they are.

1. Passes 1 to 5 (ties and slurs, grace slurs, TAB articulations, technique
   labels, playing directions).
2. `renderFadeWah` (`draw/expressionMarks.js`): fade and wah marks above the
   top staff. Their boxes go into `run.aboveBoxes`.
3. `ottavaSegments` (`draw/ottava.js`, layout only), then `renderOttavaAlta`:
   the 8va and 15ma brackets above the notation staff. Their boxes also go
   into `run.aboveBoxes`.
4. Pass 6 (`renderChordSymbolsAndDynamics`): chord symbols and diagrams, then
   the dynamics line from `draw/dynamicsLine.js` (voice 1 and voice 2
   dynamics, and hairpins). Pass 6 measures the staff's ink first, so chord
   symbols rise above the marks of step 2 and 3.
5. `renderOttavaBassa`: the 8vb and 15mb brackets, below the dynamics line.
6. Pass 7 (`renderFermatas`): fermatas clear the chord boxes and
   `run.aboveBoxes`. The boxes reach pass 7 through `collectBeats` in
   `passes/notationBeats.js`.
7. Beat text (`draw/beatText.js`), then the navigation marks per system
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
