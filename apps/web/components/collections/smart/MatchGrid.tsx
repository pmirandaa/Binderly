'use client';

// Grid of printing matches. Mirrors the browse `<PrintingThumbnail>`
// surface but re-implemented locally so the smart-collections
// stage stays self-contained — copying a small leaf component
// avoids a cross-stage import that could break if T-W-BROWSE
// renames the prop surface.

import Link from 'next/link';

import { Card, Text, XStack, YStack } from '@binderly/ui';

import { variantClassLabel } from '../../../lib/collections/smart/format';

import type { SmartRunMatch } from '../../../lib/collections/smart/run';

export interface MatchGridProps {
  matches: ReadonlyArray<SmartRunMatch>;
  /**
   * Optional empty-state copy override. Defaults to a generic
   * "no matches" message; the saved-collection viewer can pass a
   * tailored variant.
   */
  emptyLabel?: string;
  /**
   * Optional `data-testid` suffix for the surrounding grid
   * element so multiple grids on a page can be pinned
   * independently.
   */
  testId?: string;
}

export function MatchGrid({
  matches,
  emptyLabel = 'No printings match this expression yet.',
  testId = 'smart-match-grid',
}: MatchGridProps): React.ReactNode {
  if (matches.length === 0) {
    return (
      <YStack
        padding="$5"
        gap="$2"
        backgroundColor="$surfaceMuted"
        borderRadius={12}
        data-testid={`${testId}-empty`}
      >
        <Text variant="body" tone="muted">
          {emptyLabel}
        </Text>
      </YStack>
    );
  }
  return (
    <XStack flexWrap="wrap" gap="$4" data-testid={testId}>
      {matches.map((match) => (
        <YStack key={match.printing.id} width={180} flexBasis={180}>
          <MatchTile match={match} />
        </YStack>
      ))}
    </XStack>
  );
}

interface MatchTileProps {
  match: SmartRunMatch;
}

function MatchTile({ match }: MatchTileProps): React.ReactNode {
  const { printing, card, set } = match;
  const href = `/cards/${encodeURIComponent(printing.id)}`;
  const altText = `${card.name} #${card.number} (${variantClassLabel(printing.variantClass)})`;
  return (
    <Link
      href={href}
      style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
      data-testid="smart-match-link"
    >
      <Card
        variant="outlined"
        padding="$3"
        gap="$2"
        hoverStyle={{ borderColor: '$primary' }}
        focusStyle={{ borderColor: '$primary' }}
        data-testid="smart-match-tile"
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
          {printing.imageSmallUrl !== null ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={printing.imageSmallUrl}
              alt={altText}
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
              data-testid="smart-match-image"
            />
          ) : (
            <Text variant="caption" tone="muted" data-testid="smart-match-image-fallback">
              No image
            </Text>
          )}
        </YStack>
        <YStack gap="$1">
          <Text variant="bodySmall" data-testid="smart-match-name">
            #{card.number} · {card.name}
          </Text>
          <Text variant="caption" tone="muted" data-testid="smart-match-meta">
            {set.name} · {variantClassLabel(printing.variantClass)}
          </Text>
        </YStack>
      </Card>
    </Link>
  );
}
