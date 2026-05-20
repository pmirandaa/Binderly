# T-OF-LOCAL-DB — Mobile SQLite schema mirror + local repository layer

**Stage:** 09-offline-sync
**Agent role:** frontend-mobile
**Effort:** L
**Status:** in_progress

## Hard dependencies

- T-M-COLLECTION (must be merged — the collection screens are the primary downstream consumer)

## Soft dependencies

- T-OF-QUEUE (parallel-safe; T-OF-QUEUE wires the repository seam into the sync engine; ships after this)
- T-OF-CONFLICTS (sequential after T-OF-QUEUE; reads `sync_status` written here)

## Required reading

- `PROJECT.md` § 15 (Offline Mode)
- `rules/09-offline-sync.md`
- `context/data-model.md` (canonical schema; mobile mirrors a subset)
- `context/conventions.md`
- `packages/db/src/schema/collections.ts` — `collection_item` server schema
- `packages/db/src/schema/custom_collections.ts` — `custom_collection` + `custom_collection_item`
- `packages/db/src/schema/smart_rules.ts` — `smart_collection_rule`
- `packages/db/src/schema/printings.ts` — `printing` (only `image_small_url` + key identity columns mirrored)
- `apps/mobile/src/test-utils/setup.ts` — established mock patterns to extend with expo-sqlite fake

## Goal

Implement the SQLite schema mirror and typed repository facade for the Binderly mobile app's
offline-first collection layer. After this task merges, the mobile app has a fully functional
local read/write store for all user collection data. T-OF-QUEUE builds on top of it to replay
mutations back to the server. Screens do **not** change in this task — they still call
`@binderly/api-client` directly. This task ships the infrastructure layer only.

The local DB lives at `apps/mobile/src/db/` (schema, migrations, connection) and
`apps/mobile/src/repositories/` (typed facades). The repositories are the **only** legitimate
reader/writer to the local DB; screens are never allowed to issue raw SQL.

## Deliverables

### `apps/mobile/src/db/`

- `schema.ts` — SQL `CREATE TABLE` strings for all 6 local tables (see below)
- `migrations/v1.ts` — initial migration function `up(db)` that creates all tables + `_meta`
- `migrations/index.ts` — migration runner: reads `_meta.schema_version`, applies pending
  migrations in order, updates the version counter; idempotent
- `connection.ts` — lazy async singleton: opens the SQLite DB on first call, runs migrations,
  returns the `SQLiteDatabase` handle; app shell never bootstrap-crashes because the DB is opened
  lazily on first repository access, not at module load time
- `index.ts` — re-exports `getDb`, `resetDbForTesting`

### `apps/mobile/src/repositories/`

- `types.ts` — shared TypeScript types: row types for each table, `LocalWriteEvent<T>`, `SyncStatus`
- `UserCollectionRepository.ts` — see method table below
- `CustomCollectionRepository.ts` — see method table below
- `SmartCollectionRepository.ts` — see method table below
- `index.ts` — re-exports all three repository singletons + their types

### Test files

- `src/db/__tests__/migrations.test.ts` — migration round-trip tests
- `src/db/__tests__/connection.test.ts` — lazy connection + reset lifecycle
- `src/repositories/__tests__/UserCollectionRepository.test.ts`
- `src/repositories/__tests__/CustomCollectionRepository.test.ts`
- `src/repositories/__tests__/SmartCollectionRepository.test.ts`

### Test infra

- `src/test-utils/setup.ts` — extended with `expo-sqlite` fake (sql.js-backed in-memory engine)

## Schema — local tables

The mobile DB mirrors a **subset** of the server schema. Only user-owned data is stored locally.
The full card catalog (sets, cards, printings) lives on the server; only a thin
`printing_lite` cache for cards the user has actually interacted with is stored on-device.

### `_meta`

```sql
CREATE TABLE IF NOT EXISTS _meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

Single row: `key = 'schema_version', value = '1'`.

### `user_collection_item`

Mirrors `collection_item` (server). Intentional omissions: `photo_urls` (R2 upload, server-only),
`grade` stored as TEXT not NUMERIC (SQLite type flexibility), no cross-schema FK (local-only store).

```sql
CREATE TABLE IF NOT EXISTS user_collection_item (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL,
  printing_id       TEXT NOT NULL,
  quantity          INTEGER NOT NULL DEFAULT 1,
  condition         TEXT NOT NULL DEFAULT 'NEAR_MINT',
  grade_company     TEXT,
  grade             TEXT,
  acquired_at       TEXT,
  acquired_price    TEXT,
  acquired_currency TEXT,
  notes             TEXT,
  source            TEXT NOT NULL DEFAULT 'manual',
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  synced_at         TEXT,
  sync_status       TEXT NOT NULL DEFAULT 'synced'
);
```

Indexes: `(user_id)`, `(user_id, printing_id)`, `(sync_status)`.

### `custom_collection`

Mirrors `custom_collection` where `kind = 'manual'`. Smart collections use a dedicated table
(`smart_collection` below) because they have different columns and different sync semantics.
`kind` column omitted — this table is implicitly `kind = 'manual'`.

```sql
CREATE TABLE IF NOT EXISTS custom_collection (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL,
  description TEXT,
  cover_url   TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  synced_at   TEXT,
  sync_status TEXT NOT NULL DEFAULT 'synced'
);
```

Indexes: `(user_id)`, `(user_id, slug)`.

### `custom_collection_item`

```sql
CREATE TABLE IF NOT EXISTS custom_collection_item (
  custom_collection_id TEXT NOT NULL
    REFERENCES custom_collection(id) ON DELETE CASCADE,
  printing_id          TEXT NOT NULL,
  added_at             TEXT NOT NULL,
  PRIMARY KEY (custom_collection_id, printing_id)
);
```

### `smart_collection`

Merges `custom_collection (kind='smart')` + `smart_collection_rule` from the server schema into
one flat local table. Rationale: the 1:1 join never makes sense to split on mobile; the extra
round-trip through a JOIN buys nothing at this scale.

```sql
CREATE TABLE IF NOT EXISTS smart_collection (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL,
  name              TEXT NOT NULL,
  slug              TEXT NOT NULL,
  description       TEXT,
  expression        TEXT NOT NULL,
  last_evaluated_at TEXT,
  cached_count      INTEGER,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  synced_at         TEXT,
  sync_status       TEXT NOT NULL DEFAULT 'synced'
);
```

Indexes: `(user_id)`, `(sync_status)`.

### `printing_lite`

Thin cache for offline card rendering. Only populated for printings the user has in their
collection (UserCollectionRepository populates it as a side-effect of upsert). Does NOT cover
the full catalog; that's a follow-up (#FU-41).

```sql
CREATE TABLE IF NOT EXISTS printing_lite (
  id             TEXT PRIMARY KEY,
  variant_key    TEXT NOT NULL UNIQUE,
  card_name      TEXT NOT NULL,
  set_name       TEXT NOT NULL,
  set_code       TEXT NOT NULL,
  image_small_url TEXT,
  last_seen_at   TEXT NOT NULL
);
```

## Repository API surface

### Shared

```ts
type SyncStatus = 'synced' | 'pending_create' | 'pending_update' | 'pending_delete';

interface LocalWriteEvent<T> {
  type:      'created' | 'updated' | 'deleted';
  table:     string;
  payload:   T;           // full row for created/updated; { id: string } for deleted
  timestamp: string;      // ISO-8601
}
```

### `UserCollectionRepository`

```ts
// Reads
findAll(userId: string): Promise<UserCollectionItem[]>
findById(id: string): Promise<UserCollectionItem | null>
findByPrintingId(userId: string, printingId: string): Promise<UserCollectionItem[]>
findPending(): Promise<UserCollectionItem[]>               // sync_status != 'synced'

// Writes (all set sync_status = 'pending_*' and emit onLocalWrite)
upsert(item: UpsertUserCollectionItemInput): Promise<UserCollectionItem>
update(id: string, patch: UpdateUserCollectionItemInput): Promise<UserCollectionItem | null>
remove(id: string): Promise<void>                         // marks 'pending_delete' then removes

// Sync seam (called by T-OF-QUEUE)
markSynced(id: string, syncedAt: string): Promise<void>

// Subscribe hook (T-OF-QUEUE consumes)
onLocalWrite(observer: (event: LocalWriteEvent<UserCollectionItem>) => void): () => void
```

### `CustomCollectionRepository`

```ts
// Collection reads
findAll(userId: string): Promise<CustomCollection[]>
findById(id: string): Promise<CustomCollection | null>
findBySlug(userId: string, slug: string): Promise<CustomCollection | null>
findPending(): Promise<CustomCollection[]>

// Collection writes
create(input: CreateCustomCollectionInput): Promise<CustomCollection>
update(id: string, patch: UpdateCustomCollectionInput): Promise<CustomCollection | null>
remove(id: string): Promise<void>
markSynced(id: string, syncedAt: string): Promise<void>

// Item reads
getItems(collectionId: string): Promise<CustomCollectionItem[]>

// Item writes (emit onLocalWrite)
addItem(collectionId: string, printingId: string): Promise<void>
removeItem(collectionId: string, printingId: string): Promise<void>

// Subscribe hook
onLocalWrite(observer: (event: LocalWriteEvent<CustomCollection | CustomCollectionItem>) => void): () => void
```

### `SmartCollectionRepository`

```ts
// Reads
findAll(userId: string): Promise<SmartCollection[]>
findById(id: string): Promise<SmartCollection | null>
findPending(): Promise<SmartCollection[]>

// Writes
create(input: CreateSmartCollectionInput): Promise<SmartCollection>
update(id: string, patch: UpdateSmartCollectionInput): Promise<SmartCollection | null>
remove(id: string): Promise<void>
markSynced(id: string, syncedAt: string): Promise<void>
updateEvaluationCache(id: string, cachedCount: number, evaluatedAt: string): Promise<void>

// Subscribe hook
onLocalWrite(observer: (event: LocalWriteEvent<SmartCollection>) => void): () => void
```

## Subscribe-hook / event-emitter contract for T-OF-QUEUE

Each repository maintains an internal `Set<Observer>`. `onLocalWrite(observer)` adds the
observer and returns an unsubscribe function. Every write method calls `emit(event)` after the
DB mutation succeeds. The event is emitted synchronously (after `await db.runAsync(...)` settles)
so T-OF-QUEUE's listener sees exactly the rows that landed.

T-OF-QUEUE usage pattern:

```ts
import { userCollectionRepo, customCollectionRepo, smartCollectionRepo }
  from '../repositories/index.js';

const unsubs = [
  userCollectionRepo.onLocalWrite(e => queue.enqueue(e)),
  customCollectionRepo.onLocalWrite(e => queue.enqueue(e)),
  smartCollectionRepo.onLocalWrite(e => queue.enqueue(e)),
];
// on teardown: unsubs.forEach(fn => fn());
```

## expo-sqlite testing strategy

`expo-sqlite` is a native Expo module that cannot run in jsdom/vitest. The mock added to
`src/test-utils/setup.ts` wraps `sql.js` (a WASM-compiled real SQLite running in Node.js) in
the `expo-sqlite` async API shape:

```
vi.mock('expo-sqlite', () => ({ openDatabaseAsync, ... }))
  → openDatabaseAsync(name) returns a fake SQLiteDatabase backed by sql.js in-memory DB
  → all async methods (execAsync, runAsync, getAllAsync, getFirstAsync, withTransactionAsync)
    resolve via Promise wrappers around sql.js's synchronous API
  → each call to openDatabaseAsync with the same name returns the SAME in-memory database
    (singleton per name) so the migration runner and repositories share state
  → resetDbForTesting() clears all named databases between tests
```

This gives tests access to real SQLite semantics (foreign keys, constraint checking, transaction
rollback) without requiring native binaries.

## Acceptance criteria

1. `apps/mobile/src/db/` contains the 5 source files listed under Deliverables.
2. `apps/mobile/src/repositories/` contains the 5 source files listed under Deliverables.
3. `pnpm --filter @binderly/mobile build` passes with 0 type errors (tsc --noEmit).
4. `pnpm --filter @binderly/mobile lint` passes with 0 warnings (eslint --max-warnings=0).
5. `pnpm --filter @binderly/mobile test` passes with ≥ 60 tests across:
   - Migration: schema creation, idempotent re-run, version bump, table existence.
   - `UserCollectionRepository`: upsert, findAll, findById, findByPrintingId, update, remove,
     findPending, markSynced, onLocalWrite emits correct events, concurrent writes, empty dataset.
   - `CustomCollectionRepository`: create, findAll, findBySlug, update, remove, findPending,
     markSynced, addItem, removeItem, getItems, cascade delete cleans items.
   - `SmartCollectionRepository`: create, findAll, findById, update, remove, findPending,
     markSynced, updateEvaluationCache, onLocalWrite.
6. The app shell (`pnpm --filter @binderly/mobile start`) does not crash on import of the new
   modules (lazy DB open; no side-effects at module load).
7. No new native dependencies added (`expo-sqlite` is already part of Expo SDK 52).
8. `sql.js` added as devDependency only (not in production bundle).

## Branch & PR

- Branch: `agent/T-OF-LOCAL-DB`
- PR title: `feat(mobile): T-OF-LOCAL-DB — SQLite schema mirror + local repository layer`

## Notes from execution

- `printing_lite` is owned by this task. T-OF-QUEUE will populate it as part of the
  optimistic-write flow (when a user adds a card, the printing metadata is cached locally).
  This task creates the table and the read interface; T-OF-QUEUE writes to it.
- `sync_status` column is the T-OF-QUEUE consumption seam. Values: `'synced'`,
  `'pending_create'`, `'pending_update'`, `'pending_delete'`.
- No screen-side changes. Screens continue calling `@binderly/api-client` directly.
  T-OF-QUEUE is responsible for wiring repositories into the screen data-flow.
- Open question logged as Q-016: whether `printing_lite` should also cache `set.logo_url` for
  the CollectionScreen set-row renderer, or whether that remains a network-only concern until
  T-OF-QUEUE ships. Decision deferred; the `printing_lite` schema can be extended in-place
  with `ALTER TABLE` in a v2 migration.
