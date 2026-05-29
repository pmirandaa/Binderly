// Satori-safe OG palette export. T-SH-THEMES.
//
// The OG image worker (`apps/web/lib/og/render.tsx`) runs under
// Satori, which supports only a strict subset of CSS and CANNOT import
// the React `<ShareableThemeProvider>` (it pulls in `@binderly/ui`'s
// Tamagui runtime). This module exposes the theme colours as a flat,
// dependency-light object so a follow-up can re-theme the OG hero
// without dragging the provider into the edge/worker bundle.
//
// Out of scope for T-SH-THEMES (see the task's "Out of scope"): the OG
// render itself stays on the brand palette today; this is the seam.

import { resolveTheme } from './registry';

/** The flat, Satori-safe palette for an OG card. Plain hex strings. */
export interface OgPalette {
  readonly background: string;
  readonly surface: string;
  readonly text: string;
  readonly textMuted: string;
  readonly accent: string;
  readonly border: string;
}

/**
 * Resolve an OG palette for a theme id. Unknown / null ids fall back to
 * the `default` theme (same posture as `resolveTheme`). Returns only
 * colour primitives — no font stack (Satori loads fonts separately) and
 * no React.
 */
export function ogPaletteForTheme(id: string | null | undefined): OgPalette {
  const theme = resolveTheme(id);
  return {
    background: theme.background,
    surface: theme.surface,
    text: theme.text,
    textMuted: theme.textMuted,
    accent: theme.accent,
    border: theme.border,
  };
}
