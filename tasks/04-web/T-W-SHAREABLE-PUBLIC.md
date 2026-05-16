# T-W-SHAREABLE-PUBLIC — Public shareable pages (SSR, OG images)

**Stage:** 04-web
**Agent role:** frontend-web
**Effort:** L
**Status:** in_review

## Hard dependencies

- T-W-COLLECTION (merged) — `<ProgressBar>` + `formatPercent`
  conventions + the `lib/<feature>/api.ts` injectable adapter
  pattern this task mirrors verbatim.

## Soft dependencies

- T-W-BROWSE (merged) — `<PrintingThumbnail>` is the visual model
  for the member tile; `force-dynamic` + lazy-`getApiClient()`
  is the build-without-env pattern.

## Required reading

- PROJECT.md § 10 (Core App Features), § 14 (Shareables),
  § 16 (Freemium).
- rules/04-web.md — stage rules, especially the SSR + OG
  requirement and the build-time env-var rule.
- `apps/web/app/layout.tsx`, `apps/web/lib/api-client.ts` — the
  shell + the api-client singleton.
- `apps/web/app/collection/page.tsx`,
  `apps/web/components/collection/CollectionView.tsx`,
  `apps/web/components/collection/ProgressBar.tsx` — the
  auth-gated sibling whose rendering primitives the public page
  mimics (header + summary card + grid).
- `apps/web/app/browse/page.tsx`,
  `apps/web/components/browse/CardView.tsx`,
  `apps/web/components/browse/PrintingThumbnail.tsx` — the
  printing-tile visual + the `force-dynamic` page entry pattern.
- `packages/api-client/src/resources/shareables.ts` — already
  exposes `getPublicShareable({handle, slug})` (`anonymous: true`,
  returns `ShareableDto`).
- `packages/api-contracts/src/shareables.ts` — `ShareableDto`,
  `ShareableTarget` union, `ShareableTheme`.
- `packages/db/src/schema/shareables.ts` — `shareable` table
  shape (`handle/slug` via the joined profile + `unique(user_id,
  slug)`).
- `infra/supabase/functions/_shared/routes-table.ts` — confirms
  the `/v1/c/{handle}/{slug}` route is NOT yet implemented in
  the Edge Function (see Q-011).

## Goal

Ship the public shareable surface at `/c/[handle]/[slug]` on
web. A logged-out visitor lands on the page from a share URL
(or a social unfurler) and sees:

- A page header with the owner's handle / display name, the
  collection title, an optional description, and a relative
  "last updated" stamp.
- A "collection snapshot" card showing the headline tally
  (`X / Y cards`) + completion %.
- A member grid of printings — each tile links to
  `/cards/[printingId]` (public per T-W-BROWSE) with image,
  card name + number, set name + variant.
- A signup CTA footer ("Powered by Binderly — Sign up free →")
  pointing to `/auth/sign-in?signup=1`.
- A dynamically-generated 1200×630 Open Graph image at
  `/c/[handle]/[slug]/opengraph-image` so social unfurls
  surface the collection title + tally + Binderly branding.

The page is `force-dynamic` (not statically prerendered) so
`next build` succeeds with no env vars set — matching the
iter-14 W-SHELL hotfix lesson and the T-W-BROWSE / T-W-COLLECTION
pattern.

This task is the foundation for the Stage 08 shareables work
(`T-SH-OG-IMAGES`, `T-SH-THEMES`, `T-SH-CONFIG-MODEL`) — every
one of those follow-ups depends on the `ShareApi` interface, the
`PublicSharePayload` shape, and the OG-image route this task
introduces.

## Deliverables

- `apps/web/app/c/[handle]/[slug]/page.tsx` — `/c/[handle]/[slug]`
  route (server component, `dynamic = 'force-dynamic'`,
  `generateMetadata()` emitting OG + Twitter meta).
- `apps/web/app/c/[handle]/[slug]/loading.tsx` — route loading
  skeleton.
- `apps/web/app/c/[handle]/[slug]/opengraph-image.tsx` — OG
  image route using `next/og`'s `ImageResponse` (1200×630, PNG,
  Node.js runtime).
- `apps/web/components/share/ShareableRoute.tsx` — `'use client'`
  glue that lazily constructs the api-client + maps 404 to
  `notFound()`.
- `apps/web/components/share/ShareableView.tsx` — main public
  shareable view (header, summary card, member grid, footer
  CTA, plus loading / 404 / error states).
- `apps/web/components/share/MemberTile.tsx` — single printing
  tile in the member grid (visual cousin of
  `<PrintingThumbnail>`; links to `/cards/[printingId]`).
- `apps/web/lib/share/api.ts` — `ShareApi` interface +
  `PublicSharePayload`, `PublicShareOwner`, `PublicShareMember`,
  `PublicShareCounts` types + `apiToShareApi(client)` runtime
  adapter.
- `apps/web/lib/share/format.ts` — `formatPercent`,
  `formatCardTally`, `formatOwnedShort`, `formatHeaderTally`,
  `formatLastUpdated`, `publicShareUrl`.
- `apps/web/lib/share/fixtures.ts` — test-only fixtures +
  `createFakeShareApi(...)` matching the
  T-W-BROWSE / T-W-COLLECTION fake-api pattern.
- Test suites alongside each module —
  `ShareableView` (22), `MemberTile` (7), `ShareableRoute` (3),
  page entry (5), `opengraph-image` (9), `lib/share/api` (6),
  `lib/share/format` (15) = **67 new tests**, all passing.
- `dependencies.yaml` — `T-W-SHAREABLE-PUBLIC` flipped
  `status: pending → status: review`, `stub: true → stub: false`.
- `open-questions.md` — appended `Q-011` (public-read endpoint
  not implemented; richer `publicShareableDto` proposed —
  see "Escalations").

## Acceptance criteria

- [x] `pnpm install` succeeds.
- [x] `pnpm --filter @binderly/web typecheck` succeeds.
- [x] `pnpm --filter @binderly/web lint` succeeds.
- [x] `pnpm --filter @binderly/web test` succeeds with at least
      25 tests covering the brief's checklist. **67 shareable-
      specific tests** land across:
      - `/c/[handle]/[slug]` renders collection name + owner +
        tally + completion % when the public api returns data
        (`ShareableView` header / summary tests).
      - 404 for unknown handle/slug (`ShareableView` not-found
        test + `ShareableRoute` `notFound()` test +
        `apiToShareApi` 404 mapping test).
      - error state when the public api errors
        (`ShareableView` error tests, including generic-message
        fallback).
      - member grid renders printings with name + image alt +
        set badge (`ShareableView` member-grid tests +
        `MemberTile` tests).
      - links to `/cards/[id]` are present and use the correct
        `printingId` (`ShareableView` + `MemberTile` link
        tests, including path encoding).
      - footer signup CTA renders + has correct href
        (`ShareableView` footer tests).
      - OG image route returns a valid response (the metadata
        API + the `renderOgCard` JSX renderer don't throw and
        the canonical OG size/contentType/alt/runtime are
        declared correctly).
      - tests use a fake api adapter (props injection) same as
        T-W-BROWSE / T-W-COLLECTION / T-W-CUSTOM.
- [x] `unset NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY
      && pnpm --filter @binderly/web build` succeeds —
      `/c/[handle]/[slug]` and `/c/[handle]/[slug]/opengraph-image`
      are marked `ƒ (Dynamic)` in the build output.
- [x] Replace the STUB section per `AGENT_ORCHESTRATOR.md` § 7.
- [x] PR title matches `feat(web): T-W-SHAREABLE-PUBLIC — public
      shareable pages (SSR + OG images)`.

## Out of scope

- **No backend route added.** The api-client's
  `getPublicShareable` calls `GET /v1/c/{handle}/{slug}` which
  the Edge Function does not yet implement. The page still
  ships (with a degraded runtime adapter) and tests use a fake
  api that returns a rich payload. See "Escalations" + Q-011.
- No edit-shareable UI — that's a follow-up. The Stage 08
  shareables track (`T-SH-CONFIG-MODEL`) owns the configure-
  shareable surface.
- No private-link / token-gated variant; visibility is "public
  if a shareable row exists". Theming beyond `'default'` is
  the paid feature `T-SH-THEMES` will deliver.
- No social actions (likes, comments, share-to-platform).
- No analytics / view counts on the public page.

## Non-obvious decisions

- **`PublicSharePayload` is richer than `ShareableDto`.** The
  api-client only exposes `getPublicShareable` returning the
  bare `shareable` row. The SSR page needs the owner profile,
  the collection title, member items, and counts — all join
  data that today doesn't have a public read path. We declared
  `PublicSharePayload` in `lib/share/api.ts` as the contract
  the page programs against; the runtime adapter synthesises
  a degraded payload from `getPublicShareable` (empty members,
  zero counts) until the backend lands the richer endpoint
  (Q-011).
- **Page is `force-dynamic` + uses a client glue component.**
  We considered a true server-component fetch (and ditched it)
  because:
  1. The build-with-no-env-vars constraint (`next build` must
     succeed without `NEXT_PUBLIC_SUPABASE_*`) is easiest to
     honour with the established lazy-`getApiClient()` pattern.
  2. The OG image route DOES SSR-fetch server-side via the same
     `apiToShareApi(getApiClient())` path, wrapped in a
     try/catch so the build's static collection phase falls
     back to a metadata-only image.
  3. `generateMetadata()` emits the OG meta tags from URL
     params alone — no network call, no SSR-fetch failure mode.
     Crawlers receive the meta + the sibling
     `opengraph-image.tsx` image; the human visitor's body
     hydrates from the api-client like every other Binderly
     route.
- **OG image uses `next/og` (built-in, no extra dep).** Next.js
  14 ships `ImageResponse` from `next/og` (Vercel OG /
  Satori). No `@vercel/og` install needed; the package.json is
  unchanged. The OG template uses inline styles only (Satori
  doesn't understand Tamagui's CSS-in-JS output).
- **OG route tests cover the pure JSX renderer, not
  `ImageResponse`.** Calling `new ImageResponse(...)` in
  vitest's jsdom environment tries to load the WASM-backed
  Satori binary, which the test runtime doesn't have. We
  exported `renderOgCard(params, payload)` separately so tests
  exercise the JSX shape (title, owner label, tally, URL) and
  the static metadata exports (`size`, `contentType`, `alt`,
  `runtime`). The full pipeline runs at request time + during
  `next build`'s build trace.
- **`/cards/[id]` links use `printingId`, NOT `cardId`.**
  T-W-BROWSE's `/cards/[id]` route resolves to a printing UUID
  (so a single fetch returns set + card + variant context). We
  surface BOTH ids on `PublicShareMember` so tests can assert
  the underlying card id directly without dereferencing
  relationships.
- **Last-updated time is relative + deterministic.** The view
  accepts an optional `now: Date` prop so deterministic tests
  pin "2 days ago" against a known wall-clock. For dates older
  than 30 days `formatLastUpdated` falls back to a `YYYY-MM-DD`
  ISO string so the social preview never reads "27 days ago"
  forever.
- **`MemberTile` reimplements `<PrintingThumbnail>` rather than
  importing it.** T-W-BROWSE's thumbnail lives in
  `components/browse/`; importing it from
  `components/share/MemberTile.tsx` would couple two stages
  whose owns_paths are disjoint. We keep the visual identical
  (same `<Card>` + `<YStack>` shell + `next/image`-avoidance
  comment) but the testid namespace is local (`share-member-*`)
  so cross-stage selectors don't collide.
- **No `@vercel/og` or extra dep in `package.json`.** The brief
  pre-authorized a minimal dependency edit; none was needed
  because Next 14 already bundles `next/og`. `package.json`
  is unchanged in this PR.

## Branch & PR

- Branch: `agent/T-W-SHAREABLE-PUBLIC`
- PR title:
  `feat(web): T-W-SHAREABLE-PUBLIC — public shareable pages (SSR + OG images)`
- Commit format: Conventional Commits.

## Escalations

- **Q-011 raised** — the api-client's `getPublicShareable`
  expects a `/v1/c/{handle}/{slug}` route that is NOT
  implemented in the merged Edge Function code (the dispatch
  table in `infra/supabase/functions/_shared/routes-table.ts`
  has no entry under `/c/`). Even when the backend ships that
  route, the response shape (`shareableDto`) carries metadata
  only — no owner display name, no collection name, no
  members, no counts. The proposed follow-up adds a richer
  `publicShareableDto` (Option 1 in Q-011). This PR ships the
  data layer (`lib/share/api.ts`) declaring the richer shape
  so the backend follow-up has zero web-side churn beyond
  swapping the runtime adapter's degraded synthesis for a
  direct call.

## Notes from execution

- Sub-agent ran on iteration 19 (Phase 5 wrap-up; T-W-AFFILIATE-
  LINKS in parallel).
- **67 shareable-specific tests** pass; total `apps/web` test
  count after this PR: **411 tests** across 54 files (was
  344 / 47 before this task).
- `pnpm --filter @binderly/web build` with no env vars set:
  **succeeded**, both `/c/[handle]/[slug]` and
  `/c/[handle]/[slug]/opengraph-image` render as `ƒ (Dynamic)`.
- One open question appended (`Q-011`); no other escalations.
