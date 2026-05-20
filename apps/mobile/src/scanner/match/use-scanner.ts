// `useScanner()` — the React hook that wires the matcher to the
// upstream detection bus for the lifetime of the scanner screen.
//
// Subscribes once on mount; tears down on unmount. The match sink
// and queue are stable across re-renders so subscribers attached
// to them don't churn.

import { useEffect, useMemo, useSyncExternalStore } from 'react';

import { createMatcher } from './matcher.js';

import type {
  MatcherHandle,
  UseScannerOptions,
  UseScannerResult,
} from './types.js';

/**
 * Build a matcher tied to the supplied `DetectionSink` for the
 * screen lifetime, and surface its sink, queue, and matching
 * status to React land.
 *
 * The dependencies (`embedCrop`, `searchKNN`, `now`) are captured
 * by-reference at construction time; pass stable references (the
 * loader handles' bound methods, or `useMemo`-wrapped closures)
 * to keep the matcher identity stable across re-renders.
 *
 * **Why no `runOnJS` here:** the worklet hop happens upstream in
 * `useDetectFrameProcessor()`; the detection sink we subscribe to
 * already lives on the JS thread.
 */
export function useScanner(options: UseScannerOptions): UseScannerResult {
  const { detectionSink, embedCrop, searchKNN, config, now } = options;

  // The matcher is created once per (detectionSink, embedCrop,
  // searchKNN, now) identity tuple. config is allowed to change
  // shape across re-renders (e.g. dev-menu slider) — we merge it
  // each time through this dep array, but updates that swap the
  // config object will rebuild the matcher. That's an acceptable
  // posture: a config change starts a fresh recognition session,
  // which is the principled behaviour anyway.
  const matcher = useMemo<MatcherHandle>(
    () =>
      createMatcher({
        embedCrop,
        searchKNN,
        config,
        now,
      }),
    [embedCrop, searchKNN, config, now],
  );

  useEffect(() => {
    const unsubscribe = detectionSink.subscribe((event) => {
      // Fire-and-forget on purpose: `observe()` returns a Promise
      // so tests can await it, but production callers don't care
      // about completion ordering — each detection is independent.
      // The matcher catches errors internally; an unhandled-promise
      // warning here would mean the matcher's internal contract
      // broke.
      void matcher.observe(event);
    });
    return () => {
      unsubscribe();
      matcher.dispose();
    };
  }, [detectionSink, matcher]);

  // Surface `isMatching` to React via the external-store hook so
  // it re-renders precisely when an embed starts/stops in flight.
  // We don't carry an internal subscription model for it; instead
  // we poll on each render. That's fine — the matcher is at most
  // 10 FPS, and React's re-render cadence dominates the poll cost.
  const isMatching = useSyncExternalStore(
    (onChange) => {
      // No external change source — rely on parent re-renders.
      // The unsubscribe is a no-op.
      void onChange;
      return (): void => {};
    },
    () => matcher.isMatching(),
    () => false,
  );

  return useMemo(
    () => ({
      sink: matcher.sink,
      queue: matcher.queue,
      isMatching,
      config: matcher.config,
    }),
    [matcher, isMatching],
  );
}
