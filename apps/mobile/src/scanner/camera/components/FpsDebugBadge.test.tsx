import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FpsDebugBadge } from './FpsDebugBadge.js';
import { renderWithProvider } from '../../../test-utils/render.js';
import { FPS_BADGE_UPDATE_INTERVAL_MS } from '../constants.js';
import { createFrameTelemetrySink } from '../frame-telemetry.js';

import type { FrameTelemetryEvent } from '../types.js';

function event(ts: number): FrameTelemetryEvent {
  return { ts, width: 1920, height: 1080, bytesPerRow: 1920 * 4 };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('<FpsDebugBadge>', () => {
  it('renders nothing when `visible` is false', () => {
    const sink = createFrameTelemetrySink();
    const view = renderWithProvider(<FpsDebugBadge sink={sink} />);
    expect(view.queryByTestId('fps-debug-badge')).toBeNull();
  });

  it('renders the badge when `visible` is true', () => {
    const sink = createFrameTelemetrySink();
    const view = renderWithProvider(<FpsDebugBadge sink={sink} visible />);
    expect(view.queryByTestId('fps-debug-badge')).not.toBeNull();
  });

  it('shows a placeholder when not enough samples have arrived', () => {
    const sink = createFrameTelemetrySink();
    const view = renderWithProvider(<FpsDebugBadge sink={sink} visible />);
    expect(view.getByTestId('fps-debug-badge').textContent).toContain('— FPS');
  });

  it('polls the sink at the configured cadence and renders the latest FPS', () => {
    const sink = createFrameTelemetrySink({ ringSize: 8 });
    sink.observe(event(0));
    sink.observe(event(100));

    const view = renderWithProvider(<FpsDebugBadge sink={sink} visible />);

    act(() => {
      vi.advanceTimersByTime(FPS_BADGE_UPDATE_INTERVAL_MS + 10);
    });

    expect(view.getByTestId('fps-debug-badge').textContent).toMatch(/10\.0 FPS/);
  });
});
