# Stage 04 — Web App rules

Next.js 15 App Router. SSR for shareables and SEO; RSC by default; client
components only when necessary. Tamagui for components.

## Required reading

- `PROJECT.md` § 10 (Core App Features), § 14 (Shareables), § 16 (Freemium)
- `context/conventions.md`
- `context/tech-stack.md` § Web app

## Hard rules

- **RSC by default.** A `"use client"` directive needs a one-line comment
  justifying it (interaction, hooks, browser API).
- **Public shareable pages must SSR with proper meta tags.** OpenGraph,
  Twitter card, and `og:image` come from the dynamic OG endpoint. Test
  with a link unfurler.
- **Sets default sort: `release_date desc`.** This is THE critical Pablo
  fix. Add a regression test on browse and on every other surface that
  lists sets.
- **No raw card images from external sources.** Every image source is
  R2 (`WEB_R2_PUBLIC_BASE_URL`).
- **Smart-collection "Save" button visible to free users but disabled
  with a clear upgrade affordance.** This is a key conversion surface;
  PR review checks for it.
- **Accessibility.** Keyboard navigation, focus rings, ARIA on
  interactive non-button elements, color contrast WCAG AA.
- **Performance budget.** First-contentful-paint < 1.5s on 4G in
  Lighthouse for browse, set, and shareable pages. CI runs Lighthouse on
  preview deploys.
- **Loading states are real.** Use `loading.tsx` and Suspense
  boundaries. No "all-or-nothing" pages that block on slow data.

## Conventions specific to this stage

- File-based routing per Next.js conventions.
- `app/(authed)/...` for routes that require sign-in; redirect on no
  session.
- Server actions for mutations where appropriate; otherwise call
  api-client from client components.
- Image component: `next/image` with the R2 host configured in
  `next.config.js`.
- Forms: react-hook-form + zod resolver. Validate on blur.
- Error boundaries via `error.tsx` per route segment.

## Common pitfalls

- `cookies()` and `headers()` are RSC-only — don't try to use them in a
  client component.
- TanStack Query in App Router: hydration boundaries are tricky; follow
  the official Next.js example.
- Tamagui requires a Babel/SWC plugin in `next.config.js`. T-SP-UI-TOKENS
  sets it up.
- OG images from Vercel OG / Satori don't render arbitrary CSS — keep
  the OG template simple.

## Done when

- All routes in `PROJECT.md` § 10 implemented for web.
- A signed-in user can: browse, view set, view card, add a card, create
  a custom collection, search smart collection, configure a shareable.
- A signed-out visitor can view a public shareable page, see proper
  social previews when sharing the link.
- Lighthouse passes on the budgeted pages.
- Free vs Pro gating enforced visually and verified server-side.
