# Local-dev auth — paste-able recipe

End-to-end recipe for testing every auth flow locally on Pablo's
machine. Assumes `pnpm install` has already run from the repo
root and Docker Desktop is up.

## 0. Start the stack

```bash
pnpm db:start
# ... waits ~30s on warm cache, ~5min on first run while images pull
```

Once `supabase status --workdir infra` reports green:

| Service         | URL                                                       |
| --------------- | --------------------------------------------------------- |
| API (REST/Auth) | `http://localhost:54321`                                  |
| Postgres        | `postgresql://postgres:postgres@localhost:54322/postgres` |
| Studio          | `http://localhost:54323`                                  |
| Inbucket (mail) | `http://localhost:54324`                                  |

## 1. Apply migrations (incl. the auto-provisioning trigger)

```bash
pnpm --filter @binderly/db db:migrate -- --url $SUPABASE_DB_URL
```

This applies migrations 0000 through 0017. Migration 0017 is the
profile + subscription auto-provisioning trigger this PR ships.

> If you previously ran the stack without 0017, drop and re-create:
> `pnpm db:reset` will replay every migration from scratch.

## 2. Verify env vars

`.env.example` ships the public dev values; you only need to fill
real secrets in `.env.local` for the OAuth providers you want to
test.

```bash
cp .env.example .env.local      # if you don't already have one
```

The four auth-relevant values you might set:

```bash
# Real Google OAuth — see infra/supabase/auth/google.md
SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=<google-client-secret>
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=<google-client-id>.apps.googleusercontent.com

# Real Apple Sign-In — see infra/supabase/auth/apple.md
SUPABASE_AUTH_EXTERNAL_APPLE_SECRET=<signed-jwt-string>
SUPABASE_AUTH_EXTERNAL_APPLE_CLIENT_ID=app.binderly.web

# Real Discord OAuth — see infra/supabase/auth/discord.md
SUPABASE_AUTH_EXTERNAL_DISCORD_SECRET=<discord-client-secret>
SUPABASE_AUTH_EXTERNAL_DISCORD_CLIENT_ID=<discord-client-id>
```

> Note: the `_CLIENT_ID` env vars above are **forward-compat
> placeholders**. Today, `config.toml` hardcodes the client IDs
> with `REPLACE_WITH_*_OAUTH_CLIENT_ID` placeholders. To plug a
> real value, edit `config.toml` directly OR rewire the
> `client_id` field to use `env(...)` substitution. Either path is
> fine for local dev; the file edit is what we'll do for the
> hosted project (where committing the public client_id is fine).

## 3. Test magic-link (no real provider needed)

You can test magic-link without ANY OAuth credentials configured —
this is the "minimum viable auth flow" path.

1. Run the web app: `pnpm --filter @binderly/web dev` (after
   `T-W-AUTH` lands; today, you can substitute a quick curl flow
   below).
2. From the login form, enter any email (`pablo+test@binderly.app`).
3. Click "Send magic link".
4. Open Inbucket: <http://localhost:54324>.
5. Click your email → click the magic link.
6. You're signed in.

Bare-curl version (works today, before T-W-AUTH lands):

```bash
# Send the magic link via the Auth REST API:
curl -X POST http://localhost:54321/auth/v1/otp \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"pablo+test@binderly.app","options":{"shouldCreateUser":true}}'

# Inbucket UI shows the email; copy the token from the link.
# Verify the token to receive a session:
curl -X POST http://localhost:54321/auth/v1/verify \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"type":"magiclink","email":"pablo+test@binderly.app","token":"<token>"}'
```

The verify response carries the access + refresh tokens; you can
now hit any RLS-protected endpoint with `Authorization: Bearer
<access_token>`.

## 4. Test Google sign-in (real OAuth, localhost callback)

Requires the Google OAuth client ID + secret from
`infra/supabase/auth/google.md` step 1.

1. Make sure the redirect URI
   `http://localhost:54321/auth/v1/callback` is allow-listed in
   the Google Cloud Console (Authorized redirect URIs).
2. Make sure `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` is set in
   `.env.local` and `client_id` is wired in `config.toml`.
3. `pnpm db:stop && pnpm db:start` to pick up the config change.
4. From the web login form, click "Continue with Google".
5. Google's consent screen pops up; sign in with your Pablo+test
   Google account.
6. You're redirected back to the app, signed in.

> If the round-trip fails with "redirect_uri_mismatch" — the
> exact callback URL must be in the Google console, character for
> character. `http://localhost` and `http://127.0.0.1` count as
> different. The Supabase CLI uses `127.0.0.1` for `site_url` but
> `localhost` for the auth callback; allow-list both.

## 5. Verify the auto-provisioning trigger fired

After any successful sign-in:

```bash
# Connect to the local Supabase Postgres and check:
psql $SUPABASE_DB_URL -c "
  SELECT u.id, u.email, p.handle, s.tier
  FROM   auth.users u
  LEFT   JOIN public.profile      p ON p.user_id = u.id
  LEFT   JOIN public.subscription s ON s.user_id = u.id
  ORDER  BY u.created_at DESC
  LIMIT  5;
"
```

Expected: every freshly-created user has a matching `profile` row
(handle = `u_<first 12 hex chars of uuid>`) and a `subscription`
row (tier = `free`). If either is missing, migration 0017 didn't
apply — re-run `pnpm db:reset`.

## 6. Run the verify-rls suite

The behavioral suite validates the trigger end-to-end against the
live Supabase:

```bash
SUPABASE_DB_URL=postgresql://postgres:postgres@localhost:54322/postgres \
  pnpm --filter @binderly/db verify-rls
```

Expected output ends with `verify-rls: <N> passed, 0 failed.` —
where `<N>` includes the two new trigger-coverage assertions
(`behavior:trigger created profile row …`, `behavior:trigger
created subscription row …`).

## Troubleshooting

- **"Email rate limit exceeded" on magic link** — Supabase caps at
  2 emails/hour per project (`config.toml` `[auth.rate_limit]
email_sent`). Wait the hour or restart the stack to reset.
- **Apple sign-in fails locally** — likely `skip_nonce_check =
false` is incompatible with how the local CLI proxies the
  callback. Either flip to `true` in `config.toml` for local dev
  (and back for prod) or test Apple on a real Cloud project.
- **Trigger didn't fire** — check `psql $SUPABASE_DB_URL -c "\\df
public.handle_new_user"` (function should exist) and `\\d
auth.users` (the `on_auth_user_created` trigger should be
  listed). If either is missing, run `pnpm --filter @binderly/db
db:migrate` again.
