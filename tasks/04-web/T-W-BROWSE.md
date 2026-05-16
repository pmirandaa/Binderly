# T-W-BROWSE — Browse + per-set + card-detail web routes

**Stage:** 04-web
**Agent role:** frontend-web
**Effort:** L
**Status:** in_review

## Hard dependencies

- T-W-SHELL (merged) — Next.js shell + provider tree
- T-BE-API-CLIENT (merged) — `@binderly/api-client` typed catalog reads
- T-DL-SEED-INGEST (merged) — seed catalog data exists in the
  backend (so the manual smoke test can hit a real backend; the
  test suite mocks the api-client directly)

## Soft dependencies

- Parallel-safe with T-W-AUTH (no shared paths; both edit
  `apps/web/app/...` but in disjoint subtrees)

## Required reading

- `PROJECT.md` § 7 (Browse + search), § 10 (Core App Features)
- `rules/04-web.md`
- `apps/web/app/layout.tsx`,
  `apps/web/components/providers/AuthProvider.tsx`,
  `apps/web/lib/env.ts`, `apps/web/lib/api-client.ts`,
  `apps/web/lib/supabase-browser.ts` — the merged shell
- `packages/api-client/src/index.ts`,
  `packages/api-client/src/resources/cards.ts` — catalog reads
- `packages/api-contracts/src/cards.ts`,
  `packages/api-contracts/src/common.ts` — DTO shapes
- `apps/web/app/auth/sign-in/page.tsx` (+ test) — reference
  posture for client-only pages

## Goal

Ship the **first end-user-visible web feature** on top of the
merged Next.js shell — three read-only catalog routes:

- `/browse` — list of every set, ordered by `release_date desc`
  (the THE Pablo regression test from `rules/04-web.md`), with
  language / series / search filters.
- `/sets/[id]` — per-set view with header + grid of printing
  thumbnails, breadcrumb back to `/browse`, 404 via
  `notFound()` for unknown ids.
- `/cards/[id]` — per-printing detail (despite the URL name,
  `[id]` is a printing UUID so we get set + card + variant in
  one fetch via `getPrinting()`). Includes hero image,
  metadata grid, pricing placeholder, and a **disabled**
  "Add to collection" button with a sign-in tooltip.

The pages mock the api-client directly in tests via a narrow
`BrowseApi` interface (props injection), letting view
components be exercised without touching `getApiClient()` or
the Supabase singleton. The route entrypoints lazy-construct
the api-client inside a `useEffect` so `next build` succeeds
with NO env vars set (the iter-14 W-SHELL hotfix lesson —
`force-dynamic` + lazy construction + render-time
`notFound()`).

## Deliverables

- `apps/web/app/browse/page.tsx`,
  `apps/web/app/browse/loading.tsx` — `/browse` route
  (server-component shell; `dynamic = 'force-dynamic'`).
- `apps/web/app/sets/[id]/page.tsx`,
  `apps/web/app/sets/[id]/loading.tsx` — `/sets/[id]` route.
- `apps/web/app/cards/[id]/page.tsx`,
  `apps/web/app/cards/[id]/loading.tsx` — `/cards/[id]` route.
- `apps/web/components/browse/BrowseRoute.tsx`,
  `SetRoute.tsx`, `CardRoute.tsx` — client glue components
  that defer api-client construction to `useEffect`.
- `apps/web/components/browse/BrowseView.tsx`,
  `SetView.tsx`, `CardView.tsx` — the actual UI surfaces;
  take a `BrowseApi` prop, fully testable with a fake.
- `apps/web/components/browse/SetCard.tsx`,
  `PrintingThumbnail.tsx` — small presentational primitives.
- `apps/web/lib/browse/api.ts` — `BrowseApi` narrow interface
  + `apiToBrowseApi(client)` adapter (exhausts cursor
  pagination across `listSets` / `listCardsInSet`).
- `apps/web/lib/browse/format.ts` — pure display helpers
  (release-date formatting, language / rarity labels, the
  `sortSetsByReleaseDateDesc()` Pablo-regression sorter).
- `apps/web/lib/browse/use-debounce.ts` —
  `useDebouncedValue(value, delayMs)` hook for the search
  input.
- `apps/web/lib/browse/fixtures.ts` — test-only data builders
  + `createFakeBrowseApi()` (lives inside the owns_paths but
  is only imported by `*.test.tsx`, so vitest's `vi` import is
  tree-shaken out of the production bundle).
- Test files alongside each module
  (`*.test.ts(x)`); 59 new tests across 9 files.

## Acceptance criteria

- [x] `pnpm install` succeeds.
- [x] `pnpm --filter @binderly/web typecheck` succeeds.
- [x] `pnpm --filter @binderly/web lint` succeeds.
- [x] `pnpm --filter @binderly/web test` succeeds with 59 new
      tests covering the 10 critical paths in the dispatch
      brief (release-date desc, language filter, debounced
      search, empty state, set-grid, set 404, card detail,
      card 404, disabled add-to-collection + tooltip, error
      states).
- [x] `unset NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY && pnpm --filter @binderly/web build`
      succeeds — the three new routes are emitted as
      dynamic / server-rendered (`ƒ` per the build output)
      so prerender doesn't trip the env-loader.
- [x] `pnpm -w lint` and `pnpm -w typecheck` succeed
      repo-wide.
- [x] `dependencies.yaml` flipped to `status: in_review`
      and `stub: false`.
- [x] No edits outside `owns_paths` except the
      pre-authorized list (`pnpm-lock.yaml`,
      `apps/web/package.json`, `dependencies.yaml`,
      `tasks/04-web/T-W-BROWSE.md`, `open-questions.md`)
      plus the Q-009-justified deletion of
      `apps/web/app/(tabs)/browse/page.tsx` + matching test
      removal in `apps/web/app/(tabs)/tabs.test.tsx`.

## Out of scope

- Collection-add mutation (T-W-COLLECTION).
- TCGplayer affiliate "Buy" CTAs (T-W-AFFILIATE-LINKS).
- Real pricing display (T-SP-PRICING-DISPLAY).
- Master-set / smart-collection UI (T-W-SMART).
- Scanner / camera integration (mobile-only stage 06).
- Server-side filtering (filters are client-side; the catalog
  is bounded ≤ 1000 sets for v1).
- Pagination for the set grid: `apiToBrowseApi.listAllSets()`
  exhausts the cursor up to 100 pages × 100 sets =
  10 000-set ceiling; sufficient for years.
- Real slug routing — `/sets/[id]` and `/cards/[id]` use the
  raw UUID (the api-client only exposes `getSet({id})` and
  `getPrinting({id})`). A future task can add a `slug`
  column + `getSetBySlug()` endpoint without breaking the
  URL shape.

## Branch & PR

- Branch: `agent/T-W-BROWSE`
- PR title: `feat(web): T-W-BROWSE — browse + per-set + card-detail routes`
  (the `T-W-BROWSE` callout is in the body for grep — same
  pattern as T-W-SHELL / T-W-AUTH; see PR title-lint regex
  workaround).
- Commit format: Conventional Commits.

## Escalation triggers

Resolved via `open-questions.md`:

- **Q-009** — `(tabs)/browse/` placeholder collides with this
  task's `app/browse/` route. Pragmatic fix landed in this PR
  (delete + test update); reversibility documented.

## Notes from execution

- **Server vs client** — Pages are server components (no
  `'use client'`) so `dynamic = 'force-dynamic'` is honoured.
  All env-touching work is deferred to a `useEffect` inside
  `BrowseRoute` / `SetRoute` / `CardRoute`. This is the
  iter-14 W-SHELL hotfix pattern applied verbatim.
- **`notFound()` placement** — The Next.js App Router
  contract requires `notFound()` to fire during render, not
  inside an effect. The view components funnel
  `ApiNotFoundError` into a `kind: 'not-found'` state and the
  render branch invokes `onNotFound()` synchronously.
- **Search debounce** — 200 ms by default; tests pass
  `searchDebounceMs={0}` for deterministic assertions.
- **Test injection** — Views program against a narrow
  `BrowseApi` (4 methods) instead of the full
  `BinderlyClient`, so a fake fits in ~30 lines (see
  `lib/browse/fixtures.ts`). Page entrypoint tests
  `vi.mock` the `apiToBrowseApi` adapter to inject the same
  fake, matching the sign-in page's posture.
- **Image rendering** — Thumbnails use plain `<img>` tags.
  Card-image hosts come from arbitrary R2 buckets at
  ingestion time; enumerating each in
  `next.config.mjs#images.remotePatterns` would be a
  maintenance burden. The image pipeline already produces
  appropriately sized WebP variants; we don't need
  `next/image`'s optimisation here.
- **N+1 caveat** — `apiToBrowseApi.listPrintingsInSet()`
  fetches the cards page-by-page, then issues
  `listPrintingsForCard()` for each card in parallel. For a
  ~200-card set that's ~200 sequential HTTP calls. A future
  optimisation is a backend `listPrintingsInSet` endpoint.
- **Manual smoke** — The sandbox doesn't have a backend
  running; the dev server boots locally
  (`pnpm --filter @binderly/web dev`) but
  `localhost:3000/browse` will surface the api-client error
  state without a real Supabase instance. CI green covers
  the unit-test path; first real-backend smoke test will
  happen at preview-deploy time once T-DP-VERCEL lands.
