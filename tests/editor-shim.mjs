// Test-only additions to tests/dom-shim.mjs for the ScoreEditor controller (2.0.0): events, focus,
// removeChild / removeAttribute, getBoundingClientRect and scrollIntoView, added to the shim's node
// prototype only where missing. Listeners live in a WeakMap, so nodes get no own properties and
// serialize() output is unchanged. makeClock() is a manual clock for options.clock.
import { makeContainer } from './dom-shim.mjs';

const proto = Object.getPrototypeOf(makeContainer());
const listeners = new WeakMap();
/** Every scrollIntoView call: { node, opts }. */
export const scrollLog = [];

const def = (name, fn) => {
  if (!(name in proto)) Object.defineProperty(proto, name, { value: fn, configurable: true, writable: true });
};
def('addEventListener', function addEventListener(type, fn) {
  if (!listeners.has(this)) listeners.set(this, new Map());
  const m = listeners.get(this);
  if (!m.has(type)) m.set(type, new Set());
  m.get(type).add(fn);
});
def('removeEventListener', function removeEventListener(type, fn) { listeners.get(this)?.get(type)?.delete(fn); });
/** Dispatch a synthetic event of `type` with `props` at this node (no bubbling); returns the event. */
def('dispatch', function dispatch(type, props = {}) {
  const e = { type, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...props };
  for (const fn of [...(listeners.get(this)?.get(type) || [])]) fn.call(this, e);
  return e;
});
def('listenerCount', function listenerCount() {
  let n = 0;
  listeners.get(this)?.forEach((set) => { n += set.size; });
  return n;
});
def('focus', function focus() {
  const prev = document.activeElement;
  if (prev === this) return;
  document.activeElement = this;
  if (prev?.dispatch) prev.dispatch('blur');
  this.dispatch('focus');
});
def('blur', function blur() {
  if (document.activeElement !== this) return;
  document.activeElement = null;
  this.dispatch('blur');
});
def('removeChild', function removeChild(c) {
  const i = this.children.indexOf(c);
  if (i < 0) throw new Error('removeChild: not a child');
  this.children.splice(i, 1);
  return c;
});
def('removeAttribute', function removeAttribute(k) { this.attrs = this.attrs.filter((a) => a[0] !== k); });
def('getBoundingClientRect', function getBoundingClientRect() {
  const w = Number(this.getAttribute('width')) || 0;
  const h = Number(this.getAttribute('height')) || 0;
  return { left: 0, top: 0, x: 0, y: 0, width: w, height: h, right: w, bottom: h };
});
def('scrollIntoView', function scrollIntoView(opts) { scrollLog.push({ node: this, opts }); });
if (!('activeElement' in document)) document.activeElement = null;
// 2.3: the document gets the same listener functions (clipboard events are listened for on document).
for (const name of ['addEventListener', 'removeEventListener', 'dispatch', 'listenerCount']) {
  if (!(name in document)) Object.defineProperty(document, name, { value: proto[name], configurable: true, writable: true });
}

/**
 * A DataTransfer-like clipboardData for synthetic copy / cut / paste events: `init` maps types to
 * strings; `{ throws: true }` makes getData and setData throw (a browser that refuses access).
 */
export function makeClipboardData(init = {}, { throws = false } = {}) {
  const data = new Map(Object.entries(init));
  return {
    data,
    getData(type) { if (throws) throw new Error('denied'); return data.get(type) ?? ''; },
    setData(type, v) { if (throws) throw new Error('denied'); data.set(type, String(v)); },
  };
}

/** A manual clock: now(), timers and animation frames run only on advance(ms) / frame(). */
export function makeClock(start = 1000) {
  let t = start;
  let id = 0;
  const timers = new Map();
  const frames = new Map();
  return {
    now: () => t,
    setTimeout: (fn, ms) => { timers.set(++id, { fn, at: t + (ms || 0) }); return id; },
    clearTimeout: (i) => { timers.delete(i); },
    requestAnimationFrame: (fn) => { frames.set(++id, fn); return id; },
    cancelAnimationFrame: (i) => { frames.delete(i); },
    advance(ms) {
      t += ms;
      for (const [k, v] of [...timers].sort((a, b) => a[1].at - b[1].at)) if (v.at <= t && timers.has(k)) { timers.delete(k); v.fn(); }
    },
    frame() { const fs = [...frames.values()]; frames.clear(); fs.forEach((f) => f(t)); return fs.length; },
    pendingFrames: () => frames.size,
    pendingTimers: () => timers.size,
  };
}
