# `@binderly/api-contracts`

Shared API contracts for Binderly: zod schemas + inferred
TypeScript types for every wire-format DTO consumed by web,
mobile, scanner, edge functions, and shareable SSR.

This is a **pure types package**. It ships no IO, no fetch
client, no route handlers — just the schemas that pin the
request and response shapes between every Binderly surface.

## What this package is

- **The single source of truth for the API wire format.** Every
  endpoint's request body and response payload is defined here
  as a zod schema with a `z.infer<>` TypeScript type.
- **Read-only of the DB schema.** Mirrors the Drizzle tables in
  `@binderly/db`, exposing the externally-useful subset of each
  row (drops `source_metadata`, `raw_metadata`, `image_source_url`,
  pipeline-internal provenance, etc).
- **Transport-agnostic.** Doesn't know whether a DTO is sent as
  `POST /v1/cards` JSON or via a tRPC procedure. The API path /
  versioning concern lives in `T-BE-EDGE-FUNCTIONS`.

## What this package is NOT

- **Not an HTTP / fetch / RPC client.** That's
  `@binderly/api-client` (T-BE-API-CLIENT).
- **Not the smart-DSL schema.** `smartCollectionRuleDto.expression`
  here is `z.unknown()`; the typed DSL ships in
  `@binderly/smart-collection-dsl` (T-SP-SMART-DSL).
- **Not the runtime mechanics of Supabase Auth.** The auth
  module here describes the _wire shape_ of a session / profile /
  subscription. T-BE-AUTH owns the OAuth callback + JWT
  verification.

## Module map

| File                | DTOs                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `src/common.ts`     | Primitive validators (UUID, ISO-8601 datetime, ISO date, currency code, language code, market code, the Drizzle-style `numeric(p,s)` wire form), grade-tier + card-condition enums, error envelope (`apiErrorSchema`), discriminated-union result envelope (`apiResultSchema`), pagination wrapper (`paginatedResponseSchema`), opaque-base64 cursor encode/decode helpers. |
| `src/cards.ts`      | Variant taxonomy enums (variant class / flag / rarity / Pokémon type / card subtype), `setDto`, `cardDto`, `printingDto`, plus composite `cardWithPrintingsDto` and `printingWithContextDto`.                                                                                                                                                                               |
| `src/collection.ts` | `collectionItemDto` (READ), `customCollectionDto`, `customCollectionItemDto`, `smartCollectionRuleDto`, plus WRITE shapes (`addCollectionItemRequest`, `updateCollectionItemRequest`, `createCustomCollectionRequest`, `updateCustomCollectionRequest`, `addPrintingToCustomCollectionRequest`, `updateSmartCollectionExpressionRequest`).                                  |
| `src/pricing.ts`    | `marketDto`, `priceAggregateDto`, `currentPriceDto` (the `mv_current_price` row), `fxRateDto`, `priceHistoryQuery`.                                                                                                                                                                                                                                                         |
| `src/grading.ts`    | `gradingSubmissionDto`, `predictedScoresSchema`, `actualGradeSchema`, plus WRITE shapes (`submitGradingPredictionRequest`, `attachActualGradeRequest`, `updateGradingSubmissionStatusRequest`).                                                                                                                                                                             |
| `src/shareables.ts` | `shareableDto`, `shareableTarget` (discriminated union over `'full'                                                                                                                                                                                                                                                                                                         | 'custom'`), built-in theme tokens, plus WRITE shapes (`createShareableRequest`, `updateShareableRequest`). |
| `src/auth.ts`       | `userDto` (public-safe subset of `auth.users`), `sessionDto`, `profileDto`, `profilePreferencesSchema` (the contractual `profile.preferences` shape), `subscriptionDto`, `updateProfileRequest`.                                                                                                                                                                            |
| `src/index.ts`      | Public barrel — every external import goes through here.                                                                                                                                                                                                                                                                                                                    |

## Usage

```ts
import {
  apiResultSchema,
  apiErrorSchema,
  cardDto,
  type CardDto,
  type ApiResult,
} from '@binderly/api-contracts';

const cardResult = apiResultSchema(cardDto);
type CardResult = ApiResult<CardDto>;

// Server-side: shape the response
return new Response(JSON.stringify(cardResult.parse({ ok: true, data: card })), {
  headers: { 'content-type': 'application/json' },
});

// Client-side: validate the response
const parsed = cardResult.parse(await response.json());
if (parsed.ok) {
  // parsed.data is CardDto
} else {
  // parsed.error is ApiError
}
```

## Conventions

### READ vs WRITE DTOs

- **READ DTOs** (responses) expose the externally-useful subset
  of the underlying DB row. Pipeline-internal columns
  (`source_metadata`, `raw_metadata`, `image_source_url`) are
  dropped. Postgres `numeric(p,s)` columns serialize as strings
  on the wire (`'12.34'`, not `12.34`) to avoid floating-point
  drift; consumers use `T-SP-PRICING-DISPLAY` to format.
- **WRITE DTOs** (requests) validate user input strictly via
  `.strict()`. Numeric values arrive as JSON numbers; the
  server transforms to `numeric` at insert time. PATCH bodies
  use `.refine(...)` to reject fully-empty payloads.

### Error envelope

All endpoints return:

```ts
{ ok: true, data: <T> } | { ok: false, error: ApiError }
```

`ApiError` is `{ code, message, details? }` with a fixed enum of
codes:

```
'VALIDATION' | 'AUTH' | 'NOT_FOUND' | 'CONFLICT' | 'RATE_LIMIT' | 'INTERNAL'
```

### Pagination

List endpoints return `{ items, nextCursor, total? }`:

- `nextCursor` is opaque base64 (use `encodeCursor` /
  `decodeCursor` from `common.ts`); `null` on the last page.
- `total` is optional — endpoints that can't compute it cheaply
  omit it.

### Versioning

The API version (`/v1/`, `/v2/`) lives in the URL path, owned by
`T-BE-EDGE-FUNCTIONS`. **This package always describes the
_current_ shape.** Older versions are reachable via separate
endpoint paths if/when we ever bump major; this package is not
multi-version.

## Adding a new DTO

1. Pick the right module file (`cards.ts` for catalog,
   `collection.ts` for user-owned, `pricing.ts` for monetary,
   etc).
2. Define a zod schema. Use `.strict()` on object schemas so
   unknown keys are rejected. Use the primitives from `common.ts`
   for cross-cutting types (UUID, datetime, currency).
3. Export the schema as a const and the inferred type via
   `export type Foo = z.infer<typeof fooDto>;`.
4. The `src/index.ts` barrel re-exports everything via
   `export * from './<file>.js';` — no manual barrel update is
   needed for new exports in an existing module.
5. Add tests next to the schema (`<file>.test.ts`): at least one
   positive case (valid input parses) and one negative case
   (invalid input is rejected).

## Evolving schemas without breaking consumers

This package follows an **additive-only evolution policy**:

- **Add a new optional field?** Always safe.
- **Add a new enum member?** Safe to _add_, but consumers may
  have exhaustive `switch` statements that don't yet handle the
  new value. Roll out the consumer first when possible.
- **Tighten validation (e.g. shorten max length, narrow regex)?**
  Treated as breaking — bump the API version path
  (`/v1/` → `/v2/`).
- **Remove a field?** Treated as breaking — same.
- **Flip nullability?** Treated as breaking — same. Document
  the deprecation in JSDoc, ship the new shape alongside the
  old, remove the old once consumers migrate.

In short: never silently change a field's shape, nullability, or
removal status. Adding optional fields and adding enum members
is the safe path.

## Package gates

```bash
pnpm --filter @binderly/api-contracts format:check
pnpm --filter @binderly/api-contracts lint
pnpm --filter @binderly/api-contracts typecheck
pnpm --filter @binderly/api-contracts test
pnpm --filter @binderly/api-contracts build
```

All five must pass clean (no warnings, no errors) before a PR
that touches this package can land.

## Related tasks

- **T-BE-API-CLIENT** — typed fetch client built on these DTOs.
- **T-BE-EDGE-FUNCTIONS** — Supabase Edge Functions that
  validate request bodies against the WRITE DTOs and return
  `apiResultSchema`-shaped responses.
- **T-BE-AUTH** — Supabase Auth wiring that consumes
  `userDto` / `sessionDto` / `profileDto` from this package.
- **T-SP-SET-COMPLETION** — set-completion math that returns
  shapes from this package.
- **T-SP-SMART-DSL** — defines the actual smart-collection
  expression schema; consumers parse
  `smartCollectionRuleDto.expression` (currently `unknown`)
  with the DSL package's schema.
- **T-SP-PRICING-DISPLAY** — formats `priceAggregateDto` /
  `currentPriceDto` for display, applying FX conversion via
  `fxRateDto`.
