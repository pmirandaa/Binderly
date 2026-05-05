# Discord OAuth — Binderly setup

Discord is huge in the Pokémon TCG community (per `PROJECT.md`
§ 3 — "Discord huge in TCG community") so Binderly ships it as a
first-class provider alongside Google and Apple.

## Console: where to set things

[Discord Developer Portal](https://discord.com/developers/applications)
→ _New Application_ → name "Binderly".

1. **OAuth2 → Redirects** — paste the Supabase callback for the
   environment (see `redirect-urls.md`):
   - Local dev: `http://localhost:54321/auth/v1/callback`
   - Cloud: `https://<project-ref>.supabase.co/auth/v1/callback`
2. **OAuth2 → Client ID / Client Secret** — copy both. The Client
   Secret is shown once; reset it via _OAuth2 → Reset Secret_ if
   you lose it.

> Discord does NOT require email verification on its end. Users
> who registered with an unverified Discord account will land in
> Supabase with `email_confirmed_at = null` until they verify out
> of band — `T-W-AUTH` should respect that.

## Supabase wiring

`infra/supabase/config.toml` already declares the provider:

```toml
[auth.external.discord]
enabled = true
client_id = "REPLACE_WITH_DISCORD_OAUTH_CLIENT_ID"
secret = "env(SUPABASE_AUTH_EXTERNAL_DISCORD_SECRET)"
redirect_uri = ""
url = ""
skip_nonce_check = false
email_optional = false
```

To plug real values:

1. Replace `client_id` with the Discord application's Client ID.
2. Set the env var in `.env.local`:
   ```
   SUPABASE_AUTH_EXTERNAL_DISCORD_SECRET=<the-discord-client-secret>
   ```
3. `pnpm db:stop && pnpm db:start`.

## Scopes

Binderly requests:

- `identify` — required; populates `auth.users.user_metadata` with
  the user's Discord username + avatar.
- `email` — populates `auth.users.email` (so the magic-link
  fallback works for Discord-only users).

We do **not** request `connections`, `guilds`, `bot`, or any other
scope — Binderly doesn't need to read the user's Discord servers
or post on their behalf.

## Verifying

1. Run `pnpm db:start` and the web app.
2. Click "Continue with Discord" (T-W-AUTH wires the button).
3. Approve on Discord's consent screen.
4. Inspect `auth.users` — `app_metadata.provider = 'discord'`,
   `user_metadata.full_name = '<discord username>'`,
   `user_metadata.avatar_url = '<discord avatar cdn url>'`.
5. Inspect `public.profile` — auto-created by the trigger; user
   can edit `display_name` / `avatar_url` later via the app.
