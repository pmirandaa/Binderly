// Resilient image fetcher for the OG renderer.
//
// Satori (the engine behind `next/og` `ImageResponse`) needs
// **in-memory** image bytes — it cannot fetch a URL itself when
// rendering. This module fetches up to N image URLs in parallel,
// converts each to a `data:` URI, and returns one URI per input
// slot. Any individual failure (timeout, network error, non-2xx,
// invalid content-type) is caught and replaced with a placeholder
// silhouette URI so the surrounding render never throws.
//
// Design notes:
//
//   - Per-image timeout: 2 s (configurable). The total OG render
//     budget is < 3 s so 4 parallel image fetches at 2 s each leave
//     ~1 s of head-room for Satori + PNG encode.
//   - We deliberately do NOT consume the whole `members` list —
//     callers slice to ≤ 4 first. The cap is part of the visual
//     spec (lower-third row holds 4 tiles) and bounds total memory.
//   - `null` / non-string slots resolve straight to the placeholder
//     URI without making a request.
//   - Cache scope is per-render. Repeated renders re-fetch images;
//     the route handler's `Cache-Control` keeps the encoded PNG hot
//     at the CDN so repeated loads of the SAME share URL reuse the
//     fully-rendered output, not the underlying image bytes.

import { PLACEHOLDER_DATA_URI } from './placeholder';

/** A `fetch`-shaped function — same minimal subset the api-client uses. */
export type ImageFetchLike = (
  input: string | URL,
  init?: { signal?: AbortSignal },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { readonly get: (name: string) => string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export interface FetchThumbnailOptions {
  /** Per-image timeout. Default: 2000 ms. */
  readonly timeoutMs?: number;
  /** Override `globalThis.fetch` — used by tests. */
  readonly fetch?: ImageFetchLike;
  /** Maximum number of slots to resolve. Default: 4. */
  readonly maxSlots?: number;
  /**
   * Optional outer `AbortSignal` (e.g. from the route handler's
   * total render budget). When it fires, all in-flight image
   * fetches resolve to the placeholder — same fail-soft behaviour
   * as a per-image timeout.
   */
  readonly signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 2000;
const DEFAULT_MAX_SLOTS = 4;

/**
 * Resolve an array of image URLs (or nulls) into an array of
 * `data:` URIs. The output array always has length
 * `min(urls.length, maxSlots)` and never contains failures —
 * any error pre-pads with the placeholder silhouette URI.
 *
 * @example
 * await fetchThumbnails([
 *   'https://images.binderly.app/p/1.webp',
 *   null,
 *   'https://offline.example/p/2.webp', // times out → placeholder
 * ]);
 * // => ['data:image/webp;base64,...', '<placeholder>', '<placeholder>']
 */
export async function fetchThumbnails(
  urls: ReadonlyArray<string | null>,
  options: FetchThumbnailOptions = {},
): Promise<string[]> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxSlots = options.maxSlots ?? DEFAULT_MAX_SLOTS;
  const fetchImpl = options.fetch ?? resolveGlobalFetch();

  const slice = urls.slice(0, maxSlots);
  const tasks = slice.map((url) =>
    resolveOne(url, fetchImpl, timeoutMs, options.signal),
  );
  return Promise.all(tasks);
}

async function resolveOne(
  url: string | null,
  fetchImpl: ImageFetchLike,
  timeoutMs: number,
  outerSignal: AbortSignal | undefined,
): Promise<string> {
  if (url === null || typeof url !== 'string' || url.length === 0) {
    return PLACEHOLDER_DATA_URI;
  }
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  const onOuterAbort = (): void => controller.abort();
  if (outerSignal !== undefined) {
    if (outerSignal.aborted) controller.abort();
    else outerSignal.addEventListener('abort', onOuterAbort, { once: true });
  }

  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) return PLACEHOLDER_DATA_URI;
    const contentType = response.headers.get('content-type') ?? 'image/png';
    if (!isAllowedImageContentType(contentType)) return PLACEHOLDER_DATA_URI;
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0) return PLACEHOLDER_DATA_URI;
    const base64 = arrayBufferToBase64(buffer);
    const cleanType = contentType.split(';')[0]?.trim() ?? 'image/png';
    return `data:${cleanType};base64,${base64}`;
  } catch {
    return PLACEHOLDER_DATA_URI;
  } finally {
    clearTimeout(timeoutHandle);
    if (outerSignal !== undefined) {
      outerSignal.removeEventListener('abort', onOuterAbort);
    }
  }
}

/**
 * Allowed Satori-input content types. `image/svg+xml` is
 * deliberately excluded — Satori renders SVG sources differently
 * to raster-image bytes and we don't want a card thumbnail URL
 * sneaking SVG into the OG card. PNG / JPEG / WebP / GIF cover
 * every realistic catalog asset.
 */
function isAllowedImageContentType(contentType: string): boolean {
  const lower = contentType.toLowerCase();
  return (
    lower.startsWith('image/png') ||
    lower.startsWith('image/jpeg') ||
    lower.startsWith('image/jpg') ||
    lower.startsWith('image/webp') ||
    lower.startsWith('image/gif')
  );
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bufferRef = (globalThis as {
    Buffer?: { from: (b: ArrayBuffer) => { toString: (e: string) => string } };
  }).Buffer;
  if (bufferRef !== undefined) return bufferRef.from(buffer).toString('base64');
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i] as number);
  }
  const btoaRef = (globalThis as { btoa?: (s: string) => string }).btoa;
  if (btoaRef === undefined) {
    throw new Error('Neither Buffer nor btoa is available in this runtime.');
  }
  return btoaRef(binary);
}

function resolveGlobalFetch(): ImageFetchLike {
  const fetchRef = (globalThis as { fetch?: ImageFetchLike }).fetch;
  if (fetchRef === undefined) {
    throw new Error('No global `fetch` available; pass options.fetch explicitly.');
  }
  return fetchRef;
}
