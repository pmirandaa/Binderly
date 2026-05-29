// Drizzle schema for the `profile` table.
//
// Mirrors `context/data-model.md` § "User tables → profile" exactly:
// the PK is `user_id` and there is a 1:1 FK to `auth.users(id)`. The FK
// is intentionally NOT declared at the Drizzle level because `auth.users`
// lives in Supabase's managed `auth` schema — we don't author migrations
// against it. The cross-schema FK constraint is added in the
// hand-authored RLS migration that pairs with this file
// (`<NNNN+1>_users_rls.sql`). See the spec file for the rationale.
//
// `handle` is `citext` so that uniqueness is enforced case-insensitively.
// We register a small custom type because drizzle-orm doesn't ship a
// first-class `citext` builder; the generated SQL becomes
// `"handle" citext NOT NULL UNIQUE`. The `citext` extension itself is
// created at the top of the generated table-creation migration
// (Supabase ships citext in the `extensions` schema; `CREATE EXTENSION
// IF NOT EXISTS citext` is idempotent).
//
// `preferences` is jsonb with a `'{}'::jsonb` default. The shape of the
// JSON is contractual and lives in two other places — a zod schema in
// `packages/shared-types/src/profile-preferences.ts` (out of scope for
// this task) and the documentation in `context/data-model.md`
// § "profile.preferences shape". This file only enforces the *column
// type* and default; runtime validation is the API layer's job.

import { sql } from 'drizzle-orm';
import { customType, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const citext = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'citext';
  },
});

export const profile = pgTable('profile', {
  // 1:1 with `auth.users(id)`. The FK + ON DELETE CASCADE constraint is
  // emitted in the companion RLS migration (cross-schema FK; drizzle-kit
  // can't author it from this file).
  userId: uuid('user_id').primaryKey(),
  handle: citext('handle').notNull().unique(),
  displayName: text('display_name'),
  avatarUrl: text('avatar_url'),
  bio: text('bio'),
  // Owner "link in bio" list (#FU-51). Nullable jsonb storing an
  // array of `{ label, url }` objects; the API layer
  // (`socialLinksSchema` in `@binderly/api-contracts`) validates the
  // shape and readers coerce NULL → `[]`. Added by the hand-authored
  // `0027_shareable_owner_config.sql` migration.
  socialLinksJson: jsonb('social_links_json'),
  // Shape contract: see `packages/shared-types/src/profile-preferences.ts`
  // (zod) and `context/data-model.md` § "profile.preferences shape".
  preferences: jsonb('preferences')
    .notNull()
    .default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Profile = typeof profile.$inferSelect;
export type NewProfile = typeof profile.$inferInsert;
