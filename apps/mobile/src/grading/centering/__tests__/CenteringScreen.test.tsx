// `<CenteringScreen>` rendering tests.

import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CenteringScreen } from '../screens/CenteringScreen.js';
import { __resetSessionStore, storeSession } from '../session-store.js';

import type { GradingCaptureSession } from '../../capture/types.js';
import type { CenteringResult, CenteringService } from '../types.js';

const okQuality = {
  metrics: { sharpness: 12, brightness: 0.5, coverage: 0.6 },
  sharpnessOK: true,
  brightnessOK: true,
  coverageOK: true,
  accepted: true,
  reason: 'great' as const,
};

function makeShot(kind: GradingCaptureSession['frontFull']['kind']) {
  return {
    kind,
    uri: `file:///tmp/${kind}.jpg`,
    width: 1080,
    height: 1440,
    quality: okQuality,
    capturedAt: 1_700_000_000_000,
  };
}

function makeSession(id = 'gcs-screen-1'): GradingCaptureSession {
  return {
    id,
    startedAt: 1_700_000_000_000,
    completedAt: 1_700_000_001_000,
    frontFull: makeShot('frontFull'),
    backFull: makeShot('backFull'),
    frontCorner: makeShot('frontCorner'),
    backCorner: makeShot('backCorner'),
  };
}

const notImplementedService: CenteringService = {
  measure: vi.fn().mockResolvedValue({
    reason: 'not_implemented',
    message: 'not implemented',
  }),
};

const successResult: CenteringResult = {
  sessionId: 'gcs-screen-1',
  margins: { top: 50, bottom: 50, left: 50, right: 50 },
  hRatio: 1.0,
  vRatio: 1.0,
  gradeHint: '10',
  lowConfidence: false,
  lowConfidenceHolographic: false,
  flags: [],
};

const successService: CenteringService = {
  measure: vi.fn().mockResolvedValue(successResult),
};

afterEach((): void => {
  __resetSessionStore();
  vi.clearAllMocks();
});

describe('CenteringScreen — loading state', () => {
  it('renders the loading screen initially', async () => {
    const session = makeSession('gcs-screen-1');
    storeSession(session);

    let resolveMeasure!: (v: CenteringResult) => void;
    const slowService: CenteringService = {
      measure: vi.fn().mockReturnValue(
        new Promise<CenteringResult>((r) => { resolveMeasure = r; })
      ),
    };

    render(
      <CenteringScreen
        sessionIdOverride="gcs-screen-1"
        service={slowService}
        testID="centering-screen-loading"
      />
    );

    await waitFor(() =>
      screen.getByTestId('centering-screen-loading')
    );
    expect(screen.getByTestId('centering-screen-loading')).toBeTruthy();

    // Clean up pending promise.
    resolveMeasure(successResult);
  });
});

describe('CenteringScreen — error: not_implemented', () => {
  it('renders the not-implemented error state', async () => {
    const session = makeSession('gcs-screen-1');
    storeSession(session);

    render(
      <CenteringScreen
        sessionIdOverride="gcs-screen-1"
        service={notImplementedService}
      />
    );

    await waitFor(() =>
      screen.getByTestId('centering-screen-error')
    );
    expect(screen.getByTestId('centering-screen-error')).toBeTruthy();
    expect(screen.getByTestId('centering-screen-not-implemented-note')).toBeTruthy();
  });

  it('renders "Centering coming soon" heading for not_implemented', async () => {
    const session = makeSession('gcs-screen-1');
    storeSession(session);

    render(
      <CenteringScreen
        sessionIdOverride="gcs-screen-1"
        service={notImplementedService}
      />
    );

    await waitFor(() => screen.getByText('Centering coming soon'));
    expect(screen.getByText('Centering coming soon')).toBeTruthy();
  });
});

describe('CenteringScreen — error: session_not_found', () => {
  it('renders error when sessionId is missing', async () => {
    render(
      <CenteringScreen
        sessionIdOverride={undefined}
        service={notImplementedService}
      />
    );
    await waitFor(() => screen.getByTestId('centering-screen-error'));
    expect(screen.getByTestId('centering-screen-error')).toBeTruthy();
  });

  it('renders error when session is not in store', async () => {
    render(
      <CenteringScreen
        sessionIdOverride="gcs-unknown"
        service={notImplementedService}
      />
    );
    await waitFor(() => screen.getByTestId('centering-screen-error'));
  });
});

describe('CenteringScreen — success state', () => {
  it('renders the result screen on success', async () => {
    const session = makeSession('gcs-screen-1');
    storeSession(session);

    render(
      <CenteringScreen
        sessionIdOverride="gcs-screen-1"
        service={successService}
        testID="centering-screen-result"
      />
    );

    await waitFor(() => screen.getByTestId('centering-screen-result'));
    expect(screen.getByTestId('centering-screen-result')).toBeTruthy();
  });

  it('shows the grade hint', async () => {
    const session = makeSession('gcs-screen-1');
    storeSession(session);

    render(
      <CenteringScreen
        sessionIdOverride="gcs-screen-1"
        service={successService}
      />
    );

    await waitFor(() => screen.getByText('Grade hint: PSA 10'));
    expect(screen.getByText('Grade hint: PSA 10')).toBeTruthy();
  });

  it('does not show low-confidence note for a confident result', async () => {
    const session = makeSession('gcs-screen-1');
    storeSession(session);

    render(
      <CenteringScreen
        sessionIdOverride="gcs-screen-1"
        service={successService}
      />
    );

    await waitFor(() => screen.getByTestId('centering-screen-result'));
    expect(screen.queryByTestId('centering-low-confidence-note')).toBeNull();
  });
});
