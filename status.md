# Build status — Phase 1 iter 9 dispatching: PRICING-CURRENT-VIEW (the materialised-view cap)

**Phase:** 1 — Data layer (30/109 tasks merged)
**Merged:** 30 / 109 tasks
**In progress:** 1 (T-DL-PRICING-CURRENT-VIEW)
**Blocked:** 0
**Blocked on humans:** 0 (Q-003 verified live 2026-05-04 23:24Z; Q-005 verified live same session — clean SEED-INGEST run with 332 transcoded / 9 cached / 0 errors)

**Phase 1 schema-work milestone reached.** All 5 schema tasks merged.
13 schema modules + 13 monotonic migrations (0000–0012) on main.

**Phase 1 source-pipeline milestone reached.** All 5 source adapters
merged.

**Phase 1 SEED-INGEST integration crown jewel landed AND verified live.**
Pablo's 2026-05-04 23:24Z run (post-Q-005 hotfix): 1 set / 216 cards /
341 printings upserted; 332 images transcoded + 9 cached (dedup hit) /
0 errors; cross-source agreement signal flowing (PTCGIO validates
TCGdex-EN: name 301/310, hp 151/172, rarity 114/172).

**Phase 1 pricing pipeline complete except for the materialised view.**
- Layer 1: PRICING-AGGREGATOR (Cardmarket + eBay-sold paid API; mock-by-default).
- Layer 2: PRICING-EBAY-BROWSE (free eBay Browse active listings).
- Daily aggregation: PRICING-ROLLUP (idempotent; outlier-trimmed; per-currency).
- Display lookup: PRICING-CURRENT-VIEW **(this iter — dispatching)**.

**Phase 1 now ~78% done.** After PRICING-CURRENT-VIEW lands the only
remaining critical-path data-layer pieces are DATA-CONFLICT-TABLE +
ADMIN-DEBUG-SURFACES (both still need stub authoring as iter-10 prep).

## Dispatch loop status

Iter 8 closed; iter 9 dispatching. Phase 1 progression so far:

iter 1 (USERS+CARDS) →
iter 2 (COLLECTIONS+GRADING+SOURCE-INTERFACES) →
iter 3 (SCHEMA-PRICING+MASTER-SET-RULES+TCGDEX-EN) →
iter 4 (PTCGIO+BULBAPEDIA+TCGDEX-JP) →
iter 5 (IMAGE-PIPELINE+RLS-POLICIES+EBAY-LISTING-PARSER) →
iter 6 (SEED-INGEST+PROFILE-GRANTS-FIX+FX-RATES) →
iter 7 (PRICING-AGGREGATOR+PRICING-EBAY-BROWSE) →
iter 7.5 (Q-005 hotfix: image-pipeline cross-host) →
iter 8 (PRICING-ROLLUP) →
**iter 9 (PRICING-CURRENT-VIEW)**.

Reconciliation playbooks (migration renumbering, pre-staged sectioned
barrels, symbol-rename for parallel-developed type collisions)
preserved in earlier orchestrator commits + git log; not re-documented
inline.

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

PRICING-CURRENT-VIEW WILL add a migration (likely `0013_mv_current_price.sql`
hand-authored — materialised views aren't drizzle-generated). All other
schema-barrel sections in `packages/db/src/schema/index.ts` already
uncommented.

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
| T-DL-EBAY-LISTING-PARSER | merged | #30 (`2b2d144`; 8-pass; 108-entry corpus) |
| T-DL-PROFILE-GRANTS-FIX | merged | #31 (`1fe1fbd`; mig 0012; closes Q-003 — Pablo verified live) |
| T-DL-FX-RATES | merged | #32 (`63a8ae8`; Frankfurter `.dev/v1`) |
| T-DL-SEED-INGEST | merged | #33 (`34264a3`; integration crown jewel; surfaced Q-005) |
| T-DL-IMAGE-PIPELINE-CROSSHOST-FIX | merged | #35 (`49e9446`; closes Q-005) |
| T-DL-PRICING-AGGREGATOR | merged | #34 (`f3e5608`; Layer 1 paid API) |
| T-DL-PRICING-EBAY-BROWSE | merged | #36 (`8b855f4`; Layer 2 free Browse; reconciliation rename) |
| T-DL-PRICING-ROLLUP | merged | #37 (`1cc7a40`; daily aggregation; outlier-trimmed; per-currency) |
| T-DL-PRICING-CURRENT-VIEW | in_progress (iter 9) | — |
| T-DL-DATA-CONFLICT-TABLE / -ADMIN-DEBUG-SURFACES | held to iter 10 (no stubs yet — author one before dispatch) | — |
| ... ~9 more pending Phase 1 tasks | pending | — |

## Iter 9 dispatch (1 in flight, under MAX_PARALLEL=3)

PRICING-CURRENT-VIEW solo. It's the materialised view that turns
`price_aggregate` rows into the fast `mv_current_price` lookup the app
reads from. Effort S; depends only on PRICING-ROLLUP.

| Task | Effort | Owns_paths | Why this iter |
|---|---|---|---|
| **T-DL-PRICING-CURRENT-VIEW** | S | `packages/db/src/migrations/0013_mv_current_price.sql` (anticipated) + a refresh job in `data-pipeline/src/jobs/` | Caps the pricing pipeline; gives the app a single fast lookup row per (printing, grade_tier, market, currency). |

Migration coordination:
- Adds **mig 0013** (materialised view DDL + indices). Hand-authored
  (drizzle-kit doesn't model materialised views). No schema-barrel
  changes needed (mvs aren't `pgTable`s).
- DATA-CONFLICT-TABLE / ADMIN-DEBUG-SURFACES (held to iter 10) will
  share the migrations folder; their stubs need authoring before
  dispatch — flagging the serialisation now.

Stub elaboration: same Phase 1 / Phase 2 pattern as the prior pricing
pair + ROLLUP. Sub-agent reads PROJECT.md § 6/§13 + the rules + every
dependency's merged code (especially price_aggregate's columns) and
rewrites the stub against §7's full template before implementing.

## Held to iter 10

- T-DL-DATA-CONFLICT-TABLE (no stub yet — author one in iter 10 prep)
- T-DL-ADMIN-DEBUG-SURFACES (no stub yet; touches `packages/db/src/migrations/` so requires serialisation against DATA-CONFLICT-TABLE)
- T-DL-PRICING-TYPES-CONSOLIDATION (proposed cleanup; consolidate the AGGREGATOR/EBAY-BROWSE symbol divergence introduced by PR #36's reconciliation; non-critical-path)

## Open questions

All open questions are closed.

- **Q-003** (RLS grants gap) — closed; verified live by Pablo 2026-05-04 (97/0 on verify-rls after applying mig 0012).
- **Q-004** (`@binderly/db` package.json exports) — closed (self-fixed in PR #33; turbo-build follow-up logged).
- **Q-005** (image-pipeline cross-host) — closed; verified live by Pablo 2026-05-04 23:24Z (332 transcoded / 9 cached / 0 errors against the post-fix main).

## Phase 0 ledger (closed)

All 10 foundation tasks merged. See git log between `7df9f12`
(T-FN-MONOREPO) and `7b4529e` (T-FN-DB-MIGRATIONS).

## Last 5 merges

- T-DL-PRICING-ROLLUP — `1cc7a40` (daily price-observation -> price_aggregate rollup; idempotent on the schema's composite PK; per-currency aggregation [no FX in rollup — display-time conversion]; outlier filter active in v1: drop top/bottom 5% when sample_count >= 20; 29 new tests; package total 1072)
- T-DL-PRICING-EBAY-BROWSE — `8b855f4` (Layer 2 active-listings ingest; eBay Browse v1 OAuth client-credentials + paginated search; mock-by-default; 6 marketplaces; reconciliation rename `EbayBrowsePriceObservation*` to dodge AGGREGATOR's already-merged symbols; 35 new tests; package total 1043)
- T-DL-PRICING-AGGREGATOR — `f3e5608` (Layer 1 paid-source ingest; Cardmarket + eBay-sold mock fixtures; reuses EBAY-LISTING-PARSER joiner; 49 new tests; package total 976)
- T-DL-IMAGE-PIPELINE-CROSSHOST-FIX — `49e9446` (closes Q-005; dedicated assets.tcgdex.net + images.pokemontcg.io clients in seed; toJSON on ImagePipelineError + AdapterError; 14 new tests; package total 941)
- T-DL-SEED-INGEST — `34264a3` (Phase-1 integration crown jewel; runSeedIngest end-to-end; live smoke surfaced Q-005)

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
   `pricing-rollup.ts` auto-load `.env` via dotenv so smoke tests are
   one-liners. Also: PR #33's smoke-test instructions reference the
   wrong DATABASE_URL default (Compose Postgres :5433 vs Supabase
   Postgres :54322 where migrations live); fix the README.
4. **`T-DL-DB-TURBO-BUILD-PIPELINE` (proposed; Q-004 follow-up)** — add
   a turbo `^build` pipeline so `pnpm seed` implicitly builds
   `@binderly/db` first, OR add an `import` conditional in
   `@binderly/db`'s `exports` that points at `./src/index.ts` so `tsx`
   resolves it without a dist artefact.
5. **One-shot snapshot regen** — Pablo can run
   `pnpm install && pnpm --filter @binderly/db db:generate` once to
   confirm drizzle-kit produces a no-op diff against the hand-merged
   `meta/0002_snapshot.json` and `meta/0006_snapshot.json`. Not
   gating; `db:migrate` doesn't read the snapshot.
6. **`db:migrate` UX wart** — `migrate.ts` errors hard if
   `meta/_journal.json` is missing entries instead of skipping
   gracefully. Tracked from T-FN-DB-MIGRATIONS handoff.
7. **Dependabot backlog** — ~9 open PRs from when CI landed. Triage
   when convenient.
8. **`.nvmrc` 22.22.2 not locally installable** — fall back to 22.13.0.
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
