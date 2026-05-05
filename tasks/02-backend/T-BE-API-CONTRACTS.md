# T-BE-API-CONTRACTS — Shared API contracts package (zod + types)

**Stage:** 02-backend
**Agent role:** backend
**Effort:** M
**Status:** in_progress

---

## Hard dependencies

- **T-DL-SCHEMA-CARDS** (merged) — `set` / `card` / `printing` Drizzle
  schemas in `packages/db/src/schema/{sets,cards,printings}.ts`.
- **T-DL-SCHEMA-USERS** (merged) — `profile` / `subscription` Drizzle
  schemas in `packages/db/src/schema/{profiles,subscriptions}.ts`.
- **T-DL-SCHEMA-COLLECTIONS** (merged) — `collection_item`,
  `custom_collection`, `custom_collection_item`,
  `smart_collection_rule`, `shareable` Drizzle schemas in
  `packages/db/src/schema/{collections,custom_collections,smart_rules,shareables}.ts`.
- **T-DL-SCHEMA-GRADING** (merged) — `grading_submission` Drizzle
  schema in `packages/db/src/schema/grading.ts`.
- **T-DL-SCHEMA-PRICING** (merged) — `market` /
  `price_observation` / `price_aggregate` / `fx_rate` Drizzle schemas
  in `packages/db/src/schema/{prices,price_snapshots}.ts`.
- **T-DL-PRICING-CURRENT-VIEW** (merged) — `mv_current_price`
  materialized-view DDL (no Drizzle binding; the contract surface is
  a hand-modeled DTO).

These tasks landed during Phase 1 and the contracts package is the
read/write wire format that mirrors them.

## Soft dependencies / parallel siblings

- **T-BE-AUTH** (parallel sibling, Phase 2) — owns `apps/api/auth/` +
  Supabase Auth wiring. Consumes the `Profile` / `Session` /
  `Subscription` DTOs defined here as a peer dependency. Does not
  depend on this PR landing first; T-BE-AUTH does not write inside
  `packages/api-contracts/`.

## Required reading

- `PROJECT.md` § 5 (Auth), § 6 (Data Model), § 9 (Custom & Smart
  Collections), § 13 (Pricing & FX), § 14 (Shareables), § 16
  (Freemium), § 17 (Build Phases — confirms Phase 2 scope).
- `rules/02-backend.md` (stage rules — discriminated-union error
  shape, single source of truth for types, server-side freemium
  gating).
- `context/data-model.md` (full schema — every catalog and user table
  this package mirrors, plus `profile.preferences` shape and the
  pricing FX model).
- `context/tcg-domain.md` § 1 (variant taxonomy), § 5 (canonical
  keys), § 6 (rarity normalization), § 7 (type normalization). The
  contracts package re-exports the canonical enums.
- `context/conventions.md` — TypeScript, file layout, error
  handling, exports, and tests posture.
- `packages/db/src/schema/*.ts` — Phase 1 Drizzle table definitions.
- `data-pipeline/src/types.ts` — canonical zod posture, the enum
  re-exports (variant class / flag / rarity / Pokemon type / card
  subtype / language), and the price-tier / market constants.
- `data-pipeline/src/canonical-keys.ts` — canonical key generators
  used in DTO key validators.

## Goal

Phase 2 introduces a shared API contracts package that defines the
**wire-format** between Supabase Edge Functions / `apps/api-python` /
the eventual `packages/api-client` and every consumer (web, mobile,
scanner, shareable SSR, etc.). Every endpoint contract — request
body, response body, error envelope — is a zod schema with a
`z.infer<>` TypeScript type, exported from `@binderly/api-contracts`.

This package is the *foundation* for five downstream tasks
(`T-BE-API-CLIENT`, `T-BE-EDGE-FUNCTIONS`, `T-SP-SET-COMPLETION`,
`T-SP-SMART-DSL`, `T-SP-PRICING-DISPLAY`); shipping it cleanly is the
linchpin for Phase 2 and the start of Phase 3.

The package is read-only of the DB schema (no migrations, no
data-pipeline changes) and ships zero runtime code beyond zod
schemas and inferred types.

## Non-goals (explicit)

- **No HTTP / fetch / RPC client.** That is `T-BE-API-CLIENT`'s job.
- **No route registration.** That is `T-BE-EDGE-FUNCTIONS`' job.
- **No Supabase Auth runtime knowledge.** This package describes the
  *wire shape* of a session / profile / subscription — not the
  mechanics of OAuth callbacks, JWT verification, or session
  refresh. T-BE-AUTH owns those.
- **No business logic.** Set-completion math, smart-DSL evaluation,
  pricing display formatting all live in their own packages.
- **No DB writes / reads.** The package is pure types + validators.
- **No multi-version contracts.** The package always describes the
  *current* shape; the API path carries the version (`/v1/...`), not
  the package.

## Decisions (numbered — these are the elaboration outputs)

### D1 — Package shape

A new pnpm workspace package at `packages/api-contracts/` named
`@binderly/api-contracts`. Same layout as `@binderly/db` and
`@binderly/data-pipeline`:

- `package.json` with `main` + `types` + `exports` map (mirrors
  Q-004's resolution for `@binderly/db`).
- `tsconfig.json` extending `@binderly/tsconfig/library.json`.
- `eslint.config.mjs` extending `@binderly/eslint-config/node`.
- `vitest.config.ts` (vitest 2.x; `globals: false`, `environment:
  'node'`).
- `src/` with one file per domain module (D2) plus a barrel
  `index.ts`.
- `README.md` documenting the module split + the additive-only
  evolution policy.

### D2 — Module split

Mirrors the data layer's domain split. One zod schema per file,
co-located test file, exported via barrel.

| File | DTOs |
|---|---|
| `src/common.ts` | Pagination wrapper (`paginatedResponseSchema`), cursor encoding helpers (opaque base64), error envelope (`apiError`), discriminated-union result envelope (`apiResult`), reusable primitives (UUID, ISO-8601 date / datetime, currency code, language code, market code) |
| `src/cards.ts` | `setDto`, `cardDto`, `printingDto` (READ — wire format for the catalog tables) |
| `src/collection.ts` | `collectionItemDto` (READ), `customCollectionDto`, `customCollectionItemDto`, `smartCollectionRuleDto`, plus WRITE shapes: `addCollectionItemRequest`, `updateCollectionItemRequest`, `createCustomCollectionRequest`, `updateCustomCollectionRequest` |
| `src/pricing.ts` | `marketDto`, `priceAggregateDto`, `currentPriceDto` (the `mv_current_price` row), `fxRateDto`, `priceHistoryQuery` |
| `src/grading.ts` | `gradingSubmissionDto` (READ), `submitGradingPredictionRequest`, `attachActualGradeRequest` |
| `src/shareables.ts` | `shareableDto` (READ + public surface), `createShareableRequest`, `updateShareableRequest`, plus the `shareableTarget` discriminated union |
| `src/auth.ts` | `userDto` (the public-safe shape of `auth.users`), `sessionDto`, `profileDto`, `profilePreferencesSchema` (the contractual `profile.preferences` shape from `context/data-model.md`), `subscriptionDto`, `updateProfileRequest` |
| `src/index.ts` | Public barrel: re-exports everything via named exports. No deep imports allowed (D9). |

### D3 — DTO posture (READ vs WRITE)

**READ DTOs (responses)** expose the externally-useful subset of DB
columns:

- Drop pipeline-internal columns (`source_metadata`, `raw_metadata`,
  `image_source_url`, `parse_confidence`).
- Convert `Date` instances to ISO-8601 strings on the wire (zod's
  `z.string().datetime()` for timestamptz; `z.string().date()` /
  custom regex for `date`-typed columns).
- Convert Postgres `numeric(p,s)` columns to **strings**
  (`z.string().regex(/^\-?\d+(\.\d{1,2})?$/)`), matching the
  Drizzle posture (`numeric` → `string` per
  `data-pipeline/src/types.ts` precedent: the `RawEbayBrowsePrice…`
  schema). Avoids floating-point drift on the wire and gives
  consumers control over the formatter.
- UUIDs as strings via `z.string().uuid()`.
- Catalog tables (`set`, `card`, `printing`, `market`) are
  public-read and DTOs reflect the user-visible shape.
- Variant enums (`variant_class`, `variant_flags`, `rarity`,
  Pokémon type, card subtype, language) re-exported from
  `data-pipeline/src/types.ts` to keep one source of truth — but
  re-declared as locally-owned zod enums in
  `@binderly/api-contracts` so consumers don't transitively
  depend on `@binderly/data-pipeline` (which carries Sharp /
  AWS-SDK / Postgres-driver weight that mobile / web should never
  pull in). The two packages declare the same const tuples; a
  future contract test in `T-BE-API-CLIENT` can assert alignment
  if needed.

**WRITE DTOs (requests)** validate user input strictly:

- `.strict()` mode rejects unknown keys (server-side validation
  per `rules/02-backend.md`: "Freemium gating happens server-side,
  not just client-side").
- Required fields are explicit; optional fields use
  `.optional()` rather than `.nullable()` where missing means
  "don't change" (PATCH semantics).
- Numeric values are received as numbers (`z.number()`), not
  strings — the request layer is closer to the user, who sends
  JSON numbers; the server transforms to Postgres `numeric` at
  insert time.
- Whitelisted enums (condition, source, kind) are validated
  server-side via the same enums as the READ DTO, mirrored from
  `context/data-model.md`.

### D4 — API style: REST + JSON

`PROJECT.md` § 3 names Supabase Edge Functions as the backend
runtime; `rules/02-backend.md` describes Edge Functions returning
`{ ok, data | error }`. No tRPC, no GraphQL.

The contracts package therefore describes:

- Request bodies as zod schemas.
- Response bodies wrapped in the `apiResult<T>` discriminated union
  envelope (D6).
- Path/query parameters as zod schemas where they're non-trivial
  (cursor, filter sets).

The package is transport-agnostic — it doesn't know that the
endpoint is `POST /v1/collection/items` vs `RPC addCollectionItem`.
That mapping happens in `T-BE-EDGE-FUNCTIONS` and `T-BE-API-CLIENT`.

### D5 — Pagination: opaque base64 cursors

```ts
paginatedResponseSchema(itemSchema) = z.object({
  items: z.array(itemSchema),
  nextCursor: z.string().nullable(),  // null = last page
  total: z.number().int().nonnegative().optional(),  // server-side opt-in
});
```

Cursor is an opaque base64 string. Helpers (`encodeCursor`,
`decodeCursor`) ship in `src/common.ts` for server-side use; clients
treat it as opaque. `total` is optional because not every endpoint
can compute it cheaply (large catalog scans).

### D6 — Error envelope: discriminated-union result

Mirrors `rules/02-backend.md` ("Edge Functions return `{ ok, data |
error }`, the api-client unwraps") and `context/conventions.md`
(`{ ok: true, data } | { ok: false, error: { code, message } }`):

```ts
apiErrorSchema = z.object({
  code: z.enum(['VALIDATION', 'AUTH', 'NOT_FOUND', 'CONFLICT',
                'RATE_LIMIT', 'INTERNAL']),
  message: z.string().min(1),
  details: z.unknown().optional(),  // zod issues, etc.
});

apiResult<T>(dataSchema) = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: dataSchema }),
  z.object({ ok: z.literal(false), error: apiErrorSchema }),
]);
```

Codes intentionally include `RATE_LIMIT` because the eBay-Browse and
TCGdex adapters surface 429s on the data side and the user-facing
error map should distinguish "we hit a limit, retry" from
"INTERNAL". Consumers narrow on `result.ok` then read `result.data`
or `result.error`.

### D7 — Versioning

API version lives in the URL path (`/v1/cards/{id}`) — owned by
`T-BE-EDGE-FUNCTIONS`. The contracts package describes the
**current** shape. Breaking changes follow deprecate-and-remove:

1. Add new fields as optional first.
2. If a field's nullability or shape changes, add the new field
   alongside the old, deprecate the old one in JSDoc, and remove it
   in a follow-up release after consumers migrate.
3. Never silently flip a required field to optional or change a
   field's enum members in place.

Documented in `README.md` § "Evolving schemas without breaking
consumers".

### D8 — Build / test setup

- `pnpm --filter @binderly/api-contracts build` — `tsc -p .` to
  `dist/` (declarations + sourcemaps; `composite: true` per the
  library tsconfig).
- `pnpm --filter @binderly/api-contracts test` — `vitest run`.
- `pnpm --filter @binderly/api-contracts lint` — `eslint
  --max-warnings=0 .`.
- `pnpm --filter @binderly/api-contracts typecheck` — `tsc -p .
  --noEmit`.
- `pnpm --filter @binderly/api-contracts format` /
  `format:check` — Prettier with `@binderly/prettier-config`.

Test posture: each schema has at least one positive case (valid
input → `parse()` returns the typed value) and one negative case
(invalid input → `safeParse()` returns `{ success: false }` with
the expected error path / code). Tests live colocated as
`src/<module>.test.ts`.

### D9 — Public API discipline

`package.json` `exports` map only declares the root entry (`.`).
Consumers MUST import from `@binderly/api-contracts` (the barrel) —
deep imports like `@binderly/api-contracts/cards` are not exposed.
Tree-shaking handles the dead-code elimination. Same posture as
`@binderly/db` after Q-004 (`main` + `types` + `exports` map all
present at day one).

### D10 — Documentation

`packages/api-contracts/README.md` covers:

- What the package is (and is not).
- The module split (D2) at a glance.
- How to add a new DTO (file → schema → infer type → barrel
  re-export → test).
- The READ-vs-WRITE posture (D3) and zod conventions (`.strict()`
  on writes; `numeric` columns as strings on reads).
- Error envelope shape (D6) and result envelope helper.
- Pagination convention (D5).
- The additive-only evolution policy (D7).

## Deliverables

### Files created

- `packages/api-contracts/package.json` — workspace
  `@binderly/api-contracts`, ESM, `main` + `types` + `exports`,
  scripts (build / typecheck / lint / format / format:check / test).
- `packages/api-contracts/tsconfig.json` — extends
  `@binderly/tsconfig/library.json`.
- `packages/api-contracts/eslint.config.mjs` — extends
  `@binderly/eslint-config/node`; ignores `dist/**`, `coverage/**`;
  relaxes `no-explicit-any` in test files (matches the
  data-pipeline precedent).
- `packages/api-contracts/vitest.config.ts` — vitest 2.x config
  (mirrors `data-pipeline/vitest.config.ts`).
- `packages/api-contracts/README.md` — package documentation (D10).
- `packages/api-contracts/src/common.ts` — primitives, pagination,
  error envelope, result envelope, cursor helpers.
- `packages/api-contracts/src/cards.ts` — set / card / printing
  DTOs + variant / rarity / type / language enums.
- `packages/api-contracts/src/collection.ts` — collection-item /
  custom-collection / smart-rule DTOs + WRITE requests.
- `packages/api-contracts/src/pricing.ts` — market / price-aggregate
  / current-price / fx-rate DTOs + price-history query.
- `packages/api-contracts/src/grading.ts` — grading-submission DTO
  + write requests.
- `packages/api-contracts/src/shareables.ts` — shareable DTO +
  shareable-target discriminated union + write requests.
- `packages/api-contracts/src/auth.ts` — user / session / profile
  / profile-preferences / subscription DTOs + update-profile
  request.
- `packages/api-contracts/src/index.ts` — barrel.
- `packages/api-contracts/src/common.test.ts`
- `packages/api-contracts/src/cards.test.ts`
- `packages/api-contracts/src/collection.test.ts`
- `packages/api-contracts/src/pricing.test.ts`
- `packages/api-contracts/src/grading.test.ts`
- `packages/api-contracts/src/shareables.test.ts`
- `packages/api-contracts/src/auth.test.ts`

### Files modified (outside `owns_paths`, pre-authorized)

- `dependencies.yaml` — flip `T-BE-API-CONTRACTS` status from
  `in_progress` → `review`. Update `owns_paths` from the historical
  `packages/shared-types/` to the actual `packages/api-contracts/`
  (the orchestrator dispatch renamed the package; the yaml carries
  the older name from the original stub).
- `tasks/02-backend/T-BE-API-CONTRACTS.md` — flip status header to
  `review` after CI green; append `Notes from execution`.

`pnpm-workspace.yaml` already includes `packages/*`; no edit
needed.

## Acceptance criteria

- [ ] `packages/api-contracts/` exists as a workspace with a valid
  `package.json` (`name: @binderly/api-contracts`, `private: true`,
  `type: module`, `main` + `types` + `exports` all set).
- [ ] Every domain module from D2 ships as `src/<module>.ts` with
  zod schemas + inferred TS types.
- [ ] `src/common.ts` exports `apiResultSchema(<dataSchema>)`,
  `apiErrorSchema`, `paginatedResponseSchema(<itemSchema>)`,
  `encodeCursor` / `decodeCursor`, and the reusable primitive
  validators (UUID, ISO-8601 datetime, currency code,
  market code).
- [ ] `src/index.ts` re-exports every public symbol via named
  exports (no default exports anywhere).
- [ ] `package.json` `exports` map declares only the root entry
  (no deep-import paths exposed).
- [ ] Each schema has at least one positive test (valid input
  parses) and one negative test (invalid input is rejected).
- [ ] `pnpm --filter @binderly/api-contracts format:check` passes.
- [ ] `pnpm --filter @binderly/api-contracts lint` passes with
  `--max-warnings=0` (per `rules/02-backend.md` convention).
- [ ] `pnpm --filter @binderly/api-contracts typecheck` passes.
- [ ] `pnpm --filter @binderly/api-contracts test` passes (≥ 35
  tests covering positive + negative cases per schema).
- [ ] `pnpm --filter @binderly/api-contracts build` produces
  `dist/src/index.{js,d.ts}` and the imports resolve when consumed
  externally (smoke: `node -e 'import("@binderly/api-contracts")'`
  resolves under the package directory).
- [ ] Repo-wide `pnpm format:check` and `pnpm lint` pass — no
  regressions in other workspaces.
- [ ] GitHub Actions checks pass on the PR's branch HEAD.
- [ ] No new DB migration; no edits in `packages/db/` (read-only
  consumer of the schemas); no edits in `data-pipeline/` (zero
  coupling — see D3 rationale for re-declaring the enum tuples).
- [ ] No edits in `packages/auth/` or `apps/api/auth/` (T-BE-AUTH's
  scope; see Parallel-sibling note).

## Out of scope

- HTTP / fetch / RPC client (`T-BE-API-CLIENT`).
- Edge Function route handlers (`T-BE-EDGE-FUNCTIONS`).
- Supabase Auth wiring (`T-BE-AUTH`).
- Smart-DSL schema (`T-SP-SMART-DSL` will define the
  `smartRule.expression` shape — `smartCollectionRuleDto.expression`
  here is `z.unknown()` with a comment pointing at that future
  contract, mirroring `data-pipeline`'s own posture for
  `smart_collection_rule.expression`).
- Set-completion math types (`T-SP-SET-COMPLETION`).
- Pricing display formatting (`T-SP-PRICING-DISPLAY`).
- A multi-version (v1 / v2) compatibility shim — versioning lives in
  the URL path, not in this package.
- A contract test asserting `@binderly/api-contracts` enum tuples
  match `@binderly/data-pipeline`'s tuples — desirable, but
  introducing a `data-pipeline` dev dependency just to test that
  is wrong (mobile / web must not pull in Sharp / AWS-SDK
  transitively even at devtime). The two tuples are short
  (~25 entries combined) and a manual diff at PR review is the
  current safety net; if the package ever falls out of sync we
  add an alignment test in `T-BE-API-CLIENT` (which already
  depends on both packages).

## Branch & PR

- Branch: `agent/T-BE-API-CONTRACTS` (already created from
  `origin/main` at `b7264c0`).
- PR title: `T-BE-API-CONTRACTS: shared API contracts package
  (zod + types)`.
- Commit format: Conventional Commits.

PR body must include (per dispatch instructions):

1. Phase 1 elaboration decisions (numbered list — D1..D10 above).
2. Phase 2 files added.
3. Test counts (this is a brand-new package; baseline 0).
4. Module map (which file holds what DTOs).
5. Note that this PR opens Phase 2.

## Escalation triggers

Stop and escalate to orchestrator (via `open-questions.md` append)
if:

- A required dependency turns out to be wrong/missing (e.g. a Phase 1
  table this package mirrors hasn't actually merged at HEAD).
- The dispatch's API style assumption (REST + JSON via Edge
  Functions) conflicts with anything in `PROJECT.md` (the dispatch
  asked "REST vs tRPC vs etc." — the elaborated answer in D4 is
  REST per PROJECT.md § 3 and `rules/02-backend.md`; if the spec
  ever flips, pause and re-elaborate).
- A change is needed outside the pre-authorized files
  (`packages/api-contracts/**`, `dependencies.yaml`,
  `tasks/02-backend/T-BE-API-CONTRACTS.md`).
- The `profile.preferences` shape from `context/data-model.md`
  needs widening beyond the documented keys (the data model says
  "any additions are backward-compatible optional fields" — that's
  the rule we ship today).

## Notes from execution

_(Sub-agent appends here at end of work. Empty until then.)_
