'use client';

// Glue component for `/cards/[id]`. Lazily constructs the
// api-client and wires `notFound()` into <CardView>'s
// `onNotFound` callback.

import { notFound } from 'next/navigation';
import { useEffect, useState } from 'react';

import { CardView } from './CardView';
import { getApiClient } from '../../lib/api-client';
import { apiToBrowseApi, type BrowseApi } from '../../lib/browse/api';
import { PageLoading } from '../loading/PageLoading';

export interface CardRouteProps {
  printingId: string;
}

export function CardRoute({ printingId }: CardRouteProps): React.ReactNode {
  const [api, setApi] = useState<BrowseApi | null>(null);

  useEffect(() => {
    setApi(apiToBrowseApi(getApiClient()));
  }, []);

  if (api === null) {
    return <PageLoading label="Loading card…" />;
  }

  return <CardView api={api} printingId={printingId} onNotFound={notFound} />;
}
