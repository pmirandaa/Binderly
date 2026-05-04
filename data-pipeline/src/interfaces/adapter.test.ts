// Unit tests for `AdapterError` JSON serialization.
//
// The base class overrides `toJSON` so a JSON.stringify of any
// concrete subclass survives `Error`'s non-enumerable fields and
// keeps the underlying `cause` (Q-005, 2026-05-04 SEED-INGEST
// smoke). Without the override, `JSON.stringify(adapterError)`
// emits `{}` for the cause and the seed-run report at
// `data-pipeline/scripts/output/seed-run-*.json` loses every
// piece of information the operator needs to triage.

import { describe, expect, it } from 'vitest';

import {
  isAdapterError,
  NotFoundError,
  PermanentError,
  RateLimitError,
  TransientError,
} from './adapter.js';

describe('AdapterError JSON serialization (Q-005)', () => {
  it('TransientError keeps name + kind + message + source + target + cause', () => {
    const inner = new Error('socket hang up');
    const err = new TransientError('Network error talking to api.example.com', {
      source: 'api.example.com',
      target: 'https://api.example.com/v2/cards',
      attempt: 5,
      cause: inner,
    });
    const parsed = JSON.parse(JSON.stringify(err)) as Record<string, unknown>;
    expect(parsed['name']).toBe('TransientError');
    expect(parsed['kind']).toBe('transient');
    expect(parsed['message']).toBe('Network error talking to api.example.com');
    expect(parsed['source']).toBe('api.example.com');
    expect(parsed['target']).toBe('https://api.example.com/v2/cards');
    expect(parsed['cause']).toEqual({ name: 'Error', message: 'socket hang up' });
  });

  it('PermanentError serializes a string cause as a plain string', () => {
    const err = new PermanentError('HTTP 400 from x', {
      source: 'x',
      target: '/v2/cards/garbage',
      cause: 'malformed query',
    });
    const parsed = JSON.parse(JSON.stringify(err)) as Record<string, unknown>;
    expect(parsed['kind']).toBe('permanent');
    expect(parsed['cause']).toBe('malformed query');
  });

  it('RateLimitError serializes `undefined` cause as missing field', () => {
    const err = new RateLimitError('HTTP 429 from x', {
      source: 'x',
      target: '/v2/cards',
    });
    const parsed = JSON.parse(JSON.stringify(err)) as Record<string, unknown>;
    expect(parsed['kind']).toBe('rate_limit');
    expect(parsed['cause']).toBeUndefined();
  });

  it('NotFoundError without a cause never emits `cause:{}`', () => {
    const err = new NotFoundError('HTTP 404 from x', {
      source: 'x',
      target: '/v2/cards/missing',
    });
    const json = JSON.stringify(err);
    expect(json).not.toContain('"cause":{}');
    expect(json).toContain('"kind":"not_found"');
  });

  it('isAdapterError narrows correctly', () => {
    const err = new TransientError('boom', { source: 'x' });
    expect(isAdapterError(err)).toBe(true);
    expect(isAdapterError(new Error('bare'))).toBe(false);
    expect(isAdapterError(undefined)).toBe(false);
  });
});
