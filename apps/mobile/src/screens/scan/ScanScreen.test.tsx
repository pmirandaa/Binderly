import { act, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ScanScreen } from './ScanScreen.js';
import { renderWithProvider } from '../../test-utils/render.js';
import { setMockCameraPermission } from '../../test-utils/setup.js';

// Stable router mock so the close-button test can observe
// `router.back()`. We re-implement the expo-router surface inline
// (mirroring `src/test-utils/setup.ts`) rather than `importActual`
// because the real expo-router module is TSX and vitest doesn't
// transform it under jsdom.
const { routerMocks } = vi.hoisted(() => ({
  routerMocks: {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    canGoBack: vi.fn(() => true),
  },
}));

vi.mock('expo-router', () => {
  const Slot = ({ children }: { children?: React.ReactNode }) => children ?? null;
  const Stack = Object.assign(
    ({ children }: { children?: React.ReactNode }) => children ?? null,
    { Screen: ({ children }: { children?: React.ReactNode }) => children ?? null },
  );
  const Tabs = Object.assign(
    ({ children }: { children?: React.ReactNode }) => children ?? null,
    { Screen: ({ children }: { children?: React.ReactNode }) => children ?? null },
  );
  const useFocusEffect = vi.fn((callback: () => void | (() => void)) => {
    React.useEffect(() => {
      const cleanup = callback();
      return cleanup ?? undefined;
    }, [callback]);
  });
  return {
    Slot,
    Stack,
    Tabs,
    Link: ({ children }: { children?: React.ReactNode }) => children ?? null,
    Redirect: () => null,
    useFocusEffect,
    router: routerMocks,
    useRouter: () => routerMocks,
    useLocalSearchParams: () => ({}),
    useSegments: () => [],
    usePathname: () => '/',
  };
});

beforeEach(() => {
  routerMocks.push.mockClear();
  routerMocks.replace.mockClear();
  routerMocks.back.mockClear();
  routerMocks.canGoBack.mockClear();
  routerMocks.canGoBack.mockReturnValue(true);
});

describe('<ScanScreen>', () => {
  it('shows the pre-prompt when permission is `not-determined`', () => {
    setMockCameraPermission('not-determined');
    const view = renderWithProvider(<ScanScreen />);

    expect(view.queryByTestId('camera-permission-prompt')).not.toBeNull();
    expect(view.queryByTestId('scan-camera-preview')).toBeNull();
  });

  it('shows the camera preview once permission is granted', () => {
    setMockCameraPermission('granted');
    const view = renderWithProvider(<ScanScreen />);

    expect(view.queryByTestId('camera-permission-prompt')).toBeNull();
    expect(view.queryByTestId('scan-camera-preview')).not.toBeNull();
  });

  it('shows the denied-branch copy when permission is denied', () => {
    setMockCameraPermission('denied');
    const view = renderWithProvider(<ScanScreen />);

    expect(view.queryByTestId('camera-permission-prompt')).not.toBeNull();
    expect(view.container.textContent).toContain('Camera access is turned off');
  });

  it('renders a Close button that calls router.back() when history exists', () => {
    setMockCameraPermission('granted');
    const view = renderWithProvider(<ScanScreen />);

    const close = view.getByTestId('scan-screen-close');
    fireEvent.click(close);

    expect(routerMocks.back).toHaveBeenCalledTimes(1);
    expect(routerMocks.replace).not.toHaveBeenCalled();
  });

  it('falls back to router.replace("/") when there is no history', () => {
    routerMocks.canGoBack.mockReturnValue(false);
    setMockCameraPermission('granted');
    const view = renderWithProvider(<ScanScreen />);

    fireEvent.click(view.getByTestId('scan-screen-close'));

    expect(routerMocks.back).not.toHaveBeenCalled();
    expect(routerMocks.replace).toHaveBeenCalledWith('/');
  });

  it('transitions from the pre-prompt to the camera after the user grants access', async () => {
    setMockCameraPermission('not-determined', 'granted');
    const view = renderWithProvider(<ScanScreen />);

    expect(view.queryByTestId('camera-permission-prompt')).not.toBeNull();

    await act(async () => {
      fireEvent.click(view.getByTestId('camera-permission-primary'));
    });

    await waitFor(() => {
      expect(view.queryByTestId('scan-camera-preview')).not.toBeNull();
    });
    expect(view.queryByTestId('camera-permission-prompt')).toBeNull();
  });
});
