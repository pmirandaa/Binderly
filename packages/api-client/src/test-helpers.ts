// Shared test helpers for `@binderly/api-client`.
//
// This module is consumed only by `*.test.ts` files. It is NOT
// re-exported from the public barrel — the build excludes it from
// `dist/` via tsconfig (`src/**/*.test.ts` and `src/test-helpers.ts`
// are both ignored at compile time? No — only tests are. Helpers
// are intentionally kept out of the public surface by simply not
// being re-exported in `src/index.ts`).
//
// Centralising the mocked-fetch builder means every resource test
// can write the assertion shape "what URL did we hit, with what
// headers and body" in one line.

import { vi } from 'vitest';

import type { FetchLike, FetchResponseLike } from './client.js';

export interface MockResponseInput {
  readonly status?: number;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * Build a stub for the WHATWG `Response` interface — only the
 * subset {@link HttpClient} actually touches.
 */
export function mockResponse(input: MockResponseInput = {}): FetchResponseLike {
  const status = input.status ?? 200;
  const headers = new Map(
    Object.entries(input.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
  );
  const text =
    input.body === undefined
      ? ''
      : typeof input.body === 'string'
        ? input.body
        : JSON.stringify(input.body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
    text: () => Promise.resolve(text),
  };
}

/**
 * Build a `vi.fn()` typed as {@link FetchLike} that returns the
 * supplied responses in order. Index `n` returns response `n`;
 * extra calls reuse the last response (handy for retries / polling
 * when we don't care about the exact call count).
 */
export function mockFetch(
  ...responses: MockResponseInput[]
): ReturnType<typeof vi.fn<Parameters<FetchLike>, ReturnType<FetchLike>>> {
  const stubbed = responses.length === 0 ? [{}] : responses;
  let callIndex = 0;
  const fn = vi.fn((async (
    _input: string | URL,
    _init?: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      signal?: AbortSignal;
    },
  ) => {
    const idx = Math.min(callIndex, stubbed.length - 1);
    callIndex += 1;
    const spec = stubbed[idx]!;
    return mockResponse(spec);
  }) as FetchLike);
  return fn as ReturnType<typeof vi.fn<Parameters<FetchLike>, ReturnType<FetchLike>>>;
}

/**
 * Build a `vi.fn()` that rejects with the supplied error. Used for
 * the network-failure path.
 */
export function mockFetchReject(
  error: unknown,
): ReturnType<typeof vi.fn<Parameters<FetchLike>, ReturnType<FetchLike>>> {
  const fn = vi.fn((async () => {
    throw error;
  }) as FetchLike);
  return fn as ReturnType<typeof vi.fn<Parameters<FetchLike>, ReturnType<FetchLike>>>;
}

/**
 * Standard envelope wrapper for a successful response body.
 */
export function okEnvelope<T>(data: T): { ok: true; data: T } {
  return { ok: true, data };
}

/**
 * Standard envelope wrapper for an error response body. `code` is
 * optional; defaults to `'INTERNAL'`.
 */
export function errEnvelope(input: {
  readonly code?: 'VALIDATION' | 'AUTH' | 'NOT_FOUND' | 'CONFLICT' | 'RATE_LIMIT' | 'INTERNAL';
  readonly message?: string;
  readonly details?: unknown;
}): { ok: false; error: { code: string; message: string; details?: unknown } } {
  return {
    ok: false,
    error: {
      code: input.code ?? 'INTERNAL',
      message: input.message ?? 'something broke',
      ...(input.details !== undefined ? { details: input.details } : {}),
    },
  };
}
