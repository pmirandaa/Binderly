// `<GradingCaptureReviewScreen>` — read-only review surface for
// the capture → grading hand-off.
//
// The screen resolves its {@link GradingCaptureSession} the same
// way the real centering screen does (#FU-32): it reads the
// `?sessionId=<id>` router param and looks the session up in the
// module-scoped session store (`grading/centering/session-store`).
// Only the lightweight id travels through the route; the captured
// stills stay in-memory keyed by that id.
//
// The screen is intentionally read-only: there are no buttons
// that mutate the captured session. The "Back" CTA navigates back
// to the capture tab; the "Continue" CTA pushes the centering
// route, preserving the session id.

import { useLocalSearchParams, useRouter } from 'expo-router';
import { type ReactNode } from 'react';

import { Button, Text, XStack, YStack } from '@binderly/ui';

import { getSession } from '../../centering/session-store.js';

import type { GradingCaptureSession, GradingShot } from '../types.js';

export interface GradingCaptureReviewScreenProps {
  /** Inject the session directly (testing). Overrides the store lookup. */
  readonly session?: GradingCaptureSession | null;
  /** Override the session id (testing — bypasses `useLocalSearchParams`). */
  readonly sessionIdOverride?: string;
  readonly testID?: string;
}

export function GradingCaptureReviewScreen(
  props: GradingCaptureReviewScreenProps,
): ReactNode {
  const router = useRouter();
  const params = useLocalSearchParams<{ sessionId?: string }>();
  const sessionId = props.sessionIdOverride ?? params.sessionId;
  const session =
    props.session ?? (sessionId !== undefined ? getSession(sessionId) ?? null : null);

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
            router.push(`/grading/centering?sessionId=${encodeURIComponent(session.id)}`);
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
