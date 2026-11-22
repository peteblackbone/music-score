// Characterization snapshot runner. Usage: node tests/run.js [--update]
// Renders example scores with a DOM shim and compares serialized SVG to tests/snapshots/*.svg.
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

register('./hooks.mjs', import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const update = process.argv.includes('--update');

const { makeContainer, serialize } = await import('./dom-shim.mjs');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const { MusicScoreRenderer } = await imp('src/MusicScoreRenderer.js');
const { exampleScore } = await imp('examples/example-score.js');
const { cases } = await import('./cases.mjs');

const snapDir = path.join(here, 'snapshots');
fs.mkdirSync(snapDir, { recursive: true });
let fail = 0;
for (const c of cases) {
  // deep clone so a renderer that mutates its input can't affect other cases
  const score = JSON.parse(JSON.stringify(c.score));
  const box = makeContainer();
  new MusicScoreRenderer(box, score, { width: c.width, ...(c.options || {}) }).render();
  if (box.children.length !== 1) { console.log(`FAIL ${c.id}: expected 1 svg child`); fail++; continue; }
  const out = serialize(box.children[0]);
  const file = path.join(snapDir, `${c.id}.svg`);
  if (update || !fs.existsSync(file)) {
    fs.writeFileSync(file, out);
    console.log(`${update ? 'UPDATED' : 'CREATED'} ${c.id} (${out.length} bytes)`);
    continue;
  }
  const exp = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  if (exp === out) { console.log(`PASS ${c.id}`); continue; }
  fail++;
  const a = exp.split('\n'), b = out.split('\n');
  let i = 0; while (i < a.length && a[i] === b[i]) i++;
  console.log(`FAIL ${c.id}: first diff at line ${i + 1}\n  expected: ${a[i]}\n  actual:   ${b[i]}`);
  fs.writeFileSync(path.join(snapDir, `${c.id}.actual.svg.tmp`), out);
}
// Opt-out guard: with hammerPullSlurs:false every pre-1.3 render must match its recorded hash: the 1.2.0 baseline, plus the intended 1.3.1 changes (grace accidentals, release-arrow cap) re-recorded for the cases they touch.
{
  const hashes = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'pre-1.3-hashes.json'), 'utf8'));
  for (const c of cases) {
    const want = hashes[c.id];
    if (!want) continue;
    const box = makeContainer();
    const opts = { width: c.width, ...(c.options || {}), theme: { ...(c.options?.theme), hammerPullSlurs: false } };
    new MusicScoreRenderer(box, JSON.parse(JSON.stringify(c.score)), opts).render();
    const out = serialize(box.children[0]);
    if (crypto.createHash('sha256').update(out).digest('hex') === want) { console.log(`PASS optout-1.2.0 ${c.id}`); continue; }
    fail++;
    console.log(`FAIL optout-1.2.0 ${c.id}: differs from the 1.2.0 baseline plus intended 1.3.1 changes
  1.2.0 baseline: git show a825edc:tests/snapshots/${c.id}.svg`);
    fs.writeFileSync(path.join(snapDir, `${c.id}.optout.actual.svg.tmp`), out);
  }
}
// Determinism: render the same case twice in-process
{
  const r = () => { const b = makeContainer(); new MusicScoreRenderer(b, JSON.parse(JSON.stringify(exampleScore)), { width: 900 }).render(); return serialize(b.children[0]); };
  if (r() === r()) console.log('PASS determinism'); else { console.log('FAIL determinism'); fail++; }
}
// Targeted articulations/fermata assertions (tests/articulations.mjs)
{
  const { summary } = await import('./articulations.mjs');
  fail += summary();
}
// Unit-style checks (tests/units.mjs)
{
  const { summary } = await import('./units.mjs');
  fail += summary();
}
// Engraving / layout checks (tests/engraving.mjs)
{
  const { summary } = await import('./engraving.mjs');
  fail += summary();
}
// Structural guards for the passes split (tests/structure.mjs)
{
  const { summary } = await import('./structure.mjs');
  fail += await summary();
}
// 2.0.0 editor: pure model, keymap, announcements, geometry and demo helpers (tests/editor-model.mjs)
{
  const { summary } = await import('./editor-model.mjs');
  fail += summary();
}
// 2.0.0 editor: renderer hit map and the ScoreEditor controller under the DOM shim (tests/editor-dom.mjs)
{
  const { summary } = await import('./editor-dom.mjs');
  fail += await summary();
}
// 2.0.0 editor edge cases against the acceptance criteria: pure model level (tests/editor-edge.mjs)
{
  const { summary } = await import('./editor-edge.mjs');
  fail += summary();
}
// 2.0.0 editor edge cases against the acceptance criteria: controller level (tests/editor-edge-dom.mjs)
{
  const { summary } = await import('./editor-edge-dom.mjs');
  fail += await summary();
}
// 2.1.0 editor effects: effect table, effect commands, keymap letters (tests/editor-effects.mjs)
{
  const { summary } = await import('./editor-effects.mjs');
  fail += summary();
}
// 2.1.0 editor effects under the DOM shim: ScoreEditor, announcements, render check, demo group (tests/editor-effects-dom.mjs)
{
  const { summary } = await import('./editor-effects-dom.mjs');
  fail += await summary();
}
// 2.1.0 editor effects, edge cases against the criteria: ties, X slots, link suffix vs renderer, bends, tracks, undo, two voices (tests/editor-effects-edge.mjs)
{
  const { summary } = await import('./editor-effects-edge.mjs');
  fail += await summary();
}
// 2.2.0 editor settings: validators, presets, score / tempo / tuning / track / measure operations (tests/editor-settings.mjs)
{
  const { summary } = await import('./editor-settings.mjs');
  fail += summary();
}
// 2.2.0 editor settings under the DOM shim: public surface, controller path, lastMessage, aria-label, joined announcements (tests/editor-settings-dom.mjs)
{
  const { summary } = await import('./editor-settings-dom.mjs');
  fail += await summary();
}
// 2.2.0 editor settings, edge cases against the criteria: retune, hidden tracks, track operations and the cursor, column migration, addTrack render, equal-to-in-force, forms (tests/editor-settings-edge.mjs)
{
  const { summary } = await import('./editor-settings-edge.mjs');
  fail += summary();
}
// 2.2.0 editor settings, edge cases at controller level: undo by reference, read-only, size limit, lastMessage, events, live region, demo helpers (tests/editor-settings-edge-dom.mjs)
{
  const { summary } = await import('./editor-settings-edge-dom.mjs');
  fail += await summary();
}
console.log(fail ?`\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
