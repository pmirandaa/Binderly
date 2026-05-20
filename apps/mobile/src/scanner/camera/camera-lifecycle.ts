// Camera lifecycle — release on blur and background.
//
// `rules/06-scanner.md` hard rule: the camera must release on
// screen blur. The vision-camera Camera component reads `isActive`
// — when false, the native module tears the capture session down,
// drops the preview, and stops the frame-processor JSI bridge. This
// hook computes that boolean from two sources:
//
//   1. **Navigation focus** — tracked via expo-router's
//      `useFocusEffect`. The screen marks itself focused when the
//      focus callback runs and blurred when its cleanup returns.
//      `useFocusEffect` is the only focus-related hook expo-router
//      re-exports; we avoid taking a direct dependency on
//      `@react-navigation/native` (which would expand the mock
//      surface in tests with no benefit).
//   2. **AppState** — when the OS backgrounds the app entirely
//      (home button, lock screen) the camera must also release so
//      iOS doesn't show the orange privacy indicator unnecessarily
//      and so Android's CameraX session doesn't hold the sensor
//      open behind a switch.

import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import type { AppStateStatus } from 'react-native';

export interface UseCameraActiveOptions {
  /**
   * Force-disable the camera regardless of focus / AppState.
   * Useful from the permission-prompt branch where we know the
   * camera shouldn't be active even though the screen is focused.
   */
  readonly disabled?: boolean;
}

/**
 * Returns whether the camera should be active right now.
 *
 * Wire as `<Camera isActive={useCameraActive()} ... />`.
 */
export function useCameraActive(options: UseCameraActiveOptions = {}): boolean {
  const [isFocused, setIsFocused] = useState(false);
  const [appState, setAppState] = useState<AppStateStatus>(() => AppState.currentState);

  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      return (): void => {
        setIsFocused(false);
      };
    }, []),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      setAppState(next);
    });
    return (): void => {
      subscription.remove();
    };
  }, []);

  if (options.disabled === true) return false;
  return isFocused && appState === 'active';
}
