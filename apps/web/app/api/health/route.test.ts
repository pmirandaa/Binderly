import { describe, expect, it } from 'vitest';

import { GET } from './route';

describe('GET /api/health', () => {
  it('returns a 200 with an ok liveness payload', async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');

    const body = (await response.json()) as {
      status: string;
      service: string;
      timestamp: string;
    };
    expect(body.status).toBe('ok');
    expect(body.service).toBe('web');
    expect(() => new Date(body.timestamp).toISOString()).not.toThrow();
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
  });
});
