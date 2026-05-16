'use client';

// Simple horizontal progress bar built from Tamagui primitives.
// `@binderly/ui` does not yet expose a Progress component (and
// shouldn't grow one for a single consumer), so this component
// stays here in the collection-stage `owns_paths` tree. If a
// second feature needs progress bars later it should be lifted
// into the shared package.
//
// Accessibility: rendered as `role="progressbar"` with the WAI-
// ARIA value attributes so screen readers announce "Set
// completion 13.5 percent".

import { Text, YStack } from '@binderly/ui';

import { formatPercent } from '../../lib/collection/format';

export interface ProgressBarProps {
  label: string;
  /** Percentage in 0..100. NaN / negative values clamp to 0. */
  value: number;
  /**
   * Optional second-line "12 / 102" counts shown next to the
   * percentage. The home and per-set views use this to render
   * "Set %: 13.5% (12 / 102 owned)" without duplicating layout.
   */
  countLabel?: string;
  /** Tone — visual emphasis without changing the value. */
  tone?: 'set' | 'master' | 'global';
  /** Extra test id seam for tests that want to target a specific bar. */
  testId?: string;
  /** Visual size — bars on the per-set drill-down are "lg". */
  size?: 'sm' | 'lg';
}

export function ProgressBar({
  label,
  value,
  countLabel,
  tone = 'set',
  testId,
  size = 'sm',
}: ProgressBarProps): React.ReactNode {
  const clamped = clamp(value);
  const trackHeight = size === 'lg' ? 12 : 8;
  return (
    <YStack gap="$1" data-testid={testId}>
      <YStack
        // Inline flex row keeps the label, percentage, and counts on
        // one line at desktop widths and wraps gracefully on narrow
        // viewports without dragging in another XStack layout.
        flexDirection="row"
        alignItems="baseline"
        justifyContent="space-between"
        gap="$2"
        flexWrap="wrap"
      >
        <Text variant="label" data-testid={testId ? `${testId}-label` : undefined}>
          {label}
        </Text>
        <Text
          variant="bodySmall"
          tone="muted"
          data-testid={testId ? `${testId}-value` : undefined}
        >
          {formatPercent(clamped)}
          {countLabel !== undefined ? ` · ${countLabel}` : ''}
        </Text>
      </YStack>
      <YStack
        width="100%"
        height={trackHeight}
        backgroundColor="$surfaceMuted"
        borderRadius={999}
        overflow="hidden"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clamped * 10) / 10}
        aria-label={label}
        data-testid={testId ? `${testId}-track` : undefined}
      >
        {/* The fill is rendered via a tone switch rather than a
            dynamic token lookup because Tamagui's typed color
            tokens (`$primary`, `$secondary`, `$success`) live on
            a literal union — a single `backgroundColor={tokenStr}`
            with a string variable fails the typecheck. */}
        {tone === 'set' ? (
          <YStack
            height="100%"
            width={`${clamped}%`}
            backgroundColor="$primary"
            borderRadius={999}
            data-testid={testId ? `${testId}-fill` : undefined}
          />
        ) : null}
        {tone === 'master' ? (
          <YStack
            height="100%"
            width={`${clamped}%`}
            backgroundColor="$secondary"
            borderRadius={999}
            data-testid={testId ? `${testId}-fill` : undefined}
          />
        ) : null}
        {tone === 'global' ? (
          <YStack
            height="100%"
            width={`${clamped}%`}
            backgroundColor="$success"
            borderRadius={999}
            data-testid={testId ? `${testId}-fill` : undefined}
          />
        ) : null}
      </YStack>
    </YStack>
  );
}

function clamp(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  if (value > 100) return 100;
  return value;
}
