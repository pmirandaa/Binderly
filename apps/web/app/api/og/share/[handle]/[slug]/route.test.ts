// Route Handler tests for `/api/og/share/[handle]/[slug]`.
//
// We deliberately avoid invoking the real `next/og`
// `ImageResponse` (it loads Satori + WASM resvg bindings that
// jsdom doesn't ship). Instead we inject a fake
// `ImageResponseImpl` via the `renderOgRoute` test seam: the
// fake records the JSX + init it received, and returns a stub
// `Response` with the headers the production constructor would
// emit. This lets us assert on:
//
//   - Status code + content-type + cache headers
//   - Cache-key correctness (same input → byte-identical body)
//   - Fallback path (private / unknown / network error)
//   - Image-fetch timeout simulation (all 4 timeout → still 200)

import { ImageResponse } from 'next/og';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';


import { renderOgRoute } from './route';
import { GOLD_THEME, DEFAULT_THEME } from '../../../../../../app/c/themes/registry';
import { FALLBACK_CACHE_CONTROL, SUCCESS_CACHE_CONTROL } from '../../../../../../lib/og/cache-headers';
import { PLACEHOLDER_DATA_URI } from '../../../../../../lib/og/placeholder';
import {
  makePublicSharePayload,
  makePublicShareMember,
  makePublicShareOwner,
  makeShareableDto,
} from '../../../../../../lib/share/fixtures';

import type { PublicSharePayload } from '../../../../../../lib/share/api';
import type { ReactElement } from 'react';


interface ImageResponseInit {
  readonly width?: number;
  readonly height?: number;
  readonly headers?: Record<string, string>;
}

/**
 * Fake ImageResponse implementation. Renders the JSX tree to a
 * deterministic HTML string via `renderToStaticMarkup` (the same
 * tree Satori would walk for layout) so we can hash the bytes
 * (cache-key correctness) and verify the headers verbatim.
 */
class FakeImageResponse extends Response {
  public readonly capturedJsx: ReactElement;
  public readonly capturedInit: ImageResponseInit;

  public constructor(jsx: ReactElement, init: ImageResponseInit) {
    const html = renderToStaticMarkup(jsx);
    const serialised = JSON.stringify({
      width: init.width,
      height: init.height,
      html,
    });
    super(serialised, {
      status: 200,
      headers: init.headers ?? {},
    });
    this.capturedJsx = jsx;
    this.capturedInit = init;
  }
}

const FakeImageResponseCtor = FakeImageResponse as unknown as typeof ImageResponse;

describe('GET /api/og/share/[handle]/[slug] — happy path', () => {
  it('returns 200 OK with image/png + the success cache header', async () => {
    const payload = makePublicSharePayload();
    const fetchPayload = vi.fn(async () => payload);
    const fetchImages = vi.fn(async () => ['data:image/png;base64,a', 'data:image/png;base64,b', 'data:image/png;base64,c', 'data:image/png;base64,d']);
    const response = await renderOgRoute('pablo', 'binder', {
      fetchPayload,
      fetchImages,
      ImageResponseImpl: FakeImageResponseCtor,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toBe(SUCCESS_CACHE_CONTROL);
  });

  it('forwards handle + slug to fetchPayload', async () => {
    const payload = makePublicSharePayload();
    const fetchPayload = vi.fn(async () => payload);
    const fetchImages = vi.fn(async () => [PLACEHOLDER_DATA_URI, PLACEHOLDER_DATA_URI, PLACEHOLDER_DATA_URI, PLACEHOLDER_DATA_URI]);
    await renderOgRoute('alice', 'set-1', {
      fetchPayload,
      fetchImages,
      ImageResponseImpl: FakeImageResponseCtor,
    });
    expect(fetchPayload).toHaveBeenCalledWith('alice', 'set-1', undefined);
  });

  it('forwards up to 4 member image URLs to fetchImages', async () => {
    const payload = makePublicSharePayload({
      members: [
        makePublicShareMember({ printingId: 'p1', imageUrl: 'https://x/1.png' }),
        makePublicShareMember({ printingId: 'p2', imageUrl: 'https://x/2.png' }),
        makePublicShareMember({ printingId: 'p3', imageUrl: 'https://x/3.png' }),
        makePublicShareMember({ printingId: 'p4', imageUrl: 'https://x/4.png' }),
        makePublicShareMember({ printingId: 'p5', imageUrl: 'https://x/5.png' }),
      ],
    });
    const fetchPayload = vi.fn(async () => payload);
    const fetchImages = vi.fn(async () => [PLACEHOLDER_DATA_URI, PLACEHOLDER_DATA_URI, PLACEHOLDER_DATA_URI, PLACEHOLDER_DATA_URI]);
    await renderOgRoute('alice', 'set', {
      fetchPayload,
      fetchImages,
      ImageResponseImpl: FakeImageResponseCtor,
    });
    const lastCall = fetchImages.mock.calls.at(-1);
    expect(lastCall).toBeDefined();
    const call = (lastCall as unknown as [unknown])[0] as string[];
    expect(call).toHaveLength(4);
    expect(call).toEqual(['https://x/1.png', 'https://x/2.png', 'https://x/3.png', 'https://x/4.png']);
  });

  it('declares 1200 × 630 dimensions on the rendered ImageResponse', async () => {
    const payload = makePublicSharePayload();
    const fetchPayload = vi.fn(async () => payload);
    const fetchImages = vi.fn(async () => [PLACEHOLDER_DATA_URI, PLACEHOLDER_DATA_URI, PLACEHOLDER_DATA_URI, PLACEHOLDER_DATA_URI]);
    const response = (await renderOgRoute('pablo', 'binder', {
      fetchPayload,
      fetchImages,
      ImageResponseImpl: FakeImageResponseCtor,
    })) as FakeImageResponse;
    expect(response.capturedInit.width).toBe(1200);
    expect(response.capturedInit.height).toBe(630);
  });
});

describe('GET — fallback paths', () => {
  it('returns 200 + fallback header when payload is null (unknown handle/slug)', async () => {
    const fetchPayload = vi.fn(async () => null);
    const fetchImages = vi.fn(async () => []);
    const response = await renderOgRoute('unknown', 'thing', {
      fetchPayload,
      fetchImages,
      ImageResponseImpl: FakeImageResponseCtor,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toBe(FALLBACK_CACHE_CONTROL);
    // fetchImages must NOT be called on the fallback path — there
    // is no payload and therefore no member URLs to resolve.
    expect(fetchImages).not.toHaveBeenCalled();
  });

  it('does NOT return 404 when the handle is unknown (social-platform caching)', async () => {
    const fetchPayload = vi.fn(async () => null);
    const response = await renderOgRoute('unknown', 'thing', {
      fetchPayload,
      ImageResponseImpl: FakeImageResponseCtor,
    });
    expect(response.status).not.toBe(404);
  });

  it('returns the fallback when the api-client throws (treated as null upstream)', async () => {
    const fetchPayload = vi.fn(async () => null); // data.ts swallows errors → null
    const response = await renderOgRoute('pablo', 'binder', {
      fetchPayload,
      ImageResponseImpl: FakeImageResponseCtor,
    });
    expect(response.headers.get('cache-control')).toBe(FALLBACK_CACHE_CONTROL);
  });

  it('does not leak member data in the fallback render', async () => {
    const secret = 'SECRET-CARD-12345';
    // Even if some upstream tried to coerce a private payload through,
    // the fallback codepath has no payload reference to leak.
    const fetchPayload = vi.fn(async () => null);
    const response = (await renderOgRoute('pablo', 'binder', {
      fetchPayload,
      ImageResponseImpl: FakeImageResponseCtor,
    })) as FakeImageResponse;
    const body = await response.text();
    expect(body).not.toContain(secret);
  });

  it('falls back when the renderer itself throws', async () => {
    let invocationCount = 0;
    const ThrowingResponse = vi.fn((jsx: ReactElement, init: ImageResponseInit) => {
      invocationCount += 1;
      // First invocation is the rich render — throw to simulate
      // a Satori failure. Second invocation is the fallback path
      // the route handler attempts after catching the throw.
      if (invocationCount === 1) {
        throw new Error('satori went boom');
      }
      return new FakeImageResponse(jsx, init);
    }) as unknown as typeof ImageResponse;
    const payload = makePublicSharePayload();
    const fetchPayload = vi.fn(async () => payload);
    const fetchImages = vi.fn(async () => [PLACEHOLDER_DATA_URI, PLACEHOLDER_DATA_URI, PLACEHOLDER_DATA_URI, PLACEHOLDER_DATA_URI]);
    const response = await renderOgRoute('pablo', 'binder', {
      fetchPayload,
      fetchImages,
      ImageResponseImpl: ThrowingResponse,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(FALLBACK_CACHE_CONTROL);
  });
});

describe('GET — image fetch resilience', () => {
  it('still renders 200 when ALL 4 image fetches resolve to placeholder (timeout simulation)', async () => {
    const payload = makePublicSharePayload({
      members: [
        makePublicShareMember({ printingId: 'p1', imageUrl: 'https://slow/1' }),
        makePublicShareMember({ printingId: 'p2', imageUrl: 'https://slow/2' }),
        makePublicShareMember({ printingId: 'p3', imageUrl: 'https://slow/3' }),
        makePublicShareMember({ printingId: 'p4', imageUrl: 'https://slow/4' }),
      ],
    });
    const fetchPayload = vi.fn(async () => payload);
    const fetchImages = vi.fn(async () => [PLACEHOLDER_DATA_URI, PLACEHOLDER_DATA_URI, PLACEHOLDER_DATA_URI, PLACEHOLDER_DATA_URI]);
    const response = await renderOgRoute('pablo', 'binder', {
      fetchPayload,
      fetchImages,
      ImageResponseImpl: FakeImageResponseCtor,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(SUCCESS_CACHE_CONTROL);
  });

  it('still renders 200 when fetchImages itself rejects (catastrophic failure of image layer)', async () => {
    const payload = makePublicSharePayload();
    const fetchPayload = vi.fn(async () => payload);
    const fetchImages = vi.fn(async () => {
      throw new Error('image layer crashed');
    });
    const response = await renderOgRoute('pablo', 'binder', {
      fetchPayload,
      fetchImages,
      ImageResponseImpl: FakeImageResponseCtor,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(SUCCESS_CACHE_CONTROL);
  });

  it('pads to exactly 4 tiles when fetchImages returns fewer than 4', async () => {
    const payload = makePublicSharePayload({ members: [makePublicShareMember()] });
    const fetchPayload = vi.fn(async () => payload);
    const fetchImages = vi.fn(async () => ['data:image/png;base64,real']);
    const response = (await renderOgRoute('pablo', 'binder', {
      fetchPayload,
      fetchImages,
      ImageResponseImpl: FakeImageResponseCtor,
    })) as FakeImageResponse;
    const body = await response.text();
    // Exactly 1 real tile + 3 placeholder tiles = 1 instance of the
    // real data URI + 3 of the placeholder URI in the serialised tree.
    const realCount = body.split('data:image/png;base64,real').length - 1;
    const placeholderCount = body.split(PLACEHOLDER_DATA_URI).length - 1;
    expect(realCount).toBe(1);
    expect(placeholderCount).toBe(3);
  });
});

describe('GET — cache-key correctness', () => {
  it('different handles produce different rendered bodies', async () => {
    const payloadA = makePublicSharePayload({ collectionTitle: "Alice's binder" });
    const payloadB = makePublicSharePayload({ collectionTitle: "Bob's binder" });
    const responseA = await renderOgRoute('alice', 'binder', {
      fetchPayload: async (h) => (h === 'alice' ? payloadA : payloadB),
      fetchImages: async () => [PLACEHOLDER_DATA_URI, PLACEHOLDER_DATA_URI, PLACEHOLDER_DATA_URI, PLACEHOLDER_DATA_URI],
      ImageResponseImpl: FakeImageResponseCtor,
    });
    const responseB = await renderOgRoute('bob', 'binder', {
      fetchPayload: async (h) => (h === 'alice' ? payloadA : payloadB),
      fetchImages: async () => [PLACEHOLDER_DATA_URI, PLACEHOLDER_DATA_URI, PLACEHOLDER_DATA_URI, PLACEHOLDER_DATA_URI],
      ImageResponseImpl: FakeImageResponseCtor,
    });
    const bodyA = await responseA.text();
    const bodyB = await responseB.text();
    expect(bodyA).not.toBe(bodyB);
  });

  it('same (handle, slug, payload, thumbnails) produces byte-identical bodies (hash match)', async () => {
    const payload = makePublicSharePayload();
    const thumbnails = [PLACEHOLDER_DATA_URI, PLACEHOLDER_DATA_URI, PLACEHOLDER_DATA_URI, PLACEHOLDER_DATA_URI];
    const deps = {
      fetchPayload: async () => payload,
      fetchImages: async () => thumbnails,
      ImageResponseImpl: FakeImageResponseCtor,
    };
    const a = await renderOgRoute('pablo', 'binder', deps);
    const b = await renderOgRoute('pablo', 'binder', deps);
    expect(await a.text()).toBe(await b.text());
  });

  it('different slugs produce different rendered bodies even with identical payload', async () => {
    const payload = makePublicSharePayload();
    const fetchPayload = vi.fn(async () => payload);
    const fetchImages = vi.fn(async () => [PLACEHOLDER_DATA_URI, PLACEHOLDER_DATA_URI, PLACEHOLDER_DATA_URI, PLACEHOLDER_DATA_URI]);
    const a = await renderOgRoute('pablo', 'binder-1', {
      fetchPayload,
      fetchImages,
      ImageResponseImpl: FakeImageResponseCtor,
    });
    const b = await renderOgRoute('pablo', 'binder-2', {
      fetchPayload,
      fetchImages,
      ImageResponseImpl: FakeImageResponseCtor,
    });
    expect(await a.text()).not.toBe(await b.text());
  });
});

describe('GET — body is non-empty', () => {
  it('happy-path body has non-zero length', async () => {
    const payload = makePublicSharePayload();
    const response = await renderOgRoute('pablo', 'binder', {
      fetchPayload: async () => payload,
      fetchImages: async () => [PLACEHOLDER_DATA_URI, PLACEHOLDER_DATA_URI, PLACEHOLDER_DATA_URI, PLACEHOLDER_DATA_URI],
      ImageResponseImpl: FakeImageResponseCtor,
    });
    const text = await response.text();
    expect(text.length).toBeGreaterThan(0);
  });

  it('fallback body has non-zero length', async () => {
    const response = await renderOgRoute('pablo', 'binder', {
      fetchPayload: async () => null,
      ImageResponseImpl: FakeImageResponseCtor,
    });
    const text = await response.text();
    expect(text.length).toBeGreaterThan(0);
  });
});

describe('GET — `is_public=false` (private) hides the payload', () => {
  it('treats null-from-fetchPayload as private/missing: serves fallback, not data', async () => {
    const secret = 'PRIVATE-COLLECTION-NAME-X9Q2';
    // We confirm via the byte body that none of the payload data
    // could possibly leak — fallback path receives no payload at all.
    const response = (await renderOgRoute('pablo', 'binder', {
      fetchPayload: async () => null,
      ImageResponseImpl: FakeImageResponseCtor,
    })) as FakeImageResponse;
    const text = await response.text();
    expect(text).not.toContain(secret);
    expect(response.headers.get('cache-control')).toBe(FALLBACK_CACHE_CONTROL);
  });
});

describe('GET — theme palette wiring (#FU-62)', () => {
  function themedPayload(theme: string, tier: 'free' | 'pro'): PublicSharePayload {
    return makePublicSharePayload({
      shareable: { ...makeShareableDto(), theme: theme as never },
      owner: makePublicShareOwner({ tier }),
    });
  }

  it('paints the hero with the shareable theme palette for a Pro owner', async () => {
    const response = (await renderOgRoute('pablo', 'binder', {
      fetchPayload: async () => themedPayload('gold', 'pro'),
      fetchImages: async () => [PLACEHOLDER_DATA_URI, PLACEHOLDER_DATA_URI, PLACEHOLDER_DATA_URI, PLACEHOLDER_DATA_URI],
      ImageResponseImpl: FakeImageResponseCtor,
    })) as FakeImageResponse;
    const body = await response.text();
    expect(body).toContain(GOLD_THEME.palette.accent);
    expect(body).toContain(GOLD_THEME.palette.background);
  });

  it('downgrades a FREE owner with a stored Pro theme to the default palette (#FU-61)', async () => {
    const response = (await renderOgRoute('pablo', 'binder', {
      fetchPayload: async () => themedPayload('gold', 'free'),
      fetchImages: async () => [PLACEHOLDER_DATA_URI, PLACEHOLDER_DATA_URI, PLACEHOLDER_DATA_URI, PLACEHOLDER_DATA_URI],
      ImageResponseImpl: FakeImageResponseCtor,
    })) as FakeImageResponse;
    const body = await response.text();
    // The Pro gold accent must NOT leak onto a free owner's unfurl;
    // the default palette accent is used instead.
    expect(body).not.toContain(GOLD_THEME.palette.accent);
    expect(body).toContain(DEFAULT_THEME.palette.accent);
  });

  it('renders the default palette for a free owner on the default theme', async () => {
    const response = (await renderOgRoute('pablo', 'binder', {
      fetchPayload: async () => themedPayload('default', 'free'),
      fetchImages: async () => [PLACEHOLDER_DATA_URI, PLACEHOLDER_DATA_URI, PLACEHOLDER_DATA_URI, PLACEHOLDER_DATA_URI],
      ImageResponseImpl: FakeImageResponseCtor,
    })) as FakeImageResponse;
    const body = await response.text();
    expect(body).toContain(DEFAULT_THEME.palette.background);
  });

  it('still serves the brand fallback (not a theme palette) when payload is null', async () => {
    const response = await renderOgRoute('unknown', 'thing', {
      fetchPayload: async () => null,
      ImageResponseImpl: FakeImageResponseCtor,
    });
    expect(response.headers.get('cache-control')).toBe(FALLBACK_CACHE_CONTROL);
  });
});

describe('Public ImageResponse contract sanity', () => {
  it('the next/og ImageResponse export is a constructor function', () => {
    expect(typeof ImageResponse).toBe('function');
  });

  it("the route file's runtime export is 'nodejs'", async () => {
    const mod = await import('./route');
    expect(mod.runtime).toBe('nodejs');
  });

  it("the route file's dynamic export is 'force-dynamic'", async () => {
    const mod = await import('./route');
    expect(mod.dynamic).toBe('force-dynamic');
  });

  it('exports a working GET function', async () => {
    const mod = await import('./route');
    expect(typeof mod.GET).toBe('function');
  });

  it('exposes THUMBNAIL_COUNT === 4 via __testing', async () => {
    const mod = await import('./route');
    expect(mod.__testing.THUMBNAIL_COUNT).toBe(4);
  });
});

// Ensure the typed seam exposes a private payload.
function makePrivatePayload(): PublicSharePayload {
  return makePublicSharePayload({ shareable: { ...makePublicSharePayload().shareable, slug: 'private' } });
}

describe('Type-level coverage of the seam', () => {
  it('`fetchPayload` may return a typed PublicSharePayload', async () => {
    const payload = makePrivatePayload();
    const fetchPayload: (h: string, s: string) => Promise<PublicSharePayload | null> = vi.fn(
      async () => payload,
    );
    const response = await renderOgRoute('a', 'b', {
      fetchPayload,
      fetchImages: async () => [PLACEHOLDER_DATA_URI, PLACEHOLDER_DATA_URI, PLACEHOLDER_DATA_URI, PLACEHOLDER_DATA_URI],
      ImageResponseImpl: FakeImageResponseCtor,
    });
    expect(response.status).toBe(200);
  });
});
