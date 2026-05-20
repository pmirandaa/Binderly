// Camera preview — thin host around vision-camera's `<Camera>`.
//
// The preview is intentionally minimal at this stage. The full
// continuous-scan UX (rectangle overlay, session counter, undo
// toasts) lives in T-SC-UX. Today the preview:
//
//   - Picks the back-facing device via `useCameraDevice('back')`.
//   - Reads the `isActive` from the lifecycle hook so the camera
//     releases on blur and on background.
//   - Wires the placeholder frame processor (which is itself wired
//     to the JS-side telemetry sink + stack-mode detector).
//   - Caps the underlying capture session at the same FPS the
//     frame processor throttles to so battery use matches the rule.
//
// The component also renders a friendly fallback when no camera
// device is available (sandbox, emulator, broken hardware). That
// branch is the same surface a denied-permission user lands on
// from `CameraPermissionPrompt`, so the screen looks consistent.

import { type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { Camera, useCameraDevice } from 'react-native-vision-camera';

import { Text, YStack } from '@binderly/ui';

import { TARGET_FRAME_RATE_FPS } from '../constants.js';
import { useScanFrameProcessor } from '../frame-processor.js';

import type { StackModeDetector } from '../stack-mode.js';
import type { FrameTelemetrySink } from '../types.js';

export interface CameraPreviewProps {
  /** Whether the camera should hold a capture session. */
  readonly isActive: boolean;
  /** JS-thread sink for the placeholder telemetry events. */
  readonly telemetrySink: FrameTelemetrySink;
  /** Stack-mode detector that buffers recent frames for the reset signal. */
  readonly stackModeDetector: StackModeDetector;
  /** Override the test id (defaults to `'scan-camera-preview'`). */
  readonly testID?: string;
}

export function CameraPreview(props: CameraPreviewProps): ReactNode {
  const device = useCameraDevice('back');
  const frameProcessor = useScanFrameProcessor({
    telemetrySink: props.telemetrySink,
    stackModeDetector: props.stackModeDetector,
  });

  if (device === undefined || device === null) {
    return (
      <YStack
        flex={1}
        gap="$3"
        padding="$6"
        alignItems="center"
        justifyContent="center"
        backgroundColor="$background"
        testID="scan-camera-no-device"
      >
        <Text variant="subtitle" tone="default">
          No camera available
        </Text>
        <Text variant="body" tone="muted">
          Binderly couldn’t find a back-facing camera on this device. Try
          on a phone or tablet with a rear camera.
        </Text>
      </YStack>
    );
  }

  return (
    <Camera
      style={styles.camera}
      device={device}
      isActive={props.isActive}
      fps={TARGET_FRAME_RATE_FPS}
      frameProcessor={frameProcessor}
      testID={props.testID ?? 'scan-camera-preview'}
    />
  );
}

const styles = StyleSheet.create({
  camera: {
    flex: 1,
  },
});
