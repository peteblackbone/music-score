/**
 * selectionShapes.js — the selection overlay (ui-2.3 §2, 2.3.2 column band)
 * as plain shape descriptors `{ tag: 'rect' | 'path', attrs }` in SVG user
 * units, from the hit map indexed by geometry.js indexHitMap, the resolved
 * style (style.js) and the renderer theme. Pure: overlay.js turns the
 * descriptors into elements; geometry.js re-exports selectionShapes.
 */

const r2 = (v) => Math.round(v * 100) / 100;
const key = (ti, mi) => `${ti}:${mi}`;
const rect = (x, y, w, h, attrs) => ({ tag: 'rect', attrs: { x, y, width: Math.max(0, w), height: Math.max(0, h), ...attrs } });

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

/** The x extent `{ x0, x1 }` of track `ti`'s measures per system (Map by sysIdx). */
function systemExtents(index, ti) {
  const ext = new Map();
  for (const m of index.map?.measures || []) {
    if (m.ti !== ti) continue;
    const e = ext.get(m.sysIdx);
    ext.set(m.sysIdx, e ? { x0: Math.min(e.x0, m.x), x1: Math.max(e.x1, m.endX) } : { x0: m.x, x1: m.endX });
  }
  return ext;
}

/** The selection's vertical extent `[y0, y1]` on staff `st`: the staff plus its overhang. */
function staffSpan(st, style, s) {
  const notation = st.kind === 'notation';
  const o = (notation ? style.notationColOverhangSp : style.tabColOverhangSp) * s;
  return [st.y - o, st.y + (notation ? style.notationStaffSp * s : st.lineBottom) + o];
}

/** The tint and outline attributes (`cls`: a class added to both) and the corner radius. */
function bandStyle(style, s, focused, cls = '') {
  const op = focused ? style.focused : style.unfocused;
  const color = style.selectionColor;
  return {
    r: style.selRadiusSp * s,
    tint: { class: `editor-sel${cls}`, fill: color, 'fill-opacity': op.selFill },
    line: { class: `editor-sel-outline${cls}`, fill: 'none', stroke: color, 'stroke-opacity': op.selStroke, 'stroke-width': style.selStrokeSp * s },
  };
}

/** Push one band's tint and outline onto `out`: a pair of rects when both ends are closed, else paths open at the open ends. */
function pushBand(out, x0, y0, x1, y1, openL, openR, { r, tint, line }) {
  if (!openL && !openR) {
    out.push(rect(x0, y0, x1 - x0, y1 - y0, { ...tint, rx: r }), rect(x0, y0, x1 - x0, y1 - y0, { ...line, rx: r }));
    return;
  }
  out.push({ tag: 'path', attrs: { ...tint, d: tintPath(x0, y0, x1, y1, r, openL, openR) } });
  out.push({ tag: 'path', attrs: { ...line, d: outlinePath(x0, y0, x1, y1, r, openL, openR) } });
}

/**
 * The 2.3.2 column band for `sel` (`{ tracks, measures }`): per system
 * segment of measures a..b (x from the top track's measures), one tint and
 * one outline (class `editor-sel-columns` added) from the top of the first
 * selected track's top staff to the bottom of the last one's bottom staff,
 * open at system breaks. Hidden tracks have no staves, so take no space.
 */
function columnShapes(index, sel, style, theme, focused) {
  const s = theme.staffLineSpacing;
  const top = sel.tracks[0];
  const bottom = sel.tracks[sel.tracks.length - 1];
  const segs = [];
  for (let mi = sel.measures[0]; mi <= sel.measures[1]; mi++) {
    const m = index.measures.get(key(top, mi));
    if (!m) continue;
    const seg = segs[segs.length - 1];
    if (seg && seg.sys === m.sysIdx) seg.x1 = m.endX;
    else segs.push({ sys: m.sysIdx, x0: m.x, x1: m.endX });
  }
  const band = bandStyle(style, s, focused, ' editor-sel-columns');
  const out = [];
  segs.forEach((seg, i) => {
    const first = index.staves.get(key(seg.sys, top));
    const last = index.staves.get(key(seg.sys, bottom));
    if (!first?.length || !last?.length) return;
    pushBand(out, seg.x0, staffSpan(first[0], style, s)[0], seg.x1, staffSpan(last[last.length - 1], style, s)[1], i > 0, i < segs.length - 1, band);
  });
  return out;
}

/**
 * The selection shapes (ui-2.3 §2) for `sel` (`{ track, kind, slices }`,
 * 2.3.2 a column `{ tracks, measures }`, or null): per system segment, on every staff of the track, a tint
 * (`editor-sel`, no stroke) and an outline (`editor-sel-outline`, no
 * fill). Beats: from the first selected main beat (and its graces) to the
 * last one, straight across barlines and empty measures; measures: from
 * the first measure's x to the last one's end. A segment that continues on
 * another system runs to that system's edge and is open there (paths);
 * one closed at both ends is a pair of rects. Dimmed when `focused` is false.
 */
export function selectionShapes(index, sel, style, theme, focused) {
  if (!sel) return [];
  if (sel.tracks) return columnShapes(index, sel, style, theme, focused);
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
  const ext = systemExtents(index, ti);
  const band = bandStyle(style, s, focused);
  const out = [];
  segs.forEach((seg, i) => {
    const openL = i > 0;
    const openR = i < segs.length - 1;
    const x0 = openL ? ext.get(seg.sys).x0 : seg.parts[0].x0;
    const x1 = openR ? ext.get(seg.sys).x1 : seg.parts[seg.parts.length - 1].x1;
    for (const st of index.staves.get(key(seg.sys, ti)) || []) {
      const [y0, y1] = staffSpan(st, style, s);
      pushBand(out, x0, y0, x1, y1, openL, openR, band);
    }
  });
  return out;
}
