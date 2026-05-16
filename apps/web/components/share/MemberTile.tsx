'use client';

// One tile in the public shareable's member grid. A read-only
// cousin of T-W-BROWSE's `<PrintingThumbnail>` — the visual
// shape is identical so the public page looks like the browse
// surface, but the testid namespace is local to this stage
// (`share-member-*`) so cross-stage selectors don't collide.

import Link from 'next/link';

import { Card, Text, YStack } from '@binderly/ui';

import type { PublicShareMember } from '../../lib/share/api';

export interface MemberTileProps {
  member: PublicShareMember;
}

export function MemberTile({ member }: MemberTileProps): React.ReactNode {
  const altText = `${member.cardName} (${member.setCode} #${member.cardNumber})`;
  return (
    <Link
      href={`/cards/${encodeURIComponent(member.printingId)}`}
      style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
      data-testid="share-member-link"
    >
      <Card
        variant="outlined"
        padding="$3"
        gap="$2"
        hoverStyle={{ borderColor: '$primary' }}
        focusStyle={{ borderColor: '$primary' }}
        data-testid="share-member-tile"
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
          {member.imageUrl !== null ? (
            // Plain `<img>` rather than `next/image` because the
            // shareable can be embedded on third-party domains via
            // unfurlers — `next/image` rewrites src behind the
            // app's domain which breaks the OG preview. Mirrors
            // the choice in `PrintingThumbnail`.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={member.imageUrl}
              alt={altText}
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
              data-testid="share-member-image"
            />
          ) : (
            <Text variant="caption" tone="muted" data-testid="share-member-fallback">
              No image
            </Text>
          )}
        </YStack>
        <YStack gap="$1">
          <Text variant="bodySmall" data-testid="share-member-name">
            #{member.cardNumber} · {member.cardName}
          </Text>
          <Text variant="caption" tone="muted" data-testid="share-member-set">
            {member.setName} · {member.variantLabel}
          </Text>
          {member.quantity > 1 ? (
            <Text variant="caption" tone="muted" data-testid="share-member-quantity">
              ×{member.quantity}
            </Text>
          ) : null}
        </YStack>
      </Card>
    </Link>
  );
}
