# T-DP-MONITORING — Sentry + PostHog wiring across web/mobile/python

**Stage:** 11-deployment
**Agent role:** devops
**Effort:** M
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
> 1. Read `PROJECT.md` (especially § 4 (Infra & Deployment), § 17 (Build Phases)) and any
>    referenced sections.
> 2. Read `rules/11-deployment.md` (the stage rules).
> 3. Read every context file referenced by the stage rules.
> 4. Read the merged code from each `depends_on` task — the actual
>    diffs that landed, not just their task files. Reality may have
>    diverged from the original plan; align this task with what
>    actually exists.
> 5. If the work needs additional sub-tasks not in
>    `dependencies.yaml`, add them as additional stub entries (in the
>    same docs commit) before dispatching this one.
> 6. Rewrite this file using the full template. Replace the entire
>    "STUB" section above with the elaborated task. Keep the
>    metadata at the top (Stage, Agent role, Effort) accurate.
> 7. **Acceptance criteria must be testable.** If you cannot write
>    testable criteria, the task is too big — split it.
> 8. Commit as `docs(tasks): elaborate T-DP-MONITORING`.
> 9. Then dispatch the sub-agent.
>
> **Escalate instead of guessing if:**
>
> - A product decision is required (feature ambiguity, tradeoff between
>   two valid approaches, scope question).
> - The merged dependencies suggest the task as scoped is no longer
>   correct or necessary.
> - The work as scoped would require touching paths outside this
>   task's `owns_paths` and other tasks own them.
>
> Append to `open-questions.md` and skip this task in the iteration.

---

## Provisional metadata (from `dependencies.yaml`)

**Hard dependencies:**

- T-DP-VERCEL
- T-DP-FLY
- T-DP-EAS

**Parallel-safe with:** _(none)_

**Owns paths:**

- `packages/observability/`
- `apps/web/lib/observability/`
- `apps/mobile/src/lib/observability/`

## Provisional goal

Sentry + PostHog wiring across web/mobile/python.

(One paragraph from the orchestrator goes here at elaboration time
describing the problem this task solves and how it fits into the
stage.)

## Provisional reading list

- PROJECT.md § 4 (Infra & Deployment), § 17 (Build Phases)
- rules/11-deployment.md
- (context files added at elaboration time based on the stage rules)

## Branch & PR

- Branch: `agent/T-DP-MONITORING`
- PR title: `T-DP-MONITORING: Sentry + PostHog wiring across web/mobile/python`

## Notes from execution

Shipped as inert-until-secrets observability scaffolding (closes Stage 11
→ 6/6). Sentry + PostHog init seams wired per-app with injectable hooks
(no-op until a DSN/key is set AND the SDK initializer is injected at
go-live), so no provider SDK is a dependency yet (dependency-light per
brief):

- **Web** `apps/web/lib/observability/` (`initWebObservability`, mounted
  via `<ObservabilityInit/>` in the root layout) + `GET /api/health`
  liveness route.
- **Mobile** `apps/mobile/src/lib/observability/` (`initMobileObservability`,
  called from `app/_layout.tsx`).
- **Python** `apps/api-python/observability/` (`init_sentry`,
  lazy-imports `sentry-sdk` only at go-live; degrades to a no-op when the
  SDK is absent). Effective once the Q-021 HTTP entrypoint lands.
- **CI** `.github/workflows/deploy-monitoring.yml` — Sentry release
  tracking guarded on `SENTRY_AUTH_TOKEN` (skipped, not failed, when
  absent; mirrors deploy-web/fly/db/mobile).
- **Docs** `infra/monitoring/README.md` runbook +
  `infra/DEPLOYMENT_SECRETS.md` §6 + per-app `.env.example` monitoring
  blocks.

No DB migrations. Raised **Q-025** (production deep-health-check + pager
is scaffolded but not operational) → **#FU-63** (T-DP-HEALTH-CHECK).
Python error ingestion stays gated on Q-021 / #FU-53.
