# Build status — Phase 1 iter 6 near-close (PROFILE-GRANTS-FIX + FX-RATES merged); SEED-INGEST still in flight

**Phase:** 1 — Data layer (26/109 tasks merged)
**Merged:** 26 / 109 tasks
**In progress:** 1 (T-DL-SEED-INGEST)
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
| T-DL-EBAY-LISTING-PARSER | merged | #30 (`2b2d144`; 8-pass; 108-entry corpus; 310 new tests) |
| T-DL-SEED-INGEST | in_progress (iter 6) | — |
| T-DL-PROFILE-GRANTS-FIX | merged | #31 (`1fe1fbd`; mig 0012; closes Q-003 pending Pablo's verify-rls smoke test) |
| T-DL-FX-RATES | merged | #32 (`63a8ae8`; Frankfurter `.dev/v1`; 6 quote currencies; 30 new tests) |
| T-DL-RLS-POLICIES | merged | #28 (`3c448db`; verify-rls suite + posture docs; surfaced Q-003) |
| T-DL-RLS-POLICIES | ready; scope reduced to data_conflict + admin debug | — |
| T-DL-SOURCE-PTCGIO / -BULBAPEDIA / -TCGDEX-JP | ready (queued) | — |
| T-DL-EBAY-LISTING-PARSER | ready (queued) | — |
| T-DL-IMAGE-PIPELINE | ready (queued) | — |
| T-DL-PRICING-AGGREGATOR / -EBAY-BROWSE / -ROLLUP / -CURRENT-VIEW | blocked on SCHEMA-PRICING | — |
| T-DL-FX-RATES | blocked on SCHEMA-PRICING | — |
| T-DL-SEED-INGEST | blocked on adapters + MASTER-SET-RULES + IMAGE-PIPELINE + RLS-POLICIES | — |
| ... ~14 more pending Phase 1 tasks | pending | — |

## Iter 6 dispatch (3 in flight, MAX_PARALLEL=3)

The Phase 1 integration moment. Three folder-disjoint tasks
(no shared barrels, no shared SQL files).

| Task | Effort | Owns_paths | Why this iter |
|---|---|---|---|
| **T-DL-SEED-INGEST** | L | `data-pipeline/src/jobs/seed.ts` + `data-pipeline/scripts/` | The crown jewel: adapters → resolver → master-set rules → DB upsert → image pipeline, end-to-end. First true integration of all Phase 1 work. Sole owner; running alone-ish maximizes range for the integration sub-agent. |
| T-DL-PROFILE-GRANTS-FIX | XS | `packages/db/src/migrations/0012_profile_grants_fix.sql` | Closes Q-003 (verify-rls 4 failures). Additive migration; same GRANT/REVOKE pattern as 0003/0005/0007/0009. Unblocks T-BE-AUTH local-Supabase work. |
| T-DL-FX-RATES | S | `data-pipeline/src/jobs/fx-rates.ts` + `data-pipeline/src/adapters/fx/` | Quick-win. Frankfurter or ECB. Unblocks T-SP-PRICING-DISPLAY (Phase 3 shared-packages). |

Migration coordination:
- T-DL-PROFILE-GRANTS-FIX takes migration 0012 (next free).
- T-DL-SEED-INGEST is dispatched with explicit instruction NOT
  to add a migration (no new tables; only writes via @binderly/db).
- T-DL-FX-RATES does not need a new migration (the `fx_rate`
  table already exists from T-DL-SCHEMA-PRICING; the job inserts
  into it).

## Held to iter 7

- T-DL-PRICING-AGGREGATOR + T-DL-PRICING-EBAY-BROWSE (parallel pair; depend on EBAY-LISTING-PARSER which is now merged)
- T-DL-PRICING-ROLLUP (depends on the pair)
- T-DL-PRICING-CURRENT-VIEW (depends on ROLLUP)
- T-DL-DATA-CONFLICT-TABLE (S; resolver disagreement persistence)
- T-DL-ADMIN-DEBUG-SURFACES (S; pg_stat_statements + admin views)

## Open questions

- **Q-003** (raised by T-DL-RLS-POLICIES, PR #28; **fix shipped** in
  T-DL-PROFILE-GRANTS-FIX, PR #31, mig 0012): canonical REVOKE/GRANT
  pattern from 0003/0005/0007/0009/0011 applied to profile +
  subscription. Migration was authored against spec; sub-agent could
  not run live verify-rls (sandbox tsx-IPC + psql blocks). **Pending
  Pablo's smoke test** to confirm verify-rls goes from 93/4 → 97/0.
  If post-fix run reports anything other than 97/97, that's a
  follow-up additive migration (do NOT silently amend 0012).

## Phase 0 ledger (closed)

All 10 foundation tasks merged. See git log between `7df9f12`
(T-FN-MONOREPO) and `7b4529e` (T-FN-DB-MIGRATIONS) for the trail.

## Last 5 merges

- T-DL-FX-RATES — `63a8ae8` (Frankfurter `.dev/v1`; USD-base; 6 quote currencies; weekend-remap-aware; 30 new tests, package total 909; corrected fx_rate PK; CLI ergonomic)
- T-DL-PROFILE-GRANTS-FIX — `1fe1fbd` (additive 0012 mirroring canonical REVOKE/GRANT pattern from 0003/0005/0007/0009/0011; closes Q-003 pending Pablo's verify-rls smoke test)
- T-DL-EBAY-LISTING-PARSER — `2b2d144` (8-pass deterministic parser; 108-entry hand-crafted corpus; 15 variant-hint flags; 0..1 confidence; ParserCatalogReader joiner; 310 new tests, package total 837; closes iter 5)
- T-DL-RLS-POLICIES — `3c448db` (RLS posture docs + verify-rls TS suite; live Supabase: 93 passed / 4 failed; 4 failures are real gap → Q-003 → T-DL-PROFILE-GRANTS-FIX queued)
- T-DL-IMAGE-PIPELINE — `9be37c0` (sharp+S3+R2 image ingestion; 4-step variant ladder thumb/card/large/original; deterministic key shape; SHA-256 dedup via printing_image sidecar; Bulbapedia auto-excluded by EXCLUDED_IMAGE_SOURCES; mig 0010/0011; 42 new tests, package total 569)

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
