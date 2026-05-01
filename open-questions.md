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

---

_(no other open questions yet)_
