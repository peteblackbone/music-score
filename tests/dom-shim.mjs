// Minimal DOM shim: just enough for src/ (createElementNS, setAttribute, appendChild,
// textContent, dataset, innerHTML='', getElementById, head, createElement('style')).
// No layout/measurement: clientWidth is 0, so tests must pass an explicit width.
class Node_ {
  constructor(tag) { this.tag = tag; this.attrs = []; this.children = []; this._text = ''; this.dataset = {}; this.id = ''; }
  setAttribute(k, v) {
    v = String(v);
    const e = this.attrs.find((a) => a[0] === k);
    if (e) e[1] = v; else this.attrs.push([k, v]);
  }
  getAttribute(k) { const e = this.attrs.find((a) => a[0] === k); return e ? e[1] : null; }
  appendChild(c) { this.children.push(c); return c; }
  set textContent(s) { this._text = String(s); this.children = []; }
  get textContent() { return this._text; }
  set innerHTML(s) { this.children = []; this._text = ''; }
  get innerHTML() { return ''; }
  get clientWidth() { return 0; }
}
const head = new Node_('head');
globalThis.document = {
  head,
  createElementNS: (_ns, tag) => new Node_(tag),
  createElement: (tag) => new Node_(tag),
  getElementById: () => null,
};
export function makeContainer() { return new Node_('div'); }

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function serialize(n, depth = 0) {
  const pad = '  '.repeat(depth);
  const attrs = n.attrs.map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
  const ds = Object.keys(n.dataset).map((k) => ` data-${k}="${esc(String(n.dataset[k]))}"`).join('');
  if (!n.children.length && !n._text) return `${pad}<${n.tag}${attrs}${ds}/>\n`;
  if (!n.children.length) return `${pad}<${n.tag}${attrs}${ds}>${esc(n._text)}</${n.tag}>\n`;
  return `${pad}<${n.tag}${attrs}${ds}>\n${n.children.map((c) => serialize(c, depth + 1)).join('')}${pad}</${n.tag}>\n`;
}
