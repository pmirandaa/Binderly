// Unit tests for the image-pipeline HTTP wiring helpers.
//
// These tests pin the regression that motivated Q-005: the seed
// CLI used to share the catalog API client (`api.tcgdex.net`) for
// image fetches against `assets.tcgdex.net`, and the per-host
// guard in `RateLimitedClient` correctly rejected every call.
// The helpers under test build dedicated CDN clients and route
// each `ImageSource` to the matching CDN client.

import { afterEach, describe, expect, it } from 'vitest';

import {
  buildImageHttpProvider,
  createImagePipelineHttpClients,
  type ImagePipelineHttpClients,
} from './image-http-clients.js';
import { PTCGIO_ASSETS_HOST } from '../../adapters/ptcgio/index.js';
import { TCGDEX_ASSETS_HOST } from '../../adapters/tcgdex-en/index.js';

const UA = 'BinderlyTest/0.0.1 (contact: test@binderly.app)';

let tracked: ImagePipelineHttpClients | null = null;

afterEach(async () => {
  if (tracked) {
    await Promise.all([tracked.tcgdexAssets.stop(), tracked.ptcgioAssets.stop()]);
    tracked = null;
  }
});

describe('createImagePipelineHttpClients', () => {
  it('pins the TCGdex CDN client to assets.tcgdex.net', () => {
    tracked = createImagePipelineHttpClients({ userAgent: UA });
    expect(tracked.tcgdexAssets.host).toBe('assets.tcgdex.net');
    expect(tracked.tcgdexAssets.host).toBe(TCGDEX_ASSETS_HOST);
  });

  it('pins the PTCGIO CDN client to images.pokemontcg.io', () => {
    tracked = createImagePipelineHttpClients({ userAgent: UA });
    expect(tracked.ptcgioAssets.host).toBe('images.pokemontcg.io');
    expect(tracked.ptcgioAssets.host).toBe(PTCGIO_ASSETS_HOST);
  });

  it('passes the User-Agent through to both CDN clients', () => {
    tracked = createImagePipelineHttpClients({ userAgent: UA });
    expect(tracked.tcgdexAssets.userAgent).toBe(UA);
    expect(tracked.ptcgioAssets.userAgent).toBe(UA);
  });
});

describe('buildImageHttpProvider', () => {
  it('routes tcgdex-en + tcgdex-jp to the assets.tcgdex.net client (Q-005 regression)', () => {
    tracked = createImagePipelineHttpClients({ userAgent: UA });
    const provider = buildImageHttpProvider(tracked);
    const en = provider.forSource('tcgdex-en');
    const jp = provider.forSource('tcgdex-jp');
    expect(en).not.toBeNull();
    expect(jp).not.toBeNull();
    expect(en?.host).toBe('assets.tcgdex.net');
    expect(jp?.host).toBe('assets.tcgdex.net');
    // Both languages share the single CDN client; verify it's the
    // exact same instance so we don't double-rate-limit the host.
    expect(en).toBe(jp);
    expect(en).toBe(tracked.tcgdexAssets);
  });

  it('routes ptcgio to the images.pokemontcg.io client (Q-005 regression)', () => {
    tracked = createImagePipelineHttpClients({ userAgent: UA });
    const provider = buildImageHttpProvider(tracked);
    const ptcgio = provider.forSource('ptcgio');
    expect(ptcgio).not.toBeNull();
    expect(ptcgio?.host).toBe('images.pokemontcg.io');
    expect(ptcgio).toBe(tracked.ptcgioAssets);
  });

  it('returns null for sources whose images we do not fetch', () => {
    tracked = createImagePipelineHttpClients({ userAgent: UA });
    const provider = buildImageHttpProvider(tracked);
    expect(provider.forSource('bulbapedia-en')).toBeNull();
    expect(provider.forSource('pokemoncard-jp')).toBeNull();
  });

  it('never returns a client whose host equals the API host (root cause guard)', () => {
    tracked = createImagePipelineHttpClients({ userAgent: UA });
    const provider = buildImageHttpProvider(tracked);
    for (const source of ['tcgdex-en', 'tcgdex-jp', 'ptcgio'] as const) {
      const client = provider.forSource(source);
      expect(client?.host).not.toBe('api.tcgdex.net');
      expect(client?.host).not.toBe('api.pokemontcg.io');
    }
  });
});
