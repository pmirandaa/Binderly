// Transcoder tests — synthesize tiny PNG/JPEG fixtures via sharp's
// `{ create: ... }` constructor and assert on the WebP output of
// each ladder rung.
//
// Why synthetic fixtures: per the elaborated task spec, we never
// commit upstream binary samples (legal posture + repo size). sharp
// can synthesize a deterministic PNG/JPEG in a few ms; that's the
// fixture surface for every test in the image pipeline.

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { isWebpBuffer, transcode } from './transcoder.js';
import { TranscodeError, VARIANT_LADDER, type VariantSpec } from './types.js';

async function synthesizePng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
}

async function synthesizeJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 0, g: 200, b: 100 },
    },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
}

describe('transcode (happy path)', () => {
  it('produces all four ladder variants from a synthesized PNG', async () => {
    const src = await synthesizePng(2048, 2868);
    const variants = await transcode(src);

    expect(variants).toHaveLength(VARIANT_LADDER.length);
    expect(variants.map((v) => v.name)).toEqual(['thumb', 'card', 'large', 'original']);
    for (const v of variants) {
      expect(v.contentType).toBe('image/webp');
      expect(isWebpBuffer(v.buffer)).toBe(true);
      expect(v.buffer.length).toBeGreaterThan(0);
    }
  });

  it('respects the variant ladder max-side caps (PNG source)', async () => {
    const src = await synthesizePng(2000, 2800);
    const variants = await transcode(src);
    const byName = new Map(variants.map((v) => [v.name, v]));

    expect(Math.max(byName.get('thumb')!.width, byName.get('thumb')!.height)).toBeLessThanOrEqual(
      256,
    );
    expect(Math.max(byName.get('card')!.width, byName.get('card')!.height)).toBeLessThanOrEqual(
      512,
    );
    expect(Math.max(byName.get('large')!.width, byName.get('large')!.height)).toBeLessThanOrEqual(
      1024,
    );
    // `original` preserves source dimensions.
    expect(byName.get('original')!.width).toBe(2000);
    expect(byName.get('original')!.height).toBe(2800);
  });

  it('does not upscale when source is smaller than the variant cap', async () => {
    const src = await synthesizePng(64, 96);
    const variants = await transcode(src);
    for (const v of variants) {
      // No variant should exceed source dimensions on either axis.
      expect(v.width).toBeLessThanOrEqual(64);
      expect(v.height).toBeLessThanOrEqual(96);
    }
  });

  it('handles a JPEG source the same as a PNG source', async () => {
    const src = await synthesizeJpeg(800, 1120);
    const variants = await transcode(src);
    for (const v of variants) {
      expect(isWebpBuffer(v.buffer)).toBe(true);
    }
  });
});

describe('transcode (ladder override)', () => {
  it('honors a custom single-rung ladder for fast tests', async () => {
    const src = await synthesizePng(400, 560);
    const ladder: VariantSpec[] = [
      { name: 'thumb', maxSide: 64, quality: 70, effort: 4, lossless: false },
    ];
    const variants = await transcode(src, { ladder });
    expect(variants).toHaveLength(1);
    expect(variants[0]!.name).toBe('thumb');
    expect(Math.max(variants[0]!.width, variants[0]!.height)).toBeLessThanOrEqual(64);
  });

  it('emits lossless WebP when the ladder asks for it', async () => {
    const src = await synthesizePng(120, 168);
    const ladder: VariantSpec[] = [
      { name: 'original', maxSide: null, quality: 100, effort: 4, lossless: true },
    ];
    const variants = await transcode(src, { ladder });
    expect(isWebpBuffer(variants[0]!.buffer)).toBe(true);
    // Re-decode the lossless output and assert pixel parity (RGB
    // means; alpha may differ in lossy paths but lossless preserves
    // it). The synthetic fixture is solid red.
    const decoded = await sharp(variants[0]!.buffer).raw().toBuffer({ resolveWithObject: true });
    const r = decoded.data[0];
    const g = decoded.data[1];
    const b = decoded.data[2];
    expect(r).toBe(255);
    expect(g).toBe(0);
    expect(b).toBe(0);
  });
});

describe('transcode (error paths)', () => {
  it('throws TranscodeError on an empty buffer', async () => {
    await expect(transcode(Buffer.alloc(0))).rejects.toBeInstanceOf(TranscodeError);
  });

  it('throws TranscodeError on a non-image buffer', async () => {
    const garbage = Buffer.from('not an image, just some text and bytes', 'utf8');
    await expect(transcode(garbage)).rejects.toBeInstanceOf(TranscodeError);
  });

  it('throws TranscodeError when ladder is empty', async () => {
    const src = await synthesizePng(64, 96);
    await expect(transcode(src, { ladder: [] })).rejects.toBeInstanceOf(TranscodeError);
  });
});

describe('isWebpBuffer', () => {
  it('returns false for too-short buffers', () => {
    expect(isWebpBuffer(Buffer.alloc(0))).toBe(false);
    expect(isWebpBuffer(Buffer.alloc(11))).toBe(false);
  });

  it('returns false for a PNG buffer', async () => {
    const png = await synthesizePng(8, 8);
    expect(isWebpBuffer(png)).toBe(false);
  });

  it('returns true for a real WebP', async () => {
    const src = await synthesizePng(64, 64);
    const variants = await transcode(src);
    expect(isWebpBuffer(variants[0]!.buffer)).toBe(true);
  });
});
