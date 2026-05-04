# Build status — Phase 1 iter 2 partial: COLLECTIONS merged; SOURCE-INTERFACES + GRADING in flight

**Phase:** 1 — Data layer (13/109 tasks merged)
**Merged:** 13 / 109 tasks
**In progress:** 2 (T-DL-SOURCE-INTERFACES, T-DL-SCHEMA-GRADING)
**Blocked:** 0
**Blocked on humans:** 0

## Dispatch loop status

Phase 1 iteration 1 (T-DL-SCHEMA-USERS + T-DL-SCHEMA-CARDS) merged
in lock-step despite the migration-numbering collision. USERS landed
first (PR #15 → main as `e9b4f38`), then the orchestrator merged
main into the CARDS worktree, renumbered its catalog migrations
0000/0001 → 0002/0003, hand-merged `meta/0002_snapshot.json` (the
worktree couldn't `pnpm install` in the sandbox to regenerate via
drizzle-kit), and shipped the reconciliation as `b5af7f7` on
agent/T-DL-SCHEMA-CARDS. CARDS auto-merged (PR #16 → main as
`24b0fd4`).

Post-merge migration sequence on main is monotonic:

  0000_user_tables       (T-DL-SCHEMA-USERS, drizzle-generated)
  0001_users_rls         (T-DL-SCHEMA-USERS, hand-authored)
  0002_catalog_tables    (T-DL-SCHEMA-CARDS, drizzle-generated)
  0003_catalog_rls       (T-DL-SCHEMA-CARDS, hand-authored)

Pre-staged schema barrel `packages/db/src/schema/index.ts` now has
the CARDS + USERS sections uncommented; the COLLECTIONS / GRADING /
PRICING sections remain commented out for the next iteration to
fill in.

## Iteration 2 candidates (4 ready, MAX_PARALLEL=3)

| Task | Depends-on | Stub? | Effort |
|---|---|---|---|
| T-DL-SCHEMA-COLLECTIONS | CARDS, USERS | no | M |
| T-DL-SCHEMA-GRADING | USERS | yes | S |
| T-DL-SCHEMA-PRICING | CARDS | yes | S |
| T-DL-SOURCE-INTERFACES | CARDS | no | M |

Plan: dispatch COLLECTIONS, SOURCE-INTERFACES, and GRADING (smallest
stub, easy to elaborate). Hold PRICING until a slot frees — both
PRICING and GRADING are stubs flagged `scaffolded, gated` in the
task graph, so they are intentionally narrow scope.

## Phase 1 ledger so far

| Task | Status | PR |
|---|---|---|
| T-DL-SCHEMA-USERS | merged | #15 (`e9b4f38`) |
| T-DL-SCHEMA-CARDS | merged | #16 (`24b0fd4`, includes `b5af7f7` renumber) |
| T-DL-SCHEMA-COLLECTIONS | merged | #17 (`c131903`) |
| T-DL-SOURCE-INTERFACES | in_progress | — |
| T-DL-SCHEMA-GRADING | in_progress | — |
| T-DL-SCHEMA-PRICING | queued | — |
| T-DL-RLS-POLICIES | blocked (waits on GRADING; scope shrunk: 5 collection tables already RLS'd) | — |
| T-DL-SOURCE-* (4 adapters) | blocked (waits on SOURCE-INTERFACES) | — |
| ... 24 more pending Phase 1 tasks | pending | — |

Post-merge migration sequence on main:

  0000_user_tables / 0001_users_rls / 0002_catalog_tables / 0003_catalog_rls / 0004_collection_tables / 0005_collections_rls

GRADING is in flight — its drizzle-kit will likely emit 0004/0005
inside its worktree (drizzle picks next-free relative to the worktree's
journal), conflicting with the now-on-main 0004/0005. The orchestrator
will renumber on merge using the iter-1 playbook (0004 -> 0006,
0005 -> 0007 for GRADING, with hand-merged snapshot).

## Phase 0 ledger (closed)

All 10 foundation tasks merged. See git log between `7b4529e`
(T-FN-DB-MIGRATIONS) and `7df9f12` (T-FN-MONOREPO) for the trail.

## Last 5 merges

- T-DL-SCHEMA-COLLECTIONS — `c131903` (5 tables + 0004/0005 migrations; NULLS NOT DISTINCT on collection_item; nested-table RLS via EXISTS; shareable slug-gated public-read)
- T-DL-SCHEMA-CARDS — `24b0fd4` (catalog tables + RLS; renumber 0002/0003; snapshot hand-merge)
- T-DL-SCHEMA-USERS — `e9b4f38` (profile + subscription; cross-schema FK to auth.users; user-side RLS)
- T-FN-DB-MIGRATIONS — `7b4529e` (Drizzle ORM + migration tooling; pre-staged schema barrel)
- T-FN-ENV-CONVENTIONS — `cbd38f2` (73 vars / 11 sections / `docs/env.md` / `scripts/check-env.sh`)

## Known follow-ups (logged, non-blocking)

1. **`T-DL-DB-TEST-INFRA` (proposed)** — stand up vitest in
   `@binderly/db` so CARDS' AC-8 (fixture round-trip test) and
   COLLECTIONS' two deferred ACs can land. CARDS has 7/8 verified;
   COLLECTIONS has 8/10 verified. Fixture builders shipped in both
   PRs await a test runner before round-trip tests can execute.
1a. **Sandbox + drizzle-kit wrapper** — COLLECTIONS sub-agent had to
    invoke `pnpm exec drizzle-kit generate` directly because `tsx`
    cannot create its IPC pipe under the Cursor sandbox (the wrapper
    `pnpm db:generate` is a tsx script). SQL output is identical and
    convention checks would have passed by inspection; future db
    sub-agents may need the same workaround until the wrapper is
    rewritten in plain Node or the sandbox grants IPC access.
2. **One-shot snapshot regen** — Pablo can run
   `pnpm install && pnpm --filter @binderly/db db:generate` to confirm
   drizzle-kit produces a no-op diff against the hand-merged
   `meta/0002_snapshot.json`. Not gating; the runtime path
   (`db:migrate`) doesn't read the snapshot.
3. **`db:migrate` UX wart** — `migrate.ts` errors hard if
   `meta/_journal.json` is missing entries instead of skipping
   gracefully. Tracked from T-FN-DB-MIGRATIONS handoff.
4. **Dependabot backlog** — ~9 open PRs from when CI landed.
   Triage when convenient.

## Verification protocol

For runtime ACs that need Docker socket access, the orchestrator
hands Pablo a paste-able one-liner and merges on his thumbs-up.
Static-only ACs are verified in foreground via the diff inspector
or by sub-agents inside their worktrees.

## Notes

This file is updated by the orchestrator agent at the end of every
dispatch loop iteration. Do not edit by hand.
