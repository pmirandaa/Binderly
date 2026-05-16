import { describe, expect, it } from 'vitest';

import { apiOk } from './errors.ts';
import { buildContext, buildEnv, dispatch, makeHandler } from './dispatch.ts';

import type { ContextualRoute } from './routes-table.ts';

const TEST_ENV_GETTER = (name: string): string | undefined => {
  switch (name) {
    case 'SUPABASE_URL':
      return 'https://test.supabase.test';
    case 'SUPABASE_ANON_KEY':
      return 'anon';
    case 'SUPABASE_SERVICE_ROLE_KEY':
      return 'service-role';
    case 'CORS_ALLOW_ORIGINS':
      return '*';
    default:
      return undefined;
  }
};

describe('buildEnv', () => {
  it('builds an env from the canonical getter', () => {
    const env = buildEnv(TEST_ENV_GETTER);
    expect(env.supabaseUrl).toBe('https://test.supabase.test');
    expect(env.corsAllowOrigins).toEqual(['*']);
  });

  it('throws when SUPABASE_URL is missing', () => {
    expect(() => buildEnv((name) => (name === 'SUPABASE_URL' ? undefined : 'x'))).toThrow(
      /env is incomplete/,
    );
  });

  it('throws when SUPABASE_SERVICE_ROLE_KEY is missing', () => {
    expect(() =>
      buildEnv((name) => (name === 'SUPABASE_SERVICE_ROLE_KEY' ? undefined : 'x')),
    ).toThrow(/env is incomplete/);
  });

  it('parses an explicit CORS allow-list', () => {
    const env = buildEnv((name) =>
      name === 'CORS_ALLOW_ORIGINS' ? 'https://a.test,https://b.test' : 'x',
    );
    expect(env.corsAllowOrigins).toEqual(['https://a.test', 'https://b.test']);
  });
});

describe('buildContext', () => {
  it('threads env, requestId, and deps through', () => {
    const env = buildEnv(TEST_ENV_GETTER);
    const ctx = buildContext(env, 'rid-1');
    expect(ctx.env).toBe(env);
    expect(ctx.requestId).toBe('rid-1');
  });
});

describe('dispatch', () => {
  const okRoute: ContextualRoute = {
    method: 'GET',
    pattern: '/me/ping',
    handler: (request, _match, ctx) => apiOk(request, ctx.cors, ctx.requestId, { pong: true }),
  };
  const failRoute: ContextualRoute = {
    method: 'POST',
    pattern: '/me/throw',
    handler: () => {
      throw new Error('intentional');
    },
  };

  it('routes a happy-path GET to the matching handler', async () => {
    const env = buildEnv(TEST_ENV_GETTER);
    const ctx = buildContext(env, 'rid-1');
    const response = await dispatch(
      new Request('http://localhost/v1/me/ping', { method: 'GET' }),
      ctx,
      [okRoute],
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toBe('rid-1');
    const body = await response.json();
    expect(body).toEqual({ ok: true, data: { pong: true } });
  });

  it('emits a 404 envelope for an unknown path', async () => {
    const env = buildEnv(TEST_ENV_GETTER);
    const ctx = buildContext(env, 'rid-1');
    const response = await dispatch(
      new Request('http://localhost/v1/me/unknown', { method: 'GET' }),
      ctx,
      [okRoute],
    );
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('emits a 405 envelope when the path matches but method does not', async () => {
    const env = buildEnv(TEST_ENV_GETTER);
    const ctx = buildContext(env, 'rid-1');
    const response = await dispatch(
      new Request('http://localhost/v1/me/ping', { method: 'POST' }),
      ctx,
      [okRoute],
    );
    expect(response.status).toBe(405);
  });

  it('catches handler-thrown errors as INTERNAL', async () => {
    const env = buildEnv(TEST_ENV_GETTER);
    const ctx = buildContext(env, 'rid-1');
    const response = await dispatch(
      new Request('http://localhost/v1/me/throw', { method: 'POST' }),
      ctx,
      [failRoute],
    );
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe('INTERNAL');
    expect(body.error.message).toBe('intentional');
  });

  it('returns 204 for a CORS preflight', async () => {
    const env = buildEnv(TEST_ENV_GETTER);
    const ctx = buildContext(env, 'rid-1');
    const response = await dispatch(
      new Request('http://localhost/v1/me/ping', {
        method: 'OPTIONS',
        headers: { origin: 'https://example.test' },
      }),
      ctx,
      [okRoute],
    );
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('echoes inbound x-request-id when present', async () => {
    const handler = makeHandler({ getEnv: TEST_ENV_GETTER, routes: [okRoute] });
    const response = await handler(
      new Request('http://localhost/v1/me/ping', {
        method: 'GET',
        headers: { 'x-request-id': 'caller-supplied-id' },
      }),
    );
    expect(response.headers.get('x-request-id')).toBe('caller-supplied-id');
  });

  it('mints a fresh x-request-id when missing', async () => {
    const handler = makeHandler({ getEnv: TEST_ENV_GETTER, routes: [okRoute] });
    const response = await handler(new Request('http://localhost/v1/me/ping', { method: 'GET' }));
    expect(response.headers.get('x-request-id')).not.toBeNull();
    expect((response.headers.get('x-request-id') ?? '').length).toBeGreaterThan(0);
  });

  it('emits an INTERNAL envelope when env is incomplete', async () => {
    const handler = makeHandler({
      getEnv: (name) => (name === 'SUPABASE_URL' ? undefined : 'x'),
      routes: [okRoute],
    });
    const response = await handler(new Request('http://localhost/v1/me/ping', { method: 'GET' }));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe('INTERNAL');
  });

  it('every error envelope has ok:false plus code+message', async () => {
    const handler = makeHandler({ getEnv: TEST_ENV_GETTER, routes: [okRoute, failRoute] });
    const response = await handler(new Request('http://localhost/v1/me/throw', { method: 'POST' }));
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(typeof body.error.code).toBe('string');
    expect(typeof body.error.message).toBe('string');
  });
});
