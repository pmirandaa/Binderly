// `<GradingCameraSurface>` — vision-camera host for the capture flow.
//
// Mirrors the scanner-side `<CameraPreview>` posture: pick the
// back-facing device via `useCameraDevice('back')`, mount a
// `<Camera>` with `isActive`, and render a "no device" fallback
// when the device list is empty (emulator, sandbox).
//
// Unlike scanner, we do NOT mount a frame processor by default —
// the capture flow is event-driven via `takePhoto()`. A
// frame-processor for live quality feedback is on the roadmap
// (so the capture CTA can light up / dim based on live preview)
// but ships as a follow-up — out of scope this iteration.
//
// The `cameraRef` is forwarded to the screen via `cameraRef` prop
// (not via React's `forwardRef`) so the screen can call
// `cameraRef.current?.takePhoto()` from its capture handler.
//
// IMPORTANT: this component does not modify the scanner-side
// permission flow — the screen filters non-granted permission
// branches and renders the scanner's `<CameraPermissionPrompt>`
// before this component ever mounts.

import React, { type MutableRefObject, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { Camera, useCameraDevice } from 'react-native-vision-camera';

import { Text, YStack } from '@binderly/ui';

import { CaptureFramingOverlay } from './CaptureFramingOverlay.js';

import type { CaptureOverlayKind } from '../types.js';

export interface GradingCameraSurfaceProps {
  /** Whether the camera should hold a capture session. */
  readonly isActive: boolean;
  /**
   * Ref for the underlying `<Camera>` instance — the screen calls
   * `cameraRef.current.takePhoto()` from its capture button handler.
   * Typed as `MutableRefObject<Camera | null>` so callers using
   * `useRef<Camera | null>(null)` line up; vision-camera accepts
   * mutable refs as the underlying `<Camera>` ref prop.
   */
  readonly cameraRef: MutableRefObject<Camera | null>;
  /** Overlay shape to draw for the current step. */
  readonly overlayKind: CaptureOverlayKind;
  /** Optional hint string rendered inside the overlay frame. */
  readonly overlayHint?: string;
  /** Override the test id (defaults to `'grading-camera-preview'`). */
  readonly testID?: string;
}

export function GradingCameraSurface(props: GradingCameraSurfaceProps): ReactNode {
  const device = useCameraDevice('back');

  if (device === undefined || device === null) {
    return (
      <YStack
        flex={1}
        gap="$3"
        padding="$6"
        alignItems="center"
        justifyContent="center"
        backgroundColor="$background"
        testID="grading-camera-no-device"
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
    <YStack flex={1} testID={props.testID ?? 'grading-camera-preview'}>
      <Camera
        // vision-camera's `<Camera>` is a class component whose ref
        // type is `Ref<Camera>` (non-nullable). We forward a
        // `MutableRefObject<Camera | null>` (the standard
        // `useRef<Camera | null>(null)` shape) and cast at the ref
        // boundary — the underlying setter still works because RN's
        // ref assignment tolerates nullable mutable refs.
        ref={props.cameraRef as unknown as React.Ref<Camera>}
        style={styles.camera}
        device={device}
        isActive={props.isActive}
        photo
      />
      <CaptureFramingOverlay kind={props.overlayKind} hint={props.overlayHint} />
    </YStack>
  );
}

const styles = StyleSheet.create({
  camera: {
    flex: 1,
  },
});
