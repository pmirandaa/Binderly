# T-OF-CONFLICTS — Conflict resolution (last-write-wins + log)

**Stage:** 09-offline-sync
**Agent role:** frontend-mobile
**Effort:** M
**Status:** pending

---

## Hard dependencies

- T-OF-LOCAL-DB (merged) — provides `apps/mobile/src/db/` + the 3 typed
  repositories (`UserCollectionRepository`, `CustomCollectionRepository`,
  `SmartCollectionRepository`) we read & write through.
- T-OF-QUEUE (merged) — provides `apps/mobile/src/sync/queue/`:
  - `syncQueueRepo.onDeadLetter(observer)` — the subscribe hook that fires
    when a queue row exhausts all 10 replay attempts.
  - `syncQueueRepo.findAll()` / `findById(id)` — for inspecting + cleaning
    up dead-lettered rows.
  - `syncQueueRepo.enqueue(id, table, op, payload)` — for re-injecting a
    "local-won" mutation back into the queue.
  - `DeadLetterEvent = { row: SyncQueueRow (status='failed'), finalError: string }`.

## Soft dependencies

- T-GR-AGGREGATE (running in parallel) — disjoint owns_paths; only contact
  surface is `pnpm-lock.yaml` (resolve by taking main's lockfile +
  `pnpm install`) and `status.md` "Last 5 merges" + #FU numbering (use
  #FU-48 unless T-GR-AGGREGATE claims it first; then use #FU-49).

## Required reading

- `PROJECT.md` § 15 (Offline Mode)
- `rules/09-offline-sync.md`
- `tasks/09-offline-sync/T-OF-LOCAL-DB.md` (upstream contract)
- `tasks/09-offline-sync/T-OF-QUEUE.md` (upstream contract)
- `apps/mobile/src/db/` (schema + migrations; v3 added here for the
  `sync_conflict_log` table)
- `apps/mobile/src/repositories/` (typed CRUD facades — consume as-is)
- `apps/mobile/src/sync/queue/` (dead-letter source + re-enqueue API)
- `packages/api-client/` (typed `@binderly/api-client` — fetch fresh
  server state)

## Goal

When the T-OF-QUEUE replay engine exhausts its 10 retries against the
server for a single mutation, that row is dead-lettered. This task
consumes those dead-letter events, fetches the fresh server state for
the affected entity, compares `updated_at` timestamps under a
last-write-wins (LWW) policy, applies the winner, persists every
decision to a `sync_conflict_log` table for debug / future-undo UX, and
surfaces an `onConflictResolved` event so the UX layer can later show a
toast when the server-side state overrode a local edit. **Closes Stage
09 offline-sync 3/3.**

## Deliverables

### Module (`apps/mobile/src/sync/conflicts/`)

| File | Description |
|---|---|
| `types.ts` | `ConflictResolution` enum (`local_won \| server_won \| server_won_deleted \| transient_error`), `ConflictLogEntry`, `ConflictResolvedEvent`, `ServerFetchResult` adapter shape. |
| `server-fetcher.ts` | `ServerFetcher` interface + `makeDefaultServerFetcher(collectionResource)`. Encapsulates the per-table API call (paginated `listCollectionItems` for `user_collection_item`; `getCustomCollection` for `custom_collection` + `smart_collection`; `listCustomCollectionItems` for membership rows). |
| `local-writer.ts` | Direct-to-SQLite writers that overwrite the local row with server state. Bypasses repository event-emission to avoid re-enqueueing the resolution as a new mutation. |
| `resolver.ts` | `ConflictResolver` class with `resolve(event: DeadLetterEvent): Promise<ConflictLogEntry>`. Pure LWW logic + transaction orchestration. |
| `log-repository.ts` | `SyncConflictLogRepository` typed CRUD: `append(entry)`, `findAll()`, `findByEntity(table, id)`. |
| `event-emitter.ts` | `conflictEvents.onConflictResolved(observer): () => void`. UX seam. |
| `start.ts` | `startConflictResolver({ syncQueueRepo, apiClient, conflictLogRepo, serverFetcher?, onResolved? }): () => void`. Wires the dead-letter subscription to the resolver. Mirrors T-OF-QUEUE's `startSync` shape. |
| `index.ts` | Public barrel. |

### Migration + schema

| File | Description |
|---|---|
| `apps/mobile/src/db/migrations/v3.ts` | Creates `sync_conflict_log` table. `CREATE TABLE IF NOT EXISTS` for idempotency. |
| `apps/mobile/src/db/migrations/index.ts` | Add v3 entry to `MIGRATIONS` array. |
| `apps/mobile/src/db/schema.ts` | Add `CREATE_SYNC_CONFLICT_LOG_TABLE` + `CREATE_SYNC_CONFLICT_LOG_INDEXES` constants; bump `CURRENT_SCHEMA_VERSION` to 3. |

### `sync_conflict_log` columns

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PRIMARY KEY | Client-generated UUID. |
| `table_name` | TEXT NOT NULL | Matches `sync_queue.table_name`. |
| `entity_id` | TEXT NOT NULL | Canonical entity id (composite for `custom_collection_item`). |
| `op_type` | TEXT NOT NULL | `created \| updated \| deleted` from the queue row. |
| `resolution` | TEXT NOT NULL | `local_won \| server_won \| server_won_deleted \| transient_error`. |
| `local_payload_json` | TEXT NOT NULL | The queue row's payload (frozen at time of attempted write). |
| `server_payload_json` | TEXT NULL | Fetched server state; NULL on 404 / transient error. |
| `local_updated_at` | TEXT NULL | ISO-8601 of the local row, when applicable. |
| `server_updated_at` | TEXT NULL | ISO-8601 from the server row, when applicable. |
| `error_detail` | TEXT NULL | NULL on success; the error string on `transient_error`. |
| `created_at` | TEXT NOT NULL | ISO-8601 timestamp of the resolution attempt. |

### Tests (`apps/mobile/src/sync/conflicts/__tests__/`)

Mirror T-OF-QUEUE's structure. Cover:

1. LWW comparator (local-newer / server-newer / exact tie / missing
   server / variants per op type).
2. Resolver happy paths: `local_won` (with re-enqueue verification),
   `server_won` (with overwrite verification), `server_won_deleted`.
3. Transient-error path (5xx / network error → dead-letter row retained
   + `transient_error` log entry).
4. Idempotency: resolving the same dead-letter event twice yields the
   same final state (no double re-enqueue, no double overwrite).
5. `sync_conflict_log` CRUD.
6. Event emitter: observer fires on `server_won` resolution;
   unsubscribe stops firing.
7. End-to-end integration of `startConflictResolver` against a mocked
   queue, mocked api-client, and sql.js-backed repositories.
8. Migration v3 applies cleanly on fresh + upgrade paths; idempotent.

Target **60+ vitest tests**. Use `sql.js`-backed `expo-sqlite` mock
from `apps/mobile/src/test-utils/setup.ts`. Mock `@binderly/api-client`
per-test for HTTP scenarios.

## Acceptance criteria

- [ ] v3 SQLite migration creates `sync_conflict_log` and is idempotent
  on re-apply.
- [ ] `CURRENT_SCHEMA_VERSION` bumped to 3; migration runner applies
  v1+v2+v3 on a fresh DB and v3 only on a v2 DB.
- [ ] LWW resolver compiles, types check, and all tests pass under
  `pnpm --filter @binderly/mobile test`.
- [ ] At least **60 new vitest tests** added under
  `apps/mobile/src/sync/conflicts/__tests__/`.
- [ ] `startConflictResolver(...)` returns a stop function and the
  dead-letter subscription is observable via the conflict-resolved
  event emitter end-to-end in tests.
- [ ] `pnpm lint` + `pnpm typecheck` + `pnpm build` +
  `pnpm --filter @binderly/mobile test` all green locally.
- [ ] PR merged + branch/worktree cleaned up.
- [ ] `status.md` Stage 09 → 3/3 CLOSED + "Last 5 merges" updated +
  any new follow-ups appended.
- [ ] `dependencies.yaml` `T-OF-CONFLICTS.status: merged`.
- [ ] No changes outside owns_paths (or escalation-documented additive
  changes only).

## Out of scope

- A UX toast or banner: the resolver only emits the event; rendering it
  is a follow-up task (`T-M-CONFLICT-UX`).
- Undo: the log table preserves enough state to build undo later, but
  the actual undo flow is not implemented here.
- Catalog-mirror / browse-history conflicts: `printing_lite` is a
  pure cache, never a queue source.
- Modifying the 3 repositories or `apps/mobile/src/sync/queue/` (consume
  as-is per task brief).

## Branch & PR

- Branch: `agent/T-OF-CONFLICTS`
- PR title: `feat(mobile): T-OF-CONFLICTS — LWW conflict resolution + sync_conflict_log`
- Commit format: Conventional Commits

## Escalation triggers

Stop and surface to orchestrator if:

- A required dependency turns out to be wrong/missing.
- A change is needed outside `owns_paths` that requires materially
  expanding the api-client or the 3 repositories beyond a minimal
  additive method.
- An acceptance criterion conflicts with `PROJECT.md`.

## Notes from execution

_(empty until the sub-agent runs)_
