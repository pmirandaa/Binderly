// `paddle_webhook_log` — audit trail of Paddle Billing v2 webhook
// deliveries to the web app's `/api/paddle/webhook` route.
//
// One row per Paddle event delivery. The webhook handler:
//
//   1. Verifies Paddle's HMAC-SHA256 signature against
//      `PADDLE_WEBHOOK_SECRET`.
//   2. Maps the event verb (`subscription.created`,
//      `transaction.completed`, `subscription.canceled`, …) to a
//      RevenueCat entitlement action (`grant` | `revoke` | `ignore`).
//   3. Forwards the action to RevenueCat's REST API using the
//      `customData.userId` Paddle propagated through checkout.
//   4. Persists ONE row here regardless of the outcome — so a future
//      reconciliation job can replay the unprocessed (`processed =
//      false`, `retry = true`) rows when downstream RC is healthy
//      again.
//
// Why this lives here rather than in `apps/web/`: the web app writes
// to it but the schema lives next to every other Postgres table so
// migrations stay atomic and `verify-rls` covers the whole DB. The
// RLS posture is service-role-only (no anon / authenticated access),
// matching `data_conflict`, `price_observation`, and
// `grading_training_sample`.
//
// Idempotency:
//   `paddle_event_id` is UNIQUE. Paddle's `event_id` (`evt_…`) is
//   stable across retries; the webhook handler upserts on conflict
//   so a Paddle-side retry refreshes the row instead of inserting
//   a duplicate.
//
// `event_type` is intentionally NOT CHECK-constrained — Paddle adds
// new event verbs over time and we want the audit log to keep
// recording even when we receive an unrecognised event (the handler
// stores it with `processed = false` + `action = 'ignore'`).

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

export const paddleWebhookLog = pgTable(
  'paddle_webhook_log',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    paddleEventId: text('paddle_event_id').notNull(),
    eventType: text('event_type').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }),
    signatureVerified: boolean('signature_verified').notNull().default(false),
    userId: uuid('user_id'),
    priceId: text('price_id'),
    entitlementId: text('entitlement_id'),
    action: text('action'),
    processed: boolean('processed').notNull().default(false),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    retry: boolean('retry').notNull().default(false),
    error: text('error'),
    payload: jsonb('payload').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    unique('paddle_webhook_log_paddle_event_id_unique').on(table.paddleEventId),
    check(
      'paddle_webhook_log_action_check',
      sql`${table.action} IS NULL OR ${table.action} IN ('grant', 'revoke', 'ignore')`,
    ),
    index('paddle_webhook_log_event_type_idx').on(table.eventType),
    index('paddle_webhook_log_user_id_idx').on(table.userId),
    index('paddle_webhook_log_received_at_idx').on(table.receivedAt.desc()),
  ],
);

export type PaddleWebhookLogRow = typeof paddleWebhookLog.$inferSelect;
export type NewPaddleWebhookLogRow = typeof paddleWebhookLog.$inferInsert;
