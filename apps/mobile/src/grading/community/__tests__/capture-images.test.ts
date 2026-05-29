import { describe, expect, it } from 'vitest';

import { sessionToImages } from '../capture-images';

import type { GradingCaptureSession, GradingShot } from '../../capture/types';

function shot(kind: GradingShot['kind'], uri: string): GradingShot {
  return {
    kind,
    uri,
    width: 1000,
    height: 1400,
    quality: {
      metrics: { sharpness: 1, brightness: 0.5, coverage: 0.8 },
      sharpnessOK: true,
      brightnessOK: true,
      coverageOK: true,
      accepted: true,
      reason: 'great',
    },
    capturedAt: 1,
  };
}

function session(): GradingCaptureSession {
  return {
    frontFull: shot('frontFull', 'file:///front.jpg'),
    backFull: shot('backFull', 'file:///back.jpg'),
    frontCorner: shot('frontCorner', 'file:///fc.jpg'),
    backCorner: shot('backCorner', 'file:///bc.jpg'),
    id: 'session-1',
    startedAt: 1,
    completedAt: 2,
  };
}

describe('sessionToImages', () => {
  it('maps the full shots to front/back', () => {
    const images = sessionToImages(session());
    expect(images.front).toBe('file:///front.jpg');
    expect(images.back).toBe('file:///back.jpg');
  });

  it('maps the corner crops to the corners array', () => {
    const images = sessionToImages(session());
    expect(images.corners).toEqual(['file:///fc.jpg', 'file:///bc.jpg']);
  });
});
