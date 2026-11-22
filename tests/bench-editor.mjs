// Editor performance bench (2.0.0, requirements J1–J2). Outside the test gate: `node tests/bench-editor.mjs`.
// Synthetic scores of 32, 100 and 200 measures x 2 tracks at 8th-note density, rendered with the DOM shim.
// Reports the median of 7 runs for: a full render, a digit keystroke (synchronous re-render, i.e. keystroke to
// repaint in Node), a cursor-only move, and getHitMap(). Targets (J2): 100 measures <= 150 ms render in Node;
// cursor-only move <= 16 ms. The Chrome targets (100 ms at 100 measures, 250 ms at 200) are checked in the browser.
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

register('./hooks.mjs', import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const { makeContainer } = await import('./dom-shim.mjs');
const { makeClock } = await import('./editor-shim.mjs');
const { ScoreEditor } = await imp('src/editor/ScoreEditor.js');

const RUNS = 7;
const nt = (duration, string, fret) => ({ type: 'note', duration, notes: [{ string, fret }] });
const synthetic = (measures, tracks = 2) => ({ tracks: Array.from({ length: tracks }, (_, ti) => ({
  name: `Guitar ${ti + 1}`, showStandardNotation: true, showTablature: true, timeSignature: { beats: 4, beatType: 4 },
  measures: Array.from({ length: measures }, (_, mi) => ({ beats: Array.from({ length: 8 }, (_, k) => nt('8th', 1 + ((mi + k + ti) % 6), (mi * 3 + k) % 13)) })),
})) });
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const time = (fn) => { const t0 = performance.now(); fn(); return performance.now() - t0; };
const key = (k) => ({ key: k, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false });

const rows = [];
for (const n of [32, 100, 200]) {
  const score = synthetic(n);
  const clock = makeClock();
  clock.requestAnimationFrame = null; // synchronous renders
  clock.cancelAnimationFrame = null;
  const ed = new ScoreEditor(makeContainer(), score, { width: 1200, clock });
  ed.setCursor({ measure: Math.floor(n / 2), beat: 3, string: 2 });
  const render = []; const digit = []; const move = []; const hit = [];
  for (let i = 0; i < RUNS; i++) {
    render.push(time(() => ed.refresh()));
    digit.push(time(() => ed.handleKey(key(String(i % 10)))));
    clock.advance(1000); // end the two-digit buffer
    move.push(time(() => ed.handleKey(key(i % 2 ? 'ArrowLeft' : 'ArrowRight'))));
    hit.push(time(() => ed._view.renderer.getHitMap()));
  }
  rows.push({ measures: n, render: median(render), digit: median(digit), move: median(move), getHitMap: median(hit) });
  ed.destroy();
}
const f = (v) => `${v.toFixed(1)} ms`.padStart(10);
console.log('measures x2 |   render |    digit |     move | getHitMap');
for (const r of rows) console.log(`${String(r.measures).padStart(11)} |${f(r.render)}|${f(r.digit)}|${f(r.move)}|${f(r.getHitMap)}`);
const r100 = rows.find((r) => r.measures === 100);
console.log(`\nJ2 (Node): 100-measure render ${r100.render.toFixed(1)} ms (target <= 150): ${r100.render <= 150 ? 'OK' : 'OVER'}`);
console.log(`J2: cursor-only move max median ${Math.max(...rows.map((r) => r.move)).toFixed(2)} ms (target <= 16): ${rows.every((r) => r.move <= 16) ? 'OK' : 'OVER'}`);
