# T-SH-CONFIG-MODEL — Owner-side shareable config & settings UI (web + mobile)

**Stage:** 08-shareables
**Agent role:** frontend-web + frontend-mobile (full-stack within owns_paths)
**Effort:** M
**Status:** in_progress

## Hard dependencies

- T-W-COLLECTION (merged) — settings page sits inside the same auth shell.
- T-M-COLLECTION (merged) — mobile screen sits inside the same tab shell.

## Soft dependencies

- T-W-SHAREABLE-PUBLIC (merged, iter 20) — settings UI writes the rows
  the public page reads.
- T-BE-EDGE-FUNCTIONS-V2 (merged, iter 21) — `/v1/me/shareables/*` +
  `/v1/me/profile` endpoints already exist.

## Required reading

- `PROJECT.md` § 14 (Shareables), § 16 (Freemium plan — free tier capped
  at 1 shareable).
- `rules/08-shareables.md` (the stage rules — kill switch, no PII leak,
  themes paid-only).
- `packages/db/src/schema/profiles.ts` + `shareables.ts` (existing
  storage shape).
- `packages/api-contracts/src/auth.ts` + `shareables.ts` (existing wire
  contracts).
- `packages/api-client/src/resources/profile.ts` + `shareables.ts`
  (existing typed clients).
- `apps/web/app/c/[handle]/[slug]/page.tsx` + `apps/web/lib/share/api.ts`
  (the public render path the owner config drives).
- `open-questions.md` § Q-020 (model divergence between brief and merged
  shape — this task ships the narrowed-scope resolution).

## Goal

Ship the owner-side controls for public shareables. T-W-SHAREABLE-PUBLIC
shipped the read-side at `/c/{handle}/{slug}`; this task ships the
settings UI on web + mobile that lets the owner manage the rows that
public page reads — their `profile` (handle, display name, bio) and
their `shareable` configurations (slug, target, theme placeholder, show
toggles).

Q-020 documents the divergence between the dispatch brief's proposed
single-row `user_share_config` shape and the merged two-table
(`profile` + `shareable`) shape. This task ships the narrowed-scope
resolution: surface the existing rows, add a typed
`checkHandleAvailability` resource method (backend endpoint follow-up),
and leave kill-switch + social-links columns for separate follow-up
tasks logged in Q-020.

## Deliverables

### Contracts + client (additive, no breaking changes)

- `packages/api-contracts/src/auth.ts` — add `handleAvailabilityResponse`
  DTO (`{ available: boolean, handle: string, reason?: 'taken'|'invalid'|'rate_limited' }`).
  No changes to existing exports. **[Outside owns_paths — single
  additive append, justified in PR body.]**
- `packages/api-client/src/resources/profile.ts` — add
  `checkHandleAvailability({ handle, signal })` method targeting
  `GET /v1/me/handle-available?handle=…`. Pure additive, no signature
  changes to existing methods. **[Outside owns_paths — single additive
  method, justified in PR body.]**
- `packages/api-contracts/src/auth.test.ts` +
  `packages/api-client/src/resources/profile.test.ts` — extend with
  cases for the new schema + method.

### Web settings UI (in owns_paths)

- `apps/web/app/settings/shareables/page.tsx` — server-component route
  entry, `force-dynamic`, mounts the client glue.
- `apps/web/app/settings/shareables/loading.tsx` — page-level spinner.
- `apps/web/app/settings/shareables/ShareablesSettingsRoute.tsx` —
  client glue (auth gate + lazy api-client construction, matches
  `CollectionRoute` pattern).
- `apps/web/app/settings/shareables/ShareablesSettingsView.tsx` — the
  main settings surface. Renders:
  - **Profile section:** handle (live availability check, debounced
    400 ms, 3–30 char `^[a-z0-9][a-z0-9-]{2,29}$` lowercase pattern,
    server-side citext uniqueness backstop); display name (max 80);
    bio (max 280); save with optimistic update + rollback on error.
  - **Shareables section:** list user's shareables (cap-1 free tier
    enforced server-side; UI surfaces the cap as a "Pro unlocks more"
    badge when at the cap). Each row:
    - Public URL preview (`binderly.app/c/{handle}/{slug}`).
    - Slug input (free-tier users edit the auto-generated CSPRNG slug
      down to a handle of their choice).
    - Theme dropdown (placeholder — only `'default'` selectable; the
      other entries from `SHAREABLE_THEMES` show "Pro" labels and are
      disabled until T-SH-THEMES wires the gate).
    - Toggles: `show_values`, `show_missing`, `show_photos`. Disabled
      toggle for `show_collection_value` (paid) maps to `show_values`;
      add aria-label "(Pro)" when disabled.
    - Delete button with confirmation copy explaining the slug is
      freed for re-use (Q-020 follow-up will replace this with the
      kill-switch toggle).
    - Save patch is optimistic with rollback.
  - **Create-new-shareable** affordance when under the cap.
- `apps/web/app/settings/shareables/api.ts` — narrow `SettingsApi`
  surface the view programs against (mirrors `apps/web/lib/share/api.ts`
  pattern); tests inject a fake.
- `apps/web/app/settings/shareables/fixtures.ts` — `createFakeSettingsApi`
  test helper.
- `apps/web/app/settings/shareables/validation.ts` — pure handle /
  bio / slug validators; vitest covers regex + length + empty-string
  branches.
- Tests: `*.test.ts` / `*.test.tsx` colocated, ≥20 cases total covering
  validation, optimistic update, rollback on error, debounced
  availability check, empty-state render, free-tier cap render,
  delete-with-confirmation flow.

### Mobile settings UI (in owns_paths)

- `apps/mobile/src/screens/shareables/ShareablesSettingsScreen.tsx` —
  top-level screen, mirrors the web view feature set with Tamagui
  primitives. Auth check via shell's standard `useAuth()` (same
  pattern as other auth-gated screens).
- `apps/mobile/src/screens/shareables/api.ts` — narrow `SettingsApi`
  (cross-platform; structurally identical to the web one — both
  consume `@binderly/api-client`).
- `apps/mobile/src/screens/shareables/fixtures.ts` — fake api factory.
- `apps/mobile/src/screens/shareables/validation.ts` — re-export of
  the same pure validators (no platform branching).
- `apps/mobile/src/screens/shareables/ShareableRowEditor.tsx` —
  per-shareable card (slug input, theme dropdown placeholder, three
  show toggles, delete button).
- `apps/mobile/src/screens/shareables/ProfileFields.tsx` — handle /
  display name / bio inputs with availability indicator.
- Route registration: `apps/mobile/app/settings/shareables.tsx` (one-line
  re-export of the screen). **[Outside owns_paths — single new route
  file, justified in PR body; Expo Router requires the file to live
  under `apps/mobile/app/`.]**
- Tests: `*.test.tsx` colocated, ≥20 cases following the
  `apps/mobile/src/test-utils/setup.ts` `routerMocks` pattern.

## Acceptance criteria

- [ ] `packages/api-contracts` exports `handleAvailabilityResponse`
      with positive + negative parse tests.
- [ ] `packages/api-client` exports
      `profile.checkHandleAvailability({ handle, signal })`
      hitting `GET /v1/me/handle-available?handle=…`, returning the
      typed response. Tests cover 200 (available + taken),
      400 (invalid handle), and 429 (rate-limited) branches.
- [ ] Web route `/settings/shareables` renders behind an auth gate
      (signed-out users see the same `SignInPrompt` `/collection` uses).
- [ ] Web view renders: profile fields, shareables list, theme dropdown
      placeholder, three show toggles, delete with confirmation.
- [ ] Web validation rejects handles outside
      `^[a-z0-9][a-z0-9-]{2,29}$` and bios over 280 chars with inline
      copy; the validators have ≥6 dedicated tests.
- [ ] Web optimistic-update on save: UI flips immediately, rolls back
      on api error, leaves the form editable.
- [ ] Mobile screen renders the same surface via Tamagui primitives.
- [ ] Mobile validation re-exports the same validators (no fork).
- [ ] Both sides total ≥20 vitest cases each (40+ overall) — `pnpm
      --filter @binderly/web test` + `pnpm --filter @binderly/mobile test`
      both green.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build` all green from the
      worktree root.
- [ ] No DB migration in this task (Q-020 documented assumptions —
      kill switch + social links are follow-ups).
- [ ] No edits to `apps/web/middleware.ts` (route component handles
      auth itself, same pattern as `/collection`).
- [ ] No edits to `apps/mobile/app/(tabs)/_layout.tsx` (settings is a
      nested route outside the tabs group; Expo Router resolves the
      `/settings/shareables` URL as a standalone stack).

## Out of scope

- DB schema changes (Q-020 follow-ups `T-SH-KILL-SWITCH`,
  `T-SH-SOCIAL-LINKS`).
- Backend endpoint for `handle-available` — typed client lands here,
  backend ships in Q-020 follow-up `T-BE-SHAREABLES-HANDLE-CHECK`.
  Until that backend lands, the UI degrades gracefully (debounced
  fetch surfaces "we'll verify on save" if the endpoint returns 404).
- Theme picker beyond the `'default'` placeholder (T-SH-THEMES).
- OG-image rendering (T-SH-OG-IMAGES — parallel sibling, disjoint paths).

## Branch & PR

- Branch: `agent/T-SH-CONFIG-MODEL`
- Worktree: `/Users/pmiranda/Stuff/binderly-wt-T-SH-CONFIG-MODEL`
- PR title: `feat(shareables): T-SH-CONFIG-MODEL — owner-side share config + settings UI (web + mobile)`
- Commit format: Conventional Commits.

## Escalation triggers

Stop and surface to orchestrator if:

- A merged dependency turns out to break a stated assumption in Q-020.
- The lockfile collides with a parallel worker (T-SH-OG-IMAGES,
  T-PB-PADDLE, T-PB-REVENUECAT) in a way `pnpm install` can't auto-resolve.

## Notes from execution
_(sub-agent appends here at completion)_
