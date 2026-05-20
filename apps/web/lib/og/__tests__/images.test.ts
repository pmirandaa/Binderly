import { describe, expect, it, vi } from 'vitest';

import { fetchThumbnails, type ImageFetchLike } from '../images';
import { PLACEHOLDER_DATA_URI } from '../placeholder';

interface ImageResponseInit {
  status?: number;
  contentType?: string;
  bytes?: Uint8Array;
  delayMs?: number;
}

function makeResponse(init: ImageResponseInit = {}): Awaited<ReturnType<ImageFetchLike>> {
  const status = init.status ?? 200;
  const contentType = init.contentType ?? 'image/png';
  const bytes = init.bytes ?? new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string): string | null => {
        if (name.toLowerCase() === 'content-type') return contentType;
        return null;
      },
    },
    arrayBuffer: async (): Promise<ArrayBuffer> => {
      const out = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(out).set(bytes);
      return out;
    },
  };
}

function makeFakeFetch(byUrl: Record<string, ImageResponseInit | (() => Promise<unknown>) | 'timeout'>): ImageFetchLike {
  return vi.fn(async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString();
    const recipe = byUrl[url];
    if (recipe === undefined) {
      // Default: serve a tiny PNG.
      return makeResponse();
    }
    if (recipe === 'timeout') {
      return new Promise((_resolve, reject) => {
        const onAbort = (): void => reject(new Error('aborted'));
        if (init?.signal !== undefined) {
          if (init.signal.aborted) {
            reject(new Error('aborted'));
            return;
          }
          init.signal.addEventListener('abort', onAbort, { once: true });
        }
      }) as ReturnType<ImageFetchLike>;
    }
    if (typeof recipe === 'function') {
      return recipe() as ReturnType<ImageFetchLike>;
    }
    return makeResponse(recipe);
  });
}

describe('fetchThumbnails — happy path', () => {
  it('returns one data URI per input slot when all fetches succeed', async () => {
    const fetchImpl = makeFakeFetch({
      'https://x/1.webp': { contentType: 'image/webp', bytes: new Uint8Array([1, 2, 3]) },
      'https://x/2.png': { contentType: 'image/png', bytes: new Uint8Array([4, 5, 6]) },
    });
    const out = await fetchThumbnails(['https://x/1.webp', 'https://x/2.png'], { fetch: fetchImpl });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatch(/^data:image\/webp;base64,/);
    expect(out[1]).toMatch(/^data:image\/png;base64,/);
  });

  it('caps the output at maxSlots (default 4)', async () => {
    const fetchImpl = makeFakeFetch({});
    const out = await fetchThumbnails(['https://x/1', 'https://x/2', 'https://x/3', 'https://x/4', 'https://x/5'], {
      fetch: fetchImpl,
    });
    expect(out).toHaveLength(4);
  });

  it('honours an explicit maxSlots option', async () => {
    const fetchImpl = makeFakeFetch({});
    const out = await fetchThumbnails(['https://x/1', 'https://x/2', 'https://x/3'], {
      fetch: fetchImpl,
      maxSlots: 2,
    });
    expect(out).toHaveLength(2);
  });
});

describe('fetchThumbnails — null + missing inputs', () => {
  it('returns the placeholder URI for `null` slots without invoking fetch', async () => {
    const fetchImpl = makeFakeFetch({});
    const out = await fetchThumbnails([null, null], { fetch: fetchImpl });
    expect(out).toEqual([PLACEHOLDER_DATA_URI, PLACEHOLDER_DATA_URI]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns the placeholder URI for empty-string slots', async () => {
    const fetchImpl = makeFakeFetch({});
    const out = await fetchThumbnails([''], { fetch: fetchImpl });
    expect(out[0]).toBe(PLACEHOLDER_DATA_URI);
  });

  it('returns an empty array when given an empty input', async () => {
    const out = await fetchThumbnails([], {});
    expect(out).toEqual([]);
  });
});

describe('fetchThumbnails — failure modes', () => {
  it('returns the placeholder URI when the response is non-OK', async () => {
    const fetchImpl = makeFakeFetch({ 'https://x/404.png': { status: 404 } });
    const out = await fetchThumbnails(['https://x/404.png'], { fetch: fetchImpl });
    expect(out[0]).toBe(PLACEHOLDER_DATA_URI);
  });

  it('returns the placeholder URI when content-type is not an allowed image', async () => {
    const fetchImpl = makeFakeFetch({
      'https://x/oops.html': { contentType: 'text/html', bytes: new Uint8Array([0x3c, 0x21]) },
    });
    const out = await fetchThumbnails(['https://x/oops.html'], { fetch: fetchImpl });
    expect(out[0]).toBe(PLACEHOLDER_DATA_URI);
  });

  it('rejects SVG content-type even though it is technically image/* (Satori incompatibility)', async () => {
    const fetchImpl = makeFakeFetch({
      'https://x/sneaky.svg': { contentType: 'image/svg+xml', bytes: new Uint8Array([0x3c]) },
    });
    const out = await fetchThumbnails(['https://x/sneaky.svg'], { fetch: fetchImpl });
    expect(out[0]).toBe(PLACEHOLDER_DATA_URI);
  });

  it('returns the placeholder URI for an empty body', async () => {
    const fetchImpl = makeFakeFetch({
      'https://x/empty.png': { bytes: new Uint8Array() },
    });
    const out = await fetchThumbnails(['https://x/empty.png'], { fetch: fetchImpl });
    expect(out[0]).toBe(PLACEHOLDER_DATA_URI);
  });

  it('returns the placeholder URI when fetch itself throws', async () => {
    const fetchImpl: ImageFetchLike = vi.fn(async () => {
      throw new Error('connection reset');
    });
    const out = await fetchThumbnails(['https://x/boom.png'], { fetch: fetchImpl });
    expect(out[0]).toBe(PLACEHOLDER_DATA_URI);
  });
});

describe('fetchThumbnails — timeout', () => {
  it('returns the placeholder URI when a single image times out', async () => {
    const fetchImpl = makeFakeFetch({ 'https://x/slow.png': 'timeout' });
    const out = await fetchThumbnails(['https://x/slow.png'], {
      fetch: fetchImpl,
      timeoutMs: 25,
    });
    expect(out[0]).toBe(PLACEHOLDER_DATA_URI);
  });

  it('returns placeholders for ALL slots when every image times out', async () => {
    const fetchImpl = makeFakeFetch({
      'https://x/a': 'timeout',
      'https://x/b': 'timeout',
      'https://x/c': 'timeout',
      'https://x/d': 'timeout',
    });
    const out = await fetchThumbnails(['https://x/a', 'https://x/b', 'https://x/c', 'https://x/d'], {
      fetch: fetchImpl,
      timeoutMs: 25,
    });
    expect(out.every((u) => u === PLACEHOLDER_DATA_URI)).toBe(true);
  });

  it('still resolves successful slots even when neighbours time out', async () => {
    const fastBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const fetchImpl = makeFakeFetch({
      'https://x/slow': 'timeout',
      'https://x/fast': { bytes: fastBytes, contentType: 'image/png' },
    });
    const out = await fetchThumbnails(['https://x/slow', 'https://x/fast'], {
      fetch: fetchImpl,
      timeoutMs: 25,
    });
    expect(out[0]).toBe(PLACEHOLDER_DATA_URI);
    expect(out[1]).toMatch(/^data:image\/png;base64,/);
  });

  it('honours an outer abort signal — propagates to in-flight image fetches', async () => {
    const fetchImpl = makeFakeFetch({ 'https://x/slow': 'timeout' });
    const outer = new AbortController();
    const promise = fetchThumbnails(['https://x/slow'], {
      fetch: fetchImpl,
      timeoutMs: 60_000,
      signal: outer.signal,
    });
    setTimeout(() => outer.abort(), 10);
    const out = await promise;
    expect(out[0]).toBe(PLACEHOLDER_DATA_URI);
  });
});
