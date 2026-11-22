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

const EDITOR = 'src/editor';
// Pure editor modules: no DOM tokens (the controller lives in view.js, overlay.js and ScoreEditor.js).
const isPureEditor = (n) => n.startsWith(`${EDITOR}/model/`) || ['settings.js', 'keymap.js', 'announce.js', 'geometry.js', 'style.js', 'options.js', 'emitter.js'].some((b) => n === `${EDITOR}/${b}`);
const DOM_TOKENS = /\b(document|window|requestAnimationFrame|addEventListener)\b/g;
// Renderer modules any editor file may import, and the ones only named editor files may import.
// 2.1: the effect canonicalizers (pure, DOM-free) are shared rather than copied, so the editor classifies values as the renderer draws them.
const EDITOR_SHARED = ['src/sanitize.js', 'src/duration.js', 'src/rational.js', 'src/directions.js', 'src/harmonics.js', 'src/noteEffects.js',
  // 2.2: clef names, navigation / score text canonicalizers and tempoOf, shared so settings validate values as the renderer reads them.
  'src/clef.js', 'src/navigation.js', 'src/scoreText.js', 'src/expression.js'];
// Check names used both by the checks and by their mutation cases.
const ALLOWLIST_CHECK = 'editor imports from outside src/editor/ follow the allowlist (model: sanitize, duration, rational, directions, harmonics, noteEffects, clef, navigation, scoreText, expression only)';
const DOM_FREE_CHECK = 'editor model, keymap, announce, geometry and style are DOM-free';
const EDITOR_ALLOWED = {
  'src/MusicScoreRenderer.js': [`${EDITOR}/view.js`, `${EDITOR}/ScoreEditor.js`],
  'src/hitMap.js': [`${EDITOR}/view.js`, `${EDITOR}/geometry.js`],
  'src/draw/svgUtil.js': [`${EDITOR}/overlay.js`],
  'src/textMetrics.js': [`${EDITOR}/geometry.js`],
};

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

  'draw/noteMarks.js does not import draw/notation.js': (f) => {
    const p = 'src/draw/noteMarks.js';
    if (!(p in f)) return [`${p} missing`];
    return relOnly(f[p]).filter((s) => resolveSpec(p, s) === 'src/draw/notation.js').map((s) => `${p} imports ${s}`);
  },

  // ---- 2.0.0 editor (src/editor/) ----
  'nothing in src/ outside src/editor/ imports src/editor/': (f) => {
    const probs = [];
    for (const [n, t] of Object.entries(f)) {
      if (n.startsWith(`${EDITOR}/`)) continue;
      for (const s of relOnly(t)) if (resolveSpec(n, s).startsWith(`${EDITOR}/`)) probs.push(`${n} imports ${s}`);
    }
    return probs;
  },

  [DOM_FREE_CHECK]: (f) => Object.entries(f)
    .filter(([n]) => isPureEditor(n))
    .flatMap(([n, t]) => [...new Set([...t.matchAll(DOM_TOKENS)].map((m) => m[1]))].map((tok) => `${n} uses ${tok}`)),

  [ALLOWLIST_CHECK]: (f) => {
    const probs = [];
    for (const [n, t] of Object.entries(f)) {
      if (!n.startsWith(`${EDITOR}/`)) continue;
      for (const s of relOnly(t)) {
        const target = resolveSpec(n, s);
        if (target.startsWith(`${EDITOR}/`) || EDITOR_SHARED.includes(target)) continue;
        if (n.startsWith(`${EDITOR}/model/`) || !(EDITOR_ALLOWED[target] || []).includes(n)) probs.push(`${n} imports ${s}`);
      }
    }
    return probs;
  },

  'renderer modules shared with the editor, and everything they import, are DOM-free': (f) => {
    const probs = [];
    const seen = new Set();
    const visit = (n) => {
      if (seen.has(n) || !(n in f)) return;
      seen.add(n);
      for (const tok of new Set([...f[n].matchAll(DOM_TOKENS)].map((m) => m[1]))) probs.push(`${n} uses ${tok}`);
      for (const s of relOnly(f[n])) visit(resolveSpec(n, s));
    };
    EDITOR_SHARED.forEach(visit);
    return probs;
  },

  'src/editor/ files are <= 300 lines': (f) => Object.entries(f)
    .filter(([p]) => p.startsWith(`${EDITOR}/`))
    .filter(([, t]) => t.replace(/\n$/, '').split('\n').length > 300)
    .map(([p, t]) => `${p} has ${t.split('\n').length} lines`),

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

// draw/notation.js export names recorded before the 1.5 move of the beat marks into draw/noteMarks.js
// (notation.js re-exports the moved names, so callers are unchanged).
const NOTATION_EXPORTS = ['BEAM_LEVEL_GAP_SP', 'BEAM_STUB_SP', 'TUPLET_LABEL_SIZE_SP', 'beamShape', 'beamStemCap',
  'chordSymbolFontSize', 'curveBow', 'curveOuterPoints', 'dynamicFontSizePx', 'elementBottom', 'elementTop',
  'normalizeArticulations', 'renderArticulations', 'renderBeams', 'renderChordSymbol', 'renderCurve', 'renderDynamic',
  'renderFermata', 'renderNotationElement', 'renderNoteSlide', 'renderPickStroke', 'renderTremolo',
  'renderTupletBracket', 'renderVibrato', 'renderWholeMeasureRest', 'stemGeometry', 'tupletBracket', 'tupletLabel'];

export async function notationExportProblems(extra = []) {
  const ns = await import(pathToFileURL(path.join(root, 'src/draw/notation.js')).href);
  const names = Object.keys(ns).sort();
  const want = [...NOTATION_EXPORTS, ...extra].sort();
  return JSON.stringify(names) === JSON.stringify(want) ? [] : [`notation.js exports [${names}]`];
}

// Mutation tests for the editor guards: each mutated copy of the sources must make its check fail.
export function mutationProblems(files) {
  const imp = (spec) => `import { x } from '${spec}';\n`;
  const cases = [
    ['renderer module importing src/editor/ is caught', 'nothing in src/ outside src/editor/ imports src/editor/',
      { 'src/theme.js': imp('./editor/style.js') + (files['src/theme.js'] || '') }],
    ['DOM token in a model file is caught', DOM_FREE_CHECK,
      { [`${EDITOR}/model/zz.js`]: 'export const w = () => window.innerWidth;\n' }],
    ['addEventListener in keymap.js is caught', DOM_FREE_CHECK,
      { [`${EDITOR}/keymap.js`]: 'el.addEventListener("x", f);\n' }],
    ['model importing layout is caught', ALLOWLIST_CHECK,
      { [`${EDITOR}/model/zz.js`]: imp('../../layout/index.js') }],
    ['model importing hitMap is caught', ALLOWLIST_CHECK,
      { [`${EDITOR}/model/zz.js`]: imp('../../hitMap.js') }],
    ['model importing draw/tab.js is caught', ALLOWLIST_CHECK,
      { [`${EDITOR}/model/zz.js`]: imp('../../draw/tab.js') }],
    ['model importing layout/navigation.js (not the shared src/navigation.js) is caught', ALLOWLIST_CHECK,
      { [`${EDITOR}/model/settings/zz.js`]: imp('../../../layout/navigation.js') }],
    ['a shared module importing a DOM module is caught', 'renderer modules shared with the editor, and everything they import, are DOM-free',
      { 'src/pitch.js': imp('./font.js') + (files['src/pitch.js'] || '') }],
    ['DOM token in settings.js is caught', DOM_FREE_CHECK,
      { [`${EDITOR}/settings.js`]: 'export const d = () => document.title;\n' }],
    ['overlay importing MusicScoreRenderer is caught', ALLOWLIST_CHECK,
      { [`${EDITOR}/overlay.js`]: imp('../MusicScoreRenderer.js') }],
    ['geometry importing svgUtil is caught', ALLOWLIST_CHECK,
      { [`${EDITOR}/geometry.js`]: imp('../draw/svgUtil.js') }],
    ['301-line editor file is caught', 'src/editor/ files are <= 300 lines',
      { [`${EDITOR}/zz.js`]: 'x\n'.repeat(301) }],
  ];
  return cases.map(([name, check, over]) => [name, checks[check]({ ...files, ...over }).length ? [] : [`${check} did not fail`]]);
}

export async function summary() {
  let fail = 0;
  const files = loadSrc();
  const report = (name, probs) => {
    if (probs.length) { fail++; console.log(`FAIL structure: ${name}\n  ${probs.join('\n  ')}`); }
    else console.log(`PASS structure: ${name}`);
  };
  report('barrel exports exactly the 8 pass functions', await barrelProblems());
  report('notation.js exports the pre-1.5 names plus fermataGlyph', await notationExportProblems(['fermataGlyph']));
  for (const [name, fn] of Object.entries(checks)) report(name, fn(files));
  for (const [name, probs] of mutationProblems(files)) report(`mutation: ${name}`, probs);
  return fail;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const f = await summary();
  console.log(f ? `\n${f} FAILED` : '\nALL PASSED');
  process.exit(f ? 1 : 0);
}
