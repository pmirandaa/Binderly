// `GET /api/og/share/[handle]/[slug]` — dynamic OG image route.
//
// Drives every social unfurl for `/c/[handle]/[slug]`. Resolves
// the public share payload via the V2 Edge endpoint, fetches up
// to 4 thumbnail images in parallel (each capped to a 2 s
// timeout), and returns a 1200×630 PNG via Next.js's stock
// `next/og` `ImageResponse`.
//
// Cache strategy: 1 h browser cache, 1 d shared-CDN cache,
// 1 wk stale-while-revalidate for the success path; 1 h flat
// for the fallback. See `lib/og/cache-headers.ts` for the
// canonical strings.
//
// Failure budget: any error (api-client unavailable, payload
// fetch fails, image fetches fail, render throws) degrades to
// the generic Binderly-branded fallback PNG. The route never
// emits a 4xx/5xx — social platforms cache failures aggressively
// and a new share would be unfurlable for hours after going
// public.

import { ImageResponse } from 'next/og';

import { FALLBACK_CACHE_CONTROL, SUCCESS_CACHE_CONTROL } from '../../../../../../lib/og/cache-headers';
import { fetchOgPayload, type FetchOgPayloadOptions } from '../../../../../../lib/og/data';
import { renderOgFallback } from '../../../../../../lib/og/fallback';
import { fetchThumbnails, type FetchThumbnailOptions } from '../../../../../../lib/og/images';
import { PLACEHOLDER_DATA_URI } from '../../../../../../lib/og/placeholder';
import { OG_SIZE, renderOgImage } from '../../../../../../lib/og/render';

import type { PublicSharePayload } from '../../../../../../lib/share/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Visual spec: lower-third row holds exactly 4 tiles. */
const THUMBNAIL_COUNT = 4;

interface RouteContext {
  readonly params: { readonly handle: string; readonly slug: string };
}

/**
 * Test seam: dependency overrides for {@link renderOgRoute}.
 * Production callers always go through the bare {@link GET}
 * export, which constructs no overrides.
 */
export interface OgRouteDeps {
  readonly fetchPayload?: (
    handle: string,
    slug: string,
    options?: FetchOgPayloadOptions,
  ) => Promise<PublicSharePayload | null>;
  readonly fetchImages?: typeof fetchThumbnails;
  readonly imageOptions?: FetchThumbnailOptions;
  readonly payloadOptions?: FetchOgPayloadOptions;
  /** Override `next/og`'s ImageResponse — used by tests. */
  readonly ImageResponseImpl?: typeof ImageResponse;
}

/**
 * Pure-ish renderer used by both the production GET handler and
 * the route's vitest suite. Composes payload fetch + thumbnail
 * fetch + ImageResponse construction; exposes every external
 * dependency so tests can stub the api-client + image fetcher +
 * `ImageResponse` constructor without touching Satori.
 */
export async function renderOgRoute(
  handle: string,
  slug: string,
  deps: OgRouteDeps = {},
): Promise<Response> {
  const fetchPayload = deps.fetchPayload ?? fetchOgPayload;
  const fetchImages = deps.fetchImages ?? fetchThumbnails;
  const ImageResponseCtor = deps.ImageResponseImpl ?? ImageResponse;

  const payload = await fetchPayload(handle, slug, deps.payloadOptions);

  if (payload === null) {
    return renderFallback(ImageResponseCtor, handle);
  }

  let thumbnailUris: string[] = [];
  try {
    const memberUrls = payload.members
      .slice(0, THUMBNAIL_COUNT)
      .map((m) => m.imageUrl);
    thumbnailUris = await fetchImages(memberUrls, deps.imageOptions);
  } catch {
    thumbnailUris = [];
  }
  // Always pad to exactly 4 tiles so the lower-third row stays
  // visually balanced regardless of `members.length`.
  while (thumbnailUris.length < THUMBNAIL_COUNT) {
    thumbnailUris.push(PLACEHOLDER_DATA_URI);
  }

  try {
    return new ImageResponseCtor(
      renderOgImage({ handle, slug, payload, thumbnailUris }),
      {
        width: OG_SIZE.width,
        height: OG_SIZE.height,
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': SUCCESS_CACHE_CONTROL,
        },
      },
    ) as unknown as Response;
  } catch {
    return renderFallback(ImageResponseCtor, handle);
  }
}

function renderFallback(
  ImageResponseCtor: typeof ImageResponse,
  handle: string,
): Response {
  return new ImageResponseCtor(renderOgFallback({ handle }), {
    width: OG_SIZE.width,
    height: OG_SIZE.height,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': FALLBACK_CACHE_CONTROL,
    },
  }) as unknown as Response;
}

export async function GET(_request: Request, ctx: RouteContext): Promise<Response> {
  return renderOgRoute(ctx.params.handle, ctx.params.slug);
}

export const __testing = {
  THUMBNAIL_COUNT,
};
