// Permission flow tests.
//
// The mock for `react-native-vision-camera` in
// `src/test-utils/setup.ts` exposes `setMockCameraPermission` so
// each test can drive the static permission status through the
// four branches the hook exposes. The mock for `react-native`
// exposes `triggerAppStateChange` so we can simulate the
// "user opened Settings, flipped the switch, came back" path.

import { act, renderHook, waitFor } from '@testing-library/react';
import { Linking } from 'react-native';
import { Camera } from 'react-native-vision-camera';
import { describe, expect, it, vi } from 'vitest';

import { useCameraPermissionFlow } from './permissions.js';
import {
  setMockCameraPermission,
  triggerAppStateChange,
} from '../../test-utils/setup.js';

describe('useCameraPermissionFlow', () => {
  it('starts with `not-determined` on a fresh install', () => {
    setMockCameraPermission('not-determined');
    const { result } = renderHook(() => useCameraPermissionFlow());
    expect(result.current.status).toBe('not-determined');
    expect(result.current.hasPermission).toBe(false);
  });

  it('reflects a pre-granted status without re-prompting', () => {
    setMockCameraPermission('granted');
    const { result } = renderHook(() => useCameraPermissionFlow());
    expect(result.current.status).toBe('granted');
    expect(result.current.hasPermission).toBe(true);
  });

  it('flips to `granted` when the user accepts the OS dialog', async () => {
    setMockCameraPermission('not-determined', 'granted');
    const { result } = renderHook(() => useCameraPermissionFlow());

    expect(result.current.status).toBe('not-determined');

    await act(async () => {
      await result.current.requestPermission();
    });

    expect(result.current.status).toBe('granted');
    expect(result.current.hasPermission).toBe(true);
  });

  it('flips to `denied` when the user declines the OS dialog', async () => {
    setMockCameraPermission('not-determined', 'denied');
    const { result } = renderHook(() => useCameraPermissionFlow());

    await act(async () => {
      await result.current.requestPermission();
    });

    expect(result.current.status).toBe('denied');
    expect(result.current.hasPermission).toBe(false);
  });

  it('exposes the `restricted` branch verbatim', () => {
    setMockCameraPermission('restricted');
    const { result } = renderHook(() => useCameraPermissionFlow());
    expect(result.current.status).toBe('restricted');
    expect(result.current.hasPermission).toBe(false);
  });

  it('re-reads the permission when the app returns to the foreground', async () => {
    setMockCameraPermission('denied');
    const { result } = renderHook(() => useCameraPermissionFlow());
    expect(result.current.status).toBe('denied');

    setMockCameraPermission('granted');
    await act(async () => {
      await triggerAppStateChange('active');
    });

    await waitFor(() => {
      expect(result.current.status).toBe('granted');
    });
  });

  it('ignores AppState background transitions (no spurious re-reads)', async () => {
    setMockCameraPermission('granted');
    const { result } = renderHook(() => useCameraPermissionFlow());
    const calls = vi.mocked(Camera.getCameraPermissionStatus).mock.calls.length;

    await act(async () => {
      await triggerAppStateChange('background');
    });

    expect(vi.mocked(Camera.getCameraPermissionStatus).mock.calls.length).toBe(calls);
    expect(result.current.status).toBe('granted');
  });

  it('opens the system Settings deep link via `Linking.openSettings`', async () => {
    setMockCameraPermission('denied');
    const { result } = renderHook(() => useCameraPermissionFlow());

    await act(async () => {
      await result.current.openSettings();
    });

    expect(Linking.openSettings).toHaveBeenCalled();
  });
});
