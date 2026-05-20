// Pure webhook handler — separated from the Next.js `route.ts` so
// vitest can drive it with synthetic Request-like inputs (no
// `next/server` import).
//
// Responsibilities:
//
//   1. Read the raw body + Paddle-Signature header.
//   2. Verify the signature against `PADDLE_WEBHOOK_SECRET`. Reject
//      with 401 on missing / malformed / mismatched / replayed.
//   3. Parse the JSON body. Map to `{ action, userId, entitlementId
//      }`.
//   4. Forward to RevenueCat if `action === 'grant' | 'revoke'`. RC
//      failure does NOT make the webhook return non-200 — Paddle
//      retries forever on non-2xx and we don't want that loop for
//      a transient downstream issue.
//   5. Persist an audit row to `paddle_webhook_log` with
//      `processed`, `retry`, and `error` reflecting the RC outcome.
//   6. Always return 200 (or a documented 401 / 503).
//
// `PADDLE_WEBHOOK_SECRET` missing → 503. The deploy is misconfigured
// and we want the operator to notice immediately rather than
// silently dropping events.

import { loadServerPaddleEnv, type ServerPaddleEnv } from '../../../../lib/paddle/env';
import { mapPaddleEvent, type RawPaddleEvent } from '../../../../lib/paddle/events';
import {
  recordWebhookLog,
  type RecordWebhookLogResult,
  type SupabaseFetch,
} from '../../../../lib/paddle/log';
import { type PaddlePriceIds } from '../../../../lib/paddle/plans';
import {
  forwardEntitlement,
  type RevenueCatFetch,
  type RevenueCatForwardResult,
} from '../../../../lib/paddle/revenuecat';
import {
  PADDLE_SIGNATURE_HEADER,
  verifyPaddleSignature,
  type SignatureVerification,
} from '../../../../lib/paddle/signature';

export interface WebhookRequestLike {
  readonly body: string;
  readonly header: string | null;
}

export interface WebhookResponse {
  readonly status: number;
  readonly body: WebhookResponseBody;
}

export type WebhookResponseBody =
  | { ok: true; processed: boolean; retry?: boolean; reason?: string }
  | { ok: false; error: string };

export interface HandlerDeps {
  /** Test seam — defaults to `loadServerPaddleEnv(process.env)`. */
  readonly env?: ServerPaddleEnv;
  /** Test seam — defaults to global `fetch`. */
  readonly revenueCatFetch?: RevenueCatFetch;
  /** Test seam — defaults to global `fetch`. */
  readonly supabaseFetch?: SupabaseFetch;
  /** Optional public price ids; defaults to reading the same env. */
  readonly priceIds?: PaddlePriceIds;
  /** Test seam — defaults to `Date.now`. */
  readonly now?: () => number;
}

/**
 * Run the full webhook lifecycle. Pure: takes a request-like, returns
 * a response. No Next.js types in scope.
 */
export async function handlePaddleWebhook(
  request: WebhookRequestLike,
  deps: HandlerDeps = {},
): Promise<WebhookResponse> {
  const env = deps.env ?? maybeLoadEnv();
  if (env === null) {
    return {
      status: 503,
      body: {
        ok: false,
        error:
          'Paddle webhook is not configured (PADDLE_WEBHOOK_SECRET / PADDLE_API_KEY missing).',
      },
    };
  }

  const verification = verifyPaddleSignature(request.body, request.header, env.webhookSecret, {
    ...(deps.now !== undefined ? { now: deps.now } : {}),
  });
  if (verification.ok === false) {
    return signatureFailureResponse(verification);
  }

  let event: RawPaddleEvent;
  try {
    event = JSON.parse(request.body) as RawPaddleEvent;
  } catch (error) {
    return {
      status: 400,
      body: {
        ok: false,
        error: `Could not parse webhook body as JSON: ${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }

  const priceIds: PaddlePriceIds = deps.priceIds ?? readPriceIdsFromEnv();
  const mapped = mapPaddleEvent(event, priceIds);

  // Always log — even ignore events. The audit log is the
  // forensics surface.
  const auditBase = {
    paddleEventId: mapped.eventId ?? `unknown_${Date.now()}`,
    eventType: mapped.eventType,
    occurredAt: mapped.occurredAt,
    signatureVerified: true,
    userId: mapped.userId,
    priceId: mapped.priceId,
    entitlementId: mapped.entitlementId,
    action: mapped.action,
    payload: event,
  } as const;

  if (mapped.action === 'ignore') {
    await safelyLog({
      ...auditBase,
      processed: false,
      retry: false,
      error: mapped.ignoreReason !== null ? `ignore:${mapped.ignoreReason}` : null,
    });
    return {
      status: 200,
      body: {
        ok: true,
        processed: false,
        ...(mapped.ignoreReason !== null ? { reason: mapped.ignoreReason } : {}),
      },
    };
  }

  // Grant / revoke — forward to RevenueCat.
  const forwardInput =
    mapped.action === 'grant'
      ? {
          action: 'grant' as const,
          userId: mapped.userId as string,
          entitlementId: mapped.entitlementId as string,
          plan: mapped.plan!,
        }
      : {
          action: 'revoke' as const,
          userId: mapped.userId as string,
          entitlementId: mapped.entitlementId as string,
        };

  const rcResult: RevenueCatForwardResult =
    env.revenueCatApiKey === null
      ? { kind: 'unconfigured' }
      : await forwardEntitlement(forwardInput, {
          apiKey: env.revenueCatApiKey,
          baseUrl: env.revenueCatBaseUrl,
          ...(deps.revenueCatFetch !== undefined ? { fetch: deps.revenueCatFetch } : {}),
        });

  const summary = summariseForwardResult(rcResult);

  await safelyLog({
    ...auditBase,
    processed: summary.processed,
    retry: summary.retry,
    error: summary.error,
  });

  return {
    status: 200,
    body: {
      ok: true,
      processed: summary.processed,
      ...(summary.retry ? { retry: true } : {}),
      ...(summary.reason !== null ? { reason: summary.reason } : {}),
    },
  };

  // ---- helpers ----
  async function safelyLog(row: {
    paddleEventId: string;
    eventType: string;
    occurredAt: string | null;
    signatureVerified: boolean;
    userId: string | null;
    priceId: string | null;
    entitlementId: string | null;
    action: 'grant' | 'revoke' | 'ignore';
    processed: boolean;
    retry: boolean;
    error: string | null;
    payload: unknown;
  }): Promise<RecordWebhookLogResult> {
    if (env === null) return { kind: 'unconfigured' };
    if (env.supabaseUrl.length === 0 || env.supabaseServiceRoleKey === null) {
      return { kind: 'unconfigured' };
    }
    return recordWebhookLog(row, {
      supabaseUrl: env.supabaseUrl,
      supabaseServiceRoleKey: env.supabaseServiceRoleKey,
      ...(deps.supabaseFetch !== undefined ? { fetch: deps.supabaseFetch } : {}),
    });
  }
}

function maybeLoadEnv(): ServerPaddleEnv | null {
  const result = loadServerPaddleEnv();
  return result.kind === 'configured' ? result : null;
}

function readPriceIdsFromEnv(): PaddlePriceIds {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  const env = proc?.env ?? {};
  return {
    monthly: optionalString(env['NEXT_PUBLIC_PADDLE_PRICE_MONTHLY']),
    annual: optionalString(env['NEXT_PUBLIC_PADDLE_PRICE_ANNUAL']),
  };
}

function optionalString(value: string | undefined): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function signatureFailureResponse(verification: SignatureVerification): WebhookResponse {
  if (verification.ok) throw new Error('signatureFailureResponse called with ok verification');
  if (verification.reason === 'missing-secret') {
    return {
      status: 503,
      body: { ok: false, error: 'Paddle webhook secret is not configured.' },
    };
  }
  return {
    status: 401,
    body: { ok: false, error: `Invalid Paddle webhook signature (${verification.reason}).` },
  };
}

interface ForwardSummary {
  processed: boolean;
  retry: boolean;
  error: string | null;
  reason: string | null;
}

function summariseForwardResult(result: RevenueCatForwardResult): ForwardSummary {
  switch (result.kind) {
    case 'ok':
      return { processed: true, retry: false, error: null, reason: null };
    case 'unconfigured':
      return {
        processed: false,
        retry: true,
        error: 'revenuecat:unconfigured',
        reason: 'unconfigured',
      };
    case 'error':
      return {
        processed: false,
        retry: result.retryable,
        error: `revenuecat:${result.status ?? 'network'}:${result.message}`.slice(0, 500),
        reason: 'downstream-error',
      };
  }
}

export const __HEADER_NAME = PADDLE_SIGNATURE_HEADER;
