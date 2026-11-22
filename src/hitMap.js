/**
 * hitMap.js — plain-data addressing for a rendered score (2.0.0), built on
 * demand from the summary MusicScoreRenderer.render() keeps
 * (`renderer._hitSource`), so the SVG output and the layout model stay
 * exactly as they were. Pure functions, no DOM.
 *
 * HitMap, in SVG user units (the svg's width/viewBox units):
 *   { width, height,
 *     staves:   [{ sysIdx, ti, kind: 'notation'|'tab', y, lineBottom, x1, x2, stringSpacing?, stringCount? }],
 *     measures: [{ sysIdx, ti, measureIndex, x, contentX, endX, lastMeasureIndex? }],
 *     elements: [{ sysIdx, ti, measureIndex, voice: 1|2, beatIndex, x, width, isGrace, isRest }] }
 * - `y` is the staff's final translate (rounded like the drawn transform);
 *   the top line sits at y and the bottom line at y + lineBottom. TAB
 *   string n (1 = top) is at y + (n − 1) · stringSpacing.
 * - x values are the unrounded layout values: element x is the onset
 *   (notehead / fret column centre), `width` the layout width.
 * - `beatIndex` is the index in the raw `beats` (voice 1) or
 *   `voices[1].beats` (voice 2); graces and hidden rests keep theirs.
 * - A multi-measure rest run is one measure record with `lastMeasureIndex`.
 * - Tracks with no staff in a system have no records for it.
 */
import { r2 } from './draw/svgUtil.js';

/** The hit map of render summary `source` (see MusicScoreRenderer.render) drawn with `theme`. */
export function buildHitMap(source, theme) {
  const out = { width: source.width, height: source.height, staves: [], measures: [], elements: [] };
  source.layout.systems.forEach((sys, sysIdx) => {
    const seen = new Set();
    (source.staves[sysIdx] || []).forEach((st) => {
      const staff = { sysIdx, ti: st.ti, kind: st.kind, y: r2(st.y), lineBottom: st.lineBottom, x1: sys.startX, x2: sys.staffEndX };
      if (st.kind === 'tab') { staff.stringSpacing = theme.tabStaffLineSpacing; staff.stringCount = st.stringCount; }
      out.staves.push(staff);
      if (seen.has(st.ti)) return;
      seen.add(st.ti);
      for (const m of sys.tracks[st.ti].measures) {
        const rec = { sysIdx, ti: st.ti, measureIndex: m.measureIndex, x: m.x, contentX: m.contentX, endX: m.endX };
        if (m.multiRest) rec.lastMeasureIndex = m.multiRest.lastMi;
        out.measures.push(rec);
        const add = (voice) => (le) => out.elements.push({
          sysIdx, ti: st.ti, measureIndex: m.measureIndex, voice, beatIndex: le.index, x: le.x, width: le.width,
          isGrace: le.el.type === 'grace', isRest: le.el.type === 'rest',
        });
        m.elements.forEach(add(1));
        (m.elements2 || []).forEach(add(2));
      }
    });
  });
  return out;
}

/**
 * The beat at SVG point (px, py) of hit map `map`: `{ ti, measureIndex,
 * beatIndex, string? }` or null outside every staff.
 * - Staff: the nearest by vertical distance among those within its pad
 *   (lineBottom / 2 on notation, one string gap on TAB) vertically and
 *   horizontally.
 * - Measure: the one whose [x, endX) holds px, else the first / last.
 * - Beat: the nearest voice-1 non-grace element by x (ties: the lower
 *   index); an empty measure gives its element count (= beats.length).
 * - String (TAB only): the nearest string line, clamped.
 */
export function hitTestMap(map, px, py) {
  if (!map || !Number.isFinite(px) || !Number.isFinite(py)) return null;
  let staff = null;
  let best = Infinity;
  for (const st of map.staves) {
    const pad = st.kind === 'tab' ? st.stringSpacing : st.lineBottom / 2;
    const d = Math.max(0, st.y - py, py - (st.y + st.lineBottom));
    if (d > pad || px < st.x1 - pad || px > st.x2 + pad) continue;
    if (d < best) { best = d; staff = st; }
  }
  if (!staff) return null;
  const measures = map.measures.filter((m) => m.sysIdx === staff.sysIdx && m.ti === staff.ti);
  if (!measures.length) return null;
  const m = measures.find((r) => r.x <= px && px < r.endX) || (px < measures[0].x ? measures[0] : measures[measures.length - 1]);
  const own = map.elements.filter((e) => e.sysIdx === staff.sysIdx && e.ti === staff.ti && e.measureIndex === m.measureIndex && e.voice === 1);
  let beatIndex = own.length;
  let near = Infinity;
  for (const e of own) {
    if (e.isGrace) continue;
    const d = Math.abs(e.x - px);
    if (d < near || (d === near && e.beatIndex < beatIndex)) { near = d; beatIndex = e.beatIndex; }
  }
  const hit = { ti: staff.ti, measureIndex: m.measureIndex, beatIndex };
  if (staff.kind === 'tab') {
    hit.string = Math.min(staff.stringCount, Math.max(1, Math.round((py - staff.y) / staff.stringSpacing) + 1));
  }
  return hit;
}
