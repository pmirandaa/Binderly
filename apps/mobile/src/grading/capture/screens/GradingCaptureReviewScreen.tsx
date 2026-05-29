// `<GradingCaptureReviewScreen>` — placeholder review surface for
// the T-GR-CENTERING hand-off.
//
// Today this screen reads the last-emitted
// {@link GradingCaptureSession} via the module-scoped placeholder
// ref in `GradingCaptureScreen.tsx` and renders a static summary
// (one row per shot, with quality metrics + truncated URI). When
// T-GR-CENTERING ships, this screen is replaced by the real
// centering view; the placeholder ref is replaced by a real
// router-param strategy.
//
// The screen is intentionally read-only: there are no buttons
// that mutate the captured session. The "Start a new capture"
// CTA navigates back to the capture tab; the "Looks good →
// next" CTA is wired to a stub route that will become the real
// downstream screen.

import { useRouter } from 'expo-router';
import { type ReactNode } from 'react';

import { Button, Text, XStack, YStack } from '@binderly/ui';

import { __getLastEmittedSession } from './GradingCaptureScreen.js';

import type { GradingCaptureSession, GradingShot } from '../types.js';

export interface GradingCaptureReviewScreenProps {
  /** Inject the session directly (testing). Falls back to the placeholder ref. */
  readonly session?: GradingCaptureSession | null;
  readonly testID?: string;
}

export function GradingCaptureReviewScreen(
  props: GradingCaptureReviewScreenProps,
): ReactNode {
  const router = useRouter();
  const session = props.session ?? __getLastEmittedSession();

  if (session === null || session === undefined) {
    return (
      <YStack
        flex={1}
        gap="$3"
        padding="$6"
        alignItems="center"
        justifyContent="center"
        backgroundColor="$background"
        testID={props.testID ?? 'grading-capture-review-empty'}
      >
        <Text variant="subtitle" tone="default">
          No capture session
        </Text>
        <Text variant="body" tone="muted">
          Start a new guided capture from the grading tab.
        </Text>
        <Button
          variant="primary"
          onPress={(): void => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace('/');
            }
          }}
          testID="grading-capture-review-back"
        >
          Back to grading
        </Button>
      </YStack>
    );
  }

  const shots: ReadonlyArray<GradingShot> = [
    session.frontFull,
    session.backFull,
    session.frontCorner,
    session.backCorner,
    session.bottomLeftCorner,
    session.bottomRightCorner,
    session.surface,
  ];

  return (
    <YStack
      flex={1}
      gap="$4"
      padding="$4"
      backgroundColor="$background"
      testID={props.testID ?? 'grading-capture-review'}
      data-session-id={session.id}
    >
      <Text variant="title" tone="default">
        Review your shots
      </Text>
      <Text variant="bodySmall" tone="muted">
        {`Session ${session.id} • ${shots.length} shots`}
      </Text>
      <YStack gap="$2" testID="grading-capture-review-shots">
        {shots.map((shot) => (
          <ShotRow key={shot.kind} shot={shot} />
        ))}
      </YStack>
      <XStack gap="$3" justifyContent="flex-end">
        <Button
          variant="ghost"
          onPress={(): void => {
            if (router.canGoBack()) router.back();
          }}
          testID="grading-capture-review-back"
        >
          Back
        </Button>
        <Button
          variant="primary"
          onPress={(): void => {
            router.push('/grading/centering');
          }}
          testID="grading-capture-review-continue"
        >
          Continue
        </Button>
      </XStack>
    </YStack>
  );
}

interface ShotRowProps {
  readonly shot: GradingShot;
}

function ShotRow(props: ShotRowProps): ReactNode {
  const { shot } = props;
  return (
    <YStack
      padding="$3"
      gap="$1"
      borderRadius={12}
      borderWidth={1}
      borderColor="$border"
      testID={`grading-capture-review-shot-${shot.kind}`}
      data-shot-kind={shot.kind}
    >
      <Text variant="label" tone="default">
        {shot.kind}
      </Text>
      <Text variant="caption" tone="muted">
        {`${shot.width}×${shot.height}px • sharpness ${shot.quality.metrics.sharpness.toFixed(1)}`}
      </Text>
      <Text variant="caption" tone="muted">
        {shot.uri}
      </Text>
    </YStack>
  );
}
