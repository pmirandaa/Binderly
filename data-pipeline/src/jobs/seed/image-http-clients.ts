// Production-wiring helpers for the image-pipeline HTTP layer.
//
// TCGdex and PTCGIO each split their public surface across two
// hostnames: a JSON API host (`api.tcgdex.net`, `api.pokemontcg.io`)
// and a static-asset CDN host (`assets.tcgdex.net`,
// `images.pokemontcg.io`). The catalog adapters are pinned to the
// API host via their constructor's `RateLimitedClient` arg; the
// image pipeline needs SEPARATE clients pinned to the CDN hosts
// because `RateLimitedClient.executeWithRetries` enforces a
// per-host check (`u.host !== this.host` → throws). See Q-005.
//
// This module owns:
//
//   - `createImagePipelineHttpClients`: factory for the two CDN
//     clients keyed by source family (tcgdex / ptcgio).
//   - `buildImageHttpProvider`: maps `ImageSource` → CDN client,
//     conforming to `ImageHttpProvider` consumed by
//     `runImagePipelineForPrintings`.
//
// Tests live next to this file in `image-http-clients.test.ts`.
// The seed CLI (`data-pipeline/scripts/seed.ts`) wires both helpers
// in `buildProductionWiring()` so the test surface and the live
// surface are the same code path.

import { type ImageHttpProvider } from './image-pipeline-runner.js';
import {
  PTCGIO_ASSETS_HOST,
  PTCGIO_DEFAULT_BURST,
  PTCGIO_DEFAULT_RPS,
} from '../../adapters/ptcgio/index.js';
import {
  TCGDEX_ASSETS_HOST,
  TCGDEX_DEFAULT_BURST,
  TCGDEX_DEFAULT_RPS,
} from '../../adapters/tcgdex-en/index.js';
import { RateLimitedClient } from '../../http/rate-limited-client.js';
import { type ImageSource } from '../../images/index.js';

/**
 * Container for the per-host CDN clients used by the image pipeline.
 * Two clients: one for TCGdex (shared by EN + JP because the
 * `assets.tcgdex.net` CDN serves both), one for PTCGIO. Other
 * sources (`bulbapedia-en`, `pokemoncard-jp`) do not currently flow
 * through this provider — Bulbapedia is excluded by license posture
 * and pokemoncard-jp's adapter does not yet emit `imageSourceUrl`.
 */
export interface ImagePipelineHttpClients {
  readonly tcgdexAssets: RateLimitedClient;
  readonly ptcgioAssets: RateLimitedClient;
}

export interface CreateImagePipelineHttpClientsOptions {
  /** User-Agent passed verbatim to every CDN request. Required. */
  readonly userAgent: string;
  /**
   * Override the TCGdex CDN client's `RateLimitedClient` config.
   * Defaults match the API client (`TCGDEX_DEFAULT_RPS` /
   * `TCGDEX_DEFAULT_BURST`). The CDN tolerates much higher rates,
   * but matching the API rate keeps the run-time bounded by the
   * slower upstream and avoids surprising the seed-ingest report.
   */
  readonly tcgdexOverrides?: Partial<
    Omit<ConstructorParameters<typeof RateLimitedClient>[0], 'host' | 'userAgent'>
  >;
  /** Same as `tcgdexOverrides`, for PTCGIO (`images.pokemontcg.io`). */
  readonly ptcgioOverrides?: Partial<
    Omit<ConstructorParameters<typeof RateLimitedClient>[0], 'host' | 'userAgent'>
  >;
}

/**
 * Build the per-host CDN clients with sensible defaults. The seed
 * CLI calls this once per run and registers the returned clients'
 * `stop()` methods in its `closeFns` chain so Bottleneck drains
 * cleanly at process exit.
 */
export function createImagePipelineHttpClients(
  options: CreateImagePipelineHttpClientsOptions,
): ImagePipelineHttpClients {
  const tcgdexAssets = new RateLimitedClient({
    host: TCGDEX_ASSETS_HOST,
    requestsPerSecond: TCGDEX_DEFAULT_RPS,
    burst: TCGDEX_DEFAULT_BURST,
    userAgent: options.userAgent,
    ...(options.tcgdexOverrides ?? {}),
  });
  const ptcgioAssets = new RateLimitedClient({
    host: PTCGIO_ASSETS_HOST,
    requestsPerSecond: PTCGIO_DEFAULT_RPS,
    burst: PTCGIO_DEFAULT_BURST,
    userAgent: options.userAgent,
    ...(options.ptcgioOverrides ?? {}),
  });
  return { tcgdexAssets, ptcgioAssets };
}

/**
 * Map an `ImageSource` to the CDN client that owns its image host.
 * Returns `null` for sources we intentionally do not fetch images
 * from (Bulbapedia by license, pokemoncard-jp by adapter posture).
 * The runner translates `null` to `skipped_excluded_source`.
 */
export function buildImageHttpProvider(clients: ImagePipelineHttpClients): ImageHttpProvider {
  return {
    forSource(source: ImageSource): RateLimitedClient | null {
      if (source === 'tcgdex-en' || source === 'tcgdex-jp') return clients.tcgdexAssets;
      if (source === 'ptcgio') return clients.ptcgioAssets;
      return null;
    },
  };
}
