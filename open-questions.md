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

## ~~Q-008 (CLOSED) — "All Pokémon %" granularity: per-card vs per-species~~

**Status:** ~~CLOSED — ratified at merge time of PR #55 as per-card.~~

**Raised by:** T-SP-SET-COMPLETION worker (PR #55) when implementing
the third completion percentage (after Set % and Master %).

**Conflict observed:** The dispatch brief described the metric as
"percentage of distinct Pokémon species the user owns at least one
printing of." But `PROJECT.md § 8` and the
`mv_user_global_completion.unique_cards_owned` column (merged in
Phase 1) describe and shape it as **per-card** ("percentage of all
known cards across all sets that the user owns at least one printing
of"). The worker followed the canonical source over the brief and
flagged the divergence as Q-008.

**Resolution (orchestrator, ratified at merge of PR #55):**
Per-card is the v1 semantic. The canonical source (`PROJECT.md` +
the materialized view column) is right; the dispatch brief was
loose. Per-card is also the most natural "you've seen N out of M"
metric for a card-collection app.

**Reversibility:** If we later want a per-species variant ("you
own at least one printing of each of 1025 Pokémon", which is a
different and arguably more interesting metric), it's a
single-file additive — a separate function on the
`@binderly/set-completion` package, no API breakage. The current
function signature could even keep its name and we'd add a
sibling `computeAllPokemonByPokedex()` (or similar).

---

## Q-016 — Should `printing_lite` cache `set.logo_url` for the CollectionScreen set-row renderer? (T-OF-LOCAL-DB)

**Raised:** 2026-05-20
**Blocking:** No — `printing_lite` ships without it; CollectionScreen renders fine without set logos on the offline path (falls back to a Tamagui-token-colored placeholder block).
**Owner of the decision:** T-OF-QUEUE worker (next iter), since they're the first downstream consumer of `printing_lite` and will know whether their full-catalog mirror plan would naturally bring set metadata along.

**Context:**

T-OF-LOCAL-DB ships `printing_lite` as a thin per-printing cache: name, set_id, set_name, card_number, image_url, rarity. The set_id + set_name are denormalised into the row to keep the offline read path single-table (no JOIN against a hypothetical `set_lite` table the worker chose not to ship).

The web + mobile CollectionScreens both group user collection items by set and show a small set-logo thumbnail next to the set name. The logo URL is currently fetched from the server at render time. On the offline path this would 404; the screen handles that gracefully with a placeholder block but it's a minor visual regression.

**Options:**

1. **Add `set_logo_url` to `printing_lite`** as a TEXT column via a v2 schema migration. Pro: minimal change; one ALTER TABLE; T-OF-QUEUE keeps populating set_logo_url alongside set_name when it sees a new set. Con: denormalisation cost (every printing row in the same set carries the same logo URL — small at user-collection scale, wasteful at full-catalog mirror scale).
2. **Add a separate `set_lite` table** (id, name, logo_url) and JOIN at read time. Pro: normalised; no per-row waste. Con: extra JOIN on every CollectionScreen render; adds a 3-row dependency to the offline schema.
3. **Punt to the next refresh cycle**: don't cache the logo at all; once T-OF-QUEUE ships background sync, set logos are always at most a few hours stale. CollectionScreen shows the placeholder on first cold start, then refreshes. Pro: zero schema change. Con: visible "popping" on cold start.

**Recommendation:** Option 1 if T-OF-QUEUE plans to mirror only user-relevant printings (the denormalisation cost is bounded by user collection size, ~thousand rows max). Option 2 if T-OF-QUEUE plans to mirror the full ~30 k production catalog (denormalisation cost ~30 k repeated URLs, which is wasteful). T-OF-QUEUE owner picks.

**Status: open; not blocking.** Resolves when T-OF-QUEUE makes the catalog-mirror-scope call.

---

_(no other open questions yet)_
