// Migration v1 — initial schema.
//
// Creates all 6 local tables + their indexes. This is the first and (so far)
// only migration. The runner calls this via `up(db)` after verifying that the
// current schema_version is below 1.
//
// Each `execAsync` call uses a single semicolon-separated batch where possible
// to keep the migration atomic within the surrounding transaction.

import {
  CREATE_CUSTOM_COLLECTION_INDEXES,
  CREATE_CUSTOM_COLLECTION_ITEM_TABLE,
  CREATE_CUSTOM_COLLECTION_TABLE,
  CREATE_META_TABLE,
  CREATE_PRINTING_LITE_TABLE,
  CREATE_SMART_COLLECTION_INDEXES,
  CREATE_SMART_COLLECTION_TABLE,
  CREATE_USER_COLLECTION_ITEM_INDEXES,
  CREATE_USER_COLLECTION_ITEM_TABLE,
} from '../schema.js';

import type { SQLiteDatabase } from 'expo-sqlite';

export async function up(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(CREATE_META_TABLE);

  await db.execAsync(CREATE_USER_COLLECTION_ITEM_TABLE);
  await db.execAsync(CREATE_USER_COLLECTION_ITEM_INDEXES);

  await db.execAsync(CREATE_CUSTOM_COLLECTION_TABLE);
  await db.execAsync(CREATE_CUSTOM_COLLECTION_INDEXES);

  await db.execAsync(CREATE_CUSTOM_COLLECTION_ITEM_TABLE);

  await db.execAsync(CREATE_SMART_COLLECTION_TABLE);
  await db.execAsync(CREATE_SMART_COLLECTION_INDEXES);

  await db.execAsync(CREATE_PRINTING_LITE_TABLE);
}
