# Stage 02 — Backend rules

This stage ties the schema to apps via auth flows, shared API contracts, a
typed client, and Edge Functions for non-trivial mutations.

## Required reading

- `PROJECT.md` § 5 (Auth), § 6 (Data Model), § 16 (Freemium)
- `context/data-model.md`
- `context/conventions.md`
- `context/secrets-and-env.md`

## Hard rules

- **Supabase Auth, no custom auth code.** Providers configured via the
  Supabase dashboard (mirrored in `infra/supabase/auth/` config files);
  client-side uses the official SDKs.
- **All client mutations go through RLS.** No service-role keys ever
  ship to the client. If a mutation requires elevated privilege (e.g.,
  recompute completion materialized view), it goes in an Edge Function.
- **One source of truth for types.** `packages/shared-types` defines zod
  schemas; types are inferred. The DB schema in `packages/db` and these
  shared types must round-trip — write a contract test that proves it
  (insert via DB types → read via shared types → equal).
- **No N+1 queries on hot paths.** Browse, set view, and collection
  home all need to be tested for query efficiency. Use Postgres EXPLAIN
  on representative queries.
- **Errors use the discriminated union from `context/conventions.md`.**
  Edge Functions return `{ ok, data | error }`, the api-client unwraps.
- **Freemium gating happens server-side, not just client-side.** The
  api-client / Edge Functions enforce limits (3 manual custom
  collections on free, etc.). Client-side is a UX layer over the same
  rules.

## Conventions specific to this stage

- Edge Functions in `infra/supabase/functions/<name>/index.ts`. One
  function per logical operation; share helpers via a `_shared/`
  directory.
- API client in `packages/api-client/`. Methods named after operations
  (`addCollectionItem`, `getSetCompletion`), not REST verbs.
- Auth helpers in `packages/auth/` — wrap supabase-js with our error
  shape and small ergonomic helpers (`requireUser()`, `getSession()`).

## Common pitfalls

- Supabase JS v2 changed the realtime API; pin the version in
  `package.json` and document.
- Apple OAuth requires a backend JWT generation step for some flows;
  follow Supabase docs precisely.
- Magic link emails in dev go to Mailpit (Docker compose); test the
  link works end-to-end.
- Edge Functions have a cold-start latency. Keep them small. Don't put
  the smart-collection evaluator in an Edge Function — that's a
  packages/* concern called from a function.
- Rows-level security: forgetting RLS on a new table is a leak. Every
  user table gets a policy in the SAME migration that creates it.

## Done when

- Sign-in works locally end-to-end for all 4 providers (Google, Apple,
  Discord, magic link) — Apple via simulated dev flow.
- Adding/removing a `collection_item` works through the api-client and
  triggers materialized view refresh.
- A free user cannot create a 4th manual custom collection (server
  refuses, client gates).
- API contract tests pass.
