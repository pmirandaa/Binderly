'use client';

// Glue component that lazily constructs the api-client and hands
// it to <BrowseView>. Construction is deferred to a `useEffect`
// so the env-loading branch only runs in the browser at runtime,
// never during SSR / static prerender (which is the iter-14
// W-SHELL hotfix lesson — `next build` must not crash on missing
// `NEXT_PUBLIC_SUPABASE_*`).

import { useEffect, useState } from 'react';

import { BrowseView } from './BrowseView';
import { getApiClient } from '../../lib/api-client';
import { apiToBrowseApi, type BrowseApi } from '../../lib/browse/api';
import { PageLoading } from '../loading/PageLoading';

export function BrowseRoute(): React.ReactNode {
  const [api, setApi] = useState<BrowseApi | null>(null);

  useEffect(() => {
    setApi(apiToBrowseApi(getApiClient()));
  }, []);

  if (api === null) {
    return <PageLoading label="Loading sets…" />;
  }

  return <BrowseView api={api} />;
}
