// Capture controls — the bottom action bar.
//
//   - "Capture" is the primary CTA, disabled while a capture is
//     in-flight to prevent double-taps.
//   - "Cancel" routes the user out of the flow (callsite handles
//     `router.back()`).
//   - "Reset" appears once the user has accepted at least one
//     shot; lets them start over without leaving the screen.

import { type ReactNode } from 'react';

import { Button, XStack } from '@binderly/ui';

export interface CaptureControlsProps {
  readonly captureLabel: string;
  readonly captureDisabled?: boolean;
  readonly captureBusy?: boolean;
  readonly onCapture: () => void;
  readonly onCancel: () => void;
  readonly showReset: boolean;
  readonly onReset: () => void;
  readonly testID?: string;
}

export function CaptureControls(props: CaptureControlsProps): ReactNode {
  return (
    <XStack
      padding="$3"
      gap="$3"
      alignItems="center"
      justifyContent="space-between"
      testID={props.testID ?? 'capture-controls'}
    >
      <Button variant="ghost" onPress={props.onCancel} testID="capture-cancel">
        Cancel
      </Button>
      <Button
        variant="primary"
        size="lg"
        onPress={props.onCapture}
        disabled={props.captureDisabled === true || props.captureBusy === true}
        loading={props.captureBusy === true}
        testID="capture-take"
        accessibilityLabel={props.captureLabel}
      >
        {props.captureLabel}
      </Button>
      {props.showReset ? (
        <Button variant="ghost" onPress={props.onReset} testID="capture-reset">
          Start over
        </Button>
      ) : (
        <XStack width={80} testID="capture-reset-spacer" />
      )}
    </XStack>
  );
}
