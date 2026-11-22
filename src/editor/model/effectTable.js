/**
 * model/effectTable.js — the effect commands of 2.1 as data: one frozen row
 * per command (effects.js turns a row into a command). Adding an effect is
 * adding a row.
 *
 * Row: `{ name, key, shift, level: 'note' | 'beat', fields, steps, dir,
 * start?, classify, exclusive, onRest, creates, write?, suffix?, say, off,
 * added?, label, info? }`.
 * - `fields`: the keys the row owns; `steps`: the patches it cycles
 *   through (dir 1 forward, -1 backward; `start` = the step written from
 *   none, else the first, or the last when dir is -1).
 * - `classify(target)`: the target's current step index, or -1 for none
 *   and for values the row doesn't write (custom).
 * - `exclusive`: keys deleted when the result is on; `onRest`: a beat row
 *   that also works on rests; `creates`: X adds a dead note where there
 *   is none.
 * - `write(target, step, def)`: replaces the default write (articulations,
 *   whose steps are the entry names rather than patches).
 * - `suffix`: 'link' | 'tabArtic' | 'noNotation' (spoken when it applies).
 * - `say[step]` / `off` / `added`: spoken text; `label`: the undo label;
 *   `info(target)`: the words getCursorInfo().effects lists.
 *
 * Values are classified with the renderer's own canonicalizers, so a
 * truthy unknown value counts the way the renderer draws it. Pure, no DOM.
 */
import { bendOf, isLegatoSlide, slideInOf, slideOutOf } from '../../directions.js';
import { harmonicKind } from '../../harmonics.js';
import { vibratoOf } from '../../noteEffects.js';

/** Patches `{ [field]: v }` for each value of `list`. */
export const values = (field, list) => list.map((v) => ({ [field]: v }));
const lower = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '');
const flag = (field) => (t) => (t[field] ? 0 : -1);
const word = (field, w) => (t) => (t[field] ? [w] : []);

// ---- bend ----
const BENDS = ['full', '1/2', 'full release', 'prebend full', 'release'];
const BEND_WORDS = ['full', 'half', 'full and release', 'pre-bend full', 'release'];
const BEND_SAY = ['Bend full', 'Bend half', 'Bend full and release', 'Pre-bend full', 'Release'];
/** Step of a raw `note.bend` (bendOf): -1 when none, compound, held or another amount. */
export function bendStep(raw) {
  const b = bendOf(raw);
  if (!b || b.rebend || b.hold) return -1;
  const amount = b.amount == null ? null : lower(b.amount);
  if (b.type === 'release') return amount === null ? 4 : -1;
  if (b.type === 'prebend') return amount === 'full' && !b.release ? 3 : -1;
  if (amount === 'full') return b.release ? 2 : 0;
  return amount === '1/2' && !b.release ? 1 : -1;
}
const bendInfo = (t) => (t.bend ? [bendStep(t.bend) < 0 ? 'bend' : `bend ${BEND_WORDS[bendStep(t.bend)]}`] : []);

// ---- dynamics ----
/** The dynamics D and Shift+D step through, softest first. */
export const DYNAMIC_SCALE = Object.freeze(['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff']);
const dynamicStep = (t) => (typeof t.dynamic === 'string' ? DYNAMIC_SCALE.indexOf(t.dynamic.trim()) : -1);
const dynamicInfo = (t) => (typeof t.dynamic === 'string' && t.dynamic.trim() ? [t.dynamic.trim()] : []);

// ---- articulations ----
const articList = (t) => (Array.isArray(t.articulations) ? t.articulations : []);
/** Classify by the articulation group `[first, ...second]`: 1 when any of the second's names is there, 0 for the first, else -1. */
const articStep = (first, second) => (t) => {
  const list = articList(t);
  return second.some((n) => list.includes(n)) ? 1 : list.includes(first) ? 0 : -1;
};
/** Remove the group, append the step's entry, delete the key when the list is empty. */
const articWrite = (group) => (t, step, def) => {
  const list = articList(t).filter((a) => !group.includes(a));
  if (step >= 0) list.push(def.steps[step]);
  if (list.length) return { ...t, articulations: list };
  const { articulations, ...rest } = t;
  return rest;
};
const articInfo = (t) => [...new Set(articList(t).filter((a) => typeof a === 'string').map((a) => (a === 'heavyAccent' ? 'marcato' : a)))];

const row = (r) => Object.freeze({ shift: false, dir: 1, exclusive: [], onRest: false, creates: false, ...r });
const ACCENTS = ['accent', 'marcato', 'heavyAccent'];
const STACCATOS = ['staccato', 'staccatissimo'];

export const EFFECTS = Object.freeze([
  row({
    name: 'hammerPull', key: 'h', level: 'note', fields: ['hammerPull'], steps: values('hammerPull', [true]),
    classify: flag('hammerPull'), exclusive: ['slide'], suffix: 'link',
    say: ['Hammer-on/pull-off on'], off: 'Hammer-on/pull-off off', label: 'hammer-on/pull-off',
    info: (t) => (t.hammerPull ? [{ h: 'hammer-on', p: 'pull-off' }[lower(t.hammerPull)] ?? 'hammer/pull'] : []),
  }),
  row({
    name: 'slide', key: 's', level: 'note', fields: ['slide'], steps: values('slide', [true, 'legato']),
    classify: (t) => (isLegatoSlide(t.slide) ? 1 : t.slide === true ? 0 : -1), exclusive: ['hammerPull'], suffix: 'link',
    say: ['Slide', 'Legato slide'], off: 'Slide off', label: 'slide',
    info: (t) => (isLegatoSlide(t.slide) ? ['legato slide'] : t.slide ? ['slide'] : []),
  }),
  row({
    name: 'slideInOut', key: 's', shift: true, level: 'note', fields: ['slideIn', 'slideOut'],
    steps: [...values('slideIn', ['below', 'above']), ...values('slideOut', ['down', 'up'])],
    classify: (t) => {
      if (t.slideIn && t.slideOut) return -1;
      const i = ['below', 'above'].indexOf(slideInOf(t.slideIn));
      if (i >= 0) return i;
      const o = ['down', 'up'].indexOf(slideOutOf(t.slideOut));
      return o >= 0 ? o + 2 : -1;
    },
    say: ['Slide in from below', 'Slide in from above', 'Slide out down', 'Slide out up'], off: 'Slide in/out off', label: 'slide in/out',
    info: (t) => [...(slideInOf(t.slideIn) ? ['slide in'] : []), ...(slideOutOf(t.slideOut) ? ['slide out'] : [])],
  }),
  row({
    name: 'bend', key: 'b', level: 'note', fields: ['bend'], steps: values('bend', BENDS),
    classify: (t) => bendStep(t.bend), say: BEND_SAY, off: 'Bend off', label: 'bend', info: bendInfo,
  }),
  row({
    name: 'bendBack', key: 'b', shift: true, level: 'note', fields: ['bend'], steps: values('bend', BENDS), dir: -1,
    classify: (t) => bendStep(t.bend), say: BEND_SAY, off: 'Bend off', label: 'bend',
  }),
  row({
    name: 'vibrato', key: 'v', level: 'beat', fields: ['vibrato'], steps: values('vibrato', [true, 'wide']),
    classify: (t) => { const v = vibratoOf(t.vibrato); return v === 'wide' ? 1 : v ? 0 : -1; },
    say: ['Vibrato', 'Wide vibrato'], off: 'Vibrato off', label: 'vibrato',
    info: (t) => (vibratoOf(t.vibrato) === 'wide' ? ['wide vibrato'] : t.vibrato ? ['vibrato'] : []),
  }),
  row({
    name: 'palmMute', key: 'p', level: 'beat', fields: ['palmMute'], steps: values('palmMute', [true]), classify: flag('palmMute'),
    onRest: true, say: ['Palm mute on'], off: 'Palm mute off', label: 'palm mute', info: word('palmMute', 'palm mute'),
  }),
  row({
    name: 'deadNote', key: 'x', level: 'note', fields: ['mute'], steps: values('mute', [true]), classify: flag('mute'),
    exclusive: ['harmonic'], creates: true,
    say: ['Dead note on'], off: 'Dead note off', added: 'Dead note added', label: 'dead note', info: word('mute', 'dead'),
  }),
  row({
    name: 'ghostNote', key: 'g', level: 'note', fields: ['ghost'], steps: values('ghost', [true]), classify: flag('ghost'),
    say: ['Ghost note on'], off: 'Ghost note off', label: 'ghost note', info: word('ghost', 'ghost'),
  }),
  row({
    name: 'harmonic', key: 'n', level: 'note', fields: ['harmonic'], steps: values('harmonic', ['natural', 'pinch']),
    classify: (t) => ['natural', 'pinch'].indexOf(harmonicKind(t.harmonic)), exclusive: ['mute'],
    say: ['Natural harmonic', 'Pinch harmonic'], off: 'Harmonic off', label: 'harmonic',
    info: (t) => (t.harmonic ? [`${harmonicKind(t.harmonic)} harmonic`] : []),
  }),
  row({
    name: 'letRing', key: 'l', shift: true, level: 'beat', fields: ['letRing'], steps: values('letRing', [true]), classify: flag('letRing'),
    say: ['Let ring on'], off: 'Let ring off', label: 'let ring', info: word('letRing', 'let ring'),
  }),
  row({
    name: 'louder', key: 'd', level: 'beat', fields: ['dynamic'], steps: values('dynamic', DYNAMIC_SCALE), start: 4,
    classify: dynamicStep, onRest: true, suffix: 'noNotation',
    say: DYNAMIC_SCALE.map((d) => `Dynamic ${d}`), off: 'Dynamic off', label: 'dynamic', info: dynamicInfo,
  }),
  row({
    name: 'softer', key: 'd', shift: true, level: 'beat', fields: ['dynamic'], steps: values('dynamic', DYNAMIC_SCALE), dir: -1, start: 3,
    classify: dynamicStep, onRest: true, suffix: 'noNotation',
    say: DYNAMIC_SCALE.map((d) => `Dynamic ${d}`), off: 'Dynamic off', label: 'dynamic',
  }),
  row({
    name: 'accent', key: 'a', level: 'beat', fields: ['articulations'], steps: ['accent', 'marcato'],
    classify: articStep('accent', ['marcato', 'heavyAccent']), write: articWrite(ACCENTS), suffix: 'tabArtic',
    say: ['Accent', 'Marcato'], off: 'Accent off', label: 'accent', info: articInfo,
  }),
  row({
    name: 'staccato', key: 'a', shift: true, level: 'beat', fields: ['articulations'], steps: ['staccato', 'staccatissimo'],
    classify: articStep('staccato', ['staccatissimo']), write: articWrite(STACCATOS), suffix: 'tabArtic',
    say: ['Staccato', 'Staccatissimo'], off: 'Staccato off', label: 'staccato',
  }),
]);

/** Key ('h', 'Shift+s' …; letters lower case) → command name. */
export const EFFECT_KEYS = Object.freeze(Object.fromEntries(EFFECTS.map((d) => [`${d.shift ? 'Shift+' : ''}${d.key}`, d.name])));
/** Command name → row. */
export const EFFECT_BY_NAME = Object.freeze(Object.fromEntries(EFFECTS.map((d) => [d.name, d])));
