# `@binderly/web`

Next.js 14+ App Router shell for Binderly. Hosts the entire web
product surface; downstream feature tasks (T-W-AUTH, T-W-BROWSE,
T-W-COLLECTION, T-W-CUSTOM, T-W-SHAREABLE-PUBLIC, T-PB-PADDLE,
T-W-AFFILIATE-LINKS) plug into the routes and providers this
package ships.

## Getting started

```bash
# from repo root
pnpm install

# dev server (hot reload)
pnpm --filter @binderly/web dev

# prod build
pnpm --filter @binderly/web build

# tests
pnpm --filter @binderly/web test

# lint / typecheck / format
pnpm --filter @binderly/web lint
pnpm --filter @binderly/web typecheck
pnpm --filter @binderly/web format:check
```

The dev server boots at `http://localhost:3000`. Copy
`.env.example` to `.env.local` to point at a different Supabase
project; the defaults target the local Supabase CLI stack
launched via `pnpm db:start` from the repo root.

## Env keys

| Key                              | Required | Default (dev)                    | Notes                          |
| -------------------------------- | -------- | -------------------------------- | ------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`       | yes      | `http://localhost:54321`         | Backend API base URL.          |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`  | yes      | demo key from local Supabase CLI | Public anon key.               |
| `NEXT_PUBLIC_R2_PUBLIC_BASE_URL` | no       | `http://localhost:9000/images`   | Catalog image CDN.             |
| `NEXT_PUBLIC_APP_URL`            | no       | `http://localhost:3000`          | Self URL (OG, auth redirects). |

`apps/web/lib/env.ts` fails fast at module load if any required
key is missing — the production build will refuse to compile a
binary that would 500 on first request.

## Provider tree

```
<html>
  <head>
    <style id="tamagui-css">{tamaguiConfig.getCSS()}</style>
    <script>{themeBootScript}</script>     // sets data-theme synchronously
  </head>
  <body>
    <UIProvider>                            // app-level: theme context + persistence
      <BinderlyUIProvider>                  // @binderly/ui: TamaguiProvider
        <QueryProvider>                     // TanStack Query
          <AuthProvider>                    // Supabase session listener
            <ErrorBoundary>{children}</ErrorBoundary>
          </AuthProvider>
        </QueryProvider>
      </BinderlyUIProvider>
    </UIProvider>
  </body>
</html>
```

- **`<UIProvider>`** (this app's wrapper) reads
  `localStorage['binderly:theme']`, falls back to
  `prefers-color-scheme`, and exposes a `useTheme()` hook with
  `{ theme, setTheme, toggleTheme }`. Toggles persist.
- **`<QueryProvider>`** mounts a TanStack QueryClient with sensible
  defaults (`staleTime: 30s`, `retry: 1`,
  `refetchOnWindowFocus: false`).
- **`<AuthProvider>`** subscribes to
  `supabase.auth.onAuthStateChange` and exposes `{ session, user,
loading, signOut }` via a `useAuth()` hook.
- **`<ErrorBoundary>`** catches uncaught errors, surfacing
  `ApiError` codes from `@binderly/api-client` with friendly
  messages.

## Route inventory

| Route                | Owner          | State            |
| -------------------- | -------------- | ---------------- |
| `/`                  | T-W-SHELL      | placeholder      |
| `/(tabs)/browse`     | T-W-BROWSE     | placeholder      |
| `/(tabs)/collection` | T-W-COLLECTION | placeholder      |
| `/(tabs)/scanner`    | T-W-SHELL      | mobile-only stub |
| `/(tabs)/profile`    | T-W-SHELL      | placeholder      |
| `/auth/sign-in`      | T-W-AUTH       | placeholder      |
| `/auth/callback`     | T-W-AUTH       | placeholder      |
| `/auth/sign-out`     | T-W-AUTH       | placeholder      |

Future feature tasks add: `/sets/*`, `/cards/*`, `/c/*` (public
shareables), `/billing/*`, `/api/paddle/*` per
`dependencies.yaml`.

## API access

All backend calls go through the `@binderly/api-client` singleton
in `lib/api-client.ts`. Direct `fetch` to backend resources from
app code is forbidden (per `rules/04-web.md`). The singleton:

- Reads base URL + anon key from `lib/env.ts`.
- Resolves the JWT via `supabase.auth.getSession()` — same
  Supabase JS instance the `<AuthProvider>` listens on.
- Tags requests with `x-binderly-app: web` so server logs can
  filter web vs mobile traffic.

## Tamagui + Next.js setup

We bind to `@tamagui/core` (via `@binderly/ui`) without the
`@tamagui/next-plugin`. The plugin ties to the Tamagui umbrella
package; iter 13 (T-SP-UI-TOKENS) chose `@tamagui/core` only to
keep the shared graph lean. SSR styles arrive via
`tamaguiConfig.getCSS()` in `<head>` (see `app/layout.tsx`); the
runtime sheet handles client-side updates.

`next.config.ts` lists `@binderly/ui`, `@tamagui/core`, and
`@tamagui/input` in `transpilePackages` so Next.js's bundler
resolves their ESM + platform-fork extensions.

## Testing

Vitest 2.x + jsdom + `@testing-library/react@16` (matches the
sibling packages exactly). `test-utils/render.tsx` exposes
`renderWithProviders` so component tests get the full provider
tree. Run:

```bash
pnpm --filter @binderly/web test
pnpm --filter @binderly/web test:watch
```

Test focus is the **shell contract**, not feature coverage:

- Provider tree composes without throwing.
- Env loader fails fast on missing required keys.
- API-client singleton constructs with the env URL.
- Theme toggle persists to localStorage and applies to the document.
- Auth provider exposes the expected context shape.
- Each placeholder route renders without crashing.
