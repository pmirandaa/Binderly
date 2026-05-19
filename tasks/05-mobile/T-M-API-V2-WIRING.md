# T-M-API-V2-WIRING — Wire V2 read endpoints into mobile surfaces

**Stage:** 05-mobile
**Agent role:** frontend-mobile
**Effort:** M
**Status:** STUB — worker elaborates this file before any code edits.

---

> ## STUB — Worker instructions
>
> Elaborate this file into the full task template (`AGENT_ORCHESTRATOR.md` § 7)
> as your first commit (`docs(tasks): elaborate T-M-API-V2-WIRING`). Then ship
> in logical slices. Pre-authorized: edit `dependencies.yaml` (status flip,
> stub flip), and this task file.

---

## Goal

`T-BE-EDGE-FUNCTIONS-V2` (PR #68, merged `472fdcf`) shipped four new read
endpoints + matching `@binderly/api-client` methods. This task swaps the
**mobile** client-side stop-gaps shipped in iters 17 / 18 / 19 for direct
calls to those endpoints.

Three surfaces to wire (mobile doesn't have a shareable view; the public
shareable is web-only):

1. **Completion (T-M-COLLECTION).** Replace
   `apps/mobile/src/screens/collection/`'s on-device fanout
   (`listCardsInSet` + `listPrintingsForCard` per-card; full-roster
   load in `CollectionSetScreen`; parked Master % in `CollectionScreen`
   with "Open set to compute" affordance) with
   `client.collection.getCompletion()`. Server returns both global +
   perSet numbers; `CollectionScreen` can finally show real Master %
   without the parked fallback.
2. **Current price (#FU-17 frontend half).** Wire `@binderly/pricing-
   display` into `apps/mobile/src/screens/card/CardScreen.tsx` using
   `client.printings.getCurrentPrice(printingId)`. Replace the "Prices
   coming soon" placeholder with a real `formatPrice(...)` render with
   sensible loading / 404 / error states.
3. **Smart-collection preview (#FU-23 frontend half).** Replace
   `apps/mobile/src/screens/collections/`'s in-app
   `@binderly/smart-collection-dsl` `evaluate(...)` (the smart-editor
   Run preview that currently sources from owned printings only — see
   #FU-22) with `client.smartCollections.preview({ expression, limit,
   offset })`. Server preview is catalog-wide (no longer "owned-only"),
   so the #FU-22 quirk goes away as a side effect.

## Required reading

- `tasks/02-backend/T-BE-EDGE-FUNCTIONS-V2.md` — endpoint shapes + Accept
  semantics + error contracts
- `tasks/05-mobile/T-M-CUSTOM.md` — the smart-editor surface you'll
  edit lives here (T-M-CUSTOM combined custom + smart on mobile)
- `packages/api-client/src/resources/` — `collection.getCompletion`,
  `printings.getCurrentPrice`, `smartCollections.preview`
- `packages/api-contracts/src/` — `completionDto`, `currentPriceDto`,
  `smartPreviewRequest` / `smartPreviewResponse`
- `open-questions.md` § Q-013 — documents the two server-side stop-gaps;
  your client code is unaware
- `apps/mobile/src/screens/collection/` — the completion stop-gap
- `apps/mobile/src/screens/card/CardScreen.tsx` — pricing placeholder
- `apps/mobile/src/screens/collections/` — smart-editor Run preview

## Hard rules

- **Contracts are stable.** Consume DTOs from `@binderly/api-contracts`;
  no redefinitions.
- **`vi.hoisted({ routerMocks })` pattern stays** (T-M-AUTH /
  T-M-COLLECTION pattern). Any new tests must mock `expo-router`
  hoisted, not via the global `setup.ts` (see follow-up #13).
- **Loading + 404 + error states** are part of the deliverable. Tests
  cover them.
- **No regression on `apps/mobile`'s ~432-test baseline.**
- **Conventional Commits** PR title: `feat(mobile): T-M-API-V2-WIRING — …`
  (single-letter `M` scope per the established workaround).

## Acceptance criteria

1. `CollectionScreen` shows real Master % from
   `getCompletion().global.completion_pct`; the "Open set to compute"
   parked fallback is removed (or moved behind a 5xx error state).
   `CollectionSetScreen` reads its set's row from
   `getCompletion().perSet`; the per-card fanout is removed.
2. `CardScreen` renders real prices via `pricing-display`. Loading /
   404 / error states are visually distinct. Tests cover each.
3. Smart-editor Run preview uses `smartCollections.preview(...)`.
   Catalog-wide eval works; the #FU-22 "owned-only" PrintingPicker
   quirk is documented in the PR body as resolved-as-side-effect.
4. Test coverage net-additions: ~25-40 new tests across the three
   surfaces. Existing tests still pass; no regressions.
5. All 5 CI checks pass.

## Out-of-owns_paths edits — pre-authorized

- `dependencies.yaml` (status flip + stub flag flip)
- `tasks/05-mobile/T-M-API-V2-WIRING.md` (full elaboration)
- `open-questions.md` only if escalating a new question

## Internal decomposition (suggested)

Three sequential commits, one per surface, each end-to-end (swap +
tests). Then push + PR.

## Branch & PR

- Branch: `agent/T-M-API-V2-WIRING`
- PR title: `feat(mobile): T-M-API-V2-WIRING — wire V2 read endpoints (completion, current-price, smart-preview)`

## Notes from execution
_(empty until the sub-agent runs)_
