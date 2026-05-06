import { describe, expect, it, vi } from 'vitest';

vi.mock('next/server', () => {
  // Minimal stand-in for `NextResponse` — exercises the request-id
  // logic without booting the Next runtime.
  class FakeResponse {
    public readonly headers = new Map<string, string>();
  }
  return {
    NextResponse: {
      next: () => new FakeResponse(),
    },
  };
});

import { middleware } from './middleware';

interface FakeRequest {
  headers: { get: (name: string) => string | null };
}

function makeRequest(headers: Record<string, string> = {}): FakeRequest {
  return {
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
  };
}

describe('middleware', () => {
  it('passes through and sets a fresh x-request-id when none is supplied', () => {
    const response = middleware(makeRequest() as never) as unknown as {
      headers: Map<string, string>;
    };
    const id = response.headers.get('x-request-id');
    expect(typeof id).toBe('string');
    expect((id ?? '').length).toBeGreaterThan(0);
  });

  it('preserves the incoming x-request-id when set', () => {
    const response = middleware(
      makeRequest({ 'x-request-id': 'existing-id' }) as never,
    ) as unknown as { headers: Map<string, string> };
    expect(response.headers.get('x-request-id')).toBe('existing-id');
  });
});
