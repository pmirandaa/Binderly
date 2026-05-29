# Deployment secrets — Pablo's go-live checklist

This is the single source of truth for **every secret** the Stage 11 deploy
workflows reference. The deploy config + CI workflows ship **inert**: each
live step is guarded on the presence of its provider's secret and is
**skipped (not failed)** until you add it. Once a provider's secrets are in
GitHub, that provider's deploy goes live with no code change.

> **None of these are in the repo.** Add them under
> GitHub → repo **Settings → Secrets and variables → Actions → New repository
> secret** (or, where noted, as Fly/Vercel platform secrets / Supabase
> dashboard config). Names below are the **exact** keys the workflows read.

Status legend: ⬜ not yet provisioned · ✅ provisioned.

---

## 1. Vercel — web (`deploy-web.yml`, `apps/web/vercel.json`)

Live deploy guarded on `VERCEL_TOKEN`. All three are needed for a deploy.

| Secret | ⬜ | What it's for | Where to get it |
| --- | --- | --- | --- |
| `VERCEL_TOKEN` | ⬜ | Auth for the Vercel CLI in CI (`vercel pull/build/deploy`). | Vercel → Account Settings → Tokens → Create. |
| `VERCEL_ORG_ID` | ⬜ | Identifies the Vercel team/org. | Run `vercel link` in `apps/web` once → `.vercel/project.json`, or Vercel project Settings. |
| `VERCEL_PROJECT_ID` | ⬜ | Identifies the Vercel project. | Same `.vercel/project.json` / project Settings. |

**One-time project setup (Pablo):** create the Vercel project, set **Root
Directory = `apps/web`**, and enable **"Include source files outside of the
Root Directory"** (monorepo). `apps/web/vercel.json` supplies the
install/build commands + turbo filter + output dir.

### Web runtime env vars (Vercel project → Settings → Environment Variables)

These are **not** GitHub secrets — they're set on the Vercel project (build-
time + runtime). Required ones must be present or the build/runtime degrades.

| Env var | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ yes | Backend API base URL (prod Supabase project URL). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ yes | Public anon key (prod project). |
| `NEXT_PUBLIC_R2_PUBLIC_BASE_URL` | rec. | Catalog image CDN — `https://images.binderly.app`. |
| `NEXT_PUBLIC_APP_URL` | rec. | Self URL for OG meta + auth redirects — `https://binderly.app`. |
| `NEXT_PUBLIC_TCGPLAYER_AFFILIATE_ID` | no | Enables the "Buy on TCGplayer" CTA (else disabled). |
| `NEXT_PUBLIC_PADDLE_ENVIRONMENT` | no | `production` (defaults to `sandbox`). |
| `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` | no | Paddle.js overlay init (billing). |
| `NEXT_PUBLIC_PADDLE_PRICE_MONTHLY` / `_ANNUAL` | no | Paddle price ids (prod-scoped). |
| `PADDLE_API_KEY` | no | Server-side Paddle calls (webhook). |
| `PADDLE_WEBHOOK_SECRET` | no* | Required for `/api/paddle/webhook` to verify signatures (else 503). |
| `SUPABASE_SERVICE_ROLE_KEY` | no* | Webhook writes audit rows to `paddle_webhook_log`. |
| `SUPABASE_URL` | no | Server-side Supabase URL (falls back to `NEXT_PUBLIC_SUPABASE_URL`). |
| `REVENUECAT_API_KEY` | no | Webhook grants/revokes RC promotional entitlements. |

`*` = required only once billing is turned on in production.

---

## 2. Fly.io — Python service (`deploy-fly.yml`, `infra/fly/`)

Live deploy guarded on `FLY_API_TOKEN`.

| Secret | ⬜ | What it's for | Where to get it |
| --- | --- | --- | --- |
| `FLY_API_TOKEN` | ⬜ | Auth for `flyctl deploy` in CI. | `fly tokens create deploy --app binderly-api`. |

**⚠️ Also required for a live Fly deploy (Q-021):** the api-python package
needs an ASGI HTTP entrypoint (`binderly_api.main:app`) + `fastapi`/`uvicorn`
deps so the container binds `:8080` and `/healthz` passes. That's an
application-code follow-up (Python track) — see `open-questions.md` Q-021 and
the Stage 11 go-live follow-up in `status.md`. With the token but no
entrypoint, a deploy would fail the healthcheck.

### Fly runtime secrets (`fly secrets set ... --app binderly-api`)

Set whatever the service needs at runtime once the entrypoint lands — e.g.
the R2 read-write key (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ENDPOINT`) and a DB connection
string if it talks to Postgres directly. These are Fly platform secrets, not
GitHub secrets.

---

## 3. Supabase — production DB migrations (`deploy-db.yml`)

Migrate step guarded on `PROD_DATABASE_URL`.

| Secret | ⬜ | What it's for | Where to get it |
| --- | --- | --- | --- |
| `PROD_DATABASE_URL` | ⬜ | Target for `pnpm db:migrate` (drizzle migrator). | Supabase → Project Settings → Database → Connection string (**session pooler / port 5432**, `?sslmode=require`). |

**One-time (Pablo):** create the prod project, `supabase link --project-ref
<ref> --workdir infra`, `supabase config push`. OAuth client secrets + SMTP
go in the **dashboard**, not GitHub. Full flow:
`infra/supabase/production/README.md`; connection-string + rollback details:
`infra/supabase/production/migration-runbook.md`.

---

## 4. Cloudflare R2 — production buckets (`infra/r2/production/`)

No deploy workflow consumes these directly today (the image pipeline runs
ad-hoc / on a future ingestion workflow), but they're the keys the pipeline +
Python service use to write to R2. Provision the read-write **pipeline** key
(see `infra/r2/production/access-keys.md`).

| Secret | ⬜ | What it's for | Where to get it |
| --- | --- | --- | --- |
| `R2_ACCOUNT_ID` | ⬜ | Cloudflare account id (used to build the S3 endpoint). | Cloudflare dashboard → R2 → account id. |
| `R2_ACCESS_KEY_ID` | ⬜ | R2 API token access key id (read-write). | R2 → Manage R2 API Tokens → Create (Object Read & Write). |
| `R2_SECRET_ACCESS_KEY` | ⬜ | R2 API token secret. | Shown once at token creation. |
| `R2_BUCKET` | ⬜ | Catalog images bucket name — `images`. | The bucket you create. |
| `R2_ENDPOINT` | ⬜ | S3 endpoint — `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`. | Derived from account id. |

**Also (dashboard, not a secret):** create the `images`/`models`/`ann`
buckets, connect the `images.binderly.app` custom domain (public-read), and
apply `infra/r2/production/cors.json` + `lifecycle.json`. **Never** make a
public bucket for user uploads.

---

## 5. Expo Application Services — mobile (`deploy-mobile.yml`, `apps/mobile/eas.json`)

Native iOS/Android builds + store submits run on [EAS](https://expo.dev). The
`build` job is guarded on `EXPO_TOKEN`; the **submit** path additionally needs
the per-store credentials below. The workflow is **manual-dispatch only**
(native builds cost EAS build minutes) and store submission is **opt-in** via
the dispatch `submit` input — a build never auto-pushes to a store.

Full first-run flow (Expo account, `eas build:configure`, credential upload):
`infra/eas/README.md`.

### Required for any EAS build

| Secret | ⬜ | What it's for | Where to get it |
| --- | --- | --- | --- |
| `EXPO_TOKEN` | ⬜ | Auth for the EAS CLI in CI (`eas build` / `eas submit`). | expo.dev → Account → **Settings → Access tokens** → Create. |

### Additionally required to **submit** (iOS → App Store Connect)

Use an **App Store Connect API key** (`.p8`) — no Apple ID / app-specific
password, no hardcoded Team ID. `apps/mobile/eas.json` reads these via env.

| Secret | ⬜ | What it's for | Where to get it |
| --- | --- | --- | --- |
| `ASC_API_KEY_P8` | ⬜ | The ASC API private key (`.p8` file contents). CI writes it to a temp file and exports `ASC_API_KEY_PATH`. | App Store Connect → **Users and Access → Integrations → App Store Connect API** → Generate key (Admin/App Manager). Downloadable once. |
| `ASC_API_KEY_ID` | ⬜ | The key ID for the `.p8` above. | Shown next to the key in ASC. |
| `ASC_API_KEY_ISSUER_ID` | ⬜ | The issuer ID for the ASC API. | ASC → Integrations → App Store Connect API (top of page). |

### Additionally required to **submit** (Android → Google Play)

| Secret | ⬜ | What it's for | Where to get it |
| --- | --- | --- | --- |
| `GOOGLE_SERVICE_ACCOUNT_KEY_JSON` | ⬜ | Google Play service-account JSON (full file contents). CI writes it to a temp file and exports `GOOGLE_SERVICE_ACCOUNT_KEY_PATH`. | Google Play Console → **Setup → API access** → create/link a service account in Google Cloud → grant **Release** permissions → create a JSON key. |

**Signing credentials (managed by EAS, NOT GitHub secrets):** the iOS
distribution certificate + provisioning profile and the Android upload keystore
are uploaded once via `eas credentials` and stored on EAS. They are never
committed and never put in GitHub. See `infra/eas/README.md`.

**One-time project setup (Pablo):** sign in to Expo, run `eas init` in
`apps/mobile` to link the project (writes an `extra.eas.projectId` into the app
config), then `eas build:configure` and upload signing credentials. Bundle id
`app.binderly.binderly` (iOS) / package `app.binderly.binderly` (Android) are
already set in `apps/mobile/app.json`.

---

## 6. Monitoring — Sentry errors + PostHog analytics (`deploy-monitoring.yml`, per-app observability init)

Observability ships **inert** across all three runtimes: the init seams
in `apps/web/lib/observability/`, `apps/mobile/src/lib/observability/`,
and `apps/api-python/observability/` are **no-ops until a DSN / key is
present**. The release-tracking workflow (`deploy-monitoring.yml`) is
guarded on `SENTRY_AUTH_TOKEN` and **skipped (not failed)** until it's
set. Provider SDKs are deliberately not yet dependencies — the go-live
wiring (which SDK to install where, and the per-app init diff) is in
`infra/monitoring/README.md`.

### Runtime DSN / keys (set on each platform, NOT GitHub secrets)

Error *ingestion* needs only the DSN; analytics needs the PostHog key.
These are public-by-design and set per platform (Vercel project env /
EAS Secrets / Fly secrets). The app bundlers read the prefixed mirrors
(`NEXT_PUBLIC_*` / `EXPO_PUBLIC_*`); the repo-canonical names are in
`context/secrets-and-env.md`.

| Env var | Scope | Required | What it's for |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SENTRY_DSN` | Vercel (web) | for errors | Sentry browser/server DSN. |
| `NEXT_PUBLIC_POSTHOG_KEY` | Vercel (web) | for analytics | PostHog project API key. |
| `NEXT_PUBLIC_POSTHOG_HOST` | Vercel (web) | no | PostHog host (defaults to `https://us.i.posthog.com`). |
| `EXPO_PUBLIC_SENTRY_DSN` | EAS (mobile) | for errors | Sentry DSN for the Expo app. |
| `EXPO_PUBLIC_POSTHOG_KEY` | EAS (mobile) | for analytics | PostHog project API key. |
| `EXPO_PUBLIC_POSTHOG_HOST` | EAS (mobile) | no | PostHog host (default as above). |
| `API_PYTHON_SENTRY_DSN` | Fly (python) | for errors | Sentry DSN for the Python service (effective once the Q-021 HTTP entrypoint lands). |

### Release-tracking secrets (`deploy-monitoring.yml`, GitHub repo secrets)

Live release/commit-association job guarded on `SENTRY_AUTH_TOKEN`.

| Secret | ⬜ | What it's for | Where to get it |
| --- | --- | --- | --- |
| `SENTRY_AUTH_TOKEN` | ⬜ | Auth for `getsentry/action-release` to create a release + associate commits (and, at go-live, upload source maps). | Sentry → Settings → Auth Tokens → Create (scopes: `project:releases`, `org:read`). |
| `SENTRY_ORG` | ⬜ | Sentry org slug. | Sentry → Settings → General. |
| `SENTRY_PROJECT` | ⬜ | Sentry project slug. | Sentry → Projects. |

**⚠️ Python error ingestion (Q-021):** `API_PYTHON_SENTRY_DSN` only takes
effect once the api-python ASGI HTTP entrypoint lands (there's no
long-lived process to instrument today). The init seam +
`init_sentry()` are scaffolded; wire `init_sentry()` into the FastAPI
startup and add `sentry-sdk` to `pyproject.toml` then — see Q-021 /
#FU-53 and `infra/monitoring/README.md`.

---

## Go-live order (recommended)

1. **R2** buckets + custom domain + keys → set web `NEXT_PUBLIC_R2_PUBLIC_BASE_URL`.
2. **Supabase** prod project + `config push` + `PROD_DATABASE_URL` → run
   `deploy-db` once (`workflow_dispatch`) to apply all migrations.
3. **Vercel** project + 3 secrets + env vars → run `deploy-web` once.
4. **Fly** app + `FLY_API_TOKEN` — **after** the Q-021 HTTP entrypoint lands.
5. **EAS** Expo account + `EXPO_TOKEN` + `eas init` / `build:configure` +
   signing credentials → run `deploy-mobile` (`workflow_dispatch`) to build;
   add the ASC/Play submit secrets before the first store submission.
6. **Monitoring** Sentry org/projects + PostHog project → set the runtime
   DSN/keys per platform (§6) and add `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` /
   `SENTRY_PROJECT` for release tracking. Install the provider SDKs + wire
   the init hooks per `infra/monitoring/README.md`. (Python error ingest
   waits on the Q-021 entrypoint.)
7. Run each deploy workflow once via `workflow_dispatch` to verify, then let
   merge-to-`main` drive subsequent web/db deploys (the Stage 11 go-live
   follow-up). Mobile stays manual-dispatch (build minutes / store cadence).

Per `rules/11-deployment.md`: **migrations run before app deploys.**
