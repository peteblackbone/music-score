/**
 * model/durations.js — the editor's one rhythm and fill vocabulary: the
 * duration names it writes (shortest last), their spoken / displayed words,
 * and the measure-fill words. announce.js and the editor.html demo use
 * these; nothing else defines its own copy.
 */

/** Duration names, longest first (shorter = next index). */
export const DURATIONS = Object.freeze(['whole', 'half', 'quarter', '8th', '16th', '32nd', '64th']);

/** Words for each duration name. */
export const DURATION_WORDS = Object.freeze({ whole: 'whole', half: 'half', quarter: 'quarter', '8th': 'eighth', '16th': '16th', '32nd': '32nd', '64th': '64th' });

/** Prefix for 0–4 augmentation dots. */
export const DOT_WORDS = Object.freeze(['', 'dotted ', 'double-dotted ', 'triple-dotted ', 'quadruple-dotted ']);

/** e.g. 'dotted eighth, triplet'. */
export function durationWords(duration, dots = 0, triplet = false) {
  const words = Object.hasOwn(DURATION_WORDS, duration) ? DURATION_WORDS[duration] : String(duration);
  return `${DOT_WORDS[dots] ?? ''}${words}${triplet ? ', triplet' : ''}`;
}

/** Measure fill: `word` as spoken ('underfull'), `label` as shown in a status bar ('Under'). */
export const FILL_WORDS = Object.freeze({
  under: Object.freeze({ word: 'underfull', label: 'Under' }),
  full: Object.freeze({ word: 'full', label: 'Full' }),
  over: Object.freeze({ word: 'overfull', label: 'Over' }),
});
