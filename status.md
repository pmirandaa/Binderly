# Build status — Iter 13 closed. App shells (web + mobile) unblocked.

**Phase 0:** Complete (10/10 merged).
**Phase 1:** Complete (23/23 merged) — closed at iter 11.
**Phase 2 backend (Stage 02):** 3/4 merged. T-BE-EDGE-FUNCTIONS remaining.
**Phase 3 shared packages (Stage 03):** 1/4 merged (T-SP-UI-TOKENS #45). 3 ready (T-SP-PRICING-DISPLAY, T-SP-SET-COMPLETION, T-SP-SMART-DSL).
**Phase 4 web (Stage 04):** 0/8 — T-W-SHELL now unblocked.
**Phase 5 mobile (Stage 05):** 0/5 — T-M-SHELL now unblocked.
**Stages 06-11:** 0 / 32 merged.

**In progress:** 0 (iter 13 just closed; iter 14 dispatch incoming).
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

Iter 13 closed 2026-05-05 ~19:14 UTC-4 with both downstream
foundation siblings on main. Phase 2+ progression so far:

iter 12 (T-BE-API-CONTRACTS + T-BE-AUTH — opens Phase 2 backend
foundation) →
iter 13 (T-BE-API-CLIENT + T-SP-UI-TOKENS — backend client +
cross-platform UI primitives; together unblock T-W-SHELL +
T-M-SHELL for iter 14).

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

## Iter 13 close summary (downstream foundation)

Both siblings landed clean with **zero merge conflicts** —
api-client and ui-tokens dep graphs were orthogonal at the
lockfile level (api-client only added new top-level workspaces +
a few small deps; ui-tokens added a fresh Tamagui dep tree; no
shared transitive collisions).

| Task | Status | PR / commit | Tests | Highlight |
|---|---|---|---|---|
| T-BE-API-CLIENT | merged | #44 (`303e5f5`) | 227 | The `auth` resource delegates interactive sign-in (OAuth/PKCE/magic-link) to a SupabaseClient (caller-supplied or lazily built); every other resource is a pure typed HTTP wrapper that validates outbound payloads via api-contracts write schemas (fail fast — never round-trip to fail) and inbound bodies via read schemas (catch backend drift as `ApiResponseDecodeError`) |
| T-SP-UI-TOKENS | merged | #45 (`f228d1a`) | 257 | Bound prod deps to `@tamagui/core` + `@tamagui/input` only (skipping the heavy `tamagui` umbrella); `<Icon>` is a registry-pattern wrapper that takes any lucide flavour via an `as` prop, so the shared package never drags `react-native-svg` / `react-native` peers into the web RSC graph |

Final migration sequence on main: monotonic 0000-0017 (no new
migrations in iter 13).

## Iter 14 readiness — what's available

After iter 13, the dependency graph unblocks **5 ready candidates**:

| Task | Stage | Effort | Depends on (now satisfied) | Notes |
|---|---|---|---|---|
| T-W-SHELL | 04-web | M | ui-tokens + api-client | newly unblocked; opens web stage |
| T-M-SHELL | 05-mobile | M | ui-tokens + api-client | newly unblocked; opens mobile stage |
| T-BE-EDGE-FUNCTIONS | 02-backend | L | api-contracts + rls-policies | last backend task; closes Stage 02 |
| T-SP-PRICING-DISPLAY | 03-shared-packages | M | fx-rates + api-contracts | parallel-safe with set-completion + smart-dsl |
| T-SP-SET-COMPLETION | 03-shared-packages | M | api-contracts + master-set-rules | parallel-safe with smart-dsl |
| T-SP-SMART-DSL | 03-shared-packages | L | api-contracts | parallel-safe with set-completion |

**Iter 14 dispatch decision: T-W-SHELL + T-M-SHELL as parallel
siblings.** Orthogonal app directories (`apps/web/` vs
`apps/mobile/`), different agent roles, and they're the
highest-leverage remaining work since each one unblocks an entire
8-task / 5-task downstream stage. Both shells will share-validate
the cross-platform contract of @binderly/ui (Tamagui) and
@binderly/api-client (typed HTTP), which is the most useful
integration test the iter 13 work could get.

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

- T-SP-UI-TOKENS — `f228d1a` (@binderly/ui Tamagui tokens + base components; light+dark; cross-platform via core+input only; 257 tests) — **iter 13 cap**
- T-BE-API-CLIENT — `303e5f5` (@binderly/api-client typed HTTP wrapper; auth resource delegates to Supabase JS for interactive flows; 227 tests; zero live network)
- T-BE-AUTH — `2347268` (Supabase Auth wiring; mig 0017 trigger auto-provisions profile+subscription; 43 unit tests + 2 verify-rls behavioral) — **iter 12 cap**
- T-BE-API-CONTRACTS — `ebe59a1` (@binderly/api-contracts; 187 zod-backed DTOs across 7 modules; opens Phase 2)
- T-DL-ADMIN-DEBUG-SURFACES — `b13d3ed` (mig 0016 hand-authored views; Q-007 surfaced) — **Phase 1 cap**

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
