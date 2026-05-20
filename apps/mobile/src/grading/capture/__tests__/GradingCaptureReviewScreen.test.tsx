// Review-screen tests — confirms the placeholder review surface
// reads the emitted session correctly and exposes navigation hooks.

import { fireEvent } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProvider } from '../../../test-utils/render.js';
import { CAPTURE_KINDS } from '../constants.js';
import { GradingCaptureReviewScreen } from '../screens/GradingCaptureReviewScreen.js';
import {
  __setLastEmittedSession,
  GradingCaptureScreen,
} from '../screens/GradingCaptureScreen.js';

import type {
  CaptureQualityResult,
  GradingCaptureSession,
  GradingShot,
  GradingShotKind,
} from '../types.js';

void GradingCaptureScreen; // imported to keep the placeholder ref alive.

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
  return {
    Slot,
    Stack: Object.assign(({ children }: { children?: React.ReactNode }) => children ?? null, {
      Screen: ({ children }: { children?: React.ReactNode }) => children ?? null,
    }),
    Tabs: Object.assign(({ children }: { children?: React.ReactNode }) => children ?? null, {
      Screen: ({ children }: { children?: React.ReactNode }) => children ?? null,
    }),
    Link: ({ children }: { children?: React.ReactNode }) => children ?? null,
    Redirect: () => null,
    useFocusEffect: vi.fn((cb: () => void | (() => void)) => {
      React.useEffect(() => {
        const c = cb();
        return c ?? undefined;
      }, [cb]);
    }),
    router: routerMocks,
    useRouter: () => routerMocks,
    useLocalSearchParams: () => ({}),
    useSegments: () => [],
    usePathname: () => '/',
  };
});

const okQuality: CaptureQualityResult = {
  metrics: { sharpness: 14.2, brightness: 0.52, coverage: 0.6 },
  sharpnessOK: true,
  brightnessOK: true,
  coverageOK: true,
  accepted: true,
  reason: 'great',
};

function makeShot(kind: GradingShotKind): GradingShot {
  return {
    kind,
    uri: `file:///${kind}.jpg`,
    width: 1080,
    height: 1440,
    quality: okQuality,
    capturedAt: 1700000000000,
  };
}

function makeSession(): GradingCaptureSession {
  return {
    frontFull: makeShot('frontFull'),
    backFull: makeShot('backFull'),
    frontCorner: makeShot('frontCorner'),
    backCorner: makeShot('backCorner'),
    id: 'session-abc',
    startedAt: 1700000000000,
    completedAt: 1700000010000,
  };
}

beforeEach(() => {
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

describe('<GradingCaptureReviewScreen>', () => {
  it('renders the empty branch when no session has been emitted', () => {
    const view = renderWithProvider(<GradingCaptureReviewScreen />);
    expect(view.queryByTestId('grading-capture-review-empty')).not.toBeNull();
    expect(view.container.textContent).toContain('No capture session');
  });

  it('renders one row per shot when a session is present', () => {
    __setLastEmittedSession(makeSession());
    const view = renderWithProvider(<GradingCaptureReviewScreen />);
    expect(view.queryByTestId('grading-capture-review')).not.toBeNull();
    for (const kind of CAPTURE_KINDS) {
      expect(view.queryByTestId(`grading-capture-review-shot-${kind}`)).not.toBeNull();
    }
  });

  it('honours the explicit session prop over the placeholder ref', () => {
    const override = makeSession();
    const view = renderWithProvider(
      <GradingCaptureReviewScreen session={override} />,
    );
    expect(view.getByTestId('grading-capture-review').getAttribute('data-session-id')).toBe(
      'session-abc',
    );
  });

  it('renders metrics for each shot row', () => {
    __setLastEmittedSession(makeSession());
    const view = renderWithProvider(<GradingCaptureReviewScreen />);
    expect(view.container.textContent).toContain('1080×1440px');
    expect(view.container.textContent).toContain('sharpness 14.2');
  });

  it('Back routes back when canGoBack', () => {
    __setLastEmittedSession(makeSession());
    const view = renderWithProvider(<GradingCaptureReviewScreen />);
    fireEvent.click(view.getByTestId('grading-capture-review-back'));
    expect(routerMocks.back).toHaveBeenCalledTimes(1);
  });

  it('Continue pushes the centering route', () => {
    __setLastEmittedSession(makeSession());
    const view = renderWithProvider(<GradingCaptureReviewScreen />);
    fireEvent.click(view.getByTestId('grading-capture-review-continue'));
    expect(routerMocks.push).toHaveBeenCalledWith('/grading/centering');
  });
});
