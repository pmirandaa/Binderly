# Build status — Phase 1 iter 2 closed; iter 3 dispatching (last schema + first adapter + master-set rules)

**Phase:** 1 — Data layer (15/109 tasks merged)
**Merged:** 15 / 109 tasks
**In progress:** 3 (T-DL-SCHEMA-PRICING, T-DL-SOURCE-TCGDEX-EN, T-DL-MASTER-SET-RULES)
**Blocked:** 0
**Blocked on humans:** 0

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
| T-DL-SCHEMA-PRICING | in_progress (iter 3) | — |
| T-DL-SOURCE-TCGDEX-EN | in_progress (iter 3) | — |
| T-DL-MASTER-SET-RULES | in_progress (iter 3) | — |
| T-DL-RLS-POLICIES | ready; scope reduced to data_conflict + admin debug | — |
| T-DL-SOURCE-PTCGIO / -BULBAPEDIA / -TCGDEX-JP | ready (queued) | — |
| T-DL-EBAY-LISTING-PARSER | ready (queued) | — |
| T-DL-IMAGE-PIPELINE | ready (queued) | — |
| T-DL-PRICING-AGGREGATOR / -EBAY-BROWSE / -ROLLUP / -CURRENT-VIEW | blocked on SCHEMA-PRICING | — |
| T-DL-FX-RATES | blocked on SCHEMA-PRICING | — |
| T-DL-SEED-INGEST | blocked on adapters + MASTER-SET-RULES + IMAGE-PIPELINE + RLS-POLICIES | — |
| ... ~14 more pending Phase 1 tasks | pending | — |

## Iter 3 dispatch (3 in flight, MAX_PARALLEL=3)

Owns_paths are pairwise disjoint, so all 3 run safely in parallel:

| Task | Scope | Owns_paths |
|---|---|---|
| T-DL-SCHEMA-PRICING | Last schema task in Phase 1; finalizes the DB surface for the pricing branch. Migrations land cleanly at 0008/0009 (no other schema in flight). | `packages/db/src/schema/{prices,price_snapshots}.ts` + barrel uncomment + new migrations |
| T-DL-SOURCE-TCGDEX-EN | First concrete adapter; primary English source. Validates the @binderly/data-pipeline contract from the consumer side. | `data-pipeline/src/adapters/tcgdex-en/` |
| T-DL-MASTER-SET-RULES | Master set decision logic; consumes the variant classifier from SOURCE-INTERFACES; emits `printing.include_in_master_set` writes. | `data-pipeline/src/master-set/` |

All three are stubs flagged for elaboration (the orchestrator's
"elaborate-then-ship" prompt pattern from GRADING is reused). RLS-
POLICIES held: its remaining scope (data_conflict + admin debug
surfaces) may roll into a later docs PR.

## Phase 0 ledger (closed)

All 10 foundation tasks merged. See git log between `7df9f12`
(T-FN-MONOREPO) and `7b4529e` (T-FN-DB-MIGRATIONS) for the trail.

## Last 5 merges

- T-DL-SOURCE-INTERFACES — `51b3727` (@binderly/data-pipeline package; SourceAdapter / RateLimitedClient / resolver / variant-classifier / canonical-keys; 154/154 tests; tcg-domain.md § 8 patched per allowed escalation)
- T-DL-SCHEMA-GRADING — `77d18d0` (grading_submission + grading_training_sample; cross-schema FK; service-role-only training corpus; renumbered 0006/0007)
- T-DL-SCHEMA-COLLECTIONS — `c131903` (5 tables + 0004/0005; NULLS NOT DISTINCT; nested-table RLS via EXISTS; shareable slug-gated public-read)
- T-DL-SCHEMA-CARDS — `24b0fd4` (catalog tables + RLS; renumbered 0002/0003; snapshot hand-merge)
- T-DL-SCHEMA-USERS — `e9b4f38` (profile + subscription; cross-schema FK to auth.users; user-side RLS)

## Known follow-ups (logged, non-blocking)

1. **`T-DL-DB-TEST-INFRA` (proposed)** — stand up vitest in
   `@binderly/db` so CARDS' AC-8 (fixture round-trip test) and
   COLLECTIONS' two deferred ACs can land. GRADING ran live psql
   and didn't need a runner. The two prior tasks need this before
   their fixture round-trip tests can execute.
2. **Sandbox + drizzle-kit wrapper** — `pnpm exec drizzle-kit generate`
   works directly; the `pnpm db:generate` wrapper is a `tsx` script
   and `tsx` cannot create its IPC pipe under the Cursor sandbox.
   Future db sub-agents need the same workaround until the wrapper
   is rewritten in plain Node or sandbox grants IPC access.
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
