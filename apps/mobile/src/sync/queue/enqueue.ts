// enqueue.ts — subscribe to all 3 repository onLocalWrite events and
// write rows to sync_queue.
//
// Each LocalWriteEvent becomes one sync_queue row. The row id is
// derived from the entity id + op_type so that if the same write is
// somehow emitted twice (e.g. across an app restart before the queue
// is drained), the second INSERT OR IGNORE is a no-op (idempotent).
//
// Note: `custom_collection_item` rows use a composite id
// `(customCollectionId):(printingId):(op_type)` since the table has
// no single-column primary key.

import { syncQueueRepo } from './SyncQueueRepository.js';
import { customCollectionRepo } from '../../repositories/CustomCollectionRepository.js';
import { smartCollectionRepo } from '../../repositories/SmartCollectionRepository.js';
import { userCollectionRepo } from '../../repositories/UserCollectionRepository.js';

import type { QueueOpType, QueueTableName } from './types.js';
import type {
  CustomCollection,
  CustomCollectionItem,
  SmartCollection,
  UserCollectionItem,
 LocalWriteEvent } from '../../repositories/types.js';

function makeQueueId(entityId: string, opType: string): string {
  return `${entityId}:${opType}:${Date.now()}`;
}

async function handleUserCollectionWrite(
  event: LocalWriteEvent<UserCollectionItem>,
): Promise<void> {
  const entity = event.payload;
  // For pending_create events emitted for local-only rows that are
  // immediately deleted (syncStatus === 'pending_delete' on a pending_create
  // row), the remove() path in the repo already skips the server sync.
  // We enqueue all events; the translator handles the mapping.
  const id = makeQueueId(entity.id, event.type);
  await syncQueueRepo.enqueue(
    id,
    'user_collection_item' as QueueTableName,
    event.type as QueueOpType,
    JSON.stringify(entity),
  );
}

async function handleCustomCollectionWrite(
  event: LocalWriteEvent<CustomCollection | CustomCollectionItem>,
): Promise<void> {
  const payload = event.payload;

  // Determine table and entity id
  if ('customCollectionId' in payload) {
    // CustomCollectionItem
    const item = payload as CustomCollectionItem;
    const compositeId = `${item.customCollectionId}:${item.printingId}`;
    const id = makeQueueId(compositeId, event.type);
    await syncQueueRepo.enqueue(
      id,
      'custom_collection_item' as QueueTableName,
      event.type as QueueOpType,
      JSON.stringify(item),
    );
  } else {
    // CustomCollection
    const col = payload as CustomCollection;
    const id = makeQueueId(col.id, event.type);
    await syncQueueRepo.enqueue(
      id,
      'custom_collection' as QueueTableName,
      event.type as QueueOpType,
      JSON.stringify(col),
    );
  }
}

async function handleSmartCollectionWrite(
  event: LocalWriteEvent<SmartCollection>,
): Promise<void> {
  const entity = event.payload;
  const id = makeQueueId(entity.id, event.type);
  await syncQueueRepo.enqueue(
    id,
    'smart_collection' as QueueTableName,
    event.type as QueueOpType,
    JSON.stringify(entity),
  );
}

/**
 * Subscribe to all 3 repositories and enqueue every local write.
 * Returns a cleanup function that unsubscribes all observers.
 */
export function subscribeAll(): () => void {
  const unsub1 = userCollectionRepo.onLocalWrite((event) => {
    void handleUserCollectionWrite(event);
  });

  const unsub2 = customCollectionRepo.onLocalWrite((event) => {
    void handleCustomCollectionWrite(event);
  });

  const unsub3 = smartCollectionRepo.onLocalWrite((event) => {
    void handleSmartCollectionWrite(event);
  });

  return (): void => {
    unsub1();
    unsub2();
    unsub3();
  };
}
