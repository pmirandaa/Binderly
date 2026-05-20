// translator.ts — translates a sync_queue row into one or more
// @binderly/api-client calls.
//
// Returns an async `execute(collection)` function. If the row's
// (table_name, op_type) combination is unknown, returns null
// (defensive; should not happen in practice).
//
// Mapping:
//   user_collection_item + created  → collection.addCollectionItem
//   user_collection_item + updated  → collection.updateCollectionItem
//   user_collection_item + deleted  → collection.deleteCollectionItem
//
//   custom_collection + created     → collection.createCustomCollection (kind='manual')
//   custom_collection + updated     → collection.updateCustomCollection
//   custom_collection + deleted     → collection.deleteCustomCollection
//
//   custom_collection_item + created → collection.addPrintingToCustomCollection
//   custom_collection_item + deleted → collection.removePrintingFromCustomCollection
//
//   smart_collection + created      → collection.createCustomCollection (kind='smart')
//   smart_collection + updated      → collection.updateCustomCollection (metadata)
//                                     + collection.updateSmartCollectionExpression
//   smart_collection + deleted      → collection.deleteCustomCollection

import type { CollectionResource } from '@binderly/api-client';

import type { SyncQueueRow } from './types.js';
import type {
  CustomCollection,
  CustomCollectionItem,
  SmartCollection,
  UserCollectionItem,
} from '../../repositories/types.js';

export type ReplayExecutor = (collection: CollectionResource) => Promise<void>;

/**
 * After a successful replay we also need to call `markSynced` on the
 * source repository. This tuple carries everything the engine needs:
 *  - execute: the api-client call(s)
 *  - entityId: the local row id to mark synced (null for deletes that
 *    purge the row immediately)
 *  - tableName: which repo to call markSynced on
 */
export interface TranslateResult {
  execute: ReplayExecutor;
  /** Null for delete operations (the repo row is purged locally after the
   *  server DELETE succeeds, so there's nothing to mark synced). */
  entityId: string | null;
  tableName: SyncQueueRow['tableName'];
}

/** Parse the payload_json and translate to api-client calls. Returns null if
 *  the (tableName, opType) combination is unrecognised. */
export function translate(row: SyncQueueRow): TranslateResult | null {
  const { tableName, opType, payloadJson } = row;

  const payload = JSON.parse(payloadJson) as unknown;

  if (tableName === 'user_collection_item') {
    const item = payload as UserCollectionItem;

    if (opType === 'created') {
      return {
        tableName,
        entityId: item.id,
        execute: async (col) => {
          await col.addCollectionItem({
            printingId: item.printingId,
            quantity: item.quantity,
            condition: item.condition as Parameters<typeof col.addCollectionItem>[0]['condition'],
            gradeCompany:
              item.gradeCompany as Parameters<typeof col.addCollectionItem>[0]['gradeCompany'],
            grade: item.grade !== null ? parseFloat(item.grade) : null,
            acquiredAt: item.acquiredAt,
            acquiredPrice: item.acquiredPrice !== null ? parseFloat(item.acquiredPrice) : null,
            acquiredCurrency: item.acquiredCurrency,
            notes: item.notes,
            source: item.source as Parameters<typeof col.addCollectionItem>[0]['source'],
          });
        },
      };
    }

    if (opType === 'updated') {
      return {
        tableName,
        entityId: item.id,
        execute: async (col) => {
          await col.updateCollectionItem({
            id: item.id,
            patch: {
              quantity: item.quantity,
              condition: item.condition as Parameters<
                typeof col.updateCollectionItem
              >[0]['patch']['condition'],
              gradeCompany:
                item.gradeCompany as Parameters<
                  typeof col.updateCollectionItem
                >[0]['patch']['gradeCompany'],
              grade: item.grade !== null ? parseFloat(item.grade) : null,
              acquiredAt: item.acquiredAt,
              acquiredPrice: item.acquiredPrice !== null ? parseFloat(item.acquiredPrice) : null,
              acquiredCurrency: item.acquiredCurrency,
              notes: item.notes,
            },
          });
        },
      };
    }

    if (opType === 'deleted') {
      return {
        tableName,
        entityId: null,
        execute: async (col) => {
          await col.deleteCollectionItem({ id: item.id });
        },
      };
    }
  }

  if (tableName === 'custom_collection') {
    const col = payload as CustomCollection;

    if (opType === 'created') {
      return {
        tableName,
        entityId: col.id,
        execute: async (collection) => {
          await collection.createCustomCollection({
            kind: 'manual',
            name: col.name,
            slug: col.slug,
            description: col.description,
            coverUrl: col.coverUrl,
          });
        },
      };
    }

    if (opType === 'updated') {
      return {
        tableName,
        entityId: col.id,
        execute: async (collection) => {
          await collection.updateCustomCollection({
            id: col.id,
            patch: {
              name: col.name,
              slug: col.slug,
              description: col.description,
              coverUrl: col.coverUrl,
            },
          });
        },
      };
    }

    if (opType === 'deleted') {
      return {
        tableName,
        entityId: null,
        execute: async (collection) => {
          await collection.deleteCustomCollection({ id: col.id });
        },
      };
    }
  }

  if (tableName === 'custom_collection_item') {
    const item = payload as CustomCollectionItem;

    if (opType === 'created') {
      return {
        tableName,
        entityId: null,
        execute: async (collection) => {
          await collection.addPrintingToCustomCollection({
            customCollectionId: item.customCollectionId,
            body: { printingId: item.printingId },
          });
        },
      };
    }

    if (opType === 'deleted') {
      return {
        tableName,
        entityId: null,
        execute: async (collection) => {
          await collection.removePrintingFromCustomCollection({
            customCollectionId: item.customCollectionId,
            printingId: item.printingId,
          });
        },
      };
    }
  }

  if (tableName === 'smart_collection') {
    const sc = payload as SmartCollection;

    if (opType === 'created') {
      return {
        tableName,
        entityId: sc.id,
        execute: async (collection) => {
          await collection.createCustomCollection({
            kind: 'smart',
            name: sc.name,
            slug: sc.slug,
            description: sc.description,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expression: JSON.parse(sc.expression) as any,
          });
        },
      };
    }

    if (opType === 'updated') {
      return {
        tableName,
        entityId: sc.id,
        execute: async (collection) => {
          // Two-step: update metadata then update expression.
          // Both are idempotent. If the second call fails after the first
          // succeeds, the whole attempt is retried (backoff applies).
          await collection.updateCustomCollection({
            id: sc.id,
            patch: {
              name: sc.name,
              slug: sc.slug,
              description: sc.description,
            },
          });
          await collection.updateSmartCollectionExpression({
            customCollectionId: sc.id,
            body: {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              expression: JSON.parse(sc.expression) as any,
            },
          });
        },
      };
    }

    if (opType === 'deleted') {
      return {
        tableName,
        entityId: null,
        execute: async (collection) => {
          await collection.deleteCustomCollection({ id: sc.id });
        },
      };
    }
  }

  return null;
}
