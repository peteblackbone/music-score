/**
 * geometry.js — where the overlay goes (ui.md §3–§4), as plain shape
 * descriptors `{ tag: 'rect' | 'line' | 'path', attrs }` in SVG user units. Pure:
 * overlay.js turns the descriptors into elements.
 *
 * Inputs: the hit map indexed by indexHitMap, the cursor summary
 * (model/cursor.js cursorInfo), the resolved style (style.js) and the
 * renderer theme. Paint order: bands, notation column, TAB column, string
 * box. The column width uses the beat's estimated ink (its widest fret
 * knock-out) rather than the layout spacing, so a long note's column does
 * not spill over its neighbours.
 */
import { fretLabelWidth } from '../textMetrics.js';

const r2 = (v) => Math.round(v * 100) / 100;
const key = (ti, mi) => `${ti}:${mi}`;

/** Lookups over hit map `map`: measure by (track, measure), voice-1 elements by (track, measure), staves by (system, track). */
export function indexHitMap(map) {
  const measures = new Map();
  const elements = new Map();
  const staves = new Map();
  if (!map) return { map, measures, elements, staves };
  for (const m of map.measures) {
    for (let mi = m.measureIndex; mi <= (m.lastMeasureIndex ?? m.measureIndex); mi++) measures.set(key(m.ti, mi), m);
  }
  for (const e of map.elements) {
    if (e.voice !== 1) continue;
    const k = key(e.ti, e.measureIndex);
    if (!elements.has(k)) elements.set(k, []);
    elements.get(k).push(e);
  }
  for (const st of map.staves) {
    const k = key(st.sysIdx, st.ti);
    if (!staves.has(k)) staves.set(k, []);
    staves.get(k).push(st);
  }
  return { map, measures, elements, staves };
}

/** Horizontal extent `[x0, x1]` of the cursor and whether it is the dashed slot. */
function cursorSpan(m, els, info, style, s, theme) {
  const inset = style.colInsetSp * s;
  if (!info.appendSlot) {
    const el = els.find((e) => e.beatIndex === info.beat);
    if (!el) return null;
    let ink = 0;
    for (const f of info.frets) ink = Math.max(ink, fretLabelWidth(String(f), theme));
    const w = Math.max(ink + style.colPadSp * s, style.colMinSp * s);
    return { x: el.x, x0: Math.max(el.x - w / 2, m.x + inset), x1: Math.min(el.x + w / 2, m.endX - inset), slot: false };
  }
  const mains = els.filter((e) => !e.isGrace);
  if (!mains.length) {
    const x0 = m.contentX;
    const x1 = Math.max(x0 + style.slotMinSp * s, Math.min(x0 + style.slotWidthSp * s, m.endX - inset));
    return { x: (x0 + x1) / 2, x0, x1, slot: true };
  }
  let lastX = -Infinity;
  for (const e of mains) lastX = Math.max(lastX, e.x);
  const w = Math.max(style.slotMinSp * s, Math.min(style.slotWidthSp * s, m.endX - lastX - style.slotGapSp * s));
  const x = (lastX + m.endX) / 2;
  return { x, x0: x - w / 2, x1: x + w / 2, slot: true };
}

const rect = (x, y, w, h, attrs) => ({ tag: 'rect', attrs: { x, y, width: Math.max(0, w), height: Math.max(0, h), ...attrs } });

/**
 * The cursor shapes for `info` (cursorInfo): a column on each staff of the
 * cursor track, plus the string box on TAB; dashed outlines on the append
 * slot / empty measure. Dimmed when `focused` is false.
 */
export function cursorShapes(index, info, style, theme, focused) {
  const s = theme.staffLineSpacing;
  const t = theme.tabStaffLineSpacing;
  const m = index.measures.get(key(info.track, info.measure));
  if (!m) return [];
  const span = cursorSpan(m, index.elements.get(key(info.track, m.measureIndex)) || [], info, style, s, theme);
  if (!span) return [];
  const op = focused ? style.focused : style.unfocused;
  const color = style.cursorColor;
  const colW = span.x1 - span.x0;
  const dash = style.slotDashSp.map((v) => r2(v * s)).join(' ');
  const colAttrs = (kind) => (span.slot
    ? { class: 'editor-slot', fill: 'none', stroke: color, 'stroke-opacity': op.slotStroke, 'stroke-width': style.colStrokeSp * s, 'stroke-dasharray': dash, rx: style.colRadiusSp * s }
    : { class: `editor-col editor-col-${kind}`, fill: color, 'fill-opacity': op.colFill, stroke: color, 'stroke-opacity': op.colStroke, 'stroke-width': style.colStrokeSp * s, rx: style.colRadiusSp * s });
  const out = [];
  for (const st of index.staves.get(key(m.sysIdx, info.track)) || []) {
    if (st.kind === 'notation') {
      const o = style.notationColOverhangSp * s;
      out.push(rect(span.x0, st.y - o, colW, style.notationStaffSp * s + 2 * o, colAttrs('notation')));
      continue;
    }
    const o = style.tabColOverhangSp * s;
    out.push(rect(span.x0, st.y - o, colW, st.lineBottom + 2 * o, colAttrs('tab')));
    const fretW = info.fret != null ? fretLabelWidth(String(info.fret), theme) + style.stringPadSp * s : 0;
    const w = Math.min(Math.max(fretW, style.stringMinSp * s), colW);
    const y = st.y + (info.string - 1) * t;
    out.push(rect(span.x - w / 2, y - t / 2, w, t, span.slot
      ? { class: 'editor-string', fill: 'none', stroke: color, 'stroke-opacity': op.slotStroke, 'stroke-width': style.stringStrokeSp * s, 'stroke-dasharray': dash }
      : { class: 'editor-string', fill: color, 'fill-opacity': op.stringFill, stroke: color, 'stroke-opacity': op.stringStroke, 'stroke-width': style.stringStrokeSp * s }));
  }
  return out;
}

/**
 * Fill bands for every measure that is over- or underfull (fills: the
 * model's fillTable; 'empty' and 'full' get none), one per measure, over
 * the track's staves of its system: overfull = tint + solid bar above,
 * underfull = a dashed line at the bar's height.
 */
export function fillShapes(index, fills, style, theme) {
  const s = theme.staffLineSpacing;
  const out = [];
  for (const m of index.map?.measures || []) {
    const f = fills[m.ti]?.[m.measureIndex];
    if (f !== 'over' && f !== 'under') continue;
    const staves = index.staves.get(key(m.sysIdx, m.ti));
    if (!staves?.length) continue;
    const top = staves[0];
    const bottom = staves[staves.length - 1];
    const barY = top.y - style.barOffsetSp * s;
    const w = m.endX - m.x;
    if (f === 'over') {
      const y0 = top.y - style.bandOverhangSp * s;
      const y1 = bottom.y + bottom.lineBottom + style.bandOverhangSp * s;
      out.push(rect(m.x, y0, w, y1 - y0, { class: 'editor-band-over', fill: style.overfullColor, 'fill-opacity': style.overTintOpacity }));
      out.push(rect(m.x, barY, w, style.barHeightSp * s, { class: 'editor-band-over', fill: style.overfullColor, opacity: style.barOpacity }));
    } else {
      const y = barY + (style.barHeightSp * s) / 2;
      out.push({ tag: 'line', attrs: {
        class: 'editor-band-under', x1: m.x, y1: y, x2: m.endX, y2: y, stroke: style.underfullColor, 'stroke-opacity': style.underOpacity,
        'stroke-width': style.underStrokePx, 'stroke-dasharray': style.underDashPx.join(' '),
      } });
    }
  }
  return out;
}

/** Half the selection extent of hit-map element `e`: max(width + pad, min) / 2. */
const selHalf = (e, style, s) => Math.max(e.width + style.selPadSp * s, style.selMinSp * s) / 2;

/** The x extent of one selection slice (`x0` null when a beats slice has no main beat drawn); null without a measure record. */
function slicePart(index, ti, sl, kind, style, s) {
  const m = index.measures.get(key(ti, sl.measure));
  if (!m) return null;
  if (kind === 'measures') return { m, x0: m.x, x1: m.endX };
  const els = (index.elements.get(key(ti, sl.measure)) || []).filter((e) => e.beatIndex >= sl.from && e.beatIndex < sl.to);
  let first = null;
  let last = null;
  for (const e of els) {
    if (e.isGrace) continue;
    if (!first || e.beatIndex < first.beatIndex) first = e;
    if (!last || e.beatIndex > last.beatIndex) last = e;
  }
  if (!first) return { m, x0: null, x1: null };
  let x0 = Infinity;
  for (const e of els) if (e.beatIndex <= first.beatIndex) x0 = Math.min(x0, e.x - selHalf(e, style, s));
  const inset = style.selInsetSp * s;
  return { m, x0: Math.max(x0, m.x + inset), x1: Math.min(last.x + selHalf(last, style, s), m.endX - inset) };
}

const pt = (...v) => v.map(r2).join(' ');
/** Closed tint path of a band open on the left and / or right; corners of radius r on closed ends only. */
function tintPath(x0, y0, x1, y1, r, openL, openR) {
  const start = openL ? `M${pt(x0, y0)}` : `M${pt(x0 + r, y0)}`;
  const right = openR ? `L${pt(x1, y0)} L${pt(x1, y1)}` : `L${pt(x1 - r, y0)} Q${pt(x1, y0, x1, y0 + r)} L${pt(x1, y1 - r)} Q${pt(x1, y1, x1 - r, y1)}`;
  const left = openL ? `L${pt(x0, y1)}` : `L${pt(x0 + r, y1)} Q${pt(x0, y1, x0, y1 - r)} L${pt(x0, y0 + r)} Q${pt(x0, y0, x0 + r, y0)}`;
  return `${start} ${right} ${left} Z`;
}
/** Outline path of the same band: top, bottom and the closed end only. */
function outlinePath(x0, y0, x1, y1, r, openL, openR) {
  if (openL && openR) return `M${pt(x0, y0)} L${pt(x1, y0)} M${pt(x0, y1)} L${pt(x1, y1)}`;
  if (openR) return `M${pt(x1, y0)} L${pt(x0 + r, y0)} Q${pt(x0, y0, x0, y0 + r)} L${pt(x0, y1 - r)} Q${pt(x0, y1, x0 + r, y1)} L${pt(x1, y1)}`;
  return `M${pt(x0, y0)} L${pt(x1 - r, y0)} Q${pt(x1, y0, x1, y0 + r)} L${pt(x1, y1 - r)} Q${pt(x1, y1, x1 - r, y1)} L${pt(x0, y1)}`;
}

/**
 * The selection shapes (ui-2.3 §2) for `sel` (`{ track, kind, slices }`
 * or null): per system segment, on every staff of the track, a tint
 * (`editor-sel`, no stroke) and an outline (`editor-sel-outline`, no
 * fill). Beats: from the first selected main beat (and its graces) to the
 * last one, straight across barlines and empty measures; measures: from
 * the first measure's x to the last one's end. A segment that continues on
 * another system runs to that system's edge and is open there (paths);
 * one closed at both ends is a pair of rects. Dimmed when `focused` is false.
 */
export function selectionShapes(index, sel, style, theme, focused) {
  if (!sel) return [];
  const s = theme.staffLineSpacing;
  const ti = sel.track;
  const parts = sel.slices.map((sl) => slicePart(index, ti, sl, sel.kind, style, s)).filter(Boolean);
  while (parts.length && parts[0].x0 == null) parts.shift();
  while (parts.length && parts[parts.length - 1].x0 == null) parts.pop();
  if (!parts.length) return [];
  const segs = [];
  for (const p of parts) {
    const seg = segs[segs.length - 1];
    if (seg && seg.sys === p.m.sysIdx) seg.parts.push(p);
    else segs.push({ sys: p.m.sysIdx, parts: [p] });
  }
  const ext = new Map();
  for (const m of index.map?.measures || []) {
    if (m.ti !== ti) continue;
    const e = ext.get(m.sysIdx);
    ext.set(m.sysIdx, e ? { x0: Math.min(e.x0, m.x), x1: Math.max(e.x1, m.endX) } : { x0: m.x, x1: m.endX });
  }
  const op = focused ? style.focused : style.unfocused;
  const color = style.selectionColor;
  const r = style.selRadiusSp * s;
  const tint = { class: 'editor-sel', fill: color, 'fill-opacity': op.selFill };
  const line = { class: 'editor-sel-outline', fill: 'none', stroke: color, 'stroke-opacity': op.selStroke, 'stroke-width': style.selStrokeSp * s };
  const out = [];
  segs.forEach((seg, i) => {
    const openL = i > 0;
    const openR = i < segs.length - 1;
    const x0 = openL ? ext.get(seg.sys).x0 : seg.parts[0].x0;
    const x1 = openR ? ext.get(seg.sys).x1 : seg.parts[seg.parts.length - 1].x1;
    for (const st of index.staves.get(key(seg.sys, ti)) || []) {
      const notation = st.kind === 'notation';
      const o = (notation ? style.notationColOverhangSp : style.tabColOverhangSp) * s;
      const y0 = st.y - o;
      const y1 = st.y + (notation ? style.notationStaffSp * s : st.lineBottom) + o;
      if (!openL && !openR) {
        out.push(rect(x0, y0, x1 - x0, y1 - y0, { ...tint, rx: r }), rect(x0, y0, x1 - x0, y1 - y0, { ...line, rx: r }));
      } else {
        out.push({ tag: 'path', attrs: { ...tint, d: tintPath(x0, y0, x1, y1, r, openL, openR) } });
        out.push({ tag: 'path', attrs: { ...line, d: outlinePath(x0, y0, x1, y1, r, openL, openR) } });
      }
    }
  });
  return out;
}
