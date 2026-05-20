// `<ScanScreen>` — minimal host for the scanner camera infrastructure.
//
// This is the scan-stage shell, not the full continuous-add UX. The
// UX with auto-add, undo toasts, disambiguation, and the session
// counter lives in T-SC-UX (much later in the dependency graph).
// Today the screen renders one of three branches:
//
//   1. Pre-prompt — when the OS permission status is anything but
//      `'granted'`, we show `CameraPermissionPrompt` with copy
//      tailored to the branch (not-determined / denied / restricted).
//   2. Live camera — once permission is granted, mount the
//      `CameraPreview`. The preview is fed by the same telemetry
//      sink + stack-mode detector instances that the FPS badge
//      reads from, so all three move together.
//   3. Close affordance — top-left button calls `router.back()`.
//      The tab route is the back target by default, so this acts as
//      a "dismiss" that returns the user to whichever screen
//      navigated them into the scanner.
//
// The FPS debug badge is rendered only under `__DEV__` so production
// builds never accidentally surface it.

import { useRouter } from 'expo-router';
import { type ReactNode, useMemo } from 'react';

import { Button, Text, XStack, YStack } from '@binderly/ui';

import {
  CameraPermissionPrompt,
  CameraPreview,
  createFrameTelemetrySink,
  createStackModeDetector,
  FpsDebugBadge,
  useCameraActive,
  useCameraPermissionFlow,
} from '../../scanner/camera/index.js';

/**
 * Toggle for the debug FPS badge. Reads `__DEV__` so production
 * (release-channel) builds never render the overlay. Exposed as a
 * constant so tests can reason about the gate.
 */
export const FPS_BADGE_VISIBLE_IN_DEV: boolean =
  typeof __DEV__ === 'boolean' ? __DEV__ : false;

export function ScanScreen(): ReactNode {
  const router = useRouter();
  const permission = useCameraPermissionFlow();

  // One telemetry sink + one detector per screen mount. `useMemo`
  // with an empty deps array keeps their identity stable across
  // re-renders so the frame processor's `useRunOnJS` closure
  // doesn't rebuild every render (rebuilds tear the JSI bridge
  // down and re-create it).
  const telemetrySink = useMemo(() => createFrameTelemetrySink(), []);
  const stackModeDetector = useMemo(() => createStackModeDetector(), []);

  const cameraActive = useCameraActive({
    disabled: permission.status !== 'granted',
  });

  const handleClose = (): void => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  };

  if (permission.status !== 'granted') {
    return (
      <YStack flex={1} backgroundColor="$background" testID="scan-screen">
        <ScanHeader onClose={handleClose} />
        <CameraPermissionPrompt
          status={permission.status}
          onRequestPermission={permission.requestPermission}
          onOpenSettings={permission.openSettings}
        />
      </YStack>
    );
  }

  return (
    <YStack flex={1} backgroundColor="$background" testID="scan-screen">
      <CameraPreview
        isActive={cameraActive}
        telemetrySink={telemetrySink}
        stackModeDetector={stackModeDetector}
      />
      <XStack
        position="absolute"
        top={0}
        left={0}
        right={0}
        padding="$3"
        justifyContent="space-between"
        alignItems="center"
        pointerEvents="box-none"
      >
        <Button
          variant="ghost"
          onPress={handleClose}
          testID="scan-screen-close"
        >
          Close
        </Button>
        <FpsDebugBadge sink={telemetrySink} visible={FPS_BADGE_VISIBLE_IN_DEV} />
      </XStack>
      <YStack
        position="absolute"
        bottom={0}
        left={0}
        right={0}
        padding="$4"
        alignItems="center"
        pointerEvents="box-none"
      >
        <Text variant="caption" tone="muted">
          Continuous-scan UX lands with T-SC-UX
        </Text>
      </YStack>
    </YStack>
  );
}

interface ScanHeaderProps {
  readonly onClose: () => void;
}

function ScanHeader(props: ScanHeaderProps): ReactNode {
  return (
    <XStack
      padding="$3"
      justifyContent="flex-start"
      alignItems="center"
      backgroundColor="$background"
    >
      <Button variant="ghost" onPress={props.onClose} testID="scan-screen-close">
        Close
      </Button>
    </XStack>
  );
}
