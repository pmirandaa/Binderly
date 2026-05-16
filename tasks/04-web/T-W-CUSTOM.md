# T-W-CUSTOM — Web manual custom collections (3-cap on free)

**Stage:** 04-web
**Agent role:** frontend-web
**Effort:** M
**Status:** in_review

## Hard dependencies

- T-W-COLLECTION (merged) — `<SignInPrompt>`, `<PageLoading>`, lazy
  `apiToCollectionApi(getApiClient())` wiring, fake-api test
  seam, `dynamic = 'force-dynamic'` route boilerplate.
- T-BE-EDGE-FUNCTIONS (merged at iter-16) — `/v1/me/custom-collections`
  CRUD + `/items` membership endpoints surfaced via the
  `@binderly/api-client` `collection` resource.

## Soft dependencies

- T-W-BROWSE (merged) — `lib/browse/format.ts` for
  `formatReleaseDate` + `sortSetsByReleaseDateDesc`, `lib/browse/
  fixtures.ts` `makeSet` / `makeCard` / `makePrinting`
  builders.
- T-SP-UI-TOKENS (merged) — `<Button>`, `<Card>`, `<Input>`,
  `<XStack>`, `<YStack>`, `<Text>`, `<Spinner>`.

## Required reading

- PROJECT.md § 9 (Custom & Smart Collections — the 3-cap rule
  + the search-free / save-paid smart distinction; § 8 for
  context only).
- rules/04-web.md — stage rules (RSC by default; loading.tsx;
  WCAG AA; smart-collection "Save" button gating posture).
- `apps/web/app/layout.tsx`,
  `apps/web/components/providers/AuthProvider.tsx`,
  `apps/web/lib/api-client.ts`,
  `apps/web/lib/supabase-browser.ts` — the shell.
- `apps/web/app/collection/page.tsx` +
  `apps/web/components/collection/CollectionRoute.tsx` +
  `apps/web/components/collection/CollectionView.tsx` +
  `apps/web/lib/collection/api.ts` — the direct sibling +
  pattern source: soft auth gate via `<SignInPrompt>`, fake-api
  injection, lazy `useEffect` Supabase init, `dynamic = 'force-
  dynamic'`.
- `apps/web/components/browse/BrowseView.tsx` — printing-picker
  search/filter patterns.
- `packages/api-client/src/resources/collection.ts` — exposes
  `listCustomCollections` / `getCustomCollection` /
  `createCustomCollection` (manual + smart) /
  `updateCustomCollection` / `deleteCustomCollection` /
  `listCustomCollectionItems` /
  `addPrintingToCustomCollection` /
  `removePrintingFromCustomCollection`.
- `packages/api-contracts/src/collection.ts` —
  `CustomCollectionDto`, `CustomCollectionItemDto`,
  `createCustomCollectionRequest` (discriminated union over
  `kind`).

## Goal

Ship the **manual custom collections** experience on web:

- `/collections/custom` — list + create + delete (with the free-
  tier 3-cap gate and an upsell affordance).
- `/collections/custom/[id]` — edit (inline-editable name +
  description; add cards via printing-picker; remove cards;
  delete collection; 404 for unknown id).

Auth-gated via the same `<SignInPrompt>` soft-gate pattern
T-W-COLLECTION ratified. All CRUD goes through
`@binderly/api-client`'s `collection` resource. The 3-cap
matches PROJECT.md § 9 + § 16 ("Manual custom collections — 3
max on free, unlimited on Pro"); the upgrade button points at
`/billing` (a placeholder until the Phase-10 billing surface
lands) — no actual subscription flow is in scope here.

## Owns paths

- `apps/web/app/collections/custom/`

Pre-authorized siblings (called out in the PR body):

- `apps/web/components/collections/custom/` — page-specific
  components (`Modal`, `CustomCollectionsRoute`,
  `CustomCollectionsView`, `CustomCollectionDetailRoute`,
  `CustomCollectionDetailView`, `NewCustomCollectionModal`,
  `DeleteCustomCollectionModal`, `AddCardsModal`).
- `apps/web/lib/collections/custom/` — page-specific data layer
  (`api.ts`, `fixtures.ts`, `format.ts`).

## Out of scope

- Subscription / billing flow itself — the upgrade button just
  points at `/billing` (placeholder).
- Smart collections — owned by T-W-SMART (parallel sibling).
- Sharing / public pages — owned by future
  T-W-SHAREABLE-PUBLIC.
- Drag-to-reorder — left as an additive follow-up; members
  render in `addedAt` insertion order.

## What ships

### Data layer (`apps/web/lib/collections/custom/`)

- `api.ts`
  - `CustomCollectionApi` interface — narrow read+write surface
    every view programs against.
  - `apiToCustomCollectionApi(client)` adapter — wraps the
    full `BinderlyClient`. Manual-only: `createCustomCollection`
    fixes `kind: 'manual'` so views / sibling tests don't have
    to remember.
  - `manualOnly(rows)` filter helper.
  - `getPrintingsByIds(ids)` fan-out over the existing
    `cards.getPrinting` endpoint. Member counts are bounded by
    the cap of "user-curated picks per collection"; sequential
    fan-out is the simplest reliable approach until a bulk
    lookup endpoint lands.
  - `FREE_TIER_CUSTOM_COLLECTION_CAP = 3` constant — single
    source of truth for views, tests, and copy.
- `fixtures.ts` — test-only `createFakeCustomCollectionApi()`,
  `makeCustomCollection`, `makeCustomCollectionItem`,
  `makePrintingWithContextLite`, `FIXTURE_COLLECTIONS`,
  `FIXTURE_PICKER_SETS`. Tree-shaken from production via the
  `vi` import resolution path (mirrors T-W-BROWSE / T-W-
  COLLECTION fixtures pattern).
- `format.ts` — `slugify(name)`, `formatUpdatedAt(iso)`,
  `memberCountLabel(n)`, `computeCapStatus(used, cap)`.

### Components (`apps/web/components/collections/custom/`)

- `Modal.tsx` — minimal backdrop + centered surface dialog.
  `@binderly/ui` does not yet ship a `<Modal>` primitive; we
  roll our own here rather than block on a forthcoming
  T-SP-UI-MODAL. CSS-only, web-only — fine because this is
  the web app. Esc + backdrop click both close.
- `CustomCollectionsRoute.tsx` — auth-gate glue (mirrors
  `CollectionRoute`).
- `CustomCollectionsView.tsx` — list + cap header + create CTA
  (with disabled-at-cap branch and upsell tooltip pointing at
  `/billing`) + per-row Edit / Delete / member-count meta.
- `NewCustomCollectionModal.tsx` — name (required) + description
  (optional, capped at the contract's 500-char limit). Slug
  derived from name via `slugify`.
- `DeleteCustomCollectionModal.tsx` — destructive confirmation;
  reused by both list rows and the detail-page header button.
- `CustomCollectionDetailRoute.tsx` — auth-gate glue + 404 wire
  via `notFound()` from `next/navigation`.
- `CustomCollectionDetailView.tsx` — inline-editable name +
  description (raw `<input>` / `<textarea>` because the current
  `<Input>` wrapper does not yet expose `onBlur`; saves on blur
  with optimistic state); add cards CTA; member grid with
  per-tile Remove (optimistic with rollback on failure); delete
  collection button.
- `AddCardsModal.tsx` — printing-picker. Pick a set (release-
  date desc, mirrors browse), search by card name, multi-select
  printings, submit. Already-included printings render as
  disabled "Already added" rows.

### Routes (`apps/web/app/collections/custom/`)

- `page.tsx` — `dynamic = 'force-dynamic'`, mounts
  `<CustomCollectionsRoute />`.
- `[id]/page.tsx` — `dynamic = 'force-dynamic'`, mounts
  `<CustomCollectionDetailRoute collectionId={params.id} />`.

## Acceptance criteria

1. `pnpm install` succeeds.
2. `pnpm --filter @binderly/web typecheck` succeeds.
3. `pnpm --filter @binderly/web lint` succeeds.
4. `pnpm --filter @binderly/web test` succeeds with **at least
   30 tests** added in this PR covering:
   - sign-in prompt for signed-out users on both routes;
   - list renders user collections from a mocked api-client;
   - smart-kind rows are filtered out of the manual list;
   - "X / 3 used" header is correct;
   - "New" button is enabled with < 3 manual collections,
     disabled with 3, with the upsell tooltip + `/billing`
     link;
   - empty state with a "Create one" affordance;
   - create flow: opens modal, submits, refreshes list, closes
     modal; surfaces errors and keeps the modal open on
     failure; submit blocked while name is empty; Esc closes
     modal;
   - delete flow: opens confirm modal, fires DELETE, refreshes
     list; cancel doesn't fire DELETE; surfaces errors;
   - 404 for unknown collection id (component-level + route-
     level via `notFound()`);
   - smart-kind row at the manual URL is treated as 404;
   - detail renders members from a mocked api-client;
   - rename: PATCH on blur, no-op on unchanged, revert on
     emptied input;
   - description edit fires PATCH;
   - add cards: opens picker modal, multi-selects, fires POST
     per printing;
   - already-included printings are disabled in the picker;
   - remove: optimistic remove + DELETE; rolls back + surfaces
     error on failure;
   - delete via header button opens the confirm modal;
   - error state on detail when api-client throws;
   - data-layer unit tests (api adapter + manualOnly filter +
     fan-out fanout invariants);
   - format unit tests (slugify, memberCountLabel,
     formatUpdatedAt, computeCapStatus).
5. `pnpm --filter @binderly/web build` succeeds with NO env
   vars set: `unset NEXT_PUBLIC_SUPABASE_URL
   NEXT_PUBLIC_SUPABASE_ANON_KEY && pnpm --filter
   @binderly/web build`. Both new routes are emitted as
   dynamic (`ƒ`), matching `/browse`, `/collection`,
   `/sets/[id]`.
6. PR title: `feat(web): T-W-CUSTOM — manual custom
   collections (3-cap on free)`.

## Branch & PR

- Branch: `agent/T-W-CUSTOM`
- PR title: `feat(web): T-W-CUSTOM — manual custom collections (3-cap on free)`

## Notes from execution

- Reused T-W-COLLECTION's lazy api-client init pattern verbatim
  (`useEffect` builds the api adapter inside the route
  component) so `next build` static analysis never dereferences
  `loadWebEnv()`. Both new routes export `dynamic = 'force-
  dynamic'` like the rest of stage 04.
- `<SignInPrompt>` is reused from
  `apps/web/components/collection/SignInPrompt.tsx` (heading +
  body slots); not re-implemented under
  `components/collections/custom/`.
- `@binderly/ui`'s `<Input>` wrapper does not yet expose
  `onBlur` / `onEndEditing`. The detail view's inline-editable
  fields use raw `<input>` / `<textarea>` to capture blur —
  this is the smallest path that doesn't touch the shared UI
  package. A future T-SP-UI-INPUT-BLUR follow-up could expose
  `onBlur` and let us re-Tamagui these fields.
- `@binderly/ui` does not yet ship a `<Modal>`. We rolled a
  small backdrop+surface helper at
  `components/collections/custom/Modal.tsx`. Web-only, CSS-
  positioned, Escape + backdrop close. T-SP-UI-MODAL (future)
  could replace it with a portal-based mobile-aware version
  without touching consumers.
- Member-count "fan out one `listCustomCollectionItems` per
  list row" is bounded by the 3-cap on free, and on Pro is
  small in practice. A `?counts=true` server param would be
  the right Pro-scale optimization; flagged for the
  T-BE-EDGE-FUNCTIONS follow-up backlog rather than
  implemented here (out of scope per the brief).
- Drag-to-reorder was left out per the brief's "ship if it
  stays small" guidance. Members render in `addedAt`
  insertion order — natural and stable.
