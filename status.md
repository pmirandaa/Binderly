# Build status — Phase 1 iter 7 dispatching: pricing pair (PRICING-AGGREGATOR + PRICING-EBAY-BROWSE)

**Phase:** 1 — Data layer (27/109 tasks merged)
**Merged:** 27 / 109 tasks
**In progress:** 2 (T-DL-PRICING-AGGREGATOR, T-DL-PRICING-EBAY-BROWSE)
**Blocked:** 0
**Blocked on humans:** 1 (Pablo to run `pnpm --filter @binderly/db verify-rls` to confirm Q-003 closed live + run the SEED-INGEST smoke test from PR #33's body — neither blocks dispatch)

**Phase 1 schema-work milestone reached.** All 5 schema tasks
(USERS, CARDS, COLLECTIONS, GRADING, PRICING) merged. 13 schema
modules and 13 monotonic migrations (0000–0012) on main.

**Phase 1 source-pipeline milestone reached.** All 5 source
adapters merged: TCGDEX-EN (primary EN), PTCGIO (validation EN),
BULBAPEDIA (filler EN, wiki-shaped), TCGDEX-JP (primary JP),
POKEMONCARD-JP (filler JP, HTML-scraping). Pre-staged barrel +
additive rarity registry held up across 4 sibling-adapter merges
with zero 3-way conflicts.

**Phase 1 SEED-INGEST integration crown jewel landed.** All 5
adapters + resolver + variant classifier + master-set engine + DB
upserts + image pipeline (R2 dedup) compose end-to-end via
`runSeedIngest`. 18 new tests; package total **927**. PR #33's body
has the paste-able human smoke test that exercises the full chain
against local Docker.

**Phase 1 now ~70% done.** Pricing pair
(PRICING-AGGREGATOR + PRICING-EBAY-BROWSE) is the next
critical-path piece; everything they depend on is merged.

## Dispatch loop status

Iter 6 closed; iter 7 dispatching. Phase 1 progression so far:
iter 1 (USERS+CARDS) → iter 2 (COLLECTIONS+GRADING+SOURCE-INTERFACES) →
iter 3 (SCHEMA-PRICING+MASTER-SET-RULES+TCGDEX-EN) →
iter 4 (PTCGIO+BULBAPEDIA+TCGDEX-JP) →
iter 5 (IMAGE-PIPELINE+RLS-POLICIES+EBAY-LISTING-PARSER) →
iter 6 (SEED-INGEST+PROFILE-GRANTS-FIX+FX-RATES) →
iter 7 (PRICING-AGGREGATOR+PRICING-EBAY-BROWSE).

The full migration-renumbering and barrel-pre-staging playbooks
are preserved in earlier orchestrator commits + git log if needed
for future reference; not repeated inline anymore (status.md
shouldn't be the source of truth for those).

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
| T-DL-PROFILE-GRANTS-FIX | merged | #31 (`1fe1fbd`; mig 0012; closes Q-003 pending Pablo's verify-rls smoke test; Pablo's "do option 1" answer ratifies) |
| T-DL-FX-RATES | merged | #32 (`63a8ae8`; Frankfurter `.dev/v1`; 6 quote currencies; 30 new tests) |
| T-DL-SEED-INGEST | merged | #33 (`34264a3`; integration crown jewel; 18 new tests, package total 927; reconciliation merge `463b9d4`) |
| T-DL-PRICING-AGGREGATOR | in_progress (iter 7) | — |
| T-DL-PRICING-EBAY-BROWSE | in_progress (iter 7) | — |
| T-DL-PRICING-ROLLUP / -CURRENT-VIEW | blocked on the pricing pair | — |
| T-DL-DATA-CONFLICT-TABLE / -ADMIN-DEBUG-SURFACES | held to iter 8 (no stubs yet; share migrations folder; need serialisation) | — |
| ... ~10 more pending Phase 1 tasks | pending | — |

## Iter 7 dispatch (2 in flight, under MAX_PARALLEL=3)

Pricing pair. Folder-disjoint; both stubs exist and need
elaboration before implementation. Picked together because both
depend solely on already-merged tasks (SOURCE-INTERFACES +
SCHEMA-PRICING [+ EBAY-LISTING-PARSER for browse]) and are
explicitly `parallel_safe_with` each other in `dependencies.yaml`.

| Task | Effort | Owns_paths | Why this iter |
|---|---|---|---|
| **T-DL-PRICING-AGGREGATOR** | M | `data-pipeline/src/adapters/pricing-aggregator/` | Layer 1: eBay sold + Cardmarket via paid API. Becomes the high-confidence anchor for `mv_current_price`. |
| **T-DL-PRICING-EBAY-BROWSE** | M | `data-pipeline/src/adapters/pricing-ebay-browse/` | Layer 2: free eBay Browse (active listings, no approval). Joins via `EBAY-LISTING-PARSER`. |

Migration coordination:
- Neither task adds a migration (the `price_observation` /
  `price_aggregate` tables already exist from `T-DL-SCHEMA-PRICING`).
- Both write to existing tables via `@binderly/db`.

Stub elaboration: each sub-agent runs Phase 1 (read PROJECT.md
§6/§7/§8 + `rules/01-data-layer.md` + every dependency's *merged*
code; rewrite stub against the orchestrator's full task template)
and Phase 2 (implement against own elaborated spec). Same
elaboration pattern as `T-DL-SEED-INGEST` / `T-DL-FX-RATES`.

## Held to iter 8

- T-DL-PRICING-ROLLUP (depends on the pair landing first)
- T-DL-PRICING-CURRENT-VIEW (depends on ROLLUP)
- T-DL-DATA-CONFLICT-TABLE (no stub yet — author one in iter 8 prep)
- T-DL-ADMIN-DEBUG-SURFACES (no stub yet; touches `packages/db/src/migrations/` so requires serialisation against DATA-CONFLICT-TABLE)

## Open questions

- **Q-003** (raised by T-DL-RLS-POLICIES, PR #28; **fix shipped** in
  T-DL-PROFILE-GRANTS-FIX, PR #31, mig 0012; **Pablo answered** —
  "do option 1" — on 2026-05-04, ratifying what already shipped):
  canonical REVOKE/GRANT pattern from 0003/0005/0007/0009/0011
  applied to profile + subscription. Migration was authored against
  spec; sub-agent could not run live verify-rls (sandbox tsx-IPC +
  psql blocks). **Pending Pablo's smoke test** to confirm verify-rls
  goes from 93/4 → 97/0. If post-fix run reports anything other
  than 97/97, that's a follow-up additive migration (do NOT silently
  amend 0012).
- **Q-004** (raised by T-DL-SEED-INGEST, PR #33; **self-fixed in
  same PR**): `@binderly/db`'s `package.json` was missing `main` /
  `types` / `exports`. Pre-SEED-INGEST every consumer of
  `@binderly/db` imported it from `*.test.ts` only (vitest's Vite
  resolver doesn't need the fields). SEED-INGEST landed the first
  non-test imports → `tsc -p . --noEmit` blew up with `TS2307:
  Cannot find module '@binderly/db'`. Sub-agent applied the
  additive fix in the same PR as an unblocking deviation;
  orchestrator approved on review. No further action required.

## Phase 0 ledger (closed)

All 10 foundation tasks merged. See git log between `7df9f12`
(T-FN-MONOREPO) and `7b4529e` (T-FN-DB-MIGRATIONS) for the trail.

## Last 5 merges

- T-DL-SEED-INGEST — `34264a3` (Phase-1 integration crown jewel; runSeedIngest wires 5 adapters → resolver → variant classifier → master-set engine → Drizzle catalog upserts → image pipeline → R2 dedup; pure-DB-state idempotency; per-set/per-image inline concurrency pools; CLI flags --source/--set/--limit-sets/--limit-cards/--dry-run/--no-images; 18 new tests, package total 927; reconciliation merge `463b9d4` resolved jobs/index.ts + package.json conflicts cleanly; surfaced Q-004 [self-fixed in same PR])
- T-DL-FX-RATES — `63a8ae8` (Frankfurter `.dev/v1`; USD-base; 6 quote currencies; weekend-remap-aware; 30 new tests, package total 909; corrected fx_rate PK; CLI ergonomic)
- T-DL-PROFILE-GRANTS-FIX — `1fe1fbd` (additive 0012 mirroring canonical REVOKE/GRANT pattern from 0003/0005/0007/0009/0011; closes Q-003 pending Pablo's verify-rls smoke test; Pablo's "do option 1" answer ratifies)
- T-DL-EBAY-LISTING-PARSER — `2b2d144` (8-pass deterministic parser; 108-entry hand-crafted corpus; 15 variant-hint flags; 0..1 confidence; ParserCatalogReader joiner; 310 new tests, package total 837; closes iter 5)
- T-DL-RLS-POLICIES — `3c448db` (RLS posture docs + verify-rls TS suite; live Supabase: 93 passed / 4 failed; 4 failures are real gap → Q-003 → T-DL-PROFILE-GRANTS-FIX queued)

## Known follow-ups (logged, non-blocking)

1. **`T-DL-DB-TEST-INFRA` (proposed)** — stand up vitest in
   `@binderly/db` so CARDS' AC-8 (fixture round-trip test) and
   COLLECTIONS' two deferred ACs can land. GRADING ran live psql
   and didn't need a runner. The two prior tasks need this before
   their fixture round-trip tests can execute.
2. **Sandbox + tsx-IPC-pipe wrappers** — `pnpm exec drizzle-kit generate`
   works directly; the `pnpm db:generate` AND `pnpm db:migrate`
   wrappers are `tsx` scripts and `tsx` cannot create its IPC pipe
   under the Cursor sandbox. **Three sub-agents now hit this**
   (COLLECTIONS, GRADING, PRICING). T-DL-DB-TEST-INFRA scope should
   include rewriting both wrappers in plain ESM (no `tsx` runtime)
   so future db sub-agents don't repeat the dance. PRICING agent
   wrote a temporary plain-ESM migrator for AC verification and
   deleted before commit — that pattern is the prototype.
3. **One-shot snapshot regen** — Pablo can run
   `pnpm install && pnpm --filter @binderly/db db:generate` once
   to confirm drizzle-kit produces a no-op diff against the
   hand-merged `meta/0002_snapshot.json` and `meta/0006_snapshot.json`.
   Not gating; `db:migrate` doesn't read the snapshot.
4. **`db:migrate` UX wart** — `migrate.ts` errors hard if
   `meta/_journal.json` is missing entries instead of skipping
   gracefully. Tracked from T-FN-DB-MIGRATIONS handoff.
5. **Dependabot backlog** — ~9 open PRs from when CI landed.
   Triage when convenient.
6. **`.nvmrc` 22.22.2 not locally installable** — multiple sub-agents
   reported this; fall back to 22.13.0. Worth lockfile-pinning instead
   if we want CI to stay green on the exact version.

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
