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
    frontCorner: shot('frontCorner', 'file:///tl.jpg'),
    backCorner: shot('backCorner', 'file:///tr.jpg'),
    bottomLeftCorner: shot('bottomLeftCorner', 'file:///bl.jpg'),
    bottomRightCorner: shot('bottomRightCorner', 'file:///br.jpg'),
    surface: shot('surface', 'file:///surface.jpg'),
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

  it('maps the four corner crops to the corners array in [TL, TR, BL, BR] order', () => {
    const images = sessionToImages(session());
    expect(images.corners).toEqual([
      'file:///tl.jpg',
      'file:///tr.jpg',
      'file:///bl.jpg',
      'file:///br.jpg',
    ]);
  });

  it('maps the raking-light shot to surface', () => {
    const images = sessionToImages(session());
    expect(images.surface).toBe('file:///surface.jpg');
  });
});
