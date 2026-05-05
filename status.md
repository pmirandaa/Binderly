# Build status — Phase 1 iter 10 dispatching: DATA-CONFLICT-TABLE (resolver write-path) + ADMIN-DEBUG-SURFACES stub authoring

**Phase:** 1 — Data layer (31/109 tasks merged)
**Merged:** 31 / 109 tasks
**In progress:** 1 (T-DL-DATA-CONFLICT-TABLE; sub-agent also authors the T-DL-ADMIN-DEBUG-SURFACES stub for the next iter)
**Blocked:** 0
**Blocked on humans:** 0

**Phase 1 pricing pipeline complete end-to-end.**

The full chain is now on main:

- Layer 1: PRICING-AGGREGATOR (Cardmarket + eBay-sold paid API; mock-by-default).
- Layer 2: PRICING-EBAY-BROWSE (free eBay Browse active listings).
- Daily aggregation: PRICING-ROLLUP (idempotent; outlier-trimmed; per-currency).
- Display lookup: PRICING-CURRENT-VIEW (mv; REFRESH CONCURRENTLY; mig 0013).

Live SEED-INGEST verified clean (Pablo, 2026-05-04 23:24Z): 1 set /
216 cards / 341 printings upserted; 332 images transcoded + 9 cached
/ 0 errors; cross-source agreement signal flowing.

**Phase 1 now ~80% done.** After DATA-CONFLICT-TABLE (this iter) +
ADMIN-DEBUG-SURFACES (iter 11) only a handful of smaller logged
follow-ups remain in the data-layer phase before Phase 2 sponsor-spec
work begins.

## Dispatch loop status

Iter 9 closed; iter 10 dispatching. Phase 1 progression so far:

iter 1 (USERS+CARDS) →
iter 2 (COLLECTIONS+GRADING+SOURCE-INTERFACES) →
iter 3 (SCHEMA-PRICING+MASTER-SET-RULES+TCGDEX-EN) →
iter 4 (PTCGIO+BULBAPEDIA+TCGDEX-JP) →
iter 5 (IMAGE-PIPELINE+RLS-POLICIES+EBAY-LISTING-PARSER) →
iter 6 (SEED-INGEST+PROFILE-GRANTS-FIX+FX-RATES) →
iter 7 (PRICING-AGGREGATOR+PRICING-EBAY-BROWSE) →
iter 7.5 (Q-005 hotfix: image-pipeline cross-host) →
iter 8 (PRICING-ROLLUP) →
iter 9 (PRICING-CURRENT-VIEW) →
**iter 10 (DATA-CONFLICT-TABLE; ADMIN-DEBUG-SURFACES stub authoring as side-effect)**.

Reconciliation playbooks (migration renumbering, pre-staged sectioned
barrels, symbol-rename for parallel-developed type collisions)
preserved in earlier orchestrator commits + git log; not re-documented
inline.

Post-merge migration sequence on main is monotonic 0000-0013:

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
  0013_mv_current_price     (T-DL-PRICING-CURRENT-VIEW, hand-authored mv DDL)

DATA-CONFLICT-TABLE (this iter) WILL add `0014_data_conflict_tables.sql`
(generated) + `0015_data_conflict_rls.sql` (hand-authored). ADMIN-
DEBUG-SURFACES (iter 11) will follow with `0016_admin_debug_views.sql`
(hand-authored) + RLS / GRANT migration if needed — these two tasks
share `packages/db/src/migrations/` so they're serialised, not
parallelised.

## Phase 1 ledger

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
| T-DL-PRICING-CURRENT-VIEW | merged | #38 (`f9bcc96`; mig 0013; ratified Q-006: v1 simpler shape) |
| T-DL-DATA-CONFLICT-TABLE | in_progress (iter 10) | — |
| T-DL-ADMIN-DEBUG-SURFACES | held to iter 11 (this iter's worker authors its stub) | — |
| ... ~9 more pending Phase 1 tasks | pending | — |

## Iter 10 dispatch (1 in flight, under MAX_PARALLEL=3)

DATA-CONFLICT-TABLE solo. The worker is also authoring the
ADMIN-DEBUG-SURFACES stub as a side-effect (iter-11 prep) so the
two migrations-folder-sharing tasks can serialise cleanly.

| Task | Effort | Owns_paths | Why this iter |
|---|---|---|---|
| **T-DL-DATA-CONFLICT-TABLE** | M | `packages/db/src/schema/data_conflict.ts` + `data-pipeline/src/resolver/conflict-log.ts` (anticipated) + new mig 0014/0015 | The resolver currently logs conflicts to per-source `resolverConflicts` counts (see SEED-INGEST report); this task persists those rows for admin debugging. Unblocks ADMIN-DEBUG-SURFACES. |

Migration coordination:
- DATA-CONFLICT-TABLE adds **mig 0014** (`data_conflict` table; drizzle-
  generated) + **mig 0015** (RLS posture; hand-authored, mirrors the
  `0001/0003/0005/0007/0009/0011/0012` REVOKE/GRANT pattern).
- ADMIN-DEBUG-SURFACES (held to iter 11) will follow with **0016**
  (admin debug views) — serialised against this PR.

Stub elaboration: same Phase 1 / Phase 2 pattern as the prior tasks.
Sub-agent is empowered to author the missing
`tasks/01-data-layer/T-DL-DATA-CONFLICT-TABLE.md` AND
`tasks/01-data-layer/T-DL-ADMIN-DEBUG-SURFACES.md` stubs in the same
PR (per AGENT_ORCHESTRATOR.md §7's STUB shape) — only the former
gets elaborated + implemented this iter.

## Held to iter 11

- T-DL-ADMIN-DEBUG-SURFACES (stub authored this iter; elaboration + implementation deferred — share migrations folder with DATA-CONFLICT-TABLE so must run serially)
- T-DL-PRICING-TYPES-CONSOLIDATION (proposed cleanup; consolidate the AGGREGATOR/EBAY-BROWSE symbol divergence introduced by PR #36's reconciliation; non-critical-path)

## Open questions

All open questions are closed.

- **Q-003** (RLS grants gap) — closed; verified live by Pablo 2026-05-04 (97/0 on verify-rls after applying mig 0012).
- **Q-004** (`@binderly/db` package.json exports) — closed (self-fixed in PR #33; turbo-build follow-up logged).
- **Q-005** (image-pipeline cross-host) — closed; verified live by Pablo 2026-05-04 23:24Z (332 transcoded / 9 cached / 0 errors against the post-fix main).
- **Q-006** (PRICING-CURRENT-VIEW v1 column set) — closed; ratified at PR #38 merge time. v1 ships the simpler "latest aggregate stats per group" shape; richer trends + freshness shape pairs with T-SP-PRICING-DISPLAY (Phase 2) as a strict-additive follow-up.

## Phase 0 ledger (closed)

All 10 foundation tasks merged. See git log between `7df9f12`
(T-FN-MONOREPO) and `7b4529e` (T-FN-DB-MIGRATIONS).

## Last 5 merges

- T-DL-PRICING-CURRENT-VIEW — `f9bcc96` (mig 0013 hand-authored mv DDL: DISTINCT ON projection of latest price_aggregate row per group key; UNIQUE index for REFRESH CONCURRENTLY; REVOKE/GRANT posture mirrors price_aggregate; 15 new tests; package total 1087)
- T-DL-PRICING-ROLLUP — `1cc7a40` (daily price-observation -> price_aggregate; idempotent on schema's composite PK; per-currency [no FX in rollup]; outlier filter active in v1 — drop top/bottom 5% when sample_count >= 20; 29 new tests; package total 1072)
- T-DL-PRICING-EBAY-BROWSE — `8b855f4` (Layer 2 active-listings ingest; eBay Browse v1 OAuth; mock-by-default; 6 marketplaces; reconciliation rename `EbayBrowsePriceObservation*` to dodge AGGREGATOR's already-merged symbols; 35 new tests; package total 1043)
- T-DL-PRICING-AGGREGATOR — `f3e5608` (Layer 1 paid-source ingest; Cardmarket + eBay-sold mock fixtures; reuses EBAY-LISTING-PARSER joiner; 49 new tests; package total 976)
- T-DL-IMAGE-PIPELINE-CROSSHOST-FIX — `49e9446` (closes Q-005; dedicated assets.tcgdex.net + images.pokemontcg.io clients in seed; toJSON on ImagePipelineError + AdapterError; 14 new tests; package total 941)

## Known follow-ups (logged, non-blocking)

1. **`T-DL-DB-TEST-INFRA` (proposed)** — stand up vitest in
   `@binderly/db`; rewrite `db:generate` / `db:migrate` wrappers in
   plain ESM (no `tsx` runtime) so future db sub-agents don't hit
   sandbox tsx-IPC-pipe failures. PRICING agent's temporary plain-ESM
   migrator pattern is the prototype.
2. **`T-DL-PRICING-TYPES-CONSOLIDATION` (proposed)** — hoist a shared
   `RawPriceObservation` (+ schema) to `data-pipeline/src/types.ts`
   and have BOTH AGGREGATOR and EBAY-BROWSE adapters import from
   there; same for `PriceObservationRepo` +
   `InMemoryPriceObservationRepo`. EBAY-BROWSE's symbols are currently
   differentiated as `RawEbayBrowsePriceObservation` /
   `EbayBrowsePriceObservationRepo` etc. as a holding pattern (see
   PR #36's reconciliation merge). Both sets work today;
   consolidating is purely an API-surface cleanup.
3. **`T-DL-DATAPIPELINE-DOTENV` (proposed)** — make
   `data-pipeline/scripts/seed.ts` + `fx-rates.ts` +
   `pricing-aggregator.ts` + `pricing-ebay-browse.ts` +
   `pricing-rollup.ts` + `pricing-current-view.ts` auto-load `.env`
   via dotenv so smoke tests are one-liners. Also: PR #33's smoke-
   test instructions reference the wrong DATABASE_URL default
   (Compose Postgres :5433 vs Supabase Postgres :54322 where
   migrations live); fix the README.
4. **`T-DL-DB-TURBO-BUILD-PIPELINE` (proposed; Q-004 follow-up)** — add
   a turbo `^build` pipeline so `pnpm seed` implicitly builds
   `@binderly/db` first, OR add an `import` conditional in
   `@binderly/db`'s `exports` that points at `./src/index.ts` so `tsx`
   resolves it without a dist artefact.
5. **`T-DL-PRICING-CURRENT-VIEW-V2` (proposed; Q-006 follow-up)** —
   pair with T-SP-PRICING-DISPLAY (Phase 2). Adds the richer trends +
   freshness shape from `context/data-model.md` § `mv_current_price`
   (7d/30d/90d trend deltas, freshness_ts, etc.) via a DROP+CREATE
   migration once the consumer task surfaces concrete column needs.
6. **One-shot snapshot regen** — Pablo can run
   `pnpm install && pnpm --filter @binderly/db db:generate` once to
   confirm drizzle-kit produces a no-op diff against the hand-merged
   `meta/0002_snapshot.json` and `meta/0006_snapshot.json`. Not
   gating; `db:migrate` doesn't read the snapshot.
7. **`db:migrate` UX wart** — `migrate.ts` errors hard if
   `meta/_journal.json` is missing entries instead of skipping
   gracefully. Tracked from T-FN-DB-MIGRATIONS handoff.
8. **Dependabot backlog** — ~9 open PRs from when CI landed. Triage
   when convenient.
9. **`.nvmrc` 22.22.2 not locally installable** — fall back to 22.13.0.
   Worth lockfile-pinning instead if we want CI to stay green on the
   exact version.

## Verification protocol

For runtime ACs that need Docker socket access, the orchestrator hands
Pablo a paste-able one-liner and merges on his thumbs-up. Static-only
ACs are verified in foreground via the diff inspector or by sub-agents
inside their worktrees. The post-Q-005 SEED-INGEST live smoke
(2026-05-04 23:24Z) demonstrates the full chain working end-to-end —
this is the new baseline for "Phase 1 is integrated, not just unit-tested".

## Notes

This file is updated by the orchestrator agent at the end of every
dispatch loop iteration. Do not edit by hand.
