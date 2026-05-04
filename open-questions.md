# Open questions for Pablo

Append-only log. The orchestrator surfaces decisions here. Do not delete
resolved items — strike them through and link to the resolution commit/task.

## Format

```
## Q-NNN — <one-line summary>
**Raised:** <date>
**Blocking:** T-XX-XXX, T-XX-YYY
**Context:** <a few paragraphs>
**Options:**
1. <option A> — pros/cons
2. <option B> — pros/cons
**Recommendation:** <orchestrator's pick + why>
**Pablo's answer:** _(empty until answered)_
```

---

## Q-001 — `gh` CLI auth is invalid; remote default branch still `master`

**Raised:** 2026-04-30
**Blocking:** Sub-agent PR creation (every Phase 0 task after T-FN-MONOREPO),
the GitHub default-branch swap.

**Context:** During Phase 0 bootstrap, the orchestrator renamed the local
branch `master` → `main` and pushed `main` to origin. Two follow-ups
need GitHub-side permissions the sandbox can't perform:

1. The repo's **default branch on GitHub** is still `master`. Sub-agent
   PRs will default to base `master` unless explicitly told `--base main`.
2. The `master` branch can't be deleted on origin until the default
   branch is changed.

`gh auth status` reports: *"The token in keyring is invalid."*

**Options:**

1. **Pablo re-authenticates `gh`** (`gh auth login -h github.com`) in his
   terminal, then the orchestrator runs:
   ```
   gh repo edit pmirandaa/Binderly --default-branch main
   git push origin --delete master
   ```
   — Pros: single ~30s human step, unblocks automated PR creation for
   the entire build. Recommended.
2. **Pablo manually changes the default branch** in the GitHub UI
   (Settings → Branches → switch to `main`, then delete `master`).
   Sub-agents still can't open PRs without `gh` auth, so Pablo would
   also need to manually open every agent PR, or re-auth `gh` later.
3. **Pablo opens every sub-agent PR manually** from the URLs printed
   when sub-agents push their branches. — Pros: zero auth surface for
   the agent. Cons: a few clicks per task × ~109 tasks; tedious.

**Recommendation:** Option 1. The orchestrator will continue dispatching
sub-agents who *push* their branches and print the GitHub
"Create a pull request for `agent/<task-id>`" URL in their completion
summary. Pablo opens those PRs manually until `gh` is re-authed; after
that, sub-agents will use `gh pr create --base main` automatically.

**Pablo's answer:** done with option 1, auth should work

**Orchestrator follow-up (2026-04-30, post-T-FN-CI):** still broken.
`gh auth status` returns:
```
github.com
  X Failed to log in to github.com account pmirandaa (keyring)
  - Active account: true
  - The token in keyring is invalid.
```
Pablo: please re-run `gh auth login -h github.com` (HTTPS, paste a
fresh PAT with `repo` + `workflow` + `admin:public_key` scopes, or
the device-code flow). The orchestrator will run the default-branch
swap + master deletion + `gh pr create` automation as soon as
`gh auth status` returns clean. Until then, the manual
"open this URL to create a PR" loop continues; all 6 merged Phase-0
PRs were opened that way and it's working.

**RESOLVED 2026-04-30 (post-Q-001 re-auth round 2):**
`gh auth status` clean — token `gho_…`, scopes `gist, read:org, repo,
workflow`. Orchestrator executed the cleanup actions:
- `gh repo edit pmirandaa/Binderly --default-branch main` ✓
- `git ls-remote --heads origin` confirms no `master` ref (already
  gone — likely cleared during the GH-side default-branch swap).
- `git push origin --delete agent/T-FN-CI` ✓ (merged branch tidied).
Default branch verified `main` via `gh repo view --json
defaultBranchRef`. Future sub-agent dispatches will use
`gh pr create --base main` automatically.

---

## Q-002 — Docker Desktop daemon not running; T-FN-DOCKER blocked

**Raised:** 2026-04-30
**Blocking:** T-FN-DOCKER (and transitively T-FN-SUPABASE-LOCAL,
T-FN-DB-MIGRATIONS, T-FN-ENV-CONVENTIONS, all of Phase 1).

**Context:** The T-FN-DOCKER sub-agent ran its mandatory pre-flight
(`docker info`) and the daemon refused: *"Cannot connect to the Docker
daemon at unix:///Users/pmiranda/.docker/run/docker.sock"*. The Docker
CLI is installed (v28.3.3, context `desktop-linux`, darwin/arm64), but
Docker Desktop itself isn't running. Per the task's escalation rule the
sub-agent stopped immediately without modifying any files. The worktree
`../binderly-wt-T-FN-DOCKER` and branch `agent/T-FN-DOCKER` are clean
and ready for re-dispatch.

**Options:**

1. **Pablo starts Docker Desktop**, waits for the whale icon to go
   solid, and tells the orchestrator. The orchestrator re-dispatches
   T-FN-DOCKER into the existing clean worktree. Recommended — the
   sub-agent reported it can resume from step 2 with no setup overhead.
2. Skip Docker for now and unblock the chain via a non-Docker Postgres
   (Homebrew). Not recommended — the spec explicitly mandates Docker
   Compose for local-first, zero-cloud-account contributing, and many
   later tasks (image pipeline, MinIO bucket validations) hard-depend
   on the MinIO service.

**Recommendation:** Option 1. T-FN-DOCKER stays in `dependencies.yaml`
with `status: blocked`, `blocked_on: Q-002`. Other Phase 0 tasks
continue dispatching in parallel; Phase 1 will block on this if it
isn't resolved by the time the iteration-3/4 dispatch wants
T-FN-SUPABASE-LOCAL.

**Pablo's answer:** _(empty until answered)_

**Diagnostic round 1 (2026-04-30, end-of-day):**
A diagnostic sub-agent identified the root cause as stale
`Docker Desktop` Electron zombies from a SIGKILL'd Apr-29 session
(`[com.docker.backend] wait status: 9` in `supervisor.log`).
`com.docker.backend` detects the leftover PIDs on every launch and
silently spawns an invisible `--name=error-dialog` Electron
(`suppressMacOSDockIcon: true`, 600x500, alwaysOnTop) instead of the
real GUI — explaining the bounce-and-die. Ruled out: code-signing
(`spctl: accepted, source=Notarized Developer ID`), quarantine
(no `com.apple.quarantine` xattr), settings/VM state corruption.
Docker Desktop 4.45.0 (build 203075), macOS 15.5 (24F74),
MacBook Pro M1 Pro, 49 GB free.

Sub-agent killed `com.docker.backend` + all leftover Docker
Electrons; left `/Library/PrivilegedHelperTools/com.docker.vmnetd`
running (harmless system LaunchDaemon). Pablo then ran the
recommended `pkill` chain + `open -a Docker` and **it still didn't
work**. Diagnostic files left in `/tmp/docker-bounce-trace.log` +
`/tmp/docker-bounce-trace.pid` for the next session.

**Recommended next step (next session):**
1. Reboot the Mac. launchd will not respawn the zombie Electrons,
   guaranteeing a clean process tree. This is the safest "did the
   pkill miss something?" hammer before anything destructive.
2. After reboot, `pgrep -lf -i docker` should show only
   `com.docker.vmnetd`. Then `open -a Docker`.
3. If it STILL bounces post-reboot: re-tail
   `~/Library/Containers/com.docker.docker/Data/log/host/monitor.log`
   immediately after the bounce and paste the `[main.bugsnag]
   notifying bugsnag: [starting]` line. If pids of the form
   "* pid <N>: Docker Desktop" reappear, something is auto-launching
   them — check Login Items (System Settings → General → Login Items)
   for stray Docker entries.
4. If still broken: try Docker Desktop's built-in factory reset from
   the GUI (which we can't reach right now, so this requires a
   working app first), OR reinstall Docker Desktop 4.45.0 from
   docker.com (clean download — current bundle on disk is
   `/Applications/Docker.app`, intact and signed).

T-FN-DOCKER stays `blocked`. The dispatch loop is parked.

**~~RESOLVED 2026-05-04: Docker Desktop is up.~~**
`docker info` returns `28.3.3 | linux/aarch64 | 8 GB`.
T-FN-DOCKER respawned into a fresh worktree
(`../binderly-wt-T-FN-DOCKER` from current `main`) and dispatched.
T-FN-DOCKER moved from `blocked` to `in_progress`; `blocked_on`
field removed in dependencies.yaml.

---

## Q-003 — `0001_users_rls.sql` ships RLS without companion SQL grants

**Raised:** 2026-05-04
**Blocking:** none directly (verify-rls reports 4 failures against local
Supabase, all pointing at the same posture gap; PR
T-DL-RLS-POLICIES merges with the failures documented). Future work
that exercises `profile` / `subscription` against PostgREST locally
(notably T-BE-AUTH and any web-app surface) will hit the same
"permission denied for table profile" until this is resolved.

**Context:** The new `pnpm --filter @binderly/db verify-rls` script
(shipped in T-DL-RLS-POLICIES) drives every catalog table through the
documented RLS posture. It surfaced a real gap in
`0001_users_rls.sql` — that migration authors RLS policies for
`profile` and `subscription` but does **not** ship explicit
`REVOKE` / `GRANT` statements. Migrations `0003_catalog_rls.sql`,
`0005_collections_rls.sql`, `0007_grading_rls.sql`, and
`0009_pricing_rls.sql` all ship the defense-in-depth grants pattern;
`0001` is the outlier.

In hosted Supabase, the platform runs
`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,
authenticated, service_role` before migrations, so new tables get the
grants for free. In Supabase CLI 2.98.1 + PG17 locally,
`pg_default_acl` for the `public` schema is empty, so `profile` ends
up with no privileges for the three application roles. PostgREST
checks privileges before RLS, so the policies never fire — every
SELECT against `profile` from any non-superuser role fails with
"permission denied for table profile".

This is exactly the kind of finding the verify-rls script was designed
to catch. Per the task's escalation hook ("STOP, surface to
orchestrator with full repro; do NOT silently patch the existing
migration"), the merged migration is **not** modified by
T-DL-RLS-POLICIES; the finding is documented in the README and surfaced
here for ratification.

**Reproduction:**

```sh
# from /Users/pmiranda/Stuff/Binderly (or any branch with 0001 applied)
SUPABASE_DB_URL=postgresql://postgres:postgres@localhost:54322/postgres \
  pnpm --filter @binderly/db verify-rls
# 93 passed, 4 failed — all four "permission denied for table profile".
```

```sh
# Confirm the privilege snapshot directly:
psql postgresql://postgres:postgres@localhost:54322/postgres \
  -c "SELECT grantee, privilege_type FROM information_schema.role_table_grants
      WHERE table_schema='public' AND table_name='profile';"
# returns ONLY postgres rows — no anon / authenticated / service_role.

psql postgresql://postgres:postgres@localhost:54322/postgres \
  -c "SELECT grantee, privilege_type FROM information_schema.role_table_grants
      WHERE table_schema='public' AND table_name='set';"
# returns the expected anon/authenticated SELECT + service_role full DML
# (because 0003_catalog_rls.sql ships explicit GRANTs).
```

**Options:**

1. **Ship a corrective additive migration `0010_users_rls_grants_fix.sql`** that
   `REVOKE`s the unwanted writes on `profile` / `subscription` and
   `GRANT`s the per-policy minimum, mirroring the
   `0003_catalog_rls.sql` / `0005_collections_rls.sql` precedent for
   the same tables. Inert in hosted Supabase (the grants either match
   what's already there or are no-ops); fixes local. Recommended.
2. **Document the local-only quirk and leave the migration alone.**
   Argue that hosted Supabase's `ALTER DEFAULT PRIVILEGES` covers it
   and the local-only failure isn't worth a corrective migration. Not
   recommended — the verify-rls script will keep failing locally
   forever, and the asymmetry between 0001 and the other RLS
   migrations is a defense-in-depth gap regardless of platform.
3. **Re-author 0001 in place.** Rewrites `main`'s history; explicitly
   forbidden by the T-DL-RLS-POLICIES escalation rules. Not on the
   table.

**Recommendation:** Option 1. Add a new task **T-DL-PROFILE-GRANTS-FIX**
to `dependencies.yaml` (S effort), depending on T-DL-RLS-POLICIES.
Stage the migration, apply locally, watch verify-rls go to "97
passed, 0 failed". The web/edge-function tasks downstream that touch
`profile` will rely on this being fixed locally before they can
exercise PostgREST against profile.

**Pablo's answer:** _(empty until answered)_

---

## Q-004 — `@binderly/db` package.json was missing `main`/`types`/`exports`

**Raised:** 2026-05-04 (T-DL-SEED-INGEST)
**Blocking:** Any package that imports `@binderly/db` from non-test
source files (e.g. `data-pipeline/src/jobs/seed/db-upsert.ts`).

**Context:** The `@binderly/db` package was missing `main`, `types`,
and `exports` fields in its `package.json`. Existing consumers got
away with this because every prior import of `@binderly/db` lived in
a `*.test.ts` file (e.g. `data-pipeline/src/types.alignment.test.ts`),
which is excluded from `tsc -p . --noEmit` via the `exclude` glob.
Vitest's resolver (Vite-based) doesn't need the fields. As soon as
T-DL-SEED-INGEST landed non-test imports
(`data-pipeline/src/jobs/seed/db-upsert.ts`,
`data-pipeline/src/jobs/seed/image-dedup.ts`,
`data-pipeline/src/jobs/seed.ts`), `pnpm typecheck` started
failing with `TS2307: Cannot find module '@binderly/db'`.

**Resolution:** Added the three fields pointing to the package's
`dist/src/index.{js,d.ts}` artefacts, which are produced by the
existing `pnpm --filter @binderly/db build` script. Verified
`@binderly/db`'s typecheck/lint/format:check are still clean.

This is a deviation from the `T-DL-SEED-INGEST` `owns_paths`. The
fix is one-shot, additive, and unblocks every future package that
will need `@binderly/db` (Edge Functions, the future pricing job,
backfill scripts). Documented here so the orchestrator can fold
the deviation into the merge review without surprise.

**Pablo's answer:** _(no answer needed — orchestrator approved as
unblocking deviation in the PR review)_

---

_(no other open questions yet)_
