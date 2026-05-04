// Drizzle schema for the `subscription` table.
//
// Mirrors `context/data-model.md` § "User tables → subscription" exactly.
// One row per user; the PK is `user_id`, which is also a 1:1 FK to
// `auth.users(id)` ON DELETE CASCADE. As with `profile`, the cross-schema
// FK to `auth.users` is emitted in the hand-authored RLS migration
// (`<NNNN+1>_users_rls.sql`) — drizzle-kit can't author cross-schema FKs
// from a Drizzle table definition.
//
// `tier` is constrained to `'free' | 'pro'` via a CHECK constraint
// declared inline below so it ships in the generated migration. Read
// paths can rely on this enum without runtime branching.
//
// `source`, `external_customer_id`, `expires_at`, `last_event_at`, and
// `raw` are all nullable: a user with no paid subscription has only
// `tier='free'` and the rest empty. Stripe / RevenueCat webhooks fill
// the remaining fields once a subscription becomes active.

import { sql } from 'drizzle-orm';
import { check, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const subscription = pgTable(
  'subscription',
  {
    // 1:1 with `auth.users(id)`. FK + ON DELETE CASCADE emitted in the
    // companion RLS migration.
    userId: uuid('user_id').primaryKey(),
    tier: text('tier').notNull().default('free'),
    source: text('source'),
    externalCustomerId: text('external_customer_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastEventAt: timestamp('last_event_at', { withTimezone: true }),
    raw: jsonb('raw'),
  },
  (table) => [check('subscription_tier_check', sql`${table.tier} IN ('free', 'pro')`)],
);

export type Subscription = typeof subscription.$inferSelect;
export type NewSubscription = typeof subscription.$inferInsert;
