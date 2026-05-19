# T-W-API-V2-WIRING — Wire V2 read endpoints into web surfaces

**Stage:** 04-web
**Agent role:** frontend-web
**Effort:** L
**Status:** in_review

## Hard dependencies

- T-BE-EDGE-FUNCTIONS-V2 (merged `472fdcf`, PR #68) — shipped the
  four new V2 read endpoints + matching `@binderly/api-client`
  methods this task swaps in.
- T-W-COLLECTION (merged) — the on-device `catalogRoster()` +
  `computeCompletion()` stop-gap this task replaces on the
  `/collection` home and `/collection/sets/[id]` drill-down.
- T-W-BROWSE (merged) — `CardView`'s "Prices coming soon"
  placeholder this task wires for real.
- T-W-SHAREABLE-PUBLIC (merged) — `apiToShareApi`'s degraded-
  synthesis adapter branch this task swaps to a direct call.
- T-W-SMART (merged) — the smart-collection canonical preview
  surfaces (`SmartEditorView`'s post-Run results +
  `SmartDetailView`'s saved-collection results) this task moves
  off in-browser `evaluate()`.
- T-SP-PRICING-DISPLAY (merged) — `formatPrice` /
  `convertPrice` / row-helpers used by the new CardView pricing
  block.

## Soft dependencies

- T-M-API-V2-WIRING — same four-endpoint wiring on mobile,
  parallel-safe.

## Required reading

- `PROJECT.md` § 8 (Collection completion math), § 13 (Pricing),
  § 14 (Shareables)
- `tasks/02-backend/T-BE-EDGE-FUNCTIONS-V2.md` — endpoint shapes,
  `Accept`-header semantics, error contracts.
- `rules/04-web.md` — RSC + force-dynamic + loading-state rules.
- `packages/api-client/src/resources/{collection,pricing,shareables,smartCollections}.ts`
  — new method signatures.
- `packages/api-contracts/src/{collection,pricing,shareables}.ts`
  — `completionDto`, `printingCurrentPriceDto`,
  `publicShareableDto`, `smartPreviewRequestDto` +
  `smartPreviewResponseDto`.
- `open-questions.md` § Q-013 — backend stop-gaps the contract
  hides from this layer (compute-on-the-fly completion; in-JS
  DSL eval). The web code doesn't see them; flagged so
  reviewers know the perf characteristics will change later.
- `apps/web/lib/share/api.ts` — `PublicSharePayload` seam.
- `apps/web/lib/collection/api.ts` — `CollectionApi.catalogRoster()`
  fanout being removed.
- `apps/web/components/browse/CardView.tsx` — pricing placeholder
  surface.
- `apps/web/components/collections/smart/SmartEditorView.tsx`,
  `SmartDetailView.tsx` — canonical preview surfaces.

## Goal

`T-BE-EDGE-FUNCTIONS-V2` (PR #68, merged `472fdcf`) shipped four
new read endpoints + matching `@binderly/api-client` methods.
This task swaps the **web** client-side stop-gaps shipped in
iters 17 / 18 / 20 for direct calls to those endpoints. The
overarching shape: drop O(catalog) fanouts, render real
authoritative numbers, keep iter-14's no-env build invariant
intact, keep loading + 404 + error states explicit, and keep
the existing test fixtures (`createFakeCollectionApi`,
`createFakeShareApi`, `createFakeSmartCollectionsApi`) usable
unchanged.

## Deliverables

### Surface 1 — Completion (T-W-COLLECTION swap)

- `apps/web/lib/collection/api.ts` — add
  `CollectionApi.getCompletion(signal?): Promise<CompletionDto>`;
  the runtime adapter calls `client.collection.getCompletion()`.
  `catalogRoster()` stays on the interface for now because the
  per-set drill-down still needs per-card / per-printing
  resolution for its Owned / Missing grids (that surface is
  NOT what this task replaces — the brief calls out completion
  numbers, not per-printing membership). Tests cover the new
  method.
- `apps/web/components/collection/CollectionView.tsx` — replace
  the `catalogRoster()` + `computeCompletion()` block with a
  single `api.getCompletion()` call. The view now reads
  `global.allPokemonPct`, `global.masterPct`,
  `global.uniqueCardsOwned/Total`,
  `global.masterOwned/Total`, plus the `perSet` rows
  (`setId`, `setCode`, `setName`, `setPct`, `masterPct`,
  `ownedNumbered/Total`, `ownedMaster/Total`) directly. The
  list still filters to "sets the user owns ≥1 printing in"
  (`ownedNumbered > 0`).
- `apps/web/components/collection/CollectionSetView.tsx` — the
  set drill-down's header progress bars come from
  `getCompletion()`'s `perSet[setId]` row instead of running
  `computeCompletion()` locally. The Owned / Missing grids
  still need per-card data (no V2 endpoint for that yet), so
  `listSetContents()` + `listOwnedItems()` stay.
- `apps/web/lib/collection/fixtures.ts` — extend
  `createFakeCollectionApi` with a `getCompletion` vi.fn
  defaulting to a fixture derived from the existing roster +
  owned-items pair (so test code that didn't override gets
  the same numbers it used to). Backward-compatible.
- Tests: happy-path, error, empty-collection, per-set drill-
  down (covers setView consuming the new shape).

### Surface 2 — Pricing (CardView wire)

- `apps/web/lib/browse/api.ts` — extend `BrowseApi` with
  `getCurrentPrice(printingId, signal?):
   Promise<PrintingCurrentPriceDto | null>`. The runtime
  adapter calls `client.pricing.getPrintingCurrentPrice({
  printingId })`. A 404 (no row in `mv_current_price`)
  resolves to `null` rather than throws — distinguished from
  generic errors so the view can render the "no pricing yet"
  empty state distinctly from the error state.
- `apps/web/components/browse/CardView.tsx` — replace the
  "Prices coming soon" placeholder with a real
  `<CardPriceBlock>` subcomponent rendering loading / 404 /
  error / present states. The present state renders
  `formatPrice(...)` for medianPrice + price range
  (`lowPrice`–`highPrice`) and a freshness badge
  (`fresh`, `stale`, `stale_old`). Sample count + computedAt
  date are surfaced as supporting metadata. `trend_7d` /
  `trend_30d` are NOT rendered because the V2 DTO does not
  carry them (see Q-013); the surface is forward-compatible
  if the backend follow-up adds them.
- `apps/web/lib/browse/format.ts` — small `freshnessLabel()`
  helper + `formatCurrentPriceComputedAt()` helper used by
  the new block, kept testable in isolation.
- `apps/web/lib/browse/fixtures.ts` — `makeCurrentPriceDto()`
  builder + `createFakeBrowseApi` extension covering the new
  `getCurrentPrice` method (404 + happy path + reject-all).
- Tests: loading, 404, error, present (median + range + label
  + freshness badge), null `medianPrice` (degenerate row
  with `sampleCount: 0`).

### Surface 3 — Shareable (Q-012 closed)

- `apps/web/lib/share/api.ts` — rewrite `apiToShareApi`'s
  body to call
  `client.shareables.getPublicShareablePayload({ handle,
  slug })` (the new method that opts into
  `Accept: application/vnd.binderly.share+json`). The
  resulting `PublicShareableDto` is structurally identical
  to the existing `PublicSharePayload` interface — the only
  divergence is the `shareableDto` substructure which is
  already shared. No degraded synthesis fallback: a 5xx
  propagates as an error, the page renders its error state,
  the fixture-driven tests keep working. The fake adapter
  (`createFakeShareApi`) ALREADY returns the richer shape,
  so no fixture changes are needed.
- The existing test
  `apps/web/lib/share/api.test.ts` is rewritten to point at
  the new method; the public interface, behaviours and 404
  fallback are preserved.
- Tests: happy path (forwards handle + slug + signal),
  null on 404 (page calls `notFound()`), error propagation
  on 5xx, both `full` and `custom` shareable targets.

### Surface 4 — Smart-preview (canonical swap)

- `apps/web/lib/collections/smart/api.ts` — add
  `SmartCollectionsApi.runServerPreview(input:
  SmartPreviewRequestDto, signal?): Promise<SmartPreviewResponseDto>`.
  The runtime adapter calls
  `client.smartCollections.preview(...)`. `previewCatalog()`
  STAYS on the interface — the editor's "typing preview"
  (debounced, in-browser) keeps using the local
  `evaluate()` path because (a) every keystroke does NOT
  warrant a server round-trip; (b) the local evaluator
  resolves `collection.*` predicates that the server
  preview rejects with 400 (D5 in
  T-BE-EDGE-FUNCTIONS-V2). The canonical post-Run /
  saved-collection results swap to the server preview.
- `apps/web/lib/collections/smart/run.ts` — add
  `mapSmartPreviewResponse(response): SmartRunMatch[]`
  pure helper that projects `SmartPreviewItemDto[]` into
  the existing `SmartRunMatch` display shape so
  `<MatchGrid>` doesn't fork. Returns a synthetic
  `printing` / `card` / `set` triple narrow enough to
  satisfy `MatchGrid`'s reads (id, image, name, number,
  variant class, set name, set code).
- `apps/web/components/collections/smart/SmartEditorView.tsx`
  — split the "Run" button into two behaviours: in-browser
  typing-preview keeps running on every parse (no extra
  cost), and clicking Run now calls the server preview
  (loading / error states added). The local
  `runExpression()` is preserved as a "draft preview" fallback
  iff the server returns 400 with a `collection.*`-related
  message, so power users can still preview rules that
  the server can't yet execute.
- `apps/web/components/collections/smart/SmartDetailView.tsx`
  — saved-collection viewer's canonical results come from
  the server preview; the local `runExpression()` path stays
  as the `collection.*`-predicate fallback (same 400 branch).
- `apps/web/lib/collections/smart/fixtures.ts` — extend
  `createFakeSmartCollectionsApi` with a
  `runServerPreview` vi.fn defaulting to a synthetic
  `SmartPreviewResponseDto` derived from the existing
  in-browser run of the fixture preview, so tests that
  didn't override get the same matches as before.
- Tests: editor server-Run success, editor server-Run error,
  editor `collection.*` fallback (server 400 → local eval),
  detail-view server-render success, detail-view error
  state, detail-view `collection.*` fallback.

### Out-of-owns_paths edits (pre-authorized by the orchestrator brief)

- `dependencies.yaml` — flip `T-W-API-V2-WIRING`
  `status: pending → in_review`, `stub: true → false`.
- `tasks/04-web/T-W-API-V2-WIRING.md` — this file (full
  elaboration).
- `open-questions.md` — only if a new escalation is needed.
  None expected.

## Acceptance criteria

1. `apps/web/lib/collection/api.ts` exposes
   `getCompletion()`; `CollectionView` + `CollectionSetView`
   render their progress bars from `CompletionDto`. Tests
   cover happy-path, empty-collection (all-zero), and error
   (5xx).
2. `apps/web/components/browse/CardView.tsx` renders real
   `<CardPriceBlock>` via `pricing-display`'s `formatPrice`.
   Loading / 404 / error states are visually distinct. Tests
   cover each state.
3. `apps/web/lib/share/api.ts` calls
   `client.shareables.getPublicShareablePayload(...)`. The
   degraded synthesis branch is gone. 404 still maps to
   `null`; 5xx propagates. Existing fake-adapter tests still
   pass; new tests assert the new branch wires correctly.
4. `apps/web/components/collections/smart/` editor + detail
   use `client.smartCollections.preview(...)` for the
   canonical preview. Local `evaluate(...)` is kept ONLY
   for in-flight typing preview and as a `collection.*`-
   predicate fallback. Tests cover the server path, the
   error path, and the fallback path.
5. Test coverage net-additions: ~30-50 new tests across the
   four surfaces. No regressions against the apps/web
   baseline (448 tests pre-change; ~478-498 after).
6. `pnpm --filter @binderly/web build` succeeds **with no
   `NEXT_PUBLIC_SUPABASE_*` env vars** (iter-14 / 17 / 18 /
   20 build-without-env rule).
7. All 5 CI checks pass.

## Out of scope

- Mobile equivalent (T-M-API-V2-WIRING).
- Replacing the per-set drill-down's `listSetContents()`
  fanout with a server endpoint (no V2 endpoint for that
  yet — separate follow-up).
- Wiring price trends (`trend_7d`, `trend_30d`) — V2 DTO
  doesn't carry them (Q-013).
- Pricing on browse `<SetView>` (the brief calls out
  CardView only; surface for headline-per-printing in a set
  grid is a separate FU).
- Sticking server-preview into the smart editor's typing
  feedback path — explicit local-eval keep per Decisions
  below.

## Decisions

- **D1. `catalogRoster()` stays on `CollectionApi`.** The
  per-set drill-down still relies on it for the Owned /
  Missing grids' per-card / per-printing data. The
  COMPLETION numbers move to `getCompletion()`; the per-
  printing fanout is a SEPARATE follow-up (no V2 endpoint
  for full per-card/per-printing roster). Brief explicitly
  allowed dropping the math but keeping the helper if needed
  for non-completion code paths.

- **D2. Pricing 404 → `null` sentinel, not throw.** The
  api-client's `ApiNotFoundError` is reified into a `null`
  return at the `BrowseApi.getCurrentPrice` boundary so the
  view can branch on "no data yet" distinctly from "error".
  Mirrors the `apiToShareApi` 404 pattern exactly. The view
  renders the dedicated "no pricing data yet" empty state.

- **D3. Shareable: 5xx propagates; no degraded synthesis.**
  The pre-existing degraded synthesis branch was a stop-gap
  for the absence of the richer endpoint. Now that the
  endpoint ships, falling back to the bare `getPublicShareable`
  on a 5xx would render a half-broken page (zero counts +
  empty member grid) — worse than the page-level error
  state. We delete it. 404 still resolves to `null` so
  `notFound()` works.

- **D4. Smart editor keeps client-side `evaluate()` for the
  typing preview.** Every keystroke fires a debounced run
  in the editor today; replacing it with a server round-
  trip would (a) flood the rate limiter, (b) flicker more,
  (c) lose the ability to preview `collection.*` predicates
  (server returns 400). The canonical preview shown after
  clicking Run / loading a saved collection moves to the
  server preview; if the user wrote a `collection.*`
  predicate (the server rejects with 400 per D5 in
  T-BE-EDGE-FUNCTIONS-V2) we fall back to the local
  evaluator and surface a small "using local preview" note.
  Documented in the PR body.

- **D5. New `runServerPreview()` on `SmartCollectionsApi`,
  not a replacement of `previewCatalog()`.** Two methods
  serve two purposes (local typing preview vs server
  canonical preview) — collapsing them would force the
  editor to either fetch the catalog every time the user
  pauses typing (perf) or to re-implement the local
  evaluator on top of a server call. Both lose the
  `collection.*` predicate fallback.

- **D6. Use the actual exported method names.** The
  orchestrator brief informally referenced
  `client.printings.getCurrentPrice(printingId)`. The
  actual `@binderly/api-client` surface is
  `client.pricing.getPrintingCurrentPrice({ printingId })`
  (intentional — the V2 backend kept the old speculative
  `getCurrentPrice()` for backward compat per
  T-BE-EDGE-FUNCTIONS-V2 D3). We use the actual exported
  method.

## Escalation triggers

Stop and surface to orchestrator if:

- A V2 method signature differs from what the
  `packages/api-client/src/resources/*.ts` files declare
  (the source of truth). None spotted during elaboration.
- A fixture-test consumer can't be made backward-compatible
  without rewriting unrelated tests.
- The server smart-preview's 400 `collection.*` error
  envelope doesn't match the api-client error taxonomy
  cleanly enough for D4's fallback to be detected. (If so:
  add a `code`-based check; if the codes aren't there,
  parse the error message string as a soft fallback.)

## Branch & PR

- Branch: `agent/T-W-API-V2-WIRING`
- PR title: `feat(web): T-W-API-V2-WIRING — wire V2 read endpoints (completion, current-price, shareable, smart-preview)`
- Commit format: Conventional Commits. Five commits total:
  one elaboration commit, one per surface (each end-to-end:
  api + view + fixtures + tests), and one closing commit
  (dep flip + summary).

## Notes from execution

_(filled in as the worker proceeds)_
