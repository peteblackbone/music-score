/**
 * layout/vertical.js — content-aware vertical placement of every staff of
 * every system (ui.md §5). Each staff was drawn in its own group with its
 * top line at y = 0; given each group's ink extents (layout/ink.js) this
 * decides the y of every staff's top line, line-to-line gaps being
 *   max(minimum, bottom extent of the staff above + top extent of the staff below + padding)
 * and the total score height (last staff's bottom ink + bottom margin, no
 * trailing system gap). Pure function, no DOM/SVG here.
 */

// Paddings between facing extents (ui.md §5), in sp. Minimums are theme keys.
const NOTATION_TAB_PAD_SP = 0.75;
const INSTRUMENT_PAD_SP = 1.5;
const SYSTEM_PAD_SP = 2.5;
const SYSTEM_OVER_INSTRUMENT_SP = 2; // system gap >= largest neighbouring instrument gap + this
const FIRST_SYSTEM_CLEARANCE_SP = 2; // header baseline -> system 1's top ink
const BOTTOM_MARGIN_SP = 3;

/**
 * @param {Array<Array<{ ti: number, kind: 'notation'|'tab', lineBottom: number, ink: { top: number, bottom: number } }>>} systems
 *   per system, its staves top to bottom: `lineBottom` is the local y of
 *   the staff's bottom line (top line is 0), `ink` the local ink extents.
 * @param {object} theme
 * @param {number} startY - y below which system 1's ink may start (header
 *   baseline + clearance is applied here when `hasHeader`).
 * @param {boolean} hasHeader
 * @returns {{ staffY: number[][], height: number }} top-line y of each staff
 *   (same nesting as `systems`) and the total height.
 */
export function placeStaves(systems, theme, startY, hasHeader) {
  const s = theme.staffLineSpacing;
  const topExt = (st) => Math.max(0, -(Number.isFinite(st.ink.top) ? st.ink.top : 0));
  const bottomExt = (st) => Math.max(0, (Number.isFinite(st.ink.bottom) ? st.ink.bottom : st.lineBottom) - st.lineBottom);

  // Line-to-line gaps within each system first: the system gap depends on them.
  const innerGaps = systems.map((staves) => staves.map((st, i) => {
    if (i === 0) return 0;
    const prev = staves[i - 1];
    const sameTrack = prev.ti === st.ti;
    const min = (sameTrack ? theme.notationTabGapSp : theme.instrumentGapSp) * s;
    const pad = (sameTrack ? NOTATION_TAB_PAD_SP : INSTRUMENT_PAD_SP) * s;
    return Math.max(min, bottomExt(prev) + topExt(st) + pad);
  }));
  const largestInstrumentGap = systems.map((staves, si) => staves.reduce(
    (m, st, i) => (i > 0 && staves[i - 1].ti !== st.ti ? Math.max(m, innerGaps[si][i]) : m), 0));

  const staffY = [];
  let y = startY + (hasHeader ? FIRST_SYSTEM_CLEARANCE_SP * s : 0);
  let lastBottomInk = y;
  systems.forEach((staves, si) => {
    const ys = [];
    staves.forEach((st, i) => {
      if (si === 0 && i === 0) {
        y += topExt(st);
      } else if (i === 0) {
        const prev = systems[si - 1][systems[si - 1].length - 1];
        let gap = Math.max(theme.systemGapSp * s, bottomExt(prev) + topExt(st) + SYSTEM_PAD_SP * s);
        const neighbour = Math.max(largestInstrumentGap[si - 1], largestInstrumentGap[si]);
        if (neighbour > 0) gap = Math.max(gap, neighbour + SYSTEM_OVER_INSTRUMENT_SP * s);
        y += gap;
      } else {
        y += innerGaps[si][i];
      }
      ys.push(y);
      lastBottomInk = y + st.lineBottom + bottomExt(st);
      y += st.lineBottom; // continue from this staff's bottom line
    });
    staffY.push(ys);
  });
  return { staffY, height: lastBottomInk + BOTTOM_MARGIN_SP * s };
}
