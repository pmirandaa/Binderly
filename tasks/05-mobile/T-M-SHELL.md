# T-M-SHELL — Expo app shell — navigation, providers, theme, secure storage

**Stage:** 05-mobile
**Agent role:** frontend-mobile
**Effort:** M (~half day)
**Status:** in_progress

---

## Hard dependencies

- **T-SP-UI-TOKENS** (merged) — `@binderly/ui` ships the Tamagui
  config, the `<UIProvider>`, and every cross-platform primitive
  (`Box`, `Stack`, `Text`, `Pressable`, `Button`, `Card`, `Input`,
  `Spinner`, `Icon`). The mobile shell hard-imports the provider
  and uses primitives exclusively (per `rules/05-mobile.md`: no
  raw RN primitives).
- **T-BE-API-CLIENT** (merged) — `@binderly/api-client` ships
  `createClient(config)`, the `BinderlyClient` typed surface, the
  `ApiError` taxonomy, and `loadClientEnv()`. The mobile shell
  builds a singleton client instance wired to the env URL +
  anon key + a `getJwt` callback that reads the live Supabase JS
  session.

## Soft dependencies / parallel siblings

- **T-W-SHELL** (parallel sibling, in flight, owns `apps/web/`).
  Orthogonal at the directory level — only `pnpm-lock.yaml`
  contends at merge time, resolved by the orchestrator. Shell
  decisions are kept consistent (provider tree shape, env-loader
  fail-fast posture, error/loading boundary surfaces) so future
  feature tasks read the same mental model on both apps.
- **T-M-AUTH** / **T-M-BROWSE** / **T-M-COLLECTION** /
  **T-SC-CAMERA** / **T-SC-* / T-OF-*** (downstream, not yet
  started). Every one of these plugs into the shell defined here
  (placeholder tab screens, placeholder auth routes, the
  `AuthProvider` context shape, the `BinderlyClient` singleton).
  Shell does **not** ship feature behaviour — it ships the
  scaffolding the feature tasks render into.

## Required reading

- `PROJECT.md` § 2 (Brand & Legal — naming, IP posture, the
  attribution string), § 3 (Tech Stack — Expo SDK / RN / Tamagui /
  expo-router / TanStack Query, the cross-platform bet),
  § 5 (Auth & Accounts), § 10 (Core App Features — IA the tabs
  mirror), § 11 (Scanner overview — the shell only reserves the
  route + permission scaffolding), § 15 (Offline — the shell only
  reserves the sync surface; T-OF-LOCAL-DB owns persistence),
  § 18 (Tamagui-maturity escalation valve).
- `rules/05-mobile.md` — stage rules. Hard rules that bind this
  task: (a) Tamagui / `@binderly/ui` only, never raw RN
  primitives for design surfaces; (b) navigation via expo-router;
  (c) bottom-tab structure is **Browse, Collection, Scan,
  Grading, Profile** (5 tabs, with Scan visually centered when
  feature tabs ship); (d) async storage is minimal, persistence
  routes through SQLite/MMKV in stage 09 — secure-store handles
  JWTs and the small list of preferences the shell legitimately
  needs to keep encrypted at rest; (e) `expo-image` for image
  rendering; (f) iOS + Android parity mandatory.
- `context/conventions.md` — TS strict, named exports, kebab-case
  files, PascalCase components, error-shape contract, test
  posture (vitest for TS-only, Jest+RNTL for mobile component
  trees deferred to feature tasks).
- `context/tech-stack.md` § Mobile app — pinned defaults this
  shell binds (Expo SDK, expo-router, expo-image, Tamagui).
- `context/secrets-and-env.md` — env-var naming convention.
  Documented deviation: Expo's bundler only inlines vars
  prefixed with `EXPO_PUBLIC_*`, so the mobile workspace reads
  `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`
  / `EXPO_PUBLIC_API_URL`. The root `.env.example` continues to
  declare the canonical `MOBILE_*` triple; mapping between the
  two is a deploy-time concern (`.env.local` ships both).
- `packages/ui/README.md` and `packages/ui/src/index.ts` — the
  primitives this shell renders.
- `packages/api-client/README.md`, `packages/api-client/src/index.ts`,
  `packages/api-client/src/client.ts`, `packages/api-client/src/env.ts` —
  the construction shape the shell wires.
- `packages/auth/README.md` and `packages/auth/src/index.ts` —
  noted as **server-side only**. The mobile auth provider does
  NOT import from `@binderly/auth`; it talks to `@supabase/supabase-js`
  directly with `expo-secure-store` as the storage adapter.
- `packages/api-contracts/README.md` — confirm the public surface
  the api-client exposes (no direct import in this task).
- `tasks/03-shared-packages/T-SP-UI-TOKENS.md`,
  `tasks/02-backend/T-BE-API-CLIENT.md` — sibling pattern
  reference (file layout, README posture, package.json shape).

## Goal

Stand up `apps/mobile` — the Expo / React Native shell that hosts
the entire mobile product. The shell is the skeleton every
mobile feature task plugs into: file-based navigation
(`expo-router`) with the canonical 5-tab structure, the provider
tree (`<UIProvider>` → `<AuthProvider>` → `<QueryProvider>` →
error/loading boundary), a typed env loader that fails fast on
missing keys, a secure-storage wrapper around `expo-secure-store`
for JWTs and the handful of preferences that need encrypted
persistence, a singleton `BinderlyClient` wired to the env URL +
a `getJwt` callback that reads the live Supabase session, and a
deep-link scheme registered for OAuth/magic-link callbacks
(`binderly://auth/callback`). Light + dark themes ship from day
one (`useColorScheme()` with a manual override persisted to
secure-store). The shell does not implement any feature
behaviour — placeholder tab screens render `Text` from
`@binderly/ui` so feature tasks (T-M-AUTH, T-M-BROWSE,
T-M-COLLECTION, T-SC-CAMERA, T-OF-*) can land later in their own
PRs.

## Design

### Framework choices (defaults; deviations called out)

- **Expo SDK 54+** with the **managed workflow**. The stage
  rules call out development builds (vision-camera + fast-tflite
  need native modules), but for this *shell* task the managed
  workflow is sufficient — no native modules are introduced
  here. Camera and ML modules come in their own tasks
  (T-SC-CAMERA / T-SC-EMBED-MODEL). The shell's deps list keeps
  the managed-workflow surface so EAS dev clients can build
  cleanly later without re-jigging here.
- **React Native 0.81+** (matches Expo SDK 54).
- **expo-router 6+** for file-based navigation. Mirrors the
  Next.js App Router pattern T-W-SHELL uses, lowering the
  cross-team mental-model cost.
- **TypeScript strict** (extends `@binderly/tsconfig/react-native`).
- **TanStack Query 5+** for client-side data fetching layered on
  top of the api-client. Network-mode awareness (`onlineManager` +
  `@react-native-community/netinfo`) is wired so queries pause
  when offline.
- **expo-secure-store** for JWTs and the explicit short list of
  preferences that need to survive an app reinstall while
  encrypted at rest. **NEVER AsyncStorage** for tokens (per the
  task brief and the stage rules' "async storage minimal"
  posture).
- **`@binderly/ui` Tamagui** with the iter-13 `core+input`
  setup. We do NOT install the umbrella `tamagui` package —
  matches the package's hard decision (escalate via
  `open-questions.md` if a primitive needs umbrella-only deps
  rather than swapping silently).
- **vitest + jsdom** for shell-contract tests. Component tests
  that need a real RN renderer (e.g. proper `useColorScheme`
  behaviour) are deferred to feature tasks where they're
  necessary; the shell contract is verifiable at the
  composition / pure-function level.

### Navigation tree

```
app/
├── _layout.tsx                  # Root: env validation gate, provider tree, error boundary
├── +not-found.tsx               # 404
├── (tabs)/
│   ├── _layout.tsx              # Bottom-tab navigator (5 tabs)
│   ├── browse.tsx               # Browse — placeholder (T-M-BROWSE fills)
│   ├── collection.tsx           # Collection home — placeholder (T-M-COLLECTION fills)
│   ├── scanner.tsx              # Scan (visually centered) — placeholder (T-SC-* fills)
│   ├── grading.tsx              # Grading — placeholder (T-GR-* fills)
│   └── profile.tsx              # Profile — placeholder (T-M-AUTH / future profile task)
└── auth/
    ├── _layout.tsx              # Stack: sign-in flow
    ├── sign-in.tsx              # Placeholder (T-M-AUTH fills)
    └── callback.tsx             # OAuth / magic-link callback (T-M-AUTH fills)
```

The 5-tab structure follows `rules/05-mobile.md` (Browse,
Collection, Scan, Grading, Profile). The user-facing brief
listed only 4 tab screens; the stage rules win — the
brief-omitted Grading tab is added with a placeholder so
`T-GR-CAPTURE-FLOW` plugs straight in.

### Provider tree (root layout)

```
<EnvGate>                              # validates env, renders error UI if missing
  <ErrorBoundary>                      # surfaces ApiError + ApiNetworkError friendly messages
    <UIProvider defaultTheme={resolved}>
      <SafeAreaProvider>
        <AuthProvider>                 # wraps Supabase JS auth state
          <QueryProvider>              # TanStack Query w/ NetInfo + secure-store cache
            <ThemeOverrideProvider>    # syncs override + system preference into UIProvider
              <Stack/>                 # expo-router root stack
            </ThemeOverrideProvider>
          </QueryProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </UIProvider>
  </ErrorBoundary>
</EnvGate>
```

Decisions baked into this tree:

- **Env validation is the outermost gate.** A missing
  `EXPO_PUBLIC_SUPABASE_URL` (etc.) renders a deterministic
  error screen instead of crashing the JS bundle; production
  builds catch missing config at install time, not at
  feature-time.
- **`<ErrorBoundary>`** sits *outside* `<UIProvider>` so the
  fallback tree can render even if Tamagui itself blew up.
  Secondary inner boundaries can be added per-feature later.
- **`<UIProvider>`** is the Tamagui mount point; `defaultTheme`
  is the resolved theme name (override → system → `'light'`).
- **`<AuthProvider>`** owns the Supabase JS auth state subscription
  (`supabase.auth.onAuthStateChange`) and exposes a typed
  `useAuth()` hook returning `{ session, user, loading, signOut }`.
  No actual sign-in UI lives here — `T-M-AUTH` adds it. The
  provider's contract is what feature tasks code against.
- **`<QueryProvider>`** wraps TanStack Query's `<QueryClientProvider>`
  with RN-friendly defaults (`networkMode: 'offlineFirst'`),
  wires `@react-native-community/netinfo` into TanStack
  Query's `onlineManager`, and exposes the singleton
  `QueryClient`.
- **`<ThemeOverrideProvider>`** owns the `light | dark | system`
  preference, listens for `useColorScheme()` changes, persists
  the user's manual override to secure-store, and re-renders
  `<UIProvider defaultTheme>` when the resolved theme changes.

### Env handling

`apps/mobile/src/lib/env.ts` exposes `loadMobileEnv(source?)`,
which reads:

| Required | Var | Purpose |
| -------- | --- | ------- |
| ✓ | `EXPO_PUBLIC_SUPABASE_URL` | Base URL for the Binderly backend (passed to `createClient` + Supabase JS) |
| ✓ | `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Public anon key |
| optional | `EXPO_PUBLIC_API_URL` | Override for the Binderly backend base URL when it diverges from Supabase URL (e.g. Cloudflare worker reverse-proxy) |

Missing required keys throw a clear `MobileEnvError` listing
every missing var. The loader is invoked at module scope of
`api-client.ts` and `supabase-mobile.ts` (singletons) and
short-circuited inside `EnvGate` so a missing key renders a
graceful screen instead of aborting the JS bundle.

We deliberately do NOT consume `loadClientEnv()` from
`@binderly/api-client` here: that loader keys on
`SUPABASE_URL` / `SUPABASE_ANON_KEY` (no `EXPO_PUBLIC_` prefix),
which Expo's bundler does NOT inline into the JS bundle. The
mobile env loader is a thin Expo-specific wrapper that emits
the same `ClientEnv` shape (`{ baseUrl, apiKey }`) for
`createClient(...)`.

### Secure-storage strategy

`apps/mobile/src/lib/secure-storage.ts` wraps `expo-secure-store`
with a typed key registry:

```ts
type SecureStorageKey =
  | 'binderly.theme.override'        // 'light' | 'dark' | 'system'
  | 'binderly.supabase.session';     // serialized Supabase session (JWT + refresh token)
```

The wrapper:

- Round-trips strings via `getItem` / `setItem` / `removeItem`.
- Never logs values.
- On native, uses `expo-secure-store` (Keychain / Keystore).
- On web (e.g. Tamagui's web fork during testing), falls back
  to an in-memory map so the same code typechecks under jsdom.
  The web fallback is **not** part of the production surface;
  the mobile build never uses it.

The Supabase JS client receives a `SecureStorageAdapter` matching
`@supabase/supabase-js`'s `SupportedStorage` interface, so the
Supabase session is encrypted at rest. JWTs are NEVER persisted
via AsyncStorage anywhere in the codebase.

### API-client singleton

`apps/mobile/src/lib/api-client.ts` exports a single
`createBinderlyClient(env, supabase)` factory called once at
module load. The `getJwt` callback reads the live Supabase
session synchronously (Supabase JS caches the active session
in memory; secure-store handles persistence on first hydrate).
Refreshes are handled by the Supabase SDK; the api-client just
re-reads the cached value at call time.

```ts
export function createBinderlyClient(
  env: MobileEnv,
  supabase: SupabaseClient,
): BinderlyClient {
  return createClient({
    baseUrl: env.apiBaseUrl ?? env.supabaseUrl,
    apiKey: env.supabaseAnonKey,
    getJwt: async () => {
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token ?? null;
    },
    supabaseAuth: supabase,
  });
}
```

A React context (`<ApiClientProvider>` inside
`AuthProvider`) exposes the singleton via `useApiClient()` so
feature code never reaches into a global module.

### Build pipeline

| Step | Command | Notes |
| ---- | ------- | ----- |
| Format | `pnpm --filter @binderly/mobile format:write` | matches sibling |
| Lint | `pnpm --filter @binderly/mobile lint` | flat config extending `@binderly/eslint-config/react-native` |
| Typecheck | `pnpm --filter @binderly/mobile typecheck` | `tsc --noEmit` |
| Test | `pnpm --filter @binderly/mobile test` | vitest, jsdom env |
| Build | `pnpm --filter @binderly/mobile build` | `tsc --noEmit` (alias of typecheck) — see escalation below |

The `build` script intentionally runs `tsc --noEmit` rather
than `expo export` or a full native EAS build. EAS Build is
remote, requires Apple/Google credentials, and is too heavy
for CI; `expo export --platform web` would force a Tamagui web
compile inside the mobile workspace which double-bundles
work that's already covered by `apps/web` (T-W-SHELL). The
typecheck-as-build choice is documented in
`apps/mobile/README.md`. Mobile binaries are still produced
via `eas build` invoked manually / from `T-DP-EAS` — not from
`pnpm -w build`.

### Testing strategy

Test posture for the shell **contract**, not feature coverage:

| Surface | Test |
| ------- | ---- |
| Env loader | Round-trips a fully-populated source; throws `MobileEnvError` listing every missing required key; strips trailing slashes from URLs. |
| Secure-storage wrapper | Round-trips `{ getItem, setItem, removeItem }` against an in-memory mock of `expo-secure-store`; clearing a missing key is a no-op; non-string values rejected at the type boundary. |
| API-client factory | Builds a `BinderlyClient` whose `http.request` resolves with the env URL + anon key in headers; `getJwt` callback reads the supplied Supabase session. |
| Auth provider | Renders children; exposes `{ session, user, loading, signOut }`; subscribes to `supabase.auth.onAuthStateChange` and re-renders on a SIGNED_IN / SIGNED_OUT event. |
| Theme override | Resolves `'system'` against `useColorScheme()`; persists `'dark'` to secure-storage and reads it back on a fresh mount. |
| Provider tree | Mounts `<RootLayout>` against an in-memory env + Supabase mock without throwing. |
| Tab routes | Each placeholder route's exported component renders without throwing under `<UIProvider>`. |
| 404 / sign-in / callback | Smoke-render. |
| Error boundary | Renders the friendly fallback when a child throws an `ApiError`; the fallback exposes a typed retry callback. |
| Loading primitives | `<PageLoading>` and `<Skeleton>` snapshot a stable token-driven output. |

Target ~50–100 test cases; **no padding** — the shell contract
is small.

### Out-of-`owns_paths` edits (pre-authorized)

- `pnpm-lock.yaml` — new workspace + Expo / RN / TanStack Query /
  Supabase JS / secure-store deps.
- `pnpm-workspace.yaml` — already includes `apps/*`; verified in
  PR.
- `dependencies.yaml` — flip `T-M-SHELL` `status: pending →
  status: review`, set `stub: false`. Single line edit, one
  commit, justified in PR body.
- `tasks/05-mobile/T-M-SHELL.md` — this elaboration. Single
  commit, before any code.

Nothing else. The orchestrator will resolve the `pnpm-lock.yaml`
contention with T-W-SHELL at merge time.

## Deliverables

- `apps/mobile/package.json` — workspace `@binderly/mobile`
  (private; not published).
- `apps/mobile/app.json` — Expo config (name, slug, ios bundle
  id, android package, splash placeholder, icon placeholder,
  scheme `binderly` for deep linking + auth callbacks).
- `apps/mobile/babel.config.js` — Expo babel preset (Tamagui
  babel plugin not added in this task because the iter-13
  `core+input` setup runs at runtime; if perf forces the
  optimizing compiler in a follow-up task that's a code-shape
  change, not a shell-shape change).
- `apps/mobile/metro.config.js` — Expo metro config with the
  `unstable_enablePackageExports` flag set so pnpm workspace
  symlink resolution + `@binderly/*` ESM exports resolve
  cleanly under React Native.
- `apps/mobile/tsconfig.json` — extends
  `@binderly/tsconfig/react-native`.
- `apps/mobile/.env.example` — required `EXPO_PUBLIC_*` env
  keys with dev defaults wired to the local Supabase CLI.
- `apps/mobile/eslint.config.mjs` — flat config extending
  `@binderly/eslint-config/react-native`.
- `apps/mobile/vitest.config.ts` — vitest config (jsdom env).
- `apps/mobile/index.js` — Expo entry; registers
  `expo-router/entry`.
- `apps/mobile/app/_layout.tsx` — root layout with the
  full provider tree.
- `apps/mobile/app/(tabs)/_layout.tsx` — bottom-tab navigator
  with the 5 tab routes.
- `apps/mobile/app/(tabs)/{browse,collection,scanner,grading,profile}.tsx`
  — placeholder tab screens.
- `apps/mobile/app/auth/_layout.tsx`,
  `apps/mobile/app/auth/sign-in.tsx`,
  `apps/mobile/app/auth/callback.tsx` — placeholder auth routes.
- `apps/mobile/app/+not-found.tsx` — 404 with a "Go home" CTA.
- `apps/mobile/src/lib/env.ts` — typed env loader, fails fast on
  missing required keys.
- `apps/mobile/src/lib/secure-storage.ts` — typed
  expo-secure-store wrapper.
- `apps/mobile/src/lib/supabase-mobile.ts` — Supabase JS
  singleton wired with the secure-store adapter.
- `apps/mobile/src/lib/api-client.ts` — Binderly API client
  singleton factory + React context.
- `apps/mobile/src/components/providers/AuthProvider.tsx`,
  `QueryProvider.tsx`, `ThemeOverrideProvider.tsx`,
  `EnvGate.tsx`.
- `apps/mobile/src/components/error/ErrorBoundary.tsx`,
  `ErrorFallback.tsx`.
- `apps/mobile/src/components/loading/PageLoading.tsx`,
  `Skeleton.tsx`.
- `apps/mobile/src/components/test-utils/{render.tsx,setup.ts}` —
  shared test harness.
- `apps/mobile/README.md` — dev / build / test / env-key /
  provider-tree / navigation-tree / secure-storage docs.

## Acceptance criteria

- [ ] `pnpm --filter @binderly/mobile lint` passes with 0 warnings.
- [ ] `pnpm --filter @binderly/mobile typecheck` passes.
- [ ] `pnpm --filter @binderly/mobile test` passes; ~50–100 tests.
- [ ] `pnpm --filter @binderly/mobile build` passes (alias for
      typecheck — documented).
- [ ] `pnpm install` completes; `pnpm-lock.yaml` regenerates with
      Expo / RN / TanStack Query / Supabase JS / secure-store /
      NetInfo / lucide-react-native added.
- [ ] Env loader throws `MobileEnvError` listing every missing
      key; resolves valid sources.
- [ ] Secure-storage wrapper round-trips
      `{ getItem, setItem, removeItem }` against a mocked
      `expo-secure-store`.
- [ ] API-client singleton factory builds a typed
      `BinderlyClient` whose `getJwt` reads the supplied
      Supabase session.
- [ ] AuthProvider exposes the documented `{ session, user,
      loading, signOut }` shape and re-renders on
      SIGNED_IN / SIGNED_OUT.
- [ ] Theme override resolves `'system'` against
      `useColorScheme()` and persists `'dark'` / `'light'` to
      secure-storage.
- [ ] All five tab placeholder screens, the 404, and the two
      auth placeholder screens render under `<UIProvider>`
      without throwing.
- [ ] Error boundary renders the friendly fallback for an
      `ApiError` and exposes a `retry` callback.
- [ ] Provider tree composes (`<RootLayout>` mounts) without
      throwing in tests.
- [ ] Tests live at `apps/mobile/src/**/*.test.{ts,tsx}` and
      pass under vitest.
- [ ] No edits outside the authorized path list (above).
- [ ] PR title `T-M-SHELL: Expo app shell — navigation,
      providers, theme, secure storage`.
- [ ] PR body covers navigation structure, provider tree, env
      strategy, secure-storage choice, theme strategy, plus
      "Notes from execution" if anything non-obvious surfaced.

## Out of scope

- Real auth UI (T-M-AUTH).
- Real browse / set / card / collection screens (T-M-BROWSE,
  T-M-COLLECTION).
- Camera, ML, vision-camera, fast-tflite (T-SC-CAMERA,
  T-SC-EMBED-MODEL, T-SC-* and T-GR-*).
- Offline DB, sync engine, MMKV state (T-OF-LOCAL-DB and
  T-OF-* in stage 09).
- EAS Build profiles, app icon, splash assets, TestFlight /
  Play submission (T-DP-EAS).
- Sentry / PostHog wiring (T-OS-* and the observability
  stage).
- RevenueCat / Paddle / paywall (T-PB-*).
- Native module additions (vision-camera, mlkit). Managed-
  workflow only at this stage.

## Branch & PR

- Branch: `agent/T-M-SHELL`
- PR title: `T-M-SHELL: Expo app shell — navigation, providers,
  theme, secure storage`
- Commit format: Conventional Commits (`docs(tasks):
  elaborate T-M-SHELL`, `feat(mobile): scaffold app shell`,
  `test(mobile): cover env / secure-storage / providers`, etc.)

## Escalation triggers

Stop and surface to the orchestrator (via `open-questions.md`)
if any of the following surface:

- Tamagui + RN with the iter-13 `core+input` setup hits a
  blocker (e.g. a primitive needs a peer that's only in the
  umbrella `tamagui` package). Do **not** swap to the umbrella
  unilaterally.
- Expo SDK version conflict with React Native version that
  would force a sub-optimal pin. Flag with the proposed pin
  options.
- The IA from `PROJECT.md` § 10 / `rules/05-mobile.md` is
  ambiguous (e.g. tab list disagreement with web). Flag rather
  than guess.
- A backend contract gap surfaces (e.g. an endpoint the shell
  needs that doesn't exist in `@binderly/api-client` yet).
  Flag — do not extend a merged sibling package.
- Native code requirement surfaces for the *shell* (managed
  workflow target — anything that requires a custom native
  module is escalation territory).

## Notes from execution

(Sub-agent appends here at end. Empty until then.)
