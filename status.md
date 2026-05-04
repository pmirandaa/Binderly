# Build status — Phase 1 iter 3 closed; iter 4 dispatching (3 sibling adapters)

**Phase:** 1 — Data layer (18/109 tasks merged)
**Merged:** 18 / 109 tasks
**In progress:** 3 (T-DL-SOURCE-PTCGIO, T-DL-SOURCE-BULBAPEDIA, T-DL-SOURCE-TCGDEX-JP)
**Blocked:** 0
**Blocked on humans:** 0

**Phase 1 schema-work milestone reached.** All 5 schema tasks
(USERS, CARDS, COLLECTIONS, GRADING, PRICING) merged. 13 schema
modules and 10 monotonic migrations (0000–0009) on main.

**Phase 1 source-pipeline foundation done.** SOURCE-INTERFACES,
MASTER-SET-RULES, and the first concrete adapter (TCGDEX-EN) are
all merged. Adapter framework is battle-tested.

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
| T-DL-SOURCE-PTCGIO | in_progress (iter 4) | — |
| T-DL-SOURCE-BULBAPEDIA | in_progress (iter 4) | — |
| T-DL-SOURCE-TCGDEX-JP | in_progress (iter 4) | — |
| T-DL-RLS-POLICIES | ready; scope reduced to data_conflict + admin debug | — |
| T-DL-SOURCE-PTCGIO / -BULBAPEDIA / -TCGDEX-JP | ready (queued) | — |
| T-DL-EBAY-LISTING-PARSER | ready (queued) | — |
| T-DL-IMAGE-PIPELINE | ready (queued) | — |
| T-DL-PRICING-AGGREGATOR / -EBAY-BROWSE / -ROLLUP / -CURRENT-VIEW | blocked on SCHEMA-PRICING | — |
| T-DL-FX-RATES | blocked on SCHEMA-PRICING | — |
| T-DL-SEED-INGEST | blocked on adapters + MASTER-SET-RULES + IMAGE-PIPELINE + RLS-POLICIES | — |
| ... ~14 more pending Phase 1 tasks | pending | — |

## Iter 4 dispatch (3 in flight, MAX_PARALLEL=3)

Three sibling adapter tasks. Owns_paths are folder-disjoint
(`adapters/ptcgio/`, `adapters/bulbapedia/`, `adapters/tcgdex-jp/`
+ `adapters/pokemoncard-jp/`); the shared coordination surfaces are:
- `data-pipeline/src/adapters/index.ts` — pre-staged with sectioned
  uncomment-only headers (same playbook as the schema barrel; PR
  #23's TCGDEX-EN line is already in place; each new adapter
  uncomments its own section).
- `data-pipeline/src/normalize/rarity.ts` — additive registry; each
  adapter adds its own source key. Git's auto-merge handles
  language-disjoint additions cleanly.

| Task | Tier | Language | Folder |
|---|---|---|---|
| T-DL-SOURCE-PTCGIO | validation | en | `data-pipeline/src/adapters/ptcgio/` |
| T-DL-SOURCE-BULBAPEDIA | validation/filler | en | `data-pipeline/src/adapters/bulbapedia/` |
| T-DL-SOURCE-TCGDEX-JP | primary | jp | `data-pipeline/src/adapters/tcgdex-jp/` + `pokemoncard-jp/` |

All three are stubs dispatched with the elaborate-then-ship prompt
pattern. The TCGDEX-EN PR body's "Notes for the 3 sibling adapter
tasks" is the canonical playbook (folder layout, FetchShim test
pattern, sourceKey convention, raw-signals-only contract, etc.).

## Held to iter 5 (post-iter-4)

- T-DL-EBAY-LISTING-PARSER (depends on SOURCE-INTERFACES + CARDS)
- T-DL-IMAGE-PIPELINE (depends on CARDS + SOURCE-INTERFACES)
- T-DL-PRICING-AGGREGATOR / -EBAY-BROWSE (need adapters + SCHEMA-PRICING)
- T-DL-FX-RATES (depends on SCHEMA-PRICING)
- T-DL-RLS-POLICIES (scope shrunk to data_conflict + admin debug; may roll into a later docs PR)

## Phase 0 ledger (closed)

All 10 foundation tasks merged. See git log between `7df9f12`
(T-FN-MONOREPO) and `7b4529e` (T-FN-DB-MIGRATIONS) for the trail.

## Last 5 merges

- T-DL-SOURCE-TCGDEX-EN — `1a741ab` (first concrete adapter; primary English; FetchShim test pattern; 45 new tests, package total 199; canonical adapter playbook for siblings)
- T-DL-SCHEMA-PRICING — `a99fc0b` (4 tables: market + price_observation + price_aggregate + fx_rate; idempotent 7-market seed; observation-internal RLS; 11/11 ACs PASS live; closes Phase 1 schema surface)
- T-DL-MASTER-SET-RULES — `d531dc7` (pure decideMasterSetMembership engine; zod-validated overrides; 53 new tests, package total 207; runtime drift guard against classifier defaults)
- T-DL-SOURCE-INTERFACES — `51b3727` (@binderly/data-pipeline package; SourceAdapter / RateLimitedClient / resolver / variant-classifier / canonical-keys; 154 tests; tcg-domain.md § 8 patched)
- T-DL-SCHEMA-GRADING — `77d18d0` (grading_submission + grading_training_sample; cross-schema FK; service-role-only training corpus; renumbered 0006/0007)

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
