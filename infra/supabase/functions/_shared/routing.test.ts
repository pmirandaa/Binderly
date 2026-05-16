import { describe, expect, it } from 'vitest';

import { matchPattern, normalizePathname, resolveRoute } from './routing.ts';

import type { RouteDescriptor } from './routing.ts';

describe('normalizePathname', () => {
  it('strips the /functions/v1/v1 prefix', () => {
    expect(normalizePathname('/functions/v1/v1/me/collection')).toBe('/me/collection');
  });

  it('strips the /v1 prefix', () => {
    expect(normalizePathname('/v1/me/collection')).toBe('/me/collection');
  });

  it('strips chained /v1/v1 prefixes', () => {
    expect(normalizePathname('/v1/v1/me/collection')).toBe('/me/collection');
  });

  it('leaves an already-canonical path alone', () => {
    expect(normalizePathname('/me/collection')).toBe('/me/collection');
  });

  it('preserves nested path segments', () => {
    expect(normalizePathname('/v1/me/custom-collections/abc/items/def')).toBe(
      '/me/custom-collections/abc/items/def',
    );
  });

  it('strips trailing slash on non-root paths', () => {
    expect(normalizePathname('/v1/me/collection/')).toBe('/me/collection');
  });

  it('preserves the root slash', () => {
    expect(normalizePathname('/')).toBe('/');
  });

  it('adds a leading slash when missing', () => {
    expect(normalizePathname('me/collection')).toBe('/me/collection');
  });
});

describe('matchPattern', () => {
  it('matches an exact-segment pattern', () => {
    expect(matchPattern('/me/collection', '/me/collection')).toEqual({});
  });

  it('returns null for a different first segment', () => {
    expect(matchPattern('/me/collection', '/them/collection')).toBeNull();
  });

  it('returns null when the segment count differs', () => {
    expect(matchPattern('/me/collection', '/me/collection/abc')).toBeNull();
  });

  it('extracts a single :id parameter', () => {
    expect(matchPattern('/me/collection/:id', '/me/collection/abc-123')).toEqual({
      id: 'abc-123',
    });
  });

  it('extracts multiple parameters', () => {
    expect(
      matchPattern(
        '/me/custom-collections/:id/items/:printingId',
        '/me/custom-collections/cc-1/items/p-1',
      ),
    ).toEqual({ id: 'cc-1', printingId: 'p-1' });
  });

  it('decodes URL-encoded segments', () => {
    expect(matchPattern('/me/collection/:id', '/me/collection/abc%20def')).toEqual({
      id: 'abc def',
    });
  });
});

describe('resolveRoute', () => {
  const routes: RouteDescriptor[] = [
    {
      method: 'GET',
      pattern: '/me/collection',
      handler: () => new Response('list'),
    },
    {
      method: 'POST',
      pattern: '/me/collection',
      handler: () => new Response('add'),
    },
    {
      method: 'PATCH',
      pattern: '/me/collection/:id',
      handler: () => new Response('update'),
    },
  ];

  it('resolves a GET to the list handler', () => {
    const result = resolveRoute(
      routes,
      new Request('http://localhost/v1/me/collection', { method: 'GET' }),
    );
    expect(result).not.toBeNull();
    expect(result && 'route' in result && result.route.method).toBe('GET');
  });

  it('resolves a POST to the add handler', () => {
    const result = resolveRoute(
      routes,
      new Request('http://localhost/v1/me/collection', { method: 'POST' }),
    );
    expect(result && 'route' in result && result.route.method).toBe('POST');
  });

  it('returns methodNotAllowed when path matches but method does not', () => {
    const result = resolveRoute(
      routes,
      new Request('http://localhost/v1/me/collection', { method: 'DELETE' }),
    );
    expect(result).toEqual({ methodNotAllowed: true });
  });

  it('returns null when no path matches', () => {
    const result = resolveRoute(
      routes,
      new Request('http://localhost/v1/me/unknown', { method: 'GET' }),
    );
    expect(result).toBeNull();
  });

  it('exposes the extracted params on a successful match', () => {
    const result = resolveRoute(
      routes,
      new Request('http://localhost/v1/me/collection/abc', { method: 'PATCH' }),
    );
    expect(result && 'match' in result && result.match.params).toEqual({ id: 'abc' });
  });

  it('exposes the search params on a successful match', () => {
    const result = resolveRoute(
      routes,
      new Request('http://localhost/v1/me/collection?cursor=ABC&limit=10', { method: 'GET' }),
    );
    expect(result && 'match' in result && result.match.searchParams.get('cursor')).toBe('ABC');
    expect(result && 'match' in result && result.match.searchParams.get('limit')).toBe('10');
  });
});
