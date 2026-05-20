// Next.js App Router POST handler for Paddle Billing v2 webhooks.
//
// Thin shim — the bulk of the logic lives in `./handler.ts` so it
// can be unit-tested without instantiating `next/server`.

import { NextResponse } from 'next/server';

import { handlePaddleWebhook } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEADER_NAME = 'paddle-signature';

export async function POST(request: Request): Promise<NextResponse> {
  // We MUST read the raw bytes Paddle sent — the signature was
  // computed over them. `request.text()` returns the body as the
  // browser-bytes utf-8 string.
  const body = await request.text();
  const header = request.headers.get(HEADER_NAME);

  const result = await handlePaddleWebhook({ body, header });
  return NextResponse.json(result.body, { status: result.status });
}

/**
 * GET on the webhook endpoint returns 405 — Paddle only POSTs and
 * we don't want to leak any state on accidental browser visits.
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    { ok: false, error: 'Method not allowed; this endpoint accepts POST only.' },
    { status: 405 },
  );
}
