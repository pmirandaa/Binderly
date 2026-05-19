// `<CardScreen>` — card detail.
//
// Surface:
//
//   - Hero image (first printing's `imageLargeUrl` if present;
//     falls back to `imageSmallUrl`).
//   - Metadata block: set id, number, rarity, illustrator,
//     language.
//   - `<PriceBlock>` — V2 `/v1/printings/:id/current-price`
//     wired via `@binderly/pricing-display` (T-M-API-V2-WIRING).
//     The hero printing's id drives the headline price.
//   - Disabled "Add to collection" CTA with copy explaining that
//     sign-in is required (collection mutations land in
//     T-M-COLLECTION).
//   - 404 surface when the id misses.

import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { type ReactNode } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { ApiNotFoundError } from '@binderly/api-client';
import type { CardWithPrintingsDto, PrintingDto } from '@binderly/api-contracts';
import { Button, Card, Spinner, Text, XStack, YStack } from '@binderly/ui';

import { BuyCta } from '../../components/buy-cta/index.js';
import { PriceBlock } from '../../components/card/PriceBlock.js';
import { languageLabel, useCardQuery, variantClassLabel } from '../../lib/browse/index.js';

const styles = StyleSheet.create({
  heroImage: { width: '100%', height: '100%' },
});

export function CardScreen(): ReactNode {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = normalizeParam(params.id);

  const cardQuery = useCardQuery(id);

  if (id === undefined) {
    return <CardNotFoundState reason="missing-id" />;
  }

  if (cardQuery.isLoading) {
    return <CardLoadingState />;
  }

  if (cardQuery.isError) {
    if (cardQuery.error instanceof ApiNotFoundError) {
      return <CardNotFoundState reason="unknown-id" id={id} />;
    }
    return <CardErrorState message={cardQuery.error?.message ?? 'Failed to load this card.'} />;
  }

  const card = cardQuery.data;
  if (card === undefined) {
    return <CardNotFoundState reason="unknown-id" id={id} />;
  }

  return <CardDetailView card={card} />;
}

function CardDetailView({ card }: { card: CardWithPrintingsDto }): ReactNode {
  const heroPrinting = pickHeroPrinting(card.printings);
  const heroImageUrl = heroPrinting?.imageLargeUrl ?? heroPrinting?.imageSmallUrl ?? null;

  return (
    <ScrollView testID="card-screen">
      <YStack flex={1} backgroundColor="$background" gap="$4" padding="$4" paddingTop="$6">
        <YStack
          alignItems="center"
          justifyContent="center"
          aspectRatio={5 / 7}
          backgroundColor="$surfaceMuted"
          borderRadius={12}
          overflow="hidden"
          testID="card-hero"
        >
          {heroImageUrl !== null ? (
            <Image
              source={{ uri: heroImageUrl }}
              style={styles.heroImage}
              contentFit="contain"
              accessibilityLabel={`${card.name} card image`}
              testID="card-hero-image"
            />
          ) : (
            <Text variant="caption" tone="muted">
              No image available
            </Text>
          )}
        </YStack>

        <YStack gap="$1" testID="card-title">
          <Text variant="title" tone="default">
            {card.name}
          </Text>
          <Text variant="caption" tone="muted">
            #{card.number} · {languageLabel(card.language)}
          </Text>
        </YStack>

        <Card variant="outlined" gap="$2" testID="card-metadata">
          <MetadataRow label="Rarity" value={card.rarity ?? '—'} />
          <MetadataRow label="Type" value={card.type ?? '—'} />
          <MetadataRow label="Subtype" value={card.subtype ?? '—'} />
          <MetadataRow label="Illustrator" value={card.illustrator ?? '—'} />
          <MetadataRow label="HP" value={card.hp !== null ? String(card.hp) : '—'} />
          <MetadataRow label="Printings" value={String(card.printings.length)} />
        </Card>

        {card.printings.length > 0 ? (
          <Card variant="outlined" gap="$2" testID="card-variants">
            <Text variant="label" tone="default">
              Variants
            </Text>
            <YStack gap="$1">
              {card.printings.map((printing) => (
                <Text key={printing.id} variant="caption" tone="muted">
                  {variantClassLabel(printing.variantClass)}
                  {printing.variantFlags.length > 0
                    ? ` · ${printing.variantFlags.map(variantClassLabel).join(', ')}`
                    : ''}
                </Text>
              ))}
            </YStack>
          </Card>
        ) : null}

        <PriceBlock printingId={heroPrinting?.id} testID="card-prices" />

        <Card variant="outlined" gap="$2" testID="card-buy">
          <Text variant="label" tone="default">
            Buy
          </Text>
          <Text variant="caption" tone="muted">
            Open this card on TCGplayer. Binderly earns a small affiliate commission on purchases —
            see our pricing & disclosure footer.
          </Text>
          <BuyCta
            card={{
              cardName: card.name,
              number: card.number,
            }}
          />
        </Card>

        <YStack gap="$1" testID="card-add">
          <Button
            label="Add to collection"
            variant="primary"
            size="lg"
            disabled
            accessibilityLabel="Add to collection (sign in required)"
            aria-label="Add to collection (sign in required)"
            testID="card-add-button"
          />
          <Text variant="caption" tone="muted">
            Sign in to track your copies once T-M-COLLECTION ships.
          </Text>
        </YStack>
      </YStack>
    </ScrollView>
  );
}

interface MetadataRowProps {
  readonly label: string;
  readonly value: string;
}

function MetadataRow(props: MetadataRowProps): ReactNode {
  return (
    <XStack justifyContent="space-between" alignItems="center" paddingVertical="$1">
      <Text variant="caption" tone="muted">
        {props.label}
      </Text>
      <Text variant="caption" tone="default">
        {props.value}
      </Text>
    </XStack>
  );
}

function pickHeroPrinting(printings: ReadonlyArray<PrintingDto>): PrintingDto | undefined {
  // Prefer a HOLO printing (the "iconic" version most collectors
  // expect on the detail surface) if present; otherwise fall back
  // to the first one returned.
  return printings.find((p) => p.variantClass === 'HOLO') ?? printings[0];
}

function normalizeParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  if (typeof value === 'string' && value.length > 0) return value;
  return undefined;
}

function CardLoadingState(): ReactNode {
  return (
    <YStack
      flex={1}
      alignItems="center"
      justifyContent="center"
      gap="$2"
      padding="$6"
      testID="card-loading"
    >
      <Spinner size="md" />
      <Text variant="caption" tone="muted">
        Loading card…
      </Text>
    </YStack>
  );
}

interface CardErrorStateProps {
  readonly message: string;
}

function CardErrorState(props: CardErrorStateProps): ReactNode {
  return (
    <YStack
      flex={1}
      alignItems="center"
      justifyContent="center"
      gap="$2"
      padding="$6"
      testID="card-error"
    >
      <Text variant="subtitle" tone="error">
        Couldn’t load this card
      </Text>
      <Text variant="body" tone="muted">
        {props.message}
      </Text>
    </YStack>
  );
}

interface CardNotFoundStateProps {
  readonly reason: 'unknown-id' | 'missing-id';
  readonly id?: string;
}

function CardNotFoundState(props: CardNotFoundStateProps): ReactNode {
  return (
    <YStack
      flex={1}
      alignItems="center"
      justifyContent="center"
      gap="$2"
      padding="$6"
      backgroundColor="$background"
      testID="card-not-found"
    >
      <Text variant="title" tone="default">
        Card not found
      </Text>
      <Text variant="body" tone="muted">
        {props.reason === 'unknown-id' && props.id !== undefined
          ? `We couldn’t find a card with the id “${props.id}”.`
          : 'No card was specified.'}
      </Text>
    </YStack>
  );
}
