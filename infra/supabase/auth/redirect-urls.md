# OAuth redirect URLs — canonical allow-list

Supabase Auth gates redirect URLs in two places:

1. **`config.toml` — `[auth].site_url` + `[auth].additional_redirect_urls`**.
   Local CLI honors these. Pre-populated by `T-FN-SUPABASE-LOCAL`.
2. **The Supabase Dashboard → Authentication → URL Configuration**.
   The hosted project honors these. Pablo-only — must be set per
   environment when the Cloud project is provisioned.

Every OAuth provider also keeps its own redirect-URL allow-list (set
in the provider's developer console). Those must include the
**Supabase callback URL** for the relevant environment, _not_ the
app URL — the app URL is what `redirect_to` re-routes to _after_
Supabase processes the OAuth response.

## Per-environment URLs

| Env        | App URL (web)                  | Mobile deep link                   | Supabase callback                                    |
| ---------- | ------------------------------ | ---------------------------------- | ---------------------------------------------------- |
| Local dev  | `http://localhost:3000`        | `binderly://auth/callback`         | `http://localhost:54321/auth/v1/callback`            |
| Staging    | `https://staging.binderly.app` | `binderly+staging://auth/callback` | `https://<project-ref>.supabase.co/auth/v1/callback` |
| Production | `https://binderly.app`         | `binderly://auth/callback`         | `https://<project-ref>.supabase.co/auth/v1/callback` |

> The mobile deep-link scheme `binderly://` is reserved for
> `T-M-AUTH` (Expo) — not yet wired. Listed here for forward-compat.

## What goes where

### Provider-side (Google / Apple / Discord developer console)

Allow-list **only** the Supabase callback URL for each environment:

```
http://localhost:54321/auth/v1/callback     # local dev
https://<project-ref>.supabase.co/auth/v1/callback   # cloud project
```

These are the `redirect_uri` Supabase sends to the provider; the
provider returns the auth code to _Supabase_, which then 302s to
`redirect_to` (the app URL).

### Supabase-side (config.toml + dashboard)

Allow-list every app URL the user can land on after auth completes:

- `[auth].site_url` — the default landing URL (one entry).
- `[auth].additional_redirect_urls` — the rest (web + mobile deep
  links).

Local config (`infra/supabase/config.toml`) currently ships:

```toml
site_url = "http://127.0.0.1:3000"
additional_redirect_urls = ["https://127.0.0.1:3000"]
```

`T-W-AUTH` and `T-M-AUTH` will extend this list when they wire
their respective callback handlers; do not add their entries
preemptively here.

## Common gotchas

- **`http://localhost` vs. `http://127.0.0.1`** — Google's OAuth
  console treats them as different origins. Allow-list both if you
  use both. Supabase's local stack uses `127.0.0.1` by default in
  the bundled config.
- **Trailing slashes matter.** `https://binderly.app` and
  `https://binderly.app/` are _different_ URLs to the OAuth
  validator. Pick one and stick to it across the provider, the
  Supabase dashboard, and the app's `redirect_to` calls.
- **Don't list per-route URLs.** Allow-list the _origin_ (e.g.
  `https://binderly.app`); Supabase will allow any path under it
  that the client hands back via `redirect_to`. Per-route allow-listing
  would force a config update on every new auth-aware page.
