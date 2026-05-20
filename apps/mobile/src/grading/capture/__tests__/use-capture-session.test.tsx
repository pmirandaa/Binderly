// Hook tests — drive `useCaptureSession` from a tiny test
// component so we can observe state transitions without setting
// up the full screen tree.

import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CAPTURE_KINDS, CAPTURE_STEP_COUNT } from '../constants.js';
import { evaluateAttemptFromPixels, useCaptureSession } from '../use-capture-session.js';
import { makeSharpCardBuffer } from './fixtures.js';

import type {
  CaptureAttempt,
  CaptureAttemptInput,
  UseCaptureSessionResult,
} from '../use-capture-session.js';


interface HarnessProps {
  readonly attemptCapture: () => Promise<CaptureAttemptInput>;
  readonly onReady: (result: UseCaptureSessionResult) => void;
  readonly initialId?: string;
  readonly clock?: () => number;
}

function Harness(props: HarnessProps): null {
  const session = useCaptureSession({
    attemptCapture: props.attemptCapture,
    initialId: props.initialId,
    clock: props.clock,
  });
  props.onReady(session);
  return null;
}

function captureRef(): {
  readonly set: (s: UseCaptureSessionResult) => void;
  readonly current: () => UseCaptureSessionResult;
} {
  let current: UseCaptureSessionResult | null = null;
  return {
    set: (s) => {
      current = s;
    },
    current: () => {
      if (current === null) throw new Error('hook not ready');
      return current;
    },
  };
}

/**
 * Drive one full "tap capture → review accept" cycle. Keeps the
 * type-narrowing dance out of every assertion site.
 */
async function acceptOne(ref: {
  readonly current: () => UseCaptureSessionResult;
}): Promise<void> {
  let attempted: CaptureAttempt | null = null;
  await act(async () => {
    attempted = await ref.current().attemptCapture();
  });
  const outcome = attempted as CaptureAttempt | null;
  if (outcome === null || outcome.outcome !== 'accepted') {
    throw new Error('acceptOne: expected accepted outcome');
  }
  act(() => {
    ref.current().acceptShot(outcome.shot);
  });
}

describe('useCaptureSession', () => {
  it('seeds at step 0 with the supplied id', () => {
    const ref = captureRef();
    render(
      <Harness
        attemptCapture={async () => {
          throw new Error('not invoked');
        }}
        onReady={ref.set}
        initialId="seeded-id"
        clock={() => 1234}
      />,
    );
    expect(ref.current().state.id).toBe('seeded-id');
    expect(ref.current().state.startedAt).toBe(1234);
    expect(ref.current().step?.kind).toBe('frontFull');
  });

  it('advances after an accepted attempt is committed via acceptShot', async () => {
    const attempt = vi.fn(async (): Promise<CaptureAttemptInput> => ({
      outcome: 'accepted',
      uri: 'file:///shot-1.jpg',
      width: 1920,
      height: 1080,
      quality: {
        metrics: { sharpness: 20, brightness: 0.5, coverage: 0.5 },
        sharpnessOK: true,
        brightnessOK: true,
        coverageOK: true,
        accepted: true,
        reason: 'great',
      },
    }));
    const ref = captureRef();
    render(<Harness attemptCapture={attempt} onReady={ref.set} initialId="i" clock={() => 1} />);

    let attempted: CaptureAttempt | null = null;
    await act(async () => {
      attempted = await ref.current().attemptCapture();
    });
    const outcome = attempted as CaptureAttempt | null;
    expect(outcome).not.toBeNull();
    if (outcome === null || outcome.outcome !== 'accepted') {
      throw new Error('expected accepted outcome');
    }
    expect(ref.current().state.stepIndex).toBe(0); // not advanced yet

    act(() => {
      ref.current().acceptShot(outcome.shot);
    });
    expect(ref.current().state.stepIndex).toBe(1);
    expect(ref.current().state.shots.frontFull?.uri).toBe('file:///shot-1.jpg');
  });

  it('stays on the current step + records reason on a rejected attempt', async () => {
    const attempt = vi.fn(async (): Promise<CaptureAttemptInput> => ({
      outcome: 'rejected',
      quality: {
        metrics: { sharpness: 1, brightness: 0.05, coverage: 0 },
        sharpnessOK: false,
        brightnessOK: false,
        coverageOK: false,
        accepted: false,
        reason: 'too_dark',
      },
    }));
    const ref = captureRef();
    render(<Harness attemptCapture={attempt} onReady={ref.set} initialId="i" clock={() => 1} />);

    await act(async () => {
      await ref.current().attemptCapture();
    });
    expect(ref.current().state.stepIndex).toBe(0);
    expect(ref.current().state.lastReason).toBe('too_dark');
  });

  it('emits null until all four shots are committed', async () => {
    let captureCount = 0;
    const attempt = async (): Promise<CaptureAttemptInput> => {
      captureCount += 1;
      return {
        outcome: 'accepted',
        uri: `file:///shot-${captureCount}.jpg`,
        width: 1920,
        height: 1080,
        quality: {
          metrics: { sharpness: 20, brightness: 0.5, coverage: 0.5 },
          sharpnessOK: true,
          brightnessOK: true,
          coverageOK: true,
          accepted: true,
          reason: 'great',
        },
      };
    };
    const ref = captureRef();
    render(<Harness attemptCapture={attempt} onReady={ref.set} initialId="i" clock={() => 1} />);

    for (let i = 0; i < CAPTURE_STEP_COUNT - 1; i += 1) {
      await acceptOne(ref);
      expect(ref.current().emitSession()).toBeNull();
    }
    await acceptOne(ref);
    const emitted = ref.current().emitSession();
    expect(emitted).not.toBeNull();
    if (emitted === null) return;
    for (const kind of CAPTURE_KINDS) {
      expect(emitted[kind].kind).toBe(kind);
    }
  });

  it('retakes the requested kind, walking back the step index', async () => {
    const attempt = async (): Promise<CaptureAttemptInput> => ({
      outcome: 'accepted',
      uri: 'file:///x.jpg',
      width: 100,
      height: 100,
      quality: {
        metrics: { sharpness: 20, brightness: 0.5, coverage: 0.5 },
        sharpnessOK: true,
        brightnessOK: true,
        coverageOK: true,
        accepted: true,
        reason: 'great',
      },
    });
    const ref = captureRef();
    render(<Harness attemptCapture={attempt} onReady={ref.set} initialId="i" clock={() => 1} />);

    for (let i = 0; i < CAPTURE_STEP_COUNT; i += 1) {
      await acceptOne(ref);
    }
    expect(ref.current().state.isComplete).toBe(true);

    act(() => {
      ref.current().retakeShot('frontFull');
    });
    expect(ref.current().state.stepIndex).toBe(0);
    expect(ref.current().state.isComplete).toBe(false);
    expect(ref.current().state.shots.frontFull).toBeUndefined();
  });

  it('resetSession returns to a fresh state', async () => {
    const attempt = async (): Promise<CaptureAttemptInput> => ({
      outcome: 'accepted',
      uri: 'file:///x.jpg',
      width: 100,
      height: 100,
      quality: {
        metrics: { sharpness: 20, brightness: 0.5, coverage: 0.5 },
        sharpnessOK: true,
        brightnessOK: true,
        coverageOK: true,
        accepted: true,
        reason: 'great',
      },
    });
    const ref = captureRef();
    let clockNow = 100;
    render(
      <Harness
        attemptCapture={attempt}
        onReady={ref.set}
        initialId="i"
        clock={() => clockNow}
      />,
    );

    await acceptOne(ref);
    expect(ref.current().state.stepIndex).toBe(1);

    clockNow = 500;
    act(() => {
      ref.current().resetSession();
    });
    expect(ref.current().state.stepIndex).toBe(0);
    expect(Object.keys(ref.current().state.shots)).toEqual([]);
    expect(ref.current().state.startedAt).toBe(500);
  });

  it('throws if attemptCapture is invoked on a completed session', async () => {
    const attempt = async (): Promise<CaptureAttemptInput> => ({
      outcome: 'accepted',
      uri: 'file:///x.jpg',
      width: 100,
      height: 100,
      quality: {
        metrics: { sharpness: 20, brightness: 0.5, coverage: 0.5 },
        sharpnessOK: true,
        brightnessOK: true,
        coverageOK: true,
        accepted: true,
        reason: 'great',
      },
    });
    const ref = captureRef();
    render(<Harness attemptCapture={attempt} onReady={ref.set} initialId="i" clock={() => 1} />);

    for (let i = 0; i < CAPTURE_STEP_COUNT; i += 1) {
      await acceptOne(ref);
    }
    await expect(() => ref.current().attemptCapture()).rejects.toThrow(/already complete/);
  });
});

describe('evaluateAttemptFromPixels', () => {
  it('returns an accepted input for a sharp buffer', () => {
    const pixels = makeSharpCardBuffer({ width: 192, height: 256 });
    const input = evaluateAttemptFromPixels(
      { pixels, width: 192, height: 256, uri: 'file:///x.jpg' },
      0.08,
    );
    expect(input.outcome).toBe('accepted');
    if (input.outcome !== 'accepted') return;
    expect(input.uri).toBe('file:///x.jpg');
    expect(input.width).toBe(192);
    expect(input.height).toBe(256);
  });

  it('returns rejected for a sparse buffer that fails the full-card coverage gate', () => {
    const pixels = makeSharpCardBuffer({
      width: 192,
      height: 256,
      cardCoverage: 0.02,
      bandCount: 0,
    });
    const input = evaluateAttemptFromPixels(
      { pixels, width: 192, height: 256, uri: 'file:///x.jpg' },
      0.08,
    );
    expect(input.outcome).toBe('rejected');
  });
});
