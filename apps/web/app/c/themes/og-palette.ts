// Flat palette export for the OG-image worker.
//
// `apps/web/lib/og/` (Satori) only understands an inline-style CSS
// subset and can't pull tokens through the Tamagui runtime, so it
// hardcodes its brand colours. Rather than edit `lib/og/` heavily,
// this module exposes each theme's palette as a flat, Satori-friendly
// struct whose field names mirror `lib/og/brand.ts` (`background`,
// `surface`, `text`, `textMuted`, `accent`) so the OG hero can be
// wired to respect a shareable's theme in a follow-up
// (T-SH-OG-THEME-WIRE) without any registry churn.

import type { ShareableTheme } from '@binderly/api-contracts';

import { resolveTheme, type Theme } from './registry';

/** The minimal palette an OG card needs. Mirrors `lib/og/brand.ts`. */
export interface OgPalette {
  readonly background: string;
  readonly surface: string;
  readonly text: string;
  readonly textMuted: string;
  readonly accent: string;
  readonly onAccent: string;
}

/** Project a Theme onto the flat OG palette. */
export function ogPaletteFromTheme(theme: Theme): OgPalette {
  return {
    background: theme.palette.background,
    surface: theme.palette.surface,
    text: theme.palette.text,
    textMuted: theme.palette.textMuted,
    accent: theme.palette.accent,
    onAccent: theme.palette.onAccent,
  };
}

/**
 * Resolve a (possibly stale/unknown) theme id to its OG palette.
 * Falls back to the default theme's palette for unknown ids.
 */
export function ogPaletteForTheme(
  id: ShareableTheme | string | null | undefined,
): OgPalette {
  return ogPaletteFromTheme(resolveTheme(id));
}
