# Conventions

Code style, naming, file layout, commits. Follow these without exception
unless a task explicitly carves out an exception.

## TypeScript

- `strict: true`. No implicit any. `noUncheckedIndexedAccess: true`.
- Prefer `interface` for object shapes that may be extended; `type` for
  unions, intersections, and utility types.
- Public exports from any package have explicit return types. Internal
  helpers can infer.
- No default exports except for Next.js page/layout files where the
  framework requires it. Named exports everywhere else.
- `import type` for type-only imports.
- File length soft cap: 300 lines. Split before then.

## Naming

- Files: kebab-case (`set-completion.ts`, not `setCompletion.ts`).
- React components: PascalCase, one component per file, file named the same
  as the component (`CardGrid.tsx`).
- Variables/functions: camelCase.
- Constants/enums: SCREAMING_SNAKE_CASE for genuinely constant values, enum
  *members* SCREAMING_SNAKE_CASE.
- DB columns and table names: snake_case.
- React hooks: `use…` prefix, return tuples or named objects consistently
  within a package.
- Test files: `<filename>.test.ts` colocated.

## Imports

- Absolute imports via `@binderly/<package>` for shared packages.
- Relative imports within a package, only up to two levels (`../../`). If
  you need `../../../`, you have a structural problem — fix the structure.
- Sorted: external → `@binderly/*` → relative. Enforced via eslint.

## React / RN

- Function components only.
- Server components by default in Next.js; mark client with `"use client"`
  only when needed.
- No `React.FC`. Type props explicitly.
- No `any`. If you must, `unknown` and narrow.
- Avoid prop drilling more than 2 levels — use context or zustand store.

## Error handling

- API responses use a discriminated union: `{ ok: true, data } | { ok:
  false, error: { code, message } }`. The api-client unwraps.
- Internal functions throw typed errors (`class NotFoundError extends Error`
  etc.). Top-level handlers catch and translate.
- Never `catch` and silently swallow. Log via observability or rethrow.

## Tests

- **Vitest** for TS packages. **Jest + react-native-testing-library** for
  mobile. **Playwright** for web E2E.
- Pure functions: unit-tested. Aim for ≥80% line coverage on
  `packages/set-completion`, `packages/smart-collection-dsl`, the
  variant classifier, and the master-set rules engine — these are
  high-leverage pure logic.
- DB-touching code: integration tests against the Dockerized local
  Postgres.
- E2E: a thin smoke layer covering critical flows (sign in, add card,
  scan one card, view shareable). Not exhaustive.
- Snapshots only for stable rendered outputs. No giant component snapshots.

## Commits

Conventional Commits.

```
feat(scanner): add ANN index loader
fix(web): correct set ordering on browse page
docs(spec): update master set rules for Trainer Gallery
build: bump turbo to 2.x
test(set-completion): cover mixed-language All Pokémon %
```

Scopes match package or app names.

## PRs

- Title = `T-XX-XXX: <task title>` for agent PRs. Human PRs free-form.
- Body uses the PR template (.github/pull_request_template.md). Sections:
  *What*, *Why*, *Acceptance*, *Notes*, *Out of scope*.
- Squash-merge to main. Linear history.
- Branch deleted on merge.

## Files in shared packages

Each package follows:

```
packages/<name>/
  package.json
  tsconfig.json
  src/
    index.ts          # public exports only
    <feature>.ts
    <feature>.test.ts
  README.md           # what it is, what it isn't
```

`index.ts` is the only file external consumers may import from. Internal
modules can import freely between each other.

## Database migrations

- One migration per logical change.
- File names: `NNNN_<snake_case_summary>.sql` (numeric, sequential).
- Each migration reversible where reasonable; if not, document in a comment.
- RLS policy changes ship in their own migration.

## Secrets

- Never committed.
- `.env.local` for personal dev; `.env.example` is the template.
- Production secrets via Vercel / Fly / Supabase / GH Actions secret
  managers.
- CI never logs env values.

## Logging

- Server: structured JSON logs (pino). One log line per request with
  fields `request_id`, `user_id`, `route`, `duration_ms`, `status`.
- Mobile/web: don't log PII. Sentry breadcrumbs and PostHog events only.

## Internationalization

- All user-facing strings go through next-intl on web and an equivalent
  helper on mobile (deferred — at minimum, wrap strings so they're easy
  to extract later).
- "Pokémon" with the accent in EN copy.
- Number formatting and dates use locale-aware formatters from day one.

## Accessibility

- All interactive elements keyboard-accessible (web).
- All images have alt text.
- Color contrast WCAG AA.
- Mobile: respect Dynamic Type / large text. Don't hardcode font sizes
  outside the design tokens.
