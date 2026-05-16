import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ApiError } from './errors.ts';
import { parseJsonBody, validateBody } from './validate.ts';

describe('validateBody', () => {
  const schema = z
    .object({
      name: z.string().min(1),
      age: z.number().int().nonnegative(),
    })
    .strict();

  it('returns the parsed value on success', () => {
    const result = validateBody({ name: 'Bulbasaur', age: 7 }, schema);
    expect(result).toEqual({ name: 'Bulbasaur', age: 7 });
  });

  it('throws ApiError VALIDATION on a missing field', () => {
    expect(() => validateBody({ name: 'Bulbasaur' }, schema)).toThrow(ApiError);
  });

  it('issues a structured details payload', () => {
    try {
      validateBody({ name: 'Bulbasaur' }, schema);
      throw new Error('should have thrown');
    } catch (cause) {
      expect(cause).toBeInstanceOf(ApiError);
      const apiCause = cause as ApiError;
      expect(apiCause.code).toBe('VALIDATION');
      const details = apiCause.details as { issues: { path: unknown[]; message: string }[] };
      expect(Array.isArray(details.issues)).toBe(true);
      expect(details.issues.length).toBeGreaterThan(0);
      expect(details.issues[0]!.path).toContain('age');
    }
  });

  it('rejects unknown keys with strict schemas', () => {
    expect(() => validateBody({ name: 'A', age: 1, extra: true }, schema)).toThrow(ApiError);
  });

  it('rejects null payloads', () => {
    expect(() => validateBody(null, schema)).toThrow(ApiError);
  });

  it('rejects array payloads when an object is expected', () => {
    expect(() => validateBody([], schema)).toThrow(ApiError);
  });
});

describe('parseJsonBody', () => {
  const schema = z
    .object({
      foo: z.string(),
    })
    .strict();

  it('parses a well-formed JSON body', async () => {
    const request = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ foo: 'bar' }),
    });
    const result = await parseJsonBody(request, schema);
    expect(result).toEqual({ foo: 'bar' });
  });

  it('rejects an empty body with VALIDATION', async () => {
    const request = new Request('http://localhost', { method: 'POST' });
    await expect(parseJsonBody(request, schema)).rejects.toThrow(/empty/);
  });

  it('rejects a malformed JSON body with VALIDATION', async () => {
    const request = new Request('http://localhost', { method: 'POST', body: '{not-json' });
    await expect(parseJsonBody(request, schema)).rejects.toThrow(/JSON/);
  });

  it('rejects a JSON body that fails schema validation with VALIDATION', async () => {
    const request = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ foo: 123 }),
    });
    await expect(parseJsonBody(request, schema)).rejects.toThrow(ApiError);
  });
});
