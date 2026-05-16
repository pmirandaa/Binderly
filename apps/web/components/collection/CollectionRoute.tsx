'use client';

// Glue component for `/collection`. Three responsibilities:
//
//   1. Read auth state via `useAuth()`. While loading, render a
//      page-level spinner; if unauthenticated, render the sign-in
//      prompt (the brief forbids a hard crash for signed-out
//      visitors).
//   2. Construct the api-client lazily inside a `useEffect` so the
//      env-loading branch only runs in the browser at runtime,
//      never during SSR / static prerender. (Iter-14 W-SHELL
//      hotfix lesson — `next build` must not crash on missing
//      `NEXT_PUBLIC_SUPABASE_*`.)
//   3. Hand the narrow `CollectionApi` to `<CollectionView>`.

import { useEffect, useState } from 'react';

import { CollectionView } from './CollectionView';
import { SignInPrompt } from './SignInPrompt';
import { getApiClient } from '../../lib/api-client';
import { apiToCollectionApi, type CollectionApi } from '../../lib/collection/api';
import { PageLoading } from '../loading/PageLoading';
import { useAuth } from '../providers/AuthProvider';

export function CollectionRoute(): React.ReactNode {
  const { user, loading } = useAuth();
  const [api, setApi] = useState<CollectionApi | null>(null);

  useEffect(() => {
    if (user === null) return;
    setApi(apiToCollectionApi(getApiClient()));
  }, [user]);

  if (loading) {
    return <PageLoading label="Loading your collection…" />;
  }

  if (user === null) {
    return <SignInPrompt nextPath="/collection" />;
  }

  if (api === null) {
    return <PageLoading label="Loading your collection…" />;
  }

  return <CollectionView api={api} />;
}
