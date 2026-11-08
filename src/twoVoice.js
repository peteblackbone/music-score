/**
 * twoVoice.js — the one place that answers "is this two-voice?" and "which
 * voice?" for normalize, layout and drawing (ui.md "Two voices"):
 *
 * - isTwoVoiceBeats(v2): THE rule — a normalized voice 2 counts only when it
 *   has a beat that is not a hidden rest;
 * - isTwoVoiceMeasure(m): a normalized measure (`voice2Beats`) or a layout
 *   measure (`elements2`) that passed that rule;
 * - voiceOf(le): a layout element's (or collected beat's) voice, 0 in a
 *   single-voice measure, else 1 | 2;
 * - trackHasTwoVoices(trackRuns, track): whether any measure of `track` in
 *   the drawn runs has two voices (else the passes skip their voice-2 walk);
 * - tabMarkBeat(le, cat): the beat that supplies TAB mark category `cat` at
 *   a voice-1 element's column (layoutEl.tabMarks, layout/voices.js), else
 *   the element's own beat.
 *
 * Pure functions, no DOM.
 */
import { isHiddenRest } from './duration.js';

export const isTwoVoiceBeats = (v2) => Array.isArray(v2) && v2.some((b) => !isHiddenRest(b));
export const isTwoVoiceMeasure = (m) => !!(m && (m.voice2Beats || m.elements2));
export const voiceOf = (le) => le.voice || 0;
export const trackHasTwoVoices = (trackRuns, track) => trackRuns.some((r) => r.track === track && r.measures.some(isTwoVoiceMeasure));
export const tabMarkBeat = (le, cat) => le.tabMarks?.[cat] ?? le.el;
