# Tech Stack

Pinned versions and rationale. Update this when an upgrade lands.

## Runtime versions

- Node.js: 22 LTS (`.nvmrc` pins exact patch)
- pnpm: 9.x
- Python: 3.12
- Postgres: 16 (matches Supabase)

## Monorepo

- **Turborepo** for task orchestration (build/test/lint pipelines)
- **pnpm workspaces** for package linking (no Yarn, no npm)
- **changesets** for versioning shared packages (deferred — not needed
  pre-launch, ok to defer until any package needs an actual semver bump)

## Web app — `apps/web`

- **Next.js 15+ (App Router)** — SSR for shareables, RSC for everything,
  partial prerendering as it stabilizes
- **TypeScript strict** — no implicit any, no unchecked indexed access
- **Tamagui** for UI components and tokens (cross-platform with mobile)
- **TanStack Query** for client-side data fetching and cache (server
  components for initial loads)
- **react-hook-form + zod** for forms
- **next-themes** for dark/light
- **next-intl** for i18n (deferred, scaffold from day one)

## Mobile app — `apps/mobile`

- **Expo SDK (latest stable at foundation phase)** with development builds
  (not Expo Go — we need native modules)
- **expo-router** for navigation (file-based, matches web mental model)
- **Tamagui** components shared with web
- **react-native-vision-camera** for camera + frame processors
- **react-native-fast-tflite** for on-device model inference
- **react-native-mlkit-text-recognition** as a fallback OCR for low-confidence
  matches (set name + number scrape)
- **react-native-reanimated 3** for animations
- **expo-sqlite** for local cache
- **op-sqlite** if expo-sqlite turns out to be too slow for our use cases
  (decision deferred to offline phase)
- **react-native-mmkv** for KV state (fast)
- **expo-image** for image rendering with caching

## Shared packages

| Package | Purpose |
|---|---|
| `packages/db` | Drizzle schemas, migrations, typed client |
| `packages/shared-types` | Pure TS types + zod schemas mirroring DB |
| `packages/api-client` | Typed wrapper around Supabase client + custom RPCs |
| `packages/set-completion` | Pure functions for completion math |
| `packages/smart-collection-dsl` | DSL schema, parser, evaluator |
| `packages/ui` | Tamagui components |
| `packages/auth` | Auth helpers |
| `packages/entitlements` | Free/Pro check utilities |
| `packages/feature-flags` | Flag evaluation |
| `packages/observability` | Sentry + PostHog wrappers |
| `packages/config` | Shared tsconfig, eslint, prettier configs |

All shared packages are TypeScript, ESM, with `dist/` build outputs (or
`tsx` consumed directly during dev).

## Backend services

### Supabase (managed)

- **Auth** — Google, Apple, Discord, magic link
- **Postgres** — primary DB
- **Storage** — for user-uploaded photos (collection_item.photo_urls,
  grading photos). Card catalog images go to R2 directly, not Supabase
  Storage (cheaper egress).
- **Edge Functions (Deno)** — for non-trivial mutations (collection
  add/update/remove with completion recompute, smart-collection eval, etc.)

### Python — `apps/api-python`

A single FastAPI app with multiple routers, deployed as separate Fly machines
where they have different scaling characteristics. Combined locally for dev.

Modules:

- `embeddings/` — image embedding model serving + ANN index builds
- `ann/` — index distribution endpoints
- `grading/` — multi-shot grading pipeline + scrapers + training
- `pricing/` — third-party pricing-feed fetcher (gated; provider TBD)
- `data-pipeline/` runs scheduled (or ad-hoc) ingestions

## Data pipeline — `data-pipeline/`

- TypeScript (we already have all the types and the resolver layer in TS)
- Runnable as CLI commands (`pnpm pipeline ingest`, `pnpm pipeline images`,
  etc.)
- Triggered by GitHub Actions cron in production

## Storage

- **Cloudflare R2** for: card catalog images, ANN index binaries, model
  artifacts, public shareable OG images cache.
- **Supabase Storage** for: user uploads (photos of their cards, grading
  shots).

## Auth providers

- Google OAuth
- Apple OAuth
- Discord OAuth
- Email magic link

All via Supabase Auth UI / SDK. No custom auth.

## Payments

- **RevenueCat** — single source of truth for entitlements
  - iOS IAP via App Store
  - Android IAP via Google Play
  - Web via Paddle (RC has an official Paddle integration; chosen over Stripe because Pablo is in Chile and Stripe does not onboard Chilean sellers)
- Edge function listens to RC webhooks and updates `subscription` table.

## Observability

- **Sentry** — errors, web + mobile + python
- **PostHog** — product analytics, session replay (web), feature flags
- **OpenTelemetry** for python services if needed; not in MVP

## CI/CD

- **GitHub Actions** — lint, typecheck, test, build, deploy
- **Vercel** — auto-deploy `apps/web` from `main`
- **Fly.io** — deploy python services from `main` via GH Action
- **EAS** — mobile builds and submits, manual triggers

## Local development

- `docker-compose up` brings up: Postgres, MinIO (R2 emulator), Mailpit
  (magic link emails), supabase services
- `pnpm dev` runs all apps in parallel via Turborepo
- iOS/Android dev builds via Expo Dev Client

## Why not...

- **Why not Flutter?** Flutter Web is poor for SSR/SEO, which our public
  shareables depend on for growth.
- **Why not separate web and mobile codebases entirely?** We share enough
  code (types, completion math, smart DSL, API client) that a monorepo is
  cheaper to maintain.
- **Why not Drizzle Studio for everything?** We use Drizzle for schema and
  migrations, but the runtime client is the Supabase JS SDK in app code so
  that RLS is enforced. Drizzle is server-side only.
- **Why not Prisma?** Drizzle is lighter and works well in Edge runtimes;
  Prisma's client is heavier for our purposes.
- **Why not Hono or tRPC for API?** Supabase Edge Functions handle most
  needs and keep the stack tight. If we outgrow them we can introduce a
  Hono service.
- **Why not pure Tailwind for web + NativeWind for mobile?** Acceptable
  fallback. Tamagui is the bet because tokens and primitives are shared. If
  Tamagui bites us during web/mobile UI tasks, swap is allowed — surface
  it as an Open Question.
