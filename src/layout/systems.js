/**
 * layout/systems.js — everything about systems (lines of music) that is
 * decided horizontally (ui.md §2–§4):
 *
 * - per-system header (clef, key, time) widths, max over all staves;
 * - time signature only on system 1 and where it changes;
 * - mid-system key/time changes and courtesy signatures at the end of a
 *   system whose successor starts with a change;
 * - repeat-start barlines at the start of their measure;
 * - instrument-name indents (names themselves are drawn in draw/decor.js);
 * - greedy system breaking and justification (all systems except the last,
 *   which is justified only when at least 75% full); a lone measure too
 *   wide for a system is compressed to its collision minimums, and if
 *   still too wide it overflows (the SVG gets wider, `overflow` is set).
 *
 * All widths px. Pure functions, no DOM.
 */
import { glyphBox, glyphStringBox } from '../glyphMetrics.js';
import { Glyph, accidentalGlyph, timeSigDigits, clefGlyph } from '../glyphs.js';
import { estimateTextWidth } from '../textMetrics.js';

export const KEY_STEP_SP = 1.1;          // between key-signature accidentals
const HEADER_CLEF_SP = 1;                // system start -> clef
const HEADER_ITEM_GAP_SP = 1;            // clef -> key -> time
const HEADER_TO_NOTE_SP = 1.5;           // last header item -> first note (plus its left extent)
const MID_SIG_GAP_SP = 1;                // opening barline -> mid-system key/time
const COURTESY_GAP_SP = 0.75;            // last barline -> courtesy signature
const COURTESY_TAIL_SP = 0.5;            // courtesy signature -> staff end
export const REPEAT_START_WIDTH_SP = 1.8;       // thick 0.5 + 0.4 + thin + 0.4 + dots
export const REPEAT_END_START_WIDTH_SP = 3.4;   // dots + 0.4 + thin + 0.4 + thick 0.5 + 0.4 + thin + 0.4 + dots
const REPEAT_AFTER_HEADER_SP = 1;        // header -> repeat-start barline at a system start
const REPEAT_AFTER_BARLINE_SP = 0.6;     // a non-single closing barline -> repeat-start
const LAST_SYSTEM_JUSTIFY_RATIO = 0.75;
export const NAME_SIZE_SP = 1.2;          // instrument name font size
export const NAME_GAP_SP = 1;            // name -> system start (or bracket)
export const BRACKET_WIDTH_SP = 1;       // bracket (0.5 thick) + its 0.5 sp gap to the joining line

/** Width (sp) of a key signature `to`, or of the cancelling naturals when `to` is 0 (from `from`). */
export function keySignatureWidthSp(to, from = 0) {
  const count = to ? Math.abs(to) : Math.abs(from || 0);
  if (!count) return 0;
  const name = to > 0 ? 'sharp' : to < 0 ? 'flat' : 'natural';
  return (count - 1) * KEY_STEP_SP + glyphBox(accidentalGlyph(name)).width;
}

/** Width (sp) of a time signature (widest of numerator and denominator). */
export function timeSignatureWidthSp(ts) {
  return Math.max(glyphStringBox(timeSigDigits(ts.beats)).width, glyphStringBox(timeSigDigits(ts.beatType)).width);
}

const TAB_CLEF_LETTER_SPAN = 0.6;        // fallback T/A/B letters fill this share of the TAB staff height

/**
 * TAB clef for a staff of `stringCount` strings (ui.md §3): the SMuFL
 * glyph for 6 (U+E06D) and 4 (U+E06E) strings, scaled so its height is the
 * outer-string span minus one tab space and centred on the staff; other
 * string counts fall back to bold T/A/B letters stacked over the middle
 * 60% of the staff. Returns `{ glyph | null, fontSize, width }` (px).
 */
export function tabClefMetrics(stringCount, theme) {
  const s = theme.staffLineSpacing;
  const span = Math.max(1, stringCount - 1) * theme.tabStaffLineSpacing;
  const glyph = stringCount === 6 ? Glyph.tabClef6 : stringCount === 4 ? Glyph.tabClef4 : null;
  if (glyph) {
    const box = glyphBox(glyph);
    const target = Math.max(s, span - theme.tabStaffLineSpacing);
    const fontSize = (4 * target) / (box.top - box.bottom);
    return { glyph, fontSize, width: box.width * (fontSize / 4) };
  }
  const fontSize = Math.max(0.8 * s, ((TAB_CLEF_LETTER_SPAN * span) / 3) * 1.15);
  return { glyph: null, fontSize, width: estimateTextWidth('B', fontSize, { bold: true }) };
}

const notationTracks = (score) => score.tracks.filter((t) => t.showStandardNotation);
/** Tracks that show a time signature: notation staves, and the TAB staff of tab-only tracks. */
const timeSigTracks = (score) => score.tracks.filter((t) => t.showStandardNotation || t.showTablature);

/**
 * Header of a system starting at measure `mi`: x offsets from the
 * system-start x of clef, tab clef (centre), key and time, whether the time
 * signature is shown, and `width` = offset of the first measure's column
 * (its own lead padding then adds measurePaddingSp + left extent, so the
 * first note lands HEADER_TO_NOTE_SP after the last header item).
 */
export function headerLayout(mi, score, theme, isFirstSystem) {
  const s = theme.staffLineSpacing;
  const nTracks = notationTracks(score);
  let clefW = 0;
  nTracks.forEach((t) => { clefW = Math.max(clefW, glyphBox(clefGlyph(t.clef, t.octaveClef)).width); });
  score.tracks.forEach((t) => {
    if (t.showTablature) clefW = Math.max(clefW, tabClefMetrics(t.tuning.length, theme).width / s);
  });
  let keyW = 0;
  nTracks.forEach((t) => { keyW = Math.max(keyW, keySignatureWidthSp(t.measures[mi].keySignature)); });
  const showTime = isFirstSystem || score.tracks.some((t) => t.measures[mi].timeChanged);
  let timeW = 0;
  if (showTime) timeSigTracks(score).forEach((t) => { timeW = Math.max(timeW, timeSignatureWidthSp(t.measures[mi].timeSignature)); });

  const clefX = HEADER_CLEF_SP;
  let cursor = clefX + clefW;
  let keyX = cursor;
  if (keyW > 0) { keyX = cursor + HEADER_ITEM_GAP_SP; cursor = keyX + keyW; }
  let timeX = cursor;
  if (showTime && timeW > 0) { timeX = cursor + HEADER_ITEM_GAP_SP; cursor = timeX + timeW; }
  return {
    clefX: clefX * s,
    tabClefX: clefX * s,
    keyX: keyX * s,
    timeX: timeX * s,
    showTime: showTime && timeW > 0,
    itemsEnd: cursor * s,
    width: (cursor + Math.max(0, HEADER_TO_NOTE_SP - theme.measurePaddingSp)) * s,
  };
}

/**
 * Key/time change signature at measure `mi` (mid-system or courtesy):
 * `{ key: { to, from } | null, time: ts | null, keyW, timeW (px), width (px of the parts) }`,
 * or null when nothing changes. Widths are the max over notation staves.
 */
export function signatureChange(mi, score, theme) {
  const s = theme.staffLineSpacing;
  const nTracks = notationTracks(score);
  const tTracks = timeSigTracks(score);
  if (!tTracks.length) return null;
  const keyChanged = nTracks.some((t) => t.measures[mi].keyChanged);
  const timeChanged = score.tracks.some((t) => t.measures[mi].timeChanged);
  if (!keyChanged && !timeChanged) return null;
  let keyW = 0; let timeW = 0;
  if (keyChanged) nTracks.forEach((t) => { const m = t.measures[mi]; if (m.keyChanged) keyW = Math.max(keyW, keySignatureWidthSp(m.keySignature, m.prevKey)); });
  if (timeChanged) tTracks.forEach((t) => { timeW = Math.max(timeW, timeSignatureWidthSp(t.measures[mi].timeSignature)); });
  const both = keyW > 0 && timeW > 0;
  return {
    keyChanged, timeChanged,
    keyW: keyW * s, timeW: timeW * s,
    width: (keyW + (both ? HEADER_ITEM_GAP_SP : 0) + timeW) * s,
  };
}

/** Per-track signature to draw for a change at measure `mi` (or null). */
export function trackSignatureChange(track, mi) {
  const m = track.measures[mi];
  if (!m.keyChanged && !m.timeChanged) return null;
  return {
    key: m.keyChanged ? { to: m.keySignature, from: m.prevKey } : null,
    time: m.timeChanged ? m.timeSignature : null,
  };
}

/** Width (px) of a courtesy signature for a change at measure `mi`, incl. gaps; 0 if none. */
export function courtesyWidth(mi, score, theme) {
  const sig = mi < score.measureCount ? signatureChange(mi, score, theme) : null;
  if (!sig || sig.width === 0) return 0;
  return sig.width + (COURTESY_GAP_SP + COURTESY_TAIL_SP) * theme.staffLineSpacing;
}

/**
 * Opening area of measure `mi`, before its lead padding: repeat-start
 * barline and/or (mid-system only) key/time change. Positions are relative
 * to the measure's x (its opening barline, or the header width offset for
 * the first measure of a system). `header` = the system header when `mi`
 * is the system's first measure, else null.
 * Returns `{ repeatX, repeatType, mergedPrev, sig: { keyX, timeX } | null, width }`
 * (`repeatType`: 'repeatStart' | 'repeatEndStart' | null).
 */
export function openingLayout(mi, score, theme, header) {
  const s = theme.staffLineSpacing;
  const first = !!header;
  const repeat = score.tracks.some((t) => t.measures[mi].repeatStart);
  let cursor = 0;
  let repeatX = null;
  let mergedPrev = false;
  let repeatType = 'repeatStart';
  if (repeat) {
    if (first) {
      // REPEAT_AFTER_HEADER_SP after the last header item; the header width already has some slack.
      repeatX = Math.max(0, REPEAT_AFTER_HEADER_SP * s - (header.width - header.itemsEnd));
    } else {
      // A preceding single or double barline merges into the repeat-start
      // at the same x; a preceding repeat-end merges with it into one
      // combined end-start sign (ui.md §6).
      repeatType = mergedRepeatType(score, mi);
      mergedPrev = repeatType !== null;
      repeatX = mergedPrev ? 0 : REPEAT_AFTER_BARLINE_SP * s;
    }
    cursor = repeatX + (repeatType === 'repeatEndStart' ? REPEAT_END_START_WIDTH_SP : REPEAT_START_WIDTH_SP) * s;
  }
  let sig = null;
  if (!first) {
    const ch = signatureChange(mi, score, theme);
    if (ch && ch.width > 0) {
      const keyX = cursor + MID_SIG_GAP_SP * s;
      sig = { keyX, timeX: keyX + (ch.keyW > 0 ? ch.keyW + (ch.timeW > 0 ? HEADER_ITEM_GAP_SP * s : 0) : 0) };
      cursor = keyX + ch.width;
    }
  }
  return { repeatX, repeatType: repeat ? (repeatType || 'repeatStart') : null, mergedPrev, sig, width: cursor };
}

/**
 * The single sign that replaces measure `mi - 1`'s closing barline and
 * measure `mi`'s repeat-start (mid-system), when every track agrees:
 * 'repeatStart' after single/double barlines, 'repeatEndStart' after
 * repeat-ends; null when they can't merge (final, mixed types).
 */
function mergedRepeatType(score, mi) {
  if (mi === 0) return null;
  const prev = score.tracks.map((t) => t.measures[mi - 1].barline);
  if (prev.every((b) => b === 'single' || b === 'double')) return 'repeatStart';
  if (prev.every((b) => b === 'repeatEnd')) return 'repeatEndStart';
  return null;
}

/** Width of `openingLayout` (px). */
export function openingWidth(mi, score, theme, header) {
  return openingLayout(mi, score, theme, header).width;
}

/** Courtesy positions after the last barline at `endX` (absolute). */
export function courtesyLayout(mi, score, theme, endX) {
  const s = theme.staffLineSpacing;
  const ch = signatureChange(mi, score, theme);
  const keyX = endX + COURTESY_GAP_SP * s;
  return {
    keyX,
    timeX: keyX + (ch.keyW > 0 ? ch.keyW + (ch.timeW > 0 ? HEADER_ITEM_GAP_SP * s : 0) : 0),
    endX: keyX + ch.width + COURTESY_TAIL_SP * s,
  };
}

/**
 * Whether systems draw a bracket (ui.md §2): a track shows notation + TAB
 * and the system holds 2 or more instruments (tracks with a staff).
 */
export function systemHasBracket(score) {
  const shown = score.tracks.filter((t) => t.showStandardNotation || t.showTablature);
  return shown.length >= 2 && shown.some((t) => t.showStandardNotation && t.showTablature);
}

/**
 * Instrument-name indents (ui.md §2): system 1 = widest full name + 1 sp,
 * later systems = widest abbreviation + 1 sp, 0 when nothing is shown;
 * plus the bracket width when systems have a bracket.
 * Name per track: system 1 `name ?? label`; later systems `label`.
 */
export function systemIndents(score, theme) {
  const s = theme.staffLineSpacing;
  const size = NAME_SIZE_SP * s;
  const widest = (pick) => score.tracks.reduce((m, t) => {
    const str = pick(t);
    return str ? Math.max(m, estimateTextWidth(str, size)) : m;
  }, 0);
  const shown = (t) => t.showStandardNotation || t.showTablature;
  const first = widest((t) => (shown(t) ? t.name || t.label : null));
  const later = widest((t) => (shown(t) ? t.label : null));
  const gap = (NAME_GAP_SP + (systemHasBracket(score) ? BRACKET_WIDTH_SP : 0)) * s;
  return {
    first: first ? first + gap : 0,
    later: later ? later + gap : 0,
  };
}

/**
 * Greedy system breaking. `columns[mi]` from buildColumn. Returns
 * `[{ measureIndices, indent, header, opening[], courtesy }]` where each
 * measure fits with its own header and (if the next system starts with a
 * key/time change) the courtesy signature.
 */
export function breakSystems(columns, score, theme, width) {
  const s = theme.staffLineSpacing;
  const indents = systemIndents(score, theme);
  const usable = (sysIdx) => width - (theme.marginLeftSp + theme.marginRightSp) * s - (sysIdx === 0 ? indents.first : indents.later);
  const systems = [];
  let cur = null;
  const open = (mi) => {
    const sysIdx = systems.length;
    const header = headerLayout(mi, score, theme, sysIdx === 0);
    cur = {
      measureIndices: [mi],
      indent: sysIdx === 0 ? indents.first : indents.later,
      header,
      usable: usable(sysIdx),
      content: header.width + openingWidth(mi, score, theme, header) + columns[mi].naturalWidth + columns[mi].extraIfFirstInSystem,
    };
  };
  for (let mi = 0; mi < columns.length; mi++) {
    if (!cur) { open(mi); continue; }
    const add = openingWidth(mi, score, theme, null) + columns[mi].naturalWidth;
    const courtesyNext = courtesyWidth(mi + 1, score, theme);
    if (cur.content + add + courtesyNext <= cur.usable + 1e-6) {
      cur.measureIndices.push(mi);
      cur.content += add;
    } else {
      systems.push(cur);
      open(mi);
    }
  }
  if (cur) systems.push(cur);
  return systems;
}

/**
 * Gap widths (px) for every column of a system after justification.
 * `isLast` applies the 75% rule. Returns `{ gaps: number[][] (per column),
 * contentWidth, justified, overflow }` where contentWidth runs from the
 * system-start x to the staff end.
 */
export function justifySystem(sys, columns, score, theme, isLast) {
  const cols = sys.measureIndices.map((mi) => columns[mi]);
  const lastMi = sys.measureIndices[sys.measureIndices.length - 1];
  const courtesy = isLast ? 0 : courtesyWidth(lastMi + 1, score, theme);
  let fixed = sys.header.width + courtesy;
  sys.measureIndices.forEach((mi, li) => { fixed += openingWidth(mi, score, theme, li === 0 ? sys.header : null) + columns[mi].leadPad + (li === 0 ? columns[mi].extraIfFirstInSystem : 0); });
  const nat = cols.reduce((a, c) => a + c.gaps.reduce((b, g) => b + g.nat, 0), 0);
  const min = cols.reduce((a, c) => a + c.gaps.reduce((b, g) => b + g.min, 0), 0);
  const weight = cols.reduce((a, c) => a + c.gaps.reduce((b, g) => b + g.weight, 0), 0);
  const W = sys.usable;
  const natural = fixed + nat;

  if (natural > W) {
    // Only possible for a lone measure: compress towards the collision minimums.
    const compressed = fixed + min;
    if (compressed <= W && nat > min) {
      const f = (W - fixed - min) / (nat - min);
      return {
        gaps: cols.map((c) => c.gaps.map((g) => g.min + f * (g.nat - g.min))),
        contentWidth: W, justified: true, overflow: false,
      };
    }
    return { gaps: cols.map((c) => c.gaps.map((g) => g.min)), contentWidth: compressed, justified: false, overflow: compressed > W };
  }
  const justify = !isLast || natural >= LAST_SYSTEM_JUSTIFY_RATIO * W;
  if (!justify || weight <= 0) {
    return { gaps: cols.map((c) => c.gaps.map((g) => g.nat)), contentWidth: natural, justified: false, overflow: false };
  }
  const extra = W - natural;
  return {
    gaps: cols.map((c) => c.gaps.map((g) => g.nat + extra * (g.weight / weight))),
    contentWidth: W, justified: true, overflow: false,
  };
}
