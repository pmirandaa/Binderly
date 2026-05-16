'use client';

// Glue component for `/collections/custom/[id]`. Mirrors
// `<CustomCollectionsRoute>` (auth gate) and forwards the
// `notFound()` signal from `next/navigation` so a missing
// collection 404s rather than rendering a stuck spinner.

import { notFound, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { CustomCollectionDetailView } from './CustomCollectionDetailView';
import { getApiClient } from '../../../lib/api-client';
import {
  apiToCustomCollectionApi,
  type CustomCollectionApi,
} from '../../../lib/collections/custom/api';
import { SignInPrompt } from '../../collection/SignInPrompt';
import { PageLoading } from '../../loading/PageLoading';
import { useAuth } from '../../providers/AuthProvider';

export interface CustomCollectionDetailRouteProps {
  collectionId: string;
}

export function CustomCollectionDetailRoute({
  collectionId,
}: CustomCollectionDetailRouteProps): React.ReactNode {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [api, setApi] = useState<CustomCollectionApi | null>(null);

  useEffect(() => {
    if (user === null) return;
    setApi(apiToCustomCollectionApi(getApiClient()));
  }, [user]);

  if (loading) {
    return <PageLoading label="Loading custom collection…" />;
  }

  if (user === null) {
    return (
      <SignInPrompt
        nextPath={`/collections/custom/${encodeURIComponent(collectionId)}`}
        heading="Sign in to manage this collection"
        body="Custom collections are private. Sign in to edit, add cards, or share."
      />
    );
  }

  if (api === null) {
    return <PageLoading label="Loading custom collection…" />;
  }

  return (
    <CustomCollectionDetailView
      api={api}
      collectionId={collectionId}
      onNotFound={notFound}
      onDeleted={() => {
        router.replace('/collections/custom');
      }}
    />
  );
}
