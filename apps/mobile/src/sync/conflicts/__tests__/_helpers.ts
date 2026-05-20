// Shared helpers for the T-OF-CONFLICTS test suite. Mirrors the
// posture in `apps/mobile/src/sync/queue/__tests__/replay.test.ts`:
// inline payload factories + a sql.js-backed db reset + a mock
// dead-letter event builder.

import { afterEach, beforeEach } from 'vitest';

import { resetDbForTesting } from '../../../db/connection.js';
import { getDb } from '../../../db/index.js';
import { __resetSqliteDbs } from '../../../test-utils/setup.js';

import type {
  DeadLetterEvent,
  QueueOpType,
  QueueTableName,
  SyncQueueRow,
} from '../../queue/types.js';

export const NOW = new Date('2026-06-01T12:00:00.000Z');

/** Build a queue row literal — useful for synthesising dead-letter
 *  events directly without going through `syncQueueRepo.enqueue`. */
export function makeQueueRow(
  overrides: Partial<SyncQueueRow> & { payloadJson: string },
): SyncQueueRow {
  const base: SyncQueueRow = {
    id: 'q-1',
    tableName: 'user_collection_item' as QueueTableName,
    opType: 'created' as QueueOpType,
    payloadJson: overrides.payloadJson,
    createdAt: NOW.toISOString(),
    attempts: 10,
    lastError: 'final attempt failed',
    nextAttemptAt: NOW.toISOString(),
    status: 'failed',
  };
  return { ...base, ...overrides };
}

export function makeDeadLetterEvent(
  overrides: Partial<SyncQueueRow> & { payloadJson: string },
  finalError = 'boom',
): DeadLetterEvent {
  return {
    row: makeQueueRow(overrides),
    finalError,
  };
}

// ---- Payload factories -------------------------------------------------

interface UciOverrides {
  id?: string;
  userId?: string;
  printingId?: string;
  quantity?: number;
  updatedAt?: string;
  createdAt?: string;
  syncStatus?: string;
}

export function uciPayload(o: UciOverrides = {}): Record<string, unknown> {
  return {
    id: o.id ?? 'uci-1',
    userId: o.userId ?? 'user-1',
    printingId: o.printingId ?? 'print-1',
    quantity: o.quantity ?? 1,
    condition: 'NEAR_MINT',
    gradeCompany: null,
    grade: null,
    acquiredAt: null,
    acquiredPrice: null,
    acquiredCurrency: null,
    notes: null,
    source: 'manual',
    createdAt: o.createdAt ?? NOW.toISOString(),
    updatedAt: o.updatedAt ?? NOW.toISOString(),
    syncedAt: null,
    syncStatus: o.syncStatus ?? 'pending_update',
  };
}

export function ccPayload(o: { id?: string; updatedAt?: string } = {}): Record<string, unknown> {
  return {
    id: o.id ?? 'cc-1',
    userId: 'user-1',
    name: 'Manual Collection',
    slug: 'manual-collection',
    description: null,
    coverUrl: null,
    createdAt: NOW.toISOString(),
    updatedAt: o.updatedAt ?? NOW.toISOString(),
    syncedAt: null,
    syncStatus: 'pending_update',
  };
}

export function scPayload(o: { id?: string; updatedAt?: string; expression?: string } = {}): Record<string, unknown> {
  return {
    id: o.id ?? 'sc-1',
    userId: 'user-1',
    name: 'Smart Collection',
    slug: 'smart-collection',
    description: null,
    expression: o.expression ?? JSON.stringify({ type: 'all' }),
    lastEvaluatedAt: null,
    cachedCount: null,
    createdAt: NOW.toISOString(),
    updatedAt: o.updatedAt ?? NOW.toISOString(),
    syncedAt: null,
    syncStatus: 'pending_update',
  };
}

export function cciPayload(o: { customCollectionId?: string; printingId?: string } = {}): Record<string, unknown> {
  return {
    customCollectionId: o.customCollectionId ?? 'cc-1',
    printingId: o.printingId ?? 'print-1',
    addedAt: NOW.toISOString(),
  };
}

// ---- Server-side payload factories (DTO shapes) ------------------------

export function serverUci(o: { id?: string; updatedAt?: string; quantity?: number } = {}): Record<string, unknown> {
  return {
    id: o.id ?? 'uci-1',
    userId: 'user-1',
    printingId: 'print-1',
    quantity: o.quantity ?? 5,
    condition: 'NEAR_MINT',
    gradeCompany: null,
    grade: null,
    acquiredAt: null,
    acquiredPrice: null,
    acquiredCurrency: null,
    notes: null,
    photoUrls: [],
    source: 'manual',
    createdAt: NOW.toISOString(),
    updatedAt: o.updatedAt ?? NOW.toISOString(),
  };
}

export function serverCc(o: { id?: string; updatedAt?: string; name?: string } = {}): Record<string, unknown> {
  return {
    id: o.id ?? 'cc-1',
    userId: 'user-1',
    kind: 'manual',
    name: o.name ?? 'Server Name',
    slug: 'server-name',
    description: null,
    coverUrl: null,
    createdAt: NOW.toISOString(),
    updatedAt: o.updatedAt ?? NOW.toISOString(),
  };
}

export function serverSc(o: { id?: string; updatedAt?: string; name?: string } = {}): Record<string, unknown> {
  return {
    id: o.id ?? 'sc-1',
    userId: 'user-1',
    kind: 'smart',
    name: o.name ?? 'Server Smart',
    slug: 'server-smart',
    description: null,
    coverUrl: null,
    createdAt: NOW.toISOString(),
    updatedAt: o.updatedAt ?? NOW.toISOString(),
  };
}

export function serverCci(
  o: { customCollectionId?: string; printingId?: string } = {},
): Record<string, unknown> {
  return {
    customCollectionId: o.customCollectionId ?? 'cc-1',
    printingId: o.printingId ?? 'print-1',
    addedAt: NOW.toISOString(),
  };
}

// ---- DB lifecycle ------------------------------------------------------

/**
 * Each test starts with a clean in-memory SQLite database with the v3
 * schema applied. Call inside `beforeEach`.
 */
export async function resetDb(): Promise<void> {
  await resetDbForTesting();
  __resetSqliteDbs();
  await getDb();
}

export async function tearDownDb(): Promise<void> {
  await resetDbForTesting();
  __resetSqliteDbs();
}

/** Convenience: install a complete beforeEach/afterEach pair.
 *  Named with the `install*` prefix instead of `use*` to avoid
 *  triggering `react-hooks/rules-of-hooks` on what is plainly a test
 *  helper, not a React hook. */
export function installFreshDb(): void {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(async () => {
    await tearDownDb();
  });
}
