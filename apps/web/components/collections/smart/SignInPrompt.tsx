'use client';

// Sign-in prompt for the smart-collection surfaces. Mirrors
// `components/collection/SignInPrompt.tsx` but with copy
// tailored to the smart flow. Re-implemented locally rather
// than imported so the smart-collections stage doesn't have a
// soft cross-stage dependency on T-W-COLLECTION's component
// surface.

import Link from 'next/link';

import { Button, Text, YStack } from '@binderly/ui';

export interface SmartSignInPromptProps {
  nextPath: string;
  heading?: string;
  body?: string;
}

export function SmartSignInPrompt({
  nextPath,
  heading = 'Sign in to use smart collections',
  body = 'Smart collections are private to your account. Sign in to write a query, run it against the catalog, and save it as a saved smart collection.',
}: SmartSignInPromptProps): React.ReactNode {
  const href = `/auth/sign-in?next=${encodeURIComponent(nextPath)}`;
  return (
    <YStack
      padding="$6"
      gap="$4"
      maxWidth={520}
      marginHorizontal="auto"
      data-testid="smart-sign-in-prompt"
    >
      <YStack gap="$2">
        <Text variant="title" data-testid="smart-sign-in-heading">
          {heading}
        </Text>
        <Text variant="body" tone="muted" data-testid="smart-sign-in-body">
          {body}
        </Text>
      </YStack>
      <Link
        href={href}
        style={{ textDecoration: 'none' }}
        data-testid="smart-sign-in-link"
        aria-label="Go to sign-in"
      >
        <Button label="Sign in" aria-label="Sign in" />
      </Link>
    </YStack>
  );
}
