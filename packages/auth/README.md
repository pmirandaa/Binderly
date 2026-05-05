# `@binderly/auth`

Server-side Supabase Auth helpers for Binderly.

This package wraps `@supabase/supabase-js` with the project's
discriminated-union error shape and a small set of ergonomic
primitives every server-side caller (Edge Functions, Next.js Route
Handlers, server-side scripts) needs:

- `requireUser(request, env)` — extract the bearer token, validate
  via Supabase, return `{ user, claims, supabase }` with a
  user-scoped (RLS-honoring) Supabase client.
- `getSessionFromRequest(request, env)` — like `requireUser` but
  returns `null` for the missing-token path; throws on bad/expired
  tokens.
- `verifyAccessToken(token, env)` — same flow with a token already in
  hand.
- `createUserScopedClient(jwt, env)` — Supabase client pre-wired with
  `Authorization: Bearer <jwt>` so PostgREST round-trips resolve to
  the JWT's subject under RLS.
- `createServiceRoleClient(env)` — service-role key client; BYPASSRLS;
  for elevated server-side paths only (profile back-fill, webhook
  handlers, admin tooling). Never expose to user input.
- `provisionProfile(serviceClient, userId)` — application-level
  safety net behind the DB-trigger primary path. Idempotent.
- `extractBearerToken` / `decodeClaims` / `isExpired` — low-level
  helpers if you want to compose your own flow.
- `loadAuthEnv(source?)` — typed loader for the three required env
  vars (`SUPABASE_URL`, `SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`).
- `AuthError` — typed error class with a stable `code` field
  (`missing_token` / `invalid_token` / `expired_token` /
  `no_profile` / `service_unavailable`).

## What this package is **not**

- A client-side login UI. The web login form lives in `T-W-AUTH`,
  the mobile login screen in `T-M-AUTH`.
- An OAuth provider configurator. Provider config (Google, Apple,
  Discord) lives in `infra/supabase/config.toml` and the docs under
  `infra/supabase/auth/`.
- A JWT signature verifier. Trust comes from
  `supabase.auth.getUser(token)`. The local `decodeClaims` helper
  parses the payload but does **not** verify the signature.
- An entitlement / subscription helper. Subscription rows are read
  via the user-scoped Supabase client (RLS-gated) by the api-client.
  This package only provisions the row at signup time.

## Canonical patterns

### Edge Function (server-side gate)

```ts
import { requireUser, loadAuthEnv, AuthError, isAuthError } from '@binderly/auth';

const env = loadAuthEnv(); // reads SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY

export default async function handler(request: Request): Promise<Response> {
  try {
    const { user, supabase } = await requireUser(request, env);
    const { data, error } = await supabase
      .from('collection_item')
      .select('id, printing_id')
      .eq('user_id', user.id);
    if (error) throw error;
    return Response.json({ ok: true, data });
  } catch (error) {
    if (isAuthError(error)) {
      const status = error.code === 'service_unavailable' ? 503 : 401;
      return Response.json({ ok: false, error: error.toJSON() }, { status });
    }
    throw error;
  }
}
```

### Next.js Route Handler (App Router)

```ts
import { NextRequest } from 'next/server';
import { requireUser, loadAuthEnv } from '@binderly/auth';

const env = loadAuthEnv();

export async function GET(request: NextRequest) {
  const { user, supabase } = await requireUser(request, env);
  const { data } = await supabase.from('profile').select('*').eq('user_id', user.id).single();
  return Response.json({ user, profile: data });
}
```

### Profile provisioning safety net

```ts
import { createServiceRoleClient, provisionProfile, loadAuthEnv } from '@binderly/auth';

const env = loadAuthEnv();
const service = createServiceRoleClient(env);
const result = await provisionProfile(service, '11111111-1111-1111-1111-111111111111');
// result.inserted === true if the row was created; false if it already existed.
```

The DB trigger in
`packages/db/src/migrations/0017_profile_provisioning_trigger.sql` is
the primary path; this helper is the safety net you call when you
want belt-and-braces guarantees (e.g. a worker that polls
`auth.users` for any rows missing a matching profile).

## Sign-out + token refresh

The Supabase JS SDK handles both **client-side**: `supabase.auth.signOut()`
clears the local session; the SDK auto-refreshes tokens before they
expire. Server-side helpers in this package don't refresh — they
respect expired tokens by throwing `AuthError({ code: 'expired_token' })`
and the client is responsible for refreshing and retrying.

## Local dev

The Supabase CLI stack (`pnpm db:start`) ships with all four auth
providers visible in Studio. Magic-link works out of the box (emails
captured by Inbucket on `localhost:54324`); OAuth round-trips for
Google / Apple / Discord need real credentials in `.env.local`.

See `infra/supabase/auth/local-dev.md` for the paste-able recipe.
