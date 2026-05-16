'use client';

// Glue component for `/collection/sets/[id]`. Three concerns:
//
//   1. Auth gate: render the sign-in prompt if the user is
//      signed out (the brief explicitly forbids a hard crash).
//   2. Lazily construct the api-client inside a `useEffect` so
//      env-loading only happens in the browser (W-SHELL hotfix).
//   3. Forward Next's `notFound()` to the view's `onNotFound`
//      callback so a missing set id renders the closest
//      `not-found.tsx` boundary.

import { notFound } from 'next/navigation';
import { useEffect, useState } from 'react';

import { CollectionSetView } from './CollectionSetView';
import { SignInPrompt } from './SignInPrompt';
import { getApiClient } from '../../lib/api-client';
import { apiToCollectionApi, type CollectionApi } from '../../lib/collection/api';
import { PageLoading } from '../loading/PageLoading';
import { useAuth } from '../providers/AuthProvider';

export interface CollectionSetRouteProps {
  setId: string;
}

export function CollectionSetRoute({ setId }: CollectionSetRouteProps): React.ReactNode {
  const { user, loading } = useAuth();
  const [api, setApi] = useState<CollectionApi | null>(null);

  useEffect(() => {
    if (user === null) return;
    setApi(apiToCollectionApi(getApiClient()));
  }, [user]);

  if (loading) {
    return <PageLoading label="Loading set…" />;
  }

  if (user === null) {
    return <SignInPrompt nextPath={`/collection/sets/${setId}`} />;
  }

  if (api === null) {
    return <PageLoading label="Loading set…" />;
  }

  return <CollectionSetView api={api} setId={setId} onNotFound={notFound} />;
}
