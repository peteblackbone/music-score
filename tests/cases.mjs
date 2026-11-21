// The 77 snapshot cases, shared by tests/run.js (SVG snapshots) and tests/units.mjs (pre-1.4 model hashes).
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

register('./hooks.mjs', import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const { exampleScore } = await imp('examples/example-score.js');
const { leadRiff } = await imp('examples/lead-riff.js');
const { leadSoloF } = await imp('examples/lead-solo-f.js');
const { articulationsScore } = await imp('examples/articulations-demo.js');
const { characterizationCases } = await imp('tests/fixtures/characterization.js');

export const cases = [];
for (const [name, score] of [['example-score', exampleScore], ['lead-riff', leadRiff], ['lead-solo-f', leadSoloF]]) {
  for (const width of [900, 600, 1400]) cases.push({ id: `${name}-w${width}`, score, width });
}
// articulations-demo snapshots were added after visual approval; only w900 and w600.
for (const width of [900, 600]) cases.push({ id: `articulations-demo-w${width}`, score: articulationsScore, width });
// Characterization fixtures (tests/fixtures/characterization.js) -> char-<name>-w<width>.svg
for (const f of characterizationCases) cases.push({ id: `char-${f.name}-w${f.width}`, score: f.score, width: f.width, options: f.options });
