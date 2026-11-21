/**
 * MusicScoreRenderer.js — the public entry point.
 *
 *   import { MusicScoreRenderer } from './index.js';
 *   const renderer = new MusicScoreRenderer(document.getElementById('score'), scoreData);
 *   renderer.render();
 *
 * render() = resolve theme (constructor) → normalize → layout → draw every
 * staff at a local origin → score-wide passes → beat text → navigation (voltas,
 * segno / coda / jumps / x3, sections) → tempo → measure ink → place staves →
 * copyright footer → mount.
 */
import { ensureBravuraFont } from './font.js';
import { resolveTheme } from './theme.js';
import { normalizeScore } from './normalize.js';
import { computeLayout } from './layout/index.js';
import { placeStaves, BOTTOM_MARGIN_SP } from './layout/vertical.js';
import { inkBounds } from './layout/ink.js';
import { el as svgEl, svgD, r2 } from './draw/svgUtil.js';
import { drawScoreHeader, drawScoreFooter } from './draw/header.js';
import { drawSystem } from './draw/system.js';
import { drawTempo, drawSystemDecor, tempoTextWidth, tempoBaseline } from './draw/decor.js';
import { renderNavigation } from './draw/navigation.js';
import { renderBeatText } from './draw/beatText.js';
import { renderFadeWah } from './draw/expressionMarks.js';
import { ottavaSegments, renderOttavaAlta, renderOttavaBassa } from './draw/ottava.js';
import { tempoChanges, renderFirstTempoChange, renderTempoChanges } from './draw/tempoMarks.js';
import {
  renderTiesAndSlurs, renderGraceSlurs, renderTabArticulations, renderTechniqueLabelRuns, renderChordSymbolsAndDynamics,
  renderFermatas, renderPlayingDirections,
} from './draw/passes.js';

export class MusicScoreRenderer {
  /**
   * @param {HTMLElement} container
   * @param {object} score - see README.md for the JSON schema.
   * @param {object} [options]
   * @param {object} [options.theme] - shallow-merged over the default theme (each key replaces the default);
   *   legacy px keys are converted to their sp keys (see theme.js resolveTheme).
   * @param {number} [options.width] - render width in px (defaults to container width).
   */
  constructor(container, score, options = {}) {
    this.container = container;
    this.score = score;
    this.theme = resolveTheme(options.theme);
    this.width = options.width || container.clientWidth || 900;
    ensureBravuraFont();
  }

  setScore(score) {
    this.score = score;
    return this;
  }

  render() {
    const theme = this.theme;
    const s = theme.staffLineSpacing;
    const score = normalizeScore(this.score);
    const requestedWidth = this.width || this.container.clientWidth || 900;
    const layout = computeLayout(score, theme, requestedWidth);
    const width = layout.width ?? requestedWidth;

    const svg = svgEl('svg', {
      xmlns: 'http://www.w3.org/2000/svg',
      width,
      class: 'music-score',
      style: `font-synthesis: none; background:${theme.background || '#ffffff'}`,
      role: 'img',
    });
    if (layout.overflow) svg.setAttribute('data-overflow', 'true');

    // --- Accessible name and description (ui.md §10): <title> must be the first child ---
    const title = svgEl('title');
    title.textContent = score.title || 'Music score';
    svg.appendChild(title);
    const desc = svgEl('desc');
    desc.textContent = describeScore(score);
    svg.appendChild(desc);

    // --- Page header: title, composer, tuning label (ui.md §1) ---
    const marginTop = theme.marginTopSp * s;
    const headerBaseline = drawScoreHeader(svg, score, theme, marginTop, width);

    // --- Every staff of every system, each at its own local origin ---
    const drawn = layout.systems.map((system, sysIdx) => drawSystem(svg, system, sysIdx, score, theme));
    const trackRuns = drawn.flatMap((d) => d.runs);

    // --- Score-wide passes, appended to the staff groups they belong to ---
    renderTiesAndSlurs(score, trackRuns, theme, layout.systems);
    renderGraceSlurs(score, trackRuns, theme);
    renderTabArticulations(score, trackRuns, theme, layout.systems);
    renderTechniqueLabelRuns(score, trackRuns, theme, layout.systems);
    // Pick strokes, notation tap "T" / slap / pop and trills (above everything but chord symbols and fermatas).
    renderPlayingDirections(score, trackRuns, theme, layout.systems);
    // Fade / wah marks above the staff (outside the pass barrel; chord symbols and fermatas clear them).
    renderFadeWah(score, trackRuns, theme, layout.systems);
    // 8va / 15ma brackets above the notation staff, outside the fade / wah marks.
    const ottavas = ottavaSegments(score, trackRuns, layout.systems, theme);
    renderOttavaAlta(ottavas, theme);
    // Chord symbols / dynamics once everything they must clear is drawn.
    renderChordSymbolsAndDynamics(score, trackRuns, theme, layout.systems);
    // 8vb / 15mb brackets below the dynamics line.
    renderOttavaBassa(ottavas, theme);
    // Fermatas last so they can clear slurs, tuplets and chord symbols.
    renderFermatas(score, trackRuns, theme, layout.systems);
    // Beat text above / below the music, clear of all of the above (outside the pass barrel).
    renderBeatText(trackRuns, theme);

    // --- Volta brackets, navigation marks and sections above each system's top staff (clear of all of the above) ---
    const navGroups = drawn.map((d, sysIdx) => renderNavigation(d.staves[0]?.g ?? null, layout.systems[sysIdx], theme));

    // --- Tempo mark above system 1, at the time signature's x, clear of the first measure and of navigation under it ---
    // (a tempo change at the first onset follows it on one shared baseline)
    const changes = tempoChanges(drawn);
    let firstChange = null;
    if (score.tempoText && drawn.length && drawn[0].staves.length) {
      const sys0 = layout.systems[0];
      const topG = drawn[0].staves[0].g;
      const firstEnd = sys0.tracks[drawn[0].staves[0].ti].measures[0].endX;
      const firstTop = inkBounds(topG, theme, { xMax: firstEnd }).top;
      const timeX = sys0.header.timeX;
      const navTop = navGroups[0]
        ? inkBounds(navGroups[0], theme, { xMin: timeX, xMax: timeX + tempoTextWidth(score.tempoText, theme), overlap: true }).top
        : Infinity;
      const first = renderFirstTempoChange(topG, changes, timeX + tempoTextWidth(score.tempoText, theme), tempoBaseline(Math.min(firstTop, navTop), theme), theme);
      firstChange = first.drawn;
      drawTempo(topG, timeX, score.tempoText, Math.min(firstTop, navTop), theme, first.y);
    }
    // --- Tempo changes (metronome marks), outermost above each system's top staff ---
    renderTempoChanges(drawn, layout.systems, changes, theme, firstChange);

    // --- Content-aware vertical placement ---
    const placement = placeStaves(
      drawn.map((d) => d.staves.map((st) => ({ ti: st.ti, kind: st.kind, lineBottom: st.lineBottom, ink: inkBounds(st.g, theme) }))),
      theme,
      headerBaseline ?? marginTop,
      headerBaseline != null,
    );
    drawn.forEach((d, sysIdx) => {
      d.staves.forEach((st, i) => {
        st.y = placement.staffY[sysIdx][i];
        st.g.setAttribute('transform', svgD`translate(0,${st.y})`);
      });
    });

    // --- Joining line, brackets and instrument names (absolute coordinates) ---
    drawn.forEach((d, sysIdx) => drawSystemDecor(d.systemG, layout.systems[sysIdx], sysIdx, d.staves, score, theme));

    // --- Copyright footer below the last system's ink; the height grows only when there is one ---
    const footer = drawScoreFooter(svg, score, theme, placement.contentBottom, width);
    const totalHeight = r2(footer != null ? footer + BOTTOM_MARGIN_SP * s : placement.height);
    svg.setAttribute('height', totalHeight);
    svg.setAttribute('viewBox', `0 0 ${r2(width)} ${totalHeight}`);

    this.container.innerHTML = '';
    this.container.appendChild(svg);
    this._svg = svg;
    return this;
  }
}

const KEY_NAMES = (k) => (k > 0 ? `${k} sharp${k > 1 ? 's' : ''}` : `${-k} flat${k < -1 ? 's' : ''}`);

/** Short text description of a score for the SVG's <desc>, e.g. "2 instruments: Guitar, Bass. 5 measures, 4/4, 2 sharps." */
function describeScore(score) {
  const tracks = score.tracks.filter((t) => t.showStandardNotation || t.showTablature);
  const names = tracks.map((t) => t.name || t.label).filter(Boolean);
  const count = `${tracks.length} instrument${tracks.length === 1 ? '' : 's'}`;
  const first = score.tracks[0]?.measures[0];
  const parts = [`${score.measureCount} measure${score.measureCount === 1 ? '' : 's'}`];
  if (first) {
    parts.push(`${first.timeSignature.beats}/${first.timeSignature.beatType}`);
    if (first.keySignature) parts.push(KEY_NAMES(first.keySignature));
  }
  return `${count}${names.length ? `: ${names.join(', ')}` : ''}. ${parts.join(', ')}.`;
}
