# T-W-SHELL — Next.js app shell, routing, layout, theme

**Stage:** 04-web
**Agent role:** frontend-web
**Effort:** M
**Status:** in_progress

## Hard dependencies

- **T-SP-UI-TOKENS** (merged) — `@binderly/ui` ships the Tamagui
  config + `<UIProvider>` + token-aware primitives this shell wraps.
- **T-BE-API-CLIENT** (merged) — `@binderly/api-client` ships the
  typed `createClient({ baseUrl, apiKey, getJwt, supabaseAuth })`
  factory this shell instantiates as a browser-side singleton.

## Soft dependencies

- **T-M-SHELL** (parallel sibling, in flight) — owns
  `apps/mobile/`. Orthogonal at the directory level; only
  `pnpm-lock.yaml` is contended at merge time and the orchestrator
  resolves it.

## Required reading

- `tasks/04-web/T-W-SHELL.md` (this file).
- `packages/ui/README.md` — Tamagui setup story (provider is
  `"use client"`, primitives are RSC-safe; `tamaguiConfig.getCSS()`
  is the SSR injection point).
- `packages/api-client/README.md` — `createClient` recipe and the
  `getJwt` injection pattern.
- `packages/auth/README.md` — server-side auth helpers; the
  browser-side Supabase JS instance lives separately in this app.
- `AGENT_ORCHESTRATOR.md` § 7 (Full task template).
- `rules/04-web.md` — RSC by default, sets default sort, R2 image
  host, accessibility, perf budget.

## Goal

Stand up `apps/web` — the Next.js 15 App Router shell that hosts
the entire Binderly web product. This task owns the cross-cutting
plumbing: root HTML scaffolding, font/CSS scaffolding, the
provider tree (Tamagui UI, browser Supabase, TanStack Query,
auth context), the typed env loader, the api-client singleton,
base error/loading boundaries, the middleware skeleton, and the
empty route folders the downstream tabbed-IA tasks plug into.
T-W-AUTH / T-W-BROWSE / T-W-COLLECTION / T-W-CUSTOM /
T-W-SHAREABLE-PUBLIC / T-PB-PADDLE all build on top of this
shell; this task ships zero feature surface itself.

## Decisions

### D1 — Tech stack

- **Next.js 15** (App Router). React 19 stable (Next 15 requires
  it).
- **`@binderly/ui` only.** Apps consume Tamagui exclusively
  through `@binderly/ui`'s `<UIProvider>` and primitives;
  `@tamagui/core` is not a direct dep here.
- **Tamagui SSR via `tamaguiConfig.getCSS()`.** No
  `@tamagui/next-plugin` in this iteration — the umbrella plugin
  ties to the umbrella `tamagui` package; we bind to
  `@tamagui/core` only (per the iter 13 ui-tokens decision).
  Server-rendered pages flush `getCSS()` into a `<style>` tag in
  `<head>` so styles arrive with the markup; subsequent
  client-side renders use Tamagui's runtime sheet.
- **TanStack Query 5.x** for client-side data caching layered on
  the api-client; no SSR hydration plumbing in this iteration
  (RSC initial loads stay direct via the api-client).
- **`@supabase/supabase-js` 2.x** as the browser session source
  of truth (cookies via Supabase's `auth-helpers` are not pulled
  in here — interactive auth flows in T-W-AUTH may add them).
- **TypeScript strict** (extends `@binderly/tsconfig/next.json`).
- **Tests** via Vitest 2.x + jsdom + `@testing-library/react@16`
  (matches sibling packages exactly).

### D2 — Route structure

```
apps/web/app/
├── layout.tsx                    # root layout: <html>, providers, getCSS injection
├── page.tsx                      # placeholder marketing/home page
├── error.tsx                     # global error boundary (Next-required)
├── loading.tsx                   # global loading.tsx (Next-required)
├── not-found.tsx                 # 404
├── (tabs)/
│   ├── browse/page.tsx           # placeholder — T-W-BROWSE fills
│   ├── collection/page.tsx       # placeholder — T-W-COLLECTION fills
│   ├── scanner/page.tsx          # placeholder — mobile-only feature, web stub
│   └── profile/page.tsx          # placeholder
└── auth/
    ├── sign-in/page.tsx          # placeholder — T-W-AUTH fills
    ├── callback/page.tsx         # placeholder — T-W-AUTH fills (PKCE)
    └── sign-out/page.tsx         # placeholder — T-W-AUTH fills
```

The `(tabs)` route group exists only so the four core tabs share
a common visual chrome later; sibling tasks may move them out
of the group if they need a different shell. No layout file is
shipped under `(tabs)/` in this iteration — the root layout
suffices.

### D3 — Provider tree

```
<html>
  <head>
    <style id="tamagui-css">{tamaguiConfig.getCSS()}</style>
  </head>
  <body>
    <UIProvider defaultTheme={resolvedTheme}>      // @binderly/ui (wrapped here)
      <QueryProvider>                              // TanStack Query
        <AuthProvider>                             // Supabase JS session listener
          <ErrorBoundary>{children}</ErrorBoundary>
        </AuthProvider>
      </QueryProvider>
    </UIProvider>
  </body>
</html>
```

- `UIProvider` (this app's) wraps `@binderly/ui`'s `<UIProvider>`
  and adds (a) light/dark resolution from `prefers-color-scheme`
  with `localStorage` override and (b) a React context exposing
  `{ theme, setTheme, toggleTheme }`.
- `AuthProvider` subscribes to `supabase.auth.onAuthStateChange`
  and exposes `{ session, user, loading, signOut }` via context.
- `QueryProvider` configures sensible defaults
  (`staleTime: 30_000`, `retry: 1`, `refetchOnWindowFocus: false`).

### D4 — Env strategy

`apps/web/lib/env.ts` is the single typed env loader. Required
keys (Next-style `NEXT_PUBLIC_*` so they survive the build-time
inline pass), failing fast at module load when any are missing:

| Key                              | Notes                          |
| -------------------------------- | ------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`       | Backend API base URL.          |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`  | Public anon key.               |
| `NEXT_PUBLIC_R2_PUBLIC_BASE_URL` | (optional) image CDN host.     |
| `NEXT_PUBLIC_APP_URL`            | (optional) self URL for OG.    |

The api-client expects unprefixed `SUPABASE_URL` /
`SUPABASE_ANON_KEY`, so `lib/api-client.ts` re-maps the
`NEXT_PUBLIC_*` keys before constructing.

`.env.example` ships dev defaults targeting the local Supabase
stack (`http://localhost:54321`).

### D5 — API client singleton

`apps/web/lib/api-client.ts` exports a memoized singleton
constructed with:

- `baseUrl` / `apiKey` from `lib/env.ts`.
- `getJwt` callback that reads `supabase.auth.getSession()` from
  the browser singleton in `lib/supabase-browser.ts`.
- `supabaseAuth` shared with the AuthProvider so sign-in /
  sign-out / session-listener wires hit the same SDK instance.

Server-side callers (RSC, route handlers) are deferred to
T-W-AUTH / feature tasks; this shell ships only the browser
binding.

### D6 — Theme strategy

- Default: read `localStorage.getItem('binderly:theme')`; fall
  back to `prefers-color-scheme`; default to `'light'`.
- Manual toggle persists to `localStorage`.
- A small synchronous `<script>` in `<head>` reads the saved
  preference and sets `data-theme="dark"` on `<html>` BEFORE
  React hydrates so there's no flash. Tamagui sees the same
  `defaultTheme` from the provider.

### D7 — Test posture

Vitest + jsdom + `@testing-library/react@16`. Tests live next
to their subjects (`*.test.tsx`). A `test-utils/render.tsx`
wraps RTL `render` with `<UIProvider>` for components that
need theme tokens.

Coverage target: 30-50 tests, contract-focused:

- `lib/env.test.ts` — missing keys throw; valid load returns
  typed object; trailing slash stripped.
- `lib/api-client.test.ts` — singleton constructed once;
  baseUrl threaded from env; `getJwt` resolves through
  Supabase mock.
- `lib/supabase-browser.test.ts` — singleton shape; persists
  session by default.
- `components/providers/UIProvider.test.tsx` — composes;
  exposes theme context; toggle persists to `localStorage`;
  reads `prefers-color-scheme` initial value.
- `components/providers/AuthProvider.test.tsx` — exposes
  `{ session, user, loading, signOut }`; subscribes to
  `onAuthStateChange`; `signOut` calls SDK.
- `components/providers/QueryProvider.test.tsx` — composes;
  client constructed with expected defaults.
- `components/error/ErrorBoundary.test.tsx` — catches generic
  Error; renders friendly message; surfaces `ApiError.code`
  when present.
- `components/loading/*.test.tsx` — `PageLoading` and
  `Skeleton` render.
- One smoke test per placeholder route (`page.test.tsx`).
- `app/layout.test.tsx` — provider tree mounts without
  throwing.

### D8 — Build / lint / typecheck

- `pnpm --filter @binderly/web build` — `next build` produces
  a clean prod build.
- `pnpm --filter @binderly/web typecheck` — `tsc --noEmit`.
- `pnpm --filter @binderly/web lint` — ESLint flat config
  extending `@binderly/eslint-config/next`.
- `pnpm --filter @binderly/web test` — Vitest run.
- `pnpm --filter @binderly/web format:check` /
  `format:write` — Prettier with `@binderly/prettier-config`.

## Deliverables

- `apps/web/package.json` — workspace `@binderly/web`
  (private). Pinned versions, no `^` / `~`.
- `apps/web/tsconfig.json` — extends
  `@binderly/tsconfig/next.json`.
- `apps/web/next.config.ts` — Tamagui transpile list, R2
  image host configured.
- `apps/web/eslint.config.mjs` — extends
  `@binderly/eslint-config/next`.
- `apps/web/vitest.config.ts` — jsdom + Tamagui inline.
- `apps/web/.env.example` — documented env keys.
- `apps/web/README.md` — provider tree, route inventory, env
  keys, dev/build/test recipes.
- `apps/web/app/layout.tsx`, `app/page.tsx`, `error.tsx`,
  `loading.tsx`, `not-found.tsx`.
- `apps/web/app/(tabs)/{browse,collection,scanner,profile}/page.tsx`.
- `apps/web/app/auth/{sign-in,callback,sign-out}/page.tsx`.
- `apps/web/lib/env.ts`, `api-client.ts`, `supabase-browser.ts`.
- `apps/web/components/providers/{UIProvider,AuthProvider,QueryProvider}.tsx`.
- `apps/web/components/error/ErrorBoundary.tsx`.
- `apps/web/components/loading/{PageLoading,Skeleton}.tsx`.
- `apps/web/middleware.ts` (skeleton; T-W-AUTH fills logic).
- Colocated `*.test.{ts,tsx}` files.

## Acceptance criteria

- [ ] `apps/web/` exists as a workspace with valid
      `package.json` (`name: @binderly/web`, `private: true`,
      `type: module`).
- [ ] `pnpm --filter @binderly/web build` produces a clean
      `.next/` prod build (no errors, no warnings about missing
      env when `.env.example` defaults are used).
- [ ] `pnpm --filter @binderly/web typecheck` passes under
      strict TS.
- [ ] `pnpm --filter @binderly/web lint` passes with
      `--max-warnings=0`.
- [ ] `pnpm --filter @binderly/web test` runs ≥30 tests, all
      green.
- [ ] Repo-wide `pnpm -w lint && pnpm -w typecheck && pnpm -w
      test && pnpm -w build` are all green.
- [ ] Provider tree composes without throwing (asserted in
      tests).
- [ ] `lib/env.ts` throws synchronously when required keys are
      missing (asserted in tests).
- [ ] API-client singleton is constructed with the env URL +
      anon key + a `getJwt` callback wired to the browser
      Supabase SDK (asserted in tests).
- [ ] Theme toggle persists to `localStorage` and applies to
      the document (asserted in tests).
- [ ] Each placeholder route renders without crashing
      (asserted in tests).
- [ ] All buttons / inputs / links inside this task's scope use
      `@binderly/ui` primitives (no direct `@tamagui/core`
      imports in `apps/web/`; ESLint enforces).
- [ ] No `fetch` to backend resources outside the api-client
      (ESLint hint).
- [ ] `dependencies.yaml`: `T-W-SHELL` flipped from `pending`
      to `review`; `stub: false`.

## Out of scope

- Real auth flows (T-W-AUTH).
- Browse / set / card pages (T-W-BROWSE).
- Collection home (T-W-COLLECTION).
- Custom / smart collections (T-W-CUSTOM / T-W-SMART).
- Public shareable pages (T-W-SHAREABLE-PUBLIC).
- Paddle billing pages (T-PB-PADDLE).
- Affiliate "Buy on TCGplayer" CTAs (T-W-AFFILIATE-LINKS).
- E2E / Playwright (`rules/04-web.md` calls for it later;
  not on the shell's critical path).
- Lighthouse CI plumbing (`T-DP-VERCEL` / a later task).

## Branch & PR

- Branch: `agent/T-W-SHELL`
- PR title: `T-W-SHELL: Next.js app shell — layout, routing, providers, theme`
- Commit format: Conventional Commits.

## Authorized out-of-`owns_paths` edits

- `pnpm-lock.yaml` (regenerated for the new app workspace).
- `pnpm-workspace.yaml` if needed (`apps/*` glob already
  covers; no edit expected).
- `dependencies.yaml` — flip `T-W-SHELL` `status: pending` →
  `status: review`; set `stub: false`.
- `tasks/04-web/T-W-SHELL.md` (this elaboration).

## Escalation triggers

Stop and append to `open-questions.md` if:

- Tamagui + Next.js 15 SSR/RSC has a sharp edge (style
  flicker, RSC compile error) that the iter 13 ui-tokens
  README doesn't cover.
- A required env key for Supabase isn't documented anywhere.
- The IA from PROJECT.md § 10 is ambiguous (e.g. a tab list
  disagreement between this shell and T-M-SHELL).
- A backend contract gap surfaces (a needed endpoint missing
  from `@binderly/api-client`).
- A change is needed outside the pre-authorized files.

## Notes from execution

_(Sub-agent appends here at end. Empty until then.)_
