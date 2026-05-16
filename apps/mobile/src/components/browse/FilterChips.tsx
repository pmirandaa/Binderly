// `<FilterChips>` — language + series filter row for the
// BrowseScreen. Chips are intentionally light: a tap toggles
// inclusion; an "ALL" chip resets the dimension.
//
// The component is presentation-only; the BrowseScreen owns the
// filter state + memoization. We export a small inner `<Chip>`
// primitive because the SetScreen header reuses the same look
// for a future "show only missing" toggle.

import { Pressable, Text, XStack, YStack } from '@binderly/ui';

import { UNKNOWN_SERIES, type LanguageFilter } from '../../lib/browse/index.js';

import type { ReactNode } from 'react';

export interface ChipProps {
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
  readonly testID?: string;
}

export function Chip(props: ChipProps): ReactNode {
  const { label, selected, onPress, testID } = props;
  return (
    <Pressable
      onPress={onPress}
      variant="ghost"
      paddingHorizontal="$3"
      paddingVertical="$2"
      borderRadius={999}
      borderWidth={1}
      borderColor={selected ? '$primary' : '$border'}
      backgroundColor={selected ? '$primary' : 'transparent'}
      aria-label={label}
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      aria-pressed={selected}
      testID={testID}
    >
      <Text variant="caption" tone={selected ? 'inverse' : 'default'}>
        {label}
      </Text>
    </Pressable>
  );
}

const LANGUAGE_CHIPS: ReadonlyArray<{ readonly token: LanguageFilter; readonly label: string }> = [
  { token: 'ALL', label: 'All' },
  { token: 'en', label: 'EN' },
  { token: 'jp', label: 'JP' },
];

export interface FilterChipsProps {
  readonly language: LanguageFilter;
  readonly onLanguageChange: (next: LanguageFilter) => void;
  readonly seriesOptions: ReadonlyArray<string>;
  readonly selectedSeries: ReadonlySet<string>;
  readonly onToggleSeries: (token: string) => void;
}

export function FilterChips(props: FilterChipsProps): ReactNode {
  const { language, onLanguageChange, seriesOptions, selectedSeries, onToggleSeries } = props;
  return (
    <YStack gap="$2" paddingHorizontal="$4" paddingVertical="$2" testID="browse-filters">
      <XStack gap="$2" testID="browse-language-chips">
        {LANGUAGE_CHIPS.map(({ token, label }) => (
          <Chip
            key={token}
            label={label}
            selected={language === token}
            onPress={() => onLanguageChange(token)}
            testID={`browse-language-${token.toLowerCase()}`}
          />
        ))}
      </XStack>
      {seriesOptions.length > 0 ? (
        <XStack gap="$2" flexWrap="wrap" testID="browse-series-chips">
          {seriesOptions.map((token) => (
            <Chip
              key={token}
              label={token === UNKNOWN_SERIES ? 'Other' : token}
              selected={selectedSeries.has(token)}
              onPress={() => onToggleSeries(token)}
              testID={`browse-series-${tokenToId(token)}`}
            />
          ))}
        </XStack>
      ) : null}
    </YStack>
  );
}

function tokenToId(token: string): string {
  return token
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
