# T-W-AUTH — Web auth pages and session handling

**Stage:** 04-web
**Agent role:** frontend-web
**Effort:** M
**Status:** pending

## Hard dependencies

- T-W-SHELL (merged) — Next.js shell, `<AuthProvider>`, `getBrowserSupabase`, `getApiClient`, middleware skeleton.
- T-BE-AUTH (merged) — server-side `@binderly/auth` helpers + Supabase project config (Google / Apple / Discord / magic-link providers enabled in `infra/supabase/auth/`).

## Soft dependencies

- T-M-AUTH (parallel sibling) — owns the mobile equivalent. Orthogonal directories.

## Required reading

- `apps/web/app/auth/{sign-in,callback,sign-out}/page.tsx` (placeholders being replaced)
- `apps/web/components/providers/AuthProvider.tsx` (lazy useEffect-based Supabase init — preserve the pattern)
- `apps/web/lib/supabase-browser.ts` (browser singleton; only safe to touch from `'use client'` code, never at module evaluation)
- `apps/web/middleware.ts` (skeleton — extend for protected-route gating)
- `packages/api-client/src/resources/auth.ts` (interactive auth contract — `signInWithOAuth`, `signInWithMagicLink`, `exchangeCodeForSession`, `signOut`)
- `packages/auth/README.md` (server-side surface; confirms the JWT shape but no server work needed here)
- `infra/supabase/auth/{google,discord,magic-link,redirect-urls}.md` (provider config — already wired by T-BE-AUTH)

## Goal

Replace the three placeholder auth pages from T-W-SHELL with a real, end-to-end interactive sign-in surface for the web app and wire protected-route enforcement into the existing middleware. Users should be able to sign in via magic-link or any of the three OAuth providers, complete the PKCE callback, and sign out cleanly. Unauthenticated requests for routes the product treats as private (`/collection/*`, `/profile/*`) are redirected to `/auth/sign-in?next=…` and the original destination is preserved across the round-trip.

## Deliverables

- `apps/web/app/auth/sign-in/page.tsx` — interactive sign-in: magic-link form + Google/Apple/Discord OAuth buttons; reads `?next=` and forwards it to `redirectTo` so the callback resumes the original destination. Uses `@binderly/ui` only.
- `apps/web/app/auth/callback/page.tsx` — exchanges the `?code=` query param via `supabase.auth.exchangeCodeForSession`, then redirects to the `?next=` target (default `/`). Surfaces `?error_description=` if the provider returned one.
- `apps/web/app/auth/sign-out/page.tsx` — calls `AuthProvider.signOut()` once on mount, shows a brief confirmation, and redirects home after a short delay. Idempotent on repeat visits.
- `apps/web/lib/auth/redirect.ts` — pure helpers: `buildSignInUrl(next)`, `extractNext(searchParams)`, `safeNext(value)` (rejects external URLs to avoid open-redirect).
- `apps/web/lib/auth/protected-route.tsx` — declarative `<ProtectedRoute>` client wrapper. Reads `useAuth()`; renders fallback while loading; renders children when authenticated; calls `router.replace(buildSignInUrl(currentPath))` when signed-out.
- `apps/web/middleware.ts` — extended: a small `PROTECTED_PREFIXES` array (`/collection`, `/profile`); when a request to one of those has no Supabase auth cookie (`sb-*-auth-token`), respond with a redirect to `/auth/sign-in?next=<path>`. Preserves the existing `x-request-id` header behaviour. Best-effort cookie check — definitive gating still happens client-side via `<ProtectedRoute>`.
- `apps/web/.env.example` — comment block documenting that OAuth client IDs / secrets are configured **on the Supabase dashboard** (not in this app's env), so no new env keys are added here. Magic-link redirect URLs come from `NEXT_PUBLIC_APP_URL`.
- Tests for every file above (≈30–50 total) under the same paths with `.test.ts(x)` suffix.

## Acceptance criteria

- [ ] `/auth/sign-in` renders the magic-link form (email field + submit) and three OAuth buttons.
- [ ] Submitting the magic-link form with an invalid email shows an inline error and does NOT call `signInWithOtp`.
- [ ] Submitting with a valid email calls `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo } })` once with `emailRedirectTo` derived from `?next=`.
- [ ] Each OAuth button click calls `supabase.auth.signInWithOAuth({ provider, options: { redirectTo } })` with the correct `provider` (`google` / `apple` / `discord`).
- [ ] `/auth/callback?code=…` calls `supabase.auth.exchangeCodeForSession(code)` and redirects to the `?next=` target on success (defaulting to `/`).
- [ ] `/auth/callback` with `?error_description=…` and no code renders the error message and a "Try again" link to `/auth/sign-in`.
- [ ] `/auth/sign-out` calls `supabase.auth.signOut()` exactly once and redirects to `/`.
- [ ] Middleware: a request to `/collection/foo` without a `sb-*-auth-token` cookie returns a 307 to `/auth/sign-in?next=%2Fcollection%2Ffoo`.
- [ ] Middleware: a request to `/collection/foo` WITH a `sb-*-auth-token` cookie passes through (no redirect).
- [ ] Middleware: a request to `/` (non-protected) passes through.
- [ ] `safeNext` rejects external URLs (`http://evil.com`, `//evil.com`) and falls back to `/`.
- [ ] `<ProtectedRoute>` renders its `fallback` while `loading === true`, redirects via `router.replace` when `loading === false && session === null`, and renders children when authenticated.
- [ ] `pnpm --filter @binderly/web build` succeeds with `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` UNSET — no module-evaluation Supabase calls anywhere new.
- [ ] All tests live under `apps/web/{app,lib}/**/*.test.ts(x)` and pass under `pnpm --filter @binderly/web test`.
- [ ] No edits outside the authorized list (see § Branch & PR).

## Out of scope

- Email/password sign-in form (Supabase project ships with magic-link as the email primary; password is intentionally absent until a clear product reason emerges).
- Session refresh / cookie-based SSR auth via `@supabase/ssr` (the middleware does cookie sniffing, not JWT verification — definitive gating is client-side; SSR auth is a future task if needed).
- Server-side auth API routes; everything here is client-side via the Supabase JS singleton.
- Any change to `<AuthProvider>` (W-SHELL owns the existing pattern).
- Any change to `apps/mobile/` (T-M-AUTH sibling).

## Branch & PR

- Branch: `agent/T-W-AUTH`
- PR title: `feat(web): T-W-AUTH — Web auth pages and session handling`
  - (Note: the literal `T-W-AUTH: …` form fails the pr-title check; the regex requires a 2-letter scope, but `T-W-AUTH` has only one. The orchestrator's pr-title check accepts the conventional `feat(web):` prefix.)
- Commit format: Conventional Commits.
- Authorized out-of-`owns_paths` edits (mention each in the PR body):
  - `apps/web/middleware.ts`
  - `apps/web/.env.example`
  - `pnpm-lock.yaml` (if any new deps; none expected)
  - `dependencies.yaml` (status flip)
  - `tasks/04-web/T-W-AUTH.md` (this elaboration)

## Escalation triggers

Stop and write to `open-questions.md` if:

- OAuth provider client-ID configuration would need to live in this app's env (Supabase manages providers — confirm before adding env keys).
- The `auth` resource on `@binderly/api-client` is missing a flow needed here.
- `next build` fails without env vars even after the lazy-init pattern is applied (escalate; do not paper over with CI env vars).

## Notes from execution

_(populated by the sub-agent at the end of execution)_
