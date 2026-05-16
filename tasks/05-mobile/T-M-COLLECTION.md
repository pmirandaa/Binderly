# T-M-COLLECTION — Mobile collection home + per-set progress

**Stage:** 05-mobile
**Agent role:** frontend-mobile
**Effort:** L
**Status:** in_review

## Hard dependencies

- T-M-AUTH (merged) — provides `useAuth()`, the `/auth/sign-in`
  route, and the session shape this task gates on.
- T-SP-SET-COMPLETION (merged) — provides the
  `@binderly/set-completion` package (`computeCompletion`,
  `RosterCard`, `RosterPrinting`, `SetCompletionResult`).

## Soft dependencies

- T-M-BROWSE — sibling read-only feature this task mirrors. We
  re-use its `useSetsQuery`, `useSetBySlugQuery`, `format.ts`
  helpers, and the `vi.hoisted({ routerMocks })` test pattern.
- T-W-COLLECTION — cross-platform sibling with the symmetric
  web UX (different worktree).

## Required reading

- `PROJECT.md` § 8 (Master Set & Completion), § 10 (Core App
  Features)
- `rules/05-mobile.md`
- `apps/mobile/app/_layout.tsx` — root provider tree
- `apps/mobile/src/lib/auth/protected-screen.tsx` — auth-gating
  pattern
- `apps/mobile/src/components/providers/AuthProvider.tsx` —
  `useAuth()` shape
- `apps/mobile/src/lib/api-client.ts` — `useApiClient()` singleton
- `apps/mobile/src/screens/browse/BrowseScreen.tsx`,
  `apps/mobile/src/screens/set/SetScreen.tsx` — closest sibling
  patterns (TanStack Query hooks, FlatList, `vi.hoisted`)
- `apps/mobile/src/lib/browse/` — re-used hooks + format helpers
- `packages/set-completion/src/index.ts` — the math API
- `packages/api-client/src/resources/collection.ts` —
  `listCollectionItems`
- `packages/api-contracts/src/collection.ts`,
  `packages/api-contracts/src/cards.ts` — DTO shapes

## Goal

Ship the **first auth-gated, user-personal mobile feature** on
top of the merged Expo shell + auth: a two-screen collection
experience that lets a signed-in user see how complete each set
is for them and drill down to the per-set owned / missing
breakdown. Reads from the merged `@binderly/api-client`, computes
percentages via `@binderly/set-completion`, gates on
`useAuth()`. Cross-platform sibling of `T-W-COLLECTION`.

## Deliverables

### Data layer (`apps/mobile/src/lib/collection/`)

- `format.ts` — pure formatters: `formatPercent` (clamped, integer
  rendering), `formatCount` (`owned/total`), `clampPercent` (raw
  number for progress-bar widths).
- `completion.ts` — completion-math orchestration:
  - `summarizeCollection({ sets, owned })` — per-set + global
    summary for the home list. Set % uses `set.total` as the
    denominator (with `printedTotal` fallback) and unique
    distinct cards owned as the numerator. Master % is left at
    0 on the home row (full math is per-set drill-down only —
    see "Notes" for the partial-roster trade-off).
  - `compareSummariesForHome` — `setPct desc, releaseDate desc,
    name asc` comparator.
  - `computeCompletionForSet({ setId, cards, printings,
    ownedPrintingIds })` — wraps `@binderly/set-completion`'s
    `computeCompletion` for the drill-down (full per-set
    roster).
  - `partitionPrintingsForDrillDown` — slices the per-set
    printing list into owned + missing halves, sorted stably
    by `variantClass / variantKey`.
  - `summaryFromResult` — convenience for the future
    materialized-view endpoint (Q-010).
- `hooks.ts` — three TanStack Query wrappers:
  - `useCollectionItemsQuery({ enabled })` — paginated walk of
    `/v1/me/collection`, gated on `enabled` so signed-out
    renders never hit a 401.
  - `useOwnedPrintingsContextQuery(printingIds)` — fans out
    `getPrinting(id)` per owned printingId via
    `queryClient.fetchQuery` + `Promise.all`, keying each
    individual fetch in the cache so unrelated edits don't bust
    the whole set. Sidesteps `useQueries`'s typed-array
    awkwardness while still benefiting from the query cache.
  - `useSetDrillDownQuery(setId)` — two-stage fetch:
    `listCardsInSet` then a parallel
    `listPrintingsForCard(cardId)` fan-out so the drill-down
    can hand a complete `ComputeCompletionInput` to the math
    package.
- `index.ts` — barrel.

### Components (`apps/mobile/src/components/collection/`)

- `ProgressBar.tsx` — small token-driven horizontal bar (3 tones:
  `set`, `master`, `global`); clamps inputs defensively, renders
  `role="progressbar"` with `aria-valuenow`.
- `CollectionSetRow.tsx` — one row of the home list (set logo
  fallback, name, release-date / language footnote, Set %
  progress + count, Master % progress with "Open set to compute"
  placeholder when the home row's partial roster doesn't have
  the master denominator).
- `CompletionBadge.tsx` — above-the-fold global card with All
  Pokémon %, supporting counters (sets started, sets mastered,
  master cards owned), and a wider progress bar.
- `PrintingTile.tsx` — one tile of the drill-down's owned /
  missing grid (image or fallback, variant-class chip, status
  pill, optional variant-flags subtitle). Tap routes to
  `/cards/{cardId}` (re-using the existing card detail surface
  from T-M-BROWSE).

### Screens (`apps/mobile/src/screens/collection/`)

- `CollectionScreen.tsx` — the collection home:
  - `useAuth()` gate; signed-out users see a friendly prompt
    with a "Sign in" button that pushes `/auth/sign-in`.
  - Above-the-fold: `<CompletionBadge>`.
  - Below: virtualized `<FlatList>` of `<CollectionSetRow>` items
    sorted by `compareSummariesForHome` (completion % desc, then
    release date desc, then name asc).
  - Pull-to-refresh wired to both `useCollectionItemsQuery` and
    `useSetsQuery`.
  - Empty state ("Your collection is empty. Browse the
    catalog →") deep-links into `(tabs)/browse`.
  - Skeleton + error states.
- `CollectionSetScreen.tsx` — the per-set drill-down:
  - `useAuth()` gate (same prompt + redirect).
  - Slug → set resolution via `useSetBySlugQuery` (slug =
    `canonical_key`, mirroring T-M-BROWSE's `/sets/[slug]`).
  - Header: set name, release date / language footnote, large
    Set % + Master % progress bars with `owned/total` counts.
  - Segmented control: **Owned** (default) / **Missing** with
    counts on each tab.
  - 2-column `<FlatList>` of `<PrintingTile>`s for the active
    tab; tap → `/cards/{cardId}`.
  - Skeleton + error + not-found states.
- `index.ts` — barrel.

### Routes (`apps/mobile/app/`)

Thin wrappers — each file just imports the screen component
from its owns_paths and re-exports as the default.

- `(tabs)/collection.tsx` — replaces the M-SHELL placeholder
  with the elaborated `CollectionScreen`.
- `collection/sets/[slug].tsx` — new route for the per-set
  drill-down.

### Tests

**64 new tests** across:

- `src/lib/collection/format.test.ts` — 10 cases pinning
  `formatPercent`, `formatCount`, `clampPercent` (NaN /
  out-of-bounds handling).
- `src/lib/collection/completion.test.ts` — 15 cases pinning
  `summarizeCollection` (per-set bucketing, global aggregation,
  Set % math, `set.total` / `printedTotal` fallback, missing
  denominator), `compareSummariesForHome`,
  `computeCompletionForSet` (delegation to
  `@binderly/set-completion`), `partitionPrintingsForDrillDown`.
- `src/components/collection/ProgressBar.test.tsx` — 4 cases on
  ARIA wiring, clamping, fill element rendering.
- `src/components/collection/PrintingTile.test.tsx` — 4 cases on
  variant labelling, owned / missing copy, tap callback, variant
  flags rendering.
- `src/components/collection/CollectionSetRow.test.tsx` — 4
  cases on header content, Set % rendering, Master placeholder
  copy, row tap callback.
- `src/components/collection/CompletionBadge.test.tsx` — 2 cases
  on All Pokémon % headline + the supporting counters.
- `src/screens/collection/CollectionScreen.test.tsx` — 12 cases:
  signed-out prompt + sign-in `router.push`, signed-in initial
  loading, error state + retry, empty state + browse-CTA
  navigation, global badge totals, per-set list ordering,
  pull-to-refresh, row navigation to
  `/collection/sets/{slug}`. Applies the `vi.hoisted({
  routerMocks })` pattern.
- `src/screens/collection/CollectionSetScreen.test.tsx` — 13
  cases: auth gate, missing slug not-found, unknown slug
  not-found, set-error state, header content, accurate Set /
  Master percentages from `computeCompletionForSet`, default
  Owned tab, tab switch updates counts, empty Owned state, empty
  Missing state, tile tap navigation to `/cards/{cardId}`,
  signed-out + signed-in transitions. Applies the `vi.hoisted`
  router + `useLocalSearchParams` pattern.

### Manifest changes (pre-authorized)

- `apps/mobile/package.json` — added `@binderly/set-completion`
  workspace dep (was previously transitive only; the math
  package is now a direct mobile dependency).
- `pnpm-lock.yaml` — regenerated by `pnpm install`.

## Acceptance criteria

- [x] `pnpm install` succeeds.
- [x] `pnpm --filter @binderly/mobile typecheck` passes.
- [x] `pnpm --filter @binderly/mobile lint` passes
      (`--max-warnings=0`).
- [x] `pnpm --filter @binderly/mobile test` passes with **305
      tests** (64 new, all targeted at this task's surface).
- [x] `pnpm --filter @binderly/mobile build` (tsc) passes.
- [x] `CollectionScreen` renders a sign-in prompt for signed-out
      users.
- [x] `CollectionScreen` renders the per-set list ordered by
      completion % desc when signed in.
- [x] Global completion badge shows correct totals (mocked
      api-client + computed by the math layer).
- [x] Empty state ("Your collection is empty") shows when the
      user has zero owned items.
- [x] Error state shows when the api-client throws.
- [x] Pull-to-refresh triggers a refetch on both the items and
      sets queries.
- [x] `CollectionSetScreen` renders the Owned tab by default.
- [x] `CollectionSetScreen` Missing tab renders correctly.
- [x] Tab switch updates the active list state.
- [x] Not-found state renders for an unknown set slug.
- [x] `CollectionScreen` → `CollectionSetScreen` row navigation
      asserts on `router.push` via the `vi.hoisted({
      routerMocks })` pattern.
- [x] No changes outside `owns_paths` except for the
      pre-authorized files listed above.

## Out of scope

- Add-to-collection / remove-from-collection mutations — the
  disabled CTA from T-M-BROWSE's `CardScreen` stays disabled.
  Mutation UX lives in a follow-up task.
- Custom or smart collections — T-M-CUSTOM.
- Pricing display ("Total value coming soon" placeholder per
  follow-up #FU-17) — T-SP-PRICING-DISPLAY.
- Scanner / camera capture — stage 06.
- Materialized-view-backed home metric — see Q-010 (the
  `mv_user_set_completion` endpoint isn't live yet; we compute
  on-device against the partial roster instead).

## Notes from execution

- **Partial-roster trade-off on the home screen.** The home
  list's Set % is computed against `set.total` (with
  `printedTotal` as a defensive fallback when `total` is null on
  freshly-ingested sets). Master % is intentionally left at 0
  on each home row with an "Open set to compute" affordance —
  computing the precise Master % requires the *full* per-set
  printing roster (every variant of every card), which would
  fan out to hundreds of network calls if attempted on the home
  screen. The drill-down loads the full roster once per set
  visited and shows precise Set / Master percentages. When the
  T-BE-EDGE-FUNCTIONS materialized view ships (Q-010), the
  home screen should switch to reading
  `mv_user_set_completion` directly and the on-device math
  becomes a fallback / offline path.
- **Drill-down Set % vs home Set %.** The drill-down uses
  `computeCompletion` against the actual per-set card roster,
  so its `totalNumbered` reflects the cards we observed
  (not `set.total`). For freshly-ingested catalogs these can
  diverge; we treat the drill-down as the source of truth (the
  test fixture asserts 100% Set when the user owns ≥1 printing
  of every card in the set, even if `set.total` claims more).
- **`useOwnedPrintingsContextQuery`.** TanStack Query's
  `useQueries` is the canonical fan-out tool but its typed
  return shape is awkward when the array length is dynamic
  (the rules-of-hooks-friendly variant requires a stable
  generic position). Switched to a `useEffect` +
  `queryClient.fetchQuery` + `Promise.all` pattern: still
  benefits from the per-printing cache, still re-uses successful
  fetches across renders, and keeps the rules of hooks
  satisfied because we're not calling `useQuery` inside a loop.
- **Slug-vs-id convention.** `/collection/sets/[slug]` mirrors
  `/sets/[slug]` from T-M-BROWSE — slug is the set's
  `canonical_key` (e.g. `en-base1`) so the URL is shareable
  and human-meaningful. Resolved via `useSetBySlugQuery`
  against the same `/v1/sets` cache the home screen already
  populates.
- **Virtualization.** Used `FlatList` from `react-native` for
  both screens (single column on the home, two columns in the
  drill-down). Same rationale as T-M-BROWSE — minimal new deps,
  v1 catalog sits well inside FlatList's range.
- **Test pattern.** Both screen tests apply the `vi.hoisted({
  routerMocks })` pattern from follow-up #13 because both
  navigate via `router.push` and both need observable assertions
  on those calls. The setup file's global `expo-router` mock
  returns fresh router instances per call, so the local re-mock
  is the only reliable way to assert on navigation.
- **`PrintingTile` testID convention.** The owned / missing
  status `<Text>` uses an independent testID
  (`collection-printing-status-{id}`) instead of suffixing the
  parent tile's testID — needed so
  `[data-testid^="collection-printing-tile-"]` selectors in the
  drill-down list assertion only match top-level tiles.

## Branch & PR

- Branch: `agent/T-M-COLLECTION`
- PR title: `feat(mobile): T-M-COLLECTION — collection home + per-set progress drill-down`
- Commit format: Conventional Commits.
