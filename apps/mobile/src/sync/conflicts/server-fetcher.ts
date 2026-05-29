// server-fetcher.ts — per-table API adapters that return the current
// server state for a conflicting entity.
//
// Why an adapter? Because:
//
//  1. Each conflicting table maps to a different `CollectionResource`
//     call, and the result must be normalised into the resolver's
//     `ServerFetchResult` union (`found` / `not_found` /
//     `transient_error`). The adapter owns that mapping. Single-row
//     reads use the dedicated single-GETs shipped by #FU-49
//     (`getCollectionItem({id})` /
//     `getCustomCollectionItem({customCollectionId, printingId})`),
//     which closed the Q-019 gap — so there is no page-walk anymore
//     (#FU-59).
//  2. `custom_collection_item` has no `updated_at` column on the wire
//     (it's an immutable membership row); LWW comparison doesn't
//     apply. The adapter still reports `found` / `not_found` so the
//     resolver can apply the deterministic "server wins after queue
//     exhaustion" policy.
//  3. `smart_collection` is stored server-side as `custom_collection`
//     with `kind='smart'`; we fetch the `customCollectionDto` and
//     use its `updatedAt`.
//
// The resolver consumes only the abstract `ServerFetcher` interface so
// tests can swap in trivial fakes for each scenario.

import {
  ApiNetworkError,
  ApiNotFoundError,
  ApiRateLimitError,
  ApiServerError,
  type CollectionResource,
} from '@binderly/api-client';

import type { ServerFetchResult, ServerFetcher } from './types.js';
import type { DeadLetterEvent, QueueTableName } from '../queue/types.js';

interface ParsedEntityRef {
  table: QueueTableName;
  /** For `user_collection_item`, `custom_collection`, `smart_collection`:
   *  the single uuid. For `custom_collection_item`: the parent collection
   *  id; `printingId` carries the child reference. */
  primaryId: string;
  /** Only populated for `custom_collection_item`. */
  printingId: string | null;
}

/**
 * Extract the canonical entity reference from a dead-letter event by
 * decoding the queued payload. Mirrors the encoding T-OF-QUEUE's
 * `enqueue.ts` writes:
 *
 *   - user_collection_item:    payload.id
 *   - custom_collection:       payload.id
 *   - smart_collection:        payload.id
 *   - custom_collection_item:  payload.customCollectionId + payload.printingId
 */
export function parseEntityRef(event: DeadLetterEvent): ParsedEntityRef {
  const payload = JSON.parse(event.row.payloadJson) as Record<string, unknown>;
  if (event.row.tableName === 'custom_collection_item') {
    return {
      table: event.row.tableName,
      primaryId: String(payload.customCollectionId ?? ''),
      printingId: String(payload.printingId ?? ''),
    };
  }
  return {
    table: event.row.tableName,
    primaryId: String(payload.id ?? ''),
    printingId: null,
  };
}

/**
 * Combined entity id used by `sync_conflict_log.entity_id`. For
 * `custom_collection_item` this is the composite
 * `${customCollectionId}:${printingId}` string; for the other 3
 * tables it's the single uuid.
 */
export function canonicalEntityId(event: DeadLetterEvent): string {
  const ref = parseEntityRef(event);
  if (ref.printingId !== null) {
    return `${ref.primaryId}:${ref.printingId}`;
  }
  return ref.primaryId;
}

/**
 * Classify an api-client error as transient (worth retrying) vs
 * not-found vs unexpected. 5xx + network + rate-limit are transient;
 * 404 maps to `not_found`; everything else (4xx-other) is treated as
 * transient too, since the resolver does not have a useful "wrong
 * request shape" recovery path — the queue already exhausted retries
 * for those.
 */
function classifyError(err: unknown): ServerFetchResult {
  if (err instanceof ApiNotFoundError) {
    return { kind: 'not_found' };
  }
  if (
    err instanceof ApiNetworkError ||
    err instanceof ApiServerError ||
    err instanceof ApiRateLimitError
  ) {
    const msg = err instanceof Error ? err.message : String(err);
    return { kind: 'transient_error', error: msg };
  }
  // Unknown / 4xx-other: treat as transient so we don't accidentally
  // discard local state on a transient bug. The dead-letter row
  // remains and will be retried on the next connectivity-restored tick.
  const msg = err instanceof Error ? err.message : String(err);
  return { kind: 'transient_error', error: msg };
}

/**
 * Default fetcher built on top of the live `CollectionResource`. Each
 * branch maps the queued table to the right api-client single-GET
 * (#FU-49 / #FU-59 — no client-side page-walk):
 *
 *   - user_collection_item:    `getCollectionItem({id})` → 404 → not_found.
 *   - custom_collection:       `getCustomCollection({id})` → 404 → not_found.
 *   - smart_collection:        same — server stores both as
 *                              `custom_collection` rows.
 *   - custom_collection_item:  `getCustomCollectionItem({customCollectionId,
 *                              printingId})` → 404 → not_found. No
 *                              updatedAt on the wire → `updatedAt: null`.
 */
export function makeDefaultServerFetcher(collection: CollectionResource): ServerFetcher {
  async function fetchUserCollectionItem(id: string): Promise<ServerFetchResult> {
    try {
      const item = await collection.getCollectionItem({ id });
      return {
        kind: 'found',
        payload: item,
        updatedAt: item.updatedAt,
      };
    } catch (err) {
      return classifyError(err);
    }
  }

  async function fetchCustomCollection(id: string): Promise<ServerFetchResult> {
    try {
      const dto = await collection.getCustomCollection({ id });
      return {
        kind: 'found',
        payload: dto,
        updatedAt: dto.updatedAt,
      };
    } catch (err) {
      return classifyError(err);
    }
  }

  async function fetchCustomCollectionItem(
    customCollectionId: string,
    printingId: string,
  ): Promise<ServerFetchResult> {
    try {
      const item = await collection.getCustomCollectionItem({ customCollectionId, printingId });
      return {
        kind: 'found',
        payload: item,
        updatedAt: null,
      };
    } catch (err) {
      return classifyError(err);
    }
  }

  return {
    async fetch(event: DeadLetterEvent): Promise<ServerFetchResult> {
      const ref = parseEntityRef(event);
      switch (ref.table) {
        case 'user_collection_item':
          return fetchUserCollectionItem(ref.primaryId);
        case 'custom_collection':
        case 'smart_collection':
          return fetchCustomCollection(ref.primaryId);
        case 'custom_collection_item':
          if (ref.printingId === null) {
            return {
              kind: 'transient_error',
              error: 'custom_collection_item dead-letter missing printingId',
            };
          }
          return fetchCustomCollectionItem(ref.primaryId, ref.printingId);
      }
    },
  };
}
