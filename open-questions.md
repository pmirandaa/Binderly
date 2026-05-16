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

**Pablo's answer:** this is solved

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

## Q-009 — `(tabs)/browse` placeholder collides with T-W-BROWSE's `app/browse/` route

**Raised:** 2026-05-15
**Blocking:** T-W-BROWSE

**Context:** T-W-SHELL (PR merged at iter-14) created placeholder
pages at `apps/web/app/(tabs)/browse/page.tsx`,
`(tabs)/collection/page.tsx`, `(tabs)/scanner/page.tsx`, and
`(tabs)/profile/page.tsx`, plus a sibling
`apps/web/app/(tabs)/tabs.test.tsx` that imports each. The
`(tabs)` route group does not add a URL segment in Next.js App
Router — `(tabs)/browse/page.tsx` resolves to `/browse`.

T-W-BROWSE's authoritative `owns_paths` (per `dependencies.yaml`)
is `apps/web/app/browse/`, `apps/web/app/sets/`,
`apps/web/app/cards/`. Creating
`apps/web/app/browse/page.tsx` triggers a Next.js
"You cannot have two parallel pages that resolve to the same
path" build error because both `app/browse/page.tsx` and
`app/(tabs)/browse/page.tsx` map to `/browse`.

The shell appears to have anticipated a tab-navigation layout
under `(tabs)/layout.tsx` that was never built — none of the
four placeholder folders has a layout, and there's no
shared-nav component. The placeholders exist solely so
`(tabs)/tabs.test.tsx` has something to import.

**Options:**

1. **Delete `(tabs)/browse/page.tsx` and update
   `(tabs)/tabs.test.tsx` to drop the browse test.** Land the
   real `/browse` implementation under
   `apps/web/app/browse/page.tsx` per the
   T-W-BROWSE `owns_paths`. The other three `(tabs)/*`
   placeholders stay untouched until their feature tasks land
   (T-W-COLLECTION, T-W-AUTH/profile, scanner is mobile-only).
   This is the minimal-blast-radius option.
2. **Move the real implementation under
   `(tabs)/browse/page.tsx`.** Cleaner long-term if a real tab
   layout lands later, but it edits paths outside T-W-BROWSE's
   `owns_paths` and effectively redirects the whole task into
   `(tabs)/`, which the brief did not authorize. Also moves
   set / card routes (`(tabs)/sets/[id]`,
   `(tabs)/cards/[id]`) to mirror.
3. **Keep both pages and special-case the conflict** — not an
   option: Next.js refuses to compile.

**Recommendation:** Option 1, executed inside this PR. The
delete-and-update is a pure follow-up to a shell drift bug
(empty placeholder + no tab layout) and the only path that
both ships T-W-BROWSE at its declared `owns_paths` and
preserves the build. Documented prominently in the PR body so
the orchestrator can rescope T-W-COLLECTION /
T-W-PROFILE / etc. when those tasks dispatch.

**Pablo's answer:** _(empty until answered — proceeding with
recommendation in this PR; revert is one-line if rejected)_

---

## Q-010 — `mv_user_set_completion` materialized view (T-M-COLLECTION)

**Asked by:** T-M-COLLECTION sub-agent
**Asked at:** 2026-05-15
**Status:** Open — flagged for T-BE-EDGE-FUNCTIONS

PROJECT.md § 8 promises a materialized view (`mv_user_set_completion`) keyed by
`(user_id, set_id)` that the per-set completion rows would read from. The
recompute job (T-SP-SET-COMPLETION) is merged but the read endpoint is still a
stub — `T-BE-EDGE-FUNCTIONS` hasn't shipped. The `@binderly/api-client`
`collection` resource only exposes `listCollectionItems` (the raw owned-printings
list) and `getCollectionStats` is not yet wired.

**What I did instead (in this PR):**

- The home `CollectionScreen` walks `/v1/me/collection`, fans out
  `getPrinting(id)` per owned printing to enrich with `setId / cardId /
  includeInMasterSet`, and computes Set % on-device using `set.total` as the
  denominator and the count of distinct owned cards per set as the numerator.
- Master % on the home row is intentionally left at 0 with an "Open set to
  compute" affordance — the precise denominator requires the *full* per-set
  printing roster, which would fan out to hundreds of network calls per home
  render. The drill-down (`CollectionSetScreen`) loads that roster once per set
  visited and shows precise Set / Master percentages via
  `@binderly/set-completion`.
- All Pokémon % is the global aggregate (sum of unique-cards-owned across all
  sets / sum of `set.total` across all sets).

**What needs to happen later:**

When `mv_user_set_completion` ships:

1. The home screen should switch to reading the materialized view directly (one
   query, no fan-out) for both Set % and Master %.
2. `useOwnedPrintingsContextQuery` becomes the *fallback* / offline-cache path
   instead of the primary data source.
3. The drill-down's per-set computation can stay as-is — having the full roster
   on hand is useful for the "Missing" tab anyway.

**Pablo's answer:** _(empty — proceeding with on-device computation per partial
roster; documented prominently in the PR body so the orchestrator can rescope
when T-BE-EDGE-FUNCTIONS dispatches)_

---

_(no other open questions yet)_
