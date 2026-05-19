// `<CompletionBadge>` — the "above-the-fold" global summary on the
// CollectionScreen. Renders the user's All Pokémon % alongside
// supporting counts (sets started, sets mastered, total cards
// owned). Uses the larger global progress bar tone.
//
// Master % is sourced authoritatively from the V2
// `/v1/me/collection/completion` endpoint (T-M-API-V2-WIRING);
// the parked "full math soon" placeholder was retired with that
// swap.

import { Card, Text, XStack, YStack } from '@binderly/ui';

import { ProgressBar } from './ProgressBar.js';
import { formatCount, formatPercent } from '../../lib/collection/format.js';

import type { CollectionGlobalSummary } from '../../lib/collection/index.js';
import type { ReactNode } from 'react';

export interface CompletionBadgeProps {
  readonly summary: CollectionGlobalSummary;
  readonly testID?: string;
}

export function CompletionBadge(props: CompletionBadgeProps): ReactNode {
  const { summary } = props;
  const testID = props.testID ?? 'collection-global-badge';
  return (
    <Card variant="outlined" gap="$3" padding="$4" testID={testID}>
      <YStack gap="$1">
        <Text variant="caption" tone="muted">
          Your collection
        </Text>
        <XStack justifyContent="space-between" alignItems="baseline" gap="$2">
          <Text variant="title" tone="default">
            {formatPercent(summary.allPokemonPct)}
          </Text>
          <Text variant="caption" tone="muted">
            of all Pokémon
          </Text>
        </XStack>
        <Text variant="caption" tone="muted">
          {formatCount(summary.uniqueCardsOwned, summary.uniqueCardsTotal)} unique cards
        </Text>
      </YStack>
      <ProgressBar
        value={summary.allPokemonPct}
        tone="global"
        height={10}
        accessibilityLabel={`All Pokémon progress ${formatPercent(summary.allPokemonPct)}`}
        testID={`${testID}-bar`}
      />
      <XStack gap="$4" justifyContent="space-between" testID={`${testID}-counters`}>
        <Counter label="Sets started" value={String(summary.setsStarted)} />
        <Counter label="Sets mastered" value={String(summary.setsMastered)} />
        <Counter
          label="Master %"
          value={formatPercent(summary.masterPct)}
          subtitle={formatCount(summary.masterOwned, summary.masterTotal)}
        />
      </XStack>
    </Card>
  );
}

interface CounterProps {
  readonly label: string;
  readonly value: string;
  readonly subtitle?: string;
}

function Counter(props: CounterProps): ReactNode {
  return (
    <YStack flex={1} gap="$1">
      <Text variant="label" tone="default">
        {props.value}
      </Text>
      <Text variant="caption" tone="muted">
        {props.label}
      </Text>
      {props.subtitle !== undefined ? (
        <Text variant="caption" tone="muted">
          {props.subtitle}
        </Text>
      ) : null}
    </YStack>
  );
}
