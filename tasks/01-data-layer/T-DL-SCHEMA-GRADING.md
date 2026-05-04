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

_(empty until the sub-agent runs)_
