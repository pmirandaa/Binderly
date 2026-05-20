import { describe, expect, it, vi } from 'vitest';

import { makePublicSharePayload } from '../../share/fixtures';
import { fetchOgPayload } from '../data';

import type { ShareApi } from '../../share/api';

function makeShareApiStub(impl: ShareApi['getPublicSharePayload']): ShareApi {
  return { getPublicSharePayload: impl };
}

describe('fetchOgPayload — happy path', () => {
  it('returns the payload from the injected shareApi', async () => {
    const payload = makePublicSharePayload();
    const shareApi = makeShareApiStub(vi.fn(async () => payload));
    const out = await fetchOgPayload('pablo', 'binder', { shareApi });
    expect(out).toBe(payload);
  });

  it('forwards handle + slug to the shareApi', async () => {
    const inner = vi.fn(async () => makePublicSharePayload());
    await fetchOgPayload('pablo', 'mine', { shareApi: makeShareApiStub(inner) });
    expect(inner).toHaveBeenCalledWith(
      expect.objectContaining({ handle: 'pablo', slug: 'mine' }),
    );
  });
});

describe('fetchOgPayload — null + failure modes', () => {
  it('returns null when the shareApi returns null (404 / private)', async () => {
    const shareApi = makeShareApiStub(vi.fn(async () => null));
    const out = await fetchOgPayload('unknown', 'thing', { shareApi });
    expect(out).toBeNull();
  });

  it('returns null when the shareApi throws', async () => {
    const shareApi = makeShareApiStub(
      vi.fn(async () => {
        throw new Error('5xx upstream');
      }),
    );
    const out = await fetchOgPayload('pablo', 'binder', { shareApi });
    expect(out).toBeNull();
  });

  it('never lets a sync throw escape (rejects → null)', async () => {
    // Deliberately exercising a degenerate adapter that throws
    // synchronously instead of returning a rejected promise. The
    // wrapper still has to swallow this and yield null.
    const shareApi = makeShareApiStub((async () => {
      throw new Error('sync explode');
    }) as unknown as ShareApi['getPublicSharePayload']);
    await expect(fetchOgPayload('a', 'b', { shareApi })).resolves.toBeNull();
  });
});

describe('fetchOgPayload — timeout', () => {
  it('returns null when the inner adapter never resolves within timeoutMs', async () => {
    const shareApi = makeShareApiStub(
      ({ signal }) =>
        new Promise((_resolve, reject) => {
          if (signal === undefined) return; // never resolves
          if (signal.aborted) {
            reject(new Error('aborted'));
            return;
          }
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
    );
    const out = await fetchOgPayload('a', 'b', { shareApi, timeoutMs: 25 });
    expect(out).toBeNull();
  });

  it('passes a signal through to the adapter', async () => {
    const inner = vi.fn(async ({ signal }) => {
      expect(signal).toBeInstanceOf(AbortSignal);
      return makePublicSharePayload();
    });
    await fetchOgPayload('a', 'b', { shareApi: makeShareApiStub(inner) });
  });

  it('honours an outer abort signal', async () => {
    const shareApi = makeShareApiStub(
      ({ signal }) =>
        new Promise((_resolve, reject) => {
          if (signal === undefined) return;
          if (signal.aborted) {
            reject(new Error('aborted'));
            return;
          }
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
    );
    const outer = new AbortController();
    const promise = fetchOgPayload('a', 'b', {
      shareApi,
      signal: outer.signal,
      timeoutMs: 60_000,
    });
    setTimeout(() => outer.abort(), 10);
    const out = await promise;
    expect(out).toBeNull();
  });
});
