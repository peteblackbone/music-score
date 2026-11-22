/**
 * view.js — the editor's DOM: the wrapper elements inside the container,
 * the renderer it owns, event listeners, render scheduling, the overlay,
 * scrolling and the live region. It holds no model state; it asks its
 * `host` (ScoreEditor) for what to draw:
 *   host.viewScore() · host.cursorInfo() · host.fills() · host.afterRender()
 *   host.onKey(e) → bool · host.onClick(hit) · host.onFocusChange(focused)
 *
 * DOM (ui.md §2), all inside the container:
 *   div.music-score-editor[tabindex=0][role=application]   (focus stays here)
 *     div.music-score-editor-host  → the renderer's svg (+ the overlay as its last child)
 *     div.music-score-editor-live[aria-live=polite][aria-atomic=true]
 * Only functional inline styles are set; no stylesheet is injected and the
 * focus ring is left to the page (`.music-score-editor:focus`).
 *
 * Renders are coalesced per animation frame (synchronous without
 * requestAnimationFrame); announcements are debounced to 150 ms.
 */
import { MusicScoreRenderer } from '../MusicScoreRenderer.js';
import { hitTestMap } from '../hitMap.js';
import { indexHitMap, cursorShapes, fillShapes } from './geometry.js';
import { createOverlay, drawShapes } from './overlay.js';

const LIVE_STYLE = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;'
  + 'clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0';
export const LIVE_DELAY_MS = 150;
/** Render anyway after this long when animation frames are paused (hidden tab). */
export const RENDER_FALLBACK_MS = 250;
const NBSP = ' ';

/** The real clock: performance.now, timers and requestAnimationFrame (null when missing, e.g. Node). */
export function defaultClock() {
  const g = globalThis;
  const raf = typeof g.requestAnimationFrame === 'function';
  return {
    now: () => (g.performance?.now ? g.performance.now() : Date.now()),
    setTimeout: (fn, ms) => g.setTimeout(fn, ms),
    clearTimeout: (id) => g.clearTimeout(id),
    requestAnimationFrame: raf ? (fn) => g.requestAnimationFrame(fn) : null,
    cancelAnimationFrame: raf ? (id) => g.cancelAnimationFrame(id) : null,
  };
}

const div = (attrs) => {
  const n = document.createElement('div');
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

export class EditorView {
  /** @param {object} opts `{ width, theme, style, clock }` */
  constructor(container, host, opts) {
    this.container = container;
    this.host = host;
    this.clock = opts.clock;
    this.style = opts.style;
    this.focused = false;
    this.pending = false;
    this.renders = 0;
    this.index = indexHitMap(null);
    this.overlay = null;
    this._raf = null;
    this._liveTimer = null;
    this._scroll = false;
    this._destroyed = false;
    this._listeners = [];

    this.root = div({ class: 'music-score-editor', tabindex: '0', role: 'application', 'aria-roledescription': 'tablature editor', style: 'position:relative' });
    this.renderHost = div({ class: 'music-score-editor-host' });
    this.live = div({ class: 'music-score-editor-live', 'aria-live': 'polite', 'aria-atomic': 'true', style: LIVE_STYLE });
    this.root.appendChild(this.renderHost);
    this.root.appendChild(this.live);
    container.appendChild(this.root);
    this.renderer = new MusicScoreRenderer(this.renderHost, host.viewScore(), { width: opts.width, theme: opts.theme });

    this._listen(this.root, 'keydown', (e) => {
      if (e.target !== this.root || e.defaultPrevented) return;
      if (this.host.onKey(e)) e.preventDefault();
    });
    this._listen(this.root, 'focus', () => this.host.onFocusChange(true));
    this._listen(this.root, 'blur', () => this.host.onFocusChange(false));
    this._listen(this.renderHost, 'mousedown', (e) => this._mouseDown(e));

    // One re-render once the fonts are ready (the Bravura face may still be loading on first paint).
    const fonts = typeof document !== 'undefined' ? document.fonts : null;
    if (fonts?.ready && typeof fonts.ready.then === 'function') {
      fonts.ready.then(() => { if (!this._destroyed) this.scheduleRender(); }, () => {});
    }
  }

  _listen(node, type, fn) {
    node.addEventListener(type, fn);
    this._listeners.push([node, type, fn]);
  }

  /** Root classes and labels: `--focused`, `--readonly`, aria-label from the title ('Untitled score' without one), aria-readonly. */
  setRootState({ focused, readOnly, title: raw }) {
    const title = typeof raw === 'string' && raw.trim() ? raw.trim() : 'Untitled score';
    const cls = ['music-score-editor'];
    if (focused) cls.push('music-score-editor--focused');
    if (readOnly) cls.push('music-score-editor--readonly');
    this.root.setAttribute('class', cls.join(' '));
    this.root.setAttribute('aria-label', `${title}${readOnly ? ', read-only' : ''}`);
    if (readOnly) this.root.setAttribute('aria-readonly', 'true');
    else this.root.removeAttribute('aria-readonly');
  }

  /** Ask for a full render: once per animation frame, or now without requestAnimationFrame. */
  scheduleRender() {
    if (this._destroyed) return;
    this.pending = true;
    if (!this.clock.requestAnimationFrame) { this.flush(); return; }
    if (this._raf == null) {
      this._raf = this.clock.requestAnimationFrame(() => {
        this._raf = null;
        if (this.pending) this.flush();
      });
      // Hidden or background tabs pause animation frames: render (and emit `change`) after a
      // short timeout anyway, so hosts still see edits and can save them.
      this._fallback = this.clock.setTimeout(() => {
        this._fallback = null;
        if (this.pending) this.flush();
      }, RENDER_FALLBACK_MS);
    }
  }

  /** Render now: score, hit map, overlay (bands + cursor), scroll if asked, then host.afterRender(). */
  flush() {
    if (this._destroyed) return;
    if (this._raf != null) { this.clock.cancelAnimationFrame?.(this._raf); this._raf = null; }
    if (this._fallback != null) { this.clock.clearTimeout(this._fallback); this._fallback = null; }
    this.pending = false;
    this.renderer.setScore(this.host.viewScore()).render();
    this.renders++;
    this.svg = this.renderer.getSvg();
    this.index = indexHitMap(this.renderer.getHitMap());
    this.overlay = createOverlay(this.svg);
    drawShapes(this.overlay.fill, fillShapes(this.index, this.host.fills(), this.style, this.renderer.theme));
    this.drawCursor();
    this.host.afterRender();
  }

  /** Render width in px from the next render on (scheduled). */
  setWidth(px) {
    this.renderer.width = px;
    this.scheduleRender();
  }

  flushPending() {
    if (this.pending) this.flush();
  }

  /** Scroll the cursor into view (nearest edge, instant) at its next redraw. */
  requestScroll() {
    this._scroll = true;
  }

  /** Redraw only the cursor group (dimmed when unfocused). */
  drawCursor() {
    if (!this.overlay) return;
    drawShapes(this.overlay.cursor, cursorShapes(this.index, this.host.cursorInfo(), this.style, this.renderer.theme, this.focused));
    if (this._scroll) {
      this._scroll = false;
      this.overlay.cursor.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
    }
  }

  /**
   * Speak `text` in the live region after 150 ms of quiet. Within one
   * window a later text replaces an earlier one, except a `keep` text (a
   * settings result): it stays, and the texts after it are joined to it
   * with ". " (the latest non-kept one only; a repeat is spoken once).
   */
  announce(text, keep = false) {
    if (this._destroyed) return;
    if (this._liveTimer != null) this.clock.clearTimeout(this._liveTimer);
    else this._parts = [];
    const last = this._parts[this._parts.length - 1];
    if (last && last.text === text) last.keep ||= keep; // the same text twice in a row is spoken once
    else if (last && !last.keep && !keep) last.text = text;
    else this._parts.push({ text, keep });
    this._liveTimer = this.clock.setTimeout(() => {
      this._liveTimer = null;
      const text = this._parts.map((p, i) => (i < this._parts.length - 1 ? p.text.replace(/\.$/, '') : p.text)).join('. ');
      this._parts = [];
      // a repeated message gets a trailing no-break space so screen readers speak it again
      this.live.textContent = text === this.live.textContent ? text + NBSP : text;
    }, LIVE_DELAY_MS);
  }

  /** Client (mouse) coordinates → SVG user units: getScreenCTM when available, else the bounding box scaled by the width attribute. */
  clientToSvg(e) {
    const svg = this.svg;
    if (!svg) return null;
    const ctm = typeof svg.getScreenCTM === 'function' ? svg.getScreenCTM() : null;
    if (ctm && typeof svg.createSVGPoint === 'function') {
      const p = svg.createSVGPoint();
      p.x = e.clientX;
      p.y = e.clientY;
      const q = p.matrixTransform(ctm.inverse());
      return { x: q.x, y: q.y };
    }
    const r = svg.getBoundingClientRect();
    const k = r.width ? Number(svg.getAttribute('width')) / r.width : 1;
    return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k };
  }

  _mouseDown(e) {
    if (e.button !== 0) return;
    e.preventDefault(); // no text selection; focus is set by hand
    this.root.focus({ preventScroll: true });
    this.flushPending();
    const p = this.clientToSvg(e);
    const hit = p && hitTestMap(this.index.map, p.x, p.y);
    if (hit) this.host.onClick(hit);
  }

  /** Cancel the frame, timers and the font hook, remove listeners and the wrapper. */
  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    if (this._raf != null) this.clock.cancelAnimationFrame?.(this._raf);
    if (this._liveTimer != null) this.clock.clearTimeout(this._liveTimer);
    if (this._fallback != null) this.clock.clearTimeout(this._fallback);
    this._raf = null;
    this._fallback = null;
    this._liveTimer = null;
    for (const [node, type, fn] of this._listeners) node.removeEventListener(type, fn);
    this._listeners = [];
    try { this.container.removeChild(this.root); } catch { /* already removed by the page */ }
  }
}
