/**
 * layout/navigation.js — horizontal layout of volta brackets and navigation
 * marks (segno, coda, jump texts) from `score.navigation` (normalize.js).
 * Pure functions, no DOM; changes no measure position (vertical placement
 * happens while drawing, draw/navigation.js).
 *
 * Brackets are grouped score-wide by measure column: consecutive measures
 * with the same ending (endingKey) form one bracket; a measure without an
 * ending, a different ending or a repeat-start measure (any track) starts
 * over. A bracket is closed (right hook) when its `open` override says so,
 * else when any track's last bracket measure ends in a repeatEnd barline.
 * Brackets crossing a system break are split into one part per system;
 * only the first part has the left hook and label, only the last part the
 * right hook.
 *
 * Per system: `{ voltas: [VoltaPart], marks: [Mark] }` where
 * VoltaPart = `{ sysIdx, startMi, endMi, x1, x2, label | null, leftHook, rightHook, closed }`,
 * Mark = `{ kind: 'segno' | 'coda', mi, x }` (glyph left edge),
 * `{ kind: 'jump', mi, text, jumpKind, xEnd }` (text right edge),
 * `{ kind: 'repeatCount', mi, text: 'x3', xEnd }` (text right edge, at the
 * repeat-end measure's endX; a jump in the same measure ends
 * REPEAT_COUNT_GAP_SP before it) or `{ kind: 'section', mi, letter, text, x }`
 * (box left edge where a segno goes, pushed right to stay SECTION_GAP_SP
 * after the previous section of the system; drawn in its own tier).
 */
import { endingKey, endingLabel, jumpKind } from '../navigation.js';
import { glyphBox } from '../glyphMetrics.js';
import { estimateTextWidth } from '../textMetrics.js';

export const VOLTA_END_INSET_SP = 0.5;        // closing barline -> bracket end
export const VOLTA_SYSTEM_START_GAP_SP = 0.5; // contentStartX -> bracket start on a system's first measure
export const VOLTA_MIN_LENGTH_SP = 1.5;
export const MARK_GLYPH_SCALE = 0.75;         // segno / coda size relative to the music font
export const MARK_BARLINE_GAP_SP = 0.3;       // opening barline -> segno / coda
export const MARK_GAP_SP = 0.5;               // segno -> coda in the same measure
export const SECTION_SIZE_SP = 1.3;           // section letter / text (bold)
export const SECTION_PAD_SP = 0.3;            // box border -> boxed text
export const SECTION_STROKE_SP = 0.12;
export const SECTION_TEXT_GAP_SP = 0.5;       // box -> text after it
export const SECTION_GAP_SP = 0.5;            // previous section's right edge -> next section
export const REPEAT_COUNT_SIZE_SP = 1.1;
export const REPEAT_COUNT_GAP_SP = 0.5;       // jump text -> "x3" in the same measure

/**
 * Horizontal parts of a section marker `{ letter, text }`: the boxed text
 * (the letter, else the text), the text after the box (only with a
 * letter), the box width, the tail's offset from the box's left edge and
 * the total width. Shared by layout and drawing.
 */
export function sectionParts(section, theme) {
  const s = theme.staffLineSpacing;
  const size = SECTION_SIZE_SP * s;
  const boxed = section.letter ?? section.text;
  const tail = section.letter ? section.text : null;
  const boxW = estimateTextWidth(boxed, size, { bold: true }) + 2 * SECTION_PAD_SP * s;
  const tailDx = boxW + SECTION_TEXT_GAP_SP * s;
  const width = tail ? tailDx + estimateTextWidth(tail, size, { bold: true }) : boxW;
  return { boxed, tail, boxW, tailDx, width };
}

/** Left x of a system's measure `li` for brackets and marks (after the header / opening repeat on li 0). */
export function measureStartX(system, li, theme) {
  const m = system.tracks[0].measures[li];
  if (li > 0) return m.x;
  return m.startBarline ? m.startBarline.x : system.contentStartX + VOLTA_SYSTEM_START_GAP_SP * theme.staffLineSpacing;
}

/** Score-wide brackets: `[{ ending, startMi, endMi, open, closed }]`. */
export function voltaBrackets(score) {
  const nav = score.navigation || [];
  const tracks = score.tracks || [];
  const brackets = [];
  let cur = null;
  nav.forEach((col, mi) => {
    const e = col?.ending;
    if (!e) { cur = null; return; }
    const repeatStart = tracks.some((t) => t.measures[mi]?.repeatStart);
    if (cur && endingKey(cur.ending) === endingKey(e) && cur.endMi === mi - 1 && !repeatStart) {
      cur.endMi = mi;
      if (e.open != null) cur.open = e.open;
    } else {
      cur = { ending: e, startMi: mi, endMi: mi, open: e.open ?? null };
      brackets.push(cur);
    }
  });
  brackets.forEach((b) => {
    b.closed = b.open != null ? !b.open : tracks.some((t) => t.measures[b.endMi]?.barline === 'repeatEnd');
  });
  return brackets;
}

/** Per system `{ voltas, marks }` (see the module header). */
export function navigationLayout(systems, score, theme) {
  const s = theme.staffLineSpacing;
  const out = systems.map(() => ({ voltas: [], marks: [] }));
  const where = new Map(); // mi -> { sysIdx, li }
  systems.forEach((sys, sysIdx) => {
    if (!sys.tracks.length) return;
    // a multi-measure rest's later measures map onto its column (layout/multiRest.js)
    sys.measureIndices.forEach((mi, li) => {
      const lastMi = sys.tracks[0].measures[li].multiRest?.lastMi ?? mi;
      for (let k = mi; k <= lastMi; k++) where.set(k, { sysIdx, li });
    });
  });
  const measure = (sysIdx, li) => systems[sysIdx].tracks[0].measures[li];

  for (const b of voltaBrackets(score)) {
    const label = endingLabel(b.ending);
    for (let mi = b.startMi; mi <= b.endMi;) {
      const at = where.get(mi);
      if (!at) { mi++; continue; }
      const sys = systems[at.sysIdx];
      const lastMiInSys = sys.measureIndices[sys.measureIndices.length - 1];
      const partEnd = Math.min(b.endMi, lastMiInSys);
      const endsHere = partEnd === b.endMi;
      const x1 = at.li > 0 ? measure(at.sysIdx, at.li).x : measureStartX(sys, 0, theme);
      let x2 = endsHere ? measure(at.sysIdx, where.get(partEnd).li).endX - VOLTA_END_INSET_SP * s : sys.lastBarlineX;
      x2 = Math.max(x2, x1 + VOLTA_MIN_LENGTH_SP * s);
      const first = mi === b.startMi;
      out[at.sysIdx].voltas.push({
        sysIdx: at.sysIdx, startMi: mi, endMi: partEnd, x1, x2,
        label: first ? label : null, leftHook: first, rightHook: b.closed && endsHere, closed: b.closed,
      });
      mi = partEnd + 1;
    }
  }

  const segnoW = glyphBox('segno').width * s * MARK_GLYPH_SCALE;
  const lastSectionRight = systems.map(() => -Infinity);
  (score.navigation || []).forEach((col, mi) => {
    const at = where.get(mi);
    if (!col || !at) return;
    const sys = systems[at.sysIdx];
    const m = measure(at.sysIdx, at.li);
    const x = at.li > 0 ? m.x + MARK_BARLINE_GAP_SP * s : measureStartX(sys, 0, theme);
    const marks = out[at.sysIdx].marks;
    if (col.segno) marks.push({ kind: 'segno', mi, x });
    if (col.coda) marks.push({ kind: 'coda', mi, x: col.segno ? x + segnoW + MARK_GAP_SP * s : x });
    const countText = col.repeatCount ? `x${col.repeatCount}` : null;
    const jumpEnd = countText
      ? m.endX - estimateTextWidth(countText, REPEAT_COUNT_SIZE_SP * s) - REPEAT_COUNT_GAP_SP * s
      : m.endX;
    if (col.jump) marks.push({ kind: 'jump', mi, text: col.jump, jumpKind: jumpKind(col.jump), xEnd: jumpEnd });
    if (countText) marks.push({ kind: 'repeatCount', mi, text: countText, xEnd: m.endX });
    if (col.section) {
      const sx = Math.max(x, lastSectionRight[at.sysIdx] + SECTION_GAP_SP * s);
      marks.push({ kind: 'section', mi, letter: col.section.letter, text: col.section.text, x: sx });
      lastSectionRight[at.sysIdx] = sx + sectionParts(col.section, theme).width;
    }
  });
  return out;
}
