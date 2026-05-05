// Application-level profile-provisioning safety net.
//
// The PRIMARY path for profile + subscription creation is the
// Postgres trigger in `0017_profile_provisioning_trigger.sql`,
// which fires inside the auth.users INSERT transaction so the rows
// always exist by the time any client first authenticates.
//
// This helper is the BELT-AND-BRACES path: idempotent, server-side,
// safe to call after the fact (e.g. from a worker that polls
// auth.users for any rows missing a matching profile, or from an
// admin tool that wants to back-fill a manually-deleted profile).
// Also used by tests to verify the contract holds end-to-end without
// requiring the trigger to fire first.
//
// `provisionProfile` requires a SERVICE-ROLE client. End-user
// sessions do not have INSERT privilege on `subscription` (per the
// 0001 RLS posture: subscription writes are service_role only).

import { AuthError } from './errors.js';

import type { ProvisionedProfile } from './types.js';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Generate the same default handle the DB trigger uses. Keeps the
 * application-level safety net consistent with the trigger's output
 * so a row created by either path is indistinguishable.
 *
 * Format: `'u_' || first 12 hex chars of the user UUID, dashes
 * stripped`. ~2.8 trillion combos — collision-free at our scale.
 */
export function defaultHandleFor(userId: string): string {
  const compact = userId.replace(/-/g, '');
  return `u_${compact.slice(0, 12)}`;
}

interface ProfileRow {
  readonly user_id: string;
  readonly handle: string;
}

interface SubscriptionRow {
  readonly user_id: string;
  readonly tier: 'free' | 'pro';
}

/**
 * Ensure `public.profile` and `public.subscription` rows exist for
 * `userId`. Idempotent: returns `inserted: false` if both rows were
 * already present, `inserted: true` if either was created.
 *
 * Implementation note: we don't use `INSERT ... ON CONFLICT
 * DO NOTHING` via raw SQL here because PostgREST 12+ supports
 * conflict resolution via the `Prefer: resolution=ignore-duplicates`
 * header (the SDK's `.upsert(..., { onConflict, ignoreDuplicates })`
 * shape). That keeps us inside the SDK's typed surface.
 */
export async function provisionProfile(
  serviceClient: SupabaseClient,
  userId: string,
  options: { readonly handle?: string } = {},
): Promise<ProvisionedProfile> {
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new Error('provisionProfile: userId must be a non-empty string.');
  }
  const handle = options.handle ?? defaultHandleFor(userId);

  const profileResult = await serviceClient
    .from('profile')
    .upsert<ProfileRow>(
      { user_id: userId, handle },
      { onConflict: 'user_id', ignoreDuplicates: true },
    )
    .select('user_id, handle');

  if (profileResult.error !== null) {
    throw new AuthError(
      'no_profile',
      `provisionProfile: failed to upsert profile row (${profileResult.error.message}).`,
      { cause: profileResult.error },
    );
  }

  const subscriptionResult = await serviceClient
    .from('subscription')
    .upsert<SubscriptionRow>(
      { user_id: userId, tier: 'free' },
      { onConflict: 'user_id', ignoreDuplicates: true },
    )
    .select('user_id, tier');

  if (subscriptionResult.error !== null) {
    throw new AuthError(
      'no_profile',
      `provisionProfile: failed to upsert subscription row (${subscriptionResult.error.message}).`,
      { cause: subscriptionResult.error },
    );
  }

  // PostgREST returns the row(s) affected. With `ignoreDuplicates: true`
  // an existing row collapses to an empty result set; we use that as the
  // "did we insert?" signal. If either insert created a new row,
  // overall `inserted` is true.
  const profileInserted = (profileResult.data ?? []).length > 0;
  const subscriptionInserted = (subscriptionResult.data ?? []).length > 0;

  return {
    userId,
    handle,
    inserted: profileInserted || subscriptionInserted,
  };
}
