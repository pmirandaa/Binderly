// Bottom feedback banner. Renders the most recent capture's
// feedback reason (or the "ready to capture" hint when there's
// no recent attempt).

import { type ReactNode } from 'react';

import { Text, YStack } from '@binderly/ui';

import { CAPTURE_FEEDBACK_COPY } from '../quality.js';

import type { CaptureFeedbackReason } from '../types.js';

export interface CaptureFeedbackBannerProps {
  /** Most recent feedback reason, or `null` before any capture. */
  readonly reason: CaptureFeedbackReason | null;
  /** Render copy even when reason is `null` (treated as "great"). */
  readonly defaultsToReady?: boolean;
  readonly testID?: string;
}

export function CaptureFeedbackBanner(props: CaptureFeedbackBannerProps): ReactNode {
  const resolved: CaptureFeedbackReason | null =
    props.reason ?? (props.defaultsToReady === true ? 'great' : null);
  if (resolved === null) {
    return null;
  }
  const copy = CAPTURE_FEEDBACK_COPY[resolved];
  const tone: 'success' | 'warning' | 'error' =
    resolved === 'great' ? 'success' : resolved === 'no_card_detected' ? 'error' : 'warning';
  return (
    <YStack
      padding="$3"
      borderRadius={12}
      backgroundColor="$surfaceMuted"
      alignItems="center"
      testID={props.testID ?? 'capture-feedback-banner'}
      data-reason={resolved}
    >
      <Text variant="bodySmall" tone={tone}>
        {copy}
      </Text>
    </YStack>
  );
}
