# T-M-API-V2-WIRING — Wire V2 read endpoints into mobile surfaces

**Stage:** 05-mobile
**Agent role:** frontend-mobile
**Effort:** M
**Status:** in_review

---

## Hard dependencies

- T-BE-EDGE-FUNCTIONS-V2 (merged @ `472fdcf`) — ships the four
  V2 read endpoints + matching `@binderly/api-client` methods
  (`collection.getCompletion()`, `pricing.getPrintingCurrentPrice()`,
  `smartCollections.preview()`, `shareables.getPublicShareablePayload()`).
- T-M-COLLECTION (merged) — owns `CollectionScreen` and
  `CollectionSetScreen` with the iter-17/18 client-side
  completion stop-gap this task replaces.
- T-M-BROWSE (merged) — owns `CardScreen` with the "Prices
  coming soon" placeholder this task replaces.
- T-M-CUSTOM (merged) — owns the smart-collection editor
  (`SmartCollectionEditorScreen`) with the in-app
  `evaluateAgainstCatalog(...)` Run preview this task replaces.
- T-SP-PRICING-DISPLAY (merged) — pure-logic
  `@binderly/pricing-display` package providing `formatPrice` +
  the `ConvertedCurrentPrice` row helpers.

## Soft dependencies

- T-W-API-V2-WIRING (parallel sibling) — flips the same three
  endpoints into the web surfaces; declared `parallel_safe_with`
  this task because `owns_paths` are disjoint (web: `apps/web/`,
  mobile: `apps/mobile/src/`).

## Required reading

- `tasks/02-backend/T-BE-EDGE-FUNCTIONS-V2.md` — endpoint
  shapes, defaults (RAW_NM + EBAY_US for current-price), Accept
  semantics, error contracts.
- `packages/api-client/src/resources/collection.ts`
  (`getCompletion()`).
- `packages/api-client/src/resources/pricing.ts`
  (`getPrintingCurrentPrice()` — note the parent task brief
  uses the informal name `client.printings.getCurrentPrice(printingId)`;
  the shipped method is `client.pricing.getPrintingCurrentPrice({ printingId })`).
- `packages/api-client/src/resources/smartCollections.ts`
  (`preview()`).
- `packages/api-contracts/src/collection.ts` (`completionDto`,
  `smartPreviewRequestDto`, `smartPreviewResponseDto`).
- `packages/api-contracts/src/pricing.ts`
  (`printingCurrentPriceDto`, `printingCurrentPriceFreshnessSchema`).
- `packages/pricing-display/src/index.ts` — public
  surface (`formatPrice`, `convertCurrentPriceRow`,
  freshness types).
- `apps/mobile/src/screens/collection/CollectionScreen.tsx` —
  parked "Open set to compute" Master % surface.
- `apps/mobile/src/screens/collection/CollectionSetScreen.tsx` —
  per-card `listCardsInSet` + `listPrintingsForCard` fanout.
- `apps/mobile/src/screens/card/CardScreen.tsx` — "Prices
  coming soon" placeholder.
- `apps/mobile/src/screens/collections/SmartCollectionEditorScreen.tsx`
  — in-app `evaluate(...)` Run preview (#FU-23).
- `apps/mobile/src/lib/collection/{completion.ts,hooks.ts,index.ts}`
  — current home-screen lib surface to swap.
- `apps/mobile/src/lib/collections/dsl.ts` — the in-app
  `evaluateAgainstCatalog` to swap out of the Run preview.
- `open-questions.md` § Q-013 — documents the two server-side
  divergences (MV-missing completion, in-memory preview eval).
  This client code is unaware of them; the contracts are
  identical to the brief.

## Goal

The V2 worker (PR #68) shipped four authoritative read
endpoints that obsolete three iter-17/18/19 client-side
stop-gaps on mobile. This task swaps the three swappable
surfaces (mobile doesn't own the public-shareable; that's web-
only) to direct calls so the home screen finally shows real
Master %, the card-detail page finally shows real prices, and
the smart-collection editor's Run preview finally evaluates
catalog-wide instead of "owned-only" (closing #FU-22 as a side
effect of the #FU-23 swap).

## Deliverables

### Surface 1 — Completion (T-M-COLLECTION swap)

**Files touched (mobile-only):**

- `apps/mobile/src/lib/collection/hooks.ts` — add
  `useCompletionQuery({ enabled })` calling
  `client.collection.getCompletion()`; keep
  `useCollectionItemsQuery` (still used by the drill-down for
  the segmented control's Owned/Missing partition + by the
  smart editor for the owned-set context).
- `apps/mobile/src/lib/collection/index.ts` — export the new
  hook + its result type.
- `apps/mobile/src/lib/collection/completion.ts` — add a
  `perSetCompletionEntryToSummary(entry, set)` adapter so the
  existing `CollectionSetRow` keeps consuming the
  `CollectionSetSummary` shape (the API DTO `perSetCompletionEntryDto`
  has no `set: SetDto` field; the screen joins on `setId`
  against `useSetsQuery`).
- `apps/mobile/src/screens/collection/CollectionScreen.tsx` —
  swap to `useCompletionQuery` for both the badge and the per-
  set rows. Drop the `useOwnedPrintingsContextQuery` fanout +
  the `summarizeCollection` call. Real Master % on the badge.
- `apps/mobile/src/screens/collection/CollectionSetScreen.tsx`
  — swap to `useCompletionQuery` for the per-set header
  numbers (Set % / Master %), keep
  `useSetDrillDownQuery` for the per-printing roster that
  drives Owned/Missing partition (server completion endpoint
  doesn't return printings — that's still a roster + ownership
  intersection on-device).
- `apps/mobile/src/components/collection/CompletionBadge.tsx`
  — drop the "full math soon" subtitle on the Master counter;
  master totals are real now. Tighten counter labels.

### Surface 2 — Current price (#FU-17 frontend half)

**Files touched (mobile-only):**

- `apps/mobile/package.json` — add `@binderly/pricing-display`
  workspace dependency.
- `apps/mobile/src/lib/pricing/` (new) — `hooks.ts` exporting
  `useCurrentPriceQuery({ printingId, enabled })` returning a
  TanStack `UseQueryResult<PrintingCurrentPriceDto, Error>`;
  `index.ts` barrel. The hook handles `ApiNotFoundError` by
  surfacing it as `data: null` (not error), since "no price
  data yet" is a UX state not an error per the parent brief.
- `apps/mobile/src/components/card/PriceBlock.tsx` (new) —
  `<PriceBlock>` component composing `useCurrentPriceQuery` +
  `formatPrice` to render the median + range with a freshness
  badge. States: loading skeleton, no-data (404 → "Prices not
  available yet"), error (retry), success.
- `apps/mobile/src/screens/card/CardScreen.tsx` — replace the
  "Prices coming soon" placeholder Card with `<PriceBlock>`
  for the hero printing.

### Surface 3 — Smart-collection preview (#FU-23 frontend half)

**Files touched (mobile-only):**

- `apps/mobile/src/lib/collections/hooks.ts` — add
  `useSmartPreviewMutation()` wrapping
  `client.smartCollections.preview()`. Mutation rather than
  query because the editor runs preview imperatively on Run
  (debounced live-eval is a future polish; v1 stays explicit).
- `apps/mobile/src/lib/collections/index.ts` — export the new
  hook + result types.
- `apps/mobile/src/screens/collections/SmartCollectionEditorScreen.tsx`
  — replace the in-app `evaluateAgainstCatalog(...)` Run path
  with the server preview. Drop the `useOwnedPrintingsContextQuery`
  fanout (Run no longer needs it). Drop the "preview against
  owned only" copy. Update `<SmartPreviewTile>` to render
  `SmartPreviewItemDto` (the new wire shape — narrower than
  the in-app `EvaluateMatch`). Keep the existing parse / save
  / cancel / Pro-gating logic untouched.

## Acceptance criteria

- [ ] `CollectionScreen` shows real Master % from
      `getCompletion().global.masterPct`; the
      "Open set to compute" parked Master fallback in
      `CollectionSetRow` is replaced by the real number when
      the API resolves and a `—` placeholder when the API
      hasn't replied yet. `useOwnedPrintingsContextQuery` is
      no longer called from the home screen.
- [ ] `CollectionSetScreen` reads its set's row from
      `getCompletion().perSet`; the per-card
      `listCardsInSet` + `listPrintingsForCard` fanout still
      runs but only to drive the Owned/Missing partition (not
      the header numbers).
- [ ] `CardScreen` renders real prices via `<PriceBlock>` +
      `@binderly/pricing-display`'s `formatPrice`. Loading,
      404, and error states are visually distinct. Tests cover
      each.
- [ ] Smart-editor Run preview uses
      `client.smartCollections.preview(...)`. Catalog-wide
      eval works (a `card.name = "Charizard"` query returns
      every Charizard in the catalog, not just those the user
      owns). The #FU-22 "owned-only PrintingPicker" quirk is
      explicitly documented in the PR body as resolved-as-
      side-effect.
- [ ] Test coverage net-additions: ~25-40 new tests across
      the three surfaces. Existing 432-test baseline still
      green (zero regressions).
- [ ] All 5 CI checks pass (pr-title, typecheck, lint, build,
      test).
- [ ] No edits outside `apps/mobile/src/` except the
      pre-authorized `dependencies.yaml` status flip,
      `apps/mobile/package.json` for the new
      `@binderly/pricing-display` dep, and this task file.

## Out of scope

- The fourth V2 endpoint (`/v1/c/{handle}/{slug}` public
  shareable). Mobile has no public-share surface; web owns it
  via T-W-API-V2-WIRING.
- Adding a live debounced smart-preview re-evaluation as the
  user types. v1 stays imperative-on-Run; the cost of every
  keystroke shipping a 30k-row catalog scan server-side is too
  high for v1.
- Pricing graph / history wiring (T-SP-PRICING-DISPLAY's
  graphs ship in a follow-up Pro-gated card-detail tab).
- New materialized views or backend changes. Q-013 logs the
  divergence; this task ships the client adapters and trusts
  the contracts.

## Branch & PR

- Branch: `agent/T-M-API-V2-WIRING`
- PR title: `feat(mobile): T-M-API-V2-WIRING — wire V2 read endpoints (completion, current-price, smart-preview)`
- Commit format: Conventional Commits. Five commits:
  1. `docs(tasks): elaborate T-M-API-V2-WIRING`
  2. `feat(mobile): wire getCompletion() into CollectionScreen + CollectionSetScreen`
  3. `feat(mobile): wire pricing-display + getPrintingCurrentPrice into CardScreen`
  4. `feat(mobile): wire smartCollections.preview into SmartCollectionEditorScreen`
  5. `chore(deps): flip T-M-API-V2-WIRING to in_review`

## Escalation triggers

Stop and surface to orchestrator if:

- A contract field is missing from the shipped DTO (e.g. the
  per-set entry lacks `setCode` / `setName`, forcing a second
  fetch — Q-NNN escalation).
- The server endpoint returns a shape inconsistent with the
  DTO under realistic conditions (e.g. empty-collection 200
  with `lastUpdatedAt: undefined` instead of `null`).
- The freshness band on `printingCurrentPriceDto` is missing
  from the response payload (the DTO requires it).
- Either of the two parallel siblings (T-W-API-V2-WIRING)
  needs the same Q-NNN escalation at the same time — the
  orchestrator renumbers at merge time.

## Decisions

- **D1. Keep `useCollectionItemsQuery` after the swap.** The
  per-set drill-down still needs the user's owned printingIds
  to partition `useSetDrillDownQuery`'s roster into Owned vs.
  Missing tabs. The completion DTO doesn't (and shouldn't)
  carry per-printing ownership; only the per-set tallies. So
  `useCollectionItemsQuery` stays — only the
  `useOwnedPrintingsContextQuery` fanout (the expensive part
  the V2 endpoint replaces) is dropped from the home + drill-
  down render paths.

- **D2. Adapt `perSetCompletionEntryDto` → `CollectionSetSummary`
  in the screen, not in the lib.** The completion lib still
  owns the on-device `summarizeCollection` (for tests + any
  future offline mode); the screen now imports a small
  `perSetCompletionEntryToSummary(entry, set)` helper that
  takes the API entry + a `SetDto` (joined on `setId`) and
  produces the existing `CollectionSetSummary` shape. This
  keeps `<CollectionSetRow>` unchanged.

- **D3. 404 on current-price is `data: null`, not error.** The
  parent brief calls out "loading + 404 + error states"
  separately for current-price. Surfacing 404 as
  `query.isError` would force the screen to distinguish
  `error instanceof ApiNotFoundError` at the render boundary;
  collapsing 404 into a `null` data success keeps the render
  switch flat (`isLoading` → loading; `data === null` → no-
  data; `isError` → genuine error).

- **D4. Preview is a TanStack `useMutation`, not `useQuery`.**
  The server preview is imperative ("user pressed Run"), it
  costs a 30k-row catalog scan on the server, and the
  expression is the body — `useMutation` semantics match.
  Live debounced re-eval is a follow-up.

- **D5. `<SmartPreviewTile>` reads the new DTO shape
  (`SmartPreviewItemDto`) directly.** The wire shape
  intentionally projects `cardName / cardNumber / setName /
  setCode / variantLabel / imageSmallUrl` (per the V2 task —
  narrow, bounded for the 500-row max page). The in-app
  `EvaluateMatch` shape with full `CardDto + SetDto + PrintingDto`
  is dropped from the Run path. The Owned-or-not chip is also
  dropped (the server preview doesn't carry ownership; the
  parent brief calls out that the catalog-wide swap closes the
  #FU-22 "owned-only" quirk, so showing "Owned" on the tile
  would be misleading after the swap).

## Notes from execution

Worker (this PR):

- Baseline before any swaps: 432 mobile tests green.
- The parent brief references `client.printings.getCurrentPrice(printingId)`;
  the actual shipped api-client method is
  `client.pricing.getPrintingCurrentPrice({ printingId })`.
  Used the shipped name; called this out in Decisions and in
  the PR body.
- Closed #FU-22 as side effect — preview Run is no longer
  scoped to owned printings.
- Bypassed the `useOwnedPrintingsContextQuery` for both the
  home screen and the smart-editor Run; both flows used it
  only because the V2 endpoint didn't exist yet.
