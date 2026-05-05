# Build status — Phase 1 iter 11 dispatching: ADMIN-DEBUG-SURFACES (the last Phase 1 task)

**Phase:** 1 — Data layer (22/23 merged; this iter closes the phase)
**Phase 0:** Complete (10/10 merged; 3 stale `pending` entries in deps.yaml retroactively flipped this commit — code was on main since Phase 0 close)
**Total tracked:** 31 merged / 86 known tasks across stages 00-11. (PROJECT.md's "~109 tasks" is a forward-looking estimate; actual graph is ~86 hard tasks plus a handful of follow-ups not yet authored.)

**In progress:** 1 (T-DL-ADMIN-DEBUG-SURFACES)
**Blocked:** 0
**Blocked on humans:** 0

**Phase 1 is one task away from completion.** Once ADMIN-DEBUG-SURFACES
lands, the data layer is done end-to-end:

- Schema: USERS, CARDS, COLLECTIONS, GRADING, PRICING all on main with
  RLS posture verified live (Q-003 closed).
- Source pipeline: 5 source adapters (TCGDEX-EN/JP, PTCGIO,
  BULBAPEDIA, POKEMONCARD-JP) merged, with the resolver +
  variant-classifier + master-set rules engine.
- Image pipeline: SHA-256 dedup + sharp WebP + R2 / MinIO storage
  with cross-host plumbing fixed (Q-005 closed).
- Pricing pipeline complete end-to-end: AGGREGATOR (paid Layer 1) +
  EBAY-BROWSE (free Layer 2) → price_observation → ROLLUP → price_aggregate
  → CURRENT-VIEW → mv_current_price.
- FX rates: Frankfurter `.dev/v1` daily ingest (USD-base, 6 quote
  currencies).
- SEED-INGEST: live-verified end-to-end (Pablo, 2026-05-04 23:24Z;
  332 transcoded / 9 cached / 0 errors).
- Conflict logging: data_conflict table persists resolver disputes
  for admin debugging (just merged; iter 10).
- Admin debug views: **dispatching this iter** (final piece).

After Phase 1 closes, the queue opens up to **stages 02-11** (backend
APIs, shared packages, web app, mobile, scanner, grading, shareables,
offline sync, paywall, deployment) — 56 tasks, 0 merged. PROJECT.md's
sponsor-spec ordering decides which of those goes first.

## Dispatch loop status

Iter 10 closed; iter 11 dispatching. Phase 1 progression so far:

iter 1 (USERS+CARDS) →
iter 2 (COLLECTIONS+GRADING+SOURCE-INTERFACES) →
iter 3 (SCHEMA-PRICING+MASTER-SET-RULES+TCGDEX-EN) →
iter 4 (PTCGIO+BULBAPEDIA+TCGDEX-JP) →
iter 5 (IMAGE-PIPELINE+RLS-POLICIES+EBAY-LISTING-PARSER) →
iter 6 (SEED-INGEST+PROFILE-GRANTS-FIX+FX-RATES) →
iter 7 (PRICING-AGGREGATOR+PRICING-EBAY-BROWSE) →
iter 7.5 (Q-005 hotfix) →
iter 8 (PRICING-ROLLUP) →
iter 9 (PRICING-CURRENT-VIEW) →
iter 10 (DATA-CONFLICT-TABLE) →
**iter 11 (ADMIN-DEBUG-SURFACES — Phase 1 cap)**.

Reconciliation playbooks (migration renumbering, pre-staged sectioned
barrels, symbol-rename for parallel-developed type collisions)
preserved in earlier orchestrator commits + git log.

Post-merge migration sequence on main is monotonic 0000-0015:

  0000_user_tables          (T-DL-SCHEMA-USERS)
  0001_users_rls            (T-DL-SCHEMA-USERS, hand-authored)
  0002_catalog_tables       (T-DL-SCHEMA-CARDS)
  0003_catalog_rls          (T-DL-SCHEMA-CARDS, hand-authored)
  0004_collection_tables    (T-DL-SCHEMA-COLLECTIONS)
  0005_collections_rls      (T-DL-SCHEMA-COLLECTIONS, hand-authored)
  0006_grading_tables       (T-DL-SCHEMA-GRADING)
  0007_grading_rls          (T-DL-SCHEMA-GRADING, hand-authored)
  0008_pricing_tables       (T-DL-SCHEMA-PRICING)
  0009_pricing_rls          (T-DL-SCHEMA-PRICING, hand-authored)
  0010_image_provenance     (T-DL-IMAGE-PIPELINE)
  0011_image_provenance_rls (T-DL-IMAGE-PIPELINE, hand-authored)
  0012_profile_grants_fix   (T-DL-PROFILE-GRANTS-FIX, hand-authored, closes Q-003)
  0013_mv_current_price     (T-DL-PRICING-CURRENT-VIEW, hand-authored)
  0014_data_conflict        (T-DL-DATA-CONFLICT-TABLE, drizzle-generated)
  0015_data_conflict_rls    (T-DL-DATA-CONFLICT-TABLE, hand-authored)

ADMIN-DEBUG-SURFACES (this iter) WILL add **0016** (admin debug views;
hand-authored).

## Phase 1 ledger (22/23 merged; ADMIN-DEBUG-SURFACES dispatching)

| Task | Status | PR / commit |
|---|---|---|
| T-DL-SCHEMA-USERS | merged | #15 (`e9b4f38`) |
| T-DL-SCHEMA-CARDS | merged | #16 (`24b0fd4`, renumber `b5af7f7`) |
| T-DL-SCHEMA-COLLECTIONS | merged | #17 (`c131903`) |
| T-DL-SCHEMA-GRADING | merged | #18 (`77d18d0`, renumber `ffc4d34`) |
| T-DL-SOURCE-INTERFACES | merged | #19 (`51b3727`) |
| T-DL-MASTER-SET-RULES | merged | #21 (`d531dc7`) |
| T-DL-SCHEMA-PRICING | merged | #22 (`a99fc0b`) |
| T-DL-SOURCE-TCGDEX-EN | merged | #23 (`1a741ab`) |
| T-DL-SOURCE-PTCGIO | merged | #24 (`c8b2de0`) |
| T-DL-SOURCE-BULBAPEDIA | merged | #25 (`4afde4d`) |
| T-DL-SOURCE-TCGDEX-JP | merged | #26 (`4c30cf0`) |
| T-DL-IMAGE-PIPELINE | merged | #27 (`9be37c0`) |
| T-DL-RLS-POLICIES | merged | #28 (`3c448db`) |
| T-DL-EBAY-LISTING-PARSER | merged | #30 (`2b2d144`) |
| T-DL-PROFILE-GRANTS-FIX | merged | #31 (`1fe1fbd`; closes Q-003) |
| T-DL-FX-RATES | merged | #32 (`63a8ae8`) |
| T-DL-SEED-INGEST | merged | #33 (`34264a3`; surfaced Q-005) |
| T-DL-IMAGE-PIPELINE-CROSSHOST-FIX | merged | #35 (`49e9446`; closes Q-005) |
| T-DL-PRICING-AGGREGATOR | merged | #34 (`f3e5608`) |
| T-DL-PRICING-EBAY-BROWSE | merged | #36 (`8b855f4`; reconciliation rename) |
| T-DL-PRICING-ROLLUP | merged | #37 (`1cc7a40`) |
| T-DL-PRICING-CURRENT-VIEW | merged | #38 (`f9bcc96`; mig 0013; ratified Q-006) |
| T-DL-DATA-CONFLICT-TABLE | merged | #39 (`3fb5227`; mig 0014/0015; per-set buffer-and-flush; admin-debug additive — never blocks the primary write path) |
| T-DL-ADMIN-DEBUG-SURFACES | in_progress (iter 11) | — |

## Iter 11 dispatch (1 in flight, under MAX_PARALLEL=3)

ADMIN-DEBUG-SURFACES solo. The closing piece for Phase 1: a small set
of admin-only `v_*` views (catalog audit + pg_stat_statements
summaries) gated to service_role / admin so an operator can query
data-pipeline health directly without writing ad-hoc joins each time.

| Task | Effort | Owns_paths | Why this iter |
|---|---|---|---|
| **T-DL-ADMIN-DEBUG-SURFACES** | S | `packages/db/src/migrations/` + `packages/db/src/views/` | Phase 1 cap. Pairs with DATA-CONFLICT-TABLE (the conflict rows are the headline thing these views expose). Lays groundwork for the eventual admin web UI in Phase 2+. |

Migration coordination:
- ADMIN-DEBUG-SURFACES adds **mig 0016** (hand-authored DDL: CREATE
  VIEW + GRANT/REVOKE; Postgres views aren't drizzle-generated). No
  schema-barrel changes (views aren't pgTables).
- This is the LAST data-layer migration; mig 0017 onwards will come
  from Phase 2+ as needed.

Stub elaboration: stub authored in PR #39 (iter 10's side-effect)
and now full and ready for elaboration. Sub-agent reads PROJECT.md
+ rules + the existing `data_conflict` / `printing_image` /
`fx_rate` schemas to pick the column set + grouping for each view.
Suggested starting set already in the stub:
- `v_data_conflict_top` (top N conflicts by `dispute_count`).
- `v_data_conflict_by_source` (per-source conflict counts).
- `v_image_pipeline_failures` (printing_image transcode failures over time).
- `v_fx_rate_freshness` (rows-per-source-per-day window of fx_rate).
- `v_pg_stat_statements_top_queries` (top queries by total time; admin/service_role only).

## Held to Phase 2 prep

Once Phase 1 closes:
- Triage stages 02-11 against PROJECT.md's sponsor-spec ordering.
- Author stubs for stages without them.
- Open the first iter-12 dispatch with whatever the next critical-path
  unblocked task is (likely backend API surface or shared types
  package depending on PROJECT.md's read).

## Open questions

All open questions are closed.

- **Q-003** (RLS grants gap) — closed; verified live by Pablo 2026-05-04.
- **Q-004** (`@binderly/db` package.json exports) — closed (self-fixed in PR #33).
- **Q-005** (image-pipeline cross-host) — closed; verified live by Pablo 2026-05-04 23:24Z.
- **Q-006** (PRICING-CURRENT-VIEW v1 column set) — closed; ratified at PR #38 merge time. Richer trends + freshness shape pairs with T-SP-PRICING-DISPLAY (Phase 2) as a strict-additive follow-up.

## Phase 0 ledger (closed; 10/10 merged)

All foundation tasks merged. Three stale `pending` deps.yaml entries
(T-FN-SUPABASE-LOCAL, T-FN-DB-MIGRATIONS, T-FN-ENV-CONVENTIONS) flipped
to `merged` retroactively in this iter's housekeeping commit — they
were merged on main long ago but the orchestrator's deps.yaml flips
were inconsistent before iter 1. Git log between `7df9f12`
(T-FN-MONOREPO) and `7b4529e` (T-FN-DB-MIGRATIONS) is the source of
truth.

## Last 5 merges

- T-DL-DATA-CONFLICT-TABLE — `3fb5227` (mig 0014 + 0015; per-set buffer-and-flush integration in resolve-and-classify; service_role-only RLS posture; ADMIN-DEBUG-SURFACES stub authored as Phase-0-of-this-PR side-effect; 14 new tests; package total 1101)
- T-DL-PRICING-CURRENT-VIEW — `f9bcc96` (mig 0013 hand-authored mv DDL; DISTINCT ON projection; UNIQUE for REFRESH CONCURRENTLY; REVOKE/GRANT posture; 15 new tests; package total 1087)
- T-DL-PRICING-ROLLUP — `1cc7a40` (daily aggregation; idempotent on schema PK; per-currency [no FX in rollup]; outlier filter active in v1; 29 new tests; package total 1072)
- T-DL-PRICING-EBAY-BROWSE — `8b855f4` (Layer 2 active-listings ingest; 6 marketplaces; reconciliation rename to dodge AGGREGATOR; 35 new tests; package total 1043)
- T-DL-PRICING-AGGREGATOR — `f3e5608` (Layer 1 paid-source ingest; mock-by-default; 49 new tests; package total 976)

## Known follow-ups (logged, non-blocking)

1. **`T-DL-DB-TEST-INFRA` (proposed)** — stand up vitest in
   `@binderly/db`; rewrite `db:generate` / `db:migrate` wrappers in
   plain ESM (no `tsx` runtime) so future db sub-agents don't hit
   sandbox tsx-IPC-pipe failures.
2. **`T-DL-PRICING-TYPES-CONSOLIDATION` (proposed)** — hoist a shared
   `RawPriceObservation` (+ schema) to `data-pipeline/src/types.ts`
   and have BOTH AGGREGATOR and EBAY-BROWSE adapters import from
   there. EBAY-BROWSE's symbols are currently differentiated as
   `RawEbayBrowsePriceObservation` etc. as a holding pattern.
3. **`T-DL-DATAPIPELINE-DOTENV` (proposed)** — auto-load `.env` in
   data-pipeline scripts so smoke tests are one-liners. Also: PR #33's
   smoke-test instructions reference the wrong DATABASE_URL default
   (Compose Postgres :5433 vs Supabase Postgres :54322 where
   migrations live); fix the README.
4. **`T-DL-DB-TURBO-BUILD-PIPELINE` (proposed; Q-004 follow-up)** — add
   a turbo `^build` pipeline so `pnpm seed` implicitly builds
   `@binderly/db` first.
5. **`T-DL-PRICING-CURRENT-VIEW-V2` (proposed; Q-006 follow-up)** —
   pair with T-SP-PRICING-DISPLAY (Phase 2). Adds the richer trends +
   freshness shape from `context/data-model.md` § `mv_current_price`.
6. **One-shot snapshot regen** — Pablo can run
   `pnpm install && pnpm --filter @binderly/db db:generate` once to
   confirm drizzle-kit produces a no-op diff against the hand-merged
   `meta/0002_snapshot.json` and `meta/0006_snapshot.json`.
7. **`db:migrate` UX wart** — `migrate.ts` errors hard if
   `meta/_journal.json` is missing entries instead of skipping
   gracefully.
8. **Dependabot backlog** — ~9 open PRs from when CI landed.
9. **`.nvmrc` 22.22.2 not locally installable** — fall back to 22.13.0.

## Verification protocol

For runtime ACs that need Docker socket access, the orchestrator hands
Pablo a paste-able one-liner and merges on his thumbs-up. Static-only
ACs are verified in foreground via the diff inspector or by sub-agents
inside their worktrees. The post-Q-005 SEED-INGEST live smoke
(2026-05-04 23:24Z) demonstrates the full chain working end-to-end.

## Notes

This file is updated by the orchestrator agent at the end of every
dispatch loop iteration. Do not edit by hand.
