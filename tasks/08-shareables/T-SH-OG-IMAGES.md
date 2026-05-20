# T-SH-OG-IMAGES — Dynamic OG image generation for public collection pages

**Stage:** 08-shareables
**Agent role:** frontend-web
**Effort:** M
**Status:** in_progress

## Hard dependencies

- T-W-SHAREABLE-PUBLIC (merged iter 20; the public page at
  `/c/[handle]/[slug]` whose `<meta property="og:image">` we point at).

## Soft dependencies

- T-BE-EDGE-FUNCTIONS-V2 (merged iter 21; the
  `GET /v1/c/{handle}/{slug}` Edge endpoint with the
  `Accept: application/vnd.binderly.share+json` content-type
  negotiation, surfaced through `client.shareables.getPublicShareablePayload`).
- T-SH-CONFIG-MODEL (parallel-safe; we only read the public payload
  shape that's already locked in `packages/api-contracts`).

## Required reading

- `PROJECT.md` § 14 (Shareables) — OG previews are an explicit
  build pillar.
- `rules/08-shareables.md` — stage rules: SSR + full meta tags,
  no PII leakage, anonymous read works, cache-friendly headers.
- `apps/web/app/c/[handle]/[slug]/page.tsx` — the public page that
  emits the `<meta property="og:image">` tag.
- `apps/web/lib/share/api.ts` — the `ShareApi` + `PublicSharePayload`
  contract every consumer reads against.
- `apps/web/lib/share/fixtures.ts` — fixtures + `createFakeShareApi`
  pattern this app reuses across share-page test suites.
- `packages/api-client/src/resources/shareables.ts` — the typed
  `getPublicShareablePayload(...)` resource method.

## Goal

Ship a Next.js Route Handler at `/api/og/share/[handle]/[slug]`
that renders a 1200×630 PNG Open Graph card whenever a public
shareable URL gets unfurled by Twitter / Discord / iMessage /
Slack / Bluesky etc. Today T-W-SHAREABLE-PUBLIC's file-based
`opengraph-image.tsx` ships a minimal text-only card; this task
replaces the metadata wiring with a richer `next/og` route that
composes the user's handle, collection name, a row of card-image
thumbnails, and stat line into one durable PNG. The route must
work anonymously (no auth on share URLs), cache cheaply at the
CDN, and never leak private data — `is_public=false` and unknown
`(handle, slug)` pairs serve a generic Binderly-branded fallback
PNG (NOT a 404, since social platforms cache 404s aggressively).

## Deliverables

- `apps/web/app/api/og/share/[handle]/[slug]/route.tsx` —
  Next.js Route Handler. `GET` returns a 1200×630 PNG via
  `next/og` `ImageResponse` with the spec'd `Cache-Control`
  header. Resolves the share payload via the same V2 Edge
  endpoint the public page uses, falls back to a generic
  branded image on miss / private / failure.
- `apps/web/lib/og/render.tsx` — pure JSX renderer for the
  card-grid hero. Exported for unit-test reach without invoking
  Satori. Composes brand-token gradient background, top-left
  Binderly wordmark, top-right "Pokémon collection by @{handle}"
  subtitle, center collection title, lower row of up to 4
  thumbnail tiles (real images if reachable; placeholder
  silhouettes otherwise), footer-right stat line.
- `apps/web/lib/og/fallback.tsx` — pure renderer for the
  fallback "Binderly branded" generic image (used when payload
  missing / private).
- `apps/web/lib/og/data.ts` — server-side share-payload fetcher.
  Wraps `apiToShareApi(getApiClient())` with a hard 2 s timeout
  per image fetch and a graceful null fallback so a 4xx/5xx
  Edge response never throws out of the route handler.
- `apps/web/lib/og/images.ts` — `fetchThumbnails(urls, opts)`.
  Resolves up to 4 image URLs to base64 data-URI strings (Satori
  needs in-memory bytes; it can't fetch images itself). Per-image
  timeout: 2 s. Failed slots fall back to a placeholder silhouette
  data-URI. Total budget: < 3 s.
- `apps/web/lib/og/cache-headers.ts` — single source of truth for
  the public render + fallback `Cache-Control` strings. Pure;
  pinned by tests.
- `apps/web/lib/og/__tests__/*` — vitest test suites covering
  pure renderers + headers + image resolution + data fetch.
- `apps/web/app/api/og/share/[handle]/[slug]/route.test.ts` —
  Route Handler tests: stub `fetch` via the api-client `fetch`
  override, verify happy path / fallback path / private path /
  cache headers / image-fetch timeout / cache-key correctness.
- `apps/web/app/c/[handle]/[slug]/page.tsx` — **minimal one-line
  edit** to point `metadata.openGraph.images` + `twitter.images`
  at the new route. Documented in PR description.
- `apps/web/app/c/[handle]/[slug]/opengraph-image.tsx` — left in
  place (file-based OG remains the fallback if the API route
  ever 5xxs or is mis-deployed; the page meta now points at the
  API route which is preferred by every social unfurler).

## Acceptance criteria

- [ ] `GET /api/og/share/{handle}/{slug}` returns
  `200 OK`, `Content-Type: image/png`, non-empty body, and
  `Cache-Control: public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800`.
- [ ] Unknown `(handle, slug)` returns 200 + fallback PNG (NOT 404),
  with cache header `public, max-age=3600`.
- [ ] `is_public=false` (non-`null` payload that the runtime treats
  as missing) returns the fallback (no payload data leaked).
- [ ] All 4 image fetches timing out renders the placeholder-tile
  variant successfully (no throw, still 200 + PNG).
- [ ] Cache-key correctness: rendered output bytes for handle "a"
  vs "b" differ; same handle + slug + fixed clock produce
  byte-identical bodies.
- [ ] OG metadata on the public page (`page.tsx` `generateMetadata`)
  emits `<meta property="og:image" content=".../api/og/share/{handle}/{slug}">`
  and the corresponding Twitter card.
- [ ] **25 + vitest tests pass** under `pnpm --filter @binderly/web test`,
  covering renderers, headers, image fetch, data fetch, and
  the route handler.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm --filter @binderly/web test`
  all green.
- [ ] No changes outside `owns_paths` other than the
  one-line `og:image` URL update on the public `page.tsx`
  (called out in the PR description).

## Out of scope

- Image generation for non-shareable URLs (e.g. card detail
  pages — different consumer, deferred to a future task).
- Themed OG images (Pro-only feature; T-SH-THEMES owns).
- Edge runtime tuning beyond verifying `runtime = 'nodejs'`
  works under `next/og` for our payload size.
- Custom font loading via `@vercel/og` font option — system
  fonts are fine for v1; a follow-up can swap in Inter / a
  branded serif later.
- The `/api/og` signing-secret abuse-prevention layer mentioned
  in `rules/08-shareables.md` § Conventions. The shareable URL
  itself is the abuse boundary (any URL hitting our OG route is
  a public-shareable URL); a downstream task can layer signing
  on top once we observe abuse signals in production.

## Branch & PR

- Branch: `agent/T-SH-OG-IMAGES`
- PR title: `feat(shareables): T-SH-OG-IMAGES — dynamic OG image generation for public collection pages`
- Worktree: `/Users/pmiranda/Stuff/binderly-wt-T-SH-OG-IMAGES`
- Commit format: Conventional Commits

## Escalation triggers

Stop and surface to orchestrator if:

- `next/og` `ImageResponse` is not available at the project's
  Next.js version (very unlikely — this is a Next 13.4+ stock
  API, and `apps/web` ships Next 14.2.18).
- The `GET /v1/c/{handle}/{slug}` Edge endpoint doesn't expose
  thumbnails on the public payload (would need a backend DTO
  extension; would block the lower-third row).
- The social-unfurl spec calls for sizes other than 1200×630
  (square crop variants, etc.).

In any of those cases append `Q-NNN` to `open-questions.md` via
shell heredoc and proceed with documented defaults.

## Notes from execution

(Sub-agent appends here at end. Empty until then.)
