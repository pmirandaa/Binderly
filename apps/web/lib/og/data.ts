// Server-side share-payload fetcher for the OG route.
//
// Same shape as `apps/web/app/c/[handle]/[slug]/opengraph-image.tsx`'s
// `tryFetchPayload` helper but extracted here so the route
// handler + tests can inject a stub `ShareApi` directly without
// reaching into the api-client / Supabase singletons.
//
// Why this lives in `lib/og/` instead of `lib/share/`:
// `lib/share/` is owned by T-W-SHAREABLE-PUBLIC; T-SH-OG-IMAGES
// owns `lib/og/`. The new fetcher is logically a wafer-thin
// composition over the existing `apiToShareApi(client)` adapter
// — it adds (a) a hard outer timeout and (b) error swallowing
// so the route handler never bubbles a 5xx to the social
// crawler.

import type { PublicSharePayload, ShareApi } from '../share/api';

export interface FetchOgPayloadOptions {
  /** Override the share-api adapter — used by tests. */
  readonly shareApi?: ShareApi;
  /** Hard outer deadline. Default: 2500 ms. */
  readonly timeoutMs?: number;
  /** Optional outer abort. */
  readonly signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 2500;

/**
 * Fetch the public share payload for `(handle, slug)`. Returns
 * `null` on any failure mode the OG route should treat as
 * "render the fallback":
 *
 *   - Adapter throws (api-client construction failure, network
 *     error, 5xx, decode error, …).
 *   - Adapter returns `null` (404 sentinel — handle/slug doesn't
 *     resolve OR `is_public=false`).
 *   - Outer timeout elapses.
 *
 * Importantly the route handler MUST NOT propagate errors here:
 * a 5xx OG image is worse UX than a fallback OG image, because
 * social platforms cache 5xx responses and the unfurl never
 * recovers.
 */
export async function fetchOgPayload(
  handle: string,
  slug: string,
  options: FetchOgPayloadOptions = {},
): Promise<PublicSharePayload | null> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const shareApi = options.shareApi ?? (await loadDefaultShareApi());
  if (shareApi === null) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const outer = options.signal;
  const onOuterAbort = (): void => controller.abort();
  if (outer !== undefined) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener('abort', onOuterAbort, { once: true });
  }

  try {
    return await shareApi.getPublicSharePayload({
      handle,
      slug,
      signal: controller.signal,
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    if (outer !== undefined) outer.removeEventListener('abort', onOuterAbort);
  }
}

/**
 * Lazy-construct the production `ShareApi` from the api-client
 * singleton. Returns `null` if the singleton can't be built —
 * happens during `next build` when `NEXT_PUBLIC_SUPABASE_*` are
 * unset for a route that's `force-dynamic`.
 */
async function loadDefaultShareApi(): Promise<ShareApi | null> {
  try {
    const [{ apiToShareApi }, { getApiClient }] = await Promise.all([
      import('../share/api'),
      import('../api-client'),
    ]);
    return apiToShareApi(getApiClient());
  } catch {
    return null;
  }
}
