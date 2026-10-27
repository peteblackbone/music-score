// Characterization snapshot runner. Usage: node tests/run.js [--update]
// Renders example scores with a DOM shim and compares serialized SVG to tests/snapshots/*.svg.
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

register('./hooks.mjs', import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const update = process.argv.includes('--update');

const { makeContainer, serialize } = await import('./dom-shim.mjs');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const { MusicScoreRenderer } = await imp('src/MusicScoreRenderer.js');
const { exampleScore } = await imp('examples/example-score.js');
const { leadRiff } = await imp('examples/lead-riff.js');

const { articulationsScore } = await imp('examples/articulations-demo.js');

const { characterizationCases } = await imp('tests/fixtures/characterization.js');

const cases = [];
for (const [name, score] of [['example-score', exampleScore], ['lead-riff', leadRiff]]) {
  for (const width of [900, 600, 1400]) cases.push({ id: `${name}-w${width}`, score, width });
}
// articulations-demo snapshots were added after visual approval; only w900 and w600.
// Missing snapshots are written on first run; existing ones are only rewritten with --update.
for (const width of [900, 600]) cases.push({ id: `articulations-demo-w${width}`, score: articulationsScore, width });
// Characterization fixtures (tests/fixtures/characterization.js) -> char-<name>-w<width>.svg
for (const f of characterizationCases) cases.push({ id: `char-${f.name}-w${f.width}`, score: f.score, width: f.width, options: f.options });

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
console.log(fail ?`\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
