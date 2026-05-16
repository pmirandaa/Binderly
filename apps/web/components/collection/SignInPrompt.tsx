'use client';

// Sign-in prompt shown when an unauthenticated visitor hits any
// `/collection/...` surface. The brief explicitly forbids a hard
// crash; we render a friendly upsell pointing at
// `/auth/sign-in?next=<where-they-were>`.

import Link from 'next/link';

import { Button, Text, YStack } from '@binderly/ui';

export interface SignInPromptProps {
  /**
   * Path the sign-in flow should bounce back to once the session
   * is established. Forwarded via the `next` query param the
   * `/auth/sign-in` page consumes — see
   * `apps/web/lib/auth/redirect.ts`.
   */
  nextPath: string;
  /**
   * Optional override for the heading. Defaults to a generic copy
   * tailored to the collection surface.
   */
  heading?: string;
  /** Sub-heading body copy. */
  body?: string;
}

export function SignInPrompt({
  nextPath,
  heading = 'Sign in to see your collection',
  body = 'Your collection is private. Sign in to track set progress, see your master sets, and watch your All Pokémon %.',
}: SignInPromptProps): React.ReactNode {
  const href = `/auth/sign-in?next=${encodeURIComponent(nextPath)}`;
  return (
    <YStack
      padding="$6"
      gap="$4"
      maxWidth={520}
      marginHorizontal="auto"
      data-testid="collection-sign-in-prompt"
    >
      <YStack gap="$2">
        <Text variant="title" data-testid="collection-sign-in-heading">
          {heading}
        </Text>
        <Text variant="body" tone="muted" data-testid="collection-sign-in-body">
          {body}
        </Text>
      </YStack>
      <Link
        href={href}
        style={{ textDecoration: 'none' }}
        data-testid="collection-sign-in-link"
        aria-label="Go to sign-in"
      >
        <Button label="Sign in" aria-label="Sign in" />
      </Link>
    </YStack>
  );
}
