/**
 * emitter.js — the ScoreEditor event listeners and the queue of events
 * that wait for the next render (`change` fires after the re-render it
 * caused). Listener exceptions go to console.error and never stop the
 * other listeners or the editor.
 */
export class Emitter {
  constructor() {
    this._listeners = new Map();
    this._queue = [];
  }

  /** Add `fn` for `type`; returns an unsubscribe function. */
  on(type, fn) {
    if (typeof fn !== 'function') throw new TypeError('listener must be a function');
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(fn);
    return () => this.off(type, fn);
  }

  off(type, fn) {
    this._listeners.get(type)?.delete(fn);
  }

  /** Call every listener of `type` now. */
  emit(type, payload) {
    for (const fn of [...(this._listeners.get(type) || [])]) {
      try { fn(payload); } catch (err) { console.error(err); }
    }
  }

  /** Emit `type` at the next drain(); `payload` may be a function, called then for the current value. */
  queue(type, payload) {
    this._queue.push([type, payload]);
  }

  /** Emit the queued events in order. */
  drain() {
    const q = this._queue;
    this._queue = [];
    for (const [type, payload] of q) this.emit(type, typeof payload === 'function' ? payload() : payload);
  }

  clear() {
    this._listeners.clear();
    this._queue = [];
  }
}
