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

export const CURRENT_SCHEMA_VERSION = 1;
