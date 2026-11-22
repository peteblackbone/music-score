/**
 * model/settings/score.js — the header and options of the score
 * (updateScore). The tempo operations (setTempo, tempoAt, checkTempo,
 * TEMPO_UNITS) live in tempo.js and are re-exported here.
 *
 * Operations are pure: `(score, cursor, ...args) → { score, cursor?,
 * announce } | { refused: { id } }`. They throw TypeError / RangeError
 * before building anything; a call that changes nothing returns the same
 * score object.
 */
import { object, checkKeys, text, flag, withField } from './validate.js';

export { TEMPO_UNITS, checkTempo, setTempo, tempoAt } from './tempo.js';

const LONG = ['instructions', 'copyright'];
const FLAGS = ['showTuningChart', 'multiMeasureRests'];
/** The fields updateScore accepts, with the words its announcement uses. */
export const SCORE_FIELDS = Object.freeze({
  title: 'Title', subtitle: 'Subtitle', artist: 'Artist', album: 'Album', composer: 'Composer', words: 'Words', music: 'Music',
  tempoText: 'Tempo text', tuningLabel: 'Tuning label', instructions: 'Instructions', copyright: 'Copyright',
  showTuningChart: 'Tuning chart', multiMeasureRests: 'Multi-measure rests',
});

/** The values `patch` writes (undefined = delete), every key checked first. */
function scoreValues(raw) {
  const patch = object(raw, 'Score settings');
  checkKeys(patch, Object.keys(SCORE_FIELDS), 'score');
  const out = {};
  for (const [k, v] of Object.entries(patch)) {
    const label = SCORE_FIELDS[k];
    if (FLAGS.includes(k)) out[k] = flag(v, label);
    else out[k] = text(v, { label, multiline: LONG.includes(k) });
  }
  return out;
}

/** updateScore(patch): header text and the two score flags (see the module header). */
export function updateScore(score, cursor, patch) {
  const values = scoreValues(patch);
  let out = score;
  const changed = [];
  for (const [k, v] of Object.entries(values)) {
    const next = withField(out, k, v);
    if (next !== out) changed.push(k);
    out = next;
  }
  const key = changed.length === 1 ? changed[0] : null;
  const mmrOn = changed.includes('multiMeasureRests') && out.multiMeasureRests === true;
  return { score: out, announce: { id: 'scoreUpdated', key, label: key && SCORE_FIELDS[key], on: !!key && out[key] !== undefined, mmrOn } };
}
