import { describe, expect, it } from 'vitest';

import { generateRequestId, REQUEST_ID_HEADER, resolveRequestId } from './request-id.ts';

describe('resolveRequestId', () => {
  it('echoes the inbound x-request-id header verbatim when present', () => {
    const request = new Request('http://localhost/v1/me/collection', {
      headers: { [REQUEST_ID_HEADER]: 'inbound-id-123' },
    });
    expect(resolveRequestId(request)).toBe('inbound-id-123');
  });

  it('mints a fresh id when the header is absent', () => {
    const request = new Request('http://localhost/v1/me/collection');
    const id = resolveRequestId(request);
    expect(id.length).toBeGreaterThan(0);
  });

  it('mints a fresh id when the header is empty', () => {
    const request = new Request('http://localhost/v1/me/collection', {
      headers: { [REQUEST_ID_HEADER]: '' },
    });
    expect(resolveRequestId(request).length).toBeGreaterThan(0);
  });

  it('truncates an excessively long inbound header', () => {
    const huge = 'x'.repeat(500);
    const request = new Request('http://localhost/v1/me/collection', {
      headers: { [REQUEST_ID_HEADER]: huge },
    });
    expect(resolveRequestId(request).length).toBeLessThanOrEqual(128);
  });

  it('produces UUID-shaped ids by default', () => {
    const id = generateRequestId();
    expect(id).toMatch(/^[0-9a-f-]{16,}$/i);
  });

  it('header constant matches the canonical x-request-id literal', () => {
    expect(REQUEST_ID_HEADER).toBe('x-request-id');
  });
});
