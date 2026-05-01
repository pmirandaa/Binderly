// Smoke test for `next.json`. Exercises the DOM lib (so the preset is
// suitable for browser-targeted Next.js code) without requiring React types
// to be installed in this config-only package. Real Next.js apps will add
// React + the Next plugin themselves.

export function setDocumentTitle(text: string): void {
  if (typeof document !== "undefined") {
    document.title = text;
  }
}

export function readSearchParams(url: string): ReadonlyMap<string, string> {
  const parsed = new URL(url);
  const out = new Map<string, string>();
  parsed.searchParams.forEach((v, k) => {
    out.set(k, v);
  });
  return out;
}

export const APP_NAME: string = "Binderly Web";
