// `<ShareablesSettingsScreen>` — mobile owner-side surface for
// managing the public `/c/{handle}/{slug}` pages. Sibling of the
// web `<ShareablesSettingsView>` (`apps/web/app/settings/shareables/`).
//
// Surface:
//   - Profile editor with debounced handle availability check.
//   - Per-shareable cards with slug / theme / show toggles +
//     delete-with-confirm.
//   - Create-new-shareable affordance (gated to the free-tier cap
//     per PROJECT.md § 16; the create button stays disabled when
//     the user is at the cap).
//
// Auth gating and api-client construction live in the route file
// (`apps/mobile/app/settings/shareables.tsx`) — mirrors the web
// `<ShareablesSettingsRoute>` split so this view is trivially
// testable with an injected fake `SettingsApi`.

import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { ScrollView } from 'react-native';

import type {
  CreateShareableRequest,
  ProfileDto,
  ShareableDto,
  SubscriptionDto,
  UpdateProfileRequest,
  UpdateShareableRequest,
} from '@binderly/api-contracts';
import { Button, Card, Input, Spinner, Text, XStack, YStack } from '@binderly/ui';

import { ProfileFields } from './ProfileFields.js';
import { ShareableRowEditor } from './ShareableRowEditor.js';
import { validateSlug } from './validation.js';

import type { SettingsApi } from './api.js';

/** Free-tier shareable cap (PROJECT.md § 16). */
export const FREE_SHAREABLE_CAP = 1;

export interface ShareablesSettingsScreenProps {
  readonly api: SettingsApi;
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

export function ShareablesSettingsScreen({ api }: ShareablesSettingsScreenProps): ReactNode {
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
        setState({ kind: 'ready', profile, subscription, shareables: [...shareables] });
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const message =
          err instanceof Error && err.message.length > 0
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
            ? { ...s, shareables: s.shareables.map((x) => (x.id === id ? next : x)) }
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
      const created = await api.createShareable(input);
      setState((s) =>
        s.kind === 'ready' ? { ...s, shareables: [...s.shareables, created] } : s,
      );
    },
    [api],
  );

  if (state.kind === 'loading') {
    return (
      <YStack
        padding="$6"
        alignItems="center"
        gap="$2"
        testID="m-settings-shareables-loading"
      >
        <Spinner size="md" />
        <Text variant="caption" tone="muted">
          Loading your settings\u2026
        </Text>
      </YStack>
    );
  }

  if (state.kind === 'error') {
    return (
      <YStack
        padding="$6"
        gap="$4"
        maxWidth={720}
        marginHorizontal="auto"
        testID="m-settings-shareables-page"
      >
        <Text variant="title">Public shareables</Text>
        <YStack
          padding="$4"
          backgroundColor="$surfaceMuted"
          borderRadius={12}
          role="alert"
          testID="m-settings-shareables-error"
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
    <ScrollView testID="m-settings-shareables-page">
      <YStack
        padding="$5"
        gap="$5"
        maxWidth={720}
        marginHorizontal="auto"
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

        <YStack gap="$2" testID="m-settings-shareables-list-header">
          <XStack gap="$3" alignItems="baseline" justifyContent="space-between">
            <Text variant="subtitle">Your shareables ({shareables.length})</Text>
            {atCap ? (
              <Text variant="bodySmall" tone="muted" testID="m-settings-shareables-cap-badge">
                Free tier: 1 shareable. Pro unlocks more.
              </Text>
            ) : null}
          </XStack>
          <Text variant="bodySmall" tone="muted">
            Each shareable publishes at binderly.app/c/@{profile.handle}/&lt;slug&gt;.
          </Text>
        </YStack>

        {shareables.length === 0 ? (
          <Card variant="outlined" padding="$5" gap="$3" testID="m-settings-shareables-empty">
            <Text variant="subtitle">You don\u2019t have any shareables yet</Text>
            <Text variant="body" tone="muted">
              Create one to publish a public page over your collection.
            </Text>
          </Card>
        ) : (
          <YStack gap="$3" testID="m-settings-shareables-list">
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

        <CreateShareableCard atCap={atCap} onCreate={createShareable} />
      </YStack>
    </ScrollView>
  );
}

interface CreateShareableCardProps {
  atCap: boolean;
  onCreate: (input: CreateShareableRequest) => Promise<void>;
}

function CreateShareableCard({ atCap, onCreate }: CreateShareableCardProps): ReactNode {
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
    <Card variant="outlined" padding="$5" gap="$3" testID="m-settings-shareables-create-card">
      <Text variant="subtitle">Create a new shareable</Text>
      <Text variant="bodySmall" tone="muted">
        {atCap
          ? 'You\u2019re at the free-tier cap. Upgrade to Pro to add more.'
          : 'Pick a slug \u2014 you can change it later.'}
      </Text>
      <Input
        label="Slug"
        value={slug}
        onChangeText={(next: string) => setSlug(next.trim().toLowerCase())}
        size="md"
        disabled={atCap}
        error={slug.length > 0 && slugValidation.kind !== 'ok'}
        {...(slug.length > 0 && slugValidation.message !== null
          ? { errorText: slugValidation.message }
          : {})}
        testID="m-settings-shareables-create-slug"
      />
      {error !== null ? (
        <YStack
          padding="$3"
          backgroundColor="$surfaceMuted"
          borderRadius={8}
          role="alert"
          testID="m-settings-shareables-create-error"
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
        accessibilityLabel="Create shareable"
        testID="m-settings-shareables-create-button"
      />
    </Card>
  );
}
