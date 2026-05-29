# Build status — **Iter 33 closed.** **Stage 09 offline-sync CLOSED (3/3).** **Scanner stage CLOSED (6/6).** ✅ **Stage 07 grading CLOSED (10/10)** (T-GR-COMMUNITY-FLYWHEEL merged — the first-party data flywheel). Stage 08 shareables **2/3** (T-SH-THEMES remains — now unblocked). Stage 10 paywall/billing **3/4** (RevenueCat + Paddle + unified `@binderly/entitlements` keystone merged; only T-PB-GATING remains — now unblocked). Stage 11 deployment **4/6 scaffolded** (Vercel/Fly/Supabase-prod/R2-prod inert until Pablo provisions secrets per `infra/DEPLOYMENT_SECRETS.md`; T-DP-EAS + T-DP-MONITORING remain). **Functional chain unblocked:** T-PB-ENTITLEMENTS opened T-PB-GATING + T-SH-THEMES + T-GR-COMMUNITY-FLYWHEEL (iter-34 candidates). **Open question:** Q-021 (api-python has no HTTP entrypoint — Fly serving deploy needs a FastAPI entrypoint; tracked with #FU-53 go-live). 78/86 tasks merged.

**Phase 0:** Complete (10/10 merged).
**Phase 1:** Complete (23/23 merged) — closed at iter 11; +1 in iter 24 (T-DL-RLS-PG-STAT-REVOKE).
**Phase 2 backend (Stage 02):** **Complete (5/5 merged)** — closed at iter 16; +1 in iter 21 (T-BE-EDGE-FUNCTIONS-V2); +1 in iter 23 (T-BE-Q013-CLEANUP).
**Phase 3 shared packages (Stage 03):** **Complete (4/4 merged)** — closed at iter 17.
**Phase 4 web (Stage 04):** **Complete (8/8 merged)** — closed at iter 20; +1 in iter 22 (T-W-API-V2-WIRING).
**Phase 5 mobile (Stage 05):** **Complete (5/5 merged)** — closed at iter 19 with T-M-CUSTOM; +1 in iter 22 (T-M-API-V2-WIRING).
**Stage 06 scanner:** ✅ **CLOSED — 6 / 6 merged** (T-SC-CAMERA #71, T-SC-EMBED-MODEL #72 — iter 23; T-SC-ANN-INDEX #76, T-SC-DETECT #77 — iter 25; T-SC-MATCH #78 — iter 26; T-SC-UX #80 — iter 27). End-to-end pipeline + UI live: camera surface → frame-processor detect → mobilenet embed → flat FP16 ANN search → confidence/stability gate → MatchOverlay or DisambigPicker → stack-mode review.
**Stage 07 grading:** ✅ **CLOSED — 10 / 10 merged** (T-GR-CAPTURE-UX #79 — iter 26; T-GR-CENTERING #81 — iter 27; T-GR-DATA-PSA #82, T-GR-DATA-EBAY #83, T-GR-DATA-AUCTIONS #84 — iter 28; T-GR-CORNERS #86 — iter 29; T-GR-EDGES #87, T-GR-SURFACE #88 — iter 30; T-GR-AGGREGATE — iter 31; T-GR-COMMUNITY-FLYWHEEL — iter 34). Capture + centering + 3 data scrapers + 3 sub-grade models + `ml_common/` shared training infra + final-stage PSA-calibrated aggregator with 3-band categorical confidence + the **community submission flywheel** (the first-party labelled-data inflow that powers the long-term accuracy loop). **T-GR-COMMUNITY-FLYWHEEL** closes the stage: pro users submit their real graded-card outcomes (slab cert + the photos they captured) which the Python ingestion (`apps/api-python/grading/flywheel/`: validation + cross-company grade/cert normalization + dedup) turns into `grading_training_sample` rows with `source='community_flywheel'` — mock-by-default with a live env gate, mirroring the iter-28 scrapers. Mobile pro-gated submission flow (`apps/mobile/src/grading/community/`) with client-side validation, idle/submitting/success/already_submitted/error states, consent gate + paywall CTA; gating via the `@binderly/entitlements` fallback (`getMyEntitlements()` + `grading_prediction`) since T-PB-GATING hadn't merged. New user-owned `community_submission` table + owner-CRUD RLS (migrations 0025/0026; verify-rls 137/0 incl. 4 new community-submission assertions); ingestion into `grading_training_sample` stays service-role. Image refs persisted as URLs (full ingest deferred to #FU-39); cross-company calibration is a conservative same-grid mapping (raw company + grade stored; proper calibration is #FU-56). **121 pytest + 43 mobile vitest** (both above their 40+/30+ targets). Edge submission handler deferred to #FU-55 (client + contract precede the handler, mirroring the `entitlements`/`grading` resource pattern).
**Stage 08 shareables polish:** **2 / 3 merged** (T-SH-OG-IMAGES — iter 32; T-SH-CONFIG-MODEL — iter 32). T-SH-OG-IMAGES ships the dynamic OG image route at `/api/og/share/[handle]/[slug]` (1200×630 PNG hero; gradient background; top-left wordmark; centre title; 4-tile lower row from member thumbnails with 2 s per-image timeout + brand-coloured silhouette fallback; footer URL + stat line; `Cache-Control: public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800` on success, `public, max-age=3600` on fallback; unknown handle / `is_public=false` / network failure all serve a generic Binderly-branded fallback PNG instead of 404 since social platforms cache 404s; public page `generateMetadata` now wires `<meta property="og:image">` + Twitter card images at the new route). T-SH-CONFIG-MODEL ships the owner-side share config + settings UI on web (`/settings/shareables`) + mobile (`/settings/shareables` Expo Router route) mapped onto the already-merged `profile` (handle, displayName, bio) + `shareable` (slug, theme, show toggles) tables; Q-020 escalated + closed in same iter — dispatch brief's `user_share_config` proposed schema collapsed onto the existing two-table physical model via new `checkHandleAvailability()` on `ProfileResource` + `shareableHandleSchema` in `@binderly/api-contracts`; UI degrades gracefully when the backend `/v1/me/handle-available` endpoint isn't deployed yet — surface shows "we'll verify on save" copy (#FU-52 logs the matching backend route). Kill-switch (`is_active`) + `social_links_json` deferred to follow-ups #FU-50 + #FU-51 since they need DB schema additions outside the narrowed scope of this task. T-SH-THEMES remaining.
**Stage 10 paywall / billing:** 3 / 4 merged (T-PB-REVENUECAT + T-PB-PADDLE — iter 32; T-PB-ENTITLEMENTS — iter 33). **T-PB-ENTITLEMENTS** ships the keystone unified entitlement service making RevenueCat the canonical *read* path: new `@binderly/entitlements` package (`model.ts` canonical `Tier` + 9-entry `PaidFeature` union from PROJECT.md § 16 + `FREE_LIMITS` {customCollections:3, shareables:1} + `PRO_ENTITLEMENT_ID='pro'`; `can.ts` pure `canUseFeature`/`withinFreeLimit` gate helpers; `revenuecat-client.ts` resilient fail-closed RC REST read over `GET /v1/subscribers/{id}` — any network/non-200/malformed/missing-key error → `{tier:'free', source:'fallback'}`, never throws) + `GET /v1/me/entitlements` Edge endpoint (slotted into the existing single `v1` mux as `_shared/handlers/entitlements.ts` + route, NOT the stub's `functions/entitlements/` dir — path divergence noted; reads authed user id as RC `app_user_id`, env-missing `REVENUECAT_SECRET_API_KEY` → free fallback + 200 + logged warn, never 500) + `entitlements` resource (`getMyEntitlements()`) on api-client + `entitlementsDto` on api-contracts. RC read logic is **mirrored** in the edge handler (Deno bundle can't import workspace pkgs — same constraint as `_shared/contracts.ts`), pinned to § 16 by a parity test. **Canonical `PaidFeature` reconciliation:** spec matrix wins over mobile's 8-entry union (renames: `pricing_graphs`→`pricing_history`, `export_csv`→`export_data`, `remove_branding`→`shareable_themes`, `cloud_ai_scan_fallback`→`cloud_ai_scan`; adds `save_smart_collections`); migrating `apps/mobile/src/billing/` to import the hoisted union is T-PB-GATING's job. **+104 tests** (73 `@binderly/entitlements` ≥40 target; +8 api-contracts → 258; +7 api-client → 270; +16 edge-fn → 329). lint / typecheck / build green locally. No Q raised (RC GET-subscriber lazily returns empty subscriber → new users read free, no creation step / product decision). Raised #FU-53 (entitlement-fallback observability). T-PB-ENTITLEMENTS unblocks T-PB-GATING + T-SH-THEMES + T-GR-COMMUNITY-FLYWHEEL. T-PB-PADDLE ships Paddle MoR (Merchant of Record) checkout shipped on web at `/billing` with auth-gated, env-degrading UI (free → 2 plan cards monthly + annual / pro → manage-via-Paddle stub) backed by `@paddle/paddle-js@1.6.4` overlay; HMAC-SHA256 webhook verifier at `/api/paddle/webhook` (5-minute timestamp tolerance, `node:crypto` `timingSafeEqual`) maps 7 Paddle event types (`subscription.created|activated|canceled|past_due|paused|resumed`, `transaction.completed`) to RevenueCat REST grants/revokes (server-side `forwardEntitlement` against `/v1/subscribers/:id/entitlements/pro/promotional`); 2 SQL migrations land `paddle_webhook_log` audit table (event id unique for idempotency, action ∈ {grant, revoke, ignore}, retry flag, jsonb payload) under service-role-only RLS (verify-rls 131/0 incl. `paddle_webhook_log` × 3 new assertions). Webhook returns 401 on invalid signature, 503 on missing `PADDLE_WEBHOOK_SECRET`, 200 + retry-flag on RC downstream failures (Paddle's at-least-once retries don't re-grant; the audit row is the reconciliation seam). Coordinated `'pro'` entitlement-id with T-PB-REVENUECAT via `apps/web/lib/paddle/plans.ts.PRO_ENTITLEMENT_ID`. **+130 vitest tests** across 11 files (env / plans / signature / events / revenuecat / log / client / entitlements / handler / BillingView / BillingRoute) bringing web suite to 629/629 green; lint + typecheck + build all green locally. T-PB-ENTITLEMENTS + T-PB-GATING remaining.
**Stage 09 offline-sync:** ✅ **CLOSED — 3 / 3 merged** (T-OF-LOCAL-DB #85 — iter 29; T-OF-QUEUE #89 — iter 30; T-OF-CONFLICTS — iter 31). Mutation queue + replay engine live (FIFO `sync_queue` table, idle/replaying/paused state machine, `30 s × 2^attempts` backoff capped at 1 h, 10-attempt dead-letter); LWW conflict resolver consumes the dead-letter seam with per-table server-fetcher adapters (paginated walk fallback for entities the api-client doesn't expose a single-GET for; capped at 50 pages / ~5 000 items before degrading to `transient_error` retry), v3 `sync_conflict_log` audit table, direct-SQL `local-writer` for server-wins overwrites (bypasses repository `onLocalWrite` to avoid sync-queue feedback loop), and `onConflictResolved` event emitter for the future `T-M-CONFLICT-UX` toast surface (event-emitter contract shipped; UI integration is a screen-layer follow-up out of Stage 09's scope).
**Stage 11 deployment:** **4 / 6 merged** (T-DP-VERCEL + T-DP-FLY + T-DP-SUPABASE-PROD + T-DP-R2-PROD — iter 33, shipped as one cluster PR on `agent/T-DP-INFRA`). **Scaffolding-complete, awaiting Pablo's production secrets** — all four deploy paths ship inert (each live step guarded on its provider secret, skipped not failed) until the secrets enumerated in `infra/DEPLOYMENT_SECRETS.md` are added to the GitHub repo. Vercel deploy (web) guarded on `VERCEL_TOKEN`; Fly deploy (Python svc) guarded on `FLY_API_TOKEN` **and** the Q-021 HTTP-entrypoint follow-up; Supabase migration CI (`deploy-db.yml`) guarded on `PROD_DATABASE_URL` (idempotent forward-only drizzle migrator, no resets); R2 prod buckets + CORS/lifecycle/access-key docs (policy files only, no live keys). Raised **Q-021** (api-python has no FastAPI/HTTP entrypoint — Fly serving target is batch/CLI-only today). T-DP-EAS + T-DP-MONITORING remain.

**In progress:** 0.
**Blocked:** 0.
**Blocked on humans:** 0 (Pablo has granted full autonomy: "don't wait for my approval to do stuff"; "Run Everything" enabled in Cursor).

Iter 29 ran a mixed-stage pair: T-GR-CORNERS shipped the Corners sub-grade model AND established `apps/api-python/grading/ml_common/` (shared ML infrastructure that T-GR-EDGES + T-GR-SURFACE copy next iter — types, data loader, image loader, training loop, eval metrics, ONNX export helper, confidence band utility); T-OF-LOCAL-DB opened Stage 09 offline-sync with the mobile SQLite schema mirror + 3 typed repositories (UserCollection / CustomCollection / SmartCollection) + the `onLocalWrite` subscribe-hook contract that T-OF-QUEUE consumes next. **Workers reported clean local CI;** post-merge sync on main needed `pnpm install` (not just `--frozen-lockfile`) to pick up 6 new transitive packages T-OF-LOCAL-DB added to the lockfile (`expo-sqlite` + `sql.js` + types) — orthogonal to iter 27's "run `pnpm build` before filtered tests" lesson; the dual lesson is now logged as a single operational note in this iter's close.

**GitHub Actions usage** is at ~90 % of monthly quota — all PRs from iter 24 onward merge without CI gate, with full local CI-equivalent battery (`pnpm lint` / `typecheck` / `test` / `build` + `pytest` where applicable) exercised in the worktree before push. Workers report local-battery pass counts in their summaries for orchestrator audit.

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

**Iter 23 CLOSED 2026-05-20 ~11:00 UTC-4. Three-worker iter:
scanner stage opened (T-SC-CAMERA + T-SC-EMBED-MODEL) +
Q-013 backend perf cleanup (T-BE-Q013-CLEANUP). All three
PRs merged clean. PR #71 carried a small in-PR `fix(mobile)`
hotfix during Pablo's smoke test (removed a stale
`expo-web-browser` entry from `app.json` plugins — T-M-AUTH
leftover that was crashing `expo prebuild`; package ships no
`app.plugin.js`, so the plugin resolver fell through to
`require()`-ing its ESM `build/WebBrowser.js`, which on
Node 20+ followed `require(ESM)` into `expo-modules-core/src/index.ts`
and threw `ERR_UNKNOWN_FILE_EXTENSION`). Same hotfix commit
also switched `apps/mobile/package.json` scripts from
`expo start --ios/android` → `expo run:ios/android` (vision-camera
is native, not in Expo Go). #FU-26 + #FU-27 both closed by #73.
Q-013 closed.**

**Iter 22 CLOSED 2026-05-19 ~15:35 UTC-4. Frontend wiring of the
4 V2 endpoints shipped on both platforms. Web (4 surfaces, +51
tests) and mobile (3 surfaces, +28 tests) sibling workers both
merged clean. #FU-22 closed as a side effect on mobile.**

The client-side stop-gaps from iters 17 / 18 / 20 are now gone:
Master% on `CollectionScreen` reads from `getCompletion()` on
first paint; CardView/CardScreen render real prices; the public
shareable page reads the canonical `publicShareableDto`; smart-
preview Run uses catalog-wide server eval. Only #FU-26 + #FU-27
Q-013 perf cleanups remain, both server-side and transparent to
the frontend.

Iter 21 closed 2026-05-19 ~14:30 UTC-4: 4 additive Edge endpoints
shipped (T-BE-EDGE-FUNCTIONS-V2 #68 → 472fdcf); Q-012 closed;
Q-013 raised for two server-side scope divergences (now logged as
#FU-26 + #FU-27). Iter 20 closed 2026-05-15 ~23:30 UTC-4 with
Stage 04 web at 8/8 and Phases 0-5 ALL complete (frontend
foundation merged).

Progression so far:

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
parallel; custom+smart collections live cross-platform; closes
Stage 05 mobile; T-M-CUSTOM combines custom+smart per the spec
while web splits into two tasks) →
iter 20 (T-W-SHAREABLE-PUBLIC + T-W-AFFILIATE-LINKS — 2-worker
parallel; public OG-imaged shareable pages + TCGplayer buy-CTAs;
closes Stage 04 web 8/8 → frontend foundation COMPLETE;
Q-011 + Q-012 raised, both non-blocking) →
iter 21 (T-BE-EDGE-FUNCTIONS-V2 — single worker, 4 additive
read endpoints in one PR; Q-012 closed, Q-013 raised for
two scope divergences: missing `mv_user_set_completion` /
`mv_user_global_completion` mvs + Edge bundle can't import
`@binderly/smart-collection-dsl`) →
iter 22 (T-W-API-V2-WIRING + T-M-API-V2-WIRING — 2-worker
sibling; wires the 4 V2 endpoints through every web + mobile
surface that had a client-side stop-gap; **closes #FU-22 as
side effect on mobile**; no new open questions raised; Q-013
implicitly answered client-side).

Every Phase 0-5 task is merged: foundation (Phase 0), data layer
(Phase 1), backend core (Phase 2), shared packages (Phase 3),
web (Phase 4 — 8/8), mobile (Phase 5 — 5/5). Remaining work
splits into ops + advanced features: scanner (Stage 06), ML (07),
integrations (08), admin (09), billing (10), deploy (11). 32
tasks remaining.

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

## Iter 29 close summary (Stage 09 offline-sync foundation — T-OF-LOCAL-DB)

Single worker. Shipped the mobile SQLite schema mirror + local repository layer — the foundation for Stage 09 offline sync.

| Task | Status | PR / commit | vitest | Highlight |
|---|---|---|---|---|
| T-OF-LOCAL-DB | merged | #85 (`3005b13`) | 104 / 104 new (1099 total) | 6-table SQLite schema (`user_collection_item`, `custom_collection`, `custom_collection_item`, `smart_collection`, `printing_lite`, `_meta`), forward-only migrations, lazy singleton connection. Three typed repository facades (`UserCollectionRepository`, `CustomCollectionRepository`, `SmartCollectionRepository`) with `onLocalWrite` subscribe-hook seam for T-OF-QUEUE. `expo-sqlite` mocked via sql.js (real SQLite WASM, FK enforcement). |

**Local CI battery (final, on main after merge):**

- `pnpm build` (workspace): 11 / 11 tasks ✓.
- `pnpm --filter @binderly/mobile lint`: 0 warnings ✓.
- `pnpm --filter @binderly/mobile typecheck`: 0 errors ✓.
- `pnpm --filter @binderly/mobile test`: 1099 / 1099 (109 test files) ✓.

**New follow-ups:**

- **#FU-41** — Background browse-history pre-warming for `printing_lite` (scope refined iter 31 by T-OF-QUEUE; Q-016 resolved — `set_logo_url` now in `printing_lite`). Remaining gap: pre-warm thumbnails for *browsed-but-not-collected* printings. Blocked on browse-history repo + screen events.

**Open questions raised:**

- **Q-016** — Should `printing_lite` cache `set.logo_url` for the CollectionScreen set-row renderer, or defer to T-OF-QUEUE? Decision deferred; table can be extended with `ALTER TABLE` in a v2 migration without breaking T-OF-QUEUE.

**Notes:**

- Stage 09 is now partially open: T-OF-LOCAL-DB (foundation) merged; T-OF-QUEUE and T-OF-CONFLICTS remain pending.
- `expo-sqlite` is already part of Expo SDK 52 — no new native deps added. `sql.js` + `@types/sql.js` added as devDependencies only (not in production bundle).

HEAD: `3005b13`. Open questions: 4 non-blocking (Q-007, Q-011, Q-014 deferred to #FU-29, Q-016).

## Iter 29 close summary (Corners sub-grade + ml_common shared infra; Stage 09 offline-sync opened)

Mixed-stage 2-way parallel dispatch: one ML pattern-establisher in grading + one foundation task in offline-sync. Both shipped clean. Iter 29 closes one further task in Stage 07 and opens Stage 09.

| Task | Status | PR / commit | Tests | Highlight |
|---|---|---|---|---|
| T-GR-CORNERS | merged | #86 (`7c14cc2`) | +19 TS (1014 mobile total in worker's local battery) / +117 Python (1 skipped — live-image gate) | Corners sub-grade model. v1 ships a **numpy linear regression placeholder** for CI smoke; production architecture path (MobileNetV3-small backbone → shared trunk over 4 corner patches → average pool → 1-d regression head → clamp to [1.0, 10.0]; MSE loss; MAE primary eval, ±1-grade accuracy ≥ 80% target) is fully documented at `apps/api-python/grading/corners/model.py` behind `CORNERS_USE_TORCH=1`. ONNX export uses Gemm + Clip graph; onnxruntime round-trip test within `atol=1e-4`. **Shared `apps/api-python/grading/ml_common/` shipped** with `types.py` (LabelledGradingSample / ConfidenceBand / SubgradePrediction / TrainingConfig / ModelProtocol / DataLoaderProtocol), `data_loader.py` (PSA / Ebay / Auction / Merged loaders normalising the 3 iter-28 scraper tables → unified shape), `image_loader.py` (mock-by-default; `CORNERS_LIVE_IMAGES=1` gate), `training_loop.py`, `eval_metrics.py`, `model_export.py`, `confidence.py`. EDGES + SURFACE will copy this template + drop in per-sub-grade specifics. TS contract: `createCornersService(impl?)` factory + `defaultCornersService` singleton (returns `not_implemented` until real model deploys) — mirrors CenteringService shape exactly. Raised **#FU-42** (real CNN training pass; blocked on labelled data growth + torch install + #FU-40 printing_id match) and **#FU-43** (on-device ONNX inference via `onnxruntime-react-native`; blocked on #FU-42). |
| T-OF-LOCAL-DB | merged | #85 (`3005b13`) | +104 mobile (995→1099 in worker's local battery) | Mobile SQLite mirror at `apps/mobile/src/db/` + repositories at `apps/mobile/src/repositories/`. **6 tables**: `user_collection_item`, `custom_collection`, `custom_collection_item` (junction with ON DELETE CASCADE), `smart_collection` (flattens server's `custom_collection (kind='smart')` + `smart_collection_rule` 1:1 join — doesn't pay off at mobile scale), `printing_lite` (thin offline-thumbnail cache populated as upsert side-effect for user-interacted printings only), `_meta` (schema version). **Deliberately NOT mirrored**: `photo_urls` (R2 server-only), full card catalog, grading tables, price tables. **3 repositories** with typed CRUD + `findPending()` (returns rows with `sync_status != 'synced'`) + `markSynced()` + `onLocalWrite(observer) => unsubscribe` event-emitter for T-OF-QUEUE. `LocalWriteEvent<T> = { type: 'created' | 'updated' | 'deleted', table, payload, timestamp }`; `sync_status` is one of `synced | pending_create | pending_update | pending_delete`. **expo-sqlite testing**: `vi.mock('expo-sqlite')` backed by `sql.js` (real SQLite WASM via emscripten) in `test-utils/setup.ts`; PRAGMA foreign_keys = ON; databases keyed by name so migration runner + repositories share the same in-memory store within a test. Raised **#FU-41** (full catalog mirror in `printing_lite`; blocked on T-OF-QUEUE). Raised **Q-016** (whether `printing_lite` should cache `set.logo_url` for the CollectionScreen set-row renderer — deferred; can be added via v2 ALTER TABLE without breaking T-OF-QUEUE). |

**Local CI battery (final, on main after stitching):**

- `pnpm build` (workspace): 11 / 11 tasks ✓.
- `pnpm lint`: 12 / 12 packages ✓ (0 warnings).
- `pnpm typecheck`: 20 / 20 packages ✓.
- `pnpm --filter @binderly/mobile test`: **1118 / 1118 across 110 files** ✓ (after `pnpm install` to pick up the 6 new transitive packages T-OF-LOCAL-DB introduced).

**Operational lesson logged (combines iter 27 + iter 29 stitching pains):** when checking out main after a worker that adds workspace dependencies + builds workspace packages, run **`pnpm install && pnpm build`** before any filtered test command. `--frozen-lockfile` is fine for CI but skips installing packages absent from node_modules when they're already in the lockfile; the orchestrator's local sandbox was stale on first checkout. Same pattern as iter 27's dist-not-checked-in issue. This is now the documented orchestrator post-merge sanity flow: `git pull --ff-only && pnpm install && pnpm build && (pnpm --filter <pkg> test || pnpm test)`.

**New follow-ups raised this iter** (logged in Known Follow-ups below):

- **#FU-41 — Background browse-history pre-warming for `printing_lite`** (scope refined iter 31): T-OF-QUEUE ships user-collection sync (Q-016 resolved → `set_logo_url` denormalised into `printing_lite` via v2 migration). #FU-41 now covers the narrower goal of pre-populating `printing_lite` for printings the user has *browsed but not collected* (browse-history mirror), so thumbnails render offline without a collection add. Blocked on: browse-history repository + screen-side browse event emission (future task).
- **#FU-42 — Real CNN training pass for Corners** (T-GR-CORNERS): run `make train CORNERS_USE_TORCH=1` once labelled-data volume grows beyond synthetic fixtures; export trained model to R2. Blocked on #FU-40 printing_id match + Pablo's labelled-data pipeline.
- **#FU-43 — On-device ONNX inference via `onnxruntime-react-native`** (T-GR-CORNERS): replace the `not_implemented` TS stub; evaluate bundle size + per-prediction latency. Blocked on #FU-42 (need a trained model first) + native build evaluation (Pablo's Xcode + Android Studio update — same gate as #FU-29).

**Open questions raised this iter:**

- **Q-016 — Should `printing_lite` cache `set.logo_url`** for the CollectionScreen set-row renderer? Deferred (can ALTER TABLE in a v2 schema migration without breaking T-OF-QUEUE). Not blocking.

Final migration sequence on main: 0000-0022 (no new migrations in iter 29). HEAD: `9e6188a`. Open questions: 4 non-blocking (Q-007, Q-011, Q-014 deferred to #FU-29, Q-016).

**Next iter candidates (ranked):**

1. **T-GR-EDGES + T-GR-SURFACE (parallel pair, copying ml_common).** Both depend only on already-merged tasks; both consume `ml_common/` shipped this iter. Disjoint owns_paths. Closes 8 / 10 of Stage 07. After this lands, T-GR-AGGREGATE (the last ML grading task) becomes dispatchable.
2. **T-OF-QUEUE.** Mutation queue + replay engine. Consumes the `onLocalWrite` event-emitter T-OF-LOCAL-DB shipped. Unlocks T-OF-CONFLICTS downstream. Self-contained mobile-only task; could dispatch in parallel with #1 if a 3-worker iter is desired.
3. **#FU-40 / T-GR-DATA-PRINTING-MATCH.** Backend Python task; fuzzy-match `printing_id` for the 3 grading observation tables. Unblocks #FU-42 (real CNN training needs printing_id-resolved labels).
4. **T-SH-OG-IMAGES.** Self-contained web task; Vercel OG / Satori. Independent of all the above.

## Iter 28 close summary (3 grading data scrapers shipped in parallel; ML training trio unblocked)

Three sibling workers, fully disjoint owns_paths under `apps/api-python/grading/scrapers/<psa|ebay|auctions>/`, all green on local CI, all squash-merged. **Largest parallel batch yet — 3-way dispatch with sibling state-file contention handled cleanly.**

| Task | Status | PR / commit | pytest | Highlight |
|---|---|---|---|---|
| T-GR-DATA-PSA | merged | #82 (`6445405`) | 72 / 72 | PSA cert page parser (httpx + bs4 + lxml). Writes to existing `grading_training_sample` with `source='psa_cert'` (no new migration — the CHECK constraint already allowed it from T-DL-SCHEMA-GRADING). 8 synthetic HTML fixtures: PSA 10 / 9 / 8 / 1 / Authentic / Authentic Altered / PSA 9 [OC] qualifier / Cloudflare-block page. Rate-limited (default 2 s) with clock-mock-exercised tests. SHA-256 content hash for change detection on re-fetch. `PSA_LIVE=1` is the live gate; `fetch_html` is the swap seam for browser-driven backends. |
| T-GR-DATA-EBAY | merged | #83 (`8160ea3`) | 49 / 49 | Finding API `findCompletedItems` with `SoldItemsOnly=true`, category 183454 (Pokémon Individual Cards). New table `ebay_graded_listing_observation` (migration `0021`). Default query matrix: PSA 10 / 9, BGS 9.5 / 9, CGC 10 / 9, SGC 10 / 9. Title regex parser with company priority order + grade-adjacency confidence penalty + BGS sub-grade extraction. 7 JSON fixtures: PSA-10/USD, BGS-9.5+subgrades/USD, CGC-8/USD, SGC-9/USD, unknown-grader/OTHER, misgraded-title (confidence penalty), BGS-9.5/GBP (non-USD currency / pence). Secondary upsert to `grading_training_sample` (`source='ebay_sold'`). Dedup: UNIQUE(listing_id) + run-level seen-set. `EBAY_GRADING_LIVE=1` gate. |
| T-GR-DATA-AUCTIONS | merged | #84 (`50304f4`) | 116 / 116 | Two adapters (PWCC + Goldin) sharing parser utilities under `auctions/_shared/`: grade-from-title regex covering PSA / BGS / CGC / SGC + Black Label sub-grades, currency parser (→ cents + ISO-4217), rate-limited httpx client. PWCC at `/auctions/<slug>/lots?page=N` → `/items/<lot-id>`; Goldin at `/lot-list/?auctionid=<id>&page=N` → `/lot/<year>/<slug>/<id>/`. New table `auction_lot_observation` (migration `0022` — rebased from `0021` after EBAY collision). Hammer + buyer's-premium price columns. 5 fixtures per site (PSA-graded / BGS+subgrades / CGC / raw-card-excluded / multi-card-lot). `AUCTIONS_LIVE=1` gate. |

**Local CI battery (final, on main after all 3 merges):**

- `pnpm build` (workspace): 11 / 11 tasks ✓ (10 cached).
- `pnpm lint`: 12 / 12 packages ✓ (0 warnings).
- `pnpm typecheck`: 20 / 20 packages ✓.
- `pnpm --filter @binderly/mobile test`: 995 / 995 (104 files) ✓.
- `pytest` (3 new subtrees): 72 + 49 + 116 = **237 new Python tests**, all green.

**Follow-up number reconciliation** (3 workers claimed overlapping numbers):

Each worker independently claimed `#FU-37` (and two claimed `#FU-38`) for similar-shaped follow-ups. Reconciled into a single clean set, logged in the numbered list below:

- **#FU-37** — live-fetch verification across all 3 scrapers (PSA `PSA_LIVE=1`, eBay `EBAY_GRADING_LIVE=1` + robots.txt verification for PWCC / Goldin). Cross-cutting concern; Pablo enables when he has the data-collection budget + grading-data API credentials.
- **#FU-38** — browser-driven fetcher fallback (playwright / headless chrome). Shared swap seam at `psa/fetch_html`, `auctions/fetcher.py::_fetch_page`. Needed if PSA's Cloudflare gating triggers or Goldin / PWCC archives turn out to be JS-gated.
- **#FU-39** — image download + Supabase Storage / R2 ingest for graded-slab thumbnails (`thumbnail_url` from eBay) + auction lot images (`lot_image_urls` from PWCC / Goldin). Cross-cutting backend tidy; today the columns hold remote URLs only.
- **#FU-40 — `T-GR-DATA-PRINTING-MATCH` (proposed)** — `printing_id` fuzzy-match resolution pass against the canonical `printings` table. Affects 3 tables: `grading_training_sample` rows from PSA + eBay observations, plus `auction_lot_observation`. Likely uses the existing card-name + set-name + number tuple + a trigram + ANN approach. Substantively its own task; the 3 scrapers all leave `printing_id` NULL intentionally so this pass can run as a single batch job later.

**Operational notes for future iters:**

- **3-way parallel dispatch is sustainable** when owns_paths are clearly disjoint. The only contention was state files (`dependencies.yaml` + `status.md` Last 5 merges + migration numbers) and follow-up number claims, all of which resolved cleanly on rebase. The auction migration's 0021→0022 rename was the only file-level conflict and was handled by the worker without orchestrator intervention.
- **Mock-by-default with env-flag-gated live mode** continues to be the right pattern for scrapers; same shape we used for source adapters in Phase 1. Live verification belongs in a single follow-up task (#FU-37) that Pablo runs once with credentials, not in every scraper's CI.
- **Sonnet 4.6 medium-thinking handles 3-way parallel sibling dispatch cleanly.** No regressions, no `resource_exhausted`, no architecturally surprising decisions. The only thing requiring orchestrator judgment was the `#FU-37` collision reconciliation, which is below-the-line bookkeeping.

Final migration sequence on main: monotonic 0000-0022 (+2 from iter 28 — `0021_ebay_graded_listing_observation` + `0022_auction_lot_observation`). HEAD: `a452aca`. Open questions: 3 non-blocking (Q-007, Q-011, Q-014 deferred to #FU-29).

**Next iter candidates (ranked):**

1. **ML training trio — T-GR-CORNERS + T-GR-EDGES + T-GR-SURFACE (parallel triple).** All three now have their full data dependency unblocked (PSA + eBay + auctions all merged). All three are `agent_role: ml`, train + ship inference models. Same shape as T-GR-CENTERING but learned, not deterministic. Disjoint owns_paths under `apps/api-python/grading/<corners|edges|surface>/` + `apps/mobile/src/grading/<corners|edges|surface>/`. Closes 8 / 10 of Stage 07 in one batch.
2. **T-GR-AGGREGATE** — depends on all 4 sub-grades (CENTERING merged + the 3 from candidate 1). Holds until the training trio lands.
3. **Stage 09 offline-sync — T-OF-LOCAL-DB.** Mobile SQLite mirror. Foundation for offline collection support; downstream T-OF-QUEUE + T-OF-CONFLICTS need it. Self-contained, no external accounts needed.
4. **#FU-40 / T-GR-DATA-PRINTING-MATCH.** Resolve the NULL `printing_id` FKs across all 3 grading observation tables. Backend Python task; can parallelise with ML trio if dispatched as a 4th worker.
5. **Stage 08 shareables polish — T-SH-OG-IMAGES.** Self-contained web task; needs Vercel OG / Satori.

## Iter 27 close summary (Stage 06 scanner closed 6/6; Stage 07 grading 2/10; one post-merge test hotfix)

Two sibling workers on disjoint owns_paths, both shipped in one batch, both squash-merged. **Closes Stage 06 scanner end-to-end** — Binderly now has a working on-device card scanner from camera frame → recognised printing → user-reviewable stack. T-GR-CENTERING also closes #FU-32 with the real router-param hand-off, replacing T-GR-CAPTURE-UX's `__deprecated`-tagged module-scoped ref.

| Task | Status | PR / commit | Tests | Highlight |
|---|---|---|---|---|
| T-SC-UX | merged | #80 (`020a996`) | +161 mobile (796→957 in worker's local battery; main settled at 995/995 after stitching) | 8 new UI components in `apps/mobile/src/scanner/ui/` (MatchOverlay, DisambigPicker, StabilityIndicator, StackPanel, UndoToast, ModelLoaderStatus, ScanError, ScanLoadingShell), screen orchestration in `apps/mobile/src/screens/scan/ScanScreen.tsx`, pure reducer `use-scanner-session.ts`, async model loader `use-model-loader.ts` (model + index warmup), network-isolation test guard, dependency-injected `loadModels` prop for test stubbing without bundling binary assets. The route was already wired by T-SC-CAMERA so `app/(tabs)/scan.tsx` was unchanged. **Raised #FU-34 (thumbnail URL plumbing — MatchOverlay + DisambigPicker show coloured placeholders today; needs MatchResult to expose a thumbnail URL or a `usePrinting()` lookup hook) and #FU-35 (`useModelLoader` re-triggers on every ScanScreen remount; module-level singleton cache would keep the model warm across tab switches).** |
| T-GR-CENTERING | merged | #81 (`65f15a2`) | +30 mobile (484→514 in worker's local battery) / +53 Python | **Python authoritative** at `apps/api-python/grading/centering/`: multi-pass Canny outer-edge detector (thresholds 5/20, 15/50, 30/100 — handles ~24-greyscale-level card-vs-background contrast) + threshold-based inner-border finder + Hough-line fallback for edge cases + 4-margin → h/v ratio mapping → PSA grade hint (10 ≥ 0.818, 9 ≥ 0.667, 8 ≥ 0.538, 7 ≥ 0.429, worse, unknown). 53 pytest tests against synthetic + real fixtures, all green. Added `opencv-python-headless` to `apps/api-python/` only (not the JS monorepo). **TS contract** at `apps/mobile/src/grading/centering/`: typed `CenteringService` factory (v1 default returns `not_implemented` until the Python endpoint deploys) + `useCentering` hook + `CenteringScreen`. **Session-routing seam (closes #FU-32):** capture screen calls `storeSession(emitted)` and pushes `/grading/centering?sessionId=<id>`; centering screen reads from a module-scoped `Map<string, GradingCaptureSession>` keyed on that id. Sibling stages (T-GR-CORNERS / EDGES / SURFACE) consume the same `getSession` seam from the centering barrel. **Raised #FU-36 (pure-JS on-device centering algorithm — blocked on accuracy validation against real card photos; TS contract is already the seam for swapping it in).** |
| **HOTFIX (orchestrator)** | merged | `1f90a1e` (direct to main) | -0 / +0 (test contract update only) | Sibling-pair sequencing artefact: T-GR-CENTERING correctly re-pointed the post-capture navigation in `GradingCaptureScreen.tsx:168` from `/grading/capture/review` → `/grading/centering?sessionId=<id>`, but the T-GR-CAPTURE-UX test `GradingCaptureScreen.test.tsx:257` still asserted the old route. Workers both ran their own filtered batteries inside their worktrees (where `dist/` was warm); main on first checkout failed `pnpm --filter @binderly/mobile test` until `pnpm build` populated workspace package dists. Stitched in foreground because it was a 5-line test-contract update — not worth a full worker round-trip. |

**Local CI battery (final, on main after stitching):**

- `pnpm --filter @binderly/ui test`: 257 / 257 (20 files).
- `pnpm --filter @binderly/mobile test`: 995 / 995 (104 files) after `pnpm build` populates workspace package dists.
- `pnpm --filter @binderly/mobile typecheck`: clean.
- (Web + other packages not re-verified this session — workers reported their local batteries green; trusted.)

**New follow-ups raised this iter** (logged in Known Follow-ups below):

- **#FU-34 — scanner thumbnails:** MatchOverlay + DisambigPicker show coloured placeholders. Needs MatchResult to expose a thumbnail URL or a `usePrinting()` lookup hook reading from the api-client. Small backend addition + 2 UI swaps.
- **#FU-35 — scanner model cache:** `useModelLoader` re-loads the TFLite model + ANN index on every ScanScreen remount (tab switch costs ~200-400 ms warmup). Module-level singleton cache keeps it warm; needs a lifetime/eviction policy decision (probably indefinite for v1 since the assets are small).
- **#FU-36 — pure-JS on-device centering:** T-GR-CENTERING ships the Python authoritative algorithm + a TS `not_implemented` stub. On-device port (or thin native module wrapping OpenCV-mobile) is needed before centering can run without server round-trip; blocked on accuracy validation against real Pokémon card photos.

**Operational notes for future iters:**

- **Lesson learned (sibling-pair workspace package builds):** workers that ran `pnpm --filter @binderly/<consumer> test` in their worktrees passed because `pnpm build` had populated `packages/*/dist/`. When the orchestrator (or anyone else) checks out main fresh and runs the same filter without first running `pnpm build`, Vite can't resolve the workspace package imports. **Mitigation:** the local-CI checklist for workers should explicitly include `pnpm build` before `pnpm --filter <pkg> test`, OR the worker should run `pnpm test` (workspace-wide, which runs turbo and respects the `dependsOn: ["^build"]` task chain). The first option is the lighter touch.
- **T-GR-CENTERING's "44 baseline failures" note in `@binderly/ui` was misleading;** main `@binderly/ui` is 257/257 green. The worker likely conflated their worktree's stale-dist state (10 mobile-package files unable to resolve `@binderly/set-completion`, `@binderly/smart-collection-dsl`, `@binderly/pricing-display`) with `@binderly/ui` test failures. Treated as a label error, not a real regression cluster.

Final migration sequence on main: monotonic 0000-0020 (no new migrations in iter 27). HEAD: `1f90a1e`. Open questions: 3 non-blocking (Q-007, Q-011, Q-014 deferred to #FU-29).

**Next iter candidates (ranked):**

1. **Grading algorithm pair — T-GR-CORNERS + T-GR-EDGES (parallel pair).** Both depend on T-GR-CAPTURE-UX (merged) + share the `getSession` seam T-GR-CENTERING shipped. Orthogonal owns_paths. Same shape as T-GR-CENTERING — Python authoritative + TS contract + screen. Closes 4 / 10 of Stage 07.
2. **T-GR-SURFACE + T-GR-AGGREGATE** (next grading pair). SURFACE depends on the 4-shot session (in-place) + needs the raking-light surface shot (#FU-31 — not blocking since the algorithm can stub with placeholder data for v1); AGGREGATE depends on the 4 sub-grades. Wait until SURFACE lands before AGGREGATE; SURFACE is dispatchable now.
3. **#FU-34 + #FU-35 + #FU-36 backend tidy-up iter.** Three small follow-ups; could cluster as one worker.
4. **Stage 11 deployment kick-off — T-DP-VERCEL + T-DP-EAS (parallel).** Web hosting + mobile binary distribution can start in parallel with grading work. Critical for v1 launch.
5. **#FU-29 / T-SC-ANN-NATIVE.** Still gated on Pablo's Xcode + Android Studio install.

## Iter 26 close summary (scanner read-path closed end-to-end + grading stage opened; Q-014 deferred to #FU-29)

Two sibling workers, fully orthogonal owns_paths trees (`scanner/match/` vs `grading/capture/`), both green on local CI, both squash-merged without GH Actions gating. Closes Stage 06's read path (only T-SC-UX remains) and opens Stage 07 grading.

| Task | Status | PR / commit | Tests | Highlight |
|---|---|---|---|---|
| T-SC-MATCH | merged | #78 (`378116b`) | +72 mobile (720→792) | JS-thread `useScanner()` orchestration: subscribe to `DetectionSink` → run crop through `embed()` adapter (Float32 → uint8 RGB bridge stays in the T-SC-UX screen layer per the elaborated brief — `embedCrop(Float32Array) => Promise<Float32Array>` injected, decouples the embed-input shape mismatch) → `searchKNN(k=5)` → confidence + stability gate → emit `MatchResult { printingId, confidence, stabilityCount, framesSinceMatch }`. Parameters chosen first-principles for L2-normalised cosine (calibration is a follow-up): `autoAddScore = 0.78`, `disambigScore = 0.55`, `topGapMin = 0.04`, `stabilityCount = 3` (~300 ms at 10 FPS upstream throttle), `stackResetMs = 350`, `queueCap = 32`. **Stack mode:** per-printing post-fire cooldown released on either a card-removed gap > `stackResetMs` or a different printing stabilising (user flipped); fired matches accumulate in a bounded FIFO that the UI flushes on session end. **Q-014 shipped pure-JS** — native swap is transparent at `apps/mobile/src/scanner/ann/search.ts` via #FU-29. |
| T-GR-CAPTURE-UX | merged | #79 (`fa9faab`) | +76 mobile (720→796) | Guided 4-shot grading capture flow at `apps/mobile/src/grading/capture/`. Order: `frontFull → backFull → frontCorner → backCorner` (front first feels natural; corners after full shots so the user has already oriented). Pure modules: `quality.ts` (gradient-projection sharpness + brightness window [0.18, 0.85] + edge-coverage gate; **stricter than scanner** — user can re-take and downstream centering needs high-quality input) and `session.ts` (4-step state machine reducer: accept / reject / retake / reset). Re-entry posture: session lives in the hook's mount lifetime — tab navigation keeps progress (tabs router doesn't unmount), full unmount drops it (no AsyncStorage in v1; logged as follow-up). Overlay framing: card-aspect rectangle (~75% screen width) for full shots; corner-anchored square (~40% width, top-left front / top-right back) for corner shots. Scanner-side `CameraPermissionPrompt` re-used via the barrel without modification. Network isolation asserted by `network-isolation.test.ts`. |

**Local CI battery (both workers ran the full set; substitute for GH Actions at ~90% quota):**

- `pnpm lint`: 0 warnings (12/12 packages).
- `pnpm typecheck`: 20/20 packages green.
- `pnpm test`: mobile **796 tests passing** (was 720 on `main` → +72 match + +76 capture-ux = +148 net-new across both workers; small overlap because both branched off the same point and tests merged cleanly).
- `pnpm build`: 11/11 packages green.

**New follow-ups raised this iter** (logged in Known Follow-ups below):

- **#FU-30 — confidence calibration on labeled real-phone scans** (T-SC-MATCH worker): the `rules/06-scanner.md` FP < 0.5% target needs a real labelled calibration set. Pablo captures the dataset; a worker tunes the thresholds against it.
- **#FU-31 — T-GR-CAPTURE-FULL-SCHEMA**: remaining 2 corner crops (bottom-left, bottom-right) + the surface raking-light shot from PROJECT.md § 12. Not blocking T-GR-CENTERING + T-GR-CORNERS which only need the 4 shipped today.
- **#FU-32 — T-GR-CENTERING-ROUTING**: session hand-off uses a module-scoped ref (`__getLastEmittedSession()`) tagged `@deprecated`; T-GR-CENTERING swaps in a real router-param strategy.
- **#FU-33 — live frame-processor sample for capture-button quality state**: today `attemptCapture` is screen-injected; the `CaptureAttemptInput` shape is already designed to compose a live frame-processor quality stream with `takePhoto()` once a CPU-side JPEG decoder is bundled.

Final migration sequence on main: monotonic 0000-0020 (no new migrations in iter 26). HEAD: `de069b0`. Open questions: 3 (Q-007 admin role, Q-011 TCGplayer URL, Q-014 ANN catalog-scale latency — deferred to #FU-29); all non-blocking.

**Next iter candidates (ranked):**

1. **T-SC-UX + T-GR-CENTERING (parallel pair).** T-SC-UX closes Stage 06 scanner (camera screen + match-result UI + stack-mode queue review). T-GR-CENTERING is the next grading algo step (computes PSA-style centering scores from the front + back full shots). Fully orthogonal owns_paths.
2. **#FU-29 / T-SC-ANN-NATIVE.** Native SIMD inner loop for ANN search. Substantial Expo Module work (Swift + Kotlin + autolinking + Expo plugin + TS fallback). Hold until Pablo's Xcode + Android Studio install completes, since sandbox can't validate native builds end-to-end.
3. **T-GR-CORNERS / T-GR-EDGES / T-GR-SURFACE** — algorithmic grading layers; can parallelise once T-GR-CENTERING lands.
4. **T-GR-DATA-{PSA,EBAY,AUCTIONS}** — data-collection pieces; standalone, can parallelise any time.
5. **#FU-30 — confidence calibration** — needs Pablo's labelled dataset first.

## Iter 25 close summary (scanner read-path middle + end; Q-014 raised, non-blocking)

Two sibling workers, fully orthogonal owns_paths trees (`scanner/detect/` vs `scanner/ann/` + `apps/api-python/ann/`), both green on local CI, both squash-merged without GH Actions gating (quota at ~90 % monthly cap). Lockfile conflict was structurally impossible from the DETECT side (no new mobile deps) and the ANN-INDEX worker raced through its own state commit first; no merge friction at all.

| Task | Status | PR / commit | Tests | Highlight |
|---|---|---|---|---|
| T-SC-DETECT | merged | #77 (`6411b75`) | +90 mobile (577→667) | Pure-JS, no native module. Frame-processor-safe pipeline: RGB → Rec. 601 luma grayscale → aspect-preserving downsample to a **dynamic** ≤96×128 analysis grid (originally-planned fixed 96×128 distorted landscape sources enough to flip the aspect gate — caught by synthetic-frame tests) → 2-tap finite-difference gradients → row/column activity projections → first-from-each-side scan above `0.35 × max(profile)` gated on noise floor `12` → sharpness/brightness/aspect quality gate → axis-aligned crop + nearest-neighbour resize to 224×224 + mobilenet_v3 normalisation (`byte/127.5 - 1`, `[-1, +1]`). `useDetectFrameProcessor()` mirrors T-SC-CAMERA's 10 FPS throttle; ships a `DetectionSink` JS-side bus that T-SC-MATCH will subscribe to. Failed-gate frames emit `cropped: null` to preserve the embedding budget. **Explicit deferrals** (in scope of the brief, not blockers): full perspective correction (T-SC-MATCH may add it once real-world miss data lands); auto-rotation on landscape (v1 rejects via gate); stack-mode geometry stability (T-SC-MATCH owns — needs consecutive accepted rects). |
| T-SC-ANN-INDEX | merged | #76 (`9549e44`) | +53 mobile vitest, +65 pytest | Flat brute-force, FP16-quantised. Portable binary format: 32-byte LE header + fixed-width ASCII ids + row-major embedding block; `format` field reserved so HNSW/PQ is an additive future migration. Python builder + CLI under `apps/api-python/ann/`; TS runtime under `apps/mobile/src/scanner/ann/` reads byte-for-byte mirror. `metro.config.js` additively registers `.bin` as a bundled asset extension (mirrors T-SC-EMBED-MODEL's `.tflite` block). **Recall@10 = 100.0 %** on the FP16-vs-FP32 ground-truth benchmark (1 000 queries × 5 000 catalog rows). No new runtime deps (Python: `numpy` + `pydantic` already present; TS: `zod` already present). **Q-014 raised** in the brief's "Notes from execution": pure-JS dot-product at full 30 k × 576 production catalog projects to ~140 ms on a Pixel 6-class device, **exceeding the 30 ms stage budget**; beta-launch catalog (~3-5 k printings, EN only) stays inside the budget. T-SC-MATCH owns the on-device latency story and the decide-to-go-native call. |

**Local CI battery (substitute for GH Actions; both workers ran the full set in their worktrees):**

- `pnpm lint`: 0 warnings (12/12 packages).
- `pnpm typecheck`: 20/20 packages green.
- `pnpm test`: **3 496 JS tests** pass (mobile 667 after +90 detect tests + 53 ann tests; data-pipeline 1101; web 499; etc.).
- `pnpm build`: 11/11 packages green.
- `pytest` under `apps/api-python/`: 128 tests pass (+65 net-new under `ann/tests/`).

Final migration sequence on main: monotonic 0000-0020 (no new migrations in iter 25; iter 24 added 0020). HEAD: `0e8442b`. Open questions: 3 (Q-007 admin role, Q-011 TCGplayer URL, Q-014 ANN catalog-scale latency); all non-blocking.

**Next iter candidates (ranked):**

1. **T-SC-MATCH** (single worker, scanner read-path closer): stitches T-SC-DETECT → T-SC-EMBED-MODEL → T-SC-ANN-INDEX into a recognised printing. Owns the Q-014 decision (whether to push ANN into a native module for full-catalog latency). Critical path for closing the scanner stage.
2. **T-GR-CAPTURE-UX** (grading stage opener): depends on T-SC-CAMERA only (merged); fully orthogonal to scanner. Can run in parallel with T-SC-MATCH.
3. **T-SC-UX** (scanner UX shell): depends on T-SC-MATCH; sequence after MATCH lands.

## Iter 23 close summary (scanner stage opened + Q-013 backend perf cleanup; #FU-26 + #FU-27 closed)

Three workers, three orthogonal owns_paths trees, three clean
merges in one sweep. Mixed-discipline iter (frontend-mobile +
ml + backend) — possible only because the scanner subtree
under `apps/mobile/src/scanner/` is brand new (no other tasks
have touched it) and the Q-013 cleanup is purely backend
(migrations + handler swaps + RPC, no client surface change).

| Task | Status | PR / commit | Tests | Highlight |
|---|---|---|---|---|
| T-SC-CAMERA | merged | #71 (`56aaa82`) | scanner camera infra | `react-native-vision-camera@4.6.4` + `react-native-worklets-core@1.5.0` (last 4.x minor with explicit RN 0.76 autolinking fixes); iOS NSCameraUsageDescription + Android camera permission + vision-camera config plugin with `enableFrameProcessors: true`; worklet-thread frame processor capped at 10 FPS; JS-side permission flow + Scan screen host. **In-PR hotfix `fix(mobile)`:** removed stale `expo-web-browser` plugin entry from `app.json` (T-M-AUTH leftover — package ships no `app.plugin.js`, plugin resolver fell through to ESM `build/WebBrowser.js` → `require(ESM)` → `expo-modules-core/src/index.ts` → `ERR_UNKNOWN_FILE_EXTENSION`); switched `apps/mobile/package.json` scripts to `expo run:ios/android` (vision-camera is native, not in Expo Go). |
| T-SC-EMBED-MODEL | merged | #72 (`122e879`) | python + RN inference suite | MobileNetV3-Small TFLite (1.0_224, FP16) — best size/quality tradeoff for 224×224 card crops on iPhone + mid-tier Android; Python embedding pipeline (`apps/api-python/embeddings/`) with model conversion script + reference embeddings; `react-native-fast-tflite@3.0.1` on-device inference wrapper with manifest validation; `metro.config.js` bundles `.tflite` files; new `ci-python.yml` GH Action with path filters; `pnpm-workspace.yaml` negates `apps/api-python` to avoid mixed JS/Py tooling. |
| T-BE-Q013-CLEANUP | merged | #73 (`ac01201`) | +10 edge-fn (303→313) | **#FU-26:** migration `0018_mv_user_completion.sql` ships `mv_user_set_completion` + `mv_user_global_completion` MVs with `UNIQUE` indexes (for `REFRESH CONCURRENTLY`), `security_barrier = true` wrapper views `v_my_set_completion` / `v_my_global_completion` filtered by `(SELECT auth.uid())` (PG17 lacks RLS on MVs), and `refresh_user_completion()` `SECURITY DEFINER` function. Completion handler swapped from on-the-fly compute → MV SELECT (`completionDto` wire shape unchanged). Best-effort `supabase.rpc()` refresh hook wired into every collection mutation. **#FU-27:** migration `0019_smart_preview_rpc.sql` ships `smart_collection_preview(ast, p_user_id, p_limit, p_offset)` `SECURITY DEFINER` RPC + 4 PL/pgSQL helpers that port `expressionToSql()`; smart-preview handler swapped to `client.rpc()`; `previewExpressionSchema` widened to accept `collection.*` (non-breaking). RPC security: `SECURITY DEFINER` + explicit `auth.uid() = p_user_id` guard + `SET search_path = ''` + `quote_literal()`-quoted values + static `CASE` allowlist for column refs. |

**Refresh strategy (Q-013 / #FU-26):** synchronous `REFRESH
MATERIALIZED VIEW CONCURRENTLY` wrapped in a best-effort
`supabase.rpc(...)` from each collection mutation —
strong-consistency UX in the typical case, eventually-consistent
fallback on failure. Pivot to `pg_cron` documented if it scales
badly. `lastUpdatedAt` temporarily `null` (MV doesn't carry
`max(updated_at)` yet); widening is a tiny follow-up if the UI
needs it. `bigint` may serialize as string over PostgREST;
`coerceCount` handles both shapes.

**New follow-up raised:** **#FU-28 (proposed `T-DL-RLS-PG-STAT-REVOKE`):**
one-line REVOKE migration to fix 2 pre-existing `verify-rls`
failures on `v_pg_stat_statements_top_queries`. Cause:
Supabase's default `ALTER DEFAULT PRIVILEGES … GRANT ALL ON
TABLES TO anon, authenticated` fires on view creation before
migration `0016_admin_debug_views.sql`'s `REVOKE ALL FROM PUBLIC`
runs (PUBLIC ≠ union of all roles). Fix: ship `0020_*.sql` with
`REVOKE ALL ON public.v_pg_stat_statements_top_queries FROM
anon, authenticated;`. **Not introduced by #73** — predates
branch base on main commit `b13d3ed` (T-DL-ADMIN-DEBUG-SURFACES,
iter 11). Trivial to land.

Final migration sequence on main: monotonic 0000-0019.

  0018_mv_user_completion       (T-BE-Q013-CLEANUP, hand-authored; closes #FU-26)
  0019_smart_preview_rpc        (T-BE-Q013-CLEANUP, hand-authored; closes #FU-27)

HEAD: `122e879`. Open questions: 2 (Q-007 admin role,
Q-011 TCGplayer URL); both non-blocking. Q-013 closed.

**Next iter candidates (ranked):**

1. **T-DL-RLS-PG-STAT-REVOKE (#FU-28).** Trivial one-line REVOKE
   migration; closes the two pre-existing `verify-rls` failures.
   Lowest-effort backend hygiene.
2. **Scanner stage continuation: T-SC-DETECT.** Card detection
   (frame → crop → quality gate) on top of T-SC-CAMERA's frame
   processor + T-SC-EMBED-MODEL's manifest. Standalone; no
   dependency outside the scanner subtree.
3. **T-SC-ANN-INDEX.** Approximate nearest-neighbor index over
   the embedding bank; pairs with the model from T-SC-EMBED-MODEL.
4. **T-SC-MATCH.** End-to-end match pipeline that stitches
   T-SC-DETECT → T-SC-EMBED → T-SC-ANN-INDEX into a recognised
   printing. Closes the scanner read path.
5. **Open the grading stage** (T-GR-CAPTURE-UX depends on
   T-SC-CAMERA — now unblocked).

## Iter 22 close summary (frontend wiring of V2 endpoints — cross-platform; #FU-22 closed as side effect)

Two sibling workers, cleanly disjoint owns_paths per platform,
both green CI, both squash-merged. Closes the loop opened by
iter 21: every client-side stop-gap shipped in iters 17 / 18 / 20
that the V2 endpoints unblocked is now wired through to the real
server data.

| Task | Status | PR / commit | Tests | Highlight |
|---|---|---|---|---|
| T-M-API-V2-WIRING | merged | #69 (`6186ef3`) | +28 (target 25-40; total apps/mobile 460 / 48 files) | 3 surface swaps: `CollectionScreen` + `CollectionSetScreen` → `getCompletion()` (Master% real on first paint, no more parked fallback); `CardScreen` → `pricing-display` + `getPrintingCurrentPrice()` with loading/404/error/retry/freshness; smart-editor Run → `smartCollections.preview()` catalog-wide (closes #FU-22 owned-only PrintingPicker quirk as side effect — pinned by regression test rendering an unowned printing). `useMutation` not `useQuery` for smart preview (Run is imperative). 404 → `data: null` sentinel pattern. |
| T-W-API-V2-WIRING | merged | #70 (`d45b9d4`) | +51 (target 30-50; total apps/web 499 files) | 4 surface swaps: `CollectionView` / `CollectionSetView` → `getCompletion()`; `CardView` → new `CardPriceBlock` rendering `pricing-display` + `getPrintingCurrentPrice()`; `apiToShareApi` → `getPublicShareablePayload()` (Q-012 fully closed end-to-end; degraded synthesis deleted); `SmartEditorView` Run + `SmartDetailView` re-run → `smartCollections.preview()`. Local `evaluate()` retained for typing/explainer + as canonical `collection.*` predicate fallback when V2 rejects with `ApiValidationError` (Q-013). `MatchGrid` widened to a `SmartMatchView` shape via `runMatchToView` / `previewItemToView` pure projections. 5xx-propagates posture on shareable (half-broken page is strictly worse UX than honest error). `catalogRoster()` stays for per-set Owned/Missing grids (no V2 endpoint covers that yet — would need a backend follow-up if we want to drop it). |

**No new open questions raised by either worker.** Every V2 endpoint
shape was sufficient for its surface; Q-013 is implicitly answered
client-side (the `collection.*` predicate fallback in smart-preview
falls out of `ApiValidationError` cleanly, no escalation needed).

**Frontend foundation now reads exclusively from server-side
endpoints for completion, current-price, public-shareable, and
smart-preview.** The O(catalog) client-side fanout that's been
sitting in T-W/M-COLLECTION since iter 18 is gone. The "Prices
coming soon" placeholder on Card{View,Screen} since iter 17 is
gone. The "owned-only PrintingPicker" quirk on mobile smart-editor
since iter 19 is gone.

**Remaining Q-013 perf concerns** are entirely server-side and
non-blocking at v1 scale:

- **#FU-26 (`T-DL-MV-COMPLETION`):** completion handler still
  computes on-the-fly because the mvs don't exist. Frontend is
  unaware; swap from on-the-fly compute → mv SELECT is transparent.
- **#FU-27 (`T-BE-SMART-PREVIEW-RPC`):** smart-preview server
  handler still evaluates AST in JS in-memory. Frontend unaware;
  swap to Postgres RPC is transparent.

Final migration sequence on main: monotonic 0000-0017 (no new
migrations in iter 22). HEAD: `d45b9d4`. Open questions: 3
(Q-007 admin role, Q-011 TCGplayer URL, Q-013 mv/RPC gaps); all
non-blocking.

**Next iter candidates (ranked) when work resumes:**

1. **Land the missing mvs (#FU-26 / T-DL-MV-COMPLETION).** Small
   data-layer task; ship the two hand-authored migrations + indexes
   + refresh strategy, then swap the completion handler from
   on-the-fly compute to a single `SELECT`. Strictly improves perf;
   no API surface change; no frontend touch needed.
2. **Pair: #FU-26 + #FU-27 backend perf cleanup iter.** Bundles
   the mv-completion swap with the smart-preview RPC migration —
   both are Q-013 backend follow-ups; both transparent to the
   frontend.
3. **Open the scanner stage** — T-SC-CAMERA + T-SC-EMBED-MODEL
   parallel pair. Standalone; no frontend dependency; larger
   scope (T-SC-EMBED-MODEL is genuinely ML work, not pure
   software engineering).

## Iter 21 close summary (backend tidy-up — 4 additive Edge endpoints; Q-012 closed; Q-013 raised)

One worker, single coherent PR. Closed four frontend follow-ups
that had been waiting since iters 17 / 18 / 20 by adding four
additive read endpoints to the Supabase Edge Function + matching
DTOs + api-client methods. **No schema changes; no migrations;
no edits to existing endpoints.**

| Task | Status | PR / commit | Tests | Highlight |
|---|---|---|---|---|
| T-BE-EDGE-FUNCTIONS-V2 | merged | #68 (`472fdcf`) | +260+ across api-contracts (232 total) / api-client (253 total) / edge functions (293 total); workspace `pnpm test` 19/19 task-graph tasks green | One PR ships all 4 endpoints: `GET /v1/me/collection/completion`, `GET /v1/printings/:id/current-price`, `GET /v1/c/{handle}/{slug}` (anonymous, dual-Accept), `POST /v1/smart-collections/preview`. Worker self-elaborated the stub (`15107bf`), shipped the work (`2c16859`), closed Q-012 + raised Q-013 (`1c5a552`). |

**Non-obvious decisions (worker self-decided; all flagged in PR
body + Q-013):**

- **Completion handler computes on-the-fly** instead of reading
  `mv_user_set_completion` / `mv_user_global_completion`. Those
  mvs were named in the brief + ratified Q-010 but they **don't
  exist in migrations** — the hand-merged `0013_mv_current_price`
  is the only mv on main. "No schema changes" rule prevents
  creating them mid-task. Handler re-implements
  `@binderly/set-completion`'s algorithm against canonical tables
  (`collection_item ⨯ card ⨯ printing ⨯ set`); well under 100ms
  at v1 catalog size. The brief got this wrong; Q-013 documents
  the gap.
- **Smart-preview evaluates AST in-memory** against a catalog
  projection. The Edge bundle can't import
  `@binderly/smart-collection-dsl` (Deno bundler doesn't resolve
  the workspace package), and supabase-js is PostgREST-only — no
  raw-SQL escape hatch. AST is validated via a Zod mirror in
  `_shared/contracts.ts`; `collection.*` predicates rejected at
  the preview boundary. `compileToSql()` only flows server-side
  through an RPC follow-up (proposed `T-BE-SMART-PREVIEW-RPC`).
- **Public shareable: single URL, dual response shape.**
  `Accept: application/vnd.binderly.share+json` opts into the
  richer `publicShareableDto`; the default `Accept` continues to
  return the bare `shareableDto` so the existing
  `getPublicShareable` client keeps working. Service-role bypass
  on `collection_item` with column-level projection discipline
  (anonymous read; no JWT parsed).
- **`normalizePathname` widened** from `/v1/me/`-only to strip
  `/v1/` from any path so the three non-`/me/` endpoints
  (`/c/…`, `/printings/…`, `/smart-collections/…`) dispatch
  correctly.
- **`ZodEffects` interaction.** `z.discriminatedUnion` rejects
  `ZodEffects` branches, so the smart-preview "range needs min
  or max" cross-field rule lifted from per-branch `.refine()`
  to a top-level `superRefine` on `smartPreviewRequest`. Worth
  knowing for future contract authors.

**Q-012 closed** at merge time (additive `publicShareableDto`
landed; T-W-SHAREABLE-PUBLIC's runtime adapter can swap its
degraded synthesis for `getPublicShareablePayload(...)` in a
small follow-up PR — the data layer was designed as the seam
exactly for this).

**Q-013 raised** documenting the two scope divergences with
bounded blast radius:

1. **`mv_user_set_completion` + `mv_user_global_completion`
   missing from migrations.** Proposed follow-up
   **`T-DL-MV-COMPLETION`**: land the two mvs as hand-authored
   migrations + indexes; swap the completion handler back to a
   single `SELECT`. Strictly improves perf; no API surface
   change.
2. **DSL evaluation in JS instead of SQL.** Proposed follow-up
   **`T-BE-SMART-PREVIEW-RPC`**: ship a Postgres RPC function
   that accepts the DSL AST as JSON, compiles to SQL via the
   server-side `compileToSql()` path, and runs as a single
   query. Unlocks `collection.*` predicates + catalog-scale
   eval (currently capped by in-memory projection size).

Final migration sequence on main: monotonic 0000-0017 (no new
migrations in iter 21). HEAD: `472fdcf`. Open questions: 3
(Q-007 admin role, Q-011 TCGplayer URL, Q-013 mv/RPC gaps);
all non-blocking.

**Next iter candidates (ranked):**

1. **Frontend wiring of the new endpoints (small but high
   leverage).** Three short follow-ups: swap T-W-COLLECTION /
   T-M-COLLECTION's client-side compute → `getCompletion()`;
   wire pricing-display into Card{View,Screen} using the new
   `getCurrentPrice()` (#FU-17 frontend half); swap
   T-W-SHAREABLE-PUBLIC's degraded adapter → direct
   `getPublicShareablePayload({ vendorAccept: true })`; swap
   T-W-SMART preview → server preview. Could be a 2-worker
   sibling dispatch (web + mobile) since owns_paths are
   disjoint per platform.
2. **Land the missing mvs (`T-DL-MV-COMPLETION`).** Small data-
   layer task; unlocks the completion-handler swap from
   on-the-fly compute to single-SELECT mv read.
3. **Open the scanner stage** — T-SC-CAMERA + T-SC-EMBED-MODEL
   parallel pair. Larger scope; standalone (no frontend
   dependency).

## Iter 20 close summary (Stage 04 cap — frontend foundation COMPLETE)

Two workers, two orthogonal owns_paths trees, both green CI, both
squash-merged. **Phases 0-5 are now ALL complete: foundation, data
layer, backend core, shared packages, web (8/8), mobile (5/5).**

| Task | Status | PR / commit | Tests | Highlight |
|---|---|---|---|---|
| T-W-AFFILIATE-LINKS | merged | #66 (`d028681`) | +57 (target 20-35; URL-builder edge cases pushed higher) | TCGplayer affiliate `<BuyCta>` on web + mobile card detail. Documented placeholder URL format (Impact partner docs unverified → **Q-011 / #FU-24**). Env-missing degraded path: disabled button + "Coming soon" hint — production default until affiliate id lands. Mobile uses `expo-web-browser.openBrowserAsync` (better Impact cookie attribution + one-swipe back) with silent `Linking.openURL` fallback. Pure URL builder duplicated web↔mobile (~30 LOC each) since cross-app shared package over-engineered at this scope. |
| T-W-SHAREABLE-PUBLIC | merged | #67 (`79ad293`) | +67 (target 25-45; extras are cheap pure-unit on `format.ts` + `api.ts`) | Public no-auth shareable pages at `/c/[handle]/[slug]` + Next 14 `next/og` `ImageResponse` OG card. Logged-out users see real collection snapshot. `force-dynamic` server component + lazy client glue (T-W-BROWSE pattern); `generateMetadata()` URL-params-only (no SSR fetch failure mode for crawlers). **Q-011 → Q-012 renamed in-merge** (collided with affiliate's Q-011); orchestrator resolved the open-questions.md conflict + lockstep-renumbered all in-PR refs (`lib/share/api.ts`, `opengraph-image.tsx` comments, task file). Backend follow-up: `GET /v1/c/{handle}/{slug}` Edge route + additive `publicShareableDto` in `@binderly/api-contracts` (Option 1 in Q-012). Page ships against a richer injectable `PublicSharePayload` contract; runtime adapter synthesises a degraded payload (URL-derived handle + empty members + zero counts) from existing `getPublicShareable` until backend lands. |

**Q-011 raised** (T-W-AFFILIATE-LINKS, PR #66) — TCGplayer URL
format placeholder until Pablo signs up for Impact / TCGplayer
affiliate program. Non-blocking: env-missing degraded path is
production default. **Logged as #FU-24.**

**Q-012 raised** (T-W-SHAREABLE-PUBLIC, PR #67; renumbered from
in-PR Q-011 at merge time to avoid collision with affiliate's
Q-011) — public shareable read endpoint not yet implemented in
Edge Function + `shareableDto` is metadata-only. Page scaffold
ships green; backend follow-up is additive. **Logged as the
backend-side companion to #FU-23 (smart-collection server eval)
and #FU-19 (server-side completion).**

**Frontend foundation status: COMPLETE.** Remaining work (Stages
06-11): scanner, ML, integrations, admin, billing, deploy. 32
tasks, all backend / mobile-scanner / ops surfaces. **Logical
next iter (when Pablo resumes after the night):**

1. **Backend tidy-up iter** — clear #FU-19 (server-side
   `/v1/me/collection/completion`), #FU-17 (wire pricing-display
   into Card{View,Screen} + expose `mv_current_price`), Q-012
   (additive `publicShareableDto` + `GET /v1/c/{handle}/{slug}`
   Edge route). Three additive edge-function endpoints unblock
   four frontend follow-ups.
2. **Or: open scanner stage** — T-SC-CAMERA + T-SC-EMBED-MODEL
   as a parallel pair. Standalone (no frontend dependency); MVP
   scope.

Final migration sequence on main: monotonic 0000-0017 (no new
migrations in iter 20). HEAD: `79ad293`. Open questions: 3
(Q-007 admin role + Q-011 TCGplayer + Q-012 shareable backend);
all non-blocking.

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

## Open questions (3 open; all non-blocking)

- **Q-007** (raised by T-DL-ADMIN-DEBUG-SURFACES, PR #40):
  should we provision a narrower Postgres `admin` role for read-only
  debug access (e.g. when an admin web UI lands)? For v1 the
  service_role posture is sufficient — anyone with service_role
  bypass can query the views. As soon as we want to expose these to
  human admins via a UI, we likely want a narrower role with SELECT-
  only scope on the debug views, not full DB superuser. **Status:
  open; not blocking. Decide before the admin UI lands.**
- **Q-011** (raised by T-W-AFFILIATE-LINKS, PR #66): exact TCGplayer
  affiliate URL format unconfirmed. `<BuyCta>` ships with a documented
  placeholder URL. Real format + Impact tracking param come once
  Pablo signs up. Non-blocking: env-missing degraded path is
  production default until affiliate id lands. **Logged as #FU-24.**

- **Q-014** (raised by T-SC-ANN-INDEX, PR #76): pure-JS dot-product
  brute-force ANN search projects to ~140 ms per query on a
  Pixel 6-class device at full production catalog (~30 k × 576),
  exceeding the 30 ms scanner stage budget. Beta-launch catalog
  (~3-5 k printings) stays inside the budget, so v1 is fine.
  T-SC-MATCH worker owns the decision: pre-cluster the catalog,
  push the inner loop into a tiny native module
  (`vDSP_distancesq` / Neon `vmlaq_f32`), migrate the index to
  HNSW/IVF-PQ (the manifest's `format` field reserves this slot
  for additive migration), or accept the latency off-worklet on a
  debounced JS tick. **Status: open; not blocking. Resolved when
  T-SC-MATCH ships with its chosen latency contract.**

**Q-013** closed at iter 23 merge time. Both halves landed in
T-BE-Q013-CLEANUP (PR #73 → `ac01201`): migration `0018_mv_user_completion.sql`
ships the two missing mvs + wrapper views + refresh function (closes
#FU-26); migration `0019_smart_preview_rpc.sql` ships
`smart_collection_preview()` Postgres RPC + 4 PL/pgSQL helpers
that port `expressionToSql()` faithfully (closes #FU-27). Both
handlers swapped accordingly; wire shapes unchanged.
**Q-012** closed at iter 21 merge time (additive `publicShareableDto`
+ `GET /v1/c/{handle}/{slug}` anonymous endpoint shipped in PR #68).

All other open questions (Q-002 / Q-003 / Q-004 / Q-005 / Q-006 /
Q-008 / Q-009 / Q-010 / Q-012) are closed.
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

- T-GR-COMMUNITY-FLYWHEEL — `e6ccde6` (#102) (**Stage 07 grading CLOSED — 10/10**; the first-party data flywheel. Pro users submit real graded-card outcomes → labelled training data. **Python** (`apps/api-python/grading/flywheel/`): `validation.py` (per-company cert-format + grade-range + photo + consent checks), `normalization.py` (cert canonicalization + dedup `source_id` + 0.5-grid grade snapping incl. BGS Black Label), `ingest.py` (`run_ingestion` orchestration mirroring the iter-28 scraper `run_job` shape → `build_training_sample_row` → `grading_training_sample` rows with `source='community_flywheel'`, mock-by-default `db_upsert_fn`/`existing_source_id_fn` seams, `default_image_handler` URL passthrough). **Mobile** (`apps/mobile/src/grading/community/`): pure `validation.ts` (mirrors the server rules) + `submission-machine.ts` reducer (idle/submitting/success/already_submitted/error) + `<CommunitySubmissionScreen>` (company selector, cert + grade + optional sub-grade inputs, Black-Label toggle, consent gate, paywall CTA for free users) + `app/grading/community.tsx` route reusing the capture session's photos via `sessionToImages`. **Gating path:** `@binderly/entitlements` fallback (`client.entitlements.getMyEntitlements()` + `grading_prediction`/tier check) since T-PB-GATING hadn't merged — swap to `useGate` at its merge. **DB:** user-owned `community_submission` table (idempotent on `(user_id, grade_company, cert_number_normalized)`) + owner-CRUD RLS (migrations `0025`/`0026`); ingestion into `grading_training_sample` stays service-role (verify-rls **137/0**, +4 community assertions). **api-contracts** `submitCommunitySubmission` DTO (adds SGC vs collection's PSA/BGS/CGC) + **api-client** `communitySubmissions` resource. **121 pytest + 43 mobile vitest** (api-contracts 275, api-client 275 incl. the new suites); lint / typecheck / build / mobile-test / pytest / verify-rls all green locally (Node 22.13.0; Actions skipped per quota policy). **Image ingest deferred to #FU-39; cross-company calibration is a conservative same-grid mapping, proper calibration #FU-56; Edge submission handler #FU-55.** No Q raised — ingestion to the existing shape + image refs as URLs is an acceptable Stage-07 close per the brief — **iter 34**
- T-SC-POLISH — `581f84e` (**scanner backlog burndown — closes #FU-34 + #FU-35**; deferred T-SC-UX polish done properly. **#FU-34 (thumbnails):** `MatchResult` already carried `printing.id`, so no api-client / match-pipeline / DTO change was needed — added a lightweight `usePrinting(printingId)` hook (`apps/mobile/src/screens/scan/use-printing.ts`) that reads the existing `client.cards.getPrinting()` + a module-scope dedup LRU, plus a pure `<CardThumbnail>` in `scanner/ui/` (kept network-free per the folder's network-isolation guard — the IO hook lives in the screen layer). `MatchOverlay` + `DisambigPicker` now render real card images with graceful loading/error/no-image placeholder fallback, and the overlay/picker also resolve the real name/set/number. **#FU-35 (warm cache):** module-scope singleton cache `apps/mobile/src/scanner/model-cache.ts` keyed on the model+index asset identity; `useModelLoader` opts in via a `warmCacheKey` (production path only — tests inject loaders + stay uncached) and skips unmount-disposal so handles survive `ScanScreen` remounts (tab switch / back-nav skips the ~200-400 ms re-warm). **Lifetime decision: indefinite for v1** (both assets small + shipped in-bundle), documented in the module + with a `resetModelWarmCache()` test hook to avoid cross-suite leakage. **+34 mobile tests (1557 green, 139 files)**: `CardThumbnail` (loading/success/error/no-image), `MatchOverlay` thumbnail rows, `DisambigPicker` thumbnail rows, `usePrinting`, `model-cache` (warm-hit/cold-miss/reset/failure-not-cached), `useModelLoader` warm-cache integration. lint / typecheck / build / mobile-test all green locally (Node 22.13.0; Actions skipped per quota policy). **Path note:** `useModelLoader` + `ScanScreen` live in `apps/mobile/src/screens/scan/` (the Stage-06 scanner screen layer), just outside the literal `apps/mobile/src/scanner/` owns_path — the FU explicitly targets `useModelLoader` and the network-isolation guard mandates the data hook live there; disjoint from the live grading/gating/themes workers. No Q raised) — **iter 34**
- T-PB-ENTITLEMENTS — `86ca0c4` (#99) (**Stage 10 paywall / billing 3 / 4**; ships the keystone unified entitlement service making RevenueCat the canonical *read* path. New `packages/entitlements/` (`@binderly/entitlements`): `model.ts` (canonical `Tier='free'|'pro'`, the 9-entry `PaidFeature` union from PROJECT.md § 16, `ALL_PAID_FEATURES`, `FREE_LIMITS` {customCollections:3, shareables:1}, `PRO_ENTITLEMENT_ID='pro'`), `can.ts` (pure `canUseFeature(tier, feature)` exhaustive-switch + `withinFreeLimit(tier, resource, count)` — what T-PB-GATING calls at every gate site), `revenuecat-client.ts` (`readEntitlement()` — typed wrapper over RC REST `GET /v1/subscribers/{app_user_id}`, parses `entitlements.pro` active-iff-present-and-not-expired, **fail-closed**: any network/non-200/malformed-body/missing-key error → `{tier:'free', source:'fallback', error}`, never throws). `GET /v1/me/entitlements` Edge endpoint added to the existing single `v1` mux (`_shared/handlers/entitlements.ts` + `routes-table.ts` route + optional `REVENUECAT_SECRET_API_KEY`/`REVENUECAT_API_BASE_URL` threaded through `EdgeFunctionEnv`/`buildEnv`) — **path divergence from the stub's `functions/entitlements/` dir noted** (matched the merged single-mux reality); reads authed user id as RC `app_user_id`; **env-missing → free fallback + 200 (never 500)** + logged warn; auth still fails closed (401). RC read + § 16 model are **mirrored** in the edge handler (production Deno bundle can't import workspace pkgs — same constraint as `_shared/contracts.ts`), pinned by a parity test. Added `entitlements` resource (`getMyEntitlements()`) to `@binderly/api-client` + `entitlementsDto` ({tier, activeFeatures, source:'revenuecat'|'fallback', checkedAt}) to `@binderly/api-contracts`. **Canonical `PaidFeature` reconciliation:** the § 16 spec list wins over mobile's 8-entry union (renames `pricing_graphs`→`pricing_history`, `export_csv`→`export_data`, `remove_branding`→`shareable_themes`, `cloud_ai_scan_fallback`→`cloud_ai_scan`; adds `save_smart_collections`) — migrating `apps/mobile/src/billing/` to import the hoisted union is explicitly T-PB-GATING's job, documented in the package README. **+104 tests** (73 `@binderly/entitlements` vs 40+ target; +8 api-contracts → 258; +7 api-client → 270; +16 edge-fn → 329); lint / typecheck / build all green locally (Node 22.13.0; Actions skipped per quota policy). **No Q raised** (RC's GET-subscriber lazily returns an empty subscriber → brand-new users read as free with no creation step, so the treat-as-free vs lazy-create decision is moot). Raised **#FU-54** (entitlement-fallback observability; renumbered from 53 at merge — the parallel T-DP-INFRA worker claimed #FU-53). Unblocks T-PB-GATING + T-SH-THEMES + T-GR-COMMUNITY-FLYWHEEL) — **iter 33**
- T-DP-INFRA cluster (T-DP-VERCEL + T-DP-FLY + T-DP-SUPABASE-PROD + T-DP-R2-PROD) — `e34fecf` (#98) (**Stage 11 deployment 4/6 — scaffolding-complete, awaiting Pablo's production secrets per `infra/DEPLOYMENT_SECRETS.md`**; one config-only PR on `agent/T-DP-INFRA`. **T-DP-VERCEL**: `apps/web/vercel.json` (framework nextjs, monorepo install + `turbo run build --filter=@binderly/web...`, output `.next`, region `iad1`, git auto-deploy disabled in favour of CLI) + `.github/workflows/deploy-web.yml` (push-to-main web-paths + workflow_dispatch; `vercel pull/build/deploy --prebuilt --prod`; guarded on `VERCEL_TOKEN` — deploy job skipped not failed when absent). **T-DP-FLY**: `infra/fly/{fly.toml,Dockerfile,.dockerignore,README.md}` (python:3.12-slim image installing api-python runtime deps only — no TF/torch extras — non-root user, `/healthz` http check, shared-cpu-1x/512mb) + `deploy-fly.yml` (push api-python-paths + dispatch; `flyctl deploy --remote-only`; guarded on `FLY_API_TOKEN`). **T-DP-SUPABASE-PROD**: `infra/supabase/production/{README,config.notes,migration-runbook}.md` (prod linking flow, config diff, idempotency + rollback/PITR + staging-first) + `deploy-db.yml` (push migration-paths + dispatch; `pnpm db:migrate` against `PROD_DATABASE_URL`; forward-only drizzle migrator — never reset/push; idempotent + non-destructive; guarded on the secret). **T-DP-R2-PROD**: `infra/r2/production/{README,access-keys}.md` + `cors.json` + `lifecycle.json` (bucket layout mirroring `infra/r2/README.md` — `images`/`models`/`ann` public-read, user-uploads stay in Supabase Storage; least-privilege read-only delivery vs read-write pipeline keys; no live keys). Plus consolidated `infra/DEPLOYMENT_SECRETS.md` go-live checklist (exact GitHub secret names per provider + where to obtain each + which workflow consumes them). Every live step inert until its secret lands → no deploy triggered, CI stays green. Raised **Q-021** (api-python ships only batch/CLI jobs — no FastAPI/ASGI HTTP entrypoint — so a live Fly serving deploy needs an entrypoint + fastapi/uvicorn deps from the Python track; scaffolded for the FastAPI assumption, logged go-live follow-up) + **#FU-53** (Stage 11 go-live: Pablo provisions secrets, then verify each deploy workflow once via workflow_dispatch). Local battery: every workflow YAML + JSON + TOML validated (`yaml.safe_load` / `json.load` / `tomllib`); Dockerfile manual review (hadolint/actionlint unavailable on box); `pnpm install` + `lint` + `typecheck` + `build` green — **iter 33**) — **iter 33**
- T-PB-PADDLE — `d6e565f` (**Stage 10 paywall / billing 2 / 4**; ships `apps/web/app/billing/` UI + `apps/web/app/api/paddle/webhook/` HMAC-SHA256 verifier + `apps/web/lib/paddle/` (env / plans / signature / events / revenuecat / log / client / entitlements modules) + 2 migrations (`0023_paddle_webhook_log` + `0024_paddle_webhook_log_rls` — service-role-only) + Drizzle schema + verify-rls inventory updates. `/billing` route is auth-gated via the existing `<AuthProvider>` + collection's `<SignInPrompt>` (reused with billing-tailored copy); when `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` is missing it renders an "isn't configured in this environment" placeholder rather than crashing the build. Plan catalog hardcoded in `lib/paddle/plans.ts` (PRO monthly + annual; both grant `'pro'` entitlement matching T-PB-REVENUECAT) with Paddle price ids loaded from `NEXT_PUBLIC_PADDLE_PRICE_*` env vars (per-environment sandbox vs production). Checkout flow: client clicks Subscribe → `loadPaddle()` lazy-imports `@paddle/paddle-js@1.6.4` → `Paddle.Checkout.open({ items, customData: { userId, source: 'binderly-web' } })`; SDK-level `eventCallback` fans out to a per-flow listener registry so `checkout.completed` invalidates the entitlements TanStack Query (optimistic UI flip to Pro without waiting on the webhook). Webhook handler is split into a pure `handler.ts` (testable with synthetic Request-like inputs; no `next/server` import) and a thin `route.ts` Next.js shim — handler verifies `paddle-signature` header (`ts=...;h1=...` over `${ts}:${body}`, `node:crypto.timingSafeEqual`, 5 min replay tolerance), parses 7 known event types via `mapPaddleEvent()` → `{ action: 'grant'|'revoke'|'ignore', userId, entitlementId, plan }`, forwards grants/revokes to RevenueCat's REST API (`POST /v1/subscribers/:id/entitlements/:entitlementId/promotional` with `{ duration: 'monthly'|'yearly' }`; `POST /v1/subscribers/:id/entitlements/:entitlementId/revoke_promotionals` for revokes), and persists an audit row to `paddle_webhook_log` via Supabase PostgREST + `service_role` key. Returns 401 on signature failure (missing/malformed/mismatched/replayed), 503 on missing webhook secret, 400 on un-parseable JSON, **200 even on RC downstream failure** (sets `retry=true` on the audit row + logs reason — Paddle would retry forever on non-2xx for transient downstream issues). Entitlement read adapter (`lib/paddle/entitlements.ts`) calls `client.profile.getMySubscription()` and degrades to `{ tier: 'free', authoritative: false }` on 404/5xx — TODO marker points at T-PB-ENTITLEMENTS to wire up the unified RC source. **+130 vitest tests** (target 35+; web suite now 629/629 green) across `env` (11) / `plans` (10) / `signature` (22) / `events` (17) / `revenuecat` (11) / `log` (7) / `client` (6) / `entitlements` (9) / `handler` (19) / `BillingView` (13) / `BillingRoute` (5). RLS verifier 131/0 with 3 new `paddle_webhook_log` assertions (anon SELECT denied / authenticated SELECT denied / service_role SELECT allowed). Coordinated `'pro'` entitlement-id contract with T-PB-REVENUECAT via `PRO_ENTITLEMENT_ID` constant; rules-file convention upheld. No Q-NN raised (Paddle Billing v2 + RC REST surfaces fully specified in their respective docs); ships under sandbox env defaults — production cutover is a Vercel env-var rotation + Paddle dashboard webhook URL reconfig away) — **iter 32**
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
16. **Iter-17 pre-rendered placeholders waiting on pricing-display.** ✅ **CLOSED iter 22** — T-BE-EDGE-FUNCTIONS-V2 shipped `getPrintingCurrentPrice()` in iter 21; T-W-API-V2-WIRING + T-M-API-V2-WIRING wired `pricing-display` into both CardView (via new `CardPriceBlock`) and CardScreen with loading / 404 / error states in iter 22. The "Prices coming soon" placeholder is gone on both platforms. **Closed as #FU-17.**
17. **(Reserved — duplicate slot; see #FU-17 above.)**
18. **URL convention divergence between web and mobile browse routes.** T-W-BROWSE uses raw UUIDs for `/sets/[id]` and `/cards/[id]` (api-client only exposes by-id). T-M-BROWSE uses slug-based `/sets/[slug]` resolving against the `/v1/sets` list cache (e.g. `en-base1`). Both work; both shipped green. T-W-COLLECTION inherited UUID; T-M-COLLECTION inherited slug — divergence persists in iter 18. Future cross-platform consolidation: pick one convention (probably slug, after a `getSetBySlug` endpoint lands) and migrate the other. Low priority — neither is user-visible while routes are SSR-hidden. **Logged as #FU-18.**
19. **Server-side `/v1/me/collection/completion` endpoint (Q-010 ratified).** ✅ **CLOSED iter 21-22** — T-BE-EDGE-FUNCTIONS-V2 shipped the endpoint in iter 21 (PR #68); T-W/M-API-V2-WIRING wired both T-W-COLLECTION and T-M-COLLECTION to read from it in iter 22. The on-device fanout is gone on both platforms. **Note**: the underlying mvs `mv_user_set_completion` / `mv_user_global_completion` turned out to not exist in any migration (named in PROJECT.md § 8 but never landed), so the handler computes on-the-fly against canonical tables — this is fast at v1 scale and transparent to the client. Landing the mvs + swapping to a single SELECT is now tracked as **#FU-26** (T-DL-MV-COMPLETION). **Closed as #FU-19; perf follow-up moved to #FU-26.**
20. **`@binderly/ui` `<Modal>` primitive missing.** T-W-CUSTOM rolled a modal in-tree at `apps/web/components/collections/custom/Modal.tsx` (Esc + backdrop close, ARIA dialog, no focus trap). T-W-SMART likely makes the same trade-off; iter-20+ tasks will too. Proposed `T-SP-UI-MODAL` follow-up to hoist a shared cross-platform modal into `@binderly/ui` once 2+ consumers are in main. **Logged as #FU-20.**
21. **`@binderly/ui` `<Input>` doesn't expose `onBlur` / `onEndEditing`.** T-W-CUSTOM's detail screen uses raw `<input>`/`<textarea>` for inline-edit name/description because the shared `<Input>` wrapper doesn't surface blur events. Future T-SP-UI-INPUT-BLUR adds the prop pass-through (additive). **Logged as #FU-21.**
22. **Catalog-wide PrintingPicker on mobile.** ✅ **CLOSED iter 22 (smart-editor half)** — T-M-API-V2-WIRING swapped the smart-editor Run preview to `client.smartCollections.preview()` which is catalog-wide; the unowned-tile regression is pinned by test. The `<PrintingPicker>` in the *add-card* flow is intentionally still owned-only (correct UX there — you can only add cards you have, not cards from the global catalog). Effectively closed at its meaningful scope. **Closed as #FU-22.**
23. **Server-evaluated smart-collection preview.** ✅ **CLOSED iter 21-22 (functionally)** — T-BE-EDGE-FUNCTIONS-V2 shipped `/v1/smart-collections/preview` in iter 21; T-W/M-API-V2-WIRING swapped the Run / re-run paths to call it in iter 22 on both platforms. Local `evaluate()` is retained only as (a) typing/explainer preview during DSL editing and (b) `collection.*` predicate fallback when the server returns `ApiValidationError`. **Note**: the server-side handler also evaluates the AST in JS in-memory (the Edge bundle can't import `@binderly/smart-collection-dsl`), not via `compileToSql()`. Lifting eval to Postgres RPC is now tracked as **#FU-27** (T-BE-SMART-PREVIEW-RPC). **Closed as #FU-23; backend eval cleanup moved to #FU-27.**
24. **TCGplayer affiliate URL format verification (Q-011).** T-W-AFFILIATE-LINKS' `<BuyCta>` ships with a documented placeholder URL (`/search/pokemon/product?productLineName=pokemon&q=<name> <number> <set>&utm_source=binderly&utm_medium=affiliate&utm_campaign=binderly-buy-cta&utm_id=<id>`). The Impact partner program may expect a different storefront path (`/search/all/product?productLineName=pokemon` is also common in the wild) and a different tracking param (`clickref` / `irclickid` / `partner` vs `utm_id`). Fix: sign up for the TCGplayer affiliate program once the business entity is ready; receive exact wire format + tracking param spec from Impact; update both `apps/web/lib/affiliate/tcgplayer.ts` and `apps/mobile/src/components/buy-cta/tcgplayer.ts` in lockstep (~5 LOC each + tests). Non-blocking: env-missing "Coming soon" degraded path is production default until an affiliate id lands in `NEXT_PUBLIC_TCGPLAYER_AFFILIATE_ID` / `EXPO_PUBLIC_TCGPLAYER_AFFILIATE_ID`. **Logged as #FU-24.**
25. **Server-side public shareable read endpoint (Q-012).** ✅ **CLOSED iter 21** — `T-BE-EDGE-FUNCTIONS-V2` shipped `GET /v1/c/{handle}/{slug}` anonymous with `Accept: application/vnd.binderly.share+json` opting into the richer `publicShareableDto`. T-W-SHAREABLE-PUBLIC's runtime adapter can swap its degraded synthesis for `getPublicShareablePayload(...)` in a small follow-up; the data layer was designed as the seam for exactly this.
26. **Land `mv_user_set_completion` + `mv_user_global_completion` materialised views (Q-013, half 1).** ✅ **CLOSED iter 23** — T-BE-Q013-CLEANUP shipped both mvs + `UNIQUE` indexes (for `REFRESH CONCURRENTLY`) + `security_barrier = true` wrapper views `v_my_set_completion` / `v_my_global_completion` filtered by `(SELECT auth.uid())` (PG17 lacks RLS on MVs) + `refresh_user_completion()` `SECURITY DEFINER` function in migration `0018_mv_user_completion.sql`. Completion handler swapped from on-the-fly compute → MV SELECT; `completionDto` wire shape unchanged. Best-effort `supabase.rpc()` refresh hook wired into every collection mutation (strong-consistency UX in the typical case, eventually-consistent fallback on failure; documented pivot to `pg_cron` if it scales badly). `lastUpdatedAt` temporarily `null` (MV doesn't carry `max(updated_at)`); widening is a tiny follow-up if the UI ever needs it. `bigint` may serialize as string over PostgREST; `coerceCount` handles both shapes. **Closed as #FU-26.**
27. **Smart-preview DSL-to-SQL via Postgres RPC (Q-013, half 2).** ✅ **CLOSED iter 23** — T-BE-Q013-CLEANUP shipped `smart_collection_preview(ast, p_user_id, p_limit, p_offset)` `SECURITY DEFINER` RPC + 4 PL/pgSQL helpers that port `expressionToSql()` faithfully in migration `0019_smart_preview_rpc.sql`. Smart-preview handler swapped to `client.rpc()`; `previewExpressionSchema` widened to accept `collection.*` (non-breaking). RPC security: `SECURITY DEFINER` + explicit `auth.uid() = p_user_id` guard + `SET search_path = ''` + `quote_literal()`-quoted values + static `CASE` allowlist for column refs. **Closed as #FU-27.**
28. **One-line REVOKE migration for `v_pg_stat_statements_top_queries` (`T-DL-RLS-PG-STAT-REVOKE` proposed).** `pnpm --filter @binderly/db verify-rls` reports 2 pre-existing failures on this view (anon + authenticated can read it). Cause: Supabase's default `ALTER DEFAULT PRIVILEGES … GRANT ALL ON TABLES TO anon, authenticated` fires on view creation **before** migration `0016_admin_debug_views.sql`'s `REVOKE ALL FROM PUBLIC` runs (`PUBLIC` ≠ the union of all roles). Fix: ship `0020_*.sql` with `REVOKE ALL ON public.v_pg_stat_statements_top_queries FROM anon, authenticated;`. Surfaced by the T-BE-Q013-CLEANUP worker (PR #73). **Not introduced by #73** — predates branch base on main commit `b13d3ed` (T-DL-ADMIN-DEBUG-SURFACES, iter 11). Trivial to land. **Logged as #FU-28.**
29. **`T-SC-ANN-NATIVE` (Q-014 resolution).** Native SIMD inner loop for ANN search to keep brute-force flat NN scoring at full production catalog scale (~30 k printings × 576-dim FP16) inside the 30 ms per-frame budget. Pablo's directive on Q-014: "choose accuracy, but also keep latency as low as possible" → Option 2 (native SIMD). Substantively its own Expo Module: Swift package using `Accelerate.framework` `vDSP_distancesq` for iOS + Kotlin AAR using ARM Neon intrinsics via JNI for Android + podspec / autolinking + Expo plugin to register both + TS wrapper with feature-detection fallback to the existing pure-JS path at `apps/mobile/src/scanner/ann/search.ts`. The TS surface (`searchKNN`) stays unchanged → transparent swap from `useScanner()`'s perspective. **Hold until Pablo's Xcode + Android Studio install completes**, since the sandbox can't validate native builds end-to-end (Pablo's Xcode update is in progress per current session). Beta-launch catalog (3-5 k printings, EN only) stays inside budget on the pure-JS path, so the swap is needed before the catalog grows past ~10 k printings, not before v1 beta. **Logged as #FU-29.**
30. **#FU-30 — confidence calibration on labeled real-phone scans (T-SC-MATCH follow-up).** `rules/06-scanner.md` sets a target of **FP < 0.5%** for auto-add. T-SC-MATCH shipped first-principles defaults for L2-normalised cosine (`autoAddScore = 0.78`, `disambigScore = 0.55`, `topGapMin = 0.04`, `stabilityCount = 3`). Real-world calibration needs a labelled set of phone-shot scans against known printings to tune these — different phone cameras have different sharpness/colour characteristics that may shift the cosine distribution. **Pablo captures the dataset** (mix of well-lit / dim / glossy / matte / different sleeves; both positives and confounders); a follow-up worker tunes the thresholds and ships a `confidence-calibration.json` fixture + unit tests that pin the chosen values. **Logged as #FU-30.**
31. **#FU-31 — T-GR-CAPTURE-FULL-SCHEMA (T-GR-CAPTURE-UX follow-up).** The remaining 2 corner crops (bottom-left, bottom-right) + the surface raking-light shot from PROJECT.md § 12 weren't shipped in v1. T-GR-CENTERING + T-GR-CORNERS only need the 4 already shipped (front + back full, front-corner top-left, back-corner top-right). Full schema adds 3 capture steps + 3 quality gates + 3 overlay framings to the existing 4-shot session. **Logged as #FU-31.**
32. **#FU-32 — T-GR-CENTERING-ROUTING (T-GR-CAPTURE-UX follow-up).** Session hand-off from capture → centering uses a module-scoped ref `__getLastEmittedSession()` tagged `@deprecated`. T-GR-CENTERING swaps in a real router-param strategy — likely expo-router params + a stable session id, since the 4 captured stills are too large to serialise into URL params and need to stay in-memory. **Logged as #FU-32.**
33. **#FU-33 — live frame-processor sample for capture-button quality state (T-GR-CAPTURE-UX follow-up).** Today `attemptCapture` is screen-injected and runs only on capture-button tap. The `CaptureAttemptInput` shape is already designed to compose a live frame-processor quality stream with `takePhoto()` once a CPU-side JPEG decoder is bundled. UX win: capture button can disable / show "hold steady" / hint corner-framing hints before the user even taps. **Logged as #FU-33.**
34. ✅ **CLOSED (backlog burndown; 2026-05-29 — T-SC-POLISH).** Shipped via a `usePrinting(printingId)` lookup hook (`apps/mobile/src/screens/scan/use-printing.ts`) reading the existing `client.cards.getPrinting()` — no api-client / `MatchResult` DTO change needed (the printing id was already on every `MatchResult` + ANN candidate). `<CardThumbnail>` + the wired `MatchOverlay`/`DisambigPicker` render real images with loading/error/no-image placeholder fallback. **#FU-34 — scanner thumbnail URL plumbing (T-SC-UX follow-up).** `MatchOverlay` + `DisambigPicker` show coloured placeholders today; need `MatchResult` to expose a thumbnail URL or a `usePrinting()` lookup hook reading from the api-client. Small backend addition (the printing already has an image URL in the catalogue; just needs to flow through the match result DTO) + 2 UI component swaps. **Logged as #FU-34.**
35. ✅ **CLOSED (backlog burndown; 2026-05-29 — T-SC-POLISH).** Shipped a module-scope warm cache (`apps/mobile/src/scanner/model-cache.ts`) keyed on the model+index asset identity; `useModelLoader` opts in via `warmCacheKey` (production path only) and skips disposal so handles stay warm across remounts. **Lifetime: indefinite for v1** (both assets small + in-bundle) with a `resetModelWarmCache()` test hook. **#FU-35 — scanner model warmup cache (T-SC-UX follow-up).** `useModelLoader` re-loads the TFLite model + ANN index on every `ScanScreen` remount; tab navigation costs ~200-400 ms of warmup. A module-level singleton cache keyed on `model + index` paths would keep both warm across tab switches. Decision needed on lifetime/eviction (likely indefinite for v1 since both assets are small and shipped in-bundle). **Logged as #FU-35.**
36. **#FU-36 — pure-JS on-device centering (T-GR-CENTERING follow-up).** T-GR-CENTERING ships the Python authoritative algorithm + a TS `not_implemented` stub. On-device port (pure JS, or a thin native module wrapping OpenCV-mobile) needed before centering can run without server round-trip. The TS `CenteringService` factory is already the swap seam. Blocked on accuracy validation against real Pokémon card photos — needs Pablo's calibration dataset (overlapping concern with #FU-30). **Logged as #FU-36.**
37. **#FU-37 — live-fetch verification across all 3 grading data scrapers (iter 28 reconciliation).** Run `PSA_LIVE=1` against PSA's real cert lookup + `EBAY_GRADING_LIVE=1` against eBay's Finding API + live verification of robots.txt + archive paths for PWCC and Goldin. Each scraper ships mock-by-default + a documented live env flag; this follow-up is the single end-to-end smoke that Pablo runs once when he has data-collection budget + grading-data API credentials. **Logged as #FU-37.**
38. **#FU-38 — browser-driven fetcher fallback (iter 28 cross-cutting follow-up).** Playwright / headless-chrome backend swapped behind the existing `fetch_html` (PSA) and `_fetch_page` (auctions) hooks. Needed only if PSA's Cloudflare gating triggers in practice or if Goldin / PWCC archive pages turn out to be JS-gated. Pure HTML path is the v1 default; this follow-up swaps in a heavier backend behind the same hook contract without API changes upstream. **Logged as #FU-38.**
39. **#FU-39 — image download + Supabase Storage / R2 ingest for graded card images.** Today the iter 28 scrapers persist `thumbnail_url` (eBay) and `lot_image_urls` (auctions) as remote URLs only. Hosting images ourselves needs: a downloader job + content-addressed storage on R2 (or Supabase Storage) + a normalised image rewrite when the row is read. Re-uses `T-DL-IMAGE-PIPELINE`'s sharp transcode + SHA-256 dedup primitives. **Logged as #FU-39.**
40. **#FU-40 — `T-GR-DATA-PRINTING-MATCH` (proposed; iter 28 cross-cutting follow-up).** Resolve the NULL `printing_id` FK on grading observation tables (`grading_training_sample` rows from PSA + eBay, `auction_lot_observation` rows from PWCC + Goldin). All 3 scrapers leave `printing_id` NULL intentionally — fuzzy matching against the canonical `printings` table is its own task. Likely strategy: trigram + ANN search over `(card_name, set_name, card_number)` tuples + a confidence threshold + a manual-resolution surface in admin UI for low-confidence matches. Substantively a backend Python task with its own pytest battery. **Logged as #FU-40.**
41. **#FU-41 — Background browse-history pre-warming for `printing_lite` (scope refined by T-OF-QUEUE; iter 31).** T-OF-QUEUE shipped user-collection sync (mutation queue + replay engine). Q-016 is resolved: `set_logo_url` is now denormalised into `printing_lite` via v2 migration. The remaining gap is pre-populating `printing_lite` for printings the user has *browsed but not yet collected* — so CollectionScreen and browse thumbnails render offline without ever having added the card. Requires: (a) a browse-history repository that records `printing_id` on card-detail screen visits; (b) an `onLocalWrite`-style hook or a separate enqueue path in T-OF-QUEUE's enqueue layer; (c) possibly a `browse_history` table or just an in-memory LRU upsert. Blocked on browse-history screen events (future task; no planned iter). **Logged as #FU-41.**
42. **#FU-42 — Real CNN training for corners sub-grade (T-GR-CORNERS follow-up; iter 30).** The `CornersModel` CI implementation is a numpy linear regression placeholder. Real training requires: (a) enough labelled PSA cert / eBay / auction rows with non-null `corners` sub-grade (currently only synthetic fixtures); (b) `torch + torchvision` installed (`pip install -e ".[ml]"`); (c) running `make train CORNERS_USE_TORCH=1` in `apps/api-python/grading/corners/`; (d) exporting the ONNX artifact to R2 at `models/grading/corners/v1/model.onnx`; (e) wiring the R2 path into `CornersInferenceEngine`. Blocked on: more labelled data (depends on #FU-40 printing_id match + community flywheel launch). **Logged as #FU-42.**
43. **#FU-43 — On-device ONNX inference for corners via `onnxruntime-react-native` (T-GR-CORNERS follow-up; iter 30).** The TypeScript `CornersService` v1 returns `not_implemented`. A future impl would load the ONNX artifact via `onnxruntime-react-native` and run inference on-device (≤200ms target per `rules/07-grading.md`). Requires: evaluating `onnxruntime-react-native` bundle size + latency on mid-range iOS/Android; possibly a custom Metro config to bundle the `.onnx` file; or falling back to a server endpoint if the on-device path is too heavy. Blocked on: #FU-42 (trained model file); `onnxruntime-react-native` availability + iOS/Android native build support. **Logged as #FU-43.**
44. **#FU-44 — `ml_common` subgrade-key generalisation (closes Q-017; raised by T-GR-EDGES + hit independently by T-GR-SURFACE; iter 30).** `ml_common/types.py` ships `LabelledGradingSample.corners_score` as the labelled target field and `MergedDataLoader` hard-codes `subgrades->>'corners'`. Both T-GR-EDGES and T-GR-SURFACE worked around this by shipping parallel `EdgesMergedDataLoader` / `SurfaceMergedDataLoader` in their own subtrees — 3 near-identical loaders diverging only on the subgrade key string. **Cleanup task `T-GR-ML-COMMON-GENERALISE`:** (a) rename `corners_score` → `subgrade_score`; (b) generalise `MergedDataLoader.__init__(subgrade_key: Literal['corners','edges','surface'])`; (c) drop `EdgesMergedDataLoader` (`apps/api-python/grading/edges/dataset.py`) + `SurfaceMergedDataLoader` (`apps/api-python/grading/surface/dataset.py`); (d) update all 3 sub-grade dataset tests. All sub-grade siblings merged → safe to land as a single PR. T-GR-AGGREGATE is independent (consumes per-sub-grade predictions, not labelled training data), so it can run in parallel with this cleanup. **Logged as #FU-44; closes Q-017.**
45. **#FU-45 — Real PyTorch CNN training pass for edges + surface sub-grades (omnibus; T-GR-EDGES + T-GR-SURFACE follow-up; iter 30).** Both `EdgesModel` and `SurfaceModel` CI implementations are numpy linear regression placeholders mirroring the #FU-42 pattern for corners. Real training requires: (a) enough labelled PSA cert / eBay / auction rows with non-null `edges` / `surface` sub-grades; (b) `torch + torchvision` installed (`pip install -e ".[ml]"`); (c) running `make train EDGES_USE_TORCH=1` and `make train SURFACE_USE_TORCH=1` in their respective `apps/api-python/grading/<sub>/` dirs; (d) exporting ONNX artifacts to R2 at `models/grading/{edges,surface}/v1/model.onnx`. Note: raking-light shot (better surface accuracy) is not yet captured — see #FU-31. Blocked on: labelled data (depends on #FU-40 printing_id match + community flywheel launch). Trains side-by-side with #FU-42 (corners) when training-data budget unlocks. **Logged as #FU-45.**
46. **#FU-46 — Deploy edges + surface sub-grade inference (omnibus; T-GR-EDGES + T-GR-SURFACE follow-up; iter 30).** The TypeScript `EdgesService` and `SurfaceService` v1 both return `not_implemented`. Future impls either (a) make a network call to the Python grading service once T-GR-SERVING deploys the FastAPI endpoint covering all 4 sub-grades (centering + corners + edges + surface), or (b) run `onnxruntime-react-native` on-device once #FU-43 (corners ONNX harness) lands and #FU-45 produces the trained models. Decision deferred to whoever picks up T-GR-SERVING; bundle-size vs latency trade-off is identical for edges + surface. Blocked on: T-GR-SERVING (not yet dispatched) **or** #FU-43 (on-device ONNX harness) + #FU-45 (trained models). **Logged as #FU-46.**
47. **#FU-47 — Hyperparameter tuning + dataset curation across all sub-grade models (T-GR-EDGES follow-up; iter 30).** Once #FU-42 + #FU-45 produce real-CNN training pipelines for corners + edges + surface, run a systematic HPO sweep (learning rate, batch size, augmentation strength, freeze/unfreeze schedule for MobileNetV3 trunk) + curate the labelled dataset (handle class imbalance — most graded slabs are 8–10, very few low-end; partition PSA / eBay / auction sources for cross-source validation; flag anomalous label noise). Single coordinated effort across all 3 sub-grades since they share the `ml_common` training loop. Blocked on: #FU-42 + #FU-45 (both need real CNN paths landed first). **Logged as #FU-47.**
48. **#FU-48 — Learned-weights upgrade for T-GR-AGGREGATE (iter 31).** The v1 aggregator is a numpy linear-weighted-sum with hand-tuned PSA-grounded priors (centering 0.25 / corners 0.35 / edges 0.25 / surface 0.15). Once labelled PSA-graded grading sessions are available at scale (post-#FU-40 printing_id match + community flywheel launch), train a small dense regression head (4 inputs → 8 hidden Hardswish → 1 output, clamped to [1.0, 10.0]) against ground truth and export it via the `AGGREGATE_USE_TORCH=1` env-gated path that mirrors `CORNERS_USE_TORCH=1` / `EDGES_USE_TORCH=1` / `SURFACE_USE_TORCH=1`. The `AggregateWeights` constructor + `LinearWeightedAggregator.set_parameters()` already accept arbitrary normalised weights, so the swap is a localised refactor with no public API change. Re-tune the float→categorical confidence thresholds (currently 0.66 / 0.33) and the spread heuristic (`< 1.0` for 'high', `>= 2.0` forces 'low') in the same calibration pass — see Q-018 for the rationale. Blocked on: labelled data (#FU-40 + community flywheel). Trains alongside #FU-42 (corners) + #FU-45 (edges + surface). **Logged as #FU-48.**
49. **#FU-49 — `T-BE-API-CLIENT-SINGLE-GET-COLLECTION-ITEMS` (proposed; T-OF-CONFLICTS / Q-019 follow-up; iter 31).** `@binderly/api-client`'s `CollectionResource` ships `listCollectionItems({ cursor })` and `listCustomCollectionItems({ customCollectionId })` (paginated) but no single-fetch `getCollectionItem({ id })` or `getCustomCollectionItem({ customCollectionId, printingId })`. T-OF-CONFLICTS' `ServerFetcher` adapter currently walks pages client-side and gives up at `MAX_PAGE_WALK = 50` (~5 000 items) → `transient_error` retry. Once api-client adds the 2 single-GETs (plus matching backend routes if not already present in Supabase Edge functions), swap the page-walk for direct GETs behind the same `ServerFetcher` interface (no resolver changes needed; the adapter is the only consumer). Drop the `MAX_PAGE_WALK` cap and the `transient_error` walk-limit branch. Small additive task (~30 LOC client + tests + 2 small backend routes). Blocked on T-BE-API-CLIENT maintainer cycle. **Logged as #FU-49.**
50. **#FU-50 — `T-SH-KILL-SWITCH` (proposed; T-SH-CONFIG-MODEL / Q-020 follow-up; iter 32).** Add an `is_active boolean DEFAULT true NOT NULL` column to `packages/db/src/schema/shareables.ts` (`shareable` table) via a new migration `0023_*.sql`, gate the public read path (`/v1/c/{handle}/{slug}` Edge function — supabase/functions/c/ shipped in iter 21 T-BE-EDGE-FUNCTIONS-V2) on `is_active = true` so the 404 boundary is enforced before any RLS-public predicate ever runs, surface a per-shareable "Visible to the public" toggle in the settings UI (`<ShareableRowEditor>` on both web + mobile), and update `shareableDto` + `updateShareableRequest` contracts to expose the flag. T-SH-CONFIG-MODEL deliberately deferred this so the iter could ship without a destructive schema change while parallel `T-SH-OG-IMAGES` was in flight; the kill-switch is a small additive migration + a single toggle row on the existing UI. **Logged as #FU-50.**
51. **#FU-51 — `T-SH-SOCIAL-LINKS` (proposed; T-SH-CONFIG-MODEL / Q-020 follow-up; iter 32).** Add a `social_links jsonb DEFAULT '[]'::jsonb NOT NULL` column to `packages/db/src/schema/profiles.ts` (`profile` table) via a new migration, with a zod-validated shape of `Array<{ platform: 'twitter' | 'instagram' | 'tiktok' | 'youtube' | 'discord' | 'website', handle: string }>` and a max of 10 entries (validation already prototyped in the settings validators ready to be lifted into `@binderly/api-contracts`). Surface a tag-style add/remove editor with platform dropdown + handle input in both the web and mobile settings UI (the existing `<ProfileFields>` layouts on both apps have a hook for the section), and expose the field on `profileDto` + `updateProfileRequest` so the public shareable page can render social-link chips. T-SH-CONFIG-MODEL deferred this since the brief's minimum scope didn't include the editor UX detail; this is a focused additive task. **Logged as #FU-51.**
52. **#FU-52 — `T-BE-SHAREABLES-HANDLE-CHECK` (proposed; T-SH-CONFIG-MODEL / Q-020 follow-up; iter 32).** Ship `GET /v1/me/handle-available?handle=<handle>` as a small Supabase Edge function under `supabase/functions/profile-handle-available/` that (a) re-validates the input through `shareableHandleSchema` (already exported from `@binderly/api-contracts/src/auth.ts` and consumed client-side by the new `ProfileResource.checkHandleAvailability()`), (b) queries `select 1 from public.profile where lower(handle) = lower($1)` to check uniqueness (case-insensitive), (c) consults a small server-side reserved-handle list (`admin`, `support`, `binderly`, `api`, `www`, `app`, `c`, `auth`…), and (d) responds with the already-shipped `handleAvailabilityResponse` DTO shape `{ handle, available, reason?: 'taken' | 'invalid' | 'reserved' | 'rate_limited' }`. Add a rate-limit gate (10 requests / minute / user) so the debounced UI checks can't be weaponised. The web + mobile settings UI already degrades gracefully to a "we'll verify on save" message when the endpoint 404s, so this can ship asynchronously without breaking the owner-side flow. **Logged as #FU-52.**
53. **#FU-53 — Stage 11 go-live: provision production secrets, then verify each deploy workflow (T-DP-INFRA cluster follow-up; iter 33).** The four Stage 11 deploy paths (T-DP-VERCEL/FLY/SUPABASE-PROD/R2-PROD) ship as inert scaffolding — every live step is guarded on its provider secret and skipped (not failed) until provisioned. Go-live: Pablo adds the secrets enumerated in `infra/DEPLOYMENT_SECRETS.md` to the GitHub repo (`VERCEL_TOKEN` + `VERCEL_ORG_ID` + `VERCEL_PROJECT_ID` + Vercel project env vars; `FLY_API_TOKEN`; `PROD_DATABASE_URL`; R2 `R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_BUCKET`/`R2_ENDPOINT`) + creates the R2 buckets/custom-domain/CORS/lifecycle + the prod Supabase project (`supabase link` + `config push`) + the Vercel project (Root Directory `apps/web`, monorepo include-outside-root). Then a verification pass runs **each deploy workflow once via `workflow_dispatch`** (recommended order: db migrate → web → fly) and confirms the live deploy + a basic health check. **Blocked on:** Pablo provisioning the production accounts/secrets, **and for Fly specifically** on #FU-53's sibling prerequisite — the Q-021 HTTP entrypoint (`binderly_api.main:app` + `fastapi`/`uvicorn` in `apps/api-python`, a Python-track task) without which the Fly machine fails its `/healthz` check. **Logged as #FU-53.**
54. **#FU-54 — Entitlement-fallback observability (proposed; T-PB-ENTITLEMENTS follow-up; iter 33; renumbered from 53 — the parallel T-DP-INFRA worker claimed #FU-53).** The `@binderly/entitlements` RC read client + the `GET /v1/me/entitlements` Edge handler are deliberately **fail-closed**: any RC outage / non-200 / malformed body / missing `REVENUECAT_SECRET_API_KEY` silently degrades every caller to `{ tier: 'free', source: 'fallback' }`. That's the correct UX (never 500, never over-grant), but it also means a *prolonged* RC outage or a key misconfiguration would silently downgrade the whole user base to free with no alarm — today the only signal is a `console.warn`. Follow-up: emit a structured metric/log on every `source: 'fallback'` (count + reason), wire a threshold alert (e.g. fallback rate > N% over 5 min → page on-call), and consider a short-TTL server-side cache of the last-known-good RC read per user so a transient blip doesn't flap paying users to free between requests. Small additive observability task; no API change (the DTO already carries `source`). **Logged as #FU-54.**
55. **#FU-55 — `T-BE-COMMUNITY-SUBMISSION-ENDPOINT` (proposed; T-GR-COMMUNITY-FLYWHEEL follow-up; iter 34).** Ship the `POST /v1/me/community-submissions` Edge handler that backs the already-merged `client.communitySubmissions.submitCommunitySubmission()` resource + `submitCommunitySubmissionRequest`/`submitCommunitySubmissionResponse` contracts. The handler: (a) re-validates the body server-side (the client validators in `apps/mobile/src/grading/community/validation.ts` mirror, but never replace, server validation), (b) **pro-gates** via the same RC entitlement read as `GET /v1/me/entitlements` (`grading_prediction`) → 403 for free users, (c) normalizes the cert number + upserts into `community_submission` keyed on `(user_id, grade_company, cert_number_normalized)` returning `alreadySubmitted: true` on an idempotent re-submit, and (d) maps to the `communitySubmissionDto` response shape. This intentionally lands after the client + contract (same pattern as the `entitlements`/`grading` resources preceding their handlers); until it deploys the mobile flow surfaces the network error state. **Logged as #FU-55.**
56. **#FU-56 — Cross-company grade calibration + flywheel job runner wiring (proposed; T-GR-COMMUNITY-FLYWHEEL follow-up; iter 34).** The flywheel ingestion (`apps/api-python/grading/flywheel/`) currently normalizes each company's grade onto the **same** 1–10 0.5-step grid and stores the raw company + grade alongside — a conservative mechanical mapping, NOT a calibrated cross-company equivalence (a BGS 9.5 ≠ a PSA 9.5 in practice). Proper calibration is a real ML/product decision: fit a per-company → canonical-PSA-scale transform (mirroring `rules/07-grading.md`'s PSA-calibration posture for the aggregator) once enough paired/overlap data exists. Separately, wire `run_ingestion`'s mock-by-default `db_upsert_fn` / `existing_source_id_fn` seams to a live DB job runner (reading opted-in `community_submission` rows → writing `grading_training_sample`) behind a live env gate, mirroring the iter-28 scraper job wiring. Image transcode/storage for submitted photos rides #FU-39 (today image refs are persisted as URLs). **Logged as #FU-56.**
34. ✅ **CLOSED (backlog burndown; 2026-05-29 — T-SC-POLISH; duplicate of the #FU-34 entry above).** No `MatchResult`/T-SC-MATCH change was needed — the printing id already flows through; resolved via the `usePrinting()` lookup hook + `<CardThumbnail>` swap in both components with graceful fallback. **#FU-34 — Thumbnail images in MatchOverlay + DisambigPicker (T-SC-UX follow-up).** `MatchOverlay` and `DisambigPicker` render a coloured placeholder box in place of a card thumbnail. Blocked on T-SC-MATCH exposing a thumbnail URL in `MatchResult` or a separate printings-lookup hook (`usePrinting(printingId)`). Once available, swap the `YStack` placeholder for `<Image source={{ uri: thumbnailUrl }} />` with a shimmer fallback. **Logged as #FU-34.**
35. ✅ **CLOSED (backlog burndown; 2026-05-29 — T-SC-POLISH; duplicate of the #FU-35 entry above).** Module-scope warm cache keyed on the asset identity; indefinite lifetime for v1 (documented), reset hook for tests. **#FU-35 — Module-level model cache for useModelLoader (T-SC-UX follow-up).** `useModelLoader` re-triggers load on every `ScanScreen` remount (tab switch, back-navigate). A singleton/module-scope cache (similar to `expo-av`'s `Audio.Sound`) would keep the model warm across tab switches and skip the loading state on second visit. Blocked on deciding the right cache lifetime and eviction strategy (low-memory signal? app backgrounding?). **Logged as #FU-35.**
36. **#FU-36 — Pure-JS on-device centering algorithm (T-GR-CENTERING follow-up).** The TypeScript v1 ships a `not_implemented` stub that gracefully defers to the Python service. A pure-JS port of the contour-detection approach (using the scanner's gradient-projection rect finder as a reference) would enable full on-device inference without OpenCV. Blocked on: accuracy validation against real Pokémon card photos; decision on acceptable latency budget. **Logged as #FU-36.**
37. **#FU-37 — Browser-driven live-fetch seam validation (T-GR-DATA-PSA follow-up).** Run `PSA_LIVE=1` smoke test post-merge against a handful of real PSA cert URLs to confirm the HTML-based BeautifulSoup4 parser extracts grades correctly. If PSA requires JS rendering (React-hydrated tables), swap `PsaClient.fetch_html` for a playwright back-end via the existing hook seam. Blocked on Pablo enabling data-collection budget. **Logged as #FU-37.**
38. **#FU-38 — `printing_id` fuzzy-match pass for psa_cert rows (T-GR-DATA-PSA follow-up).** `grading_training_sample` rows written by the PSA scraper have `printing_id = NULL`. A separate resolution pass should match `(card_name, set_name, card_number)` → `printing_id` in the catalog after the catalog stabilizes. Blocked on catalog completeness. **Logged as #FU-38.**
39. **Cosmetic chore for Pablo: orphan worktree dirs at `/Users/pmiranda/Stuff/binderly-wt-T-*`.** Git no longer tracks them as worktrees; safe to `rm -rf`. pnpm-store residue blocks sandbox `rm`. Affected: T-DL-SEED-INGEST, T-FN-LINT-CONFIG, T-M-COLLECTION, T-W-BROWSE, T-W-COLLECTION, T-W-CUSTOM, T-W-SHAREABLE-PUBLIC, T-W-SMART, T-BE-EDGE-FUNCTIONS-V2, T-W-API-V2-WIRING, T-M-API-V2-WIRING, T-SC-CAMERA, T-SC-EMBED-MODEL, T-BE-Q013-CLEANUP, T-DL-RLS-PG-STAT-REVOKE, T-SC-ANN-INDEX, T-SC-DETECT, T-SC-MATCH, T-GR-CAPTURE-UX, T-SC-UX.

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
