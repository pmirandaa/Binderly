# Production config diff (from `infra/supabase/config.toml`)

We keep a **single** `config.toml` (`infra/supabase/config.toml`) for both
local dev and the `supabase config push` to production. The values below are
the blocks that differ in production. Apply them either by environment
substitution (`env(...)`, already used for secrets) or in the Supabase
dashboard — never by committing real secrets to the repo (per
`rules/11-deployment.md`: "Secrets live in platform secret managers only").

| `config.toml` block | Local value | Production value / action |
| --- | --- | --- |
| `[auth] site_url` | `http://127.0.0.1:3000` | `https://binderly.app` (the deployed web origin / `NEXT_PUBLIC_APP_URL`). |
| `[auth] additional_redirect_urls` | `["https://127.0.0.1:3000"]` | Add `https://binderly.app/auth/callback` + any Vercel preview origins used for OAuth testing. |
| `[auth.external.google] client_id` | `REPLACE_WITH_*` placeholder | Real Google OAuth client id (dashboard or `env(...)`). Secret via `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`. |
| `[auth.external.apple] client_id` | `REPLACE_WITH_*` placeholder | Real Apple Services ID. Secret (signed JWT) via `SUPABASE_AUTH_EXTERNAL_APPLE_SECRET`. |
| `[auth.external.discord] client_id` | `REPLACE_WITH_*` placeholder | Real Discord OAuth client id. Secret via `SUPABASE_AUTH_EXTERNAL_DISCORD_SECRET`. |
| `[auth.email] enable_confirmations` | `false` | `true` — require email confirmation in prod. |
| `[auth.email.smtp]` | commented (local Inbucket) | Enable with a real SMTP provider (e.g. SendGrid/Resend); `pass = env(SMTP_PASS)`. |
| `[db.network_restrictions] enabled` | `false` (allow all) | Consider `true` + allow-list (Fly egress, CI) once the IP set is known. |
| `[db.ssl_enforcement] enabled` | commented | `true` — reject non-TLS DB connections in prod. |
| `[storage] file_size_limit` | `50MiB` | Keep `50MiB` (user-upload photos) unless product needs change. |

## What does NOT change

- The schema (`schemas = ["public", "graphql_public"]`), `max_rows`,
  realtime, and RLS posture are identical — production must enforce the same
  RLS policies verified locally (`pnpm --filter @binderly/db verify-rls`).
- `project_id = "binderly"` is the local container-naming string; the cloud
  project is identified by its **project ref** (set via `supabase link`), not
  this field.

## How to apply

```bash
# Non-secret config (auth toggles, storage limits, redirect URLs):
pnpm exec supabase config push --workdir infra   # review the diff first

# Secrets (OAuth client secrets, SMTP password): set in the dashboard
# (Authentication → Providers / Project Settings → Auth) OR export the
# env vars the `env(...)` substitutions reference before `config push`.
```
