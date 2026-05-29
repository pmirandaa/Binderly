// Capture-button state derivation tests (#FU-33) — pure decision table.

import { describe, expect, it } from 'vitest';

import { deriveCaptureButtonState } from '../capture-button.js';

import type { CaptureQualityResult } from '../types.js';

function quality(
  accepted: boolean,
  reason: CaptureQualityResult['reason'],
): CaptureQualityResult {
  return {
    metrics: { sharpness: accepted ? 20 : 2, brightness: 0.5, coverage: 0.5 },
    sharpnessOK: accepted,
    brightnessOK: true,
    coverageOK: accepted,
    accepted,
    reason,
  };
}

describe('deriveCaptureButtonState', () => {
  it('disables with "Done" when the session is complete', () => {
    const state = deriveCaptureButtonState({
      liveQuality: null,
      sessionComplete: true,
      busy: false,
    });
    expect(state).toEqual({ disabled: true, label: 'Done', liveReason: null });
  });

  it('disables while a capture is in flight (busy) but keeps the Capture label', () => {
    const state = deriveCaptureButtonState({
      liveQuality: quality(true, 'great'),
      sessionComplete: false,
      busy: true,
    });
    expect(state.disabled).toBe(true);
    expect(state.label).toBe('Capture');
    expect(state.liveReason).toBeNull();
  });

  it('falls back to an enabled Capture button when there is no live sample', () => {
    const state = deriveCaptureButtonState({
      liveQuality: null,
      sessionComplete: false,
      busy: false,
    });
    expect(state).toEqual({ disabled: false, label: 'Capture', liveReason: null });
  });

  it('disables with "Hold steady" + surfaces the reason when live quality fails the gate', () => {
    const state = deriveCaptureButtonState({
      liveQuality: quality(false, 'blurry'),
      sessionComplete: false,
      busy: false,
    });
    expect(state.disabled).toBe(true);
    expect(state.label).toBe('Hold steady');
    expect(state.liveReason).toBe('blurry');
  });

  it('enables Capture + reports "great" when live quality passes the gate', () => {
    const state = deriveCaptureButtonState({
      liveQuality: quality(true, 'great'),
      sessionComplete: false,
      busy: false,
    });
    expect(state).toEqual({ disabled: false, label: 'Capture', liveReason: 'great' });
  });

  it('prioritises session-complete over a passing live sample', () => {
    const state = deriveCaptureButtonState({
      liveQuality: quality(true, 'great'),
      sessionComplete: true,
      busy: false,
    });
    expect(state.label).toBe('Done');
    expect(state.disabled).toBe(true);
  });
});
