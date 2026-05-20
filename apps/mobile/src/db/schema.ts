// Local SQLite schema for the Binderly mobile offline-sync layer.
//
// This module exports the SQL `CREATE TABLE` strings and index definitions
// for the 6 local tables. Tables are a deliberate subset of the server
// Postgres schema (`packages/db/src/schema/`) — only user-owned data that
// the mobile app reads or writes locally is mirrored here.
//
// Intentional omissions vs. the server schema:
//  - `photo_urls`: R2 upload URLs; server-only (no offline upload path in v1).
//  - `grade` stored as TEXT not NUMERIC: SQLite's type affinity is flexible;
//    keeping it TEXT avoids floating-point round-trip surprises when syncing.
//  - No cross-schema FKs: the local DB is user-scoped; `auth.users` doesn't
//    exist in SQLite.
//  - Full card catalog (sets, cards, printings): server-only. Only a thin
//    `printing_lite` cache for cards the user has *interacted with* is stored
//    on-device. See #FU-41 for a full catalog mirror follow-up.
//  - `custom_collection.kind`: this table is implicitly `kind = 'manual'`.
//    Smart collections are stored separately in `smart_collection` (see below).
//
// Schema versioning: stored in `_meta` table, key = 'schema_version'.
// Migration runner in `migrations/index.ts` applies forward-only migrations.

export const CREATE_META_TABLE = `
  CREATE TABLE IF NOT EXISTS _meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`.trim();

export const CREATE_USER_COLLECTION_ITEM_TABLE = `
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
  )
`.trim();

export const CREATE_USER_COLLECTION_ITEM_INDEXES = `
  CREATE INDEX IF NOT EXISTS uci_user_id_idx
    ON user_collection_item (user_id);
  CREATE INDEX IF NOT EXISTS uci_user_id_printing_id_idx
    ON user_collection_item (user_id, printing_id);
  CREATE INDEX IF NOT EXISTS uci_sync_status_idx
    ON user_collection_item (sync_status)
`.trim();

export const CREATE_CUSTOM_COLLECTION_TABLE = `
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
  )
`.trim();

export const CREATE_CUSTOM_COLLECTION_INDEXES = `
  CREATE INDEX IF NOT EXISTS cc_user_id_idx
    ON custom_collection (user_id);
  CREATE UNIQUE INDEX IF NOT EXISTS cc_user_id_slug_idx
    ON custom_collection (user_id, slug);
  CREATE INDEX IF NOT EXISTS cc_sync_status_idx
    ON custom_collection (sync_status)
`.trim();

export const CREATE_CUSTOM_COLLECTION_ITEM_TABLE = `
  CREATE TABLE IF NOT EXISTS custom_collection_item (
    custom_collection_id TEXT NOT NULL
      REFERENCES custom_collection(id) ON DELETE CASCADE,
    printing_id          TEXT NOT NULL,
    added_at             TEXT NOT NULL,
    PRIMARY KEY (custom_collection_id, printing_id)
  )
`.trim();

// `smart_collection` merges `custom_collection (kind='smart')` and
// `smart_collection_rule` from the server schema into one flat local
// table. The 1:1 join never makes sense to split in SQLite at mobile
// scale; the extra JOIN buys nothing and complicates the query surface.
export const CREATE_SMART_COLLECTION_TABLE = `
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
  )
`.trim();

export const CREATE_SMART_COLLECTION_INDEXES = `
  CREATE INDEX IF NOT EXISTS sc_user_id_idx
    ON smart_collection (user_id);
  CREATE INDEX IF NOT EXISTS sc_sync_status_idx
    ON smart_collection (sync_status)
`.trim();

// `printing_lite` — thin cache for offline card rendering. Only populated
// for printings the user has in their collection (side-effect of
// UserCollectionRepository.upsert). Does NOT cover the full catalog.
// See #FU-41 for a full catalog mirror follow-up.
//
// Note: `set_logo_url` was added in migration v2 via
// `ALTER TABLE printing_lite ADD COLUMN set_logo_url TEXT` (Q-016 Option 1).
// The v1 CREATE TABLE below intentionally omits it so v1.ts continues
// to produce the same schema as when it originally shipped.
export const CREATE_PRINTING_LITE_TABLE = `
  CREATE TABLE IF NOT EXISTS printing_lite (
    id              TEXT PRIMARY KEY,
    variant_key     TEXT NOT NULL UNIQUE,
    card_name       TEXT NOT NULL,
    set_name        TEXT NOT NULL,
    set_code        TEXT NOT NULL,
    image_small_url TEXT,
    last_seen_at    TEXT NOT NULL
  )
`.trim();

// `sync_queue` — pending mutation queue for the offline-sync replay engine
// (T-OF-QUEUE). One row per write that has not yet been confirmed by the
// server. Rows are deleted on successful replay or kept with status='failed'
// for T-OF-CONFLICTS dead-letter handling.
export const CREATE_SYNC_QUEUE_TABLE = `
  CREATE TABLE IF NOT EXISTS sync_queue (
    id              TEXT PRIMARY KEY,
    table_name      TEXT NOT NULL,
    op_type         TEXT NOT NULL,
    payload_json    TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    attempts        INTEGER NOT NULL DEFAULT 0,
    last_error      TEXT,
    next_attempt_at TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending'
  )
`.trim();

export const CREATE_SYNC_QUEUE_INDEXES = `
  CREATE INDEX IF NOT EXISTS sq_status_next_idx
    ON sync_queue (status, next_attempt_at);
  CREATE INDEX IF NOT EXISTS sq_created_at_idx
    ON sync_queue (created_at)
`.trim();

// `sync_conflict_log` — append-only audit trail of every conflict the
// LWW resolver (T-OF-CONFLICTS) has decided. One row per dead-letter
// event resolved. Used for debugging today, future undo UX tomorrow.
//
// Columns mirror the elaborated task brief exactly. Resolution values
// are constrained at the TypeScript layer (ConflictResolution enum) and
// at the SQL layer via CHECK; idempotency-of-migration uses
// CREATE TABLE IF NOT EXISTS so re-running v3 on an already-v3 db is
// a no-op (matches the v2 pattern).
export const CREATE_SYNC_CONFLICT_LOG_TABLE = `
  CREATE TABLE IF NOT EXISTS sync_conflict_log (
    id                  TEXT PRIMARY KEY,
    table_name          TEXT NOT NULL,
    entity_id           TEXT NOT NULL,
    op_type             TEXT NOT NULL,
    resolution          TEXT NOT NULL,
    local_payload_json  TEXT NOT NULL,
    server_payload_json TEXT,
    local_updated_at    TEXT,
    server_updated_at   TEXT,
    error_detail        TEXT,
    created_at          TEXT NOT NULL
  )
`.trim();

export const CREATE_SYNC_CONFLICT_LOG_INDEXES = `
  CREATE INDEX IF NOT EXISTS scl_table_entity_idx
    ON sync_conflict_log (table_name, entity_id);
  CREATE INDEX IF NOT EXISTS scl_created_at_idx
    ON sync_conflict_log (created_at)
`.trim();

export const CURRENT_SCHEMA_VERSION = 3;
