/**
 * draw/voice2Marks.js — voice 2's beat marks below the notation staff (ui.md
 * "Two voices" §2), drawn by pass 5 (draw/passes/playingDirections.js)
 * after voice 1's marks, for tracks with two-voice measures. Lives outside
 * draw/passes/ so that pass stays small.
 *
 * Per voice-2 beat (main beats of two-voice measures; the voice-2 stream
 * continues through single-voice measures only to find the next note), a
 * stack below the beat, nearest first, DIRECTION_STACK_GAP_SP apart, each
 * layer placed by its top edge: trill ("tr" and wave; draw/trill.js) or
 * ornament, right-hand letters (highest note's on top), the tap mark (T /
 * left-hand tap / S / P), golpe, pick stroke; then the inverted fermata
 * (notes and rests; not on a voice-2 rest merged with voice 1's, whose
 * fermata voice 1 draws in pass 7). Every layer clears (clearBottom): the
 * staff, the beat's own ink (stem, beam, articulations below, heads), its
 * vibrato below and a stemless note's tremolo, its tuplet bracket below,
 * voice 1's ink in the same column, voice 2's ties and slurs drawn below
 * (run.curvesBelow2, pass 1), label runs below a notation-only staff
 * (run.labelBoxes, pass 4) and a rest's own glyph. Consecutive trills on a
 * system share one line (the lowest of their own), each "tr" also clear of
 * the next note's bottom; pick strokes of one voice-2 beam group share the
 * lowest top. The fermata's top sits below the stack's bottom too. Marks
 * are upright (only the fermata flips) and centred on the voice-2 head x.
 *
 * All of a run's voice-2 marks go in one `<g class="voice-2">` appended to
 * its notation group on first use, so they follow voice 1's in document
 * order and pass 6 (dynamics) clears them.
 */
import { group } from './svgUtil.js';
import { renderFermata, fermataGlyph, renderPickStroke, elementBottom } from './notation.js';
import { vibratoClearSp, vibratoBelowSp } from './noteMarks.js';
import { renderOrnament, renderRightFingering, rightFingeringHalf, rightFingeringHeight, renderGolpe, golpeHalf } from './handMarks.js';
import { renderTapMark, tapMarkHalf, tapMarkBox } from './tab.js';
import { trillEndX, trillRunEndX, trillRuns, trillGeometry, renderTrill } from './trill.js';
import { collectBeats, curveEdgeOver, beamGroupsOf } from './passes/notationBeats.js';
import { breakEndX } from './passes/common.js';
import { voiceOf } from '../twoVoice.js';
import { beatTapMark, beatPickStroke, beatTrill } from '../directions.js';
import { beatOrnament, beatGolpe, rightFingerStack, ORNAMENT_GLYPH } from '../hands.js';
import { vibratoOf, fermataOf } from '../noteEffects.js';
import { glyphBox } from '../glyphMetrics.js';
import { pickStrokeGlyph, Glyph } from '../glyphs.js';

const DIRECTION_STACK_GAP_SP = 0.4;  // layer bottom -> next layer's top (as above the staff)
const STAFF_CLEAR_SP = 1;            // bottom line -> a mark's top
const OWN_CLEAR_SP = 1;              // the beat's lowest ink -> a mark's top
const STEMLESS_TREMOLO_SP = 2.8;     // a stemless note's bottom -> a mark below its tremolo
const TUPLET_CLEAR_SP = 1.1;         // voice 2's tuplet bracket line -> a mark's top
const COLUMN_CLEAR_SP = 1;           // voice 1's lowest ink in the same column -> a mark's top
const CURVE_CLEAR_SP = 0.5;          // a tie / slur's outer edge below -> a mark's top
const LABEL_CLEAR_SP = 0.4;          // a label run below the staff -> a mark's top
const REST_CLEAR_SP = 1;             // a rest's glyph bottom -> its fermata's top
const TRILL_NEXT_CLEAR_SP = 1;       // the next note's bottom -> a trill's top
const FERMATA_DIRECTION_GAP_SP = 0.5; // the stack's bottom -> the fermata's top

/**
 * Highest y (px) a voice-2 mark spanning (xa, xb) below beat `item` may
 * put its top at (see the header).
 */
function clearBottom(item, xa, xb, ctx) {
  const sp = ctx.sp;
  const { el, info, run } = item;
  const note = !info.isRest;
  const bottom = note ? elementBottom(info) : -Infinity;
  const vib = note ? vibratoOf(el.vibrato) : null;
  // vibratoClearSp is measured from the wave's usual offset; a stemless note's tremolo pushes the wave further down.
  const vibClear = vib ? vibratoClearSp(vib) - vibratoBelowSp(info, false) + vibratoBelowSp(info, !!el.tremolo) : 0;
  return Math.max(
    item.baselineY + STAFF_CLEAR_SP * sp,
    bottom + OWN_CLEAR_SP * sp,
    vib ? bottom + vibClear * sp : -Infinity,
    note && el.tremolo && info.stemTopY == null ? bottom + STEMLESS_TREMOLO_SP * sp : -Infinity,
    info.tupletBottomY != null ? info.tupletBottomY + TUPLET_CLEAR_SP * sp : -Infinity,
    (ctx.columnBottom.get(item.layoutEl) ?? -Infinity) + COLUMN_CLEAR_SP * sp,
    ...(run.curvesBelow2 || []).map((pts) => curveEdgeOver(pts, xa, xb, true) + CURVE_CLEAR_SP * sp),
    ...(ctx.labelsBelow ? (run.labelBoxes || []) : [])
      .filter((b) => b.top >= item.baselineY && b.x1 < xb && b.x2 > xa).map((b) => b.bottom + LABEL_CLEAR_SP * sp),
    info.restBottomY != null ? info.restBottomY + REST_CLEAR_SP * sp : -Infinity,
  );
}

/** Lowest ink (elementBottom) of voice 1's element at each voice-2 element's onset, keyed by the voice-2 element. */
function columnBottoms(trackRuns, track) {
  const out = new Map();
  trackRuns.filter((r) => r.track === track).forEach((run) => run.measures.forEach((m) => (m.elements2 || []).forEach((le2) => {
    const v1 = le2.t && m.elements.find((le) => le.t && le.t.n === le2.t.n && le.t.d === le2.t.d && le.rendered);
    if (v1) out.set(le2, elementBottom(v1.rendered));
  })));
  return out;
}

/** Height (px) and half width (px) of a glyph drawn at full SMuFL size. */
const glyphSize = (glyph, sp) => { const b = glyphBox(glyph); return { half: (b.width / 2) * sp, height: (b.top - b.bottom) * sp }; };

/** Voice 2's marks and fermatas below the notation staff of `track` (see the header). */
export function renderVoice2Directions(track, trackRuns, theme, systems) {
  const sp = theme.staffLineSpacing;
  const gap = DIRECTION_STACK_GAP_SP * sp;
  const stream = collectBeats(trackRuns, track, theme, 2);
  const ctx = { sp, columnBottom: columnBottoms(trackRuns, track), labelsBelow: !track.showTablature };
  const items = stream.filter((b) => voiceOf(b) === 2 && b.info && !b.info.isGrace && !b.info.hidden);
  items.forEach((item) => {
    item.run = trackRuns.find((r) => r.notationG === item.g);
    const el = item.el;
    item.fermata = fermataOf(el.fermata);
    if (item.info.isRest) return;
    item.trill = beatTrill(el); item.ornament = beatOrnament(el); item.rightLetters = rightFingerStack(el);
    item.tapMark = beatTapMark(el); item.golpe = beatGolpe(el); item.pick = beatPickStroke(el);
  });
  const marked = items.filter((it) => it.trill || it.ornament || it.rightLetters || it.tapMark || it.golpe || it.pick || it.fermata);
  if (!marked.length) return;

  // Each trill's own top (clear of the next note), then one shared line per run of trills: the lowest.
  const trillHalf = (glyphBox(Glyph.ornamentTrill).width / 2) * sp;
  const trilled = marked.filter((it) => it.trill);
  const runs = trillRuns(stream, (b) => trilled.includes(b), (b) => b.sysIdx, (b) => !!b.info?.isGrace);
  trilled.forEach((item) => {
    const at = stream.indexOf(item);
    const later = stream.filter((b, bi) => bi > at && b.sysIdx === item.sysIdx);
    const run = runs.get(item);
    item.trillEndX = trillRunEndX(trillEndX(item.x, later[0] ? later[0].x : Infinity, breakEndX(systems, item.sysIdx, theme), theme),
      run[run.indexOf(item) + 1]?.x, theme);
    const nextNote = later.find((b) => b.info && !b.info.isRest);
    item.trillOwnTop = Math.max(clearBottom(item, item.x - trillHalf, item.trillEndX, ctx),
      nextNote ? elementBottom(nextNote.info) + TRILL_NEXT_CLEAR_SP * sp : -Infinity);
  });

  // Each beat's stack, nearest first: every layer's top below its own clearance and the layer above it.
  marked.forEach((item) => {
    let next = -Infinity;
    const place = (half, height) => {
      const top = Math.max(clearBottom(item, item.x - half, item.x + half, ctx), next);
      next = top + height + gap;
      return top;
    };
    if (item.trill) {
      const top = Math.max(...runs.get(item).map((m) => m.trillOwnTop));
      item.trillBottomY = top - trillGeometry(item.x, 0, item.trillEndX, theme).top;
      next = item.trillBottomY + gap;
    } else if (item.ornament) {
      const { half, height } = glyphSize(Glyph[ORNAMENT_GLYPH[item.ornament]], sp);
      item.ornamentBottomY = place(half, height) + height;
    }
    if (item.rightLetters) {
      const height = rightFingeringHeight(item.rightLetters, theme);
      item.rightBottomY = place(rightFingeringHalf(item.rightLetters, theme), height) + height;
    }
    if (item.tapMark) {
      const box = tapMarkBox(item.x, 0, theme, item.tapMark);
      item.tapBaselineY = place(tapMarkHalf(item.tapMark, theme), box.bottom - box.top) - box.top;
    }
    if (item.golpe) {
      const { height } = glyphSize(Glyph.guitarGolpe, sp);
      item.golpeBottomY = place(golpeHalf(theme), height) + height;
    }
    if (item.pick) {
      const { half, height } = glyphSize(pickStrokeGlyph(item.pick), sp);
      item.pickTop = place(half, height);
      item.pickHeight = height;
    }
    item.stackBottomY = next === -Infinity ? null : next - gap;
  });
  // Pick strokes of one voice-2 beam group share the lowest of their tops.
  const groups = beamGroupsOf(trackRuns, track, 2);
  const shared = new Map();
  marked.forEach((item) => {
    const key = groups.get(item.layoutEl);
    if (key && item.pick) shared.set(key, Math.max(shared.get(key) ?? -Infinity, item.pickTop));
  });

  const layers = new Map();
  const layerOf = (g) => {
    if (!layers.has(g)) { const v = group({ class: 'voice-2' }); g.appendChild(v); layers.set(g, v); }
    return layers.get(g);
  };
  const color = theme.noteColor;
  marked.forEach((item) => {
    const { x } = item;
    if (!(item.trill || item.ornament || item.rightLetters || item.tapMark || item.golpe || item.pick)) return;
    const g = layerOf(item.g);
    if (item.trill) renderTrill(g, x, item.trillBottomY, item.trillEndX, color, theme, null);
    else if (item.ornament) renderOrnament(g, x, item.ornamentBottomY, item.ornament, color, theme);
    if (item.rightLetters) renderRightFingering(g, x, item.rightBottomY, item.rightLetters, color, theme);
    if (item.tapMark) renderTapMark(g, x, item.tapBaselineY, color, theme, item.tapMark);
    if (item.golpe) renderGolpe(g, x, item.golpeBottomY, item.golpe, color, theme);
    if (item.pick) {
      const key = groups.get(item.layoutEl);
      const top = key ? shared.get(key) : item.pickTop;
      renderPickStroke(g, x, top + item.pickHeight, item.pick, color, theme);
      item.stackBottomY = top + item.pickHeight;
    }
  });
  // Fermatas last: below the stack, so pass 6's dynamics clear them too.
  marked.forEach((item) => {
    if (!item.fermata) return;
    const half = (glyphBox(fermataGlyph(item.fermata, true)).width / 2) * sp;
    const top = Math.max(clearBottom(item, item.x - half, item.x + half, ctx),
      item.stackBottomY != null ? item.stackBottomY + FERMATA_DIRECTION_GAP_SP * sp : -Infinity);
    renderFermata(layerOf(item.g), item.x, top, theme, item.fermata, { below: true });
  });
}
