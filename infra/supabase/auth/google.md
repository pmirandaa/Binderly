# Google OAuth — Binderly setup

## Console: where to set things

Google Cloud Console → APIs & Services → Credentials.

1. **Create an OAuth 2.0 Client ID** (type: _Web application_).
2. **Authorized redirect URIs** — paste the Supabase callback for
   the environment you're configuring (see `redirect-urls.md`):
   - Local dev: `http://localhost:54321/auth/v1/callback`
   - Cloud (staging / prod): `https://<project-ref>.supabase.co/auth/v1/callback`
3. Copy the resulting **Client ID** + **Client Secret**.

> Tip: the OAuth consent screen must be filled out before Google
> issues a Client ID. Set it to _External_, scope-list `openid`,
> `email`, `profile` (default scopes — no extra approval needed),
> and add Pablo's account as a test user while the app is in
> "Testing".

## Supabase wiring

`infra/supabase/config.toml` already declares the provider with
placeholder values:

```toml
[auth.external.google]
enabled = true
client_id = "REPLACE_WITH_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com"
secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"
redirect_uri = ""
url = ""
skip_nonce_check = true
email_optional = false
```

To plug real values:

1. Replace `client_id` with the value Google issued.
   (The `client_id` is **not** a secret — it's safe to commit.
   For Pablo-only setups, override locally and don't commit; for a
   public Binderly Cloud project, the value is fine to commit when
   the time comes.)
2. Set the env var in `.env.local`:
   ```
   SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=<the-client-secret-google-issued>
   ```
3. `pnpm db:stop && pnpm db:start` to pick up the new config.

## Scopes

Binderly requests the Supabase defaults for Google:

- `openid` — required to receive an ID token.
- `email` — populates `auth.users.email` for magic-link fallback +
  account-recovery.
- `profile` — populates `auth.users.user_metadata.full_name` and
  `avatar_url` (used as the default `display_name` / `avatar_url` in
  `public.profile` if the user doesn't change them).

We do **not** request `https://www.googleapis.com/auth/calendar`,
`drive`, etc. — Binderly is a TCG collection tracker; nothing in
the app surface justifies any non-default scope.

## `skip_nonce_check`

The local config sets `skip_nonce_check = true` because the bundled
Supabase CLI auth flow doesn't always plumb the nonce through the
local OAuth round-trip. **Production must set this back to `false`**
when Pablo provisions the hosted project (the hosted Auth service
handles nonce verification properly). The hosted dashboard's UI for
this is _Authentication → Providers → Google → Skip nonce check_.

## Verifying

After wiring, magic-link still works without Google credentials —
that's the local fallback path. To verify Google specifically:

1. Run `pnpm db:start` and the web app.
2. Click "Continue with Google" (T-W-AUTH wires the button).
3. Complete the Google consent screen.
4. Inspect `auth.users` via Studio — the row should have
   `app_metadata.provider = 'google'` and `email_confirmed_at` set.
5. Inspect `public.profile` — the row should exist (auto-provisioned
   by the trigger in `0017_profile_provisioning_trigger.sql`) with
   `handle = 'u_<first 12 hex of uuid>'`.
