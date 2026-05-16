# T-W-SMART — Web smart collections (search free, save paid; gated UI)

**Stage:** 04-web
**Agent role:** frontend-web
**Effort:** L
**Status:** in_progress

---

## Goal

Ship the **smart collections** experience on web at `/collections/smart`:
list of the user's saved smart collections (paid feature; gated), a
"New / Try" editor where users write a JSON DSL expression and run it
against the catalog (search is FREE; save is PAID — gated UI with
upsell), and a result view showing matched printings. Auth-gated.

Smart collections are saved as a `custom_collection` with `kind:
'smart'` and an attached `smart_collection_rule` row. The wire is
already there in `@binderly/api-client` (`createCustomCollection({
kind: 'smart', expression })` plus `getSmartCollectionRule` /
`updateSmartCollectionExpression`). The DSL package
(`@binderly/smart-collection-dsl`, merged at iter 16) provides
`safeParseExpression`, `evaluateExpression`, `explainExpression`
which we wire into the editor.

## Architectural decisions

1. **Client-side evaluation for v1.** The brief recommends client-side,
   and we agree: we fetch the catalog roster the user wants to evaluate
   against (capped at MAX_PREVIEW_ITEMS = 200 printings to keep the
   in-browser fan-out bounded), project each `(card, set, printing,
   collection)` tuple into a `CandidateItem`, and run
   `evaluateExpression()` over each one. Server-side compile-to-SQL
   via the edge function is post-v1 — the DSL package's
   `expressionToSql()` is ready when that work lands. Documented in
   `apps/web/lib/collections/smart/api.ts`'s file-header.

2. **Plan-gating.** Pulled from `client.profile.getMySubscription()`
   (`tier === 'pro'` ⇒ paid, otherwise free). The list page shows
   the user's saved smart collections only when paid. The editor's
   "Save" button is disabled for free users with an upsell tooltip.
   Detail pages render an upgrade CTA for free users instead of
   crashing.

3. **DSL editor UX.** Plain `<textarea>` accepting raw JSON. We
   parse with `safeParseExpression(JSON.parse(text))`. On parse
   success we render the `explainExpression` output below; on
   failure we render the `SmartDslParseError` message inline. Only
   when parse succeeds do we enable the Run + Save buttons. A
   visual tree builder is future work.

4. **Save flow.** Optimistic? No — we wait for the
   `createCustomCollection({ kind: 'smart', ... })` response and
   redirect to `/collections/smart/[id]` on success. If save
   fails, surface the error inline; the editor keeps its
   expression so the user can retry. Slug is generated from the
   user-supplied name (lowercase, kebab-case).

5. **Member count + last-evaluated timestamp.** Until the server
   computes these, we render placeholders and the detail page's
   "re-run on load" populates them client-side.

## Owns paths

- `apps/web/app/collections/smart/`

## Pre-authorized "outside owns_paths" edits

- `apps/web/components/collections/smart/`
- `apps/web/lib/collections/smart/`
- `pnpm-lock.yaml`
- `apps/web/package.json` — added `@binderly/smart-collection-dsl`
  workspace dep
- `dependencies.yaml` — status flip
- `tasks/04-web/T-W-SMART.md` — this file
- `open-questions.md` — append-only

## Reading list (read in order before implementation)

1. `PROJECT.md` § 9 (Custom & Smart Collections) and § 16 (Freemium)
2. `rules/04-web.md`
3. `apps/web/app/layout.tsx`,
   `apps/web/components/providers/AuthProvider.tsx`,
   `apps/web/lib/api-client.ts`, `apps/web/lib/supabase-browser.ts`
4. `apps/web/app/collection/page.tsx` +
   `apps/web/components/collection/{CollectionRoute,CollectionView,SignInPrompt}.tsx`
5. `apps/web/app/browse/` + `apps/web/components/browse/PrintingThumbnail.tsx`
6. `packages/smart-collection-dsl/src/{index,parse,evaluate,explain,types}.ts`
7. `packages/api-client/src/resources/collection.ts` (smart-collection wire)
8. `infra/supabase/functions/_shared/handlers/customCollections.ts` (server contract)
9. `dependencies.yaml` — confirm `depends_on: [T-W-COLLECTION, T-SP-SMART-DSL]`

## Definition of done (testable acceptance criteria)

1. `pnpm install` succeeds.
2. `pnpm --filter @binderly/web typecheck` succeeds.
3. `pnpm --filter @binderly/web lint` succeeds.
4. `pnpm --filter @binderly/web test` succeeds with **at least 30
   tests** covering:
   - `/collections/smart` shows sign-in prompt for signed-out user
   - free-tier user sees empty state + upgrade CTA (no saved list)
   - paid-tier user sees list of saved smart collections from
     mocked api-client
   - "Try a smart query" navigates to `/collections/smart/new`
   - `/collections/smart/new` editor parses input live and shows
     explain output
   - parse error shows inline when expression is malformed
   - Run button evaluates against mocked printings, shows match
     count + result grid
   - "Save" button disabled for free users with upsell tooltip;
     enabled for paid users
   - Save flow (paid): opens modal, submits, redirects to
     `/collections/smart/[id]`
   - `/collections/smart/[id]` re-runs expression on load + renders
     members
   - `/collections/smart/[id]` 404 for unknown id
   - delete flow on saved collection
   - error state when api-client throws
5. `pnpm --filter @binderly/web build` succeeds with NO env vars
   set (lazy-init pattern).
6. Replace STUB above with full elaboration (this commit).
7. Commit with Conventional Commits. PR title:
   `feat(web): T-W-SMART — smart collections (search free, save paid)`
8. Push, open PR, wait for CI green. Do not merge.

## What NOT to build

- No subscription/billing flow (upgrade button is a placeholder).
- No DSL visual tree builder (textarea + explain output is enough
  for v1; visual builder is future work).
- No background re-evaluation (smart collections are re-run on
  page load for v1; nightly server-side recompute is future).
- No custom collections (sibling T-W-CUSTOM).
- No sharing.

## Branch & PR

- Branch: `agent/T-W-SMART`
- PR title: `feat(web): T-W-SMART — smart collections (search free, save paid)`

## Notes from execution
_(updated by sub-agent during execution)_
