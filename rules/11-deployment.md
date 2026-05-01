# Stage 11 — Deployment rules

Production deploys, monitoring, analytics. Everything else converging
into a runnable, observable product.

## Required reading

- `PROJECT.md` § 4 (Infra & Deployment)
- `context/secrets-and-env.md`
- `context/tech-stack.md`

## Hard rules

- **No production deploy without CI green on `main`.** Branch
  protection enforces this from foundation, but verify here too.
- **Migrations run before app deploy.** GitHub Action ordering: db
  migrate → web/mobile/python deploys.
- **Rollback path documented per service.** Vercel: instant rollback to
  previous deployment. Fly: `fly releases rollback`. Supabase: SQL
  migration rollback file or restore from backup. Mobile: previous
  build via EAS.
- **Secrets live in platform secret managers only.** Never in repo,
  never in container env files committed.
- **Observability from day one of prod.** Sentry capturing errors,
  PostHog capturing events, basic dashboards before any user-facing
  promotion.
- **Cost monitoring.** Set Supabase, Fly, R2, Vercel budget alerts.
  Alert at 50% of expected.

## Conventions specific to this stage

- Each platform has a workflow:
  - `.github/workflows/deploy-web.yml`
  - `.github/workflows/deploy-fly.yml`
  - `.github/workflows/deploy-db.yml`
  - `.github/workflows/deploy-mobile.yml` (manual trigger; mobile
    submits aren't auto)
- Production envs in platform UI; staging envs (Vercel preview, Fly
  staging app, Supabase staging project) for safer rollout.
- Mobile has separate iOS/Android EAS profiles for `preview`,
  `production`.

## Common pitfalls

- Apple App Store review surprises: don't gate launch on a fixed date.
- Supabase migration squash on push: the workflow is push-on-merge;
  test on a staging Supabase project first.
- R2 public bucket misconfiguration leaking data — buckets for catalog
  images are public-read; user-uploaded photos are NOT.
- Sentry source maps need to be uploaded for Next.js — verify the
  Sentry plugin is wired in `next.config.js`.

## Done when

- Web deploys auto from `main`.
- Python services deploy from `main`.
- Supabase migrations apply via CI on `main`.
- Mobile builds trigger via manual EAS workflow with proper signing.
- Sentry receiving errors from all three runtimes.
- PostHog receiving events from web and mobile.
- A 5-minute production health check (curl + DB ping + R2 read) runs
  on cron and pages on failure (deferred — at least, the alarms exist).
