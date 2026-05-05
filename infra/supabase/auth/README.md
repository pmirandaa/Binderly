# `infra/supabase/auth/` — Supabase Auth provider docs

Provider-by-provider configuration recipes for Binderly's auth
surface (`PROJECT.md` § 5: Google, Apple, Discord, magic-link).

The actual provider blocks live in
[`infra/supabase/config.toml`](../config.toml) under
`[auth.external.<provider>]`. Real client IDs / secrets are wired via
`env(...)` substitution and live in `.env.local` (never committed —
see `.env.example` for the variable names).

| Doc                                      | What it covers                                                                                             |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [`redirect-urls.md`](./redirect-urls.md) | The canonical allow-list of OAuth redirect URLs per environment (dev / staging / prod).                    |
| [`google.md`](./google.md)               | Google OAuth — Cloud Console wiring, scopes (`openid email profile`).                                      |
| [`apple.md`](./apple.md)                 | Sign-In-with-Apple — Services ID, key ID, team ID, the per-key signed-JWT secret, six-month rotation note. |
| [`discord.md`](./discord.md)             | Discord OAuth — Developer Portal wiring, `email identify` scopes.                                          |
| [`magic-link.md`](./magic-link.md)       | Email magic-link — local Inbucket capture and the prod SMTP swap-in.                                       |
| [`local-dev.md`](./local-dev.md)         | Paste-able local-dev recipe: magic-link via Inbucket; Google via localhost callback.                       |

## Scope of this directory

This directory ships **docs and configuration shapes**. It does
**not** ship:

- Real OAuth client IDs or secrets (those are Pablo-only;
  `.env.local`).
- Apple `.p8` private keys or a generated signed-JWT secret (those
  are Pablo-only; `.env.local`).
- Per-environment Supabase project refs (those are Vercel /
  Supabase-Cloud env vars).

The matching server-side code lives in
[`packages/auth/`](../../../packages/auth/) (the `@binderly/auth`
workspace package); the matching DB-trigger that auto-provisions
`profile` + `subscription` rows on every signup lives in
[`packages/db/src/migrations/0017_profile_provisioning_trigger.sql`](../../../packages/db/src/migrations/0017_profile_provisioning_trigger.sql).
Client-side login UI lives in `T-W-AUTH` (web) and `T-M-AUTH`
(mobile) — not in this PR.
