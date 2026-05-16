// `/c/[handle]/[slug]/opengraph-image` — Open Graph image route.
//
// Next.js's file-based OG image convention: a default export
// returning an `ImageResponse` (from `next/og`) is auto-routed
// to a 1200×630 image at this path. Crawlers fetch the URL when
// unfurling shares; the social preview shows the collection
// title + tally + Binderly branding.
//
// SSR-only by design — the OG image is read by bots, not
// browsers — so this file does NOT carry `'use client'`. We
// import the data layer's runtime adapter to fetch the payload
// server-side. If the api-client cannot be constructed (no env
// vars; happens during `next build` when the page is excluded
// from prerender via `force-dynamic`), we fall back to a
// metadata-only image. The fallback also covers the case when
// the backend's public read endpoint hasn't shipped yet
// (`open-questions.md` § Q-012).
//
// The OG render template intentionally uses inline styles only:
// `next/og` (Satori under the hood) does NOT understand external
// stylesheets / Tamagui's CSS-in-JS output. We keep the JSX as
// flat as possible.

import { ImageResponse } from 'next/og';

import { apiToShareApi, type PublicSharePayload } from '../../../../lib/share/api';
import {
  formatHeaderTally,
  formatLastUpdated,
  publicShareUrl,
} from '../../../../lib/share/format';

export const runtime = 'nodejs';

export const alt = 'Binderly shareable preview';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

interface RouteParams {
  params: { handle: string; slug: string };
}

/**
 * Try to fetch the public share payload server-side. Returns
 * `null` on any failure (missing env, 404, network) so the OG
 * image can render the metadata-only fallback. Errors here
 * intentionally do NOT break the route — a degraded social
 * preview is far better than no preview at all.
 */
async function tryFetchPayload(
  handle: string,
  slug: string,
): Promise<PublicSharePayload | null> {
  try {
    // Lazy-load the api-client module so the `loadWebEnv()` env
    // assertion only runs at request time. During `next build`
    // (which doesn't prerender this dynamic route) the module is
    // not imported and the fallback path executes.
    const { getApiClient } = await import('../../../../lib/api-client');
    const api = apiToShareApi(getApiClient());
    return await api.getPublicSharePayload({ handle, slug });
  } catch {
    return null;
  }
}

export default async function OpenGraphImage({
  params,
}: RouteParams): Promise<ImageResponse> {
  const payload = await tryFetchPayload(params.handle, params.slug);
  return new ImageResponse(renderOgCard(params, payload), {
    width: size.width,
    height: size.height,
  });
}

/** Exported for unit tests — pure (no I/O, just JSX). */
export function renderOgCard(
  params: { handle: string; slug: string },
  payload: PublicSharePayload | null,
): React.ReactElement {
  const ownerLabel =
    payload?.owner.displayName ?? `@${payload?.owner.handle ?? params.handle}`;
  const title = payload?.collectionTitle ?? `@${params.handle} on Binderly`;
  const tally =
    payload !== null
      ? formatHeaderTally(
          payload.counts.ownedUnique,
          payload.counts.catalogTotal,
          payload.counts.completionPct,
        )
      : 'A Binderly shareable';
  const updated =
    payload !== null ? `Updated ${formatLastUpdated(payload.lastUpdatedAt)}` : null;
  const url = publicShareUrl(params.handle, params.slug);

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '64px',
        backgroundColor: '#0b0b0d',
        color: '#ffffff',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <div
          style={{
            width: '56px',
            height: '56px',
            borderRadius: '12px',
            backgroundColor: '#4f46e5',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '28px',
            fontWeight: 700,
          }}
        >
          B
        </div>
        <div style={{ fontSize: '28px', fontWeight: 600, letterSpacing: '-0.5px' }}>
          Binderly
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ fontSize: '24px', color: '#a1a1aa' }}>{ownerLabel}</div>
        <div
          style={{
            fontSize: '64px',
            fontWeight: 700,
            lineHeight: 1.1,
            letterSpacing: '-1px',
          }}
        >
          {title}
        </div>
        <div style={{ fontSize: '32px', color: '#d4d4d8' }}>{tally}</div>
        {updated !== null ? (
          <div style={{ fontSize: '20px', color: '#71717a' }}>{updated}</div>
        ) : null}
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          color: '#71717a',
          fontSize: '20px',
        }}
      >
        <div>binderly.app{url}</div>
        <div>Powered by Binderly</div>
      </div>
    </div>
  );
}
