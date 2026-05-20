// Camera permission flow.
//
// vision-camera's stock `useCameraPermission()` collapses the four-
// state native permission model into a boolean (`hasPermission`).
// That's not enough for the pre-prompt UX `rules/06-scanner.md`
// asks for — we need to distinguish:
//
//   - `not-determined` — first launch; show the "Allow camera"
//     pre-prompt with a friendly *why* explanation before the OS
//     dialog fires.
//   - `denied` — user previously declined; explain how to flip the
//     toggle in Settings.
//   - `restricted` — parental controls / MDM; show a friendly
//     non-actionable explanation.
//   - `granted` — straight to the camera.
//
// This module wraps `Camera.getCameraPermissionStatus()` /
// `Camera.requestCameraPermission()` directly so we keep the full
// four-state surface. AppState change refreshes the status so a user
// who toggles Settings and returns to the app picks up the new value
// without us polling.

import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking } from 'react-native';
import { Camera } from 'react-native-vision-camera';

import type {
  CameraPermissionRequestResult,
  CameraPermissionStatus,
} from 'react-native-vision-camera';

export type CameraPermissionFlowStatus = CameraPermissionStatus;

export interface CameraPermissionFlow {
  /** Current native permission status, refreshed on AppState transitions. */
  readonly status: CameraPermissionFlowStatus;
  /** Convenience flag — `status === 'granted'`. */
  readonly hasPermission: boolean;
  /**
   * Trigger the native permission dialog. On Android and iOS the
   * dialog fires once; subsequent calls resolve immediately with
   * the cached decision. Updates {@link status} synchronously after
   * the OS responds.
   */
  requestPermission(): Promise<CameraPermissionRequestResult>;
  /**
   * Deep-link the user to the system Settings app for the
   * Binderly bundle. Used from the "denied" branch — we can't
   * re-prompt programmatically after the OS has cached a denial.
   */
  openSettings(): Promise<void>;
}

/**
 * Camera permission flow hook.
 *
 * Safe to call from any component — there's no global state behind
 * it, just a wrapper around vision-camera's static APIs plus an
 * AppState listener.
 */
export function useCameraPermissionFlow(): CameraPermissionFlow {
  const [status, setStatus] = useState<CameraPermissionFlowStatus>(() =>
    Camera.getCameraPermissionStatus(),
  );

  // Re-read the permission whenever the app comes back to the
  // foreground. Users who hit "Open Settings" from the denied
  // branch and toggle the camera switch land back in Binderly with
  // the new value; without this we'd render the denied UI for one
  // extra render until the next manual refresh.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        setStatus(Camera.getCameraPermissionStatus());
      }
    });
    return (): void => {
      subscription.remove();
    };
  }, []);

  const requestPermission = useCallback(async (): Promise<CameraPermissionRequestResult> => {
    const result = await Camera.requestCameraPermission();
    setStatus(Camera.getCameraPermissionStatus());
    return result;
  }, []);

  const openSettings = useCallback(async (): Promise<void> => {
    await Linking.openSettings();
  }, []);

  return {
    status,
    hasPermission: status === 'granted',
    requestPermission,
    openSettings,
  };
}
