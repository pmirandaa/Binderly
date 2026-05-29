// `shareable` — public-link configuration over a user's collection or
// custom collection.
//
// Mirrors `context/data-model.md` § "User tables → shareable" and
// PROJECT.md § 14 (Shareables). The public URL surface is
// `/c/{profile.handle}/{slug}`; SSR pages render with theme + show_*
// toggles applied. Free tier: 1 shareable per user; paid: unlimited
// and themed.
//
// Notes for downstream readers:
// - `user_id` is plain `uuid` (no Drizzle `references()`); the
//   cross-schema FK to `auth.users(id)` ON DELETE CASCADE is added by
//   hand in the companion RLS migration.
// - `slug` is unique *per user* (composite UNIQUE on `(user_id, slug)`)
//   for the same reason as `custom_collection.slug` — the URL path
//   namespaces by `handle`. The slug doubles as an unguessable URL
//   token: it's the only thing protecting an unauthenticated visitor's
//   request, so the application layer (the create-shareable edge
//   function in stage 2) must generate it from a CSPRNG. Schema-level
//   we just enforce the (user_id, slug) uniqueness; entropy is a
//   policy concern.
// - `target` is `jsonb` storing the discriminated union
//   `{kind: 'full'} | {kind: 'custom', custom_collection_id: <uuid>}`.
//   We do NOT model `custom_collection_id` as a real foreign-key
//   column because the union is asymmetric — `kind: 'full'` has no
//   collection — and a partial / conditional FK in Postgres requires
//   either a trigger or a denormalised nullable column. The
//   application layer (the same edge function) is responsible for
//   verifying the referenced `custom_collection_id` belongs to the
//   same user when `target.kind = 'custom'`. Schema-level CHECK
//   enforces only that `target` has a recognized `kind`.
// - The boolean toggles default per spec: `show_values=false` (privacy
//   default — collections are public but values are not),
//   `show_missing=true` (the master-set "what I'm chasing" surface is
//   the headline use case for shareables), `show_photos=false` (user
//   uploads stay private unless explicitly opted in).
// - `theme` defaults to `'default'`. Themed shareables are a paid
//   feature (PROJECT § 16); the schema accepts any text and the API
//   layer gates non-default themes by subscription tier.

import { sql } from 'drizzle-orm';
import { boolean, check, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

export const shareable = pgTable(
  'shareable',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    // Cross-schema FK to `auth.users(id)` ON DELETE CASCADE is emitted
    // in the companion RLS migration; Drizzle cannot author it here.
    userId: uuid('user_id').notNull(),
    slug: text('slug').notNull(),
    target: jsonb('target').notNull(),
    theme: text('theme').notNull().default('default'),
    // Kill switch (#FU-50). When false the public render endpoint
    // 404s and the slug-gated anon read policy hides the row; the
    // owner still sees it in their settings list. The hand-authored
    // companion migration `0027_shareable_owner_config.sql` adds the
    // column + folds `is_active = true` into the public-read policy.
    isActive: boolean('is_active').notNull().default(true),
    showValues: boolean('show_values').notNull().default(false),
    showMissing: boolean('show_missing').notNull().default(true),
    showPhotos: boolean('show_photos').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    unique('shareable_user_id_slug_unique').on(table.userId, table.slug),
    // Validate the discriminator at the storage layer; deeper shape
    // (e.g. presence of `custom_collection_id` when kind = 'custom')
    // is the API layer's job. `?` is the jsonb "key exists" operator,
    // and `->>` extracts the value as text — both are PG-stable.
    check(
      'shareable_target_kind_check',
      sql`${table.target} ? 'kind' AND ${table.target}->>'kind' IN ('full', 'custom')`,
    ),
  ],
);

export type Shareable = typeof shareable.$inferSelect;
export type NewShareable = typeof shareable.$inferInsert;
