'use client';

// Glue between the server-component page entry and the client
// view. Lazily constructs the api-client inside `useEffect` so
// `next build` never dereferences `getApiClient()` →
// `loadWebEnv()` without env vars set (the iter-14 W-SHELL
// hotfix lesson). Mirrors `<BrowseRoute>` exactly.

import { notFound } from 'next/navigation';
import { useEffect, useState } from 'react';

import { ShareableView } from './ShareableView';
import { getApiClient } from '../../lib/api-client';
import { apiToShareApi, type ShareApi } from '../../lib/share/api';
import { PageLoading } from '../loading/PageLoading';

export interface ShareableRouteProps {
  handle: string;
  slug: string;
}

export function ShareableRoute({ handle, slug }: ShareableRouteProps): React.ReactNode {
  const [api, setApi] = useState<ShareApi | null>(null);

  useEffect(() => {
    setApi(apiToShareApi(getApiClient()));
  }, []);

  if (api === null) {
    return <PageLoading label="Loading shareable…" />;
  }

  return <ShareableView api={api} handle={handle} slug={slug} onNotFound={notFound} />;
}
