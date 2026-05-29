# Monitoring & observability runbook

Stage 11 scaffolding for **error tracking** (Sentry), **product
analytics** (PostHog), and **uptime/health**. Everything here ships
**inert**: the per-app init seams are guaranteed no-ops until a DSN /
key is provisioned, and the release-tracking workflow is skipped (never
failed) until its secret is added — the same inert-until-secrets pattern
as the other Stage 11 deploy paths (Vercel / Fly / Supabase-prod /
R2-prod / EAS).

Providers are fixed by `context/tech-stack.md`: **Sentry** for errors
across web + mobile + python, **PostHog** for analytics on web + mobile.
OpenTelemetry for Python is explicitly out of MVP scope.

> **Why no SDKs yet?** Per the task's dependency-light guidance, the
> provider SDKs are **not** dependencies today. We scaffold the init
> module + env wiring now and add the SDK at go-live. This keeps the
> install graph light and avoids the Sentry Next.js plugin's
> `next.config` / source-map-upload machinery until it's actually wired
> to a real project.

---

## What's wired today (inert)

| Runtime | Init seam | Reads | Status |
| --- | --- | --- | --- |
| Web (`apps/web`) | `lib/observability/` (`initWebObservability`, mounted via `<ObservabilityInit/>` in the root layout) | `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` | no-op until DSN/key + hooks |
| Mobile (`apps/mobile`) | `src/lib/observability/` (`initMobileObservability`, called from `app/_layout.tsx`) | `EXPO_PUBLIC_SENTRY_DSN`, `EXPO_PUBLIC_POSTHOG_KEY`, `EXPO_PUBLIC_POSTHOG_HOST` | no-op until DSN/key + hooks |
| Python (`apps/api-python`) | `observability/` (`init_sentry`) | `API_PYTHON_SENTRY_DSN` | no-op until DSN + `sentry-sdk` + an HTTP entrypoint (Q-021) |
| CI | `.github/workflows/deploy-monitoring.yml` | `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | release job skipped until secret |
| Health | `apps/web` → `GET /api/health` | — | live (cheap liveness 200) |

The init functions take **injectable hooks** (`initSentry` / `initPostHog`
on web+mobile, `initializer=` on python). With no hooks wired they do
nothing; at go-live a thin SDK wrapper passes the real initializer in.
This is why the seam is fully unit-testable without the SDK installed.

---

## Uptime / health

- **Web:** `GET /api/health` returns a cheap, dependency-free
  `{ status: 'ok', service: 'web', timestamp }` (200, `Cache-Control:
  no-store`). Point an uptime monitor (Better Stack / UptimeRobot / a
  cron `curl`) at `https://binderly.app/api/health`.
- **Python service:** **no HTTP entrypoint exists yet (Q-021 / #FU-53).**
  `infra/fly/fly.toml` already declares a `/healthz` check, but it only
  passes once the ASGI app (`binderly_api.main:app`) binds `:8080`. Until
  then there is nothing to probe — don't add a monitor for it.
- **Deep production health check** (curl + DB ping + R2 read on a cron
  that pages on failure) is the deferred Stage 11 "Done when" item from
  `rules/11-deployment.md` → tracked as **#FU-63** (Q-025).

---

## Go-live wiring (per provider)

### Sentry — web (`apps/web`)

1. `pnpm --filter @binderly/web add @sentry/nextjs`.
2. Run `npx @sentry/wizard@latest -i nextjs` (or wire manually): adds the
   Sentry build plugin to `next.config.mjs` for source-map upload.
3. Pass the real initializer into the seam — e.g. from
   `ObservabilityInit` (client) and a server `instrumentation.ts`:
   ```ts
   import * as Sentry from '@sentry/nextjs';
   initWebObservability(loadWebObservabilityConfig(), {
     initSentry: ({ dsn }) => Sentry.init({ dsn, tracesSampleRate: 0.1 }),
   });
   ```
4. Set `NEXT_PUBLIC_SENTRY_DSN` in the Vercel project env.

### PostHog — web

1. `pnpm --filter @binderly/web add posthog-js`.
2. Pass `initPostHog: ({ key, host }) => posthog.init(key, { api_host: host })`.
3. Set `NEXT_PUBLIC_POSTHOG_KEY` (+ optional `NEXT_PUBLIC_POSTHOG_HOST`).

### Sentry + PostHog — mobile (`apps/mobile`)

1. `pnpm --filter @binderly/mobile add @sentry/react-native posthog-react-native`
   and add the Sentry Expo config plugin to `app.json`.
2. Pass the real initializers into `initMobileObservability(...)` in
   `app/_layout.tsx`.
3. Set `EXPO_PUBLIC_SENTRY_DSN` / `EXPO_PUBLIC_POSTHOG_KEY` in EAS Secrets.

### Sentry — python (`apps/api-python`)

1. Add `sentry-sdk` to `pyproject.toml` `dependencies`.
2. Call `init_sentry(environment="production")` from the FastAPI startup
   (lands with the **Q-021** entrypoint). The default path will then
   `import sentry_sdk` and call `sentry_sdk.init(...)` automatically.
3. Set `API_PYTHON_SENTRY_DSN` as a Fly secret.

### Release tracking — CI (`deploy-monitoring.yml`)

Add `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` as GitHub repo
secrets. The workflow then creates a Sentry release tagged with the
commit SHA and associates commits on every push to `main`. Wire
source-map upload into the per-app deploy steps (the Sentry Next.js
plugin handles web automatically once installed).

See `infra/DEPLOYMENT_SECRETS.md` §6 for the exact secret list.
