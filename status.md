# Build status — Iter 15 closed. Auth flows live cross-platform. Paused for the night.

**Phase 0:** Complete (10/10 merged).
**Phase 1:** Complete (23/23 merged) — closed at iter 11.
**Phase 2 backend (Stage 02):** 3/4 merged. T-BE-EDGE-FUNCTIONS remaining.
**Phase 3 shared packages (Stage 03):** 1/4 merged (T-SP-UI-TOKENS). 3 ready (T-SP-PRICING-DISPLAY, T-SP-SET-COMPLETION, T-SP-SMART-DSL).
**Phase 4 web (Stage 04):** 2/8 merged (T-W-SHELL #48, T-W-AUTH #51). T-W-BROWSE now ready.
**Phase 5 mobile (Stage 05):** 2/5 merged (T-M-SHELL #47, T-M-AUTH #52). T-M-BROWSE now ready.
**Stages 06-11:** 0 / 32 merged.

**In progress:** 0 (orchestrator paused for the night per Pablo's request).
**Blocked:** 0.
**Blocked on humans:** 0.

## Phase 1 close summary

The data layer is **done end-to-end** on main:

- **Schema (5 tasks):** USERS, CARDS, COLLECTIONS, GRADING, PRICING.
  13 schema modules; 17 monotonic migrations 0000-0016.
- **Source pipeline (5 adapters + resolver + classifier + master-set):**
  TCGDEX-EN (primary EN), PTCGIO (validation EN), BULBAPEDIA (filler EN),
  TCGDEX-JP (primary JP), POKEMONCARD-JP (filler JP).
- **Image pipeline:** sharp WebP transcode + R2 / MinIO storage +
  SHA-256 dedup; cross-host plumbing fixed (Q-005).
- **Pricing pipeline (4 tasks, complete chain):** AGGREGATOR (Layer 1
  paid API; mock-by-default) + EBAY-BROWSE (Layer 2 free; mock-by-
  default) → price_observation → ROLLUP (per-currency; outlier-
  trimmed) → price_aggregate → CURRENT-VIEW → mv_current_price.
- **FX rates:** Frankfurter `.dev/v1` daily ingest, USD-base, 6
  quote currencies.
- **Conflict logging:** data_conflict table; resolver write-path is
  per-set buffer-and-flush; failures never block primary write.
- **Admin debug views:** 5 service_role-gated views
  (v_data_conflict_top, v_data_conflict_by_source,
  v_image_pipeline_coverage_gaps, v_fx_rate_freshness,
  v_pg_stat_statements_top_queries).
- **RLS posture verified live** (Q-003 closed; verify-rls 97/0;
  per-view smoke 5/5 service_role passes, anon/authenticated 5/5
  permission denied).
- **Live SEED-INGEST verified end-to-end** (Pablo, 2026-05-04 23:24Z;
  1 set / 216 cards / 341 printings; 332 transcoded / 9 cached /
  0 errors).
- **1101 tests pass** in `@binderly/data-pipeline` (covering all
  adapters + resolver + variant classifier + master-set engine +
  image pipeline + parsers + jobs + repos).

## Dispatch loop status

Iter 15 closed 2026-05-05 ~21:15 UTC-4 with cross-platform auth
flows on main. Pablo paused for the night. Phase 2+ progression
so far:

iter 12 (T-BE-API-CONTRACTS + T-BE-AUTH — opens Phase 2 backend
foundation) →
iter 13 (T-BE-API-CLIENT + T-SP-UI-TOKENS — backend client +
cross-platform UI primitives) →
iter 14 (T-W-SHELL + T-M-SHELL — Next.js + Expo app shells;
opens Phase 4 web stage and Phase 5 mobile stage) →
iter 15 (T-W-AUTH + T-M-AUTH — cross-platform sign-in /
callback / sign-out on top of iter-12 backend auth).

Phase 1 progression (closed at iter 11):

iter 1 (USERS+CARDS) →
iter 2 (COLLECTIONS+GRADING+SOURCE-INTERFACES) →
iter 3 (SCHEMA-PRICING+MASTER-SET-RULES+TCGDEX-EN) →
iter 4 (PTCGIO+BULBAPEDIA+TCGDEX-JP) →
iter 5 (IMAGE-PIPELINE+RLS-POLICIES+EBAY-LISTING-PARSER) →
iter 6 (SEED-INGEST+PROFILE-GRANTS-FIX+FX-RATES) →
iter 7 (PRICING-AGGREGATOR+PRICING-EBAY-BROWSE) →
iter 7.5 (Q-005 hotfix) →
iter 8 (PRICING-ROLLUP) →
iter 9 (PRICING-CURRENT-VIEW) →
iter 10 (DATA-CONFLICT-TABLE) →
iter 11 (ADMIN-DEBUG-SURFACES — Phase 1 cap).

Final migration sequence on main: monotonic 0000-0016.

  0000_user_tables          (T-DL-SCHEMA-USERS)
  0001_users_rls            (T-DL-SCHEMA-USERS, hand-authored)
  0002_catalog_tables       (T-DL-SCHEMA-CARDS)
  0003_catalog_rls          (T-DL-SCHEMA-CARDS, hand-authored)
  0004_collection_tables    (T-DL-SCHEMA-COLLECTIONS)
  0005_collections_rls      (T-DL-SCHEMA-COLLECTIONS, hand-authored)
  0006_grading_tables       (T-DL-SCHEMA-GRADING)
  0007_grading_rls          (T-DL-SCHEMA-GRADING, hand-authored)
  0008_pricing_tables       (T-DL-SCHEMA-PRICING)
  0009_pricing_rls          (T-DL-SCHEMA-PRICING, hand-authored)
  0010_image_provenance     (T-DL-IMAGE-PIPELINE)
  0011_image_provenance_rls (T-DL-IMAGE-PIPELINE, hand-authored)
  0012_profile_grants_fix   (T-DL-PROFILE-GRANTS-FIX, hand-authored, closes Q-003)
  0013_mv_current_price     (T-DL-PRICING-CURRENT-VIEW, hand-authored)
  0014_data_conflict        (T-DL-DATA-CONFLICT-TABLE, drizzle-generated)
  0015_data_conflict_rls    (T-DL-DATA-CONFLICT-TABLE, hand-authored)
  0016_admin_debug_views    (T-DL-ADMIN-DEBUG-SURFACES, hand-authored)
  0017_profile_provisioning_trigger (T-BE-AUTH, hand-authored)

## Phase 1 ledger (23/23 — 100%)

| Task | Status | PR / commit |
|---|---|---|
| T-DL-SCHEMA-USERS | merged | #15 (`e9b4f38`) |
| T-DL-SCHEMA-CARDS | merged | #16 (`24b0fd4`, renumber `b5af7f7`) |
| T-DL-SCHEMA-COLLECTIONS | merged | #17 (`c131903`) |
| T-DL-SCHEMA-GRADING | merged | #18 (`77d18d0`, renumber `ffc4d34`) |
| T-DL-SOURCE-INTERFACES | merged | #19 (`51b3727`) |
| T-DL-MASTER-SET-RULES | merged | #21 (`d531dc7`) |
| T-DL-SCHEMA-PRICING | merged | #22 (`a99fc0b`) |
| T-DL-SOURCE-TCGDEX-EN | merged | #23 (`1a741ab`) |
| T-DL-SOURCE-PTCGIO | merged | #24 (`c8b2de0`) |
| T-DL-SOURCE-BULBAPEDIA | merged | #25 (`4afde4d`) |
| T-DL-SOURCE-TCGDEX-JP | merged | #26 (`4c30cf0`) |
| T-DL-IMAGE-PIPELINE | merged | #27 (`9be37c0`) |
| T-DL-RLS-POLICIES | merged | #28 (`3c448db`) |
| T-DL-EBAY-LISTING-PARSER | merged | #30 (`2b2d144`) |
| T-DL-PROFILE-GRANTS-FIX | merged | #31 (`1fe1fbd`; closes Q-003) |
| T-DL-FX-RATES | merged | #32 (`63a8ae8`) |
| T-DL-SEED-INGEST | merged | #33 (`34264a3`; surfaced Q-005) |
| T-DL-IMAGE-PIPELINE-CROSSHOST-FIX | merged | #35 (`49e9446`; closes Q-005) |
| T-DL-PRICING-AGGREGATOR | merged | #34 (`f3e5608`) |
| T-DL-PRICING-EBAY-BROWSE | merged | #36 (`8b855f4`; reconciliation rename) |
| T-DL-PRICING-ROLLUP | merged | #37 (`1cc7a40`) |
| T-DL-PRICING-CURRENT-VIEW | merged | #38 (`f9bcc96`; ratified Q-006) |
| T-DL-DATA-CONFLICT-TABLE | merged | #39 (`3fb5227`) |
| T-DL-ADMIN-DEBUG-SURFACES | merged | #40 (`b13d3ed`; surfaced Q-007) |

## Iter 12 close summary (Phase 2 backend foundation)

Both siblings landed clean with one merge-time conflict (`pnpm-lock.yaml`)
resolved by regenerating with `pnpm install --no-frozen-lockfile`
after taking main's lockfile. `dependencies.yaml` auto-merged.

| Task | Status | PR / commit | Tests | Highlight |
|---|---|---|---|---|
| T-BE-API-CONTRACTS | merged | #41 (`ebe59a1`) | 187 | Variant-taxonomy enums re-declared locally to avoid pulling sharp/aws-sdk into web/mobile/scanner consumers; smart-collection `expression` enforced via field-level `z.custom` |
| T-BE-AUTH | merged | #42 (`2347268`) | 43 + 2 verify-rls behavioral | Profile + subscription auto-provisioned via idempotent `AFTER INSERT ON auth.users` trigger (mig 0017) — signup is atomic and provider-agnostic |

## Iter 15 close summary (cross-platform auth)

Both siblings landed clean — **zero merge conflicts** this iter
(orthogonal owns_paths under each app's auth/ subtree;
orthogonal Expo vs. Next dep graphs at the lockfile level).

| Task | Status | PR / commit | Tests | Highlight |
|---|---|---|---|---|
| T-M-AUTH | merged | #52 (`c970b4b`) | +58 (168 total in @binderly/mobile) | Tests re-mock `expo-router` locally via `vi.hoisted({ routerMocks })` because M-SHELL's global mock returns a fresh `useRouter()` per call, breaking `mockReturnValueOnce` and observable `.mock.calls` assertions on `router.replace`. Apple Sign-In via `expo-apple-authentication` for iOS App Store compliance |
| T-W-AUTH | merged | #51 (`e7b3ebf`) | +55 (113 total in @binderly/web) | Auth pages pin `useAuth().signOut` and `useRouter()` into refs and gate effects with a `startedRef` because AuthProvider's value reference flips during lazy Supabase hydration (per W-SHELL hotfix `fb4a6d0`); naive `useEffect` deps would double-fire. Build still succeeds with NO `NEXT_PUBLIC_SUPABASE_*` env set |

**Cross-platform validation:** both flows exercise the same
backend auth contract (`@binderly/auth` + Supabase JS +
provisioning trigger from mig 0017) and the same api-client
`auth` resource. The trigger ensures profile + subscription rows
exist atomically regardless of which platform signs the user up.

Final migration sequence on main: monotonic 0000-0017 (no new
migrations in iter 15).

## Iter 16 readiness — what's available when Pablo resumes

| Task | Stage | Effort | Depends on (now satisfied) | Notes |
|---|---|---|---|---|
| T-W-BROWSE | 04-web | ? | shell + auth | catalog browse on web |
| T-M-BROWSE | 05-mobile | ? | shell + auth | catalog browse on mobile |
| T-BE-EDGE-FUNCTIONS | 02-backend | L | api-contracts + rls-policies | last backend task; closes Stage 02 |
| T-SP-PRICING-DISPLAY | 03-shared-packages | M | fx-rates + api-contracts | parallel-safe with set-completion + smart-dsl |
| T-SP-SET-COMPLETION | 03-shared-packages | M | api-contracts + master-set-rules | parallel-safe with smart-dsl |
| T-SP-SMART-DSL | 03-shared-packages | L | api-contracts | parallel-safe with set-completion |

Suggested iter 16 dispatch (when resuming): T-BE-EDGE-FUNCTIONS
(closes Stage 02; large but fully independent) **or** the
browse pair (T-W-BROWSE + T-M-BROWSE) for another cross-platform
feature lap. Edge functions probably earns its slot first since
collection mutations need it before browse can be useful.

## Iter 14 close summary (app shells)

Both siblings landed; T-W-SHELL hit a CI build snag at merge
time that needed an orchestrator hotfix, otherwise clean.

| Task | Status | PR / commit | Tests | Highlight |
|---|---|---|---|---|
| T-M-SHELL | merged | #47 (`f73c54b`) | 110 | Pinned the workspace to RN 0.76.9 / React 18 (Expo SDK 52) via a workspace-root `pnpm.overrides` block — Tamagui's `react-native: *` peer otherwise drags RN 0.85.x + React 19 typings into `@binderly/ui` and breaks its build. expo-secure-store is the JWT storage adapter (NOT AsyncStorage) |
| T-W-SHELL | merged | #48 (`355b63c`) | 58 | Pinned Next.js 14.2.18 + React 18.3.1 to align with the React 18 graph; AuthProvider lazily constructs Supabase JS in useEffect (not useMemo at render) so `next build` static prerender doesn't fail on missing env vars in CI (orchestrator hotfix `fb4a6d0` after merge — see ledger note below) |

**Hotfix at merge time:** T-W-SHELL's worker reported all CI
green locally, but the post-merge CI run failed at the `build`
step because `next build` prerendered the public placeholder
routes, evaluated AuthProvider, and called `getBrowserSupabase()`
→ `loadWebEnv()` → throw on missing
`NEXT_PUBLIC_SUPABASE_URL`. Orchestrator pushed `fb4a6d0`
deferring Supabase JS init to a useEffect (client-only); 11/11
prerendered routes now build cleanly without env vars set. Same
file also needed `eslint --fix` for import order — both included
in the hotfix commit.

Final migration sequence on main: monotonic 0000-0017 (no new
migrations in iter 14).

## Iter 15 readiness — what's available

After iter 14, the dependency graph unblocks **8 ready
candidates** (and several more if shared packages land):

| Task | Stage | Effort | Depends on (now satisfied) | Notes |
|---|---|---|---|---|
| T-W-AUTH | 04-web | M | shell + be-auth | actual sign-in flow on web; parallel with T-W-BROWSE |
| T-W-BROWSE | 04-web | ? | shell | catalog browse; parallel with T-W-AUTH |
| T-M-AUTH | 05-mobile | M | shell + be-auth | actual sign-in flow on mobile; parallel with T-M-BROWSE |
| T-M-BROWSE | 05-mobile | ? | shell | catalog browse; parallel with T-M-AUTH |
| T-BE-EDGE-FUNCTIONS | 02-backend | L | api-contracts + rls-policies | last backend task; closes Stage 02 |
| T-SP-PRICING-DISPLAY | 03-shared-packages | M | fx-rates + api-contracts | parallel-safe with set-completion + smart-dsl |
| T-SP-SET-COMPLETION | 03-shared-packages | M | api-contracts + master-set-rules | parallel-safe with smart-dsl |
| T-SP-SMART-DSL | 03-shared-packages | L | api-contracts | parallel-safe with set-completion |

**Iter 15 dispatch decision: T-W-AUTH + T-M-AUTH as parallel
siblings.** Orthogonal owns_paths (`apps/web/app/auth/` +
`apps/web/lib/auth/` vs `apps/mobile/src/screens/auth/` +
`apps/mobile/src/lib/auth/`), different agent roles. Both
exercise the same backend auth contract (`@binderly/auth` +
Supabase JS + provisioning trigger from mig 0017) and the same
api-client `auth` resource — best cross-platform validation we
can do at this layer. Iter 16 candidate: T-BE-EDGE-FUNCTIONS to
close Stage 02.

## Open questions (1 open; non-blocking)

- **Q-007** (raised by T-DL-ADMIN-DEBUG-SURFACES, PR #40):
  should we provision a narrower Postgres `admin` role for read-only
  debug access (e.g. when an admin web UI lands)? For v1 the
  service_role posture is sufficient — anyone with service_role
  bypass can query the views. As soon as we want to expose these to
  human admins via a UI, we likely want a narrower role with SELECT-
  only scope on the debug views, not full DB superuser. **Status:
  open; not blocking. Decide before the admin UI lands.**

All other open questions (Q-003 / Q-004 / Q-005 / Q-006) are closed.

## Last 5 merges

- T-W-AUTH — `e7b3ebf` (web sign-in/callback/sign-out; +55 tests; refs+startedRef pattern for hydration-flip-safe effects) — **iter 15 cap**
- T-M-AUTH — `c970b4b` (mobile sign-in/callback; magic-link + Google/Apple/Discord OAuth via expo-auth-session; +58 tests; expo-router test-mock pattern logged for follow-ups)
- T-W-SHELL — `355b63c` (Next.js 14.2.18 + React 18 app shell; AuthProvider lazy-init via useEffect; 58 tests) — **iter 14 cap (with hotfix `fb4a6d0`)**
- T-M-SHELL — `f73c54b` (Expo SDK 52 + RN 0.76.9 app shell; expo-secure-store JWT storage; root pnpm.overrides for React 18 pin; 110 tests)
- T-SP-UI-TOKENS — `f228d1a` (@binderly/ui Tamagui tokens + base components; cross-platform via core+input only; 257 tests) — **iter 13 cap**

## Known follow-ups (logged, non-blocking; Phase 1 left them deliberately)

1. **`T-DL-DB-TEST-INFRA` (proposed)** — vitest in `@binderly/db`;
   rewrite `db:generate` / `db:migrate` wrappers in plain ESM (no
   `tsx` runtime) so future db sub-agents don't hit sandbox tsx-
   IPC-pipe failures.
2. **`T-DL-PRICING-TYPES-CONSOLIDATION` (proposed)** — hoist a shared
   `RawPriceObservation` (+ schema) to `data-pipeline/src/types.ts`
   and have BOTH AGGREGATOR and EBAY-BROWSE adapters import from
   there. EBAY-BROWSE's symbols are currently differentiated as
   `RawEbayBrowsePriceObservation` etc. as a holding pattern.
3. **`T-DL-DATAPIPELINE-DOTENV` (proposed)** — auto-load `.env` in
   data-pipeline scripts so smoke tests are one-liners. Also: PR #33's
   smoke-test instructions reference the wrong DATABASE_URL default
   (Compose Postgres :5433 vs Supabase Postgres :54322 where
   migrations live); fix the README.
4. **`T-DL-DB-TURBO-BUILD-PIPELINE` (proposed; Q-004 follow-up)** — add
   a turbo `^build` pipeline so `pnpm seed` implicitly builds
   `@binderly/db` first.
5. **`T-DL-PRICING-CURRENT-VIEW-V2` (proposed; Q-006 follow-up)** —
   pair with T-SP-PRICING-DISPLAY (Phase 2). Adds the richer trends +
   freshness shape from `context/data-model.md` § `mv_current_price`.
6. **One-shot snapshot regen** — Pablo can run
   `pnpm install && pnpm --filter @binderly/db db:generate` once to
   confirm drizzle-kit produces a no-op diff against the hand-merged
   `meta/0002_snapshot.json` and `meta/0006_snapshot.json`.
7. **`db:migrate` UX wart** — `migrate.ts` errors hard if
   `meta/_journal.json` is missing entries instead of skipping
   gracefully.
8. **Dependabot backlog** — ~9 open PRs from when CI landed.
9. **`.nvmrc` 22.22.2 not locally installable** — fall back to 22.13.0.
10. **`scripts/cleanup_worktree.sh` regex rejects single-letter task scopes** — script enforces `^T-[A-Z]{2}-[A-Z0-9-]+$` but iter 14's `T-M-SHELL` and `T-W-SHELL` only have one letter in the scope segment. Orchestrator did manual `git worktree remove --force` + `git branch -D` for both. Either relax the regex to `^T-[A-Z]+-[A-Z0-9-]+$` or rename the affected tasks. Same regex appears in the repo's `pr-title` lint workflow (which is why both shell PRs needed `feat(<area>): T-X-SHELL — …` reformatting at merge time).
11. **`@binderly/web` worker reported all-green-locally but CI build failed.** Root cause: AuthProvider eagerly called Supabase client constructor (which throws on missing env) inside useMemo at render time; `next build` static prerender evaluates this for every page. Orchestrator hotfix `fb4a6d0` deferred init to useEffect. **Action item:** add a CI-style "build with no env" smoke test the worker can run locally before pushing, so future Next.js shells catch this in the dispatch loop instead of post-merge.
12. **Iter 14 worker `T-W-SHELL` hit `resource_exhausted` twice** before the third resume succeeded with strict guardrails (no web searches, minimal up-front reading, smallest viable shell, 30-50 test target). For future Next.js / Expo / large-framework dispatches, default to the lean prompt shape upfront.
13. **Mobile router-asserting tests need a local `vi.hoisted({ routerMocks })` mock** because M-SHELL's global `setup.ts` returns a fresh `useRouter()` per call (breaks `mockReturnValueOnce` and observable `.mock.calls`). T-M-AUTH worked around it locally; M-SHELL cleanup pass could lift the stable mock into the global setup. Worth a short follow-up task for whoever next touches `apps/mobile/src/test-utils/`.
14. **Dead M-SHELL placeholder screens** at `apps/mobile/src/screens/SignInScreen.tsx` and `AuthCallbackScreen.tsx` (legacy duplicates from before T-M-AUTH repointed the route shells). Outside any current task's owns_paths; flag for an M-SHELL cleanup follow-up.
15. **`apps/web/components/providers/AuthProvider.tsx` not prettier-compliant** — `pnpm --filter @binderly/web format:write` reformats it. T-W-SHELL committed it in this state and `format:check` isn't a CI gate, so workers can't safely re-run format on the file. Worth a one-shot cleanup commit.

## Phase 0 ledger (closed; 10/10 merged)

All foundation tasks merged. See git log between `7df9f12`
(T-FN-MONOREPO) and `7b4529e` (T-FN-DB-MIGRATIONS).

## Verification protocol

For runtime ACs that need Docker socket access, the orchestrator
hands Pablo a paste-able one-liner and merges on his thumbs-up.
Static-only ACs are verified in foreground via the diff inspector
or by sub-agents inside their worktrees. The post-Q-005 SEED-INGEST
live smoke (2026-05-04 23:24Z) demonstrates the full chain working
end-to-end.

## Notes

This file is updated by the orchestrator agent at the end of every
dispatch loop iteration. Do not edit by hand.
