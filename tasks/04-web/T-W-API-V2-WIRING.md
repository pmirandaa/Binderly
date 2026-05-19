# T-W-API-V2-WIRING — Wire V2 read endpoints into web surfaces

**Stage:** 04-web
**Agent role:** frontend-web
**Effort:** L
**Status:** STUB — worker elaborates this file before any code edits.

---

> ## STUB — Worker instructions
>
> Elaborate this file into the full task template (`AGENT_ORCHESTRATOR.md` § 7)
> as your first commit (`docs(tasks): elaborate T-W-API-V2-WIRING`). Then ship
> in logical slices. Pre-authorized: edit `dependencies.yaml` (status flip,
> stub flip), and this task file.

---

## Goal

`T-BE-EDGE-FUNCTIONS-V2` (PR #68, merged `472fdcf`) shipped four new read
endpoints + matching `@binderly/api-client` methods. This task swaps the
**web** client-side stop-gaps shipped in iters 17 / 18 / 20 for direct
calls to those endpoints.

Four surfaces to wire:

1. **Completion (T-W-COLLECTION).** Replace `apps/web/lib/collection/`'s
   client-side `catalogRoster()` fanout + `computeCompletion()` call
   with `client.collection.getCompletion()`. Global + per-set numbers
   come from the server now. The on-device math goes away (or stays as
   a fallback if the server returns 5xx; worker judges).
2. **Current price (#FU-17 frontend half).** Wire `@binderly/pricing-
   display` into `apps/web/components/browse/CardView.tsx` using
   `client.printings.getCurrentPrice(printingId)`. Replace the "Prices
   coming soon" placeholder with a real `formatPrice(...)` render with
   sensible loading / 404 / error states. Trends (`trend_7d`,
   `trend_30d`) render if present; missing trends do not crash.
3. **Public shareable (Q-012 → closed iter 21).** Update
   `apps/web/lib/share/api.ts`'s `apiToShareApi` to call
   `client.shareables.getPublicShareablePayload({ handle, slug })` (the
   new richer method, gated by `Accept: application/vnd.binderly.share+json`),
   replacing the degraded synthesis branch (URL-derived handle + empty
   members + zero counts). `PublicSharePayload` was designed as exactly
   this seam — the type doesn't move; only the runtime adapter changes.
   Tests using the fake adapter shouldn't need to change.
4. **Smart-collection preview (#FU-23 frontend half).** Replace
   `apps/web/components/collections/smart/`'s in-browser
   `@binderly/smart-collection-dsl` `evaluate(...)` on a 200-printing
   preview window with `client.smartCollections.preview({ expression,
   limit, offset })`. The DSL package's `evaluate()` stays usable on
   the client for the **editor preview while typing** (debounced; no
   server round-trip for in-flight typing), but the canonical preview
   shown after save / load comes from the server. Worker may also keep
   client-side eval as a feature-flagged fallback.

## Required reading

- `PROJECT.md` § 8 (Collection completion math) — for the shape the
  completion endpoint returns
- `tasks/02-backend/T-BE-EDGE-FUNCTIONS-V2.md` — the elaborated brief
  the V2 worker shipped against (endpoint shapes, Accept header
  semantics, error contracts)
- `packages/api-client/src/resources/` — read the new methods:
  `collection.getCompletion`, `printings.getCurrentPrice`,
  `shareables.getPublicShareablePayload`, `smartCollections.preview`
- `packages/api-contracts/src/` — read `completionDto`, `currentPriceDto`,
  `publicShareableDto`, `smartPreviewRequest`/`smartPreviewResponse`
- `open-questions.md` § Q-013 — documents the two server-side stop-gaps
  (on-the-fly completion compute; in-JS DSL eval). Your client code
  doesn't know or care about these — the contract is stable; performance
  characteristics are the only thing that changes when #FU-26 / #FU-27
  land later.
- `apps/web/lib/share/api.ts` — the seam you'll edit
- `apps/web/lib/collection/` — completion stop-gap
- `apps/web/components/browse/CardView.tsx` — pricing placeholder
- `apps/web/components/collections/smart/` — smart-preview stop-gap

## Hard rules

- **Contracts are stable.** Frontend code should NOT redefine DTOs;
  consume from `@binderly/api-contracts`.
- **No breaking changes to existing UI tests** that use the fake api
  adapters. The fake adapters (`createFakeShareApi`, etc.) already
  return the richer payload shape; runtime adapter swap should be
  transparent to those tests.
- **`force-dynamic` + lazy client glue stays.** Build-with-no-env smoke
  test must pass; do not eagerly construct the api-client at module
  load.
- **Loading + 404 + error states are part of the deliverable.** Every
  network swap must handle them with at least minimal UI. Tests cover
  these states.
- **No new owns_paths conflicts.** Worker may touch `apps/web/app/`,
  `apps/web/components/`, `apps/web/lib/`. If a change crosses into
  another current task's owns_paths, escalate.
- **Conventional Commits** PR title: `feat(web): T-W-API-V2-WIRING — …`
  (single-letter `W` scope per the established workaround).

## Acceptance criteria

1. `apps/web/lib/collection/` (or wherever completion lives in the
   collection surface) calls `getCompletion()` for both the global and
   per-set numbers. The client-side `catalogRoster()` fanout is removed
   (or moved behind an explicit fallback flag). Tests cover authed-
   success, 5xx fallback / error, and empty-collection.
2. `apps/web/components/browse/CardView.tsx` renders real prices via
   `pricing-display`'s `formatPrice`/`convertPrice`. Loading / 404 /
   error states are visually distinct. Tests cover each state.
3. `apps/web/lib/share/api.ts` calls `getPublicShareablePayload(...)`
   when `Accept: application/vnd.binderly.share+json` is supported by
   the api-client (it should be — the V2 worker shipped both branches);
   degraded synthesis branch is either deleted or kept as a documented
   `5xx`-fallback. Existing tests still pass; new tests assert the new
   branch wires correctly.
4. `apps/web/components/collections/smart/` uses
   `client.smartCollections.preview(...)` for the canonical preview;
   client-side `evaluate(...)` either gone or kept only for in-flight
   typing preview, with a comment explaining why. Tests cover both
   paths if both exist.
5. Test coverage net-additions: ~30-50 new tests across the four
   surfaces. Existing tests still pass; no regressions on `apps/web`'s
   411-test baseline.
6. `apps/web` `pnpm build` succeeds **with no env vars** (the iter 14 /
   17 / 18 / 20 build-without-env-vars rule).
7. All 5 CI checks pass.

## Out-of-owns_paths edits — pre-authorized

- `dependencies.yaml` (status flip + stub flag flip)
- `tasks/04-web/T-W-API-V2-WIRING.md` (full elaboration)
- `open-questions.md` only if escalating a new question

## Internal decomposition (suggested)

Four sequential commits, one per surface, each end-to-end (swap +
tests). Then push + PR.

## Branch & PR

- Branch: `agent/T-W-API-V2-WIRING`
- PR title: `feat(web): T-W-API-V2-WIRING — wire V2 read endpoints (completion, current-price, shareable, smart-preview)`

## Notes from execution
_(empty until the sub-agent runs)_
