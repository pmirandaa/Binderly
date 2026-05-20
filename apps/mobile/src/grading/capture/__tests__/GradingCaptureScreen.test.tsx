// Screen-level tests for `<GradingCaptureScreen>`.
//
// The shared `src/test-utils/setup.ts` provides the vision-camera +
// expo-router mocks. We override the router mock per test file so
// the navigation assertions observe a stable `router.push` mock.

import { act, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProvider } from '../../../test-utils/render.js';
import { setMockCameraPermission } from '../../../test-utils/setup.js';
import { CAPTURE_KINDS } from '../constants.js';
import {
  __getLastEmittedSession,
  __setLastEmittedSession,
  GradingCaptureScreen,
} from '../screens/GradingCaptureScreen.js';

import type { GradingShotKind } from '../types.js';
import type { CaptureAttemptInput } from '../use-capture-session.js';

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
  return {
    Slot,
    Stack,
    Tabs,
    Link: ({ children }: { children?: React.ReactNode }) => children ?? null,
    Redirect: () => null,
    useFocusEffect: vi.fn((callback: () => void | (() => void)) => {
      React.useEffect(() => {
        const cleanup = callback();
        return cleanup ?? undefined;
      }, [callback]);
    }),
    router: routerMocks,
    useRouter: () => routerMocks,
    useLocalSearchParams: () => ({}),
    useSegments: () => [],
    usePathname: () => '/',
  };
});

function makeAcceptedAttempt(kind: GradingShotKind, index: number): CaptureAttemptInput {
  return {
    outcome: 'accepted',
    uri: `file:///shot-${kind}-${index}.jpg`,
    width: 1920,
    height: 2560,
    quality: {
      metrics: { sharpness: 20, brightness: 0.5, coverage: 0.6 },
      sharpnessOK: true,
      brightnessOK: true,
      coverageOK: true,
      accepted: true,
      reason: 'great',
    },
  };
}

function makeRejectedAttempt(reason: 'too_dark' | 'blurry' | 'off_center'): CaptureAttemptInput {
  return {
    outcome: 'rejected',
    quality: {
      metrics: { sharpness: 1, brightness: 0.05, coverage: 0 },
      sharpnessOK: false,
      brightnessOK: false,
      coverageOK: false,
      accepted: false,
      reason,
    },
  };
}

beforeEach(() => {
  setMockCameraPermission('granted');
  routerMocks.push.mockClear();
  routerMocks.replace.mockClear();
  routerMocks.back.mockClear();
  routerMocks.canGoBack.mockClear();
  routerMocks.canGoBack.mockReturnValue(true);
  __setLastEmittedSession(null);
});

afterEach(() => {
  __setLastEmittedSession(null);
});

describe('<GradingCaptureScreen> — permission branches', () => {
  it('renders the shared CameraPermissionPrompt when not-determined', () => {
    setMockCameraPermission('not-determined');
    const view = renderWithProvider(<GradingCaptureScreen />);
    expect(view.queryByTestId('camera-permission-prompt')).not.toBeNull();
    expect(view.queryByTestId('grading-camera-preview')).toBeNull();
  });

  it('renders the shared CameraPermissionPrompt when denied', () => {
    setMockCameraPermission('denied');
    const view = renderWithProvider(<GradingCaptureScreen />);
    expect(view.queryByTestId('camera-permission-prompt')).not.toBeNull();
    expect(view.container.textContent).toContain('Camera access is turned off');
  });

  it('renders the camera preview once permission is granted', () => {
    setMockCameraPermission('granted');
    const view = renderWithProvider(<GradingCaptureScreen />);
    expect(view.queryByTestId('camera-permission-prompt')).toBeNull();
    expect(view.queryByTestId('grading-camera-preview')).not.toBeNull();
  });
});

describe('<GradingCaptureScreen> — close button', () => {
  it('routes back when canGoBack is true', () => {
    const view = renderWithProvider(<GradingCaptureScreen />);
    fireEvent.click(view.getByTestId('capture-cancel'));
    expect(routerMocks.back).toHaveBeenCalledTimes(1);
    expect(routerMocks.replace).not.toHaveBeenCalled();
  });

  it('falls back to router.replace("/") when there is no history', () => {
    routerMocks.canGoBack.mockReturnValue(false);
    const view = renderWithProvider(<GradingCaptureScreen />);
    fireEvent.click(view.getByTestId('capture-cancel'));
    expect(routerMocks.back).not.toHaveBeenCalled();
    expect(routerMocks.replace).toHaveBeenCalledWith('/');
  });
});

describe('<GradingCaptureScreen> — capture flow', () => {
  it('renders the step indicator with all 4 dots', () => {
    const view = renderWithProvider(<GradingCaptureScreen />);
    for (const kind of CAPTURE_KINDS) {
      expect(view.queryByTestId(`capture-step-dot-${kind}`)).not.toBeNull();
    }
  });

  it('shows the active step heading + instruction for frontFull at start', () => {
    const view = renderWithProvider(<GradingCaptureScreen />);
    expect(view.container.textContent).toContain('Front of card');
  });

  it('keeps the user on step 1 + shows feedback when a capture is rejected', async () => {
    const attempt = vi.fn(async () => makeRejectedAttempt('too_dark'));
    const view = renderWithProvider(
      <GradingCaptureScreen attemptCapture={attempt} />,
    );
    await act(async () => {
      fireEvent.click(view.getByTestId('capture-take'));
    });
    await waitFor(() => {
      expect(view.queryByTestId('capture-feedback-banner')).not.toBeNull();
    });
    const banner = view.getByTestId('capture-feedback-banner');
    expect(banner.getAttribute('data-reason')).toBe('too_dark');
    expect(view.container.textContent).toContain('Too dark');
    // Still on step 1 — step indicator shows "Step 1 of 4".
    expect(view.container.textContent).toContain('Step 1 of 4');
    // Review modal is NOT visible.
    expect(view.queryByTestId('capture-review-modal')).toBeNull();
  });

  it('surfaces the review modal on an accepted capture and stays on the current step until accepted', async () => {
    const attempt = vi.fn(async () => makeAcceptedAttempt('frontFull', 1));
    const view = renderWithProvider(
      <GradingCaptureScreen attemptCapture={attempt} />,
    );
    await act(async () => {
      fireEvent.click(view.getByTestId('capture-take'));
    });
    await waitFor(() => {
      expect(view.queryByTestId('capture-review-modal')).not.toBeNull();
    });
    // Still on step 1 until the user accepts the pending shot.
    expect(view.container.textContent).toContain('Step 1 of 4');
  });

  it('advances to step 2 once the pending shot is accepted', async () => {
    const attempt = vi.fn(async () => makeAcceptedAttempt('frontFull', 1));
    const view = renderWithProvider(
      <GradingCaptureScreen attemptCapture={attempt} />,
    );
    await act(async () => {
      fireEvent.click(view.getByTestId('capture-take'));
    });
    await waitFor(() => {
      expect(view.queryByTestId('capture-review-modal')).not.toBeNull();
    });
    act(() => {
      fireEvent.click(view.getByTestId('capture-review-accept'));
    });
    await waitFor(() => {
      expect(view.container.textContent).toContain('Step 2 of 4');
    });
    expect(view.queryByTestId('capture-review-modal')).toBeNull();
  });

  it('drops the pending shot + stays on step 1 when retake is tapped', async () => {
    const attempt = vi.fn(async () => makeAcceptedAttempt('frontFull', 1));
    const view = renderWithProvider(
      <GradingCaptureScreen attemptCapture={attempt} />,
    );
    await act(async () => {
      fireEvent.click(view.getByTestId('capture-take'));
    });
    await waitFor(() => {
      expect(view.queryByTestId('capture-review-modal')).not.toBeNull();
    });
    act(() => {
      fireEvent.click(view.getByTestId('capture-review-retake'));
    });
    expect(view.queryByTestId('capture-review-modal')).toBeNull();
    expect(view.container.textContent).toContain('Step 1 of 4');
  });

  it('emits a complete session + navigates to the review route on the 4th accept', async () => {
    const sequence: CaptureAttemptInput[] = CAPTURE_KINDS.map((kind, idx) =>
      makeAcceptedAttempt(kind, idx + 1),
    );
    let call = 0;
    const attempt = vi.fn(
      async (): Promise<CaptureAttemptInput> =>
        sequence[call++] ?? sequence[sequence.length - 1]!,
    );
    const view = renderWithProvider(
      <GradingCaptureScreen attemptCapture={attempt} />,
    );
    for (let i = 0; i < CAPTURE_KINDS.length; i += 1) {
      await act(async () => {
        fireEvent.click(view.getByTestId('capture-take'));
      });
      await waitFor(() => {
        expect(view.queryByTestId('capture-review-modal')).not.toBeNull();
      });
      act(() => {
        fireEvent.click(view.getByTestId('capture-review-accept'));
      });
    }
    await waitFor(() => {
      expect(routerMocks.push).toHaveBeenCalledTimes(1);
    });
    const emitted = __getLastEmittedSession();
    expect(emitted).not.toBeNull();
    if (emitted === null) return;
    expect(routerMocks.push).toHaveBeenCalledWith(
      `/grading/centering?sessionId=${encodeURIComponent(emitted.id)}`,
    );
    expect(emitted.frontFull.uri).toBe('file:///shot-frontFull-1.jpg');
    expect(emitted.backFull.uri).toBe('file:///shot-backFull-2.jpg');
    expect(emitted.frontCorner.uri).toBe('file:///shot-frontCorner-3.jpg');
    expect(emitted.backCorner.uri).toBe('file:///shot-backCorner-4.jpg');
  });

  it('shows the "Start over" button after the first accepted shot', async () => {
    const attempt = vi.fn(async () => makeAcceptedAttempt('frontFull', 1));
    const view = renderWithProvider(
      <GradingCaptureScreen attemptCapture={attempt} />,
    );
    expect(view.queryByTestId('capture-reset')).toBeNull();
    await act(async () => {
      fireEvent.click(view.getByTestId('capture-take'));
    });
    act(() => {
      fireEvent.click(view.getByTestId('capture-review-accept'));
    });
    await waitFor(() => {
      expect(view.queryByTestId('capture-reset')).not.toBeNull();
    });
  });

  it('Start over resets the session back to step 1', async () => {
    const attempt = vi.fn(async () => makeAcceptedAttempt('frontFull', 1));
    const view = renderWithProvider(
      <GradingCaptureScreen attemptCapture={attempt} />,
    );
    await act(async () => {
      fireEvent.click(view.getByTestId('capture-take'));
    });
    act(() => {
      fireEvent.click(view.getByTestId('capture-review-accept'));
    });
    await waitFor(() => {
      expect(view.container.textContent).toContain('Step 2 of 4');
    });
    act(() => {
      fireEvent.click(view.getByTestId('capture-reset'));
    });
    await waitFor(() => {
      expect(view.container.textContent).toContain('Step 1 of 4');
    });
  });

  it('does not navigate when fewer than four shots are accepted', async () => {
    const sequence: CaptureAttemptInput[] = CAPTURE_KINDS.map((kind, idx) =>
      makeAcceptedAttempt(kind, idx + 1),
    );
    let call = 0;
    const attempt = vi.fn(
      async (): Promise<CaptureAttemptInput> =>
        sequence[call++] ?? sequence[0]!,
    );
    const view = renderWithProvider(
      <GradingCaptureScreen attemptCapture={attempt} />,
    );
    for (let i = 0; i < 3; i += 1) {
      await act(async () => {
        fireEvent.click(view.getByTestId('capture-take'));
      });
      act(() => {
        fireEvent.click(view.getByTestId('capture-review-accept'));
      });
    }
    expect(routerMocks.push).not.toHaveBeenCalled();
  });

  it('renders a no-device fallback when useCameraDevice returns null', async () => {
    const { setMockCameraDevice } = await import('../../../test-utils/setup.js');
    setMockCameraDevice(null);
    const view = renderWithProvider(<GradingCaptureScreen />);
    expect(view.queryByTestId('grading-camera-no-device')).not.toBeNull();
    setMockCameraDevice({ id: 'back-camera-mock', position: 'back' });
  });
});

describe('<GradingCaptureScreen> — re-entry preserves progress within the mount', () => {
  it('keeps state across re-renders triggered by parent updates', async () => {
    const attempt = vi.fn(async () => makeAcceptedAttempt('frontFull', 1));
    const view = renderWithProvider(
      <GradingCaptureScreen attemptCapture={attempt} />,
    );
    await act(async () => {
      fireEvent.click(view.getByTestId('capture-take'));
    });
    act(() => {
      fireEvent.click(view.getByTestId('capture-review-accept'));
    });
    await waitFor(() => {
      expect(view.container.textContent).toContain('Step 2 of 4');
    });
    // Re-render with the same attempt mock — state must persist.
    view.rerender(<GradingCaptureScreen attemptCapture={attempt} />);
    expect(view.container.textContent).toContain('Step 2 of 4');
  });

  it('drops state when the screen is unmounted + re-mounted', async () => {
    const attempt = vi.fn(async () => makeAcceptedAttempt('frontFull', 1));
    const view = renderWithProvider(
      <GradingCaptureScreen attemptCapture={attempt} />,
    );
    await act(async () => {
      fireEvent.click(view.getByTestId('capture-take'));
    });
    act(() => {
      fireEvent.click(view.getByTestId('capture-review-accept'));
    });
    await waitFor(() => {
      expect(view.container.textContent).toContain('Step 2 of 4');
    });
    view.unmount();
    const fresh = renderWithProvider(<GradingCaptureScreen attemptCapture={attempt} />);
    expect(fresh.container.textContent).toContain('Step 1 of 4');
  });
});
