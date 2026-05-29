'use client';

// Settings surface root view. Fetches profile + subscription +
// shareables in parallel on mount, renders the profile editor +
// per-shareable cards + create-new affordance, and surfaces a
// page-level error banner if any fetch fails.
//
// Optimistic updates for profile / shareable edits live inside
// the child components (`ProfileFields`, `ShareableRowEditor`)
// so a single failing PATCH only affects that card. Create +
// delete flow through the view-level state so the list mutates
// in place.

import { useCallback, useEffect, useState } from 'react';

import type {
  CreateShareableRequest,
  ProfileDto,
  ShareableDto,
  SubscriptionDto,
  UpdateProfileRequest,
  UpdateShareableRequest,
} from '@binderly/api-contracts';
import { Button, Card, Input, Text, XStack, YStack } from '@binderly/ui';

import { ProfileFields } from './ProfileFields';
import { ShareableRowEditor } from './ShareableRowEditor';
import { validateSlug } from './validation';
import { PageLoading } from '../../../components/loading/PageLoading';

import type { SettingsApi } from './api';

/** Free-tier shareable cap (PROJECT.md § 16). */
export const FREE_SHAREABLE_CAP = 1;

export interface ShareablesSettingsViewProps {
  api: SettingsApi;
}

type FetchState =
  | { kind: 'loading' }
  | {
      kind: 'ready';
      profile: ProfileDto;
      subscription: SubscriptionDto;
      shareables: ShareableDto[];
    }
  | { kind: 'error'; message: string };

export function ShareablesSettingsView({ api }: ShareablesSettingsViewProps): React.ReactNode {
  const [state, setState] = useState<FetchState>({ kind: 'loading' });

  useEffect(() => {
    const ctrl = new AbortController();
    setState({ kind: 'loading' });
    Promise.all([
      api.getMyProfile(ctrl.signal),
      api.getMySubscription(ctrl.signal),
      api.listShareables(ctrl.signal),
    ])
      .then(([profile, subscription, shareables]) => {
        if (ctrl.signal.aborted) return;
        setState({
          kind: 'ready',
          profile,
          subscription,
          shareables: [...shareables],
        });
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const message = err instanceof Error && err.message.length > 0
          ? err.message
          : 'Could not load your settings.';
        setState({ kind: 'error', message });
      });
    return (): void => {
      ctrl.abort();
    };
  }, [api]);

  const saveProfile = useCallback(
    async (patch: UpdateProfileRequest): Promise<void> => {
      if (state.kind !== 'ready') return;
      const previous = state.profile;
      const optimistic: ProfileDto = {
        ...previous,
        ...(patch.handle !== undefined ? { handle: patch.handle } : {}),
        ...(patch.displayName !== undefined ? { displayName: patch.displayName ?? null } : {}),
        ...(patch.bio !== undefined ? { bio: patch.bio ?? null } : {}),
        ...(patch.socialLinks !== undefined ? { socialLinks: patch.socialLinks } : {}),
      };
      setState((s) => (s.kind === 'ready' ? { ...s, profile: optimistic } : s));
      try {
        const next = await api.updateMyProfile(patch);
        setState((s) => (s.kind === 'ready' ? { ...s, profile: next } : s));
      } catch (err) {
        setState((s) => (s.kind === 'ready' ? { ...s, profile: previous } : s));
        throw err;
      }
    },
    [state, api],
  );

  const saveShareable = useCallback(
    async (id: string, patch: UpdateShareableRequest): Promise<void> => {
      if (state.kind !== 'ready') return;
      const previous = state.shareables;
      const optimistic = previous.map((s) =>
        s.id === id
          ? ({
              ...s,
              ...(patch.slug !== undefined ? { slug: patch.slug } : {}),
              ...(patch.target !== undefined ? { target: patch.target } : {}),
              ...(patch.theme !== undefined ? { theme: patch.theme } : {}),
              ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
              ...(patch.showValues !== undefined ? { showValues: patch.showValues } : {}),
              ...(patch.showMissing !== undefined ? { showMissing: patch.showMissing } : {}),
              ...(patch.showPhotos !== undefined ? { showPhotos: patch.showPhotos } : {}),
            } satisfies ShareableDto)
          : s,
      );
      setState((s) => (s.kind === 'ready' ? { ...s, shareables: optimistic } : s));
      try {
        const next = await api.updateShareable(id, patch);
        setState((s) =>
          s.kind === 'ready'
            ? {
                ...s,
                shareables: s.shareables.map((x) => (x.id === id ? next : x)),
              }
            : s,
        );
      } catch (err) {
        setState((s) => (s.kind === 'ready' ? { ...s, shareables: previous } : s));
        throw err;
      }
    },
    [state, api],
  );

  const deleteShareable = useCallback(
    async (id: string): Promise<void> => {
      if (state.kind !== 'ready') return;
      const previous = state.shareables;
      setState((s) =>
        s.kind === 'ready' ? { ...s, shareables: s.shareables.filter((x) => x.id !== id) } : s,
      );
      try {
        await api.deleteShareable(id);
      } catch (err) {
        setState((s) => (s.kind === 'ready' ? { ...s, shareables: previous } : s));
        throw err;
      }
    },
    [state, api],
  );

  const createShareable = useCallback(
    async (input: CreateShareableRequest): Promise<void> => {
      if (state.kind !== 'ready') return;
      const created = await api.createShareable(input);
      setState((s) =>
        s.kind === 'ready' ? { ...s, shareables: [...s.shareables, created] } : s,
      );
    },
    [state, api],
  );

  if (state.kind === 'loading') {
    return <PageLoading label="Loading your settings\u2026" />;
  }

  if (state.kind === 'error') {
    return (
      <YStack
        padding="$6"
        gap="$4"
        maxWidth={720}
        marginHorizontal="auto"
        data-testid="settings-shareables-page"
      >
        <Text variant="title">Public shareables</Text>
        <YStack
          padding="$4"
          backgroundColor="$surfaceMuted"
          borderRadius={12}
          role="alert"
          data-testid="settings-shareables-error"
        >
          <Text variant="subtitle">We couldn\u2019t load your settings</Text>
          <Text variant="body" tone="muted">
            {state.message}
          </Text>
        </YStack>
      </YStack>
    );
  }

  const { profile, subscription, shareables } = state;
  const isPro = subscription.tier === 'pro';
  const atCap = !isPro && shareables.length >= FREE_SHAREABLE_CAP;

  return (
    <YStack
      padding="$6"
      gap="$5"
      maxWidth={720}
      marginHorizontal="auto"
      data-testid="settings-shareables-page"
    >
      <YStack gap="$2">
        <Text variant="title">Public shareables</Text>
        <Text variant="body" tone="muted">
          Manage your handle and configure the public pages you share with the world.
        </Text>
      </YStack>

      <ProfileFields
        profile={profile}
        onSave={saveProfile}
        onCheckHandle={(handle) => api.checkHandleAvailability(handle)}
      />

      <YStack gap="$2" data-testid="settings-shareables-list-header">
        <XStack gap="$3" alignItems="baseline" justifyContent="space-between">
          <Text variant="subtitle">Your shareables ({shareables.length})</Text>
          {atCap ? (
            <Text variant="bodySmall" tone="muted" data-testid="settings-shareables-cap-badge">
              Free tier: 1 shareable. Pro unlocks more.
            </Text>
          ) : null}
        </XStack>
        <Text variant="bodySmall" tone="muted">
          Each shareable publishes at <code>binderly.app/c/@{profile.handle}/&lt;slug&gt;</code>.
        </Text>
      </YStack>

      {shareables.length === 0 ? (
        <Card
          variant="outlined"
          padding="$5"
          gap="$3"
          data-testid="settings-shareables-empty"
        >
          <Text variant="subtitle">You don\u2019t have any shareables yet</Text>
          <Text variant="body" tone="muted">
            Create one to publish a public page over your collection.
          </Text>
        </Card>
      ) : (
        <YStack gap="$3" data-testid="settings-shareables-list">
          {shareables.map((s) => (
            <ShareableRowEditor
              key={s.id}
              shareable={s}
              handle={profile.handle}
              onSave={saveShareable}
              onDelete={deleteShareable}
              isPro={isPro}
            />
          ))}
        </YStack>
      )}

      <CreateShareableCard
        atCap={atCap}
        onCreate={createShareable}
      />
    </YStack>
  );
}

interface CreateShareableCardProps {
  atCap: boolean;
  onCreate: (input: CreateShareableRequest) => Promise<void>;
}

function CreateShareableCard({ atCap, onCreate }: CreateShareableCardProps): React.ReactNode {
  const [slug, setSlug] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slugValidation = validateSlug(slug);
  const canCreate = !atCap && !busy && slugValidation.kind === 'ok';

  async function handleCreate(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await onCreate({ slug: slug.trim(), target: { kind: 'full' } });
      setSlug('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the shareable.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      variant="outlined"
      padding="$5"
      gap="$3"
      data-testid="settings-shareables-create-card"
    >
      <Text variant="subtitle">Create a new shareable</Text>
      <Text variant="bodySmall" tone="muted">
        {atCap
          ? 'You\u2019re at the free-tier cap. Upgrade to Pro to add more.'
          : 'Pick a slug \u2014 you can change it later.'}
      </Text>
      <Input
        label="Slug"
        value={slug}
        onChangeText={(next) => setSlug(next.trim().toLowerCase())}
        size="md"
        disabled={atCap}
        error={slug.length > 0 && slugValidation.kind !== 'ok'}
        {...(slug.length > 0 && slugValidation.message !== null
          ? { errorText: slugValidation.message }
          : {})}
        testID="settings-shareables-create-slug"
      />
      {error !== null ? (
        <YStack
          padding="$3"
          backgroundColor="$surfaceMuted"
          borderRadius={8}
          role="alert"
          data-testid="settings-shareables-create-error"
        >
          <Text variant="bodySmall" tone="muted">
            {error}
          </Text>
        </YStack>
      ) : null}
      <Button
        label={busy ? 'Creating\u2026' : 'Create shareable'}
        variant="primary"
        size="md"
        disabled={!canCreate}
        loading={busy}
        onPress={handleCreate}
        aria-label="Create shareable"
        data-testid="settings-shareables-create-button"
      />
    </Card>
  );
}
