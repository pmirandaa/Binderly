# T-DL-DATA-CONFLICT-TABLE — data_conflict table + resolver write path (admin debug surface)

**Stage:** 01-data-layer
**Agent role:** data
**Effort:** S
**Status:** STUB — must be elaborated by the orchestrator before dispatch.

---

> ## STUB — Orchestrator instructions
>
> This task file is intentionally incomplete. The orchestrator agent
> elaborates it into a full task per the template in
> `AGENT_ORCHESTRATOR.md` § 7 (Full task template) **at the moment all
> hard dependencies have merged AND this task is in the next batch to
> dispatch**.
>
> **Steps to elaborate:**
>
> 1. Read `PROJECT.md` § 6 (Data Model) and § 7 (Sources) for the
>    "conflicts are surfaced, not silenced" posture and the
>    `data_conflict` table sketch in `context/data-model.md`.
> 2. Read `rules/01-data-layer.md` (the "Conflicts are surfaced, not
>    silenced" hard rule).
> 3. Read the merged resolver code (`data-pipeline/src/resolver/resolver.ts`,
>    `data-pipeline/src/jobs/seed/resolve-and-classify.ts`) to confirm
>    the in-memory `DataConflict` shape that's already being emitted —
>    today only counted in the seed-run report; this task persists the
>    rows.
> 4. Read the canonical RLS migration patterns
>    (`packages/db/src/migrations/0009_pricing_rls.sql`,
>    `0011_image_provenance_rls.sql`, `0012_profile_grants_fix.sql`)
>    plus the precedent for service-role-only tables
>    (`grading_training_sample`, `price_observation`) in
>    `packages/db/scripts/verify-rls/inventory.ts` (the
>    `NO_PERMISSIVE_POLICY_TABLES` list).
> 5. Read the `ConflictLogRepo` precedent in the pricing pipeline
>    (`data-pipeline/src/jobs/pricing-rollup.ts` and the in-memory
>    aggregate writer in its tests) for the repo + in-memory shim
>    shape.
> 6. Rewrite this file against AGENT_ORCHESTRATOR.md § 7's full task
>    template (replace the STUB block with Hard / Soft dependencies,
>    Required reading, Goal, Deliverables, Acceptance criteria, Out of
>    scope, Branch & PR, Escalation triggers, Notes from execution).
> 7. Commit the elaboration as a single docs commit on `main`.

## Why this task exists

The resolver already detects per-source conflicts (validation tier
disagreeing with the primary on a field) and surfaces them in-memory
as `DataConflict` records — today the seed-run report only tallies
them as `resolverConflicts` per source (see SEED-INGEST report).
Without persistence, every conflict is lost the moment the run ends:
ops can't audit, can't dispute, can't manually override.

This task adds the `data_conflict` table the resolver was always
meant to write to (`PROJECT.md` § 6 / § 7; `rules/01-data-layer.md`
"conflicts are surfaced, not silenced"; `context/data-model.md`
§ data_conflict). It plumbs the already-emitted in-memory
`DataConflict` records through a `ConflictLogRepo` (Drizzle + in-memory
shim, mirroring the pricing repos) into a service-role-only,
admin-debug-grade table whose `(entity_kind, entity_canonical_key,
field_name)` UNIQUE makes re-runs idempotent (bumps `dispute_count`
instead of duplicating). It is a precondition for the iter-11
admin-debug-surfaces follow-up that exposes "top conflicts" + a
manual-override workflow to admins.

## Dependencies (from `dependencies.yaml`)

- **depends_on:** T-DL-RLS-POLICIES, T-DL-SOURCE-INTERFACES
- **parallel_safe_with:** T-DL-PROFILE-GRANTS-FIX, T-DL-ADMIN-DEBUG-SURFACES
- **provides:** table:data_conflict
- **owns_paths:** packages/db/src/schema/data_conflict.ts,
  data-pipeline/src/resolver/conflict-log.ts
