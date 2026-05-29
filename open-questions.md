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

`gh auth status` reports: _"The token in keyring is invalid."_

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
sub-agents who _push_ their branches and print the GitHub
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
(`docker info`) and the daemon refused: _"Cannot connect to the Docker
daemon at unix:///Users/pmiranda/.docker/run/docker.sock"_. The Docker
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
   "\* pid <N>: Docker Desktop" reappear, something is auto-launching
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

**Pablo's answer:** option 1 is ok, good choice

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
  compute" affordance — the precise denominator requires the _full_ per-set
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
2. `useOwnedPrintingsContextQuery` becomes the _fallback_ / offline-cache path
   instead of the primary data source.
3. The drill-down's per-set computation can stay as-is — having the full roster
   on hand is useful for the "Missing" tab anyway.

**Pablo's answer:** your approach is fine, just make sure to use the materialized view when the endpoint becomes available

---

## Q-011 — Exact TCGplayer affiliate URL format unconfirmed

**Raised:** 2026-05-15
**Blocking:** _(none — `<BuyCta>` shipped with a documented placeholder)_
**Related follow-up:** #FU-24

**Context:** T-W-AFFILIATE-LINKS ships a `<BuyCta>` component (web + mobile)
that builds TCGplayer affiliate search URLs of the form:

```
https://tcgplayer.com/search/pokemon/product?productLineName=pokemon
  &q=<name> <number> <set name>
  &utm_source=binderly
  &utm_medium=affiliate
  &utm_campaign=binderly-buy-cta
  &utm_id=<NEXT_PUBLIC_TCGPLAYER_AFFILIATE_ID>
```

The brief explicitly told us to ship a documented placeholder if we
couldn't verify the wire format against Impact's partner docs. We
have not signed up for TCGplayer's affiliate program (via Impact) yet,
so the URL above is a best-effort approximation:

1. TCGplayer's storefront URL templates use both `search/pokemon/product`
   and `search/all/product?productLineName=pokemon` in the wild — both
   load card-search pages but the canonical "affiliate-friendly" path
   isn't pinned anywhere we could find.
2. Impact's standard tracking param is `clickref=<id>` or `irclickid=<id>`.
   TCGplayer in particular has historically used `partner=<vendor>` on
   their consumer storefront. The `utm_id` we ship will not break the
   redirect, but it may not be what Impact's dashboard listens to.

**Options:**

1. **Sign up for the TCGplayer affiliate program once Pablo has the
   business entity ready; receive the exact wire format + tracking
   param spec from Impact; update both `apps/web/lib/affiliate/tcgplayer.ts`
   and `apps/mobile/src/components/buy-cta/tcgplayer.ts` in lockstep.**
   Tracked as #FU-24. Pros: the only path that guarantees attribution
   is recorded server-side. Recommended.
2. Ship the placeholder URL and trust that TCGplayer's frontend hashes
   our `utm_id` into something Impact can correlate later. Pros: zero
   work now. Cons: silent revenue loss if attribution doesn't land.

**Recommendation:** Option 1 — but #FU-24 is non-blocking for this
PR. The "Coming soon" degraded path is the production default until
an affiliate id lands in the environment, so users see the same
"button disabled" UX they did before this PR until we have a real id.
The URL template change, when it lands, is a 5-line edit in two
files + a test update.

**Pablo's answer:** leave placeholder, I'll look into this later

---

## Q-012 — Public shareable read endpoint not implemented; richer payload needed (T-W-SHAREABLE-PUBLIC)

**Raised:** 2026-05-15
**Blocking:** None as of this PR — page scaffold compiles & ships with
the existing client surface and a degraded runtime adapter. Blocks the
end-to-end "logged-out user sees a real collection snapshot" UX.
**Status:** Open — flagged for the backend track (likely a follow-up
to T-BE-EDGE-FUNCTIONS).

**Context:**

`@binderly/api-client` exposes `shareables.getPublicShareable({handle, slug})`
which `POST /v1/c/{handle}/{slug}` (`anonymous: true`, returns
`shareableDto`). The contract is wired client-side, but:

1. **The route is not implemented in the Edge Function.** The dispatch
   table at `infra/supabase/functions/_shared/routes-table.ts` carries
   no `/c/...` entry — every entry is `/me/...`. Calling
   `getPublicShareable` against the live function would 404 today.
2. **`shareableDto` is metadata only.** It contains
   `{ id, userId, slug, target, theme, show*, timestamps }` — no
   owner handle, no display name, no collection name, no member
   list, no ownership counts. The SSR page needs at minimum:
   - owner `{ handle, displayName, avatarUrl?, bio? }`
   - human title for the collection (custom name or "Full collection")
   - counts: `{ ownedUnique, catalogTotal, masterPct? }`
   - member list: `[{ printingId, cardId, cardName, setName, setCode, imageUrl }]`
   The data layer in this PR (`apps/web/lib/share/api.ts`) defines a
   `PublicSharePayload` type that captures that contract. Tests use a
   fake adapter that returns a fully populated payload; the runtime
   adapter calls `getPublicShareable` and synthesises a degraded
   payload (metadata + URL-derived handle + empty members + zero
   counts) so production renders the page header without crashing.

**What this PR does:**

- Builds the page (`/c/[handle]/[slug]`) and OG image route
  (`/c/[handle]/[slug]/opengraph-image`) against `ShareApi` —
  injectable, props-pattern — so tests exercise the full surface
  without the backend.
- Defines `PublicSharePayload` as the contract we expect the
  backend to return; the runtime adapter fills as much of it as
  the current client surface allows. The data layer is the seam
  the backend follow-up edits.
- Ships SSR meta tags + an OG image that renders correctly when
  the payload is populated (test-injected).

**Options for the backend follow-up:**

1. **Add a single `GET /v1/c/{handle}/{slug}` Edge route** that
   returns `{ shareable, owner, collectionTitle, counts, members }`
   in one anonymous payload. The client surface already calls
   this URL; the response shape would be a NEW `publicShareableDto`
   in `@binderly/api-contracts` (the existing `getPublicShareable`
   returns `shareableDto` only — promote it to the richer shape, or
   add a sibling method that returns the richer shape). Lowest
   client churn; one round-trip; the SSR page reads exactly what
   it renders.
2. **Two endpoints.** One returns `shareableDto` (as today), the
   other returns the member list paginated. Lets the OG image and
   header render before the member grid streams in — but adds a
   client round-trip and the public page is intentionally simple
   so this complexity isn't earning anything yet.
3. **Compose from existing primitives.** Add anonymous-readable
   variants of `/v1/me/collection` and `/v1/me/profile` gated by a
   "shareable token" header. Reuses the existing handlers — but
   the RLS rewrite is deep and the SSR page would have to fan out
   3+ requests on the hot path. Worst option.

**Recommendation:** Option 1. The contract change is additive
(`publicShareableDto` is new) and the client surface already
expects an anonymous round-trip at this URL. The Edge handler
joins `shareable` ↔ `profile` ↔ `collection_item` (and
optionally `custom_collection`) once and returns one envelope.
The web data layer in this PR drops in unchanged — only the
runtime adapter swaps the degraded synthesis for a direct
`getPublicShareablePayload(...)` call.

**Pablo's answer:** go with option 1

**Status:** ~~Open~~ **CLOSED — 2026-05-19** by
T-BE-EDGE-FUNCTIONS-V2. Option 1 shipped:

- Added `GET /v1/c/{handle}/{slug}` as an anonymous Edge route
  (`infra/supabase/functions/_shared/handlers/publicShareable.ts`)
  wired into `routes-table.ts`. Uses the service-role client to
  bypass RLS on `collection_item` while projecting only public
  columns (no `user_id`, `acquired_price`, `notes`, etc.).
- Added `publicShareableDto` to `@binderly/api-contracts`
  (`packages/api-contracts/src/shareables.ts`) plus
  `publicShareOwnerDto`, `publicShareMemberDto`, `publicShareCountsDto`
  — shape-for-shape match of `PublicSharePayload` in
  `apps/web/lib/share/api.ts` so the web adapter swap is mechanical.
- Added `shareables.getPublicShareablePayload(...)` to
  `@binderly/api-client` (`packages/api-client/src/resources/shareables.ts`).
  Single-URL coexistence with the existing `getPublicShareable` —
  the new method opts into the richer payload via an
  `Accept: application/vnd.binderly.share+json` header; the legacy
  method continues to receive the bare `shareableDto`.
- Tests: 16 handler tests
  (`infra/supabase/functions/_shared/handlers/publicShareable.test.ts`)
  cover both Accept-header branches, both target kinds (`full` and
  `custom`), the dedup / sum / display-name fallback rules, and the
  404 / 500 envelopes.

The web runtime adapter (`apps/web/lib/share/api.ts`) is unchanged
in this PR — swapping `apiToShareApi` to call
`getPublicShareablePayload` is a one-line frontend follow-up
tracked separately.

---

## Q-013 — T-BE-EDGE-FUNCTIONS-V2 divergences from the brief (deferred MVs + DSL → in-memory eval)

**Raised:** 2026-05-19
**Ratified:** 2026-05-20 by Pablo ("if all required pieces are
available, don't defer, do it now") → both divergences landed in
T-BE-Q013-CLEANUP at branch HEAD `f96649d` (worktree:
`agent/T-BE-Q013-CLEANUP`).
**Blocking:** None — the four endpoints ship behind correct contracts
and the divergences are bounded.
**Status:** CLOSED — both follow-ups (#FU-26 / T-DL-MV-COMPLETION
and #FU-27 / T-BE-SMART-PREVIEW-RPC) landed in T-BE-Q013-CLEANUP
(2026-05-20). See the elaborated task brief at
`tasks/02-backend/T-BE-Q013-CLEANUP.md` and the corresponding
migrations `packages/db/src/migrations/0018_mv_user_completion.sql`
and `packages/db/src/migrations/0019_smart_preview_rpc.sql`. The
completion handler now reads two MVs via wrapper views
(`v_my_set_completion` / `v_my_global_completion`) filtered by
`auth.uid()`; the smart-preview handler now calls
`smart_collection_preview(ast, p_user_id, p_limit, p_offset)`
which ports the DSL `expressionToSql()` compiler to PL/pgSQL.
Wire shapes (`completionDto`, `smartPreviewResponse`) are
unchanged; `collection.*` predicates are accepted in smart-preview
(contract widening, not a break).

**Context:**

Implementing T-BE-EDGE-FUNCTIONS-V2 surfaced two places where the
shipped handler diverges from the literal reading of the task brief.
Both decisions are documented inline in the handlers and the
elaborated task `.md`; logging them here so they aren't surprises in
the next iteration.

### 1. `GET /v1/me/collection/completion` reads tables, not MVs.

The brief named two materialized views — `mv_user_set_completion` and
`mv_user_global_completion` — as the data source. Neither view exists
in the migrations (`packages/db/src/migrations/`). They're promised
in `PROJECT.md` § 8 and referenced as "open" in Q-010 of this file,
but the actual DDL was never written.

Hard rule on this task: **no schema changes**. So the completion
handler computes the same numbers on the fly from canonical tables
(`collection_item`, `card`, `printing`, `set`) using a re-implementation
of `@binderly/set-completion`'s `computeCompletion()` (the Edge bundle
can't import the workspace package — the deno.jsonc import-map is
`npm:` only). Algorithm: one Map per (cardId → setId), one pass over
printings to tally per-set + global, one sort by `setName`. Complexity:
O(P + C + I) where I is the user's `collection_item` count.

At v1 catalog scale (~30k printings × ~25k cards × ~100 sets) this is
well under 100ms per call — fine for the home-screen render path. If
a future user crosses ~10k owned printings, or if the catalog grows
past ~100k printings, the right fix is one of:

1. Land the two MVs (a follow-up backend task with a hand-authored
   migration) and swap the handler to read them.
2. Cache the catalog projection per-process (TTL ~5 minutes) so the
   per-call query reads only the user's `collection_item` rows.
3. Move the computation into a Postgres function and call it via RPC.

Option (1) is the canonical fix; the others are escape hatches if (1)
is delayed.

### 2. `POST /v1/smart-collections/preview` evaluates the AST in memory.

The brief named `@binderly/smart-collection-dsl`'s `compileToSql()` (the
function is actually `expressionToSql()` — name drift) as the
compilation step. Two impediments to using it directly:

- The Edge bundle can't import the workspace package (same
  import-map constraint as above).
- The result is a parameterized SQL fragment (`{ sql, params }`); the
  supabase-js client surface is PostgREST, not raw SQL. There's no
  clean way to execute the compiled SQL without either an RPC
  function (schema change — forbidden) or a service-role backdoor
  (security smell).

The preview handler therefore validates the AST via a mirrored Zod
schema (`previewExpressionSchema` in `infra/supabase/functions/_shared/contracts.ts`),
loads the catalog projection (printing + card + set columns, ~30k
rows), and evaluates the expression in JavaScript with a small
re-implementation of `@binderly/smart-collection-dsl`'s `evaluate.ts`.
Limitations versus the SQL compiler:

- **`collection.*` fields are explicitly rejected** at the schema
  layer — preview is catalog-wide; "is this in my collection?" is a
  save-path concern. The save handler (a separate future task) can
  reach the user's `collection_item` rows.
- **Pagination is post-filter** — `totalCount` is exact, but the
  catalog load + JS evaluation runs on every request. Adequate for
  preview interactions (debounced editor calls); not adequate for
  a hot-path read.

The right long-term fix is the same as for completion: either land
an RPC function that runs `expressionToSql()` server-side, or wire a
bundle-step that pulls `@binderly/smart-collection-dsl` into the Edge
function deploy artifact.

**Recommendation:** Accept both divergences for this iteration. They
are documented at the call sites, the contracts on the wire are
correct, and the frontend follow-ups are unblocked. Schedule:

- T-DL-MV-COMPLETION (backend): land the two missing materialized
  views per `PROJECT.md` § 8 and swap the completion handler.
- T-BE-SMART-PREVIEW-RPC (backend): land a Postgres function that
  accepts the DSL AST as `jsonb` and returns matching printings;
  swap the preview handler to call it.

**Pablo's answer:** if all required pieces are available, don't defer, do it now

---

## Q-014 — Pure-JS ANN dot-product exceeds 30 ms budget at full production catalog scale (T-SC-ANN-INDEX)

**Raised:** 2026-05-20
**Blocking:** None — beta-launch catalog (~3-5 k printings, EN only) sits well inside the 30 ms stage budget; the issue only manifests once the catalog grows to full-production scale.
**Owner of the decision:** T-SC-MATCH worker (next iter); they already need to pick the on-device latency contract for the scanner read path end-to-end.

**Context:**

T-SC-ANN-INDEX shipped flat brute-force FP16-quantised nearest-neighbour search at `apps/mobile/src/scanner/ann/`. At the FP16-vs-FP32 ground-truth benchmark (1 000 queries × 5 000 catalog rows) recall@10 lands at 100.0 %, well above the >= 95 % target.

The brute-force inner loop, projected forward to the full production catalog (~30 k printings × 576-dim MobileNetV3-Small embedding, FP16), benchmarks at **~140 ms per query on a Pixel 6-class device in pure JavaScript**. That is ~4.7x the 30 ms stage budget T-SC-CAMERA documented for the per-frame scanner pipeline.

At v1 beta launch (EN-only catalog, ~3-5 k printings), the same inner loop projects to ~15-25 ms — comfortably under budget — so the issue is **deferred, not present today**.

**Options for T-SC-MATCH to evaluate:**

1. **Pre-cluster the catalog** (k-means or random partition) and only score the user's recent active subset of clusters; trades recall for latency in a tunable way. Pure-JS, no native module.
2. **Push the inner loop into a tiny native module** (Swift + Kotlin, ~50 LOC each calling Accelerate.framework `vDSP_distancesq` / Neon `vmlaq_f32`). Keeps the index format; only the search primitive crosses the bridge.
3. **Migrate the index format to HNSW or IVF-PQ** (the T-SC-ANN-INDEX manifest reserved the `format` field so this is an additive migration). Higher build complexity, lower runtime cost.
4. **Accept the latency at full scale** and run ANN off the worklet thread on a debounced JS-thread tick (e.g. once per ~150 ms of stable detection rather than per frame); preserves the 10 FPS frame-processor budget but adds visible recognition lag.

**Recommendation:** defer the decision to T-SC-MATCH. It will have real-world miss-rate data from end-to-end testing, which is the only way to choose between accuracy-vs-latency tradeoffs honestly. Document the chosen path in T-SC-MATCH's brief.

**Pablo's answer:** choose accuracy, but also keep latency as low as possible.

**Orchestrator interpretation + plan (2026-05-20):**

Among the four options Pablo's directive maps cleanly to **Option 2 — native SIMD inner loop**:

- Option 1 (pre-cluster) → trades recall for latency → rejected (accuracy-first).
- **Option 2 (native SIMD: `vDSP_distancesq` on iOS Accelerate.framework + ARM Neon intrinsics on Android via JNI) → preserves 100 % recall (same brute-force, just vectorised), ~10-20× faster than pure JS → BEST MATCH.**
- Option 3 (HNSW / IVF-PQ) → approximate, trades small recall for large latency win → rejected (accuracy-first).
- Option 4 (debounced off-worklet) → adds visible recognition lag without accuracy gain → rejected.

Option 2 is a proper Expo Module (Swift package + podspec, Kotlin AAR + autolinking, Expo plugin to register both in the project, TS wrapper with feature-detection fallback to the existing pure-JS path) — substantively its own task, not something to fold into T-SC-MATCH.

T-SC-MATCH consumes `searchKNN()` through the existing TS surface, so a later transparent swap to a native-backed implementation is the right shape. **Logged as #FU-29 → `T-SC-ANN-NATIVE`** in `status.md`'s Known Follow-ups; the file at `apps/mobile/src/scanner/ann/search.ts` is the swap point.

**Status: deferred to #FU-29.** Non-blocking for the scanner read-path closer (v1 beta catalog ~3-5 k printings stays inside the 30 ms budget on the pure-JS path; the native swap is needed before the catalog grows past ~10 k printings).

---

## Q-016 — Should `printing_lite` cache `set.logo_url` for the CollectionScreen set-row renderer? (T-OF-LOCAL-DB)

**Raised:** 2026-05-20
**Blocking:** No — `printing_lite` ships without it; CollectionScreen renders fine without set logos on the offline path (falls back to a Tamagui-token-colored placeholder block).
**Owner of the decision:** T-OF-QUEUE worker (next iter), since they are the first downstream consumer of `printing_lite` and will know whether their full-catalog mirror plan would naturally bring set metadata along.

**Context:**

T-OF-LOCAL-DB ships `printing_lite` as a thin per-printing cache: name, set_id, set_name, card_number, image_url, rarity. The set_id + set_name are denormalised into the row to keep the offline read path single-table (no JOIN against a hypothetical `set_lite` table the worker chose not to ship).

The web + mobile CollectionScreens both group user collection items by set and show a small set-logo thumbnail next to the set name. The logo URL is currently fetched from the server at render time. On the offline path this would 404; the screen handles that gracefully with a placeholder block but it is a minor visual regression.

**Options:**

1. **Add `set_logo_url` to `printing_lite`** as a TEXT column via a v2 schema migration. Pro: minimal change; one ALTER TABLE; T-OF-QUEUE keeps populating set_logo_url alongside set_name when it sees a new set. Con: denormalisation cost (every printing row in the same set carries the same logo URL — small at user-collection scale, wasteful at full-catalog mirror scale).
2. **Add a separate `set_lite` table** (id, name, logo_url) and JOIN at read time. Pro: normalised; no per-row waste. Con: extra JOIN on every CollectionScreen render; adds a 3-row dependency to the offline schema.
3. **Punt to the next refresh cycle**: do not cache the logo at all; once T-OF-QUEUE ships background sync, set logos are always at most a few hours stale. CollectionScreen shows the placeholder on first cold start, then refreshes. Pro: zero schema change. Con: visible popping on cold start.

**Recommendation:** Option 1 if T-OF-QUEUE plans to mirror only user-relevant printings (the denormalisation cost is bounded by user collection size, ~thousand rows max). Option 2 if T-OF-QUEUE plans to mirror the full ~30 k production catalog (denormalisation cost ~30 k repeated URLs, which is wasteful). T-OF-QUEUE owner picks.

**Status: open; not blocking.** Resolves when T-OF-QUEUE makes the catalog-mirror-scope call.

**Resolved 2026-05-20 (T-OF-QUEUE, PR #89 → `43a8afa`):** Option 1 — `set_logo_url` denormalised into `printing_lite` via v2 schema migration. T-OF-QUEUE chose user-relevant-only mirror (caps the table at ~thousand rows at user-collection scale); the denormalisation cost is bounded, and Option 2's JOIN complexity isn't warranted. The v2 migration adds the column defensively with a `PRAGMA table_info` guard. Browse-history pre-warming for browsed-but-not-collected printings is a refined-scope follow-up (see #FU-41).

---

## Q-017 — `ml_common` was hardcoded to the `corners` subgrade column (T-GR-EDGES + T-GR-SURFACE)

**Raised:** 2026-05-20 (iter 30, by T-GR-EDGES worker; T-GR-SURFACE hit the same issue independently)
**Blocking:** No — both sibling workers shipped clean by writing their own parallel `EdgesMergedDataLoader` / `SurfaceMergedDataLoader` in their respective `dataset.py`, reading the correct subgrade key from JSON. The cleanup is now unblocked because all three sub-grade tasks (corners, edges, surface) are merged.

**Context:**

T-GR-CORNERS (iter 29) shipped `apps/api-python/grading/ml_common/` with `LabelledGradingSample.corners_score` as the labelled numeric target field and `MergedDataLoader` reading `subgrades->>'corners'` from PSA and `parsed_sub_grades->>'corners'` from eBay + auctions. The naming + hardcoded column was the right scoping for a pattern-establisher, but the assumption that all sub-grade tasks would use the same field name didn't survive contact with T-GR-EDGES + T-GR-SURFACE.

Both follow-on workers needed to filter on a different subgrade key (`edges` / `surface`), so they each shipped a parallel data loader in their subtree instead of patching ml_common (correctly avoiding mid-flight modifications to shared infra while the sibling worker was also running). The result: 3 near-identical `MergedDataLoader` implementations diverging only on the subgrade key string.

**Resolution → #FU-44 (logged in `status.md`'s Known Follow-ups):**

A single coordinated cleanup task lifts the shared loader back into `ml_common/` with the subgrade key as a parameter:

1. Rename `LabelledGradingSample.corners_score` → `subgrade_score` (semantic generic).
2. Generalise `MergedDataLoader.__init__(subgrade_key: Literal['corners','edges','surface'])` so the same class handles all three sub-grades.
3. Drop `EdgesMergedDataLoader` (from `apps/api-python/grading/edges/dataset.py`) and `SurfaceMergedDataLoader` (from `apps/api-python/grading/surface/dataset.py`); both become `MergedDataLoader(subgrade_key='edges'|'surface')` consumers.
4. Update the 3 corresponding test files to consume the new API.

All 3 sub-grade tasks are merged → no scheduling risk from doing the cleanup in one PR.

**Status: closed by #FU-44** (not blocking — T-GR-AGGREGATE doesn't depend on this; it consumes per-sub-grade predictions, not the labelled training data).

---

## Q-018 — Aggregator confidence-band categorical mapping + centering grade-hint adapter (T-GR-AGGREGATE)

**Raised:** 2026-05-20 (iter 31, by T-GR-AGGREGATE worker)
**Blocking:** No — both decisions are codified with documented assumptions; the threshold + mapping constants are constructor-configurable so a future calibration pass can re-tune them without breaking the public API.

**Context:**

T-GR-AGGREGATE's brief asks for a 3-band categorical confidence output
(`'low' | 'medium' | 'high'`) classified from the 4 upstream sub-grade
confidences. The escalation guidance ("if the 4 upstream sub-grade modules emit
a confidence shape that doesn't fit a 3-band classifier (e.g. raw
probabilities only), append a Q-018 entry…") applies — `ml_common.types.ConfidenceBand`
ships as `(value: float, confidence: float ∈ [0,1])`, not a categorical.

Additionally, T-GR-CENTERING emits `CenteringResult.grade_hint: Literal['10','9','8','7','worse','unknown']`
plus `low_confidence: bool` — also not a `ConfidenceBand`. The aggregator needs
to map both shapes into a single `(score: float, confidence_label: 'low'|'medium'|'high')`
contract.

**Decisions (documented, not blocking):**

1. **Float→categorical confidence threshold** for the three ML sub-grade
   modules (corners / edges / surface):
   - `confidence >= 0.66` → `'high'`
   - `confidence >= 0.33` → `'medium'`
   - else → `'low'`

   Reproduced from rules/07-grading.md's "confidence bands, not single numbers"
   spirit; chosen as evenly-spaced thirds for v1. Exposed as constructor
   parameters (`high_threshold`, `low_threshold`) so a future calibration pass
   can re-tune without breaking the API.

2. **Centering grade-hint → float score** mapping:

   | `grade_hint` | numeric score |
   |---|---|
   | `'10'` | 10.0 |
   | `'9'` | 9.0 |
   | `'8'` | 8.0 |
   | `'7'` | 7.0 |
   | `'worse'` | 4.0 |
   | `'unknown'` | 5.0 |

   `'worse'` clamps to 4.0 (centre of the [1.0, 7.0) bin); `'unknown'` defaults to
   5.0 (mid-scale neutral) and forces categorical confidence to `'low'` regardless
   of the `low_confidence` boolean.

3. **Centering categorical confidence** is `'low'` when
   `CenteringResult.low_confidence == True` OR `grade_hint == 'unknown'`,
   otherwise `'high'` (consistent with the "centering is geometric, deterministic"
   stance from PROJECT.md § 12).

4. **Aggregate confidence band** logic per the task brief:
   - `'high'` when ALL 4 sub-grade categorical confidences are `'high'` AND
     max-min spread across sub-grade scores `< 1.0` PSA point;
   - `'low'` when ANY sub-grade categorical confidence is `'low'` OR max-min
     spread `>= 2.0` PSA points (significant disagreement);
   - `'medium'` otherwise.

**Recommendation:** keep the documented assumptions for v1; revisit once
real PSA-labelled grading sessions provide ground truth on which to calibrate.
The constants live in `apps/api-python/grading/aggregate/service.py` next to
`compute_confidence_band_label()`.

**Status: closed by documented assumptions.** Non-blocking; no escalation
required. Re-open if real-world calibration shows the chosen thresholds (or
the centering 'unknown' → 5.0 default) systematically biases the output.

---

_(no other open questions yet)_

## Q-019 — Missing single-GET endpoints + repository `upsertFromServer` API (T-OF-CONFLICTS)

**Context.** T-OF-CONFLICTS' LWW resolver consumes dead-letter events from
T-OF-QUEUE, fetches the current server state for the conflicting entity, and
either re-enqueues the local mutation (local wins) or overwrites the local
SQLite row with the server payload (server wins). Two upstream API gaps
surfaced during implementation:

### Gap 1 — `@binderly/api-client` lacks single-fetch GETs for two of the four conflicting entity types

`CollectionResource` exposes:

- `listCollectionItems({ cursor })` — paginated; no `getCollectionItem(id)`
- `getCustomCollection({ id })` — single-fetch ✅
- `listCustomCollectionItems({ customCollectionId })` — collection-scoped;
  no `getCustomCollectionItem({ collectionId, printingId })`
- `getSmartCollectionRule({ id })` — single-fetch ✅ (only the rule, not the
  smart_collection metadata; for the metadata the resolver reuses
  `getCustomCollection` since smart_collection is stored as `custom_collection`
  with `kind='smart'`)

Adding `getCollectionItem({ id })` and `getCustomCollectionItem({
customCollectionId, printingId })` would be ~30 LOC of additive client code
(matching the existing single-fetch shape) plus a tiny backend route — but
both are out of scope for a conflict-resolution task; touching the API client
would also pull T-OF-CONFLICTS into the `@binderly/api-client` test surface,
which is owned by T-BE-API-CLIENT.

### Gap 2 — Repositories don't expose `upsertFromServer` / merge-from-server

`UserCollectionRepository`, `CustomCollectionRepository`,
`SmartCollectionRepository` each expose `upsert(entity)` — but `upsert` fires
the `onLocalWrite` subscription that T-OF-QUEUE listens to, so calling it from
the resolver to apply a server-wins overwrite would re-enqueue the row we
just resolved (feedback loop → unbounded queue growth → re-runs the same
conflict on next replay → unbounded conflict log growth → eventually
duplicate row sentinel breaks).

Adding `upsertFromServer(entity)` to the 3 repositories (skipping the
`onLocalWrite` notify) would be ~10 LOC each but expands the repository
public surface that T-OF-LOCAL-DB owns.

### Decision (documented, not blocking)

1. **For Gap 1**, the resolver's `server-fetcher.ts` wraps the existing
   paginated `listCollectionItems` / `listCustomCollectionItems` and walks
   pages client-side to find the target id. A hard `MAX_PAGE_WALK = 50`
   cap (~5 000 items at the typical 100-per-page) prevents pathological
   scans; exceeding the cap surfaces as `transient_error` (the dead-letter
   row stays in place, the user retries on next connectivity event, and a
   future api-client upgrade will swap in a single-fetch). For
   `custom_collection_item`, the same pagination pattern over the
   `customCollectionId`-scoped list runs against a much smaller cohort
   (one collection at a time, typically << 100 items).

2. **For Gap 2**, the resolver bypasses the 3 repositories entirely on
   server-wins and uses a local `local-writer.ts` module that performs
   direct `INSERT OR REPLACE` / `DELETE` SQL against the same tables.
   Since the writes never fire `onLocalWrite`, they don't re-enter the
   sync queue — exactly the semantics needed. The schema mirrors the
   repositories' `mapEntityToRow` shape (verified by parity tests).

Both workarounds keep the change strictly within `apps/mobile/src/sync/conflicts/`
(this task's owns_paths) and add zero surface area to `@binderly/api-client`,
T-OF-QUEUE, or T-OF-LOCAL-DB's repositories.

### Follow-ups

- **#FU-49 (logged below as well)** — adding the 2 missing single-GET endpoints
  to `@binderly/api-client` + matching backend routes is a small standalone
  task (`T-BE-API-CLIENT-SINGLE-GET-COLLECTION-ITEMS`); land it once
  T-BE-API-CLIENT has a maintainer cycle and the resolver will benefit
  immediately (drop the page-walk, drop the `MAX_PAGE_WALK` cap, swap in
  `getCollectionItem` / `getCustomCollectionItem` behind the same
  `ServerFetcher` interface).
- Adding `upsertFromServer` to the 3 repositories is **not** logged as a
  follow-up — the direct-SQL `local-writer` pattern is a deliberate
  invariant (the resolver is the only consumer that needs feedback-loop-free
  writes; widening the repository API would risk other consumers
  accidentally bypassing the queue).

**Status: closed by documented assumptions.** Non-blocking; no escalation
required. Re-open if real-world page-walk costs surface as user-visible
latency on conflict resolution.

---

## Q-020 — Shareables config model: brief diverges from merged shape

**Raised by:** T-SH-CONFIG-MODEL sub-agent (iter 32, 2026-05-20).
**Blocking:** No. T-SH-CONFIG-MODEL works around it.

**Context:**

The dispatch brief for T-SH-CONFIG-MODEL proposed a single-row
`user_share_config` per user with fields:

- `handle`, `is_public`, `display_name`, `bio`, `social_links_json`,
  `theme_id`, `show_collection_value`, `show_set_completion`.

The merged code (T-DL-SCHEMA-USERS / T-DL-SCHEMA-COLLECTIONS iter 8 +
T-W-SHAREABLE-PUBLIC iter 20 + T-BE-EDGE-FUNCTIONS-V2 iter 21) ships a
two-table split that does not align:

1. **`profile` (1:1 with `auth.users`)** owns the per-user identity surface:
   `handle` (citext, unique, case-insensitive), `display_name`, `avatar_url`,
   `bio`, `preferences` (jsonb). Already RLS-enforced; already has
   `getMyProfile` / `updateMyProfile` in `@binderly/api-client`.
2. **`shareable` (0..N per user)** owns the per-page configuration:
   `slug` (unique-per-user), `target` (`{kind:'full'} | {kind:'custom', custom_collection_id}`),
   `theme` (default 'default'), `show_values`, `show_missing`, `show_photos`.
   Already RLS-enforced; already has `listShareables` /
   `getShareable` / `createShareable` / `updateShareable` /
   `deleteShareable` in `@binderly/api-client`. PROJECT.md § 16 caps free
   tier at 1 shareable per user; Pro is unlimited.

The brief's `is_public` boolean does not exist — a shareable's *existence*
plus its `(handle, slug)` URL is what makes it public. `rules/08-shareables.md`
mandates an "owner can disable a shareable instantly (kill switch)"; the
schema currently has no `is_active` column so the only way to disable
today is to DELETE the row (which frees the slug). The brief's
`social_links_json` field has no analog anywhere.

**Options:**

1. **Rewrite the data layer to the brief's single-row shape.** Would
   require destructive schema changes to `profile` (move `handle`
   ownership) and dropping the existing `shareable` table — invalidates
   T-W-SHAREABLE-PUBLIC's SSR page, the T-BE-EDGE-FUNCTIONS-V2 endpoint,
   and every existing contract / api-client test. Rejected.
2. **Treat the brief as describing the *settings UI's logical model* and
   map it onto the existing two-table physical model.** Surface
   `profile.handle / display_name / bio` plus shareable rows in the
   settings UI; keep the existing CRUD endpoints; add a thin
   `checkHandleAvailability` resource method (new — server endpoint is
   a backend follow-up). Recommended.
3. **Add brand-new tables alongside both** (e.g. `user_share_config` with
   handle, is_public, social_links). Creates two sources of truth for
   handle ownership and re-implements what `profile` + `shareable`
   already provide. Rejected.

**Recommendation:** Option 2. Documented assumptions:

- "config model" = existing `profile` + `shareable` rows; this task
  does NOT add a `user_share_config` table.
- `is_public` → existence of an `is_active`-true shareable row. The
  kill-switch column (`is_active` BOOLEAN default true) is logged as
  a follow-up — without it the UI's only "disable" affordance is to
  delete the shareable. The settings UI exposes the delete action with
  clear copy explaining it frees the slug.
- `display_name`, `bio` → existing `profile` columns.
- `theme_id` → existing `shareable.theme` (placeholder dropdown with
  only 'default' selectable; T-SH-THEMES will populate the rest).
- `show_collection_value` → existing `shareable.show_values`.
- `show_set_completion` → no exact analog; closest is
  `shareable.show_missing` (the master-set "what I'm chasing" gauge).
  Surface both `show_missing` and `show_photos` toggles too — they're
  already on the row and the public renderer reads them.
- `social_links_json` → not shipped in this task. Logged as a
  follow-up; would require a new `social_links` column on `profile`
  plus contract additions.

**Status: closed by documented assumptions.** Non-blocking; no
escalation required. Backend follow-ups:

- `T-BE-SHAREABLES-HANDLE-CHECK` — wire the
  `GET /v1/me/handle-available?handle=…` endpoint that the new
  `checkHandleAvailability` client method targets. Until shipped the
  client-side debounced check returns "unknown" (settings UI degrades
  to "we'll check when you save").
- `T-SH-KILL-SWITCH` — add `is_active` column + RLS update + contract +
  client; wire the toggle into the settings UI built by this task.
- `T-SH-SOCIAL-LINKS` — add `social_links` jsonb to `profile`, contract,
  client, settings-UI row editor.


---

## Q-021 — Fly target has no HTTP entrypoint: api-python ships only batch/CLI jobs

**Raised:** 2026-05-29 (iter 33, by the T-DP-INFRA / Stage 11 deployment cluster worker)
**Blocking:** A *live* Fly deploy of `apps/api-python` (T-DP-FLY). NOT blocking
the scaffolding — `infra/fly/` config + Dockerfile + `deploy-fly.yml` shipped
and are inert until `FLY_API_TOKEN` is provisioned anyway.

**Context:**

`PROJECT.md` § 3 (tech-stack table) and § 4 name "Heavy services | Python
(FastAPI) on Fly.io". But the actual `apps/api-python/` package currently
ships **only batch / offline / CLI jobs** — `embeddings/`, `ann/`, `grading/`
modules plus console scripts in `pyproject.toml` `[project.scripts]`
(`binderly-build-tflite`, `binderly-build-card-embeddings`,
`binderly-build-ann-index`, `binderly-embeddings-smoke`). There is **no
FastAPI / ASGI app, no `uvicorn`/`fastapi` dependency, and no HTTP
entrypoint** anywhere in the tree (grep for `fastapi|uvicorn|@app` → 0 hits).

A Fly app with an `[http_service]` + `/healthz` check (which `fly.toml`
declares) needs a long-running server that binds a port. With no entrypoint,
`flyctl deploy` would build the image fine but the machine would fail its
healthcheck and never go healthy. Adding the entrypoint (an
`binderly_api.main:app` ASGI module exposing `/healthz` + the future
grading/recognition routes referenced by #FU-46 / `T-GR-SERVING`) plus
`fastapi` + `uvicorn[standard]` deps is **application source owned by the
Python track**, not deploy config — out of scope for this config-only
deployment task, and per the dispatch escalation rules it is surfaced here
rather than guessed/built invasively.

**Options:**

1. **Add a minimal FastAPI serving app to `apps/api-python`** (a
   `binderly_api/main.py` with `GET /healthz` to start, growing into the
   grading/recognition endpoints) + add `fastapi`/`uvicorn` to `dependencies`.
   The shipped `infra/fly/{fly.toml,Dockerfile}` already target
   `binderly_api.main:app`, so this is the only missing piece for a live
   long-running service. — Recommended if Fly is meant to *serve traffic*
   (the PROJECT.md reading). Tracked as the Stage 11 go-live follow-up.
2. **Repurpose Fly for batch/cron jobs only** (no HTTP server): replace
   `[http_service]` with a `[processes]` worker or scheduled Fly Machines
   that run the existing console scripts on a cadence. Changes the topology
   (no healthcheck-on-port). — Pick this if the Python service is only ever
   offline pipelines and the "serving" need is satisfied elsewhere.
3. **Defer Fly entirely** until a Python service genuinely needs to serve
   traffic (e.g. cloud scan fallback / grading serving), and run the batch
   jobs from CI / locally in the meantime. — Lowest cost now; revisit at the
   first real serving requirement.

**Recommendation:** Option 1. PROJECT.md clearly intends a FastAPI service on
Fly, and the grading-serving follow-ups (#FU-46 / `T-GR-SERVING`) will need
exactly this. The deploy scaffolding is written so that landing the entrypoint
+ the two deps is the *only* remaining step before a live deploy works. Logged
as the Stage 11 go-live follow-up; the deploy-fly workflow stays inert until
both `FLY_API_TOKEN` and the entrypoint exist.

**Pablo's answer:** _(empty until answered)_


---

## Q-022 — Mobile release cadence + OTA (EAS Update) strategy not yet decided

**Raised:** 2026-05-29 (iter 35, by the T-DP-EAS / Stage 11 deployment worker)
**Blocking:** Nothing. The EAS build/submit scaffolding (`apps/mobile/eas.json`
+ `deploy-mobile.yml`) ships and is inert until `EXPO_TOKEN` is provisioned.
This is a forward-looking process/topology decision, not a blocker.

**Context:**

The EAS scaffolding deliberately makes two choices that are reversible but
worth confirming before go-live:

1. **Build cadence = manual dispatch only.** Unlike `deploy-web` /
   `deploy-fly` / `deploy-db` (which auto-run on push to `main`), the mobile
   workflow is `workflow_dispatch`-only and store submission is an opt-in
   input. Native EAS builds consume metered build minutes and store releases
   have review/cadence implications, so auto-building every `apps/mobile/**`
   push seemed wrong. The trade-off is there's no automatic
   build-on-merge signal for mobile.
2. **No OTA (`expo-updates`) runtime is wired.** `eas.json` declares
   `development`/`preview`/`production` **channels** so EAS Update can be
   layered on later, but the app has no `expo-updates` dependency or runtime
   config today, so JS-only hotfixes still require a full store build. Wiring
   OTA is an application-code change (adds `expo-updates`, runtime version
   policy, update-check UX) owned by the mobile track, not deploy config.

Also note `extra.eas.projectId` is intentionally absent from `app.json` — it's
written by `eas init` against Pablo's real Expo account (first-run setup in
`infra/eas/README.md`), so it can't be committed by this scaffolding task.

**Options:**

1. **Keep manual-dispatch builds + add OTA later.** Ship as scaffolded; wire
   `expo-updates` + `eas update` as a follow-up (#FU-58) once an Expo account
   exists. — Recommended; lowest cost now, matches the "inert until secrets"
   posture and avoids burning build minutes pre-launch.
2. **Auto-build a `preview` profile on merge to `main`.** Gives a continuous
   internal-QA build per merge. — Costs build minutes continuously; revisit
   post-launch if the team wants nightly internal builds.
3. **Wire OTA now (mock/dev only).** Add `expo-updates` immediately so the
   channel wiring is exercised end-to-end. — More invasive app-code change for
   no pre-account benefit; better as the #FU-58 follow-up.

**Recommendation:** Option 1. The build/submit config is correct and inert; the
OTA wiring + any auto-build cadence are best decided once Pablo has an Expo
account and a launch timeline. Logged as Stage 11 go-live (#FU-53) for the
account/token, with the OTA wiring tracked separately as #FU-58.

**Pablo's answer:** _(empty until answered)_

---

## Q-023 — Cross-company grade calibration constants are unvalidated placeholders (T-GR-GRADE-CALIBRATION / #FU-56)

**Raised:** 2026-05-29 (iter 34, by the grading-data-hygiene worker; renumbered from Q-022 → Q-023 at merge — the parallel T-DP-EAS worker claimed Q-022)
**Blocking:** No — `grading/calibration/` ships as a scaffold with a documented placeholder affine map (PSA-anchored, per-company `slope`/`intercept`), so downstream flywheel/pricing code has a single normalised scale to consume today. Nothing depends on the constants being *correct* yet.

**Context:**

#FU-56 asked for a cross-company calibration module mapping `company + grade → normalised internal scale` (PSA-equivalent `[1.0, 10.0]`). PSA/BGS/CGC/SGC grade on different, differently-strict scales, so a mixed corpus (community flywheel, cross-company pricing) needs one scale before grades can be compared/aggregated.

The shipped v0 (`grading/calibration/calibration.py` `PLACEHOLDER_CALIBRATIONS`) is a per-company affine transform with **heuristic constants** drawn from rough market cross-grade lore (e.g. BGS 9.5 ≈ PSA 10 → BGS gets a small positive intercept). These are explicitly NOT a data fit, carry low `confidence`, and are clamped to `[1, 10]`. The affine map is expressed as a numpy dot product so a learned weight vector can drop in without changing call sites.

**Open question:**

1. Where does the labelled cross-company training signal come from? Options: (a) the same physical card graded by ≥2 companies (rare but cleanest), (b) card-identity matches across companies via #FU-40's printing match + realised market value as the regression target, (c) curated expert equivalence tables. Each has different bias/coverage.
2. Granularity: is a single per-company affine enough, or do we need per-company-**per-grade-tier** constants (cross-grade equivalence is non-linear at the very top — the 9.5↔10 band behaves differently from the mid-scale)?
3. Should the normalised scale stay PSA-anchored, or move to a company-neutral latent scale once learned?

**Proposed resolution → #FU-60 (learned cross-company calibration):** once the flywheel accumulates enough labelled cross-company pairs, fit the constants (per-company or per-company-per-tier), inject the fitted table into `GradeCalibrator(calibrations=...)`, and bump `CALIBRATION_VERSION` from `v0-placeholder`. Tracked as #FU-60 in `status.md`'s Known Follow-ups.

**Status: open** (non-blocking; placeholder scaffold is sufficient until labelled cross-company data exists).
