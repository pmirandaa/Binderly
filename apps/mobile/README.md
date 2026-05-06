# `@binderly/mobile`

Binderly's Expo / React Native app. Hosts the entire mobile
product surface — Browse, Collection, Scan, Grading, Profile.
Every other mobile task plugs into this shell.

## What this workspace is

- **The shell**: file-based navigation (`expo-router`), the provider
  tree, env loading, secure-storage scaffolding, the singleton
  Binderly API client, error / loading boundaries.
- **Cross-platform**: iOS + Android via Expo SDK 55, React Native
  0.85, React 19. UI primitives come exclusively from
  [`@binderly/ui`](../../packages/ui/) — no raw RN imports for
  visual surfaces.
- **Managed workflow today**, dev-clients tomorrow. Camera and
  on-device ML modules (vision-camera, fast-tflite) ship in
  later tasks (`T-SC-CAMERA`, `T-SC-EMBED-MODEL`); they require
  EAS Dev Clients but the _shell_ itself does not.

## What this workspace is **not**

- **Not a feature implementation.** Browse, Collection, Scan,
  Grading, Auth flows are placeholders. Their owning tasks
  (T-M-BROWSE, T-M-COLLECTION, T-SC-CAMERA, T-GR-CAPTURE-FLOW,
  T-M-AUTH) replace the placeholder screens in their own PRs.
- **Not the offline / sync layer.** SQLite + sync engine ship in
  stage 9 (T-OF-LOCAL-DB and friends). The shell only guards
  TanStack Query with `networkMode: 'offlineFirst'` so feature
  tasks land cleanly later.
- **Not a Sentry / PostHog wiring.** The error boundary exposes
  an `onError` seam; observability hookup is its own task.

## Quickstart

```bash
# from the monorepo root
pnpm install

# copy the per-workspace env template and fill in real values
cp apps/mobile/.env.example apps/mobile/.env.local

# start the bundler (Metro)
pnpm --filter @binderly/mobile start
```

For a real device or simulator run, install the Expo Dev Client
build (the camera + ML stages later require it; the shell builds
cleanly under Expo Go too):

```bash
pnpm --filter @binderly/mobile ios       # iOS simulator
pnpm --filter @binderly/mobile android   # Android emulator
```

Or scan the QR code with Expo Go for the shell-only target.

## Package gates

```bash
pnpm --filter @binderly/mobile format:check
pnpm --filter @binderly/mobile lint
pnpm --filter @binderly/mobile typecheck
pnpm --filter @binderly/mobile test
pnpm --filter @binderly/mobile build
```

`build` runs `tsc -p . --noEmit` rather than `expo export` or
`eas build`. Reasoning:

- **EAS Build is remote**, requires Apple/Google credentials, and
  is too heavy for CI.
- **`expo export --platform web`** would force a parallel Tamagui
  web compile that's already exercised by `apps/web` (T-W-SHELL).

Production binaries are produced via `eas build` invoked manually
or from `T-DP-EAS` — not from `pnpm -w build`.

## Required env (`.env.local`)

Expo's bundler ONLY inlines vars prefixed with `EXPO_PUBLIC_*` into
the JS bundle at build time. The shell standardises on that prefix
even though the cross-repo convention
(`context/secrets-and-env.md`) uses `<SCOPE>_<SERVICE>_<NAME>`
elsewhere. Both can coexist in `.env.local`.

| Required? | Var                             | Source                                                                       |
| --------- | ------------------------------- | ---------------------------------------------------------------------------- |
| ✓         | `EXPO_PUBLIC_SUPABASE_URL`      | Supabase project URL — `https://<ref>.supabase.co` or local CLI              |
| ✓         | `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (public-by-design)                                         |
|           | `EXPO_PUBLIC_API_URL`           | Override for the Binderly backend base URL when it differs from Supabase URL |

Missing required keys throw a `MobileEnvError` on first import,
caught by `<EnvGate>` in `app/_layout.tsx` and rendered as a
deterministic configuration-error screen.

## Provider tree

`app/_layout.tsx` mounts the providers in this order:

```
<ThemeOverrideProvider>            ← reads useColorScheme + secure-store override
  <ErrorBoundary>                  ← surfaces ApiError subclasses with friendly copy
    <EnvGate>                      ← validates EXPO_PUBLIC_* keys, fails fast
      <SafeAreaProvider>
        <SupabaseAndApiClientProvider>  ← builds singletons once per env
          <AuthProvider>           ← supabase.auth.onAuthStateChange listener
            <QueryProvider>        ← TanStack Query + NetInfo bridge
              <ApiClientProvider>  ← context wrapper around the BinderlyClient singleton
                <Stack/>           ← expo-router root stack
```

Each provider exposes a typed hook downstream feature tasks
program against:

- `useAuth(): { session, user, loading, signOut }`
- `useApiClient(): BinderlyClient`
- `useThemeOverride(): { override, resolved, hydrating, setOverride }`
- `useQueryClient()` from `@tanstack/react-query`

## Navigation tree

```
app/
├── _layout.tsx           Root layout (provider tree above)
├── +not-found.tsx        404 with a "Go home" CTA
├── (tabs)/
│   ├── _layout.tsx       Bottom-tab navigator (5 tabs)
│   ├── browse.tsx        ← T-M-BROWSE
│   ├── collection.tsx    ← T-M-COLLECTION
│   ├── scanner.tsx       ← T-SC-CAMERA (visually centered)
│   ├── grading.tsx       ← T-GR-CAPTURE-FLOW
│   └── profile.tsx       ← T-M-AUTH (settings / account / theme override)
└── auth/
    ├── _layout.tsx       Modal stack
    ├── sign-in.tsx       ← T-M-AUTH
    └── callback.tsx      ← T-M-AUTH (OAuth + magic-link callbacks land here)
```

Deep linking is registered for the `binderly://` scheme; the
auth callback resolves to `binderly://auth/callback`.

## Secure storage

JWTs are sensitive — never persist them via AsyncStorage. The shell
wraps `expo-secure-store` (iOS Keychain / Android Keystore) and
exposes:

- `getSecureStorage().getItem|setItem|removeItem` — typed KV with a
  registered keyspace under `binderly.*`.
- `supabaseSecureStoreAdapter` — the Supabase JS SDK's storage
  adapter shape; wired into `createSupabaseMobileClient(env)` so
  the SDK persists the active session in the Keychain.

Today's keyspace (one-line addition per new key):

| Key                         | Purpose                                                       |
| --------------------------- | ------------------------------------------------------------- |
| `binderly.theme.override`   | User-chosen theme override (`'light' \| 'dark' \| 'system'`). |
| `binderly.supabase.session` | Supabase JS session payload (managed by the SDK).             |

## Theme strategy

`<ThemeOverrideProvider>` resolves `'system'` against
`useColorScheme()` and persists explicit `'light'` / `'dark'` /
`'system'` choices to secure-storage. The provider re-renders
`<UIProvider defaultTheme={resolved}>` when the resolved theme
changes; settings UI calls `setOverride(...)` to update.

## Test posture

- Vitest + jsdom + `@testing-library/react`. Same posture as
  `@binderly/ui` — Tamagui forks at compile time and routes to
  its web-friendly variants under jsdom.
- `expo-secure-store`, `expo-router`, `expo-linking`,
  `expo-image`, `expo-constants`, `react-native`,
  `@react-native-community/netinfo` are mocked in
  `src/test-utils/setup.ts`. Tests target the **shell contract**,
  not real-device behaviour.
- Coverage is intentionally narrow: env loader, secure-storage
  wrapper, supabase + api-client singletons, auth + query +
  theme-override providers, error/loading primitives, every
  placeholder screen, and the root layout's composition.

## Authorized out-of-`owns_paths` edits

Per `tasks/05-mobile/T-M-SHELL.md`:

- `pnpm-lock.yaml` (regenerated; new app workspace + Expo / RN /
  TanStack Query / Supabase JS / secure-store deps).
- `pnpm-workspace.yaml` (verify `apps/*` is included; no edit
  needed in this iteration).
- `dependencies.yaml` (status flip `pending → review`, set
  `stub: false`).
- `tasks/05-mobile/T-M-SHELL.md` (full elaboration; previous
  commit).

Nothing else is touched.

## See also

- [`packages/ui/README.md`](../../packages/ui/README.md) — the UI
  primitive surface this app renders.
- [`packages/api-client/README.md`](../../packages/api-client/README.md)
  — the typed HTTP client the shell singleton wraps.
- [`tasks/05-mobile/T-M-SHELL.md`](../../tasks/05-mobile/T-M-SHELL.md)
  — the elaborated task spec.
- [`rules/05-mobile.md`](../../rules/05-mobile.md) — stage rules.
