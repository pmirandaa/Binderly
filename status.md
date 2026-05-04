# Build status — Phase 1 iter 8 dispatching: PRICING-ROLLUP (the pricing pipeline cap)

**Phase:** 1 — Data layer (29/109 tasks merged)
**Merged:** 29 / 109 tasks
**In progress:** 1 (T-DL-PRICING-ROLLUP)
**Blocked:** 0
**Blocked on humans:** 0 (Q-003 verified live by Pablo on 2026-05-04; SEED-INGEST live smoke tests pending Pablo's re-run after Q-005 fix landed — non-blocking)

**Phase 1 schema-work milestone reached.** All 5 schema tasks
(USERS, CARDS, COLLECTIONS, GRADING, PRICING) merged. 13 schema
modules and 13 monotonic migrations (0000–0012) on main.

**Phase 1 source-pipeline milestone reached.** All 5 source
adapters merged (TCGDEX-EN, PTCGIO, BULBAPEDIA, TCGDEX-JP,
POKEMONCARD-JP). Pre-staged barrel + additive rarity registry
held up across 4 sibling-adapter merges with zero 3-way conflicts.

**Phase 1 SEED-INGEST integration crown jewel landed.** All 5
adapters + resolver + variant classifier + master-set engine + DB
upserts + image pipeline (R2 dedup) compose end-to-end via
`runSeedIngest`. Live smoke (Pablo, 2026-05-04) confirmed catalog
write side end-to-end (1 set / 216 cards / 341 printings upserted
clean); image-pipeline cross-host bug surfaced and fixed in PR #35
(Q-005); awaiting re-run for full image-side verification.

**Phase 1 pricing pair landed.** PRICING-AGGREGATOR (Layer 1 —
mock-by-default Cardmarket + eBay-sold) + PRICING-EBAY-BROWSE
(Layer 2 — active eBay listings, free, no approval) both merged.
Both write to existing `price_observation`. PRICING-ROLLUP
(daily aggregate rollup; the consumer of both layers) is the
next critical-path piece and is dispatching this iter.

**Phase 1 now ~75% done.** PRICING-ROLLUP unblocks
PRICING-CURRENT-VIEW (the materialised view + nightly refresh).
After that pair, only DATA-CONFLICT-TABLE + ADMIN-DEBUG-SURFACES
(both still need stub authoring) and a handful of smaller
follow-ups remain in the data-layer phase.

## Dispatch loop status

Iter 7 closed; iter 8 dispatching. Phase 1 progression so far:

iter 1 (USERS+CARDS) →
iter 2 (COLLECTIONS+GRADING+SOURCE-INTERFACES) →
iter 3 (SCHEMA-PRICING+MASTER-SET-RULES+TCGDEX-EN) →
iter 4 (PTCGIO+BULBAPEDIA+TCGDEX-JP) →
iter 5 (IMAGE-PIPELINE+RLS-POLICIES+EBAY-LISTING-PARSER) →
iter 6 (SEED-INGEST+PROFILE-GRANTS-FIX+FX-RATES) →
iter 7 (PRICING-AGGREGATOR+PRICING-EBAY-BROWSE) →
**iter 7.5** (Q-005 hotfix: image-pipeline cross-host) →
iter 8 (PRICING-ROLLUP).

Reconciliation playbooks (migration renumbering, pre-staged
sectioned barrels) preserved in earlier orchestrator commits +
git log; not re-documented inline.

Post-merge migration sequence on main is monotonic 0000-0012:

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

All schema-barrel sections in `packages/db/src/schema/index.ts`
are uncommented.

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
| T-DL-SOURCE-TCGDEX-EN | merged | #23 (`1a741ab`, includes `4f0a36c` reconciliation) |
| T-DL-SOURCE-PTCGIO | merged | #24 (`c8b2de0`) |
| T-DL-SOURCE-BULBAPEDIA | merged | #25 (`4afde4d`) |
| T-DL-SOURCE-TCGDEX-JP | merged | #26 (`4c30cf0`; agent hung post-commit, orchestrator validated + opened PR) |
| T-DL-IMAGE-PIPELINE | merged | #27 (`9be37c0`; +printing_image table; mig 0010/0011) |
| T-DL-RLS-POLICIES | merged | #28 (`3c448db`; verify-rls suite + posture docs; surfaced Q-003) |
| T-DL-EBAY-LISTING-PARSER | merged | #30 (`2b2d144`; 8-pass; 108-entry corpus; 310 new tests) |
| T-DL-PROFILE-GRANTS-FIX | merged | #31 (`1fe1fbd`; mig 0012; closes Q-003 — Pablo verified live 2026-05-04) |
| T-DL-FX-RATES | merged | #32 (`63a8ae8`; Frankfurter `.dev/v1`; 6 quote currencies; 30 new tests) |
| T-DL-SEED-INGEST | merged | #33 (`34264a3`; integration crown jewel; reconciliation merge `463b9d4`; live smoke 2026-05-04 surfaced Q-005) |
| T-DL-IMAGE-PIPELINE-CROSSHOST-FIX | merged | #35 (`49e9446`; closes Q-005; tcgdex assets host + ImagePipelineError.toJSON) |
| T-DL-PRICING-AGGREGATOR | merged | #34 (`f3e5608`; Layer 1; mock-by-default; 49 new tests) |
| T-DL-PRICING-EBAY-BROWSE | merged | #36 (`8b855f4`; Layer 2; mock-by-default; reconciliation rename `EbayBrowsePriceObservation*` to dodge AGGREGATOR collision) |
| T-DL-PRICING-ROLLUP | in_progress (iter 8) | — |
| T-DL-PRICING-CURRENT-VIEW | blocked on PRICING-ROLLUP | — |
| T-DL-DATA-CONFLICT-TABLE / -ADMIN-DEBUG-SURFACES | held to iter 9 (no stubs yet — author one before dispatch) | — |
| ... ~9 more pending Phase 1 tasks | pending | — |

## Iter 8 dispatch (1 in flight, under MAX_PARALLEL=3)

PRICING-ROLLUP solo. It transforms `price_observation` rows
(from PRICING-AGGREGATOR + PRICING-EBAY-BROWSE) into daily
`price_aggregate` rows; idempotent on re-run via
(printing_id, market, grade_tier, observed_date) UNIQUE.
Holds the pricing pipeline cap; PRICING-CURRENT-VIEW
(blocked on this) is the materialised view that turns the
aggregates into a fast `mv_current_price` lookup for the app.

| Task | Effort | Owns_paths | Why this iter |
|---|---|---|---|
| **T-DL-PRICING-ROLLUP** | M | `data-pipeline/src/jobs/pricing-rollup.ts` (+ test) | Daily price aggregation cap; consumes both Layer 1 + Layer 2 observations; downstream of the pricing pair that just landed. |

Migration coordination:
- No new migration. Writes to existing `price_aggregate` table
  (from `T-DL-SCHEMA-PRICING`).
- Reads from `price_observation` + `fx_rate` (the latter for the
  source-currency → display-currency conversion).

Stub elaboration: same Phase 1 / Phase 2 pattern as
SEED-INGEST / FX-RATES / PRICING-{AGGREGATOR,EBAY-BROWSE}.

## Held to iter 9

- T-DL-PRICING-CURRENT-VIEW (depends on ROLLUP)
- T-DL-DATA-CONFLICT-TABLE (no stub yet — author one in iter 9 prep)
- T-DL-ADMIN-DEBUG-SURFACES (no stub yet; touches `packages/db/src/migrations/` so requires serialisation against DATA-CONFLICT-TABLE)

## Open questions

- **Q-003** (raised by T-DL-RLS-POLICIES, PR #28; **fix shipped** in
  T-DL-PROFILE-GRANTS-FIX, PR #31, mig 0012; **Pablo's answer** —
  "do option 1" — ratifies; **verified live by Pablo on 2026-05-04**:
  verify-rls reports 97/0 after applying 0012). **Closed.**
- **Q-004** (raised by T-DL-SEED-INGEST, PR #33; **self-fixed in
  same PR**): `@binderly/db`'s `package.json` was missing `main` /
  `types` / `exports`. Sub-agent applied the additive fix in PR #33.
  Documented; no further action required. Two follow-ups logged
  below (turbo build pipeline; tsx-friendly conditional exports).
  **Closed (with follow-ups).**
- **Q-005** (raised by SEED-INGEST live smoke, 2026-05-04;
  **fix shipped** in T-DL-IMAGE-PIPELINE-CROSSHOST-FIX, PR #35):
  cross-host RateLimitedClient pin caught the seed wiring trying
  to fetch images from `assets.tcgdex.net` via the `api.tcgdex.net`
  client (also latent same-shape bug for ptcgio's
  `images.pokemontcg.io`). Plus `ImagePipelineError.cause` was
  serialised as `{}` because Error props are non-enumerable.
  PR #35 added dedicated assets clients + `toJSON()` overrides on
  `ImagePipelineError` + `AdapterError`. **Closed pending Pablo's
  re-run of the SEED-INGEST smoke against the post-Q-005 main.**

## Phase 0 ledger (closed)

All 10 foundation tasks merged. See git log between `7df9f12`
(T-FN-MONOREPO) and `7b4529e` (T-FN-DB-MIGRATIONS).

## Last 5 merges

- T-DL-PRICING-EBAY-BROWSE — `8b855f4` (Layer 2 active-listings ingest; eBay Browse v1 OAuth client-credentials + paginated search; mock-by-default behind `MOCK_PRICING_EBAY_BROWSE`; min-confidence 0.55; 6 marketplaces; 35 new tests, package total 1043; reconciliation rename `EbayBrowsePriceObservation*` to dodge AGGREGATOR's already-merged symbols)
- T-DL-PRICING-AGGREGATOR — `f3e5608` (Layer 1 paid-source ingest; Cardmarket-style + eBay-sold-style mock fixtures; reuses EBAY-LISTING-PARSER joiner for unattributed eBay-sold rows; deterministic source_listing_id per quote kind; 49 new tests, package total 976)
- T-DL-IMAGE-PIPELINE-CROSSHOST-FIX — `49e9446` (closes Q-005; dedicated assets.tcgdex.net + images.pokemontcg.io clients in seed; toJSON on ImagePipelineError + AdapterError; 14 new tests, package total 941)
- T-DL-SEED-INGEST — `34264a3` (Phase-1 integration crown jewel; runSeedIngest wires 5 adapters + resolver + variant classifier + master-set + DB upserts + image pipeline + R2 dedup; live smoke surfaced Q-005)
- T-DL-FX-RATES — `63a8ae8` (Frankfurter `.dev/v1`; USD-base; 6 quote currencies; weekend-remap-aware; 30 new tests; corrected fx_rate PK)

## Known follow-ups (logged, non-blocking)

1. **`T-DL-DB-TEST-INFRA` (proposed)** — stand up vitest in
   `@binderly/db`; rewrite `db:generate` / `db:migrate` wrappers
   in plain ESM (no `tsx` runtime) so future db sub-agents don't
   hit sandbox tsx-IPC-pipe failures. PRICING agent's temporary
   plain-ESM migrator pattern is the prototype.
2. **`T-DL-PRICING-TYPES-CONSOLIDATION` (proposed)** — hoist a
   shared `RawPriceObservation` (+ schema) to
   `data-pipeline/src/types.ts` and have BOTH AGGREGATOR and
   EBAY-BROWSE adapters import from there; same for
   `PriceObservationRepo` + `InMemoryPriceObservationRepo`. EBAY-
   BROWSE's symbols are currently differentiated as
   `RawEbayBrowsePriceObservation` / `EbayBrowsePriceObservationRepo`
   etc. as a holding pattern (see PR #36's reconciliation merge).
   Both sets work today; consolidating is purely an API-surface
   cleanup. Coordinate with PRICING-ROLLUP (which consumes both).
3. **`T-DL-DATAPIPELINE-DOTENV` (proposed)** — make
   `data-pipeline/scripts/seed.ts` + `fx-rates.ts` +
   `pricing-aggregator.ts` + `pricing-ebay-browse.ts`
   auto-load `.env` via dotenv so smoke tests are one-liners.
   Plus: PR #33's smoke test references the wrong DATABASE_URL
   default (5433 Compose Postgres vs 54322 Supabase Postgres
   where migrations live); fix the smoke-test docs in
   `data-pipeline/README.md`.
4. **`T-DL-DB-TURBO-BUILD-PIPELINE` (proposed; Q-004 follow-up)** —
   add a turbo `^build` pipeline so `pnpm seed` implicitly builds
   `@binderly/db` first, OR add an `import` conditional in
   `@binderly/db`'s `exports` that points at `./src/index.ts`
   so `tsx` resolves it without a dist artefact.
5. **One-shot snapshot regen** — Pablo can run
   `pnpm install && pnpm --filter @binderly/db db:generate` once
   to confirm drizzle-kit produces a no-op diff against the
   hand-merged `meta/0002_snapshot.json` and `meta/0006_snapshot.json`.
   Not gating; `db:migrate` doesn't read the snapshot.
6. **`db:migrate` UX wart** — `migrate.ts` errors hard if
   `meta/_journal.json` is missing entries instead of skipping
   gracefully. Tracked from T-FN-DB-MIGRATIONS handoff.
7. **Dependabot backlog** — ~9 open PRs from when CI landed.
   Triage when convenient.
8. **`.nvmrc` 22.22.2 not locally installable** — fall back to
   22.13.0. Worth lockfile-pinning instead if we want CI to stay
   green on the exact version.

## Verification protocol

For runtime ACs that need Docker socket access, the orchestrator
hands Pablo a paste-able one-liner and merges on his thumbs-up.
Static-only ACs are verified in foreground via the diff inspector
or by sub-agents inside their worktrees. GRADING's agent
successfully ran live psql against local Supabase :54322 from
inside its worktree (Pablo's Docker is up); future schema agents
should attempt the same before deferring.

## Notes

This file is updated by the orchestrator agent at the end of every
dispatch loop iteration. Do not edit by hand.
