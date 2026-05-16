# T-M-CUSTOM — Mobile custom + smart collections (with gating)

**Stage:** 05-mobile
**Agent role:** frontend-mobile
**Effort:** L
**Status:** in_review

## Hard dependencies

- T-M-COLLECTION (merged) — provides `useAuth()`, the `/auth/sign-in`
  route, the `useApiClient()` singleton, the `useCollectionItemsQuery`
  / `useOwnedPrintingsContextQuery` data hooks (re-used by the
  smart editor's preview), and the `vi.hoisted({ routerMocks })`
  test pattern.
- T-SP-SMART-DSL (merged) — provides the `@binderly/smart-collection-dsl`
  package: `parseExpression`, `evaluateExpression`,
  `explainExpression`, `isSmartDslParseError`, plus the `Expression`
  AST and `SmartDslParseError` types that the editor surface
  rounds-trips through.

## Soft dependencies

- T-BE-EDGE-FUNCTIONS — provides the typed API client surface this
  task drives: `customCollection.{list,get,create,update,delete}`,
  `customCollection.{listItems,addPrinting,removePrinting}`, and the
  `smartCollectionRule.{get,upsert,delete}` operations.
- T-W-CUSTOM + T-W-SMART — cross-platform siblings on web. Web split
  the surface into two PRs; mobile combines them per `PROJECT.md`
  § 9 because a phone-sized navigation tree benefits more from a
  single "Collections" hub than from two near-identical lists.

## Required reading

- `PROJECT.md` § 9 (Custom & Smart Collections) — feature spec,
  freemium rules (3-cap on manual; smart-save paid).
- `rules/05-mobile.md` — Tamagui-only UI primitives, FlatList
  posture, auth-gate convention.
- `apps/mobile/app/_layout.tsx` — root provider tree (auth → query
  → api-client).
- `apps/mobile/src/components/providers/AuthProvider.tsx` —
  `useAuth()` shape.
- `apps/mobile/src/lib/api-client.ts` — `useApiClient()` singleton.
- `apps/mobile/src/screens/collection/CollectionScreen.tsx` +
  `apps/mobile/src/screens/collection/CollectionSetScreen.tsx` —
  closest sibling for auth-gate, FlatList, pull-to-refresh, error
  / empty / loading skeleton, and the `vi.hoisted` router pattern.
- `apps/mobile/src/lib/collection/` — re-used queries (items
  list + owned-printing context fan-out) and the test mock pattern.
- `packages/api-client/src/resources/collection.ts` — the resource
  surface this task drives (custom CRUD, item add/remove, smart
  rule get/upsert/delete).
- `packages/api-contracts/src/collection.ts` — DTOs + request
  schemas (`CustomCollectionDto`, `CustomCollectionKind`,
  `createCustomCollectionRequest`, `smartCollectionRuleDto`).
- `packages/smart-collection-dsl/src/index.ts` — the DSL surface
  this task wraps (parse / evaluate / explain).
- `packages/api-contracts/src/auth.ts` — `SubscriptionDto` and the
  `SUBSCRIPTION_TIERS` enum the plan-gate keys off.
- `apps/mobile/src/test-utils/setup.ts` — global expo-router /
  Tamagui mocks the screen tests build on.

## Goal

Ship the mobile custom + smart collections surface in a single
task. Custom: auth-gated list with the **3-collection free-tier
cap**, create / rename / delete, plus a per-collection detail
screen for adding / removing printings from your owned cards.
Smart: list (paid users only see saved rows; everyone sees a "Try
a smart query" CTA), DSL editor with live parse + explain + Run
preview, and a per-rule detail screen that re-runs against the
user's owned printings on every open. Mirrors the
combined-on-mobile / split-on-web posture called out in
`PROJECT.md` § 9.

## Deliverables

### Data layer (`apps/mobile/src/lib/collections/`)

- `format.ts` — `FREE_TIER_CUSTOM_LIMIT = 3`, `formatCustomUsage`,
  `truncate`, `formatDateLabel`, `slugify`. All deterministic
  pure functions.
- `dsl.ts` — thin wrapper around `@binderly/smart-collection-dsl`:
  - `parseDslText(text)` — parses raw editor text (JSON →
    `parseExpression`) and returns a discriminated union of
    `{ status: 'empty' | 'json-error' | 'dsl-error' | 'ok' }`.
    Surface-area for inline editor feedback.
  - `evaluateAgainstCatalog(expression, catalog, ownedSet)` —
    runs `evaluateExpression` per row and returns ordered
    `EvaluateMatch[]` carrying `{ printing, card, set, owned }`
    so tiles render without a second join.
  - `CatalogPrintingRow` / `EvaluateMatch` types so screens
    don't have to re-derive the projection.
- `hooks.ts` — TanStack Query hooks against the injected
  `BinderlyClient`:
  - `useCustomCollectionsQuery({ enabled })` — paginated list of
    the user's custom collections.
  - `useCustomCollectionQuery(id, { enabled })` — single
    collection detail (404 surfaces as `ApiNotFoundError`).
  - `useCustomCollectionItemsQuery(id, { enabled })` — members
    of a manual collection.
  - `useSmartCollectionRuleQuery(id, { enabled })` — the saved
    DSL expression for a smart row.
  - `useSubscriptionQuery({ enabled })` + `isPaidTier(query)` —
    plan-gate primitive (`tier === 'pro'`).
  - `useCreateCustomCollectionMutation` /
    `useUpdateCustomCollectionMutation` /
    `useDeleteCustomCollectionMutation`.
  - `useAddPrintingToCustomCollectionMutation` /
    `useRemovePrintingFromCustomCollectionMutation`.
- `index.ts` — barrel.

### Components (`apps/mobile/src/components/collections/`)

- `CustomCollectionRow.tsx` — single row of the custom list (name,
  kind chip, description, member count, last-updated). Tap routes
  to detail.
- `UpgradeBanner.tsx` — reusable upsell card. Title + description +
  optional CTA. Used by the free-tier cap, by the smart list for
  free users, and (defensively) by the smart detail when a paid
  row is hit by a downgraded session.
- `PrintingPicker.tsx` — modal-style picker the manual-detail
  screen mounts on "Add cards". Sources rows from the **user's
  owned printings** (`useCollectionItemsQuery`), filters by id
  search, hides Add for printings already in the collection.
  Catalog-wide picker is documented as a follow-up.
- `InlineEditor.tsx` — tap-to-edit primitive backing the manual
  detail's name and description. Press Save / Cancel to commit
  or revert; supports `placeholder` for empty descriptions.
- `index.ts` — barrel.

### Screens (`apps/mobile/src/screens/collections/`)

- `CustomCollectionsScreen.tsx` — the manual + smart hub.
  - Auth gate (`useAuth()`).
  - Header: "Custom Collections" + "X / 3 used" usage line.
  - "New custom collection" CTA — disabled when `count >= 3`,
    surfaced together with an inline upsell.
  - "Smart collections" link → `/collections/smart`.
  - FlatList of `<CustomCollectionRow>`s with pull-to-refresh.
  - Empty / loading / error states.
- `CustomCollectionDetailScreen.tsx` — manual collection drill-down.
  - Auth gate. 404 / loading / error states.
  - Header: inline-editable name + description, member count,
    delete with two-step confirmation.
  - "Add cards" → mounts `<PrintingPicker>` against owned items.
  - 2-column FlatList of members (name + set + number); per-tile
    "Remove" with confirmation. Tap routes to `/cards/{cardId}`.
- `SmartCollectionsScreen.tsx` — saved smart-collection list.
  - Auth gate.
  - For free users: empty list + `<UpgradeBanner>` + "Try a smart
    query" CTA (free).
  - For paid users: list of saved smart rows + the same Try CTA.
  - Empty / loading / error states.
- `SmartCollectionEditorScreen.tsx` — the DSL editor / preview.
  - Auth gate.
  - Single-line `<Input>` for v1 (multi-line + syntax highlight is
    a follow-up — testing native multi-line is fiddly enough that
    we keep the v1 surface simple).
  - Inline parse status: empty / JSON error / DSL error / valid
    explanation rendered from `explainExpression`.
  - "Run" → evaluates the parsed expression against the user's
    owned printings (capped at 200) and renders a 2-col match
    grid + match count.
  - "Save" — disabled with upsell tooltip for free users; for
    paid, opens a modal (name + description) → posts via
    `useCreateCustomCollectionMutation` (`kind: 'smart'`) +
    `upsertSmartCollectionRule` → `router.replace('/collections/smart/{id}')`.
  - Cancel → `router.back()`.
- `SmartCollectionDetailScreen.tsx` — saved smart drill-down.
  - Auth gate. Plan gate (defensive — if a downgraded paid user
    lands on a saved row we render `<UpgradeBanner>` instead of
    silently surfacing matches).
  - Header: name + description + match count + Edit + Delete
    (two-step).
  - Re-runs the rule on load against the owned-printing catalog
    (same v1 trade-off as the editor preview).
  - 2-col FlatList of matches; "no matches" empty state; per-rule
    parse-error notice if the saved expression no longer parses
    (lets the user open the editor to fix without losing the row).
- `index.ts` — barrel.

### Routes (`apps/mobile/app/`)

Thin re-exports — each file just imports the screen and re-exports
as default. Top-level `/collections/...` was chosen instead of
adding a sixth bottom tab because the existing 5-tab navigator
(`(tabs)/_layout.tsx`) is a hard product constraint
(`rules/05-mobile.md`).

- `app/collections/index.tsx` → `CustomCollectionsScreen`.
- `app/collections/custom/[id].tsx` → `CustomCollectionDetailScreen`.
- `app/collections/smart/index.tsx` → `SmartCollectionsScreen`.
- `app/collections/smart/new.tsx` → `SmartCollectionEditorScreen`.
- `app/collections/smart/[id].tsx` → `SmartCollectionDetailScreen`.

### Tests

**107 new tests** across:

- `src/lib/collections/format.test.ts` — 13 cases pinning
  `FREE_TIER_CUSTOM_LIMIT`, `formatCustomUsage` cap rendering,
  `truncate` (under / at / over the cap, custom max), null-safe
  `formatDateLabel`, `slugify` (normalisation, collapsing, edge
  inputs).
- `src/lib/collections/dsl.test.ts` — 12 cases pinning
  `parseDslText` (empty / JSON / DSL error / ok) and
  `evaluateAgainstCatalog` (eq / and / or / contains, owned vs
  not-owned propagation, deterministic ordering, cap-respecting
  caller).
- `src/components/collections/CustomCollectionRow.test.tsx` — 4
  cases on title, kind chip, member count copy, tap navigation.
- `src/components/collections/UpgradeBanner.test.tsx` — 4 cases on
  title / description fallback, custom CTA label, optional CTA
  callback.
- `src/components/collections/PrintingPicker.test.tsx` — 7 cases on
  search filter, the empty-owned state, dedup against existing
  member ids, Add callback, Done callback, search-no-match copy.
- `src/components/collections/InlineEditor.test.tsx` — 5 cases on
  display vs editing modes, Save / Cancel callbacks, placeholder
  rendering.
- `src/screens/collections/CustomCollectionsScreen.test.tsx` — 16
  cases: auth gate + sign-in `router.push`, free-tier cap render
  (X/3 + disabled CTA at 3), enabled CTA below cap, create flow
  (modal → mutation → list refresh), error state, empty state,
  pull-to-refresh, navigation to detail, smart link.
- `src/screens/collections/CustomCollectionDetailScreen.test.tsx`
  — 13 cases: auth gate, missing-id not-found, 404 not-found,
  inline rename mutation, description edit mutation, two-step
  delete + replace navigation back to list, picker open / add /
  remove flows, navigation to `/cards/{cardId}`.
- `src/screens/collections/SmartCollectionsScreen.test.tsx` — 9
  cases: auth gate, free-tier upsell, paid list rendering, "Try a
  smart query" → editor navigation, empty paid state, error
  state, pull-to-refresh.
- `src/screens/collections/SmartCollectionEditorScreen.test.tsx`
  — 12 cases: auth gate, JSON parse error inline, DSL error
  inline, valid expression `explain()` inline, Run produces grid
  + match count, free-user Save disabled with upsell, paid-user
  Save modal flow + replace navigation, cancel `router.back()`.
- `src/screens/collections/SmartCollectionDetailScreen.test.tsx`
  — 11 cases: auth gate, missing-id not-found, 404 not-found,
  free-user plan-gate banner, paid header + match count, 2-col
  member grid, two-step delete + replace, Edit navigation, saved
  rule parse-error notice, no-matches empty, rule-fetch error.

All screen tests apply the `vi.hoisted({ routerMocks })` pattern
from follow-up #13 because every screen navigates via
`router.push` / `router.replace`.

### Manifest changes (pre-authorized)

- `apps/mobile/package.json` — added `@binderly/smart-collection-dsl`
  as a direct workspace dep (was previously transitive through
  the API client only; the editor preview wraps the DSL surface
  directly).
- `pnpm-lock.yaml` — regenerated by `pnpm install`.

## Acceptance criteria

- [x] `pnpm install` succeeds.
- [x] `pnpm --filter @binderly/mobile typecheck` passes.
- [x] `pnpm --filter @binderly/mobile lint` passes
      (`--max-warnings=0`).
- [x] `pnpm --filter @binderly/mobile test` passes with **412
      tests** (107 new, all targeted at this task's surface).
- [x] `pnpm --filter @binderly/mobile build` (tsc) passes.
- [x] Every screen renders a sign-in prompt for signed-out users
      and routes to `/auth/sign-in` on tap.
- [x] `CustomCollectionsScreen` shows "X / 3 used" and disables
      the create CTA at the cap.
- [x] `CustomCollectionDetailScreen` supports inline rename, add
      via picker, remove with confirmation, two-step delete, and
      navigation to `/cards/{cardId}`.
- [x] `SmartCollectionsScreen` differentiates free vs paid copy
      and routes "Try a smart query" to the editor.
- [x] `SmartCollectionEditorScreen` renders inline parse / DSL
      errors and the explain output, runs against owned printings,
      and gates Save behind paid plan.
- [x] `SmartCollectionDetailScreen` plan-gates rendering, re-runs
      on load, two-step deletes, and surfaces saved-rule parse
      errors.
- [x] No changes outside `owns_paths` except for the
      pre-authorized files listed above.

## Out of scope

- Subscription / billing flow itself — every "Upgrade" CTA is a
  placeholder. The actual purchase plumbing belongs to a future
  paid-tier task.
- DSL visual builder — text input + explain output is enough for
  v1. A guided builder is a follow-up.
- Background re-evaluation of saved smart collections — re-run on
  page load. A scheduled background re-eval (with diff
  notifications) is a follow-up.
- Sharing / collaborator UX.
- Native drag-to-reorder of custom-collection members; v1 renders
  in insertion order.
- Catalog-wide printing picker — v1's picker only surfaces the
  user's owned printings (see "Notes" for the rationale).

## Notes from execution

- **Combined surface, single task.** Per `PROJECT.md` § 9 mobile
  ships custom + smart together (vs the web split into T-W-CUSTOM
  + T-W-SMART). The combined surface motivates the new
  `/collections/...` URL prefix instead of two parallel hubs and
  keeps the navigator at five tabs.
- **5-tab navigator constraint.** `rules/05-mobile.md` and the
  existing `app/(tabs)/_layout.tsx` (Browse / Collection / Scan /
  Grading / Profile) are a fixed product surface. Adding a sixth
  tab would have meant editing shared shell code outside this
  task's `owns_paths`. We instead route under top-level
  `/collections/...` and let `CollectionScreen` (and follow-up UX)
  surface the deep-link.
- **Owned-printings catalog for v1 picker + previews.** Both the
  manual `<PrintingPicker>` and the smart editor's Run preview
  source rows from `useCollectionItemsQuery` (capped at 200 in
  the preview path). Hitting the catalog-wide search per keystroke
  (or per Run) would be heavy on a phone for v1 and would also
  require committing to a server-side DSL evaluator we haven't
  built yet. Documented as a follow-up: catalog-wide picker +
  server-evaluated preview once the catalog index ships.
- **Plan gate as a derived selector.** `useSubscriptionQuery` +
  `isPaidTier(query)` is a tiny derived helper rather than a
  context — keeps tests trivial (mock the resource on the
  injected client and assert the rendered surface) and matches
  the rest of the data layer's posture.
- **Two-step delete.** Both `<CustomCollectionDetailScreen>` and
  `<SmartCollectionDetailScreen>` use a "tap Delete → Confirm /
  Cancel" inline flow rather than a native `Alert.alert` modal.
  Native alerts don't render in the jsdom test environment, so
  inline confirmation is testable; same posture as
  `<CollectionSetScreen>` from T-M-COLLECTION.
- **Saved-rule parse-error tolerance.** The smart detail screen
  defends against a saved expression that no longer parses (e.g.
  a future DSL change). It surfaces a `data-testid="…-rule-parse-error"`
  notice and points the user at Edit. The editor doesn't yet
  hydrate from the saved AST (round-trip from `Expression` back
  to JSON text is a follow-up), but the door is open.
- **`vi.hoisted({ routerMocks })` everywhere.** Every screen
  navigates somewhere — `/auth/sign-in`, `/collections/smart`,
  `/cards/{id}`, `/collections/custom/{id}`, etc. The hoisted
  mock + per-test `paramsRef.current = …` pattern from T-M-AUTH /
  T-M-BROWSE / T-M-COLLECTION carries over directly.
- **Lint-fix conformance.** Two of the new files needed manual
  fixes after `eslint --fix`: `<PrintingPicker>`'s import order
  (the `react` type import sits below the `@binderly/ui` value
  import per the project's `import/order` config) and the empty
  state's apostrophe (`react/no-unescaped-entities`). Both are
  surface-level and noted here so future refactors don't
  re-introduce them.

## Branch & PR

- Branch: `agent/T-M-CUSTOM`
- PR title: `feat(mobile): T-M-CUSTOM — custom + smart collections (gated)`
- Commit format: Conventional Commits.
