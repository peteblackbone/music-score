/**
 * overlay.js — the editor overlay inside the rendered SVG:
 * `<g class="editor-overlay" pointer-events="none">` appended as the svg's
 * last child, with `<g class="editor-fill">` (bands), the 2.3
 * `<g class="editor-selection">` and `<g class="editor-cursor">` (cursor)
 * inside, in that order. Draws geometry.js shape
 * descriptors; a redraw clears its group with textContent.
 */
import { el } from '../draw/svgUtil.js';

/** Append the overlay groups to `svg`; returns `{ root, fill, selection, cursor }`. */
export function createOverlay(svg) {
  const root = el('g', { class: 'editor-overlay', 'pointer-events': 'none' });
  const fill = el('g', { class: 'editor-fill' });
  const selection = el('g', { class: 'editor-selection' });
  const cursor = el('g', { class: 'editor-cursor' });
  root.appendChild(fill);
  root.appendChild(selection);
  root.appendChild(cursor);
  svg.appendChild(root);
  return { root, fill, selection, cursor };
}

/** Replace the children of `group` with elements for `shapes`; returns the new elements. */
export function drawShapes(group, shapes) {
  group.textContent = '';
  return shapes.map((sh) => group.appendChild(el(sh.tag, sh.attrs)));
}
