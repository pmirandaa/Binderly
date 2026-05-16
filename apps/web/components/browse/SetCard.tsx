'use client';

// Single set tile in the browse grid. Pure presentation — receives
// pre-resolved cover image / count / formatted release date.
//
// `"use client"` because it composes Tamagui primitives that mount
// React contexts at module evaluation; tests render it through
// `renderWithProviders` (UIProvider wraps Tamagui).

import Link from 'next/link';

import { Card, Text, YStack } from '@binderly/ui';

export interface SetCardProps {
  href: string;
  name: string;
  releaseDateLabel: string;
  cardCount: number | null;
  coverImageUrl: string | null;
  language: string;
}

export function SetCard(props: SetCardProps): React.ReactNode {
  const { href, name, releaseDateLabel, cardCount, coverImageUrl, language } = props;

  return (
    <Link
      href={href}
      style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
      data-testid="set-card-link"
    >
      <Card
        variant="outlined"
        padding="$4"
        gap="$3"
        hoverStyle={{ borderColor: '$primary' }}
        focusStyle={{ borderColor: '$primary' }}
        data-testid="set-card"
      >
        <YStack
          width="100%"
          height={140}
          backgroundColor="$surfaceMuted"
          borderRadius={8}
          alignItems="center"
          justifyContent="center"
          overflow="hidden"
        >
          {coverImageUrl !== null ? (
            // Use a plain <img> tag rather than next/image because
            // the catalog covers come from arbitrary R2 hosts that
            // would each need to be enumerated in
            // `next.config.mjs#images.remotePatterns`. The image
            // pipeline already produces appropriately sized
            // WebP variants; we don't need next/image's
            // optimisation here.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={coverImageUrl}
              alt={`${name} cover`}
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
              data-testid="set-card-image"
            />
          ) : (
            <Text variant="caption" tone="muted" data-testid="set-card-image-fallback">
              No cover image
            </Text>
          )}
        </YStack>
        <YStack gap="$1">
          <Text variant="subtitle" data-testid="set-card-name">
            {name}
          </Text>
          <Text variant="caption" tone="muted" data-testid="set-card-meta">
            {releaseDateLabel} · {language} · {cardCount ?? 0} cards
          </Text>
        </YStack>
      </Card>
    </Link>
  );
}
