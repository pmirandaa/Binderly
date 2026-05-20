// `<CenteringScreen>` — the real centering result screen.
//
// Reads `sessionId` from `useLocalSearchParams()`, retrieves the session
// from the module-scoped store, invokes the centering service, and renders
// loading / result / error states.
//
// This screen REPLACES the `GradingCaptureReviewScreen` placeholder at the
// `/grading/centering` route (see `apps/mobile/app/grading/centering.tsx`).
//
// # Session-store seam (#FU-32)
//
// The capture screen calls `storeSession(emitted)` and pushes:
//   `/grading/centering?sessionId=${emitted.id}`
// This screen calls `getSession(sessionId)` to retrieve the full session
// object without encoding 4 file URIs in the URL.  On unmount, it calls
// `clearSession(sessionId)` to free memory.

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, type ReactNode } from 'react';

import { Button, Text, XStack, YStack } from '@binderly/ui';

import { clearSession } from '../session-store.js';
import { useCentering } from '../use-centering.js';

import type { CenteringService } from '../types.js';

export interface CenteringScreenProps {
  /** Override the service (testing). Defaults to the module singleton. */
  readonly service?: CenteringService;
  /** Override the session lookup (testing). */
  readonly getSessionFn?: (id: string) => import('../../capture/types.js').GradingCaptureSession | undefined;
  /** Override the session id (testing — bypasses `useLocalSearchParams`). */
  readonly sessionIdOverride?: string;
  readonly testID?: string;
}

export function CenteringScreen(props: CenteringScreenProps): ReactNode {
  const router = useRouter();
  const params = useLocalSearchParams<{ sessionId?: string }>();
  const sessionId = props.sessionIdOverride ?? params.sessionId;

  const centering = useCentering({
    sessionId,
    service: props.service,
    getSessionFn: props.getSessionFn,
  });

  // Clean up the session from the store when the screen unmounts.
  useEffect((): (() => void) => {
    return (): void => {
      if (sessionId) {
        clearSession(sessionId);
      }
    };
  }, [sessionId]);

  const handleBack = (): void => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  };

  if (centering.status === 'idle' || centering.status === 'loading') {
    return (
      <YStack
        flex={1}
        alignItems="center"
        justifyContent="center"
        gap="$3"
        padding="$6"
        backgroundColor="$background"
        testID={props.testID ?? 'centering-screen-loading'}
      >
        <Text variant="subtitle" tone="default">
          Measuring centering…
        </Text>
        <Text variant="bodySmall" tone="muted">
          Analysing your front and back captures.
        </Text>
      </YStack>
    );
  }

  if (centering.status === 'error') {
    const errorReason = centering.error?.reason ?? 'unknown';
    const errorMessage = centering.error?.message ?? 'An unknown error occurred.';
    const isNotImplemented = errorReason === 'not_implemented';

    return (
      <YStack
        flex={1}
        gap="$4"
        padding="$6"
        backgroundColor="$background"
        testID={props.testID ?? 'centering-screen-error'}
        data-error-reason={errorReason}
      >
        <Text variant="title" tone="default">
          {isNotImplemented ? 'Centering coming soon' : 'Measurement failed'}
        </Text>
        <Text variant="body" tone={isNotImplemented ? 'muted' : 'default'}>
          {isNotImplemented
            ? 'On-device centering measurement will be available in a future update. '
              + 'Your captures have been saved for when the feature launches.'
            : errorMessage}
        </Text>
        {isNotImplemented && (
          <Text variant="bodySmall" tone="muted" testID="centering-screen-not-implemented-note">
            The centering algorithm runs on a Python service that is not yet
            deployed. This is a known limitation — see T-GR-CENTERING #FU-33.
          </Text>
        )}
        <XStack gap="$3" justifyContent="flex-end">
          <Button
            variant="primary"
            onPress={handleBack}
            testID="centering-screen-error-back"
          >
            Back
          </Button>
        </XStack>
      </YStack>
    );
  }

  // status === 'success'
  const result = centering.result!;
  const session = centering.session!;

  const hPct = result.hRatio !== null
    ? `${Math.round(result.hRatio * 100)}%`
    : '—';
  const vPct = result.vRatio !== null
    ? `${Math.round(result.vRatio * 100)}%`
    : '—';

  return (
    <YStack
      flex={1}
      gap="$4"
      padding="$4"
      backgroundColor="$background"
      testID={props.testID ?? 'centering-screen-result'}
      data-session-id={session.id}
      data-grade-hint={result.gradeHint}
    >
      <Text variant="title" tone="default">
        Centering
      </Text>
      <Text variant="bodySmall" tone="muted">
        {`Session ${session.id}`}
      </Text>

      <YStack gap="$2" testID="centering-grade-hint">
        <Text variant="subtitle" tone="default">
          {`Grade hint: PSA ${result.gradeHint}`}
        </Text>
        {result.lowConfidence && (
          <Text variant="bodySmall" tone="muted" testID="centering-low-confidence-note">
            Low confidence — holographic or single-face measurement.
          </Text>
        )}
      </YStack>

      <YStack gap="$1" testID="centering-ratios">
        <Text variant="label" tone="default">
          Horizontal
        </Text>
        <Text variant="body" tone="muted">
          {hPct}
        </Text>
        <Text variant="label" tone="default">
          Vertical
        </Text>
        <Text variant="body" tone="muted">
          {vPct}
        </Text>
      </YStack>

      <XStack gap="$3" justifyContent="flex-end">
        <Button
          variant="ghost"
          onPress={handleBack}
          testID="centering-screen-result-back"
        >
          Back
        </Button>
      </XStack>
    </YStack>
  );
}
