// `<SignInScreen>` — the mobile sign-in surface.
//
// Surface:
//
//   - A short heading ("Sign in to Binderly").
//   - A magic-link email field + "Send magic link" submit button.
//   - Three OAuth buttons (Apple, Google, Discord). Apple is shown
//     unconditionally on iOS (Apple Store rule); on Android / web
//     it falls back to the Supabase OAuth round-trip via
//     `signInWithApple()`.
//   - Inline error / success messaging.
//
// State management is intentionally local: this is a leaf screen
// that exists purely to drive Supabase JS calls. No TanStack Query,
// no Zustand. The `<AuthProvider>` from M-SHELL handles the session
// listener after the round-trip completes; this screen never reads
// session state itself, only triggers sign-in attempts.
//
// All Supabase / Apple / WebBrowser calls live behind the `useApiClient`
// hook + the `signIn*` helpers from `lib/auth/`. Mounting the screen
// performs no side effects (lazy-init posture).

import { useCallback, useState, type ReactNode } from 'react';

import { Button, Input, Text, YStack } from '@binderly/ui';

import { useAuth } from '../../components/providers/AuthProvider.js';
import { useApiClient } from '../../lib/api-client.js';
import {
  OAUTH_PROVIDERS,
  signInWithApple,
  signInWithOAuthProvider,
  type OAuthProvider,
} from '../../lib/auth/index.js';

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Cheap, RFC-5322-flavoured email check. We deliberately don't
 * pull in a full validator — the SDK does the real work; this is
 * just to gate the submit button.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface SubmitState {
  readonly status: 'idle' | 'pending' | 'success' | 'error';
  readonly message?: string;
}

const IDLE_STATE: SubmitState = { status: 'idle' };

/** Provider-button copy. Apple's label flips per Apple HIG. */
const PROVIDER_LABELS: Record<OAuthProvider, string> = {
  apple: 'Sign in with Apple',
  google: 'Continue with Google',
  discord: 'Continue with Discord',
};

export function SignInScreen(): ReactNode {
  const apiClient = useApiClient();
  const supabase = apiClient.auth.raw();
  const auth = useAuth();

  const [email, setEmail] = useState('');
  const [magicLink, setMagicLink] = useState<SubmitState>(IDLE_STATE);
  const [providerState, setProviderState] = useState<{
    readonly provider: OAuthProvider | null;
    readonly state: SubmitState;
  }>({ provider: null, state: IDLE_STATE });

  const trimmedEmail = email.trim();
  const emailValid = EMAIL_RE.test(trimmedEmail);
  const magicLinkPending = magicLink.status === 'pending';
  const oauthPending = providerState.state.status === 'pending';
  const anyPending = magicLinkPending || oauthPending || auth.loading;

  const handleSendMagicLink = useCallback(async () => {
    if (!emailValid || anyPending) return;
    setMagicLink({ status: 'pending' });
    try {
      await apiClient.auth.signInWithMagicLink({
        email: trimmedEmail,
        redirectTo: undefined,
      });
      setMagicLink({
        status: 'success',
        message: `Check ${trimmedEmail} for a sign-in link.`,
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Failed to send magic link.';
      setMagicLink({ status: 'error', message });
    }
  }, [emailValid, anyPending, apiClient, trimmedEmail]);

  const handleProvider = useCallback(
    async (provider: OAuthProvider) => {
      if (anyPending) return;
      setProviderState({ provider, state: { status: 'pending' } });
      try {
        const result =
          provider === 'apple'
            ? await signInWithApple(supabase as SupabaseClient)
            : await signInWithOAuthProvider(supabase as SupabaseClient, provider);
        if (result.type === 'success') {
          setProviderState({ provider, state: { status: 'success' } });
        } else if (result.type === 'cancel' || result.type === 'dismiss') {
          setProviderState({ provider: null, state: IDLE_STATE });
        } else {
          setProviderState({
            provider,
            state: { status: 'error', message: result.message },
          });
        }
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : 'Sign-in failed.';
        setProviderState({ provider, state: { status: 'error', message } });
      }
    },
    [anyPending, supabase],
  );

  return (
    <YStack
      flex={1}
      gap="$4"
      padding="$6"
      backgroundColor="$background"
      justifyContent="center"
      testID="sign-in-screen"
    >
      <YStack gap="$2" alignItems="center">
        <Text variant="title" tone="default">
          Sign in to Binderly
        </Text>
        <Text variant="body" tone="muted">
          Track your collection across devices.
        </Text>
      </YStack>

      <YStack gap="$3">
        <Input
          label="Email"
          placeholder="you@example.com"
          value={email}
          onChangeText={setEmail}
          accessibilityLabel="Email"
          aria-label="Email"
          testID="sign-in-email"
          error={magicLink.status === 'error'}
          errorText={magicLink.status === 'error' ? magicLink.message : undefined}
          helperText={magicLink.status === 'success' ? magicLink.message : undefined}
        />
        <Button
          label={magicLinkPending ? 'Sending…' : 'Send magic link'}
          variant="primary"
          size="lg"
          loading={magicLinkPending}
          disabled={!emailValid || anyPending}
          onPress={handleSendMagicLink}
          accessibilityLabel="Send magic link"
          testID="sign-in-magic-link"
        />
      </YStack>

      <YStack gap="$2" alignItems="center">
        <Text variant="caption" tone="muted">
          or continue with
        </Text>
      </YStack>

      <YStack gap="$3">
        {OAUTH_PROVIDERS.map((provider) => {
          const isThisPending =
            providerState.provider === provider && providerState.state.status === 'pending';
          return (
            <Button
              key={provider}
              label={PROVIDER_LABELS[provider]}
              variant={provider === 'apple' ? 'secondary' : 'ghost'}
              size="lg"
              loading={isThisPending}
              disabled={anyPending}
              onPress={() => {
                void handleProvider(provider);
              }}
              accessibilityLabel={PROVIDER_LABELS[provider]}
              testID={`sign-in-oauth-${provider}`}
            />
          );
        })}
        {providerState.state.status === 'error' && providerState.provider !== null ? (
          <Text variant="caption" tone="error" testID="sign-in-oauth-error">
            {providerState.state.message ?? 'Sign-in failed.'}
          </Text>
        ) : null}
      </YStack>
    </YStack>
  );
}
