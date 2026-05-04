# Environment variables

Human-readable reference for every environment variable Binderly uses.
Pair this with `.env.example` (the canonical, copy-and-fill template) at
the repo root.

- **Canonical naming list:** [`context/secrets-and-env.md`](../context/secrets-and-env.md)
  is the source of truth for what vars exist and the `<SCOPE>_<SERVICE>_<NAME>`
  convention.
- **Local stack docs:** [`infra/README.md`](../infra/README.md) (Compose:
  Postgres / MinIO / Mailpit) and
  [`infra/supabase/README.md`](../infra/supabase/README.md) (Supabase CLI:
  Auth / Postgres / Studio / Inbucket).
- **Local validation:** `pnpm check:env` runs
  [`scripts/check-env.sh`](../scripts/check-env.sh) against `.env.local`.

## How this file is organized

`.env.example` and the tables below are grouped by **scope**, in the
order a new contributor would care about them:

| Order | Section            | Why this position                                                                                          |
|-------|--------------------|------------------------------------------------------------------------------------------------------------|
| 1     | `STACK`            | First thing a new clone needs; powers `docker compose up`.                                                 |
| 2     | `DERIVED URLS`     | One-line URLs computed from the stack values; everything downstream reads these.                           |
| 3     | `SUPABASE LOCAL`   | The other half of the local stack; co-exists with Compose on disjoint ports.                               |
| 4     | `AUTH PROVIDERS`   | OAuth secrets that the Supabase CLI substitutes via `env(...)` in `infra/supabase/config.toml`.            |
| 5     | `WEB`              | First app most contributors run.                                                                           |
| 6     | `MOBILE`           | Mirrors `WEB` for parity; same Supabase / R2 endpoints in dev.                                             |
| 7     | `API_PYTHON`       | Backend Python services and the data-pipeline credentials they need.                                       |
| 8     | `PIPELINE`         | TS data-pipeline jobs; reserved scope, currently no canonical vars.                                        |
| 9     | `EDGE`             | Supabase Edge Functions runtime; mostly auto-provisioned.                                                  |
| 10    | `CI`               | GitHub Actions tokens; only set as repo secrets, almost never locally.                                     |
| 11    | `FEATURE FLAGS`    | Env-flippable behaviour switches; live last because they're a deploy concern, not a "what runs locally" one. |

Each table column means:

- **Var** — exact env var name as it appears in `.env.example`.
- **Scope** — owning scope (`STACK`, `WEB`, `MOBILE`, …).
- **Purpose** — one-line description.
- **Source** — where you get a real value.
- **Local Y/N** — must be set for `pnpm dev` to work locally.
- **Prod Y/N** — must be set for production deploys.
- **Notes** — anything else worth knowing.

## STACK — Docker Compose infrastructure

Consumed by `infra/docker-compose.yml`. Dev-only credentials baked into
the compose defaults; override locally only to dodge a port collision.
See [`infra/README.md`](../infra/README.md) for the running stack.

| Var                  | Scope | Purpose                                       | Source            | Local | Prod | Notes                                                |
|----------------------|-------|-----------------------------------------------|-------------------|-------|------|------------------------------------------------------|
| `POSTGRES_USER`      | STACK | Compose Postgres username                     | dev default       | Y     | N/A  | Compose stack only; not deployed.                    |
| `POSTGRES_PASSWORD`  | STACK | Compose Postgres password                     | dev default       | Y     | N/A  | Dev-only credential.                                  |
| `POSTGRES_DB`        | STACK | Compose Postgres database name                | dev default       | Y     | N/A  | Database `binderly`.                                  |
| `POSTGRES_PORT`      | STACK | Host port for Compose Postgres                | dev default `5433`| Y     | N/A  | Avoids host PG (5432) and Supabase CLI PG (54322).    |
| `MINIO_ROOT_USER`    | STACK | MinIO root username                           | dev default       | Y     | N/A  |                                                      |
| `MINIO_ROOT_PASSWORD`| STACK | MinIO root password                           | dev default       | Y     | N/A  |                                                      |
| `MINIO_API_PORT`     | STACK | Host port for MinIO S3 API                    | dev default `9000`| Y     | N/A  | Path-style addressing only.                           |
| `MINIO_CONSOLE_PORT` | STACK | Host port for MinIO web console               | dev default `9001`| Y     | N/A  |                                                      |
| `MAILPIT_SMTP_PORT`  | STACK | Host port for Mailpit SMTP                    | dev default `1025`| Y     | N/A  | Capture-all dev SMTP.                                 |
| `MAILPIT_WEB_PORT`   | STACK | Host port for Mailpit web inbox               | dev default `8025`| Y     | N/A  |                                                      |

## DERIVED URLS — one-liner connection strings

Connection strings derived from the STACK values. Apps and migrations
read these instead of recomposing the URL in code so a port override
only needs to happen in one place.

| Var                | Scope   | Purpose                                       | Source       | Local | Prod | Notes                                                                                          |
|--------------------|---------|-----------------------------------------------|--------------|-------|------|------------------------------------------------------------------------------------------------|
| `DATABASE_URL`     | DERIVED | Postgres URL for the Compose stack            | derived      | Y     | N/A  | **Port 5433** — used by data-pipeline workflows; **NOT** the app DB. App DB = `SUPABASE_DB_URL`. |
| `SMTP_HOST`        | DERIVED | SMTP host for outgoing dev mail               | derived      | Y     | N    | Production uses a real SMTP provider, set via `[auth.email.smtp]` in `infra/supabase/config.toml`. |
| `SMTP_PORT`        | DERIVED | SMTP port for outgoing dev mail               | derived      | Y     | N    | Mailpit on 1025.                                                                                |
| `S3_ENDPOINT_URL`  | DERIVED | S3-compatible endpoint for local MinIO        | derived      | Y     | N    | Production uses Cloudflare R2; the Python services read this via `API_PYTHON_*` overrides.       |
| `S3_REGION`        | DERIVED | S3 region (MinIO ignores it; clients require it)| dev default | Y     | N    | Hard-coded `us-east-1` per Cloudflare R2 convention.                                              |

## SUPABASE LOCAL — Supabase CLI stack

The app-facing backend (Auth, REST, Realtime, Storage, Edge Functions,
Studio). See [`infra/supabase/README.md`](../infra/supabase/README.md).

| Var                          | Scope          | Purpose                                            | Source                         | Local | Prod | Notes                                                                                       |
|------------------------------|----------------|----------------------------------------------------|--------------------------------|-------|------|---------------------------------------------------------------------------------------------|
| `SUPABASE_URL`               | SUPABASE LOCAL | Supabase API gateway URL                           | Supabase CLI / Cloud project   | Y     | Y    | Local: `http://localhost:54321`. Prod: `https://<ref>.supabase.co`.                          |
| `SUPABASE_DB_URL`            | SUPABASE LOCAL | Direct Postgres URL for the app schema             | Supabase CLI / Cloud connection| Y     | Y    | **Port 54322** locally — this is the app DB; runs PG17. See README "Postgres version note". |
| `SUPABASE_ANON_KEY`          | SUPABASE LOCAL | Public anon JWT (RLS enforced)                     | `supabase status`              | Y     | Y    | Well-known dev key shipped with `.env.example`; rotate with the project, NOT a real secret. |
| `SUPABASE_SERVICE_ROLE_KEY`  | SUPABASE LOCAL | Service-role JWT (RLS bypass)                      | `supabase status`              | Y     | Y    | Server-only. NEVER expose to clients. Dev-only well-known value shipped here.               |

## AUTH PROVIDERS — OAuth + Studio extras

Substituted into `infra/supabase/config.toml` via `env(...)`. Empty in
dev so providers appear configured in Studio while real OAuth
round-trips fail until you fill them in `.env.local`.

| Var                                       | Scope          | Purpose                                  | Source                                                          | Local | Prod | Notes                                                                                     |
|-------------------------------------------|----------------|------------------------------------------|-----------------------------------------------------------------|-------|------|-------------------------------------------------------------------------------------------|
| `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`    | AUTH PROVIDERS | OAuth client secret for Google           | https://console.cloud.google.com/apis/credentials               | N     | Y    | Empty in dev = Google appears in Studio but real auth fails until set in `.env.local`.    |
| `SUPABASE_AUTH_EXTERNAL_APPLE_SECRET`     | AUTH PROVIDERS | OAuth client secret (signed JWT) for Apple | https://developer.apple.com/account/resources/identifiers/list/serviceId | N     | Y    | Apple's "secret" is a signed JWT generated from a `.p8` key; rotate every 6 months.       |
| `SUPABASE_AUTH_EXTERNAL_DISCORD_SECRET`   | AUTH PROVIDERS | OAuth client secret for Discord          | https://discord.com/developers/applications                     | N     | Y    | Discord OAuth2 application secret.                                                         |
| `OPENAI_API_KEY`                          | AUTH PROVIDERS | Powers the AI assistant inside Supabase Studio | https://platform.openai.com/api-keys                       | N     | N    | Optional. Not used by app code. Leave empty to disable Studio's AI panel.                 |

## WEB — Next.js web app

`apps/web`. Dev defaults assume the local Supabase CLI stack and the
local MinIO bucket. Real Supabase project values come from your personal
`.env.local` once you wire a real Supabase project.

| Var                            | Scope | Purpose                                              | Source                                                  | Local | Prod | Notes                                                                                     |
|--------------------------------|-------|------------------------------------------------------|---------------------------------------------------------|-------|------|-------------------------------------------------------------------------------------------|
| `WEB_SUPABASE_URL`             | WEB   | Supabase URL the web app talks to                    | Supabase project URL                                     | Y     | Y    | Local: `http://localhost:54321`. Prod: `https://<ref>.supabase.co`.                       |
| `WEB_SUPABASE_ANON_KEY`        | WEB   | Public anon key (RLS-gated)                          | `supabase status` / Supabase project settings            | Y     | Y    | Public-by-design (RLS enforces access).                                                    |
| `WEB_R2_PUBLIC_BASE_URL`       | WEB   | Public CDN base URL for card images                  | derived / Cloudflare R2 public bucket URL                | Y     | Y    | Local: `http://localhost:9000/images`. Prod: `https://images.binderly.app`.                |
| `WEB_POSTHOG_KEY`              | WEB   | PostHog project key (analytics)                      | https://app.posthog.com/project/settings                 | N     | Y    | Empty in dev to disable analytics. Public-by-design.                                       |
| `WEB_SENTRY_DSN`               | WEB   | Sentry DSN for the web app                           | https://sentry.io project settings                       | N     | Y    | Empty in dev to disable error reporting. Public-by-design.                                 |
| `WEB_PADDLE_CLIENT_TOKEN`      | WEB   | Paddle client-side checkout token                    | Paddle dashboard → Developer Tools → Authentication      | N     | Y    | Public-by-design.                                                                          |
| `WEB_PADDLE_API_KEY`           | WEB   | Paddle server-side API key                           | Paddle dashboard → Developer Tools → Authentication      | N     | Y    | **Server-only.** Never expose to the browser.                                              |
| `WEB_PADDLE_WEBHOOK_SECRET`    | WEB   | Secret used to verify Paddle webhook signatures      | Paddle dashboard → Notifications                         | N     | Y    | Server-only.                                                                                |
| `WEB_PADDLE_ENVIRONMENT`       | WEB   | Paddle environment toggle                            | one of `sandbox` or `production`                         | Y     | Y    | Defaults to `sandbox`.                                                                      |
| `WEB_TCGPLAYER_AFFILIATE_ID`   | WEB   | TCGplayer Impact affiliate id (for "Buy on TCGplayer" CTAs) | https://impact.com TCGplayer dashboard            | N     | Y    | Public-by-design.                                                                          |

## MOBILE — Expo mobile app

`apps/mobile`. Mirrors WEB for parity (same Supabase / R2 endpoints in
dev) and adds RevenueCat for in-app purchases.

| Var                                  | Scope  | Purpose                                  | Source                                              | Local | Prod | Notes                                                          |
|--------------------------------------|--------|------------------------------------------|-----------------------------------------------------|-------|------|----------------------------------------------------------------|
| `MOBILE_SUPABASE_URL`                | MOBILE | Supabase URL the mobile app talks to     | Supabase project URL                                 | Y     | Y    | Same shape as `WEB_SUPABASE_URL`.                              |
| `MOBILE_SUPABASE_ANON_KEY`           | MOBILE | Public anon key                          | `supabase status` / project settings                 | Y     | Y    | Same shape as `WEB_SUPABASE_ANON_KEY`.                         |
| `MOBILE_R2_PUBLIC_BASE_URL`          | MOBILE | Public CDN base URL for card images      | derived / R2                                         | Y     | Y    | Mirror of `WEB_R2_PUBLIC_BASE_URL`.                            |
| `MOBILE_POSTHOG_KEY`                 | MOBILE | PostHog mobile project key               | PostHog project settings                             | N     | Y    | May be the same project as web with a different "lib".         |
| `MOBILE_SENTRY_DSN`                  | MOBILE | Sentry DSN for the mobile app            | Sentry project settings                              | N     | Y    | Separate Sentry project from web.                              |
| `MOBILE_REVENUECAT_API_KEY_IOS`      | MOBILE | RevenueCat public SDK key (iOS)          | RevenueCat dashboard → Project → API keys → iOS      | N     | Y    | Public-by-design.                                              |
| `MOBILE_REVENUECAT_API_KEY_ANDROID`  | MOBILE | RevenueCat public SDK key (Android)      | RevenueCat dashboard → Project → API keys → Android  | N     | Y    | Public-by-design.                                              |
| `MOBILE_TCGPLAYER_AFFILIATE_ID`      | MOBILE | TCGplayer affiliate id (mobile mirror)   | https://impact.com TCGplayer dashboard               | N     | Y    | Same value as `WEB_TCGPLAYER_AFFILIATE_ID`.                    |

## API_PYTHON — FastAPI services

`apps/api-python`. Dev defaults point at the Compose stack (port 5433 +
MinIO). The app schema on Supabase is reached via the service-role key
(`SUPABASE_SERVICE_ROLE_KEY`), not via `API_PYTHON_DB_URL`.

| Var                                              | Scope      | Purpose                                          | Source                                       | Local | Prod | Notes                                                                                                          |
|--------------------------------------------------|------------|--------------------------------------------------|----------------------------------------------|-------|------|----------------------------------------------------------------------------------------------------------------|
| `API_PYTHON_DB_URL`                              | API_PYTHON | Postgres URL for data-pipeline workflows         | derived / Compose stack                      | Y     | Y    | **Compose Postgres on 5433**, NOT the Supabase app DB. Same shape in prod, pointing at the Fly Postgres.       |
| `API_PYTHON_R2_ACCESS_KEY_ID`                    | API_PYTHON | R2/S3 access key id                              | Cloudflare R2 token                          | Y     | Y    | Local default `minio` matches the MinIO root user.                                                              |
| `API_PYTHON_R2_SECRET_ACCESS_KEY`                | API_PYTHON | R2/S3 secret access key                          | Cloudflare R2 token                          | Y     | Y    | Local default `miniominio`.                                                                                     |
| `API_PYTHON_R2_BUCKET_IMAGES`                    | API_PYTHON | Bucket name for card images                      | derived / R2 console                         | Y     | Y    | Created locally by `minio-init`.                                                                                |
| `API_PYTHON_R2_BUCKET_MODELS`                    | API_PYTHON | Bucket for ML model artifacts                    | derived / R2 console                         | Y     | Y    |                                                                                                                |
| `API_PYTHON_R2_BUCKET_ANN`                       | API_PYTHON | Bucket for ANN/embedding indexes                 | derived / R2 console                         | Y     | Y    |                                                                                                                |
| `API_PYTHON_SENTRY_DSN`                          | API_PYTHON | Sentry DSN for Python services                   | Sentry project settings                      | N     | Y    |                                                                                                                |
| `API_PYTHON_PRICING_AGGREGATOR_PROVIDER`         | API_PYTHON | Pricing data aggregator name                     | chosen in T-DL-PRICING-AGGREGATOR            | N     | Y¹   | E.g. `poketrace`, `pokemon_api`. ¹ Required only when `PRICING_ENABLED=true`.                                  |
| `API_PYTHON_PRICING_AGGREGATOR_API_KEY`          | API_PYTHON | Pricing aggregator API key                       | aggregator dashboard                         | N     | Y¹   | ¹ Required only when `PRICING_ENABLED=true`.                                                                   |
| `API_PYTHON_PRICING_AGGREGATOR_BASE_URL`         | API_PYTHON | Pricing aggregator base URL                      | aggregator docs                              | N     | Y¹   | Varies by provider. ¹ Required only when `PRICING_ENABLED=true`.                                                |
| `API_PYTHON_EBAY_BROWSE_APP_ID`                  | API_PYTHON | eBay Developer Program app id (Browse API)       | https://developer.ebay.com keysets           | N     | Y    | Browse API is free.                                                                                            |
| `API_PYTHON_EBAY_BROWSE_CERT_ID`                 | API_PYTHON | eBay Browse API cert id                          | https://developer.ebay.com keysets           | N     | Y    |                                                                                                                |
| `API_PYTHON_EBAY_BROWSE_DEV_ID`                  | API_PYTHON | eBay Browse API dev id                           | https://developer.ebay.com keysets           | N     | Y    |                                                                                                                |
| `API_PYTHON_EBAY_MARKETPLACE_INSIGHTS_ENABLED`   | API_PYTHON | Enable Marketplace Insights queries              | dev default `false`                          | Y     | Y    | Stays `false` until eBay business approval. Reuses the Browse credentials when enabled.                          |
| `API_PYTHON_EBAY_APP_ID`                         | API_PYTHON | eBay Sell/Trading API app id                     | https://developer.ebay.com keysets           | N     | Y²   | ² Required only if Sell/Trading APIs are wired (not in MVP).                                                    |
| `API_PYTHON_EBAY_CERT_ID`                        | API_PYTHON | eBay Sell/Trading API cert id                    | https://developer.ebay.com keysets           | N     | Y²   |                                                                                                                |
| `API_PYTHON_EBAY_DEV_ID`                         | API_PYTHON | eBay Sell/Trading API dev id                     | https://developer.ebay.com keysets           | N     | Y²   |                                                                                                                |
| `API_PYTHON_FX_PROVIDER`                         | API_PYTHON | FX rates provider                                | one of `frankfurter`, `openexchangerates`    | Y     | Y    | Default `frankfurter` is free and key-less; works in dev with no setup.                                         |
| `API_PYTHON_FX_API_KEY`                          | API_PYTHON | FX provider API key                              | provider dashboard                           | N     | Y³   | Empty for `frankfurter`. ³ Required when `API_PYTHON_FX_PROVIDER=openexchangerates`.                            |
| `API_PYTHON_PSA_USER_AGENT`                      | API_PYTHON | Contactable User-Agent for PSA scraper           | dev default empty                            | N     | Y⁴   | E.g. `BinderlyBot/1.0 (+mailto:ops@binderly.app)`. ⁴ Required only when PSA scraping is active.                |

## PIPELINE — data-pipeline TS jobs

Reserved scope name. No canonical `PIPELINE_*` vars exist yet; they
will be added by the relevant data-source tasks (e.g.
`T-DL-SOURCE-TCGDEX-EN`, see `dependencies.yaml`).

When adding new vars, place them under a `# ===== PIPELINE =====`
section in `.env.example` and document them in the corresponding
section here.

## EDGE — Supabase Edge Functions

| Var                                | Scope | Purpose                                          | Source                              | Local | Prod | Notes                                                                                            |
|------------------------------------|-------|--------------------------------------------------|-------------------------------------|-------|------|--------------------------------------------------------------------------------------------------|
| `EDGE_SUPABASE_SERVICE_ROLE_KEY`   | EDGE  | Service-role JWT for the Edge Functions runtime  | provided by Supabase                | Y¹    | Y¹   | ¹ Auto-provisioned by the Supabase runtime. Only set explicitly when invoking edge functions outside `supabase functions serve`. Local dev value mirrors `SUPABASE_SERVICE_ROLE_KEY`. |
| `EDGE_REVENUECAT_WEBHOOK_SECRET`   | EDGE  | Verify RevenueCat webhook signatures             | RevenueCat dashboard → Webhooks     | N     | Y    |                                                                                                  |
| `EDGE_PADDLE_WEBHOOK_SECRET`       | EDGE  | Verify Paddle webhook signatures                 | Paddle dashboard → Notifications    | N     | Y    |                                                                                                  |

## CI — GitHub Actions tokens

Set as **repository secrets in the GitHub UI**, NOT in any local
`.env.local`. They are listed in `.env.example` for discoverability and
so `pnpm check:env` enforces presence in any env file that opts to
define them locally — most developers won't.

| Var                          | Scope | Purpose                                       | Source                                                     | Local | Prod (CI) | Notes                                                                  |
|------------------------------|-------|-----------------------------------------------|------------------------------------------------------------|-------|-----------|------------------------------------------------------------------------|
| `CI_VERCEL_TOKEN`            | CI    | Vercel deploy token                           | https://vercel.com/account/tokens                          | N     | Y         | Used by the Vercel deploy GitHub Action.                                |
| `CI_FLY_API_TOKEN`           | CI    | Fly.io deploy token                           | `flyctl auth token`                                        | N     | Y         | Used to deploy `apps/api-python` to Fly.io.                             |
| `CI_EXPO_TOKEN`              | CI    | Expo / EAS access token                       | https://expo.dev/accounts/[user]/settings/access-tokens    | N     | Y         | Used by EAS Build / EAS Submit GitHub Actions.                          |
| `CI_SUPABASE_ACCESS_TOKEN`   | CI    | `supabase` CLI auth token                     | https://app.supabase.com/account/tokens                    | N     | Y         | Used to push migrations and edge functions from CI.                      |
| `CI_SUPABASE_DB_PASSWORD`    | CI    | Supabase project DB password                  | Supabase project → Settings → Database                     | N     | Y         | Needed for `supabase db push` from CI.                                  |
| `CI_SUPABASE_PROJECT_REF`    | CI    | Supabase project ref (e.g. `abcdwxyz`)        | Supabase project URL                                       | N     | Y         | Identifies the project the CLI talks to.                                |

## FEATURE FLAGS — environment-flippable behaviour

These are env vars (not constants) specifically so they can be flipped
per environment without code changes.

| Var                            | Scope         | Purpose                                                | Source        | Local         | Prod          | Notes                                                                                          |
|--------------------------------|---------------|--------------------------------------------------------|---------------|---------------|---------------|------------------------------------------------------------------------------------------------|
| `PRICING_ENABLED`              | FEATURE FLAGS | Show pricing data in app                               | dev default   | Y (`false`)   | Y             | Flip to `true` once a pricing aggregator is selected and credentials are configured.            |
| `CLOUD_FALLBACK_RECOGNITION`   | FEATURE FLAGS | Use cloud LLM fallback when on-device recognition fails | dev default  | Y (`false`)   | Y             | Flip when AI fallback is built.                                                                 |
| `COMMUNITY_GRADING_FLYWHEEL`   | FEATURE FLAGS | Enable community grading data flywheel                 | dev default   | Y (`false`)   | Y             | Flip post-launch.                                                                               |

## `pnpm check:env` and the `# EXTRA-OK` convention

`scripts/check-env.sh` validates a target env file (e.g. `.env.local`)
against `.env.example`. The rules are:

1. **Every var declared in `.env.example` MUST be present** in the
   target. The line must exist; the value can be empty for non-required
   vars.
2. **No extra vars in the target** unless the line directly above is a
   comment containing `# EXTRA-OK`. Use this opt-in escape hatch for
   per-developer experimental vars or for adopting a new var ahead of
   `.env.example` being updated. Example:

   ```
   # EXTRA-OK: prototype, will land in T-XX-FOO
   MY_EXPERIMENTAL_KNOB=1
   ```

3. Comment lines and blank lines are ignored on both sides.

The script exits `0` on a clean match, `1` on usage errors / missing
files, and `2` on drift (missing or extra vars). It always prints a
summary line:

- `OK: N vars match` — clean
- `FAIL: M missing, K extra` — drift, followed by named diffs

## Production secret managers

Real secrets live in the platform that needs them, NOT in this repo.
This list mirrors the table in
[`context/secrets-and-env.md`](../context/secrets-and-env.md):

- **Vercel** — web env (`WEB_*`)
- **Fly.io** — Python service envs (`API_PYTHON_*`), via `fly secrets set`
- **Supabase** — Edge Function envs (`EDGE_*`)
- **EAS** — mobile build secrets (`MOBILE_*` that are server-side)
- **GitHub Actions** — CI envs (`CI_*`)

There is no single source of truth for production secrets by design —
each platform owns its own.
