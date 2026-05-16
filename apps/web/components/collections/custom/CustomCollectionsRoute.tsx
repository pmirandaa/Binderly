'use client';

// Glue component for `/collections/custom`. Mirrors
// `<CollectionRoute>` (T-W-COLLECTION):
//
//   1. Read auth state via `useAuth()`. Loading → page-level
//      spinner; unauthenticated → `<SignInPrompt nextPath=...>`.
//   2. Construct the api-client lazily inside a `useEffect` so
//      the env-loading branch only runs in the browser at
//      runtime, never during SSR / static prerender.
//   3. Hand the narrow `CustomCollectionApi` to
//      `<CustomCollectionsView>`.

import { useEffect, useState } from 'react';

import { CustomCollectionsView } from './CustomCollectionsView';
import { getApiClient } from '../../../lib/api-client';
import {
  apiToCustomCollectionApi,
  type CustomCollectionApi,
} from '../../../lib/collections/custom/api';
import { SignInPrompt } from '../../collection/SignInPrompt';
import { PageLoading } from '../../loading/PageLoading';
import { useAuth } from '../../providers/AuthProvider';

export function CustomCollectionsRoute(): React.ReactNode {
  const { user, loading } = useAuth();
  const [api, setApi] = useState<CustomCollectionApi | null>(null);

  useEffect(() => {
    if (user === null) return;
    setApi(apiToCustomCollectionApi(getApiClient()));
  }, [user]);

  if (loading) {
    return <PageLoading label="Loading your custom collections…" />;
  }

  if (user === null) {
    return (
      <SignInPrompt
        nextPath="/collections/custom"
        heading="Sign in to manage custom collections"
        body="Custom collections are private. Sign in to create up to three groupings of hand-picked cards on the free plan."
      />
    );
  }

  if (api === null) {
    return <PageLoading label="Loading your custom collections…" />;
  }

  return <CustomCollectionsView api={api} />;
}
