// Typed theme registry for the public shareable page
// (`/c/{handle}/{slug}`). T-SH-THEMES.
//
// Each `Theme` is a flat bag of design tokens (colours + font) the
// SSR-safe `<ShareableThemeProvider>` applies to a frame element and
// `<ShareableView>` reads for per-element colours. Tokens are concrete
// hex strings sourced from the `@binderly/ui` palette so the shareable
// surface stays visually consistent with the rest of Binderly while
// remaining import-light (no Tamagui runtime needed on the OG worker —
// see `og-palette.ts`).
//
// Gating note: the *picker* is Pro-gated (only `default` is free) via
// `@binderly/feature-flags`; the *render* enforcement is
// `resolvePublicTheme(id, ownerIsPro)`, which force-defaults a provably
// non-pro owner's stored theme server-side at render time
// (rules/08-shareables.md: "themes are paid-only, enforced server-side
// at render time").

import { palette } from '@binderly/ui';

import type { ShareableTheme } from '@binderly/api-contracts';

/**
 * The flat token bag every shareable theme provides. Colour tokens are
 * concrete CSS colour strings; `fontFamily` is a CSS font-family stack.
 */
export interface Theme {
  /** The contract theme id this token bag implements. */
  readonly id: ShareableTheme;
  /** Human label rendered in the picker. */
  readonly label: string;
  /** One-line picker description. */
  readonly description: string;
  /** Page background. */
  readonly background: string;
  /** Card / panel surface. */
  readonly surface: string;
  /** Muted surface (empty states, footers). */
  readonly surfaceMuted: string;
  /** Hairline / card border. */
  readonly border: string;
  /** Primary body + heading text. */
  readonly text: string;
  /** Secondary / caption text. */
  readonly textMuted: string;
  /** Accent used for emphasis (links, focus). */
  readonly accent: string;
  /** CSS font-family stack applied to the frame. */
  readonly fontFamily: string;
}

const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const SERIF = 'Georgia, Cambria, "Times New Roman", Times, serif';
const MONO = '"SFMono-Regular", ui-monospace, Menlo, Consolas, "Liberation Mono", monospace';

/**
 * The `default` theme — the only theme free users get. A clean,
 * neutral light surface that matches the in-app light theme.
 */
export const DEFAULT_THEME: Theme = {
  id: 'default',
  label: 'Default',
  description: 'Clean and neutral. Free on every plan.',
  background: palette.white,
  surface: palette.neutral['50'],
  surfaceMuted: palette.neutral['100'],
  border: palette.neutral['200'],
  text: palette.neutral['900'],
  textMuted: palette.neutral['600'],
  accent: palette.teal['500'],
  fontFamily: SANS,
};

const DARK_THEME: Theme = {
  id: 'dark',
  label: 'Midnight',
  description: 'High-contrast dark surface.',
  background: palette.neutral['950'],
  surface: palette.neutral['900'],
  surfaceMuted: palette.neutral['800'],
  border: palette.neutral['700'],
  text: palette.neutral['50'],
  textMuted: palette.neutral['400'],
  accent: palette.teal['400'],
  fontFamily: SANS,
};

const PAPER_THEME: Theme = {
  id: 'paper',
  label: 'Paper',
  description: 'Warm, editorial, serif type.',
  background: palette.amber['50'],
  surface: palette.white,
  surfaceMuted: palette.amber['100'],
  border: palette.amber['200'],
  text: palette.neutral['900'],
  textMuted: palette.amber['800'],
  accent: palette.amber['600'],
  fontFamily: SERIF,
};

const NEON_THEME: Theme = {
  id: 'neon',
  label: 'Neon',
  description: 'Electric violet on near-black, mono type.',
  background: palette.neutral['950'],
  surface: palette.violet['950'],
  surfaceMuted: palette.violet['900'],
  border: palette.violet['700'],
  text: palette.violet['50'],
  textMuted: palette.violet['300'],
  accent: palette.teal['400'],
  fontFamily: MONO,
};

const GOLD_THEME: Theme = {
  id: 'gold',
  label: 'Gold',
  description: 'Luxe gold accents on slate.',
  background: palette.neutral['900'],
  surface: palette.neutral['800'],
  surfaceMuted: palette.neutral['700'],
  border: palette.amber['500'],
  text: palette.amber['50'],
  textMuted: palette.amber['200'],
  accent: palette.amber['400'],
  fontFamily: SERIF,
};

/**
 * Every theme keyed by its contract id. Exhaustive over
 * `SHAREABLE_THEMES`; adding a contract theme without a registry entry
 * is a compile error (the `Record<ShareableTheme, Theme>` annotation).
 */
export const THEMES: Readonly<Record<ShareableTheme, Theme>> = {
  default: DEFAULT_THEME,
  dark: DARK_THEME,
  paper: PAPER_THEME,
  neon: NEON_THEME,
  gold: GOLD_THEME,
} as const;

/** Themes in picker display order (default first). */
export const THEME_LIST: readonly Theme[] = [
  DEFAULT_THEME,
  DARK_THEME,
  PAPER_THEME,
  NEON_THEME,
  GOLD_THEME,
];

/**
 * Resolve a (possibly unknown / null) theme id to a concrete `Theme`.
 * Unknown ids and `null`/`undefined` fall back to `default` so a
 * backend drift or a row written before the theme shipped never throws
 * at render time.
 */
export function resolveTheme(id: string | null | undefined): Theme {
  if (id === null || id === undefined) return DEFAULT_THEME;
  return (THEMES as Record<string, Theme>)[id] ?? DEFAULT_THEME;
}

/**
 * Server-side free-downgrade seam. The public render path calls this so
 * a provably non-pro owner's stored non-default theme reverts to
 * `default` (rules/08-shareables.md: themes are enforced server-side at
 * render time).
 *
 *   - `ownerIsPro === false` → force `default` (free owner downgrade).
 *   - `ownerIsPro === true`  → render the stored theme.
 *   - `ownerIsPro == null`   → owner tier not yet sourced on the public
 *     payload (Q-022 / `T-BE-SHAREABLE-OWNER-TIER`); interim behaviour
 *     renders the stored theme for everyone.
 */
export function resolvePublicTheme(
  id: string | null | undefined,
  ownerIsPro: boolean | null | undefined,
): Theme {
  if (ownerIsPro === false) return DEFAULT_THEME;
  return resolveTheme(id);
}
