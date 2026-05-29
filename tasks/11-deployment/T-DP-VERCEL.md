# T-DP-VERCEL — Vercel deployment for web

**Stage:** 11-deployment
**Agent role:** devops
**Effort:** S
**Status:** merged

## Hard dependencies
- T-W-SHELL (merged — the Next.js app shell being deployed)

## Soft dependencies
- T-DP-SUPABASE-PROD (the prod Supabase URL/anon key the web build reads)
- T-DP-R2-PROD (the prod R2 public base URL the web reads for catalog images)

## Required reading
- PROJECT.md § 3 (Tech Stack — "Deploys (web) | Vercel"), § 4 (Infra & Deployment)
- rules/11-deployment.md
- apps/web/package.json, apps/web/next.config.mjs, apps/web/lib/env.ts (env contract)
- .github/workflows/ci.yml (the pnpm/corepack setup block this workflow reuses)

## Goal
Stand up the production Vercel deployment for `@binderly/web` (Next.js 15
App Router inside the pnpm + turbo monorepo). Ship the Vercel project
config and a `deploy-web` GitHub Actions workflow that deploys on merge to
`main` (web-path-filtered) and on manual dispatch. Because Pablo has not yet
provisioned the Vercel account/token, the live deploy step is **guarded on
`secrets.VERCEL_TOKEN`** and no-ops cleanly until provisioned — everything
else (config, workflow YAML, env documentation) ships now.

## Deliverables
- `apps/web/vercel.json` — framework `nextjs`, monorepo-aware install/build
  commands (`pnpm install` / `turbo run build --filter=@binderly/web...`),
  `outputDirectory` `.next`, region, and a documented env-var contract.
- `.github/workflows/deploy-web.yml` — push-to-`main` (web paths) +
  `workflow_dispatch`; Vercel CLI deploy guarded on `VERCEL_TOKEN` presence.
- Env-var contract documented in the consolidated `infra/DEPLOYMENT_SECRETS.md`.

## Acceptance criteria
- [ ] `apps/web/vercel.json` is valid JSON and sets framework, build/install
      commands targeting `@binderly/web` and its workspace deps, and output dir.
- [ ] `deploy-web.yml` is valid YAML, triggers on `push` to `main` filtered to
      web-relevant paths plus `workflow_dispatch`.
- [ ] The live deploy job is gated so it is skipped (not failed) when
      `VERCEL_TOKEN` is absent — CI never goes red for a missing secret.
- [ ] Every env var the web app reads (`NEXT_PUBLIC_*` + server Paddle/Supabase
      vars) is enumerated in `infra/DEPLOYMENT_SECRETS.md`.
- [ ] No changes outside `owns_paths` (+ shared `infra/DEPLOYMENT_SECRETS.md`).

## Out of scope
- Provisioning the real Vercel project / token (Pablo, at go-live).
- Sentry source-map upload wiring (T-DP-MONITORING).
- Preview/staging environment tuning beyond documenting it exists.

## Branch & PR
- Branch: `agent/T-DP-INFRA` (shipped as part of the Stage 11 cluster)
- PR title: `feat(deploy): T-DP-VERCEL/FLY/SUPABASE-PROD/R2-PROD — Stage 11 deployment scaffolding (secrets pending)`
- Commit format: Conventional Commits

## Notes from execution
Shipped via the cluster PR. The web app reads `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY` (required), `NEXT_PUBLIC_R2_PUBLIC_BASE_URL`,
`NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_TCGPLAYER_AFFILIATE_ID`, the
`NEXT_PUBLIC_PADDLE_*` client vars, and the server-only `PADDLE_API_KEY` /
`PADDLE_WEBHOOK_SECRET` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_URL`. The
deploy uses the **Vercel CLI** (`vercel deploy --prod`) driven from CI rather
than Vercel's native Git integration so the monorepo build command and turbo
filter stay in version control and the deploy stays gated on a CI-managed
token. Inert until `VERCEL_TOKEN` + `VERCEL_ORG_ID` + `VERCEL_PROJECT_ID` are
added to GitHub secrets — see `infra/DEPLOYMENT_SECRETS.md`.
