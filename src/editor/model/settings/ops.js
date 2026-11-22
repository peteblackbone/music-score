/**
 * model/settings/ops.js — the settings registry: the seven model-changing
 * settings operations with their undo labels. The controller
 * (src/editor/settings.js) runs them; they do not go through COMMANDS.
 */
import { updateScore, setTempo } from './score.js';
import { updateTrack } from './track.js';
import { addTrack, removeTrack, moveTrack } from './tracks.js';
import { updateMeasure } from './measureSettings.js';

export const SETTINGS = Object.freeze({
  updateScore: Object.freeze({ fn: updateScore, label: 'score settings' }),
  updateTrack: Object.freeze({ fn: updateTrack, label: 'track settings' }),
  addTrack: Object.freeze({ fn: addTrack, label: 'add track' }),
  removeTrack: Object.freeze({ fn: removeTrack, label: 'remove track' }),
  moveTrack: Object.freeze({ fn: moveTrack, label: 'move track' }),
  updateMeasure: Object.freeze({ fn: updateMeasure, label: 'measure settings' }),
  setTempo: Object.freeze({ fn: setTempo, label: 'tempo' }),
});
