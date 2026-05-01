# Stage 03 — Shared Packages rules

Pure logic packages used by web and mobile. The set completion math, the
smart collection DSL, and the design tokens live here.

## Required reading

- `PROJECT.md` § 8 (Master Set), § 9 (Custom & Smart)
- `context/tcg-domain.md`
- `context/data-model.md`
- `context/conventions.md`

## Hard rules

- **Zero side effects on import.** No `console.log`, no global state, no
  module-level fetches. These packages run in node, browser, and React
  Native runtimes — anything not pure breaks one of them.
- **No platform-specific imports.** No `react-native`, no `next/*`, no
  `node:fs` (use `node:` prefix only in CLI tools, not shared packages).
- **Tree-shakable.** Named exports only from `index.ts`. No barrel files
  that pull everything in.
- **High test coverage.** Set completion, smart-collection DSL, and the
  master-set rules engine are pure logic — they should be ≥90% line
  covered with property-based tests where natural (fast-check).
- **Tamagui tokens, not raw values.** UI package exposes tokens (color,
  space, font, radius); no hex codes in component code.

## Conventions specific to this stage

- DSL ASTs are zod-schema-validated at every boundary. Never trust an
  expression that hasn't been parsed.
- Set completion functions are pure: `(printings, ownership, rules) =>
  result`. Side effects (DB reads) happen in the caller.
- UI components have a "Story" file (`.stories.tsx`) that runs in
  Storybook (web) for visual review. Mobile gets visual review in dev
  builds.

## Common pitfalls

- Tamagui's compiler has setup gotchas across Next.js + Expo. The
  T-SP-UI-TOKENS task includes verifying both build pipelines.
- The smart DSL is tempting to over-design. v1 covers the use cases in
  `PROJECT.md` § 9. No "graph queries", no "sub-selects". Boolean
  combinations of field predicates are enough.

## Done when

- `packages/set-completion`, `packages/smart-collection-dsl`, `packages/ui`
  build, test, and publish (workspace-internal) cleanly.
- Web and mobile both successfully import a token from `packages/ui` and
  render with it.
- The DSL evaluator can answer every example in `PROJECT.md` § 9 against
  a fixture catalog.
