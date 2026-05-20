// Webhook audit log helper.
//
// The webhook handler upserts ONE row per Paddle delivery into
// `paddle_webhook_log` (migration 0023). We use the Supabase REST
// PostgREST endpoint with the service-role key so the route doesn't
// need a long-lived DB connection inside Next.js's edge/serverless
// runtime.
//
// Failure mode: this helper NEVER throws. If the audit insert
// fails (network blip, env not set), we log to stderr and the
// webhook still returns 200 — Paddle's webhook retry queue would
// otherwise loop forever for an issue unrelated to the upstream
// event. Reconciliation across retries is the
// `paddle_event_id`-UNIQUE upsert; if the next retry succeeds, the
// row lands.

export type SupabaseFetch = (
  input: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export interface RecordWebhookLogDeps {
  readonly supabaseUrl: string;
  readonly supabaseServiceRoleKey: string;
  /** Test seam — defaults to global `fetch`. */
  readonly fetch?: SupabaseFetch;
}

export interface PaddleWebhookLogRow {
  readonly paddleEventId: string;
  readonly eventType: string;
  readonly occurredAt: string | null;
  readonly signatureVerified: boolean;
  readonly userId: string | null;
  readonly priceId: string | null;
  readonly entitlementId: string | null;
  readonly action: 'grant' | 'revoke' | 'ignore' | null;
  readonly processed: boolean;
  readonly retry: boolean;
  readonly error: string | null;
  readonly payload: unknown;
}

export type RecordWebhookLogResult =
  | { readonly kind: 'ok' }
  | { readonly kind: 'unconfigured' }
  | { readonly kind: 'error'; readonly status: number | null; readonly message: string };

/**
 * Insert (or upsert on `paddle_event_id`) one audit row.
 *
 * - When `supabaseServiceRoleKey` is missing, returns
 *   `unconfigured` and the caller logs a warning. The webhook
 *   still returns 200 so Paddle stops retrying.
 * - When the insert fails (HTTP 4xx/5xx, network), returns `error`
 *   and the caller logs a warning. The webhook still returns 200;
 *   the row is lost (downside is acceptable — RevenueCat is the
 *   source of truth for entitlements).
 */
export async function recordWebhookLog(
  row: PaddleWebhookLogRow,
  deps: RecordWebhookLogDeps,
): Promise<RecordWebhookLogResult> {
  if (deps.supabaseUrl.length === 0 || deps.supabaseServiceRoleKey.length === 0) {
    return { kind: 'unconfigured' };
  }
  const fetchImpl = deps.fetch ?? (globalThis.fetch as SupabaseFetch | undefined);
  if (typeof fetchImpl !== 'function') {
    return { kind: 'error', status: null, message: 'fetch is not available' };
  }

  const baseUrl = stripTrailingSlash(deps.supabaseUrl);
  const url = `${baseUrl}/rest/v1/paddle_webhook_log?on_conflict=paddle_event_id`;
  const body = JSON.stringify([toPostgrestRow(row)]);

  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: deps.supabaseServiceRoleKey,
        Authorization: `Bearer ${deps.supabaseServiceRoleKey}`,
        // PostgREST upsert — `merge-duplicates` updates the
        // existing row when `paddle_event_id` collides.
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body,
    });
    if (response.ok) return { kind: 'ok' };
    const message = await safeText(response);
    return { kind: 'error', status: response.status, message };
  } catch (error) {
    return {
      kind: 'error',
      status: null,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function toPostgrestRow(row: PaddleWebhookLogRow): Record<string, unknown> {
  return {
    paddle_event_id: row.paddleEventId,
    event_type: row.eventType,
    occurred_at: row.occurredAt,
    signature_verified: row.signatureVerified,
    user_id: row.userId,
    price_id: row.priceId,
    entitlement_id: row.entitlementId,
    action: row.action,
    processed: row.processed,
    processed_at: row.processed ? new Date().toISOString() : null,
    retry: row.retry,
    error: row.error,
    payload: row.payload,
    updated_at: new Date().toISOString(),
  };
}

function stripTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

async function safeText(response: { text: () => Promise<string> }): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '<unreadable response body>';
  }
}
