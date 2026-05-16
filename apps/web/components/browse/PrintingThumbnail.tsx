'use client';

// Thumbnail tile for the per-set printing grid. Click → navigates
// to `/cards/[printingId]`. Falls back to the variant code when
// no small image is available, so the grid never has visual gaps.

import Link from 'next/link';

import { Card, Text, YStack } from '@binderly/ui';

export interface PrintingThumbnailProps {
  href: string;
  cardName: string;
  cardNumber: string;
  variantLabel: string;
  imageUrl: string | null;
  altText: string;
}

export function PrintingThumbnail(props: PrintingThumbnailProps): React.ReactNode {
  const { href, cardName, cardNumber, variantLabel, imageUrl, altText } = props;

  return (
    <Link
      href={href}
      style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
      data-testid="printing-thumbnail-link"
    >
      <Card
        variant="outlined"
        padding="$3"
        gap="$2"
        hoverStyle={{ borderColor: '$primary' }}
        focusStyle={{ borderColor: '$primary' }}
        data-testid="printing-thumbnail"
      >
        <YStack
          width="100%"
          height={160}
          backgroundColor="$surfaceMuted"
          borderRadius={8}
          alignItems="center"
          justifyContent="center"
          overflow="hidden"
        >
          {imageUrl !== null ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt={altText}
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
              data-testid="printing-thumbnail-image"
            />
          ) : (
            <Text variant="caption" tone="muted" data-testid="printing-thumbnail-fallback">
              No image
            </Text>
          )}
        </YStack>
        <YStack gap="$1">
          <Text variant="bodySmall" data-testid="printing-thumbnail-name">
            #{cardNumber} · {cardName}
          </Text>
          <Text variant="caption" tone="muted" data-testid="printing-thumbnail-variant">
            {variantLabel}
          </Text>
        </YStack>
      </Card>
    </Link>
  );
}
