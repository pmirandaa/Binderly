# Secrets & Environment

Naming, where each var is needed, and how it's provisioned.

## Naming convention

```
<SCOPE>_<SERVICE>_<NAME>
```

Examples:
- `WEB_SUPABASE_URL`
- `WEB_SUPABASE_ANON_KEY`
- `MOBILE_SENTRY_DSN`
- `PIPELINE_TCGDEX_BASE_URL`
- `API_PYTHON_R2_ACCESS_KEY_ID`

Public-by-design vars (anon keys, public URLs) are in `.env.example` with
their dev defaults. Secret vars are listed with empty values and a
`# REQUIRED` comment.

## Scopes

- `WEB_*` — Next.js web app
- `MOBILE_*` — Expo mobile app
- `API_PYTHON_*` — FastAPI services
- `PIPELINE_*` — data-pipeline TS jobs
- `EDGE_*` — Supabase Edge Functions
- `CI_*` — GitHub Actions

## Required vars (canonical list)

### Web

| Var | Public? | Source | Notes |
|---|---|---|---|
| `WEB_SUPABASE_URL` | yes | Supabase project | |
| `WEB_SUPABASE_ANON_KEY` | yes | Supabase project | |
| `WEB_R2_PUBLIC_BASE_URL` | yes | `https://images.binderly.app` | |
| `WEB_POSTHOG_KEY` | yes | PostHog project | |
| `WEB_SENTRY_DSN` | yes | Sentry project | |
| `WEB_PADDLE_CLIENT_TOKEN` | yes | Paddle | client-side checkout token |
| `WEB_PADDLE_API_KEY` | no | Paddle | server-only |
| `WEB_PADDLE_WEBHOOK_SECRET` | no | Paddle | for webhook signature verification |
| `WEB_PADDLE_ENVIRONMENT` | yes | Paddle | `sandbox` or `production` |
| `WEB_TCGPLAYER_AFFILIATE_ID` | yes | TCGplayer Impact affiliate dashboard | needed for "Buy on TCGplayer" CTAs |
| `MOBILE_TCGPLAYER_AFFILIATE_ID` | yes | same as above | mirror for mobile |

### Mobile

| Var | Public? | Notes |
|---|---|---|
| `MOBILE_SUPABASE_URL` | yes | |
| `MOBILE_SUPABASE_ANON_KEY` | yes | |
| `MOBILE_R2_PUBLIC_BASE_URL` | yes | |
| `MOBILE_POSTHOG_KEY` | yes | |
| `MOBILE_SENTRY_DSN` | yes | |
| `MOBILE_REVENUECAT_API_KEY_IOS` | yes | |
| `MOBILE_REVENUECAT_API_KEY_ANDROID` | yes | |

### Python services

| Var | Notes |
|---|---|
| `API_PYTHON_DB_URL` | Postgres connection |
| `API_PYTHON_R2_ACCESS_KEY_ID` | |
| `API_PYTHON_R2_SECRET_ACCESS_KEY` | |
| `API_PYTHON_R2_BUCKET_IMAGES` | |
| `API_PYTHON_R2_BUCKET_MODELS` | |
| `API_PYTHON_R2_BUCKET_ANN` | |
| `API_PYTHON_SENTRY_DSN` | |
| `API_PYTHON_PRICING_AGGREGATOR_PROVIDER` | aggregator name (e.g., `poketrace`, `pokemon_api`); chosen in T-DL-PRICING-AGGREGATOR |
| `API_PYTHON_PRICING_AGGREGATOR_API_KEY` | aggregator API key |
| `API_PYTHON_PRICING_AGGREGATOR_BASE_URL` | aggregator base URL (varies by provider) |
| `API_PYTHON_EBAY_BROWSE_APP_ID` | eBay Developer Program app ID; needed for Browse API (free) |
| `API_PYTHON_EBAY_BROWSE_CERT_ID` | eBay app cert |
| `API_PYTHON_EBAY_BROWSE_DEV_ID` | eBay app dev ID |
| `API_PYTHON_EBAY_MARKETPLACE_INSIGHTS_ENABLED` | `false` until business approval lands; same eBay credentials when enabled |
| `API_PYTHON_FX_PROVIDER` | `frankfurter` (default, free, no key) or `openexchangerates` |
| `API_PYTHON_FX_API_KEY` | empty for `frankfurter`; required for `openexchangerates` |
| `API_PYTHON_PSA_USER_AGENT` | contactable UA for scraper |
| `API_PYTHON_EBAY_APP_ID` | |
| `API_PYTHON_EBAY_CERT_ID` | |
| `API_PYTHON_EBAY_DEV_ID` | |

### Edge Functions

| Var | Notes |
|---|---|
| `EDGE_SUPABASE_SERVICE_ROLE_KEY` | provided automatically by Supabase |
| `EDGE_REVENUECAT_WEBHOOK_SECRET` | |
| `EDGE_PADDLE_WEBHOOK_SECRET` | |

### CI / Actions

| Var | Notes |
|---|---|
| `CI_VERCEL_TOKEN` | |
| `CI_FLY_API_TOKEN` | |
| `CI_EXPO_TOKEN` | |
| `CI_SUPABASE_ACCESS_TOKEN` | |
| `CI_SUPABASE_DB_PASSWORD` | |
| `CI_SUPABASE_PROJECT_REF` | |

## Feature flags (also via env)

| Var | Default | Notes |
|---|---|---|
| `PRICING_ENABLED` | `false` | Flip to true when a pricing-data provider (e.g. TCG API, TCGAPIs) is selected and credentials are configured |
| `CLOUD_FALLBACK_RECOGNITION` | `false` | Flip when AI fallback is built |
| `COMMUNITY_GRADING_FLYWHEEL` | `false` | Flip post-launch |

These are environment vars not because they're secret but because they need
to be flippable per environment without code changes.

## Local dev defaults

`.env.example` ships with values that work against the Docker compose
stack:

```
WEB_SUPABASE_URL=http://localhost:54321
WEB_SUPABASE_ANON_KEY=<value supabase-cli prints>
WEB_R2_PUBLIC_BASE_URL=http://localhost:9000/images
PRICING_ENABLED=false
```

Real secrets (Paddle sandbox keys, RC, PostHog) are personal — copy
`.env.example` to `.env.local` and fill in.

## Production secret managers

- **Vercel** → web env
- **Fly.io** → python service envs (`fly secrets set`)
- **Supabase** → edge function envs
- **EAS** → mobile build secrets
- **GitHub Actions** → CI envs

A single source of truth document doesn't exist by design — secrets live in
the platforms that need them.
