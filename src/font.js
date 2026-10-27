/**
 * font.js — injects the @font-face for the Bravura SMuFL music font
 * (https://github.com/steinbergmedia/bravura, SIL Open Font License —
 * see fonts/BRAVURA-LICENSE.txt) once per page.
 *
 * The font ships locally in fonts/Bravura.woff2 so the module works
 * offline / behind a firewall with no CDN dependency. A jsDelivr copy is
 * listed as a fallback `src`, and a locally-installed "Bravura" font (if
 * any) is preferred via `local()`.
 */
let injected = false;

function moduleBaseUrl() {
  // import.meta.url points at this file (src/font.js); fonts/ is a sibling of src/.
  return new URL('../fonts/', import.meta.url).href;
}

export function ensureBravuraFont(fontUrl) {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  if (document.getElementById('music-score-bravura-font')) return;
  const base = fontUrl || moduleBaseUrl();
  const local = `${base}Bravura.woff2`;
  const cdn = 'https://cdn.jsdelivr.net/npm/@vexflow-fonts/bravura@1.0.2/bravura.woff2';
  const style = document.createElement('style');
  style.id = 'music-score-bravura-font';
  style.textContent = `
@font-face {
  font-family: 'Bravura';
  src: local('Bravura'),
       url('${local}') format('woff2'),
       url('${cdn}') format('woff2');
  font-weight: normal;
  font-style: normal;
  font-display: block;
}`;
  document.head.appendChild(style);
}
