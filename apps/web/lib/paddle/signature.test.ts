import { describe, expect, it } from 'vitest';

import {
  PADDLE_SIGNATURE_HEADER,
  parsePaddleSignatureHeader,
  signPaddlePayloadForTest,
  verifyPaddleSignature,
} from './signature';

const SECRET = 'pdl_ntfset_sandbox_test_secret_value_dont_use_in_prod';

describe('PADDLE_SIGNATURE_HEADER', () => {
  it('lowercases to the lookup key Next.js exposes on Headers', () => {
    expect(PADDLE_SIGNATURE_HEADER).toBe('paddle-signature');
  });
});

describe('parsePaddleSignatureHeader', () => {
  it('extracts ts + h1 from a valid header', () => {
    const ts = '1671552777';
    const h1 = 'a'.repeat(64);
    const parsed = parsePaddleSignatureHeader(`ts=${ts};h1=${h1}`);
    expect(parsed).not.toBeNull();
    if (parsed === null) return;
    expect(parsed.ts).toBe(ts);
    expect(parsed.h1).toBe(h1);
  });

  it('returns null for empty input', () => {
    expect(parsePaddleSignatureHeader('')).toBeNull();
  });

  it('returns null when ts is missing', () => {
    const h1 = 'a'.repeat(64);
    expect(parsePaddleSignatureHeader(`h1=${h1}`)).toBeNull();
  });

  it('returns null when h1 is missing', () => {
    expect(parsePaddleSignatureHeader('ts=1671552777')).toBeNull();
  });

  it('returns null when ts is non-numeric', () => {
    const h1 = 'a'.repeat(64);
    expect(parsePaddleSignatureHeader(`ts=abc;h1=${h1}`)).toBeNull();
  });

  it('returns null when h1 is not 64 hex chars', () => {
    expect(parsePaddleSignatureHeader('ts=1671552777;h1=abc123')).toBeNull();
  });

  it('tolerates leading whitespace in segments', () => {
    const ts = '1671552777';
    const h1 = 'a'.repeat(64);
    const parsed = parsePaddleSignatureHeader(`ts=${ts}; h1=${h1}`);
    expect(parsed).not.toBeNull();
    if (parsed === null) return;
    expect(parsed.h1).toBe(h1);
  });
});

describe('verifyPaddleSignature', () => {
  const body = JSON.stringify({ event_type: 'subscription.created', event_id: 'evt_1' });
  const tsSeconds = 1_700_000_000;
  const tsMs = tsSeconds * 1000;
  const validHeader = signPaddlePayloadForTest(body, SECRET, tsSeconds);
  const fixedNow = (): number => tsMs + 1000;

  it('returns ok with the parsed timestamp for a valid signature', () => {
    const result = verifyPaddleSignature(body, validHeader, SECRET, { now: fixedNow });
    expect(result).toEqual({ ok: true, ts: tsMs });
  });

  it('rejects when the secret is missing', () => {
    expect(verifyPaddleSignature(body, validHeader, undefined)).toEqual({
      ok: false,
      reason: 'missing-secret',
    });
  });

  it('rejects when the secret is empty string', () => {
    expect(verifyPaddleSignature(body, validHeader, '')).toEqual({
      ok: false,
      reason: 'missing-secret',
    });
  });

  it('rejects when the header is missing', () => {
    expect(verifyPaddleSignature(body, undefined, SECRET)).toEqual({
      ok: false,
      reason: 'missing-header',
    });
  });

  it('rejects when the header is empty', () => {
    expect(verifyPaddleSignature(body, '', SECRET)).toEqual({
      ok: false,
      reason: 'missing-header',
    });
  });

  it('rejects malformed headers (missing components)', () => {
    expect(verifyPaddleSignature(body, 'ts=1700000000', SECRET, { now: fixedNow })).toEqual({
      ok: false,
      reason: 'malformed-header',
    });
  });

  it('rejects when the body has been tampered with', () => {
    const tampered = body + 'X';
    const result = verifyPaddleSignature(tampered, validHeader, SECRET, { now: fixedNow });
    expect(result).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('rejects when the signing secret differs', () => {
    const result = verifyPaddleSignature(body, validHeader, 'wrong-secret', { now: fixedNow });
    expect(result).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('rejects replays older than the tolerance window', () => {
    const tooOld = (): number => tsMs + 6 * 60 * 1000;
    const result = verifyPaddleSignature(body, validHeader, SECRET, { now: tooOld });
    expect(result).toEqual({ ok: false, reason: 'replay' });
  });

  it('rejects timestamps too far in the future', () => {
    const future = (): number => tsMs - 6 * 60 * 1000;
    const result = verifyPaddleSignature(body, validHeader, SECRET, { now: future });
    expect(result).toEqual({ ok: false, reason: 'replay' });
  });

  it('honours a custom tolerance window', () => {
    const tightWindow = (): number => tsMs + 2000;
    const result = verifyPaddleSignature(body, validHeader, SECRET, {
      now: tightWindow,
      toleranceMs: 1000,
    });
    expect(result).toEqual({ ok: false, reason: 'replay' });
  });

  it('treats Infinity tolerance as disabled (always passes the timestamp check)', () => {
    const result = verifyPaddleSignature(body, validHeader, SECRET, {
      now: () => 0,
      toleranceMs: Infinity,
    });
    expect(result.ok).toBe(true);
  });

  it('is case-insensitive on the hex h1 component', () => {
    const ts = '1700000000';
    const h1 = signPaddlePayloadForTest(body, SECRET, Number.parseInt(ts, 10))
      .split(';')[1]
      ?.split('=')[1];
    expect(h1).toBeDefined();
    if (h1 === undefined) return;
    const upper = `ts=${ts};h1=${h1.toUpperCase()}`;
    const result = verifyPaddleSignature(body, upper, SECRET, { now: fixedNow });
    expect(result.ok).toBe(true);
  });
});

describe('signPaddlePayloadForTest', () => {
  it('produces a header that round-trips through verifyPaddleSignature', () => {
    const body = '{"hello":"world"}';
    const tsSeconds = 1_700_000_500;
    const header = signPaddlePayloadForTest(body, SECRET, tsSeconds);
    const result = verifyPaddleSignature(body, header, SECRET, { now: () => tsSeconds * 1000 });
    expect(result.ok).toBe(true);
  });
});
