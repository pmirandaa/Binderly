# @binderly/smart-collection-dsl

Pure-logic Smart Collection DSL. The schema, parser, evaluator, SQL
compiler, and human explainer for the rule expressions that drive
Binderly's smart custom collections (PROJECT.md § 9).

## What lives here

- `src/types.ts` — AST types, the `Field` allowlist, per-field
  metadata.
- `src/schema.ts` — canonical zod schema (`expressionSchema`).
- `src/parse.ts` — `parseExpression(unknown): Expression` plus typed
  `SmartDslParseError`.
- `src/evaluate.ts` — `evaluateExpression(expr, item): boolean`.
- `src/sql.ts` — `expressionToSql(expr, opts): { sql, params }`.
- `src/explain.ts` — `explainExpression(expr): string`.

## Constraints

- **No I/O.** Every export is a pure function.
- **No Turing-completeness.** AND / OR / NOT / EQ / IN / RANGE /
  EXISTS only. No loops, no functions, no user-defined operators.
- **SQL injection safe.** The compiler ALWAYS uses parameterized
  queries — no code path interpolates user values into the SQL
  string.
- **Field allowlist.** Only fields enumerated in `types.ts`'
  `FIELD_DEFS` are accessible. Adding a field is a code change.
- **Bounded nesting.** Default max depth is 8 levels.

## Operator surface

| Operator     | Valid on                                                 | Semantics                                                                        |
| ------------ | -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `and` / `or` | —                                                        | Short-circuit boolean combination of children.                                   |
| `not`        | —                                                        | Negation of a single child.                                                      |
| `eq`         | string / enum / number / date / boolean / enumArray      | Equality (or "array contains" on enumArray).                                     |
| `in`         | string / enum / number / date / boolean / enumArray      | Membership (or "array overlaps" on enumArray).                                   |
| `range`      | number / date                                            | Closed-by-default interval; `minInclusive` / `maxInclusive` flip to open bounds. |
| `exists`     | nullable fields, plus the synthetic `collection.isOwned` | "is the column non-null?" (`exists: true`) or null (`exists: false`).            |

## NULL semantics

Every leaf comparison is wrapped in `(... ) IS TRUE` in the emitted
SQL, which collapses NULL to FALSE before the surrounding NOT / AND /
OR sees it. The evaluator mirrors this — null/undefined operands
short-circuit a leaf to false. The two compilers therefore agree on
every well-formed input; the round-trip property test in
`src/sql.test.ts` verifies the agreement on a generated corpus.

## Wiring with `@binderly/api-contracts`

The contracts package keeps `smartExpressionSchema` opaque
(`z.custom<unknown>`) so importing it doesn't drag this package in
where it isn't needed. A follow-up task wires
`smartExpressionSchema` to delegate to `expressionSchema` here at
the API boundary.

Until that lands, downstream code imports the schema directly:

```ts
import { parseExpression, type Expression } from '@binderly/smart-collection-dsl';

const expr: Expression = parseExpression(jsonFromTheWire);
```

## Example

```ts
import {
  evaluateExpression,
  expressionToSql,
  parseExpression,
  explainExpression,
} from '@binderly/smart-collection-dsl';

// "All Holo Charizards from any Sword & Shield-era set, PSA 9 or
// better."
const expr = parseExpression({
  type: 'and',
  children: [
    { type: 'eq', field: 'card.name', value: 'Charizard' },
    { type: 'eq', field: 'printing.variantClass', value: 'HOLO' },
    { type: 'eq', field: 'set.series', value: 'Sword & Shield' },
    { type: 'eq', field: 'collection.gradeCompany', value: 'PSA' },
    {
      type: 'range',
      field: 'collection.grade',
      min: 9,
      minInclusive: true,
    },
  ],
});

evaluateExpression(expr, candidateItem); // => boolean
expressionToSql(expr); // => { sql, params }
explainExpression(expr);
// => "card name is Charizard and variant is Holo and set series is Sword & Shield ..."
```

## Testing

```
pnpm --filter @binderly/smart-collection-dsl test
```
