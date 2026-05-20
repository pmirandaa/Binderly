# T-OF-QUEUE — Mutation queue + replay engine

**Stage:** 09-offline-sync
**Agent role:** frontend-mobile
**Effort:** M (~half day)
**Status:** in_progress

## Hard dependencies

- T-OF-LOCAL-DB (merged — local SQLite schema v1 + 3 typed repositories shipped)

## Soft dependencies

- T-OF-CONFLICTS (downstream — consumes dead-letter seam this task exposes)

## Required reading

- PROJECT.md § 15 (Offline Mode)
- rules/09-offline-sync.md
- apps/mobile/src/db/schema.ts — v1 schema shape
- apps/mobile/src/db/migrations/ — migration runner contract
- apps/mobile/src/repositories/ — 3 repos + `onLocalWrite` event contract
- apps/mobile/src/test-utils/setup.ts — expo-sqlite + netinfo mocks
- packages/api-client/src/resources/collection.ts — server mutation surface

## Goal

Ship the mutation queue + replay engine that buffers writes when the device is
offline and replays them against the server when connectivity is restored.
Consumes the `onLocalWrite(observer)` event-emitter T-OF-LOCAL-DB shipped on the
three mobile repositories (UserCollection / CustomCollection / SmartCollection).
Each local write enqueues a `sync_queue` row; a polling replay engine pops ready
rows and calls the appropriate `@binderly/api-client` method, then marks the
local repository row as `synced`. This closes 2/3 of Stage 09 offline-sync and
unblocks T-OF-CONFLICTS (last-write-wins conflict resolution).

## Deliverables

### Modified files (outside literal owns_paths — justified below)

- `apps/mobile/src/db/schema.ts` — add `CREATE_SYNC_QUEUE_TABLE` +
  `CREATE_SYNC_QUEUE_INDEXES`, bump `CURRENT_SCHEMA_VERSION` to 2.
- `apps/mobile/src/db/migrations/v2.ts` (**new**) — adds `sync_queue` table +
  `ALTER TABLE printing_lite ADD COLUMN set_logo_url TEXT` (Q-016 Option 1).
- `apps/mobile/src/db/migrations/index.ts` — register v2 migration.
- `apps/mobile/src/repositories/types.ts` — add `setLogoUrl` to `PrintingLite`
  and `UpsertPrintingLiteInput` (Q-016 consequence).
- `apps/mobile/src/repositories/UserCollectionRepository.ts` — surface
  `setLogoUrl` through `findAllPrintingLite` + `upsertPrintingLite`.

Justification: The migration mechanism lives in `apps/mobile/src/db/`; the schema
version bump and v2 migration are a hard requirement of the queue table creation.
The repository type additions follow from the Q-016 decision (Option 1 — see
below). Both areas are T-OF-LOCAL-DB's adjacent territory; T-OF-LOCAL-DB is fully
merged and no other worker is in-progress on these paths.

The wiring shim at `apps/mobile/src/sync/index.ts` (outside literal owns_paths)
is documented in the PR body; it serves as the integration point for app startup.

### New files (all within owns_paths)

- `apps/mobile/src/sync/queue/types.ts` — `SyncQueueRow`, `QueueStatus`,
  `QueueEngineState`, `DeadLetterEvent` types.
- `apps/mobile/src/sync/queue/SyncQueueRepository.ts` — CRUD over `sync_queue`
  SQLite table: enqueue, pop, markDone, markFailed, markAttempted, onDeadLetter.
- `apps/mobile/src/sync/queue/enqueue.ts` — subscribes to all 3 repository
  `onLocalWrite` events and writes rows to `sync_queue`.
- `apps/mobile/src/sync/queue/translator.ts` — translates `(table_name, op_type,
  payload_json)` into the appropriate `@binderly/api-client` call. Returns an
  async `execute(collection)` function.
- `apps/mobile/src/sync/queue/ReplayEngine.ts` — background polling loop; pops
  ready rows; calls translator; marks synced or applies exponential backoff /
  dead-letters; exposes `state` observable.
- `apps/mobile/src/sync/queue/connectivity.ts` — thin wrapper over
  `@react-native-community/netinfo` exposing `isOnline()` + `onConnectivityChange`.
- `apps/mobile/src/sync/queue/index.ts` — public barrel.
- `apps/mobile/src/sync/index.ts` — `startSync(client)` wiring shim.
- `apps/mobile/src/sync/queue/__tests__/migration.test.ts`
- `apps/mobile/src/sync/queue/__tests__/enqueue.test.ts`
- `apps/mobile/src/sync/queue/__tests__/replay.test.ts`
- `apps/mobile/src/sync/queue/__tests__/connectivity.test.ts`

## Queue table schema

```sql
CREATE TABLE IF NOT EXISTS sync_queue (
  id              TEXT PRIMARY KEY,           -- UUID v4
  table_name      TEXT NOT NULL,              -- 'user_collection_item' | 'custom_collection'
                                              -- | 'custom_collection_item' | 'smart_collection'
  op_type         TEXT NOT NULL,              -- 'created' | 'updated' | 'deleted'
  payload_json    TEXT NOT NULL,              -- JSON of the full entity at write time
  created_at      TEXT NOT NULL,              -- ISO8601 — determines replay order
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,                       -- truncated to 500 chars
  next_attempt_at TEXT NOT NULL,              -- ISO8601; starts as created_at (immediate)
  status          TEXT NOT NULL DEFAULT 'pending'  -- 'pending' | 'failed'
)
```

## Replay engine state machine

States: `idle` | `replaying` | `paused`

Transitions:
- `idle → replaying` — a new item is enqueued OR polling finds a ready item
- `replaying → idle` — queue drained (no more ready items)
- `replaying → paused` — `ApiNetworkError` mid-replay OR connectivity lost
- `idle → paused` — connectivity lost
- `paused → idle` — connectivity restored + queue empty
- `paused → replaying` — connectivity restored + ready items exist

## Backoff + dead-letter policy

Default backoff: `min(30_000 * 2^attempts, 3_600_000)` ms.
- attempt 0: immediate (next_attempt_at = created_at)
- attempt 1: 30 s
- attempt 2: 60 s
- attempt 3: 120 s
- attempt 7+: capped at 3 600 s (1 h)

Error classification:
- **4xx (except 404 on DELETE, 429)**: mark `status = 'failed'` immediately
  (client error — not retryable without T-OF-CONFLICTS intervention).
- **404 on DELETE**: treat as success (server already deleted the row).
- **429 / 5xx / `ApiNetworkError`**: exponential backoff.
- **After 10 attempts**: mark `status = 'failed'`; emit `onDeadLetter` event.

## T-OF-CONFLICTS integration seam

`SyncQueueRepository.onDeadLetter(observer)` is a stable subscribe surface.
Dead-letter rows remain in `sync_queue` with `status = 'failed'`. T-OF-CONFLICTS
subscribes to `onDeadLetter`, applies last-write-wins resolution, and either:
1. Rewrites the row (reset `attempts = 0`, `status = 'pending'`, `next_attempt_at = now`),
2. Or discards the row + marks the local entity as permanently conflicted.

T-OF-QUEUE does not purge `failed` rows — that is T-OF-CONFLICTS's responsibility.

## Q-016 decision — `printing_lite.set_logo_url`

**Decision: Option 1** — denormalize `set_logo_url` as a TEXT column in
`printing_lite` via v2 migration.

**Rationale:** T-OF-QUEUE mirrors only user-relevant printings (the current
`printing_lite` behaviour — one row per printing the user has interacted with).
At user-collection scale (~hundreds to low thousands of rows), the denormalization
cost (same logo URL repeated across printings of the same set) is negligible.
Option 2 (separate `set_lite` table) would add a JOIN on every CollectionScreen
render and a 3-row join dependency to the offline schema — not worth it for the
savings at this scale. A full catalog mirror (#FU-41) would warrant revisiting
to Option 2; that decision is deferred.

## #FU-41 disposition

Leave open with refined scope: "If/when a full catalog mirror (all ~30 k
printings, not just user-owned) is shipped, migrate `set_logo_url` out of
`printing_lite` into a separate `set_lite(id, name, logo_url)` table to avoid
the per-row denormalization waste at catalog scale. Until then, the single-column
approach suffices."

## Acceptance criteria

- [ ] `sync_queue` table is created by the v2 migration (migration round-trip test)
- [ ] `printing_lite.set_logo_url` is added by the v2 migration
- [ ] `CURRENT_SCHEMA_VERSION` in `_meta` is `2` after migration
- [ ] Fresh install (v1 → v2) and upgrade (v1 already ran → only v2) both produce
      the correct schema
- [ ] `enqueue()` writes a `sync_queue` row for every `onLocalWrite` event from
      all 3 repositories
- [ ] Queue rows are ordered by `created_at`; the replay engine pops the oldest
      ready row first
- [ ] Replay success: `markSynced` is called on the source repository + queue row
      is deleted
- [ ] Replay 4xx (non-404-DELETE): queue row marked `status = 'failed'`
      immediately (no retry)
- [ ] Replay 5xx / network error: `attempts` incremented, `next_attempt_at`
      computed with exponential backoff, row stays `pending`
- [ ] After 10 failed attempts: row marked `status = 'failed'`, `onDeadLetter`
      fires
- [ ] Replay pauses when offline, resumes when online
- [ ] Replaying the same queue row twice (simulated) does not double-write (queue
      row is deleted after first success)
- [ ] Tests live at `apps/mobile/src/sync/queue/__tests__/` and pass under
      `pnpm --filter @binderly/mobile test`
- [ ] ≥ 80 passing tests across the 4 test files
- [ ] No lint errors, no typecheck errors

## Out of scope

- True OS-level background sync (BackgroundFetch / WorkManager). The replay
  engine runs on the JS thread; it pauses with the app. A follow-up task
  can add true background sync using Expo's BackgroundFetch API.
- Conflict resolution (last-write-wins, server-wins, manual merge). Handled by
  T-OF-CONFLICTS which subscribes to `onDeadLetter`.
- Full catalog mirror (all ~30 k printings). See #FU-41.
- Screen-side changes. Screens continue to call `@binderly/api-client` directly.

## Branch & PR

- Branch: `agent/T-OF-QUEUE`
- PR title: `feat(mobile): T-OF-QUEUE — mutation queue + replay engine`
- Commit format: Conventional Commits

## Escalation triggers

Stop and surface to orchestrator if:
- A required api-client method is missing or has a different signature than
  expected.
- A change is needed outside the documented paths.
- An acceptance criterion conflicts with PROJECT.md.

## Notes from execution

(Sub-agent appends here at end.)
