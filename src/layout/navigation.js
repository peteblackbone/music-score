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
 * Mark = `{ kind: 'segno' | 'coda', mi, x }` (glyph left edge) or
 * `{ kind: 'jump', mi, text, jumpKind, xEnd }` (text right edge).
 */
import { endingKey, endingLabel, jumpKind } from '../navigation.js';
import { glyphBox } from '../glyphMetrics.js';

export const VOLTA_END_INSET_SP = 0.5;        // closing barline -> bracket end
export const VOLTA_SYSTEM_START_GAP_SP = 0.5; // contentStartX -> bracket start on a system's first measure
export const VOLTA_MIN_LENGTH_SP = 1.5;
export const MARK_GLYPH_SCALE = 0.75;         // segno / coda size relative to the music font
export const MARK_BARLINE_GAP_SP = 0.3;       // opening barline -> segno / coda
export const MARK_GAP_SP = 0.5;               // segno -> coda in the same measure

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
    sys.measureIndices.forEach((mi, li) => where.set(mi, { sysIdx, li }));
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
  (score.navigation || []).forEach((col, mi) => {
    const at = where.get(mi);
    if (!col || !at) return;
    const sys = systems[at.sysIdx];
    const m = measure(at.sysIdx, at.li);
    const x = at.li > 0 ? m.x + MARK_BARLINE_GAP_SP * s : measureStartX(sys, 0, theme);
    const marks = out[at.sysIdx].marks;
    if (col.segno) marks.push({ kind: 'segno', mi, x });
    if (col.coda) marks.push({ kind: 'coda', mi, x: col.segno ? x + segnoW + MARK_GAP_SP * s : x });
    if (col.jump) marks.push({ kind: 'jump', mi, text: col.jump, jumpKind: jumpKind(col.jump), xEnd: m.endX });
  });
  return out;
}
