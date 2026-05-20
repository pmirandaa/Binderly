// Placeholder card silhouette used as the lower-third tile when
// a thumbnail URL is missing or its fetch times out. We ship the
// silhouette as an inline base64-encoded SVG data URI so:
//
//   - The OG renderer never has to make a network request to
//     resolve the placeholder (Satori needs in-memory bytes).
//   - There is zero static-asset disk dependency at build time
//     (no `public/og-assets/` PNG to keep in sync with the
//     palette).
//
// The silhouette is a stylised TCG card outline using the brand
// teal as the background and a rounded inner panel reminiscent
// of a card frame. Roughly 290×400 (the lower-third tile aspect
// ratio); Satori scales it to the rendered tile size.
//
// SVG kept hand-readable above; the data URI below is the
// base64-encoded form we actually export. Keeping both lets a
// future palette change be applied by editing the SVG string,
// re-running the encode, and pasting in the new data URI.

import { BRAND } from './brand';

/** Source SVG — the canonical form. Kept exported for tests + future regeneration. */
export const PLACEHOLDER_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 290 400" fill="none">
  <rect width="290" height="400" rx="20" fill="${BRAND.surface}"/>
  <rect x="14" y="14" width="262" height="372" rx="12" fill="${BRAND.primaryDark}"/>
  <circle cx="145" cy="170" r="58" fill="${BRAND.primary}" opacity="0.55"/>
  <rect x="60" y="270" width="170" height="14" rx="7" fill="${BRAND.text}" opacity="0.18"/>
  <rect x="80" y="298" width="130" height="10" rx="5" fill="${BRAND.text}" opacity="0.14"/>
  <rect x="100" y="324" width="90" height="8" rx="4" fill="${BRAND.text}" opacity="0.10"/>
</svg>`;

/**
 * Base64-encoded data URI of {@link PLACEHOLDER_SVG}. Computed
 * once at module load (cheap — ~600 bytes of SVG) and re-used
 * across every OG render that needs a placeholder tile.
 */
export const PLACEHOLDER_DATA_URI: string = encodeSvgAsDataUri(PLACEHOLDER_SVG);

function encodeSvgAsDataUri(svg: string): string {
  // Both Node 18+ runtimes (server) and the Edge runtime expose
  // `Buffer` (via the `node:buffer` polyfill in edge) — but we
  // want a portable encoder that works in both without an import
  // dance. Fall back to `globalThis.btoa` if `Buffer` is missing.
  const bufferRef = (globalThis as { Buffer?: { from: (s: string) => { toString: (e: string) => string } } }).Buffer;
  const base64 =
    bufferRef !== undefined
      ? bufferRef.from(svg).toString('base64')
      : btoaUtf8(svg);
  return `data:image/svg+xml;base64,${base64}`;
}

function btoaUtf8(input: string): string {
  // Minimal portable UTF-8 → base64 — used only when `Buffer` is
  // unavailable (some hardened edge runtimes).
  const btoaRef = (globalThis as { btoa?: (s: string) => string }).btoa;
  if (btoaRef === undefined) {
    throw new Error('Neither Buffer nor btoa is available in this runtime.');
  }
  // SVG is pure ASCII so no UTF-8 escape is needed in practice;
  // run a defensive `unescape(encodeURIComponent(...))` regardless
  // so a future SVG with non-ASCII text doesn't silently corrupt.
  return btoaRef(unescape(encodeURIComponent(input)));
}
