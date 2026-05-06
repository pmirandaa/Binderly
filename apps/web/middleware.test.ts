import { describe, expect, it, vi } from 'vitest';

interface FakeUrlInit {
  pathname: string;
  search?: string;
}

class FakeUrl {
  public pathname: string;
  public search: string;
  public origin = 'http://localhost';
  public constructor(init: FakeUrlInit | string) {
    if (typeof init === 'string') {
      const [p = '/', q = ''] = init.split('?');
      this.pathname = p;
      this.search = q.length > 0 ? `?${q}` : '';
      return;
    }
    this.pathname = init.pathname;
    this.search = init.search ?? '';
  }
  public clone(): FakeUrl {
    return new FakeUrl({ pathname: this.pathname, search: this.search });
  }
  public toString(): string {
    return `${this.origin}${this.pathname}${this.search}`;
  }
}

vi.mock('next/server', () => {
  class FakeResponse {
    public readonly headers = new Map<string, string>();
    public readonly redirect: { url: FakeUrl; status: number } | null;
    public constructor(redirect: { url: FakeUrl; status: number } | null = null) {
      this.redirect = redirect;
    }
  }
  return {
    NextResponse: {
      next: () => new FakeResponse(),
      redirect: (url: FakeUrl, status: number) => new FakeResponse({ url, status }),
    },
  };
});

import { PROTECTED_PREFIXES, middleware } from './middleware';

interface FakeRequest {
  headers: { get: (name: string) => string | null };
  cookies: { getAll: () => Array<{ name: string; value: string }> };
  nextUrl: FakeUrl;
}

function makeRequest(
  pathname: string,
  options: {
    headers?: Record<string, string>;
    cookies?: Array<{ name: string; value: string }>;
    search?: string;
  } = {},
): FakeRequest {
  const { headers = {}, cookies = [], search = '' } = options;
  return {
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    cookies: { getAll: () => cookies },
    nextUrl: new FakeUrl({ pathname, search }),
  };
}

interface FakeResp {
  headers: Map<string, string>;
  redirect: { url: FakeUrl; status: number } | null;
}

function call(req: FakeRequest): FakeResp {
  return middleware(req as never) as unknown as FakeResp;
}

describe('middleware — request id behaviour', () => {
  it('stamps a fresh x-request-id when none is supplied (pass-through path)', () => {
    const response = call(makeRequest('/'));
    const id = response.headers.get('x-request-id');
    expect(typeof id).toBe('string');
    expect((id ?? '').length).toBeGreaterThan(0);
    expect(response.redirect).toBeNull();
  });

  it('preserves the incoming x-request-id when set', () => {
    const response = call(makeRequest('/', { headers: { 'x-request-id': 'existing-id' } }));
    expect(response.headers.get('x-request-id')).toBe('existing-id');
    expect(response.redirect).toBeNull();
  });

  it('stamps an x-request-id on redirect responses too', () => {
    const response = call(makeRequest('/collection'));
    expect(response.headers.get('x-request-id')).toBeDefined();
    expect(response.redirect).not.toBeNull();
  });
});

describe('middleware — protected route gating', () => {
  it('redirects /collection to sign-in with next= when no auth cookie is present', () => {
    const response = call(makeRequest('/collection'));
    expect(response.redirect).not.toBeNull();
    expect(response.redirect?.status).toBe(307);
    expect(response.redirect?.url.pathname).toBe('/auth/sign-in');
    expect(response.redirect?.url.search).toBe('?next=%2Fcollection');
  });

  it('redirects /collection/abc/edit?tab=binders preserving the full path + query', () => {
    const response = call(makeRequest('/collection/abc/edit', { search: '?tab=binders' }));
    expect(response.redirect?.url.pathname).toBe('/auth/sign-in');
    expect(response.redirect?.url.search).toBe('?next=%2Fcollection%2Fabc%2Fedit%3Ftab%3Dbinders');
  });

  it('redirects /profile (and /profile/settings) when no auth cookie is present', () => {
    expect(call(makeRequest('/profile')).redirect?.url.pathname).toBe('/auth/sign-in');
    expect(call(makeRequest('/profile/settings')).redirect?.url.pathname).toBe('/auth/sign-in');
  });

  it('passes through protected routes when an sb-*-auth-token cookie is present', () => {
    const response = call(
      makeRequest('/collection', {
        cookies: [{ name: 'sb-abc123-auth-token', value: 'jwt' }],
      }),
    );
    expect(response.redirect).toBeNull();
  });

  it('passes through protected routes when a chunked sb-*-auth-token.N cookie is present', () => {
    const response = call(
      makeRequest('/collection', {
        cookies: [{ name: 'sb-projref-auth-token.0', value: 'chunk-zero' }],
      }),
    );
    expect(response.redirect).toBeNull();
  });

  it('does NOT consider unrelated cookies a session', () => {
    const response = call(
      makeRequest('/collection', {
        cookies: [{ name: 'analytics-id', value: 'xyz' }],
      }),
    );
    expect(response.redirect).not.toBeNull();
  });

  it('does NOT redirect public routes regardless of cookies', () => {
    expect(call(makeRequest('/')).redirect).toBeNull();
    expect(call(makeRequest('/browse')).redirect).toBeNull();
    expect(call(makeRequest('/sets/abc')).redirect).toBeNull();
    expect(call(makeRequest('/auth/sign-in')).redirect).toBeNull();
    expect(call(makeRequest('/auth/callback')).redirect).toBeNull();
  });

  it('does NOT match prefix-overlapping paths that are not actually protected', () => {
    // `/collectionish` should NOT be treated as `/collection/*`.
    expect(call(makeRequest('/collectionish')).redirect).toBeNull();
    expect(call(makeRequest('/profilesomething')).redirect).toBeNull();
  });

  it('exports the protected-prefixes list for documentation / cross-import', () => {
    expect(PROTECTED_PREFIXES).toContain('/collection');
    expect(PROTECTED_PREFIXES).toContain('/profile');
  });
});
