# T-DL-SCHEMA-GRADING — DB schema for grading_submission and ML training data

**Stage:** 01-data-layer
**Agent role:** backend
**Effort:** S
**Status:** pending

## Hard dependencies

- T-DL-SCHEMA-USERS (provides cross-schema FK pattern for `auth.users` and
  the `profile` table whose `preferences.grading_flywheel_opt_in` flag
  governs training-data eligibility)

## Soft dependencies

- T-DL-SCHEMA-CARDS (parallel-safe; provides the `printing` table this
  schema FKs into for known-card grading attempts)
- T-DL-SCHEMA-COLLECTIONS, T-DL-SCHEMA-PRICING (parallel-safe)

## Required reading

- `PROJECT.md` § 12 (Grading Pipeline) — multi-shot capture, four
  subgrades (centering / corners / edges / surface), aggregate +
  confidence band, three external training-data ingestion pipelines
  (PSA cert lookup, eBay sold listings, auction archives), plus the
  community-submission flywheel
- `PROJECT.md` § 16 (Freemium) — grading prediction is a paid feature;
  the community flywheel is paid-only
- `rules/01-data-layer.md` — naming, RLS posture, migration conventions
- `rules/07-grading.md` — confidence-band UI rule, training-data
  hygiene, calibration target
- `context/data-model.md` § "User tables → grading_submission" (the
  normative spec for the primary table) and § "RLS policies"
- `context/conventions.md` — TS / SQL / migration conventions
- `context/legal-and-brand.md` — image hosting (user uploads in Supabase
  Storage with strict owner-only RLS) and PSA scraping ToS guardrails
  that the training-data table must accommodate
- **Merged code from `T-DL-SCHEMA-USERS`** —
  `packages/db/src/schema/profiles.ts`, `subscriptions.ts`;
  `packages/db/src/migrations/0000_user_tables.sql`,
  `0001_users_rls.sql`. Match style and the cross-schema FK pattern
  (Drizzle declares `uuid('user_id').notNull()` without `references()`;
  the `auth.users` FK is emitted in the hand-authored RLS migration).
- **Sibling reference (CARDS)** —
  `packages/db/src/schema/sets.ts`, `cards.ts`, `printings.ts`;
  `0002_catalog_tables.sql`, `0003_catalog_rls.sql`. Match style for
  service-role-only-write tables (REVOKE + GRANT pattern in the RLS
  migration, RLS-enabled with no permissive policies = denied for
  non-service roles).

## Goal

Define the Drizzle schema for `grading_submission` (user-owned multi-shot
grading captures) and the sibling `grading_training_sample` table
(service-role-only training corpus populated by the stage-07 scrapers and
the community flywheel). The product spec calls for both: § 12 mandates
user-facing per-submission storage of front/back/corner/surface images
plus predicted subgrades and an `actual` payload that's filled in when
the user later uploads their slab; the same § names three external
ingestion pipelines (PSA, eBay sold, auction archives) whose data shape
(no user owner, variable image count, optional printing match) does not
fit `grading_submission`. Splitting them keeps user PII out of the
training corpus and matches the orchestrator's "training-data table (if
separate) likely has tighter access — only service_role reads/writes;
users never see it directly" guidance. Both tables ship in a single
schema file (`packages/db/src/schema/grading.ts`) to stay within
`owns_paths`. RLS is wired up per `context/data-model.md` § "RLS
policies": owner-CRUD on `grading_submission`, service-role-only on
`grading_training_sample`.

## Deliverables

- `packages/db/src/schema/grading.ts` — single schema file exporting two
  Drizzle tables:
  - `gradingSubmissionTable` (`grading_submission`) matching the spec in
    `context/data-model.md` § "grading_submission" column-for-column.
    `user_id` is plain `uuid('user_id').notNull()` (cross-schema FK to
    `auth.users(id)` lives in the RLS migration). `printing_id` is a
    `uuid('printing_id').references(() => printingTable.id, { onDelete: 'set null' })`
    nullable FK (the user may not yet know which printing the card is at
    capture time; `set null` preserves the submission if a catalog row
    is reorganized). `corner_urls` is `text[]` constrained to length 4
    via a check. `status` is `text` with a check constraint pinning the
    enum `('predicted', 'submitted_for_grading', 'graded')`. `predicted`
    and `actual` are `jsonb` (nullable for `actual` — populated only
    when the user uploads their actual slab).
  - `gradingTrainingSampleTable` (`grading_training_sample`) — a
    service-role-only training corpus. Columns:
    - `id uuid PK gen_random_uuid()`
    - `source text NOT NULL` with check `IN ('psa_cert',
      'ebay_sold', 'auction_pwcc', 'auction_goldin',
      'community_flywheel')` covering the three external ingestion
      pipelines named in PROJECT.md § 12 plus the flywheel
    - `source_id text NOT NULL` (cert number, eBay item id, auction
      lot id, or originating `grading_submission.id` for flywheel
      samples) — `(source, source_id)` is unique to dedupe
      idempotent ingestion
    - `source_url text` (provenance fallback — never surfaced to
      clients; `legal-and-brand.md` requires we keep it for kill-switch
      / takedown response)
    - `printing_id uuid REFERENCES printing(id) ON DELETE SET NULL`
      (nullable; not every scraped sample matches a known printing)
    - `grade_company text NOT NULL` with check `IN ('PSA', 'BGS',
      'CGC', 'SGC', 'OTHER')`
    - `grade numeric(3,1)` (overall grade; nullable because
      partial-quality samples may carry only subgrade hints)
    - `subgrades jsonb` ({centering?, corners?, edges?, surface?} —
      shape mirrors `grading_submission.predicted` so downstream
      training code reuses one parser)
    - `images jsonb NOT NULL DEFAULT '{}'::jsonb` (
      {front?, back?, corners?: text[], surface?, raw_photos?: text[]}
      — variable shape per spec: "many listings only have one shot")
    - `parse_confidence numeric(3,2)` (0..1; aggregator excludes
      <0.7, mirroring price_observation conventions)
    - `raw_metadata jsonb NOT NULL DEFAULT '{}'::jsonb` (parser
      breadcrumbs, scraped title, source HTML excerpt — debug surface
      for the stage-07 ingestion tasks)
    - `ingested_at timestamptz NOT NULL DEFAULT now()`
    - standard `created_at` / `updated_at` timestamps
  - Both tables export `$inferSelect` / `$inferInsert` type aliases
    (e.g. `GradingSubmission`, `NewGradingSubmission`,
    `GradingTrainingSample`, `NewGradingTrainingSample`).
- `packages/db/src/schema/index.ts` — uncomment **only** the line in the
  pre-staged `T-DL-SCHEMA-GRADING` section
  (`export * from './grading.js';`). Do not edit other sections, do not
  remove the trailing `export {};` placeholder.
- `packages/db/src/migrations/<NNNN>_grading_tables.sql` — drizzle-kit
  generated migration for the two tables, their indexes, the in-public
  FK to `printing(id)`, the check constraints, and the unique
  constraint on `grading_training_sample(source, source_id)`. Filename
  number is whatever drizzle-kit chooses next (current journal: 0000–
  0003). The orchestrator handles renumbering at merge time.
- `packages/db/src/migrations/<NNNN+1>_grading_rls.sql` — hand-authored
  migration. Two concerns, bundled per the convention used by
  `0001_users_rls.sql`:
  1. Cross-schema FK from `grading_submission.user_id` to
     `auth.users(id) ON DELETE CASCADE`. (No corresponding FK on
     `grading_training_sample` — that table has no `user_id`.)
  2. RLS posture for both tables:
     - `grading_submission`: `ENABLE ROW LEVEL SECURITY`. Owner CRUD
       policies (`auth.uid() = user_id`) for SELECT / INSERT / UPDATE /
       DELETE on the `authenticated` role. No anon-read policy (per
       `context/data-model.md` § RLS — grading data is private). Service
       role bypasses RLS by virtue of `BYPASSRLS`; no explicit policy
       needed (matches the user-tables pattern). REVOKE the permissive
       Supabase-default writes from `anon` to keep `\dp` honest, then
       GRANT `SELECT, INSERT, UPDATE, DELETE` to `authenticated` (RLS
       still gates row visibility).
     - `grading_training_sample`: `ENABLE ROW LEVEL SECURITY` with **no
       permissive policies** for `anon` or `authenticated`. The
       defense-in-depth REVOKE clears the permissive default grants
       Supabase ships; the `service_role` GRANT is explicit. End result:
       end-user sessions cannot read or write at all, the training
       pipeline (running with the service-role key) has full DML.
  - Idempotent: `DROP POLICY IF EXISTS … / CREATE POLICY` and `IF NOT
    EXISTS` guards as appropriate, mirroring `0001_users_rls.sql` and
    `0003_catalog_rls.sql`.
- `packages/db/src/migrations/meta/_journal.json` — append two entries
  (one for the drizzle-generated table migration, one for the
  hand-authored RLS migration). Drizzle's generate step writes the
  table-migration entry automatically; the RLS entry is appended by
  hand using the existing `{ idx, version, when, tag, breakpoints }`
  shape.

## Acceptance criteria

- [ ] **AC-1.** Drizzle-generated migration applies cleanly to a fresh
      local Supabase Postgres (`supabase db reset` →
      `pnpm --filter @binderly/db db:migrate` exits 0; both
      `grading_submission` and `grading_training_sample` appear in
      `\dt public.*`).
- [ ] **AC-2.** Hand-authored RLS migration applies idempotently. After a
      first run RLS is enabled on both tables (`SELECT relrowsecurity
      FROM pg_class WHERE relname IN ('grading_submission',
      'grading_training_sample')` returns `t,t`); re-running the
      migration is a no-op (every statement is guarded). Re-applying via
      `db:migrate` against the already-migrated DB does not duplicate
      policies (`pg_policies` row count for each table is unchanged).
- [ ] **AC-3.** Cross-schema FK from `grading_submission.user_id` to
      `auth.users(id) ON DELETE CASCADE` is in place. Proof: insert a
      row referencing a fabricated UUID — rejected with
      `foreign_key_violation`. Insert a row referencing a real
      `auth.users(id)` — accepted. DELETE the `auth.users` row — the
      `grading_submission` row is gone.
- [ ] **AC-4.** `printing_id` FK to `public.printing(id)` is in place
      with `ON DELETE SET NULL`. Proof: insert with a real `printing_id`
      — accepted. Insert with a fabricated UUID — rejected. Delete the
      printing — the `printing_id` on the submission goes NULL, the
      submission row is preserved.
- [ ] **AC-5.** `grading_submission.status` check constraint rejects
      values outside `{predicted, submitted_for_grading, graded}` and
      defaults to `predicted`.
- [ ] **AC-6.** `grading_submission.corner_urls` length-4 check
      constraint rejects arrays of length ≠ 4 (insert with 3 entries
      fails; with 4 succeeds).
- [ ] **AC-7.** `grading_training_sample`:
      - `(source, source_id)` unique constraint rejects duplicate
        source rows (idempotent ingestion).
      - `grade_company` and `source` check constraints reject
        out-of-enum values.
- [ ] **AC-8.** RLS posture per spec, verified live with
      `SET LOCAL ROLE`:
      - As `anon`: SELECT on either table → 0 rows / permission denied.
      - As `authenticated` (with `request.jwt.claims` set so
        `auth.uid() = some-user-id`): SELECT on `grading_submission`
        returns only that user's rows; INSERT/UPDATE/DELETE for own
        rows succeeds; cross-user mutation rejected.
      - As `authenticated`: any access on `grading_training_sample` is
        denied (no policy permits it).
      - As `service_role`: full DML on both tables (BYPASSRLS).
- [ ] **AC-9.** PROJECT.md § 12 product requirements are reflected:
      front / back / corner (×4) / surface URL columns exist and are
      `NOT NULL` on `grading_submission`; `predicted` is the AI score
      column; `actual` carries the slab payload populated post-grade;
      `status` enum tracks the lifecycle; `grading_training_sample`
      accepts the three external sources named in § 12 plus the
      community flywheel.
- [ ] **AC-10.** No file modified outside `owns_paths` plus the
      pre-staged uncomment line in `packages/db/src/schema/index.ts`
      (`T-DL-SCHEMA-GRADING` section). `git diff --stat` against `main`
      shows only:
      - `packages/db/src/schema/grading.ts` (new)
      - `packages/db/src/schema/index.ts` (1-line uncomment in the
        designated section)
      - `packages/db/src/migrations/<NNNN>_grading_tables.sql` (new)
      - `packages/db/src/migrations/<NNNN+1>_grading_rls.sql` (new)
      - `packages/db/src/migrations/meta/_journal.json` (entries
        appended; existing entries unchanged)
      - `packages/db/src/migrations/meta/<NNNN>_snapshot.json` (new,
        auto-generated by drizzle-kit)
      - `tasks/01-data-layer/T-DL-SCHEMA-GRADING.md` (the elaboration
        commit; not part of the implementation diff)
- [ ] **AC-11.** `pnpm --filter @binderly/db build typecheck lint
      format:check` exits 0.

## Out of scope

- Fixture builders (`packages/db/src/fixtures/grading.ts`) and
  round-trip tests. Mirroring CARDS and USERS' AC-deferral: a fixture
  task lands once `T-DL-DB-TEST-INFRA` introduces a vitest config
  for `@binderly/db`. The `$inferSelect` / `$inferInsert` exports are
  in place so the fixture task has typed builders out of the box.
- Edge Function that creates a `grading_submission` row from a
  multi-shot capture upload — that's a stage-02 / stage-07 task.
- Storage RLS for the user-uploaded image bytes themselves
  (`grading_submission.front_url` etc.) — those URLs point at a
  Supabase Storage bucket whose RLS lives in T-BE-STORAGE-POLICIES.
- The training-data ingestion pipelines that populate
  `grading_training_sample` — those are T-GR-DATA-PSA, T-GR-DATA-EBAY,
  T-GR-DATA-AUCTIONS in stage 07.
- The community-flywheel credit-issuance logic — T-PB-ENTITLEMENTS in
  stage 10 reads the `grading_flywheel_opt_in` preference and the
  `actual`-populated submissions to award credit.
- Materialized views for grading aggregates — none specified for v1.
- Adding `grading_submission` / `grading_training_sample` rows to the
  remaining-table scope of T-DL-RLS-POLICIES — this task ships RLS
  inline (per orchestrator iter-2 dispatch pattern, mirroring CARDS
  and USERS); T-DL-RLS-POLICIES inherits a tighter scope.

## Branch & PR

- Branch: `agent/T-DL-SCHEMA-GRADING`
- PR title: `T-DL-SCHEMA-GRADING: DB schema for grading submissions`
- Commit format: Conventional Commits.
  - Elaboration: `docs(tasks): elaborate T-DL-SCHEMA-GRADING`
  - Implementation: `feat(db): grading_submission and training data
    schemas (T-DL-SCHEMA-GRADING)`

## Escalation triggers

Stop and surface to the orchestrator (append to `open-questions.md`)
if:

- PROJECT.md § 12 turns out to require column shapes the spec in
  `context/data-model.md` doesn't enumerate (e.g., per-corner crop
  metadata, frame-quality scores, capture-device fingerprint) — needs
  Pablo to nail down the columns before committing them.
- The grading product requires tables not in this task's `owns_paths`
  (e.g. a separate `grading_image` blob table, a `grading_event` audit
  log) — propose adding them to `dependencies.yaml` before
  implementing.
- Docker / Supabase Postgres unavailable for live AC verification — flag
  the deferred ACs to the orchestrator (iter-1 pattern: orchestrator
  hands Pablo a smoke test in the PR review).
- The `auth.users` schema isn't in scope at migration time on the
  target Postgres (it should be on Supabase; surface if not).

## Notes from execution

### Deliverables landed

- `packages/db/src/schema/grading.ts` — two Drizzle tables in one file:
  `gradingSubmissionTable` (12 columns, PK on `id`, FK to `printing(id)`
  with `ON DELETE SET NULL`, status + corner-urls-length-4 CHECK
  constraints, two indexes) and `gradingTrainingSampleTable`
  (14 columns, unique `(source, source_id)`, FK to `printing(id)` with
  `ON DELETE SET NULL`, source + grade_company CHECK constraints, two
  indexes). Exported `$inferSelect`/`$inferInsert` types for both.
- `packages/db/src/schema/index.ts` — uncommented the single
  pre-staged line in the `T-DL-SCHEMA-GRADING` section. No other
  section touched. Trailing `export {};` placeholder left in place.
- `packages/db/src/migrations/0004_grading_tables.sql` — drizzle-kit
  generated. Used `--name grading_tables` to keep the conventional
  `NNNN_<snake_case_summary>.sql` filename without renaming. Auto-
  generated `meta/0004_snapshot.json` ships alongside.
- `packages/db/src/migrations/0005_grading_rls.sql` — hand-authored.
  Cross-schema FK `grading_submission.user_id → auth.users(id) ON
  DELETE CASCADE`, RLS enabled on both tables, owner-CRUD policies on
  `grading_submission` for `authenticated` (`auth.uid() = user_id`),
  no `anon` and no permissive policies on `grading_training_sample`.
  Defense-in-depth `REVOKE` of the permissive Supabase-default grants
  followed by explicit `GRANT` for the roles that should have access
  (`authenticated` → SELECT/INSERT/UPDATE/DELETE on
  `grading_submission`; `service_role` → full DML on both tables).
  Idempotent: `DROP POLICY IF EXISTS … / CREATE POLICY` mirroring
  `0001_users_rls.sql`. (The `ALTER TABLE … ADD CONSTRAINT` for the
  cross-schema FK isn't `IF NOT EXISTS`-able in Postgres, but the
  drizzle migrator dedupes by hash so re-runs of `db:migrate` are
  no-ops; matches the precedent set by `0001_users_rls.sql`.)
- `packages/db/src/migrations/meta/_journal.json` — appended an entry
  for `0005_grading_rls` (drizzle-kit wrote the `0004_grading_tables`
  entry automatically during `db:generate`).

### Acceptance-criteria results

| AC | Status | Proof |
|---|---|---|
| AC-1: drizzle migration applies to fresh local Supabase | PASS | `psql DROP TABLE/SCHEMA → node migrate.ts → "success"` (6 entries in `drizzle.__drizzle_migrations`). |
| AC-2: hand-authored RLS migration applies idempotently | PASS | RLS enabled on both tables (`pg_class.relrowsecurity = t`); re-running `db:migrate` is a no-op (count of `__drizzle_migrations` rows unchanged at 6). |
| AC-3: cross-schema FK to `auth.users(id)` ON DELETE CASCADE | PASS | INSERT with fabricated `user_id` → `foreign_key_violation`. INSERT with real `user_id` → accepted. `DELETE FROM auth.users WHERE id = …` → `grading_submission` row count for that user drops to 0. |
| AC-4: `printing_id` FK ON DELETE SET NULL | PASS | INSERT with fabricated `printing_id` → `foreign_key_violation`. `DELETE FROM printing WHERE id = …` → existing submission's `printing_id` becomes NULL, row preserved. |
| AC-5: `status` enum CHECK | PASS | INSERT with `status = 'totally_made_up'` → `violates check constraint "grading_submission_status_check"`. Default is `'predicted'`. |
| AC-6: `corner_urls` length-4 CHECK | PASS | INSERTs with arrays of length 3 and 5 both rejected with `violates check constraint "grading_submission_corner_urls_length_check"`. |
| AC-7: `grading_training_sample` constraints | PASS | Duplicate `(source, source_id)` rejected. Out-of-enum `source` ('not_a_source') rejected. Out-of-enum `grade_company` ('NOTACO') rejected. `source = 'community_flywheel'` accepted. |
| AC-8: RLS posture verified live | PASS | `BEGIN; SET LOCAL ROLE anon; SELECT … FROM grading_submission` → `permission denied` (no SELECT grant). Same for `grading_training_sample`. As `authenticated` with `request.jwt.claims.sub = user2`, only user2's rows visible (3 of 4 in fixture); attempting INSERT with `user_id = user1` → `new row violates row-level security policy`. As `authenticated` against `grading_training_sample` → `permission denied`. As `service_role` → full SELECT + INSERT on both. |
| AC-9: PROJECT.md § 12 product requirements reflected | PASS | front_url / back_url / corner_urls (×4 enforced) / surface_url all NOT NULL on `grading_submission`; `predicted` is the AI score column; `actual` carries the slab payload (nullable until graded); `status` enum tracks lifecycle; `grading_training_sample.source` enum covers PSA cert / eBay sold / auction (PWCC, Goldin) / community flywheel exactly. |
| AC-10: no edits outside `owns_paths` + pre-staged uncomment | PASS | `git diff --stat` shows only `packages/db/src/schema/grading.ts` (new), `packages/db/src/schema/index.ts` (1-line uncomment in own section), `packages/db/src/migrations/0004_grading_tables.sql` (new), `packages/db/src/migrations/0005_grading_rls.sql` (new), `packages/db/src/migrations/meta/_journal.json` (1 entry appended), `packages/db/src/migrations/meta/0004_snapshot.json` (new, drizzle-emitted). |
| AC-11: build + typecheck + lint + format:check clean | PASS | `tsc -p .` (build) clean; `tsc --noEmit` clean; `eslint --max-warnings=0 .` clean; `prettier --check .` clean (after one prettier-write pass on `grading.ts` for indentation). |

`has_table_privilege` snapshot confirms the SQL-level grants match
the policy posture:

```
 anon_sel_sub | anon_ins_sub | anon_sel_train | auth_sel_sub |
 auth_ins_sub | auth_sel_train | svc_ins_sub | svc_ins_train
--------------+--------------+----------------+--------------+
 f            | f            | f              | t            |
 t            | f              | t           | t
```

### Spec-vs-orchestrator resolution

- **Two tables in one file.** The orchestrator dispatch instructions
  expected a possible `grading_training_sample` sibling
  ("training-data table (if separate) likely has tighter access —
  only service_role reads/writes; users never see it directly. Decide
  based on PROJECT.md § grading"). The data-model.md spec only
  details `grading_submission`; PROJECT.md § 12 names three external
  ingestion pipelines (PSA cert lookup, eBay sold listings, auction
  archives — PWCC, Goldin) plus the community-submission flywheel
  whose data shape (no user_id, variable image count, optional
  printing match) does not fit `grading_submission`. Splitting them
  also keeps user PII out of the training corpus. Both tables fit in
  the single owned file `packages/db/src/schema/grading.ts`; no
  expansion of `owns_paths` was needed.
- **RLS ships in this task** (mirroring CARDS / USERS iter-1
  precedent). T-DL-RLS-POLICIES inherits a tighter scope: it does
  not need to re-author RLS for `grading_submission` /
  `grading_training_sample`. The grading tables' RLS lives directly
  under `migrations/`, not the `migrations/rls/` directory
  T-DL-RLS-POLICIES owns, so there's no path collision.
- **Fixtures + round-trip tests deferred** (mirroring CARDS / USERS).
  The dispatch `owns_paths` does not enumerate
  `packages/db/src/fixtures/grading.ts`, and no test runner is
  configured for `@binderly/db` yet (CARDS' AC-8 deferral noted that
  `T-DL-DB-TEST-INFRA` is the precondition). The `$inferSelect` /
  `$inferInsert` exports are in place so the future fixture task
  has typed builders out of the box.

### Other notes

- **Migration numbering.** Current journal indices are 0–3 (USERS:
  0000–0001; CARDS: 0002–0003). drizzle-kit picked `0004` for
  `grading_tables`; the hand-authored RLS migration is `0005`. The
  orchestrator can renumber at merge time if a sibling task collides;
  the migrator keys by `tag` (journal) and content hash, not
  filename position.
- **Prettier write.** Initial `grading.ts` failed `prettier --check`
  (multi-line `references()` arg). One `prettier --write` pass fixed
  the formatting; verified clean afterwards. No structural changes.
- **Local Supabase only — Compose Postgres on :5433 was not used.**
  Per `packages/db/README.md` § Targets, migrations target the
  Supabase CLI Postgres on `:54322`; the Compose Postgres on `:5433`
  is for the data-pipeline only. Live AC verification ran against
  `:54322`. Test fixtures (`auth.users`, a fixture set/card/printing,
  grading submissions and training samples) were truncated /
  deleted after verification. `\dt public.*` in the local DB now
  contains: `card, grading_submission, grading_training_sample,
  printing, profile, set, subscription` — all empty.

### Notes for downstream tasks

- **T-DL-RLS-POLICIES** inherits a smaller scope: catalog tables and
  user tables already have RLS; collections, grading, and pricing
  schemas ship RLS inline in their own tasks. T-DL-RLS-POLICIES likely
  reduces to admin-only surfaces (`data_conflict`), the
  `card_report` table, any audit-log tables, and consolidating
  cross-table policy invariants — not re-doing per-table RLS.
- **T-GR-DATA-PSA / T-GR-DATA-EBAY / T-GR-DATA-AUCTIONS** (stage 7)
  write to `grading_training_sample` exclusively via the service-role
  key. The dedup key is `(source, source_id)`; idempotent re-ingestion
  is "INSERT … ON CONFLICT (source, source_id) DO UPDATE SET …".
  When matching to a `printing_id`, leave it NULL when the match is
  uncertain rather than corrupting the catalog join. The `images`
  jsonb column accepts a flexible shape — single shot, partial corner
  set, full multi-shot — so a single ingestion pipeline handles the
  full quality spectrum named in PROJECT.md § 12.
- **Community flywheel job** (probably in stage 10 alongside
  T-PB-ENTITLEMENTS) reads `grading_submission` rows where
  `status = 'graded'` and the owner's
  `profile.preferences.grading_flywheel_opt_in = true`, then writes
  a row to `grading_training_sample` with
  `source = 'community_flywheel'` and
  `source_id = grading_submission.id`. The opt-in check is enforced
  in application code; RLS at the row level cannot easily express
  "service role can read row X if profile preference Y is set",
  so the gate lives in the cron job.
- **T-BE-STORAGE-POLICIES** owns RLS for the user-uploaded image
  bytes themselves (the URLs in `front_url`, `back_url`,
  `corner_urls`, `surface_url`, and `actual.slab_url` point at a
  Supabase Storage bucket). Bucket policy must be owner-only-read,
  matching the `grading_submission` owner-CRUD posture.
