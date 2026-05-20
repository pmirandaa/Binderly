'use client';

// Glue between the server-component page entry and the
// `ShareablesSettingsView`. Three responsibilities (mirrors
// `CollectionRoute`):
//
//   1. Auth gate via `useAuth()`. Signed-out visitors get the
//      same `SignInPrompt` `/collection` uses (passing the
//      `next` redirect back here).
//   2. Construct the api-client lazily inside a `useEffect` so
//      `next build` never dereferences `getApiClient()` →
//      `loadWebEnv()` during static prerender (the iter-14
//      W-SHELL hotfix lesson).
//   3. Hand the narrow `SettingsApi` down to the view so tests
//      can render the view directly with a fake.

import { useEffect, useState } from 'react';

import { binderlyClientToSettingsApi, type SettingsApi } from './api';
import { ShareablesSettingsView } from './ShareablesSettingsView';
import { SignInPrompt } from '../../../components/collection/SignInPrompt';
import { PageLoading } from '../../../components/loading/PageLoading';
import { useAuth } from '../../../components/providers/AuthProvider';
import { getApiClient } from '../../../lib/api-client';

export function ShareablesSettingsRoute(): React.ReactNode {
  const { user, loading } = useAuth();
  const [api, setApi] = useState<SettingsApi | null>(null);

  useEffect(() => {
    if (user === null) return;
    setApi(binderlyClientToSettingsApi(getApiClient()));
  }, [user]);

  if (loading) {
    return <PageLoading label="Loading your settings\u2026" />;
  }

  if (user === null) {
    return (
      <SignInPrompt
        nextPath="/settings/shareables"
        heading="Sign in to manage your public shareables"
        body="Your handle, theme, and per-page toggles live in your account. Sign in to edit them."
      />
    );
  }

  if (api === null) {
    return <PageLoading label="Loading your settings\u2026" />;
  }

  return <ShareablesSettingsView api={api} />;
}
