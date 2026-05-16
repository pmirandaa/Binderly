# T-M-BROWSE — Mobile browse, set, card detail

**Stage:** 05-mobile
**Agent role:** frontend-mobile
**Effort:** L
**Status:** in_review

## Hard dependencies

- T-M-SHELL (merged) — provides the Expo app shell, expo-router root,
  `@binderly/ui` mount, Supabase + API client singletons, TanStack
  Query provider.
- T-DL-SEED-INGEST — provides catalog content. The browse surface is
  defensive against a thin / empty catalog (empty / loading /
  error states) so it ships meaningfully ahead of full ingestion.

## Soft dependencies

- T-M-AUTH — sibling read-only feature; can race. Browse does not
  read auth state.
- T-W-BROWSE — cross-platform sibling running in parallel; same
  backend contract.

## Required reading

- `PROJECT.md` § 7 (Browse), § 10 (Core App Features: Browse,
  Card detail, Set page)
- `rules/05-mobile.md`
- `apps/mobile/app/_layout.tsx` — root provider tree
- `apps/mobile/src/lib/api-client.ts` — singleton + `useApiClient()`
- `packages/api-client/src/resources/cards.ts` — the data API
  (`listSets`, `getCard`, `listCardsInSet`)
- `packages/api-contracts/src/cards.ts` — DTO shapes
- `packages/ui/src/index.ts` — Tamagui primitives

## Goal

Ship the first end-user-visible mobile feature on the merged Expo
shell: a read-only browse experience over the card catalog. Three
screens (BrowseScreen → SetScreen → CardScreen) wired to the
typed `@binderly/api-client`, rendered with `@binderly/ui` Tamagui
primitives, navigated via expo-router. This is the cross-platform
sibling of `T-W-BROWSE`.

## Deliverables

### Data layer (`apps/mobile/src/lib/browse/`)

- `filters.ts` — pure functions for the three filter knobs
  (language / series / search) + a `release_date` desc sort.
- `format.ts` — pure formatters for release dates (UTC-locked
  `Intl.DateTimeFormat`), language codes, and variant-class enums.
- `hooks.ts` — four TanStack Query wrappers around the catalog
  reads: `useSetsQuery`, `useSetBySlugQuery`, `useCardsInSetQuery`,
  `useCardQuery`. Exposes a `BROWSE_QUERY_KEYS` map for cache
  invalidation.
- `index.ts` — barrel.

### Components (`apps/mobile/src/components/browse/`)

- `SetRow.tsx` — one row of the BrowseScreen list (cover image,
  name, release-date footnote, chevron).
- `CardTile.tsx` — one tile of the SetScreen grid (number badge,
  card name, rarity).
- `FilterChips.tsx` — language + series filter chip row.

### Screens

- `apps/mobile/src/screens/browse/BrowseScreen.tsx` — the set
  list. Title + search input + filter chips + `<FlatList>` with
  pull-to-refresh, loading / error / empty states.
- `apps/mobile/src/screens/set/SetScreen.tsx` — per-set card
  grid (`<FlatList numColumns={2}>`), header (name / release date /
  count / language), loading / error / not-found states.
- `apps/mobile/src/screens/card/CardScreen.tsx` — card detail
  with hero image, metadata, variants list, prices placeholder
  (clearly labelled for T-SP-PRICING-DISPLAY), disabled "Add to
  collection" CTA (T-M-COLLECTION will activate).

### Routes (`apps/mobile/app/`)

Thin wrappers — each file just imports the screen component from
its owns_paths and re-exports as the default.

- `(tabs)/browse.tsx` — replaces the M-SHELL placeholder.
- `sets/[slug].tsx` — `slug` is the set's `canonical_key` (e.g.
  `en-base1`).
- `cards/[id].tsx` — `id` is the card UUID.

### Tests

**73 new tests** across:

- `src/lib/browse/filters.test.ts` — 17 cases pinning the
  filter pipeline + chip collection + toggle helper.
- `src/lib/browse/format.test.ts` — 9 cases pinning the date /
  language / variant formatters (including the UTC timezone fix).
- `src/lib/browse/hooks.test.tsx` — 11 cases against
  `useSetsQuery`, `useSetBySlugQuery`, `useCardsInSetQuery`,
  `useCardQuery` with a fake `BinderlyClient`.
- `src/components/browse/FilterChips.test.tsx` — 8 cases
  pinning chip rendering, selection state, and tap behaviour.
- `src/screens/browse/BrowseScreen.test.tsx` — 11 cases covering
  initial render, loading state, release-date sort, language /
  series / search filter narrowing, empty state, pull-to-refresh,
  error state, and navigation to `/sets/{slug}`. Applies the
  `vi.hoisted({ routerMocks })` pattern (follow-up #13).
- `src/screens/set/SetScreen.test.tsx` — 8 cases covering
  not-found (missing slug + unknown slug), header rendering,
  card-grid rendering, empty-grid state, cards-error state,
  navigation to `/cards/{id}`, and array-slug deep-link handling.
  Applies the `vi.hoisted` router + params pattern.
- `src/screens/card/CardScreen.test.tsx` — 9 cases covering
  missing-id not-found, `ApiNotFoundError` 404, generic error
  state, card detail render, disabled CTA, variants section,
  no-image placeholder, loading state, and array-id deep-link
  handling.

### Setup additions (pre-authorized)

- `apps/mobile/src/test-utils/setup.ts` — extends the existing
  `react-native` jsdom mock with `FlatList` (renders synchronously,
  exposes `refreshControl`), `RefreshControl` (clickable to
  simulate pull-to-refresh), `ScrollView` (preserves `testID`),
  and a `View` variant that preserves `testID`. The setup file's
  own comment explicitly instructs feature tasks to extend it
  rather than mocking inline per file.

### Manifest changes (pre-authorized)

- `apps/mobile/package.json` — added `@binderly/api-contracts`
  workspace dep (was previously transitive only).
- `pnpm-lock.yaml` — regenerated by `pnpm install`.

## Acceptance criteria

- [x] `pnpm install` succeeds.
- [x] `pnpm --filter @binderly/mobile typecheck` passes.
- [x] `pnpm --filter @binderly/mobile lint` passes
      (`--max-warnings=0`).
- [x] `pnpm --filter @binderly/mobile test` passes with **241
      tests** (73 new, all targeted at this task's surface).
- [x] `pnpm --filter @binderly/mobile build` (tsc) passes.
- [x] `pnpm turbo run typecheck lint test` passes across all 38
      workspace tasks.
- [x] BrowseScreen renders sets in `release_date` desc order from
      a mocked api-client.
- [x] Language filter narrows the list.
- [x] Search filter narrows the list (case-insensitive, name + code).
- [x] Series chip filter narrows the list.
- [x] Empty state renders when filters yield nothing.
- [x] Pull-to-refresh triggers a `refetch()` (asserted via the
      stub `RefreshControl` `onClick`).
- [x] Error state renders when the api-client throws.
- [x] SetScreen renders the card grid.
- [x] SetScreen renders not-found for an unknown slug.
- [x] CardScreen renders the card detail (name, number,
      metadata, variants, prices placeholder).
- [x] CardScreen renders not-found for an unknown id (via
      `ApiNotFoundError`).
- [x] "Add to collection" button is rendered disabled with the
      sign-in copy.
- [x] BrowseScreen → SetScreen → CardScreen navigation tests
      apply the `vi.hoisted({ routerMocks })` pattern and assert
      on `router.push` calls.
- [x] No changes outside `owns_paths` except for the
      pre-authorized files listed above.

## Out of scope

- Collection mutations (add / edit / remove copies) — T-M-COLLECTION.
- Pricing display — T-SP-PRICING-DISPLAY.
- Affiliate buy CTAs — future task.
- Scanner / camera integration — stage 06.
- Master-set or smart-collection UI — T-SP-SET-COMPLETION,
  T-M-CUSTOM.
- Deep pagination beyond the first page of 200 sets / cards. The
  footer note "More results coming soon" explicitly flags this.
- Full-text search across cards (vs sets) — out of MVP scope.

## Notes from execution

- Used `FlatList` from `react-native` for both BrowseScreen (single
  column) and SetScreen (two columns) rather than introducing
  `@shopify/flash-list`. Rationale: minimal new deps, and the v1
  catalog (~few hundred sets, low hundreds of cards per set) sits
  well inside FlatList's comfortable range. The data layer
  fetches a single 200-row page; deep pagination is explicitly
  out of scope.
- The route file at `apps/mobile/app/sets/[slug].tsx` uses the
  set's `canonical_key` (e.g. `en-base1`) as the slug — more
  URL-friendly than the UUID and resolved via
  `useSetBySlugQuery` against the same `/v1/sets` cache the
  BrowseScreen already populates.
- Added `apps/mobile/src/components/browse/`,
  `apps/mobile/src/lib/browse/` per the pre-authorized convention
  for page-specific supporting code. These directories are scoped
  to the browse / set / card surfaces only.
- The `react-native` mock in `src/test-utils/setup.ts` was
  extended (per the file's own contract — "New imports added under
  `src/lib/*` or `src/components/*` should extend this file rather
  than mocking inline in each test file"). The extensions are
  additive (no existing mock semantics changed).
- Applied the `vi.hoisted({ routerMocks })` workaround for
  follow-up #13 (the global `useRouter()` mock returns a fresh
  object per call which breaks `mockReturnValueOnce` and
  observable assertions) in all three screen-level tests that
  assert on navigation. Same pattern T-M-AUTH used in
  `CallbackScreen.test.tsx`.

## Branch & PR

- Branch: `agent/T-M-BROWSE`
- PR title: `feat(mobile): T-M-BROWSE — browse + per-set + card-detail screens`
- Commit format: Conventional Commits.
