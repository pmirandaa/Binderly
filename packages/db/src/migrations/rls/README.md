# Binderly RLS posture

This directory documents the **catalog-wide Row Level Security posture** for
every table the app reads or writes, plus the runnable verification script
that asserts the posture against a live Postgres.

The per-table policies themselves live in the hand-authored RLS migrations
that each schema task ships with — this README is the consolidated map, not
the source of truth. The source of truth is the SQL.

| RLS migration                | Tables it governs                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `0001_users_rls.sql`         | `profile`, `subscription`                                                                      |
| `0003_catalog_rls.sql`       | `set`, `card`, `printing`                                                                      |
| `0005_collections_rls.sql`   | `collection_item`, `custom_collection`, `custom_collection_item`, `smart_collection_rule`, `shareable` |
| `0007_grading_rls.sql`       | `grading_submission`, `grading_training_sample`                                                |
| `0009_pricing_rls.sql`       | `market`, `price_observation`, `price_aggregate`, `fx_rate`                                    |

If you change any of those migrations, **update this README in the same PR**
and re-run `pnpm --filter @binderly/db verify-rls` against a freshly-migrated
local Supabase before merging.

---

## Table of contents

1. [Roles glossary](#1-roles-glossary)
2. [Posture at a glance](#2-posture-at-a-glance)
3. [Users](#3-users-profile-subscription)
4. [Catalog](#4-catalog-set-card-printing)
5. [Collections](#5-collections-collection_item-custom_collection-custom_collection_item-smart_collection_rule-shareable)
6. [Grading](#6-grading-grading_submission-grading_training_sample)
7. [Pricing](#7-pricing-market-price_observation-price_aggregate-fx_rate)
8. [`service_role` bypass — who uses it and why](#8-service_role-bypass--who-uses-it-and-why)
9. [Defense-in-depth: SQL grants](#9-defense-in-depth-sql-grants)
10. [How to verify the posture](#10-how-to-verify-the-posture)
11. [Out of scope](#11-out-of-scope-deferred-to-follow-up-tasks)

---

## 1. Roles glossary

Binderly uses Supabase's standard four-role model. Every policy in every
migration is keyed to one of these.

| Role            | Source of truth                                  | RLS                  | What it represents                                                                                                                                            |
| --------------- | ------------------------------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `anon`          | PostgREST role for unauthenticated traffic       | enforced             | A signed-out browser hitting the public API. Sees only what's explicitly granted via a permissive policy.                                                     |
| `authenticated` | PostgREST role after a Supabase JWT is verified  | enforced, `auth.uid() = <user-id>` | An end-user session. `auth.uid()` returns the JWT's `sub` claim; owner-bound policies key off it.                                                          |
| `service_role`  | The Supabase service-role JWT / DB role          | **bypassed** (`BYPASSRLS`) | Trusted server-side surfaces: data-pipeline jobs, edge functions running with the service-role key, the migration tool, the Supabase admin webhook handlers. |
| superuser       | The DB owner / Supabase platform                 | bypassed             | Out of scope here. Reserved for the platform itself; never used by app code.                                                                                  |

`auth.uid()` is the helper Supabase installs on every project; it reads
`request.jwt.claim.sub` set per-request by PostgREST when it validates the
incoming `Authorization: Bearer <jwt>` header.

> **`service_role` bypass is a hard contract, not a convention.** Supabase
> creates the `service_role` Postgres role with the `BYPASSRLS` attribute.
> Every policy below assumes that — none of them are written for
> `service_role`, because the service role doesn't need them. The flip side
> is that any code holding the service-role key is *unauthenticated by
> Postgres*: do not put the service-role key in a browser, mobile binary,
> or any client-reachable surface. It belongs in trusted server processes
> only.

---

## 2. Posture at a glance

`SELECT` rows visible to each role. `✅` = full access; `owner` = only rows
where `auth.uid() = user_id` (or transitively via the parent collection);
`slug` = only rows whose `slug IS NOT NULL` (a tautology today; see
§ 5); `❌` = no rows; `bypass` = `BYPASSRLS`.

| Table                     | `anon`  | `authenticated`  | `service_role` | RLS migration                |
| ------------------------- | ------- | ---------------- | -------------- | ---------------------------- |
| `profile`                 | all     | owner¹           | bypass         | `0001_users_rls.sql`         |
| `subscription`            | ❌       | owner            | bypass²        | `0001_users_rls.sql`         |
| `set`                     | all     | all              | bypass         | `0003_catalog_rls.sql`       |
| `card`                    | all     | all              | bypass         | `0003_catalog_rls.sql`       |
| `printing`                | all     | all              | bypass         | `0003_catalog_rls.sql`       |
| `collection_item`         | ❌       | owner            | bypass         | `0005_collections_rls.sql`   |
| `custom_collection`       | ❌       | owner            | bypass         | `0005_collections_rls.sql`   |
| `custom_collection_item`  | ❌       | parent owner     | bypass         | `0005_collections_rls.sql`   |
| `smart_collection_rule`   | ❌       | parent owner     | bypass         | `0005_collections_rls.sql`   |
| `shareable`               | slug    | owner ∪ slug     | bypass         | `0005_collections_rls.sql`   |
| `grading_submission`      | ❌       | owner            | bypass         | `0007_grading_rls.sql`       |
| `grading_training_sample` | ❌       | ❌                | bypass         | `0007_grading_rls.sql`       |
| `market`                  | all     | all              | bypass         | `0009_pricing_rls.sql`       |
| `price_observation`       | ❌       | ❌                | bypass         | `0009_pricing_rls.sql`       |
| `price_aggregate`         | all     | all              | bypass         | `0009_pricing_rls.sql`       |
| `fx_rate`                 | all     | all              | bypass         | `0009_pricing_rls.sql`       |

¹ `profile` row visibility for `anon` is `USING (true)` — the policy returns
every row. The application (PostgREST + edge functions) is responsible for
**projecting only the public columns** (`handle`, `display_name`,
`avatar_url`, `bio`) when serving anonymous traffic. Private columns
(`preferences`, timestamps) leak only if the application surface forgets to
project. See `0001_users_rls.sql` head comment for the rationale.

² `subscription` writes from RevenueCat / Paddle / Stripe webhooks land via
the service-role key. End-user sessions can only `SELECT` their own row;
they cannot mutate. The `subscription_service_role_write` policy in
`0001_users_rls.sql` is technically redundant given `BYPASSRLS`, but is
authored explicitly to document intent.

Write posture (per role × table):

| Table                     | `anon` writes  | `authenticated` writes        | `service_role` writes |
| ------------------------- | -------------- | ----------------------------- | --------------------- |
| `profile`                 | ❌              | owner only                    | yes (BYPASSRLS)       |
| `subscription`            | ❌              | ❌ (read-own only)             | yes (BYPASSRLS)       |
| `set` / `card` / `printing` | ❌            | ❌                             | yes (BYPASSRLS)       |
| `collection_item`         | ❌              | owner only                    | yes                   |
| `custom_collection`       | ❌              | owner only                    | yes                   |
| `custom_collection_item`  | ❌              | parent-owner only             | yes                   |
| `smart_collection_rule`   | ❌              | parent-owner only             | yes                   |
| `shareable`               | ❌              | owner only                    | yes                   |
| `grading_submission`      | ❌              | owner only                    | yes                   |
| `grading_training_sample` | ❌              | ❌                             | yes                   |
| `market`                  | ❌              | ❌                             | yes                   |
| `price_observation`       | ❌              | ❌                             | yes                   |
| `price_aggregate`         | ❌              | ❌                             | yes                   |
| `fx_rate`                 | ❌              | ❌                             | yes                   |

`❌` for `service_role` does not appear because there is no table the
service role cannot write — by design.

---

## 3. Users (`profile`, `subscription`)

**RLS migration:** `0001_users_rls.sql`. Both tables additionally have a
cross-schema FK to `auth.users(id) ON DELETE CASCADE` declared in this
migration (Drizzle can't author cross-schema FKs to Supabase's managed
`auth` schema).

### `profile`

Stores the public-facing profile (handle, display name, avatar, bio) plus
private settings (`preferences` jsonb).

| Operation | `anon`              | `authenticated`           | `service_role`     |
| --------- | ------------------- | ------------------------- | ------------------ |
| SELECT    | all rows (`profile_public_read`) | own row (`profile_owner_select`) | bypass |
| INSERT    | ❌                   | own row (`profile_owner_insert`) | bypass             |
| UPDATE    | ❌                   | own row (`profile_owner_update`) | bypass             |
| DELETE    | ❌                   | own row (`profile_owner_delete`) | bypass             |

The `profile_public_read` policy returns `true` for every row — meaning
**Postgres serves the full row** to anonymous traffic. The expectation is
that the API layer projects only public columns when responding to
unauthenticated requests. This is documented in `0001_users_rls.sql` and is
how the public render path `/c/{handle}/{slug}` resolves a creator's
display name without a JWT.

### `subscription`

Stores tier, source, and external customer id from RevenueCat / Paddle /
Stripe.

| Operation | `anon` | `authenticated`               | `service_role`                                  |
| --------- | ------ | ----------------------------- | ----------------------------------------------- |
| SELECT    | ❌      | own row (`subscription_owner_select`) | bypass (also covered by `subscription_service_role_write`) |
| INSERT    | ❌      | ❌                              | bypass / `subscription_service_role_write`     |
| UPDATE    | ❌      | ❌                              | bypass / `subscription_service_role_write`     |
| DELETE    | ❌      | ❌                              | bypass / `subscription_service_role_write`     |

End-user sessions never write `subscription`. Webhook handlers land via the
service-role key.

---

## 4. Catalog (`set`, `card`, `printing`)

**RLS migration:** `0003_catalog_rls.sql`.

Catalog data is **public-read, service-role-write**. The browse, search,
scanner-lookup, and shareable-render paths all rely on `anon` being able to
SELECT.

| Operation | `anon`                        | `authenticated`                | `service_role` |
| --------- | ----------------------------- | ------------------------------ | -------------- |
| SELECT    | all (`{set,card,printing}_public_read`) | all (same policy) | bypass         |
| INSERT    | ❌                             | ❌                              | bypass         |
| UPDATE    | ❌                             | ❌                              | bypass         |
| DELETE    | ❌                             | ❌                              | bypass         |

There are no write policies on these tables. With RLS enabled and no
permissive write policy, non-service writes are denied. The
`0003_catalog_rls.sql` migration also `REVOKE`s the Supabase-default
`INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER` grants on `anon` and
`authenticated` so the SQL-level privilege snapshot matches the policy
posture (defense in depth — see § 9).

---

## 5. Collections (`collection_item`, `custom_collection`, `custom_collection_item`, `smart_collection_rule`, `shareable`)

**RLS migration:** `0005_collections_rls.sql`. All five tables additionally
get a cross-schema FK to `auth.users(id) ON DELETE CASCADE` for any column
named `user_id`.

### `collection_item`, `custom_collection`, `shareable` — direct ownership

These tables carry their own `user_id` column. Policies key off
`auth.uid() = user_id`.

| Table              | Policies                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| `collection_item`  | `*_owner_select`, `*_owner_insert`, `*_owner_update`, `*_owner_delete` (all gated on `user_id`)   |
| `custom_collection`| same as above                                                                                     |
| `shareable`        | same as above, plus `shareable_public_read_by_slug` (`anon, authenticated` SELECT where `slug IS NOT NULL`) |

`shareable.slug` is `NOT NULL` in the schema, so the slug-gated policy is a
tautology today. The actual access control is the slug's CSPRNG entropy
(generated by the create-shareable edge function in stage 2). The
predicate documents intent and survives any future migration that
nullable-izes the column for soft-delete or draft semantics.

### `custom_collection_item`, `smart_collection_rule` — transitive ownership

These tables have no `user_id` column of their own — they nest under
`custom_collection`. Policies use an `EXISTS` subquery that resolves the
parent collection's owner.

```
USING (
  EXISTS (
    SELECT 1 FROM "custom_collection" cc
    WHERE cc.id = <child>.custom_collection_id
      AND cc.user_id = auth.uid()
  )
)
```

Same `*_owner_select` / `*_owner_insert` / `*_owner_update` /
`*_owner_delete` shape as the direct-owner tables. The subquery is faster
than a join in PG's RLS optimizer and rides the existing PK index on
`custom_collection.id`.

### Role × table matrix

| Operation | `anon`                                | `authenticated`         | `service_role` |
| --------- | ------------------------------------- | ----------------------- | -------------- |
| SELECT collection_item / custom_collection / *_item / smart_collection_rule | ❌ | owner / parent owner    | bypass         |
| SELECT shareable                       | rows with `slug IS NOT NULL` | own rows ∪ rows with `slug IS NOT NULL` | bypass |
| INSERT / UPDATE / DELETE on any of the five | ❌                          | owner / parent owner    | bypass         |

---

## 6. Grading (`grading_submission`, `grading_training_sample`)

**RLS migration:** `0007_grading_rls.sql`. `grading_submission` carries a
cross-schema FK to `auth.users(id) ON DELETE CASCADE`. The training corpus
is not user-owned and has no such FK.

### `grading_submission`

Per-user grading attempts. Owner-only CRUD.

| Operation | `anon` | `authenticated`                                         | `service_role` |
| --------- | ------ | ------------------------------------------------------- | -------------- |
| SELECT    | ❌      | own row (`grading_submission_owner_select`)             | bypass         |
| INSERT    | ❌      | own row (`grading_submission_owner_insert`)             | bypass         |
| UPDATE    | ❌      | own row (`grading_submission_owner_update`)             | bypass         |
| DELETE    | ❌      | own row (`grading_submission_owner_delete`)             | bypass         |

The community-flywheel ingestion job (stage 7) reads `grading_submission`
via the service-role key, but only acts on rows whose owner has set
`profile.preferences.grading_flywheel_opt_in = true` — that opt-in check
is **enforced in the application layer**, not in RLS, so the SQL-level
posture stays simple.

### `grading_training_sample`

Service-role-only training corpus. **No permissive policies for
`anon` or `authenticated`.** Combined with the SQL-level REVOKE,
end-user sessions cannot read or write at all.

| Operation | `anon` | `authenticated` | `service_role` |
| --------- | ------ | --------------- | -------------- |
| any       | ❌      | ❌               | bypass         |

Stage-07 ingestion pipelines (T-GR-DATA-PSA, T-GR-DATA-EBAY,
T-GR-DATA-AUCTIONS) and the community-flywheel cron all run with the
service-role key and write here.

---

## 7. Pricing (`market`, `price_observation`, `price_aggregate`, `fx_rate`)

**RLS migration:** `0009_pricing_rls.sql`. No cross-schema FKs (pricing is
sourced from third-party APIs, not user activity).

Pricing splits into two postures:

- **Consumer-facing (public-read, service-role-write)**: `market`,
  `price_aggregate`, `fx_rate`. These power the price chips on cards,
  the "all markets" toggle, and the display-time currency conversion.
- **Pipeline-internal (service-role-only)**: `price_observation`. The
  raw signal table — every quote / sale we ingest from aggregators or
  eBay APIs. Never read directly by clients.

### Role × table matrix

| Operation | `anon`         | `authenticated`  | `service_role` |
| --------- | -------------- | ---------------- | -------------- |
| SELECT market / price_aggregate / fx_rate | all (`*_public_read`) | all | bypass |
| SELECT price_observation                  | ❌             | ❌                | bypass         |
| INSERT / UPDATE / DELETE on any           | ❌             | ❌                | bypass         |

`price_observation` is the only "totally private" pricing table. All
display-layer reads go through `price_aggregate` (daily rollup) or the
`mv_current_price` materialized view (T-DL-PRICING-CURRENT-VIEW); the
display layer should never SELECT `price_observation` directly.

---

## 8. `service_role` bypass — who uses it and why

Postgres role `service_role` is created by Supabase with the `BYPASSRLS`
attribute. Code holding the service-role JWT bypasses every policy in
this README. The bypass is intentional and load-bearing — without it the
following surfaces could not function:

| Surface                                              | Why it needs `service_role`                                                                                       |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `data-pipeline` ingest jobs (TCGdex EN/JP, pokemontcg.io, Bulbapedia, image pipeline) | Writing `set` / `card` / `printing` is service-role-only. Adapters run as the data-pipeline cron, not as a user.  |
| Pricing ingest (`T-DL-PRICING-AGGREGATOR`, `T-DL-PRICING-EBAY-BROWSE`) | Writes `price_observation` (totally private) and `price_aggregate` (consumer-facing, service-role-write).         |
| FX-rate cron (`T-DL-FX-RATES`)                       | Writes `fx_rate`.                                                                                                  |
| Grading training-corpus ingest (`T-GR-DATA-*`)       | Writes `grading_training_sample` (totally private).                                                                |
| Community-flywheel cron                              | Reads `grading_submission` rows whose owner opted in, writes `grading_training_sample`.                            |
| Subscription webhook handler (RevenueCat / Paddle / Stripe) | Writes `subscription` from server-to-server webhook calls. End users cannot mutate this table.                     |
| `db:migrate` / Drizzle migrator                      | DDL + RLS policy creation. Migrations run as the DB owner against the local Supabase, against `service_role` in production. |
| Admin / ops scripts and break-glass debugging        | Anything reading or repairing data outside the user-facing API.                                                    |

**Hard constraint:** the service-role key (and the corresponding JWT)
**must never** ship to a browser, mobile binary, or any client-reachable
surface. Place of safekeeping:

- Server-only env vars (`PIPELINE_SUPABASE_SERVICE_ROLE_KEY`,
  `EDGE_SUPABASE_SERVICE_ROLE_KEY` — see `.env.example`).
- The Supabase Edge Functions runtime (which injects the service-role
  key automatically when running in the cloud).
- CI secret stores (`SUPABASE_SERVICE_ROLE_KEY` in GitHub Actions for
  the `deploy-db` workflow).

If you need a "trusted server-side surface" outside those, raise an
open-question. There is no `service_role`-equivalent role with narrower
write scope today; if scope-narrowing becomes necessary we'll add a
purpose-built Postgres role and grant DML on the specific tables it
needs.

---

## 8.1 Known posture gap — `profile` SQL grants (under review)

The verification script (§ 10) currently surfaces four failures against a
freshly-migrated **local** Supabase Postgres (port `54322`):

```
✗ behavior:authenticated reads own profile row                   permission denied for table profile
✗ behavior:authenticated cannot read other-user profile row …    permission denied for table profile
✗ behavior:anon profile_public_read sees rows                    permission denied for table profile
✗ behavior:service_role bypass — sees all profile rows           permission denied for table profile
```

Root cause: `0001_users_rls.sql` (the migration that authors RLS for
`profile` and `subscription`) ships **only** policies — no explicit
`REVOKE` / `GRANT` statements. Migrations `0003` / `0005` / `0007` /
`0009` all ship explicit grants as defense in depth; `0001` is the
outlier.

In the **hosted** Supabase project, the platform's project-init runs
`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,
authenticated, service_role` before any migration runs, so new tables
get the grants for free and the policies fire as designed. In the
**local** Supabase CLI (`supabase start`), `pg_default_acl` for the
`public` schema is empty in this version, so `profile` ends up with no
privileges for the three application roles and PostgREST denies before
RLS can run.

This is **not patched in this PR** — modifying merged migration
`0001_users_rls.sql` would rewrite `main`'s history. The orchestrator's
escalation hook for "verify-rls reveals a real RLS bug" is the right
path; see `open-questions.md` Q-003 for the proposed corrective
migration (an additive `0010_users_rls_grants_fix.sql` that ships the
defense-in-depth grants 0001 omitted).

## 9. Defense-in-depth: SQL grants

Each RLS migration also `REVOKE`s the Supabase project-init defaults
(`ALTER DEFAULT PRIVILEGES … GRANT ALL ON TABLES IN SCHEMA public TO anon,
authenticated`) and re-`GRANT`s the per-policy minimum. Why:

- RLS already blocks operations that have no permissive policy, but the
  SQL-level grants are misleading on `\dp` and could become a foot-gun
  if someone disables RLS for debugging and forgets to re-enable it.
- PostgREST checks SQL privileges **before** RLS. If `anon` has no
  `SELECT` privilege on a table, the read fails with a privilege error
  before any policy runs. Our REVOKE/GRANT layout makes the privilege
  snapshot match the policy snapshot.

The verification script (§ 10) audits `pg_class.relrowsecurity` and the
policy inventory but **does not** currently audit `pg_class.relacl` /
`information_schema.role_table_grants`. Adding that audit is on the
follow-up list (see § 11).

---

## 10. How to verify the posture

```sh
# From the repo root, against a freshly-migrated local Supabase:
SUPABASE_DB_URL=postgresql://postgres:postgres@localhost:54322/postgres \
  pnpm --filter @binderly/db verify-rls
```

The script (`packages/db/scripts/verify-rls.ts`) connects to the target
Postgres and runs four classes of assertions:

1. **Table inventory.** Every table in §§ 3–7 exists in `public`.
2. **RLS enabled.** `pg_class.relrowsecurity = true` for every table.
3. **Policy inventory.** Every expected `(tablename, policyname, roles,
   cmd)` tuple exists in `pg_policies`. Extra policies surface as a
   warning, not a failure (the `0001/0003/0005/0007/0009` migrations
   are the source of truth — if a policy was added to `main` without
   updating this README and the script, the orchestrator should be
   notified before the addition merges).
4. **Behavioral spot-check.** The script connects to the target,
   `SET LOCAL`s `request.jwt.claims` to a synthetic JWT, switches roles
   between `anon` / `authenticated` / `service_role`, and runs
   parameterized SELECTs that assert the documented row-visibility
   matrix on the `profile` / `collection_item` / `shareable` /
   `grading_submission` tables.

Exit codes:

- `0` — all assertions passed.
- `1` — at least one assertion failed; the failure is printed in full
  with the SQL that produced it.
- `2` — the script could not run (no DB URL provided, connection failed,
  or required tables are missing). Treat as "verification skipped" — run
  it again once you have a live Supabase.

The script is **typecheck-clean and lint-clean without a live DB**; it
only needs the DB at runtime.

---

## 11. Out of scope (deferred to follow-up tasks)

The original `T-DL-RLS-POLICIES` brief mentioned two items that are
explicitly deferred:

1. **`data_conflict` table.** Documented in `context/data-model.md` as an
   admin-only audit surface for resolver disagreements between sources.
   The schema does not exist today — the resolver
   (`data-pipeline/src/types.ts`) emits in-memory `DataConflict`
   records but does not persist them. Deferred to **T-DL-DATA-CONFLICT-TABLE**
   (schema + RLS migration + resolver wiring).
2. **Admin debug surfaces.** `pg_stat_statements` exposure to
   `service_role` only, an admin-only audit view joining
   `printing × card × set`, and audit-log read views. None of these are
   on the path of any current ready task. Deferred to
   **T-DL-ADMIN-DEBUG-SURFACES**.

A third item that's worth filing once the verification script is in
production use:

3. **SQL-grant audit in `verify-rls.ts`.** Currently the script asserts
   policies and behavioral spot-checks; it does not assert
   `information_schema.role_table_grants`. Adding that closes the
   "someone disabled RLS for debugging and the GRANTs were too
   permissive" gap.
