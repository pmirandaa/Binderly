// Public-shareable theme registry — the typed source of truth for
// the visual variants a Pro user can apply to `/c/{handle}/{slug}`.
//
// Each theme is a flat token bundle (palette + font pairing + header
// treatment + card frame). No gradient/box-shadow slop — the themes
// lean flat and tasteful; a theme only reaches for an accent band
// when its identity genuinely calls for it.
//
// The id space is pinned to `SHAREABLE_THEMES` in
// `@binderly/api-contracts` so the server-side gate
// (`theme: 'gold'` from a free user) and the client renderer agree on
// the exact same set without the UI package having to be consulted.
//
// `resolveTheme` makes a stale/unknown `theme_id` non-fatal (always a
// valid Theme back). `resolvePublicTheme` layers the free-tier
// downgrade on top so a non-Pro owner's page reverts to `default`.

import { type ShareableTheme } from '@binderly/api-contracts';

/** Flat colour tokens a theme paints the public surface with. */
export interface ThemePalette {
  readonly background: string;
  readonly surface: string;
  readonly surfaceMuted: string;
  readonly border: string;
  readonly text: string;
  readonly textMuted: string;
  readonly accent: string;
  /** Foreground colour that sits legibly on top of `accent`. */
  readonly onAccent: string;
}

/** Heading + body font stacks. Web-safe stacks only — no webfont load. */
export interface ThemeFonts {
  readonly heading: string;
  readonly body: string;
}

/**
 * Header treatment:
 *   - `plain` — header text sits directly on the page background.
 *   - `band`  — a thin accent band runs across the top of the page.
 */
export type HeaderTreatment = 'plain' | 'band';

/**
 * Card framing for the snapshot / member cards:
 *   - `outlined` — 1px border, no fill emphasis (the default look).
 *   - `flat`     — filled surface, borderless.
 *   - `soft`     — filled surface with a hairline border.
 */
export type CardFrame = 'outlined' | 'flat' | 'soft';

/** A fully-resolved, typed theme. */
export interface Theme {
  readonly id: ShareableTheme;
  readonly name: string;
  readonly description: string;
  /** Free tier may only persist/render `pro: false` themes. */
  readonly pro: boolean;
  readonly palette: ThemePalette;
  readonly fonts: ThemeFonts;
  readonly header: HeaderTreatment;
  readonly cardFrame: CardFrame;
}

const SANS = 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif';
const SERIF = 'Georgia, "Iowan Old Style", "Times New Roman", serif';

export const DEFAULT_THEME: Theme = {
  id: 'default',
  name: 'Classic',
  description: 'Clean light surface — the free default everyone starts on.',
  pro: false,
  palette: {
    background: '#FFFFFF',
    surface: '#F8FAFC',
    surfaceMuted: '#F1F5F9',
    border: '#E2E8F0',
    text: '#0F172A',
    textMuted: '#64748B',
    accent: '#0FA3A3',
    onAccent: '#FFFFFF',
  },
  fonts: { heading: SANS, body: SANS },
  header: 'plain',
  cardFrame: 'outlined',
};

export const DARK_THEME: Theme = {
  id: 'dark',
  name: 'Midnight',
  description: 'Deep slate dark mode with a cool cyan accent.',
  pro: true,
  palette: {
    background: '#0B1120',
    surface: '#111827',
    surfaceMuted: '#1E293B',
    border: '#334155',
    text: '#F8FAFC',
    textMuted: '#94A3B8',
    accent: '#38BDF8',
    onAccent: '#04121F',
  },
  fonts: { heading: SANS, body: SANS },
  header: 'band',
  cardFrame: 'flat',
};

export const PAPER_THEME: Theme = {
  id: 'paper',
  name: 'Vintage Paper',
  description: 'Warm off-white stock with a serif voice — a binder feel.',
  pro: true,
  palette: {
    background: '#F5EFE0',
    surface: '#FBF7EC',
    surfaceMuted: '#EFE6D2',
    border: '#D9C9A3',
    text: '#3D3527',
    textMuted: '#7A6E55',
    accent: '#B5651D',
    onAccent: '#FBF7EC',
  },
  fonts: { heading: SERIF, body: SERIF },
  header: 'plain',
  cardFrame: 'soft',
};

export const NEON_THEME: Theme = {
  id: 'neon',
  name: 'Holo',
  description: 'Near-black canvas with a punchy magenta holo accent.',
  pro: true,
  palette: {
    background: '#0A0A12',
    surface: '#14111F',
    surfaceMuted: '#1F1A2E',
    border: '#3A2F5C',
    text: '#F5F3FF',
    textMuted: '#A99FD6',
    accent: '#FF2EC4',
    onAccent: '#0A0A12',
  },
  fonts: { heading: SANS, body: SANS },
  header: 'band',
  cardFrame: 'flat',
};

export const GOLD_THEME: Theme = {
  id: 'gold',
  name: 'Gold Foil',
  description: 'Espresso-dark with a brushed-gold accent for grails.',
  pro: true,
  palette: {
    background: '#14110A',
    surface: '#1E1809',
    surfaceMuted: '#2A2210',
    border: '#4D3F1A',
    text: '#FBF6E8',
    textMuted: '#C9B98A',
    accent: '#E8B341',
    onAccent: '#14110A',
  },
  fonts: { heading: SERIF, body: SANS },
  header: 'band',
  cardFrame: 'outlined',
};

/** Lookup keyed by the canonical `ShareableTheme` id. */
export const THEMES: Readonly<Record<ShareableTheme, Theme>> = {
  default: DEFAULT_THEME,
  dark: DARK_THEME,
  paper: PAPER_THEME,
  neon: NEON_THEME,
  gold: GOLD_THEME,
};

/** The free fallback id. */
export const DEFAULT_THEME_ID: ShareableTheme = 'default';

/** Stable display order for the gallery (default first). */
export const THEME_LIST: readonly Theme[] = [
  DEFAULT_THEME,
  DARK_THEME,
  PAPER_THEME,
  NEON_THEME,
  GOLD_THEME,
];

/** Ids that require Pro to persist/render. */
export const PRO_THEME_IDS: readonly ShareableTheme[] = THEME_LIST.filter(
  (t) => t.pro,
).map((t) => t.id);

/** Narrowing guard — is `id` a real, registered theme id? */
export function isKnownThemeId(id: unknown): id is ShareableTheme {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(THEMES, id);
}

/**
 * Resolve any (possibly stale / null / unknown) id to a concrete
 * theme. Falls back to `default` so an invalid stored `theme_id`
 * never breaks the public page.
 */
export function resolveTheme(id: ShareableTheme | string | null | undefined): Theme {
  if (isKnownThemeId(id)) return THEMES[id];
  return DEFAULT_THEME;
}

/**
 * Resolve the theme for the PUBLIC render with free-tier
 * enforcement folded in:
 *   - `ownerIsPro === false` → force `default` (a downgraded owner's
 *     themed page reverts cleanly, regardless of stored id).
 *   - `ownerIsPro === true`  → render the resolved stored theme.
 *   - `ownerIsPro === null`  → owner tier unknown to the public
 *     payload (see Q-022 / T-BE-SHAREABLE-OWNER-TIER). Interim: render
 *     the resolved stored theme for everyone. The day the payload
 *     carries the tier, passing `false` flips the downgrade on with no
 *     further change here.
 */
export function resolvePublicTheme(
  id: ShareableTheme | string | null | undefined,
  ownerIsPro: boolean | null,
): Theme {
  if (ownerIsPro === false) return DEFAULT_THEME;
  return resolveTheme(id);
}
