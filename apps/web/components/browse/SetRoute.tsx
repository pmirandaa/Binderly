'use client';

// Glue component for `/sets/[slug]`. Lazily constructs the
// api-client and wires `notFound()` into <SetView>'s
// `onNotFound` callback.

import { notFound } from 'next/navigation';
import { useEffect, useState } from 'react';

import { SetView } from './SetView';
import { getApiClient } from '../../lib/api-client';
import { apiToBrowseApi, type BrowseApi } from '../../lib/browse/api';
import { PageLoading } from '../loading/PageLoading';

export interface SetRouteProps {
  /** The set's `canonicalKey` slug (e.g. `en-base1`), or a legacy set UUID. */
  slug: string;
}

export function SetRoute({ slug }: SetRouteProps): React.ReactNode {
  const [api, setApi] = useState<BrowseApi | null>(null);

  useEffect(() => {
    setApi(apiToBrowseApi(getApiClient()));
  }, []);

  if (api === null) {
    return <PageLoading label="Loading set…" />;
  }

  return <SetView api={api} slug={slug} onNotFound={notFound} />;
}
