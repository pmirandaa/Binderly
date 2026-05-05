# T-DL-ADMIN-DEBUG-SURFACES — Admin debug views (pg_stat_statements + catalog audit views)

**Stage:** 01-data-layer
**Agent role:** backend
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
>    "audit + observability" posture, plus `context/data-model.md`
>    § data_conflict / § RLS policies for the admin role expectations.
> 2. Read `rules/01-data-layer.md` (especially the
>    "conflicts are surfaced, not silenced" rule that motivates these
>    views).
> 3. Read the merged catalog tables (`packages/db/src/schema/`) and
>    the merged `data_conflict` table (T-DL-DATA-CONFLICT-TABLE) to
>    pick the columns + grouping each view exposes.
> 4. Read the existing RLS migration patterns
>    (`packages/db/src/migrations/0009_pricing_rls.sql`,
>    `0011_image_provenance_rls.sql`, `0013_mv_current_price.sql`)
>    for the `REVOKE ALL FROM PUBLIC` + `GRANT SELECT TO admin/
>    service_role` posture views need.
> 5. Confirm whether an `admin` Postgres role exists in the local
>    Supabase (`SELECT rolname FROM pg_roles`); if not, default to
>    `service_role` only and surface an open question for Pablo
>    about provisioning an `admin` role for read-only debug access.
> 6. Decide which `pg_stat_statements`-based view(s) are worth
>    shipping vs. pure catalog-audit views; size to S effort.
>    Suggested starting set:
>    - `v_data_conflict_top` (top N conflicts by `dispute_count`).
>    - `v_data_conflict_by_source` (per-source conflict counts).
>    - `v_image_pipeline_failures` (printing_image transcode
>      failures over time — joins onto `printing_image` once
>      that surface lands).
>    - `v_fx_rate_freshness` (rows-per-source-per-day window of
>      `fx_rate` to surface stale FX inputs).
>    - `v_pg_stat_statements_top_queries` (top queries by
>      total time; gated to admin/service_role only).
> 7. Rewrite this file against AGENT_ORCHESTRATOR.md § 7's full task
>    template.
> 8. Commit the elaboration as a single docs commit on `main`.

## Why this task exists

The data-pipeline ingests data from multiple sources, runs a resolver
that surfaces conflicts, transcodes images, and rolls up pricing.
Each stage has its own failure modes (FX rate gone stale; image
transcode failing on a given source; resolver disagreement spiking on
a particular field). Today there's no canonical Postgres surface that
exposes these signals to a human auditor.

This task ships a small set of read-only `v_*` views (catalog audit +
`pg_stat_statements` summaries) gated to `service_role` (and an
`admin` role if one exists) so an operator can query directly without
having to write ad-hoc joins each time. It pairs naturally with
T-DL-DATA-CONFLICT-TABLE — the persisted `data_conflict` rows are
the headline thing the views surface — and lays the groundwork for
the eventual admin web UI.

## Dependencies (from `dependencies.yaml`)

- **depends_on:** T-DL-RLS-POLICIES
- **parallel_safe_with:** T-DL-PROFILE-GRANTS-FIX, T-DL-DATA-CONFLICT-TABLE
- **provides:** debug:admin-surfaces
- **owns_paths:** packages/db/src/migrations/, packages/db/src/views/
