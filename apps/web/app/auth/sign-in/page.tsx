'use client';

// Interactive sign-in surface.
//
// Two flows:
//   - Magic-link (email OTP): user enters their address, we call
//     `supabase.auth.signInWithOtp` (via the api-client wrapper),
//     they receive a link, click it, and land on `/auth/callback`
//     where the SDK auto-establishes the session.
//   - OAuth: user clicks Google / Apple / Discord, we call
//     `supabase.auth.signInWithOAuth({ provider, options:
//     { redirectTo } })` and follow the returned URL.
//
// `?next=` is preserved across both round-trips by encoding it
// into the `redirectTo` URL we hand Supabase.
//
// Implementation note: every Supabase touchpoint (api-client +
// browser singleton) lives behind `getApiClient()`, which is
// called only inside event handlers. Module-evaluation must
// stay env-free so `next build` succeeds without
// NEXT_PUBLIC_SUPABASE_URL set.

import { useSearchParams } from 'next/navigation';
import { useMemo, useState, type ReactNode } from 'react';

import { Button, Input, Text, YStack } from '@binderly/ui';

import { getApiClient } from '../../../lib/api-client';
import { extractNext } from '../../../lib/auth/redirect';

type Status = 'idle' | 'submitting' | 'sent' | 'error';
type Provider = 'google' | 'apple' | 'discord';

interface ProviderConfig {
  id: Provider;
  label: string;
  testId: string;
}

const PROVIDERS: readonly ProviderConfig[] = [
  { id: 'google', label: 'Continue with Google', testId: 'oauth-google' },
  { id: 'apple', label: 'Continue with Apple', testId: 'oauth-apple' },
  { id: 'discord', label: 'Continue with Discord', testId: 'oauth-discord' },
] as const;

// RFC-5322 simplified — good enough for a client-side sanity
// check. The Supabase backend re-validates anyway.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function buildCallbackUrl(next: string): string {
  const origin =
    typeof window !== 'undefined' && window.location?.origin !== undefined
      ? window.location.origin
      : '';
  const callback = `${origin}/auth/callback`;
  if (next === '/' || next === '') return callback;
  return `${callback}?next=${encodeURIComponent(next)}`;
}

export default function SignInPage(): ReactNode {
  const searchParams = useSearchParams();
  const next = useMemo(() => extractNext(searchParams), [searchParams]);

  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [oauthProvider, setOAuthProvider] = useState<Provider | null>(null);

  const submitting = status === 'submitting';
  const sent = status === 'sent';
  const oauthBusy = oauthProvider !== null;
  const anyBusy = submitting || oauthBusy;

  async function handleMagicLink(): Promise<void> {
    if (anyBusy || sent) return;
    setErrorMessage(null);
    if (!EMAIL_RE.test(email)) {
      setEmailError('Enter a valid email address.');
      return;
    }
    setEmailError(null);
    setStatus('submitting');
    try {
      const api = getApiClient();
      await api.auth.signInWithMagicLink({
        email,
        redirectTo: buildCallbackUrl(next),
      });
      setStatus('sent');
    } catch (error) {
      setStatus('error');
      setErrorMessage(toErrorMessage(error, 'Could not send the magic link.'));
    }
  }

  async function handleOAuth(provider: Provider): Promise<void> {
    if (anyBusy) return;
    setErrorMessage(null);
    setOAuthProvider(provider);
    try {
      const api = getApiClient();
      const { url } = await api.auth.signInWithOAuth({
        provider,
        redirectTo: buildCallbackUrl(next),
      });
      if (typeof window !== 'undefined' && window.location !== undefined) {
        window.location.assign(url);
      }
    } catch (error) {
      setOAuthProvider(null);
      setStatus('error');
      setErrorMessage(toErrorMessage(error, `Could not start ${provider} sign-in.`));
    }
  }

  return (
    <YStack padding="$6" gap="$5" maxWidth={420} marginHorizontal="auto" data-testid="sign-in-page">
      <YStack gap="$2">
        <Text variant="title">Sign in to Binderly</Text>
        <Text variant="body" tone="muted">
          Use a magic link or continue with a provider. We never share your collection.
        </Text>
      </YStack>

      <YStack gap="$3" data-testid="magic-link-form">
        <Input
          label="Email"
          placeholder="you@example.com"
          value={email}
          onChangeText={(value) => {
            setEmail(value);
            if (emailError !== null) setEmailError(null);
          }}
          error={emailError !== null}
          errorText={emailError ?? undefined}
          disabled={submitting || sent}
          name="email"
          id="sign-in-email"
          aria-label="Email address"
          testID="email-input"
        />
        <Button
          label={sent ? 'Check your inbox' : submitting ? 'Sending…' : 'Send magic link'}
          disabled={sent}
          loading={submitting}
          onPress={() => {
            void handleMagicLink();
          }}
          data-testid="magic-link-submit"
          aria-label="Send magic link"
        />
      </YStack>

      {sent ? (
        <Text variant="body" tone="muted" data-testid="magic-link-sent">
          Magic link sent to {email}. Open it on this device to finish signing in.
        </Text>
      ) : null}

      <YStack alignItems="center">
        <Text variant="caption" tone="muted">
          or
        </Text>
      </YStack>

      <YStack gap="$3" data-testid="oauth-buttons">
        {PROVIDERS.map((provider) => (
          <Button
            key={provider.id}
            variant="secondary"
            label={provider.label}
            disabled={submitting || (oauthBusy && oauthProvider !== provider.id)}
            loading={oauthProvider === provider.id}
            onPress={() => {
              void handleOAuth(provider.id);
            }}
            data-testid={provider.testId}
            aria-label={provider.label}
          />
        ))}
      </YStack>

      {errorMessage !== null ? (
        <Text variant="body" tone="muted" data-testid="sign-in-error">
          {errorMessage}
        </Text>
      ) : null}
    </YStack>
  );
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  if (typeof error === 'string' && error.length > 0) return error;
  return fallback;
}
