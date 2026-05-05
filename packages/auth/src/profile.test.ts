// Unit tests for the application-level profile-provisioning safety net.
//
// We mock the Supabase service-role client's PostgREST builder chain
// (`from(table).upsert(...).select(...)`) and assert:
//   - `provisionProfile` calls upsert on `profile` then `subscription`
//   - the conflict-target + ignore-duplicates flags are wired correctly
//   - idempotency: if both calls return zero affected rows, `inserted = false`
//   - missing rows on first call: `inserted = true`
//   - upstream errors translate to AuthError(code: 'no_profile')

import { describe, expect, it, vi } from 'vitest';

import { AuthError } from './errors.js';
import { defaultHandleFor, provisionProfile } from './profile.js';

import type { SupabaseClient } from '@supabase/supabase-js';

const USER_ID = '11111111-1111-1111-1111-111111111111';

interface UpsertCall {
  readonly table: string;
  readonly values: Record<string, unknown>;
  readonly onConflict?: string;
  readonly ignoreDuplicates?: boolean;
}

interface MockServiceClientOptions {
  /**
   * Per-table response shape: `data` is the array of rows the
   * builder chain ultimately resolves to; `error` is the
   * PostgREST-style error or null.
   */
  readonly tables?: Readonly<
    Record<
      string,
      { data?: ReadonlyArray<Record<string, unknown>>; error?: { message: string } | null }
    >
  >;
}

function mockServiceClient(opts: MockServiceClientOptions = {}): {
  client: SupabaseClient;
  calls: UpsertCall[];
} {
  const calls: UpsertCall[] = [];
  const tables = opts.tables ?? {};
  const fromFn = (table: string): unknown => ({
    upsert: (
      values: Record<string, unknown>,
      upsertOpts?: { onConflict?: string; ignoreDuplicates?: boolean },
    ) => ({
      select: (_columns: string) => {
        const result = tables[table] ?? { data: [{ user_id: USER_ID }], error: null };
        calls.push({
          table,
          values,
          ...(upsertOpts?.onConflict !== undefined ? { onConflict: upsertOpts.onConflict } : {}),
          ...(upsertOpts?.ignoreDuplicates !== undefined
            ? { ignoreDuplicates: upsertOpts.ignoreDuplicates }
            : {}),
        });
        return Promise.resolve({
          data: result.data ?? [],
          error: result.error ?? null,
        });
      },
    }),
  });
  return {
    client: { from: vi.fn(fromFn) } as unknown as SupabaseClient,
    calls,
  };
}

describe('defaultHandleFor', () => {
  it('returns "u_<first 12 hex chars of UUID, dashes stripped>"', () => {
    expect(defaultHandleFor('abcdef12-3456-7890-abcd-ef1234567890')).toBe('u_abcdef123456');
  });
});

describe('provisionProfile', () => {
  it('upserts profile and subscription rows with the correct conflict-target + ignore-duplicates', async () => {
    const { client, calls } = mockServiceClient();
    await provisionProfile(client, USER_ID);
    expect(calls).toHaveLength(2);
    const [profileCall, subscriptionCall] = calls;
    expect(profileCall?.table).toBe('profile');
    expect(profileCall?.values).toEqual({ user_id: USER_ID, handle: defaultHandleFor(USER_ID) });
    expect(profileCall?.onConflict).toBe('user_id');
    expect(profileCall?.ignoreDuplicates).toBe(true);
    expect(subscriptionCall?.table).toBe('subscription');
    expect(subscriptionCall?.values).toEqual({ user_id: USER_ID, tier: 'free' });
    expect(subscriptionCall?.onConflict).toBe('user_id');
    expect(subscriptionCall?.ignoreDuplicates).toBe(true);
  });

  it('returns inserted=true when the profile row was created (mock returns one row)', async () => {
    const { client } = mockServiceClient({
      tables: {
        profile: { data: [{ user_id: USER_ID, handle: defaultHandleFor(USER_ID) }] },
        subscription: { data: [] },
      },
    });
    const result = await provisionProfile(client, USER_ID);
    expect(result.inserted).toBe(true);
    expect(result.userId).toBe(USER_ID);
    expect(result.handle).toBe(defaultHandleFor(USER_ID));
  });

  it('is idempotent: returns inserted=false when both rows already existed', async () => {
    // PostgREST with `Prefer: resolution=ignore-duplicates` returns
    // an empty data array when the row was already present.
    const { client } = mockServiceClient({
      tables: {
        profile: { data: [] },
        subscription: { data: [] },
      },
    });
    const result = await provisionProfile(client, USER_ID);
    expect(result.inserted).toBe(false);
    expect(result.userId).toBe(USER_ID);
  });

  it('accepts a caller-supplied handle override', async () => {
    const { client, calls } = mockServiceClient();
    await provisionProfile(client, USER_ID, { handle: 'pablo' });
    expect(calls[0]?.values).toEqual({ user_id: USER_ID, handle: 'pablo' });
  });

  it('throws AuthError(no_profile) when the profile upsert fails', async () => {
    expect.assertions(2);
    const { client } = mockServiceClient({
      tables: { profile: { data: [], error: { message: 'unique violation: handle' } } },
    });
    try {
      await provisionProfile(client, USER_ID);
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).code).toBe('no_profile');
    }
  });

  it('throws AuthError(no_profile) when the subscription upsert fails', async () => {
    expect.assertions(2);
    const { client } = mockServiceClient({
      tables: {
        profile: { data: [{ user_id: USER_ID }] },
        subscription: { data: [], error: { message: 'check constraint subscription_tier_check' } },
      },
    });
    try {
      await provisionProfile(client, USER_ID);
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).code).toBe('no_profile');
    }
  });

  it('refuses to run with an empty user id (configuration mistake, not an auth event)', async () => {
    expect.assertions(1);
    const { client } = mockServiceClient();
    try {
      await provisionProfile(client, '');
    } catch (error) {
      expect((error as Error).message).toMatch(/userId must be a non-empty string/);
    }
  });
});
