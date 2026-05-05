# Sign-In-with-Apple — Binderly setup

Apple's OAuth surface is harder than Google's because the
"client secret" isn't a static string — it's a **signed JWT** that
Pablo regenerates every six months from a private key. This doc
walks the full flow.

## Why Apple is required

iOS App Store guidelines (4.8) require that any app offering
third-party sign-in (Google, Discord, Facebook, …) also offers
Sign-In-with-Apple **on iOS**. Binderly will be on the App Store, so
Apple is non-negotiable.

## Apple Developer Portal: where to set things

You need an active **Apple Developer Program** membership ($99/yr).

1. **App ID**
   _Identifiers → + → App IDs_ → bundle ID `app.binderly` (or
   whatever final bundle id `T-M-AUTH` settles on). Capabilities:
   _Sign In with Apple_.

2. **Services ID** (this is the OAuth `client_id` Supabase uses)
   _Identifiers → + → Services IDs_ → identifier
   `app.binderly.web` (suggested; not the bundle ID — Services IDs
   must be a separate identifier from the App ID).
   Enable _Sign In with Apple_, configure:
   - Primary App ID: select the App ID created above.
   - Domains: `binderly.app` (production) — Apple validates this.
   - Return URLs: the Supabase callback for the environment
     (see `redirect-urls.md`).

3. **Key**
   _Keys → + → Sign In with Apple_ → name "Binderly Web Auth Key".
   Apple lets you download the `.p8` private key **once** — save
   it somewhere safe (1Password recommended). Note the **Key ID**
   (10 chars, e.g. `ABC123DEFG`).

4. **Team ID** — top-right corner of the developer portal.

## Generating the signed-JWT secret

Apple expects a JWT signed with your private key as the OAuth client
secret. Format (per [Apple docs][1]):

```
header  = { alg: 'ES256', kid: '<KEY_ID>' }
payload = {
  iss: '<TEAM_ID>',
  iat: <now-epoch-seconds>,
  exp: <iat + 15777000>,    // ≤ 6 months
  aud: 'https://appleid.apple.com',
  sub: '<SERVICES_ID>',     // e.g. 'app.binderly.web'
}
```

Use Supabase's official [snippet][2] or the small Node helper
below:

```js
// scripts/generate-apple-secret.mjs (run locally; never commit the .p8)
import { SignJWT, importPKCS8 } from "jose";
import { readFile } from "node:fs/promises";

const p8 = await readFile(process.env.APPLE_P8_PATH, "utf8");
const key = await importPKCS8(p8, "ES256");
const now = Math.floor(Date.now() / 1000);
const secret = await new SignJWT({})
  .setProtectedHeader({ alg: "ES256", kid: process.env.APPLE_KEY_ID })
  .setIssuer(process.env.APPLE_TEAM_ID)
  .setSubject(process.env.APPLE_SERVICES_ID)
  .setAudience("https://appleid.apple.com")
  .setIssuedAt(now)
  .setExpirationTime(now + 15777000) // ~ 6 months
  .sign(key);
console.log(secret);
```

The output is a single string — that's what goes into
`SUPABASE_AUTH_EXTERNAL_APPLE_SECRET`.

> Six-month rotation: set a calendar reminder. When the secret
> expires, Apple sign-ins start failing with "invalid_client". The
> rotation is just re-running the generator with the same `.p8` and
> updating the env var.

## Supabase wiring

`infra/supabase/config.toml` already declares the provider with
placeholder values:

```toml
[auth.external.apple]
enabled = true
client_id = "REPLACE_WITH_APPLE_SERVICES_ID"
secret = "env(SUPABASE_AUTH_EXTERNAL_APPLE_SECRET)"
redirect_uri = ""
url = ""
skip_nonce_check = false
email_optional = false
```

To plug real values:

1. Replace `client_id` with the **Services ID** (e.g.
   `app.binderly.web`). Not the App ID, not the bundle ID.
2. Set the env var in `.env.local`:
   ```
   SUPABASE_AUTH_EXTERNAL_APPLE_SECRET=<the-signed-jwt>
   ```
3. `pnpm db:stop && pnpm db:start`.

## Scopes

Apple supports `name` and `email` scopes; both are returned **only
on the user's first sign-in** for a given Services ID. Subsequent
sign-ins return only the user identifier — Apple intentionally
doesn't re-share PII.

This means the DB trigger in `0017_profile_provisioning_trigger.sql`
should NOT rely on `auth.users.email` being present for Apple users;
the trigger uses the user UUID for handle generation precisely so
it works without an email. ✓

## Native iOS sign-in

The Services ID flow above is the **web** flow (Supabase OAuth
callback). On native iOS (`T-M-AUTH`), the Expo SDK uses the
`expo-apple-authentication` module which talks to the OS directly
and exchanges the resulting identity token via
`supabase.auth.signInWithIdToken()`. That path does NOT need the
signed-JWT secret — it uses the App ID, not the Services ID. Both
flows share the same `auth.users` row, so the trigger fires once
per logical user regardless.

[1]: https://developer.apple.com/documentation/sign_in_with_apple/generate_and_validate_tokens
[2]: https://supabase.com/docs/guides/auth/social-login/auth-apple
