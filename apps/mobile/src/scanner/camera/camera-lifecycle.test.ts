import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useCameraActive } from './camera-lifecycle.js';
import {
  blurNavigationFocus,
  refocusNavigation,
  triggerAppStateChange,
} from '../../test-utils/setup.js';

describe('useCameraActive', () => {
  it('returns true on mount when focused and the app is active', () => {
    const { result } = renderHook(() => useCameraActive());
    expect(result.current).toBe(true);
  });

  it('flips to false on navigation blur (camera releases on screen blur)', async () => {
    const { result } = renderHook(() => useCameraActive());
    expect(result.current).toBe(true);

    await act(async () => {
      await blurNavigationFocus();
    });

    expect(result.current).toBe(false);
  });

  it('flips back to true when the screen is re-focused', async () => {
    const { result } = renderHook(() => useCameraActive());

    await act(async () => {
      await blurNavigationFocus();
    });
    expect(result.current).toBe(false);

    await act(async () => {
      await refocusNavigation();
    });
    expect(result.current).toBe(true);
  });

  it('returns false when the app moves to the background', async () => {
    const { result } = renderHook(() => useCameraActive());
    expect(result.current).toBe(true);

    await act(async () => {
      await triggerAppStateChange('background');
    });

    expect(result.current).toBe(false);
  });

  it('returns false when the app is inactive (incoming call / control center)', async () => {
    const { result } = renderHook(() => useCameraActive());
    await act(async () => {
      await triggerAppStateChange('inactive');
    });
    expect(result.current).toBe(false);
  });

  it('returns to true when the app comes back to the foreground', async () => {
    const { result } = renderHook(() => useCameraActive());

    await act(async () => {
      await triggerAppStateChange('background');
    });
    expect(result.current).toBe(false);

    await act(async () => {
      await triggerAppStateChange('active');
    });
    expect(result.current).toBe(true);
  });

  it('respects `disabled: true` regardless of focus / AppState', async () => {
    const { result } = renderHook(() => useCameraActive({ disabled: true }));
    expect(result.current).toBe(false);

    await act(async () => {
      await triggerAppStateChange('active');
    });
    expect(result.current).toBe(false);
  });

  it('stays inactive when the screen is blurred AND the app is backgrounded', async () => {
    const { result } = renderHook(() => useCameraActive());

    await act(async () => {
      await blurNavigationFocus();
      await triggerAppStateChange('background');
    });

    expect(result.current).toBe(false);

    // Only one of the two transitions un-blocks the camera; both
    // must be true again for the camera to come back.
    await act(async () => {
      await triggerAppStateChange('active');
    });
    expect(result.current).toBe(false);

    await act(async () => {
      await refocusNavigation();
    });
    expect(result.current).toBe(true);
  });
});
