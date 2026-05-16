'use client';

// Glue for `/collections/smart/[id]`. Auth gate, lazy api-client
// construction, `notFound()` wiring, and Delete handling that
// returns the user to `/collections/smart` after a successful
// delete.

import { notFound, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import type { CustomCollectionDto } from '@binderly/api-contracts';

import { SmartSignInPrompt } from './SignInPrompt';
import { SmartDetailView } from './SmartDetailView';
import { getApiClient } from '../../../lib/api-client';
import {
  apiToSmartCollectionsApi,
  type SmartCollectionsApi,
} from '../../../lib/collections/smart/api';
import { PageLoading } from '../../loading/PageLoading';
import { useAuth } from '../../providers/AuthProvider';

export interface SmartDetailRouteProps {
  collectionId: string;
  apiOverride?: SmartCollectionsApi;
  /** Test seam — defaults to `notFound` from next/navigation. */
  notFoundFn?: () => void;
}

export function SmartDetailRoute({
  collectionId,
  apiOverride,
  notFoundFn = notFound,
}: SmartDetailRouteProps): React.ReactNode {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [api, setApi] = useState<SmartCollectionsApi | null>(apiOverride ?? null);

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
      const ok =
        typeof window === 'undefined' ||
        window.confirm(`Delete "${collection.name}"? This cannot be undone.`);
      if (!ok) return;
      void api
        .deleteSmartCollection(collection.id)
        .then(() => {
          router.push('/collections/smart');
        })
        .catch((err: unknown) => {
          if (typeof window !== 'undefined') {
            const message = err instanceof Error ? err.message : 'Delete failed.';
            window.alert(`Could not delete: ${message}`);
          }
        });
    },
    [api, router],
  );

  if (loading) {
    return <PageLoading label="Loading smart collection…" />;
  }

  if (user === null) {
    return <SmartSignInPrompt nextPath={`/collections/smart/${collectionId}`} />;
  }

  if (api === null) {
    return <PageLoading label="Loading smart collection…" />;
  }

  return (
    <SmartDetailView
      api={api}
      collectionId={collectionId}
      onNotFound={notFoundFn}
      onDelete={handleDelete}
    />
  );
}
