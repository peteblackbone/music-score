/**
 * style.js — every visual value of the editor overlay (ui.md §3–§5), in
 * staff spaces (sp: theme.staffLineSpacing) unless named otherwise. The
 * four colours can be overridden per editor (cursorColor, overfullColor,
 * underfullColor and the 2.3 selectionColor options); nothing else is an option.
 */

export const EDITOR_STYLE = Object.freeze({
  cursorColor: '#3b5bdb',
  overfullColor: '#d92d20',
  underfullColor: '#62636a',
  selectionColor: '#0b7285', // 2.3 (ui-2.3 §2): teal, about 5.6:1 on white

  // cursor column: centred on the element, width max(ink + pad, min), inset from the barlines
  colPadSp: 0.8,
  colMinSp: 1.8,
  colInsetSp: 0.2,
  colRadiusSp: 0.2,
  colStrokeSp: 0.15,
  tabColOverhangSp: 0.75, // above the top / below the bottom TAB line
  notationColOverhangSp: 1.5, // above the top / below the bottom staff line (fixed 4 sp staff)
  notationStaffSp: 4,

  // string box: one TAB line gap tall, width max(knock-out + pad, min), never wider than the column
  stringPadSp: 0.4,
  stringMinSp: 1.6,
  stringStrokeSp: 0.2,

  // append slot / empty measure: dashed, no fill
  slotWidthSp: 1.6,
  slotMinSp: 0.8,
  slotGapSp: 0.4,
  slotDashSp: [0.4, 0.25],

  // fill bands
  bandOverhangSp: 1,
  barOffsetSp: 1.25,
  barHeightSp: 0.25,
  overTintOpacity: 0.1,
  barOpacity: 0.85,
  underOpacity: 0.7,
  underStrokePx: 1,
  underDashPx: [4, 3],

  // 2.3 selection (ui-2.3 §2): a tint and an outline per system segment; element extent max(width + pad, min), inset from the barlines
  selPadSp: 0.8,
  selMinSp: 1.8,
  selInsetSp: 0.2,
  selRadiusSp: 0.2,
  selStrokeSp: 0.1,

  // opacities, focused / unfocused (ui.md §5, ui-2.3 §2)
  focused: Object.freeze({ colStroke: 1, colFill: 0.1, stringStroke: 1, stringFill: 0.22, slotStroke: 1, selFill: 0.14, selStroke: 1 }),
  unfocused: Object.freeze({ colStroke: 0.35, colFill: 0.04, stringStroke: 0.5, stringFill: 0.08, slotStroke: 0.35, selFill: 0.06, selStroke: 0.4 }),
});

const colour = (v, d) => (typeof v === 'string' && v.trim() ? v.trim() : d);

/** EDITOR_STYLE with the colour options applied (non-empty strings only). */
export function resolveStyle(options = {}) {
  return Object.freeze({
    ...EDITOR_STYLE,
    cursorColor: colour(options.cursorColor, EDITOR_STYLE.cursorColor),
    overfullColor: colour(options.overfullColor, EDITOR_STYLE.overfullColor),
    underfullColor: colour(options.underfullColor, EDITOR_STYLE.underfullColor),
    selectionColor: colour(options.selectionColor, EDITOR_STYLE.selectionColor),
  });
}
