// Step indicator — four dots, one per shot kind.
//
// Filled: shot accepted. Outlined: shot pending. Ringed: current
// step. Tamagui tokens only — the colours come from theme tokens
// so dark mode just works.

import { type ReactNode } from 'react';

import { Text, XStack, YStack } from '@binderly/ui';

import type { CaptureStepDefinition, GradingShotKind } from '../types.js';

export interface CaptureStepIndicatorProps {
  readonly steps: ReadonlyArray<CaptureStepDefinition>;
  readonly currentIndex: number;
  readonly acceptedKinds: ReadonlySet<GradingShotKind>;
  readonly testID?: string;
}

export function CaptureStepIndicator(props: CaptureStepIndicatorProps): ReactNode {
  const accepted = props.acceptedKinds;
  return (
    <YStack gap="$2" alignItems="center" testID={props.testID ?? 'capture-step-indicator'}>
      <Text variant="caption" tone="muted">
        {`Step ${Math.min(props.currentIndex + 1, props.steps.length)} of ${props.steps.length}`}
      </Text>
      <XStack gap="$2" alignItems="center">
        {props.steps.map((step) => {
          const isAccepted = accepted.has(step.kind);
          const isCurrent = step.index === props.currentIndex;
          const state: DotState = isAccepted ? 'accepted' : isCurrent ? 'current' : 'pending';
          return (
            <YStack
              key={step.kind}
              width={12}
              height={12}
              borderRadius={6}
              borderWidth={state === 'pending' ? 1 : 2}
              borderColor={state === 'pending' ? '$border' : '$primary'}
              backgroundColor={state === 'accepted' ? '$primary' : 'transparent'}
              testID={`capture-step-dot-${step.kind}`}
              data-state={state}
            />
          );
        })}
      </XStack>
    </YStack>
  );
}

type DotState = 'accepted' | 'current' | 'pending';
