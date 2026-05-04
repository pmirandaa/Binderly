// `transcode` — pure-ish wrapper over `sharp` that produces the
// variant ladder defined in `./types.ts`. The function accepts
// raw image bytes (PNG / JPEG / GIF / WebP — any format sharp
// understands) and returns a parallel array of WebP buffers + the
// dimensions sharp resolved.
//
// Why we own this in a separate module:
//
//   - Keeps the storage-agnostic transcode contract testable in
//     isolation (no S3 client, no rate-limited HTTP).
//   - Lets the seed-ingest job, the per-source backfill jobs, and
//     any future re-transcode batch share one implementation.
//
// The sharp dependency is the single point of contact with libvips.
// Bundled prebuilt binaries cover darwin-arm64 and linux-x64/arm64
// (the only platforms we run on); CI will fail loudly if a future
// platform is added without a matching binary.

import sharp from 'sharp';

import { TranscodeError, VARIANT_LADDER, type VariantSpec } from './types.js';

export interface TranscodedVariant {
  readonly name: VariantSpec['name'];
  readonly buffer: Buffer;
  readonly width: number;
  readonly height: number;
  readonly contentType: 'image/webp';
}

export interface TranscodeOptions {
  /** Override the canonical ladder (tests use a single 64px tier). */
  readonly ladder?: ReadonlyArray<VariantSpec>;
}

/**
 * Decode the source bytes once, then encode each variant from a
 * cloned pipeline. Cloning shares the libvips decoder cache instead
 * of redoing the decode N times.
 *
 * The output array preserves ladder order.
 */
export async function transcode(
  source: Buffer,
  options: TranscodeOptions = {},
): Promise<TranscodedVariant[]> {
  if (!Buffer.isBuffer(source) || source.length === 0) {
    throw new TranscodeError('transcoder: source buffer is empty', {
      source: 'transcoder',
    });
  }
  const ladder = options.ladder ?? VARIANT_LADDER;
  if (ladder.length === 0) {
    throw new TranscodeError('transcoder: ladder is empty', { source: 'transcoder' });
  }

  // Resolve source dimensions up front so we can short-circuit
  // resizes when the variant max-side is already larger than the
  // source (avoids upscaling artefacts in tests with tiny inputs).
  let metadataWidth: number;
  let metadataHeight: number;
  try {
    const meta = await sharp(source).metadata();
    if (typeof meta.width !== 'number' || typeof meta.height !== 'number') {
      throw new TranscodeError('transcoder: source metadata missing dimensions', {
        source: 'transcoder',
      });
    }
    metadataWidth = meta.width;
    metadataHeight = meta.height;
  } catch (err) {
    if (err instanceof TranscodeError) throw err;
    throw new TranscodeError('transcoder: failed to read source metadata', {
      source: 'transcoder',
      cause: err,
    });
  }

  const out: TranscodedVariant[] = [];
  for (const spec of ladder) {
    out.push(await encodeVariant(source, spec, metadataWidth, metadataHeight));
  }
  return out;
}

async function encodeVariant(
  source: Buffer,
  spec: VariantSpec,
  srcWidth: number,
  srcHeight: number,
): Promise<TranscodedVariant> {
  try {
    let pipeline = sharp(source, { failOn: 'error' });
    if (spec.maxSide != null) {
      const longest = Math.max(srcWidth, srcHeight);
      // Skip the resize when the variant ladder is wider than the
      // source — sharp would otherwise upscale, producing a bigger
      // file than the original for no quality gain.
      if (longest > spec.maxSide) {
        pipeline = pipeline.resize({
          width: spec.maxSide,
          height: spec.maxSide,
          fit: 'inside',
          withoutEnlargement: true,
        });
      }
    }
    const webpOptions: sharp.WebpOptions = {
      effort: spec.effort,
    };
    if (spec.lossless) {
      webpOptions.lossless = true;
      // sharp ignores `quality` when lossless; explicit assignment
      // keeps the type signature consistent.
    } else {
      webpOptions.quality = spec.quality;
    }
    const { data, info } = await pipeline.webp(webpOptions).toBuffer({ resolveWithObject: true });
    if (!isWebpBuffer(data)) {
      throw new TranscodeError('transcoder: encoded buffer is not a WebP container', {
        source: 'transcoder',
        target: spec.name,
      });
    }
    return {
      name: spec.name,
      buffer: data,
      width: info.width,
      height: info.height,
      contentType: 'image/webp',
    };
  } catch (err) {
    if (err instanceof TranscodeError) throw err;
    throw new TranscodeError(`transcoder: failed to encode variant ${spec.name}`, {
      source: 'transcoder',
      target: spec.name,
      cause: err,
    });
  }
}

/**
 * Magic-byte check for the WebP container. Standard WebP files
 * carry the `RIFF` FourCC at byte 0 and `WEBP` at byte 8.
 *
 * Exported so consumer tests (`processor.test.ts`) can assert on
 * raw bytes without re-deriving the constants.
 */
export function isWebpBuffer(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  return (
    buffer[0] === 0x52 && // 'R'
    buffer[1] === 0x49 && // 'I'
    buffer[2] === 0x46 && // 'F'
    buffer[3] === 0x46 && // 'F'
    buffer[8] === 0x57 && // 'W'
    buffer[9] === 0x45 && // 'E'
    buffer[10] === 0x42 && // 'B'
    buffer[11] === 0x50 //   'P'
  );
}
