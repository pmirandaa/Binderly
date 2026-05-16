# Build status — Iter 19 closed. Phase 5 mobile COMPLETE. Iter 20 dispatching web tail (final iter of the night).

**Phase 0:** Complete (10/10 merged).
**Phase 1:** Complete (23/23 merged) — closed at iter 11.
**Phase 2 backend (Stage 02):** **Complete (4/4 merged)** — closed at iter 16.
**Phase 3 shared packages (Stage 03):** **Complete (4/4 merged)** — closed at iter 17.
**Phase 4 web (Stage 04):** 6/8 merged (T-W-SHELL #48, T-W-AUTH #51, T-W-BROWSE #60, T-W-COLLECTION #61, T-W-CUSTOM #64, T-W-SMART #63). T-W-SHAREABLE-PUBLIC + T-W-AFFILIATE-LINKS dispatching iter 20 — those two close Stage 04.
**Phase 5 mobile (Stage 05):** **Complete (5/5 merged)** — closed at iter 19 with T-M-CUSTOM.
**Stages 06-11:** 0 / 32 merged.

**In progress:** 2 (iter 20 dispatching — see block below).
**Blocked:** 0.
**Blocked on humans:** 0 (Pablo has granted full autonomy: "don't wait for my approval to do stuff").

After iter 20 lands tonight, **Stage 04 web will be complete (8/8)** and the entire FRONTEND foundation (web + mobile + shared packages + backend core) is shipped. Remaining work for v1 launch: scanner stage (06), ML (07), integrations (08), admin (09), billing (10), deploy/launch (11) — 32 tasks, all backend / mobile-scanner / ops surfaces.

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

Iter 19 closed 2026-05-15 ~22:30 UTC-4 with **Phase 5 mobile
complete (5/5)** and Phase 4 web at 6/8. Progression so far:

iter 12 (T-BE-API-CONTRACTS + T-BE-AUTH — opens Phase 2 backend
foundation) →
iter 13 (T-BE-API-CLIENT + T-SP-UI-TOKENS — backend client +
cross-platform UI primitives) →
iter 14 (T-W-SHELL + T-M-SHELL — Next.js + Expo app shells;
opens Phase 4 web stage and Phase 5 mobile stage) →
iter 15 (T-W-AUTH + T-M-AUTH — cross-platform sign-in /
callback / sign-out) →
iter 16 (T-BE-EDGE-FUNCTIONS + T-SP-SET-COMPLETION +
T-SP-SMART-DSL — 3-worker parallel; closes Stage 02 backend;
ratified Q-008) →
iter 17 (T-SP-PRICING-DISPLAY + T-W-BROWSE + T-M-BROWSE —
3-worker; closes Stage 03 shared packages; resolved Q-009) →
iter 18 (T-W-COLLECTION + T-M-COLLECTION — cross-platform
collection w/ client-side-compute stop-gap; Q-010 → #FU-19) →
iter 19 (T-W-CUSTOM + T-W-SMART + T-M-CUSTOM — 3-worker
parallel; custom+smart collections live cross-platform; **closes
Stage 05 mobile**; T-M-CUSTOM combines custom+smart per the spec
while web splits into two tasks).

iter 20 dispatching now (FINAL iter of the night per Pablo's
"finish current + next batch and call it a night"):
T-W-SHAREABLE-PUBLIC (public OG-imaged shareable pages) +
T-W-AFFILIATE-LINKS (TCGplayer buy-CTAs on card detail; touches
both web and a tiny mobile component). Two workers, orthogonal
owns_paths. **These close Stage 04 web entirely (8/8) and
finish the entire frontend foundation.**

After iter 20 lands, every Phase 0-5 task is merged: foundation
(Phase 0), data layer (Phase 1), backend core (Phase 2), shared
packages (Phase 3), web (Phase 4), mobile (Phase 5). Remaining
work splits into ops + advanced features: scanner (Stage 06),
ML (07), integrations (08), admin (09), billing (10), deploy
(11). 32 tasks remaining.

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

## Iter 19 close summary (custom + smart trio; Phase 5 mobile complete)

Three workers, three orthogonal owns_paths trees, three clean
merges. **Third consecutive 3-worker iter (16/17/19) with zero
pnpm-lock conflicts** — the lockfile section pattern (web vs
mobile vs packages) is reliably mergeable in parallel.

| Task | Status | PR / commit | Tests | Highlight |
|---|---|---|---|---|
| T-M-CUSTOM | merged | #65 (`487fef4`) | +107 (412 total in @binderly/mobile) | Combined custom + smart in one task per `PROJECT.md` § 9 (vs web's split). All 5 screens live under `/collections/...` NOT under `(tabs)/` — bottom tab bar stays at 5 fixed tabs per `rules/05-mobile.md`. PrintingPicker + smart-editor Run preview both source from owned printings (cap 200); catalog-wide picker + server-evaluated preview deferred to v2 follow-ups. Plan-gating via `useSubscriptionQuery` + `isPaidTier` derived selector. Two-step inline delete (jsdom doesn't render Alert.alert). Smart detail tolerates expressions that no longer parse (fix-via-Edit notice instead of crashing). `vi.hoisted({ routerMocks })` everywhere. **Closes Stage 05 mobile (5/5).** |
| T-W-CUSTOM | merged | #64 (`f796e2e`) | +54 (278 total in @binderly/web) | Two routes (list + detail). 3-cap gate on free with upsell tooltip. **Modal primitive rolled in-tree** at `components/collections/custom/Modal.tsx` (Esc + backdrop close, ARIA dialog) since `@binderly/ui` doesn't ship `<Modal>` yet — proposed T-SP-UI-MODAL follow-up. **Inline-edit fields use raw `<input>`/`<textarea>`** since `<Input>` doesn't expose `onBlur` — proposed T-SP-UI-INPUT-BLUR follow-up. Drag-to-reorder skipped per the "ship if small" brief guidance; members in `addedAt` order. **Smart-kind 404**: smart and manual share id space; manual detail renders only `kind === 'manual'`, others trigger `notFound()` (clean boundary with T-W-SMART). Optimistic update strategy: local mutation, rollback on rejection with non-blocking banner. No api-client edits needed. |
| T-W-SMART | merged | #63 (`b59c427`) | +37 (289 total in @binderly/web) | Three routes (list + new + detail). Client-side DSL evaluation for v1 (fetched printings cap 200, `evaluate()` locally) — server-side compile-to-SQL is the v2 follow-up. Plan-gating via `getMySubscription`. **Save flow reuses the custom-collection persistence path** (smart and manual share id space; saved smart collection is a `custom_collection` row with `kind === 'smart'` + `dsl_expression` field) — mirror of the T-W-CUSTOM smart-kind 404 boundary. No api-client edits needed (all ops exposed at iter 16 via T-BE-EDGE-FUNCTIONS). |

Final migration sequence on main: monotonic 0000-0017 (no new
migrations in iter 19).

## Iter 20 dispatch — web tail (Stage 04 cap)

Two workers, two orthogonal owns_paths. **These close Stage 04
web (8/8) and finish the entire frontend foundation.**

| Task | Stage | Effort | Owns paths | Depends on (all merged) | Why now |
|---|---|---|---|---|---|
| T-W-SHAREABLE-PUBLIC | 04-web | L | `apps/web/app/c/` | T-W-COLLECTION | Public shareable pages (no auth required; SSR + OG images). User shares a link like `/c/[handle]/[slug]` and viewers see a read-only snapshot of the collection. Foundation for organic growth. |
| T-W-AFFILIATE-LINKS | 04-web | S | `apps/web/lib/affiliate/`, `apps/web/components/buy-cta/`, `apps/mobile/src/components/buy-cta/` | T-W-BROWSE | TCGplayer affiliate "Buy" CTAs on card detail (web + mobile). Smaller scope than the other web tasks; the only iter-20 task that also touches mobile (single component under `apps/mobile/src/components/buy-cta/` — won't conflict since mobile is now done). |

After iter 20 lands tonight, **Phases 0-5 will all be complete**:
foundation, data layer, backend core, shared packages, web,
mobile. Remaining work (Stages 06-11): scanner, ML,
integrations, admin, billing, deploy. 32 tasks, all backend /
mobile-scanner / ops surfaces. Logical next iter (when Pablo
resumes after the night): open the scanner stage with
T-SC-CAMERA + T-SC-EMBED-MODEL as a parallel pair, OR tackle
#FU-19 (server-side completion endpoint) + #FU-17 (wire
pricing-display into Card{View,Screen}) as a backend tidy-up
iter.

## Iter 18 close summary (cross-platform collection)

Two workers, two orthogonal owns_paths trees, two clean merges
(zero pnpm-lock conflicts — same lucky pattern as iter 17 since
web-vs-mobile lockfile sections don't overlap).

| Task | Status | PR / commit | Tests | Highlight |
|---|---|---|---|---|
| T-W-COLLECTION | merged | #61 (`402d59e`) | +53 (223 total in @binderly/web) | Soft auth gate via `<SignInPrompt>` with `/auth/sign-in?next=…` link (never crashes, never auto-redirects). `@binderly/set-completion` wired via top-level `computeCompletion()`; per-set rollups come from the same call's `perSet` array (no math duplication in tests). No new api-client methods needed — `client.collection.listCollectionItems` already exposes the cursor-paged list. Tab state mirrors `?tab=` via `router.replace` (local state is source of truth; URL sync only fires when explicit URL value disagrees). `ProgressBar` lives in `components/collection/`, not `@binderly/ui` (single consumer; lift later). Q-009 in-PR resolve pattern applied for `(tabs)/collection/` placeholder collision. |
| T-M-COLLECTION | merged | #62 (`7339ab0`) | +64 (305 total in @binderly/mobile) | Symmetric to T-W-COLLECTION. Soft auth gate with inline prompt + sign-in `router.push`. `CollectionSetScreen` loads the full per-set roster (`listCardsInSet` + per-card `listPrintingsForCard` fan-out) once and hands a complete `ComputeCompletionInput` to `computeCompletion()`. `CollectionScreen` does NOT load that roster — computes Set % on-device against `set.total` and PARKS Master % at 0 with "Open set to compute" affordance. **Same trade-off as T-W-COLLECTION's `catalogRoster()` — both client-side fanout as v1 stop-gap.** Slug = `canonical_key` (mirrors T-M-BROWSE; still diverges from T-W-COLLECTION's UUID — see #FU-18). `vi.hoisted({ routerMocks })` applied per follow-up #13. **Q-010 raised, logged as #FU-19** (see below). |

**Q-010 ratification (at merge time of PR #62):** Both COLLECTION
workers converged independently on the same v1 stop-gap —
compute completion on-device by fanning out catalog reads —
because the materialised-view endpoint (`mv_user_set_completion`
+ `mv_user_global_completion`) promised by `PROJECT.md § 8`
doesn't have a read-side wrapper exposed to clients yet.
**Accepted as v1 posture.** This works for sizes we care about
in v1 (~few hundred sets, ~100-300 cards/set), and both screens
display "Open set to compute" / partial-Master% as honest UI
when the on-device fanout is incomplete. **Q-010 closed**;
re-opened as architectural follow-up #FU-19.

Final migration sequence on main: monotonic 0000-0017 (no new
migrations in iter 18).

## Iter 19 dispatch — custom + smart trio

Three workers, three orthogonal owns_paths trees, different
agent roles. Web splits custom and smart into two tasks per the
spec; mobile combines them into one wider task.

| Task | Stage | Effort | Owns paths | Depends on (all merged) | Why now |
|---|---|---|---|---|---|
| T-W-CUSTOM | 04-web | M | `apps/web/app/collections/custom/` | T-W-COLLECTION | Manual custom collections (3-cap on free tier). First gated-feature surface. Foundation for the broader subscription gate UI. |
| T-W-SMART | 04-web | L | `apps/web/app/collections/smart/` | T-W-COLLECTION + T-SP-SMART-DSL | Smart collection editor + browser (search free, save paid; gated UI). Consumes `@binderly/smart-collection-dsl` for the DSL itself (parser + evaluator + SQL compiler + explainer all already shipped at iter 16). |
| T-M-CUSTOM | 05-mobile | L | `apps/mobile/src/screens/collections/` | T-M-COLLECTION + T-SP-SMART-DSL | Mobile custom + smart, combined per the spec. Wider scope because mobile ships custom+smart as one feature (vs web's split). **Closes Stage 05 mobile (5/5 mobile tasks merged).** |

**Three-way parallelization rationale:** zero file-tree overlap;
T-W-CUSTOM and T-W-SMART are parallel-safe-with per dependencies.yaml
(both under `apps/web/app/collections/` but different subdirs;
neither touches the other's components or lib). T-M-CUSTOM is
mobile-only. All three modify root `pnpm-lock.yaml` (new app
deps likely) but the iter-16/17 luck pattern says GitHub auto-
merge should handle it; if not, standard `--theirs + reinstall`
resolution per the playbook.

After iter 19 lands, remaining stages:
- Stage 04 web: T-W-SHAREABLE-PUBLIC + T-W-AFFILIATE-LINKS
  (both small-to-medium; can run as a parallel pair iter 20).
- Stage 05 mobile: DONE.
- Stages 06-11: scanner + ML + integrations + admin + billing +
  deploy/launch — 32 tasks remaining. Scanner (T-SC-CAMERA,
  T-SC-EMBED-MODEL, T-SC-DETECT, T-SC-ANN-INDEX, T-SC-MATCH,
  T-SC-UX, T-SC-MULTISHOT) is the largest remaining chunk and
  begins parallelizable work from iter 20+ once frontend tail
  is done.

## Iter 17 close summary (Stage 03 cap + cross-platform browse)

Three workers, three orthogonal owns_paths, three independent
deliverables. All three modified the root `pnpm-lock.yaml`;
**GitHub auto-merged all three with zero conflicts** (each
worker added deps in non-overlapping sections — packages/,
apps/web/, apps/mobile/). No `--theirs + reinstall` dance
needed for the first time across iters 12-17.

| Task | Status | PR / commit | Tests | Highlight |
|---|---|---|---|---|
| T-SP-PRICING-DISPLAY | merged | #59 (`b2ab9bf`) | 144 | Pure-logic FX-aware price formatting. USD-base FX with cross-currency composition through USD. Identity path skips lookup entirely. Fallback walks BACKWARD only (up to N days; default 7), never forward. Cross-currency `rateDate` reports the OLDER of the two underlying legs (honest about freshness). 7 supported currencies (USD + 6 Frankfurter quotes — worker shipped 7 vs brief's 6; **accepted at merge**). `bestEffortConvert` distinguishes `RangeError` (programmer error → 400) from `Error` (data gap → 503). All three bonus helpers shipped (range, current-price-row, best-effort). **Closes Stage 03 shared packages (4/4).** |
| T-M-BROWSE | merged | #58 (`85972cd`) | +73 (241 total in @binderly/mobile) | FlatList over FlashList (no new native dep; v1 catalog sits inside FlatList's range). Slug = `printing.canonical_key` (e.g. `en-base1`) for `/sets/[slug]` — URL-friendly; resolved via `useSetBySlugQuery` against the same `/v1/sets` cache. CardScreen hero picks HOLO printing if present. TanStack Query data layer at `apps/mobile/src/lib/browse/`. Route wrappers under `apps/mobile/app/` are 2-line re-exports from owns_paths. Follow-up #13 honoured: `vi.hoisted({ routerMocks })` pattern in all three screen-level navigation tests. |
| T-W-BROWSE | merged | #60 (`8b87630`) | +59 (171 total in @binderly/web) | Server-component pages + `dynamic = 'force-dynamic'` + lazy api-client construction in client `*Route` glue components inside useEffect — iter-14 W-SHELL hotfix lesson applied verbatim. `unset NEXT_PUBLIC_SUPABASE_* && pnpm --filter @binderly/web build` ✅. Narrow `BrowseApi` interface (4 methods); props injection beats module mocks. `notFound()` invoked synchronously during render via `kind: 'not-found'` state flag. **Uses raw UUIDs** for `/sets/[id]` and `/cards/[id]` (api-client only exposes by-id; diverges from T-M-BROWSE's slug — see #FU-18). **Q-009 raised AND resolved in-PR** via sibling `chore(web)` commit deleting the colliding `(tabs)/browse/page.tsx` placeholder. |

**Q-009 resolution (at merge time of PR #60):** T-W-SHELL's
shell-bootstrap placeholder at `apps/web/app/(tabs)/browse/page.tsx`
collided with T-W-BROWSE's authoritative
`apps/web/app/browse/page.tsx`. Both map to `/browse` in Next.js
App Router (the `(tabs)` group adds no URL segment). Worker chose
Option 1 (delete placeholder + drop its test); other three
`(tabs)/*` placeholders untouched until their feature tasks land
(T-W-COLLECTION will reclaim `(tabs)/collection/`). Q-009 closed.

**URL convention divergence between web and mobile (#FU-18):**
T-W-BROWSE went with UUID-based `/sets/[id]` and `/cards/[id]`
(api-client only exposes by-id). T-M-BROWSE went with
slug-based `/sets/[slug]` resolving against the `/v1/sets` list
cache. Both work. Future cross-platform consolidation task can
pick one (likely slug, after a `getSetBySlug` endpoint lands)
and migrate the other; logged as follow-up #18 below.

Final migration sequence on main: monotonic 0000-0017 (no new
migrations in iter 17).

## Iter 18 dispatch — cross-platform collection pair

Two workers, two orthogonal owns_paths, same agent-role pairing
as iters 14/15 (web vs mobile). Both depend on the just-merged
shared packages (set-completion, pricing-display) and the
already-merged auth + browse foundations.

| Task | Stage | Effort | Owns paths | Depends on (all merged) | Why now |
|---|---|---|---|---|---|
| T-W-COLLECTION | 04-web | L | `apps/web/app/collection/` | T-W-AUTH + T-SP-SET-COMPLETION | First auth-gated web feature. Personal collection home + per-set progress bars (Set %, Master %, All Pokémon %). Foundation for T-W-CUSTOM (manual custom collections) and T-W-SMART (smart collection DSL UI). |
| T-M-COLLECTION | 05-mobile | L | `apps/mobile/src/screens/collection/` | T-M-AUTH + T-SP-SET-COMPLETION | Cross-platform sibling. Same backend contract, mobile-native UX (pull-to-refresh, list virtualization, per-set chevron rows). Foundation for T-M-CUSTOM. |

**Why two and not three:** affiliates (T-W-AFFILIATE-LINKS, S) and
scanner stage (T-SC-*) are unblocked, but the collection pair
is the natural next critical-path step — it unblocks the entire
custom/smart collection chain. Affiliates can ride along in iter
19 after the collection pair lands.

## Iter 16 close summary (Stage 02 cap + 2 shared packages)

Three workers, three orthogonal owns_paths, three independent
deliverables. Two of the three modified the root `pnpm-lock.yaml`
so the second of them (SMART-DSL) needed a `--theirs` lockfile
resolution + reinstall before re-running CI. EDGE-FUNCTIONS has
its own Deno lockfile under `infra/supabase/functions/` —
intentionally outside the pnpm workspace — so it didn't touch
the root lockfile at all.

| Task | Status | PR / commit | Tests | Highlight |
|---|---|---|---|---|
| T-BE-EDGE-FUNCTIONS | merged | #54 (`15d63b3`) | 231 | Single `v1` Edge Function muxes every `/v1/me/...` REST path the merged api-client calls (mirrored zod write-schemas + fluent fake Supabase client for test harness) instead of one function per op — the api-client URL contract works without refactor and the function bundle stays self-contained for `supabase functions deploy`. RLS-aware Postgres client bound to caller JWT. Bulk-update is a transactional snapshot-and-revert. Recompute is a deferred-202 stub until SET-COMPLETION wiring lands in iter 17. **Closes Stage 02.** |
| T-SP-SET-COMPLETION | merged | #55 (`e6e82d7`) | 125 | All Pokémon % shipped **per-card** matching `PROJECT.md § 8` and `mv_user_global_completion.unique_cards_owned` (not the dispatch brief's per-species framing). **Q-008 ratified at merge time as accepted.** CI perf assertion bumped to 500ms (from dispatch's 100ms target) because GitHub Actions standard runners can't reliably hit 100ms; dev-hardware steady-state remains ~10-15ms. 100ms preserved as a goal in README. |
| T-SP-SMART-DSL | merged | #56 (`3c6f56d`) | 212 | Every leaf comparison wrapped in `(...) IS TRUE` in the SQL compile path so Postgres tri-valued logic matches JS evaluator boolean coercion for nullable columns; verified by a 200-case round-trip property test (random AST → JS eval → SQL compile → in-memory rows → assert row sets match). SQL-injection safe by construction (parameterized bindings, identifier whitelist). |

**Q-008 ratification (at merge time):** All Pokémon % is per-card,
not per-species. The set-completion worker followed the canonical
source (`PROJECT.md § 8` + the `mv_user_global_completion`
column shape that's been per-card all along) over the dispatch
brief's looser "per Pokémon species" framing. If we ever want a
per-species variant (e.g. "you own at least one printing of each
of 1025 Pokémon"), it's a single-file additive — separate
function on the same package, no API breakage. **Decision:
accept per-card as the v1 semantic.** Q-008 closed.

Final migration sequence on main: monotonic 0000-0017 (no new
migrations in iter 16).

## Iter 17 dispatch — pricing + cross-platform browse

Three workers, three orthogonal owns_paths trees, three different
agent roles:

| Task | Stage | Effort | Owns paths | Depends on (all merged) | Why now |
|---|---|---|---|---|---|
| T-SP-PRICING-DISPLAY | 03-shared-packages | M | `packages/pricing-display/` | T-DL-FX-RATES + T-BE-API-CONTRACTS | Closes Stage 03 shared packages (4/4). FX-aware price formatting blocks browse + card-detail price display, so this needs to land before T-W-BROWSE and T-M-BROWSE can render prices. Pure-logic package; no app code. |
| T-W-BROWSE | 04-web | L | `apps/web/app/browse/`, `apps/web/app/sets/`, `apps/web/app/cards/` | T-W-SHELL + T-BE-API-CLIENT + T-DL-SEED-INGEST | First end-user-visible web feature on top of the shell. Will consume the `@binderly/api-client` + (eventually) pricing-display. |
| T-M-BROWSE | 05-mobile | L | `apps/mobile/src/screens/browse/`, `apps/mobile/src/screens/set/`, `apps/mobile/src/screens/card/` | T-M-SHELL + T-DL-SEED-INGEST | Cross-platform sibling of T-W-BROWSE. Same backend contract. Will consume `@binderly/api-client` + (eventually) pricing-display. |

**Three-way parallelization rationale:** zero file-tree overlap;
pricing-display will land first (smallest effort, no app
dependencies), then the browse pair can absorb it as a peer
workspace dep in a follow-up if needed. Both browse workers will
likely modify root `pnpm-lock.yaml` (new app deps) — first-in
wins the clean merge, second-in does the standard `--theirs +
reinstall` dance (we've done this 5+ times now; takes ~30s).

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

All other open questions (Q-002 / Q-003 / Q-004 / Q-005 / Q-006 /
Q-008 / Q-009 / Q-010) are closed.
**Q-010** (raised by T-M-COLLECTION worker, PR #62) ratified at
merge time: both COLLECTION workers independently converged on
client-side-compute as the v1 stop-gap for completion %, since
the `mv_user_set_completion` materialised-view endpoint isn't
exposed to clients yet. Re-opened as architectural follow-up
#FU-19 (build server-side `/v1/me/collection/completion`
endpoint to read both materialised views; both COLLECTION
screens then migrate from client-side fanout to direct read).
**Q-002** (Docker Desktop bouncing — raised 2026-04-30) explicitly
acknowledged closed by Pablo on 2026-05-15 ("this is solved") on
top of the existing 2026-05-04 RESOLVED note.
**Q-008** (raised by T-SP-SET-COMPLETION, PR #55) closed at merge
time: All Pokémon % is per-card, matching `PROJECT.md § 8` and
the `mv_user_global_completion.unique_cards_owned` column.
**Q-009** (raised by T-W-BROWSE worker mid-task, PR #60) resolved
in-PR: shell's `(tabs)/browse/page.tsx` placeholder collided with
the new `/browse` route; worker deleted the placeholder + its
test in a sibling `chore(web)` commit. Other three `(tabs)/*`
placeholders untouched.

## Last 5 merges

- T-W-SMART — `b59c427` (web smart collections; +37 tests; client-side DSL eval; plan-gated save; reuses custom-collection persistence with kind='smart') — **iter 19 cap**
- T-W-CUSTOM — `f796e2e` (web manual custom collections w/ 3-cap on free; +54 tests; in-tree Modal primitive; smart-kind 404 boundary)
- T-M-CUSTOM — `487fef4` (mobile custom+smart combined; +107 tests; routes under /collections/... not bottom tab; **closes Stage 05 mobile 5/5**)
- T-M-COLLECTION — `7339ab0` (mobile CollectionScreen + CollectionSetScreen; +64 tests; client-side-compute v1 stop-gap; Q-010 ratified as #FU-19; vi.hoisted router mocks) — **iter 18 cap**
- T-W-COLLECTION — `402d59e` (web /collection + /collection/sets/[id]; +53 tests; soft auth gate via SignInPrompt; same client-side-compute v1 stop-gap as mobile; Q-009 in-PR resolve for `(tabs)/collection/`)

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
16. **Iter-17 pre-rendered placeholders waiting on pricing-display.** T-W-BROWSE's `CardView` and T-M-BROWSE's `CardScreen` both render an explicit "Prices coming soon" placeholder section. Now that `@binderly/pricing-display` is merged in iter 17, an iter-18+ pass should wire it into both `Card*` views. May also need a new `/v1/printings/:id/prices` (or `/v1/printings/:id/current-price`) endpoint exposed by edge functions to expose the `mv_current_price` row to clients — currently the read API doesn't surface prices. Could be a tiny T-BE-EDGE-FUNCTIONS-V2 follow-up, or fold into the iter-18 collection-detail work if natural. **Logged as #FU-17.**
17. **(Reserved — duplicate slot; see #FU-17 above.)**
18. **URL convention divergence between web and mobile browse routes.** T-W-BROWSE uses raw UUIDs for `/sets/[id]` and `/cards/[id]` (api-client only exposes by-id). T-M-BROWSE uses slug-based `/sets/[slug]` resolving against the `/v1/sets` list cache (e.g. `en-base1`). Both work; both shipped green. T-W-COLLECTION inherited UUID; T-M-COLLECTION inherited slug — divergence persists in iter 18. Future cross-platform consolidation: pick one convention (probably slug, after a `getSetBySlug` endpoint lands) and migrate the other. Low priority — neither is user-visible while routes are SSR-hidden. **Logged as #FU-18.**
19. **Server-side `/v1/me/collection/completion` endpoint (Q-010 ratified).** Both T-W-COLLECTION and T-M-COLLECTION ship a client-side-compute v1 stop-gap: fan out catalog reads, pre-project `{cards, printings}` + owned-ids, hand to `computeCompletion()`. Works for v1 sizes, but is O(catalog) per page-load. The fix is a backend endpoint exposing the existing `mv_user_set_completion` and `mv_user_global_completion` materialised views directly, so both screens read O(1) rows instead. Spec is in `PROJECT.md § 8`; the mv definitions already exist in the data layer (Phase 1) but lack a read-side wrapper. Likely a `T-BE-EDGE-FUNCTIONS-V2` follow-up or a small new edge-function task. **Logged as #FU-19.**
20. **`@binderly/ui` `<Modal>` primitive missing.** T-W-CUSTOM rolled a modal in-tree at `apps/web/components/collections/custom/Modal.tsx` (Esc + backdrop close, ARIA dialog, no focus trap). T-W-SMART likely makes the same trade-off; iter-20+ tasks will too. Proposed `T-SP-UI-MODAL` follow-up to hoist a shared cross-platform modal into `@binderly/ui` once 2+ consumers are in main. **Logged as #FU-20.**
21. **`@binderly/ui` `<Input>` doesn't expose `onBlur` / `onEndEditing`.** T-W-CUSTOM's detail screen uses raw `<input>`/`<textarea>` for inline-edit name/description because the shared `<Input>` wrapper doesn't surface blur events. Future T-SP-UI-INPUT-BLUR adds the prop pass-through (additive). **Logged as #FU-21.**
22. **Catalog-wide PrintingPicker on mobile.** T-M-CUSTOM's `<PrintingPicker>` (manual collection "Add cards" flow) sources from the user's OWNED printings, not the full catalog. Tight v1 scope; product can lift this later if "browse-and-add" becomes a friction point. Same goes for T-M-CUSTOM's smart-editor Run preview (also owned-only). **Logged as #FU-22.**
23. **Server-evaluated smart-collection preview.** Both T-W-SMART and T-M-CUSTOM evaluate smart-collection expressions client-side via `@binderly/smart-collection-dsl`'s `evaluate()` on a 200-printing preview window. For larger collections / future "run against entire catalog" semantics, the right shape is a server-side compile-to-SQL via an edge function (`@binderly/smart-collection-dsl`'s `compileToSql()` already supports this). **Logged as #FU-23.**

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
