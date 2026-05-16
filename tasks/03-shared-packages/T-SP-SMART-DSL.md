# T-SP-SMART-DSL — Smart Collection DSL — schema, parser, evaluator

**Stage:** 03-shared-packages
**Agent role:** backend
**Effort:** L
**Status:** in_progress

## Hard dependencies

- T-BE-API-CONTRACTS (merged) — `smartExpressionSchema` lives in
  `packages/api-contracts/src/collection.ts` as a `z.custom<unknown>`
  placeholder. This task owns the actual schema.

## Soft dependencies

- T-DL-SCHEMA-CARDS / T-DL-SCHEMA-COLLECTIONS / T-DL-SCHEMA-CUSTOM (merged) —
  the underlying `card` / `printing` / `set` / `collection_item` columns
  define the field allowlist.

## Required reading

- `PROJECT.md` § 9 (Custom & Smart Collections)
- `rules/03-shared-packages.md` (zero side-effects, ≥90% coverage)
- `packages/api-contracts/src/collection.ts` (`smartExpressionSchema`)
- `packages/api-contracts/src/cards.ts` (DTO + variant enums)
- `packages/db/src/schema/{cards,printings,sets,collections,smart_rules}.ts`

## Goal

Build a pure-logic shared package — `@binderly/smart-collection-dsl` —
that owns the small typed expression language users write to describe
smart-collection slices ("all base-holo Charizards from Vintage", "every
PSA 9+ alt-art trainer in SWSH"). The DSL is the schema, parser,
evaluator, and SQL compiler all in one place; the API contract package
delegates `smartExpressionSchema` validation here at the next pass; the
backend evaluator + UI explainer share this single source of truth.

The expression language is strictly bounded — boolean combinations
(AND / OR / NOT) of leaf predicates (EQ, IN, RANGE, EXISTS) over a
fixed allowlist of fields drawn from the printing / card / set /
collection-item DTOs. No loops, no functions, no user-defined
operators, no arbitrary string interpolation. The compiler always
emits parameterized SQL.

## Deliverables

- `packages/smart-collection-dsl/package.json` — workspace package
  metadata (name `@binderly/smart-collection-dsl`, mirror auth /
  api-contracts shape).
- `packages/smart-collection-dsl/tsconfig.json` — extends
  `@binderly/tsconfig/library.json`.
- `packages/smart-collection-dsl/eslint.config.js` — node preset.
- `packages/smart-collection-dsl/vitest.config.ts` — vitest with v8
  coverage.
- `packages/smart-collection-dsl/.prettierignore` — `dist/`,
  `node_modules/`, `coverage/`.
- `packages/smart-collection-dsl/README.md` — package overview, DSL
  shape, examples, testing posture.
- `packages/smart-collection-dsl/src/types.ts` — AST node types
  (`AndNode`, `OrNode`, `NotNode`, `EqNode`, `InNode`, `RangeNode`,
  `ExistsNode`), the `Expression` discriminated union, the `Field`
  allowlist with per-field metadata (kind, sql column, nullable).
- `packages/smart-collection-dsl/src/schema.ts` — canonical zod schema
  validating shape, field allowlist, type-matched operands, and
  max-depth (8).
- `packages/smart-collection-dsl/src/parse.ts` — `parseExpression(json:
  unknown): Expression` plus typed `SmartDslParseError`. Normalizes
  nested AND/OR and collapses double NOT.
- `packages/smart-collection-dsl/src/evaluate.ts` —
  `evaluateExpression(expr, item: CandidateItem): boolean`. Pure.
- `packages/smart-collection-dsl/src/sql.ts` —
  `expressionToSql(expr, opts): { sql: string; params: unknown[] }`.
  Always parameterized; never inlines values.
- `packages/smart-collection-dsl/src/explain.ts` —
  `explainExpression(expr): string`. Literal English (i18n deferred).
- `packages/smart-collection-dsl/src/index.ts` — public barrel.
- Test files for every module + a property-based round-trip test
  comparing evaluator vs SQL output via an in-memory interpreter that
  parses the exact grammar emitted by `expressionToSql`.

## Acceptance criteria

- [ ] `pnpm --filter @binderly/smart-collection-dsl build` succeeds.
- [ ] `pnpm --filter @binderly/smart-collection-dsl typecheck` passes.
- [ ] `pnpm --filter @binderly/smart-collection-dsl lint` passes with
      `--max-warnings=0`.
- [ ] `pnpm --filter @binderly/smart-collection-dsl test` passes with
      120–200 tests.
- [ ] Schema rejects unknown field names, mistyped operands (e.g. `range`
      on a string field), and expressions deeper than 8.
- [ ] Parser flattens nested AND/OR and collapses double NOT
      idempotently.
- [ ] Evaluator and SQL compiler agree on a generated corpus of random
      valid expressions and items (round-trip property test).
- [ ] SQL compiler verified injection-safe: a value containing
      `'; DROP TABLE x;--` ends up as a parameter, never inlined.
- [ ] Explainer emits a non-empty human-readable string for every node
      type.
- [ ] No changes outside `owns_paths` except the three pre-authorized
      files (`pnpm-lock.yaml`, `dependencies.yaml`, this task file).

## Out of scope

- Wiring `smartExpressionSchema` in `@binderly/api-contracts` to
  delegate here — that lands as a follow-up bump after this PR
  merges. The contract is documented in this README for the wiring
  task to consume.
- Any `infra/supabase/functions/` work (T-BE-EDGE-FUNCTIONS owns).
- Any `packages/set-completion/` work (T-SP-SET-COMPLETION owns).
- Persisting / caching evaluation results (caller's concern).
- i18n of explainer output (literal English for v1; flagged in PR
  body).

## Branch & PR

- Branch: `agent/T-SP-SMART-DSL`
- PR title: `T-SP-SMART-DSL: Smart Collection DSL — schema, parser, evaluator`
- Commit format: Conventional Commits.

## Escalation triggers

Stop and append to `open-questions.md` if:

- The DSL needs a feature beyond AND/OR/NOT/EQ/IN/RANGE/EXISTS for v1.
- A column we'd want to expose isn't on the DTO (would need an
  api-contracts change).
- The SQL compiler can't produce a clean parameterized form for some
  operator without a stored function or migration change.

## Notes from execution

- **NULL semantics chosen.** Every leaf comparison emits `(... ) IS
  TRUE` so NULLs collapse to FALSE before `NOT` / `AND` / `OR`
  consider them. The evaluator mirrors this — null/undefined
  operands short-circuit a leaf to false. Without this, the
  evaluator and the SQL compiler would diverge under `NOT eq(...)`
  on a NULL-valued row (SQL would yield `NULL` → filtered out;
  the JS evaluator would yield `true` after negation). This is the
  load-bearing design decision that makes the round-trip property
  test pass.
- **`collection.isOwned` is a synthetic boolean.** Compiles to
  `<alias>.id IS NOT NULL`, assuming the caller LEFT JOINs
  `collection_item` filtered by user_id. Documented in
  `src/sql.ts` and the README; the join is a query-shape concern
  the backend evaluator owns, not the DSL.
- **`api-contracts` wiring is a follow-up.** The contracts package
  keeps `smartExpressionSchema` opaque (`z.custom<unknown>`) so
  importing it doesn't pull this package into transitive graphs
  that don't need it. The README has a snippet showing how
  consumers parse expressions today; a small follow-up task can
  switch `smartExpressionSchema` to delegate to
  `expressionSchema` without API churn.
- **Round-trip property test approach.** Wrote a tiny
  recursive-descent SQL interpreter (~120 LOC) that knows the
  exact grammar `expressionToSql` emits. Runs the evaluator and
  the SQL interpreter against 200 randomly-generated
  (expression, item) pairs (deterministic Mulberry32 PRNG seed)
  and asserts identical truth values. Avoids the fast-check
  dependency.
- **i18n is deferred.** Explainer outputs literal English. v1
  decision; flagged here for translation tooling later (string
  keys + ICU plurals).
- **Test count.** 212 tests (slightly above the 120–200 aim);
  every leaf operator gets explicit positive + negative cases,
  and the property test runs 200 random expressions against the
  agreement check.
