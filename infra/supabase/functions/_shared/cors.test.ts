import { describe, expect, it } from 'vitest';

import {
  CORS_ALLOWED_HEADERS,
  CORS_ALLOWED_METHODS,
  CORS_EXPOSED_HEADERS,
  corsResponseHeaders,
  handlePreflight,
  parseCorsConfig,
  resolveAllowedOrigin,
} from './cors.ts';

describe('parseCorsConfig', () => {
  it('falls back to wildcard when env value is undefined', () => {
    const config = parseCorsConfig(undefined);
    expect(config.allowOrigins).toEqual(['*']);
  });

  it('falls back to wildcard when env value is empty', () => {
    expect(parseCorsConfig('').allowOrigins).toEqual(['*']);
    expect(parseCorsConfig('   ').allowOrigins).toEqual(['*']);
  });

  it('parses a comma-separated allow-list, trimming whitespace', () => {
    const config = parseCorsConfig('https://binderly.app, https://staging.binderly.app');
    expect(config.allowOrigins).toEqual(['https://binderly.app', 'https://staging.binderly.app']);
  });

  it('drops empty entries from the parsed list', () => {
    const config = parseCorsConfig(', https://binderly.app, , ');
    expect(config.allowOrigins).toEqual(['https://binderly.app']);
  });
});

describe('resolveAllowedOrigin', () => {
  it('returns wildcard when config allows everything', () => {
    const request = new Request('http://localhost/v1/me/collection', {
      headers: { origin: 'https://binderly.app' },
    });
    expect(resolveAllowedOrigin(request, { allowOrigins: ['*'] })).toBe('*');
  });

  it('echoes the request origin when it appears in the allow-list', () => {
    const request = new Request('http://localhost/v1/me/collection', {
      headers: { origin: 'https://binderly.app' },
    });
    const allowed = resolveAllowedOrigin(request, {
      allowOrigins: ['https://binderly.app', 'https://staging.binderly.app'],
    });
    expect(allowed).toBe('https://binderly.app');
  });

  it('returns null when the origin is not allowed', () => {
    const request = new Request('http://localhost/v1/me/collection', {
      headers: { origin: 'https://evil.example' },
    });
    expect(resolveAllowedOrigin(request, { allowOrigins: ['https://binderly.app'] })).toBeNull();
  });

  it('returns null when the request has no origin header (server-to-server)', () => {
    const request = new Request('http://localhost/v1/me/collection');
    expect(resolveAllowedOrigin(request, { allowOrigins: ['https://binderly.app'] })).toBeNull();
  });
});

describe('corsResponseHeaders', () => {
  it('includes the expose-headers + vary always', () => {
    const request = new Request('http://localhost/v1/me/collection');
    const headers = corsResponseHeaders(request, { allowOrigins: ['*'] });
    expect(headers['access-control-expose-headers']).toBe(CORS_EXPOSED_HEADERS);
    expect(headers['vary']).toBe('Origin');
  });

  it('omits allow-origin when no origin matches', () => {
    const request = new Request('http://localhost/v1/me/collection', {
      headers: { origin: 'https://evil.example' },
    });
    const headers = corsResponseHeaders(request, {
      allowOrigins: ['https://binderly.app'],
    });
    expect(headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('handlePreflight', () => {
  it('returns null for non-OPTIONS requests', () => {
    const request = new Request('http://localhost/v1/me/collection', { method: 'GET' });
    expect(handlePreflight(request, { allowOrigins: ['*'] })).toBeNull();
  });

  it('returns 204 with allow headers for an allowed OPTIONS preflight', async () => {
    const request = new Request('http://localhost/v1/me/collection', {
      method: 'OPTIONS',
      headers: { origin: 'https://binderly.app' },
    });
    const response = handlePreflight(request, { allowOrigins: ['https://binderly.app'] });
    expect(response).not.toBeNull();
    expect(response!.status).toBe(204);
    expect(response!.headers.get('access-control-allow-origin')).toBe('https://binderly.app');
    expect(response!.headers.get('access-control-allow-methods')).toBe(CORS_ALLOWED_METHODS);
    expect(response!.headers.get('access-control-allow-headers')).toBe(CORS_ALLOWED_HEADERS);
    expect(response!.headers.get('access-control-max-age')).toBe('600');
  });

  it('returns 403 for an OPTIONS request from a disallowed origin', () => {
    const request = new Request('http://localhost/v1/me/collection', {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example' },
    });
    const response = handlePreflight(request, { allowOrigins: ['https://binderly.app'] });
    expect(response).not.toBeNull();
    expect(response!.status).toBe(403);
  });

  it('returns 204 with wildcard origin when config is permissive', () => {
    const request = new Request('http://localhost/v1/me/collection', {
      method: 'OPTIONS',
      headers: { origin: 'https://anywhere.example' },
    });
    const response = handlePreflight(request, { allowOrigins: ['*'] });
    expect(response!.status).toBe(204);
    expect(response!.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('exposes x-request-id in the allowed headers list', () => {
    expect(CORS_ALLOWED_HEADERS).toContain('x-request-id');
  });

  it('exposes x-request-id in the response-side expose list', () => {
    expect(CORS_EXPOSED_HEADERS).toContain('x-request-id');
  });

  it('allows POST/PATCH/PUT/DELETE in the methods list', () => {
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE', 'GET', 'OPTIONS']) {
      expect(CORS_ALLOWED_METHODS).toContain(method);
    }
  });
});
