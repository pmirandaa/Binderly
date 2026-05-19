# T-BE-EDGE-FUNCTIONS-V2 — 4 additive read endpoints unblocking frontend follow-ups

**Stage:** 02-backend
**Agent role:** backend
**Effort:** L
**Status:** STUB — must be elaborated by the worker before implementation.

---

> ## STUB — Worker instructions
>
> This task file is intentionally a thin brief. The dispatched worker
> elaborates it into a full task per the template in
> `AGENT_ORCHESTRATOR.md` § 7 (Full task template) at the start of the
> PR, and commits the elaboration as the first commit
> (`docs(tasks): elaborate T-BE-EDGE-FUNCTIONS-V2`) before any
> implementation work.
>
> **Pre-authorized edits outside `owns_paths`:**
>
> - `dependencies.yaml` — flip `status: pending → review` and
>   `stub: true → false` for `T-BE-EDGE-FUNCTIONS-V2`.
> - `tasks/02-backend/T-BE-EDGE-FUNCTIONS-V2.md` — full elaboration.
> - `open-questions.md` — append any new Q-NNN as needed.

---

## Goal

Add four additive read endpoints to the Supabase Edge Function so the
frontend follow-ups logged in iter 17 / 18 / 20 can drop their O(catalog)
client-side stop-gaps and read O(1) authoritative server data:

1. **`GET /v1/me/collection/completion`** (authed) — reads
   `mv_user_set_completion` + `mv_user_global_completion`. Closes Q-010
   ratified ratification + **#FU-19**. Unblocks T-W-COLLECTION's
   `catalogRoster()` fanout + T-M-COLLECTION's per-set roster fanout.
2. **`GET /v1/printings/:id/current-price`** (authed; cacheable) — reads
   `mv_current_price` for one printing. Closes **#FU-17 backend half**.
   Unblocks T-W-BROWSE's `CardView` and T-M-BROWSE's `CardScreen`
   "Prices coming soon" placeholders (the wiring half stays a separate
   follow-up).
3. **`GET /v1/c/{handle}/{slug}`** (anonymous; no auth required) — joins
   `shareable` ↔ `profile` ↔ `collection_item` (and optionally
   `custom_collection`) once and returns one envelope matching the
   `publicShareableDto` shape proposed in `open-questions.md` § Q-012.
   Closes **Q-012**. Unblocks T-W-SHAREABLE-PUBLIC's degraded runtime
   adapter — `apps/web/lib/share/api.ts`'s `PublicSharePayload` is the
   target shape.
4. **`POST /v1/smart-collections/preview`** (authed) — accepts a smart-
   collection expression (DSL string) and a `{ limit, offset }` page,
   compiles via `@binderly/smart-collection-dsl`'s `compileToSql()`,
   returns the matching printings. Closes **#FU-23**. Unblocks T-W-SMART
   + T-M-CUSTOM (smart half) from their client-side 200-printing preview
   window.

## Required reading

- `PROJECT.md` § 8 (Collection completion math) + § 11 if relevant
- `rules/02-backend.md`
- `infra/supabase/functions/_shared/routes-table.ts` — current dispatch
  table; learn the pattern before adding 4 routes
- `infra/supabase/functions/_shared/handlers/` — handler conventions
  (auth, error shape, response envelope)
- `packages/api-contracts/src/` — DTO patterns (Zod schemas + DTO types)
- `packages/api-client/src/` — client method patterns
- `packages/db/src/schema/` — `mv_current_price`, `mv_user_set_completion`,
  `mv_user_global_completion`, `shareable`, `profile`,
  `collection_item`, `custom_collection`, `printing`, `card`, `set`
- `packages/smart-collection-dsl/src/` — `compileToSql()` API
- `apps/web/lib/share/api.ts` — `PublicSharePayload` shape this task
  must serve
- `apps/web/lib/collection/` + `apps/mobile/src/screens/collection/` —
  current client-side-compute stop-gap (so the new endpoint matches what
  the screens need)
- `open-questions.md` — Q-010 (closed; #FU-19 follow-up) + Q-012
  (open; this task closes it)

## Non-goals (out of scope for this task)

- Wiring the four new endpoints into web/mobile screens. Those are
  separate follow-ups (#FU-17 frontend half stays open after this task;
  T-W-COLLECTION / T-M-COLLECTION migrations from client-side compute
  to `getCompletion()` are separate; T-W-SHAREABLE-PUBLIC adapter swap
  from degraded synthesis to direct call is separate; T-W-SMART preview
  migration is separate).
- New materialised views or schema changes. All four endpoints read
  existing tables / mvs. If a new index is genuinely needed for
  performance, add it as a hand-authored migration and call it out in
  the PR body; do NOT add new mvs.
- Anonymous read of `/v1/me/collection/completion` or
  `/v1/printings/:id/current-price` — both stay authed. Only the public
  shareable endpoint is anonymous.

## Hard rules

- **No breaking changes to existing endpoints.** All four routes are
  net-new additions to `routes-table.ts`. Existing handlers stay
  untouched (modulo shared helper edits if needed).
- **RLS posture preserved.** Authed endpoints read with the user's JWT
  (service_role only when intentionally bypassing for the anonymous
  shareable read). Anonymous shareable endpoint must NOT use the
  user's session at all (cookie-less fetch, public DTO).
- **Contracts are Zod-first.** Add new DTOs (`completionDto`,
  `currentPriceDto`, `publicShareableDto`, `smartPreviewRequestDto` +
  `smartPreviewResponseDto`) to `packages/api-contracts/src/`. The
  client and server both `parse()` these.
- **api-client methods match the brief.** Add the matching methods:
  `client.collection.getCompletion()`, `client.printings.getCurrentPrice(id)`,
  `client.shareables.getPublicShareablePayload({ handle, slug })`
  (sibling to existing `getPublicShareable`, returns the richer payload),
  `client.smartCollections.preview({ expression, limit, offset })`.
- **Edge handlers test-cover the happy path + auth/anon boundaries +
  error shape.** Use the existing handler test patterns; aim for
  per-route test counts in the 8-15 range (target total: ~40-60 new
  tests across infra/supabase/functions + api-contracts + api-client).
- **Q-012 close-out:** the worker rewrites `open-questions.md` to mark
  Q-012 as CLOSED with a 2026-05-19 ratification note pointing at the
  PR HEAD.
- **Conventional Commits PR title** with single-letter `BE` scope:
  `feat(backend): T-BE-EDGE-FUNCTIONS-V2 — …`.

## Acceptance criteria (testable)

1. **`GET /v1/me/collection/completion`** returns
   `{ global: { unique_cards_owned, total_cards }, perSet: [{ set_id,
   set_code, set_name, owned, total, completion_pct }, ...] }` for the
   authenticated user. Unit + integration tests cover authed-success,
   no-rows (empty collection → all zeros), JWT-missing (401), and
   service_role bypass.
2. **`GET /v1/printings/:id/current-price`** returns
   `{ printing_id, current_price_cents_usd, currency, source, observed_at,
   trend_7d, trend_30d, sample_size }` for the requested printing, or
   404 if no `mv_current_price` row. Unit tests cover present-row,
   missing-row (404), invalid-uuid (400).
3. **`GET /v1/c/{handle}/{slug}`** returns the full `publicShareableDto`
   matching the `PublicSharePayload` shape expected by
   `apps/web/lib/share/api.ts` (see that file for the exact field names),
   including owner subset, collectionTitle, counts, members list,
   description, lastUpdatedAt. Returns 404 if no shareable matches.
   Anonymous — no JWT required, no auth header parsed. Integration test
   covers populated-collection-success, missing-shareable (404),
   private-shareable (404 to avoid existence leak), zero-members
   (empty array, not 404).
4. **`POST /v1/smart-collections/preview`** accepts
   `{ expression: string, limit?: number (default 200, max 500),
   offset?: number (default 0) }`, compiles via
   `@binderly/smart-collection-dsl`'s `compileToSql()`, executes against
   the catalog, returns `{ items: [printing rows], totalCount: number,
   nextOffset: number | null }`. Tests cover happy-path expression,
   syntax-error (400 with parse-error detail), pagination correctness,
   limit clamp.
5. **`packages/api-contracts/src/`** has 5 new DTO schemas
   (`completionDto`, `currentPriceDto`, `publicShareableDto`,
   `smartPreviewRequestDto`, `smartPreviewResponseDto`) with Zod
   schemas + TypeScript types, each unit-tested for parse-success and
   parse-failure on malformed input.
6. **`packages/api-client/src/`** has 4 new client methods (above);
   each unit-tested with a `fetch`-mock for happy path + 404 + auth
   header semantics.
7. **`open-questions.md`** has Q-012 marked CLOSED with merge ratification.
8. **No new migrations.** The four endpoints read existing tables /
   materialised views only.
9. **Build-with-no-env smoke** passes for any frontend test fixtures
   touched (none expected — this is backend-only).
10. **CI green:** pr-title, typecheck, lint, build, test all pass.

## Owns paths

- `infra/supabase/functions/` (additive — new handlers + routes-table
  additions only)
- `packages/api-contracts/src/` (additive — new DTO files; no edits to
  existing DTOs unless promoting a shape — call out in PR body)
- `packages/api-client/src/` (additive — new client methods)

## Out-of-owns_paths edits (pre-authorized)

- `dependencies.yaml` — status flip + stub flag flip
- `tasks/02-backend/T-BE-EDGE-FUNCTIONS-V2.md` — full elaboration
- `open-questions.md` — Q-012 close-out

## Branch & PR

- Branch: `agent/T-BE-EDGE-FUNCTIONS-V2`
- PR title: `feat(backend): T-BE-EDGE-FUNCTIONS-V2 — 4 additive read endpoints (completion, current-price, public-shareable, smart-preview)`

## Internal decomposition (optional)

The four endpoints are independent. The worker may internally split
implementation into 4 sequential commits (one per endpoint, each with
contracts + client + handler + tests). One coherent PR; small reviewable
slices.

## Notes from execution
_(empty until the sub-agent runs)_
