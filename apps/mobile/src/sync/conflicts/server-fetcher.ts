// server-fetcher.ts — per-table API adapters that return the current
// server state for a conflicting entity.
//
// Why an adapter? Because:
//
//  1. The `@binderly/api-client` `CollectionResource` does NOT expose a
//     single-fetch `getCollectionItem(id)` for `user_collection_item`;
//     callers either paginate `listCollectionItems` or wait for a
//     server-side route addition. See Q-019 in `open-questions.md`.
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
 * branch maps the queued table to the right api-client call:
 *
 *   - user_collection_item:    paginated `listCollectionItems` walk
 *                              until id match. Bounded by `walkLimit`
 *                              (default 25 pages × server-default 50 =
 *                              1250 rows — well above realistic
 *                              offline-edit volumes).
 *   - custom_collection:       `getCustomCollection({id})` → 404 → not_found.
 *   - smart_collection:        same — server stores both as
 *                              `custom_collection` rows.
 *   - custom_collection_item:  `listCustomCollectionItems({customCollectionId})`
 *                              then linear scan for `printingId`.
 *                              No updatedAt → `updatedAt: null`.
 */
export function makeDefaultServerFetcher(
  collection: CollectionResource,
  options: { walkLimit?: number } = {},
): ServerFetcher {
  const walkLimit = options.walkLimit ?? 25;

  async function fetchUserCollectionItem(id: string): Promise<ServerFetchResult> {
    let cursor: string | undefined = undefined;
    for (let page = 0; page < walkLimit; page += 1) {
      try {
        const res: Awaited<ReturnType<typeof collection.listCollectionItems>> =
          cursor !== undefined
            ? await collection.listCollectionItems({ cursor })
            : await collection.listCollectionItems({});
        const match = res.items.find(
          (item: { id: string; updatedAt: string }) => item.id === id,
        );
        if (match !== undefined) {
          return {
            kind: 'found',
            payload: match,
            updatedAt: match.updatedAt,
          };
        }
        if (res.nextCursor === null || res.nextCursor === undefined) {
          return { kind: 'not_found' };
        }
        cursor = res.nextCursor;
      } catch (err) {
        return classifyError(err);
      }
    }
    // Hit the page cap without finding the row. Conservative: treat
    // as transient so we don't apply server-wins on a possibly-stale
    // pagination walk.
    return {
      kind: 'transient_error',
      error: `listCollectionItems pagination exceeded ${walkLimit} pages`,
    };
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
      const items = await collection.listCustomCollectionItems({ customCollectionId });
      const match = items.find(
        (item: { printingId: string }) => item.printingId === printingId,
      );
      if (match === undefined) {
        return { kind: 'not_found' };
      }
      return {
        kind: 'found',
        payload: match,
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
