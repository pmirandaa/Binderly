'use client';

// Glue for `/collections/smart/new`. Same three responsibilities
// as `SmartListRoute`: auth gate, lazy api-client construction,
// and forwarding "Cancel" + "Saved" navigation back to Next.js's
// router so the editor stays framework-light.

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { SmartSignInPrompt } from './SignInPrompt';
import { SmartEditorView } from './SmartEditorView';
import { getApiClient } from '../../../lib/api-client';
import {
  apiToSmartCollectionsApi,
  type SmartCollectionsApi,
} from '../../../lib/collections/smart/api';
import { PageLoading } from '../../loading/PageLoading';
import { useAuth } from '../../providers/AuthProvider';

export interface SmartEditorRouteProps {
  apiOverride?: SmartCollectionsApi;
}

export function SmartEditorRoute({
  apiOverride,
}: SmartEditorRouteProps = {}): React.ReactNode {
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

  if (loading) {
    return <PageLoading label="Loading editor…" />;
  }

  if (user === null) {
    return <SmartSignInPrompt nextPath="/collections/smart/new" />;
  }

  if (api === null) {
    return <PageLoading label="Loading editor…" />;
  }

  return (
    <SmartEditorView
      api={api}
      onSaved={(id): void => {
        router.push(`/collections/smart/${encodeURIComponent(id)}`);
      }}
    />
  );
}
