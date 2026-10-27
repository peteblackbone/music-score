// Structural guards for src/draw/passes.js (barrel) and src/draw/passes/*.js.
// Run via `node tests/run.js`, or directly: `node tests/structure.mjs`.
// The check functions take an in-memory { 'src/rel/path.js': text } map so the guards can be
// mutation-tested without touching src/.
import { pathToFileURL, fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const norm = (p) => p.split(path.sep).join('/');

export function loadSrc() {
  const files = {};
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (e.name.endsWith('.js')) files[rel] = fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
    }
  };
  walk('src');
  return files;
}

// Relative specifiers from `import ... from 'x'`, `import 'x'` and `export ... from 'x'` statements.
export function specifiers(text) {
  const out = [];
  const re = /^[ \t]*(?:import|export)\b(?:[^'";]*?\bfrom\s*|\s*)(['"])([^'"\n]+)\1/gm;
  let m;
  while ((m = re.exec(text))) out.push(m[2]);
  return out;
}
const relOnly = (text) => specifiers(text).filter((s) => s.startsWith('.'));
const resolveSpec = (from, spec) => path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));

const PASSES = 'src/draw/passes';
const BARREL_NAMES = ['flattenRuns', 'renderTiesAndSlurs', 'renderGraceSlurs', 'renderTabArticulations',
  'renderTechniqueLabelRuns', 'renderPlayingDirections', 'renderChordSymbolsAndDynamics', 'renderFermatas'];
const PASS_MODULES = ['curves', 'tabTechniques', 'techniqueLabels', 'playingDirections', 'chordsFermatas'];
const CALL_ORDER = ['renderTiesAndSlurs', 'renderGraceSlurs', 'renderTabArticulations', 'renderTechniqueLabelRuns',
  'renderPlayingDirections', 'renderChordSymbolsAndDynamics', 'renderFermatas'];

// Each check returns an array of problem strings (empty = pass).
export const checks = {
  'passes/ files are <= 300 lines': (f) => Object.entries(f)
    .filter(([p]) => p.startsWith(`${PASSES}/`))
    .filter(([, t]) => t.replace(/\n$/, '').split('\n').length > 300)
    .map(([p, t]) => `${p} has ${t.split('\n').length} lines`),

  'pass modules import only ./common.js and ./notationBeats.js from passes/': (f) => {
    const probs = [];
    for (const n of PASS_MODULES) {
      const p = `${PASSES}/${n}.js`;
      if (!(p in f)) { probs.push(`${p} missing`); continue; }
      for (const s of relOnly(f[p])) {
        if (resolveSpec(p, s).startsWith(`${PASSES}/`) && !['./common.js', './notationBeats.js'].includes(s)) probs.push(`${p} imports ${s}`);
      }
    }
    return probs;
  },

  'common.js imports nothing': (f) => (f[`${PASSES}/common.js`] === undefined ? ['common.js missing']
    : specifiers(f[`${PASSES}/common.js`]).map((s) => `common.js imports ${s}`)),

  'notationBeats.js imports only ./common.js from passes/': (f) => {
    const p = `${PASSES}/notationBeats.js`;
    if (!(p in f)) return [`${p} missing`];
    return relOnly(f[p]).filter((s) => resolveSpec(p, s).startsWith(`${PASSES}/`) && s !== './common.js').map((s) => `${p} imports ${s}`);
  },

  'src/ import graph is acyclic': (f) => {
    const color = {}; const probs = []; const stack = [];
    const dfs = (n) => {
      color[n] = 1; stack.push(n);
      for (const s of relOnly(f[n])) {
        const t = resolveSpec(n, s);
        if (!(t in f)) continue; // reported by the resolution check
        if (color[t] === 1) probs.push(`cycle: ${[...stack.slice(stack.indexOf(t)), t].join(' -> ')}`);
        else if (!color[t]) dfs(t);
      }
      stack.pop(); color[n] = 2;
    };
    for (const n of Object.keys(f)) if (!color[n]) dfs(n);
    return probs;
  },

  'relative imports end in .js and resolve with exact case': (f, exists = realExists) => {
    const probs = [];
    for (const [n, t] of Object.entries(f)) {
      for (const s of relOnly(t)) {
        if (!s.endsWith('.js')) { probs.push(`${n}: '${s}' lacks .js`); continue; }
        const t2 = resolveSpec(n, s);
        if (!exists(t2)) probs.push(`${n}: '${s}' does not resolve (exact case)`);
      }
    }
    return probs;
  },

  'MusicScoreRenderer.js calls the 7 passes in order': (f) => {
    const t = f['src/MusicScoreRenderer.js'];
    if (t === undefined) return ['MusicScoreRenderer.js missing'];
    const calls = [...t.matchAll(/^[ \t]*(render(?:TiesAndSlurs|GraceSlurs|TabArticulations|TechniqueLabelRuns|PlayingDirections|ChordSymbolsAndDynamics|Fermatas))\s*\(/gm)].map((m) => m[1]);
    return JSON.stringify(calls) === JSON.stringify(CALL_ORDER) ? [] : [`call order was ${calls.join(', ')}`];
  },
};

// Exact-case existence: compare each path segment with readdirSync names.
function realExists(rel) {
  let cur = root;
  for (const seg of rel.split('/')) {
    if (!fs.existsSync(cur) || !fs.readdirSync(cur).includes(seg)) return false;
    cur = path.join(cur, seg);
  }
  return fs.statSync(cur).isFile();
}

export async function barrelProblems() {
  const probs = [];
  const ns = await import(pathToFileURL(path.join(root, 'src/draw/passes.js')).href);
  const names = Object.keys(ns).sort();
  if (JSON.stringify(names) !== JSON.stringify([...BARREL_NAMES].sort())) probs.push(`barrel exports [${names}]`);
  for (const n of BARREL_NAMES) if (typeof ns[n] !== 'function') probs.push(`${n} is not a function`);
  return probs;
}

export async function summary() {
  let fail = 0;
  const files = loadSrc();
  const report = (name, probs) => {
    if (probs.length) { fail++; console.log(`FAIL structure: ${name}\n  ${probs.join('\n  ')}`); }
    else console.log(`PASS structure: ${name}`);
  };
  report('barrel exports exactly the 8 pass functions', await barrelProblems());
  for (const [name, fn] of Object.entries(checks)) report(name, fn(files));
  return fail;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const f = await summary();
  console.log(f ? `\n${f} FAILED` : '\nALL PASSED');
  process.exit(f ? 1 : 0);
}
