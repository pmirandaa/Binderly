'use client';

// Glue component for `/sets/[id]`. Lazily constructs the
// api-client and wires `notFound()` into <SetView>'s
// `onNotFound` callback.

import { notFound } from 'next/navigation';
import { useEffect, useState } from 'react';

import { SetView } from './SetView';
import { getApiClient } from '../../lib/api-client';
import { apiToBrowseApi, type BrowseApi } from '../../lib/browse/api';
import { PageLoading } from '../loading/PageLoading';

export interface SetRouteProps {
  setId: string;
}

export function SetRoute({ setId }: SetRouteProps): React.ReactNode {
  const [api, setApi] = useState<BrowseApi | null>(null);

  useEffect(() => {
    setApi(apiToBrowseApi(getApiClient()));
  }, []);

  if (api === null) {
    return <PageLoading label="Loading set…" />;
  }

  return <SetView api={api} setId={setId} onNotFound={notFound} />;
}
