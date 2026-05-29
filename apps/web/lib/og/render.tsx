// Pure JSX renderer for the OG card. Exported separately from
// the route handler so unit tests can assert on the rendered
// React tree without invoking Satori (which needs WASM bindings
// jsdom doesn't provide).
//
// Layout:
//
//   ┌──────────────────────────────────────────────────────────┐
//   │  [B] Binderly                          @{handle} on …    │
//   │                                                          │
//   │              {Collection title — large}                  │
//   │              Owner subtitle line                         │
//   │                                                          │
//   │      ┌──┐ ┌──┐ ┌──┐ ┌──┐                                 │
//   │      │  │ │  │ │  │ │  │                                 │
//   │      └──┘ └──┘ └──┘ └──┘                                 │
//   │                                                          │
//   │  binderly.app/c/{handle}/{slug}      {n cards · m sets}  │
//   └──────────────────────────────────────────────────────────┘
//
// Satori CSS subset rules (per `next/og` docs):
//   - Every container with > 1 child must declare `display: flex`.
//   - No external stylesheets / no className. Inline styles only.
//   - `gap` works; nested flex works.
//   - `borderRadius` + `boxShadow` work.

import { BRAND } from './brand';
import { formatHeaderTally, publicShareUrl } from '../share/format';

import type { OgPalette } from '../../app/c/themes/og-palette';
import type { PublicSharePayload } from '../share/api';

const SIZE_PX = { width: 1200, height: 630 } as const;
export const OG_SIZE = SIZE_PX;

/**
 * The brand palette the OG card falls back to when no theme palette
 * is supplied (the production fallback render + any test that renders
 * the card without a theme). Mirrors `lib/og/brand.ts`; structurally a
 * superset-compatible `OgPalette`. Themed renders pass the resolved
 * `ogPaletteForTheme(...)` palette instead (#FU-62 / T-SH-OG-THEME-WIRE).
 */
export const DEFAULT_OG_PALETTE: OgPalette = {
  background: BRAND.background,
  surface: BRAND.surface,
  text: BRAND.text,
  textMuted: BRAND.textMuted,
  accent: BRAND.primary,
  onAccent: BRAND.background,
};

/**
 * The card background gradient, derived from the active palette so a
 * themed share unfurls in its own colours rather than the fixed brand
 * gradient. background → surface → accent (the same 3-stop, 135°
 * structure the brand gradient used).
 */
export function ogBackgroundGradient(palette: OgPalette): string {
  return `linear-gradient(135deg, ${palette.background} 0%, ${palette.surface} 60%, ${palette.accent} 100%)`;
}

export interface OgRenderInput {
  readonly handle: string;
  readonly slug: string;
  readonly payload: PublicSharePayload;
  /**
   * Pre-fetched thumbnail data URIs, one per tile. The renderer
   * always renders 4 tiles (the visual spec); pad with placeholder
   * URIs upstream when the user has fewer than 4 owned items.
   */
  readonly thumbnailUris: ReadonlyArray<string>;
  /**
   * The resolved theme palette to paint the hero with (#FU-62). The
   * route resolves the shareable's `theme` → `ogPaletteForTheme` with
   * the same free-tier downgrade the public page applies. Optional so
   * callers (and tests) that don't theme fall back to the brand palette.
   */
  readonly palette?: OgPalette;
}

/**
 * The stat line shown in the footer-right corner. Rule:
 *   - Prefer the completion percentage (the most evocative
 *     signal — "27.3% complete" reads as "this binder is real").
 *   - Fall back to `{n} cards` when the completion percentage is
 *     unavailable (catalogTotal=0; an unusual but not impossible
 *     edge for custom collections).
 */
export function buildStatLine(payload: PublicSharePayload): string {
  return formatHeaderTally(
    payload.counts.ownedUnique,
    payload.counts.catalogTotal,
    payload.counts.completionPct,
  );
}

/**
 * The renderer for the rich (real-payload) variant.
 * Satori-compatible JSX; pure — no I/O, no hooks, deterministic.
 */
export function renderOgImage(input: OgRenderInput): React.ReactElement {
  const { handle, slug, payload, thumbnailUris } = input;
  const palette = input.palette ?? DEFAULT_OG_PALETTE;
  const ownerLabel = payload.owner.displayName ?? `@${payload.owner.handle}`;
  const stat = buildStatLine(payload);
  const url = publicShareUrl(handle, slug);

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '64px',
        backgroundImage: ogBackgroundGradient(palette),
        backgroundColor: palette.background,
        color: palette.text,
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      }}
    >
      <Header handle={handle} palette={palette} />
      <Title title={payload.collectionTitle} ownerLabel={ownerLabel} palette={palette} />
      <ThumbnailRow uris={thumbnailUris} palette={palette} />
      <Footer url={url} stat={stat} palette={palette} />
    </div>
  );
}

function Header({
  handle,
  palette,
}: {
  readonly handle: string;
  readonly palette: OgPalette;
}): React.ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <Logo palette={palette} />
        <div
          style={{
            fontSize: '36px',
            fontWeight: 700,
            color: palette.text,
            letterSpacing: '-0.5px',
          }}
        >
          Binderly
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          fontSize: '24px',
          color: palette.textMuted,
        }}
      >
        Pokémon collection by @{handle}
      </div>
    </div>
  );
}

function Logo({ palette }: { readonly palette: OgPalette }): React.ReactElement {
  return (
    <div
      style={{
        width: '64px',
        height: '64px',
        borderRadius: '14px',
        background: palette.accent,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: palette.onAccent,
        fontSize: '34px',
        fontWeight: 800,
        letterSpacing: '-1px',
      }}
    >
      B
    </div>
  );
}

function Title({
  title,
  ownerLabel,
  palette,
}: {
  readonly title: string;
  readonly ownerLabel: string;
  readonly palette: OgPalette;
}): React.ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        alignItems: 'flex-start',
      }}
    >
      <div
        style={{
          fontSize: '24px',
          color: palette.textMuted,
          textTransform: 'uppercase',
          letterSpacing: '4px',
        }}
      >
        {ownerLabel}
      </div>
      <div
        style={{
          display: 'flex',
          fontSize: '76px',
          fontWeight: 800,
          lineHeight: 1.05,
          letterSpacing: '-2px',
          color: palette.text,
          maxWidth: '1080px',
        }}
      >
        {title}
      </div>
    </div>
  );
}

function ThumbnailRow({
  uris,
  palette,
}: {
  readonly uris: ReadonlyArray<string>;
  readonly palette: OgPalette;
}): React.ReactElement {
  // Always render 4 tiles for visual consistency. Callers
  // pre-pad with placeholder URIs.
  const tiles = uris.slice(0, 4);
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        gap: '20px',
        alignItems: 'flex-end',
      }}
    >
      {tiles.map((src, idx) => (
        <Tile key={`tile-${idx.toString()}`} src={src} palette={palette} />
      ))}
    </div>
  );
}

function Tile({
  src,
  palette,
}: {
  readonly src: string;
  readonly palette: OgPalette;
}): React.ReactElement {
  // Satori (the engine behind next/og) does NOT understand
  // next/image — it can only consume bare <img> tags whose `src`
  // is a `data:` URI. The next/no-img-element rule therefore does
  // not apply here; it's disabled on this single line so the rest
  // of the app keeps the lint guardrail.
  return (
    <div
      style={{
        display: 'flex',
        width: '160px',
        height: '224px',
        borderRadius: '14px',
        overflow: 'hidden',
        boxShadow: '0 12px 32px rgba(0, 0, 0, 0.45)',
        backgroundColor: palette.surface,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        width={160}
        height={224}
        style={{
          width: '160px',
          height: '224px',
          objectFit: 'cover',
        }}
      />
    </div>
  );
}

function Footer({
  url,
  stat,
  palette,
}: {
  readonly url: string;
  readonly stat: string;
  readonly palette: OgPalette;
}): React.ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        color: palette.textMuted,
        fontSize: '24px',
      }}
    >
      <div style={{ display: 'flex' }}>binderly.app{url}</div>
      <div style={{ display: 'flex', fontWeight: 600, color: palette.text }}>
        {stat}
      </div>
    </div>
  );
}
