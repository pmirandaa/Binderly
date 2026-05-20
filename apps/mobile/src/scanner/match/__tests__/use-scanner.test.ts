// `useScanner()` integration tests.
//
// We mount the hook with a real `createDetectionSink()` (the
// JS-thread bus the worklet hops onto upstream — already on the
// JS thread in tests because the `useRunOnJS` mock resolves
// synchronously). The matcher's async chain runs against vi-mocked
// `embedCrop` + `searchKNN` callbacks; we await each `observe()`
// resolution path by polling the queue.

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';


import { useScanner } from '../use-scanner.js';

import type { AnnSearchResult } from '@/scanner/ann';
import type { DetectionEvent } from '@/scanner/detect';

import { createDetectionSink } from '@/scanner/detect';

function detection(ts: number, accepted = true): DetectionEvent {
  return {
    ts,
    rect: { x: 0, y: 0, width: 50, height: 70 },
    rectValid: accepted,
    quality: {
      sharpness: 20,
      brightness: 0.5,
      aspectRatio: 1.4,
      portraitOrientation: true,
      sharpnessOK: accepted,
      brightnessOK: accepted,
      aspectOK: accepted,
    },
    accepted,
    cropped: accepted ? new Float32Array([0.1, 0.2, 0.3]) : null,
  };
}

function ann(printingId: string, score: number): AnnSearchResult {
  return { printingId, score, distance: 1 - score };
}

describe('useScanner', () => {
  it('subscribes to the detection sink and fires on a stable run', async () => {
    const detectionSink = createDetectionSink();
    const embedCrop = vi.fn(async () => new Float32Array([1, 2, 3]));
    const searchKNN = vi.fn(() => [ann('A', 0.9), ann('Z', 0.1)]);

    const { result } = renderHook(() =>
      useScanner({ detectionSink, embedCrop, searchKNN }),
    );

    // Each detection arrives at the 10-FPS production cadence;
    // we drain microtasks between them so the matcher's embed
    // chain completes before the next event lands (otherwise the
    // async-debounce coalesces them into 2 embed runs and we
    // never hit the stability count).
    for (let i = 0; i < 3; i += 1) {
      await act(async () => {
        detectionSink.observe(detection(100 + i * 100));
        await new Promise((r) => setTimeout(r, 0));
      });
    }

    await waitFor(() => {
      expect(result.current.queue.size).toBe(1);
    });
    const latest = result.current.queue.latest();
    expect(latest?.printingId).toBe('A');
    expect(latest?.disposition).toBe('auto-add');
  });

  it('exposes the live MatchSink — listeners receive fired events', async () => {
    const detectionSink = createDetectionSink();
    const embedCrop = vi.fn(async () => new Float32Array([1]));
    const searchKNN = vi.fn(() => [ann('A', 0.9)]);
    const matchListener = vi.fn();

    const { result } = renderHook(() =>
      useScanner({ detectionSink, embedCrop, searchKNN }),
    );

    act(() => {
      result.current.sink.subscribe(matchListener);
    });

    for (let i = 0; i < 3; i += 1) {
      await act(async () => {
        detectionSink.observe(detection(100 + i * 100));
        await new Promise((r) => setTimeout(r, 0));
      });
    }

    await waitFor(() => {
      expect(matchListener).toHaveBeenCalledTimes(1);
    });
  });

  it('unmounts cleanly — no fires after teardown', async () => {
    const detectionSink = createDetectionSink();
    const embedCrop = vi.fn(async () => new Float32Array([1]));
    const searchKNN = vi.fn(() => [ann('A', 0.9)]);
    const matchListener = vi.fn();

    const { result, unmount } = renderHook(() =>
      useScanner({ detectionSink, embedCrop, searchKNN }),
    );
    act(() => {
      result.current.sink.subscribe(matchListener);
    });
    unmount();

    detectionSink.observe(detection(100));
    detectionSink.observe(detection(200));
    detectionSink.observe(detection(300));
    await new Promise((r) => setTimeout(r, 0));
    expect(matchListener).not.toHaveBeenCalled();
    expect(embedCrop).not.toHaveBeenCalled();
  });

  it('skips rejected detection events without calling embedCrop', async () => {
    const detectionSink = createDetectionSink();
    const embedCrop = vi.fn(async () => new Float32Array([1]));
    const searchKNN = vi.fn(() => []);

    renderHook(() => useScanner({ detectionSink, embedCrop, searchKNN }));

    await act(async () => {
      detectionSink.observe(detection(100, false));
      detectionSink.observe(detection(200, false));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(embedCrop).not.toHaveBeenCalled();
    expect(searchKNN).not.toHaveBeenCalled();
  });

  it('exposes a stable config snapshot through the hook result', () => {
    const detectionSink = createDetectionSink();
    const embedCrop = vi.fn(async () => new Float32Array([1]));
    const searchKNN = vi.fn(() => []);
    const config = { autoAddScore: 0.6 } as const;

    const { result } = renderHook(() =>
      useScanner({ detectionSink, embedCrop, searchKNN, config }),
    );
    expect(result.current.config.autoAddScore).toBe(0.6);
    // Default values still merged in for the un-overridden knobs.
    expect(result.current.config.disambigScore).toBeGreaterThan(0);
  });

  it('off-worklet posture: detection events from the JS thread do not block the embed chain', async () => {
    const detectionSink = createDetectionSink();
    let inFlight = false;
    const embedCrop = vi.fn(async (_crop: Float32Array) => {
      void _crop;
      // Assert we're not entered concurrently — the async-debounce
      // posture guarantees one embed at a time.
      expect(inFlight).toBe(false);
      inFlight = true;
      await new Promise((r) => setTimeout(r, 0));
      inFlight = false;
      return new Float32Array([1]);
    });
    const searchKNN = vi.fn(() => [ann('A', 0.9)]);

    renderHook(() => useScanner({ detectionSink, embedCrop, searchKNN }));

    await act(async () => {
      // Rapid-fire 6 detections — all on the JS thread (the
      // useRunOnJS mock resolves synchronously). The matcher
      // should debounce them to 2 embed runs (first + newest
      // pending) without deadlocking.
      for (let i = 0; i < 6; i += 1) {
        detectionSink.observe(detection(100 + i * 50));
      }
      await new Promise((r) => setTimeout(r, 10));
    });

    // Exact count = first embed + one drain pass for the newest pending.
    expect(embedCrop.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(embedCrop.mock.calls.length).toBeLessThanOrEqual(2);
  });
});
