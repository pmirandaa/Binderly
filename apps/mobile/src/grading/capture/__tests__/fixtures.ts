// Synthetic RGB-pixel fixtures used by the quality + screen tests.
//
// All buffers are RGB, HWC layout, length = `width * height * 3`.
// Helpers below build buffers with predictable luminance + gradient
// characteristics so per-axis OK flags are deterministic.

/** Build a uniform-colour buffer. Triggers `no_card_detected` (zero coverage). */
export function makeUniformBuffer(
  width: number,
  height: number,
  rgb: readonly [number, number, number],
): Uint8Array {
  const buf = new Uint8Array(width * height * 3);
  for (let i = 0; i < buf.length; i += 3) {
    buf[i] = rgb[0];
    buf[i + 1] = rgb[1];
    buf[i + 2] = rgb[2];
  }
  return buf;
}

/**
 * Build a high-contrast buffer with a centered rectangle. Used as
 * the "good capture" fixture — sharpness, brightness, coverage
 * all pass the stricter capture gate by default.
 */
export function makeSharpCardBuffer(options: {
  readonly width: number;
  readonly height: number;
  readonly cardCoverage?: number;
  readonly background?: readonly [number, number, number];
  readonly card?: readonly [number, number, number];
  /** Number of interior bands to draw on the card (sharpness boost). */
  readonly bandCount?: number;
}): Uint8Array {
  const {
    width,
    height,
    cardCoverage = 0.75,
    background = [40, 40, 40] as const,
    card = [220, 220, 220] as const,
    bandCount = 8,
  } = options;
  const buf = makeUniformBuffer(width, height, background);
  const cardW = Math.floor(width * Math.sqrt(cardCoverage));
  const cardH = Math.floor(height * Math.sqrt(cardCoverage));
  const x0 = Math.floor((width - cardW) / 2);
  const y0 = Math.floor((height - cardH) / 2);
  const x1 = x0 + cardW;
  const y1 = y0 + cardH;
  for (let y = y0; y < y1; y += 1) {
    const row = y * width * 3;
    for (let x = x0; x < x1; x += 1) {
      const i = row + x * 3;
      buf[i] = card[0];
      buf[i + 1] = card[1];
      buf[i + 2] = card[2];
    }
  }
  // Interior banding — alternating dark/light horizontal stripes to
  // produce many gradient events inside the card, boosting the
  // mean-gradient sharpness.
  if (bandCount > 0) {
    const bandSpacing = Math.max(2, Math.floor(cardH / bandCount));
    for (let band = 0; band < bandCount; band += 1) {
      const yBand = y0 + band * bandSpacing;
      if (yBand >= y1) break;
      const row = yBand * width * 3;
      for (let x = x0; x < x1; x += 1) {
        const i = row + x * 3;
        buf[i] = background[0];
        buf[i + 1] = background[1];
        buf[i + 2] = background[2];
      }
    }
  }
  return buf;
}

/**
 * Build a "blurry but well-framed" buffer — a large soft-edged
 * card with no interior banding. Edge pixels produce a little
 * coverage so we don't trip `no_card_detected`, but the mean
 * gradient stays well below the sharpness floor.
 */
export function makeBlurryBuffer(width: number, height: number): Uint8Array {
  return makeSharpCardBuffer({
    width,
    height,
    cardCoverage: 0.9,
    background: [120, 120, 120],
    card: [160, 160, 160],
    bandCount: 0,
  });
}

/**
 * Build a buffer with no card edges + no interior content — used
 * to verify the `no_card_detected` short-circuit.
 */
export function makeEmptyFrameBuffer(width: number, height: number): Uint8Array {
  return makeUniformBuffer(width, height, [128, 128, 128]);
}

/** Build a very dark buffer. Triggers `too_dark`. */
export function makeDarkBuffer(width: number, height: number): Uint8Array {
  return makeSharpCardBuffer({
    width,
    height,
    background: [5, 5, 5],
    card: [25, 25, 25],
    cardCoverage: 0.75,
    bandCount: 8,
  });
}

/** Build an over-exposed buffer. Triggers `over_exposed`. */
export function makeOverExposedBuffer(width: number, height: number): Uint8Array {
  return makeSharpCardBuffer({
    width,
    height,
    background: [250, 250, 250],
    card: [255, 255, 255],
    cardCoverage: 0.75,
    bandCount: 8,
  });
}

/**
 * Build a sharp + well-exposed buffer with a moderately-sized
 * card whose **edge-pixel coverage** still falls below the strict
 * full-card gate but above zero. Triggers `off_center` (NOT
 * `no_card_detected`).
 */
export function makeOffCenterBuffer(width: number, height: number): Uint8Array {
  return makeSharpCardBuffer({
    width,
    height,
    cardCoverage: 0.5,
    bandCount: 6,
  });
}
