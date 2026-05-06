# T-M-AUTH — Mobile auth flows (Google, Apple, Discord, magic link)

**Stage:** 05-mobile
**Agent role:** frontend-mobile
**Effort:** M
**Status:** in_progress

## Hard dependencies

- T-M-SHELL (the Expo Router shell, `<AuthProvider>`, the
  `expo-secure-store`-backed Supabase JS client, env loader)
- T-BE-AUTH (the `@binderly/auth` server helpers and Supabase
  Auth project configuration)

## Soft dependencies

- Parallel-safe with T-M-BROWSE (orthogonal directories).
- Sibling task **T-W-AUTH** owns the equivalent surface on web
  (`apps/web/app/auth/`, `apps/web/lib/auth/`).

## Required reading

- `tasks/05-mobile/T-M-AUTH.md` (this file)
- `apps/mobile/app/auth/sign-in.tsx`, `apps/mobile/app/auth/callback.tsx`,
  `apps/mobile/app/auth/_layout.tsx` (Expo Router placeholders from M-SHELL)
- `apps/mobile/src/components/providers/AuthProvider.tsx` (existing
  context — the lazy-init pattern is the model for any new client-side init)
- `apps/mobile/src/lib/supabase-mobile.ts` and
  `apps/mobile/src/lib/secure-storage.ts` (singleton + storage adapter)
- `apps/mobile/app.json` (`binderly://` deep-link scheme)
- `packages/auth/src/index.ts` + `packages/auth/README.md` (server-side
  contract; JWT shape)
- `packages/api-client/src/resources/auth.ts` (interactive sign-in
  delegates to Supabase JS via `supabaseAuth`)

## Goal

Replace the placeholder `app/auth/sign-in.tsx` and
`app/auth/callback.tsx` routes with real, ship-quality mobile auth
flows. Users can sign in via magic link (email-OTP) or one of three
OAuth providers (Apple, Google, Discord). The `<AuthProvider>` from
M-SHELL already owns the live session subscription and the
secure-store-backed Supabase JS client — this task wires the user-facing
side: input, the OAuth round-trip via `expo-auth-session` +
`expo-web-browser`, the deep-link callback handler, and a small
`<ProtectedScreen>` helper feature tasks downstream use to gate routes.

## Deliverables

- `apps/mobile/src/lib/auth/oauth.ts` — thin wrapper around
  `expo-auth-session` / `expo-web-browser` for OAuth provider sign-in.
  Exports `getOAuthRedirectUrl()`, `signInWithOAuthProvider(supabase, provider)`,
  and the `OAuthProvider` literal-union type.
- `apps/mobile/src/lib/auth/apple.ts` — Apple Sign-In wrapper around
  `expo-apple-authentication`. Exports `isAppleAuthAvailable()` and
  `signInWithApple(supabase)`. Falls back to the OAuth round-trip on
  Android / web.
- `apps/mobile/src/lib/auth/protected-screen.tsx` — `<ProtectedScreen>`
  component + `useRequireAuth()` hook. Redirects to `/auth/sign-in`
  when no session and rendering is otherwise unblocked.
- `apps/mobile/src/lib/auth/index.ts` — barrel export.
- `apps/mobile/src/screens/auth/SignInScreen.tsx` — real sign-in UI
  built from `@binderly/ui` primitives. Email + magic-link path,
  Apple / Google / Discord buttons, in-flight + error states.
- `apps/mobile/src/screens/auth/CallbackScreen.tsx` — deep-link
  callback handler. Reads the `code` query param off the URL,
  calls `supabase.auth.exchangeCodeForSession(code)`, navigates to
  `/(tabs)` on success, surfaces an error on failure.
- `apps/mobile/src/screens/auth/index.ts` — barrel export.
- `apps/mobile/app/auth/sign-in.tsx`, `apps/mobile/app/auth/callback.tsx`
  — re-pointed to import from `src/screens/auth/`.
- `apps/mobile/app.json` — registers `expo-apple-authentication` plugin
  + `usesAppleSignIn: true` for the iOS bundle.
- `apps/mobile/.env.example` — documents the optional
  `EXPO_PUBLIC_OAUTH_REDIRECT_URL` override.
- New deps: `expo-auth-session`, `expo-web-browser`,
  `expo-apple-authentication` (SDK 52 compatible). Lockfile bumps.
- Tests at `apps/mobile/src/screens/auth/*.test.tsx` and
  `apps/mobile/src/lib/auth/*.test.{ts,tsx}` covering render, form
  validation, OAuth click-through, callback exchange, and protected-screen
  redirect.

## Acceptance criteria

- [ ] `<SignInScreen>` renders the email field, the magic-link button,
      and three OAuth buttons (Apple, Google, Discord).
- [ ] Email input rejects empty / malformed addresses; the magic-link
      button is disabled until a syntactically valid email is entered.
- [ ] Tapping a provider button calls `supabase.auth.signInWithOAuth`
      with that provider and the `binderly://auth/callback` redirect.
- [ ] `<CallbackScreen>` reads the `code` param from the URL and
      calls `supabase.auth.exchangeCodeForSession(code)` on mount;
      success navigates to `/(tabs)`, failure surfaces a user-readable
      error message.
- [ ] `<ProtectedScreen>` redirects to `/auth/sign-in` when
      `useAuth().session === null` and `loading === false`.
- [ ] No Supabase / SecureStore call happens at module-evaluation or
      first-render time (lazy-init mirrors `<AuthProvider>`).
- [ ] All tests live alongside their source files and pass under
      `pnpm --filter @binderly/mobile test`.
- [ ] No edits outside the authorized list (see Out of scope).

## Out of scope

- Server-side OAuth provider configuration (client IDs, redirect URIs,
  Apple Developer entitlements). Documented in `open-questions.md` if
  Pablo's input is required.
- Profile screen / sign-out UI (lives in `apps/mobile/src/screens/ProfileScreen.tsx`,
  owned by a follow-up task).
- Tab gating beyond `<ProtectedScreen>` exposure (a follow-up task may
  wrap individual tabs / stacks).
- Web auth (T-W-AUTH owns it).
- Any change to `<AuthProvider>` (M-SHELL owns it; extend via
  composition or escalate).

## Authorized out-of-`owns_paths` edits

These are explicitly green-lit by the dispatch brief:

- `apps/mobile/app/auth/sign-in.tsx` and `apps/mobile/app/auth/callback.tsx`
  (Expo Router route shells from M-SHELL — repointed to the new
  screen components).
- `apps/mobile/app.json` (Apple Sign-In iOS plugin entry +
  `usesAppleSignIn` flag).
- `apps/mobile/.env.example` (new optional env keys).
- `apps/mobile/package.json` and `pnpm-lock.yaml` (new deps).
- `dependencies.yaml` (status flip on completion).
- `tasks/05-mobile/T-M-AUTH.md` (this elaboration).

## Branch & PR

- Branch: `agent/T-M-AUTH`
- PR title: `feat(mobile): T-M-AUTH — Mobile auth flows (Google, Apple, Discord, magic link)`
  (the regex on the pr-title check requires a 2-letter task scope;
  T-M-AUTH only has one, so the literal `T-M-AUTH: ...` prefix fails.
  Conventional Commits prefix in the title satisfies the gate.)
- Commit format: Conventional Commits.

## Escalation triggers

Stop and append to `open-questions.md` if:

- OAuth provider configuration (client IDs / redirect URIs) is not
  present in the Supabase project — propose defaults but flag.
- Apple Sign-In requires native config Pablo hasn't decided on yet
  (Apple Developer team, entitlements). The JS surface ships with a
  reasonable default; flag the native side.
- The `packages/api-client/src/resources/auth.ts` contract is missing
  a flow this task needs — flag, do not extend the contract here.
- A required Expo SDK API is unstable in SDK 52.

## Notes from execution

_(Sub-agent appends after running.)_
