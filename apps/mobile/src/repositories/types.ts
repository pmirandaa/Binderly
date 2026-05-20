// Shared TypeScript types for the local-DB repository layer.
//
// Row types mirror the local SQLite schema (`apps/mobile/src/db/schema.ts`).
// They are NOT the same as the server-side Drizzle inferred types from
// `packages/db/src/schema/`; they are flatter (no NUMERIC, no arrays) to
// match SQLite's type system.
//
// `SyncStatus` tracks the sync state of each row:
//   - 'synced'          — server and local are in agreement.
//   - 'pending_create'  — written locally, not yet confirmed by server.
//   - 'pending_update'  — updated locally, not yet confirmed by server.
//   - 'pending_delete'  — removed from the local store; T-OF-QUEUE will
//                          send the DELETE to the server then purge the row.
//
// `LocalWriteEvent<T>` is the event shape emitted by repository write
// methods and consumed by T-OF-QUEUE's mutation queue builder.

export type SyncStatus = 'synced' | 'pending_create' | 'pending_update' | 'pending_delete';

export interface LocalWriteEvent<T> {
  type: 'created' | 'updated' | 'deleted';
  table: string;
  payload: T;
  timestamp: string;
}

// ---- user_collection_item ----

export interface UserCollectionItem {
  id: string;
  userId: string;
  printingId: string;
  quantity: number;
  condition: string;
  gradeCompany: string | null;
  grade: string | null;
  acquiredAt: string | null;
  acquiredPrice: string | null;
  acquiredCurrency: string | null;
  notes: string | null;
  source: string;
  createdAt: string;
  updatedAt: string;
  syncedAt: string | null;
  syncStatus: SyncStatus;
}

export interface UpsertUserCollectionItemInput {
  id: string;
  userId: string;
  printingId: string;
  quantity?: number;
  condition?: string;
  gradeCompany?: string | null;
  grade?: string | null;
  acquiredAt?: string | null;
  acquiredPrice?: string | null;
  acquiredCurrency?: string | null;
  notes?: string | null;
  source?: string;
  createdAt: string;
  updatedAt: string;
  syncStatus?: SyncStatus;
}

export interface UpdateUserCollectionItemInput {
  quantity?: number;
  condition?: string;
  gradeCompany?: string | null;
  grade?: string | null;
  acquiredAt?: string | null;
  acquiredPrice?: string | null;
  acquiredCurrency?: string | null;
  notes?: string | null;
  updatedAt: string;
}

// ---- custom_collection ----

export interface CustomCollection {
  id: string;
  userId: string;
  name: string;
  slug: string;
  description: string | null;
  coverUrl: string | null;
  createdAt: string;
  updatedAt: string;
  syncedAt: string | null;
  syncStatus: SyncStatus;
}

export interface CreateCustomCollectionInput {
  id: string;
  userId: string;
  name: string;
  slug: string;
  description?: string | null;
  coverUrl?: string | null;
  createdAt: string;
  updatedAt: string;
  syncStatus?: SyncStatus;
}

export interface UpdateCustomCollectionInput {
  name?: string;
  slug?: string;
  description?: string | null;
  coverUrl?: string | null;
  updatedAt: string;
}

// ---- custom_collection_item ----

export interface CustomCollectionItem {
  customCollectionId: string;
  printingId: string;
  addedAt: string;
}

// ---- smart_collection ----

export interface SmartCollection {
  id: string;
  userId: string;
  name: string;
  slug: string;
  description: string | null;
  expression: string;
  lastEvaluatedAt: string | null;
  cachedCount: number | null;
  createdAt: string;
  updatedAt: string;
  syncedAt: string | null;
  syncStatus: SyncStatus;
}

export interface CreateSmartCollectionInput {
  id: string;
  userId: string;
  name: string;
  slug: string;
  description?: string | null;
  expression: string;
  createdAt: string;
  updatedAt: string;
  syncStatus?: SyncStatus;
}

export interface UpdateSmartCollectionInput {
  name?: string;
  slug?: string;
  description?: string | null;
  expression?: string;
  updatedAt: string;
}

// ---- printing_lite ----

export interface PrintingLite {
  id: string;
  variantKey: string;
  cardName: string;
  setName: string;
  setCode: string;
  imageSmallUrl: string | null;
  lastSeenAt: string;
}

export interface UpsertPrintingLiteInput {
  id: string;
  variantKey: string;
  cardName: string;
  setName: string;
  setCode: string;
  imageSmallUrl?: string | null;
  lastSeenAt: string;
}
