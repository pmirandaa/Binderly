-- T-PB-PADDLE — paddle_webhook_log table.
--
-- Audit log of Paddle Billing v2 webhook deliveries to
-- `/api/paddle/webhook` on the web app. The handler validates Paddle's
-- HMAC-SHA256 signature, maps the event to a RevenueCat entitlement
-- grant / revoke, and persists ONE row per delivery here.
--
-- Why a dedicated table:
--   * Paddle is the merchant of record (Pablo is in Chile and Stripe
--     does not onboard Chilean sellers); RevenueCat is the unified
--     entitlement source of truth (T-PB-ENTITLEMENTS, next iter). The
--     webhook is the moat between the two, so we keep an immutable
--     audit trail for debugging missed grants and reconciliation.
--   * `processed = false` rows with `retry = true` are picked up by a
--     future reconciliation job (out-of-scope for T-PB-PADDLE; logged
--     as a follow-up). We must never block Paddle's retry queue on a
--     transient downstream RevenueCat failure, so the webhook always
--     returns 200 and lets this table drive the recovery path.
--
-- Idempotency:
--   `paddle_event_id` is UNIQUE. Paddle delivers each event with a
--   stable `event_id` (`evt_...`) that survives retries; the webhook
--   handler upserts on conflict so a Paddle-side retry of the same
--   event refreshes `processed_at` / `error` / `retry` rather than
--   inserting a duplicate row.
--
-- Operational notes:
--   * `event_type` is a free-text Paddle event verb
--     (`subscription.created`, `transaction.completed`, etc.). We
--     intentionally do NOT CHECK-constrain the column — Paddle adds
--     new event types over time and we want the audit log to keep
--     working when we receive an unrecognised one (the handler
--     stores it with `processed = false`, no entitlement action).
--   * `payload` is jsonb — full webhook body for forensics. RC
--     forwarding only reads a small subset (`customData.userId`,
--     `items[].price.id`).
--   * `error` is a short message for the most recent failed attempt.
--     `retry = true` means a reconciliation job should re-attempt the
--     RC forwarding; the row is otherwise terminal once `processed
--     = true`.
--
-- RLS posture: service-role only — same posture as `data_conflict`
-- (`0014/0015`) and `price_observation` (`0008/0009`). End-user
-- sessions never read this audit log; ops queries via psql or the
-- service-role key. Companion migration `0024_paddle_webhook_log_rls.sql`
-- enables RLS, REVOKEs the default Supabase grants, and explicitly
-- GRANTs to `service_role` so the privilege snapshot matches the
-- documented posture.
CREATE TABLE "paddle_webhook_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"paddle_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"occurred_at" timestamp with time zone,
	"signature_verified" boolean DEFAULT false NOT NULL,
	"user_id" uuid,
	"price_id" text,
	"entitlement_id" text,
	"action" text,
	"processed" boolean DEFAULT false NOT NULL,
	"processed_at" timestamp with time zone,
	"retry" boolean DEFAULT false NOT NULL,
	"error" text,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "paddle_webhook_log_paddle_event_id_unique" UNIQUE("paddle_event_id"),
	CONSTRAINT "paddle_webhook_log_action_check" CHECK ("paddle_webhook_log"."action" IS NULL OR "paddle_webhook_log"."action" IN ('grant', 'revoke', 'ignore'))
);
--> statement-breakpoint
CREATE INDEX "paddle_webhook_log_event_type_idx" ON "paddle_webhook_log" USING btree ("event_type");
--> statement-breakpoint
CREATE INDEX "paddle_webhook_log_user_id_idx" ON "paddle_webhook_log" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "paddle_webhook_log_retry_idx" ON "paddle_webhook_log" USING btree ("retry") WHERE "paddle_webhook_log"."retry" = true;
--> statement-breakpoint
CREATE INDEX "paddle_webhook_log_received_at_idx" ON "paddle_webhook_log" USING btree ("received_at" DESC NULLS LAST);
