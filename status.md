# Build status — Phase 1 iter 5 near-close (IMAGE-PIPELINE + RLS-POLICIES merged); EBAY-LISTING-PARSER still in flight

**Phase:** 1 — Data layer (23/109 tasks merged)
**Merged:** 23 / 109 tasks
**In progress:** 1 (T-DL-EBAY-LISTING-PARSER)
**Blocked:** 0
**Blocked on humans:** 0

**Phase 1 schema-work milestone reached.** All 5 schema tasks
(USERS, CARDS, COLLECTIONS, GRADING, PRICING) merged. 13 schema
modules and 10 monotonic migrations (0000–0009) on main.

**Phase 1 source-pipeline milestone reached.** All 5 source
adapters merged: TCGDEX-EN (primary EN), PTCGIO (validation EN),
BULBAPEDIA (filler EN, wiki-shaped), TCGDEX-JP (primary JP),
POKEMONCARD-JP (filler JP, HTML-scraping). Pre-staged barrel +
additive rarity registry held up across 4 sibling-adapter merges
with zero 3-way conflicts.

**Phase 1 now ~50% done.** SEED-INGEST is unblocked once
IMAGE-PIPELINE + RLS-POLICIES land (this iter).

## Dispatch loop status

Phase 1 iter 2 schema work is functionally complete: USERS, CARDS,
COLLECTIONS, GRADING all merged. Each pair of parallel schema tasks
(USERS+CARDS, then COLLECTIONS+GRADING) hit the same migration-
numbering collision on merge; the orchestrator's reusable playbook is:

1. `cp` the second-arriving agent's SQL files + snapshot to `/tmp`.
2. `git merge -X theirs main` in the worktree (takes main's SQL +
   snapshot for the conflicting filenames).
3. Restore the agent's SQL files at the next-free numbered slot
   (0002/0003 for CARDS post-USERS; 0006/0007 for GRADING post-
   COLLECTIONS).
4. Hand-merge the snapshot JSON (combine main's tables map with
   the agent's net-new tables; mint a fresh UUID for `id`; chain
   `prevId` to main's latest snapshot).
5. Append the renumbered entries to `meta/_journal.json`.
6. Commit reconciliation, push, `gh pr merge --auto --squash`.

Sandbox prevents `pnpm install` in the worktree, so drizzle-kit
can't regenerate the snapshot. The hand-merge produces a
runtime-correct migration sequence (`db:migrate` only reads the
journal + SQL); a one-shot `db:generate` from Pablo's normal shell
will confirm a no-op diff and is the recommended sanity check.

Post-merge migration sequence on main is monotonic:

  0000_user_tables       (T-DL-SCHEMA-USERS, drizzle-generated)
  0001_users_rls         (T-DL-SCHEMA-USERS, hand-authored)
  0002_catalog_tables    (T-DL-SCHEMA-CARDS, drizzle-generated)
  0003_catalog_rls       (T-DL-SCHEMA-CARDS, hand-authored)
  0004_collection_tables (T-DL-SCHEMA-COLLECTIONS, drizzle-generated)
  0005_collections_rls   (T-DL-SCHEMA-COLLECTIONS, hand-authored)
  0006_grading_tables    (T-DL-SCHEMA-GRADING, drizzle-generated)
  0007_grading_rls       (T-DL-SCHEMA-GRADING, hand-authored)

Schema barrel `packages/db/src/schema/index.ts` has CARDS + USERS +
COLLECTIONS + GRADING uncommented. PRICING (the lone remaining
schema task) section is still pre-staged + commented.

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
| T-DL-EBAY-LISTING-PARSER | in_progress (iter 5) | — |
| T-DL-RLS-POLICIES | merged | #28 (`3c448db`; verify-rls suite + posture docs; surfaced Q-003) |
| T-DL-RLS-POLICIES | ready; scope reduced to data_conflict + admin debug | — |
| T-DL-SOURCE-PTCGIO / -BULBAPEDIA / -TCGDEX-JP | ready (queued) | — |
| T-DL-EBAY-LISTING-PARSER | ready (queued) | — |
| T-DL-IMAGE-PIPELINE | ready (queued) | — |
| T-DL-PRICING-AGGREGATOR / -EBAY-BROWSE / -ROLLUP / -CURRENT-VIEW | blocked on SCHEMA-PRICING | — |
| T-DL-FX-RATES | blocked on SCHEMA-PRICING | — |
| T-DL-SEED-INGEST | blocked on adapters + MASTER-SET-RULES + IMAGE-PIPELINE + RLS-POLICIES | — |
| ... ~14 more pending Phase 1 tasks | pending | — |

## Iter 5 dispatch (3 in flight, MAX_PARALLEL=3)

Three folder-disjoint, ready, high-impact tasks. All stubs;
elaborate-then-ship prompt pattern.

| Task | Effort | Owns_paths | Why this iter |
|---|---|---|---|
| T-DL-IMAGE-PIPELINE | L | `data-pipeline/src/images/` + `infra/r2/` | Unblocks SEED-INGEST + SC-EMBED-MODEL + R2-PROD; only blocking SEED-INGEST dep alongside RLS-POLICIES |
| T-DL-EBAY-LISTING-PARSER | L | `data-pipeline/src/parsers/ebay-listing/` | Unblocks PRICING-EBAY-BROWSE → PRICING-ROLLUP → PRICING-CURRENT-VIEW chain |
| T-DL-RLS-POLICIES | M (shrunk) | `packages/db/src/migrations/rls/` (RLS-only SQL; pre-staged folder) | Unblocks SEED-INGEST, AUTH, EDGE-FUNCTIONS, SUPABASE-PROD; remaining scope = data_conflict + admin debug surfaces only (per-table RLS landed inline with each schema task) |

Coordination notes:
- All three are folder-disjoint (no shared barrels, no shared
  registry edits expected).
- IMAGE-PIPELINE and SEED-INGEST share `infra/r2/` paths — but
  SEED-INGEST isn't in flight, so no conflict.
- RLS-POLICIES will likely add migrations 0010+; no parallelism
  with other DB-touching tasks this iter.

## Held to iter 6 (post-iter-5)

- **T-DL-SEED-INGEST** (now FULLY UNBLOCKED — both IMAGE-PIPELINE and RLS-POLICIES merged. The crown-jewel integration of Phase 1.)
- T-DL-PROFILE-GRANTS-FIX (XS; closes Q-003; additive 0012 migration; should land before T-BE-AUTH)
- T-DL-PRICING-AGGREGATOR + T-DL-PRICING-EBAY-BROWSE (parallel pair)
- T-DL-PRICING-ROLLUP (depends on the pricing-aggregator pair)
- T-DL-PRICING-CURRENT-VIEW (depends on PRICING-ROLLUP)
- T-DL-FX-RATES (S effort; quick win; could land iter 6)
- T-DL-DATA-CONFLICT-TABLE (S; new follow-up from RLS-POLICIES elaboration)
- T-DL-ADMIN-DEBUG-SURFACES (S; new follow-up from RLS-POLICIES elaboration)

## Open questions

- **Q-003** (raised by T-DL-RLS-POLICIES, PR #28): `0001_users_rls.sql`
  ships RLS policies for `profile`/`subscription` without companion
  `GRANT/REVOKE` statements. Hosted Supabase covers via
  `ALTER DEFAULT PRIVILEGES`; local Supabase CLI (PG17) does not.
  verify-rls reports 4 failures (all the same gap). Fix is additive:
  T-DL-PROFILE-GRANTS-FIX (XS; queued for iter 6).

## Phase 0 ledger (closed)

All 10 foundation tasks merged. See git log between `7df9f12`
(T-FN-MONOREPO) and `7b4529e` (T-FN-DB-MIGRATIONS) for the trail.

## Last 5 merges

- T-DL-RLS-POLICIES — `3c448db` (RLS posture docs + verify-rls TS suite; live Supabase: 93 passed / 4 failed; 4 failures are real gap → Q-003 → T-DL-PROFILE-GRANTS-FIX queued)
- T-DL-IMAGE-PIPELINE — `9be37c0` (sharp+S3+R2 image ingestion; 4-step variant ladder thumb/card/large/original; deterministic key shape; SHA-256 dedup via printing_image sidecar; Bulbapedia auto-excluded by EXCLUDED_IMAGE_SOURCES; mig 0010/0011; 42 new tests, package total 569)
- T-DL-SOURCE-TCGDEX-JP — `4c30cf0` (primary JP TCGdex + filler JP Pokemon-Card.com; reuses isTcgdexPromoSet from EN; pokemoncardJpToTcgdexJp matcher bridges id systems; 99 new tests, package total 527; closes iter 4)
- T-DL-SOURCE-BULBAPEDIA — `4afde4d` (filler-tier English; wiki-shaped; raw-wikitext brace-counted parser; CC-BY-NC-SA-compliant — no images persisted; 108 new tests, package total 367; first parser-heavy adapter)
- T-DL-SOURCE-PTCGIO — `c8b2de0` (validation-tier English adapter; tcgplayer.prices key set + rarity-string class signals; X-Api-Key support; 61 new tests, package total 313; rarity registry pre-seeded by SOURCE-INTERFACES)

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
