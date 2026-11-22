/**
 * model/settings/score.js — the header and options of the score
 * (updateScore) and the tempo mark at the cursor beat (setTempo, tempoAt).
 *
 * Operations are pure: `(score, cursor, ...args) → { score, cursor?,
 * announce } | { refused: { id } }`. They throw TypeError / RangeError
 * before building anything; a call that changes nothing returns the same
 * score object.
 */
import { tempoOf } from '../../../expression.js';
import { trackAt, measureAt, beatsOf, beatAt, isGrace, updateBeat } from '../access.js';
import { object, checkKeys, text, flag, withField } from './validate.js';

const LONG = ['instructions', 'copyright'];
const FLAGS = ['showTuningChart', 'multiMeasureRests'];
/** The fields updateScore accepts, with the words its announcement uses. */
export const SCORE_FIELDS = Object.freeze({
  title: 'Title', subtitle: 'Subtitle', artist: 'Artist', album: 'Album', composer: 'Composer', words: 'Words', music: 'Music',
  tempoText: 'Tempo text', tuningLabel: 'Tuning label', instructions: 'Instructions', copyright: 'Copyright',
  showTuningChart: 'Tuning chart', multiMeasureRests: 'Multi-measure rests',
});

/** The values `patch` writes (undefined = delete), every key checked first. */
function scoreValues(patch) {
  object(patch, 'Score settings');
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

const UNITS = ['whole', 'half', 'quarter', '8th', '16th', '32nd'];
const TEMPO_KEYS = ['bpm', 'unit', 'dots', 'text'];

/** The stored form of tempo `value`: null (remove), a bpm number (quarter beat), or `{ bpm, unit, dots?, text? }`. */
export function checkTempo(value) {
  if (value === null) return undefined;
  const obj = typeof value === 'number' ? { bpm: value } : object(value, 'Tempo');
  checkKeys(obj, TEMPO_KEYS, 'tempo');
  const { bpm } = obj;
  if (typeof bpm !== 'number') throw new TypeError('Tempo bpm must be a number');
  if (!(bpm > 0 && bpm <= 1000) || Math.round(bpm * 100) / 100 !== bpm) throw new RangeError('BPM must be above 0 and at most 1000, with up to 2 decimals');
  const unit = obj.unit ?? 'quarter';
  if (typeof unit !== 'string') throw new TypeError('Tempo unit must be a string');
  if (!UNITS.includes(unit)) throw new RangeError(`Tempo unit must be one of ${UNITS.join(', ')}`);
  const dots = obj.dots ?? 0;
  if (typeof dots !== 'number') throw new TypeError('Tempo dots must be a number');
  if (!Number.isInteger(dots) || dots < 0 || dots > 2) throw new RangeError('Tempo dots must be 0, 1 or 2');
  const words = obj.text == null ? undefined : text(obj.text, { label: 'Tempo text' });
  if (unit === 'quarter' && !dots && !words) return bpm;
  return { bpm, unit, ...(dots ? { dots } : {}), ...(words ? { text: words } : {}) };
}

/** Number of the beat at `cursor` counting non-grace beats from 1. */
const beatNumber = (score, cursor) => beatsOf(measureAt(trackAt(score, cursor.track), cursor.measure))
  .slice(0, cursor.beat + 1).filter((b) => !isGrace(b)).length;

/** setTempo(value): writes or removes `beat.tempo` on the voice-1 beat at the cursor; refused on the append slot. */
export function setTempo(score, cursor, value) {
  const stored = checkTempo(value);
  if (!beatAt(score, cursor)) return { refused: { id: 'noBeat' } };
  const out = updateBeat(score, cursor, (b) => withField(b, 'tempo', stored));
  const t = stored === undefined ? null : tempoOf(stored);
  return { score: out, announce: { id: 'tempoSet', tempo: t, measure: cursor.measure + 1, beat: beatNumber(score, cursor) } };
}

/**
 * The tempo in force at the cursor: the nearest `beat.tempo` the renderer
 * reads (tempoOf), scanning voice 1 backwards from the cursor beat (the
 * last beat on the append slot) into earlier measures of the same track.
 * `{ bpm, unit, dots, text, here }` (here: set on the cursor beat), or null.
 */
export function tempoAt(score, cursor) {
  const track = trackAt(score, cursor.track);
  for (let mi = cursor.measure; mi >= 0; mi--) {
    const beats = beatsOf(measureAt(track, mi));
    const from = mi === cursor.measure ? Math.min(cursor.beat, beats.length - 1) : beats.length - 1;
    for (let k = from; k >= 0; k--) {
      const t = tempoOf(beats[k].tempo);
      if (t) return { ...t, here: mi === cursor.measure && k === cursor.beat };
    }
  }
  return null;
}
