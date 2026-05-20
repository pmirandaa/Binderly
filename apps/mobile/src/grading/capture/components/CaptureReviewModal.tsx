// Review modal — surfaced after each accepted capture so the
// user has a chance to retake before the session advances.
//
// Pure Tamagui surface — no native modal primitive. The screen
// gates rendering by inspecting `attempt.outcome === 'accepted'`
// in its own state. Render path is therefore identical on iOS,
// Android, and web.

import { type ReactNode } from 'react';

import { Button, Text, XStack, YStack } from '@binderly/ui';

export interface CaptureReviewModalProps {
  readonly visible: boolean;
  readonly stepTitle: string;
  readonly photoUri: string;
  readonly sharpness: number;
  readonly brightness: number;
  readonly coverage: number;
  readonly onAccept: () => void;
  readonly onRetake: () => void;
  readonly testID?: string;
}

export function CaptureReviewModal(props: CaptureReviewModalProps): ReactNode {
  if (!props.visible) return null;
  return (
    <YStack
      position="absolute"
      top={0}
      left={0}
      right={0}
      bottom={0}
      backgroundColor="rgba(0,0,0,0.6)"
      alignItems="center"
      justifyContent="center"
      padding="$4"
      testID={props.testID ?? 'capture-review-modal'}
    >
      <YStack
        backgroundColor="$background"
        padding="$4"
        borderRadius={16}
        gap="$3"
        width="100%"
        maxWidth={420}
        alignItems="stretch"
        testID="capture-review-card"
      >
        <Text variant="subtitle" tone="default">
          {props.stepTitle}
        </Text>
        <Text variant="bodySmall" tone="muted">
          {`URI: ${truncate(props.photoUri)}`}
        </Text>
        <YStack gap="$1" testID="capture-review-metrics">
          <Text variant="caption" tone="muted">
            {`Sharpness ${props.sharpness.toFixed(1)} • Brightness ${(
              props.brightness * 100
            ).toFixed(0)}% • Coverage ${(props.coverage * 100).toFixed(0)}%`}
          </Text>
        </YStack>
        <XStack gap="$3" justifyContent="flex-end">
          <Button variant="ghost" onPress={props.onRetake} testID="capture-review-retake">
            Retake
          </Button>
          <Button variant="primary" onPress={props.onAccept} testID="capture-review-accept">
            Accept
          </Button>
        </XStack>
      </YStack>
    </YStack>
  );
}

function truncate(uri: string, max: number = 40): string {
  if (uri.length <= max) return uri;
  return `…${uri.slice(uri.length - max + 1)}`;
}
