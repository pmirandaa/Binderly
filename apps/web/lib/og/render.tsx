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

import { BRAND, BRAND_BACKGROUND_GRADIENT } from './brand';
import { formatHeaderTally, publicShareUrl } from '../share/format';

import type { PublicSharePayload } from '../share/api';

const SIZE_PX = { width: 1200, height: 630 } as const;
export const OG_SIZE = SIZE_PX;

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
        backgroundImage: BRAND_BACKGROUND_GRADIENT,
        backgroundColor: BRAND.background,
        color: BRAND.text,
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      }}
    >
      <Header handle={handle} />
      <Title title={payload.collectionTitle} ownerLabel={ownerLabel} />
      <ThumbnailRow uris={thumbnailUris} />
      <Footer url={url} stat={stat} />
    </div>
  );
}

function Header({ handle }: { handle: string }): React.ReactElement {
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
        <Logo />
        <div
          style={{
            fontSize: '36px',
            fontWeight: 700,
            color: BRAND.text,
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
          color: BRAND.textMuted,
        }}
      >
        Pokémon collection by @{handle}
      </div>
    </div>
  );
}

function Logo(): React.ReactElement {
  return (
    <div
      style={{
        width: '64px',
        height: '64px',
        borderRadius: '14px',
        background: BRAND.primary,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: BRAND.background,
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
}: {
  readonly title: string;
  readonly ownerLabel: string;
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
          color: BRAND.textMuted,
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
          color: BRAND.text,
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
}: {
  readonly uris: ReadonlyArray<string>;
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
        <Tile key={`tile-${idx.toString()}`} src={src} />
      ))}
    </div>
  );
}

function Tile({ src }: { readonly src: string }): React.ReactElement {
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
        backgroundColor: BRAND.surface,
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
}: {
  readonly url: string;
  readonly stat: string;
}): React.ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        color: BRAND.textDim,
        fontSize: '24px',
      }}
    >
      <div style={{ display: 'flex' }}>binderly.app{url}</div>
      <div style={{ display: 'flex', fontWeight: 600, color: BRAND.text }}>
        {stat}
      </div>
    </div>
  );
}
