'use client';

// Glue for `/collections/smart`. Three responsibilities (mirrors
// `CollectionRoute` from T-W-COLLECTION):
//   1. Read auth state via `useAuth()` and render the sign-in
//      prompt for signed-out users.
//   2. Construct the api-client lazily inside `useEffect` so
//      env-loading only happens client-side (W-SHELL hotfix).
//   3. Wire the Delete affordance to `api.deleteSmartCollection()`
//      with a `window.confirm()` guard. Delete-failure recovery is
//      a follow-up — for v1 we surface an alert and let the
//      user retry.

import { useCallback, useEffect, useState } from 'react';

import type { CustomCollectionDto } from '@binderly/api-contracts';

import { SmartSignInPrompt } from './SignInPrompt';
import { SmartListView } from './SmartListView';
import { getApiClient } from '../../../lib/api-client';
import {
  apiToSmartCollectionsApi,
  type SmartCollectionsApi,
} from '../../../lib/collections/smart/api';
import { PageLoading } from '../../loading/PageLoading';
import { useAuth } from '../../providers/AuthProvider';

export interface SmartListRouteProps {
  /**
   * Test seam — the route file always omits this and the
   * production code path constructs the api-client lazily.
   */
  apiOverride?: SmartCollectionsApi;
}

export function SmartListRoute({ apiOverride }: SmartListRouteProps = {}): React.ReactNode {
  const { user, loading } = useAuth();
  const [api, setApi] = useState<SmartCollectionsApi | null>(apiOverride ?? null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (apiOverride !== undefined) {
      setApi(apiOverride);
      return;
    }
    if (user === null) return;
    setApi(apiToSmartCollectionsApi(getApiClient()));
  }, [user, apiOverride]);

  const handleDelete = useCallback(
    (collection: CustomCollectionDto): void => {
      if (api === null) return;
      // `window.confirm` keeps the destructive flow blunt and
      // dependency-free for v1. A custom modal lands later.
      const ok =
        typeof window === 'undefined' ||
        window.confirm(`Delete "${collection.name}"? This cannot be undone.`);
      if (!ok) return;
      void api
        .deleteSmartCollection(collection.id)
        .then(() => {
          setReloadKey((k) => k + 1);
        })
        .catch((err: unknown) => {
          if (typeof window !== 'undefined') {
            const message = err instanceof Error ? err.message : 'Delete failed.';
            window.alert(`Could not delete: ${message}`);
          }
        });
    },
    [api],
  );

  if (loading) {
    return <PageLoading label="Loading smart collections…" />;
  }

  if (user === null) {
    return <SmartSignInPrompt nextPath="/collections/smart" />;
  }

  if (api === null) {
    return <PageLoading label="Loading smart collections…" />;
  }

  return <SmartListView key={reloadKey} api={api} onDelete={handleDelete} />;
}
